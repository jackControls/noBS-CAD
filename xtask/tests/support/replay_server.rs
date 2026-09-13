//! Std-only subprocess fixture, compiled by replay_cli.rs using the same Rust
//! toolchain as xtask. It never opens CAD, accesses sessions, or invokes a shell.
use std::{
    fs,
    io::{BufRead, Write},
    thread,
    time::Duration,
};

fn main() {
    // A broken client must fail this test rather than leave a process behind.
    thread::spawn(|| {
        thread::sleep(Duration::from_secs(15));
        std::process::exit(98);
    });
    if let Some(path) = std::env::var_os("NBCAD_FIXTURE_ARGUMENTS") {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        writeln!(
            file,
            "{}",
            std::env::args().skip(1).collect::<Vec<_>>().join("\0")
        )
        .unwrap();
    }
    if let Some(path) = std::env::var_os("NBCAD_FIXTURE_HEARTBEAT") {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)
            .unwrap();
        write!(file, "{}:", std::process::id()).unwrap();
        file.flush().unwrap();
        thread::spawn(move || loop {
            file.write_all(b".").unwrap();
            file.flush().unwrap();
            thread::sleep(Duration::from_millis(20));
        });
    }
    let mode = std::env::var("NBCAD_FIXTURE_MODE").unwrap_or_default();
    if mode == "silent" || mode == "sentinel" {
        loop {
            thread::park();
        }
    }
    if mode == "non-mcp" {
        println!("This executable does not speak MCP.");
        std::io::stdout().flush().unwrap();
        loop {
            thread::park();
        }
    }
    for line in std::io::stdin().lock().lines() {
        let line = line.unwrap();
        let Some(id) = line.split("\"id\":").nth(1) else {
            continue;
        };
        let id: String = id
            .trim_start()
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();
        assert!(!id.is_empty());
        let result = if line.contains("\"method\":\"initialize\"") {
            if mode == "invalid-init" {
                "{\"not_an_mcp_handshake\":true}".to_owned()
            } else {
                r#"{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"}}"#.to_owned()
            }
        } else {
            let payload = if line.contains("\"action\":\"recipes\"") {
                if mode == "unknown-recipe" {
                    "[]"
                } else {
                    r#"[{"id":"fixture"}]"#
                }
            } else if line.contains("\"action\":\"script\"") {
                if mode == "slow-modeling" {
                    thread::sleep(Duration::from_millis(1500));
                }
                r#"{"steps_completed":1,"checks_completed":1,"elapsed_ms":1,"exports":{"final_model":{"solid":1}}}"#
            } else {
                r#"{"ok":true}"#
            };
            // The fixture payloads above are ASCII JSON. Rust's debug string
            // quoting produces the required JSON string for the text content.
            format!("{{\"content\":[{{\"type\":\"text\",\"text\":{payload:?}}}]}}")
        };
        println!("{{\"jsonrpc\":\"2.0\",\"id\":{id},\"result\":{result}}}");
        std::io::stdout().flush().unwrap();
    }
    // Prove Drop kills the owned server even if that server ignores EOF after
    // successful initialization and a subsequent recipe-catalog failure.
    if mode == "unknown-recipe" {
        loop {
            thread::park();
        }
    }
}
