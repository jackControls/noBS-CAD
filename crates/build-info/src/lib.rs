//! One compiled identity for the desktop and its embedded/standalone MCP.
#[derive(Clone, Debug, serde::Serialize)]
pub struct BuildInfo {
    pub version: &'static str,
    pub revision: &'static str,
    pub channel: &'static str,
    pub modified: bool,
}

pub fn build_info() -> BuildInfo {
    BuildInfo {
        version: env!("CARGO_PKG_VERSION"),
        revision: env!("NBCAD_BUILD_REVISION"),
        channel: env!("NBCAD_BUILD_CHANNEL"),
        modified: env!("NBCAD_BUILD_MODIFIED") == "true",
    }
}

impl BuildInfo {
    pub fn display_version(&self) -> String {
        format!(
            "{}+{}{}",
            self.version,
            self.revision,
            if self.modified { ".modified" } else { "" }
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_version_keeps_the_full_revision_and_modified_marker() {
        let mut info = BuildInfo {
            version: "0.1.0",
            revision: "abcdef0123456789abcdef0123456789abcdef01",
            channel: "preview",
            modified: false,
        };
        assert_eq!(info.display_version(), format!("0.1.0+{}", info.revision));
        info.modified = true;
        assert_eq!(
            info.display_version(),
            format!("0.1.0+{}.modified", info.revision)
        );
    }
}

#[cfg(test)]
mod version_carriers {
    /// `BuildInfo::version` is the product version the desktop About dialog and
    /// the MCP `initialize` result report, so the manifest that carries it must
    /// agree with the repository's product version. This crate was split out of
    /// the engine workspace to keep source identity from invalidating the CAD
    /// dependency graph; a rebase that keeps this manifest at its old `0.1.0`
    /// while `package.json` moves to `0.2.0` would silently report the wrong
    /// version on both surfaces. Fail loudly instead of shipping it.
    #[test]
    fn packaged_version_matches_the_product_version() {
        let manifest: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../package.json"
        )))
        .expect("package.json must be valid JSON");
        let declared = manifest["version"]
            .as_str()
            .expect("package.json must declare a version");
        assert_eq!(
            env!("CARGO_PKG_VERSION"),
            declared,
            "nbcad-build-info must carry the product version; keep crates/build-info/Cargo.toml \
             in step with package.json"
        );
    }
}

// Build scripts do not participate in Cargo's test harness automatically.
// Include the same implementation so ordinary core CI exercises its Git and
// worktree regression tests without a native CAD build.
#[cfg(test)]
#[allow(dead_code)]
mod build_script_tests {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/build.rs"));
}
