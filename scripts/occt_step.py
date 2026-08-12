"""Exact STEP/XCAF import primitives used by the standalone Windows worker."""

from __future__ import annotations

import hashlib
import json
import math
import re
import struct
from pathlib import Path

from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from OCP.BRep import BRep_Tool
from OCP.BRepGProp import BRepGProp
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepTools import BRepTools
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_ReturnStatus
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TColStd import TColStd_SequenceOfAsciiString
from OCP.TCollection import TCollection_AsciiString, TCollection_ExtendedString
from OCP.TDF import TDF_Label, TDF_LabelSequence, TDF_Tool
from OCP.TDataStd import TDataStd_Name
from OCP.TDocStd import TDocStd_Document
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_REVERSED
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.gp import gp_Trsf
from OCP.TopoDS import TopoDS
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ShapeTool

try:
    from scripts.mesh_variants import bake_reflected_binary_stl
except ModuleNotFoundError:  # worker execution with scripts/ as sys.path root
    from mesh_variants import bake_reflected_binary_stl


class StepImportError(RuntimeError):
    pass


def _label_entry(label: TDF_Label) -> str:
    value = TCollection_AsciiString()
    TDF_Tool.Entry_s(label, value)
    return value.ToCString()


def _label_name(label: TDF_Label) -> str | None:
    attribute = TDataStd_Name()
    if label.FindAttribute(TDataStd_Name.GetID_s(), attribute):
        value = attribute.Get().ToExtString().strip()
        return value or None
    return None


def _matrix(location) -> list[float]:
    transform = location.Transformation()
    result = [0.0] * 16
    for row in range(3):
        for column in range(3):
            result[row * 4 + column] = transform.Value(row + 1, column + 1)
        result[row * 4 + 3] = transform.Value(row + 1, 4)
    result[15] = 1.0
    return result


def _multiply(a: list[float], b: list[float]) -> list[float]:
    return [sum(a[row * 4 + k] * b[k * 4 + column] for k in range(4))
            for row in range(4) for column in range(4)]


IDENTITY = [1.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 0.0, 1.0]


def _transform_diagnostics(matrix: list[float], tolerance: float = 1e-6) -> dict:
    rotation = [[matrix[row * 4 + column] for column in range(3)] for row in range(3)]
    dot = lambda a, b: sum(a[i] * b[i] for i in range(3))
    errors = [abs(dot(rotation[i], rotation[j]) - (1.0 if i == j else 0.0)) for i in range(3) for j in range(3)]
    determinant = (
        rotation[0][0] * (rotation[1][1] * rotation[2][2] - rotation[1][2] * rotation[2][1])
        - rotation[0][1] * (rotation[1][0] * rotation[2][2] - rotation[1][2] * rotation[2][0])
        + rotation[0][2] * (rotation[1][0] * rotation[2][1] - rotation[1][1] * rotation[2][0])
    )
    error = max(errors)
    return {"finite": all(math.isfinite(value) for value in matrix[:12]), "orthogonalityError": error,
            "determinant": determinant, "mirrored": determinant < 0,
            "validRigidTransform": error <= tolerance and abs(abs(determinant) - 1.0) <= tolerance}


def _prepare_mirrored_occurrence(occurrence: dict, definition_mesh: Path, output_root: Path,
                                 collision_mesh: Path | None = None) -> dict:
    matrix = occurrence["sourceTransformMeters"]
    diagnostics = _transform_diagnostics(matrix)
    if not diagnostics["mirrored"]:
        occurrence["meshReflectionBaked"] = False
        return occurrence
    safe_id = re.sub(r"[^A-Za-z0-9_.-]+", "_", occurrence["id"]).strip("_") or "occurrence"
    relative = Path("instances") / f"{safe_id}_reflection_baked.stl"
    bake_reflected_binary_stl(definition_mesh, output_root / relative, axis=0)
    collision_relative = None
    if collision_mesh is not None:
        collision_relative = Path("collision-instances") / f"{safe_id}_reflection_baked.stl"
        bake_reflected_binary_stl(collision_mesh, output_root / collision_relative, axis=0)
    residual = list(matrix)
    for index in (0, 4, 8):
        residual[index] = -residual[index]
    residual_diagnostics = _transform_diagnostics(residual)
    if not residual_diagnostics["validRigidTransform"] or residual_diagnostics["mirrored"]:
        raise StepImportError(f"Could not construct a right-handed residual frame for {occurrence['id']}")
    occurrence.update({
        "mesh": relative.as_posix(),
        "meshTransformMeters": residual,
        "meshTransformDiagnostics": residual_diagnostics,
        "meshReflectionBaked": True,
        "mirrorBakeAxisLocal": "x",
    })
    if collision_relative is not None:
        occurrence.update({
            "collisionMesh": collision_relative.as_posix(),
            "collisionMeshSource": "occt_brep_coarse_tessellation+reflection_baked",
        })
    return occurrence


def _shape_at_matrix(shape, matrix: list[float]):
    transform = gp_Trsf()
    transform.SetValues(*[matrix[row * 4 + column] for row in range(3) for column in range(4)])
    return shape.Moved(TopLoc_Location(transform))


def _bounds_metrics(a: dict, b: dict) -> tuple[float, list[float], float, str]:
    gaps = [max(0.0, a["min"][i] - b["max"][i], b["min"][i] - a["max"][i]) for i in range(3)]
    overlaps = [max(0.0, min(a["max"][i], b["max"][i]) - max(a["min"][i], b["min"][i])) for i in range(3)]
    contains = lambda outer, inner: all(outer["min"][i] <= inner["min"][i] and outer["max"][i] >= inner["max"][i] for i in range(3))
    containment = "A_CONTAINS_B" if contains(a, b) else "B_CONTAINS_A" if contains(b, a) else "NONE"
    ordered = sorted(overlaps, reverse=True)
    return math.sqrt(sum(value * value for value in gaps)), overlaps, ordered[0] * ordered[1], containment


def _looks_like_fastener_name(name: str) -> bool:
    value = name.casefold()
    return any(token in value for token in ("screw", "bolt", "nut", "washer", "bearing", "螺钉", "螺栓", "螺母", "垫片", "轴承"))


def _vector_dot(left: list[float], right: list[float]) -> float:
    return sum(left[index] * right[index] for index in range(3))


def _vector_cross(left: list[float], right: list[float]) -> list[float]:
    return [left[1] * right[2] - left[2] * right[1],
            left[2] * right[0] - left[0] * right[2],
            left[0] * right[1] - left[1] * right[0]]


def _vector_length(value: list[float]) -> float:
    return math.sqrt(_vector_dot(value, value))


def _direction_values(direction, reverse: bool = False) -> list[float]:
    sign = -1.0 if reverse else 1.0
    return [sign * direction.X(), sign * direction.Y(), sign * direction.Z()]


def _world_face_records(shape, occurrence_id: str, definition_id: str) -> list[dict]:
    records = []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    index = 0
    while explorer.More():
        index += 1
        face = TopoDS.Face_s(explorer.Current())
        adaptor = BRepAdaptor_Surface(face, True)
        kind = str(adaptor.GetType()).split(".")[-1]
        record = {
            "shape": face,
            "occurrenceFaceId": f"{occurrence_id}/face/{index}",
            "definitionFaceId": f"{definition_id}/face/{index}",
            "surfaceType": kind,
            "bounds": _bounds_meters(face),
            "normal": None,
            "cylinder": None,
        }
        reversed_face = face.Orientation() == TopAbs_REVERSED
        if kind == "GeomAbs_Plane":
            record["normal"] = _direction_values(adaptor.Plane().Axis().Direction(), reversed_face)
        elif kind == "GeomAbs_Cylinder":
            cylinder = adaptor.Cylinder()
            record["cylinder"] = {
                "originMeters": [cylinder.Axis().Location().X(), cylinder.Axis().Location().Y(), cylinder.Axis().Location().Z()],
                "axis": _direction_values(cylinder.Axis().Direction()),
                "radiusMeters": cylinder.Radius(),
            }
        records.append(record)
        explorer.Next()
    return records


def _coaxial_cylinders(left: dict, right: dict, tolerance: float) -> bool:
    a, b = left.get("cylinder"), right.get("cylinder")
    if not a or not b:
        return False
    if abs(_vector_dot(a["axis"], b["axis"])) < 1.0 - 1e-7:
        return False
    if abs(a["radiusMeters"] - b["radiusMeters"]) > max(tolerance, max(a["radiusMeters"], b["radiusMeters"]) * 1e-5):
        return False
    delta = [b["originMeters"][index] - a["originMeters"][index] for index in range(3)]
    return _vector_length(_vector_cross(delta, a["axis"])) <= tolerance


def _exact_common_surface(left_face, right_face, tolerance: float) -> dict | None:
    try:
        common = BRepAlgoAPI_Common(left_face, right_face)
        common.SetFuzzyValue(tolerance)
        common.Build()
        if not common.IsDone() or common.Shape().IsNull():
            return None
        properties = GProp_GProps()
        BRepGProp.SurfaceProperties_s(common.Shape(), properties)
        area = properties.Mass()
        if not math.isfinite(area):
            return None
        center = properties.CentreOfMass()
        return {
            "areaSquareMeters": area if area > 1e-12 else 0.0,
            "centerMeters": [center.X(), center.Y(), center.Z()] if area > 1e-12 else None,
        }
    except Exception:
        return None


def _face_interface_pairs(left: dict, right: dict, tolerance: float) -> list[dict]:
    pairs, zero_area_pairs = [], []
    for left_face in left.get("faces", []):
        for right_face in right.get("faces", []):
            bbox_distance, _, _, _ = _bounds_metrics(left_face["bounds"], right_face["bounds"])
            if bbox_distance > tolerance:
                continue
            distance = BRepExtrema_DistShapeShape(left_face["shape"], right_face["shape"])
            distance.Perform()
            if not distance.IsDone() or distance.Value() > tolerance:
                continue
            normal_relation = "UNKNOWN"
            if left_face.get("normal") and right_face.get("normal"):
                dot = _vector_dot(left_face["normal"], right_face["normal"])
                normal_relation = "OPPOSED" if dot <= -0.99 else "ALIGNED" if dot >= 0.99 else "ANGLED"
            coaxial = _coaxial_cylinders(left_face, right_face, tolerance)
            comparable = (left_face["surfaceType"] == right_face["surfaceType"]
                          and left_face["surfaceType"] in {"GeomAbs_Plane", "GeomAbs_Cylinder"})
            common_surface = _exact_common_surface(left_face["shape"], right_face["shape"], tolerance) if comparable else None
            area = common_surface["areaSquareMeters"] if common_surface is not None else None
            pair = {
                "faceAId": left_face["occurrenceFaceId"], "faceBId": right_face["occurrenceFaceId"],
                "definitionFaceAId": left_face["definitionFaceId"], "definitionFaceBId": right_face["definitionFaceId"],
                "surfaceTypeA": left_face["surfaceType"], "surfaceTypeB": right_face["surfaceType"],
                "exactMinimumDistanceMeters": distance.Value(),
                "contactAreaSquareMeters": area,
                "contactCenterMeters": common_surface.get("centerMeters") if common_surface else None,
                "contactAreaMethod": "EXACT_BREP_COMMON_SURFACE" if area is not None else "UNAVAILABLE",
                "faceNormalRelation": normal_relation, "coaxialRelation": coaxial,
                "confidence": "HIGH" if (area or 0.0) > 0 or coaxial else "MEDIUM",
            }
            (pairs if (area or 0.0) > 0 or coaxial else zero_area_pairs).append(pair)
    if pairs:
        return pairs
    return sorted(zero_area_pairs, key=lambda item: item["exactMinimumDistanceMeters"])[:1]


def _summarize_interface(pairs: list[dict], effective_distance: float, tolerance: float) -> dict:
    positive_area = [item for item in pairs if (item.get("contactAreaSquareMeters") or 0.0) > 0]
    coaxial = any(item.get("coaxialRelation") and (item.get("contactAreaSquareMeters") or 0.0) > 0 for item in pairs)
    planar = [item for item in positive_area if item["surfaceTypeA"] == item["surfaceTypeB"] == "GeomAbs_Plane"]
    opposed_planar = [item for item in planar if item.get("faceNormalRelation") == "OPPOSED"]
    area = sum(item["contactAreaSquareMeters"] for item in positive_area)
    contact_center = ([
        sum(item["contactCenterMeters"][axis] * item["contactAreaSquareMeters"] for item in positive_area if item.get("contactCenterMeters"))
        / sum(item["contactAreaSquareMeters"] for item in positive_area if item.get("contactCenterMeters"))
        for axis in range(3)
    ] if any(item.get("contactCenterMeters") for item in positive_area) else None)
    if coaxial:
        interface_class, rigid_decision = "ROTATIONAL_CYLINDRICAL_INTERFACE", "ROTATIONAL_INTERFACE"
    elif opposed_planar:
        interface_class, rigid_decision = "FIXED_PLANAR_INTERFACE", "FIXED_LIKELY"
    elif effective_distance <= tolerance:
        interface_class, rigid_decision = "INCIDENTAL_OR_UNKNOWN_CONTACT", "UNKNOWN"
    else:
        interface_class, rigid_decision = "CLEARANCE", "UNKNOWN"
    normal_relations = {item.get("faceNormalRelation") for item in positive_area if item.get("faceNormalRelation") != "UNKNOWN"}
    face_normal_relation = next(iter(normal_relations)) if len(normal_relations) == 1 else "MIXED" if normal_relations else "UNKNOWN"
    return {
        "interfacePairs": pairs, "interfaceClass": interface_class, "rigidDecision": rigid_decision,
        "contactAreaSquareMeters": area, "contactAreaMethod": "EXACT_BREP_COMMON_SURFACE" if positive_area else "NONE",
        "contactCenterMeters": contact_center,
        "faceNormalRelation": face_normal_relation, "coaxialRelation": coaxial,
    }


MAX_EXACT_FACE_PAIR_CANDIDATES = 2048


def _build_exact_contact_graph(part_records: list[dict], tolerance: float = 0.003) -> dict:
    nodes = [{"occurrenceId": item["id"], "definitionId": item["definitionId"], "centerMeters": [
        (item["bounds"]["min"][i] + item["bounds"]["max"][i]) / 2 for i in range(3)]} for item in part_records]
    edges = []
    for left_index, left in enumerate(part_records):
        for right in part_records[left_index + 1:]:
            bbox_distance, overlaps, area_estimate, containment = _bounds_metrics(left["bounds"], right["bounds"])
            if bbox_distance > tolerance:
                continue
            exact_distance = None
            closest_point_midpoint = None
            evidence = [f"AABB gap {bbox_distance:.9g} m"]
            try:
                distance = BRepExtrema_DistShapeShape(left["shape"], right["shape"])
                distance.Perform()
                if distance.IsDone():
                    exact_distance = distance.Value()
                    evidence.append(f"OCCT exact B-Rep minimum distance {exact_distance:.9g} m")
                    if distance.NbSolution() > 0:
                        point_a, point_b = distance.PointOnShape1(1), distance.PointOnShape2(1)
                        closest_point_midpoint = [
                            (point_a.X() + point_b.X()) / 2,
                            (point_a.Y() + point_b.Y()) / 2,
                            (point_a.Z() + point_b.Z()) / 2,
                        ]
            except Exception as error:  # keep the coarse edge and make uncertainty explicit
                evidence.append(f"exact B-Rep distance unavailable: {type(error).__name__}")
            fastener = _looks_like_fastener_name(left["name"]) or _looks_like_fastener_name(right["name"])
            effective = exact_distance if exact_distance is not None else bbox_distance
            face_pair_candidates = len(left.get("faces", [])) * len(right.get("faces", []))
            should_analyze_faces = effective <= 0.00005 and face_pair_candidates <= MAX_EXACT_FACE_PAIR_CANDIDATES
            if effective > 0.00005:
                face_analysis_status = "NOT_REQUIRED_CLEARANCE"
            elif should_analyze_faces:
                face_analysis_status = "COMPLETED"
            else:
                face_analysis_status = "SKIPPED_COMPLEXITY_LIMIT"
                evidence.append(
                    f"exact face-interface analysis skipped: {face_pair_candidates} candidates exceed "
                    f"the {MAX_EXACT_FACE_PAIR_CANDIDATES} safety limit"
                )
            interface = _summarize_interface(
                _face_interface_pairs(left, right, 0.00005) if should_analyze_faces else [],
                effective,
                0.00005,
            )
            edges.append({
                "id": f"contact-{len(edges) + 1}", "a": left["id"], "b": right["id"],
                "boundingBoxDistanceMeters": bbox_distance, "exactMinimumDistanceMeters": exact_distance,
                "closestPointMidpointMeters": closest_point_midpoint,
                "facePairCandidateCount": face_pair_candidates,
                "faceInterfaceAnalysisStatus": face_analysis_status,
                **interface, "aabbOverlapAreaEstimateSquareMeters": area_estimate,
                "containment": containment,
                "outputPortProximityMeters": None, "fastenerSuppressed": fastener,
                "confidence": "HIGH" if exact_distance is not None and exact_distance <= 0.00005 else "MEDIUM" if bbox_distance <= 0.00005 else "LOW",
                "evidence": evidence + (["fastener/bearing semantic suppression"] if fastener else []),
            })
    return {"schema": "step-servo-urdf/contact-graph/v1", "nodes": nodes, "edges": edges}


def _schema_names(path: Path) -> list[str]:
    header = path.read_bytes()[:65536].decode("latin-1", errors="ignore")
    match = re.search(r"FILE_SCHEMA\s*\(\s*\((.*?)\)\s*\)\s*;", header, re.I | re.S)
    return re.findall(r"'([^']+)'", match.group(1)) if match else []


def _file_units(reader: STEPCAFControl_Reader) -> dict:
    lengths = TColStd_SequenceOfAsciiString()
    angles = TColStd_SequenceOfAsciiString()
    solid_angles = TColStd_SequenceOfAsciiString()
    reader.Reader().FileUnits(lengths, angles, solid_angles)
    values = lambda sequence: [sequence.Value(i).ToCString() for i in range(1, sequence.Length() + 1)]
    return {"length": values(lengths), "angle": values(angles), "solidAngle": values(solid_angles)}


def _surface_features(shape, definition_id: str) -> tuple[list[dict], list[dict]]:
    faces, edges = [], []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    face_index = 0
    while explorer.More():
        face_index += 1
        face = TopoDS.Face_s(explorer.Current())
        adaptor = BRepAdaptor_Surface(face, True)
        kind = str(adaptor.GetType()).split(".")[-1]
        item = {"id": f"{definition_id}/face/{face_index}", "topologyIndex": face_index, "surfaceType": kind}
        if kind == "GeomAbs_Cylinder":
            cylinder = adaptor.Cylinder()
            axis = cylinder.Axis()
            direction = axis.Direction()
            origin = axis.Location()
            item["cylinder"] = {
                "originMeters": [origin.X(), origin.Y(), origin.Z()],
                "axis": [direction.X(), direction.Y(), direction.Z()],
                "radiusMeters": cylinder.Radius(),
            }
        faces.append(item)
        explorer.Next()

    explorer = TopExp_Explorer(shape, TopAbs_EDGE)
    edge_index = 0
    while explorer.More():
        edge_index += 1
        edge = TopoDS.Edge_s(explorer.Current())
        adaptor = BRepAdaptor_Curve(edge)
        kind = str(adaptor.GetType()).split(".")[-1]
        item = {"id": f"{definition_id}/edge/{edge_index}", "topologyIndex": edge_index, "curveType": kind}
        if kind == "GeomAbs_Circle":
            circle = adaptor.Circle()
            axis = circle.Axis()
            direction = axis.Direction()
            origin = axis.Location()
            item["circle"] = {
                "originMeters": [origin.X(), origin.Y(), origin.Z()],
                "axis": [direction.X(), direction.Y(), direction.Z()],
                "radiusMeters": circle.Radius(),
            }
        edges.append(item)
        explorer.Next()
    return faces, edges


def _mass_properties(shape) -> dict:
    properties = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, properties, True, False, False)
    center = properties.CentreOfMass()
    matrix = properties.MatrixOfInertia()
    # STEP is transferred into an XCAF document whose system length unit is one metre.
    # Therefore coordinates, volume and geometric inertia are already m, m^3 and m^5.
    return {
        "volumeCubicMeters": properties.Mass(),
        "centerOfMassMeters": [center.X(), center.Y(), center.Z()],
        "inertiaAtUnitDensityKgPerCubicMeter": [
            matrix.Value(1, 1), matrix.Value(1, 2), matrix.Value(1, 3),
            matrix.Value(2, 1), matrix.Value(2, 2), matrix.Value(2, 3),
            matrix.Value(3, 1), matrix.Value(3, 2), matrix.Value(3, 3),
        ],
        "massKilograms": None,
        "massStatus": "density_required",
    }


def _bounds_meters(shape) -> dict:
    bounds = Bnd_Box()
    BRepBndLib.Add_s(shape, bounds, True)
    if bounds.IsVoid():
        raise StepImportError("B-Rep shape has no finite bounds")
    xmin, ymin, zmin, xmax, ymax, zmax = bounds.Get()
    values = [xmin, ymin, zmin, xmax, ymax, zmax]
    if not all(math.isfinite(value) for value in values):
        raise StepImportError("B-Rep shape bounds contain non-finite values")
    return {"min": values[:3], "max": values[3:]}


def _write_meter_stl(shape, target: Path, definition_id: str, linear_deflection: float = 0.0001) -> list[dict]:
    BRepMesh_IncrementalMesh(shape, linear_deflection, False, 0.5, True).Perform()
    target.parent.mkdir(parents=True, exist_ok=True)
    triangles = []
    ranges = []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    face_index = 0
    while explorer.More():
        face_index += 1
        face = TopoDS.Face_s(explorer.Current())
        location = TopLoc_Location()
        triangulation = BRep_Tool.Triangulation_s(face, location)
        start = len(triangles)
        if triangulation is not None:
            transform = location.Transformation()
            reversed_face = face.Orientation() == TopAbs_REVERSED
            for triangle_index in range(1, triangulation.NbTriangles() + 1):
                indices = list(triangulation.Triangle(triangle_index).Get())
                if reversed_face:
                    indices[1], indices[2] = indices[2], indices[1]
                points = [triangulation.Node(index).Transformed(transform) for index in indices]
                vertices = [[point.X(), point.Y(), point.Z()] for point in points]
                a, b, c = vertices
                ab = [b[i] - a[i] for i in range(3)]
                ac = [c[i] - a[i] for i in range(3)]
                normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]]
                length = math.sqrt(sum(value * value for value in normal))
                normal = [value / length for value in normal] if length > 1e-15 else [0.0, 0.0, 0.0]
                triangles.append((normal, vertices))
        ranges.append({"faceId": f"{definition_id}/face/{face_index}", "triangleStart": start, "triangleCount": len(triangles) - start})
        explorer.Next()
    with target.open("wb") as stream:
        stream.write(b"OCCT STEP triangles in metres; face order preserved".ljust(80, b"\0"))
        stream.write(struct.pack("<I", len(triangles)))
        for normal, vertices in triangles:
            stream.write(struct.pack("<12fH", *normal, *vertices[0], *vertices[1], *vertices[2], 0))
    if not triangles:
        raise StepImportError(f"Failed to write preview mesh: {target.name}")
    return ranges


def import_step(source: Path, output: Path) -> dict:
    source, output = source.resolve(), output.resolve()
    if source.suffix.casefold() not in {".step", ".stp"} or not source.is_file():
        raise StepImportError("Input must be an existing .step or .stp file")
    output.mkdir(parents=True, exist_ok=True)
    document = TDocStd_Document(TCollection_ExtendedString("XmlXCAF"))
    # OCCT 7.6+ stores the target system unit on the XCAF document.  One metre
    # here and 1000 mm in STEPControl make transfer independent of file units.
    XCAFDoc_DocumentTool.SetLengthUnit_s(document, 1.0)
    reader = STEPCAFControl_Reader()
    for setter in (reader.SetNameMode, reader.SetColorMode, reader.SetLayerMode,
                   reader.SetPropsMode, reader.SetMatMode, reader.SetGDTMode):
        setter(True)
    status = reader.ReadFile(str(source))
    if status != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise StepImportError(f"OCCT could not read STEP file: {status}")
    reader.Reader().SetSystemLengthUnit(1000.0)
    if not reader.Transfer(document):
        raise StepImportError("OCCT read the file but could not transfer it to XCAF")

    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(document.Main())
    definitions: dict[str, dict] = {}
    definition_shapes: dict[str, object] = {}
    occurrences: list[dict] = []
    part_records: list[dict] = []
    all_faces, all_edges = [], []

    def add_definition(label: TDF_Label) -> str:
        definition_id = f"def:{_label_entry(label)}"
        if definition_id in definitions:
            return definition_id
        shape = XCAFDoc_ShapeTool.GetShape_s(label)
        if shape.IsNull():
            raise StepImportError(f"Definition {definition_id} has no B-Rep shape")
        mesh_name = f"definitions/{definition_id.replace(':', '_')}.stl"
        collision_mesh_name = f"collision/{definition_id.replace(':', '_')}.stl"
        faces, edges = _surface_features(shape, definition_id)
        triangle_ranges = _write_meter_stl(shape, output / mesh_name, definition_id)
        BRepTools.Clean_s(shape)
        _write_meter_stl(shape, output / collision_mesh_name, definition_id, linear_deflection=0.001)
        all_faces.extend(faces)
        all_edges.extend(edges)
        definitions[definition_id] = {
            "id": definition_id,
            "name": _label_name(label) or definition_id,
            "mesh": mesh_name,
            "collisionMesh": collision_mesh_name,
            "collisionMeshSource": "occt_brep_coarse_tessellation",
            "faceCount": len(faces),
            "edgeCount": len(edges),
            "triangleFaceRanges": triangle_ranges,
            "boundsMeters": _bounds_meters(shape),
            "massProperties": _mass_properties(shape),
        }
        definition_shapes[definition_id] = shape
        return definition_id

    def walk(label: TDF_Label, parent_id: str | None, parent_matrix: list[float], path: list[int]) -> None:
        local_matrix = _matrix(XCAFDoc_ShapeTool.GetLocation_s(label))
        world_matrix = _multiply(parent_matrix, local_matrix)
        referred = TDF_Label()
        definition_label = referred if XCAFDoc_ShapeTool.GetReferredShape_s(label, referred) else label
        is_assembly = XCAFDoc_ShapeTool.IsAssembly_s(definition_label)
        occurrence_id = "occ:" + "/".join(map(str, path))
        definition_id = None if is_assembly else add_definition(definition_label)
        transform_diagnostics = _transform_diagnostics(world_matrix)
        occurrence_record = {
            "id": occurrence_id,
            "parentOccurrenceId": parent_id,
            "definitionId": definition_id,
            "name": _label_name(label) or _label_name(definition_label) or occurrence_id,
            "kind": "assembly" if is_assembly else "part",
            "sourceTransformMeters": world_matrix,
            "transformDiagnostics": transform_diagnostics,
        }
        if not is_assembly and transform_diagnostics["mirrored"]:
            _prepare_mirrored_occurrence(
                occurrence_record,
                output / definitions[definition_id]["mesh"],
                output,
                output / definitions[definition_id]["collisionMesh"],
            )
        occurrences.append(occurrence_record)
        if not is_assembly:
            try:
                world_shape = _shape_at_matrix(definition_shapes[definition_id], world_matrix)
                part_records.append({"id": occurrence_id, "definitionId": definition_id,
                                     "name": occurrence_record["name"], "shape": world_shape,
                                     "bounds": _bounds_meters(world_shape),
                                     "faces": _world_face_records(world_shape, occurrence_id, definition_id)})
            except Exception as error:
                occurrence_record.setdefault("diagnostics", []).append(f"world B-Rep transform/contact preparation failed: {type(error).__name__}")
        if is_assembly:
            components = TDF_LabelSequence()
            XCAFDoc_ShapeTool.GetComponents_s(definition_label, components, False)
            for index in range(1, components.Length() + 1):
                walk(components.Value(index), occurrence_id, world_matrix, [*path, index])

    free_shapes = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free_shapes)
    for index in range(1, free_shapes.Length() + 1):
        walk(free_shapes.Value(index), None, IDENTITY, [index])
    if not occurrences:
        raise StepImportError("STEP contains no transferable shapes")
    contact_graph = _build_exact_contact_graph(part_records)

    schema = {
        "schema": "step-servo-urdf/assembly/v1",
        "source": {
            "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "stepSchemas": _schema_names(source),
            "fileUnits": _file_units(reader),
            "normalizedLengthUnit": "metre",
            "transferSystemLengthUnitMeters": 1.0,
            "occtVersion": "7.9.3",
        },
        "definitions": list(definitions.values()),
        "occurrences": occurrences,
        "contactGraph": contact_graph,
        "diagnostics": (["STEP has one part occurrence; joint recovery requires an assembly"]
                        if sum(item["kind"] == "part" for item in occurrences) == 1 else []),
    }
    (output / "assembly.json").write_text(json.dumps(schema, ensure_ascii=False, indent=2) + "\n", "utf-8")
    (output / "brep_features.json").write_text(json.dumps({
        "schema": "step-servo-urdf/brep-features/v1", "faces": all_faces, "edges": all_edges,
    }, ensure_ascii=False, indent=2) + "\n", "utf-8")
    (output / "contact_graph.json").write_text(json.dumps(contact_graph, ensure_ascii=False, indent=2) + "\n", "utf-8")
    return schema
