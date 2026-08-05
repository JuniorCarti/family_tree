# Release 6: Mobile Tree and Scale

Release 6 makes the family tree feel native on phones and keeps long lineages responsive. It addresses the two causes of the reported mobile freeze: the canvas previously had mouse-only navigation, and every mobile viewport resize rebuilt the complete SVG tree.

## What ships

### Touch-first tree navigation

- One-finger drag to move across the tree.
- Two-finger pinch to zoom around the gesture midpoint.
- Pointer capture so a drag continues smoothly at the edge of the canvas.
- Trackpad and mouse-wheel panning, with Ctrl/Command wheel zoom.
- A reachable in-canvas control dock for zooming and fitting the whole tree.
- Automatic fit-to-view when a family is first opened on a phone or tablet.
- A short, non-blocking gesture hint for touch users.
- Safe-area-aware controls for phones with home indicators.

### Long-lineage performance

- A dedicated, testable tree-layout engine shared by the browser and Node tests.
- Cached layout results until people or relationships actually change.
- Iterative generation, width, and placement passes, avoiding recursive stack growth.
- Memoized subtree widths instead of repeatedly calculating the same descendants.
- Constant-time person lookup and stable person ordering.
- Cycle-safe handling for malformed legacy parent links.
- Selection highlighting without rebuilding every SVG card.
- Animation-frame throttling for pan, pinch, wheel, and viewport updates.

### Mobile viewport reliability

- The app uses dynamic viewport height so browser chrome does not hide the tree.
- Browser address-bar movement and rotation resize only the SVG surface; they do not recalculate or rebuild the genealogy.
- The canvas owns touch gestures with contained overscroll.
- The large relationship legend and duplicate top-bar zoom controls are removed from narrow layouts.
- Add-relative controls remain discoverable on touch screens where hover does not exist.
- The compact control dock remains usable down to 320px.
- Reduced-motion preferences disable the temporary gesture-hint transition.

## Root-cause record

The previous implementation listened to `mousedown`, `mousemove`, `mouseup`, and Ctrl/Command wheel only. A touch screen therefore had no supported pan path. At the same time, `window.resize` called the full `render()` function. Mobile browsers emit resize events as their address bar expands or collapses, so a long tree could repeatedly:

1. infer relationship maps;
2. recalculate generations and subtree widths;
3. recreate every connector;
4. recreate every SVG `foreignObject` card.

Release 6 replaces this with Pointer Events and a cheap, animation-frame-coalesced surface resize.

## Performance contract

The automated suite lays out a 5,000-person direct lineage and verifies:

- every person receives a finite position;
- generation 4,999 is retained;
- no recursive call-stack growth occurs;
- the layout completes within a conservative two-second CI budget.

The current local reference run completes that layout in about 100ms. Timing varies by machine; the CI threshold is the contract.

## Accessibility and interaction

- Control buttons have explicit accessible names.
- The zoom percentage is exposed through a polite live output.
- Keyboard users can operate all zoom and fit controls.
- Focus states remain visible against the parchment surface.
- Decorative gesture guidance is hidden from assistive technology.
- Person cards remain regular selectable controls inside the SVG.

## Verification

Run the layout and mobile regression suite without a database:

    npm run test:tree-layout

Run JavaScript syntax checks:

    node --check public/tree-layout.js
    node --check public/app.js

Run the full integration suite against a disposable PostgreSQL database:

    npm test

Browser QA should cover:

- 320px, 375px, 390px, 430px, tablet, and desktop widths;
- one-finger pan and two-finger pinch on a real or emulated touch viewport;
- fit, zoom in, and zoom out controls;
- opening and closing a person profile without a full tree rebuild;
- mobile address-bar movement and orientation changes;
- a long multi-generation family;
- no horizontal page scrolling;
- Timeline and Stories navigation after the tree changes.

## Deliberate boundaries

Release 6 optimizes layout calculation and interaction but still renders each visible family member as an SVG `foreignObject`. Extremely large archives may eventually benefit from viewport virtualization or a canvas/WebGL renderer. That larger rendering architecture is not required for the current 5,000-person layout contract and should only be introduced with matching accessibility behavior.
