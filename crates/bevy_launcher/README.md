# nbcad-bevy-launcher

```bash
cargo run -p nbcad-bevy-launcher
cargo run -p nbcad-bevy-launcher -- --target desktop
cargo run -p nbcad-bevy-launcher -- --target experimental --release
```

Interactive menu:

1. **desktop** — native Bevy (3D + Feathers UI + `CadSession` bridge)
2. **experimental** — wasm in browser (alias: `wasm`)

See [docs/bevy-viewport/ui-ports.md](../../docs/bevy-viewport/ui-ports.md).