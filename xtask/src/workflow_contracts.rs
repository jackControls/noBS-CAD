//! Preserve release/ABI/publication guard contracts without a Node test runner.
use regex::Regex;
use std::fs;
fn read(file: &str) -> String {
    fs::read_to_string(crate::release_tooling::root().join(file))
        .unwrap()
        .replace("\r\n", "\n")
}
fn job(source: &str, id: &str) -> String {
    let prefix = format!("  {id}:\n");
    let rest = source
        .split_once(&prefix)
        .unwrap_or_else(|| panic!("missing job {id}"))
        .1;
    let end = Regex::new(r"(?m)^  [\w-]+:\n")
        .unwrap()
        .find(rest)
        .map_or(rest.len(), |m| m.start());
    rest[..end].into()
}
fn matches(text: &str, pattern: &str) {
    assert!(
        Regex::new(pattern).unwrap().is_match(text),
        "missing contract {pattern}"
    );
}
fn ordered(text: &str, first: &str, second: &str) {
    assert!(
        text.find(first).unwrap() < text.find(second).unwrap(),
        "{first} must precede {second}"
    );
}

#[test]
fn material_sources_are_verified_before_engine_tests_and_desktop_packages() {
    let command = "cargo xtask materials --fetch --check";
    let engine = read(".github/workflows/linux-engine-tests.yml");
    ordered(&engine, command, "cargo test --locked --workspace");
    let tooling = read(".github/workflows/rust-web.yml");
    assert!(job(&tooling, "repository-tooling").contains(command));
    let desktop = read(".github/workflows/desktop-packages.yml");
    for name in [
        "build-windows-portable",
        "build-linux-ubuntu",
        "build-linux-appimage",
        "build-macos-apple-silicon",
    ] {
        let config = job(&desktop, name);
        ordered(&config, command, "cargo xtask package");
    }
}

#[test]
fn rust_setup_and_wasm_tools_use_repository_pins() {
    let action = read(".github/actions/setup-rust/action.yml");
    assert!(
        action.contains("rustup show")
            && action.contains("working-directory: ${{ inputs.directory }}")
    );
    assert!(!action.contains("stable"));
    let web = read(".github/workflows/rust-web.yml");
    assert!(
        web.contains("cargo xtask bootstrap --wasm") && !web.contains("cargo install wasm-pack")
    );
    let desktop = read(".github/workflows/desktop-packages.yml");
    assert!(
        desktop.contains("cargo xtask ci desktop-changes")
            && !desktop.contains("actions/github-script")
    );
    let matched = read(".github/workflows/native-switching.yml");
    assert!(matched.contains("uses: ./candidate/.github/actions/setup-rust"));
    assert!(matched.contains("RUSTUP_TOOLCHAIN=${{ steps.rust.outputs.toolchain }}"));
}

#[test]
fn package_and_publication_cannot_bypass_version_or_failed_builds() {
    let desktop = read(".github/workflows/desktop-packages.yml");
    assert!(!desktop.contains("frontend_regressions") && !desktop.contains("npm ci"));
    assert!(
        job(&desktop, "version_preflight").contains("uses: ./.github/workflows/version-guard.yml")
    );
    let bypass = Regex::new(r"(?m)^    if:.*(?:always|cancelled|failure)\(").unwrap();
    for name in [
        "build-windows-portable",
        "build-linux-ubuntu",
        "build-linux-appimage",
        "build-macos-apple-silicon",
    ] {
        let config = job(&desktop, name);
        assert!(config.contains("needs: [classify_changes, version_preflight]"));
        matches(
            &config,
            r"if: needs\.classify_changes\.outputs\.\w+_should_build == 'true'",
        );
        assert!(!bypass.is_match(&config));
    }
    let publish = job(&desktop, "publish_release");
    assert!(publish
        .contains("if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')"));
    for name in [
        "build-windows-portable",
        "build-linux-ubuntu",
        "build-linux-appimage",
        "verify-linux-appimage",
        "build-macos-apple-silicon",
    ] {
        assert!(publish.contains(&format!("      - {name}")));
    }
    ordered(&publish, "check-release-tag", "actions/download-artifact");
    assert!(
        publish.contains("merge-multiple: false")
            && publish.contains("--draft")
            && publish.contains("test \"$uploaded\" -eq 11")
    );
    assert!(publish.contains("test \"$checked\" -eq 5"));
    assert!(publish.contains("perl -pi -e 's/\\r$//'"));
    assert_eq!(
        desktop
            .lines()
            .filter(|line| line.trim() == "contents: write")
            .count(),
        1
    );
    let version = read(".github/workflows/version-guard.yml");
    matches(&version, r"(?m)^  workflow_call:");
    assert!(version.contains("group: version-guard-${{ github.workflow }}-${{ github.ref }}"));
    assert!(version.contains("cargo test --locked -p xtask 'release_tooling::'"));
    assert!(version.contains("cargo xtask check-release-tag \"$GITHUB_REF_NAME\" \"$GITHUB_SHA\""));
    assert!(!Regex::new(r"setup-node|\bnode\b|\bnpm\b")
        .unwrap()
        .is_match(&version));
}

#[test]
fn sdk_cache_keys_keep_all_abi_inputs_and_arm_runner_is_default_branch_only() {
    let warmer = read(".github/workflows/windows-occt-cache.yml");
    assert!(
        warmer.contains("  push:\n    branches: [main]")
            && warmer.contains("  workflow_dispatch:")
            && warmer.contains("  schedule:")
    );
    assert!(!warmer.contains("  pull_request"));
    assert!(job(&warmer, "warm-arm64").contains(
        "if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)"
    ));
    let desktop = read(".github/workflows/desktop-packages.yml");
    for value in [
        "windows-11-vs2026-arm",
        "windows-11-vs2026-arm-arm64-windows-msvc",
        "arm64-windows",
        "Microsoft.VisualStudio.Component.VC.Tools.ARM64",
    ] {
        assert!(warmer.contains(value) && desktop.contains(value));
    }
    let sdk = read(".github/actions/setup-windows-occt/action.yml");
    assert!(sdk.contains("default: 716b42043743cdceabed9c8e2e6cf80ddae1e0c1"));
    for prefix in ["vcpkg-installed-v1", "vcpkg-binary-v2"] {
        let key = format!("key: {prefix}-${{{{ inputs.runner-cache-key }}}}-${{{{ steps.msvc.outputs.toolset }}}}-${{{{ inputs.vcpkg-commit }}}}-${{{{ hashFiles('vcpkg.json') }}}}");
        assert_eq!(sdk.matches(&key).count(), 2);
    }
    assert!(!sdk.contains("restore-keys:"));
}

#[test]
fn native_shards_keep_geometry_workshop_and_exact_same_run_artifact_provenance() {
    let mcp = read(".github/workflows/mcp-server.yml");
    assert!(
        job(&mcp, "mcp-windows").contains("strategy: &acceptance-shards\n      fail-fast: false")
    );
    assert!(job(&mcp, "mcp-linux").contains("strategy: *acceptance-shards"));
    for (shard, project) in [
        ("core", "garden-bench"),
        ("turbine", "vertical-axis-turbine"),
        ("vise", "d-screw-vise"),
    ] {
        assert!(mcp.contains(&format!("- shard: {shard}\n            project: {project}")));
    }
    for name in ["mcp-windows", "mcp-linux"] {
        let config = job(&mcp, name);
        assert!(config.contains("cargo xtask ci mcp-shard ${{ matrix.shard }}"));
        assert!(config.contains(
            "name: MCP bench and complete feature workshop\n        if: matrix.shard == 'core'"
        ));
        let step = config
            .split_once("      - name: Native geometry integration regressions\n")
            .unwrap()
            .1
            .split("\n      -")
            .next()
            .unwrap();
        assert!(
            step.contains("if: matrix.shard == 'core'")
                && step.contains("CARGO_TARGET_DIR: ${{ github.workspace }}/mcp-server/target")
        );
        assert!(step.contains("cargo test --locked -p nbcad-occt --features native-occt --tests -- --test-threads=1") && !step.contains("continue-on-error:"));
        ordered(
            &config,
            "name: MCP server tests",
            "Native geometry integration regressions",
        );
        ordered(
            &config,
            "Native geometry integration regressions",
            "name: Upload successful demo input",
        );
        if name == "mcp-windows" {
            assert!(
                step.contains("OCCT_ROOT: ${{ steps.occt.outputs.root }}")
                    && step.contains("if ($LASTEXITCODE -ne 0)")
            );
        } else {
            assert!(step.contains("OCCT_ROOT: /usr"));
        }
    }
    for input in [
        "crates/cam/**",
        "crates/help/**",
        "xtask/**",
        ".github/actions/setup-windows-occt/**",
    ] {
        assert_eq!(mcp.matches(&format!("- '{input}'")).count(), 2);
    }
    let config = job(&mcp, "mcp-tests");
    assert!(
        config.contains("needs: mcp-windows\n    if: always()")
            && config.contains("NATIVE_RESULT: ${{ needs.mcp-windows.result }}")
            && config.contains("MCP_PLATFORM: windows")
    );
    assert!(job(&mcp, "mcp-tests-linux").contains("steps: *publish-demo-projects"));
    ordered(
        &config,
        "cargo xtask ci require-platform",
        "actions/download-artifact",
    );
    assert_eq!(config.matches("actions/download-artifact@v4").count(), 3);
    assert!(
        config.contains("cargo xtask ci stage-demo-projects")
            && config
                .contains("name: noBS-CAD-demo-projects-${{ env.MCP_PLATFORM }}-${{ github.sha }}")
    );
    for shard in ["core", "turbine", "vise"] {
        assert!(config.contains(&format!(
            "name: mcp-demo-${{{{ env.MCP_PLATFORM }}}}-{shard}"
        )));
    }
    assert!(!Regex::new(r"run-id:|repository:|github-token:|pattern:")
        .unwrap()
        .is_match(&config));
}

#[test]
fn appimage_keeps_oldest_glibc_and_minimal_host_input_runtime() {
    let desktop = read(".github/workflows/desktop-packages.yml");
    let build = job(&desktop, "build-linux-appimage");
    let verify = job(&desktop, "verify-linux-appimage");
    assert!(
        build.contains("container: ubuntu:22.04")
            && build.contains("cargo xtask package --bundle appimage")
    );
    assert!(build.contains("cargo xtask build-occt --prefix /opt/opencascade"));
    assert!(build.contains("steps.occt_key.outputs.sdk_key"));
    ordered(&build, "Save verified OCCT", "Build and audit the AppImage");
    let cache = read("xtask/src/occt_cache.rs");
    assert!(cache.contains("FREETYPE_LIBRARIES") && cache.contains("CMAKE_CXX_COMPILER_VERSION"));
    assert!(build.contains("GLIBC_2.35 | sort -V | tail -n 1"));
    assert!(
        verify.contains("runs-on: ubuntu-26.04")
            && verify.contains("needs: [classify_changes, build-linux-appimage]")
    );
    for config in [&build, &verify] {
        assert!(config.contains("scripts/verify-linux-viewport.sh") && config.contains("x11"));
    }
    let docker = read("scripts/docker/appimage-ubuntu-22.04.Dockerfile");
    let packages = |text: &str| {
        Regex::new(r"(?m)^ +([a-z0-9][a-z0-9.+-]*) \\")
            .unwrap()
            .captures_iter(text)
            .map(|c| c[1].to_owned())
            .filter(|s| s != "zstd")
            .collect::<Vec<_>>()
    };
    assert_eq!(
        packages(docker.split("rm -rf /var/lib/apt/lists").next().unwrap()),
        packages(build.split("- name: Check out noBS CAD").next().unwrap())
    );
    for runtime in [
        "libegl1",
        "libx11-6",
        "libx11-xcb1",
        "libxcursor1",
        "libxi6",
        "libvulkan1",
        "libwayland-client0",
        "libwayland-cursor0",
        "libwayland-egl1",
        "xclip",
        "xdotool",
    ] {
        assert!(verify.contains(runtime));
    }
    let deb = job(&desktop, "build-linux-ubuntu");
    assert!(deb.contains("cargo xtask package --bundle deb") && !deb.contains(".AppImage"));
    let bundler = read("xtask/src/package/linux.rs");
    let sdk = read(".github/actions/setup-linux-desktop/action.yml");
    for dependency in [
        "libx11-xcb1",
        "libxcursor1",
        "libxi6",
        "libdbus-1-3",
        "zenity",
    ] {
        assert!(
            docker.contains(dependency) && sdk.contains(dependency) && bundler.contains(dependency)
        );
    }
    for library in ["client", "cursor", "egl"] {
        assert!(bundler.contains(&format!("\"libwayland-{library}.so\"")));
    }
    assert!(!bundler.contains("\"libwayland-server.so\""));
}
