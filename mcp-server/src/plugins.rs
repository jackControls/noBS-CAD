//! Installed out-of-process plugins reach the product through the ordinary
//! script path: a plugin returns a version 1 script and never touches the
//! kernel, the document or the session.
use serde_json::{json, Value};
use std::path::Path;

/// `cad_interface` action `plugins`.
pub fn list() -> Value {
    nbcad_plugins::discover_default().summary()
}

/// Run one installed plugin and validate its returned script against the
/// product catalog. Whether the script then executes is the caller's decision.
pub fn import(arguments: &Value) -> Result<nbcad_plugins::Outcome, String> {
    let id = arguments
        .get("plugin")
        .and_then(Value::as_str)
        .ok_or("plugin requires a plugin id string; list IDs with action plugins")?;
    let discovery = nbcad_plugins::discover_default();
    let plugin = discovery.find(id)?;
    let input = match arguments.get("input") {
        None | Some(Value::Null) => None,
        Some(Value::String(path)) => Some(Path::new(path)),
        Some(_) => return Err("plugin input must be an absolute file path string".into()),
    };
    let options = match arguments.get("options") {
        None | Some(Value::Null) => json!({}),
        Some(options) if options.is_object() => options.clone(),
        Some(_) => return Err("plugin options must be an object".into()),
    };
    let outcome = nbcad_plugins::run(plugin, input, options, None)?;
    crate::interface::validate_script(&outcome.script)?;
    Ok(outcome)
}
