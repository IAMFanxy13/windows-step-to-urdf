import { XMLParser } from 'fast-xml-parser';

const asArray = value => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

const parseTuple = value =>
  String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);

const meshNodesForLink = link =>
  asArray(link.visual).flatMap(visual =>
    asArray(visual?.geometry?.mesh),
  );

export function readBinaryStlBounds(buffer) {
  const bytes =
    buffer instanceof Uint8Array
      ? buffer
      : new Uint8Array(buffer);
  if (bytes.byteLength < 84) throw new Error('Binary STL is shorter than 84 bytes');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = view.getUint32(80, true);
  const expectedLength = 84 + triangles * 50;
  if (bytes.byteLength !== expectedLength) {
    throw new Error(
      `Binary STL length mismatch: expected ${expectedLength}, got ${bytes.byteLength}`,
    );
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const triangleOffset = 84 + triangle * 50;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const vertexOffset = triangleOffset + 12 + vertex * 12;
      for (let axis = 0; axis < 3; axis += 1) {
        const value = view.getFloat32(vertexOffset + axis * 4, true);
        if (!Number.isFinite(value)) throw new Error('STL vertex is not finite');
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
  }
  return { triangles, min, max };
}

export function validateUrdf(xml, {
  expectedLinks = null,
  expectedRevoluteJoints = null,
  meshExists = () => true,
  meshBounds = () => null,
} = {}) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    allowBooleanAttributes: true,
  });
  const document = parser.parse(xml);
  const robot = document.robot;
  const errors = [];
  if (!robot) {
    return {
      ok: false,
      errors: ['Missing robot root element'],
      counts: { links: 0, joints: 0, revoluteJoints: 0, roots: 0, meshes: 0 },
    };
  }

  const links = asArray(robot.link);
  const joints = asArray(robot.joint);
  const revoluteJoints = joints.filter(joint => joint.type === 'revolute');
  const linkNames = new Set(links.map(link => link.name));
  const childNames = new Set();
  const outgoing = new Map();
  const incomingCount = new Map([...linkNames].map(name => [name, 0]));
  const undirectedDegree = new Map([...linkNames].map(name => [name, 0]));

  if (expectedLinks != null && links.length !== expectedLinks) {
    errors.push(`Expected ${expectedLinks} links, found ${links.length}`);
  }
  if (expectedRevoluteJoints != null && revoluteJoints.length !== expectedRevoluteJoints) {
    errors.push(
      `Expected ${expectedRevoluteJoints} revolute joints, found ${revoluteJoints.length}`,
    );
  }

  for (const joint of joints) {
    const name = joint.name || '<unnamed>';
    const parent = joint.parent?.link;
    const child = joint.child?.link;
    if (!parent) errors.push(`Joint ${name} missing parent`);
    if (!child) errors.push(`Joint ${name} missing child`);
    if (!joint.origin?.xyz) errors.push(`Joint ${name} missing origin`);
    if (!joint.axis?.xyz) {
      errors.push(`Joint ${name} missing axis`);
    } else {
      const axis = parseTuple(joint.axis.xyz);
      const length = Math.sqrt(axis.reduce((sum, value) => sum + value * value, 0));
      if (
        axis.length !== 3 ||
        !axis.every(Number.isFinite) ||
        Math.abs(length - 1) > 1e-6
      ) {
        errors.push(`Joint ${name} axis must be a unit vector`);
      }
    }
    if (joint.type === 'revolute' && !joint.limit) {
      errors.push(`Joint ${name} missing limit`);
    }
    if (joint.limit) {
      for (const field of ['lower', 'upper', 'effort', 'velocity']) {
        if (!Number.isFinite(Number(joint.limit[field]))) {
          errors.push(`Joint ${name} limit missing numeric ${field}`);
        }
      }
    }
    if (parent && !linkNames.has(parent)) {
      errors.push(`Joint ${name} references unknown parent ${parent}`);
    }
    if (child && !linkNames.has(child)) {
      errors.push(`Joint ${name} references unknown child ${child}`);
    }
    if (parent && child && linkNames.has(parent) && linkNames.has(child)) {
      childNames.add(child);
      incomingCount.set(child, (incomingCount.get(child) || 0) + 1);
      if (!outgoing.has(parent)) outgoing.set(parent, []);
      outgoing.get(parent).push(child);
      undirectedDegree.set(parent, undirectedDegree.get(parent) + 1);
      undirectedDegree.set(child, undirectedDegree.get(child) + 1);
    }
  }

  for (const [name, count] of incomingCount) {
    if (count > 1) errors.push(`Link ${name} has multiple parents`);
  }

  const roots = [...linkNames].filter(name => !childNames.has(name));
  if (roots.length === 0) errors.push('No root link found; graph may contain a cycle');
  if (roots.length > 1) {
    errors.push(`Multiple roots found: ${roots.join(', ')}`);
  }

  for (const [name, degree] of undirectedDegree) {
    if (links.length > 1 && degree === 0) errors.push(`Isolated link: ${name}`);
  }

  const visitState = new Map();
  let cycleFound = false;
  const visit = name => {
    const state = visitState.get(name) || 0;
    if (state === 1) {
      cycleFound = true;
      return;
    }
    if (state === 2) return;
    visitState.set(name, 1);
    for (const child of outgoing.get(name) || []) visit(child);
    visitState.set(name, 2);
  };
  for (const name of linkNames) visit(name);
  if (cycleFound) errors.push('Kinematic graph contains a cycle');

  const meshes = [];
  for (const link of links) {
    const linkMeshes = meshNodesForLink(link);
    if (linkMeshes.length === 0) errors.push(`Link ${link.name} has no visual mesh`);
    for (const mesh of linkMeshes) {
      const filename = mesh.filename;
      meshes.push(filename);
      if (!filename || !meshExists(filename)) {
        errors.push(`Missing mesh for link ${link.name}: ${filename || '<none>'}`);
        continue;
      }
      const bounds = meshBounds(filename);
      if (bounds) {
        const extents = bounds.max.map((value, index) => value - bounds.min[index]);
        const largest = Math.max(...extents);
        if (
          !extents.every(Number.isFinite) ||
          largest < 0.001 ||
          largest > 10
        ) {
          errors.push(
            `Mesh ${filename} has implausible dimensions for metres: ${extents.join(', ')}`,
          );
        }
      }
    }
  }

  const counts = {
    links: links.length,
    joints: joints.length,
    revoluteJoints: revoluteJoints.length,
    roots: roots.length,
    meshes: meshes.length,
  };
  return { ok: errors.length === 0, errors, counts, roots, meshes };
}
