const clone = value => structuredClone(value);

function worldBounds(occurrence, definition) {
  const bounds = definition?.boundsMeters;
  const matrix = occurrence.sourceTransformMeters || occurrence.worldTransformMeters;
  if (!bounds || !matrix) return null;
  const points = [];
  for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) points.push([
    matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3], matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7], matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11],
  ]);
  return { min: [0, 1, 2].map(i => Math.min(...points.map(p => p[i]))), max: [0, 1, 2].map(i => Math.max(...points.map(p => p[i]))) };
}

function boundsMetrics(a, b) {
  const gaps = [0, 1, 2].map(i => Math.max(0, a.min[i] - b.max[i], b.min[i] - a.max[i]));
  const overlaps = [0, 1, 2].map(i => Math.max(0, Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i])));
  const distance = Math.hypot(...gaps);
  const sortedOverlap = [...overlaps].sort((x, y) => y - x);
  const contactAreaEstimate = sortedOverlap[0] * sortedOverlap[1];
  const contains = (outer, inner) => [0, 1, 2].every(i => outer.min[i] <= inner.min[i] && outer.max[i] >= inner.max[i]);
  return { distance, gaps, overlaps, contactAreaEstimate, containment: contains(a, b) ? 'A_CONTAINS_B' : contains(b, a) ? 'B_CONTAINS_A' : 'NONE' };
}

export function looksLikeFastener(definition) {
  const name = String(definition?.name || '').toLowerCase();
  const semantic = /(screw|bolt|nut|washer|bearing|螺钉|螺栓|螺母|垫片|轴承)/.test(name);
  const bounds = definition?.boundsMeters;
  const dimensions = bounds ? [0, 1, 2].map(i => bounds.max[i] - bounds.min[i]).sort((a, b) => a - b) : [];
  const slender = dimensions.length === 3 && dimensions[2] > dimensions[0] * 2.5 && dimensions[1] < 0.02;
  const tiny = definition?.massProperties?.volumeCubicMeters > 0 && definition.massProperties.volumeCubicMeters < 2e-6;
  return semantic || (slender && tiny);
}

export function buildContactGraph(assembly, { coarseToleranceMeters = 0.003, contactToleranceMeters = 0.00005, exactDistances = {} } = {}) {
  const definitions = new Map(assembly.definitions.map(item => [item.id, item]));
  const parts = assembly.occurrences.filter(item => item.kind === 'part');
  const bounds = new Map(parts.map(item => [item.id, worldBounds(item, definitions.get(item.definitionId))]));
  const edges = [];
  for (let i = 0; i < parts.length; i += 1) for (let j = i + 1; j < parts.length; j += 1) {
    const a = parts[i], b = parts[j], aBounds = bounds.get(a.id), bBounds = bounds.get(b.id);
    if (!aBounds || !bBounds) continue;
    const metrics = boundsMetrics(aBounds, bBounds);
    if (metrics.distance > coarseToleranceMeters) continue;
    const key = [a.id, b.id].sort().join('|');
    const exactMinimumDistanceMeters = Number.isFinite(exactDistances[key]) ? exactDistances[key] : null;
    const effectiveDistance = exactMinimumDistanceMeters ?? metrics.distance;
    const fastener = looksLikeFastener(definitions.get(a.definitionId)) || looksLikeFastener(definitions.get(b.definitionId));
    const confidence = exactMinimumDistanceMeters != null && effectiveDistance <= contactToleranceMeters ? 'HIGH' : metrics.distance <= contactToleranceMeters ? 'MEDIUM' : 'LOW';
    edges.push({
      id: `contact-${edges.length + 1}`, a: a.id, b: b.id,
      boundingBoxDistanceMeters: metrics.distance, exactMinimumDistanceMeters,
      contactAreaSquareMeters: effectiveDistance <= contactToleranceMeters ? metrics.contactAreaEstimate : 0,
      contactAreaMethod: 'AABB_OVERLAP_ESTIMATE_NOT_EXACT_BREP_AREA',
      faceNormalRelation: 'UNKNOWN_UNTIL_EXACT_FACE_PAIR', coaxialRelation: false,
      containment: metrics.containment, outputPortProximityMeters: null,
      fastenerSuppressed: fastener, confidence,
      evidence: [
        `AABB gap ${metrics.distance.toExponential(3)} m`,
        exactMinimumDistanceMeters == null ? 'exact B-Rep distance unavailable for this edge' : `exact B-Rep minimum distance ${exactMinimumDistanceMeters.toExponential(3)} m`,
        fastener ? 'one endpoint matches fastener/bearing suppression evidence' : 'neither endpoint matches current fastener suppression rules',
      ],
    });
  }
  return { schema: 'step-servo-urdf/contact-graph/v1', nodes: parts.map(item => ({ occurrenceId: item.id, definitionId: item.definitionId })), edges };
}

export function classifyServoContacts(contactGraph, servoInstanceId, outputCenterWorld, { outputRadiusMeters = 0.02 } = {}) {
  const candidates = contactGraph.edges.filter(edge => edge.a === servoInstanceId || edge.b === servoInstanceId).map(edge => ({ ...clone(edge), neighborOccurrenceId: edge.a === servoInstanceId ? edge.b : edge.a }));
  const centerByOccurrence = contactGraph.nodeCenters || {};
  for (const edge of candidates) {
    const center = centerByOccurrence[edge.neighborOccurrenceId];
    if (center) edge.outputPortProximityMeters = Math.hypot(...center.map((v, i) => v - outputCenterWorld[i]));
    edge.side = edge.fastenerSuppressed ? 'IGNORED_FASTENER'
      : edge.outputPortProximityMeters != null && edge.outputPortProximityMeters <= outputRadiusMeters ? 'OUTPUT_SIDE'
        : 'HOUSING_SIDE';
  }
  return candidates;
}

export function topologyPatternFromRepresentative({ representativeInstanceId, housingOccurrenceIds, outputOccurrenceIds, assembly, outputPort = null, defaultActuationMode = 'direct', ignoredFastenerTypes = [] }) {
  if (!representativeInstanceId || !housingOccurrenceIds?.length || !outputOccurrenceIds?.length) throw new Error('Representative topology requires housing and output contacts');
  const occurrences = new Map(assembly.occurrences.map(item => [item.id, item]));
  const definitions = new Map(assembly.definitions.map(item => [item.id, item]));
  const servo = occurrences.get(representativeInstanceId);
  const matrix = servo?.sourceTransformMeters;
  const localOffset = occurrence => {
    if (!matrix || !occurrence?.sourceTransformMeters) return null;
    const delta = [occurrence.sourceTransformMeters[3] - matrix[3], occurrence.sourceTransformMeters[7] - matrix[7], occurrence.sourceTransformMeters[11] - matrix[11]];
    return [matrix[0] * delta[0] + matrix[4] * delta[1] + matrix[8] * delta[2], matrix[1] * delta[0] + matrix[5] * delta[1] + matrix[9] * delta[2], matrix[2] * delta[0] + matrix[6] * delta[1] + matrix[10] * delta[2]];
  };
  const signature = ids => ids.map(id => {
    const occurrence = occurrences.get(id), definition = definitions.get(occurrence?.definitionId);
    return { occurrenceId: id, definitionId: occurrence?.definitionId || null, geometryFingerprint: definition?.geometryFingerprint || null, localOffsetMeters: localOffset(occurrence) };
  });
  return {
    representativeInstanceId, housingSideContactSignatures: signature(housingOccurrenceIds), outputSideContactSignatures: signature(outputOccurrenceIds),
    outputPortLocal: outputPort ? { interfaceCenter: [...outputPort.interfaceCenter], axis: [...outputPort.axisLine.direction] } : null,
    relativeLocalPositions: [], defaultActuationMode, ignoredFastenerTypes: [...ignoredFastenerTypes], source: 'user_taught_representative_instance', lastModifiedBy: 'user',
  };
}

export function matchTopologyPattern(pattern, servoInstanceId, contactGraph, assembly) {
  const occurrences = new Map(assembly.occurrences.map(item => [item.id, item]));
  const taughtRoleSignatures = [...(pattern.housingSideContactSignatures || []), ...(pattern.outputSideContactSignatures || [])];
  if (servoInstanceId === pattern.representativeInstanceId && taughtRoleSignatures.length && taughtRoleSignatures.every(item => item.occurrenceId)) {
    const housingOccurrenceIds = (pattern.housingSideContactSignatures || []).map(item => item.occurrenceId).filter(id => occurrences.has(id));
    const outputOccurrenceIds = (pattern.outputSideContactSignatures || []).map(item => item.occurrenceId).filter(id => occurrences.has(id));
    const complete = housingOccurrenceIds.length === (pattern.housingSideContactSignatures || []).length
      && outputOccurrenceIds.length === (pattern.outputSideContactSignatures || []).length;
    return {
      servoInstanceId, housingOccurrenceIds, outputOccurrenceIds,
      defaultActuationMode: pattern.defaultActuationMode, complete,
      verificationStatus: complete ? 'TEMPLATE_VERIFIED' : 'UNRESOLVED',
      evidence: complete ? ['representative topology was explicitly taught by the user'] : ['taught representative occurrences are missing'],
    };
  }
  const servo = occurrences.get(servoInstanceId), matrix = servo?.sourceTransformMeters;
  const neighbors = contactGraph.edges.filter(edge => edge.a === servoInstanceId || edge.b === servoInstanceId).map(edge => ({ edge, id: edge.a === servoInstanceId ? edge.b : edge.a }));
  const neighborOffset = item => {
    const occurrence = occurrences.get(item.id);
    if (!matrix || !occurrence?.sourceTransformMeters) return null;
    const delta = [occurrence.sourceTransformMeters[3] - matrix[3], occurrence.sourceTransformMeters[7] - matrix[7], occurrence.sourceTransformMeters[11] - matrix[11]];
    return [matrix[0] * delta[0] + matrix[4] * delta[1] + matrix[8] * delta[2], matrix[1] * delta[0] + matrix[5] * delta[1] + matrix[9] * delta[2], matrix[2] * delta[0] + matrix[6] * delta[1] + matrix[10] * delta[2]];
  };
  const used = new Set();
  const matchSide = (signatures, role) => signatures.map(signature => {
    const ranked = neighbors.filter(item => !item.edge.fastenerSuppressed && !used.has(item.id)).map(item => {
      const occurrence = occurrences.get(item.id), offset = neighborOffset(item);
      const positional = offset && signature.localOffsetMeters ? Math.hypot(...offset.map((value, i) => value - signature.localOffsetMeters[i])) : 1;
      const exactDefinition = Boolean(signature.definitionId && occurrence?.definitionId === signature.definitionId);
      const definitionBonus = exactDefinition ? -0.05 : 0;
      const portDistance = offset && pattern.outputPortLocal ? Math.hypot(...offset.map((value, i) => value - pattern.outputPortLocal.interfaceCenter[i])) : null;
      const housingDistance = offset ? Math.hypot(...offset) : null;
      const score = role === 'output' && portDistance != null ? portDistance
        : role === 'housing' && housingDistance != null ? housingDistance
          : positional + definitionBonus;
      return { item, score, exactDefinition };
    }).sort((a, b) => a.score - b.score);
    const best = ranked[0];
    if (!best || (!best.exactDefinition && !pattern.outputPortLocal && best.score > 0.06)) return null;
    used.add(best.item.id); return best.item.id;
  }).filter(Boolean);
  const outputOccurrenceIds = matchSide(pattern.outputSideContactSignatures || [], 'output');
  const housingOccurrenceIds = matchSide(pattern.housingSideContactSignatures || [], 'housing');
  const complete = housingOccurrenceIds.length === (pattern.housingSideContactSignatures || []).length && outputOccurrenceIds.length === (pattern.outputSideContactSignatures || []).length;
  return { servoInstanceId, housingOccurrenceIds, outputOccurrenceIds, defaultActuationMode: pattern.defaultActuationMode, complete, verificationStatus: complete ? 'TEMPLATE_VERIFIED' : 'UNRESOLVED', evidence: complete ? ['all taught contact signatures matched'] : ['one or more taught contact signatures did not match'] };
}
