//! Read the one product-authored catalog consumed by the ribbon and MCP.
use serde_json::{json, Value};
use std::sync::OnceLock;

pub fn document() -> &'static Value {
    static CATALOG: OnceLock<Value> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../../interface/catalog.json"))
            .expect("The committed product catalog must be valid JSON")
    })
}

/// Preserve the existing MCP group order and shape. Workspace/panel controls
/// and command metadata remain available directly from document().
pub fn groups() -> &'static Vec<Value> {
    static GROUPS: OnceLock<Vec<Value>> = OnceLock::new();
    GROUPS.get_or_init(|| {
        let catalog = document();
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
        .find(|group| {
            group["operations"]
                .as_array()
                .unwrap()
                .iter()
                .any(|name| name == operation)
        })
        .and_then(|group| group["id"].as_str())
}
