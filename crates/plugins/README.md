# Out-of-process plugins

`nbcad-plugins` discovers `nbcad-plugin.json` manifests and runs one plugin at
a time through a JSON request on standard input and a JSON response on
standard output. A plugin's only product is a version 1 `.nbcad.jsonc` script,
parsed here with `nbcad-script` before anything runs. The crate opens no
window, owns no session and implements no CAD operations; the MCP server and
the desktop decide whether and where the returned script executes.

See [docs/PLUGINS.md](../../docs/PLUGINS.md) for the manifest, the protocol and
how to write a plugin. `src/bin/nbcad-plugin-example.rs` is the reference
import plugin used by the tests: a JSON plate description becomes the same
construction as the bundled mounting-plate recipe.

Run the host-neutral tests with `cargo test -p nbcad-plugins`. They need no
OpenCASCADE or desktop session.
