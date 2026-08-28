//! Orrery's Rust sidecar.
//!
//! A long-lived child process spawned by the Electron main process, speaking the
//! same `Content-Length`-framed JSON-RPC the app already uses for language
//! servers. Requests arrive on stdin, responses leave on stdout; stderr is for
//! diagnostics and the parent captures it, because a silent crash here would be
//! indistinguishable from "no results".
//!
//! Every method is expected to degrade rather than fail: the parent falls back
//! to its TypeScript implementation whenever this process is missing, slow or
//! broken, so nothing here is load-bearing for correctness.

mod rpc;
mod search;

use serde::Deserialize;
use serde_json::json;
use std::io::{self, BufReader, BufWriter};

#[derive(Deserialize)]
struct Request {
    id: u64,
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

fn main() {
    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let stdout = io::stdout();
    let mut writer = BufWriter::new(stdout.lock());

    loop {
        let message = match rpc::read_message(&mut reader) {
            Ok(Some(m)) => m,
            Ok(None) => break, // parent closed the pipe; exit quietly
            Err(err) => {
                eprintln!("orrery-sidecar: read failed: {err}");
                break;
            }
        };
        if message.is_empty() {
            continue; // header block with no Content-Length
        }

        let request: Request = match serde_json::from_str(&message) {
            Ok(r) => r,
            Err(err) => {
                eprintln!("orrery-sidecar: malformed request: {err}");
                continue; // one lost message, not a lost connection
            }
        };

        let response = match request.method.as_str() {
            "ping" => json!({ "id": request.id, "result": "pong" }),
            "search" => match serde_json::from_value::<search::SearchRequest>(request.params) {
                Ok(params) => json!({ "id": request.id, "result": search::search(&params) }),
                Err(err) => {
                    eprintln!("orrery-sidecar: bad search params: {err}");
                    json!({ "id": request.id, "error": "bad params" })
                }
            },
            other => {
                eprintln!("orrery-sidecar: unknown method {other}");
                json!({ "id": request.id, "error": "unknown method" })
            }
        };

        if let Err(err) = rpc::write_message(&mut writer, &response.to_string()) {
            eprintln!("orrery-sidecar: write failed: {err}");
            break;
        }
    }
}
