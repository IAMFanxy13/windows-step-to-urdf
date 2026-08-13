# Robot-Arm Public Example Design

## Goal

Replace the current flat-looking public demonstration with a recognizable desktop industrial robot arm while preserving the existing deterministic STEP-to-URDF test purpose.

The result must read visually as a robot arm before the viewer reads the README caption: raised base, shoulder, upper arm, elbow, forearm, and two-finger gripper.

## Scope

- Keep two SG51R servo occurrences from the existing pinned MIT-licensed source definition.
- Keep two revolute joints and three intended rigid links.
- Keep the imported AP242 assembly pose as URDF `q=0`.
- Change only repository-generated base, bracket, link, horn, and gripper geometry plus the public screenshot and related descriptions.
- Do not add private EduBotics geometry or any unrecorded external CAD.
- Do not add extra joints, inverse kinematics, dynamics, or collision simulation.

## Visual Layout

The generated assembly represents a compact tabletop arm:

1. A broad circular foot and tapered pedestal make the base stable and immediately recognizable.
2. A raised shoulder yoke supports Servo A with its output disc visibly exposed.
3. A substantial upper-arm link rises diagonally from the shoulder instead of lying flat on the ground plane.
4. Servo B is exposed at the elbow and remains a second occurrence of the same SG51R definition.
5. A tapered forearm extends forward from the elbow.
6. A compact palm and two fixed fingers form a clearly readable gripper silhouette.

The zero pose uses a bent-arm silhouette rather than a straight horizontal chain. Both revolute axes remain parallel and geometrically centred on their respective output horns.

## Kinematic and Assembly Constraints

- The arm remains an open serial chain with intended topology `base -> upper_arm -> forearm`.
- Servo A housing belongs to the base side; its output horn drives the upper-arm structure.
- Servo B housing belongs to the upper-arm side; its output horn drives the forearm and gripper.
- The servo body geometry is unchanged and shared by both occurrences.
- Generated horn cylinders retain radius `0.008 m` and remain centred on the detected local output axes.
- Generated rigid structures may contain multiple solids in one STEP definition, but they must not visually intersect unrelated links at `q=0`.
- Housing brackets may contact servo housings; output-side structures may contact output horns. Those interfaces must remain distinguishable to the inference and review pipeline.
- The example must still yield one repeated servo family with two instances and two revolute-joint candidates.

## Geometry Strategy

Use deterministic OCP/Open CASCADE primitives only:

- cylinders and truncated-cone-like stacked cylinders for the base;
- boxes and cylinders for shoulder cheeks, servo cradle, output horns, and link ribs;
- rotated/transformed compounds for the diagonal upper arm and forward forearm;
- two separated box fingers on the terminal palm.

Rounded cosmetic details are optional. Recognizable silhouette, separated moving groups, and stable B-Rep topology take priority over decorative complexity.

## Preview Composition

The README image remains a real screenshot of the running application:

- 1440 x 810, without browser chrome;
- three-quarter isometric view from slightly above;
- whole robot arm visible with comfortable margins;
- dark application grid retained;
- current motion-review card visible;
- shoulder joint shown at `+5°` so the moving structure, axis, and interface are apparent;
- parent, child, and downstream colours readable without obscuring the servo bodies.

## Data and Documentation Changes

- Update `test/fixtures/generate_step_fixtures.py` with the revised generated structures and occurrence transforms.
- Regenerate `public/examples/two_joint_servo_arm_ap242.step` from that generator.
- Update exact geometry and topology assertions in `test/test_step_import.py` before implementation.
- Replace `docs/images/interface-preview.png` with the real application screenshot.
- Update the English and Chinese README caption or example description only where the new raised robot-arm layout changes the wording.
- Preserve existing third-party attribution because the SG51R source asset and license do not change.

## Error Handling

- If the new pose causes automatic contact topology to become ambiguous, adjust generated bracket interfaces rather than hard-code candidates.
- If a visually attractive part creates a false cylindrical output-axis candidate, simplify that part or change its radius; do not weaken axis ranking tests.
- If an exact high-complexity contact is skipped by the safety budget, it must remain explicitly marked as a proximity fallback requiring review.
- If a generated STEP no longer produces two joints and three intended links, generation is considered failed and the screenshot must not be updated.

## Testing

1. Add failing assertions for a raised pedestal, diagonal upper-arm extent, exposed elbow separation, terminal gripper fingers, two SG51R occurrences, and two horn axes.
2. Regenerate and import the AP242 example through the real OCCT/XCAF pipeline.
3. Verify the servo template contains exactly two matching instances.
4. Verify two joint candidates and three intended rigid links after template application.
5. Run all JavaScript and Python tests, the production build, four Playwright workflows, release-boundary scan, and npm audit.
6. Inspect the final screenshot at its native resolution and at typical GitHub README width.
7. Verify the public tree contains no EduBotics or private CAD artifacts.
8. Push only after local verification, then require Windows CI and CodeQL success for the final commit.

## Acceptance Criteria

- A new viewer identifies the object as a robot arm without reading explanatory text.
- The base, shoulder, upper arm, elbow, forearm, and gripper are visually distinct.
- Both real servo bodies and both output horns remain visible.
- No link appears fused into an unrelated moving group or detached in the zero pose.
- Moving either joint drives only its expected downstream structure in the browser.
- The public example remains generic, licensed, deterministic, and free of private EduBotics geometry.
- The final README preview is generated from the actual application and actual AP242 example.
