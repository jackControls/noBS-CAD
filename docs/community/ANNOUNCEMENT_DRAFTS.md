# Announcement drafts

Ready-to-adapt copy for announcing noBS CAD publicly. **Do not post yet** —
work through the checklist at the bottom first.

**Two modes.** Current plan is **release-first**: point people at downloadable
desktop builds (GitHub Releases) instead of a browser demo. A browser demo
remains a later, optional upgrade (the code already supports it). Replace
`[DEMO URL]` with the real try-it link when a demo exists, otherwise use
`[RELEASES URL]` = `https://github.com/jackControls/noBS-CAD/releases`.

---

## Show HN (Hacker News)

**Title options**

- Show HN: noBS CAD — local-first, open-source mechanical CAD (no cloud, no BS)
- Show HN: I'm building a local-first mechanical CAD with a real OCCT kernel
- Show HN: noBS CAD — parametric mechanical CAD that runs entirely on your machine

**Body**

> noBS CAD is a fully local, fully open-source (LGPL) mechanical CAD, built
> around the classic sketch-and-extrude workflow. No account, no cloud, no
> subscription — your models never leave your machine.
>
> Try it: [DEMO URL]
>
> Why another CAD? FreeCAD proved open-source CAD can be serious. We want the
> same honesty with a gentler learning curve and a modern feel — and we're
> pre-alpha, so the real point is to find what breaks.
>
> What's inside:
> - Parametric sketches with dimensions and a constraint solver
> - Extrude, revolve, sweep, loft, rib, hole, fillet, chamfer, shell
> - Modeled ISO metric / Unified hole threads
> - Patterns, mirrors, combine/split, editable feature history, undo
> - `.nbcad` project files (inspectable ZIP) + STEP import / AP242 export
> - A local MCP server so AI agents can drive the model over stdio
>
> Stack: Rust core + OCCT kernel (native via C++ bridge, browser via WASM),
> React shell, Bevy viewport on desktop, Tauri packaging.
>
> **I need your help breaking it.** A young kernel hides bugs in tangent
> faces, thin walls, grazing fillets, self-intersecting sweeps. I've started
> an [edge-case hunt](https://github.com/jackControls/noBS-CAD/issues/45)
> with a challenge list — every report becomes a regression test.
>
> Repo: https://github.com/jackControls/noBS-CAD

---

## Reddit

### r/cad (mechanical/parametric users)

> I've been building a local-first, open-source mechanical CAD: noBS CAD.
> No cloud, no account, no subscription — models stay on your machine. It's
> pre-alpha, built on a real OCCT kernel with the familiar sketch → extrude →
> fillet → hole workflow, plus modeled ISO/Unified threads, patterns,
> combine/split, editable history, and STEP export.
>
> Try it: [DEMO URL]
>
> Pre-alpha means I want you to break it — a challenge list with the nastiest
> geometry cases is pinned in the repo, and every report becomes a regression
> test. What breaks, what's confusing, what's missing? Real parts > feature
> checklists.
>
> https://github.com/jackControls/noBS-CAD

### r/opensource

> noBS CAD is a fully local, fully open-source mechanical CAD (LGPL-2.0+):
> Rust modeling core + OCCT kernel, React UI, Bevy viewport, Tauri desktop,
> WASM browser dev build. No account, no cloud, no telemetry — the `.nbcad`
> project files are plain ZIPs you can inspect.
>
> Try it: [DEMO URL]
>
> It's pre-alpha, and the most useful thing you can do is try to model a real
> part and report what breaks — we turn every report into a regression test.
> There's also a local MCP server so agents can drive the model directly.
>
> https://github.com/jackControls/noBS-CAD

### r/3dprinting (optional — angles toward slicer-ready export)

> Quick heads-up for the 3D printing crowd: noBS CAD, a local-first
> open-source mechanical CAD, now exports 3MF with per-body color/material
> (plus STL/STEP). Built around sketch-and-extrude, free, no cloud, no
> account. Pre-alpha — the point is to find what breaks, so weird-geometry
> challenge list is pinned in the repo.
>
> https://github.com/jackControls/noBS-CAD

### r/freecad (only if comfortable — keep it respectful)

> FreeCAD showed open-source CAD can be serious — thank you for that. Some of
> us are exploring a different take on the same goal: a local-first mechanical
> CAD with a gentler learning curve (noBS CAD). Pre-alpha, LGPL, built on
> OCCT. We're not here to replace anything, just to find what breaks: if you
> model the kind of parts FreeCAD struggles with, your failure reports are
> gold. https://github.com/jackControls/noBS-CAD

---

## Short blurbs (X / Mastodon / Bluesky)

**One-liner**

> noBS CAD — local-first, open-source mechanical CAD. No cloud, no account, no
> BS. Pre-alpha and proud of it: break it on purpose and we'll turn your bug
> into a regression test. [DEMO URL]

**Thread opener (X)**

> 1/ Building noBS CAD: mechanical CAD that runs entirely on your machine.
> Rust core + OCCT kernel, React UI, Bevy viewport, WASM for the browser,
> LGPL. No account, no cloud, no telemetry. [DEMO URL]
>
> 2/ What works: parametric sketches w/ constraint solver, extrude/revolve/
> sweep/loft, fillet/chamfer/shell, modeled ISO+Unified threads, patterns,
> combine/split, editable history, STEP import/export, 3MF with materials.
>
> 3/ Pre-alpha means I need people to break it. A challenge list of nasty
> geometry (thin walls, tangent faces, grazing fillets…) is pinned at
> github.com/jackControls/noBS-CAD/issues/45 — every report becomes a
> regression test. Try it?

---

## Demo script (record as a 60–90 s GIF/video)

Attach to the HN/Reddit posts — a looped GIF showing the whole flow is the
best conversion tool. Record in dark theme with a clean grid.

1. **New project** — File → New, name it (2 s).
2. **Sketch** — rectangle, then a circle inside; add a dimension and a
   constraint; watch the under-constrained/fully-defined state change (15 s).
3. **Extrude** — pick the profile, pull to 20 mm (8 s).
4. **Fillet** — select the top edge ring, radius 3 mm (8 s).
5. **Threaded hole** — M12 hole with modeled threads on the top face (10 s).
6. **Timeline** — drag the fillet before the extrude, watch history recompute
   (8 s).
7. **Export** — File → Export → STEP (or 3MF), show the dialog (6 s).

Total ~60 s. Keep the cursor visible; avoid rapid orbit (motion blur reads as
instability).

---

## Posting checklist

Release-first path:

- [ ] Tag `v0.1.0` and cut a GitHub Release with the macOS `.dmg` + Windows
      portable ZIP attached (merge the assembly branch first, then PR #46).
- [ ] Release notes call out install friction honestly: macOS build is
      ad-hoc signed (right-click → Open past the Gatekeeper warning); Windows
      needs the VC++ x64 Redistributable and WebView2. One sentence each.
- [ ] Replace `[RELEASES URL]` in the drafts with the real releases link.
- [ ] Enable GitHub Discussions (repo Settings → General → Features →
      Discussions) and paste `docs/community/DISCUSSIONS_WELCOME.md` as the
      first post in *General*.
- [ ] Confirm the pinned Edge-case hunt issue
      (https://github.com/jackControls/noBS-CAD/issues/45) is visible on the
      repo front page.
- [ ] Recheck screenshots in `docs/assets/` render correctly (README images).
- [ ] Record the demo GIF per the script above (record on a real part, not a
      test piece); keep it under 2 MB for HN.
- [ ] Post Show HN first (most forgiving audience for pre-alpha), then Reddit
      a few hours later with any fixes learned from HN feedback.
- [ ] Stick around and answer comments — responsiveness is what converts
      curious readers into testers.

Later, optional: deploy the browser demo (the code already supports save/load
and autosave in-browser — see `src/files/fileIO.ts`) and add a Try-it-now
button above the downloads. Until then, the drafts above stand on their own
with `[RELEASES URL]`.
