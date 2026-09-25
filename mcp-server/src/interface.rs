use serde_json::{json, Value};
use std::sync::OnceLock;

use nbcad_script::MAX_SCRIPT_BYTES;

/// Load an authored text script, never executable code or a model snapshot.
pub fn script_source(arguments: &Value) -> Result<String, String> {
    let recipe = arguments.get("recipe");
    let source = arguments.get("source");
    let path = arguments.get("path");
    let present = [recipe, source, path]
        .into_iter()
        .filter(|v| v.is_some())
        .count();
    if present != 1 {
        return Err("script requires exactly one of recipe, source or path".into());
    }
    if let Some(recipe) = recipe {
        let id = recipe.as_str().ok_or("recipe must be an ID string")?;
        let recipe = nbcad_recipes::find(id)?;
        let text: String = recipe.source.into();
        if nbcad_script::has_unresolved_includes(&text)? {
            return Err(format!(
                "bundled recipe {id} has unresolved includes; flatten at catalog build time"
            ));
        }
        return Ok(text);
    }
    let (source, root_path): (String, Option<&std::path::Path>) = match (source, path) {
        (Some(source), None) => (
            source
                .as_str()
                .ok_or("script source must be text")?
                .to_owned(),
            None,
        ),
        (None, Some(path)) => {
            let path = path.as_str().ok_or("script path must be a string")?;
            let file = std::path::Path::new(path);
            if !file.is_absolute() || !path.to_lowercase().ends_with(".nbcad.jsonc") {
                return Err("script path must be an absolute .nbcad.jsonc file path".into());
            }
            let metadata =
                std::fs::metadata(file).map_err(|e| format!("read script {path}: {e}"))?;
            if !metadata.is_file() || metadata.len() > MAX_SCRIPT_BYTES as u64 {
                return Err("script must be a regular file no larger than 16 MiB".into());
            }
            let text =
                std::fs::read_to_string(file).map_err(|e| format!("read script {path}: {e}"))?;
            (text, Some(file))
        }
        _ => return Err("script requires exactly one of source or path".into()),
    };
    if source.len() > MAX_SCRIPT_BYTES {
        return Err("script exceeds 16 MiB".into());
    }
    expand_includes_if_needed(&source, root_path)
}

fn expand_includes_if_needed(
    source: &str,
    root_path: Option<&std::path::Path>,
) -> Result<String, String> {
    if !nbcad_script::has_unresolved_includes(source)? {
        return Ok(source.to_owned());
    }
    let root_path = root_path.ok_or(
        "Scripts with includes require an absolute path root so collections can be loaded",
    )?;
    let base = root_path
        .parent()
        .ok_or("script path has no parent directory")?;
    let base_canon = std::fs::canonicalize(base)
        .map_err(|e| format!("canonicalize script base {}: {e}", base.display()))?;

    nbcad_script::flatten_includes(source, |rel| {
        nbcad_script::validate_include_path(rel)?;
        let joined = base.join(rel);
        let canon =
            std::fs::canonicalize(&joined).map_err(|e| format!("read include {rel}: {e}"))?;
        if !canon.starts_with(&base_canon) {
            return Err(format!("include {rel} escapes script base directory"));
        }
        if !canon.is_file() {
            return Err(format!("include {rel} is not a file"));
        }
        let meta = std::fs::metadata(&canon).map_err(|e| e.to_string())?;
        if meta.len() > MAX_SCRIPT_BYTES as u64 {
            return Err(format!("include {rel} exceeds 16 MiB"));
        }
        std::fs::read_to_string(&canon).map_err(|e| format!("read include {rel}: {e}"))
    })
}

/// The renderer and API consume the same product-owned grouping data.
pub fn groups() -> &'static Vec<Value> {
    static GROUPS: OnceLock<Vec<Value>> = OnceLock::new();
    GROUPS.get_or_init(|| {
        let catalog: Value = serde_json::from_str(include_str!("../../interface/catalog.json")).unwrap();
        let mut groups = catalog["groups"].as_array().unwrap().clone();
        for workspace in catalog["workspaces"].as_array().unwrap() {
            for panel in workspace["panels"].as_array().unwrap() {
                groups.push(json!({"id":format!("{}/{}",workspace["id"].as_str().unwrap(),panel["id"].as_str().unwrap()),
                    "labelKey":panel["labelKey"],"operations":panel["operations"]}));
            }
        }
        groups
    })
}

pub fn group_for(operation: &str) -> Option<&'static str> {
    groups()
        .iter()
        .find(|g| {
            g["operations"]
                .as_array()
                .unwrap()
                .iter()
                .any(|n| n == operation)
        })
        .and_then(|g| g["id"].as_str())
}

pub fn validate_script(script: &nbcad_script::Script) -> Result<(), String> {
    script.validate_calls(|group, operation| match group_for(operation) {
        Some(expected) if group == expected => Ok(()),
        Some(expected) => Err(format!("{operation} belongs to {expected}, not {group}")),
        None => Err(format!("Unknown interface operation {operation}")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_recipe_calls_preflight_against_the_product_catalog() {
        for recipe in nbcad_recipes::RECIPES {
            let script = nbcad_script::Script::parse(recipe.source).unwrap();
            validate_script(&script).unwrap_or_else(|error| panic!("{}: {error}", recipe.id));
        }
        let script = nbcad_script::Script::parse(r#"{"version":1,"name":"wrong late group","steps":[{"note":"No geometry should run"}],"checks":[{"id":"late_inspection","call":{"group":"solid/inspect","operation":"solid_scene","arguments":{}}}]}"#).unwrap();
        let error = validate_script(&script).unwrap_err();
        assert!(
            error.contains("late_inspection") && error.contains("solid/check"),
            "{error}"
        );
    }

    #[test]
    fn script_source_requires_one_explicit_text_source() {
        assert_eq!(
            script_source(&json!({"source":"// readable\n{}"})).unwrap(),
            "// readable\n{}"
        );
        for args in [
            json!({}),
            json!({"source":1}),
            json!({"recipe":1}),
            json!({"recipe":"not-a-recipe"}),
            json!({"recipe":"mounting-plate","source":"{}"}),
            json!({"recipe":"mounting-plate","path":"/part.nbcad.jsonc"}),
            json!({"source":"{}","path":"a.nbcad.jsonc"}),
            json!({"path":"relative.nbcad.jsonc"}),
            json!({"source":"x".repeat(MAX_SCRIPT_BYTES+1)}),
        ] {
            assert!(script_source(&args).is_err());
        }
    }
}
