use std::{env, fs, path::Path};

fn markdown_files(root: &Path, directory: &Path, files: &mut Vec<String>) {
    for entry in fs::read_dir(directory).expect("read knowledge directory") {
        let entry = entry.expect("read knowledge entry");
        let kind = entry.file_type().expect("read knowledge file type");
        if kind.is_dir() {
            markdown_files(root, &entry.path(), files);
        } else if kind.is_file() && entry.path().extension().is_some_and(|ext| ext == "md") {
            files.push(
                entry
                    .path()
                    .strip_prefix(root)
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .replace('\\', "/"),
            );
        }
    }
}

fn main() {
    let root = Path::new(&env::var("CARGO_MANIFEST_DIR").unwrap()).join("../knowledge");
    // Watch directories as well as files so adding or removing a concept rebuilds the inventory.
    println!("cargo:rerun-if-changed={}", root.display());
    let mut files = Vec::new();
    markdown_files(&root, &root, &mut files);
    files.sort();
    assert!(!files.is_empty(), "knowledge bundle must not be empty");
    let mut generated = String::from("const DOCUMENTS: &[(&str, &str)] = &[\n");
    for relative in files {
        let path = root
            .join(&relative)
            .canonicalize()
            .expect("resolve knowledge file");
        generated.push_str(&format!(
            "    ({relative:?}, include_str!({:?})),\n",
            path.to_str().unwrap()
        ));
    }
    generated.push_str("];\n");
    fs::write(
        Path::new(&env::var("OUT_DIR").unwrap()).join("knowledge_bundle.rs"),
        generated,
    )
    .expect("write embedded knowledge inventory");
}
