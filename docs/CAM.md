# 3-axis CAM foundation

This branch starts a host-neutral, fixed-axis CAM module for common 3-axis
milling workflows. It is an engineering foundation, not yet a claim of
production-safe CAM.

## As-built scope

- Persistent manufacturing intent in `.nbcad`: setups, WCS, G54-G59 work
  offset, rectangular stock, tool library, cutting parameters, operations, and
  post settings.
- Deterministic controller-neutral motion planning in millimetres.
- Face, closed 2D contour, and point-drilling operations.
- Multiple depth passes, contour side compensation, stepover, stepdown, and
  peck drilling.
- Built-in conservative posts for GRBL, LinuxCNC, a generic Fanuc-style
  subset, and a native Siemens 828D reference profile with an explicitly
  confirmed machine-coordinate `SUPA` retract.
- A `.nbpost` file contract and non-executing callback-post analyzer.
  Script execution is not implemented yet and therefore cannot generate NC.
- A bounded, deterministic 3D voxel stock simulator that consumes the same
  neutral motion IR as the post layer, records per-command removal/time,
  detects rapid/tool contact with remaining stock, and greedily extracts a
  renderer-neutral remaining-stock surface mesh.
- A React manufacturing workspace with a setup/operation browser, parameter
  inspectors, interactive orbitable 3D remaining-stock preview, distance/time
  estimates, warnings, NC export, and neutral post-event export.

The Rust crate at `crates/cam/` owns validation, path generation, motion IR,
posting, and post-event projection. The React code under `src/cam/` and
`src/components/cam/` edits intent and visualizes generated motion. As with
drawings, generated tool motion is not persisted; it is regenerated from the
saved CAM intent.

## Coordinate and safety contract

- All persisted dimensions and motion coordinates are millimetres.
- Each setup has an orthonormal, right-handed WCS. Setup `Z+` points away from
  the stock and remains parallel to the spindle axis.
- `clearance_z` must be above `retract_z`, and both must be above stock top.
- Operations must remain inside the stock range, reference a compatible tool,
  and stay within that tool's flute length.
- Posted programs start in absolute metric XY-plane mode and explicitly cancel
  common modal compensation/cycles.

The simulator models volumetric remaining stock and flags rapid contact with
that stock, but it does **not** yet check target-part gouging, fixtures, clamps,
shanks, holders, machine travel, tool-change positions, or spindle envelopes.
Built-in posts retract Z to setup clearance before their first XY move,
but that still assumes a correctly set WCS and machine-safe starting position.
Every output must be simulated, inspected, and dry-run above the workpiece
before machining.

## 3D simulator architecture: planner, OCCT, and Bevy

The simulator is a headless Rust subsystem, not a feature of either OCCT or a
renderer:

`CAM intent -> neutral CamProgram motion -> voxel removal/collision -> triangle mesh + timeline`

This is the same `CamProgram` consumed by every built-in post and by the
host-neutral event projection. That makes simulation a check on planned CAM
motion instead of a picture reconstructed from controller text.

The first stock engine starts with a fully occupied rectangular voxel grid. It
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

Bevy remains a presentation layer. The stock result already uses the same
packed triangle shape accepted by the native transient rendering path, but the
CAM workspace currently renders it with an orbitable React canvas so the
desktop, browser/WASM, and automated-test paths share behavior. A dedicated
retained Bevy CAM scene and timeline player can consume the same result later;
it should not own material removal or safety decisions.

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

1. Selection-derived contours and drill points from exact BRep faces/edges.
2. Exact target-solid voxelization, fixture/tool-holder definitions, gouge and
   collision checking, plus operation-to-operation rest machining.
3. Dedicated retained Bevy CAM scene and timeline playback fed directly from
   the headless simulator; the current canvas consumes the same stock mesh as
   a cross-platform presentation path.
4. Tool-length compensation, machine limits, safe tool-change/home policies,
   and configurable controller capabilities.
5. Pockets, adaptive clearing, ramp/helical entries, tabs, lead-in/out, canned
   drill cycles, and arc fitting.
6. Parse and simulate final posted NC, compare it with pre-post motion, and add
   per-command inspection plus golden controller tests.
