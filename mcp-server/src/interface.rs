use serde_json::{json, Value};
use std::sync::OnceLock;

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
