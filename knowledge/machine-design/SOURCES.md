---
type: Concept
title: Machine-design sources
description: Provenance and license table for distilled versus link-only machine-design help.
status: draft
updated: 2026-09-11
---

# Machine-design sources

Bundled prose in this tree is project content under the repository license
(`LGPL-2.1-or-later`) unless a page says otherwise. **Distill** only from
public-domain or clearly reusable CC BY (and similar) teaching materials.
**Link-only** means cite and send the reader out; do not copy body text.

Never paste ASME Y14.5, ISO 1101, or other standards body text. Prefer
**CC BY / PD / US gov** over NC or SA when building a product help corpus.
ShareAlike derivatives need an explicit license plan before ingest.

## Distill (commercial-friendliest)

| Name | URL | License class | Use | Notes |
|------|-----|---------------|-----|-------|
| NIST / Berez GD&T Part I | https://zenodo.org/records/7647256 | cc-by | distill | Teaching spine for [GD&T intro](concepts/gdt-intro.md) |
| NIST / Berez GD&T Part II | https://zenodo.org/records/8237278 | cc-by | distill | Inspection, implementation, limits & fits |
| NIST MBE PMI CAD models & STEP | https://www.nist.gov/ctl/smart-connected-systems-division/smart-connected-manufacturing-systems-group/mbe-pmi-0 | public-domain | distill | Annotated PMI examples; not a how-to course |
| NWTC LibreTexts Design for Various Manufacturing Methods (Guns) | https://eng.libretexts.org/Courses/Northeast_Wisconsin_Technical_College/Design_for_Various_Manufacturing_Methods | cc-by | distill | Verified CC BY on DFM chapter — strong backbone |
| Design for Manufacture and Assembly (Gagnon & Bearman, PALNI) | https://pressbooks.palni.org/designmanufactureassembly/ | cc-by | distill | DFA principles; do not copy Boothroyd tables |
| DOE Module 3D — DFM / DFA / reliability | https://www.energy.gov/sites/default/files/2021-07/Module_3D.pdf | public-domain | distill | High-level checklists; strip third-party figures |
| NASA Fastener Design Manual | https://ntrs.nasa.gov/citations/19900009424 | public-domain | distill | Joints, torque, locking, fatigue language |
| NASA rolling-element bearing reports | https://ntrs.nasa.gov/citations/19830018943 | public-domain | distill | Geometry, loads, lubrication, life concepts |
| KittyCAD material-properties | https://github.com/KittyCAD/material-properties | apache-2.0 | distill | Seed JSON pattern; not certified allowables |
| Materials Project | https://next-gen.materialsproject.org/ | cc-by | distill | Computed crystalline props; check GNoME BY-NC subset |
| OQMD | https://oqmd.org/ | cc-by | distill | DFT properties complement |
| Crystallography Open Database | https://www.crystallography.net/cod/ | cc0 | distill | Crystal structures |
| Wikimedia Commons GD&T diagrams | https://commons.wikimedia.org/wiki/Category:Geometric_dimensioning_and_tolerancing | varies | distill | Prefer CC0/PD SVGs; check each file |

## Distill with SA or pedagogy care

| Name | URL | License class | Use | Notes |
|------|-----|---------------|-----|-------|
| Introduction to Mechanical Engineering Design (Baughman, Iowa State) | https://iastate.pressbooks.pub/me270baughman/ | cc-by-sa | distill | Design-process modules; SA on derivatives |
| Mechanics Map (Moore et al.) | https://mechanicsmap.org/ | cc-by-sa | distill | Statics/dynamics prerequisites |
| FreeCAD documentation wiki | https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/License.md | cc-by | link-only / pattern | Help-page voice; do not fork wholesale |
| Wikipedia GD&T | https://en.wikipedia.org/wiki/Geometric_dimensioning_and_tolerancing | cc-by-sa | distill | Summarize; SA if substantial text reuse |

## Link-only (NC, proprietary, or murky)

| Name | URL | License class | Use | Notes |
|------|-----|---------------|-----|-------|
| UArk Jensen, Introduction to Mechanical Design and Manufacturing | https://uark.pressbooks.pub/mechanicaldesign/ | cc-by-nc | link-only | Excellent DFM survey; NC blocks default bundling |
| MIT OCW 2.72 Elements of Mechanical Design | https://ocw.mit.edu/courses/2-72-elements-of-mechanical-design-spring-2009/ | cc-by-nc-sa | link-only | Mechanisms, gears, bearings |
| MIT OCW 2.007 / 2.008 Design and Manufacturing | https://ocw.mit.edu/courses/2-007-design-and-manufacturing-i-spring-2009/ | cc-by-nc-sa | link-only | Design + process physics |
| Strength of Materials (Virginia Tech) | https://engineeringmechanicsoer.github.io/StrengthBook/ | cc-by-nc-sa | link-only | SoM depth; check figures |
| Engineering Graphics and Design (Ford, UW Tacoma) | https://uw.pressbooks.pub/enggraphics/ | cc-by-nc-sa | link-only | Drawing + intro GD&T |
| LibreTexts Machine Design (Cal Poly Humboldt) | https://eng.libretexts.org/Courses/California_State_Polytechnic_University_Humboldt/Mechanics_and_Science_of_Materials/Machine_Design | link-only | link-only | Verify page license before any excerpt |
| NASA GSFC Drawing Standards Manual (1994) | https://s3vi.ndc.nasa.gov/ssri-kb/static/resources/NASA%20GSFC-X-673-64-1F.pdf | public-domain | link-only | Historical; outdated vs ASME Y14.5-2018 |
| ASME Y14.5 / Y14.41 / Y14.46 | https://www.asme.org/codes-standards | proprietary | link-only | Purchase/read; never copy |
| ISO 1101 and GPS (ISO/TC 213) | https://www.iso.org/committee/54924.html | proprietary | link-only | GPS counterpart to ASME GD&T |
| MatWeb / MakeItFrom | vendor sites | proprietary | link-only | No scrape; MakeItFrom sells datapoints |
| Onshape / SolidWorks / Autodesk help | vendor sites | proprietary | link-only | Paraphrase concepts only |
| Boothroyd-Dewhurst DFA tables | proprietary | proprietary | link-only | Do not reproduce |

## In-repo recipe cross-links

Construction sources on this stack (not third-party text):
`fillet-basics`, `mounting-plate`, `revolved-spacer`, `angle-bracket`,
`repeated-bracket-assembly`, `garden-bench`, `d-screw-vise`,
`d-screw-vise-fit`, `vertical-axis-turbine`, `turbine-fit-coupons`.
