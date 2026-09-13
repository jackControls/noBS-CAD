use super::super::tests::Fixture;
use super::*;
use std::fs;

fn metadata() -> SaveMetadata<'static> {
    SaveMetadata {
        application_version: "test",
        saved_at: "2026-09-13T00:00:00.000Z",
    }
}
fn path(name: &str) -> PathBuf {
    let path = crate::session_bridge::session_root().join("workspace-files");
    fs::create_dir_all(&path).unwrap();
    path.join(name)
}
fn observe(workspace: &mut DocumentWorkspace, fixture: &Fixture) -> DocumentReceipt {
    workspace
        .observe(&fixture.bridge, &fixture.engine, "main")
        .unwrap()
}

#[test]
fn save_completion_stays_with_its_source_tab_and_keeps_later_edits_dirty() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let mut workspace = DocumentWorkspace::default();
    let first = observe(&mut workspace, &fixture);
    fixture.rename(&first.owner, "Source A").unwrap();
    let capture = observe(&mut workspace, &fixture);
    let saved_path = path("source-a.nbcad");
    let save = workspace
        .prepare_save(
            &fixture.bridge,
            &fixture.engine,
            &capture,
            saved_path.clone(),
            false,
            metadata(),
        )
        .unwrap();
    fixture
        .rename(&capture.owner, "A changed during Save")
        .unwrap();
    let changed = observe(&mut workspace, &fixture);
    let second = workspace
        .new_tab(&fixture.bridge, &fixture.engine, &changed)
        .unwrap();
    fixture.rename(&second.owner, "Source B").unwrap();
    let second = observe(&mut workspace, &fixture);
    workspace
        .complete_save(&fixture.bridge, save.write())
        .unwrap();
    assert_eq!(fixture.engine.document_snapshot().name, "Source B");
    let summaries = workspace.summaries(&fixture.bridge, &second.owner).unwrap();
    let a = summaries
        .iter()
        .find(|tab| tab.owner == capture.owner)
        .unwrap();
    let b = summaries
        .iter()
        .find(|tab| tab.owner == second.owner)
        .unwrap();
    assert_eq!(a.path.as_ref(), Some(&saved_path));
    assert!(a.dirty);
    assert!(!a.active);
    assert!(b.path.is_none());
    assert!(b.dirty);
    assert!(b.active);
    let archive = ProjectArchive::decode(fs::read(saved_path).unwrap()).unwrap();
    let saved: serde_json::Value = serde_json::from_str(archive.model_json()).unwrap();
    assert_eq!(saved["document"]["name"], "Source A");
}

#[test]
fn failed_or_cancelled_save_preserves_destination_metadata_and_releases_its_lease() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let mut workspace = DocumentWorkspace::default();
    let owner = observe(&mut workspace, &fixture);
    fixture.rename(&owner.owner, "Unsaved work").unwrap();
    let owner = observe(&mut workspace, &fixture);
    let folder = path("cannot-replace.nbcad");
    fs::create_dir(&folder).unwrap();
    let cancelled = workspace
        .prepare_save(
            &fixture.bridge,
            &fixture.engine,
            &owner,
            folder.clone(),
            true,
            metadata(),
        )
        .unwrap();
    assert!(workspace
        .prepare_save(
            &fixture.bridge,
            &fixture.engine,
            &owner,
            path("second.nbcad"),
            false,
            metadata()
        )
        .is_err());
    drop(cancelled);
    let work = workspace
        .prepare_save(
            &fixture.bridge,
            &fixture.engine,
            &owner,
            folder,
            true,
            metadata(),
        )
        .unwrap();
    assert!(workspace
        .complete_save(&fixture.bridge, work.write())
        .is_err());
    let tab = &workspace.summaries(&fixture.bridge, &owner.owner).unwrap()[0];
    assert!(tab.path.is_none());
    assert!(tab.dirty);
    assert!(!tab.saving);
    let work = workspace
        .prepare_save(
            &fixture.bridge,
            &fixture.engine,
            &owner,
            path("good.nbcad"),
            false,
            metadata(),
        )
        .unwrap();
    workspace
        .complete_save(&fixture.bridge, work.write())
        .unwrap();
    assert!(!workspace.summaries(&fixture.bridge, &owner.owner).unwrap()[0].dirty);
}

#[test]
fn delayed_save_cannot_adopt_a_path_or_clean_a_same_tab_replacement() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let mut workspace = DocumentWorkspace::default();
    let owner = observe(&mut workspace, &fixture);
    let work = workspace
        .prepare_save(
            &fixture.bridge,
            &fixture.engine,
            &owner,
            path("old-document.nbcad"),
            false,
            metadata(),
        )
        .unwrap();
    fixture
        .bridge
        .apply_native_mutation(
            &fixture.engine,
            &owner.owner,
            "cad_new_project",
            &json!({}),
            || Ok(()),
        )
        .unwrap();
    // Complete before observe, so the check must consult authoritative owner
    // state rather than trusting the workspace's last-seen tab metadata.
    assert!(workspace
        .complete_save(&fixture.bridge, work.write())
        .is_err());
    let replacement = observe(&mut workspace, &fixture);
    let tab = &workspace
        .summaries(&fixture.bridge, &replacement.owner)
        .unwrap()[0];
    assert!(tab.path.is_none());
    assert!(tab.dirty);
}

#[test]
fn new_tabs_retain_independent_engines_and_close_requires_the_exact_dirty_owner() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let mut workspace = DocumentWorkspace::default();
    let a = observe(&mut workspace, &fixture);
    fixture.rename(&a.owner, "Retained A").unwrap();
    let a = observe(&mut workspace, &fixture);
    let b = workspace
        .new_tab(&fixture.bridge, &fixture.engine, &a)
        .unwrap();
    fixture.rename(&b.owner, "Retained B").unwrap();
    let b = observe(&mut workspace, &fixture);
    let a = workspace
        .activate(&fixture.bridge, &fixture.engine, &b, &a.owner)
        .unwrap();
    assert_eq!(fixture.engine.document_snapshot().name, "Retained A");
    assert!(workspace
        .close_active(&fixture.bridge, &fixture.engine, &a, false)
        .is_err());
    fixture
        .rename(&a.owner, "A changed after confirmation")
        .unwrap();
    assert!(workspace
        .close_active(&fixture.bridge, &fixture.engine, &a, true)
        .is_err());
    let a = observe(&mut workspace, &fixture);
    let b = workspace
        .close_active(&fixture.bridge, &fixture.engine, &a, true)
        .unwrap();
    assert_eq!(fixture.engine.document_snapshot().name, "Retained B");
    let blank = workspace
        .close_active(&fixture.bridge, &fixture.engine, &b, true)
        .unwrap();
    assert_eq!(workspace.tabs.len(), 1);
    assert_eq!(fixture.engine.document_snapshot().name, "Untitled");
    assert!(!workspace.summaries(&fixture.bridge, &blank.owner).unwrap()[0].dirty);
}

#[test]
fn rejected_open_keeps_current_model_path_and_incarnation_then_valid_open_replaces_them() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let mut workspace = DocumentWorkspace::default();
    let owner = observe(&mut workspace, &fixture);
    let good_path = path("source.nbcad");
    let work = workspace
        .prepare_save(
            &fixture.bridge,
            &fixture.engine,
            &owner,
            good_path.clone(),
            false,
            metadata(),
        )
        .unwrap();
    workspace
        .complete_save(&fixture.bridge, work.write())
        .unwrap();
    fixture.rename(&owner.owner, "Valuable local work").unwrap();
    let changed = observe(&mut workspace, &fixture);
    assert!(workspace
        .open(
            &fixture.bridge,
            &fixture.engine,
            &changed,
            good_path.clone(),
            false
        )
        .is_err());
    let mut unsupported: serde_json::Value = serde_json::from_str(
        parse_engine_envelope(fixture.engine.engine_call("project_export_model", ""))
            .unwrap()
            .as_str()
            .unwrap(),
    )
    .unwrap();
    unsupported["schema_version"] = json!(9999);
    let invalid = ProjectArchive::new(unsupported.to_string(), metadata()).unwrap();
    let invalid_path = path("unsupported.nbcad");
    fs::write(&invalid_path, invalid.encode().unwrap()).unwrap();
    assert!(workspace
        .open(
            &fixture.bridge,
            &fixture.engine,
            &changed,
            invalid_path,
            true
        )
        .is_err());
    assert_eq!(fixture.owner(), changed.owner);
    assert_eq!(
        fixture.engine.document_snapshot().name,
        "Valuable local work"
    );
    assert_eq!(workspace.tabs[0].path.as_ref(), Some(&good_path));
    let opened = workspace
        .open(&fixture.bridge, &fixture.engine, &changed, good_path, true)
        .unwrap();
    assert_ne!(opened.context, changed.owner);
    assert_eq!(fixture.engine.document_snapshot().name, "Untitled");
    assert!(
        !workspace
            .summaries(&fixture.bridge, &opened.context)
            .unwrap()[0]
            .dirty
    );
}
