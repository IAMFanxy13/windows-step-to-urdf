import unittest

from scripts.candidate_engine import generate_candidates


class CandidateEngineTests(unittest.TestCase):
    def test_finds_repeated_actuator_geometry_without_brand_or_count_rules(self):
        assembly = {
            "definitions": [{"id": "motor-def", "name": "anonymous", "faceCount": 4}],
            "occurrences": [
                {"id": "m1", "kind": "part", "definitionId": "motor-def", "sourceTransformMeters": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]},
                {"id": "m2", "kind": "part", "definitionId": "motor-def", "sourceTransformMeters": [1, 0, 0, 0.2, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]},
                {"id": "bracket", "kind": "part", "definitionId": "other", "sourceTransformMeters": [1, 0, 0, 0.1, 0, 1, 0, 0.1, 0, 0, 1, 0, 0, 0, 0, 1]},
            ],
        }
        features = {"faces": [
            {"id": "motor-def/face/1", "cylinder": {"originMeters": [0, 0, 0], "axis": [0, 0, 1], "radiusMeters": 0.004}},
            {"id": "motor-def/face/2", "cylinder": {"originMeters": [0, 0, 0.01], "axis": [0, 0, 1], "radiusMeters": 0.008}},
        ], "edges": []}
        result = generate_candidates(assembly, features)
        self.assertEqual(len(result["suspectedActuatorFamilies"]), 1)
        self.assertEqual(result["servoTemplateCandidates"], result["suspectedActuatorFamilies"])
        template = result["servoTemplateCandidates"][0]
        self.assertTrue(template["geometryFingerprint"].startswith("sha256:"))
        self.assertEqual(template["instanceIds"], ["m1", "m2"])
        self.assertEqual(len(template["outputAxisLocal"]["direction"]), 3)
        self.assertTrue(template["axisCandidates"])
        self.assertEqual(len(result["jointCandidates"]), 2)
        self.assertTrue(all(item["reviewRequired"] for item in result["jointCandidates"]))
        self.assertTrue(all(item["parentLinkId"] is None for item in result["jointCandidates"]))
        self.assertTrue(all(abs(sum(value * value for value in item["axis"]) - 1) < 1e-9 for item in result["jointCandidates"]))
        self.assertIsNotNone(result["rootRecommendation"])
        self.assertTrue(all(len(item["topologyAlternatives"]) == 2 for item in result["jointCandidates"]))
        self.assertTrue(all(item["source"] == "automatic_brep_candidate" for item in result["jointCandidates"]))
        self.assertTrue(all(item["lastModifiedBy"] == "automatic_system" for item in result["jointCandidates"]))
        self.assertEqual(len(result["rigidGroupCandidates"]), 2)

    def test_does_not_claim_unique_parts_are_actuators(self):
        result = generate_candidates({
            "definitions": [{"id": "only"}],
            "occurrences": [{"id": "one", "kind": "part", "definitionId": "only", "sourceTransformMeters": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]}],
        }, {"faces": [], "edges": []})
        self.assertEqual(result["jointCandidates"], [])

    def test_many_screws_do_not_hide_less_repeated_servos(self):
        identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        occurrences = [
            {"id": f"motor-{index}", "kind": "part", "definitionId": "motor", "sourceTransformMeters": identity}
            for index in range(13)
        ] + [
            {"id": f"screw-{index}", "kind": "part", "definitionId": "screw", "sourceTransformMeters": identity}
            for index in range(40)
        ] + [{"id": "base", "kind": "part", "definitionId": "base", "sourceTransformMeters": identity}]
        features = {"faces": [
            {"id": "motor/face/1", "cylinder": {"originMeters": [0, 0, 0], "axis": [0, 0, 1], "radiusMeters": 0.004}},
            {"id": "screw/face/1", "cylinder": {"originMeters": [0, 0, 0], "axis": [0, 0, 1], "radiusMeters": 0.0015}},
        ], "edges": []}
        definitions = [
            {"id": "motor", "name": "compact servo", "boundsMeters": {"min": [-.01, -.02, -.015], "max": [.01, .02, .015]}, "massProperties": {"volumeCubicMeters": 1e-5}},
            {"id": "screw", "name": "M3 screw", "boundsMeters": {"min": [-.0015, -.0015, -.01], "max": [.0015, .0015, .01]}, "massProperties": {"volumeCubicMeters": 1e-7}},
        ]
        result = generate_candidates({"definitions": definitions, "occurrences": occurrences}, features)
        families = {item["definitionId"]: item for item in result["rankedMechanismCandidates"]}
        self.assertIn("motor", families)
        self.assertIn("screw", families)  # low-ranked evidence remains inspectable
        self.assertGreater(families["motor"]["confidenceScore"], families["screw"]["confidenceScore"])
        self.assertEqual(len([item for item in result["jointCandidates"] if item["definitionId"] == "motor"]), 13)
        self.assertEqual(len([item for item in result["jointCandidates"] if item["definitionId"] == "screw"]), 0)

    def test_supports_one_servo_and_two_different_servo_models(self):
        identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        definitions = [{"id": id_, "name": name, "boundsMeters": {"min": [-.01, -.02, -.015], "max": [.01, .02, .015]}, "massProperties": {"volumeCubicMeters": 1e-5}} for id_, name in (("a", "servo A"), ("b", "Dynamixel B"))]
        occurrences = [{"id": "a1", "kind": "part", "definitionId": "a", "sourceTransformMeters": identity}, {"id": "b1", "kind": "part", "definitionId": "b", "sourceTransformMeters": identity}]
        features = {"faces": [{"id": f"{id_}/face/1", "cylinder": {"originMeters": [0, 0, 0], "axis": [0, 0, 1], "radiusMeters": .004}} for id_ in ("a", "b")], "edges": []}
        result = generate_candidates({"definitions": definitions, "occurrences": occurrences}, features)
        self.assertEqual({item["definitionId"] for item in result["servoTemplateCandidates"]}, {"a", "b"})
        self.assertEqual({item["definitionId"] for item in result["jointCandidates"]}, {"a", "b"})

    def test_each_repeated_instance_origin_uses_template_local_interface_center(self):
        identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        translated = [1, 0, 0, 0.2, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        assembly = {
            "definitions": [{
                "id": "motor", "name": "servo", "faceCount": 2,
                "boundsMeters": {"min": [-.01, -.01, 0], "max": [.01, .01, .03]},
                "massProperties": {"volumeCubicMeters": 1e-5},
            }],
            "occurrences": [
                {"id": "m1", "kind": "part", "definitionId": "motor", "sourceTransformMeters": identity},
                {"id": "m2", "kind": "part", "definitionId": "motor", "sourceTransformMeters": translated},
                {"id": "h1", "kind": "part", "definitionId": "housing", "sourceTransformMeters": identity},
                {"id": "h2", "kind": "part", "definitionId": "housing", "sourceTransformMeters": translated},
            ],
            "contactGraph": {"edges": [
                {"a": "m1", "b": "h1", "contactCenterMeters": [9, 9, 9], "fastenerSuppressed": False},
                {"a": "m2", "b": "h2", "contactCenterMeters": [8, 8, 8], "fastenerSuppressed": False},
            ]},
        }
        features = {
            "faces": [{"id": "motor/face/1", "cylinder": {"originMeters": [0, 0, 0], "axis": [0, 0, 1], "radiusMeters": .004}}],
            "edges": [{"id": "motor/edge/1", "circle": {"originMeters": [0, 0, .02], "axis": [0, 0, 1], "radiusMeters": .004}}],
        }

        result = generate_candidates(assembly, features)
        origins = {item["actuatorOccurrenceId"]: item["originMeters"] for item in result["jointCandidates"]}

        self.assertEqual(origins["m1"], [0, 0, .02])
        self.assertEqual(origins["m2"], [.2, 0, .02])

    def test_clearance_edges_cannot_be_selected_as_servo_housing_contacts(self):
        identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        assembly = {
            "definitions": [{"id": "motor", "name": "servo", "faceCount": 1}],
            "occurrences": [
                {"id": id_, "kind": "part", "definitionId": "motor" if id_ == "motor" else id_, "sourceTransformMeters": identity}
                for id_ in ("motor", "output", "housing", "clearance")
            ],
            "contactGraph": {"edges": [
                {"a": "motor", "b": "output", "contactCenterMeters": [0, 0, .001], "interfaceClass": "FIXED_PLANAR_INTERFACE", "fastenerSuppressed": False},
                {"a": "motor", "b": "housing", "contactCenterMeters": [0, 0, .02], "interfaceClass": "FIXED_PLANAR_INTERFACE", "fastenerSuppressed": False},
                {"a": "motor", "b": "clearance", "closestPointMidpointMeters": [0, 0, .05], "interfaceClass": "CLEARANCE", "fastenerSuppressed": False},
            ]},
        }
        features = {"faces": [{"id": "motor/face/1", "cylinder": {"originMeters": [0, 0, 0], "axis": [0, 0, 1], "radiusMeters": .004}}], "edges": []}

        result = generate_candidates(assembly, features)
        candidate = next(item for item in result["jointCandidates"] if item["actuatorOccurrenceId"] == "motor")

        self.assertEqual(candidate["outputSideOccurrenceIds"], ["output"])
        self.assertEqual(candidate["housingSideOccurrenceIds"], ["housing"])


if __name__ == "__main__":
    unittest.main()
