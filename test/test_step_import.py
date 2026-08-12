import json
import struct
import tempfile
import unittest
from pathlib import Path

from scripts import occt_step
from scripts.occt_step import import_step
from fixtures.generate_step_fixtures import (
    write_coaxial_contact_assembly,
    write_planar_contact_assembly,
    write_two_joint_servo_arm,
    write_two_part_assembly,
)
from scripts.candidate_engine import generate_candidates


class StepImportTests(unittest.TestCase):
    def test_bakes_mirrored_occurrence_mesh_and_exposes_right_handed_residual_transform(self):
        with tempfile.TemporaryDirectory(prefix="step-urdf-mirror-") as directory:
            root = Path(directory)
            source = root / "definition.stl"
            source.write_bytes(b"mirror".ljust(80, b"\0") + struct.pack("<I12fH", 1, 0, 0, 1, 0, 0, 0, 0.1, 0, 0, 0, 0.1, 0, 0))
            collision_source = root / "collision.stl"
            collision_source.write_bytes(source.read_bytes())
            prepare = getattr(occt_step, "_prepare_mirrored_occurrence", None)
            self.assertIsNotNone(prepare, "mirror occurrence preparation is missing")
            occurrence = {"id": "occ:1/2", "sourceTransformMeters": [-1, 0, 0, 0.1, 0, 1, 0, 0.2, 0, 0, 1, 0.3, 0, 0, 0, 1]}
            try:
                prepare(occurrence, source, root, collision_source)
            except TypeError as error:
                self.fail(f"mirror preparation does not support collision meshes: {error}")
            self.assertTrue(occurrence["meshReflectionBaked"])
            self.assertTrue((root / occurrence["mesh"]).is_file())
            self.assertTrue((root / occurrence["collisionMesh"]).is_file())
            self.assertGreater(occurrence["meshTransformDiagnostics"]["determinant"], 0)

    def test_extracts_exact_planar_contact_interface(self):
        with tempfile.TemporaryDirectory(prefix="step-urdf-planar-contact-") as directory:
            root = Path(directory)
            result = import_step(write_planar_contact_assembly(root / "planar.step"), root / "out")
            edges = result["contactGraph"]["edges"]
            self.assertEqual(len(edges), 1)
            edge = edges[0]
            self.assertEqual(edge["interfaceClass"], "FIXED_PLANAR_INTERFACE")
            self.assertEqual(edge["faceNormalRelation"], "OPPOSED")
            self.assertEqual(edge["contactAreaMethod"], "EXACT_BREP_COMMON_SURFACE")
            self.assertAlmostEqual(edge["contactAreaSquareMeters"], 0.0004, places=8)
            self.assertEqual(len(edge["contactCenterMeters"]), 3)
            self.assertAlmostEqual(edge["contactCenterMeters"][0], 0.02, places=8)
            self.assertAlmostEqual(edge["contactCenterMeters"][1], 0.01, places=8)
            self.assertAlmostEqual(edge["contactCenterMeters"][2], 0.01, places=8)
            self.assertEqual(len(edge["closestPointMidpointMeters"]), 3)
            self.assertTrue(edge["interfacePairs"])
            self.assertEqual(edge["rigidDecision"], "FIXED_LIKELY")

    def test_extracts_coaxial_cylindrical_rotational_interface(self):
        with tempfile.TemporaryDirectory(prefix="step-urdf-coaxial-contact-") as directory:
            root = Path(directory)
            result = import_step(write_coaxial_contact_assembly(root / "coaxial.step"), root / "out")
            edges = result["contactGraph"]["edges"]
            self.assertEqual(len(edges), 1)
            edge = edges[0]
            self.assertTrue(edge["coaxialRelation"])
            self.assertEqual(edge["interfaceClass"], "ROTATIONAL_CYLINDRICAL_INTERFACE")
            self.assertEqual(edge["rigidDecision"], "ROTATIONAL_INTERFACE")
            self.assertTrue(any(pair["coaxialRelation"] for pair in edge["interfacePairs"]))

    def test_imports_real_xcaf_assembly_hierarchy_and_instance_transform(self):
        with tempfile.TemporaryDirectory(prefix="step-urdf-") as directory:
            root = Path(directory)
            source = write_two_part_assembly(root / "assembly.step")
            result = import_step(source, root / "out")
            self.assertTrue(any("AP242" in schema for schema in result["source"]["stepSchemas"]))
            parts = [item for item in result["occurrences"] if item["kind"] == "part"]
            self.assertEqual(len(result["definitions"]), 2)
            self.assertEqual(len(parts), 2)
            self.assertEqual(len([item for item in result["occurrences"] if item["kind"] == "assembly"]), 1)
            translations = sorted(round(item["sourceTransformMeters"][3], 6) for item in parts)
            self.assertEqual(translations, [0.0, 0.1])
            for definition in result["definitions"]:
                mesh = root / "out" / definition["mesh"]
                collision_mesh = root / "out" / definition["collisionMesh"]
                self.assertTrue(mesh.is_file())
                self.assertTrue(collision_mesh.is_file())
                self.assertEqual(definition["collisionMeshSource"], "occt_brep_coarse_tessellation")
                triangle_count = int.from_bytes(mesh.read_bytes()[80:84], "little")
                self.assertEqual(sum(item["triangleCount"] for item in definition["triangleFaceRanges"]), triangle_count)
                self.assertGreater(definition["massProperties"]["volumeCubicMeters"], 0)
                self.assertEqual(definition["massProperties"]["massStatus"], "density_required")

            features = json.loads((root / "out" / "brep_features.json").read_text("utf-8"))
            self.assertGreater(sum("cylinder" in face for face in features["faces"]), 0)
            self.assertGreater(sum("circle" in edge for edge in features["edges"]), 0)

    def test_rejects_non_step_inputs(self):
        with tempfile.TemporaryDirectory(prefix="step-urdf-") as directory:
            root = Path(directory)
            source = root / "assembly.txt"
            source.write_text("not step", "ascii")
            with self.assertRaisesRegex(Exception, "step or .stp"):
                import_step(source, root / "out")

    def test_normalizes_millimetre_metre_and_inch_step_files_to_identical_metres(self):
        with tempfile.TemporaryDirectory(prefix="step-urdf-units-") as directory:
            root = Path(directory)
            imported = {}
            for unit in ("millimetre", "metre", "inch"):
                source = write_two_part_assembly(root / f"assembly-{unit}.step", source_unit=unit)
                imported[unit] = import_step(source, root / f"out-{unit}")

            for unit, result in imported.items():
                parts = [item for item in result["occurrences"] if item["kind"] == "part"]
                translations = sorted(round(item["sourceTransformMeters"][3], 9) for item in parts)
                self.assertEqual(translations, [0.0, 0.1], unit)
                self.assertEqual(result["source"]["normalizedLengthUnit"], "metre")
                self.assertAlmostEqual(result["source"]["transferSystemLengthUnitMeters"], 1.0)

            reference = imported["metre"]["definitions"]
            for unit in ("millimetre", "inch"):
                definitions = imported[unit]["definitions"]
                self.assertEqual(len(definitions), len(reference))
                for actual, expected in zip(definitions, reference):
                    self.assertAlmostEqual(actual["massProperties"]["volumeCubicMeters"], expected["massProperties"]["volumeCubicMeters"], places=12, msg=unit)
                    self.assertEqual(actual["faceCount"], expected["faceCount"])
                    self.assertEqual(actual["edgeCount"], expected["edgeCount"])

    def test_two_joint_example_produces_an_automatic_movable_first_draft(self):
        with tempfile.TemporaryDirectory(prefix="step-urdf-example-") as directory:
            root = Path(directory)
            result = import_step(write_two_joint_servo_arm(root / "two-joint.step"), root / "out")
            features = json.loads((root / "out" / "brep_features.json").read_text("utf-8"))
            candidates = generate_candidates(result, features)
            parts = [item for item in result["occurrences"] if item["kind"] == "part"]
            self.assertEqual(len(parts), 5)
            self.assertEqual(len(candidates["jointCandidates"]), 2)
            self.assertEqual(len(candidates["rigidGroupCandidates"]), 2)
            self.assertTrue(all(item["topologyAlternatives"] for item in candidates["jointCandidates"]))
            self.assertTrue(all(item["outputPortContactClassification"]["method"] == "EXACT_BREP_CONTACT_CENTER" for item in candidates["jointCandidates"]))


if __name__ == "__main__":
    unittest.main()
