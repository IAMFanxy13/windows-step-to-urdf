import { describe, expect, it } from 'vitest';

import {
  RobotEditor,
  createRobotModelFromAnalysis,
  createRobotModelFromAssembly,
} from '../src/editor-store.mjs';

const assembly = {
  occurrences: [
    { id: 'occ:1', kind: 'assembly', name: 'Robot' },
    { id: 'occ:1/1', kind: 'part', name: 'same name' },
    { id: 'occ:1/2', kind: 'part', name: 'same name' },
    { id: 'occ:1/3', kind: 'part', name: '' },
  ],
};

describe('RobotEditor', () => {
  it('creates generic unique rigid groups from arbitrary occurrences', () => {
    const model = createRobotModelFromAssembly(assembly, 'job-x');
    expect(model.rigidGroups.map(group => group.name)).toEqual(['same_name', 'same_name_2', 'link_3']);
    expect(model.rigidGroups).toHaveLength(3);
    expect(model.joints).toEqual([]);
  });

  it('merges, splits, renames and supports undo/redo', () => {
    const editor = new RobotEditor(createRobotModelFromAssembly(assembly, 'job-x'));
    editor.mergeGroups(['group-1', 'group-2'], 'merged_link');
    expect(editor.model.rigidGroups).toHaveLength(2);
    editor.splitOccurrence('group-1', 'occ:1/2', 'split_link');
    expect(editor.model.rigidGroups).toHaveLength(3);
    editor.renameLink('group-1', 'base_link');
    expect(editor.model.rigidGroups.find(group => group.id === 'group-1').name).toBe('base_link');
    editor.undo();
    expect(editor.model.rigidGroups.find(group => group.id === 'group-1').name).toBe('merged_link');
    editor.redo();
    expect(editor.model.rigidGroups.find(group => group.id === 'group-1').name).toBe('base_link');
  });

  it('edits joint topology, moving side, direction, names and user limits', () => {
    const editor = new RobotEditor(createRobotModelFromAssembly(assembly, 'job-x'));
    editor.addJoint({
      name: 'shoulder', parentLinkId: 'group-1', childLinkId: 'group-2',
      originMeters: [0.1, 0.2, 0.3], axis: [0, 0, 1], evidence: { faceId: 'def:1/face/8' },
    });
    const id = editor.model.joints[0].id;
    editor.reverseJointAxis(id);
    editor.setJointLimitsDegrees(id, -35, 42);
    editor.setJointDynamics(id, 2.5, 1.25);
    editor.renameJoint(id, 'joint_shoulder');
    expect(editor.model.joints[0]).toMatchObject({ name: 'joint_shoulder', axis: [0, 0, -1] });
    expect(editor.model.joints[0].limits.source).toBe('user');
    expect(editor.model.joints[0].confirmation.limits).toBe(true);
    expect(editor.model.joints[0].dynamics).toEqual({ effort: 2.5, velocity: 1.25, source: 'user' });
    expect(() => editor.setJointDynamics(id, 0, 1)).toThrow(/positive effort/i);
  });

  it('rolls back model and history completely when a change fails', () => {
    const editor = new RobotEditor(createRobotModelFromAssembly(assembly, 'job-x'));
    editor.renameLink('group-1', 'base_link');
    editor.undo();
    const beforeModel = structuredClone(editor.model);
    const beforeUndo = structuredClone(editor.undoStack);
    const beforeRedo = structuredClone(editor.redoStack);

    expect(() => editor.change(model => {
      model.rigidGroups[0].name = 'partially_corrupted';
      model.rigidGroups.pop();
      throw new Error('simulated failure');
    })).toThrow('simulated failure');

    expect(editor.model).toEqual(beforeModel);
    expect(editor.undoStack).toEqual(beforeUndo);
    expect(editor.redoStack).toEqual(beforeRedo);
  });

  it('does not partially merge or consume undo history when merge validation fails', () => {
    const editor = new RobotEditor(createRobotModelFromAssembly(assembly, 'job-x'));
    editor.addJoint({
      name: 'joint_1', parentLinkId: 'group-1', childLinkId: 'group-2',
      originMeters: [0, 0, 0], axis: [0, 0, 1],
    });
    const before = structuredClone(editor.model);
    const undoDepth = editor.undoStack.length;
    expect(() => editor.mergeGroups(['group-1', 'group-2'], 'bad_merge')).toThrow(/reassign joints/i);
    expect(editor.model).toEqual(before);
    expect(editor.undoStack).toHaveLength(undoDepth);
  });

  it('reselects an exact B-Rep face or circular edge axis and edits origin transactionally', () => {
    const editor = new RobotEditor(createRobotModelFromAssembly(assembly, 'job-x'));
    editor.addJoint({
      name: 'elbow', parentLinkId: 'group-1', childLinkId: 'group-2',
      originMeters: [0, 0, 0], axis: [0, 0, 1],
    });
    const id = editor.model.joints[0].id;
    editor.setJointAxis(id, {
      originMeters: [0.1, 0.2, 0.3], axis: [0, 2, 0],
      evidence: { edgeId: 'def:1/edge/7', geometryType: 'circle' },
      source: 'user_selected_brep_edge',
    });
    expect(editor.model.joints[0]).toMatchObject({
      originMeters: [0.1, 0.2, 0.3], axis: [0, 1, 0],
      confidence: 'HIGH', reviewRequired: true,
      source: 'user_selected_brep_edge', lastModifiedBy: 'user',
      evidence: { edgeId: 'def:1/edge/7', geometryType: 'circle' },
    });
    editor.setJointOrigin(id, [0.4, 0.5, 0.6]);
    expect(editor.model.joints[0].originMeters).toEqual([0.4, 0.5, 0.6]);
    expect(editor.model.joints[0].originSource).toBe('user_numeric');
    expect(editor.model.joints[0].reviewRequired).toBe(true);
  });

  it('deletes a wrong joint and supports undo', () => {
    const editor = new RobotEditor(createRobotModelFromAssembly(assembly, 'job-x'));
    editor.addJoint({
      name: 'wrong_joint', parentLinkId: 'group-1', childLinkId: 'group-2',
      originMeters: [0, 0, 0], axis: [1, 0, 0],
    });
    const id = editor.model.joints[0].id;
    editor.deleteJoint(id);
    expect(editor.model.joints).toEqual([]);
    expect(editor.undo()).toBe(true);
    expect(editor.model.joints[0].id).toBe(id);
  });

  it('rejects invalid axis changes without touching the model', () => {
    const editor = new RobotEditor(createRobotModelFromAssembly(assembly, 'job-x'));
    editor.addJoint({
      name: 'joint_1', parentLinkId: 'group-1', childLinkId: 'group-2',
      originMeters: [0, 0, 0], axis: [1, 0, 0],
    });
    const before = structuredClone(editor.model);
    expect(() => editor.setJointAxis('joint-1', {
      originMeters: [0, 0, 0], axis: [0, 0, 0], evidence: {},
    })).toThrow(/non-zero/i);
    expect(editor.model).toEqual(before);
  });

  it('applies explainable automatic root and joint candidates to an editable first draft', () => {
    const candidates = {
      rootRecommendation: {
        occurrenceId: 'occ:1/2', confidence: 'MEDIUM', evidence: ['lowest stable support'], reviewRequired: true,
      },
      jointCandidates: [{
        id: 'candidate-1', actuatorOccurrenceId: 'occ:1/3',
        originMeters: [0.01, 0.02, 0.03], axis: [0, 0, 1], axisFaceId: 'def:servo/face/4',
        topologyAlternatives: [{ parentOccurrenceId: 'occ:1/2', childOccurrenceId: 'occ:1/1', movingSideOccurrenceId: 'occ:1/1' }],
        confidence: 'MEDIUM', evidence: ['repeated actuator definition', 'coaxial cylinders'], reviewRequired: true,
      }],
    };
    const model = createRobotModelFromAnalysis(assembly, candidates, 'job-auto');
    expect(model.rootLinkId).toBe('group-2');
    expect(model.joints).toHaveLength(1);
    expect(model.rigidGroups).toHaveLength(2);
    expect(model.rigidGroups.find(group => group.id === 'group-2').occurrenceIds).toContain('occ:1/3');
    expect(model.joints[0]).toMatchObject({
      parentLinkId: 'group-2', childLinkId: 'group-1', movingSideLinkId: 'group-1',
      actuationMode: 'direct',
      confidence: 'MEDIUM', reviewRequired: true,
      source: 'automatic_brep_candidate', lastModifiedBy: 'automatic_system',
      confirmation: { axis: false, topology: false, movingSide: false, limits: false },
    });
    expect(model.automation).toMatchObject({ jointCandidatesReceived: 1, jointsApplied: 1, rigidMergesApplied: 1 });
    const editor = new RobotEditor(model);
    for (const degrees of [0, 5, -5]) editor.recordJointReviewPose('joint-1', degrees);
    for (const aspect of ['movingPartsCorrect', 'pivotCorrect', 'directionCorrect']) editor.confirmJointMotionAspect('joint-1', aspect);
    editor.confirmJoint('joint-1');
    expect(editor.model.joints[0]).toMatchObject({
      reviewRequired: false, lastModifiedBy: 'user',
      confirmation: { axis: true, topology: true, movingSide: true, limits: false },
    });
    editor.setJointActuationMode('joint-1', 'reaction');
    expect(editor.model.joints[0]).toMatchObject({
      parentLinkId: 'group-2', childLinkId: 'group-1', movingSideLinkId: 'group-1',
      actuationMode: 'reaction', reviewRequired: true,
    });
    expect(editor.model.rigidGroups.find(group => group.id === 'group-1').occurrenceIds).toContain('occ:1/3');
    expect(editor.model.rigidGroups.find(group => group.id === 'group-2').occurrenceIds).not.toContain('occ:1/3');
    editor.setJointActuationMode('joint-1', 'direct');
    expect(editor.model.joints[0]).toMatchObject({
      parentLinkId: 'group-2', childLinkId: 'group-1', actuationMode: 'direct',
    });
    expect(editor.model.rigidGroups.find(group => group.id === 'group-2').occurrenceIds).toContain('occ:1/3');
  });

  it('does not turn a TEMPLATE_VERIFIED instance into a high-risk review blocker', () => {
    const candidates = {
      rootRecommendation: { occurrenceId: 'occ:1/2', confidence: 'HIGH', reviewRequired: false },
      jointCandidates: [{
        id: 'templated', actuatorOccurrenceId: 'occ:1/3', originMeters: [0, 0, 0], axis: [0, 0, 1],
        topologyAlternatives: [{ parentOccurrenceId: 'occ:1/2', childOccurrenceId: 'occ:1/1', movingSideOccurrenceId: 'occ:1/1' }],
        confidence: 'HIGH', verificationStatus: 'TEMPLATE_VERIFIED', reviewRequired: false,
        templateId: 'servo-template-001', usesTemplate: true,
      }],
    };
    const model = createRobotModelFromAnalysis(assembly, candidates, 'job-template');
    expect(model.joints[0]).toMatchObject({
      verificationStatus: 'TEMPLATE_VERIFIED', reviewRequired: false,
      confirmation: { axis: true, topology: true, movingSide: true, limits: false },
    });
  });

  it('moves complete multipart servo housing/output role sets for direct and reaction mounting', () => {
    const editor = new RobotEditor({
      schema: 'step-servo-urdf/robot-model/v1', rootLinkId: 'parent', mirroredOccurrences: [], servoTemplates: [], servoInstances: [],
      rigidGroups: [
        { id: 'parent', name: 'parent', occurrenceIds: ['parent-anchor', 'housing-a', 'housing-b', 'servo-screw'] },
        { id: 'child', name: 'child', occurrenceIds: ['child-anchor', 'output-a', 'output-b'] },
      ],
      joints: [{
        id: 'joint-servo', name: 'joint_servo', parentLinkId: 'parent', childLinkId: 'child', movingSideLinkId: 'child',
        actuatorOccurrenceId: 'output-a', actuationMode: 'direct',
        componentRoleOccurrenceIds: { housing: ['housing-a', 'housing-b'], output: ['output-a', 'output-b'], ignored: ['servo-screw'] },
        confirmation: { axis: true, topology: true, movingSide: true, limits: false },
      }],
    });
    editor.setJointActuationMode('joint-servo', 'reaction');
    expect(editor.model.rigidGroups.find(group => group.id === 'parent').occurrenceIds).toEqual(expect.arrayContaining(['parent-anchor', 'output-a', 'output-b', 'servo-screw']));
    expect(editor.model.rigidGroups.find(group => group.id === 'child').occurrenceIds).toEqual(expect.arrayContaining(['child-anchor', 'housing-a', 'housing-b']));
    expect(editor.model.rigidGroups.find(group => group.id === 'child').occurrenceIds).not.toContain('output-a');
    editor.setJointActuationMode('joint-servo', 'direct');
    expect(editor.model.rigidGroups.find(group => group.id === 'parent').occurrenceIds).toEqual(expect.arrayContaining(['housing-a', 'housing-b']));
    expect(editor.model.rigidGroups.find(group => group.id === 'child').occurrenceIds).toEqual(expect.arrayContaining(['output-a', 'output-b']));
  });
});
