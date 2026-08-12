import json
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path

from scripts.package_step_job import StepPackageError, package_step_job


def one_triangle_stl() -> bytes:
    return b"meter fixture".ljust(80, b"\0") + struct.pack("<I12fH", 1, 0, 0, 1, 0, 0, 0, 0.1, 0, 0, 0, 0.1, 0, 0)


class PackageStepJobTests(unittest.TestCase):
    def make_job(self, root: Path):
        job = root / "job"
        (job / "analysis" / "definitions").mkdir(parents=True)
        (job / "analysis" / "definitions" / "part.stl").write_bytes(one_triangle_stl())
        (job / "source.step").write_bytes(b"ISO-10303-21;")
        for name, value in {
            "assembly.json": {"source": {"sha256": "abc"}},
            "brep_features.json": {"faces": [], "edges": []},
            "joint_candidates.json": {"jointCandidates": []},
        }.items():
            (job / "analysis" / name).write_text(json.dumps(value), "utf-8")
        model = {"rigidGroups": [{"id": "g", "name": "base", "occurrenceIds": ["o"]}], "joints": [], "rootLinkId": "g"}
        urdf = '''<robot name="generic"><link name="base"><inertial><origin xyz="0 0 0"/><mass value="1"/><inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/></inertial><visual><geometry><mesh filename="meshes/definitions/part.stl" scale="1 1 1"/></geometry></visual><collision><geometry><mesh filename="meshes/definitions/part.stl" scale="1 1 1"/></geometry></collision></link></robot>'''
        (job / "export_request.json").write_text(json.dumps({"urdf": urdf, "robotModel": model}), "utf-8")
        return job

    def test_packages_generic_job_without_static_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            job = self.make_job(Path(temp))
            bundle = package_step_job(job, Path(temp))
            with zipfile.ZipFile(bundle) as archive:
                names = set(archive.namelist())
                self.assertIn("robot.urdf", names)
                self.assertIn("robot-model.json", names)
                self.assertIn("meshes/definitions/part.stl", names)
                self.assertIn("reports/urdf_validation.json", names)
                self.assertNotIn("model_manifest.json", names)

    def test_rejects_unsafe_mesh_path(self):
        with tempfile.TemporaryDirectory() as temp:
            job = self.make_job(Path(temp))
            request = json.loads((job / "export_request.json").read_text("utf-8"))
            request["urdf"] = request["urdf"].replace("meshes/definitions/part.stl", "../secret.stl")
            (job / "export_request.json").write_text(json.dumps(request), "utf-8")
            with self.assertRaisesRegex(StepPackageError, "unsafe mesh"):
                package_step_job(job, Path(temp))

    def test_rejects_limits_that_exclude_step_zero_even_if_urdf_xml_is_well_formed(self):
        with tempfile.TemporaryDirectory() as temp:
            job = self.make_job(Path(temp))
            request = json.loads((job / "export_request.json").read_text("utf-8"))
            request["robotModel"] = {
                "rigidGroups": [
                    {"id": "g1", "name": "base", "occurrenceIds": ["o1"]},
                    {"id": "g2", "name": "arm", "occurrenceIds": ["o2"]},
                ],
                "joints": [{
                    "id": "j1", "name": "elbow", "type": "revolute",
                    "parentLinkId": "g1", "childLinkId": "g2", "movingSideLinkId": "g2",
                    "originMeters": [0, 0, 0], "axis": [0, 0, 1], "reviewRequired": False,
                    "limits": {"lowerRadians": 0.1, "upperRadians": 0.5, "source": "user"},
                    "dynamics": {"effort": 1, "velocity": 1, "source": "user"},
                    "confirmation": {"axis": True, "topology": True, "movingSide": True, "limits": True},
                }],
                "rootLinkId": "g1",
            }
            link = '<link name="{name}"><inertial><mass value="1"/><inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/></inertial><visual><geometry><mesh filename="meshes/definitions/part.stl" scale="1 1 1"/></geometry></visual></link>'
            request["urdf"] = '<robot name="r">' + link.format(name="base") + link.format(name="arm") + '<joint name="elbow" type="revolute"><parent link="base"/><child link="arm"/><origin xyz="0 0 0" rpy="0 0 0"/><axis xyz="0 0 1"/><limit lower="0.1" upper="0.5" effort="1" velocity="1"/></joint></robot>'
            (job / "export_request.json").write_text(json.dumps(request), "utf-8")
            with self.assertRaisesRegex(StepPackageError, "zero pose"):
                package_step_job(job, Path(temp))

    def test_rejects_placeholder_effort_and_velocity_for_formal_package(self):
        with tempfile.TemporaryDirectory() as temp:
            job = self.make_job(Path(temp))
            request = json.loads((job / "export_request.json").read_text("utf-8"))
            request["robotModel"] = {
                "rigidGroups": [
                    {"id": "g1", "name": "base", "occurrenceIds": ["o1"]},
                    {"id": "g2", "name": "arm", "occurrenceIds": ["o2"]},
                ],
                "joints": [{
                    "id": "j1", "name": "elbow", "type": "revolute",
                    "parentLinkId": "g1", "childLinkId": "g2", "movingSideLinkId": "g2",
                    "originMeters": [0, 0, 0], "axis": [0, 0, 1], "reviewRequired": False,
                    "limits": {"lowerRadians": -0.5, "upperRadians": 0.5, "source": "user"},
                    "confirmation": {"axis": True, "topology": True, "movingSide": True, "limits": True},
                }],
                "rootLinkId": "g1",
            }
            link = '<link name="{name}"><inertial><mass value="1"/><inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/></inertial><visual><geometry><mesh filename="meshes/definitions/part.stl" scale="1 1 1"/></geometry></visual><collision><geometry><mesh filename="meshes/definitions/part.stl" scale="1 1 1"/></geometry></collision></link>'
            request["urdf"] = '<robot name="r">' + link.format(name="base") + link.format(name="arm") + '<joint name="elbow" type="revolute"><parent link="base"/><child link="arm"/><origin xyz="0 0 0" rpy="0 0 0"/><axis xyz="0 0 1"/><limit lower="-0.5" upper="0.5" effort="1" velocity="1"/></joint></robot>'
            (job / "export_request.json").write_text(json.dumps(request), "utf-8")
            with self.assertRaisesRegex(StepPackageError, "effort and velocity"):
                package_step_job(job, Path(temp))

    def test_rejects_unbaked_mirrored_occurrence(self):
        with tempfile.TemporaryDirectory() as temp:
            job = self.make_job(Path(temp))
            request = json.loads((job / "export_request.json").read_text("utf-8"))
            request["robotModel"]["mirroredOccurrences"] = [{"occurrenceId": "o", "determinant": -1, "meshBaked": False}]
            (job / "export_request.json").write_text(json.dumps(request), "utf-8")
            with self.assertRaisesRegex(StepPackageError, "reflection-baked"):
                package_step_job(job, Path(temp))

    def test_reports_and_packages_independent_collision_meshes(self):
        with tempfile.TemporaryDirectory() as temp:
            job = self.make_job(Path(temp))
            (job / "analysis" / "collision").mkdir()
            (job / "analysis" / "collision" / "part.stl").write_bytes(one_triangle_stl())
            request = json.loads((job / "export_request.json").read_text("utf-8"))
            request["urdf"] = request["urdf"].replace(
                '<collision><geometry><mesh filename="meshes/definitions/part.stl" scale="1 1 1"/></geometry></collision>',
                '<collision><geometry><mesh filename="meshes/collision/part.stl" scale="1 1 1"/></geometry></collision>',
            )
            (job / "export_request.json").write_text(json.dumps(request), "utf-8")

            bundle = package_step_job(job, Path(temp))
            report = json.loads((job / "output-step" / "reports" / "urdf_validation.json").read_text("utf-8"))
            self.assertEqual(report["collisionGeometry"], "independent_collision_meshes")
            with zipfile.ZipFile(bundle) as archive:
                self.assertIn("meshes/collision/part.stl", archive.namelist())


if __name__ == "__main__":
    unittest.main()
