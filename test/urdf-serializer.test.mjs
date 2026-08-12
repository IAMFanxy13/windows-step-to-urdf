import { describe, expect, it } from 'vitest';

import {
  deriveLinkFrames,
  renderGenericUrdf,
  visualMatrixInLink,
} from '../src/urdf-serializer.mjs';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translated = [1, 0, 0, 0.1, 0, 1, 0, 0.2, 0, 0, 1, 0.3, 0, 0, 0, 1];
const inertial = {
  massKilograms: 1,
  centerOfMassMeters: [0, 0, 0],
  inertiaKgSquareMeters: [0.01, 0, 0, 0, 0.02, 0, 0, 0, 0.03],
  source: 'user_density',
};

const model = {
  schema: 'step-servo-urdf/robot-model/v1', jobId: 'x', sourcePoseIsZero: true, rootLinkId: 'g1',
  rigidGroups: [
    { id: 'g1', name: 'base', occurrenceIds: ['o1'], inertial },
    { id: 'g2', name: 'arm', occurrenceIds: ['o2'], inertial },
  ],
  joints: [{
    id: 'j1', name: 'shoulder', type: 'revolute', parentLinkId: 'g1', childLinkId: 'g2', movingSideLinkId: 'g2',
    originMeters: [0.05, 0.1, 0.15], axis: [0, 0, 1],
    limits: { lowerRadians: -0.4, upperRadians: 0.7, source: 'user' },
    dynamics: { effort: 2.5, velocity: 1.25, source: 'user' },
    confirmation: { axis: true, topology: true, movingSide: true, limits: true },
  }],
};
const assembly = {
  source: { sha256: 'abc' },
  definitions: [
    { id: 'd1', mesh: 'definitions/d1.stl', collisionMesh: 'collision/d1.stl', collisionMeshSource: 'occt_brep_coarse_tessellation' },
    { id: 'd2', mesh: 'definitions/d2.stl', collisionMesh: 'collision/d2.stl', collisionMeshSource: 'occt_brep_coarse_tessellation' },
  ],
  occurrences: [
    { id: 'o1', definitionId: 'd1', sourceTransformMeters: identity },
    { id: 'o2', definitionId: 'd2', sourceTransformMeters: translated },
  ],
};

describe('generic URDF serializer', () => {
  it('preserves every STEP occurrence world transform at q=0', () => {
    const frames = deriveLinkFrames(model);
    expect(frames.get('g2').slice(0, 3)).toEqual([0.05, 0.1, 0.15]);
    const relative = visualMatrixInLink(translated, frames.get('g2'));
    expect(relative[3]).toBeCloseTo(0.05);
    expect(relative[7]).toBeCloseTo(0.1);
    expect(relative[11]).toBeCloseTo(0.15);
    const reconstructed = [...relative];
    reconstructed[3] += frames.get('g2')[0];
    reconstructed[7] += frames.get('g2')[1];
    reconstructed[11] += frames.get('g2')[2];
    expect(reconstructed).toEqual(translated);
  });

  it('renders generic links, revolute joints, meter meshes, inertials and user limits', () => {
    const urdf = renderGenericUrdf(model, assembly, { robotName: 'arbitrary_robot' });
    expect(urdf).toContain('<robot name="arbitrary_robot">');
    expect(urdf.match(/<link name=/g)).toHaveLength(2);
    expect(urdf.match(/type="revolute"/g)).toHaveLength(1);
    expect(urdf).toContain('filename="meshes/definitions/d2.stl" scale="1 1 1"');
    expect(urdf).toContain('lower="-0.4" upper="0.7"');
    expect(urdf).toContain('effort="2.5" velocity="1.25"');
    expect(urdf).toContain('<mass value="1"/>');
    expect(urdf.toLowerCase()).not.toContain('sample-brand');
    expect(urdf.toLowerCase()).not.toContain('sample-model');
  });

  it('keeps localhost preview mesh paths relative for URDFLoader workingPath resolution', () => {
    const urdf = renderGenericUrdf(model, assembly, {
      preview: true,
      meshPrefix: 'api/step-jobs/job-1/artifacts/',
      temporaryCollisionFromVisual: false,
    });
    expect(urdf).toContain('filename="api/step-jobs/job-1/artifacts/definitions/d1.stl"');
    expect(urdf).not.toContain('filename="//api/');
  });

  it('serializes a distinct OCCT collision mesh when temporary visual reuse is disabled', () => {
    const urdf = renderGenericUrdf(model, assembly, { temporaryCollisionFromVisual: false });
    expect(urdf).toContain('<mesh filename="meshes/collision/d2.stl" scale="1 1 1"/>');
    expect(urdf).toContain('collision geometry source: occt_brep_coarse_tessellation');
  });

  it('attaches disconnected candidate roots with preview-only fixed joints without making them exportable', () => {
    const forestModel = structuredClone(model);
    forestModel.rigidGroups.push({ id: 'g3', name: 'unresolved_branch', occurrenceIds: ['o3'] });
    const forestAssembly = structuredClone(assembly);
    forestAssembly.definitions.push({ id: 'd3', mesh: 'definitions/d3.stl' });
    forestAssembly.occurrences.push({ id: 'o3', definitionId: 'd3', sourceTransformMeters: identity });
    expect(() => renderGenericUrdf(forestModel, forestAssembly, { preview: true })).toThrow(/root link/i);
    const preview = renderGenericUrdf(forestModel, forestAssembly, {
      preview: true, attachPreviewForest: true, temporaryCollisionFromVisual: false,
    });
    expect(preview).toContain('name="preview_attach_g3" type="fixed"');
    expect(preview).toContain('<child link="unresolved_branch"/>');
  });

  it('uses a reflection-baked occurrence mesh and a right-handed residual transform', () => {
    const mirroredModel = structuredClone(model);
    mirroredModel.mirroredOccurrences = [{ occurrenceId: 'o2', determinant: -1, meshBaked: true }];
    const mirroredAssembly = structuredClone(assembly);
    mirroredAssembly.occurrences[1].sourceTransformMeters = [-1, 0, 0, 0.1, 0, 1, 0, 0.2, 0, 0, 1, 0.3, 0, 0, 0, 1];
    mirroredAssembly.occurrences[1].meshTransformMeters = translated;
    mirroredAssembly.occurrences[1].mesh = 'instances/o2_reflection_baked.stl';
    mirroredAssembly.occurrences[1].meshReflectionBaked = true;
    const urdf = renderGenericUrdf(mirroredModel, mirroredAssembly, { robotName: 'mirrored_robot' });
    expect(urdf).toContain('filename="meshes/instances/o2_reflection_baked.stl"');
    expect(urdf).not.toContain('rpy="0 -3.14159265359 3.14159265359"');
  });
});
