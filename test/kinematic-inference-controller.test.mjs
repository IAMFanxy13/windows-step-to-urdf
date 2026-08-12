import { describe, expect, it } from 'vitest';

const controllerModule = await import('../src/kinematic-inference-controller.mjs').catch(() => null);

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('kinematic inference controller', () => {
  it('cuts the actuator-to-output contact while allowing the housing side to merge with the actuator body', () => {
    const assembly = {
      source: {}, definitions: [],
      occurrences: ['base', 'servo', 'arm'].map(id => ({ id, kind: 'part', definitionId: id, name: id, sourceTransformMeters: identity, transformDiagnostics: { mirrored: false } })),
      contactGraph: { edges: [
        { id: 'housing-contact', a: 'base', b: 'servo', exactMinimumDistanceMeters: 0, rigidDecision: 'FIXED_LIKELY', interfaceClass: 'FIXED_PLANAR_INTERFACE', contactAreaSquareMeters: 0.001, contactAreaMethod: 'EXACT_BREP_COMMON_SURFACE', faceNormalRelation: 'OPPOSED', coaxialRelation: false },
        { id: 'output-contact', a: 'servo', b: 'arm', exactMinimumDistanceMeters: 0, rigidDecision: 'FIXED_LIKELY', interfaceClass: 'FIXED_PLANAR_INTERFACE', contactAreaSquareMeters: 0.001, contactAreaMethod: 'EXACT_BREP_COMMON_SURFACE', faceNormalRelation: 'OPPOSED', coaxialRelation: false },
      ] },
    };
    const analysisCandidates = {
      rootRecommendation: { occurrenceId: 'base', reviewRequired: false },
      jointCandidates: [{
        id: 'joint-servo', actuatorOccurrenceId: 'servo', verificationStatus: 'TEMPLATE_VERIFIED', confidence: 'HIGH',
        originMeters: [0, 0, 0], axis: [0, 0, 1],
        housingSideOccurrenceIds: ['base'], outputSideOccurrenceIds: ['arm'],
        topologyAlternatives: [{ parentOccurrenceId: 'base', childOccurrenceId: 'arm' }],
      }],
    };

    const result = controllerModule.runKinematicInference({ assembly, analysisCandidates, jobId: 'joint-cut' });

    expect(result.rigidGroups).toHaveLength(2);
    expect(result.rigidGroups.find(group => group.occurrenceIds.includes('servo')).occurrenceIds).toEqual(['base', 'servo']);
    expect(result.model.joints).toHaveLength(1);
  });

  it('uses a confirmed functional housing contact as explicit fixed evidence even when planar normals are inconclusive', () => {
    const assembly = {
      source: {}, definitions: [],
      occurrences: ['housing', 'servo', 'output'].map(id => ({ id, kind: 'part', definitionId: id, name: id, sourceTransformMeters: identity, transformDiagnostics: { mirrored: false } })),
      contactGraph: { edges: [
        { id: 'housing-aligned', a: 'housing', b: 'servo', exactMinimumDistanceMeters: 0, rigidDecision: 'UNKNOWN', interfaceClass: 'INCIDENTAL_OR_UNKNOWN_CONTACT' },
        { id: 'output-face', a: 'servo', b: 'output', exactMinimumDistanceMeters: 0, rigidDecision: 'FIXED_LIKELY', interfaceClass: 'FIXED_PLANAR_INTERFACE', contactAreaSquareMeters: 0.001, contactAreaMethod: 'EXACT_BREP_COMMON_SURFACE', faceNormalRelation: 'OPPOSED', coaxialRelation: false },
      ] },
    };
    const analysisCandidates = {
      rootRecommendation: { occurrenceId: 'housing', reviewRequired: false },
      jointCandidates: [{
        id: 'joint-functional', actuatorOccurrenceId: 'servo', verificationStatus: 'TEMPLATE_VERIFIED', confidence: 'HIGH',
        originMeters: [0, 0, 0], axis: [0, 0, 1], housingSideOccurrenceIds: ['housing'], outputSideOccurrenceIds: ['output'],
        outputPortContactClassification: { method: 'CONFIRMED_TEMPLATE_PORT_TO_EXACT_BREP_CONTACT_CENTER', confidence: 'HIGH', housingDistanceMeters: 0.02 },
        topologyAlternatives: [{ parentOccurrenceId: 'housing', childOccurrenceId: 'output' }],
      }],
    };
    const result = controllerModule.runKinematicInference({ assembly, analysisCandidates, jobId: 'functional-fixed' });
    expect(result.rigidGroups.find(group => group.occurrenceIds.includes('servo')).occurrenceIds).toEqual(['housing', 'servo']);
    expect(result.rigidGroups).toHaveLength(2);
  });


  it('does not silently verify a review-required automatic topology candidate', () => {
    const assembly = {
      source: { sha256: 'fixture' }, definitions: [], contactGraph: { edges: [] },
      occurrences: ['base', 'arm'].map(id => ({ id, kind: 'part', definitionId: id, name: id, sourceTransformMeters: identity, transformDiagnostics: { mirrored: false } })),
    };
    const analysisCandidates = {
      rootRecommendation: { occurrenceId: 'base', confidence: 'HIGH', reviewRequired: false },
      jointCandidates: [{
        id: 'j-review', actuatorOccurrenceId: 'servo', reviewRequired: true, confidence: 'LOW',
        originMeters: [0, 0, 0], axis: [0, 0, 1],
        topologyAlternatives: [{ parentOccurrenceId: 'base', childOccurrenceId: 'arm' }],
      }],
    };

    const result = controllerModule.runKinematicInference({ assembly, analysisCandidates, jobId: 'job-review' });

    expect(result.model.joints).toHaveLength(0);
    expect(result.anomalies).toContainEqual(expect.objectContaining({ candidateId: 'j-review', status: 'UNRESOLVED' }));
  });

  it('creates one editable globally-solved draft and exposes unresolved anomalies', () => {
    expect(controllerModule).not.toBeNull();
    if (!controllerModule) return;
    const assembly = {
      source: { sha256: 'fixture' }, definitions: [], contactGraph: { edges: [] },
      occurrences: ['base', 'arm', 'tip'].map(id => ({ id, kind: 'part', definitionId: id, name: id, sourceTransformMeters: identity, transformDiagnostics: { mirrored: false } })),
    };
    const analysisCandidates = {
      rootRecommendation: { occurrenceId: 'base', confidence: 'HIGH', reviewRequired: false },
      jointCandidates: [
        { id: 'j1', actuatorOccurrenceId: 'servo-1', verificationStatus: 'TEMPLATE_VERIFIED', confidence: 'HIGH', originMeters: [0, 0, 0], axis: [0, 0, 1], topologyAlternatives: [{ parentOccurrenceId: 'base', childOccurrenceId: 'arm' }] },
        { id: 'j2', actuatorOccurrenceId: 'servo-2', verificationStatus: 'UNRESOLVED', confidence: 'LOW', originMeters: [0, 0, 0], axis: [0, 1, 0], topologyAlternatives: [{ parentOccurrenceId: 'arm', childOccurrenceId: 'tip' }] },
      ],
    };
    const result = controllerModule.runKinematicInference({ assembly, analysisCandidates, confirmedTemplates: [], jobId: 'job-1' });
    expect(result.model.rootLinkId).toBe('contact-group-1');
    expect(result.model.joints.map(joint => joint.id)).toEqual(['j1']);
    expect(result.anomalies.map(item => item.candidateId).filter(Boolean)).toEqual(['j2']);
    expect(result.anomalies).toContainEqual(expect.objectContaining({ type: 'disconnected_group', groupId: 'contact-group-3' }));
    expect(result.model.automation).toMatchObject({ engineVersion: 6, globalSolverComplete: false });
  });

  it('assigns orphan single-part servo bodies to the fixed side so the first draft is movable', () => {
    const assembly = {
      source: {}, definitions: [], contactGraph: { edges: [] },
      occurrences: ['base', 'servo-1', 'arm', 'servo-2', 'tip'].map(id => ({
        id, kind: 'part', definitionId: id.startsWith('servo') ? 'servo-def' : id,
        name: id, sourceTransformMeters: identity, transformDiagnostics: { mirrored: false },
      })),
    };
    const analysisCandidates = {
      rootRecommendation: { occurrenceId: 'base', reviewRequired: false },
      jointCandidates: [
        { id: 'j1', actuatorOccurrenceId: 'servo-1', verificationStatus: 'TEMPLATE_VERIFIED', usesTemplate: true, actuationMode: 'direct', confidence: 'HIGH', originMeters: [0, 0, 0], axis: [0, 0, 1], topologyAlternatives: [{ parentOccurrenceId: 'base', childOccurrenceId: 'arm' }] },
        { id: 'j2', actuatorOccurrenceId: 'servo-2', verificationStatus: 'AUTOMATIC_UNVERIFIED', usesTemplate: true, actuationMode: 'direct', confidence: 'MEDIUM', originMeters: [1, 0, 0], axis: [0, 0, 1], topologyAlternatives: [{ parentOccurrenceId: 'arm', childOccurrenceId: 'tip' }] },
      ],
    };

    const result = controllerModule.runKinematicInference({ assembly, analysisCandidates, jobId: 'movable-draft' });

    expect(result.model.rigidGroups.map(group => group.occurrenceIds)).toEqual([
      ['base', 'servo-1'], ['arm', 'servo-2'], ['tip'],
    ]);
    expect(result.model.kinematicSolver.completeTree).toBe(true);
    expect(result.model.joints).toHaveLength(2);
    expect(result.model.joints.every(joint => typeof joint.name === 'string' && joint.name.length > 0)).toBe(true);
  });
});
