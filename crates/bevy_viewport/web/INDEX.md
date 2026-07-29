# Index — `crates/bevy_viewport/web`

Static host for the wasm spike.

| Path | Role |
|------|------|
| [index.html](index.html) | Loads `bevy_desktop.js` (wasm-bindgen `--target web`) |
| `bevy_desktop.js` | **Generated** — gitignored |
| `bevy_desktop_bg.wasm` | **Generated** — gitignored (prefer `--release` builds) |

Regenerate with the launcher (`--target wasm`) or:

```bash
cargo build -p nbcad-bevy-viewport --bin bevy_desktop --target wasm32-unknown-unknown --release
wasm-bindgen --out-dir crates/bevy_viewport/web --target web --no-typescript \
  target/wasm32-unknown-unknown/release/bevy_desktop.wasm
py -3 -m http.server 4173 --bind 127.0.0.1
```

Parent: [../INDEX.md](../INDEX.md).
