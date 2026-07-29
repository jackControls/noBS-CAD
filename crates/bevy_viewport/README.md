# nbcad-bevy-viewport

Spike crate for issue [#20](https://github.com/jackControls/noBS-CAD/issues/20): Bevy 0.19 as a **display/ECS** viewport behind `ViewportBackend`.

OCCT remains solid truth. See [SPIKE.md](SPIKE.md) for findings.

## Run

```bash
# Desktop window
cargo run -p nbcad-bevy-viewport --bin bevy_desktop

# Or via launcher
cargo run -p nbcad-bevy-launcher -- --target desktop
cargo run -p nbcad-bevy-launcher -- --target wasm
```

Wasm prerequisites: `rustup target add wasm32-unknown-unknown`, `cargo install wasm-bindgen-cli --version 0.2.126`, and Python 3 for the local static server.

Controls: LMB pick, RMB orbit, scroll zoom, Esc quit (desktop).
