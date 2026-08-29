//! The glob subset used by search's include and exclude filters.
//!
//! A hand-written port of `src/core/glob.ts`, not a use of `globset`. There are
//! two implementations of search and they have to agree exactly; delegating to
//! a crate here and to a library there would leave their edge cases deciding
//! what the app does, differently, on each path.
//!
//! The TypeScript is the specification, and the differential test in
//! `src/main/services/search-rust.test.ts` compares the two directly.

use regex::Regex;

/// Split a comma-separated list of patterns, dropping blanks.
pub fn parse_pattern_list(input: &str) -> Vec<String> {
    input
        .split(',')
        .map(str::trim)
        .filter(|pattern| !pattern.is_empty())
        .map(str::to_owned)
        .collect()
}

/// A glob as an anchored regular expression.
///
/// `**` is handled before `*` so the greedy form is not eaten by the
/// segment-local one, and `**/` collapses to "any number of directories,
/// including none" — otherwise `**/*.ts` would miss a file in the root.
pub fn glob_to_regex(pattern: &str) -> Option<Regex> {
    let chars: Vec<char> = pattern.chars().collect();
    let mut out = String::from("^");
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '*' => {
                if chars.get(i + 1) == Some(&'*') {
                    if chars.get(i + 2) == Some(&'/') {
                        out.push_str("(?:.*/)?");
                        i += 3;
                    } else {
                        out.push_str(".*");
                        i += 2;
                    }
                } else {
                    out.push_str("[^/]*");
                    i += 1;
                }
            }
            '?' => {
                out.push_str("[^/]");
                i += 1;
            }
            c if "\\^$.|+()[]{}".contains(c) => {
                out.push('\\');
                out.push(c);
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    out.push('$');
    Regex::new(&out).ok()
}

/// Does this vault-relative path match any of the patterns?
///
/// A pattern naming no directory is matched against the file name alone, which
/// is what makes `*.ts` mean "any TypeScript file" rather than "one in the root".
pub fn matches_any_glob(relative_path: &str, patterns: &[String]) -> bool {
    let name = relative_path.rsplit('/').next().unwrap_or(relative_path);
    patterns.iter().any(|pattern| {
        glob_to_regex(pattern).is_some_and(|re| {
            re.is_match(if pattern.contains('/') { relative_path } else { name })
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn matches(path: &str, pattern: &str) -> bool {
        matches_any_glob(path, &[pattern.to_string()])
    }

    #[test]
    fn a_pattern_without_a_slash_is_about_the_file_name() {
        assert!(matches("src/deep/main.ts", "*.ts"));
        assert!(!matches("src/main.tsx", "*.ts"));
    }

    #[test]
    fn a_pattern_with_a_slash_is_about_the_path() {
        assert!(matches("src/main.ts", "src/*.ts"));
        assert!(!matches("src/deep/main.ts", "src/*.ts"));
    }

    #[test]
    fn double_star_crosses_separators_and_matches_none() {
        assert!(matches("src/a/b/main.ts", "src/**"));
        assert!(matches("main.ts", "**/*.ts"));
        assert!(matches("a/b/main.ts", "**/*.ts"));
    }

    #[test]
    fn question_mark_is_one_character_and_never_a_separator() {
        assert!(matches("a.ts", "?.ts"));
        assert!(!matches("ab.ts", "?.ts"));
        assert!(!matches("a/b.ts", "a?b.ts"));
    }

    #[test]
    fn regex_characters_are_literal() {
        assert!(!matches("mainXts", "*.ts"));
        assert!(matches("note(1).md", "note(1).md"));
        assert!(glob_to_regex("a[b]c{d}e(f)g|h^i$j.k+l").is_some());
    }

    #[test]
    fn an_empty_list_matches_nothing() {
        assert!(!matches_any_glob("a/b.md", &[]));
        assert_eq!(parse_pattern_list("*.ts, *.md ,,  ").len(), 2);
    }
}
