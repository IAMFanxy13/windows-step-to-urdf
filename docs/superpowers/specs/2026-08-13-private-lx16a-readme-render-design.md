# Private LX-16A README Render Design

## Goal

Replace the two generic servo bodies visible in the public README screenshot with the user's latest LX-16A part appearance, while keeping every reusable private CAD artifact out of the public repository.

## Privacy boundary

- Read the selected local LX-16A part without modifying it.
- Export only to a temporary directory for local rendering.
- Do not commit or publish the source part, derived STEP/STL/mesh, complete private assembly, transforms from the private robot, or local recovery data.
- Commit only the final flattened PNG screenshot. The image may reveal the exterior appearance of the commercial servo but not a reusable CAD model.
- Keep the distributable AP242 example and its licensed SG51R dependency unchanged.

## Rendering approach

1. Use the installed CAD application through its local automation API to export the selected LX-16A part to a temporary neutral format.
2. Inspect the temporary geometry to identify its body bounds and output-axis orientation.
3. Build a temporary, non-tracked preview assembly that reuses the public procedural pedestal, arm links and gripper but substitutes two transformed LX-16A bodies.
4. Import that temporary assembly through the real STEP analysis path, confirm the two joints, and capture the motion-review view at a small positive angle.
5. Replace only `docs/images/interface-preview.png` and adjust its alt text if necessary.

## Failure handling

- If the native part cannot be exported reliably, use the matching local neutral-format LX-16A file only for the temporary render.
- If automatic axis inference is uncertain, determine the output axis from repeated coaxial cylindrical features and verify the motion in the browser before capture.
- Never work around an export failure by copying a private CAD derivative into the repository.

## Verification

- Visually verify that both visible servos use the LX-16A exterior and remain connected to the shoulder and elbow structures.
- Test each preview joint at `0°`, `+5°`, and `-5°`; confirm only the expected downstream structure moves.
- Run the full test suite and public-release gate.
- Inspect tracked files and Git history for private CAD extensions, private product markers, derived meshes, and local absolute paths before pushing.

## Deliverable

One updated README preview PNG showing the tabletop robot arm with two LX-16A servo bodies. No private reusable CAD asset is part of the public release.
