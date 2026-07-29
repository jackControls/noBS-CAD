//! Choose desktop or experimental (wasm) for the Bevy CAD shell spike.
//!
//! Usage:
//!   cargo run -p nbcad-bevy-launcher
//!   cargo run -p nbcad-bevy-launcher -- --target desktop
//!   cargo run -p nbcad-bevy-launcher -- --target experimental --release

use std::env;
use std::io::{self, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::thread;
use std::time::Duration;

fn main() -> ExitCode {
    let options = match parse_options(env::args().skip(1).collect()) {
        Ok(options) => options,
        Err(message) => {
            eprintln!("{message}");
            print_usage();
            return ExitCode::from(2);
        }
    };

    match options.target {
        Target::Desktop => run_desktop(options.release),
        Target::Experimental => run_experimental(options.release),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Target {
    /// Native Bevy window: 3D viz + Feathers UI + CadSession bridge.
    Desktop,
    /// Browser wasm path (experimental parity).
    Experimental,
}

#[derive(Debug, Clone, Copy)]
struct Options {
    target: Target,
    release: bool,
}

fn parse_options(args: Vec<String>) -> Result<Options, String> {
    if args.is_empty() {
        return Ok(Options {
            target: prompt_target(),
            release: false,
        });
    }

    let mut target = None;
    let mut release = false;
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "-h" | "--help" => {
                print_usage();
                std::process::exit(0);
            }
            "--release" | "-r" => release = true,
            "--target" => {
                let value = iter
                    .next()
                    .ok_or_else(|| "missing value for --target".to_string())?;
                target = Some(parse_target_value(&value)?);
            }
            other if other.starts_with("--target=") => {
                target = Some(parse_target_value(&other["--target=".len()..])?);
            }
            "desktop" | "experimental" | "wasm" | "native" | "web" => {
                target = Some(parse_target_value(&arg)?);
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    Ok(Options {
        target: target.unwrap_or_else(prompt_target),
        release,
    })
}

fn parse_target_value(value: &str) -> Result<Target, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "desktop" | "native" | "d" | "1" => Ok(Target::Desktop),
        "experimental" | "experiment" | "wasm" | "web" | "e" | "2" => Ok(Target::Experimental),
        other => Err(format!(
            "unknown target '{other}' (expected desktop or experimental)"
        )),
    }
}

fn prompt_target() -> Target {
    eprintln!();
    eprintln!("noBS CAD — Bevy shell launcher");
    eprintln!("  [1] desktop       native window (viz + UI + Rust CAD bridge)");
    eprintln!("  [2] experimental  wasm in browser (parity spike)");
    eprint!("Select [1/2] (default: 1 desktop): ");
    let _ = io::stderr().flush();
    let mut line = String::new();
    if io::stdin().read_line(&mut line).is_err() {
        return Target::Desktop;
    }
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Target::Desktop;
    }
    parse_target_value(trimmed).unwrap_or(Target::Desktop)
}

fn print_usage() {
    eprintln!(
        "Usage:\n  \
         cargo run -p nbcad-bevy-launcher\n  \
         cargo run -p nbcad-bevy-launcher -- --target desktop\n  \
         cargo run -p nbcad-bevy-launcher -- --target experimental --release\n\n\
         desktop:       native Bevy — 3D + Feathers UI + CadSession bridge\n\
         experimental:  wasm browser path (alias: wasm)\n\
         --release:     release profile (recommended for experimental)"
    );
}

fn run_desktop(release: bool) -> ExitCode {
    eprintln!("Launching Bevy desktop shell…");
    let mut cmd = Command::new(env!("CARGO"));
    cmd.args(["run", "-p", "nbcad-bevy-viewport", "--bin", "bevy_desktop"]);
    if release {
        cmd.arg("--release");
    }
    match cmd.status() {
        Ok(status) if status.success() => ExitCode::SUCCESS,
        Ok(status) => ExitCode::from(status.code().unwrap_or(1) as u8),
        Err(error) => {
            eprintln!("failed to launch desktop shell: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run_experimental(release: bool) -> ExitCode {
    let profile = if release { "release" } else { "debug" };
    eprintln!("Building Bevy experimental wasm shell ({profile})…");
    let mut build = Command::new(env!("CARGO"));
    build.args([
        "build",
        "-p",
        "nbcad-bevy-viewport",
        "--bin",
        "bevy_desktop",
        "--target",
        "wasm32-unknown-unknown",
    ]);
    if release {
        build.arg("--release");
    }
    match build.status() {
        Ok(status) if status.success() => {}
        Ok(status) => return ExitCode::from(status.code().unwrap_or(1) as u8),
        Err(error) => {
            eprintln!("wasm build failed: {error}");
            return ExitCode::FAILURE;
        }
    }

    let manifest_dir = workspace_root();
    let wasm_path = manifest_dir.join(format!(
        "target/wasm32-unknown-unknown/{profile}/bevy_desktop.wasm"
    ));
    let web_dir = manifest_dir.join("crates/bevy_viewport/web");
    if !wasm_path.is_file() {
        eprintln!("missing wasm artifact at {}", wasm_path.display());
        return ExitCode::FAILURE;
    }

    eprintln!("Running wasm-bindgen --target web…");
    let bindgen = Command::new("wasm-bindgen")
        .args([
            "--out-dir",
            web_dir.to_str().unwrap(),
            "--target",
            "web",
            "--no-typescript",
            wasm_path.to_str().unwrap(),
        ])
        .status();
    match bindgen {
        Ok(status) if status.success() => {}
        Ok(status) => {
            eprintln!(
                "wasm-bindgen failed (install: cargo install wasm-bindgen-cli --version 0.2.126)"
            );
            return ExitCode::from(status.code().unwrap_or(1) as u8);
        }
        Err(error) => {
            eprintln!(
                "wasm-bindgen not found ({error}). Install with:\n  cargo install wasm-bindgen-cli --version 0.2.126"
            );
            return ExitCode::FAILURE;
        }
    }

    let port = free_port().unwrap_or(4173);
    let url = format!("http://127.0.0.1:{port}/");
    eprintln!("Serving experimental shell at {url}");
    eprintln!("Ctrl+C to stop.");

    let mut child = match spawn_http_server(port, &web_dir) {
        Ok(child) => child,
        Err(error) => {
            eprintln!("could not start local HTTP server: {error}");
            return ExitCode::FAILURE;
        }
    };

    thread::sleep(Duration::from_millis(400));
    let _ = open_browser(&url);
    match child.wait() {
        Ok(status) if status.success() => ExitCode::SUCCESS,
        Ok(status) => ExitCode::from(status.code().unwrap_or(1) as u8),
        Err(error) => {
            eprintln!("HTTP server error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn free_port() -> io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

fn spawn_http_server(port: u16, web_dir: &Path) -> io::Result<std::process::Child> {
    let port = port.to_string();
    let attempts: [(&str, Vec<&str>); 3] = [
        (
            "py",
            vec!["-3", "-m", "http.server", port.as_str(), "--bind", "127.0.0.1"],
        ),
        (
            "python3",
            vec!["-m", "http.server", port.as_str(), "--bind", "127.0.0.1"],
        ),
        (
            "python",
            vec!["-m", "http.server", port.as_str(), "--bind", "127.0.0.1"],
        ),
    ];
    let mut last_error = None;
    for (program, args) in &attempts {
        match Command::new(program)
            .args(args)
            .current_dir(web_dir)
            .stdin(Stdio::null())
            .spawn()
        {
            Ok(child) => return Ok(child),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| io::Error::other("no Python interpreter found")))
}

fn open_browser(url: &str) {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("cmd").args(["/C", "start", "", url]).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg(url).spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = Command::new("xdg-open").arg(url).spawn();
    }
}
