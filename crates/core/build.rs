use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

fn git_path(path: &Path) -> String {
    let safe = path.to_string_lossy();
    if let Some(unc) = safe.strip_prefix(r"\\?\UNC\") {
        format!("//{}", unc.replace('\\', "/"))
    } else {
        safe.trim_start_matches(r"\\?\").replace('\\', "/")
    }
}

fn git(root: &Path, args: &[&str]) -> Option<String> {
    let root = root.canonicalize().ok()?;
    let safe = git_path(&root);
    let output = Command::new("git")
        .arg("-c")
        .arg(format!("safe.directory={safe}"))
        .args(args)
        .current_dir(&root)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_COMMON_DIR")
        // git status must not refresh the index we watch and invalidate the
        // next otherwise-identical Cargo invocation as a side effect.
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .ok()?;
    output.status.success().then(|| {
        let text = String::from_utf8_lossy(&output.stdout);
        if args.contains(&"-z") {
            text.into_owned()
        } else {
            text.trim().to_owned()
        }
    })
}

struct Identity {
    revision: String,
    modified: bool,
    inputs: Vec<PathBuf>,
}

fn identity(root: &Path, override_revision: Option<&str>) -> Result<Identity, String> {
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    // Source archives nested in another repository must not borrow its SHA.
    let repository = git(&root, &["rev-parse", "--show-toplevel"])
        .and_then(|path| PathBuf::from(path).canonicalize().ok())
        .is_some_and(|path| path == root);
    let read_git = |args: &[&str]| repository.then(|| git(&root, args)).flatten();
    let head = read_git(&["rev-parse", "HEAD"]);
    let revision = match override_revision {
        Some(value) => {
            if value.len() != 40 || !value.bytes().all(|c| c.is_ascii_hexdigit()) {
                return Err("NBCAD_BUILD_REVISION must be a full 40-character commit SHA".into());
            }
            if head
                .as_ref()
                .is_some_and(|head| !head.eq_ignore_ascii_case(value))
            {
                return Err("NBCAD_BUILD_REVISION does not match the checked-out HEAD".into());
            }
            value.to_ascii_lowercase()
        }
        None => head.unwrap_or_else(|| "unknown".into()),
    };
    // Unknown source state must not be reported as an exact clean build.
    // Newly added modules and embedded recipes also count as modifications.
    let modified = read_git(&["status", "--porcelain", "--untracked-files=normal"])
        .is_none_or(|status| !status.is_empty());
    let mut inputs = Vec::new();
    for path in ["HEAD", "index", "packed-refs"] {
        if let Some(path) = read_git(&["rev-parse", "--git-path", path]) {
            let path = root.join(path);
            // Watching a nonexistent optional packed-refs file makes every
            // Cargo invocation rebuild. A loose ref's removal is already watched.
            if path.exists() {
                inputs.push(path);
            }
        }
    }
    if let Some(reference) = read_git(&["symbolic-ref", "-q", "HEAD"]) {
        if let Some(path) = read_git(&["rev-parse", "--git-path", &reference]) {
            let path = root.join(path);
            if path.exists() {
                inputs.push(path);
            }
        }
    }
    // Explicit rerun directives disable Cargo's default source tracking. Watch
    // unstaged edits, including currently untracked but non-ignored files.
    if let Some(paths) = read_git(&[
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
    ]) {
        inputs.extend(
            paths
                .split('\0')
                .filter(|path| !path.is_empty())
                .map(|path| root.join(path)),
        );
    }
    // Detect additions in directories embedded without an existing source edit.
    // Do not watch roots containing target or node_modules build outputs.
    for directory in [
        "src",
        "src-tauri/src",
        "src-tauri/icons",
        "src-tauri/capabilities",
        "mcp-server/src",
        "examples/scripts",
        "knowledge",
        "interface",
        "public",
    ] {
        let path = root.join(directory);
        if path.is_dir() {
            inputs.push(path);
        }
    }
    if let Ok(crates) = fs::read_dir(root.join("crates")) {
        for entry in crates.flatten() {
            for directory in ["src", "cpp", "include"] {
                let path = entry.path().join(directory);
                if path.is_dir() {
                    inputs.push(path);
                }
            }
        }
    }
    inputs.sort();
    inputs.dedup();
    Ok(Identity {
        revision,
        modified,
        inputs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    // Clock readings can repeat between parallel tests on the same process.
    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = env::temp_dir().join(format!(
                "nbcad build identity {} {nonce} {}",
                std::process::id(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            assert!(git(&root, &["init", "--initial-branch=main"]).is_some());
            fs::create_dir(root.join("src")).unwrap();
            fs::write(root.join("src/lib.rs"), "original source\n").unwrap();
            fs::write(root.join(".gitignore"), "target/\n").unwrap();
            assert!(git(&root, &["add", "."]).is_some());
            assert!(git(
                &root,
                &[
                    "-c",
                    "user.name=Build identity test",
                    "-c",
                    "user.email=build-test@example.invalid",
                    "-c",
                    "commit.gpgsign=false",
                    "commit",
                    "-m",
                    "fixture"
                ]
            )
            .is_some());
            Self(root.canonicalize().unwrap())
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn unstaged_and_untracked_source_are_modified_and_watched() {
        let fixture = Fixture::new();
        let clean = identity(&fixture.0, None).unwrap();
        assert!(!clean.modified);
        assert_eq!(clean.revision.len(), 40);
        assert!(clean.inputs.contains(&fixture.0.join("src/lib.rs")));
        assert!(clean.inputs.contains(&fixture.0.join("src")));
        assert!(!clean.inputs.contains(&fixture.0));
        assert!(clean.inputs.iter().all(|path| path.exists()));
        fs::write(fixture.0.join("src/lib.rs"), "unstaged source\n").unwrap();
        assert!(identity(&fixture.0, None).unwrap().modified);
        assert!(git(&fixture.0, &["checkout", "--", "src/lib.rs"]).is_some());
        fs::write(fixture.0.join("src/new.rs"), "new source\n").unwrap();
        assert!(identity(&fixture.0, None).unwrap().modified);
    }

    #[test]
    fn worktree_metadata_and_explicit_revision_identify_the_actual_checkout() {
        let fixture = Fixture::new();
        let worktree = fixture.0.join("target/linked worktree");
        fs::create_dir(fixture.0.join("target")).unwrap();
        let worktree_argument = git_path(&worktree);
        assert!(git(
            &fixture.0,
            &["worktree", "add", "-b", "linked", &worktree_argument]
        )
        .is_some());
        let info = identity(&worktree, None).unwrap();
        assert!(!info.modified);
        assert!(info
            .inputs
            .iter()
            .any(|path| path.ends_with("HEAD") && path != &worktree.join(".git/HEAD")));
        assert!(identity(&worktree, Some(&info.revision)).is_ok());
        assert!(identity(&worktree, Some(&"a".repeat(40))).is_err());
        assert!(identity(&worktree, Some("short-sha")).is_err());
    }

    #[test]
    fn a_nested_source_archive_does_not_claim_its_parent_revision() {
        let fixture = Fixture::new();
        let archive = fixture.0.join("target/source archive");
        fs::create_dir_all(&archive).unwrap();
        let info = identity(&archive, None).unwrap();
        assert_eq!(info.revision, "unknown");
        assert!(info.modified);
    }
}

fn main() {
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../..");
    println!("cargo:rerun-if-env-changed=NBCAD_BUILD_REVISION");
    println!("cargo:rerun-if-env-changed=NBCAD_BUILD_CHANNEL");
    let info = identity(&root, env::var("NBCAD_BUILD_REVISION").ok().as_deref())
        .unwrap_or_else(|error| panic!("Build identity: {error}"));
    for path in info.inputs {
        println!("cargo:rerun-if-changed={}", path.display());
    }
    let channel = env::var("NBCAD_BUILD_CHANNEL").unwrap_or_else(|_| "development".into());
    println!("cargo:rustc-env=NBCAD_BUILD_REVISION={}", info.revision);
    println!(
        "cargo:rustc-env=NBCAD_BUILD_CHANNEL={}",
        channel.replace(['\r', '\n'], "")
    );
    println!("cargo:rustc-env=NBCAD_BUILD_MODIFIED={}", info.modified);
}
