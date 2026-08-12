import { describe, expect, it } from 'vitest';

import {
  readBinaryStlBounds,
  validateUrdf,
} from '../src/urdf-validation.mjs';

const link = name => `
  <link name="${name}">
    <visual><geometry><mesh filename="meshes/${name}.stl"/></geometry></visual>
  </link>`;

const joint = ({
  name = 'j1',
  parent = 'base',
  child = 'child',
  axis = '0 0 1',
  origin = true,
  limit = true,
} = {}) => `
  <joint name="${name}" type="revolute">
    <parent link="${parent}"/>
    <child link="${child}"/>
    ${origin ? '<origin xyz="0 0 0" rpy="0 0 0"/>' : ''}
    <axis xyz="${axis}"/>
    ${limit ? '<limit lower="-0.3" upper="0.3" effort="1" velocity="1"/>' : ''}
  </joint>`;

const robot = body => `<?xml version="1.0"?><robot name="test">${body}</robot>`;

const options = {
  expectedLinks: 2,
  expectedRevoluteJoints: 1,
  meshExists: () => true,
  meshBounds: () => ({ min: [0, 0, 0], max: [0.2, 0.1, 0.1] }),
};

describe('validateUrdf', () => {
  it('is generic when expected counts are not supplied', () => {
    const result = validateUrdf(robot(link('base')), {
      meshExists: () => true,
      meshBounds: () => ({ min: [0, 0, 0], max: [0.2, 0.1, 0.1] }),
    });
    expect(result.ok).toBe(true);
    expect(result.errors.join('\n')).not.toMatch(/expected 14|expected 13/i);
  });

  it('accepts a connected one-root tree with complete revolute data', () => {
    const result = validateUrdf(
      robot(link('base') + link('child') + joint()),
      options,
    );
    expect(result.ok).toBe(true);
    expect(result.counts).toEqual({
      links: 2,
      joints: 1,
      revoluteJoints: 1,
      roots: 1,
      meshes: 2,
    });
  });

  it('reports incorrect link and revolute-joint counts', () => {
    const result = validateUrdf(robot(link('base')), options);
    expect(result.errors.join('\n')).toMatch(/expected 2 links/i);
    expect(result.errors.join('\n')).toMatch(/expected 1 revolute/i);
  });

  it('detects multiple roots and isolated links', () => {
    const result = validateUrdf(
      robot(link('base') + link('child') + link('orphan') + joint()),
      { ...options, expectedLinks: 3 },
    );
    expect(result.errors.join('\n')).toMatch(/multiple roots/i);
    expect(result.errors.join('\n')).toMatch(/isolated.*orphan/i);
  });

  it('detects a closed cycle', () => {
    const result = validateUrdf(
      robot(
        link('base') +
          link('child') +
          joint() +
          joint({ name: 'j2', parent: 'child', child: 'base' }),
      ),
      { ...options, expectedRevoluteJoints: 2 },
    );
    expect(result.errors.join('\n')).toMatch(/cycle/i);
  });

  it('requires origin, axis, and limit and rejects non-unit axes', () => {
    const missing = validateUrdf(
      robot(link('base') + link('child') + joint({ origin: false, limit: false })),
      options,
    );
    expect(missing.errors.join('\n')).toMatch(/missing origin/i);
    expect(missing.errors.join('\n')).toMatch(/missing limit/i);

    const nonUnit = validateUrdf(
      robot(link('base') + link('child') + joint({ axis: '0 0 2' })),
      options,
    );
    expect(nonUnit.errors.join('\n')).toMatch(/unit vector/i);
  });

  it('reports missing meshes', () => {
    const result = validateUrdf(
      robot(link('base') + link('child') + joint()),
      { ...options, meshExists: filename => !filename.includes('child') },
    );
    expect(result.errors.join('\n')).toMatch(/missing mesh.*child/i);
  });

  it('rejects obvious thousand-times mesh scale errors', () => {
    const result = validateUrdf(
      robot(link('base') + link('child') + joint()),
      {
        ...options,
        meshBounds: () => ({ min: [0, 0, 0], max: [500, 300, 100] }),
      },
    );
    expect(result.errors.join('\n')).toMatch(/implausible.*metres/i);
  });
});

describe('readBinaryStlBounds', () => {
  it('reads finite metre bounds from a binary STL buffer', () => {
    const buffer = Buffer.alloc(84 + 50);
    buffer.writeUInt32LE(1, 80);
    const values = [
      0, 0, 1,
      -0.2, 0.1, 0,
      0.3, -0.4, 0.5,
      0, 0.2, -0.1,
    ];
    values.forEach((value, index) => buffer.writeFloatLE(value, 84 + index * 4));
    expect(readBinaryStlBounds(buffer)).toEqual({
      triangles: 1,
      min: [-0.20000000298023224, -0.4000000059604645, -0.10000000149011612],
      max: [0.30000001192092896, 0.20000000298023224, 0.5],
    });
  });
});
