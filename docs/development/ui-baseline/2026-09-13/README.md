# Current desktop interface: visual baseline

These are real, unretouched Windows desktop captures from the clean rebuilt binary at `eccdc9402f10c76ec91392b135b4a2d12eecfb6d` (2026-09-13). This baseline includes CAM and always-on local stdio MCP from the integration branch. It is the comparison point for [the full Bevy conversion](../../../adr/0003-bevy-interface.md), not screenshots of the replacement.

The capture window was owned by this task. Other CAD windows and their documents were preserved. Navigation and model construction used MCP; the native capture service recorded the rendered window. Native file and print dialogs required native input because they block the current WebView automation route.

All primary areas are represented: shell/files/settings, parametric solid features, sketch editing, assemblies/motion, drawings, CAM, and scripts/presentations. The [source inventory and acceptance checklist](../../ui-parity-baseline.md) also tracks alternate modes, inaccessible states and platform behavior that pictures cannot prove. **This is visual baseline coverage, not a completed parity or exhaustive behavioral test claim.**

## How to use the evidence

Expand a capture below to see the full window. Its notes distinguish completed interactions from pending previews, deliberate cancellations and actual failures. Matching `.controls.json` files are MCP inspections/action receipts from the same route. A few immediate receipts precede lazy form mounting; the image is authoritative for what actually painted. Native dialogs are outside that control tree. The [manifest](captures.json) retains timestamps and image dimensions; no image has been cropped to conceal a surrounding failure.

The interface uses a dark theme and English labels. Captured full-window size is 1442 × 932 pixels unless the manifest says otherwise. Display scaling was not independently recorded. macOS/Linux visual behavior, alternative themes/locales, high-DPI and narrow-window behavior remain explicit follow-up acceptance work.

## Reopenable fixtures

- [Model, drawing and CAM setup](model-drawing-cam.nbcad): the `fillet-basics` recipe's constrained 60 × 30 mm sketch, 12 mm extrusion and 2 mm rim fillet; an ISO A4 drawing with associative section/dimension and annotation examples; one valid facing operation with a project-local 6 mm cutter. The Siemens machine snapshot is illustrative. No NC program was posted or machine behavior certified.
- [Assembly, motion and sketch fixture](assembly-motion.nbcad): `repeated-bracket-assembly`, a saved position and motor-driven motion study, plus a separate 30 × 20 mm sketch used to inspect pattern and dimension tools. The exact interference panel reports a plate/spacer overlap. This is intentionally retained as captured evidence, not promoted as a manufacturing example.

The drawing annotations deliberately share nearby anchors to expose their different inspectors. Their crowded placement is not a polished drawing. The auto-layout/title-block overlap, invisible material panel, clipped nested menus, unnamed controls, invalid Face default and footer overlap are recorded in the acceptance checklist and captions.

## Captures

### Shell, files, settings and export

<details>
<summary>01-solid-blank</summary>

Fresh document, solid ribbon, browser, viewport, navigation and timeline.

![01-solid-blank](01-solid-blank.jpg)

[MCP inspection / action receipt](01-solid-blank.controls.json)

</details>

<details>
<summary>02-file-menu</summary>

File popup with project lifecycle, import/export, Settings and Exit. No Help panel is implemented in this baseline.

![02-file-menu](02-file-menu.jpg)

[MCP inspection / action receipt](02-file-menu.controls.json)

</details>

<details>
<summary>03-settings</summary>

Settings dialog, appearance, locale and native navigation speed.

![03-settings](03-settings.jpg)

[MCP inspection / action receipt](03-settings.controls.json)

</details>

<details>
<summary>04-settings-cam</summary>

Partially scrolled Settings showing the CAM library section; complete storage/post controls are captured in 125.

![04-settings-cam](04-settings-cam.jpg)

</details>

<details>
<summary>124-settings-posts</summary>

Settings opened from CAM post management.

![124-settings-posts](124-settings-posts.jpg)

[MCP inspection / action receipt](124-settings-posts.controls.json)

</details>

<details>
<summary>125-settings-cam-storage</summary>

Settings CAM library location and custom post storage, fully scrolled into view.

![125-settings-cam-storage](125-settings-cam-storage.jpg)

[MCP inspection / action receipt](125-settings-cam-storage.controls.json)

</details>

<details>
<summary>127-file-menu-populated</summary>

File menu for saved model containing drawing and CAM data.

![127-file-menu-populated](127-file-menu-populated.jpg)

[MCP inspection / action receipt](127-file-menu-populated.controls.json)

</details>

<details>
<summary>128-project-rename</summary>

Blocking browser prompt for project rename; it prevents live MCP acknowledgement until dismissed. Native replacement needs inspectable modal input.

![128-project-rename](128-project-rename.jpg)

[MCP inspection / action receipt](128-project-rename.controls.json)

</details>

<details>
<summary>129-save-picker</summary>

Native Save As dialog, NBCAD project filter, default document name, Save and Cancel. Folder was navigated to the baseline fixture directory; this picker was cancelled without writing.

![129-save-picker](129-save-picker.jpg)

[MCP inspection / action receipt](129-save-picker.controls.json)

</details>

<details>
<summary>153-drawing-file-menu</summary>

Drawing-specific File menu adds active drawing DXF and exact 1:1 manufacturing-profile export beside common model exports.

![153-drawing-file-menu](153-drawing-file-menu.jpg)

[MCP inspection / action receipt](153-drawing-file-menu.controls.json)

</details>

<details>
<summary>154-manufacturing-profile</summary>

Manufacturing-profile export chooses an exact sketch region and previews its outer/hole wires at local sketch-plane millimetres. No export performed.

![154-manufacturing-profile](154-manufacturing-profile.jpg)

[MCP inspection / action receipt](154-manufacturing-profile.controls.json)

</details>

<details>
<summary>155-drawing-print</summary>

Native WebView print preview for the actual sheet: printer, layout, pages, color and duplex options. Defaults show a landscape sheet fitted on portrait paper; no print was sent.

![155-drawing-print](155-drawing-print.jpg)

[MCP inspection / action receipt](155-drawing-print.controls.json)

</details>


### Scripts and presentations

<details>
<summary>05-scripts</summary>

Script library: recipes, lessons, open file and run/presentation entry points.

![05-scripts](05-scripts.jpg)

[MCP inspection / action receipt](05-scripts.controls.json)

</details>

<details>
<summary>06-script-details</summary>

Recipe overview while isolated preview preparation is pending.

![06-script-details](06-script-details.jpg)

[MCP inspection / action receipt](06-script-details.controls.json)

</details>

<details>
<summary>07-script-ready</summary>

Loaded recipe with isolated rendered preview and per-step teaching notes.

![07-script-ready](07-script-ready.jpg)

[MCP inspection / action receipt](07-script-ready.controls.json)

</details>

<details>
<summary>08-script-source</summary>

Readable JSONC source, editable recipe workflow, run mode and speed.

![08-script-source](08-script-source.jpg)

[MCP inspection / action receipt](08-script-source.controls.json)

</details>

<details>
<summary>09-script-playing</summary>

Recipe playback in a new document with calm captions and live construction controls.

![09-script-playing](09-script-playing.jpg)

</details>

<details>
<summary>10-script-sketch-live</summary>

Completed recipe: parametric solid, retained sketch, three-feature timeline and completion caption.

![10-script-sketch-live](10-script-sketch-live.jpg)

</details>

<details>
<summary>130-assembly-replay</summary>

Repeated bracket recipe completed 84/84 steps in a new tab. Script library and playback footer coexist; final model is cropped while the library remains open.

![130-assembly-replay](130-assembly-replay.jpg)

[MCP inspection / action receipt](130-assembly-replay.controls.json)

</details>

<details>
<summary>151-script-draft</summary>

Edited source draft disables chapter navigation until validated. Source field is scrolled into view; action buttons below it are partly hidden behind the fixed run footer.

![151-script-draft](151-script-draft.jpg)

[MCP inspection / action receipt](151-script-draft.controls.json)

</details>

<details>
<summary>152-script-unsaved</summary>

Opening another recipe with edited source prompts Save, Don’t Save or Cancel, explicitly preserving the CAD document.

![152-script-unsaved](152-script-unsaved.jpg)

[MCP inspection / action receipt](152-script-unsaved.controls.json)

</details>


### Solid modeling, feature forms and references

<details>
<summary>11-solid-model</summary>

Built parametric model with browser tree and feature timeline; script panel closed.

![11-solid-model](11-solid-model.jpg)

[MCP inspection / action receipt](11-solid-model.controls.json)

</details>

<details>
<summary>12-extrude-edit</summary>

Editing an existing extrusion with semantic preview, direction, extent and boolean controls.

![12-extrude-edit](12-extrude-edit.jpg)

[MCP inspection / action receipt](12-extrude-edit.controls.json)

</details>

<details>
<summary>13-extrude-two-sides</summary>

Extrude two-sided extent fields and signed preview.

![13-extrude-two-sides](13-extrude-two-sides.jpg)

[MCP inspection / action receipt](13-extrude-two-sides.controls.json)

</details>

<details>
<summary>14-fillet</summary>

Existing edge fillet edit: selected edges, radius and retained feature preview.

![14-fillet](14-fillet.jpg)

[MCP inspection / action receipt](14-fillet.controls.json)

</details>

<details>
<summary>15-revolve</summary>

Revolve command form and model selection context.

![15-revolve](15-revolve.jpg)

[MCP inspection / action receipt](15-revolve.controls.json)

</details>

<details>
<summary>16-sweep</summary>

Sweep command form and model selection context.

![16-sweep](16-sweep.jpg)

[MCP inspection / action receipt](16-sweep.controls.json)

</details>

<details>
<summary>17-loft</summary>

Loft prerequisite guard with insufficient sketches; full form is captured in 141.

![17-loft](17-loft.jpg)

[MCP inspection / action receipt](17-loft.controls.json)

</details>

<details>
<summary>18-rib</summary>

Rib command form and model selection context.

![18-rib](18-rib.jpg)

[MCP inspection / action receipt](18-rib.controls.json)

</details>

<details>
<summary>19-hole</summary>

Hole command form and model selection context.

![19-hole](19-hole.jpg)

[MCP inspection / action receipt](19-hole.controls.json)

</details>

<details>
<summary>20-external-thread</summary>

External Thread command form and current model context.

![20-external-thread](20-external-thread.jpg)

[MCP inspection / action receipt](20-external-thread.controls.json)

</details>

<details>
<summary>21-chamfer</summary>

Chamfer command form and current model context.

![21-chamfer](21-chamfer.jpg)

[MCP inspection / action receipt](21-chamfer.controls.json)

</details>

<details>
<summary>22-shell</summary>

Shell command form and current model context.

![22-shell](22-shell.jpg)

[MCP inspection / action receipt](22-shell.controls.json)

</details>

<details>
<summary>23-mirror</summary>

Mirror command form and current model context.

![23-mirror](23-mirror.jpg)

[MCP inspection / action receipt](23-mirror.controls.json)

</details>

<details>
<summary>24-rectangular-pattern</summary>

Settled rectangular body pattern form on the assembly fixture: body/reference selection, direction vector, spacing/count and optional second direction. No pattern committed.

![24-rectangular-pattern](24-rectangular-pattern.jpg)

[MCP inspection / action receipt](24-rectangular-pattern.controls.json)

</details>

<details>
<summary>25-circular-pattern</summary>

Circular Pattern command form and current model context.

![25-circular-pattern](25-circular-pattern.jpg)

[MCP inspection / action receipt](25-circular-pattern.controls.json)

</details>

<details>
<summary>26-move-copy</summary>

Move/Copy form with model selection, values and acceptance state.

![26-move-copy](26-move-copy.jpg)

[MCP inspection / action receipt](26-move-copy.controls.json)

</details>

<details>
<summary>27-combine</summary>

Combine form with model selection, values and acceptance state.

![27-combine](27-combine.jpg)

[MCP inspection / action receipt](27-combine.controls.json)

</details>

<details>
<summary>28-split-body</summary>

Split Body form with model selection, values and acceptance state.

![28-split-body](28-split-body.jpg)

[MCP inspection / action receipt](28-split-body.controls.json)

</details>

<details>
<summary>29-offset-plane</summary>

Offset Plane form with model selection, values and acceptance state.

![29-offset-plane](29-offset-plane.jpg)

[MCP inspection / action receipt](29-offset-plane.controls.json)

</details>

<details>
<summary>30-midplane</summary>

Midplane form with model selection, values and acceptance state.

![30-midplane](30-midplane.jpg)

[MCP inspection / action receipt](30-midplane.controls.json)

</details>

<details>
<summary>31-joint</summary>

Joint form with model selection, values and acceptance state.

![31-joint](31-joint.jpg)

[MCP inspection / action receipt](31-joint.controls.json)

</details>

<details>
<summary>32-screw-joint</summary>

Screw joint controls including pitch, motion limits and connector orientation.

![32-screw-joint](32-screw-joint.jpg)

[MCP inspection / action receipt](32-screw-joint.controls.json)

</details>

<details>
<summary>36-browser-bodies</summary>

Expanded body tree, per-body identity and visibility.

![36-browser-bodies](36-browser-bodies.jpg)

[MCP inspection / action receipt](36-browser-bodies.controls.json)

</details>

<details>
<summary>37-body-context</summary>

Body context menu, including feature editing and deletion routes; names in the matching control snapshot are authoritative.

![37-body-context](37-body-context.jpg)

[MCP inspection / action receipt](37-body-context.controls.json)

</details>

<details>
<summary>38-delete-feature-guard</summary>

Feature deletion confirmation with downstream dependency consequences; no deletion committed.

![38-delete-feature-guard](38-delete-feature-guard.jpg)

[MCP inspection / action receipt](38-delete-feature-guard.controls.json)

</details>

<details>
<summary>39-body-appearance</summary>

Selected body with physical readout. MCP reports material controls, but the material panel is missing from rendered capture: native composition gap.

![39-body-appearance](39-body-appearance.jpg)

[MCP inspection / action receipt](39-body-appearance.controls.json)

</details>

<details>
<summary>40-3mf-export</summary>

3MF export scope dialog choosing assembly placement versus definition geometry. No export or geometry-validation result is shown.

![40-3mf-export](40-3mf-export.jpg)

[MCP inspection / action receipt](40-3mf-export.controls.json)

</details>

<details>
<summary>141-loft-form</summary>

Full Loft form with ordered profile selection, continuity, ruled transition, centerline, guide rail and operation. Multiple finished sketches exist; no loft committed.

![141-loft-form](141-loft-form.jpg)

[MCP inspection / action receipt](141-loft-form.controls.json)

</details>


### Sketch creation and editing

<details>
<summary>41-sketch-edit</summary>

Active fully constrained sketch, origin, dimensions, palette and sketch ribbon.

![41-sketch-edit](41-sketch-edit.jpg)

[MCP inspection / action receipt](41-sketch-edit.controls.json)

</details>

<details>
<summary>42-sketch-draw-menu</summary>

Full sketch DRAW menu.

![42-sketch-draw-menu](42-sketch-draw-menu.jpg)

[MCP inspection / action receipt](42-sketch-draw-menu.controls.json)

</details>

<details>
<summary>43-sketch-edit-menu</summary>

Full sketch EDIT menu.

![43-sketch-edit-menu](43-sketch-edit-menu.jpg)

[MCP inspection / action receipt](43-sketch-edit-menu.controls.json)

</details>

<details>
<summary>44-sketch-constraint-menu</summary>

Full sketch CONSTRAIN menu.

![44-sketch-constraint-menu](44-sketch-constraint-menu.jpg)

[MCP inspection / action receipt](44-sketch-constraint-menu.controls.json)

</details>

<details>
<summary>45-sketch-repeat-menu</summary>

Full sketch REPEAT menu.

![45-sketch-repeat-menu](45-sketch-repeat-menu.jpg)

[MCP inspection / action receipt](45-sketch-repeat-menu.controls.json)

</details>

<details>
<summary>46-arc-variants</summary>

Nested menu items reported by MCP but flyout pixels absent in native composition; baseline defect to fix.

![46-arc-variants](46-arc-variants.jpg)

[MCP inspection / action receipt](46-arc-variants.controls.json)

</details>

<details>
<summary>47-spline-variants</summary>

Nested menu items reported by MCP but flyout pixels absent in native composition; baseline defect to fix.

![47-spline-variants](47-spline-variants.jpg)

[MCP inspection / action receipt](47-spline-variants.controls.json)

</details>

<details>
<summary>48-rectangle-variants</summary>

Nested menu items reported by MCP but flyout pixels absent in native composition; baseline defect to fix.

![48-rectangle-variants](48-rectangle-variants.jpg)

[MCP inspection / action receipt](48-rectangle-variants.controls.json)

</details>

<details>
<summary>49-circle-variants</summary>

Nested menu items reported by MCP but flyout pixels absent in native composition; baseline defect to fix.

![49-circle-variants](49-circle-variants.jpg)

[MCP inspection / action receipt](49-circle-variants.controls.json)

</details>

<details>
<summary>50-polygon-variants</summary>

Nested menu items reported by MCP but flyout pixels absent in native composition; baseline defect to fix.

![50-polygon-variants](50-polygon-variants.jpg)

[MCP inspection / action receipt](50-polygon-variants.controls.json)

</details>

<details>
<summary>51-slot-variants</summary>

Nested menu items reported by MCP but flyout pixels absent in native composition; baseline defect to fix.

![51-slot-variants](51-slot-variants.jpg)

[MCP inspection / action receipt](51-slot-variants.controls.json)

</details>

<details>
<summary>52-line-tool</summary>

Line tool in progress, snap preview, dynamic dimensions and active tool indication.

![52-line-tool](52-line-tool.jpg)

[MCP inspection / action receipt](52-line-tool.controls.json)

</details>

<details>
<summary>53-sketch-pattern</summary>

Sketch pattern dialog and selection guard.

![53-sketch-pattern](53-sketch-pattern.jpg)

[MCP inspection / action receipt](53-sketch-pattern.controls.json)

</details>

<details>
<summary>142-sketch-plane</summary>

Create Sketch plane-picking mode: origin plane overlays, planar-face picking and Escape instruction.

![142-sketch-plane](142-sketch-plane.jpg)

[MCP inspection / action receipt](142-sketch-plane.controls.json)

</details>

<details>
<summary>143-origin-browser</summary>

Expanded origin with named XY/XZ/YZ planes and center point while selecting the support for a new sketch.

![143-origin-browser](143-origin-browser.jpg)

[MCP inspection / action receipt](143-origin-browser.controls.json)

</details>

<details>
<summary>144-sketch-rectangle</summary>

New dimensioned 30 by 20 mm sketch rectangle, constraint markers, sketch palette, grid and navigation.

![144-sketch-rectangle](144-sketch-rectangle.jpg)

[MCP inspection / action receipt](144-sketch-rectangle.controls.json)

</details>

<details>
<summary>145-sketch-pattern-form</summary>

Rectangular sketch pattern with one selected line, direction angle, spacing, count and optional second direction. Cancelled without changing sketch.

![145-sketch-pattern-form](145-sketch-pattern-form.jpg)

[MCP inspection / action receipt](145-sketch-pattern-form.controls.json)

</details>

<details>
<summary>146-sketch-circular-pattern</summary>

Circular sketch pattern center X/Y, count and total angle on a selected line; no changes committed.

![146-sketch-circular-pattern](146-sketch-circular-pattern.jpg)

[MCP inspection / action receipt](146-sketch-circular-pattern.controls.json)

</details>

<details>
<summary>147-sketch-move</summary>

Sketch Move/Copy is an active viewport tool with the selected line, not a floating form. No movement committed.

![147-sketch-move](147-sketch-move.jpg)

[MCP inspection / action receipt](147-sketch-move.controls.json)

</details>

<details>
<summary>148-sketch-dimension-editor</summary>

Inline driving dimension text editor and reference-dimension toggle opened by a double-click on the rendered 20 mm dimension.

![148-sketch-dimension-editor](148-sketch-dimension-editor.jpg)

[MCP inspection / action receipt](148-sketch-dimension-editor.controls.json)

</details>

<details>
<summary>149-dimension-error</summary>

Invalid expression 20 + is rejected with a modal error while the inline draft stays present and geometry remains unchanged.

![149-dimension-error](149-dimension-error.jpg)

[MCP inspection / action receipt](149-dimension-error.controls.json)

</details>


### Assemblies and motion

<details>
<summary>33-assembly-structure</summary>

Assembly sidebar structure, component creation and reuse, joints and document viewport.

![33-assembly-structure](33-assembly-structure.jpg)

[MCP inspection / action receipt](33-assembly-structure.controls.json)

</details>

<details>
<summary>34-assembly-motion</summary>

Assembly Motion tab and its empty-state guidance.

![34-assembly-motion](34-assembly-motion.jpg)

[MCP inspection / action receipt](34-assembly-motion.controls.json)

</details>

<details>
<summary>35-assembly-inspect</summary>

Assembly Inspect tab and its empty-state guidance.

![35-assembly-inspect](35-assembly-inspect.jpg)

[MCP inspection / action receipt](35-assembly-inspect.controls.json)

</details>

<details>
<summary>131-assembly-structure</summary>

Three definitions, four occurrences, one grounded plate and three joints; reused bracket definition after shared edit.

![131-assembly-structure](131-assembly-structure.jpg)

[MCP inspection / action receipt](131-assembly-structure.controls.json)

</details>

<details>
<summary>132-occurrence-inspector</summary>

Selected repeated occurrence, parent and occurrence transforms, reusable definition and model selection measurements.

![132-occurrence-inspector](132-occurrence-inspector.jpg)

[MCP inspection / action receipt](132-occurrence-inspector.controls.json)

</details>

<details>
<summary>133-component-origin</summary>

Reusable component definition and local coordinate-system translation/rotation, independent of the selected occurrence placement.

![133-component-origin](133-component-origin.jpg)

[MCP inspection / action receipt](133-component-origin.controls.json)

</details>

<details>
<summary>134-assembly-motion</summary>

Motion study duration, playback rate, loop, scrubber and driver/path export controls. Existing play, stop and time-range controls are unnamed in MCP.

![134-assembly-motion](134-assembly-motion.jpg)

[MCP inspection / action receipt](134-assembly-motion.controls.json)

</details>

<details>
<summary>135-motion-driver</summary>

Joint/degree-of-freedom picker and editable keyframe times, values and interpolation in a new motion driver.

![135-motion-driver](135-motion-driver.jpg)

[MCP inspection / action receipt](135-motion-driver.controls.json)

</details>

<details>
<summary>136-motion-motor</summary>

Motor driver start, speed and acceleration fields, with the same joint and degree-of-freedom binding.

![136-motion-motor](136-motion-motor.jpg)

[MCP inspection / action receipt](136-motion-motor.controls.json)

</details>

<details>
<summary>137-named-position</summary>

Saved assembly position with editable name, Apply and delete; motion study remains available.

![137-named-position](137-named-position.jpg)

[MCP inspection / action receipt](137-named-position.controls.json)

</details>

<details>
<summary>138-assembly-analysis</summary>

Interference and clearance, swept-study sampling, stop-at-first and physical contact-stop creation.

![138-assembly-analysis](138-assembly-analysis.jpg)

[MCP inspection / action receipt](138-assembly-analysis.controls.json)

</details>

<details>
<summary>139-assembly-interference</summary>

Exact OCCT static interference results. Repeated-bracket example reports a plate/spacer overlap of 1178.097 cubic millimetres; this fixture is not collision-free.

![139-assembly-interference](139-assembly-interference.jpg)

[MCP inspection / action receipt](139-assembly-interference.controls.json)

</details>


### Drawing workspace and annotations

<details>
<summary>54-workspaces</summary>

Workspace switcher: Solid Modeling, Drawing and Manufacture.

![54-workspaces](54-workspaces.jpg)

[MCP inspection / action receipt](54-workspaces.controls.json)

</details>

<details>
<summary>55-drawing-new-sheet</summary>

First entry to Drawing workspace and New Sheet setup.

![55-drawing-new-sheet](55-drawing-new-sheet.jpg)

[MCP inspection / action receipt](55-drawing-new-sheet.controls.json)

</details>

<details>
<summary>56-drawing-blank</summary>

Blank drawing sheet with title block, drawing browser and sheet inspector.

![56-drawing-blank](56-drawing-blank.jpg)

[MCP inspection / action receipt](56-drawing-blank.controls.json)

</details>

<details>
<summary>57-drawing-layout</summary>

Automatic four-view layout; the Top view overlaps the title-block region.

![57-drawing-layout](57-drawing-layout.jpg)

[MCP inspection / action receipt](57-drawing-layout.controls.json)

</details>

<details>
<summary>58-drawing-view-inspector</summary>

Selected front view and editable projection/scale/line-style inspector.

![58-drawing-view-inspector](58-drawing-view-inspector.jpg)

[MCP inspection / action receipt](58-drawing-view-inspector.controls.json)

</details>

<details>
<summary>59-drawing-views-menu</summary>

Drawing view families and current availability.

![59-drawing-views-menu](59-drawing-views-menu.jpg)

[MCP inspection / action receipt](59-drawing-views-menu.controls.json)

</details>

<details>
<summary>60-drawing-derived-menu</summary>

Drawing derived-view flyout, rendered above the 2D sheet.

![60-drawing-derived-menu](60-drawing-derived-menu.jpg)

[MCP inspection / action receipt](60-drawing-derived-menu.controls.json)

</details>

<details>
<summary>61-drawing-section-placement</summary>

Section view placement mode and inspector before choosing source geometry.

![61-drawing-section-placement](61-drawing-section-placement.jpg)

[MCP inspection / action receipt](61-drawing-section-placement.controls.json)

</details>

<details>
<summary>62-drawing-section-preview</summary>

Section placement still awaiting source anchor picks; attempted mid-edge clicks did not complete the section. See 62b for the completed view.

![62-drawing-section-preview](62-drawing-section-preview.jpg)

[MCP inspection / action receipt](62-drawing-section-preview.controls.json)

</details>

<details>
<summary>62b-drawing-section-picks</summary>

Completed associative section view with source arrows, hatching and editable derived-view inspector.

![62b-drawing-section-picks](62b-drawing-section-picks.jpg)

[MCP inspection / action receipt](62b-drawing-section-picks.controls.json)

</details>

<details>
<summary>63-drawing-dimension-placement</summary>

Completed associative 60 mm linear dimension and its inspector.

![63-drawing-dimension-placement](63-drawing-dimension-placement.jpg)

[MCP inspection / action receipt](63-drawing-dimension-placement.controls.json)

</details>

<details>
<summary>64-drawing-dimensions-menu</summary>

Dimension family menu and selected associative linear dimension.

![64-drawing-dimensions-menu](64-drawing-dimensions-menu.jpg)

[MCP inspection / action receipt](64-drawing-dimensions-menu.controls.json)

</details>

<details>
<summary>65-drawing-angular-menu</summary>

Feature and angular dimension flyout.

![65-drawing-angular-menu](65-drawing-angular-menu.jpg)

[MCP inspection / action receipt](65-drawing-angular-menu.controls.json)

</details>

<details>
<summary>66-drawing-linear-menu</summary>

Linear, chain, baseline, continued and ordinate dimension flyout.

![66-drawing-linear-menu](66-drawing-linear-menu.jpg)

[MCP inspection / action receipt](66-drawing-linear-menu.controls.json)

</details>

<details>
<summary>67-drawing-annotate-menu</summary>

Drawing annotation menu families.

![67-drawing-annotate-menu](67-drawing-annotate-menu.jpg)

[MCP inspection / action receipt](67-drawing-annotate-menu.controls.json)

</details>

<details>
<summary>68-drawing-symbols-menu</summary>

Manufacturing symbol menu: datum, GD&T, surface texture, edge requirement, weld.

![68-drawing-symbols-menu](68-drawing-symbols-menu.jpg)

[MCP inspection / action receipt](68-drawing-symbols-menu.controls.json)

</details>

<details>
<summary>69-drawing-tolerance-menu</summary>

Datum, GD&T, surface texture and edge requirement flyout.

![69-drawing-tolerance-menu](69-drawing-tolerance-menu.jpg)

[MCP inspection / action receipt](69-drawing-tolerance-menu.controls.json)

</details>

<details>
<summary>70-drawing-fabrication-menu</summary>

Weld, item balloon and revision-cloud flyout.

![70-drawing-fabrication-menu](70-drawing-fabrication-menu.jpg)

[MCP inspection / action receipt](70-drawing-fabrication-menu.controls.json)

</details>

<details>
<summary>71-drawing-centers-menu</summary>

Center mark, center line, symmetry axis and bolt-circle flyout.

![71-drawing-centers-menu](71-drawing-centers-menu.jpg)

[MCP inspection / action receipt](71-drawing-centers-menu.controls.json)

</details>

<details>
<summary>72-drawing-notes-menu</summary>

Hole note, chamfer note and free note flyout.

![72-drawing-notes-menu](72-drawing-notes-menu.jpg)

[MCP inspection / action receipt](72-drawing-notes-menu.controls.json)

</details>

<details>
<summary>73-drawing-note-inspector</summary>

Placed drawing note with text and X/Y position inspector.

![73-drawing-note-inspector](73-drawing-note-inspector.jpg)

[MCP inspection / action receipt](73-drawing-note-inspector.controls.json)

</details>

<details>
<summary>74-drawing-gdt-inspector</summary>

Placed geometric tolerance frame and feature-control inspector.

![74-drawing-gdt-inspector](74-drawing-gdt-inspector.jpg)

[MCP inspection / action receipt](74-drawing-gdt-inspector.controls.json)

</details>

<details>
<summary>75-drawing-datum</summary>

Datum flag and associative datum inspector.

![75-drawing-datum](75-drawing-datum.jpg)

[MCP inspection / action receipt](75-drawing-datum.controls.json)

</details>

<details>
<summary>76-drawing-surface-texture</summary>

Surface texture symbol and roughness/material-removal fields.

![76-drawing-surface-texture](76-drawing-surface-texture.jpg)

[MCP inspection / action receipt](76-drawing-surface-texture.controls.json)

</details>

<details>
<summary>77-drawing-edge-requirement</summary>

Edge-requirement placement awaiting a projected straight-edge pick; completed inspector is in 77b.

![77-drawing-edge-requirement](77-drawing-edge-requirement.jpg)

[MCP inspection / action receipt](77-drawing-edge-requirement.controls.json)

</details>

<details>
<summary>77b-drawing-edge-inspector</summary>

Edge requirement inspector after picking a straight projected edge.

![77b-drawing-edge-inspector](77b-drawing-edge-inspector.jpg)

[MCP inspection / action receipt](77b-drawing-edge-inspector.controls.json)

</details>

<details>
<summary>78-drawing-weld-inspector</summary>

Weld placement awaiting a projected straight-edge pick; completed editor is in 78b.

![78-drawing-weld-inspector](78-drawing-weld-inspector.jpg)

[MCP inspection / action receipt](78-drawing-weld-inspector.controls.json)

</details>

<details>
<summary>78b-drawing-weld-editor</summary>

Weld symbol applied to straight edge, with weld-type, side, size, length and pitch fields.

![78b-drawing-weld-editor](78b-drawing-weld-editor.jpg)

[MCP inspection / action receipt](78b-drawing-weld-editor.controls.json)

</details>

<details>
<summary>79-drawing-balloon-inspector</summary>

Placed item balloon with BOM item and X/Y position fields.

![79-drawing-balloon-inspector](79-drawing-balloon-inspector.jpg)

[MCP inspection / action receipt](79-drawing-balloon-inspector.controls.json)

</details>

<details>
<summary>80-drawing-revision-cloud</summary>

Revision-cloud two-point placement mode; no completed cloud was created.

![80-drawing-revision-cloud](80-drawing-revision-cloud.jpg)

[MCP inspection / action receipt](80-drawing-revision-cloud.controls.json)

</details>

<details>
<summary>81-drawing-sheet-properties</summary>

Scrolled sheet properties showing title-block metadata and template controls.

![81-drawing-sheet-properties](81-drawing-sheet-properties.jpg)

[MCP inspection / action receipt](81-drawing-sheet-properties.controls.json)

</details>

<details>
<summary>82-drawing-style</summary>

Drawing style: font, text height, arrow size and line weights/patterns.

![82-drawing-style](82-drawing-style.jpg)

[MCP inspection / action receipt](82-drawing-style.controls.json)

</details>

<details>
<summary>83-drawing-release-bom</summary>

Sheet line-style, hatch, document status, revision and BOM controls.

![83-drawing-release-bom](83-drawing-release-bom.jpg)

[MCP inspection / action receipt](83-drawing-release-bom.controls.json)

</details>

<details>
<summary>84-drawing-tables</summary>

BOM table enabled and revision row added; document controls at bottom of inspector.

![84-drawing-tables](84-drawing-tables.jpg)

[MCP inspection / action receipt](84-drawing-tables.controls.json)

</details>


### CAM setup, operations, simulation and output

<details>
<summary>85-cam-blank</summary>

Manufacture workspace with empty CAM setup and Program ribbon over the actual model.

![85-cam-blank](85-cam-blank.jpg)

[MCP inspection / action receipt](85-cam-blank.controls.json)

</details>

<details>
<summary>86-cam-setup</summary>

CAM setup editor: WCS orientation/origin and model selection.

![86-cam-setup](86-cam-setup.jpg)

[MCP inspection / action receipt](86-cam-setup.controls.json)

</details>

<details>
<summary>87-cam-setup-wcs</summary>

CAM setup WCS orientation and work-offset pattern fields, scrolled through MCP focus.

![87-cam-setup-wcs](87-cam-setup-wcs.jpg)

[MCP inspection / action receipt](87-cam-setup-wcs.controls.json)

</details>

<details>
<summary>88-cam-tool-library</summary>

CAM central/project library browser and available tool kinds.

![88-cam-tool-library](88-cam-tool-library.jpg)

[MCP inspection / action receipt](88-cam-tool-library.controls.json)

</details>

<details>
<summary>89-cam-tool-editor</summary>

New flat-end-mill tool General tab; separate cutter and cutting-data tabs are captured in 90 and 91.

![89-cam-tool-editor](89-cam-tool-editor.jpg)

[MCP inspection / action receipt](89-cam-tool-editor.controls.json)

</details>

<details>
<summary>90-cam-cutter</summary>

Tool cutter geometry and dimensions.

![90-cam-cutter](90-cam-cutter.jpg)

[MCP inspection / action receipt](90-cam-cutter.controls.json)

</details>

<details>
<summary>91-cam-cutting-data</summary>

Tool cutting profiles, spindle speed, feeds and coolant.

![91-cam-cutting-data](91-cam-cutting-data.jpg)

[MCP inspection / action receipt](91-cam-cutting-data.controls.json)

</details>

<details>
<summary>92-cam-project-tools</summary>

Project-scoped tool library; no changes made to the central library.

![92-cam-project-tools](92-cam-project-tools.jpg)

[MCP inspection / action receipt](92-cam-project-tools.controls.json)

</details>

<details>
<summary>93-cam-face-operation</summary>

Face operation editor and required tool selection.

![93-cam-face-operation](93-cam-face-operation.jpg)

[MCP inspection / action receipt](93-cam-face-operation.controls.json)

</details>

<details>
<summary>94-cam-face-geometry</summary>

Face operation geometry and stock extent.

![94-cam-face-geometry](94-cam-face-geometry.jpg)

[MCP inspection / action receipt](94-cam-face-geometry.controls.json)

</details>

<details>
<summary>95-cam-heights</summary>

Associative CAM heights and offsets.

![95-cam-heights](95-cam-heights.jpg)

[MCP inspection / action receipt](95-cam-heights.controls.json)

</details>

<details>
<summary>96-cam-face-passes</summary>

Face operation passes and stepover.

![96-cam-face-passes](96-cam-face-passes.jpg)

[MCP inspection / action receipt](96-cam-face-passes.controls.json)

</details>

<details>
<summary>97-cam-linking</summary>

Upper CAM linking settings; this image does not expose every lower field.

![97-cam-linking](97-cam-linking.jpg)

[MCP inspection / action receipt](97-cam-linking.controls.json)

</details>

<details>
<summary>98-cam-contour-geometry</summary>

Contour geometry: associative chain selection and machining side.

![98-cam-contour-geometry](98-cam-contour-geometry.jpg)

[MCP inspection / action receipt](98-cam-contour-geometry.controls.json)

</details>

<details>
<summary>99-cam-contour-passes</summary>

Upper contour passes and compensation settings; lower depth fields are outside this image.

![99-cam-contour-passes](99-cam-contour-passes.jpg)

[MCP inspection / action receipt](99-cam-contour-passes.controls.json)

</details>

<details>
<summary>100-cam-pocket-geometry</summary>

Pocket geometry and source selection.

![100-cam-pocket-geometry](100-cam-pocket-geometry.jpg)

[MCP inspection / action receipt](100-cam-pocket-geometry.controls.json)

</details>

<details>
<summary>101-cam-pocket-passes</summary>

Pocket passes, stepdown, stepover and stock-to-leave.

![101-cam-pocket-passes](101-cam-pocket-passes.jpg)

[MCP inspection / action receipt](101-cam-pocket-passes.controls.json)

</details>

<details>
<summary>102-cam-chamfer-geometry</summary>

Chamfer geometry: modeled chamfer or selected contour.

![102-cam-chamfer-geometry](102-cam-chamfer-geometry.jpg)

[MCP inspection / action receipt](102-cam-chamfer-geometry.controls.json)

</details>

<details>
<summary>103-cam-chamfer-passes</summary>

Chamfer pass width, offset and multiple-pass settings.

![103-cam-chamfer-passes](103-cam-chamfer-passes.jpg)

[MCP inspection / action receipt](103-cam-chamfer-passes.controls.json)

</details>

<details>
<summary>104-cam-drill-geometry</summary>

Drilling hole/point selections.

![104-cam-drill-geometry](104-cam-drill-geometry.jpg)

[MCP inspection / action receipt](104-cam-drill-geometry.controls.json)

</details>

<details>
<summary>105-cam-drill-passes</summary>

Default drilling cycle and visible pass parameters.

![105-cam-drill-passes](105-cam-drill-passes.jpg)

[MCP inspection / action receipt](105-cam-drill-passes.controls.json)

</details>

<details>
<summary>106-cam-thread-geometry</summary>

Thread operation geometry, holes and pitch.

![106-cam-thread-geometry](106-cam-thread-geometry.jpg)

[MCP inspection / action receipt](106-cam-thread-geometry.controls.json)

</details>

<details>
<summary>107-cam-thread-passes</summary>

Thread milling/tapping pass controls.

![107-cam-thread-passes](107-cam-thread-passes.jpg)

[MCP inspection / action receipt](107-cam-thread-passes.controls.json)

</details>

<details>
<summary>108-cam-adaptive-geometry</summary>

Adaptive roughing geometry and machining boundary.

![108-cam-adaptive-geometry](108-cam-adaptive-geometry.jpg)

[MCP inspection / action receipt](108-cam-adaptive-geometry.controls.json)

</details>

<details>
<summary>109-cam-adaptive-heights</summary>

Adaptive height references; lower fields are partly overlapped by the fixed footer.

![109-cam-adaptive-heights](109-cam-adaptive-heights.jpg)

[MCP inspection / action receipt](109-cam-adaptive-heights.controls.json)

</details>

<details>
<summary>110-cam-adaptive-passes</summary>

Adaptive pass parameters; lower fields are partly overlapped by the fixed footer.

![110-cam-adaptive-passes](110-cam-adaptive-passes.jpg)

[MCP inspection / action receipt](110-cam-adaptive-passes.controls.json)

</details>

<details>
<summary>111-cam-adaptive-linking</summary>

Adaptive entry/linking controls; lower fields are partly overlapped by the fixed footer.

![111-cam-adaptive-linking](111-cam-adaptive-linking.jpg)

[MCP inspection / action receipt](111-cam-adaptive-linking.controls.json)

</details>

<details>
<summary>112-cam-tool-picker</summary>

Nested tool picker over face operation; fixture tool seeded through shared MCP CAM document operation.

![112-cam-tool-picker](112-cam-tool-picker.jpg)

[MCP inspection / action receipt](112-cam-tool-picker.controls.json)

</details>

<details>
<summary>113-cam-generated</summary>

Actual failure: default face-operation top offset 0.2 above stock is rejected as depth range outside stock. Misleading File operation failed title.

![113-cam-generated](113-cam-generated.jpg)

[MCP inspection / action receipt](113-cam-generated.controls.json)

</details>

<details>
<summary>113b-cam-generated</summary>

Successful face toolpath after changing top offset from 0.2 to 0; stock preparation is still busy in this image.

![113b-cam-generated](113b-cam-generated.jpg)

[MCP inspection / action receipt](113b-cam-generated.controls.json)

</details>

<details>
<summary>114-cam-simulation</summary>

CAM Simulate ribbon before opening playback transport.

![114-cam-simulation](114-cam-simulation.jpg)

[MCP inspection / action receipt](114-cam-simulation.controls.json)

</details>

<details>
<summary>115-cam-playback</summary>

CAM simulation preparation in progress; settled playback is captured in 115b.

![115-cam-playback](115-cam-playback.jpg)

[MCP inspection / action receipt](115-cam-playback.controls.json)

</details>

<details>
<summary>115b-cam-playback-ready</summary>

Prepared CAM simulation timeline, speed, direction and tool/stock state.

![115b-cam-playback-ready](115b-cam-playback-ready.jpg)

[MCP inspection / action receipt](115b-cam-playback-ready.controls.json)

</details>

<details>
<summary>116-cam-simulation-settings</summary>

CAM playback scrubbed to 65 seconds with Simulation Settings popover.

![116-cam-simulation-settings](116-cam-simulation-settings.jpg)

[MCP inspection / action receipt](116-cam-simulation-settings.controls.json)

</details>

<details>
<summary>117-cam-nc-simulation</summary>

NC simulation dialog: load code, dialect and setup-machine mapping.

![117-cam-nc-simulation](117-cam-nc-simulation.jpg)

[MCP inspection / action receipt](117-cam-nc-simulation.controls.json)

</details>

<details>
<summary>118-cam-output</summary>

CAM Output ribbon and generated setup.

![118-cam-output](118-cam-output.jpg)

[MCP inspection / action receipt](118-cam-output.controls.json)

</details>

<details>
<summary>119-cam-post</summary>

Post NC dialog, machine-assignment requirement and output controls.

![119-cam-post](119-cam-post.jpg)

[MCP inspection / action receipt](119-cam-post.controls.json)

</details>

<details>
<summary>120-cam-machine</summary>

Return from Post NC to setup machine assignment.

![120-cam-machine](120-cam-machine.jpg)

[MCP inspection / action receipt](120-cam-machine.controls.json)

</details>

<details>
<summary>121-cam-siemens</summary>

Siemens setup configuration branch before saving any machine assignment.

![121-cam-siemens](121-cam-siemens.jpg)

[MCP inspection / action receipt](121-cam-siemens.controls.json)

</details>

<details>
<summary>122-cam-post-bound</summary>

Post NC with Siemens machine snapshot; review/output guard remains unconfirmed.

![122-cam-post-bound](122-cam-post-bound.jpg)

[MCP inspection / action receipt](122-cam-post-bound.controls.json)

</details>

<details>
<summary>123-cam-machine-post-fields</summary>

Siemens changer, M6 positioning, machine retract and tool-edge post fields.

![123-cam-machine-post-fields](123-cam-machine-post-fields.jpg)

[MCP inspection / action receipt](123-cam-machine-post-fields.controls.json)

</details>
