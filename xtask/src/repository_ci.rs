//! Platform-independent CI orchestration. Cargo failures and empty shards fail closed.
use crate::hash::hex;
use anyhow::{bail, ensure, Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{env, fs, path::Path};

const FLAGSHIPS: [(&str, &str); 2] = [
    (
        "turbine",
        "turbine_replays_edits_restores_prints_and_drives_native_geometry",
    ),
    ("vise", "vise::d_screw_vise_builds_editable_native_geometry"),
];
const PROJECTS: [(&str, &str); 3] = [
    ("garden-bench", "bench.nbcad"),
    ("d-screw-vise", "vise.nbcad"),
    ("vertical-axis-turbine", "turbine.nbcad"),
];

pub fn run(mut args: impl Iterator<Item = String>) -> Result<()> {
    let task = args
        .next()
        .context("use ci mcp-shard SHARD, stage-demo-projects, or require-platform")?;
    let root = crate::release_tooling::root();
    match task.as_str() {
        "desktop-changes" => return crate::desktop_changes::run(args),
        "mcp-shard" => {
            let shard = args
                .next()
                .context("missing MCP shard (core, turbine, vise)")?;
            ensure!(args.next().is_none(), "unexpected MCP shard argument");
            let arguments = shard_arguments(&shard)?;
            let inventory = crate::build_tools::cargo()
                .current_dir(root)
                .args([
                    "test",
                    "--locked",
                    "--manifest-path",
                    "mcp-server/Cargo.toml",
                    "--test",
                    "recipes",
                    "--",
                    "--list",
                ])
                .stderr(std::process::Stdio::inherit())
                .output()
                .context("list compiled MCP recipe tests")?;
            ensure!(
                inventory.status.success(),
                "Cargo inventory failed ({})",
                inventory.status
            );
            verify_inventory(std::str::from_utf8(&inventory.stdout)?)?;
            let status = crate::build_tools::cargo()
                .current_dir(root)
                .args(arguments)
                .status()?;
            ensure!(status.success(), "MCP {shard} shard failed ({status})");
        }
        "stage-demo-projects" => {
            ensure!(args.next().is_none(), "unexpected staging argument");
            stage_projects(
                &root.join("target/mcp-recipe-evidence"),
                &root.join("target/demo-projects"),
                &env::var("GITHUB_SHA").context("missing GITHUB_SHA")?,
                &fs::read_to_string(root.join("VERSION"))?,
            )?;
        }
        "require-platform" => {
            ensure!(args.next().is_none(), "unexpected platform gate argument");
            require_platform(
                &env::var("MCP_PLATFORM").unwrap_or_default(),
                &env::var("NATIVE_RESULT").unwrap_or_default(),
            )?;
        }
        _ => bail!("unknown CI task '{task}'"),
    }
    Ok(())
}

fn shard_arguments(shard: &str) -> Result<Vec<String>> {
    let mut args: Vec<String> = [
        "test",
        "--locked",
        "--manifest-path",
        "mcp-server/Cargo.toml",
    ]
    .map(String::from)
    .into();
    if shard == "core" {
        args.extend(["--", "--test-threads=1", "--exact"].map(String::from));
        for (_, name) in FLAGSHIPS {
            args.extend(["--skip".into(), name.into()]);
        }
    } else {
        let name = FLAGSHIPS
            .iter()
            .find(|(key, _)| *key == shard)
            .context("unknown MCP shard; use core, turbine, or vise")?
            .1;
        args.extend(
            [
                "--test",
                "recipes",
                name,
                "--",
                "--exact",
                "--test-threads=1",
            ]
            .map(String::from),
        );
    }
    Ok(args)
}

fn verify_inventory(output: &str) -> Result<()> {
    for (_, name) in FLAGSHIPS {
        ensure!(output.lines().filter_map(|line| line.strip_suffix(": test")).filter(|test| *test == name).count() == 1,
            "expected exactly one compiled recipe test named {name}; update CI sharding after a rename");
    }
    Ok(())
}

fn require_platform(platform: &str, result: &str) -> Result<()> {
    ensure!(
        ["windows", "linux"].contains(&platform),
        "unknown or missing MCP platform"
    );
    ensure!(
        result == "success",
        "MCP {platform} acceptance shards did not all succeed: {result}"
    );
    Ok(())
}

#[derive(Serialize)]
struct Asset<'a> {
    recipe: &'a str,
    name: &'a str,
    size: usize,
    sha256: String,
}
#[derive(Serialize)]
struct Manifest<'a> {
    schema_version: u32,
    source_commit: &'a str,
    application_version: &'a str,
    assets: Vec<Asset<'a>>,
}

fn stage_projects(source: &Path, destination: &Path, commit: &str, version: &str) -> Result<()> {
    ensure!(
        commit.len() == 40
            && commit
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "invalid source commit"
    );
    let version = version.trim();
    semver::Version::parse(version).context("invalid application version")?;
    let mut assets = Vec::new();
    let mut inputs = Vec::new();
    // Validate and capture every input before reserving a publishable directory.
    for (recipe, name) in PROJECTS {
        let path = source.join(format!("{recipe}.nbcad"));
        let metadata = fs::symlink_metadata(&path)
            .with_context(|| format!("missing project {}", path.display()))?;
        ensure!(
            metadata.is_file() && metadata.len() > 0,
            "empty or non-regular project {}",
            path.display()
        );
        let bytes = fs::read(&path)?;
        ensure!(
            !bytes.is_empty(),
            "project became empty: {}",
            path.display()
        );
        assets.push(Asset {
            recipe,
            name,
            size: bytes.len(),
            sha256: hex(&Sha256::digest(&bytes)),
        });
        inputs.push((name, bytes));
    }
    // create_dir refuses stale output and symlinks; never merge attempts.
    fs::create_dir(destination).context("reserve fresh demo-project directory")?;
    let result = (|| -> Result<()> {
        let staging = tempfile::tempdir_in(destination.parent().context("demo output parent")?)?;
        for (name, bytes) in inputs {
            fs::write(staging.path().join(name), bytes)?;
        }
        let manifest = Manifest {
            schema_version: 1,
            source_commit: commit,
            application_version: version,
            assets,
        };
        fs::write(
            staging.path().join("demo-projects.json"),
            format!("{}\n", serde_json::to_string_pretty(&manifest)?),
        )?;
        fs::remove_dir(destination)?;
        fs::rename(staging.path(), destination)?;
        Ok(())
    })();
    if result.is_err() && destination.exists() {
        fs::remove_dir(destination).context("remove this attempt's empty demo reservation")?;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compiled_shards_require_exact_unique_names() {
        let inventory = FLAGSHIPS
            .map(|(_, name)| format!("{name}: test\r\n"))
            .concat();
        verify_inventory(&inventory).unwrap();
        assert!(verify_inventory("").is_err());
        assert!(verify_inventory(&(inventory.clone() + &inventory)).is_err());
        assert!(verify_inventory(&inventory.replace(FLAGSHIPS[0].1, "renamed_test")).is_err());
        assert!(shard_arguments("toString").is_err());
        let core = shard_arguments("core").unwrap();
        assert!(!core.contains(&"--test".to_owned())); // All targets and doctests remain included.
        assert_eq!(&core[4..7], ["--", "--test-threads=1", "--exact"]);
        for (shard, name) in FLAGSHIPS {
            assert_eq!(
                &shard_arguments(shard).unwrap()[4..],
                [
                    "--test",
                    "recipes",
                    name,
                    "--",
                    "--exact",
                    "--test-threads=1"
                ]
            );
        }
    }
    #[test]
    fn platform_gate_rejects_every_non_success_result() {
        for platform in ["windows", "linux"] {
            for result in ["success", "failure", "cancelled", "skipped", ""] {
                assert_eq!(
                    require_platform(platform, result).is_ok(),
                    result == "success"
                );
            }
        }
        assert!(require_platform("", "success").is_err());
    }
    #[test]
    fn staged_projects_have_exact_provenance_and_preserve_stale_output() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("inputs");
        fs::create_dir(&source).unwrap();
        for (recipe, _) in PROJECTS {
            fs::write(source.join(format!("{recipe}.nbcad")), recipe).unwrap();
        }
        let dest = root.path().join("output");
        assert!(stage_projects(&source, &dest, "main", "0.2.2").is_err());
        assert!(!dest.exists());
        let missing = source.join("vertical-axis-turbine.nbcad");
        fs::write(&missing, "").unwrap();
        assert!(stage_projects(&source, &dest, &"a".repeat(40), "0.2.2").is_err());
        assert!(!dest.exists());
        fs::write(missing, "turbine").unwrap();
        stage_projects(&source, &dest, &"a".repeat(40), "0.2.2\n").unwrap();
        let manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(dest.join("demo-projects.json")).unwrap()).unwrap();
        for asset in manifest["assets"].as_array().unwrap() {
            let bytes = fs::read(dest.join(asset["name"].as_str().unwrap())).unwrap();
            assert_eq!(asset["size"].as_u64().unwrap(), bytes.len() as u64);
            assert_eq!(asset["sha256"], hex(&Sha256::digest(bytes)));
        }
        fs::write(dest.join("bench.nbcad"), "preserve").unwrap();
        assert!(stage_projects(&source, &dest, &"a".repeat(40), "0.2.2").is_err());
        assert_eq!(
            fs::read_to_string(dest.join("bench.nbcad")).unwrap(),
            "preserve"
        );
    }
}
