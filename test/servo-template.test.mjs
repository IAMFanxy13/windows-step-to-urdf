import { describe, expect, it } from 'vitest';
import {
  applyServoTemplate, chooseTemplateAxis, createServoTemplate,
  inspectOccurrenceTransform, localAxisToWorld, overrideServoInstance, restoreServoInstance, setTemplateInstances, teachTopologyPattern, worldAxisToLocal,
} from '../src/servo-template.mjs';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const rotatedTranslated = [0, -1, 0, 2, 1, 0, 0, 3, 0, 0, 1, 4, 0, 0, 0, 1];
const family = {
  definitionId: 'servo-def', displayName: 'servo', geometryFingerprint: 'sha256:test',
  instanceIds: ['servo-1', 'servo-2'], outputAxisLocal: { origin: [1, 0, 0], direction: [1, 0, 0] },
  outputFaceId: 'servo-def/face/9', confidence: 'MEDIUM',
};
const assembly = { occurrences: [
  { id: 'servo-1', kind: 'part', definitionId: 'servo-def', sourceTransformMeters: identity },
  { id: 'servo-2', kind: 'part', definitionId: 'servo-def', sourceTransformMeters: rotatedTranslated },
] };

describe('servo template local axes', () => {
  it('forbids batch apply when only the output axis was confirmed', () => {
    const template = chooseTemplateAxis(createServoTemplate(family), family.outputAxisLocal, { faceId: family.outputFaceId });
    expect(template.status.identityStatus).toBe('pending');
    expect(template.status.outputPortStatus).toBe('user_confirmed');
    expect(() => applyServoTemplate(template, assembly)).toThrow(/identity and output port/i);
  });

  it('maps one local output axis into every instance pose', () => {
    const template = chooseTemplateAxis(setTemplateInstances(createServoTemplate(family), family.instanceIds), family.outputAxisLocal, { faceId: family.outputFaceId });
    const candidates = applyServoTemplate(template, assembly);
    expect(candidates[0]).toMatchObject({ originMeters: [1, 0, 0], axis: [1, 0, 0] });
    expect(candidates[1]).toMatchObject({ originMeters: [2, 4, 4], axis: [0, 1, 0] });
    expect(candidates.every(item => item.axisDirectionStatus === 'CANONICAL_UNVERIFIED')).toBe(true);
    expect(candidates.every(item => item.templateId === template.templateId)).toBe(true);
    expect(candidates.every(item => item.verificationStatus === 'UNRESOLVED')).toBe(true);
  });

  it('keeps joint origin at the interface center rather than cylinder surface origin', () => {
    const candidate = { ...family, outputPort: { axisLine: { origin: [0, 0, -4], direction: [0, 0, 1] }, interfaceCenter: [0, 0, 2], outputPlane: { origin: [0, 0, 2], normal: [0, 0, 1] }, interfaceNormal: [0, 0, 1], selectedFaceIds: ['f'], selectedEdgeIds: ['e'] } };
    let template = createServoTemplate(candidate);
    template = setTemplateInstances(template, template.instanceIds);
    template = chooseTemplateAxis(template, template.outputPort.axisLine, { interfaceCenter: template.outputPort.interfaceCenter, edgeId: 'e' });
    template = teachTopologyPattern(template, { representativeInstanceId: 'servo-1', defaultActuationMode: 'direct', housingSideContactSignatures: [{ definitionId: 'parent-def' }], outputSideContactSignatures: [{ definitionId: 'child-def' }] });
    const portAssembly = { occurrences: [...assembly.occurrences, { id: 'p', kind: 'part', definitionId: 'parent-def', sourceTransformMeters: identity }, { id: 'c', kind: 'part', definitionId: 'child-def', sourceTransformMeters: identity }] };
    const contactGraph = { edges: [{ a: 'servo-1', b: 'p', fastenerSuppressed: false }, { a: 'servo-1', b: 'c', fastenerSuppressed: false }] };
    const candidates = applyServoTemplate(template, portAssembly, [], { contactGraph });
    expect(candidates[0].axisLineOriginMeters).toEqual([0, 0, -4]);
    expect(candidates[0].originMeters).toEqual([0, 0, 2]);
    expect(candidates[0].verificationStatus).toBe('TEMPLATE_VERIFIED');
    expect(candidates[0].reviewRequired).toBe(false);
  });

  it('uses the confirmed local output port to correct instance contact roles before template verification', () => {
    let template = chooseTemplateAxis(setTemplateInstances(createServoTemplate(family), family.instanceIds), family.outputAxisLocal);
    template = teachTopologyPattern(template, {
      representativeInstanceId: 'servo-1', defaultActuationMode: 'direct',
      housingSideContactSignatures: [{ occurrenceId: 'housing-1', definitionId: 'arm-def', localOffsetMeters: [0.04, 0, 0] }],
      outputSideContactSignatures: [{ occurrenceId: 'output-1', definitionId: 'base-def', localOffsetMeters: [-0.04, 0, 0] }],
    });
    const topologyAssembly = { occurrences: [
      ...assembly.occurrences,
      { id: 'housing-1', kind: 'part', definitionId: 'arm-def', sourceTransformMeters: [1, 0, 0, 0.04, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      { id: 'output-1', kind: 'part', definitionId: 'base-def', sourceTransformMeters: [1, 0, 0, -0.04, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      { id: 'housing-2', kind: 'part', definitionId: 'arm-def', sourceTransformMeters: [1, 0, 0, 2, 0, 1, 0, 3.05, 0, 0, 1, 4, 0, 0, 0, 1] },
      { id: 'output-2', kind: 'part', definitionId: 'arm-def', sourceTransformMeters: [1, 0, 0, 2, 0, 1, 0, 2.95, 0, 0, 1, 4, 0, 0, 0, 1] },
      { id: 'clearance-2', kind: 'part', definitionId: 'noise-def', sourceTransformMeters: identity },
    ] };
    const originals = [
      { actuatorOccurrenceId: 'servo-1', topologyAlternatives: [{ parentOccurrenceId: 'housing-1', childOccurrenceId: 'output-1' }] },
      {
        actuatorOccurrenceId: 'servo-2',
        topologyAlternatives: [{ parentOccurrenceId: 'output-2', childOccurrenceId: 'housing-2' }],
        housingSideOccurrenceIds: ['output-2'], outputSideOccurrenceIds: ['housing-2'],
        outputPortContactClassification: { method: 'EXACT_BREP_CONTACT_CENTER', confidence: 'HIGH' },
      },
    ];
    const contactGraph = { edges: [
      { a: 'servo-2', b: 'housing-2', contactCenterMeters: [2, 3, 4], contactAreaSquareMeters: 0.001, fastenerSuppressed: false },
      { a: 'servo-2', b: 'output-2', contactCenterMeters: [2, 4, 4], contactAreaSquareMeters: 0.001, fastenerSuppressed: false },
      { a: 'servo-2', b: 'clearance-2', closestPointMidpointMeters: [9, 9, 9], interfaceClass: 'CLEARANCE', fastenerSuppressed: false },
    ] };
    const candidates = applyServoTemplate(template, topologyAssembly, originals, { contactGraph });
    expect(candidates.map(item => item.verificationStatus)).toEqual(['TEMPLATE_VERIFIED', 'TEMPLATE_VERIFIED']);
    expect(candidates[1]).toMatchObject({ housingSideOccurrenceIds: ['housing-2'], outputSideOccurrenceIds: ['output-2'] });
  });

  it('detects mirrored and invalid occurrence transforms', () => {
    expect(inspectOccurrenceTransform([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]).mirrored).toBe(true);
    expect(inspectOccurrenceTransform([2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]).valid).toBe(false);
  });

  it('supports a servo made from multiple parts or a subassembly instance', () => {
    const composite = createServoTemplate({
      displayName: 'composite servo', componentDefinitionIds: ['housing-def', 'shaft-def'], subassemblyDefinitionId: 'servo-subassembly', outputComponentDefinitionId: 'shaft-def',
      componentRoles: { housingDefinitionIds: ['housing-def'], outputDefinitionIds: ['shaft-def'], ignoredDefinitionIds: [] },
      geometryFingerprint: 'set:1', instanceIds: ['servo-assembly-1'], instanceGroups: [{ instanceId: 'servo-assembly-1', componentOccurrenceIds: ['housing-1', 'shaft-1'], outputOccurrenceId: 'shaft-1' }],
      outputPort: { axisLine: { origin: [0, 0, 0], direction: [0, 0, 1] }, interfaceCenter: [0, 0, 0.02], interfaceNormal: [0, 0, 1], selectedFaceIds: [], selectedEdgeIds: [] },
    });
    const confirmed = chooseTemplateAxis(setTemplateInstances(composite, ['servo-assembly-1']), composite.outputPort.axisLine, { interfaceCenter: composite.outputPort.interfaceCenter });
    const compositeAssembly = { occurrences: [
      { id: 'housing-1', kind: 'part', definitionId: 'housing-def', sourceTransformMeters: identity },
      { id: 'shaft-1', kind: 'part', definitionId: 'shaft-def', sourceTransformMeters: identity },
    ] };
    const result = applyServoTemplate(confirmed, compositeAssembly, [{ actuatorOccurrenceId: 'shaft-1', topologyAlternatives: [{ parentOccurrenceId: 'p', childOccurrenceId: 'c' }] }]);
    expect(result[0]).toMatchObject({
      servoInstanceId: 'servo-assembly-1', actuatorOccurrenceId: 'shaft-1',
      componentOccurrenceIds: ['housing-1', 'shaft-1'],
      componentRoleOccurrenceIds: { housing: ['housing-1'], output: ['shaft-1'], ignored: [] },
      verificationStatus: 'AUTOMATIC_UNVERIFIED',
    });
  });

  it('round trips a world selection back into part-local coordinates', () => {
    const world = localAxisToWorld(family.outputAxisLocal, rotatedTranslated);
    expect(worldAxisToLocal(world, rotatedTranslated).origin).toEqual([1, 0, 0]);
    expect(worldAxisToLocal(world, rotatedTranslated).direction).toEqual([1, 0, 0]);
  });

  it('supports partial families and one-instance reversal without changing the template', () => {
    let template = chooseTemplateAxis(setTemplateInstances(createServoTemplate(family), family.instanceIds), family.outputAxisLocal);
    template = overrideServoInstance(template, 'servo-2', { axisDirectionReversed: true });
    expect(applyServoTemplate(template, assembly)[1].axis).toEqual([0, -1, 0]);
    template = restoreServoInstance(template, 'servo-2');
    template = setTemplateInstances(template, ['servo-1']);
    expect(applyServoTemplate(template, assembly).map(item => item.actuatorOccurrenceId)).toEqual(['servo-1']);
  });

  it('supports a user-verified topology exception for one reaction-driven instance', () => {
    let template = chooseTemplateAxis(setTemplateInstances(createServoTemplate(family), family.instanceIds), family.outputAxisLocal);
    template = overrideServoInstance(template, 'servo-2', {
      parentOccurrenceId: 'output-2', childOccurrenceId: 'servo-2',
      movingSideOccurrenceId: 'servo-2', actuationMode: 'reaction',
      topologyConfirmedByUser: true,
    });
    const exceptionAssembly = { occurrences: [
      ...assembly.occurrences,
      { id: 'output-2', kind: 'part', definitionId: 'output-def', sourceTransformMeters: identity },
    ] };

    const candidates = applyServoTemplate(template, exceptionAssembly);
    const exception = candidates.find(item => item.servoInstanceId === 'servo-2');

    expect(exception.topologyAlternatives[0]).toMatchObject({
      parentOccurrenceId: 'output-2', childOccurrenceId: 'servo-2',
      movingSideOccurrenceId: 'servo-2', actuationMode: 'reaction', userConfirmed: true,
    });
    expect(exception).toMatchObject({ verificationStatus: 'USER_VERIFIED', reviewRequired: false, lastModifiedBy: 'user' });
  });
});
