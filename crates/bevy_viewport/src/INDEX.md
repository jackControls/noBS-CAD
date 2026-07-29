# Index — `crates/bevy_viewport/src`

| Module | File | Responsibility |
|--------|------|----------------|
| crate root | [lib.rs](lib.rs) | Public API + smoke tests |
| `soup` | [soup.rs](soup.rs) | Host-neutral `TessellatedTriangleSoup` |
| `backend` | [backend.rs](backend.rs) | `ViewportBackend` trait + Bevy impl |
| `app` | [app.rs](app.rs) | `App` plugins, resources, schedules |
| `scene` | [scene.rs](scene.rs) | Startup spawn (mesh, lights, HUD) |
| `camera` | [camera.rs](camera.rs) | Orbit / zoom (+ look-at unit test) |
| `picking` | [picking.rs](picking.rs) | Pointer observers, gizmos, status text |
| `mesh_convert` | [mesh_convert.rs](mesh_convert.rs) | Soup → Bevy `Mesh` |
| binary | [bin/bevy_desktop.rs](bin/bevy_desktop.rs) | Shared desktop/wasm entry |

Parent: [../INDEX.md](../INDEX.md).
