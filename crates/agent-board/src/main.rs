use anyhow::{ensure, Context, Result};
use async_nats::jetstream::kv::{Config, Operation, Store};
use clap::{Parser, Subcommand};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const MAX_RECORD_BYTES: usize = 16 * 1024;

#[derive(Parser)]
#[command(
    version,
    about = "Shared agent notices on NATS JetStream; messages never execute commands"
)]
struct Args {
    #[arg(long, env = "NATS_URL", hide_env_values = true)]
    url: String,
    #[arg(long, env = "NATS_CREDS", hide_env_values = true)]
    creds: Option<PathBuf>,
    #[arg(
        long,
        env = "NATS_TOKEN_FILE",
        hide_env_values = true,
        conflicts_with = "creds"
    )]
    token_file: Option<PathBuf>,
    #[arg(long, env = "NBCAD_AGENT_BOARD", default_value = "nbcad_agents")]
    bucket: String,
    #[arg(long, env = "NBCAD_AGENT_ID")]
    agent: Option<String>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Create the dedicated bucket once; never changes an existing bucket.
    Init,
    /// Add an immutable notice. Reuse --id when retrying after a timeout.
    Post {
        #[arg(long)]
        topic: String,
        #[arg(long)]
        text: String,
        #[arg(long, default_value = "all")]
        to: String,
        #[arg(long)]
        id: Option<Uuid>,
    },
    /// Print retained notices and acknowledgments as JSON lines.
    Read,
    /// Print retained records, then follow updates until Ctrl-C.
    Watch,
    /// Record receipt/status of a notice, without deleting it for other agents.
    Ack {
        id: Uuid,
        #[arg(long)]
        text: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Record {
    Notice {
        version: u8,
        id: Uuid,
        agent: String,
        topic: String,
        to: String,
        text: String,
        timestamp_ms: u64,
    },
    Ack {
        version: u8,
        id: Uuid,
        agent: String,
        text: String,
        timestamp_ms: u64,
    },
}

fn segment(value: &str) -> Result<()> {
    ensure!(
        !value.is_empty()
            && value.len() <= 80
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'),
        "identities, topics and bucket names must be 1–80 ASCII letters, digits, '_' or '-'"
    );
    Ok(())
}

fn now_ms() -> Result<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis()
        .try_into()?)
}

fn encode(record: &Record) -> Result<Vec<u8>> {
    let text = match record {
        Record::Notice { text, .. } | Record::Ack { text, .. } => text,
    };
    ensure!(!text.trim().is_empty(), "message text must not be empty");
    let bytes = serde_json::to_vec(record)?;
    ensure!(bytes.len() <= MAX_RECORD_BYTES, "record exceeds 16 KiB");
    Ok(bytes)
}

fn decode(key: &str, value: &[u8]) -> Result<Record> {
    ensure!(value.len() <= MAX_RECORD_BYTES, "oversized record");
    let record: Record = serde_json::from_slice(value)?;
    let expected = match &record {
        Record::Notice {
            version,
            id,
            agent,
            topic,
            to,
            ..
        } => {
            ensure!(*version == 1, "unsupported board version");
            segment(agent)?;
            segment(topic)?;
            segment(to)?;
            format!("notice.{id}")
        }
        Record::Ack {
            version, id, agent, ..
        } => {
            ensure!(*version == 1, "unsupported board version");
            segment(agent)?;
            format!("ack.{id}.{agent}")
        }
    };
    ensure!(
        key == expected,
        "record identity does not match its NATS key"
    );
    encode(&record)?;
    Ok(record)
}

fn emit(key: &str, value: &[u8]) -> Result<()> {
    let record = decode(key, value).with_context(|| format!("invalid board record at {key}"))?;
    let mut stdout = std::io::stdout().lock();
    serde_json::to_writer(&mut stdout, &record)?;
    writeln!(stdout)?;
    stdout.flush()?;
    Ok(())
}

async fn connect(args: &Args) -> Result<async_nats::jetstream::Context> {
    // Keep credentials out of process arguments, URLs, error chains and JSON output.
    ensure!(
        !args.url.contains('@'),
        "URL credentials are unsupported; use NATS_TOKEN or NATS_CREDS"
    );
    let mut token = std::env::var("NATS_TOKEN").ok();
    ensure!(
        args.token_file.is_none() || token.is_none(),
        "set only one of NATS_TOKEN_FILE and NATS_TOKEN"
    );
    if let Some(path) = &args.token_file {
        token = Some(
            std::fs::read_to_string(path)
                .map_err(|_| anyhow::anyhow!("could not read NATS token file"))?
                .trim()
                .to_owned(),
        );
    }
    ensure!(
        token.as_ref().is_none_or(|value| !value.is_empty()),
        "NATS token is empty"
    );
    ensure!(
        args.creds.is_none() || token.is_none(),
        "set only one of NATS_CREDS and NATS_TOKEN"
    );
    let mut options = async_nats::ConnectOptions::new()
        .name("nbcad-agent-board")
        .connection_timeout(Duration::from_secs(5))
        .request_timeout(Some(Duration::from_secs(5)))
        .max_reconnects(3);
    if let Some(path) = &args.creds {
        options = options
            .credentials_file(path)
            .await
            .map_err(|_| anyhow::anyhow!("could not load NATS credentials file"))?;
    }
    if let Some(token) = token {
        options = options.token(token);
    }
    let client = options.connect(&args.url).await.map_err(|_| {
        anyhow::anyhow!("NATS connection failed; check endpoint, TLS and authentication")
    })?;
    Ok(async_nats::jetstream::new(client))
}

async fn prepare(args: &Args) -> Result<Store> {
    segment(&args.bucket)?;
    let js = connect(args).await?;
    if matches!(args.command, Command::Init) {
        let store = js.create_key_value(Config {
            bucket: args.bucket.clone(),
            description: "Agent coordination notices only; no CAD models or credentials".into(),
            history: 1,
                storage: async_nats::jetstream::stream::StorageType::File,
            max_age: Duration::from_secs(7 * 24 * 60 * 60),
            max_bytes: 16 * 1024 * 1024,
            max_value_size: MAX_RECORD_BYTES as i32,
            ..Default::default()
        }).await.context("could not create dedicated board bucket; it may already exist (use read), or JetStream/permissions may be unavailable")?;
        println!(
            "{}",
            serde_json::json!({"bucket": args.bucket, "created": true})
        );
        return Ok(store);
    }
    js.get_key_value(&args.bucket).await.context(
        "board unavailable; run init once with JetStream enabled and dedicated bucket permissions",
    )
}

async fn run(args: Args) -> Result<()> {
    if let Some(agent) = &args.agent {
        segment(agent)?;
    }
    let store = tokio::time::timeout(Duration::from_secs(20), prepare(&args))
        .await
        .context("NATS setup timed out")??;
    if matches!(args.command, Command::Init) {
        return Ok(());
    }
    let is_watch = matches!(args.command, Command::Watch);
    let work = async {
        match args.command {
            Command::Post {
                topic,
                text,
                to,
                id,
            } => {
                segment(&topic)?;
                segment(&to)?;
                let agent = args
                    .agent
                    .context("post requires --agent or NBCAD_AGENT_ID")?;
                let id = id.unwrap_or_else(Uuid::new_v4);
                let key = format!("notice.{id}");
                eprintln!("notice ID: {id}");
                let record = Record::Notice {
                    version: 1,
                    id,
                    agent,
                    topic,
                    to,
                    text,
                    timestamp_ms: now_ms()?,
                };
                let bytes = encode(&record)?;
                // Check first for retries; create is atomic so concurrent posters cannot replace a notice.
                if let Some(existing) = store.get(&key).await? {
                    let old = decode(&key, &existing)?;
                    let mut retry = record.clone();
                    if let (
                        Record::Notice {
                            timestamp_ms: old_time,
                            ..
                        },
                        Record::Notice { timestamp_ms, .. },
                    ) = (&old, &mut retry)
                    {
                        *timestamp_ms = *old_time;
                    }
                    ensure!(
                        old == retry,
                        "notice ID already belongs to different content"
                    );
                    emit(&key, &existing)?;
                } else {
                    store
                        .create(&key, bytes.clone().into())
                        .await
                        .context("notice was not confirmed; retry with the same --id")?;
                    emit(&key, &bytes)?;
                }
            }
            Command::Ack { id, text } => {
                let agent = args
                    .agent
                    .context("ack requires --agent or NBCAD_AGENT_ID")?;
                let key = format!("notice.{id}");
                let notice = store
                    .get(&key)
                    .await?
                    .context("notice missing or expired; acknowledgment rejected")?;
                ensure!(
                    matches!(decode(&key, &notice)?, Record::Notice { .. }),
                    "invalid notice"
                );
                let key = format!("ack.{id}.{agent}");
                let bytes = encode(&Record::Ack {
                    version: 1,
                    id,
                    agent,
                    text,
                    timestamp_ms: now_ms()?,
                })?;
                store.put(&key, bytes.clone().into()).await?;
                emit(&key, &bytes)?;
            }
            Command::Read => {
                let mut keys = store.keys().await?;
                while let Some(key) = keys.next().await {
                    let key = key?;
                    if let Some(value) = store.get(&key).await? {
                        emit(&key, &value)?;
                    }
                }
            }
            Command::Watch | Command::Init => unreachable!(),
        }
        Ok::<(), anyhow::Error>(())
    };
    if is_watch {
        let mut watch =
            tokio::time::timeout(Duration::from_secs(20), store.watch_with_history(">"))
                .await
                .context("watch setup timed out")??;
        loop {
            tokio::select! {
                signal = tokio::signal::ctrl_c() => { signal?; return Ok(()); }
                entry = watch.next() => {
                    let entry = entry.context("board watch disconnected")??;
                    if entry.operation == Operation::Put { emit(&entry.key, &entry.value)?; }
                }
            }
        }
    }
    tokio::time::timeout(Duration::from_secs(30), work)
        .await
        .context(
            "board request timed out; delivery is unconfirmed, retry post using the same --id",
        )?
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> std::process::ExitCode {
    match run(Args::parse()).await {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error:#}");
            std::process::ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires explicit NATS_TEST_URL and a JetStream test account"]
    async fn retained_notices_retry_conflicts_and_acknowledgments() -> Result<()> {
        let url = std::env::var("NATS_TEST_URL").context("set NATS_TEST_URL")?;
        let token_file = std::env::var_os("NATS_TEST_TOKEN_FILE").map(PathBuf::from);
        let bucket = format!("nbcad_test_{}", Uuid::new_v4().simple());
        let make_args = |command| Args {
            url: url.clone(),
            creds: None,
            token_file: token_file.clone(),
            bucket: bucket.clone(),
            agent: Some("test-agent".into()),
            command,
        };
        let js = connect(&make_args(Command::Init)).await?;
        run(make_args(Command::Init)).await?;
        let result = async {
            let id = Uuid::new_v4();
            let post = |text: &str| Command::Post {
                topic: "test".into(),
                text: text.into(),
                to: "all".into(),
                id: Some(id),
            };
            run(make_args(post("Keep this notice"))).await?;
            let store = js.get_key_value(&bucket).await?;
            let key = format!("notice.{id}");
            let original = store.get(&key).await?.context("missing notice")?;
            run(make_args(post("Keep this notice"))).await?;
            ensure!(
                store.get(&key).await?.as_ref() == Some(&original),
                "retry changed immutable notice"
            );
            ensure!(
                run(make_args(post("Overwrite attempt"))).await.is_err(),
                "conflicting retry accepted"
            );
            ensure!(
                run(make_args(Command::Ack {
                    id: Uuid::new_v4(),
                    text: "Invalid".into()
                }))
                .await
                .is_err(),
                "ack accepted missing notice"
            );
            run(make_args(Command::Ack {
                id,
                text: "Received".into(),
            }))
            .await?;
            let ack = store
                .get(format!("ack.{id}.test-agent"))
                .await?
                .context("missing acknowledgment")?;
            ensure!(
                matches!(
                    decode(&format!("ack.{id}.test-agent"), &ack)?,
                    Record::Ack { .. }
                ),
                "invalid ack"
            );
            let mut watch = store.watch_with_history(">").await?;
            let mut retained = 0;
            while retained < 2 {
                let entry = tokio::time::timeout(Duration::from_secs(5), watch.next())
                    .await?
                    .context("watch ended")??;
                decode(&entry.key, &entry.value)?;
                retained += 1;
            }
            run(make_args(Command::Read)).await?;
            Ok::<(), anyhow::Error>(())
        }
        .await;
        let cleanup = js
            .delete_key_value(&bucket)
            .await
            .context("remove owned test bucket");
        result?;
        cleanup?;
        Ok(())
    }

    #[test]
    fn rejects_subject_injection_and_oversized_notices() {
        for bad in ["", "agent.name", "*", ">", "a b", "a\n", "日本語"] {
            assert!(segment(bad).is_err());
        }
        assert!(segment("bevy-agent_1").is_ok());
        let record = Record::Notice {
            version: 1,
            id: Uuid::nil(),
            agent: "agent".into(),
            topic: "bevy".into(),
            to: "all".into(),
            text: "x".repeat(MAX_RECORD_BYTES),
            timestamp_ms: 1,
        };
        assert!(encode(&record).is_err());
    }

    #[test]
    fn record_identity_and_version_are_fenced() {
        let record = Record::Ack {
            version: 1,
            id: Uuid::nil(),
            agent: "agent".into(),
            text: "Saved; ready to restart".into(),
            timestamp_ms: 1,
        };
        let key = format!("ack.{}.agent", Uuid::nil());
        let bytes = encode(&record).unwrap();
        assert_eq!(decode(&key, &bytes).unwrap(), record);
        assert!(decode("ack.other.agent", &bytes).is_err());
        let future = String::from_utf8(bytes)
            .unwrap()
            .replace("\"version\":1", "\"version\":2");
        assert!(decode(&key, future.as_bytes()).is_err());
    }
}
