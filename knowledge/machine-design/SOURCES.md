---
type: Concept
title: Machine-design sources
description: Provenance table with stable ids for concept frontmatter sources keys.
status: draft
updated: 2026-09-20
searchable: false
---

# Machine-design sources

Bundled prose is project content under `LGPL-2.1-or-later` unless a page says
otherwise. **Distill** only from public-domain or CC BY (and similar).
**Link-only** means cite and send the reader out — prefer distill + URL over copying body text.

Concept frontmatter `sources:` values **must** match an `id` below.
Prefer purchase/read + citation for ASME Y14.5, ISO 1101, and other standards; keep body text outside the corpus.
ShareAlike (SA) sources stay **link-only** until maintainers decide SA policy.

Policy narrative: [`docs/machine-design-distill-vs-link.md`](https://github.com/jackControls/noBS-CAD/blob/docs/machine-design-kb/docs/machine-design-distill-vs-link.md)
(GitHub blob — not available on the Pages-only artifact).

## Distill (commercial-friendliest)

| id | Name | URL | License | Notes |
|----|------|-----|---------|-------|
| `nist-gdt-1` | NIST / Berez GD&T Part I | https://zenodo.org/records/7647256 | cc-by-4.0 | Teaching spine for GD&T intro |
| `nist-gdt-2` | NIST / Berez GD&T Part II | https://zenodo.org/records/8237278 | cc-by-4.0 | Inspection, implementation, limits & fits teaching |
| `nist-pmi` | NIST MBE PMI CAD models & STEP | https://www.nist.gov/ctl/smart-connected-systems-division/smart-connected-manufacturing-systems-group/mbe-pmi-0 | public-domain | Annotated PMI examples; not a how-to course |
| `nwtc-guns-dfm` | NWTC LibreTexts DFM (Guns) | https://eng.libretexts.org/Courses/Northeast_Wisconsin_Technical_College/Design_for_Various_Manufacturing_Methods | cc-by-4.0 | [Ch.1 DFM](https://eng.libretexts.org/Courses/Northeast_Wisconsin_Technical_College/Design_for_Various_Manufacturing_Methods/01%3A_Design_for_Manufacturing_(DFM)), [Ch.2 processes](https://eng.libretexts.org/Courses/Northeast_Wisconsin_Technical_College/Design_for_Various_Manufacturing_Methods/02%3A_DFM_Guidelines_for_Specific_Manufacturing_Processes); license https://creativecommons.org/licenses/by/4.0/ |
| `palni-dfma` | PALNI Design for Manufacture and Assembly | https://pressbooks.palni.org/designmanufactureassembly/ | cc-by-4.0 | DFA principles; prefer distill + link over Boothroyd tables |
| `doe-3d` | DOE Module 3D DFM/DFA/reliability | https://www.energy.gov/sites/default/files/2021-07/Module_3D.pdf | public-domain | High-level checklists; strip third-party figures |
| `technic-scad` | Technic.scad (cfinke) | https://github.com/cfinke/Technic.scad | mit | Print-oriented beam/pin constants (≈8 mm pitch, ~4.85 mm hole); compatible intent, not a LEGO drawing |
| `nasa-fastener` | NASA Fastener Design Manual (RP-1228) | https://ntrs.nasa.gov/citations/19900009424 | public-domain | Preload/torque/lube/grip distill OK; **no** paste of torque tables into Help |
| `nasa-bearing` | NASA rolling-element bearing reports | https://ntrs.nasa.gov/citations/19830018943 | public-domain | Confirm each NTRS record |
| `kittycad-materials` | KittyCAD material-properties | https://github.com/KittyCAD/material-properties | apache-2.0 | JSON pattern; not certified allowables |
| `materials-project` | Materials Project | https://next-gen.materialsproject.org/ | cc-by-4.0 | Computed crystalline props; exclude GNoME BY-NC |
| `oqmd` | OQMD | https://oqmd.org/ | cc-by-4.0 | DFT complement |
| `cod` | Crystallography Open Database | https://www.crystallography.net/cod/ | cc0 | Crystal structures |
| `commons-gdt` | Wikimedia Commons GD&T diagrams | https://commons.wikimedia.org/wiki/Category:Geometric_dimensioning_and_tolerancing | varies | Prefer CC0/PD; check each file |
| `ldraw-ffs` | LDraw File Format Specification (LDU) | https://www.ldraw.org/article/218.html | open-spec (LDraw.org) | LDU definition + brick/plate/stud LDU table; real-world 0.4 mm approx; distill numbers, do not paste large format prose |
| `ldraw-opls` | LDraw Official Parts Library Specifications | https://www.ldraw.org/article/512.html | open-spec (LDraw.org) | 1 stud = 20 LDU dimension language; library authoring rules — cite, thin paraphrase |

## Link-only (NC, SA, proprietary, murky)

| id | Name | URL | License | Notes |
|----|------|-----|---------|-------|
| `uark-jensen` | UArk Jensen Mechanical Design & Manufacturing | https://uark.pressbooks.pub/mechanicaldesign/ | cc-by-nc | Excellent survey; NC |
| `mit-272` | MIT OCW 2.72 Elements of Mechanical Design | https://ocw.mit.edu/courses/2-72-elements-of-mechanical-design-spring-2009/ | cc-by-nc-sa | Mechanisms, gears, bearings |
| `mit-2007` | MIT OCW 2.007 / 2.008 | https://ocw.mit.edu/courses/2-007-design-and-manufacturing-i-spring-2009/ | cc-by-nc-sa | Design + process physics |
| `vt-strength` | VT Strength of Materials | https://engineeringmechanicsoer.github.io/StrengthBook/ | cc-by-nc-sa | SoM depth |
| `ford-graphics` | Ford Engineering Graphics and Design | https://uw.pressbooks.pub/enggraphics/ | cc-by-nc-sa | Drawing + intro GD&T |
| `libretexts-machine-design` | LibreTexts Machine Design (Cal Poly Humboldt) | https://eng.libretexts.org/Courses/California_State_Polytechnic_University_Humboldt/Mechanics_and_Science_of_Materials/Machine_Design | verify | Default link-only until page license verified |
| `nasa-gsfc-drawings-1994` | NASA GSFC Drawing Standards Manual (1994) | https://s3vi.ndc.nasa.gov/ssri-kb/static/resources/NASA%20GSFC-X-673-64-1F.pdf | public-domain | Historical; outdated vs Y14.5-2018 |
| `baughman-me270` | Baughman Iowa State ME design | https://iastate.pressbooks.pub/me270baughman/ | cc-by-sa | **Link-only** until SA policy |
| `mechanics-map` | Mechanics Map | https://mechanicsmap.org/ | cc-by-sa | **Link-only** until SA policy |
| `wikipedia-gdt` | Wikipedia GD&T | https://en.wikipedia.org/wiki/Geometric_dimensioning_and_tolerancing | cc-by-sa | Short paraphrase only; large reuse → SA |
| `freecad-wiki` | FreeCAD documentation wiki | https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/License.md | cc-by-3.0 | Pattern reference; prefer cite over fork |
| `asme-y14` | ASME Y14.5 / Y14.41 / Y14.46 | https://www.asme.org/codes-standards | proprietary | Purchase/read; link-out |
| `iso-gps` | ISO 1101 / GPS (ISO/TC 213) | https://www.iso.org/committee/54924.html | proprietary | Link-out |
| `iso-286` | ISO 286 / preferred fits | https://www.iso.org/ | proprietary | Link-out fit charts |
| `asme-b4` | ASME B4.x preferred fits | https://www.asme.org/codes-standards | proprietary | Preferred-fit *purposes* taught via NIST only with hard fence |
| `matweb` | MatWeb | vendor | proprietary | No scrape |
| `makeitfrom` | MakeItFrom | vendor | proprietary | No scrape |
| `boothroyd` | Boothroyd-Dewhurst DFA tables | proprietary | proprietary | Link-out only |
| `vendor-cad-help` | Onshape / SolidWorks / Autodesk help | vendor | proprietary | Paraphrase only |
| `prusa-kb` | Prusa Knowledge Base (design/print notes) | https://help.prusa3d.com/ | vendor | **Link-only**; material/profile specific — not a universal mm chart |
| `stegu-ldu` | Empirical findings regarding the length of 1 LDU (Gustafsson) | https://itn-web.it.liu.se/~stegu76/lego/LDUlength.pdf | verify | Community metrology note; **link-only** until license confirmed |
| `cailliau-lego-dims` | Cailliau — Lego Dimensions (reverse-engineering notes) | https://www.cailliau.org/Alphabetical/L/Lego/Dimensions/ | verify | Independent RE narrative; **link-only** (verify license before distill) |

## In-repo recipe ids (not third-party text)

`fillet-basics`, `mounting-plate`, `revolved-spacer`, `angle-bracket`,
`repeated-bracket-assembly`, `garden-bench`, `d-screw-vise`,
`d-screw-vise-fit`, `vertical-axis-turbine`, `turbine-fit-coupons`.
