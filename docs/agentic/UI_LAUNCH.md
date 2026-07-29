# Headless MCP + optional desktop UI

**Audience:** humans and agents driving noBS CAD through MCP.

## The short answer

| Mode | How | UI? |
|------|-----|-----|
| **Headless (default)** | Client runs `nbcad-mcp` over stdio | No |
| **With UI** | MCP calls `cad_launch_ui` (or you start the app yourself) | Yes |
| **Co-link** | UI publishes sessions; MCP `cad_list_sessions` → `cad_attach` | Shared via **files**, not live memory |

MCP does **not** replace the kernel when the UI is open. Each process has its own engine until a deeper live co-link lands (backlog / #11).

---

## Start without UI (already works)

1. Install MCP: `cargo run -p xtask -- install-mcp`
2. Use modeling tools directly (`sketch_begin`, `solid_extrude`, …).
3. Export with `solid_export_step` when needed.

No desktop window required. CI goldens stay on this path.

---

## Start with UI from MCP

Spine tools (always advertised):

| Tool | Purpose |
|------|---------|
| `cad_launch_ui` | Detach-spawn desktop app; share `NBCAD_SESSION_DIR` |
| `cad_ui_status` | Is a tracked UI pid alive? Session summary |
| `cad_ui_window` | Queue focus / show / hide / move / resize |

### Launch

```text
cad_launch_ui
→ { pid, exe, session_dir, already_running }
```

Resolves the executable in order:

1. `NBCAD_UI_EXE` (absolute path override)
2. `src-tauri/target/release/nbcad` (`.exe` on Windows)
3. `src-tauri/target/x86_64-pc-windows-msvc/release/nbcad.exe`
4. Portable `noBS-CAD.exe` under bundle/portable

Build the UI first if missing:

```powershell
npx tauri build --target x86_64-pc-windows-msvc --no-bundle
```

Optional env:

| Env | Meaning |
|-----|---------|
| `NBCAD_UI_EXE` | Exact UI binary |
| `NBCAD_REPO_ROOT` | Help discovery when the MCP binary is relocated |
| `NBCAD_SESSION_DIR` | Must match between MCP and UI for co-link + window commands |

### Window commands

```text
cad_ui_window { "action": "focus" }
cad_ui_window { "action": "move", "x": 80, "y": 60 }
cad_ui_window { "action": "resize", "width": 1440, "height": 900 }
cad_ui_window { "action": "show" }
cad_ui_window { "action": "hide" }
```

MCP writes `$NBCAD_SESSION_DIR/_ui/control.json`. The desktop shell polls ~500ms and applies to the **main** window.

---

## Typical agent flow

```text
# Headless modeling (always OK)
sketch_begin → … → solid_extrude → solid_export_step

# Optional: show the human a window
cad_launch_ui
cad_ui_window { action: focus }

# Optional: pull UI-published document into this MCP process
cad_list_sessions
cad_attach { session_id: "…" }
```

Honesty: after `cad_attach`, MCP holds a **copy**. UI edits appear only after the UI republishes; MCP edits do not auto-reload in the UI yet.

---

## Backlog (do not block on these)

| Item | Why later |
|------|-----------|
| Live shared session / writer lock | True co-edit (#11) |
| Multi-window broker | Multiple labeled windows (#12) |
| Instant IPC (socket) for window cmds | Faster than 500ms poll |
| Auto-attach on launch | Keep headless goldens pure |

---

## Code map

| Path | Role |
|------|------|
| `mcp-server/src/ui_launch.rs` | Launch, status, control.json writer |
| `src-tauri/src/ui_control.rs` | UI poll + apply window actions |
| `src/sessionBridge.ts` | UI → session model/focus publish |

Related: [STEERABLE_MCP.md](STEERABLE_MCP.md), [INSTALL_MCP.md](INSTALL_MCP.md), [../mcp-harness.md](../mcp-harness.md).
