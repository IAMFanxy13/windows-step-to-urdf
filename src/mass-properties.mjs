const multiply3 = (a, b) => Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const column = index % 3;
  return a[row * 3] * b[column] + a[row * 3 + 1] * b[3 + column] + a[row * 3 + 2] * b[6 + column];
});
const transpose3 = value => [value[0], value[3], value[6], value[1], value[4], value[7], value[2], value[5], value[8]];
const add3 = (a, b) => a.map((value, index) => value + b[index]);
const scale3 = (a, scale) => a.map(value => value * scale);

function transformPoint(matrix, point) {
  return [
    matrix[0] * point[0] + matrix[1] * point[1] + matrix[2] * point[2] + matrix[3],
    matrix[4] * point[0] + matrix[5] * point[1] + matrix[6] * point[2] + matrix[7],
    matrix[8] * point[0] + matrix[9] * point[1] + matrix[10] * point[2] + matrix[11],
  ];
}

function parallelAxis(mass, delta) {
  const [x, y, z] = delta;
  return scale3([
    y * y + z * z, -x * y, -x * z,
    -x * y, x * x + z * z, -y * z,
    -x * z, -y * z, x * x + y * y,
  ], mass);
}

export function computeRigidGroupInertial(group, assembly, {
  densityKgPerCubicMeter,
  densityByDefinitionId = null,
  linkFrameMeters = [0, 0, 0],
} = {}) {
  const hasGlobalDensity = Number.isFinite(densityKgPerCubicMeter) && densityKgPerCubicMeter > 0;
  if (!hasGlobalDensity && !densityByDefinitionId) throw new Error('A positive user density is required');
  const definitions = new Map(assembly.definitions.map(item => [item.id, item]));
  const occurrences = new Map(assembly.occurrences.map(item => [item.id, item]));
  const densitySources = {};
  const densityFor = definitionId => {
    const entry = densityByDefinitionId?.[definitionId];
    const density = typeof entry === 'number' ? entry : entry?.value;
    if (Number.isFinite(density) && density > 0) {
      densitySources[definitionId] = entry?.source || 'user_definition_density';
      return density;
    }
    if (hasGlobalDensity) {
      densitySources[definitionId] = 'user_global_density';
      return densityKgPerCubicMeter;
    }
    throw new Error(`A positive density is required for STEP definition ${definitionId}`);
  };
  const items = group.occurrenceIds.map(id => {
    const occurrence = occurrences.get(id);
    const properties = definitions.get(occurrence?.definitionId)?.massProperties;
    if (!occurrence || !properties || !(properties.volumeCubicMeters > 0)) throw new Error(`Missing OCCT B-Rep mass properties for ${id}`);
    const transform = occurrence.sourceTransformMeters;
    const rotation = [transform[0], transform[1], transform[2], transform[4], transform[5], transform[6], transform[8], transform[9], transform[10]];
    const density = densityFor(occurrence.definitionId);
    const mass = properties.volumeCubicMeters * density;
    const localInertia = scale3(properties.inertiaAtUnitDensityKgPerCubicMeter, density);
    return {
      mass,
      center: transformPoint(transform, properties.centerOfMassMeters),
      inertia: multiply3(multiply3(rotation, localInertia), transpose3(rotation)),
    };
  });
  const mass = items.reduce((sum, item) => sum + item.mass, 0);
  if (!(mass > 0)) throw new Error('Rigid group contains no positive-volume occurrences');
  const centerWorld = [0, 1, 2].map(axis => items.reduce((sum, item) => sum + item.center[axis] * item.mass, 0) / mass);
  let inertia = Array(9).fill(0);
  for (const item of items) {
    const delta = item.center.map((value, axis) => value - centerWorld[axis]);
    inertia = add3(inertia, add3(item.inertia, parallelAxis(item.mass, delta)));
  }
  return {
    massKilograms: mass,
    centerOfMassMeters: centerWorld.map((value, axis) => value - linkFrameMeters[axis]),
    inertiaKgSquareMeters: inertia,
    densityKgPerCubicMeter: hasGlobalDensity ? densityKgPerCubicMeter : null,
    densitySources,
    source: densityByDefinitionId ? 'per_definition_density+occt_brep' : 'user_density+occt_brep',
  };
}
