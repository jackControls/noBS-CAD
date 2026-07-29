# Bevy spike learnings (superseded embed path)

**Spike:** issue [#20](https://github.com/jackControls/noBS-CAD/issues/20) · draft PR [#25](https://github.com/jackControls/noBS-CAD/pull/25)  
**Superseded for desktop embed by:** branch `Bevy-test`  
**Feathers follow-on:** issue [#29](https://github.com/jackControls/noBS-CAD/issues/29) · `docs/bevy-feathers-ui/`

## What the spike proved

| Finding | Keep? |
|---------|--------|
| Bevy 0.19 can draw tessellation + orbit + mesh picks | Yes (Jack’s embed is the product path) |
| Feathers can host Mode / Appearance / Selection-style panes | Yes → port onto native viewport (#29) |
| `Time<Virtual>` + `FixedUpdate` is the right clock model for sim viz | Yes as a later design note |
| Feature prune + `wasm-release` → ~**35 MB** bindgen wasm (was ~115–123 MB) | Useful if Bevy-in-browser returns |
| Standalone `ViewportBackend` + soup DTO | Optional later; Jack uses in-process `viewport_snapshot()` |

## What not to merge from the spike

- `crates/bevy_viewport` / `crates/bevy_launcher` as a second Bevy product  
- CadMode States that own the OS window (fights React-owned input)  
- Fixture-only sim bay as the desktop default  

## Kill / continue (updated)

**Continue** native embed on `Bevy-test`.  
**Continue** Feathers chrome on that baseline (#29).  
**Close** standalone spike PR #25 as superseded for the embed goal.
