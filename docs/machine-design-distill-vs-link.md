# Distill vs link — machine-design knowledge

Policy for `knowledge/machine-design/`. Branch work only; no PR required.
Verified as of 2026-09-11 unless noted.

## The rule in one sentence

**We write our own thin help pages**, grounded in sources we may adapt
(**distill**), and we **link out** to excellent books, courses, and standards
when the license forbids copying or when the primary artifact *is* the
external document.

Distill ≠ paste. Distill means: read the open source, rewrite concepts in
noBS CAD voice, attribute, and keep pages thin. Link means: cite URL + why
it is good; do not ingest body text or figures.

## Why this split exists

noBS CAD ships under `LGPL-2.1-or-later`. Help in-repo is product content.
If we copy **CC BY-NC** or **CC BY-NC-SA** text into the app’s knowledge
bundle, we risk treating noncommercial material as part of a general product
distribution. Safer default: **distill only PD / US-gov / CC BY / Apache /
CC0**, and treat NC and proprietary materials as first-class **links**.

ShareAlike (CC BY-SA) is usable but sticky: substantial remix may require
releasing that article under SA. Prefer BY/PD for the spine; use SA only
when we are ready to label those pages.

## What we distill (write our own pages from these)

These are the **spine**. Attribution goes in page frontmatter / SOURCES.

| Topic | Source | License (verified) | How we use it |
|-------|--------|--------------------|---------------|
| GD&T concepts | NIST/Berez Parts I & II (Zenodo) | **CC BY 4.0** (API: `cc-by-4.0`) | Teaching spine for datums, FCFs, form/orientation/location; never paste ASME tables |
| PMI examples | NIST MBE PMI CAD / STEP sets | US gov / unrestricted NIST data | Example models and PMI shapes for demos; not a GD&T textbook |
| DFM principles | NWTC LibreTexts — Design for Various Manufacturing Methods (Guns) | **CC BY 4.0** (page footer) | Process DFM chapters; their generalized DFA times are OK; still skip Boothroyd proprietary tables |
| DFA principles | PALNI — Design for Manufacture and Assembly (Gagnon & Bearman) | **CC BY 4.0** | Part-count, orientation, snap-fit heuristics |
| DFM checklist tone | DOE Module 3D (DFM/DFA/reliability) | US gov work | High-level checklists; strip third-party figures |
| Fasteners / joints | NASA RP-1228 Fastener Design Manual | **US gov — public use permitted** (NTRS) | Preload, locking, materials, torque language |
| Bearings (fundamentals) | NASA NTRS rolling-element reports | US gov / public use (per record) | Geometry, loads, lubrication, life concepts |
| Materials JSON pattern | KittyCAD `material-properties` | **Apache-2.0** | Schema/pattern for common CAD materials — not certified allowables |
| Computed materials (optional depth) | Materials Project (default), OQMD, COD | **CC BY 4.0** / **CC BY 4.0** / **CC0** | Optional property lookups; **exclude GNoME** (BY-NC) |
| Diagrams / symbols | Wikimedia Commons (file-by-file) | Prefer **CC0 / PD** | Icons and diagrams only after per-file license check |

Also distill from **our own recipes** on this stack (`turbine-fit-coupons`,
`d-screw-vise`, etc.): captions and checks are already project content.

## What we link (great places — do not copy)

Link freely. Agents and humans should be sent here for depth.

| Topic | Source | License / status | Why link, not copy |
|-------|--------|------------------|--------------------|
| Full design+manufacturing survey | UArk Jensen — Intro to Mechanical Design and Manufacturing | **CC BY-NC 4.0** | Excellent structure; NC blocks default product bundling |
| Machine elements lectures | MIT OCW 2.72 Elements of Mechanical Design | **CC BY-NC-SA** | Best open lecture set for shafts/gears/cams; NC+SA |
| Design / manufacturing courses | MIT OCW 2.007 / 2.008 | **CC BY-NC-SA** | Pedagogy and process physics |
| Strength of materials | Virginia Tech Strength of Materials OER | **CC BY-NC-SA** | Deep SoM; figures need care |
| Engineering graphics / intro GD&T | Ford — Engineering Graphics and Design (UW Tacoma) | **CC BY-NC-SA** | Drawing pedagogy |
| Design process modules | Baughman — Intro to ME Design (Iowa State) | Reported **CC BY-SA**; reconfirm page before heavy use | Good process outline; SA may force article-level SA |
| LibreTexts Machine Design (Humboldt) | Steimel et al. | Per-page; treat as link until verified BY | Useful chapters; license varies by LibreTexts page |
| NASA GSFC drawing manual (1994) | X-673-64-1F | US gov, but **outdated** vs Y14.5-2018 | Historical interest only; do not teach as current |
| **Contractual standards** | ASME Y14.5 / Y14.41 / Y14.46; ISO 1101 / GPS / ISO 286 | Proprietary | Buy/read; never OCR or paste |
| Property websites | MatWeb, MakeItFrom | Proprietary ToS | Browse/link; no scrape |
| Vendor CAD help | Onshape, SolidWorks, Autodesk | Proprietary | Paraphrase concepts; do not copy UI help |
| Proprietary DFA tables | Boothroyd-Dewhurst | Proprietary | Guns/PALNI already avoid verbatim tables — we do too |
| FreeCAD / OpenSCAD docs | Wiki / manuals | CC BY / BY-SA | Pattern reference; link rather than fork |

## How an article should behave

1. **Concept in our words** (thin OKF page).
2. **Attribution** to distill sources used.
3. **Further reading** links to NC courses and purchased standards.
4. **Recipe id** when a live viewport example exists.
5. **Disclaimer**: educational; not allowables; not a substitute for the standard.

## Mapping to noBS CAD topics

| KB area | Distill from | Link out to |
|---------|--------------|-------------|
| GD&T | NIST/Berez + Commons symbols | ASME Y14.5 purchase; Ford graphics (NC); Wikipedia summary |
| Fits | Our coupon recipes + NIST Part II fits teaching | ISO 286 / ANSI preferred-fit charts (proprietary) |
| Fasteners | NASA RP-1228 | Vendor catalogs; grade standards |
| DFM/DFA | Guns (BY) + PALNI (BY) + DOE | Jensen (NC); MIT 2.008 (NC-SA) |
| Materials vocab | KittyCAD pattern + our filament catalog distinction | MatWeb/MakeItFrom; Materials Project for computed depth |
| Mechanisms | Our assembly joints + turbine recipe | MIT 2.72 / 2.007 (NC-SA) |
| SoM / sizing | Short self-written primers only if needed | VT Strength book; MIT 3.11 (NC-SA) |

## Escape hatch

MCP/local help first. If the answer is not in the bundle, **search the web**
and return citations — still without pasting proprietary standard text into
the repo.

## Decision we are locking

- **Distill spine** = NIST GD&T + PMI, NWTC Guns DFM, PALNI DFMA, NASA fasteners, KittyCAD materials pattern, Commons (checked files).
- **Link shelf** = UArk, MIT OCW, VT SoM, Ford graphics, ASME/ISO, MatWeb/MakeItFrom, vendor help.
- **Baughman / SA texts** = link by default until we deliberately accept SA on specific pages.
