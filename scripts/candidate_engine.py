"""Explainable, conservative actuator/axis candidate generation."""

from __future__ import annotations

import json
import math
import hashlib
from collections import Counter, defaultdict
from pathlib import Path


def _normalize(vector):
    length = math.sqrt(sum(value * value for value in vector))
    if length <= 1e-12:
        raise ValueError("zero axis")
    result = [value / length for value in vector]
    for value in result:
        if abs(value) > 1e-9:
            if value < 0:
                result = [-item for item in result]
            break
    return result


def _transform_axis(matrix, origin, axis):
    world_origin = [
        matrix[0] * origin[0] + matrix[1] * origin[1] + matrix[2] * origin[2] + matrix[3],
        matrix[4] * origin[0] + matrix[5] * origin[1] + matrix[6] * origin[2] + matrix[7],
        matrix[8] * origin[0] + matrix[9] * origin[1] + matrix[10] * origin[2] + matrix[11],
    ]
    world_axis = _normalize([
        matrix[0] * axis[0] + matrix[1] * axis[1] + matrix[2] * axis[2],
        matrix[4] * axis[0] + matrix[5] * axis[1] + matrix[6] * axis[2],
        matrix[8] * axis[0] + matrix[9] * axis[1] + matrix[10] * axis[2],
    ])
    return world_origin, world_axis


def _line_key(cylinder):
    axis = _normalize(cylinder["axis"])
    origin = cylinder["originMeters"]
    # p x d is invariant for points along the same infinite line.
    moment = [origin[1] * axis[2] - origin[2] * axis[1],
              origin[2] * axis[0] - origin[0] * axis[2],
              origin[0] * axis[1] - origin[1] * axis[0]]
    return tuple(round(value, 4) for value in [*axis, *moment])


def _world_bounds(occurrence, definition):
    bounds = definition.get("boundsMeters")
    if not bounds:
        point = [occurrence["sourceTransformMeters"][index] for index in (3, 7, 11)]
        return {"min": point, "max": point}
    matrix = occurrence["sourceTransformMeters"]
    corners = []
    for x in (bounds["min"][0], bounds["max"][0]):
        for y in (bounds["min"][1], bounds["max"][1]):
            for z in (bounds["min"][2], bounds["max"][2]):
                corners.append([
                    matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3],
                    matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7],
                    matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11],
                ])
    return {"min": [min(point[i] for point in corners) for i in range(3)],
            "max": [max(point[i] for point in corners) for i in range(3)]}


def _geometry_fingerprint(definition, faces):
    """Stable identity evidence; names are deliberately excluded."""
    bounds = definition.get("boundsMeters") or {"min": [0, 0, 0], "max": [0, 0, 0]}
    dimensions = [bounds["max"][i] - bounds["min"][i] for i in range(3)]
    surface_types = Counter(face.get("surfaceType", "unknown") for face in faces)
    payload = {
        "dimensionsMeters": [round(value, 9) for value in dimensions],
        "volumeCubicMeters": round(definition.get("massProperties", {}).get("volumeCubicMeters", 0.0), 15),
        "faceCount": definition.get("faceCount", len(faces)),
        "edgeCount": definition.get("edgeCount", 0),
        "surfaceTypes": sorted(surface_types.items()),
        "cylinderRadiiMeters": sorted(round(face["cylinder"]["radiusMeters"], 9) for face in faces if face.get("cylinder")),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def generate_candidates(assembly: dict, features: dict) -> dict:
    occurrences = [item for item in assembly.get("occurrences", []) if item.get("kind") == "part"]
    definition_counts = Counter(item.get("definitionId") for item in occurrences)
    cylinders_by_definition = defaultdict(list)
    circles_by_definition = defaultdict(list)
    for face in features.get("faces", []):
        if "cylinder" in face:
            definition_id = face["id"].split("/face/", 1)[0]
            cylinders_by_definition[definition_id].append(face)
    for edge in features.get("edges", []):
        if "circle" in edge:
            definition_id = edge["id"].split("/edge/", 1)[0]
            circles_by_definition[definition_id].append(edge)

    definitions = {item["id"]: item for item in assembly.get("definitions", [])}
    families, candidates, rigid_group_candidates = [], [], []
    for definition_id, count in sorted(definition_counts.items()):
        cylinders = cylinders_by_definition.get(definition_id, [])
        if not cylinders:
            continue
        clusters = defaultdict(list)
        for face in cylinders:
            clusters[_line_key(face["cylinder"])].append(face)
        ranked = sorted(clusters.values(), key=lambda cluster: (-len(cluster), min(face["cylinder"]["radiusMeters"] for face in cluster)))
        primary = ranked[0]
        representative = min(primary, key=lambda face: face["cylinder"]["radiusMeters"])
        definition_faces = [face for face in features.get("faces", []) if face["id"].startswith(f"{definition_id}/face/")]
        definition = definitions.get(definition_id, {})
        instance_ids = [item["id"] for item in occurrences if item.get("definitionId") == definition_id]
        display_name = str(definition.get("name") or definition_id)
        semantic_match = any(token in display_name.lower() for token in ("servo", "motor", "actuator", "dynamixel", "lx-")) or "舵机" in display_name
        bounds = definition.get("boundsMeters") or {"min": [0, 0, 0], "max": [0, 0, 0]}
        dimensions = [bounds["max"][i] - bounds["min"][i] for i in range(3)]
        compact_size = all(0.005 <= value <= 0.15 for value in dimensions)
        lower_name = display_name.lower()
        fastener_semantic = any(token in lower_name for token in ("screw", "bolt", "nut", "washer", "bearing")) or any(token in display_name for token in ("螺钉", "螺栓", "螺母", "垫片", "轴承"))
        volume = definition.get("massProperties", {}).get("volumeCubicMeters", 0.0)
        slender = min(dimensions, default=0) > 0 and max(dimensions) > min(dimensions) * 2.5
        likely_fastener_shape = slender and volume < 2e-6
        coaxial_strength = min(1.0, len(primary) / 3)
        repeat_evidence = min(0.15, math.log2(count + 1) * 0.035)
        score = 0.18 + repeat_evidence + (0.25 if semantic_match else 0) + (0.10 if compact_size else 0) + 0.15 * coaxial_strength
        if fastener_semantic or likely_fastener_shape:
            score -= 0.42
        history_match = any(item.get("geometryFingerprint") == _geometry_fingerprint(definition, definition_faces) for item in assembly.get("servoTemplateHistory", []))
        if history_match:
            score += 0.35
        score = max(0.01, min(0.99, score))
        candidate_class = "FASTENER_LIKELY" if fastener_semantic or likely_fastener_shape else ("SERVO_LIKELY" if score >= 0.5 else "REVIEWABLE_MECHANISM")
        axis_candidates = []
        for rank, cluster in enumerate(ranked, 1):
            face = min(cluster, key=lambda item: item["cylinder"]["radiusMeters"])
            axis_candidates.append({
                "rank": rank,
                "faceId": face["id"],
                "originLocalMeters": face["cylinder"]["originMeters"],
                "directionLocal": _normalize(face["cylinder"]["axis"]),
                "radiusMeters": face["cylinder"]["radiusMeters"],
                "coaxialFaceCount": len(cluster),
                "evidence": ["exact analytic cylindrical B-Rep face", f"{len(cluster)} coaxial cylindrical faces share this line"],
            })
        representative_axis = _normalize(representative["cylinder"]["axis"])
        representative_origin = representative["cylinder"]["originMeters"]
        compatible_circles = []
        for edge in circles_by_definition.get(definition_id, []):
            circle = edge["circle"]
            direction = _normalize(circle["axis"])
            if abs(sum(direction[i] * representative_axis[i] for i in range(3))) < 0.995:
                continue
            delta = [circle["originMeters"][i] - representative_origin[i] for i in range(3)]
            projection = sum(delta[i] * representative_axis[i] for i in range(3))
            radial = math.sqrt(sum((delta[i] - projection * representative_axis[i]) ** 2 for i in range(3)))
            if radial <= max(0.0001, representative["cylinder"]["radiusMeters"] * 0.15):
                compatible_circles.append((abs(projection), edge))
        output_edge = max(compatible_circles, default=(0, None), key=lambda item: item[0])[1]
        interface_center = output_edge["circle"]["originMeters"] if output_edge else representative_origin
        family = {
            "definitionId": definition_id,
            "displayName": display_name,
            "instanceCount": count,
            "instanceIds": instance_ids,
            "geometryFingerprint": _geometry_fingerprint(definition, definition_faces),
            "outputAxisLocal": {
                "origin": representative_origin,
                "direction": representative_axis,
            },
            "outputPort": {
                "axisLine": {"origin": representative_origin, "direction": representative_axis},
                "interfaceCenter": interface_center,
                "outputPlane": ({"origin": interface_center, "normal": _normalize(output_edge["circle"]["axis"])} if output_edge else None),
                "interfaceNormal": (_normalize(output_edge["circle"]["axis"]) if output_edge else representative_axis),
                "selectedFaceIds": [representative["id"]],
                "selectedEdgeIds": ([output_edge["id"]] if output_edge else []),
            },
            "outputFaceId": representative["id"],
            "outputEdgeId": output_edge["id"] if output_edge else None,
            "axisCandidates": axis_candidates,
            "confidence": "HIGH" if score >= 0.75 else "MEDIUM" if score >= 0.5 else "LOW",
            "confidenceScore": score,
            "candidateClass": candidate_class,
            "evidence": [
                f"same exact STEP definition is instanced {count} times",
                "instance count contributes to ranking but is not a hard filter",
                f"selected coaxial B-Rep cylinder cluster contains {len(primary)} faces",
                f"name semantic hint {'matches' if semantic_match else 'does not match'} common servo terms (weak evidence only)",
                f"bounding-box dimensions are {[round(value * 1000, 3) for value in dimensions]} mm",
                f"fastener/bearing evidence is {'present' if fastener_semantic or likely_fastener_shape else 'not present'}",
                f"user history geometry match is {history_match}",
                ("joint origin uses a compatible circular-edge center, separate from the cylinder surface origin" if output_edge else "no compatible circular edge found; interface center requires user review"),
            ],
            "alternativeAxisClusters": max(0, len(ranked) - 1),
            "reviewRequired": True,
            "source": "automatic_repeated_brep_definition",
            "lastModifiedBy": "automatic_system",
        }
        families.append(family)
        # Low-ranked mechanism families remain visible for confirmation, but
        # only plausible actuator families instantiate joints automatically.
        if score < 0.32:
            continue
        for occurrence in [item for item in occurrences if item.get("definitionId") == definition_id]:
            axis_origin_world, axis = _transform_axis(occurrence["sourceTransformMeters"], representative_origin, representative_axis)
            origin, _ = _transform_axis(occurrence["sourceTransformMeters"], interface_center, representative_axis)
            other_occurrences = [item for item in occurrences if item["id"] != occurrence["id"]]
            graph_edges = [edge for edge in assembly.get("contactGraph", {}).get("edges", []) if edge.get("a") == occurrence["id"] or edge.get("b") == occurrence["id"]]
            neighbor_map = {item["id"]: item for item in other_occurrences}
            sorted_graph_edges = sorted(graph_edges, key=lambda edge: (edge.get("exactMinimumDistanceMeters") is None, edge.get("exactMinimumDistanceMeters") if edge.get("exactMinimumDistanceMeters") is not None else edge.get("boundingBoxDistanceMeters", 1e9)))
            graph_neighbors = [next(value for value in (edge.get("a"), edge.get("b")) if value != occurrence["id"]) for edge in sorted_graph_edges if not edge.get("fastenerSuppressed")]
            fallback_near = sorted(other_occurrences, key=lambda item: sum((item["sourceTransformMeters"][index] - origin[axis_index]) ** 2 for index, axis_index in zip((3, 7, 11), range(3))))
            exact_contact_records = []
            for edge in sorted_graph_edges:
                edge_interface_center = edge.get("contactCenterMeters") or edge.get("closestPointMidpointMeters")
                if edge.get("fastenerSuppressed") or edge.get("interfaceClass") == "CLEARANCE" or not edge_interface_center:
                    continue
                neighbor_id = next(value for value in (edge.get("a"), edge.get("b")) if value != occurrence["id"])
                distance_to_output = math.dist(edge_interface_center, origin)
                exact_contact_records.append({"neighborId": neighbor_id, "edge": edge, "distanceToOutputMeters": distance_to_output, "centerMethod": "EXACT_COMMON_SURFACE_CENTER" if edge.get("contactCenterMeters") else "EXACT_CLOSEST_POINT_MIDPOINT"})
            exact_contact_records.sort(key=lambda item: (item["distanceToOutputMeters"], item["neighborId"]))
            output_neighbor_id = exact_contact_records[0]["neighborId"] if exact_contact_records else (graph_neighbors[0] if graph_neighbors else None)
            housing_records = [item for item in exact_contact_records if item["neighborId"] != output_neighbor_id]
            housing_neighbor_id = (max(housing_records, key=lambda item: (item["distanceToOutputMeters"], item["edge"].get("contactAreaSquareMeters", 0)))["neighborId"] if housing_records else None)
            if housing_neighbor_id is None:
                housing_neighbor_id = next((item["id"] for item in fallback_near if item["id"] != output_neighbor_id), None)
            ordered_neighbor_ids = [item for item in (housing_neighbor_id, output_neighbor_id) if item in neighbor_map]
            for item in [*graph_neighbors, *(candidate["id"] for candidate in fallback_near)]:
                if item not in ordered_neighbor_ids and item in neighbor_map:
                    ordered_neighbor_ids.append(item)
                if len(ordered_neighbor_ids) >= 2:
                    break
            near = [neighbor_map[item] for item in ordered_neighbor_ids[:2]]
            topology_alternatives = []
            if len(near) == 2:
                topology_alternatives = [
                    {"parentOccurrenceId": near[0]["id"], "childOccurrenceId": near[1]["id"], "movingSideOccurrenceId": near[1]["id"]},
                    {"parentOccurrenceId": near[1]["id"], "childOccurrenceId": near[0]["id"], "movingSideOccurrenceId": near[0]["id"]},
                ]
            candidate = {
                "id": f"candidate-{len(candidates) + 1}",
                "actuatorOccurrenceId": occurrence["id"],
                "originMeters": origin,
                "axisLineOriginMeters": axis_origin_world,
                "axis": axis,
                "axisFaceId": representative["id"],
                "definitionId": definition_id,
                "geometryFingerprint": family["geometryFingerprint"],
                "parentLinkId": None,
                "childLinkId": None,
                "movingSideLinkId": None,
                "neighborOccurrenceCandidates": [item["id"] for item in near],
                "housingSideOccurrenceIds": ([housing_neighbor_id] if housing_neighbor_id else []),
                "outputSideOccurrenceIds": ([output_neighbor_id] if output_neighbor_id else []),
                "outputPortContactClassification": {
                    "method": ("EXACT_BREP_CONTACT_CENTER" if exact_contact_records and all(item["centerMethod"] == "EXACT_COMMON_SURFACE_CENTER" for item in exact_contact_records) else "EXACT_BREP_INTERFACE_POINT" if exact_contact_records else "PROXIMITY_FALLBACK_REQUIRES_REVIEW"),
                    "outputOccurrenceId": output_neighbor_id,
                    "housingOccurrenceId": housing_neighbor_id,
                    "outputDistanceMeters": exact_contact_records[0]["distanceToOutputMeters"] if exact_contact_records else None,
                    "housingDistanceMeters": (max(item["distanceToOutputMeters"] for item in housing_records) if housing_records else None),
                    "confidence": "HIGH" if len(exact_contact_records) >= 2 else "MEDIUM" if exact_contact_records else "LOW",
                },
                "topologyAlternatives": topology_alternatives,
                "confidence": family["confidence"],
                "evidence": family["evidence"] + ["parent/child and moving side are intentionally unresolved"],
                "reviewRequired": True,
                "source": "automatic_brep_candidate",
                "lastModifiedBy": "automatic_system",
            }
            candidates.append(candidate)
            if topology_alternatives:
                rigid_group_candidates.append({
                    "id": f"rigid-candidate-{len(rigid_group_candidates) + 1}",
                    "occurrenceIds": [topology_alternatives[0]["parentOccurrenceId"], occurrence["id"]],
                    "actuatorOccurrenceId": occurrence["id"],
                    "confidence": family["confidence"],
                    "evidence": family["evidence"] + ["actuator body is assigned to the inferred fixed side"],
                    "reviewRequired": True,
                    "source": "automatic_actuator_fixed_side_grouping",
                    "lastModifiedBy": "automatic_system",
                })
    root_recommendation = None
    if occurrences:
        def root_score(item):
            bounds = _world_bounds(item, definitions.get(item.get("definitionId"), {}))
            footprint = max(0.0, bounds["max"][0] - bounds["min"][0]) * max(0.0, bounds["max"][1] - bounds["min"][1])
            volume = definitions.get(item.get("definitionId"), {}).get("massProperties", {}).get("volumeCubicMeters", 0.0)
            return (round(bounds["min"][2], 6), -footprint, -volume)
        root_recommendation = min(occurrences, key=root_score)
    ranked_families = sorted(families, key=lambda item: (-item["confidenceScore"], item["definitionId"]))
    active_servo_families = [item for item in ranked_families if item["candidateClass"] == "SERVO_LIKELY"]
    if not active_servo_families:
        # A one-off anonymous actuator must remain reachable. When no family is
        # strongly servo-like, show the best reviewable mechanisms instead of
        # applying a repetition-count threshold.
        active_servo_families = [item for item in ranked_families if item["candidateClass"] != "FASTENER_LIKELY"][:5]
    active_occurrence_ids = {instance_id for family in active_servo_families for instance_id in family["instanceIds"]}
    candidates = [item for item in candidates if item["actuatorOccurrenceId"] in active_occurrence_ids]
    rigid_group_candidates = [item for item in rigid_group_candidates if item.get("actuatorOccurrenceId") in active_occurrence_ids]
    return {
        "schema": "step-servo-urdf/joint-candidates/v2",
        "suspectedActuatorFamilies": active_servo_families,
        "servoTemplateCandidates": active_servo_families,
        "rankedMechanismCandidates": ranked_families,
        "jointCandidates": candidates,
        "rigidGroupCandidates": rigid_group_candidates,
        "rootRecommendation": ({
            "occurrenceId": root_recommendation["id"],
            "confidence": "MEDIUM",
            "evidence": ["part occurrence has the lowest world-space support plane", "larger support footprint and volume break ties"],
            "reviewRequired": True,
            "source": "automatic_geometric_base_candidate",
            "lastModifiedBy": "automatic_system",
        } if root_recommendation else None),
        "limitations": [
            "STEP usually omits CAD mate semantics",
            "repeated geometry and coaxial cylinders rank candidates but do not prove actuator function",
            "parent, child and moving side remain unset until adjacency evidence or user confirmation",
        ],
    }


def write_candidates(assembly_path: Path, features_path: Path, target: Path) -> dict:
    result = generate_candidates(json.loads(assembly_path.read_text("utf-8")), json.loads(features_path.read_text("utf-8")))
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", "utf-8")
    return result
