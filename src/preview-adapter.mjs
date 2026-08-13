export const PREVIEW_COLORS = Object.freeze({ parent: 0x58a6ff, child: 0xffc107, descendant: 0xff8f70, axis: 0x00e676, ghost: 0x9aa4b2, collision: 0xf85149 });

export function stepDisplayFrameSpec() {
  return {
    rotationRadians: [-Math.PI / 2, 0, 0],
    sourceUpAxis: 'Z',
    displayUpAxis: 'Y',
  };
}

export function applyReviewSceneSpec(robot, spec) {
  if (!robot || !spec) return { applied: false, reason: 'preview unavailable' };
  const highlights = { parent: spec.parentLinkId, child: spec.childLinkId, descendants: [...spec.descendantLinkIds] };
  return { applied: true, ghostAtZero: spec.ghostAtZero, colors: PREVIEW_COLORS, highlights, axis: { originMeters: spec.originMeters, direction: spec.axis }, potentialCollisionEnabled: spec.showPotentialCollision };
}

export function mirrorMeshPolicy(transformInspection) {
  return transformInspection?.mirrored
    ? { meshVariantRequired: true, frameMustRemainRightHanded: true, strategy: 'bake reflection into an instance-specific mesh' }
    : { meshVariantRequired: false, frameMustRemainRightHanded: true, strategy: 'reuse definition mesh' };
}

export function occurrenceRenderSpec(occurrence, definition) {
  if (!occurrence || !definition) throw new TypeError('occurrence and definition are required');
  const reflectionBaked = occurrence.meshReflectionBaked === true;
  const meshPath = reflectionBaked && occurrence.mesh ? occurrence.mesh : definition.mesh;
  const transformMeters = reflectionBaked && Array.isArray(occurrence.meshTransformMeters)
    ? occurrence.meshTransformMeters
    : occurrence.sourceTransformMeters;
  return { cacheKey: meshPath, meshPath, transformMeters, reflectionBaked };
}

const CONTACT_COLORS = Object.freeze({
  FIXED_CONFIRMED: 0x42d392,
  FIXED_LIKELY: 0x42d392,
  ROTATIONAL_INTERFACE: 0x58a6ff,
  ROTATIONAL_CYLINDRICAL_INTERFACE: 0x58a6ff,
  INCIDENTAL_CONTACT: 0xffb454,
  INCIDENTAL_OR_UNKNOWN_CONTACT: 0xffb454,
  UNKNOWN: 0x8b949e,
});

export function contactGraphLineSpecs(assembly) {
  const occurrences = new Map((assembly?.occurrences || []).map(item => [item.id, item]));
  return (assembly?.contactGraph?.edges || []).flatMap(edge => {
    const left = occurrences.get(edge.a);
    const right = occurrences.get(edge.b);
    if (!left?.sourceTransformMeters || !right?.sourceTransformMeters) return [];
    const classification = edge.rigidDecision || edge.interfaceClass || 'UNKNOWN';
    return [{
      edgeId: edge.id || [edge.a, edge.b].sort().join('|'),
      a: edge.a,
      b: edge.b,
      start: [left.sourceTransformMeters[3], left.sourceTransformMeters[7], left.sourceTransformMeters[11]],
      end: [right.sourceTransformMeters[3], right.sourceTransformMeters[7], right.sourceTransformMeters[11]],
      classification,
      confidence: edge.confidence || 'LOW',
      color: CONTACT_COLORS[classification] || CONTACT_COLORS.UNKNOWN,
      evidence: edge.interfacePairs || edge.evidence || [],
    }];
  });
}
