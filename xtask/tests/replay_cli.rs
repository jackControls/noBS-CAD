use std::{
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

struct TestDirectory(PathBuf);
impl TestDirectory {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("nbcad replay cli {} {nonce}", std::process::id()));
        fs::create_dir(&path).unwrap();
        Self(fs::canonicalize(path).unwrap())
    }
}
impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
struct OwnedChild(Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn command(executable: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(executable);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

fn replay(server: &Path, mode: &str, args: &[&str], heartbeat: &Path) -> Output {
    command(env!("CARGO_BIN_EXE_xtask"))
        .args(["run-script", "--recipe", "fixture", "--server"])
        .arg(server)
        .args(args)
        .env("NBCAD_FIXTURE_MODE", mode)
        .env("NBCAD_FIXTURE_HEARTBEAT", heartbeat)
        .output()
        .unwrap()
}

fn stopped(heartbeat: &Path) {
    let before = fs::metadata(heartbeat)
        .expect("Fixture did not start")
        .len();
    thread::sleep(Duration::from_millis(100));
    assert_eq!(
        fs::metadata(heartbeat).unwrap().len(),
        before,
        "Owned child kept running after xtask returned"
    );
}

fn succeeded(output: &Output) {
    assert!(
        output.status.success(),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn packaged_replay_arguments_initialization_deadline_and_owned_cleanup() {
    let temp = TestDirectory::new();
    let fixture = temp
        .0
        .join(format!("MCP fixture{}", std::env::consts::EXE_SUFFIX));
    let compile = command(std::env::var_os("RUSTC").unwrap_or_else(|| "rustc".into()))
        .arg("--edition=2021")
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/support/replay_server.rs"))
        .arg("-o")
        .arg(&fixture)
        .output()
        .unwrap();
    succeeded(&compile);

    let captured = temp.0.join("arguments.txt");
    let literal = "a path with spaces / \"quotes\" ; $literal Ω";
    let forwarded = ["--appimage-extract-and-run", "--headless", literal, ""];
    let mut run = command(env!("CARGO_BIN_EXE_xtask"));
    run.args([
        "run-script",
        "--recipe",
        "fixture",
        "--repeat",
        "2",
        "--server",
    ])
    .arg(&fixture);
    for argument in forwarded {
        run.args(["--server-arg", argument]);
    }
    let output = run
        .env("NBCAD_FIXTURE_ARGUMENTS", &captured)
        .output()
        .unwrap();
    succeeded(&output);
    assert!(String::from_utf8_lossy(&output.stdout).contains("2 independent runs"));
    let actual = fs::read_to_string(&captured).unwrap();
    assert_eq!(
        actual.lines().collect::<Vec<_>>(),
        vec![forwarded.join("\0"); 2]
    );

    // Omitting server arguments retains the standalone server behavior.
    let standalone = temp.0.join("standalone.txt");
    let output = command(env!("CARGO_BIN_EXE_xtask"))
        .args(["cad-call", "--server"])
        .arg(&fixture)
        .args(["--args", "{\"action\":\"catalog\"}"])
        .env("NBCAD_FIXTURE_ARGUMENTS", &standalone)
        .output()
        .unwrap();
    succeeded(&output);
    assert_eq!(fs::read_to_string(&standalone).unwrap(), "\n");
    let cad_call = temp.0.join("cad-call.txt");
    let output = command(env!("CARGO_BIN_EXE_xtask"))
        .args(["cad-call", "--server"])
        .arg(&fixture)
        .args([
            "--server-arg",
            "--headless",
            "--args",
            "{\"action\":\"catalog\"}",
        ])
        .env("NBCAD_FIXTURE_ARGUMENTS", &cad_call)
        .output()
        .unwrap();
    succeeded(&output);
    assert_eq!(fs::read_to_string(&cad_call).unwrap(), "--headless\n");

    // A response slower than the initialization bound still succeeds once the
    // handshake has finished; long native construction must retain that behavior.
    let slow = temp.0.join("slow.heartbeat");
    succeeded(&replay(
        &fixture,
        "slow-modeling",
        &["--init-timeout-seconds", "1"],
        &slow,
    ));
    stopped(&slow);

    let sentinel_path = temp.0.join("sentinel.heartbeat");
    let mut sentinel = OwnedChild(
        command(&fixture)
            .env("NBCAD_FIXTURE_MODE", "sentinel")
            .env("NBCAD_FIXTURE_HEARTBEAT", &sentinel_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let started = Instant::now();
    while !sentinel_path.exists() {
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "Sentinel failed to start"
        );
        thread::sleep(Duration::from_millis(10));
    }
    let sentinel_before = fs::metadata(&sentinel_path).unwrap().len();
    for (mode, expected) in [
        ("silent", "deadline"),
        ("non-mcp", "Invalid MCP reply"),
        ("invalid-init", "Invalid MCP initialization result"),
        ("unknown-recipe", "Unknown recipe"),
    ] {
        let heartbeat = temp.0.join(format!("{mode}.heartbeat"));
        let started = Instant::now();
        let output = replay(&fixture, mode, &["--init-timeout-seconds", "1"], &heartbeat);
        assert!(!output.status.success(), "{mode} unexpectedly passed");
        let error = String::from_utf8_lossy(&output.stderr);
        assert!(error.contains(expected), "{mode}: {error}");
        assert!(
            started.elapsed() < Duration::from_secs(8),
            "{mode} relied on fixture watchdog instead of client cleanup"
        );
        stopped(&heartbeat);
    }
    assert!(
        sentinel.0.try_wait().unwrap().is_none(),
        "Cleanup touched an unrelated process"
    );
    assert!(fs::metadata(sentinel_path).unwrap().len() > sentinel_before);
}
