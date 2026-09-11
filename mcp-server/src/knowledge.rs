//! Read-only, offline MCP access to the repository's existing OKF Markdown bundle.
use serde_json::{json, Value};

const PREFIX: &str = "nbcad://knowledge/";
include!(concat!(env!("OUT_DIR"), "/knowledge_bundle.rs"));

fn frontmatter<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    let mut lines = text.lines();
    if lines.next()? != "---" {
        return None;
    }
    lines.take_while(|line| *line != "---").find_map(|line| {
        let (name, value) = line.split_once(':')?;
        (name == key).then(|| value.trim())
    })
}

pub(crate) fn list() -> Value {
    let resources: Vec<Value> = DOCUMENTS
        .iter()
        .map(|(path, text)| {
            let title = frontmatter(text, "title")
                .or_else(|| text.lines().find_map(|line| line.strip_prefix("# ")))
                .unwrap_or(path);
            let mut resource = json!({
                "uri": format!("{PREFIX}{path}"),
                "name": path,
                "title": title,
                "mimeType": "text/markdown",
                "size": text.len(),
            });
            if let Some(description) = frontmatter(text, "description") {
                resource["description"] = json!(description);
            }
            resource
        })
        .collect();
    json!({"resources": resources})
}

pub(crate) fn read(uri: &str) -> Option<Value> {
    let path = uri.strip_prefix(PREFIX)?;
    // Exact inventory lookup; never turn a client URI into a filesystem path.
    let (_, text) = DOCUMENTS.iter().find(|(name, _)| *name == path)?;
    Some(json!({"contents": [{"uri": uri, "mimeType": "text/markdown", "text": text}]}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::BTreeMap, fs, path::Path};

    #[test]
    fn knowledge_resources_include_every_repository_markdown_file_unchanged() {
        fn collect(root: &Path, dir: &Path, result: &mut BTreeMap<String, String>) {
            for entry in fs::read_dir(dir).unwrap() {
                let entry = entry.unwrap();
                let kind = entry.file_type().unwrap();
                if kind.is_dir() {
                    collect(root, &entry.path(), result);
                } else if kind.is_file() && entry.path().extension().is_some_and(|ext| ext == "md")
                {
                    result.insert(
                        entry
                            .path()
                            .strip_prefix(root)
                            .unwrap()
                            .to_str()
                            .unwrap()
                            .replace('\\', "/"),
                        fs::read_to_string(entry.path()).unwrap(),
                    );
                }
            }
        }
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../knowledge");
        let mut actual = BTreeMap::new();
        collect(&root, &root, &mut actual);
        let bundled: BTreeMap<_, _> = DOCUMENTS
            .iter()
            .map(|(path, text)| (path.to_string(), text.to_string()))
            .collect();
        assert_eq!(bundled, actual);
    }
}
