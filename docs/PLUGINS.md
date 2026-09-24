# Plugins

noBS CAD runs local **out-of-process plugins**. A plugin is a program in its
own directory with a `nbcad-plugin.json` manifest. The host starts it, writes
one JSON request to its standard input and reads one JSON response from its
standard output. The only thing a plugin can hand back is a version 1
[native script](native-scripts.md), which then runs through the same
interpreter as a bundled recipe or `File → Open Script`. Plugins cannot call
the kernel, edit the document or attach to a session, and they can be written
in any language.

Version 1 supports two kinds:

| Kind | Request | Typical use |
|------|---------|-------------|
| `import` | one input file plus options | a drawing, a hole table, a vendor file becomes a part |
| `generate` | options only | a parametric wizard for a gear, flange or enclosure |

The decision and its alternatives are recorded in
[ADR 0007](adr/0007-out-of-process-plugins.md).

## Where plugins live

The host looks in these directories, in order:

1. Every entry of `NBCAD_PLUGIN_DIRS`, a platform path list (`:` on macOS and
   Linux, `;` on Windows).
2. The per-user directory beside the desktop configuration:
   - macOS: `~/Library/Application Support/org.nbcad.desktop/plugins`
   - Windows: `%APPDATA%\org.nbcad.desktop\plugins`
   - Linux: `$XDG_CONFIG_HOME/org.nbcad.desktop/plugins`, by default
     `~/.config/org.nbcad.desktop/plugins`

Each immediate subdirectory that contains `nbcad-plugin.json` is one plugin.
A manifest that fails validation is reported in the listing, never loaded. When
two manifests share an id, the first one found wins and the other is reported.
A missing directory is not an error.

## Manifest

```json
{
  "protocol": 1,
  "id": "drawing-import",
  "name": "Drawing import",
  "version": "0.1.0",
  "description": "Scanned or plotted 2D plate prints become editable plates.",
  "kind": "import",
  "command": {
    "default": [".venv/bin/python", "-m", "nbcad_drawing_import.plugin"],
    "windows": [".venv\\Scripts\\python.exe", "-m", "nbcad_drawing_import.plugin"]
  },
  "input": {"extensions": ["pdf", "png", "jpg", "jpeg", "tif", "tiff"]},
  "options_schema": {
    "type": "object",
    "properties": {
      "length_mm": {"type": "number", "description": "Longest plate edge"},
      "thickness_mm": {"type": "number"}
    },
    "required": ["length_mm", "thickness_mm"]
  },
  "timeout_seconds": 120
}
```

| Field | Meaning |
|-------|---------|
| `protocol` | Must be `1`. |
| `id` | 1 to 64 lowercase letters, digits, `-`, `_` or `.`, starting with a letter or digit. Used in `cad_interface` calls. |
| `name`, `version`, `description` | Shown in listings. |
| `kind` | `import` or `generate`. |
| `command` | An argv list, or argv lists keyed by `windows`, `macos`, `linux` and `default`. No shell is involved. A program containing a path separator is resolved relative to the plugin directory; a bare name is found through `PATH`. The plugin runs with its own directory as the working directory. |
| `input.extensions` | Required for `import`: lowercase extensions without the dot. Absent for `generate`. |
| `options_schema` | Optional JSON Schema object describing the `options` a caller may pass. The host does not evaluate it; user interfaces may. |
| `timeout_seconds` | Optional, default 120, maximum 3600. The host kills the plugin at the deadline. |

Unknown fields are ignored so future protocol versions can add data.

## Protocol

The host writes one JSON document and closes standard input:

```json
{
  "protocol": 1,
  "action": "import",
  "plugin": "drawing-import",
  "input": {"path": "/absolute/path/to/print.pdf"},
  "options": {"length_mm": 241, "thickness_mm": 11.5},
  "work_dir": "/optional/scratch/directory"
}
```

`action` is `import` or `generate` and always matches the manifest kind.
`input` is present only for imports; the host has already checked that the
path is absolute, exists, is a regular file and carries an accepted extension.
`options` is always an object. `work_dir` is optional scratch space the host
neither creates nor cleans. The environment variable `NBCAD_PLUGIN_PROTOCOL`
is set to `1`.

The plugin writes one JSON document to standard output and exits:

```json
{
  "protocol": 1,
  "ok": true,
  "script_source": "// Imported from print.pdf\n{ \"version\": 1, ... }",
  "report": {
    "summary": "Plate 241 × 40 × 11.5 mm with 7 holes",
    "flags": [
      {"severity": "warning", "message": "Hole diameters were measured from the raster; verify them against the callouts.", "step": "hole_3"}
    ]
  }
}
```

- Exactly one of `script_source` (JSONC text, comments allowed) or `script`
  (a JSON object) carries the script. Text is what the interpreter reads;
  an object is serialised by the host.
- `report.summary` is one line. Each flag has a `severity` of `info`,
  `warning` or `error`, a `message`, and optionally the script `step` id it
  concerns. Put every assumption and every unmodelled feature in a flag; a
  script should never silently invent a dimension.
- Failure: `{"protocol": 1, "ok": false, "error": "why"}`, with any exit
  status. A non-zero exit without such a document is reported with the exit
  status and the end of standard error. Standard error is otherwise free for
  logging; the host keeps its last 64 KiB for diagnostics.

Limits: the response may be at most 17 MiB and the script at most 16 MiB, the
same limit as every other script source. The host parses the script with the
ordinary parser and checks each operation against the product catalog before
it returns; an invalid script is an error, not a partial import.

## Using a plugin

Through MCP, list what is installed and run one:

```json
{"action": "plugins"}
{"action": "plugin", "plugin": "drawing-import",
 "input": "/absolute/path/to/print.pdf",
 "options": {"length_mm": 241, "thickness_mm": 11.5}}
```

`plugin` accepts the same arguments as `script`: `session_id` to run in an
attached live document, `mode` `fast` or `present`, `speed` and `validate`.
The result is the ordinary script result plus a `plugin` object holding the
report, the run time and any standard error tail. Add `"execute": false` to
receive the validated script source and its report without running anything,
for example to show it in the Scripts workspace first.

Every plugin can also be used without the host: run its command-line entry,
save the returned script as `.nbcad.jsonc`, then open it with
`File → Open Script` or replay it with `cargo xtask run-script`.

A desktop menu entry is a follow-up. It will reuse the same crate and hand the
returned source to the Scripts workspace.

## Writing a plugin

The reference plugin is
[`crates/plugins/src/bin/nbcad-plugin-example.rs`](../crates/plugins/src/bin/nbcad-plugin-example.rs):
a JSON plate description becomes the same construction as the bundled
mounting-plate recipe. The host tests in `crates/plugins/tests` run it. A
minimal Python plugin has the same shape:

```python
import json, sys

request = json.load(sys.stdin)
if request.get("protocol") != 1:
    print(json.dumps({"protocol": 1, "ok": False, "error": "unsupported protocol"}))
    sys.exit(1)
script = {
    "version": 1,
    "name": "Generated block",
    "starting_state": "empty",
    "steps": [
        {"note": "Built by a plugin from " + request["input"]["path"]},
        # ... ordinary grouped calls, exactly as in examples/scripts ...
    ],
}
print(json.dumps({"protocol": 1, "ok": True, "script": script,
                  "report": {"summary": "One block", "flags": []}}))
```

Guidance for authors:

- Copy construction patterns from [examples/scripts](../examples/scripts):
  resolve faces and bodies with `$select` from earlier results and place
  features with `$project`, so the script never depends on captured ids.
- Use `note` steps and chapters to explain what was read from the input, and
  put anything uncertain in report flags.
- Keep the plugin deterministic for a given input and options; the host may
  replay the returned script on any platform.
- Test your plugin by running its returned script headlessly with
  `cargo xtask run-script` before publishing it.

## Trust

Plugins are ordinary local programs that run with the user's permissions. The
host does not sandbox them; it only verifies the response shape and the script.
Install plugins you trust, from sources you trust, and keep company-specific
conventions in private plugin repositories rather than in this one.
