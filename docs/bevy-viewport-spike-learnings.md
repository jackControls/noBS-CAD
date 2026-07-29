# Bevy spike learnings

**Spike:** [#20](https://github.com/jackControls/noBS-CAD/issues/20) / PR [#25](https://github.com/jackControls/noBS-CAD/pull/25) (closed)  
**Desktop embed baseline:** `Bevy-test`  
**Feathers follow-on:** [#29](https://github.com/jackControls/noBS-CAD/issues/29)

| Finding | Action |
|---------|--------|
| Bevy 0.19 draws tessellation + orbit + picks | Done on `Bevy-test` |
| Feathers can host Mode / Appearance / Selection panes | Port in #29 |
| `Time<Virtual>` + `FixedUpdate` for sim viz | Later design note |
| Feature prune → ~35 MB wasm (was ~115–123 MB) | Only if Bevy-in-browser returns |

**Do not merge:** standalone `bevy_viewport` / `bevy_launcher`, window-owning CadMode States, fixture sim as desktop default.
