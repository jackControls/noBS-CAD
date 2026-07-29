# nbcad-bevy-launcher

```bash
cargo run -p nbcad-bevy-launcher -- --target desktop
cargo run -p nbcad-bevy-launcher -- --target wasm
cargo run -p nbcad-bevy-launcher -- --target wasm --release
```

- **desktop** — `cargo run -p nbcad-bevy-viewport --bin bevy_desktop`
- **wasm** — build `wasm32-unknown-unknown`, `wasm-bindgen` into `crates/bevy_viewport/web`, serve with Python (`py -3` preferred on Windows)

See sibling [bevy_viewport/SPIKE.md](../bevy_viewport/SPIKE.md).
