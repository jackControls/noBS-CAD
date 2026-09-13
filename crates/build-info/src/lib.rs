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

// Build scripts do not participate in Cargo's test harness automatically.
// Include the same implementation so ordinary core CI exercises its Git and
// worktree regression tests without a native CAD build.
#[cfg(test)]
#[allow(dead_code)]
mod build_script_tests {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/build.rs"));
}
