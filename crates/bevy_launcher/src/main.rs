//! Interactive Bevy shell launcher — choose desktop or experimental (wasm).
//!
//! ```text
//! cargo run -p nbcad-bevy-launcher
//! ```
//!
//! No args → menu. `--target …` skips the menu (CI / agents).
//! Experimental writes `crates/bevy_viewport/web/LAUNCH_URL.txt` for agent hand-off.

use std::env;
use std::fs;
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
    Desktop,
    Experimental,
}

#[derive(Debug, Clone, Copy)]
struct Options {
    target: Target,
    release: bool,
}

fn parse_options(args: Vec<String>) -> Result<Options, String> {
    if args.is_empty() {
        return Ok(prompt_interactive());
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
        target: target.unwrap_or_else(|| prompt_interactive().target),
        release,
    })
}

fn prompt_interactive() -> Options {
    let target = prompt_target();
    let release = match target {
        Target::Desktop => prompt_yes_no(
            "Build desktop as release? (slower compile, smoother) [y/N]: ",
            false,
        ),
        Target::Experimental => prompt_yes_no(
            "Build experimental wasm as release? (recommended) [Y/n]: ",
            true,
        ),
    };
    Options { target, release }
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
    eprintln!("╔══════════════════════════════════════════════════════════╗");
    eprintln!("║  noBS CAD — Bevy shell launcher                          ║");
    eprintln!("╠══════════════════════════════════════════════════════════╣");
    eprintln!("║  [1] desktop         native window                       ║");
    eprintln!("║  [2] experimental    wasm in browser                     ║");
    eprintln!("║                      → writes LAUNCH_URL.txt for agents  ║");
    eprintln!("╚══════════════════════════════════════════════════════════╝");
    eprint!("Select [1/2] (default: 1): ");
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

fn prompt_yes_no(prompt: &str, default_yes: bool) -> bool {
    eprint!("{prompt}");
    let _ = io::stderr().flush();
    let mut line = String::new();
    if io::stdin().read_line(&mut line).is_err() {
        return default_yes;
    }
    let t = line.trim().to_ascii_lowercase();
    if t.is_empty() {
        return default_yes;
    }
    matches!(t.as_str(), "y" | "yes" | "1")
}

fn print_usage() {
    eprintln!(
        "Usage:\n  \
         cargo run -p nbcad-bevy-launcher\n      ← interactive menu (use this on reload)\n  \
         cargo run -p nbcad-bevy-launcher -- --target desktop\n  \
         cargo run -p nbcad-bevy-launcher -- --target experimental --release\n\n\
         experimental writes: crates/bevy_viewport/web/LAUNCH_URL.txt"
    );
}

fn run_desktop(release: bool) -> ExitCode {
    eprintln!("→ Launching DESKTOP shell ({})…", profile_name(release));
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
    let profile = wasm_profile_name(release);
    eprintln!("→ Building EXPERIMENTAL wasm shell ({profile})…");
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
        // Slim wasm profile: LTO + single codegen unit (see workspace Cargo.toml).
        build.args(["--profile", "wasm-release"]);
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

    eprintln!("→ wasm-bindgen --target web…");
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

    maybe_wasm_opt(&web_dir);

    let port = free_port().unwrap_or(4173);
    let url = format!("http://127.0.0.1:{port}/");

    let url_file = web_dir.join("LAUNCH_URL.txt");
    let _ = fs::write(
        &url_file,
        format!(
            "{url}\n\n\
             Paste this URL to the agent for browser testing.\n\
             Served from: {}\n\
             Profile: {profile}\n",
            web_dir.display()
        ),
    );

    eprintln!();
    eprintln!("╔══════════════════════════════════════════════════════════╗");
    eprintln!("║  EXPERIMENTAL WASM READY                                 ║");
    eprintln!("║  URL:  {url}");
    eprintln!("║  Hand-off file: crates/bevy_viewport/web/LAUNCH_URL.txt  ║");
    eprintln!("║  Paste that URL to the agent to test in-browser.         ║");
    eprintln!("╚══════════════════════════════════════════════════════════╝");
    eprintln!("Ctrl+C stops the server.");
    eprintln!();

    let mut child = match spawn_http_server(port, &web_dir) {
        Ok(child) => child,
        Err(error) => {
            eprintln!("could not start local HTTP server: {error}");
            return ExitCode::FAILURE;
        }
    };

    thread::sleep(Duration::from_millis(500));
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

fn profile_name(release: bool) -> &'static str {
    if release {
        "release"
    } else {
        "debug"
    }
}

fn wasm_profile_name(release: bool) -> &'static str {
    if release {
        "wasm-release"
    } else {
        "debug"
    }
}

/// Run `wasm-opt -Os` when binaryen is on PATH (best-effort).
fn maybe_wasm_opt(web_dir: &Path) {
    let candidates = [
        web_dir.join("bevy_desktop_bg.wasm"),
        web_dir.join("bevy_desktop.wasm"),
    ];
    let Some(wasm) = candidates.into_iter().find(|p| p.is_file()) else {
        eprintln!("→ wasm-opt skipped (no bindgen .wasm found)");
        return;
    };
    let before = fs::metadata(&wasm).map(|m| m.len()).unwrap_or(0);
    eprintln!(
        "→ wasm-opt -Os ({:.1} MB)…",
        before as f64 / (1024.0 * 1024.0)
    );
    let tmp = wasm.with_extension("opt.wasm");
    let status = Command::new("wasm-opt")
        .args([
            "-Os",
            "--enable-bulk-memory",
            "--enable-nontrapping-float-to-int",
            wasm.to_str().unwrap(),
            "-o",
            tmp.to_str().unwrap(),
        ])
        .status();
    match status {
        Ok(s) if s.success() => {
            if let Err(error) = fs::rename(&tmp, &wasm) {
                eprintln!("wasm-opt produced output but replace failed: {error}");
                let _ = fs::remove_file(&tmp);
                return;
            }
            let after = fs::metadata(&wasm).map(|m| m.len()).unwrap_or(0);
            eprintln!(
                "   wasm-opt done: {:.1} MB → {:.1} MB",
                before as f64 / (1024.0 * 1024.0),
                after as f64 / (1024.0 * 1024.0)
            );
        }
        Ok(_) => {
            eprintln!("   wasm-opt failed; keeping bindgen output");
            let _ = fs::remove_file(&tmp);
        }
        Err(_) => {
            eprintln!("   wasm-opt not on PATH (optional: install Binaryen)");
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
