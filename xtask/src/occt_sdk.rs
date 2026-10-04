//! Reproducible OCCT 7.9 SDK build through a portable Rust entry point.
use anyhow::{bail, ensure, Context, Result};
use std::{
    env, fs,
    io::{Read, Write},
    path::PathBuf,
    process::Command,
    time::Duration,
};

const VERSION: &str = "7_9_3";
const SHA256: &str = "5ecf094ec6b12d5413dfb851d8c3590c354058aee556e32e408bdfbf8c357d57";
const MAX_SOURCE_BYTES: u64 = 256 * 1024 * 1024;
const SETTINGS: &[&str] = &[
    "CMAKE_BUILD_TYPE=Release",
    "BUILD_LIBRARY_TYPE=Shared",
    "BUILD_MODULE_FoundationClasses=ON",
    "BUILD_MODULE_ModelingData=ON",
    "BUILD_MODULE_ModelingAlgorithms=ON",
    "BUILD_MODULE_Visualization=ON",
    "BUILD_MODULE_ApplicationFramework=ON",
    "BUILD_MODULE_DataExchange=ON",
    "BUILD_MODULE_DETools=OFF",
    "BUILD_MODULE_Draw=OFF",
    "BUILD_DOC_Overview=OFF",
    "USE_TCL=OFF",
    "USE_TK=OFF",
    "USE_OPENGL=OFF",
    "USE_GLES2=OFF",
    "USE_FREETYPE=ON",
    "USE_FREEIMAGE=OFF",
    "USE_RAPIDJSON=OFF",
    "USE_DRACO=OFF",
    "USE_TBB=OFF",
    "USE_VTK=OFF",
];

struct Options {
    prefix: PathBuf,
    jobs: usize,
    dry_run: bool,
    cache: PathBuf,
    sccache: bool,
    github_key: bool,
    freetype: Vec<String>,
}
impl Options {
    fn parse(mut args: impl Iterator<Item = String>) -> Result<Self> {
        let mut prefix = None;
        let mut jobs = None;
        let mut dry_run = false;
        let mut cache = None;
        let mut sccache = false;
        let mut github_key = false;
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--prefix" => {
                    ensure!(prefix.is_none(), "duplicate --prefix");
                    prefix = Some(PathBuf::from(args.next().context("missing --prefix path")?));
                }
                "--jobs" => {
                    ensure!(jobs.is_none(), "duplicate --jobs");
                    jobs = Some(args.next().context("missing --jobs")?.parse::<usize>()?);
                }
                "--dry-run" => dry_run = true,
                "--cache-dir" => {
                    ensure!(cache.is_none(), "duplicate --cache-dir");
                    cache = Some(PathBuf::from(args.next().context("missing --cache-dir")?));
                }
                "--sccache" => sccache = true,
                "--github-key" => github_key = true,
                _ => bail!("use build-occt --prefix PATH [--jobs N] [--cache-dir PATH] [--sccache] [--dry-run]"),
            }
        }
        let prefix = prefix.context("missing --prefix PATH")?;
        ensure!(!prefix.as_os_str().is_empty(), "empty install prefix");
        let prefix = if prefix.is_absolute() {
            prefix
        } else {
            env::current_dir()?.join(prefix)
        };
        let jobs = match jobs {
            Some(jobs) => jobs,
            None => env::var("CMAKE_BUILD_PARALLEL_LEVEL")
                .ok()
                .filter(|s| !s.is_empty())
                .map(|s| s.parse::<usize>())
                .transpose()?
                .unwrap_or(std::thread::available_parallelism().map_or(1, usize::from)),
        };
        ensure!(jobs > 0, "--jobs must be greater than zero");
        let cache = cache
            .or_else(|| env::var_os("NBCAD_BUILD_CACHE").map(PathBuf::from))
            .unwrap_or_else(|| crate::build_tools::root().join("target/nbcad-build-cache"));
        ensure!(!cache.as_os_str().is_empty(), "empty cache directory");
        let cache = if cache.is_absolute() {
            cache
        } else {
            env::current_dir()?.join(cache)
        };
        Ok(Self {
            prefix,
            jobs,
            dry_run,
            cache,
            sccache,
            github_key,
            freetype: Vec::new(),
        })
    }
}

fn configure(options: &Options, source: &std::path::Path, build: &std::path::Path) -> Command {
    let mut command = Command::new("cmake");
    command
        .arg("-S")
        .arg(source)
        .arg("-B")
        .arg(build)
        .args(["-G", "Ninja"])
        .arg(format!("-DINSTALL_DIR={}", options.prefix.display()))
        .arg("-DINSTALL_DIR_LAYOUT=Unix");
    for setting in SETTINGS {
        command.arg(format!("-D{setting}"));
    }
    if options.sccache {
        command.args([
            "-DCMAKE_C_COMPILER_LAUNCHER=sccache",
            "-DCMAKE_CXX_COMPILER_LAUNCHER=sccache",
        ]);
    }
    command.args(&options.freetype);
    command
}
fn run_command(command: &mut Command) -> Result<()> {
    let status = command
        .status()
        .with_context(|| format!("start {command:?}"))?;
    ensure!(status.success(), "{command:?} failed ({status})");
    Ok(())
}

pub fn run(args: impl Iterator<Item = String>) -> Result<()> {
    let mut options = Options::parse(args)?;
    let url =
        format!("https://github.com/Open-Cascade-SAS/OCCT/archive/refs/tags/V{VERSION}.tar.gz");
    if options.dry_run {
        println!(
            "OCCT {} source {url}\nSHA256 {SHA256}\n{:?}\nJobs: {}\nCache: {}",
            VERSION.replace('_', "."),
            configure(
                &options,
                std::path::Path::new("SOURCE"),
                std::path::Path::new("BUILD")
            ),
            options.jobs,
            options.cache.display()
        );
        return Ok(());
    }
    fs::create_dir_all(&options.cache)?;
    if options.sccache {
        crate::build_tools::require_tool("sccache")?;
    }
    let compiler = crate::occt_cache::compiler_identity(&options.cache)?;
    // OCCT has its own finder. Pin it to the exact FreeType inputs we hashed.
    options.freetype = crate::occt_cache::freetype_arguments(&compiler)?;
    let recipe = configure(
        &options,
        std::path::Path::new("SOURCE"),
        std::path::Path::new("BUILD"),
    )
    .get_args()
    .map(|arg| arg.to_string_lossy().into_owned())
    .collect::<Vec<_>>()
    .join("\n");
    let key = crate::occt_cache::key(SHA256, &compiler, &recipe)?;
    if options.github_key {
        let mut output = fs::OpenOptions::new()
            .append(true)
            .open(env::var_os("GITHUB_OUTPUT").context("--github-key requires GITHUB_OUTPUT")?)?;
        writeln!(output, "sdk_key={key}")?;
        return Ok(());
    }
    let source_cache = options.cache.join("sources").join(SHA256);
    let source_lock = crate::occt_cache::lock(&source_cache)?;
    let archive = source_cache.join("occt.tar.gz");
    if !archive.exists() {
        download(&url, &archive)?;
    }
    ensure!(
        crate::hash::file(&archive)? == SHA256,
        "cached OCCT archive checksum differs; refusing reuse"
    );
    let source = source_cache.join(format!("OCCT-{VERSION}"));
    if !source.exists() {
        let staging = tempfile::tempdir_in(&source_cache)?;
        tar::Archive::new(flate2::read::GzDecoder::new(fs::File::open(&archive)?))
            .unpack(staging.path())?;
        let extracted = staging.path().join(format!("OCCT-{VERSION}"));
        ensure!(
            extracted.join("CMakeLists.txt").is_file(),
            "missing OCCT source tree"
        );
        fs::rename(extracted, &source)?;
    }
    ensure!(
        source.join("CMakeLists.txt").is_file(),
        "incomplete cached OCCT source"
    );
    drop(source_lock);
    let work = options.cache.join("builds").join(&key);
    let _build_lock = crate::occt_cache::lock(&work)?;
    crate::occt_cache::prepare(&options.prefix, &key)?;
    if crate::occt_cache::complete(&options.prefix, &key)? {
        println!(
            "Verified installed OCCT SDK cache hit: {}",
            options.prefix.display()
        );
        return Ok(());
    }
    let build = work.join("build");
    run_command(&mut configure(&options, &source, &build))?;
    run_command(
        Command::new("cmake")
            .arg("--build")
            .arg(&build)
            .arg("--parallel")
            .arg(options.jobs.to_string()),
    )?;
    run_command(Command::new("cmake").arg("--install").arg(&build))?;
    let doc = options.prefix.join("share/doc/opencascade");
    fs::create_dir_all(&doc)?;
    let mut copyright = fs::File::create(doc.join("copyright"))?;
    writeln!(copyright,"Open CASCADE Technology {}\nhttps://github.com/Open-Cascade-SAS/OCCT\nCopyright (c) Open CASCADE SAS\n\nOCCT is distributed under the GNU Lesser General Public License version 2.1\nwith the following additional exception.\n",VERSION.replace('_',"."))?;
    std::io::copy(
        &mut fs::File::open(source.join("OCCT_LGPL_EXCEPTION.txt"))?,
        &mut copyright,
    )?;
    fs::copy(source.join("LICENSE_LGPL_21.txt"), doc.join("LGPL-2.1.txt"))?;
    crate::build_tools::sdk::resolve(
        std::slice::from_ref(&options.prefix),
        env::consts::OS,
        env::consts::ARCH,
        None,
    )
    .map_err(anyhow::Error::msg)
    .context("validate the installed OCCT SDK before publishing its receipt")?;
    crate::occt_cache::publish(&options.prefix, &key)?;
    println!(
        "Installed OCCT {} into {}\nBuild cache: {}",
        VERSION.replace('_', "."),
        options.prefix.display(),
        work.display()
    );
    if options.sccache {
        crate::build_tools::run(Command::new("sccache").arg("--show-stats"))?;
    }
    Ok(())
}

fn download(url: &str, archive: &std::path::Path) -> Result<()> {
    let mut temporary =
        tempfile::NamedTempFile::new_in(archive.parent().context("source cache parent")?)?;
    let config = ureq::Agent::config_builder()
        .https_only(true)
        .timeout_global(Some(Duration::from_secs(120)))
        .build();
    let agent: ureq::Agent = config.into();
    let mut response = agent
        .get(url)
        .header("User-Agent", "noBS-CAD-OCCT-SDK")
        .call()?;
    let bytes = std::io::copy(
        &mut response.body_mut().as_reader().take(MAX_SOURCE_BYTES + 1),
        temporary.as_file_mut(),
    )?;
    ensure!(
        bytes <= MAX_SOURCE_BYTES,
        "OCCT source archive exceeds the 256 MB limit"
    );
    ensure!(
        crate::hash::file(temporary.path())? == SHA256,
        "OCCT source checksum differs; refusing extraction"
    );
    temporary.as_file_mut().sync_all()?;
    temporary.persist_noclobber(archive)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sdk_recipe_keeps_abi_modules_and_literal_paths_without_a_shell() {
        let options = Options::parse(
            ["--prefix", "SDK path with spaces", "--jobs", "2"]
                .map(str::to_owned)
                .into_iter(),
        )
        .unwrap();
        let command = configure(
            &options,
            std::path::Path::new("source path"),
            std::path::Path::new("build path"),
        );
        let args: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert!(args.contains(&"source path".into()) && args.contains(&"build path".into()));
        assert!(args.contains(&format!("-DINSTALL_DIR={}", options.prefix.display())));
        for module in ["DataExchange", "Visualization", "ApplicationFramework"] {
            assert!(args.contains(&format!("-DBUILD_MODULE_{module}=ON")));
        }
        for module in ["Draw", "DETools"] {
            assert!(args.contains(&format!("-DBUILD_MODULE_{module}=OFF")));
        }
        assert_eq!(options.jobs, 2);
        assert!(Options::parse(
            ["--prefix", "test", "--jobs", "0"]
                .map(str::to_owned)
                .into_iter()
        )
        .is_err());
        assert!(Options::parse(
            ["--prefix", "test", "--prefix", "another"]
                .map(str::to_owned)
                .into_iter()
        )
        .is_err());
    }
}
