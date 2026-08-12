# README Interface Preview Design

## Goal

Replace the overly wide empty-workspace image near the top of `README.md` with a clearer, more attractive screenshot of the real application.

## Scope

- Change only the README interface-preview image and its accessible caption.
- Keep the remaining README structure and wording unchanged.
- Use the repository's generated public two-joint AP242 example; never use private CAD or screenshots.

## Composition

- Capture the actual application at a 16:9 viewport, targeting 1440×810 or 1280×720.
- Show the generated example loaded at its zero pose.
- Frame the full robot clearly in the 3D viewport.
- Keep the main task panel visible and readable so the image communicates both the model and the workflow.
- Avoid browser chrome, desktop clutter, modals, transient notifications, clipped controls, and misleading postures.
- Preserve the application's real colours and controls rather than creating a fictional UI mock-up.

## Files

- Add `docs/images/interface-preview.png`.
- Update the top image reference and alt text in `README.md`.
- Retain existing screenshots used elsewhere unless they are genuinely unreferenced and safe to remove in a later cleanup.

## Verification

- Confirm the image is exactly 16:9 and legible at GitHub README width.
- Confirm the image contains only the generated public example.
- Confirm all Markdown links resolve.
- Run `npm run release:check` to enforce the public-content boundary.
- Inspect GitHub's rendered README after pushing.

## Acceptance Criteria

1. The preview is no longer unusually wide or vertically compressed.
2. A visible example model makes the application purpose immediately understandable.
3. The task panel remains readable without opening the original image.
4. No private robot model or confidential CAD data appears in the repository.
5. No application behaviour or README section beyond the preview is changed.
