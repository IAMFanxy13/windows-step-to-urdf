# Realistic Public Servo Example Design

## Goal

Replace the visually abstract block example with a small, recognizable two-joint servo arm while preserving the example's purpose as a deterministic end-to-end STEP import and kinematic-inference fixture.

## Source and Licensing

- Use `2201 Submicro Servo SG51R.step` from `adafruit/Adafruit_CAD_Parts` at commit `ab3dfc47c32468ba87e7652556cab25efd906eb0` as the servo-body reference geometry.
- The upstream repository declares the MIT License. Preserve the upstream copyright and license text under `licenses/` and add the exact file, commit, URL, role, and modifications to `THIRD_PARTY_NOTICES.md`.
- Generate all brackets, horns, base plates, and arm links in this repository with OCP/Open CASCADE. Do not use any private CAD or robot geometry.
- Clearly describe the assembly as a generic demonstration inspired by an SG51R-sized hobby servo, not as an engineering-accurate manufacturer model or a claim of product compatibility.

## Assembly Layout

The AP242 example contains these visual roles:

1. A stable base plate.
2. Servo A with a recognizable rectangular case, mounting ears, raised output boss, and output shaft.
3. A circular horn centred on Servo A's output axis.
4. A U-shaped shoulder bracket fixed to the horn.
5. A first arm link carrying Servo B.
6. Servo B, using the same servo definition as Servo A through a second STEP occurrence transform.
7. A second circular horn centred on Servo B's output axis.
8. A forearm/end link fixed to the second horn.

The two axes are parallel and spatially separated so that the zero-pose topology reads clearly in an isometric view. The assembly remains an open chain with two revolute joints and three intended rigid links.

## Geometry and Inference Requirements

- Keep the servo functional output geometry exact: cylindrical output features and circular edges must be available to the B-Rep extractor.
- Store both servos as occurrences of one definition so repeated-part/template detection still works.
- Keep the two servo instances geometrically identical; only their occurrence transforms differ.
- Keep the housing-side and output-side contacts unambiguous enough for the contact graph to propose a movable first draft.
- Keep the imported STEP pose as the URDF `q=0` pose.
- The generated assembly must continue to produce one servo template candidate with two instances, three rigid links, and two revolute-joint candidates after template confirmation.

## Repository Changes

- Add the pinned upstream servo STEP under `third_party/adafruit_sg51r/` with its MIT license.
- Refactor `test/fixtures/generate_step_fixtures.py` so `write_two_joint_servo_arm()` imports the pinned servo geometry and composes the new AP242 assembly.
- Regenerate `public/examples/two_joint_servo_arm_ap242.step` from that fixture generator.
- Update the public-release allowlist and tests to allow exactly the generated example plus the pinned licensed source asset.
- Update `THIRD_PARTY_NOTICES.md` and the third-party audit.
- Replace `docs/images/interface-preview.png` with a 16:9 real-application screenshot of the new example in motion-review mode.

## Failure Handling

- If the exact upstream body contains topology that prevents deterministic output-axis ranking, retain its visible case geometry but add a repository-generated, explicit cylindrical output boss as part of the servo definition.
- If exact contact inference becomes ambiguous, change only generated bracket/horn interfaces; do not weaken validation or silently hard-code joint results.
- If the upstream file changes, generation must fail its checksum check rather than silently accepting a different model.

## Verification

1. Verify the pinned asset SHA-256 and upstream commit metadata.
2. Regenerate the AP242 example deterministically.
3. Run the exact STEP import tests and assert one repeated servo family with two instances.
4. Assert the editable first draft contains three links and two revolute joints after one template confirmation.
5. Run all JavaScript, Python/OCCT, build, Playwright, and public-release checks.
6. Inspect the 16:9 screenshot at full size and GitHub README width.
7. Verify the remote tree contains only the licensed public CAD inputs and no private-model markers.

## Acceptance Criteria

- A reader can identify two servo bodies, two output horns, brackets, and arm links without reading the caption.
- The two output axes are visually centred on their horns rather than floating away from the model.
- The public example still exercises repeated-part detection, functional-template confirmation, contact-aware topology, and two-joint motion review.
- The README preview uses the actual application and the actual generated public STEP.
- Every redistributed third-party byte has a recorded source, pinned version, checksum, and compatible license.
- No private robot geometry or retired product-specific workflow is introduced.
