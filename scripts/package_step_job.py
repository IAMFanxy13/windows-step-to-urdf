"""Validate and package one generic STEP-derived URDF job."""

from __future__ import annotations

import argparse
import json
import math
import shutil
import struct
import zipfile
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree


class StepPackageError(RuntimeError):
    pass


def _json(path: Path):
    return json.loads(path.read_text("utf-8"))


def _safe_mesh(value: str) -> PurePosixPath:
    result = PurePosixPath(value.replace("\\", "/"))
    if result.is_absolute() or ".." in result.parts or result.parts[:1] != ("meshes",):
        raise StepPackageError(f"unsafe mesh path: {value}")
    return result


def _numbers(value: str, count: int):
    try:
        result = [float(item) for item in value.split()]
    except ValueError as error:
        raise StepPackageError(f"invalid numeric tuple: {value}") from error
    if len(result) != count or not all(math.isfinite(item) for item in result):
        raise StepPackageError(f"invalid numeric tuple: {value}")
    return result


def _binary_stl_extents(path: Path):
    data = path.read_bytes()
    if len(data) < 84:
        raise StepPackageError(f"mesh is not a valid binary STL: {path.name}")
    count = struct.unpack_from("<I", data, 80)[0]
    if len(data) != 84 + count * 50 or count == 0:
        raise StepPackageError(f"mesh is not a valid non-empty binary STL: {path.name}")
    minimum, maximum = [math.inf] * 3, [-math.inf] * 3
    for index in range(count):
        values = struct.unpack_from("<12f", data, 84 + index * 50)
        for offset in (3, 6, 9):
            for axis in range(3):
                minimum[axis] = min(minimum[axis], values[offset + axis])
                maximum[axis] = max(maximum[axis], values[offset + axis])
    return [maximum[axis] - minimum[axis] for axis in range(3)]


def validate_urdf(urdf: str, model: dict, job: Path) -> dict:
    unbaked_mirrors = [item for item in model.get("mirroredOccurrences", []) if not item.get("meshBaked")]
    if unbaked_mirrors:
        raise StepPackageError("mirrored STEP occurrences require reflection-baked meshes and right-handed residual frames")
    try:
        root = ElementTree.fromstring(urdf)
    except ElementTree.ParseError as error:
        raise StepPackageError(f"invalid URDF XML: {error}") from error
    if root.tag != "robot":
        raise StepPackageError("URDF root must be <robot>")
    links = root.findall("link")
    joints = root.findall("joint")
    if len(links) != len(model.get("rigidGroups", [])):
        raise StepPackageError("URDF link count differs from robot model")
    if len(joints) != len(model.get("joints", [])) or any(joint.get("type") != "revolute" for joint in joints):
        raise StepPackageError("URDF must contain exactly the model's revolute joints")
    link_names = {link.get("name") for link in links}
    model_joints = {joint.get("name"): joint for joint in model.get("joints", [])}
    children, graph = set(), {name: [] for name in link_names}
    for link in links:
        inertial = link.find("inertial")
        if inertial is None or not (float(inertial.find("mass").get("value")) > 0):
            raise StepPackageError(f"link {link.get('name')} has no positive mass")
        inertia = inertial.find("inertia")
        ixx, ixy, ixz, iyy, iyz, izz = [float(inertia.get(key)) for key in ("ixx", "ixy", "ixz", "iyy", "iyz", "izz")]
        minor2 = ixx * iyy - ixy * ixy
        determinant = ixx * (iyy * izz - iyz * iyz) - ixy * (ixy * izz - iyz * ixz) + ixz * (ixy * iyz - iyy * ixz)
        if not all(math.isfinite(value) for value in (ixx, ixy, ixz, iyy, iyz, izz)) or ixx <= 0 or minor2 <= 0 or determinant <= 0:
            raise StepPackageError(f"link {link.get('name')} inertia is not positive definite")
    for joint in joints:
        model_joint = model_joints.get(joint.get("name"))
        if not model_joint:
            raise StepPackageError(f"joint {joint.get('name')} is missing from RobotModel")
        if model_joint.get("reviewRequired") is True:
            raise StepPackageError(f"joint {joint.get('name')} still has unresolved high-risk ambiguity")
        confirmation = model_joint.get("confirmation", {})
        if not all(confirmation.get(key) is True for key in ("axis", "topology", "movingSide", "limits")):
            raise StepPackageError(f"joint {joint.get('name')} is not fully user-confirmed")
        if model_joint.get("limits", {}).get("source") != "user":
            raise StepPackageError(f"joint {joint.get('name')} limits are not user supplied")
        parent = joint.find("parent").get("link")
        child = joint.find("child").get("link")
        if parent not in link_names or child not in link_names or child in children:
            raise StepPackageError("joint graph has unknown links or multiple parents")
        children.add(child)
        graph[parent].append(child)
        _numbers(joint.find("origin").get("xyz"), 3)
        axis = _numbers(joint.find("axis").get("xyz"), 3)
        if abs(math.sqrt(sum(value * value for value in axis)) - 1) > 1e-6:
            raise StepPackageError(f"joint {joint.get('name')} axis is not unit length")
        limit = joint.find("limit")
        lower, upper = float(limit.get("lower")), float(limit.get("upper"))
        if not all(math.isfinite(value) for value in (lower, upper)) or lower >= upper:
            raise StepPackageError(f"joint {joint.get('name')} has invalid user limits")
        if not lower <= 0 <= upper:
            raise StepPackageError(f"joint {joint.get('name')} limits do not include the STEP zero pose")
        dynamics = model_joint.get("dynamics", {})
        effort, velocity = float(limit.get("effort")), float(limit.get("velocity"))
        if dynamics.get("source") != "user" or not (dynamics.get("effort", 0) > 0) or not (dynamics.get("velocity", 0) > 0):
            raise StepPackageError(f"joint {joint.get('name')} requires user-supplied positive effort and velocity")
        if not math.isclose(effort, float(dynamics["effort"]), rel_tol=1e-9) or not math.isclose(velocity, float(dynamics["velocity"]), rel_tol=1e-9):
            raise StepPackageError(f"joint {joint.get('name')} effort and velocity differ from RobotModel")
    roots = link_names - children
    if len(roots) != 1:
        raise StepPackageError(f"expected one root link, found {len(roots)}")
    visited, active = set(), set()
    def visit(name):
        if name in active:
            raise StepPackageError("joint graph contains a cycle")
        if name in visited:
            return
        active.add(name)
        for child in graph[name]:
            visit(child)
        active.remove(name)
        visited.add(name)
    visit(next(iter(roots)))
    if visited != link_names:
        raise StepPackageError("joint graph contains isolated links")

    visual_mesh_names = [mesh.get("filename", "") for mesh in root.findall(".//visual/geometry/mesh")]
    collision_mesh_names = [mesh.get("filename", "") for mesh in root.findall(".//collision/geometry/mesh")]
    if len(collision_mesh_names) != len(visual_mesh_names):
        raise StepPackageError("each visual mesh occurrence requires a collision mesh occurrence")
    independent_collision_meshes = bool(collision_mesh_names) and all(
        collision != visual for visual, collision in zip(visual_mesh_names, collision_mesh_names)
    )
    mesh_paths = []
    mesh_extents = {}
    for mesh in root.findall(".//mesh"):
        relative = _safe_mesh(mesh.get("filename", ""))
        source_relative = PurePosixPath(*relative.parts[1:])
        source = job / "analysis" / Path(*source_relative.parts)
        if not source.is_file():
            raise StepPackageError(f"mesh does not exist: {relative.as_posix()}")
        scale = _numbers(mesh.get("scale", "1 1 1"), 3)
        if any(abs(value - 1) > 1e-12 for value in scale):
            raise StepPackageError("STEP meshes are already metres; URDF mesh scale must be 1 1 1")
        if relative.as_posix() not in mesh_extents:
            extents = _binary_stl_extents(source)
            largest = max(extents)
            if largest < 1e-5 or largest > 20:
                raise StepPackageError(f"mesh metre scale is implausible: {relative.as_posix()} extents={extents}")
            mesh_extents[relative.as_posix()] = extents
        mesh_paths.append((relative, source))
    if not mesh_paths:
        raise StepPackageError("URDF contains no meshes")
    assembly_path = job / "analysis" / "assembly.json"
    if assembly_path.is_file():
        assembly = _json(assembly_path)
        translations = [abs(item["sourceTransformMeters"][index]) for item in assembly.get("occurrences", []) for index in (3, 7, 11)]
        if translations and max(translations) > 20:
            raise StepPackageError("assembly translations are implausible for a metre-scale servo robot")
    return {
        "ok": True,
        "linkCount": len(links),
        "revoluteJointCount": len(joints),
        "root": next(iter(roots)),
        "meshReferenceCount": len(mesh_paths),
        "meshExtentsMeters": mesh_extents,
        "meshPaths": mesh_paths,
        "collisionGeometry": "independent_collision_meshes" if independent_collision_meshes else "visual_mesh_copy_temporary",
    }


def package_step_job(job: Path, project_root: Path) -> Path:
    request = _json(job / "export_request.json")
    urdf, model = request.get("urdf"), request.get("robotModel")
    if not isinstance(urdf, str) or not isinstance(model, dict):
        raise StepPackageError("export request requires urdf and robotModel")
    validation = validate_urdf(urdf, model, job)
    output = job / "output-step"
    if output.exists():
        shutil.rmtree(output)
    (output / "reports").mkdir(parents=True)
    (output / "robot.urdf").write_text(urdf.rstrip() + "\n", "utf-8")
    (output / "robot-model.json").write_text(json.dumps(model, ensure_ascii=False, indent=2) + "\n", "utf-8")
    report = {key: value for key, value in validation.items() if key != "meshPaths"}
    report["effortVelocity"] = "user_supplied_and_matched_to_robot_model"
    (output / "reports" / "urdf_validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")
    for name in ("assembly.json", "brep_features.json", "joint_candidates.json"):
        source = job / "analysis" / name
        if source.is_file():
            target = output / "reports" / name
            shutil.copy2(source, target)
    copied = set()
    for relative, source in validation["meshPaths"]:
        if relative in copied:
            continue
        copied.add(relative)
        target = output / Path(*relative.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    notices = project_root / "THIRD_PARTY_NOTICES.md"
    if notices.is_file():
        shutil.copy2(notices, output / notices.name)
    bundle = output / "step_urdf_bundle.zip"
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(item for item in output.rglob("*") if item.is_file() and item != bundle):
            archive.write(path, path.relative_to(output).as_posix())
    return bundle


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-dir", type=Path, required=True)
    parser.add_argument("--project-root", type=Path, required=True)
    args = parser.parse_args(argv)
    package_step_job(args.job_dir.resolve(), args.project_root.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
