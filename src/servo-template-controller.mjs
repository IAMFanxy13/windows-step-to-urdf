import {
  applyFunctionalTemplate, confirmOutputPort, confirmTemplateIdentity, createServoFunctionalTemplate,
  localPortToWorld, worldPortToLocal,
} from './servo-functional-template.mjs';

const portFromAxis = (localAxis, selection = {}) => ({
  axisLine: { origin: [...localAxis.origin], direction: [...localAxis.direction] },
  interfaceCenter: [...(selection.interfaceCenter || localAxis.origin)],
  outputPlane: selection.outputPlane || null,
  interfaceNormal: [...(selection.interfaceNormal || localAxis.direction)],
  selectedFaceIds: selection.faceId ? [selection.faceId] : [], selectedEdgeIds: selection.edgeId ? [selection.edgeId] : [],
});

export const createServoTemplate = createServoFunctionalTemplate;
export const setTemplateInstances = confirmTemplateIdentity;
export function chooseTemplateAxis(template, localAxis, selection = {}) {
  return confirmOutputPort(template, portFromAxis(localAxis, selection), selection.source);
}
export const applyServoTemplate = applyFunctionalTemplate;

export function localAxisToWorld(localAxis, transform) {
  const world = localPortToWorld(portFromAxis(localAxis), transform);
  return { origin: world.axisLine.origin, direction: world.axisLine.direction };
}
export function worldAxisToLocal(worldAxis, transform) {
  const local = worldPortToLocal({ axisLine: worldAxis, interfaceCenter: worldAxis.origin, interfaceNormal: worldAxis.direction }, transform);
  return { origin: local.axisLine.origin, direction: local.axisLine.direction };
}

export function templateUiState(template) {
  return {
    identityConfirmed: ['confirmed_all', 'confirmed_partial'].includes(template.status.identityStatus),
    outputPortConfirmed: template.status.outputPortStatus === 'user_confirmed',
    canBatchApply: ['confirmed_all', 'confirmed_partial'].includes(template.status.identityStatus) && template.status.outputPortStatus === 'user_confirmed',
  };
}
