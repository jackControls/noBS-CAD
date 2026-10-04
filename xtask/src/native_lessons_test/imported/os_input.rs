//! Desktop-input lessons drive the real script chooser. The default harness
//! keeps the typed path so a headless run never opens a modal.
use anyhow::{bail, ensure, Context, Result};
use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

pub(super) fn enabled() -> bool {
    std::env::var("NBCAD_NATIVE_SCRIPT_INPUT").as_deref() == Ok("1")
}

pub(super) fn complete_dialog(title: &str, path: &str) -> Result<()> {
    std::env::set_var("NBCAD_SCRIPT_DIALOG_TITLE", title);
    invoke("script-dialog", Some(path), Duration::from_secs(30))
}

fn invoke(operation: &str, input: Option<&str>, timeout: Duration) -> Result<()> {
    let pid = std::env::var("NBCAD_NATIVE_OWNED_PID")
        .context("NBCAD_NATIVE_OWNED_PID")?
        .parse::<u32>()
        .context("NBCAD_NATIVE_OWNED_PID")?;
    let mut command = helper(pid, operation)?;
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().context("Start script chooser helper")?;
    if let Some(input) = input {
        child
            .stdin
            .take()
            .context("script chooser helper stdin")?
            .write_all(input.as_bytes())?;
    } else {
        drop(child.stdin.take());
    }
    let deadline = Instant::now() + timeout;
    while child.try_wait()?.is_none() {
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            bail!("Script chooser helper {operation} exceeded {timeout:?}");
        }
        thread::sleep(Duration::from_millis(25));
    }
    let output = child.wait_with_output()?;
    ensure!(
        output.status.success(),
        "Script chooser helper {operation} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}

fn helper(pid: u32, operation: &str) -> Result<Command> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("platform");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("powershell.exe");
        command.creation_flags(0x08000000);
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ]);
        command.arg(root.join("native-input-windows.ps1"));
        command.arg(pid.to_string()).arg(operation);
        return Ok(command);
    }
    #[cfg(target_os = "linux")]
    {
        let mut command = Command::new("bash");
        command
            .arg(root.join("native-input-linux.sh"))
            .arg(pid.to_string())
            .arg(operation);
        return Ok(command);
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = (root, pid, operation);
        bail!("Script OS chooser input is not built for this OS");
    }
}
