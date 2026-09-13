//! Window selection is independent of the always-available stdio transport.
use std::ffi::OsString;

pub const USAGE: &str = "Usage: noBS CAD [--headless | nbcad://recipe/ID]\n\
    With no arguments, open the desktop with local stdio MCP available.\n\
    --headless runs the same MCP interface without a window.\n\
    A recipe URL opens editable source for review; it does not run it.";

#[derive(Debug, PartialEq, Eq)]
pub enum Startup {
    Desktop,
    Recipe(&'static str),
    Headless,
    Help,
}

pub fn parse(arguments: impl IntoIterator<Item = OsString>) -> Result<Startup, String> {
    let mut arguments = arguments.into_iter();
    let Some(first) = arguments.next() else {
        return Ok(Startup::Desktop);
    };
    if arguments.next().is_some() {
        return Err(format!("Expected at most one argument.\n{USAGE}"));
    }
    match first.to_str() {
        Some("--headless") => Ok(Startup::Headless),
        Some("--help" | "-h") => Ok(Startup::Help),
        Some("--mcp") => Err(format!(
            "Stdio MCP is always enabled. Replace --mcp with --headless to run without a window.\n{USAGE}"
        )),
        Some(uri) if uri.starts_with("nbcad:") => {
            nbcad_mcp::recipe_id_from_uri(uri).map(Startup::Recipe)
        }
        _ => Err(format!("Unrecognized argument.\n{USAGE}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(arguments: &[&str]) -> Result<Startup, String> {
        parse(arguments.iter().map(OsString::from))
    }

    #[test]
    fn only_headless_suppresses_the_desktop() {
        assert_eq!(args(&[]), Ok(Startup::Desktop));
        assert_eq!(args(&["--headless"]), Ok(Startup::Headless));
        assert_eq!(args(&["--help"]), Ok(Startup::Help));
        assert!(args(&["--mcp"]).unwrap_err().contains("--headless"));
        assert!(args(&["--headless", "nbcad://recipe/fillet-basics"]).is_err());
        assert!(args(&["nbcad://recipe/fillet-basics", "--headless"]).is_err());
        assert!(args(&["--headless", "--headless"]).is_err());
        assert!(args(&["--unknown"]).is_err());
    }

    #[test]
    fn recipe_launches_keep_the_installed_source_contract() {
        assert_eq!(
            args(&["nbcad://recipe/fillet-basics"]),
            Ok(Startup::Recipe("fillet-basics"))
        );
        assert!(args(&["nbcad://recipe/fillet-basics?run=true"]).is_err());
        assert!(args(&["nbcad://recipe/not-installed"]).is_err());
        assert!(args(&["nbcad://recipe/fillet-basics", "extra"]).is_err());
    }
}
