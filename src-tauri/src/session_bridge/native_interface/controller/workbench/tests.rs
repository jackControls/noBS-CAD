use super::*;
use crate::session_bridge::native_interface::tests::Fixture;
mod workspace;

#[test]
fn workbench_history_epoch_keeps_workspace_but_retires_transient_state() {
    let original = DocumentContext { window_id: "main".into(), document_id: "tab-a".into(), epoch: 1 };
    let mut workbench = Workbench {
        owner: Some(original.clone()), workspace: Workspace::Cam,
        menu: Some("workspace".into()), navigation: NavigationTool::Pan,
        paper_labels: vec![drawing_paper::Label { text: "stale".into(), ..default() }],
        ..default()
    };
    let restored = DocumentContext { epoch: 2, ..original.clone() };
    workbench.refresh_owner(&restored);
    assert_eq!(workbench.workspace, Workspace::Cam);
    assert_eq!(workbench.owner.as_ref(), Some(&restored));
    assert!(workbench.menu.is_none());
    assert_eq!(workbench.navigation, NavigationTool::Select);
    assert!(workbench.paper_key.is_none() && workbench.paper_labels.is_empty());
    workbench.refresh_owner(&DocumentContext { document_id: "tab-b".into(), ..restored });
    assert_eq!(workbench.workspace, Workspace::Solid);
}

#[test]
fn native_ribbon_menus_retain_disabled_commands_and_navigation_toggles() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let services = NativeServices {
        engine: fixture.engine.clone(),
        bridge: fixture.bridge.clone(),
    };
    let mut app = native_viewport::interface_scene_fixture();
    let world = app.world_mut();
    world.init_resource::<Assets<Image>>();
    world.init_resource::<ViewportUiAssets>();
    let camera = world.spawn(InterfaceCamera).id();
    let create_sketch = world.spawn((Node::default(), InterfaceControl::button("sketch/create", "Create Sketch"))).id();
    bind_command(world, create_sketch, NativeCommand::Sketch(crate::native_editor::EditorCommand::Support(
        crate::native_editor::support::Command::Start,
    ))).unwrap();
    let owner = fixture.owner();
    let mut state = Workbench::default();
    state.widgets.begin();
    ribbon_menu::synchronize(
        world,
        camera,
        &HashMap::new(),
        1200.,
        false,
        &services,
        &mut state,
    )
    .unwrap();
    world.insert_resource(state);
    execute(world, &Command::Menu("refine".into())).unwrap();
    assert_eq!(modal(world), Some("workbench-menu"));
    let mut state = world.remove_resource::<Workbench>().unwrap();
    state.widgets.begin();
    ribbon_menu::synchronize(
        world,
        camera,
        &HashMap::new(),
        1200.,
        false,
        &services,
        &mut state,
    )
    .unwrap();
    let draft = world
        .query::<&InterfaceControl>()
        .iter(world)
        .find(|c| c.label == "Draft")
        .unwrap();
    assert!(draft.disabled);
    assert_eq!(draft.role, "menuitem");
    assert_eq!(draft.modal_scope.as_deref(), Some("workbench-menu"));
    state.owner = Some(owner.clone());
    world.insert_resource(state);
    escape(world);
    assert_eq!(modal(world), None);
    execute(world, &Command::Menu("workspace".into())).unwrap();
    let mut state = world.remove_resource::<Workbench>().unwrap();
    state.widgets.begin();
    ribbon_menu::synchronize(
        world,
        camera,
        &HashMap::new(),
        1200.,
        false,
        &services,
        &mut state,
    )
    .unwrap();
    let drawing = world
        .query::<&InterfaceControl>()
        .iter(world)
        .find(|c| c.label == "Drawing")
        .unwrap();
    assert!(!drawing.disabled);
    assert_eq!(drawing.role, "menuitem");
    let cam = world
        .query::<&InterfaceControl>()
        .iter(world)
        .find(|c| c.label == "Manufacture")
        .unwrap();
    assert!(!cam.disabled);
    world.insert_resource(state);
    execute(world, &Command::Workspace(Workspace::Drawing)).unwrap();
    assert_eq!(workspace(world), Workspace::Drawing);
    let mut state = world.remove_resource::<Workbench>().unwrap();
    state.widgets.begin();
    ribbon_menu::synchronize(
        world,
        camera,
        &HashMap::new(),
        1200.,
        false,
        &services,
        &mut state,
    )
    .unwrap();
    let sheet = world
        .query::<&InterfaceControl>()
        .iter(world)
        .find(|c| c.label == "New Sheet")
        .unwrap();
    assert!(!sheet.disabled);
    assert!(!world.get::<InterfaceControl>(create_sketch).unwrap().visible);
    let delete = world
        .query::<&InterfaceControl>()
        .iter(world)
        .find(|c| c.label == "Delete sheet")
        .unwrap();
    assert!(delete.disabled);
    let status = world
        .query::<&InterfaceControl>()
        .iter(world)
        .find(|c| c.label == "No sheet")
        .unwrap();
    assert!(status.disabled);
    let front = world
        .query::<&InterfaceControl>()
        .iter(world)
        .find(|c| c.label == "Front View")
        .unwrap();
    assert!(front.disabled);
    let iso = world
        .query::<&InterfaceControl>()
        .iter(world)
        .find(|c| c.label == "Isometric")
        .unwrap();
    assert!(iso.disabled);
    let note = world
        .query::<&InterfaceControl>()
        .iter(world)
        .find(|c| c.label == "Note")
        .unwrap();
    assert!(note.disabled);
    state.workspace = Workspace::Cam;
    world.get_mut::<InterfaceControl>(create_sketch).unwrap().visible = true;
    ribbon_menu::synchronize(world, camera, &HashMap::new(), 1200., false, &services, &mut state).unwrap();
    assert!(!world.get::<InterfaceControl>(create_sketch).unwrap().visible);
    world.insert_resource(state);
    execute(world, &Command::Navigation(NavigationTool::Pan)).unwrap();
    assert_eq!(navigation(world), NavigationTool::Pan);
    execute(world, &Command::Navigation(NavigationTool::Pan)).unwrap();
    assert_eq!(navigation(world), NavigationTool::Select);
}
