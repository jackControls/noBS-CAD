# Agentic entry — `nbcad-bevy-launcher`

**Start here:** [`docs/bevy-viewport/README.md`](../../docs/bevy-viewport/README.md)

## This crate only

- Menu: **desktop** vs **experimental** (`src/main.rs`)  
- No Bevy dependency — keep `cargo check -p nbcad-bevy-launcher` fast  
- On Windows, prefer `py -3` for the static server (not the Store `python` stub)

```bash
cargo run -p nbcad-bevy-launcher -- --target desktop
cargo run -p nbcad-bevy-launcher -- --target experimental --release
```
