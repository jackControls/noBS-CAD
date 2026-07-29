# Index — `crates/bevy_viewport/src`

| Module | File | Responsibility |
|--------|------|----------------|
| crate root | [lib.rs](lib.rs) | Public API + smoke tests |
| `soup` | [soup.rs](soup.rs) | Host-neutral `TessellatedTriangleSoup` |
| `backend` | [backend.rs](backend.rs) | `ViewportBackend` trait + Bevy impl |
| `cad_session` | [cad_session.rs](cad_session.rs) | Rust bridge resource (mode / appearance / selection) |
| `ui` | [ui.rs](ui.rs) | Feathers ports: mode, appearance, selection |
| `app` | [app.rs](app.rs) | `App` plugins, resources, schedules |
| `scene` | [scene.rs](scene.rs) | Startup spawn (mesh, lights) |
| `camera` | [camera.rs](camera.rs) | Orbit / zoom (+ look-at unit test) |
| `picking` | [picking.rs](picking.rs) | Pointer observers → CadSession |
| `mesh_convert` | [mesh_convert.rs](mesh_convert.rs) | Soup → Bevy `Mesh` |
| binary | [bin/bevy_desktop.rs](bin/bevy_desktop.rs) | Shared desktop/experimental entry |

Parent: [../INDEX.md](../INDEX.md).
