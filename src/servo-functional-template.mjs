import { matchTopologyPattern } from './contact-graph.mjs';

const clone = value => structuredClone(value);

export const TEMPLATE_STATUS = Object.freeze({
  PENDING: 'pending', CONFIRMED_ALL: 'confirmed_all', CONFIRMED_PARTIAL: 'confirmed_partial',
  USER_CONFIRMED: 'user_confirmed', TAUGHT: 'taught', MOTION_VERIFIED: 'motion_verified',
});
export const INSTANCE_VERIFICATION = Object.freeze({
  AUTOMATIC_UNVERIFIED: 'AUTOMATIC_UNVERIFIED', TEMPLATE_VERIFIED: 'TEMPLATE_VERIFIED',
  USER_VERIFIED: 'USER_VERIFIED', UNRESOLVED: 'UNRESOLVED', INVALID: 'INVALID',
});

export function normalizeDirection(direction) {
  if (!Array.isArray(direction) || direction.length !== 3 || !direction.every(Number.isFinite)) throw new Error('Axis direction must contain three finite values');
  const length = Math.hypot(...direction);
  if (length <= 1e-12) throw new Error('Axis direction must be non-zero');
  return direction.map(value => Math.abs(value / length) < 1e-15 ? 0 : value / length);
}

export function inspectOccurrenceTransform(transform, tolerance = 1e-6) {
  if (!Array.isArray(transform) || transform.length < 12 || !transform.slice(0, 12).every(Number.isFinite)) {
    return { valid: false, mirrored: false, determinant: NaN, orthogonalityError: Infinity, reason: 'non-finite or missing transform' };
  }
  const r = [[transform[0], transform[1], transform[2]], [transform[4], transform[5], transform[6]], [transform[8], transform[9], transform[10]]];
  const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const errors = [];
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) errors.push(Math.abs(dot(r[i], r[j]) - (i === j ? 1 : 0)));
  const determinant = r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1])
    - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0])
    + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
  const orthogonalityError = Math.max(...errors);
  return { valid: orthogonalityError <= tolerance && Math.abs(Math.abs(determinant) - 1) <= tolerance, mirrored: determinant < 0, determinant, orthogonalityError };
}

export function localPortToWorld(outputPort, transform) {
  const inspection = inspectOccurrenceTransform(transform);
  if (!inspection.valid) throw new Error('Occurrence transform is not a finite orthogonal rigid transform');
  const transformPoint = ([x, y, z]) => [
    transform[0] * x + transform[1] * y + transform[2] * z + transform[3],
    transform[4] * x + transform[5] * y + transform[6] * z + transform[7],
    transform[8] * x + transform[9] * y + transform[10] * z + transform[11],
  ];
  const transformDirection = ([x, y, z]) => normalizeDirection([
    transform[0] * x + transform[1] * y + transform[2] * z,
    transform[4] * x + transform[5] * y + transform[6] * z,
    transform[8] * x + transform[9] * y + transform[10] * z,
  ]);
  return {
    axisLine: { origin: transformPoint(outputPort.axisLine.origin), direction: transformDirection(outputPort.axisLine.direction) },
    interfaceCenter: transformPoint(outputPort.interfaceCenter),
    outputPlane: outputPort.outputPlane ? { origin: transformPoint(outputPort.outputPlane.origin), normal: transformDirection(outputPort.outputPlane.normal) } : null,
    interfaceNormal: transformDirection(outputPort.interfaceNormal || outputPort.axisLine.direction),
    transformInspection: inspection,
  };
}

export function worldPortToLocal(worldPort, transform) {
  const inspection = inspectOccurrenceTransform(transform);
  if (!inspection.valid) throw new Error('Occurrence transform is not a finite orthogonal rigid transform');
  const inversePoint = point => {
    const p = point.map((value, index) => value - transform[[3, 7, 11][index]]);
    return [transform[0] * p[0] + transform[4] * p[1] + transform[8] * p[2], transform[1] * p[0] + transform[5] * p[1] + transform[9] * p[2], transform[2] * p[0] + transform[6] * p[1] + transform[10] * p[2]];
  };
  const inverseDirection = direction => normalizeDirection([
    transform[0] * direction[0] + transform[4] * direction[1] + transform[8] * direction[2],
    transform[1] * direction[0] + transform[5] * direction[1] + transform[9] * direction[2],
    transform[2] * direction[0] + transform[6] * direction[1] + transform[10] * direction[2],
  ]);
  return {
    axisLine: { origin: inversePoint(worldPort.axisLine.origin), direction: inverseDirection(worldPort.axisLine.direction) },
    interfaceCenter: inversePoint(worldPort.interfaceCenter),
    outputPlane: worldPort.outputPlane ? { origin: inversePoint(worldPort.outputPlane.origin), normal: inverseDirection(worldPort.outputPlane.normal) } : null,
    interfaceNormal: inverseDirection(worldPort.interfaceNormal || worldPort.axisLine.direction),
    selectedFaceIds: [...(worldPort.selectedFaceIds || [])], selectedEdgeIds: [...(worldPort.selectedEdgeIds || [])],
  };
}

export function createServoFunctionalTemplate(candidate, index = 0) {
  const legacyAxis = candidate.outputAxisLocal;
  const port = candidate.outputPort || (legacyAxis ? {
    axisLine: clone(legacyAxis), interfaceCenter: [...legacyAxis.origin],
    outputPlane: null, interfaceNormal: [...legacyAxis.direction],
    selectedFaceIds: candidate.outputFaceId ? [candidate.outputFaceId] : [], selectedEdgeIds: candidate.outputEdgeId ? [candidate.outputEdgeId] : [],
  } : null);
  if (!port?.axisLine || !port?.interfaceCenter) throw new Error('Servo candidate has no functional output port');
  const componentDefinitionIds = [...new Set(candidate.componentDefinitionIds || [candidate.definitionId].filter(Boolean))];
  const outputComponentDefinitionId = candidate.outputComponentDefinitionId || candidate.definitionId || null;
  const suppliedRoles = candidate.componentRoles || {};
  const componentRoles = {
    housingDefinitionIds: [...new Set(suppliedRoles.housingDefinitionIds || componentDefinitionIds.filter(id => id !== outputComponentDefinitionId))],
    outputDefinitionIds: [...new Set(suppliedRoles.outputDefinitionIds || [outputComponentDefinitionId].filter(Boolean))],
    ignoredDefinitionIds: [...new Set(suppliedRoles.ignoredDefinitionIds || [])],
  };
  return {
    schema: 'step-servo-urdf/servo-functional-template/v1',
    templateId: `servo-template-${String(index + 1).padStart(3, '0')}`,
    definitionId: candidate.definitionId || candidate.outputComponentDefinitionId || null,
    displayName: candidate.displayName || candidate.definitionId || `servo_${index + 1}`,
    componentDefinitionIds,
    subassemblyDefinitionId: candidate.subassemblyDefinitionId || null,
    outputComponentDefinitionId,
    componentRoles,
    geometryFingerprint: candidate.geometryFingerprint || null,
    instanceIds: [...(candidate.instanceIds || [])],
    instanceGroups: clone(candidate.instanceGroups || (candidate.instanceIds || []).map(id => ({ instanceId: id, componentOccurrenceIds: [id], outputOccurrenceId: id }))),
    excludedInstanceIds: [],
    outputPort: { ...clone(port), axisLine: { origin: [...port.axisLine.origin], direction: normalizeDirection(port.axisLine.direction) }, interfaceCenter: [...port.interfaceCenter] },
    housingPorts: clone(candidate.housingPorts || []),
    defaultActuationMode: candidate.defaultActuationMode || 'direct',
    axisDirectionStatus: candidate.axisDirectionStatus || 'CANONICAL_UNVERIFIED',
    topologyPattern: null,
    status: { identityStatus: 'pending', outputPortStatus: 'pending', topologyPatternStatus: 'pending', motionVerificationStatus: 'pending' },
    confidence: candidate.confidence || 'LOW', confidenceScore: candidate.confidenceScore || 0,
    evidence: clone(candidate.evidence || []), instanceOverrides: {}, source: 'automatic_multi_evidence_candidate', lastModifiedBy: 'automatic_system',
  };
}

export function confirmTemplateIdentity(template, includedInstanceIds = template.instanceIds) {
  const included = new Set(includedInstanceIds);
  if (!included.size) throw new Error('At least one servo instance must be included');
  const next = clone(template);
  next.excludedInstanceIds = next.instanceIds.filter(id => !included.has(id));
  next.status.identityStatus = included.size === next.instanceIds.length ? TEMPLATE_STATUS.CONFIRMED_ALL : TEMPLATE_STATUS.CONFIRMED_PARTIAL;
  next.lastModifiedBy = 'user';
  return next;
}

export function confirmOutputPort(template, outputPort, source = 'user_selected_brep_interface') {
  const next = clone(template);
  next.outputPort = { ...clone(outputPort), axisLine: { origin: [...outputPort.axisLine.origin], direction: normalizeDirection(outputPort.axisLine.direction) }, interfaceCenter: [...outputPort.interfaceCenter] };
  next.status.outputPortStatus = TEMPLATE_STATUS.USER_CONFIRMED;
  next.source = source; next.lastModifiedBy = 'user';
  return next;
}

export function teachTopologyPattern(template, pattern) {
  if (!pattern?.representativeInstanceId || !['direct', 'reaction'].includes(pattern.defaultActuationMode)) throw new Error('Topology pattern requires a representative instance and actuation mode');
  const next = clone(template);
  next.topologyPattern = clone(pattern);
  next.defaultActuationMode = pattern.defaultActuationMode;
  next.status.topologyPatternStatus = TEMPLATE_STATUS.TAUGHT;
  next.lastModifiedBy = 'user';
  return next;
}

export function canBatchApplyTemplate(template) {
  return [TEMPLATE_STATUS.CONFIRMED_ALL, TEMPLATE_STATUS.CONFIRMED_PARTIAL].includes(template?.status?.identityStatus)
    && template?.status?.outputPortStatus === TEMPLATE_STATUS.USER_CONFIRMED;
}

function classifyContactsAtConfirmedOutputPort(instanceId, outputPortCenter, contactGraph) {
  if (!contactGraph?.edges || !Array.isArray(outputPortCenter)) return null;
  const records = contactGraph.edges.flatMap(edge => {
    const interfacePoint = edge.contactCenterMeters || edge.closestPointMidpointMeters;
    if (edge.fastenerSuppressed || edge.interfaceClass === 'CLEARANCE'
      || (edge.a !== instanceId && edge.b !== instanceId) || !Array.isArray(interfacePoint)) return [];
    const neighborId = edge.a === instanceId ? edge.b : edge.a;
    return [{
      neighborId,
      distanceMeters: Math.hypot(...interfacePoint.map((value, index) => value - outputPortCenter[index])),
      contactAreaSquareMeters: edge.contactAreaSquareMeters || 0,
      edgeId: edge.id || null,
      centerMethod: edge.contactCenterMeters ? 'COMMON_SURFACE_CENTER' : 'CLOSEST_POINT_MIDPOINT',
    }];
  }).sort((left, right) => left.distanceMeters - right.distanceMeters || right.contactAreaSquareMeters - left.contactAreaSquareMeters || left.neighborId.localeCompare(right.neighborId));
  if (!records.length) return null;
  const output = records[0];
  const housingCandidates = records.filter(item => item.neighborId !== output.neighborId);
  const housing = housingCandidates.sort((left, right) => right.distanceMeters - left.distanceMeters || right.contactAreaSquareMeters - left.contactAreaSquareMeters)[0] || null;
  return {
    outputOccurrenceId: output.neighborId,
    housingOccurrenceId: housing?.neighborId || null,
    method: records.every(item => item.centerMethod === 'COMMON_SURFACE_CENTER')
      ? 'CONFIRMED_TEMPLATE_PORT_TO_EXACT_BREP_CONTACT_CENTER'
      : 'CONFIRMED_TEMPLATE_PORT_TO_EXACT_BREP_INTERFACE_POINT',
    outputDistanceMeters: output.distanceMeters,
    housingDistanceMeters: housing?.distanceMeters ?? null,
    evidence: [`contact ${output.edgeId || output.neighborId} is closest to the confirmed output-port center`],
  };
}

export function applyFunctionalTemplate(template, assembly, originalCandidates = [], { contactGraph = null } = {}) {
  if (!canBatchApplyTemplate(template)) throw new Error('Servo identity and output port must both be confirmed before batch application');
  const excluded = new Set(template.excludedInstanceIds || []);
  const occurrenceMap = new Map(assembly.occurrences.map(item => [item.id, item]));
  const groups = template.instanceGroups.filter(item => !excluded.has(item.instanceId));
  return groups.map((group, index) => {
    const occurrence = occurrenceMap.get(group.outputOccurrenceId);
    if (!occurrence || occurrence.kind !== 'part') return { id: `${template.templateId}-candidate-${index + 1}`, actuatorOccurrenceId: group.outputOccurrenceId, servoInstanceId: group.instanceId, templateId: template.templateId, verificationStatus: INSTANCE_VERIFICATION.INVALID, reviewRequired: true, evidence: ['output component occurrence is missing'] };
    const transform = occurrence.sourceTransformMeters || occurrence.worldTransformMeters;
    const inspection = inspectOccurrenceTransform(transform);
    const original = originalCandidates.find(item => item.actuatorOccurrenceId === occurrence.id) || {};
    const override = template.instanceOverrides?.[group.instanceId] || {};
    const roleOccurrenceIds = group.roleOccurrenceIds || {
      housing: group.componentOccurrenceIds.filter(id => template.componentRoles?.housingDefinitionIds?.includes(occurrenceMap.get(id)?.definitionId)),
      output: group.componentOccurrenceIds.filter(id => template.componentRoles?.outputDefinitionIds?.includes(occurrenceMap.get(id)?.definitionId)),
      ignored: group.componentOccurrenceIds.filter(id => template.componentRoles?.ignoredDefinitionIds?.includes(occurrenceMap.get(id)?.definitionId)),
    };
    if (!inspection.valid) return { id: `${template.templateId}-candidate-${index + 1}`, actuatorOccurrenceId: occurrence.id, templateId: template.templateId, verificationStatus: INSTANCE_VERIFICATION.INVALID, reviewRequired: true, evidence: ['invalid occurrence transform'] };
    const world = localPortToWorld(template.outputPort, transform);
    const direction = override.axisDirectionReversed ? world.axisLine.direction.map(value => value === 0 ? 0 : -value) : world.axisLine.direction;
    const portContactRoles = group.instanceId === template.topologyPattern?.representativeInstanceId
      ? null
      : classifyContactsAtConfirmedOutputPort(occurrence.id, world.interfaceCenter, contactGraph);
    const baselineHousingIds = portContactRoles?.housingOccurrenceId ? [portContactRoles.housingOccurrenceId] : clone(original.housingSideOccurrenceIds || []);
    const baselineOutputIds = portContactRoles?.outputOccurrenceId ? [portContactRoles.outputOccurrenceId] : clone(original.outputSideOccurrenceIds || []);
    const patternMatch = template.topologyPattern && contactGraph ? matchTopologyPattern(template.topologyPattern, occurrence.id, contactGraph, assembly) : null;
    const housing = patternMatch?.housingOccurrenceIds?.[0];
    const output = patternMatch?.outputOccurrenceIds?.[0];
    const exactRoleEvidence = Boolean(portContactRoles)
      || String(original.outputPortContactClassification?.method || '').startsWith('EXACT_BREP_');
    const patternAgreesWithExactRoles = !exactRoleEvidence
      || baselineHousingIds.includes(housing) && baselineOutputIds.includes(output);
    const useTaughtTopology = patternMatch?.complete
      && (group.instanceId === template.topologyPattern?.representativeInstanceId || patternAgreesWithExactRoles);
    const taughtTopology = useTaughtTopology ? [{
      parentOccurrenceId: template.defaultActuationMode === 'reaction' ? output : housing,
      childOccurrenceId: template.defaultActuationMode === 'reaction' ? housing : output,
      movingSideOccurrenceId: template.defaultActuationMode === 'reaction' ? housing : output,
    }] : null;
    const userTopologyRequested = override.topologyConfirmedByUser === true;
    const userTopologyValid = userTopologyRequested
      && occurrenceMap.has(override.parentOccurrenceId)
      && occurrenceMap.has(override.childOccurrenceId)
      && override.parentOccurrenceId !== override.childOccurrenceId;
    const userTopology = userTopologyValid ? [{
      parentOccurrenceId: override.parentOccurrenceId,
      childOccurrenceId: override.childOccurrenceId,
      movingSideOccurrenceId: override.movingSideOccurrenceId || override.childOccurrenceId,
      actuationMode: override.actuationMode || null,
      userConfirmed: true,
    }] : null;
    const fallbackTopology = baselineHousingIds[0] && baselineOutputIds[0]
      ? [{ parentOccurrenceId: baselineHousingIds[0], childOccurrenceId: baselineOutputIds[0], movingSideOccurrenceId: baselineOutputIds[0] }]
      : clone(original.topologyAlternatives || []);
    const topologyResolved = Boolean(userTopology?.length || taughtTopology?.length || fallbackTopology.length);
    const exactGeometryMatch = occurrence.definitionId === template.outputComponentDefinitionId || template.componentDefinitionIds.includes(occurrence.definitionId);
    const verificationStatus = userTopologyRequested && !userTopologyValid ? INSTANCE_VERIFICATION.INVALID
      : userTopology?.length ? INSTANCE_VERIFICATION.USER_VERIFIED
        : !topologyResolved ? INSTANCE_VERIFICATION.UNRESOLVED
      : taughtTopology?.length && exactGeometryMatch ? INSTANCE_VERIFICATION.TEMPLATE_VERIFIED : INSTANCE_VERIFICATION.AUTOMATIC_UNVERIFIED;
    return {
      ...clone(original), id: original.id || `${template.templateId}-candidate-${index + 1}`,
      topologyAlternatives: userTopology || taughtTopology || fallbackTopology,
      housingSideOccurrenceIds: override.housingSideOccurrenceIds || (taughtTopology ? patternMatch?.housingOccurrenceIds || [] : baselineHousingIds),
      outputSideOccurrenceIds: override.outputSideOccurrenceIds || (taughtTopology ? patternMatch?.outputOccurrenceIds || [] : baselineOutputIds),
      outputPortContactClassification: portContactRoles || clone(original.outputPortContactClassification || null),
      definitionId: occurrence.definitionId, actuatorOccurrenceId: occurrence.id,
      servoInstanceId: group.instanceId, componentOccurrenceIds: [...group.componentOccurrenceIds],
      componentRoleOccurrenceIds: clone(roleOccurrenceIds),
      originMeters: override.originMeters || world.interfaceCenter,
      axisLineOriginMeters: world.axisLine.origin,
      axis: override.axis || direction,
      axisDirectionStatus: override.axisDirectionConfirmedByUser ? 'USER_CONFIRMED' : template.axisDirectionStatus || 'CANONICAL_UNVERIFIED',
      outputPlane: world.outputPlane, interfaceNormal: world.interfaceNormal,
      axisFaceId: override.outputFaceId ?? template.outputPort.selectedFaceIds?.[0] ?? null,
      axisEdgeId: override.outputEdgeId ?? template.outputPort.selectedEdgeIds?.[0] ?? null,
      actuationMode: override.actuationMode || template.defaultActuationMode,
      templateId: template.templateId, usesTemplate: true, overrides: clone(override), mirroredInstance: inspection.mirrored,
      mirrorHandling: inspection.mirrored ? 'BAKE_REFLECTION_INTO_INSTANCE_MESH_AND_USE_RIGHT_HANDED_FRAME' : 'RIGHT_HANDED_INSTANCE',
      verificationStatus, reviewRequired: [INSTANCE_VERIFICATION.UNRESOLVED, INSTANCE_VERIFICATION.INVALID].includes(verificationStatus),
      confidence: original.confidence || template.confidence,
      evidence: [...(original.evidence || []), 'joint origin mapped from output interface center; axis direction mapped from local axis line', ...(portContactRoles?.evidence || []), ...(patternMatch?.evidence || ['no taught topology contact match']), ...(userTopology ? ['instance topology and actuation mode were explicitly confirmed by the user'] : []), ...(userTopologyRequested && !userTopologyValid ? ['user topology override references missing or identical parent/child occurrences'] : []), ...(patternMatch?.complete && !useTaughtTopology ? ['taught pattern contradicted this instance exact output-port contact classification; retained automatic instance topology for review'] : []), `instance verification: ${verificationStatus}`],
      source: 'user_confirmed_servo_functional_template', lastModifiedBy: Object.keys(override).length ? 'user' : 'automatic_system',
    };
  });
}

export function overrideFunctionalInstance(template, instanceId, patch) {
  if (!template.instanceIds.includes(instanceId)) throw new Error(`Instance ${instanceId} does not belong to template`);
  const next = clone(template); next.instanceOverrides[instanceId] = { ...(next.instanceOverrides[instanceId] || {}), ...clone(patch) }; next.lastModifiedBy = 'user'; return next;
}

export function restoreFunctionalInstance(template, instanceId) {
  const next = clone(template); delete next.instanceOverrides[instanceId]; next.lastModifiedBy = 'user'; return next;
}
