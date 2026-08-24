# 3-axis CAM foundation

This branch starts a host-neutral, fixed-axis CAM module for common 3-axis
milling workflows. It is an engineering foundation, not yet a claim of
production-safe CAM.

## Operating model: nothing is created automatically

Entering the manufacturing workspace never creates a setup, a tool, or an
operation. The operator programs the job explicitly, in this order:

1. **Tool library first.** Every cutter is a library entry with its geometry
   (kind, diameter, flute length/count, tip angle where relevant) and its
   cutting data. Operations reference library tools by an internal id and
   inherit their cutting data as editable defaults, so renumbering or
   renaming a tool never breaks an operation. The machine-facing identity is
   deliberately dual: a tool number is optional — number-calling posts
   (GRBL/LinuxCNC/Fanuc style) fail closed with a clear error when it is
   missing, while the Siemens 828D post prefers the tool name (`T="NAME"`),
   falling back to the number only when the name carries no callable
   identifier. Tool kinds cover flat/ball/bull-nose end mills, face (shell)
   mills, drills, chamfer mills, taps, reamers, boring bars, and thread
   mills (turning kinds are reserved for the planned turning workspace).
   Flat, bull-nose, and face mills carry an optional corner radius. The
   editor is tabbed (General / Cutter / Cutting data) — new tools start
   from a type-picker page, and every field stays editable in any order
   later. Cutting
   data is a default profile plus any number of named profiles (e.g. per
   material), with a two-way chip-load calculator: each linked pair
   (rpm ↔ surface speed, feed ↔ feed-per-tooth, plunge ↔ plunge-per-rev)
   follows an edit on either side, and the side last touched wins at save
   time. The calculator works on the *effective* cutting diameter: engaged
   shallower than the corner radius, De = D − 2R + 2√(2R·ap − ap²) at the
   entered depth of cut — the correction that matters most on high-feed
   tooling. Operation creation can copy any profile instead of the default.

   The library lives in two scopes. The CENTRAL library belongs to the OS
   user, not any project: it is a single per-user file
   (`cam-tool-library.json` in the platform config directory —
   `~/Library/Application Support` on macOS, `%APPDATA%` on Windows,
   `~/.config` on Linux) holding every tool the operator ever defined, and
   it owns tool-id allocation so ids stay unique across projects. The
   PROJECT library lives inside the machining document (and the .nbcad
   file): full-data snapshots of exactly the tools this project uses, which
   is what operations reference — a project file is self-contained and
   portable, and editing the central library never silently rewrites an
   existing project. Synchronisation is always explicit, never a background
   merge: import copies a central tool into the project (or refreshes the
   same-id snapshot), publish pushes a project snapshot back into the
   collection. Creating a tool inside a project also registers it centrally
   so it stays importable everywhere. The Tool Library dialog (ribbon)
   opens on the central scope with a header switch to the project scope;
   operation dialogs list project tools and offer one-click import of
   compatible central tools. Setups, operations, units, and post defaults
   stay project data.
2. **Manual setup.** The operator chooses the part bodies, defines the stock,
   and picks the WCS origin on the geometry. Stock has four shapes — box,
   cylinder, hex bar, or a modeled body — defined in one of three ways: a
   fixed size with the model centered inside or parked against a chosen face
   with a gap; grown from the model bounding box with per-face allowances; or
   the remaining stock of an earlier setup (rest machining, which inherits the
   source setup's WCS). The WCS origin is picked in the viewport on a lattice
   of 27 stock/model box points (corners, edge midpoints, face centers,
   volume center) or on any point sketched earlier; explicit coordinates and
   equivalent anchor dropdowns remain available. Orientation (Z flip,
   rotation about Z) is explicit. Work offsets name a first offset (G54…G59)
   plus a duplicate-part count: posting one program repeats the toolpaths
   under that many consecutive offsets. The post dialect is **not** a setup
   property — it is chosen in the Post NC dialog at export time, because the
   planned toolpaths are dialect-neutral and any post can render them.
3. **One operation at a time.** Each operation is programmed against geometry
   the operator selects — sketch loops for contours, pockets, and chamfers;
   sketched points or explicit coordinates for drilling and thread milling;
   the stock top or an explicit region for facing. Facing targets the
   model's top surface: the operator enters a depth below it (0 faces the
   model top exactly). Safe heights (clearance and retract Z) are set per
   operation, not globally on the setup. The engine validates the input and
   rejects incomplete programs instead of guessing.

The same document is fully scriptable through the MCP `cam_*` tools
(`cam_get_document`, `cam_set_document`, `cam_plan_setup`, `cam_post_setup`,
`cam_simulate_setup`), which run the same validation as the UI.

## Units

Persisted geometry, planned motion, and simulation are always canonical
millimetres. The document carries an operator-facing unit switch (mm / inch)
that can be flipped at any time: every field, readout, and point list in the
workspace displays and accepts input in the chosen unit, and posts emit
matching controller words (`G21`/`G20`, `G710`/`G70`). Switching units never
rewrites stored geometry.

## As-built scope

- Persistent manufacturing intent in `.nbcad`: setups, WCS (with origin
  provenance), G54-G59 work offset plus duplicate-part count, stock
  definitions (box/cylinder/hex/modeled body; fixed size, model-grown
  allowances, or rest from an earlier setup), tool library with cutting data,
  operations with per-operation safe heights, unit preference, and post
  defaults used only to pre-fill the export dialog.
- Deterministic controller-neutral motion planning in millimetres, with
  per-offset program duplication (`G54`, `G55`, … blocks in one program).
- Facing, closed 2D contour, 2D pocket (zigzag clear plus boundary finish
  pass), 2D chamfer (90° chamfer mill with tip-offset control), internal
  thread milling (thread mill orbiting a helical path one pitch per
  revolution, split into semicircular arcs; right/left-hand threads, climb or
  conventional direction, optional multi-pass radial stepovers finishing at
  the full orbit; the host resolves the designation to explicit pitch and
  major/minor diameters stored on the operation), and hole
  operations with an explicit cycle family: plain drilling (rapid out), chip
  breaking (peck with an in-hole partial retract), deep drilling (peck with
  full retract), right/left-hand tapping (pitch-synchronised feed with
  spindle reversal), reaming, and boring (dwell and feed out). Every cycle is
  expanded to explicit longhand motion, so posted output never depends on a
  control's canned-cycle dialect. Helical arcs post as plain G2/G3 blocks
  carrying a Z word in every dialect.
- Multiple depth passes, contour side compensation, stepover, and stepdown.
- Built-in conservative posts for GRBL, LinuxCNC, a generic Fanuc-style
  subset, and a native Siemens 828D reference profile with an explicitly
  confirmed machine-coordinate `SUPA` retract. The post configuration
  (dialect, program name/number, sequence numbers, machine profile) is chosen
  at export time; all posts honor the document unit switch.
- A `.nbpost` file contract and non-executing callback-post analyzer.
  Script execution is not implemented yet and therefore cannot generate NC.
- A bounded, deterministic 3D voxel stock simulator that consumes the same
  neutral motion IR as the post layer, records per-command removal/time,
  detects rapid/tool contact with remaining stock, and greedily extracts a
  renderer-neutral remaining-stock surface mesh. Initial stock is voxelized
  from the setup's resolved shape: box grid, cylinder/hex prisms, a modeled
  body's mesh, or an earlier setup's simulated remainder (rest chains are
  validated against shared WCS/envelope and cycles).
- A React manufacturing workspace that shares the modeling viewport and
  browser: the modeling tree stays in place and gains a Setups section
  (operations listed with their tool tag, `[T<n>]`/`[name]`), while the tool
  library lives in its own full dialog (table plus tabbed editor, with a
  central/project scope switch in the header), not in the browser tree. There is no side inspector panel: double-clicking a
  setup or operation row floats its configuration in a dialog, exactly like
  the modeling feature dialogs. The workspace opens directly onto the
  modeled parts (setups
  are created from a centered dialog via the ribbon, never implicitly), with
  manual setup and operation dialogs, viewport point picking for WCS origins,
  distance/time estimates, warnings, NC export via the
  Post NC dialog, and neutral post-event export. The manufacturing tab mounts
  the very same viewport component as modeling — navigation, grid, ViewCube,
  and model presentation are literally identical — and CAM adds its overlays
  through the viewport's native transient channel (`src/cam/overlay.ts`):
  a translucent stock ghost with envelope edges, RGB WCS axes, the selected
  operation's toolpath (dotted rapids / solid cuts, drawn through geometry),
  a translucent ghost of the selected operation's tool parked at its last
  cutting position (fluted section brighter than the shank),
  the simulated remaining stock in green with rapid-collision markers, and
  point-pick candidates. A status chip at the viewport's lower right reports
  the selected operation's machining time (`h:mm:ss`, from the program's
  per-operation stats) or the whole setup's total when nothing is selected.
  Setup-space planner output is transformed back to
  model coordinates in that one module.

The Rust crate at `crates/cam/` owns validation, path generation, motion IR,
posting, and post-event projection. The React code under `src/cam/` and
`src/components/cam/` edits intent and visualizes generated motion. As with
drawings, generated tool motion is not persisted; it is regenerated from the
saved CAM intent.

## Coordinate and safety contract

- All persisted dimensions and motion coordinates are canonical millimetres;
  the document unit switch changes display and posted output only.
- Each setup has an orthonormal, right-handed WCS derived from the origin the
  operator picked (stock box point, model box point, sketch point, or explicit
  coordinates). Setup `Z+` points away from the stock and remains parallel to
  the spindle axis.
- Safe heights live on each operation: `clearance_z` must be above the stock
  top, and `retract_z` must sit between the operation's cut top and its
  clearance plane.
- Rapid moves (`G0`) are always full-speed; there is no configurable "rapid
  feed". The simulator's time estimate uses a fixed internal rapid constant.
- Operations must remain inside the stock range, reference a compatible tool,
  and stay within that tool's flute length.
- Posted programs start in absolute metric XY-plane mode and explicitly cancel
  common modal compensation/cycles. Each duplicated part block re-emits its
  work offset word (`G54`, `G55`, …) before its toolpaths.

The simulator models volumetric remaining stock and flags rapid contact with
that stock, but it does **not** yet check target-part gouging, fixtures, clamps,
shanks, holders, machine travel, tool-change positions, or spindle envelopes.
Built-in posts retract Z to the operation's clearance plane before their
first XY move, but that still assumes a correctly set WCS and machine-safe
starting position.
Every output must be simulated, inspected, and dry-run above the workpiece
before machining.

## 3D simulator architecture: planner, OCCT, and Bevy

The simulator is a headless Rust subsystem, not a feature of either OCCT or a
renderer:

`CAM intent -> neutral CamProgram motion -> voxel removal/collision -> triangle mesh + timeline`

This is the same `CamProgram` consumed by every built-in post and by the
host-neutral event projection. That makes simulation a check on planned CAM
motion instead of a picture reconstructed from controller text.

The stock engine starts from the setup's resolved shape: a fully occupied
voxel grid for box stock, shape-masked grids for cylinder and hex bar stock, a
mesh-voxelized grid for modeled-body stock, or the remainder voxel grid of the
source setup for rest stock. It
tracks occupancy in a bitset, sweeps the active cutter along linear and XY-arc
motions, removes intersected cells on feed moves, and checks rapid moves for
tool contact with remaining stock. Each motion produces a timeline record
containing duration, cumulative time, and removed-cell count. A bounded greedy
surface mesher returns renderer-neutral triangle soup. Default previews are
limited to 750,000 voxels; hard limits are 4,000,000 voxels, 2,000,000 sweep
samples, and 65,536 stock-surface triangles so malformed jobs fail closed
instead of exhausting the host.

OCCT remains the authority for exact CAD B-reps, feature replay, and the target
part. Its tessellated `SolidSceneDto` is transformed from model coordinates
into the setup WCS and drawn translucently over the remaining stock. OCCT is
not currently in the frame-by-frame removal loop: target-part gouge checks,
fixture/holder collisions, and exact target voxelization still need explicit
geometry inputs. Avoiding repeated topology-changing OCCT booleans also keeps
interactive simulation deterministic and bounded.

Bevy remains a presentation layer. The remaining-stock mesh rides the native
viewport's transient triangle channel (alpha-blended, depth-tested) alongside
the toolpath line layers, so the desktop app renders simulation results in the
shared modeling viewport. A dedicated retained Bevy CAM scene and timeline
player can consume the same result later; it should not own material removal
or safety decisions.

## Post-processor ecosystem decision

### We still need a small noBS CAD post boundary

There is no broadly adopted open plug-in ABI that lets a CAM system hand the
same rich job object to proprietary CAM posts, LinuxCNC, Mach, Fanuc, and
SINUMERIK posts.
RS274/NGC is a useful public G-code dialect and the NIST interpreter exposes a
well-documented set of canonical machining functions, but those are a
controller language and interpreter contract rather than a portable CAM post
plug-in API. ISO 14649 / STEP-NC defines a higher-level CNC data model, but it
is not the post ecosystem deployed on the machines targeted here.

noBS CAD therefore owns a deliberately small internal boundary:

`persistent CAM intent -> neutral motion IR -> simulator + post adapters`

That boundary is not intended to invent another public standard. It keeps the
planner and simulator independent of controller syntax, lets built-in posts
remain testable, and gives third-party adapters one stable input.

Public references:

- [NIST RS274/NGC Interpreter](https://www.nist.gov/publications/nist-rs274ngc-interpreter-version-3)
- [LinuxCNC G-code overview](https://linuxcnc.org/docs/html/gcode/overview.html)
- [ISO 14649-1 / STEP-NC overview](https://www.iso.org/standard/34743.html)

### `.nbpost`: the noBS file association for user-supplied posts

The noBS extension is `.nbpost`. A user may deliberately rename a compatible
post they are entitled to use to `.nbpost`; noBS CAD itself does not copy,
convert, redistribute, or silently import third-party post files. Renaming
changes only the local file association. It does not change copyright, license
terms, source syntax, or the script's dependence on its original host runtime.

A callback post is not necessarily standalone JavaScript. It may expect a
host-provided API with section, tool, machine, cycle, property, formatting,
and file-system objects. Renaming a file therefore does not imply that it can
run in noBS CAD.

The implemented v1 `.nbpost` slice is deliberately non-executing:

- accepts UTF-8 `.nbpost` files up to 2 MiB;
- lexes function declarations without evaluating JavaScript;
- detects lifecycle and motion callbacks in the supported shape;
- reports callbacks outside the planned fixed 3-axis v1 surface;
- detects the presence of rights/license notices; and
- keeps the source in memory only—it is not persisted in `.nbcad`.

The UI says **analysis only** and the engine always returns `runnable: false`.
Actual execution must wait for a resource-bounded sandbox, a versioned host
object API, deterministic output capture, and fail-closed handling for every
unsupported callback and controller feature.

The existing adapter also exports a versioned `nbcad-post-events` JSON stream
using the callback names recognized by the analyzer. It is an integration seam,
not a third-party intermediate file and not a `.nbpost` runner.

### Third-party post legal and provenance guardrails

Third-party post files and their host runtimes may be proprietary even when a
user is entitled to run or customize them locally. The native Siemens
implementation here was written from operator-provided NC behavior and public
controller programming documentation, not by copying a third-party post
implementation. This is an engineering policy, not legal advice:

- Do not copy a third-party runtime, intermediate format, or post
  implementation into noBS CAD without a compatible license.
- Treat every supplied post as third-party source until its header, author,
  and license are reviewed. Keep ambiguous files outside the repository.
- Known-good NC output and user-authored behavioral requirements may be stored
  as golden fixtures with the provider's permission; implement resulting post
  behavior independently against public controller documentation.
- If a user owns a custom post and can relicense it, record that provenance in
  the contribution before publishing derived code.
- Do not upload, bundle, publish, or serve a user's post by default. Local
  selection and in-memory execution are materially narrower than distribution.
- Preserve notices. Make the user confirm that they are entitled to use the
  post and that machine output remains their responsibility.
- Use descriptive compatibility wording only after the compatibility suite
  passes—for example, “supports a documented subset of user-supplied callback
  posts.” Do not imply third-party sponsorship or certification and do not use
  third-party logos without permission.

Recommended phases:

1. Validate the new native Siemens 828D reference profile on the actual machine
   using progressively richer known-good programs. It already fails closed
   without an explicit `SUPA` retract profile.
2. Keep safe, testable built-in posts for LinuxCNC, Mach4, Mach3, GRBL, and the
   broad ISO/Fanuc-style baseline. Siemens 828D ISO mode is a distinct tested
   profile, not an alias for Fanuc.
3. Grow the neutral motion IR and post event/metadata projection alongside
   new operations and golden NC fixtures.
4. Implement the `.nbpost` sandbox and minimum callback host API independently
   from public specifications, with per-post compatibility reports and no
   proprietary posts in the repository.
5. Claim compatibility only for fixtures that demonstrate the exact supported
   subset; fail closed on unsupported callbacks, cycles, machine kinematics,
   or file/runtime APIs.

### Siemens 828D native mode versus ISO mode

Treat these as two controller profiles, not aliases. SINUMERIK uses `G290` to
select the native Siemens language and `G291` to select its ISO dialect. The
828D manuals document compatibility differences and state that controller
state such as the active tool, offsets, and work coordinate system survives a
dialect switch. In practice the ISO profile is deliberately Fanuc-like and
will cover many common blocks, but Siemens-specific modal behavior, cycles,
tool calls, and machine-builder M-codes still require an 828D golden test set.

The first production target is native Siemens mode because it can be checked
on the user's real 828D. The ISO/Fanuc-style profile follows as a separate
compatibility target rather than reusing the generic Fanuc post unchanged.

### Current native Siemens 828D contract

The reference profile is calibrated from the supplied known-good MPF and emits
the following independently implemented fixed 3-axis subset:

- `; %_N_<NAME>_MPF` program envelope;
- selected `G54`-`G59`, then `G17 G710 G90 G94` and `G64`;
- profile-controlled tool-change positioning: `SUPA Z`, controller-managed
  `M6`, or `SUPA Z` followed by a verified fixed machine `X/Y` station;
- unnumbered `MSG ("operation")` records;
- tool calls by name (`T="NAME"`, sanitized to a callable identifier), with
  the plain tool number as fallback when a name carries no usable identifier;
- separate `T...`, `M6`, and configured `D...` blocks;
- optional `M1` before the second and later tool changes;
- optional, explicitly enabled next-tool `T...` preload immediately after
  `M6`/`D...`;
- `S... M3/M4`, `M5`, and `M7/M8/M9`;
- absolute XYZ rapid/linear motion, XY-plane `G2/G3` with `I/J`, and native
  `G4 F...` dwell seconds; and
- final `SUPA` retract, tool edge restore, and `M30`.

Sequence numbers, when selected, start at `N10` and advance by one like the
reference MPF. Coordinates use up to five decimal places. Next-tool preload is
safe-off by default; when explicitly enabled, it follows the reference MPF by
staging the next program tool after each `M6`/`D...` and wrapping the last
preload to the first tool when they differ. The post currently omits
`WORKPIECE`, canned `MCALL` cycles, non-XY arcs, cutter compensation blocks, and
all machine-builder/shop macros. In particular,
`SP_RP_D` is the operator's custom spindle-slowdown macro and is intentionally
not emitted by the standard 828D profile. Drilling is expanded into explicit
motions until canned-cycle semantics are separately validated.

#### ATC style is not a motion contract

`SUPA Z0` is a common and attractive convention on 3-axis VMCs whose machine
zero is the fully retracted spindle position, including many double-arm
installations. It is not guaranteed by the 828D or by the visual style of the
changer. Siemens defines tool and pallet change points in the machine
coordinate system, whose zero and physical layout are set by the machine-tool
builder. `SUPA` suppresses frames and offsets for only that block; therefore
`Z0` means the builder's machine-coordinate zero, not a controller-wide ATC
standard.

Siemens documents the same `T...` selection plus `M6` activation contract for
milling machines with chain, rotary-plate, or box magazines and repeatedly
defers configuration details to the machine manufacturer. Manufacturer
documentation reaches the same practical conclusion: Haas publishes a
calibrated Z-axis tool-change offset for both umbrella and side-mount/double-arm
changers. Some controls put that motion inside `M6`; others require or permit a
post/macro to position first.

The Siemens post therefore stores two independent settings:

- **Changer style**: double arm, umbrella/shuttle, carousel/chain/wheel, or
  custom. This changes guidance and the displayed example only; a regression
  test guarantees that it cannot silently change emitted motion.
- **Positioning before `M6`**: `SUPA Z -> M6`, controller/PLC managed, or
  `SUPA Z -> fixed machine X/Y -> M6`. Fixed-station posting fails closed until
  both coordinates are entered. Z always moves first.
- **Allow next-tool T preload**: disabled by default. When disabled, every
  executable `T...` belongs to the `M6` immediately following it. Enabling it
  reproduces the supplied program's `T current -> M6 -> D -> T next` pattern,
  but only for a machine whose manual or known-good output confirms that an
  early `T` call can safely stage the magazine. Carousel/chain/wheel machines
  must not inherit this from their visual style.

The setup inspector renders the exact later-tool-change example for the
selected strategy and includes the following `T...` preload only when enabled.
Examples are templates for comparison with the machine manual and a known-good
program, not universal snippets.

- [Siemens Fundamentals programming guide (G710 metric mode)](https://support.industry.siemens.com/cs/attachments/48013055/PG_0710_en_en-US.pdf)
- [Siemens Fundamentals programming guide (G4 dwell with `F` seconds)](https://support.industry.siemens.com/cs/attachments/108679566/PG_1102_en.pdf)
- [Siemens 828D functions manual (WORKPIECE and CYCLE81 examples)](https://support.industry.siemens.com/cs/attachments/109977633/828D_smte_fct_man_1224_en-US.pdf)
- [Siemens Fundamentals: machine coordinates contain tool/pallet change points](https://support.industry.siemens.com/cs/attachments/57038573/PG_0911_en_en-US.pdf)
- [Siemens 828D NC programming: `T`, `M6`, and machine-builder configuration](https://support.industry.siemens.com/cs/attachments/109823259/828D_ncprogramming_progr_man_0723_en-US.pdf)
- [Haas umbrella changer Z-axis tool-change offset](https://www.haascnc.com/service/online-manuals/mill-tool-changer---service-manual/umbrella-tool-changer---alignment-.html)
- [Haas side-mount/double-arm Z-axis tool-change offset](https://www.haascnc.com/service/online-manuals/mill-tool-changer---service-manual/side-mount-tool-changer---alignment.html)

- [SINUMERIK 828D ISO Milling Programming Manual](https://support.industry.siemens.com/cs/attachments/download/109801226/ONE_840Dsl_828D_iso_milling_progr_man_0721_en-US.pdf)
- [SINUMERIK ISO Dialects Function Manual](https://support.industry.siemens.com/cs/attachments/109813912/ONE_iso_dialects_fct_man_0722_en-US.pdf)

### Why not NX first

Siemens NX Post Configurator and Post Hub are strong industrial systems, but
they are tightly integrated with NX CAM's Machine Output Manager data model and
NX deployment workflow:

- [Siemens Post Hub overview](https://blogs.sw.siemens.com/nx-manufacturing/post-hub-a-cloud-based-postprocessor-solution-for-nx-cam-software/)
- [Siemens Post Configurator introduction](https://blogs.sw.siemens.com/nx-manufacturing/wp-content/uploads/sites/15/2019/09/01_Post-Configurator-Enablement_Introduction.pdf)

That coupling and target audience make NX compatibility substantially more
expensive than the current callback-adapter work. Defer it until the core CAM
model, machine definitions, cycles, and verification layer are mature.

## Next engineering slices

1. Selection-derived contours and drill points from exact BRep faces/edges
   (today the operator picks sketch loops/points or enters coordinates).
2. Second operation wave: thread milling, bore cycles, 3D adaptive clearing,
   and richer drilling cycles (chip-breaking, deep hole, tapping, reaming,
   boring).
3. Exact target-solid voxelization, fixture/tool-holder definitions, gouge and
   collision checking, plus operation-to-operation rest machining.
4. Timeline playback and per-step inspection fed directly from the headless
   simulator; the remaining-stock mesh already renders through the shared
   viewport's transient channel.
5. Tool-length compensation, machine limits, safe tool-change/home policies,
   and configurable controller capabilities.
6. Ramp/helical entries, tabs, lead-in/out, and arc fitting.
7. Parse and simulate final posted NC, compare it with pre-post motion, and add
   per-command inspection plus golden controller tests.
