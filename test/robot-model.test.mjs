import { describe, expect, it } from 'vitest';

import {
  createEmptyRobotModel,
  validateRobotModel,
  validateRobotModelDetailed,
} from '../src/robot-model.mjs';

function modelWithSize(size) {
  const model = createEmptyRobotModel('job-1');
  model.rigidGroups = Array.from({ length: size }, (_, index) => ({
    id: `group-${index}`,
    name: `link_${index}`,
    occurrenceIds: [`occ-${index}`],
    inertial: {
      massKilograms: 1,
      centerOfMassMeters: [0, 0, 0],
      inertiaKgSquareMeters: [0.01, 0, 0, 0, 0.02, 0, 0, 0, 0.03],
      source: 'user_density',
    },
  }));
  model.rootLinkId = 'group-0';
  model.joints = Array.from({ length: size - 1 }, (_, index) => ({
    id: `joint-${index}`,
    name: `joint_${index}`,
    type: 'revolute',
    parentLinkId: `group-${index}`,
    childLinkId: `group-${index + 1}`,
    movingSideLinkId: `group-${index + 1}`,
    originMeters: [index / 10, 0, 0],
    axis: [0, 0, 1],
    limits: { lowerRadians: null, upperRadians: null, source: 'unset' },
    confirmation: { axis: false, topology: false, movingSide: false, limits: false },
  }));
  return model;
}

describe('generic robot model', () => {
  it.each([2, 5, 17])('accepts a connected tree with %i links', size => {
    const result = validateRobotModel(modelWithSize(size));
    expect(result.ok).toBe(true);
    expect(result.counts).toEqual({ links: size, revoluteJoints: size - 1, roots: 1 });
  });

  it('does not allow export until every limit is explicitly confirmed', () => {
    const model = modelWithSize(3);
    const result = validateRobotModel(model, { forExport: true });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('joint_0: user-confirmed lower/upper limits are required');

    for (const joint of model.joints) {
      joint.limits = { lowerRadians: -0.5, upperRadians: 0.8, source: 'user' };
      joint.confirmation = { axis: true, topology: true, movingSide: true, limits: true };
      joint.dynamics = { effort: 2, velocity: 1.5, source: 'user' };
    }
    expect(validateRobotModel(model, { forExport: true }).ok).toBe(true);
  });

  it('requires user-supplied positive effort and velocity for engineering export', () => {
    const model = modelWithSize(2);
    model.joints[0].limits = { lowerRadians: -0.5, upperRadians: 0.5, source: 'user' };
    model.joints[0].confirmation = { axis: true, topology: true, movingSide: true, limits: true };
    expect(validateRobotModel(model, { forExport: true }).errors).toContain(
      'joint_0: user-supplied positive effort and velocity are required',
    );
    model.joints[0].dynamics = { effort: 2, velocity: 1.5, source: 'user' };
    expect(validateRobotModel(model, { forExport: true }).ok).toBe(true);
  });

  it('rejects cycles and non-unit axes', () => {
    const model = modelWithSize(3);
    model.joints[0].axis = [0, 0, 2];
    model.joints[1].childLinkId = 'group-0';
    const result = validateRobotModel(model);
    expect(result.ok).toBe(false);
    expect(result.errors.some(error => error.includes('unit vector'))).toBe(true);
    expect(result.errors.some(error => error.includes('cycle'))).toBe(true);
  });

  it('rejects missing or non-positive-definite inertial data at export', () => {
    const model = modelWithSize(2);
    model.rigidGroups[0].inertial.inertiaKgSquareMeters[8] = -1;
    for (const joint of model.joints) {
      joint.limits = { lowerRadians: -0.5, upperRadians: 0.5, source: 'user' };
      joint.confirmation = { axis: true, topology: true, movingSide: true, limits: true };
      joint.dynamics = { effort: 2, velocity: 1.5, source: 'user' };
    }
    const result = validateRobotModel(model, { forExport: true });
    expect(result.ok).toBe(false);
    expect(result.errors.some(error => error.includes('positive definite'))).toBe(true);
  });

  it('returns localized blocker issues with direct repair actions', () => {
    const model = modelWithSize(2);
    model.joints[0].axis = [0, 0, 0];
    model.joints[0].limits = { lowerRadians: null, upperRadians: null, source: 'unset' };
    const report = validateRobotModelDetailed(model, { forExport: true });
    const axis = report.issues.find(issue => issue.code === 'JOINT_AXIS_INVALID');
    const limits = report.issues.find(issue => issue.code === 'JOINT_LIMITS_REQUIRED');
    expect(axis).toMatchObject({ severity: 'BLOCKER', target: { type: 'joint', id: 'joint-0' } });
    expect(axis.actions.map(action => action.id)).toContain('reselect-axis');
    expect(limits.message).toContain('joint_0');
    expect(limits.actions.map(action => action.id)).toContain('edit-limits');
    expect(report.summary.blockers).toBeGreaterThanOrEqual(2);
    expect(report.canExport).toBe(false);
  });

  it('blocks limits that exclude the STEP q=0 pose', () => {
    const model = modelWithSize(2);
    model.joints[0].limits = { lowerRadians: 0.1, upperRadians: 0.5, source: 'user' };
    model.joints[0].confirmation = { axis: true, topology: true, movingSide: true, limits: true };
    const report = validateRobotModelDetailed(model, { forExport: true });
    expect(report.issues.some(issue => issue.code === 'ZERO_OUTSIDE_LIMITS')).toBe(true);
  });

  it('turns confirmed low-confidence automation into a warning but unresolved ambiguity into a blocker', () => {
    const model = modelWithSize(2);
    const joint = model.joints[0];
    joint.confidence = 'LOW';
    joint.reviewRequired = true;
    joint.verificationStatus = 'UNRESOLVED';
    joint.lastModifiedBy = 'automatic_system';
    let report = validateRobotModelDetailed(model);
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'HIGH_RISK_AMBIGUITY', severity: 'BLOCKER' }));

    joint.reviewRequired = false;
    joint.verificationStatus = 'USER_VERIFIED';
    joint.lastModifiedBy = 'user';
    report = validateRobotModelDetailed(model);
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'LOW_CONFIDENCE_CONFIRMED', severity: 'WARNING' }));
  });

  it('never hides automatically skipped joint candidates', () => {
    const model = modelWithSize(2);
    model.automation = { jointCandidatesReceived: 4, jointsApplied: 1, candidatesSkipped: 3 };
    const report = validateRobotModelDetailed(model);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: 'AUTOMATIC_CANDIDATES_SKIPPED', severity: 'BLOCKER',
      message: expect.stringContaining('3 个关节候选'),
    }));
  });

  it('blocks formal export when the global topology search was not exhaustive', () => {
    const model = modelWithSize(2);
    model.automation = {
      jointCandidatesReceived: 1,
      jointsApplied: 1,
      candidatesSkipped: 0,
      globalSolverSearchExhaustive: false,
    };
    const report = validateRobotModelDetailed(model, { forExport: true });
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: 'GLOBAL_SOLVER_SEARCH_INCOMPLETE', severity: 'BLOCKER',
    }));
  });

  it('blocks a fused servo occurrence assigned to both housing and output roles', () => {
    const model = modelWithSize(2);
    model.joints[0].componentRoleOccurrenceIds = {
      housing: ['servo-fused'], output: ['servo-fused'], ignored: [],
    };
    const report = validateRobotModelDetailed(model);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: 'UNSPLITTABLE_ACTUATOR_GEOMETRY', severity: 'BLOCKER',
      target: { type: 'joint', id: 'joint-0', name: 'joint_0' },
    }));
  });
});
