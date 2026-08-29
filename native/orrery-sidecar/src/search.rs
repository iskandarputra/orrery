//! Vault full-text search — a port of `LinkScanner.search`
//! (`src/main/services/link-scanner.ts:98-145`).
//!
//! The TypeScript body is the specification. Every behaviour below exists
//! because that implementation has it, and the differential test in
//! `src/main/services/search-rust.test.ts` compares the two directly.
//!
//! The one deliberate divergence is ordering — see `MAX_HITS` below.

use crate::glob::{matches_any_glob, parse_pattern_list};
use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Matches `MAX_HITS` in link-scanner.ts.
const MAX_HITS: usize = 200;
/// Matches `MAX_FILE_BYTES` in link-scanner.ts.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// Matches `IGNORED_DIRS` in link-scanner.ts.
const IGNORED_DIRS: [&str; 4] = ["node_modules", ".git", ".svn", ".hg"];

#[derive(Debug, Deserialize)]
pub struct SearchRequest {
    pub root_path: String,
    pub query: String,
    pub use_regex: bool,
    pub case_sensitive: bool,
    /// Match only where the query is bounded by non-word characters.
    #[serde(default)]
    pub whole_word: bool,
    /// Comma-separated globs. Empty means every file.
    #[serde(default)]
    pub include: String,
    /// Comma-separated globs. Empty means no file is excluded.
    #[serde(default)]
    pub exclude: String,
}

/// Mirrors `BacklinkHit` in `src/shared/types.ts`.
#[derive(Debug, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct Hit {
    pub path: String,
    pub line: usize,
    pub snippet: String,
}

/// The vault-relative path, with forward slashes, as the globs are written.
fn relative_of(root: &str, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// The first 200 *characters* of the trimmed line.
///
/// `String::slice(0, 200)` in JavaScript counts UTF-16 code units; taking bytes
/// here would panic on a multi-byte boundary, and taking chars is the closest
/// safe equivalent for the text this actually sees.
fn snippet_of(line: &str) -> String {
    line.trim().chars().take(200).collect()
}

pub fn search(req: &SearchRequest) -> Vec<Hit> {
    // A non-regex query is matched literally, exactly as the TypeScript escapes it.
    let source = if req.use_regex {
        req.query.clone()
    } else {
        regex::escape(&req.query)
    };
    // Bounding the whole pattern rather than each alternative, as the
    // TypeScript does — `\b(?:a|b)\b`, never `\ba|b\b`.
    let pattern = if req.whole_word {
        format!("\\b(?:{source})\\b")
    } else {
        source
    };
    // An invalid regex yields no hits rather than an error — same as the
    // TypeScript `catch { return [] }`.
    let Ok(matcher) = RegexBuilder::new(&pattern)
        .case_insensitive(!req.case_sensitive)
        .build()
    else {
        return Vec::new();
    };

    let mut hits: Vec<Hit> = Vec::new();
    let include = parse_pattern_list(&req.include);
    let exclude = parse_pattern_list(&req.exclude);

    let walker = WalkBuilder::new(&req.root_path)
        .hidden(true) // skip dotfiles, as the TypeScript does
        .git_ignore(false) // the TypeScript honours no ignore files
        .git_global(false)
        .git_exclude(false)
        .parents(false)
        .filter_entry(|entry| {
            !entry
                .file_name()
                .to_str()
                .is_some_and(|name| IGNORED_DIRS.contains(&name))
        })
        .build();

    for entry in walker.flatten() {
        let path = entry.path();
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let relative = relative_of(&req.root_path, path);
        if !include.is_empty() && !matches_any_glob(&relative, &include) {
            continue;
        }
        if !exclude.is_empty() && matches_any_glob(&relative, &exclude) {
            continue;
        }
        if fs::metadata(path).map(|m| m.len() > MAX_FILE_BYTES).unwrap_or(true) {
            continue; // too large, or unreadable — skipped either way
        }
        let Ok(text) = fs::read_to_string(path) else {
            continue; // not valid UTF-8, or unreadable
        };
        if text.contains('\0') {
            continue; // binary, as the TypeScript decides it
        }
        for (index, line) in text.split('\n').enumerate() {
            if matcher.is_match(line) {
                hits.push(Hit {
                    path: path.to_string_lossy().into_owned(),
                    line: index + 1, // 1-based, as the TypeScript reports
                    snippet: snippet_of(line),
                });
            }
        }
    }

    // Deliberate divergence: the TypeScript stops mid-walk at MAX_HITS, so which
    // 500 hits you get depends on readdir order. Sorting first makes the capped
    // set deterministic and reproducible instead. Below the cap the two agree
    // exactly once both are sorted, which is what the differential test asserts.
    hits.sort();
    hits.truncate(MAX_HITS);
    hits
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    struct Vault(PathBuf);

    impl Vault {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("orrery-search-test-{name}"));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Vault(dir)
        }
        fn write(&self, rel: &str, body: &str) {
            let path = self.0.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, body).unwrap();
        }
        fn find(&self, query: &str, use_regex: bool, case_sensitive: bool) -> Vec<Hit> {
            self.find_with(query, use_regex, case_sensitive, false, "", "")
        }
        #[allow(clippy::too_many_arguments)]
        fn find_with(
            &self,
            query: &str,
            use_regex: bool,
            case_sensitive: bool,
            whole_word: bool,
            include: &str,
            exclude: &str,
        ) -> Vec<Hit> {
            search(&SearchRequest {
                root_path: self.0.to_string_lossy().into_owned(),
                query: query.into(),
                use_regex,
                case_sensitive,
                whole_word,
                include: include.into(),
                exclude: exclude.into(),
            })
        }
    }

    impl Drop for Vault {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn finds_a_literal_match_with_a_one_based_line() {
        let v = Vault::new("literal");
        v.write("a.md", "first\nsecond needle\nthird");
        let hits = v.find("needle", false, false);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 2);
        assert_eq!(hits[0].snippet, "second needle");
    }

    #[test]
    fn is_case_insensitive_unless_asked() {
        let v = Vault::new("case");
        v.write("a.md", "Needle");
        assert_eq!(v.find("needle", false, false).len(), 1);
        assert_eq!(v.find("needle", false, true).len(), 0);
    }

    #[test]
    fn treats_a_non_regex_query_literally() {
        // Without escaping, "a.c" would match "abc".
        let v = Vault::new("literalescape");
        v.write("a.md", "abc\na.c");
        let hits = v.find("a.c", false, false);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].snippet, "a.c");
    }

    #[test]
    fn honours_a_regex_when_asked() {
        let v = Vault::new("regex");
        v.write("a.md", "abc\nxyz");
        assert_eq!(v.find("^a.c$", true, false).len(), 1);
    }

    #[test]
    fn returns_nothing_for_an_invalid_regex() {
        let v = Vault::new("badregex");
        v.write("a.md", "anything");
        assert_eq!(v.find("(unclosed", true, false).len(), 0);
    }

    #[test]
    fn looks_at_every_text_file_not_only_markdown() {
        // The vault is a folder and it holds code; a search that cannot see it
        // is the wrong search.
        let v = Vault::new("exts");
        v.write("a.md", "needle");
        v.write("e.txt", "needle");
        v.write("f.rs", "needle");
        assert_eq!(v.find("needle", false, false).len(), 3);
    }

    #[test]
    fn include_narrows_to_matching_files() {
        let v = Vault::new("include");
        v.write("a.md", "needle");
        v.write("src/b.rs", "needle");
        v.write("src/c.md", "needle");
        assert_eq!(v.find_with("needle", false, false, false, "*.md", "").len(), 2);
        assert_eq!(v.find_with("needle", false, false, false, "src/**", "").len(), 2);
    }

    #[test]
    fn exclude_removes_matching_files() {
        let v = Vault::new("exclude");
        v.write("a.md", "needle");
        v.write("dist/b.md", "needle");
        assert_eq!(v.find_with("needle", false, false, false, "", "dist/**").len(), 1);
    }

    #[test]
    fn whole_word_does_not_match_inside_a_longer_word() {
        let v = Vault::new("word");
        v.write("a.md", "testing");
        v.write("b.md", "a test here");
        assert_eq!(v.find("test", false, false).len(), 2);
        assert_eq!(v.find_with("test", false, false, true, "", "").len(), 1);
    }

    #[test]
    fn skips_binary_files() {
        // Decided by content, not by extension: an extension list is a guess
        // that is wrong for exactly the files people care about.
        let v = Vault::new("binary");
        v.write("a.md", "needle");
        v.write("b.dat", "needle\u{0}more");
        assert_eq!(v.find("needle", false, false).len(), 1);
    }

    #[test]
    fn skips_dotfiles_and_ignored_directories() {
        let v = Vault::new("ignored");
        v.write("visible.md", "needle");
        v.write(".hidden.md", "needle");
        v.write("node_modules/dep.md", "needle");
        v.write(".git/x.md", "needle");
        let hits = v.find("needle", false, false);
        assert_eq!(hits.len(), 1);
        assert!(hits[0].path.ends_with("visible.md"));
    }

    #[test]
    fn skips_a_file_over_the_size_cap() {
        let v = Vault::new("toobig");
        v.write("small.md", "needle");
        v.write("big.md", &format!("needle\n{}", "x".repeat(MAX_FILE_BYTES as usize + 1)));
        assert_eq!(v.find("needle", false, false).len(), 1);
    }

    #[test]
    fn truncates_a_long_snippet_to_200_characters() {
        let v = Vault::new("snippet");
        v.write("a.md", &"z".repeat(500));
        assert_eq!(v.find("zzz", false, false)[0].snippet.chars().count(), 200);
    }

    #[test]
    fn trims_the_snippet() {
        let v = Vault::new("trim");
        v.write("a.md", "    needle    ");
        assert_eq!(v.find("needle", false, false)[0].snippet, "needle");
    }

    #[test]
    fn reports_every_matching_line_in_one_file() {
        let v = Vault::new("multi");
        v.write("a.md", "needle\nno\nneedle");
        let hits = v.find("needle", false, false);
        assert_eq!(hits.iter().map(|h| h.line).collect::<Vec<_>>(), vec![1, 3]);
    }

    #[test]
    fn caps_the_result_set_deterministically() {
        let v = Vault::new("cap");
        for i in 0..60 {
            v.write(&format!("n{i:03}.md"), &"needle\n".repeat(20));
        }
        let first = v.find("needle", false, false);
        let second = v.find("needle", false, false);
        assert_eq!(first.len(), MAX_HITS);
        assert_eq!(first, second, "the capped set must be reproducible");
    }

    #[test]
    fn returns_nothing_for_a_missing_root() {
        let hits = search(&SearchRequest {
            root_path: "/definitely/not/here".into(),
            query: "needle".into(),
            use_regex: false,
            case_sensitive: false,
            whole_word: false,
            include: String::new(),
            exclude: String::new(),
        });
        assert!(hits.is_empty());
    }
}
