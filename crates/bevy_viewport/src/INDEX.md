# Index — `crates/bevy_viewport/src`

| Module | File | Responsibility |
|--------|------|----------------|
| crate root | [lib.rs](lib.rs) | Public API + smoke tests |
| `soup` | [soup.rs](soup.rs) | Host-neutral `TessellatedTriangleSoup` |
| `backend` | [backend.rs](backend.rs) | `ViewportBackend` trait + Bevy impl |
| `app` | [app.rs](app.rs) | Plugin registration only |
| `shell` | [shell.rs](shell.rs) | Window / DefaultPlugins / Esc quit |
| `session` | [session.rs](session.rs) | `CadMode` States + `CadSession` + commands |
| `viewport_mesh` | [viewport_mesh.rs](viewport_mesh.rs) | Soup → mesh, solid fixture, reference grid |
| `camera_ctrl` | [camera_ctrl.rs](camera_ctrl.rs) | Orbit + per-mode bookmarks; scroll = zoom |
| `picking_bridge` | [picking_bridge.rs](picking_bridge.rs) | Mesh picks → selection messages |
| `chrome_ui` | [chrome_ui.rs](chrome_ui.rs) | Feathers product chrome |
| `input_map` | [input_map.rs](input_map.rs) | Mode / sim hotkeys |
| `sim` | [sim/](sim/) | Virtual + Fixed structural mock |
| `mesh_convert` | [mesh_convert.rs](mesh_convert.rs) | Soup → Bevy `Mesh` |
| binary | [bin/bevy_desktop.rs](bin/bevy_desktop.rs) | Shared desktop/experimental entry |

Parent: [../INDEX.md](../INDEX.md).
