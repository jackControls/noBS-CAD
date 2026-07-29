# Agentic guidance — bevy launcher

- Prefer changing flags / serve logic here rather than documenting one-off cargo lines in chat.
- Keep this crate free of Bevy so `cargo check -p nbcad-bevy-launcher` stays fast.
- When wasm serve fails on Windows, try `py -3` before `python` (Store alias trap).
- Do not reintroduce `wasm-server-runner` as a hard dependency until cmake/NASM are documented for contributors.

Viewport rules: [../bevy_viewport/AGENTIC.md](../bevy_viewport/AGENTIC.md).
