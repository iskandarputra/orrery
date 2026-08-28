//! JSON-RPC wire framing, mirroring `src/main/services/lsp-protocol.ts`.
//!
//! The TypeScript side already owns a tested implementation of this framing
//! (`MessageDecoder` / `encodeMessage`), so the sidecar speaks exactly the same
//! dialect rather than inventing a second one: `Content-Length: N\r\n\r\n{json}`.
//!
//! `Content-Length` counts **bytes, not characters**. A client that counts
//! characters desynchronises on the first message containing a non-ASCII
//! character, which is the classic bug in this layer.

use std::io::{BufRead, Write};

/// Read one framed message from `reader`. `Ok(None)` means clean end of stream.
pub fn read_message<R: BufRead>(reader: &mut R) -> std::io::Result<Option<String>> {
    let mut length: Option<usize> = None;

    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            return Ok(None); // stream closed
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break; // blank line ends the header block
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            if name.trim().eq_ignore_ascii_case("content-length") {
                length = value.trim().parse::<usize>().ok();
            }
        }
        // Any other header is ignored, and an unparseable one is skipped rather
        // than spun on — same tolerance the TypeScript decoder has.
    }

    let Some(length) = length else {
        // A header block with no usable Content-Length: skip it and carry on.
        return Ok(Some(String::new()));
    };

    let mut body = vec![0u8; length];
    reader.read_exact(&mut body)?;
    Ok(Some(String::from_utf8_lossy(&body).into_owned()))
}

/// Frame one message for the wire.
pub fn write_message<W: Write>(writer: &mut W, body: &str) -> std::io::Result<()> {
    write!(writer, "Content-Length: {}\r\n\r\n", body.as_bytes().len())?;
    writer.write_all(body.as_bytes())?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn framed(body: &str) -> Vec<u8> {
        let mut out = Vec::new();
        write_message(&mut out, body).unwrap();
        out
    }

    #[test]
    fn counts_bytes_not_characters() {
        // "é" is two bytes in UTF-8; a character count under-reports here.
        let body = r#"{"v":"é"}"#;
        let wire = String::from_utf8(framed(body)).unwrap();
        let declared: usize = wire
            .split("\r\n\r\n")
            .next()
            .unwrap()
            .rsplit(' ')
            .next()
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(declared, body.len());
        assert!(declared > body.chars().count());
    }

    #[test]
    fn round_trips_a_message() {
        let mut cursor = Cursor::new(framed(r#"{"a":1}"#));
        assert_eq!(read_message(&mut cursor).unwrap().unwrap(), r#"{"a":1}"#);
    }

    #[test]
    fn reads_several_messages_from_one_stream() {
        let mut bytes = framed(r#"{"a":1}"#);
        bytes.extend(framed(r#"{"b":2}"#));
        let mut cursor = Cursor::new(bytes);
        assert_eq!(read_message(&mut cursor).unwrap().unwrap(), r#"{"a":1}"#);
        assert_eq!(read_message(&mut cursor).unwrap().unwrap(), r#"{"b":2}"#);
        assert_eq!(read_message(&mut cursor).unwrap(), None);
    }

    #[test]
    fn reassembles_a_multi_byte_character() {
        let body = r#"{"v":"café"}"#;
        let mut cursor = Cursor::new(framed(body));
        assert_eq!(read_message(&mut cursor).unwrap().unwrap(), body);
    }

    #[test]
    fn accepts_headers_in_any_case_and_ignores_extras() {
        let body = r#"{"a":1}"#;
        let wire = format!(
            "content-type: application/vscode-jsonrpc\r\ncontent-length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        let mut cursor = Cursor::new(wire.into_bytes());
        assert_eq!(read_message(&mut cursor).unwrap().unwrap(), body);
    }

    #[test]
    fn reports_clean_end_of_stream() {
        let mut cursor = Cursor::new(Vec::new());
        assert_eq!(read_message(&mut cursor).unwrap(), None);
    }
}
