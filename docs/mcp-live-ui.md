# Live UI automation and executable demos

`cad_ui` is the single live UI tool. `action: launch` starts an explicitly
supplied desktop executable (or
`NBCAD_DESKTOP_BIN`). It reports `ready` only after the new process publishes a
fresh session and that session acknowledges a UI inspection. `starting` is not
permission to launch a duplicate: inspect the existing process/session first.

`cad_ui` inspects the running application's actual controls. Results are grouped
by ribbon workspace/panel, project tabs, browser, viewport, sketch palette,
appearance, comments, timeline, drawing inspector, dialogs, and portal menus.
Only currently rendered controls appear; disabled controls remain explicitly
disabled. Missing labels are reported. This inventory is not a claim that every
product feature is implemented or behaviorally tested.

Inspect immediately before acting. Use the returned opaque control ID with
`click`, `double_click`, `context_menu`, `set_value`, or `key`. IDs expire on the
next inspection and reject changed documents, recycled controls, hidden or
disabled targets, and controls blocked by modal dialogs. Text changes and
clicks use normal input, change, focus, and blur handlers.

For geometry interaction use `action: viewport`, `canvas: viewport | drawing`,
and a `move`, `click`, `double_click`, or atomic `drag` gesture. `point` and drag
`to` are application-window CSS pixels; inspect `ui.canvases` for bounds. The
3D viewport also accepts a `world` point. These operations route through the
same canvas handlers as user input. They do not bypass feature validation.

`action: window` accepts `foreground`, `background`, or `inspect`. Returned
window flags describe observed OS state; foreground requests are subject to OS
focus policy. Native wake events advance camera animation, operation playback,
and keepalives while browser timers are throttled. Hidden execution reports
`presented: false`; a successful operation is not proof of rendered pixels.

`action: file` supports absolute `.nbcad` paths for `open` and `save`, and an
explicit `name` for `rename`, using the normal project pipeline. Replacing an
existing file requires `overwrite: true`; opening over unsaved work requires
`discard_changes: true`. This avoids OS file-picker automation. Follow returned
`active_session_id` after a document transition. OS print, driver setup, and
other external dialogs are not DOM controls.

## Ordered plans

Use one client to execute a plan sequentially. For each engine edit, await
`cad_submit` then `cad_await_apply`. Await each `cad_ui` response before
the next operation. The UI has one presentation lane and acknowledges changed
model state after publication. Failed operations stop the supplied golden;
never replay an uncertain mutation automatically. Independently submitting
commands from competing clients is not a transactional plan.

Set `pace_ms` with `cad_ui` (0–2000). The same calls support fast checks and
visible demonstrations: zero minimizes the presentation interval, while 500
ms makes each operation legible. Camera changes animate; UI actions highlight
their target and model edits show their command in order. Reduced-motion
preferences suppress the highlight animation.

## Checks that grow with the product

Run `cargo xtask test-mcp contracts` for browser behavior contracts: actual
DOM discovery, grouping, disabled/hidden/stale/modal guards, field events,
tree gestures, atomic drags, serialization, and recovery after failure. It
derives enabled ribbon commands from product configuration and checks that
they dispatch an action. It does not maintain copied tool counts. The desktop
frontend CI job runs this test with Playwright Chromium.

Run the native golden against a newly launched disposable document:

```powershell
cargo xtask test-mcp live --server <nbcad-mcp.exe> --desktop <nbcad.exe> --part --drawing --idle --pace 0 --save <new-absolute-path.nbcad> --out <report.json>
```

The executable and native libraries must be available (development builds may
need the OCCT bin directory on PATH). Use `--pace 500` for a live demonstration.
The runner speaks MCP stdio only. It checks launch readiness, foreground and
minimized camera control, optional 35-second idle recovery, native sketch/UI
mode agreement, the real Extrude dialog and resulting solid, optional drawing
placement, save/open, overwrite refusal, and continued control after open.
Reports contain calls, responses, and timings; assertion failures stop the plan.

This complements the native part/assembly model goldens and camera/joint
controls test. Those tests validate geometry and persistence; the live UI
golden validates the connection between engine state and interactive UI. A
passing command-dispatch inventory alone is not full feature coverage. Expand
goldens with real feature workflows when adding capabilities, rather than
introducing a mirrored list of expected tools or controls.

## Bench and feature workshop

```powershell
cargo xtask test-mcp bench --server <nbcad-mcp.exe> --workshop all --out <report-directory>
```

Add `--session <UUID> --pace 500` to drive an empty live document. The
runner can launch one with `--desktop <nbcad.exe>` and save the resulting
assembly with `--save <new-absolute-path.nbcad>`. The same
MCP plan runs headlessly in CI and through the live inbox for demonstrations.
Mutation routing comes from the server catalog's shared `mutates` metadata.
Active-sketch inspection, expression evaluation, and previews query the live
engine through the existing control channel. They do not read the completed
model snapshot, which intentionally excludes a sketch still being edited.
Drivers live only in `xtask/mcp`; there are no legacy script entry points.

The workshop exercises every tool in the runtime sketch, solid, modify, and
body-operations packs. Adding a tool automatically fails coverage until an
example successfully calls it. Geometry checks cover feature edits, body
counts, meshes, sketch dimensions, and replay errors. Successful invocation
coverage does not mean every parameter combination or UI dialog is tested.

After isolated workshop cases, the plan builds a garden bench from seven native
sketch/extrude parts, reused as seventeen occurrences with sixteen rigid joints.
It asserts solved occurrence positions, clean diagnostics, and native history.
Back supports attach through face connectors; rigid joints reject nonzero
motion coordinates instead of silently ignoring them. Reports include call arguments, timings, coverage,
and a model checkpoint. Workshop resets are explicit and require an empty
document at the start. Do not run it over user work.

For complementary mechanism examples, FreeCAD maintains an
[assembly example](https://github.com/FreeCAD/FreeCAD/blob/main/data/examples/AssemblyExample.FCStd)
and documents a vise and crank-slider in its
[Assembly workbench guide](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Assembly_Workbench.md).
The vise would exercise sliding and screw motion; the crank-slider would
exercise coupled joints. Treat these as design references for new native MCP
plans. An imported shape would not prove native sketch history, and `.FCStd`
is not a noBS-CAD project format. No external model is vendored here.
