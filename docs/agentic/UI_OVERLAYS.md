# UI overlay and flyout invariant

Use this note whenever adding or changing a menu, popover, combobox list,
tooltip, context menu, or dialog in the React/Tauri shell.

## The failure we must not repeat

The File menu was an absolutely positioned child of the ribbon. The ribbon
used `overflow-hidden`, and the menu began exactly at the ribbon's bottom edge
(92 px in the standard shell; 122 px after the Drawing workspace row was
added). Clicking File correctly changed React state and created the menu DOM,
but every menu pixel and pointer target was clipped. Fullscreen and windowed
layouts made the symptom easy to misdiagnose as a native Bevy stacking issue.

`z-index` cannot repair this. A descendant cannot paint or receive pointer
events outside an ancestor's overflow clip, regardless of stacking order.

## Required implementation pattern

1. Portal every surface that can extend outside its shell container to
   `document.body`.
2. Position it with fixed viewport coordinates from the trigger's
   `getBoundingClientRect()`; clamp it to the visible window.
3. Recompute placement on open, resize, fullscreen changes, display-scale
   changes, and relevant scrolling.
4. Preserve `data-native-viewport-overlay` on any portaled surface that covers
   the Bevy viewport. The Tauri compositor must know that this DOM island stays
   above the opaque native child.
5. Keep dismissal, focus return, keyboard navigation, and accessibility
   semantics connected to the trigger even though the surface moved in the
   DOM.

Do not work around the problem by removing a deliberate shell clip, adding an
extreme `z-index`, hard-coding another shell-height offset, or expanding the
native viewport mask to include an invisible/clipped element.

## Required regression

Test the windowed layout at minimum; also cover fullscreen when the shell
changes there. The test must:

1. Open the surface through its real trigger.
2. Choose an interior point beyond the trigger container's bottom or side.
3. Verify `document.elementFromPoint()` resolves to the surface or one of its
   controls.
4. Click that point and assert the intended action occurred.
5. Repeat after a window resize when placement depends on available space.

Checking only that React state changed, the node exists, an overlay rectangle
was reported to native code, or the element looks correct in fullscreen does
not prove the windowed surface is painted and interactive.
