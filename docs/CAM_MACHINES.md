# Machine-aware CAM foundation

Execution remains fixed, three-axis milling.
The machine resource schema is deliberately broader than executable motion.

## Workflow

1. Choose a target in **Setup → Machine & Controller**, or leave it **Generic
   3-axis**. Generic programming, regeneration and CAM stock simulation work
   without a controller. Old projects stay generic; migration never assigns a
   machine from a post preference or another project's settings.
2. A selected target is a self-contained project snapshot, with an identity,
   revision and shop name. The optional device default only seeds new setups.
   Editing a project snapshot never updates another setup or the device default.
3. Program machining intent and generate neutral tool-tip motion. The contour
   dialog displays the selected output policy alongside in-control compensation.
4. **Post NC** uses the setup snapshot, not the last dialect used elsewhere.
   Change controllers explicitly in Setup. Review machine-specific tool-change,
   register and preload settings, then **Check & prepare NC**. Tool numbers/names
   come directly from the project library; there is no per-tool mapping form. Rust checks
   freshness, supported motion, target/post compatibility, compensation blocks
   and existing geometric verification. Warnings are shown before **Save NC**.
5. Changing the project, stock/model state or machine snapshot invalidates a
   prepared export, including changes while the save picker is open. There is
   no persisted green "machine verified" bit.

Current starters: Siemens 828D native, FANUC-style, Haas NGC, Mitsubishi,
Mazak EIA, Syntec, Okuma OSP, Heidenhain TNC, Hermle/Heidenhain fixed-axis,
LinuxCNC and GRBL. See [post contracts and private storage](CAM_POSTS.md).
These are starting configurations, not commissioned or certified machine kits.
The existing native Siemens ATC settings remain explicit; tool preload stays
off by default. A magazine's physical style cannot enable preload or pick a
machine-coordinate station automatically.

Native output uses G710/G700 for geometry and feed units. After tool change,
it positions XY while retracted and then approaches workpiece Z, including
high-feed links. Changed fixture offsets force a SUPA Z retract and a fresh
XY-then-Z approach even with the same cutter. Reset state, M6 clearance and
extended unit support remain explicit commissioning assumptions.

Siemens ISO and Mach remain representable but unsupported output targets.
Haas, Mitsubishi and the other new targets now have explicit post contracts;
none is silently aliased to a generic target. OSP and TNC output have no NC
replay implementation yet, and attempts to replay them as ISO are rejected.

## Separation of responsibilities

| Layer | Persistent information / responsibility |
| --- | --- |
| Machining intent | CAD references, stock, WCS, tools, cutting strategy, heights and linking choices |
| Machine profile | Stable resource IDs; linear/rotary joints with parent-frame directions, origins and optional limits; tool/workpiece spindles; named channels |
| Setup assignment | Profile snapshot; machining mode; selected channel; tool/workpiece spindle bindings; optional workpiece-table attachment |
| Controller | Family, language/mode, model and optional software version, separate from mechanical topology |
| Post | Machine-specific output settings; program numbering can vary without changing the mechanical target |
| Verification | Fresh checks of the current inputs; compatibility is not equivalent to whole-machine collision verification |

`crates/cam/src/machine.rs` owns the resource contract and output policies.
Rust validates unique IDs, references, acyclic joint parents, finite unit-axis
directions, ordered limits and spindle roles/channel membership. Profiles have
a schema version and revision; unsupported versions fail explicitly. IDs and
revision labels are traceability metadata, not a replacement for comparing
actual input contents.

Ordinary machine profiles use schema 1. The opt-in native private spindle-stop
extension uses schema 2, with the same version on its `.nbpost` wrapper, so
older readers cannot silently discard that output behavior. New readers accept
both versions. See [private extension and replay limits](CAM_POSTS.md#native-private-spindle-stop-extension).

The current executor requires one milling channel, one tool spindle and three
Cartesian linear axes in fixed-three-axis mode. A rotary, indexed, simultaneous,
turning or multi-channel definition can be serialized and edited structurally,
but planning, CAM execution and NC export reject it as unsupported. That check
also walks rest-stock source setups and runs before cache lookup.

This is a declarative resource topology, **not** a complete kinematic solver or
machine assembly. No machine solids, calibrated mounting transforms, axis home
positions, workpiece-to-machine placement, PLC motions or travel verification
are inferred. A null axis limit means unknown; it is not verified unlimited
travel. Limits stored in this schema are not yet checked against machining moves.

## Executable tool identities

The **project tool library** is authoritative. Automatic mode uses its tool
number; name-capable posts use its exact name when no number is assigned.
Siemens/TNC posts also offer explicit Number or Name mode, applying to the
whole post rather than a separate per-tool mapping. Post NC previews the used
tools. There is no uppercasing, punctuation replacement, truncation or internal
ID substitution. Invalid/missing/ambiguous identifiers fail with library-edit
guidance; they are never guessed from old bindings.

The current conservative name subset is 1–31 ASCII letters, digits or
underscores. Numeric calls are integers 1–99999999; with active tool management
they may identify magazine locations rather than internal tool IDs. Names and
numbers are distinct: quoted name `"3"` is not numeric `3`. Duplicate executable
calls are rejected. NC interpretation uses the same exact library numbers/names,
including tools used only by external NC. Other posts have narrower numeric
register limits documented in the post guide.

Legacy `tool_calls` records remain readable but do not affect output or NC
interpretation. Post settings and reusable native profiles clear these obsolete
records. Existing files need no manual mapping migration. Project tools remain
snapshots: relocating/changing the central library does not alter them.

The library is not a readback of the physical machine tool table.
The [828D NC programming manual, pp. 64–67](https://cache.industry.siemens.com/dl/files/240/109974240/att_1296639/v1/828D_ncprogramming_progr_man_0724_en-US.pdf)
defines name-case and numeric-selection distinctions; machine commissioning
must confirm the actual table, D geometry and replacement-tool behavior.

## Cutter compensation contract

The core stores either full in-control radius compensation or an in-software
tool-center path. Wear-only compensation is not implemented. Length offsets
and cutter radius compensation are distinct functions.

Let the project tool radius be `R = diameter / 2`. For the activation or
cancellation block, compute the XY travel from consecutive **posted, rounded**
coordinates, converted back to canonical mm:

    Lxy = sqrt((X1 - X0)^2 + (Y1 - Y0)^2)

Current output policy requires a G1 block with nonzero XY travel at both switches:

| Target | Activation | Cancellation |
| --- | --- | --- |
| Siemens native starter | Nonzero XY G1 | Nonzero XY G1 |
| FANUC/Haas/Mitsubishi/Mazak/Syntec/OSP/TNC starters | `Lxy >= R` | `Lxy >= R` (conservative policy) |
| LinuxCNC | `Lxy >= R` | `Lxy > 2R` |
| GRBL | In-control mode blocked | In-control mode blocked |

These are deliberate supported output policies, not assertions that every
control forbids other valid startup methods. A circular lead is optional. A
G0/G1 Z-only drop does not satisfy this implementation's switch contract. We do
not assume setting-dependent no-XY activation, look-ahead variants or machine
parameter values merely from a controller name. No automatic enlargement of
leads is done: extending a move needs clearance proof, not just formatting.

Checks examine generated moves, not the dialog's linear-distance field: the
programmed in-control entry may include a radius-sized normal component. Post
rounding matters too: a 3.000 mm linear entry may round to 0.118 inch (2.9972 mm)
and no longer satisfy a 3 mm minimum. Diagnostics identify the operation and the
measured vs required move length.

The gate assumes the actual control's offset table contains the full project
tool radius with the intended sign and register. Neither the CAM planner nor
NC interpreter reads the machine's offset table. Follow existing offset checks,
stock/model verification and machine dry-run practice; these rules alone do
not establish a safe program.

### Explicit Siemens intersection corners

Every activation now emits `G41 NORM G451` or `G42 NORM G451`. NORM describes
approach/retraction; G451 selects intersections. Native NC input must explicitly
establish both modes before activation. G450 transition circles and KONT-style
approaches fail closed instead of being interpreted as the supported policy.

`crates/cam/src/compensation.rs` offsets analytic primitives before sampling:

- A directed line with unit tangent `t` has left normal `n=(-ty,tx)`; its offset
  is `P+sR*n`, with `s=+1` for left and `s=-1` for right compensation.
- A circle of radius `r` stays concentric, with `r'=r-sR` for CCW traversal or
  `r'=r+sR` for CW traversal. A consumed/inverted radius is rejected.
- Consecutive offset line/line, line/circle or circle/circle primitives meet at
  their analytic intersection. For two straight outside legs turning by `θ`,
  the miter lies `R/cos(θ/2)` from the vertex and extends `R*tan(θ/2)` along
  each leg. Tangent joins remain tangent rather than inheriting a chord-miter
  artifact.

Only the resolved centerline is tessellated for stock sweeps: circular chord
deviation ≤0.0025 mm, chord length ≤0.5 mm, at most 200,000 chords. A production
post check runs the same construction on the coordinates/arc offsets actually
rounded for output. Nonintersecting, erased/reversed or unbounded joins fail
before NC preparation. Motion is constant-depth XY profiling; this is not a
general 3D/helix compensation solver.

The supported outside turn is at most 90°. G451 can switch to round transitions
at pointed corners depending on machine data. The app cannot read that limit;
the warning requires commissioning it for this subset. See [native corner
behavior, pp. 272–274](https://cache.industry.siemens.com/dl/files/240/109974240/att_1296639/v1/828D_ncprogramming_progr_man_0724_en-US.pdf)
and the [machine-data reference](https://cache.industry.siemens.com/dl/files/894/74547894/att_76242/v1/828D_LH1_0313_en.pdf).
Explicit G451 plus software replay is not proof that an unknown controller
configuration will execute identically.

Controller references used for policy: the [Siemens native tools manual](https://cache.industry.siemens.com/dl/files/584/109823584/att_1151910/v1/828D_tools_fct_man_0723_en-US.pdf),
[Siemens ISO programming manual](https://cache.industry.siemens.com/dl/files/226/109801226/att_1080855/v1/ONE_840Dsl_828D_iso_milling_progr_man_0721_en-US.pdf),
[Haas cutter compensation documentation](https://www.haascnc.com/service/codes-settings.type=gcode.machine=mill.value=G41.html), and
[LinuxCNC G40/G41/G42 reference](https://linuxcnc.org/docs/html/gcode/g-code.html#sec:G40).
The fixed-axis Haas starter uses its own formatting/dwell contract. Generic
FANUC policy intentionally does not enable configurable startup variants.

## Caching and change impact

Machine/controller/post metadata does not currently alter neutral toolpaths.
It is excluded from generation fingerprints and Rust stock cache comparisons.
Changing that metadata does not erase operations or require regeneration;
every NC output rechecks compatibility and geometric evidence. Tool, geometry,
stock, WCS, order and linking edits retain their existing invalidation rules.
The machine-only update route also preserves the selected toolpath and stock
input identity in the UI. General Setup edits may refresh the view as before.

The original machine-foundation pass retained planner revision **7**; current
revision **9** comes from the later cutter-aware clearance proofs. Tool-call
and output-policy metadata do not by themselves regenerate neutral motion.
When a future capability affects linking or motion (for example a supported
above-stock compensation startup), add its resolved semantic policy to the
generation/cache keys and bump the planner revision. Never key safety solely
by a mutable library profile ID.

CAM Sim still predicts tool/stock/model results from planned motion; NC Sim
still interprets supported NC words in its explicit selected dialect. Neither
simulator is converted into a whole-machine simulation by selecting a profile.
NC dialect selection is not inferred from the machine profile. Our new posts
include an explicit format header for Auto replay, preventing dwell-unit
ambiguity. Unsupported conversational/OSP input remains blocked.
Neutral post-event export remains an intermediate developer artifact, not a
machine-ready NC path around the output gate; host geometric checks still apply.

## Extension sequence

1. Commission versioned machine/controller kits and regression programs. Add
   supported Siemens ISO/Haas/Mitsubishi/Mach outputs independently. Introduce
   explicit, verified controller options before enabling special compensation
   startup modes. Do not expose an unrestricted "ignore checks" switch.
2. Add indexed machining with an explicit workplane and tool-orientation intent.
   Resolve locked rotary positions, fixture frames and safe indexing sweeps;
   retain current XYZ commands as a distinct versioned motion representation.
3. Add simultaneous motion as tool-tip **pose**, not just extra A/B/C fields.
   Kinematic solving maps pose to axis trajectories with branch continuity,
   singularity handling, travel/rate limits and collision checks. Posts express
   TCP/RTCP, inverse-time or other supported feed modes from resolved semantics.
4. Add turning intent: workpiece spindles, tool nose geometry/compensation,
   diameter/radius programming, CSS and feed-per-revolution. Mill-turn then adds
   live tooling, chuck ownership/part transfer and channel synchronization.
   A multi-channel execution graph must model dependencies/waits explicitly;
   concatenating two spindle programs is not synchronization.
5. Both CAM prediction and NC interpretation should feed a common resolved
   pose/timeline simulation layer while retaining source attribution. Machine
   kinematics, fixtures and holders add a separate verified envelope; Bevy owns
   presentation, not machining authority. No requirement to replace today's
   Rust stock kernel or to run per-frame OCCT booleans.

Future enum cases and resource slots are not UI claims of machining support.

## Regression coverage

Current post-library coverage is described in [Posts and private machine profiles](CAM_POSTS.md).
It exercises direct library identities and replaces the manual binding UI tests.

Machine tests cover legacy/generic documents, all current starter bindings,
post mismatch, snapshot persistence, parameter overrides, resource graph
validation, future-motion rejection, spindle roles, controller/language
non-aliasing, actual compensation blocks and output rounding. Host tests cover
freshness preservation and enforced output gating. The isolated browser suite
uses the real WASM engine for Setup/default persistence and the prepare/review
flow, including rejecting stale prepared NC before opening a save picker.

Existing post formatting goldens use the internal formatting seam; they do not
assert machine qualification. New machine tests exercise the public production
`post_setup` boundary, and the host retains geometric checks on top of it.
