//! One entry point for the existing native package builders.
use anyhow::{bail, ensure, Context, Result};
use std::{env, path::Path, process::Command};

#[derive(Debug, Default, PartialEq, Eq)]
struct Options {
    target: Option<String>,
    help: bool,
}

impl Options {
    fn parse(mut args: impl Iterator<Item = String>) -> Result<Self> {
        let mut options = Self::default();
        while let Some(argument) = args.next() {
            match argument.as_str() {
                "--target" if options.target.is_none() => {
                    let target = args.next().context("--target requires a Windows Rust target")?;
                    ensure!(
                        matches!(
                            target.as_str(),
                            "x86_64-pc-windows-msvc" | "aarch64-pc-windows-msvc"
                        ),
                        "Unsupported Windows target '{target}'; use x86_64-pc-windows-msvc or aarch64-pc-windows-msvc"
                    );
                    options.target = Some(target);
                }
                "--help" | "-h" if !options.help => options.help = true,
                _ => bail!("Unknown or duplicate package option '{argument}'; use cargo xtask package --help"),
            }
        }
        Ok(options)
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Invocation {
    program: &'static str,
    arguments: Vec<String>,
}

impl Invocation {
    fn for_host(os: &str, arch: &str, options: &Options) -> Result<Self> {
        ensure!(
            os == "windows" || options.target.is_none(),
            "--target is only supported when packaging on Windows"
        );
        let (program, arguments) = match os {
            "windows" => {
                let target = match options.target.as_deref() {
                    Some(target) => target,
                    None => match arch {
                        "x86_64" => "x86_64-pc-windows-msvc",
                        "aarch64" => "aarch64-pc-windows-msvc",
                        _ => bail!("Unsupported Windows host architecture '{arch}'"),
                    },
                };
                (
                    "pwsh",
                    vec![
                        "-NoProfile",
                        "-File",
                        "scripts/bundle-windows-portable.ps1",
                        "-Target",
                        target,
                    ],
                )
            }
            "macos" => ("node", vec!["scripts/bundle-macos.mjs"]),
            "linux" => ("node", vec!["scripts/bundle-linux.mjs"]),
            _ => bail!("Desktop packaging is supported on Windows, macOS and Linux, not '{os}'"),
        };
        Ok(Self {
            program,
            arguments: arguments.into_iter().map(str::to_owned).collect(),
        })
    }
}

pub fn run(args: impl Iterator<Item = String>) -> Result<()> {
    let options = Options::parse(args)?;
    if options.help {
        println!(
            "Build the native desktop package using the existing platform bundler.\n\n\
Usage: cargo xtask package [--target WINDOWS_RUST_TARGET]\n\n\
Run npm ci and install the host's native SDK prerequisites first.\n\
Windows selects the running Rust toolchain's architecture by default;\n\
--target accepts x86_64-pc-windows-msvc or aarch64-pc-windows-msvc.\n\
macOS and Linux use their existing native package configuration.\n\
SDK and signing environment overrides pass through unchanged.\n\n\
See docs/DEVELOPMENT.md for setup and package locations."
        );
        return Ok(());
    }
    let invocation = Invocation::for_host(env::consts::OS, env::consts::ARCH, &options)?;
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .context("Locate repository root")?;
    eprintln!(
        "Packaging with {} {}",
        invocation.program,
        invocation.arguments.join(" ")
    );
    let status = Command::new(invocation.program)
        .args(&invocation.arguments)
        .current_dir(root)
        .status()
        .with_context(|| {
            format!(
                "Start {} package builder; check prerequisites in docs/DEVELOPMENT.md",
                invocation.program
            )
        })?;
    ensure!(status.success(), "Package builder failed ({status})");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(arguments: &[&str]) -> Result<Options> {
        Options::parse(arguments.iter().map(|argument| (*argument).to_owned()))
    }

    #[test]
    fn windows_defaults_follow_host_architecture() {
        let options = parse(&[]).unwrap();
        for (arch, target) in [
            ("x86_64", "x86_64-pc-windows-msvc"),
            ("aarch64", "aarch64-pc-windows-msvc"),
        ] {
            let invocation = Invocation::for_host("windows", arch, &options).unwrap();
            assert_eq!(invocation.program, "pwsh");
            assert_eq!(
                invocation.arguments,
                [
                    "-NoProfile",
                    "-File",
                    "scripts/bundle-windows-portable.ps1",
                    "-Target",
                    target
                ]
            );
        }
    }

    #[test]
    fn explicit_windows_target_overrides_host() {
        let options = parse(&["--target", "aarch64-pc-windows-msvc"]).unwrap();
        let invocation = Invocation::for_host("windows", "x86_64", &options).unwrap();
        assert_eq!(
            invocation.arguments.last().unwrap(),
            "aarch64-pc-windows-msvc"
        );
        assert!(Invocation::for_host("macos", "aarch64", &options).is_err());
        assert!(Invocation::for_host("linux", "x86_64", &options).is_err());
    }

    #[test]
    fn unix_hosts_use_existing_bundlers_without_target_arguments() {
        for (os, script) in [
            ("macos", "scripts/bundle-macos.mjs"),
            ("linux", "scripts/bundle-linux.mjs"),
        ] {
            let invocation = Invocation::for_host(os, "aarch64", &Options::default()).unwrap();
            assert_eq!(invocation.program, "node");
            assert_eq!(invocation.arguments, [script]);
        }
    }

    #[test]
    fn rejects_malformed_or_unsupported_arguments_before_dispatch() {
        for arguments in [
            vec!["--target"],
            vec!["--target", "--help"],
            vec!["--target", "x86_64-unknown-linux-gnu"],
            vec![
                "--target",
                "aarch64-pc-windows-msvc",
                "--target",
                "x86_64-pc-windows-msvc",
            ],
            vec!["--release"],
            vec!["--help", "--help"],
        ] {
            assert!(parse(&arguments).is_err(), "{arguments:?}");
        }
        assert!(Invocation::for_host("freebsd", "x86_64", &Options::default()).is_err());
        assert!(Invocation::for_host("windows", "x86", &Options::default()).is_err());
    }

    #[test]
    fn help_does_not_need_a_package_build() {
        assert!(parse(&["--help"]).unwrap().help);
        assert!(parse(&["-h"]).unwrap().help);
    }
}
