use nbcad_plugins::{discover, run, Severity, MANIFEST_FILE};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
    time::Instant,
};

static COUNTER: AtomicUsize = AtomicUsize::new(0);

fn temp_dir(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "nbcad-plugins-{}-{}-{label}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::SeqCst)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn example_manifest(id: &str, extensions: &[&str]) -> Value {
    json!({
        "protocol": 1,
        "id": id,
        "name": "Example plate importer",
        "version": "0.1.0",
        "description": "A JSON plate description becomes a native script.",
        "kind": "import",
        "command": [env!("CARGO_BIN_EXE_nbcad-plugin-example")],
        "input": {"extensions": extensions},
        "options_schema": {"type": "object"},
        "timeout_seconds": 30
    })
}

fn install(root: &Path, dir_name: &str, manifest: &Value) -> PathBuf {
    let dir = root.join(dir_name);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(MANIFEST_FILE), manifest.to_string()).unwrap();
    dir
}

fn plate_input(dir: &Path) -> PathBuf {
    let path = dir.join("plate.json");
    std::fs::write(
        &path,
        json!({"name":"Test plate","width_mm":60,"height_mm":40,"thickness_mm":5,
            "holes":[{"x":-20,"y":-10,"diameter":5},{"x":20,"y":10,"diameter":6.6}]})
        .to_string(),
    )
    .unwrap();
    path
}

#[test]
fn discovery_lists_valid_manifests_and_reports_the_rest() {
    let root = temp_dir("discovery");
    install(&root, "b-second", &example_manifest("second", &["json"]));
    install(&root, "a-first", &example_manifest("first", &["json"]));
    install(&root, "c-duplicate", &example_manifest("first", &["json"]));
    let broken = root.join("d-broken");
    std::fs::create_dir_all(&broken).unwrap();
    std::fs::write(broken.join(MANIFEST_FILE), "{\"protocol\": 1}").unwrap();
    std::fs::create_dir_all(root.join("e-no-manifest")).unwrap();
    let missing = root.join("does-not-exist");

    let discovery = discover(&[root.clone(), missing.clone()]);
    let ids: Vec<&str> = discovery
        .plugins
        .iter()
        .map(|plugin| plugin.manifest.id.as_str())
        .collect();
    assert_eq!(
        ids,
        ["first", "second"],
        "sorted by directory, duplicates skipped"
    );
    assert_eq!(discovery.directories, [root.clone(), missing]);
    assert_eq!(discovery.problems.len(), 2, "{:?}", discovery.problems);
    assert!(discovery
        .problems
        .iter()
        .any(|p| p.contains("duplicate plugin id")));
    assert!(discovery.problems.iter().any(|p| p.contains("d-broken")));
    assert!(discovery
        .find("nope")
        .unwrap_err()
        .contains("installed plugins"));
    let summary = discovery.summary();
    assert_eq!(summary["plugins"][0]["id"], "first");
    assert_eq!(summary["plugins"][0]["kind"], "import");
    assert_eq!(summary["plugins"][0]["timeout_seconds"], 30);
    assert!(
        summary["plugins"][0].get("command").is_none(),
        "commands stay private"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn example_import_plugin_returns_a_validated_script_and_report() {
    let root = temp_dir("import");
    install(&root, "example", &example_manifest("example", &["json"]));
    let input = plate_input(&root);
    let discovery = discover(&[root.clone()]);
    let plugin = discovery.find("example").unwrap();

    let outcome = run(plugin, Some(&input), json!({}), Some(&root)).unwrap();
    assert_eq!(outcome.plugin_id, "example");
    assert!(
        outcome.report.summary.contains("2 through holes"),
        "{}",
        outcome.report.summary
    );
    assert_eq!(outcome.report.flags.len(), 1);
    assert_eq!(outcome.report.flags[0].severity, Severity::Info);
    assert!(outcome.source.contains("\"solid_hole\""));
    assert!(outcome.stderr.is_empty());
    let parsed: Value = serde_json::from_str(&outcome.source).unwrap();
    assert_eq!(parsed["version"], 1);
    assert_eq!(parsed["steps"].as_array().unwrap().len(), 13);
    assert_eq!(outcome.script.metadata()["step_count"], 13);
    assert_eq!(outcome.summary()["id"], "example");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn import_inputs_are_checked_before_the_plugin_starts() {
    let root = temp_dir("inputs");
    install(&root, "example", &example_manifest("example", &["json"]));
    let discovery = discover(&[root.clone()]);
    let plugin = discovery.find("example").unwrap();

    let missing = run(plugin, Some(&root.join("missing.json")), json!({}), None).unwrap_err();
    assert!(missing.contains("missing.json"), "{missing}");
    let wrong = root.join("plate.txt");
    std::fs::write(&wrong, "{}").unwrap();
    let extension = run(plugin, Some(&wrong), json!({}), None).unwrap_err();
    assert!(extension.contains("accepts"), "{extension}");
    let none = run(plugin, None, json!({}), None).unwrap_err();
    assert!(none.contains("needs an input file"), "{none}");
    let relative = run(plugin, Some(Path::new("plate.json")), json!({}), None).unwrap_err();
    assert!(relative.contains("absolute"), "{relative}");
    let input = plate_input(&root);
    let options = run(plugin, Some(&input), json!([]), None).unwrap_err();
    assert!(options.contains("JSON object"), "{options}");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn plugin_failures_are_reported_with_their_message() {
    let root = temp_dir("failures");
    install(&root, "example", &example_manifest("example", &["json"]));
    let input = plate_input(&root);
    let discovery = discover(&[root.clone()]);
    let plugin = discovery.find("example").unwrap();

    let failed = run(plugin, Some(&input), json!({"fail": true}), None).unwrap_err();
    assert!(failed.contains("failure requested by options"), "{failed}");
    assert!(failed.contains("stderr: failing because"), "{failed}");
    let garbage = run(plugin, Some(&input), json!({"garbage": true}), None).unwrap_err();
    assert!(garbage.contains("invalid JSON"), "{garbage}");
    let invalid = run(plugin, Some(&input), json!({"invalid_script": true}), None).unwrap_err();
    assert!(invalid.contains("invalid script"), "{invalid}");
    let unreadable = root.join("empty.json");
    std::fs::write(&unreadable, "not json").unwrap();
    let bad_input = run(plugin, Some(&unreadable), json!({}), None).unwrap_err();
    assert!(
        bad_input.contains("cannot read plate description"),
        "{bad_input}"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_slow_plugin_is_killed_at_its_timeout() {
    let root = temp_dir("timeout");
    let mut manifest = example_manifest("slow", &["json"]);
    manifest["timeout_seconds"] = json!(1);
    install(&root, "slow", &manifest);
    let input = plate_input(&root);
    let discovery = discover(&[root.clone()]);
    let plugin = discovery.find("slow").unwrap();

    let started = Instant::now();
    let error = run(plugin, Some(&input), json!({"sleep_ms": 20000}), None).unwrap_err();
    assert!(error.contains("timed out after 1 s"), "{error}");
    assert!(
        started.elapsed().as_secs() < 10,
        "the plugin was not killed promptly"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_missing_program_is_a_clear_error() {
    let root = temp_dir("missing-program");
    let mut manifest = example_manifest("ghost", &["json"]);
    manifest["command"] = json!(["./no-such-program"]);
    install(&root, "ghost", &manifest);
    let input = plate_input(&root);
    let discovery = discover(&[root.clone()]);
    let error = run(
        discovery.find("ghost").unwrap(),
        Some(&input),
        json!({}),
        None,
    )
    .unwrap_err();
    assert!(error.contains("cannot start"), "{error}");
    let _ = std::fs::remove_dir_all(root);
}
