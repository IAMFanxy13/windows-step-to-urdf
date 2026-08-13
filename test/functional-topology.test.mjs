import { describe, expect, it } from 'vitest';
import { deriveRigidGroupsFromContactGraph, iterateRigidGroupsAndJoints } from '../src/contact-graph-controller.mjs';
import { confirmMotionAspect, createJointMotionReviewQueue, reviewSceneSpec } from '../src/joint-review-controller.mjs';
import { contactGraphLineSpecs, mirrorMeshPolicy, occurrenceRenderSpec, stepDisplayFrameSpec } from '../src/preview-adapter.mjs';
import { exportBlockedByVerificationStatuses } from '../src/validation-panel.mjs';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const assembly = { definitions: [], occurrences: ['a', 'b', 'c'].map(id => ({ id, kind: 'part', definitionId: id, sourceTransformMeters: identity })) };
const graph = { edges: [
  { a: 'a', b: 'b', exactMinimumDistanceMeters: 0, fastenerSuppressed: false },
  { a: 'b', b: 'c', exactMinimumDistanceMeters: 0, fastenerSuppressed: false },
] };

describe('joint/contact graph controllers', () => {
  it('presents CAD and URDF Z-up coordinates on the Three.js Y-up floor', () => {
    expect(stepDisplayFrameSpec()).toEqual({
      rotationRadians: [-Math.PI / 2, 0, 0],
      sourceUpAxis: 'Z',
      displayUpAxis: 'Y',
    });
  });

  it('uses a baked mesh and right-handed residual transform for mirrored occurrences', () => {
    const definition = { id: 'def-a', mesh: 'definitions/def-a.stl' };
    const occurrence = {
      id: 'occ-a',
      sourceTransformMeters: [1, 0, 0, 1, 0, 1, 0, 2, 0, 0, -1, 3, 0, 0, 0, 1],
      mesh: 'mirrored/occ-a.stl',
      meshReflectionBaked: true,
      meshTransformMeters: [1, 0, 0, 1, 0, 1, 0, 2, 0, 0, 1, 3, 0, 0, 0, 1],
    };

    expect(occurrenceRenderSpec(occurrence, definition)).toEqual({
      cacheKey: 'mirrored/occ-a.stl',
      meshPath: 'mirrored/occ-a.stl',
      transformMeters: occurrence.meshTransformMeters,
      reflectionBaked: true,
    });
  });

  it('builds explainable 3D contact-graph line specs from occurrence transforms', () => {
    const contactAssembly = {
      occurrences: [
        { id: 'a', sourceTransformMeters: identity },
        { id: 'b', sourceTransformMeters: [1, 0, 0, 0.1, 0, 1, 0, 0.2, 0, 0, 1, 0.3, 0, 0, 0, 1] },
      ],
      contactGraph: { edges: [{ id: 'edge-ab', a: 'a', b: 'b', rigidDecision: 'FIXED_LIKELY', confidence: 'HIGH' }] },
    };
    expect(contactGraphLineSpecs(contactAssembly)).toEqual([expect.objectContaining({
      edgeId: 'edge-ab', start: [0, 0, 0], end: [0.1, 0.2, 0.3], classification: 'FIXED_LIKELY', color: 0x42d392,
    })]);
  });

  it('does not merge zero-distance contacts without fixed-interface evidence', () => {
    const uncertainGraph = { edges: [
      { a: 'a', b: 'b', exactMinimumDistanceMeters: 0, fastenerSuppressed: false, rigidDecision: 'UNKNOWN', interfaceClass: 'INCIDENTAL_OR_UNKNOWN_CONTACT' },
      { a: 'b', b: 'c', exactMinimumDistanceMeters: 0, fastenerSuppressed: false, rigidDecision: 'ROTATIONAL_INTERFACE', interfaceClass: 'ROTATIONAL_CYLINDRICAL_INTERFACE' },
    ] };
    const groups = deriveRigidGroupsFromContactGraph(assembly, uncertainGraph);
    expect(groups).toHaveLength(3);
    expect(groups.every(group => group.occurrenceIds.length === 1)).toBe(true);
  });

  it('merges an exact opposed planar interface and records the responsible edge', () => {
    const fixedGraph = { edges: [{
      id: 'exact-face-contact', a: 'a', b: 'b', exactMinimumDistanceMeters: 0,
      fastenerSuppressed: false, rigidDecision: 'FIXED_LIKELY',
      interfaceClass: 'FIXED_PLANAR_INTERFACE', faceNormalRelation: 'OPPOSED',
      contactAreaSquareMeters: 0.0004, contactAreaMethod: 'EXACT_BREP_COMMON_SURFACE', coaxialRelation: false,
    }] };
    const groups = deriveRigidGroupsFromContactGraph(assembly, fixedGraph);
    expect(groups).toHaveLength(2);
    const merged = groups.find(group => group.occurrenceIds.includes('a'));
    expect(merged.occurrenceIds).toEqual(['a', 'b']);
    expect(merged.mergeEvidence).toEqual([expect.objectContaining({ edgeId: 'exact-face-contact', classification: 'FIXED_LIKELY' })]);
  });

  it('rolls back the entire joint/group iteration when the contact graph is malformed', () => {
    const model = { rigidGroups: [{ id: 'old', occurrenceIds: ['a'] }], joints: [{ id: 'old-joint' }] };
    const result = iterateRigidGroupsAndJoints(model, assembly, { edges: null }, []);
    expect(result.rigidGroups).toEqual(model.rigidGroups);
    expect(result.joints).toEqual(model.joints);
    expect(result.contactGraphIterationRolledBack).toBe(true);
  });

  it('uses a globally valid topology alternative when the greedy first choices form a cycle', () => {
    const model = { rootLinkId: 'contact-group-1', rigidGroups: [], joints: [] };
    const candidates = [
      { id: 'shoulder', verificationStatus: 'TEMPLATE_VERIFIED', confidence: 'HIGH', topologyAlternatives: [{ parentOccurrenceId: 'a', childOccurrenceId: 'b' }] },
      { id: 'elbow', verificationStatus: 'TEMPLATE_VERIFIED', confidence: 'HIGH', topologyAlternatives: [
        { parentOccurrenceId: 'b', childOccurrenceId: 'a' },
        { parentOccurrenceId: 'b', childOccurrenceId: 'c' },
      ] },
    ];
    const result = iterateRigidGroupsAndJoints(model, assembly, { edges: [] }, candidates);
    expect(result.contactGraphIterationRolledBack).not.toBe(true);
    expect(result.joints.map(joint => [joint.id, joint.parentLinkId, joint.childLinkId, joint.selectedTopologyAlternativeIndex])).toEqual([
      ['shoulder', 'contact-group-1', 'contact-group-2', 0],
      ['elbow', 'contact-group-2', 'contact-group-3', 1],
    ]);
    expect(result.kinematicSolver).toMatchObject({ completeTree: true, unresolvedCandidateIds: [] });
  });

  it('queues only anomalous joints and requires three separate confirmations', () => {
    const joints = [{ id: 'ok', verificationStatus: 'TEMPLATE_VERIFIED' }, { id: 'bad', name: 'elbow', verificationStatus: 'UNRESOLVED', reviewRequired: true }];
    let item = createJointMotionReviewQueue(joints)[0];
    expect(item.posesDegrees).toEqual([0, 5, -5]);
    item = confirmMotionAspect(item, 'movingPartsCorrect');
    item = confirmMotionAspect(item, 'pivotCorrect');
    expect(item.status).toBe('PENDING');
    item = confirmMotionAspect(item, 'directionCorrect');
    expect(item.status).toBe('USER_VERIFIED');
  });

  it('builds parent/child/descendant review highlights and mirror mesh policy', () => {
    const model = { rigidGroups: [{ id: 'p' }, { id: 'c' }, { id: 'tip' }], joints: [{ parentLinkId: 'p', childLinkId: 'c' }, { parentLinkId: 'c', childLinkId: 'tip' }] };
    expect(reviewSceneSpec({ parentLinkId: 'p', childLinkId: 'c', axis: [0, 0, 1], originMeters: [0, 0, 0] }, model, 5).descendantLinkIds).toEqual(['c', 'tip']);
    expect(mirrorMeshPolicy({ mirrored: true })).toMatchObject({ meshVariantRequired: true, frameMustRemainRightHanded: true });
  });

  it('blocks only unresolved and invalid verification states', () => {
    expect(exportBlockedByVerificationStatuses({ joints: [{ id: 'a', verificationStatus: 'TEMPLATE_VERIFIED' }, { id: 'b', verificationStatus: 'AUTOMATIC_UNVERIFIED' }] }).blocked).toBe(false);
    expect(exportBlockedByVerificationStatuses({ joints: [{ id: 'c', verificationStatus: 'INVALID' }] })).toEqual({ blocked: true, invalidJointIds: ['c'] });
  });
});
