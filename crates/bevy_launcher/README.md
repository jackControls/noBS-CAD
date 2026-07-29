# nbcad-bevy-launcher

```bash
# On reload — always use this (shows the menu):
cargo run -p nbcad-bevy-launcher
```

Menu:

1. **desktop** — native window  
2. **experimental** — wasm in browser; writes `crates/bevy_viewport/web/LAUNCH_URL.txt`  
   → paste that URL to an agent for browser testing

Skip menu (agents/CI):

```bash
cargo run -p nbcad-bevy-launcher -- --target desktop
cargo run -p nbcad-bevy-launcher -- --target experimental --release
```

**Guide:** [docs/bevy-viewport/README.md](../../docs/bevy-viewport/README.md)