use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    time::{Duration, Instant},
};

const DEFAULT_INITIALIZATION_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) struct Client {
    child: Child,
    input: Option<ChildStdin>,
    replies: Receiver<Result<Value, String>>,
    id: u64,
    request_timeout: Option<Duration>,
    initialization: Value,
}
impl Client {
    pub(crate) fn start(executable: &str) -> Result<Self> {
        Self::start_with_arguments(executable, &[], DEFAULT_INITIALIZATION_TIMEOUT)
    }
    fn start_with_arguments(
        executable: &str,
        arguments: &[String],
        initialization_timeout: Duration,
    ) -> Result<Self> {
        let mut command = Command::new(executable);
        command.args(arguments);
        Self::start_with_timeouts(command, initialization_timeout, None)
    }
    /// Package checks keep their per-request deadline, including initialization.
    /// Replays bound initialization separately from long modeling operations.
    pub(crate) fn start_command(
        command: Command,
        request_timeout: Option<Duration>,
    ) -> Result<Self> {
        Self::start_with_timeouts(
            command,
            request_timeout.unwrap_or(DEFAULT_INITIALIZATION_TIMEOUT),
            request_timeout,
        )
    }
    fn start_with_timeouts(
        mut command: Command,
        initialization_timeout: Duration,
        request_timeout: Option<Duration>,
    ) -> Result<Self> {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().context("Start MCP server")?;
        let input = child.stdin.take().unwrap();
        let output = child.stdout.take().unwrap();
        let (sender, replies) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                let result = line
                    .map_err(|e| e.to_string())
                    .and_then(|s| parse_reply_line(&s));
                if sender.send(result).is_err() {
                    break;
                }
            }
        });
        let mut client = Self {
            child,
            input: Some(input),
            replies,
            id: 0,
            request_timeout: Some(initialization_timeout),
            initialization: Value::Null,
        };
        client.initialization = client.rpc("initialize",json!({"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"nbcad-rust-replay","version":"1"}}))
            .with_context(|| format!(
                "MCP initialization failed (deadline {initialization_timeout:?}). The executable must run a stdio MCP server; for packaged CAD, pass --server-arg --mcp"
            ))?;
        if !client.initialization["protocolVersion"].is_string()
            || !client.initialization["capabilities"].is_object()
            || !client.initialization["serverInfo"]["name"].is_string()
            || !client.initialization["serverInfo"]["version"].is_string()
        {
            bail!(
                "Invalid MCP initialization result: {}",
                client.initialization
            );
        }
        let input = client.input.as_mut().unwrap();
        writeln!(
            input,
            "{}",
            json!({"jsonrpc":"2.0","method":"notifications/initialized"})
        )?;
        input.flush()?;
        // Slow OCCT work and paused presentations must not inherit the short
        // startup deadline. Package verification retains its requested bound.
        client.request_timeout = request_timeout;
        Ok(client)
    }
    pub(crate) fn initialization(&self) -> &Value {
        &self.initialization
    }
    pub(crate) fn rpc(&mut self, method: &str, params: Value) -> Result<Value> {
        let deadline = self.request_timeout.map(|timeout| Instant::now() + timeout);
        self.id += 1;
        let id = self.id;
        let input = self.input.as_mut().context("MCP input is closed")?;
        writeln!(
            input,
            "{}",
            json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
        )?;
        input.flush()?;
        let response = self.receive_reply(id, deadline, method);
        if response.is_err() && self.request_timeout.is_some() {
            self.terminate();
        }
        response
    }
    fn receive_reply(&mut self, id: u64, deadline: Option<Instant>, method: &str) -> Result<Value> {
        loop {
            let wait = reply_wait(deadline, method)?;
            match self.replies.recv_timeout(wait) {
                Ok(Ok(reply)) => {
                    if reply["id"] != id {
                        continue;
                    }
                    if let Some(error) = reply.get("error") {
                        bail!("MCP error: {error}");
                    }
                    return Ok(reply["result"].clone());
                }
                Ok(Err(error)) => bail!("Invalid MCP reply: {error}"),
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    reply_wait(deadline, method)?;
                    if let Some(status) = self.child.try_wait()? {
                        bail!("MCP exited: {status}");
                    }
                    eprintln!("Replay is running; live playback controls remain available.");
                }
                Err(error) => bail!("MCP connection closed: {error}"),
            }
        }
    }
    /// Closing the agent's input must let the stdio server exit normally. Drop
    /// still kills/reaps this owned child on any failure, including a deadline.
    pub(crate) fn finish(mut self, timeout: Duration) -> Result<()> {
        drop(self.input.take());
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(status) = self.child.try_wait()? {
                if !status.success() {
                    bail!("MCP exited unsuccessfully after EOF: {status}");
                }
                // The pipe reader can still be processing the final stdout
                // bytes. Drain until EOF so late logs cannot pass as valid MCP.
                loop {
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        bail!("MCP stdout did not close after process exit");
                    }
                    match self.replies.recv_timeout(remaining) {
                        Ok(Ok(reply)) if reply.get("method").is_some() => {}
                        Ok(Ok(reply)) => {
                            bail!("Unexpected MCP response after final request: {reply}")
                        }
                        Ok(Err(error)) => bail!("Invalid MCP output before EOF: {error}"),
                        Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            bail!("MCP stdout did not close after process exit")
                        }
                    }
                }
            }
            if Instant::now() >= deadline {
                bail!("MCP did not exit within {timeout:?} after EOF");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    fn terminate(&mut self) {
        drop(self.input.take());
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
    pub(crate) fn call(&mut self, name: &str, args: Value) -> Result<Value> {
        let result = self.rpc("tools/call", json!({"name":name,"arguments":args}))?;
        if result["isError"] == true {
            bail!("{name}: {}", result["content"]);
        }
        let text = result["content"]
            .as_array()
            .and_then(|a| a.iter().find(|v| v["type"] == "text"))
            .and_then(|v| v["text"].as_str())
            .ok_or_else(|| anyhow!("MCP response has no text"))?;
        let result: Value = serde_json::from_str(text)?;
        if result["status"] == "failed" {
            bail!("{name}: {result}");
        }
        Ok(result)
    }
}
fn parse_reply_line(line: &str) -> Result<Value, String> {
    let reply: Value = serde_json::from_str(line).map_err(|error| error.to_string())?;
    if reply["jsonrpc"] != "2.0"
        || !(reply["method"].is_string()
            || reply.get("id").is_some()
                && (reply.get("result").is_some() || reply.get("error").is_some()))
    {
        return Err("stdout must contain JSON-RPC responses or notifications only".into());
    }
    Ok(reply)
}
fn reply_wait(deadline: Option<Instant>, method: &str) -> Result<Duration> {
    match deadline {
        Some(deadline) => {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                bail!("MCP request {method} exceeded its deadline");
            }
            Ok(remaining.min(Duration::from_secs(30)))
        }
        None => Ok(Duration::from_secs(30)),
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        self.terminate();
    }
}

#[derive(Debug)]
struct Options {
    values: HashMap<String, String>,
    file: Option<String>,
    server_arguments: Vec<String>,
}
impl Options {
    fn initialization_timeout(&self) -> Result<Duration> {
        match self.values.get("--init-timeout-seconds") {
            Some(value) => {
                let seconds: u64 = value
                    .parse()
                    .context("--init-timeout-seconds must be whole seconds")?;
                if !(1..=600).contains(&seconds) {
                    bail!("--init-timeout-seconds must be 1–600 seconds");
                }
                Ok(Duration::from_secs(seconds))
            }
            None => Ok(DEFAULT_INITIALIZATION_TIMEOUT),
        }
    }
}

fn options(args: impl Iterator<Item = String>) -> Result<Options> {
    let mut args = args.peekable();
    let mut values = HashMap::new();
    let mut file = None;
    let mut server_arguments = Vec::new();
    while let Some(mut arg) = args.next() {
        if arg == "-h" {
            arg = "--help".into();
        }
        if arg == "--server-arg" {
            // Consume exactly one literal argument, including flag-shaped
            // values such as --mcp and --appimage-extract-and-run.
            server_arguments.push(
                args.next()
                    .ok_or_else(|| anyhow!("Missing value for --server-arg"))?,
            );
        } else if arg.starts_with("--") {
            if values.contains_key(&arg) {
                bail!("Duplicate option {arg}");
            }
            if matches!(arg.as_str(), "--present" | "--new" | "--help") {
                values.insert(arg, "true".into());
            } else {
                values.insert(
                    arg.clone(),
                    args.next()
                        .filter(|v| !v.starts_with("--"))
                        .ok_or_else(|| anyhow!("Missing value for {arg}"))?,
                );
            }
        } else if file.replace(arg).is_some() {
            bail!("Only one script path is accepted");
        }
    }
    Ok(Options {
        values,
        file,
        server_arguments,
    })
}
fn known_options(args: &HashMap<String, String>, allowed: &[&str]) -> Result<()> {
    for key in args.keys() {
        if !allowed.contains(&key.as_str()) {
            bail!("Unknown option {key}");
        }
    }
    Ok(())
}
fn required<'a>(args: &'a HashMap<String, String>, name: &str) -> Result<&'a str> {
    args.get(name)
        .map(String::as_str)
        .ok_or_else(|| anyhow!("Missing {name}"))
}
pub fn call(args: impl Iterator<Item = String>) -> Result<()> {
    let options = options(args)?;
    if options.values.contains_key("--help") {
        print_usage(false);
        return Ok(());
    }
    let initialization_timeout = options.initialization_timeout()?;
    let args = &options.values;
    known_options(
        args,
        &[
            "--server",
            "--init-timeout-seconds",
            "--session",
            "--tool",
            "--args",
            "--args-file",
            "--out",
        ],
    )?;
    if options.file.is_some() || args.contains_key("--args") && args.contains_key("--args-file") {
        bail!("Supply exactly one --args or --args-file");
    }
    let mut client = Client::start_with_arguments(
        required(args, "--server")?,
        &options.server_arguments,
        initialization_timeout,
    )?;
    if let Some(session) = args.get("--session") {
        client.call("cad_attach", json!({"session_id":session}))?;
    }
    let arguments = if let Some(path) = args.get("--args-file") {
        fs::read_to_string(path)?
    } else {
        required(args, "--args")?.to_owned()
    };
    let result = client.call(
        args.get("--tool")
            .map(String::as_str)
            .unwrap_or("cad_interface"),
        serde_json::from_str(&arguments)?,
    )?;
    if let Some(path) = args.get("--out") {
        fs::write(path, serde_json::to_string_pretty(&result)?)?;
    } else {
        println!("{}", serde_json::to_string_pretty(&result)?);
    }
    Ok(())
}
fn launched_session(launch: &Value) -> Result<String> {
    if launch["status"] != "ready" {
        bail!("CAD launch is not ready: {launch}. Inspect that process before retrying; no script has run and no duplicate window was launched.");
    }
    launch["session_id"]
        .as_str()
        .filter(|id| !id.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| anyhow!("Ready CAD launch did not identify a document; no script has run"))
}

#[derive(Debug)]
struct ReplayOutputs {
    directory: Option<PathBuf>,
    save: Option<PathBuf>,
}
impl ReplayOutputs {
    fn prepare(out: Option<&str>, save: Option<&str>, repeat: usize) -> Result<Self> {
        let directory = out
            .map(|path| prepare_directory(Path::new(path), "replay output"))
            .transpose()?;
        let save = save
            .map(|path| -> Result<PathBuf> {
                let path = Path::new(path);
                let filename = path.file_name().ok_or_else(|| {
                    anyhow!("Save destination must name a file: {}", path.display())
                })?;
                let parent = path
                    .parent()
                    .filter(|p| !p.as_os_str().is_empty())
                    .unwrap_or(Path::new("."));
                let path = prepare_directory(parent, "CAD save")?.join(filename);
                validate_file_destination(&path)?;
                Ok(path)
            })
            .transpose()?;
        if let Some(out) = &directory {
            for iteration in 1..=repeat {
                for name in [
                    format!("run-{iteration}.json"),
                    format!("model-{iteration}.json"),
                ] {
                    let path = out.join(name);
                    validate_file_destination(&path)?;
                    if save
                        .as_ref()
                        .is_some_and(|save| same_destination(save, &path))
                    {
                        bail!(
                            "CAD save destination conflicts with replay output: {}",
                            path.display()
                        );
                    }
                }
            }
        }
        Ok(Self { directory, save })
    }

    fn complete(
        &self,
        iteration: usize,
        report: &Value,
        save: impl FnOnce(&Path) -> Result<Value>,
    ) -> Result<()> {
        // Retain the completed result before attempting any further operation
        // on the live document. Save can still fail after a successful preflight.
        let report_path = if let Some(out) = &self.directory {
            let path = out.join(format!("run-{iteration}.json"));
            fs::write(&path, serde_json::to_vec_pretty(report)?)
                .with_context(|| format!("Write completed replay report {}", path.display()))?;
            if let Some(model) = report.pointer("/exports/final_model") {
                let model_path = out.join(format!("model-{iteration}.json"));
                fs::write(&model_path, serde_json::to_vec_pretty(model)?).with_context(|| {
                    format!(
                        "Write model snapshot {}; replay report retained at {}",
                        model_path.display(),
                        path.display()
                    )
                })?;
            }
            Some(path)
        } else {
            None
        };
        if let Some(path) = &self.save {
            save(path).with_context(|| {
                let retained = report_path
                    .as_ref()
                    .map(|report| format!("; replay report retained at {}", report.display()))
                    .unwrap_or_default();
                format!(
                    "Replay completed, but saving CAD file {} failed{retained}",
                    path.display()
                )
            })?;
        }
        Ok(())
    }
}

fn prepare_directory(path: &Path, purpose: &str) -> Result<PathBuf> {
    if path.as_os_str().is_empty() {
        bail!("The {purpose} directory must not be empty");
    }
    fs::create_dir_all(path)
        .with_context(|| format!("Prepare {purpose} directory {}", path.display()))?;
    let path = fs::canonicalize(path)
        .with_context(|| format!("Resolve {purpose} directory {}", path.display()))?;
    // Probe the actual directory permissions without touching a user's output
    // file. A unique create-new file also detects failures beyond a read-only bit.
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    for _ in 0..100 {
        let probe = path.join(format!(
            ".nbcad-replay-write-check-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let mut file = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(error).with_context(|| {
                    format!("Verify writable {purpose} directory {}", path.display())
                })
            }
        };
        let written = file
            .write_all(b"noBS CAD replay output preflight\n")
            .and_then(|_| file.sync_all());
        drop(file);
        let removed = fs::remove_file(&probe);
        written
            .with_context(|| format!("Verify writable {purpose} directory {}", path.display()))?;
        removed.with_context(|| format!("Remove output preflight file {}", probe.display()))?;
        return Ok(path);
    }
    bail!(
        "Could not allocate a write check in {purpose} directory {}",
        path.display()
    )
}

fn validate_file_destination(path: &Path) -> Result<()> {
    match fs::metadata(path) {
        Ok(metadata) => {
            if !metadata.is_file() || metadata.permissions().readonly() {
                bail!(
                    "Output destination must be a writable regular file: {}",
                    path.display()
                );
            }
            // Opening without create or truncate preserves all existing bytes.
            fs::OpenOptions::new()
                .write(true)
                .open(path)
                .with_context(|| format!("Verify writable output file {}", path.display()))?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(error)
                .with_context(|| format!("Inspect output destination {}", path.display()))
        }
    }
    Ok(())
}

fn same_destination(a: &Path, b: &Path) -> bool {
    let a = fs::canonicalize(a).unwrap_or_else(|_| a.to_owned());
    let b = fs::canonicalize(b).unwrap_or_else(|_| b.to_owned());
    if cfg!(windows) {
        a.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(&b.as_os_str().to_string_lossy())
    } else {
        a == b
    }
}

pub fn run(args: impl Iterator<Item = String>) -> Result<()> {
    let options = options(args)?;
    if options.values.contains_key("--help") {
        print_usage(true);
        return Ok(());
    }
    let initialization_timeout = options.initialization_timeout()?;
    let args = &options.values;
    known_options(
        args,
        &[
            "--server",
            "--init-timeout-seconds",
            "--session",
            "--desktop",
            "--new",
            "--present",
            "--speed",
            "--repeat",
            "--save",
            "--out",
            "--compare",
            "--recipe",
        ],
    )?;
    let live = args.contains_key("--session") || args.contains_key("--desktop");
    if !live
        && (args.contains_key("--save")
            || args.contains_key("--new")
            || args.contains_key("--present"))
    {
        bail!("Save, new-tab and presentation options require a desktop session");
    }
    if args.contains_key("--session") && args.contains_key("--desktop") {
        bail!("Choose existing session or desktop launch");
    }
    let speed = args
        .get("--speed")
        .map(|s| s.parse::<f64>())
        .transpose()?
        .unwrap_or(1.0);
    if !speed.is_finite() || !(0.1..=16.0).contains(&speed) {
        bail!("Speed must be from 0.1 to 16");
    }
    if options.file.is_some() && args.contains_key("--recipe") {
        bail!("Choose a script path or --recipe ID");
    }
    let path = if args.contains_key("--recipe") {
        None
    } else {
        Some(fs::canonicalize(options.file.as_ref().ok_or_else(
            || anyhow!("Supply a script path or --recipe ID"),
        )?)?)
    };
    let server = required(args, "--server")?;
    let repeat = args
        .get("--repeat")
        .map(|v| v.parse::<usize>())
        .transpose()?
        .unwrap_or(1);
    if repeat == 0 {
        bail!("repeat must be positive");
    }
    if repeat > 1 && (args.contains_key("--session") || args.contains_key("--desktop")) {
        bail!("Determinism repeats use independent headless processes; run the visible demonstration separately");
    }
    let mut baseline = args
        .get("--compare")
        .map(|p| -> Result<Value> {
            semantic_result(&serde_json::from_str(&fs::read_to_string(p)?)?)
        })
        .transpose()?;
    let outputs = ReplayOutputs::prepare(
        args.get("--out").map(String::as_str),
        args.get("--save").map(String::as_str),
        repeat,
    )?;
    for iteration in 1..=repeat {
        let mut client = Client::start_with_arguments(
            server,
            &options.server_arguments,
            initialization_timeout,
        )?;
        // A misspelled recipe must not launch a window or create an empty tab.
        // Ask the selected binary's catalog, not a second list in this client.
        if let Some(recipe) = args.get("--recipe") {
            let catalog = client.call("cad_interface", json!({"action":"recipes"}))?;
            if !catalog
                .as_array()
                .into_iter()
                .flatten()
                .any(|entry| entry["id"] == *recipe)
            {
                bail!("Unknown recipe '{recipe}'; inspect the server's recipe catalog");
            }
        }
        let mut session = args.get("--session").cloned();
        if let Some(desktop) = args.get("--desktop") {
            if session.is_some() {
                bail!("Choose existing session or desktop launch");
            }
            let launch = client.call(
                "cad_interface",
                json!({"action":"launch","executable":desktop}),
            )?;
            session = Some(launched_session(&launch)?);
        }
        if let Some(id) = &session {
            client.call("cad_attach", json!({"session_id":id}))?;
        }
        if args.contains_key("--new") {
            if session.is_none() {
                bail!("--new requires an existing desktop session");
            }
            let inspect = client.call("cad_interface", json!({"action":"inspect"}))?;
            let target = inspect["ui"]["surfaces"]
                .as_array()
                .into_iter()
                .flatten()
                .flat_map(|v| v["controls"].as_array().into_iter().flatten())
                .find(|v| v["label"] == "New design" && v["disabled"] == false)
                .and_then(|v| v["id"].as_str())
                .ok_or_else(|| anyhow!("New design control unavailable"))?;
            let reply = client.call("cad_interface", json!({"action":"click","target":target}))?;
            session = reply["active_session_id"].as_str().map(str::to_owned);
            client.call("cad_attach", json!({"session_id":session}))?;
        }
        let label = args
            .get("--recipe")
            .cloned()
            .unwrap_or_else(|| path.as_ref().unwrap().display().to_string());
        eprintln!("Running {label} ({iteration}/{repeat})");
        let mut request = json!({"action":"script","mode":if args.contains_key("--present"){"present"}else{"fast"},"speed":speed,"validate":true});
        if let Some(recipe) = args.get("--recipe") {
            request["recipe"] = json!(recipe);
        } else {
            request["path"] = json!(path);
        }
        let mut report = client.call("cad_interface", request)?;
        if let Some(session) = session {
            report["session_id"] = json!(session);
        }
        outputs.complete(iteration, &report, |save| {
            client.call(
                "cad_interface",
                json!({"action":"file","command":"save","path":save}),
            )
        })?;
        if repeat > 1 || args.contains_key("--compare") {
            let semantic = semantic_result(&report)?;
            if let Some(previous) = &baseline {
                if previous != &semantic {
                    let difference = first_difference(previous, &semantic, "").unwrap_or_default();
                    bail!("Replay {iteration} differs from the comparison model at {difference}");
                }
            } else {
                baseline = Some(semantic);
            }
        }
        eprintln!(
            "Completed {} steps and {} end checks in {} ms",
            report["steps_completed"], report["checks_completed"], report["elapsed_ms"]
        );
    }
    if repeat > 1 {
        println!("PASS: {repeat} independent runs produced identical model, sketches, assembly solution and geometry.");
    }
    if args.contains_key("--compare") {
        println!("PASS: replay matches the comparison model, sketches, assembly and geometry.");
    }
    Ok(())
}

fn print_usage(script: bool) {
    if script {
        println!("Usage: cargo xtask run-script [FILE.nbcad.jsonc | --recipe ID] --server PATH [OPTIONS]\n\
  --session UUID --new --present  Replay visibly in a new design of an existing window.\n\
  --desktop PATH                 Launch a desktop instead of attaching to --session.\n\
  --speed N                      Presentation speed, 0.1–16 (default: 1).\n\
  --repeat N                     Compare independent headless runs (default: 1).\n\
  --compare REPORT.json          Compare the final model with a previous replay.\n\
  --out DIRECTORY                Retain replay reports and model snapshots.\n\
  --save FILE.nbcad               Save the live design after replay.");
    } else {
        println!("Usage: cargo xtask cad-call --server PATH [--tool NAME] [--args JSON | --args-file FILE] [OPTIONS]\n\
  --tool NAME                    MCP tool name (default: cad_interface).\n\
  --session UUID                 Attach to an explicitly selected live design.\n\
  --out FILE.json                Write the tool result instead of stdout.");
    }
    println!("\nServer options:\n\
  --server-arg ARG                Pass one literal argument to the server; repeat to preserve order.\n\
  --init-timeout-seconds N        Bound MCP initialization only (1–600, default: 30).\n\
                                 Modeling and presentation waits remain unbounded.\n\
\nPackaged CAD: --server PATH --server-arg --mcp\n\
AppImage without FUSE: --server PATH --server-arg --appimage-extract-and-run --server-arg --mcp\n\
Standalone nbcad-mcp: --server PATH (no server argument required)");
}

fn semantic_result(report: &Value) -> Result<Value> {
    let exports = report
        .get("exports")
        .ok_or_else(|| anyhow!("Script did not return exports"))?;
    let mut selected = serde_json::Map::new();
    for key in [
        "final_model",
        "final_scene",
        "final_solution",
        "final_sketches",
    ] {
        if let Some(value) = exports.get(key) {
            let mut value = value.clone();
            // Tool-disclosure hints describe the client session, not the CAD.
            if let Some(object) = value.as_object_mut() {
                object.remove("_disclosure");
            }
            if key == "final_sketches" {
                if let Some(sketches) = value.as_array_mut() {
                    for sketch in sketches {
                        if let Some(sketch) = sketch.as_object_mut() {
                            // Restoring a project intentionally clears editing undo
                            // and regenerates snap candidates on sketch entry. The
                            // persisted sketch constraints/references remain intact.
                            for transient in ["can_undo", "can_redo", "reference_midpoints"] {
                                sketch.remove(transient);
                            }
                        }
                    }
                }
            }
            selected.insert(key.into(), value);
        }
    }
    if selected.is_empty() {
        bail!("Script must export a final model or scene for determinism comparison");
    }
    Ok(Value::Object(selected))
}
fn first_difference(a: &Value, b: &Value, path: &str) -> Option<String> {
    if a == b {
        return None;
    }
    match (a, b) {
        (Value::Object(a), Value::Object(b)) => {
            for (key, value) in a {
                let next = format!("{path}/{key}");
                if let Some(other) = b.get(key) {
                    if let Some(found) = first_difference(value, other, &next) {
                        return Some(found);
                    }
                } else {
                    return Some(next);
                }
            }
            b.keys()
                .find(|key| !a.contains_key(*key))
                .map(|key| format!("{path}/{key}"))
        }
        (Value::Array(a), Value::Array(b)) => {
            if a.len() != b.len() {
                return Some(format!("{path}/length"));
            }
            a.iter()
                .zip(b)
                .enumerate()
                .find_map(|(i, (a, b))| first_difference(a, b, &format!("{path}/{i}")))
        }
        _ => Some(path.to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Reuse the Rust test executable as an owned child which consumes input but
    // never replies. No shell, platform scripting runtime, or CAD window needed.
    #[test]
    #[ignore = "child-process fixture invoked only by transport tests"]
    fn transport_child_waits_for_eof() {
        if std::env::var_os("NBCAD_TRANSPORT_TEST_CHILD").is_some() {
            for line in std::io::stdin().lock().lines() {
                if line.is_err() {
                    break;
                }
            }
        }
    }

    fn transport_client(
        timeout: Option<Duration>,
    ) -> (Client, mpsc::Sender<Result<Value, String>>) {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "replay::tests::transport_child_waits_for_eof",
                "--ignored",
                "--nocapture",
            ])
            .env("NBCAD_TRANSPORT_TEST_CHILD", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().unwrap();
        let input = child.stdin.take();
        let (sender, replies) = mpsc::channel();
        (
            Client {
                child,
                input,
                replies,
                id: 0,
                request_timeout: timeout,
                initialization: Value::Null,
            },
            sender,
        )
    }

    #[test]
    fn deadline_ignores_notification_traffic_and_reaps_owned_process() {
        let (mut client, sender) = transport_client(Some(Duration::from_millis(50)));
        let traffic = std::thread::spawn(move || {
            while sender
                .send(Ok(
                    json!({"jsonrpc":"2.0","method":"notifications/tools/list_changed"}),
                ))
                .is_ok()
            {
                std::thread::sleep(Duration::from_millis(5));
            }
        });
        let error = client.rpc("ping", json!({})).unwrap_err();
        assert!(error.to_string().contains("deadline"), "{error:#}");
        assert!(
            client.child.try_wait().unwrap().is_some(),
            "Timed-out child was not reaped"
        );
        drop(client);
        traffic.join().unwrap();
    }

    #[test]
    fn ordinary_replay_keeps_waiting_and_eof_exits_cleanly() {
        let (mut client, sender) = transport_client(None);
        let reply = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            sender
                .send(Ok(json!({"jsonrpc":"2.0","id":1,"result":{"pong":true}})))
                .unwrap();
        });
        assert_eq!(client.rpc("ping", json!({})).unwrap(), json!({"pong":true}));
        reply.join().unwrap();
        client.finish(Duration::from_secs(5)).unwrap();
    }

    #[test]
    fn eof_rejects_trailing_non_protocol_stdout() {
        let (client, sender) = transport_client(None);
        sender
            .send(parse_reply_line("{\"log\":\"unexpected shutdown log\"}"))
            .unwrap();
        drop(sender);
        let error = client.finish(Duration::from_secs(5)).unwrap_err();
        assert!(
            error.to_string().contains("Invalid MCP output before EOF"),
            "{error:#}"
        );
    }

    struct TestDirectory(PathBuf);
    impl TestDirectory {
        fn new() -> Self {
            use std::sync::atomic::{AtomicU64, Ordering};
            static SEQUENCE: AtomicU64 = AtomicU64::new(0);
            for _ in 0..100 {
                let path = std::env::temp_dir().join(format!(
                    "nbcad-replay-test-{}-{}",
                    std::process::id(),
                    SEQUENCE.fetch_add(1, Ordering::Relaxed)
                ));
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("Create owned test directory: {error}"),
                }
            }
            panic!("Could not allocate an owned test directory")
        }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            // Only remove the exact directory exclusively created by new().
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn creates_shared_output_and_save_parent_without_creating_the_save_file() {
        let temp = TestDirectory::new();
        let out = temp.0.join("new/nested/output");
        let save = out.join("design.nbcad");
        let prepared = ReplayOutputs::prepare(out.to_str(), save.to_str(), 2).unwrap();
        let absolute = fs::canonicalize(&out).unwrap();
        assert_eq!(prepared.directory, Some(absolute.clone()));
        assert_eq!(prepared.save, Some(absolute.join("design.nbcad")));
        assert_eq!(
            fs::read_dir(&out).unwrap().count(),
            0,
            "write probes must be removed and real outputs must not be created early"
        );
    }

    #[test]
    fn output_preflight_runs_before_starting_the_server_or_desktop() {
        let temp = TestDirectory::new();
        let out = temp.0.join("reports");
        let save = temp.0.join("separate/save/design.nbcad");
        let args = || {
            vec![
                "--server".into(),
                temp.0
                    .join("missing-mcp-executable")
                    .to_string_lossy()
                    .into_owned(),
                "--desktop".into(),
                "must-not-launch".into(),
                "--recipe".into(),
                "unused".into(),
                "--out".into(),
                out.to_string_lossy().into_owned(),
                "--save".into(),
                save.to_string_lossy().into_owned(),
            ]
        };
        let error = run(args().into_iter()).unwrap_err();
        assert!(error.to_string().contains("Start MCP server"), "{error:#}");
        assert!(out.is_dir());
        assert!(save.parent().unwrap().is_dir());
        assert!(!save.exists());

        fs::remove_dir(&out).unwrap();
        fs::write(&out, b"existing user file").unwrap();
        let error = run(args().into_iter()).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("Prepare replay output directory"),
            "{error:#}"
        );
        assert_eq!(fs::read(&out).unwrap(), b"existing user file");
    }

    #[test]
    fn preflight_preserves_existing_files_and_rejects_bad_destinations() {
        let temp = TestDirectory::new();
        let report = temp.0.join("run-1.json");
        let save = temp.0.join("design.nbcad");
        fs::write(&report, b"previous report").unwrap();
        fs::write(&save, b"existing CAD work").unwrap();
        ReplayOutputs::prepare(temp.0.to_str(), save.to_str(), 1).unwrap();
        assert_eq!(fs::read(&report).unwrap(), b"previous report");
        assert_eq!(fs::read(&save).unwrap(), b"existing CAD work");
        assert_eq!(fs::read_dir(&temp.0).unwrap().count(), 2);
        assert!(ReplayOutputs::prepare(temp.0.to_str(), report.to_str(), 1)
            .unwrap_err()
            .to_string()
            .contains("conflicts with replay output"));

        let original = fs::metadata(&save).unwrap().permissions();
        let mut readonly = original.clone();
        readonly.set_readonly(true);
        fs::set_permissions(&save, readonly).unwrap();
        let result = ReplayOutputs::prepare(None, save.to_str(), 1);
        fs::set_permissions(&save, original).unwrap();
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("writable regular file"));
        assert_eq!(fs::read(&save).unwrap(), b"existing CAD work");

        fs::create_dir(temp.0.join("model-1.json")).unwrap();
        assert!(ReplayOutputs::prepare(temp.0.to_str(), None, 1).is_err());
    }

    #[test]
    fn relative_save_filename_is_resolved_for_the_desktop_process() {
        let temp = TestDirectory::new();
        let filename = format!("{}.nbcad", temp.0.file_name().unwrap().to_string_lossy());
        let outputs = ReplayOutputs::prepare(None, Some(&filename), 1).unwrap();
        assert_eq!(
            outputs.save,
            Some(fs::canonicalize(".").unwrap().join(filename))
        );
    }

    #[test]
    fn completed_report_and_model_survive_a_later_save_failure() {
        let temp = TestDirectory::new();
        let save = temp.0.join("saved/design.nbcad");
        let outputs = ReplayOutputs::prepare(temp.0.to_str(), save.to_str(), 1).unwrap();
        let model = json!({"schema_version":6,"name":"completed work"});
        let report = json!({"session_id":"live-document","steps_completed":3,"checks_completed":2,"exports":{"final_model":model}});
        let error = outputs
            .complete(1, &report, |destination| {
                assert_eq!(destination, outputs.save.as_ref().unwrap());
                let retained: Value =
                    serde_json::from_slice(&fs::read(temp.0.join("run-1.json"))?)?;
                assert_eq!(retained, report, "report must exist before Save is called");
                let retained_model: Value =
                    serde_json::from_slice(&fs::read(temp.0.join("model-1.json"))?)?;
                assert_eq!(retained_model, model);
                bail!("simulated late save failure")
            })
            .unwrap_err();
        let message = format!("{error:#}");
        assert!(message.contains("Replay completed"));
        assert!(message.contains("replay report retained at"));
        assert!(message.contains("simulated late save failure"));
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(temp.0.join("run-1.json")).unwrap()).unwrap(),
            report
        );
    }

    #[test]
    fn failure_to_retain_the_report_stops_before_save() {
        let temp = TestDirectory::new();
        let save = temp.0.join("design.nbcad");
        let outputs = ReplayOutputs::prepare(temp.0.to_str(), save.to_str(), 1).unwrap();
        // Simulate a destination changing after preflight but during replay.
        fs::create_dir(temp.0.join("run-1.json")).unwrap();
        let called = std::cell::Cell::new(false);
        let error = outputs
            .complete(1, &json!({"steps_completed":3}), |_| {
                called.set(true);
                Ok(json!({}))
            })
            .unwrap_err();
        assert!(!called.get());
        assert!(error.to_string().contains("Write completed replay report"));
    }

    #[test]
    fn live_launch_cannot_fall_back_to_headless_replay() {
        assert_eq!(
            launched_session(&json!({"status":"ready","session_id":"document"})).unwrap(),
            "document"
        );
        for reply in [
            json!({"status":"starting","pid":123}),
            json!({"status":"starting","session_id":"document"}),
            json!({"status":"failed","session_id":"document"}),
            json!({"status":"ready"}),
            json!({"status":"ready","session_id":" "}),
        ] {
            assert!(launched_session(&reply).is_err(), "{reply}");
        }
    }

    #[test]
    fn reports_model_difference_without_dropping_geometry() {
        let a =
            json!({"exports":{"final_scene":{"_disclosure":{"focus":"a"},"bodies":[{"id":1}]}}});
        let b =
            json!({"exports":{"final_scene":{"_disclosure":{"focus":"b"},"bodies":[{"id":1}]}}});
        assert_eq!(semantic_result(&a).unwrap(), semantic_result(&b).unwrap());
        let b = json!({"exports":{"final_scene":{"bodies":[{"id":2}]}}});
        assert_eq!(
            first_difference(
                &semantic_result(&a).unwrap(),
                &semantic_result(&b).unwrap(),
                ""
            ),
            Some("/final_scene/bodies/0/id".into())
        );
    }
    #[test]
    fn rejects_ignored_and_duplicate_options() {
        let args = HashMap::from([("--speed".to_owned(), "2".to_owned())]);
        assert!(known_options(&args, &["--server"]).is_err());
        assert!(options(
            ["--server", "a", "--server", "b"]
                .into_iter()
                .map(str::to_owned)
        )
        .is_err());
    }
    #[test]
    fn server_arguments_are_literal_ordered_and_repeatable() {
        let options = options(
            [
                "--server",
                "CAD folder/noBS-CAD.exe",
                "--server-arg",
                "--mcp",
                "--server-arg",
                "--appimage-extract-and-run",
                "--server-arg",
                "a b",
                "--server-arg",
                "",
                "--recipe",
                "fillet-basics",
            ]
            .into_iter()
            .map(str::to_owned),
        )
        .unwrap();
        assert_eq!(
            options.server_arguments,
            ["--mcp", "--appimage-extract-and-run", "a b", ""]
        );
        assert_eq!(options.values["--recipe"], "fillet-basics");
        assert_eq!(
            options.initialization_timeout().unwrap(),
            Duration::from_secs(30)
        );
        assert!(options.file.is_none());
        assert!(super::options(["--server-arg".into()].into_iter()).is_err());
    }

    #[test]
    fn initialization_timeout_rejects_ambiguous_or_unbounded_values() {
        for value in ["0", "601", "-1", "1.5", "NaN"] {
            let options = options(
                ["--init-timeout-seconds", value]
                    .into_iter()
                    .map(str::to_owned),
            )
            .unwrap();
            assert!(options.initialization_timeout().is_err(), "{value}");
        }
        let options = options(
            ["--init-timeout-seconds", "600"]
                .into_iter()
                .map(str::to_owned),
        )
        .unwrap();
        assert_eq!(
            options.initialization_timeout().unwrap(),
            Duration::from_secs(600)
        );
        assert!(super::options(
            ["--init-timeout-seconds", "1", "--init-timeout-seconds", "2"]
                .into_iter()
                .map(str::to_owned)
        )
        .is_err());
    }
    #[test]
    fn comparison_preserves_small_geometry_normals_across_json_roundtrips() {
        let value = json!({"normal":-1.1728120758078999e-17_f64});
        let restored: Value =
            serde_json::from_str(&serde_json::to_string_pretty(&value).unwrap()).unwrap();
        assert_eq!(value, restored);
    }
    #[test]
    fn comparison_keeps_persisted_sketch_references_but_ignores_editing_cache() {
        let constraint =
            json!({"type":"reference_midpoint","edge_id":42,"position":{"x":2.0,"y":3.0}});
        let a = json!({"exports":{"final_sketches":[{"can_undo":true,"reference_midpoints":[42],"constraints":[constraint]}]}});
        let b = json!({"exports":{"final_sketches":[{"can_undo":false,"reference_midpoints":[],"constraints":[constraint]}]}});
        assert_eq!(semantic_result(&a).unwrap(), semantic_result(&b).unwrap());
        let mut changed = b;
        changed["exports"]["final_sketches"][0]["constraints"][0]["position"]["x"] = json!(2.1);
        assert_ne!(
            semantic_result(&a).unwrap(),
            semantic_result(&changed).unwrap()
        );
    }
}
