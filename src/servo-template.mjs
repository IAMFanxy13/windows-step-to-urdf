// Stable public entry point for the functional-interface template controller.
export * from './servo-template-controller.mjs';
export {
  INSTANCE_VERIFICATION, TEMPLATE_STATUS, canBatchApplyTemplate,
  confirmOutputPort, confirmTemplateIdentity, createServoFunctionalTemplate,
  inspectOccurrenceTransform, localPortToWorld, normalizeDirection,
  overrideFunctionalInstance as overrideServoInstance,
  restoreFunctionalInstance as restoreServoInstance,
  teachTopologyPattern, worldPortToLocal,
} from './servo-functional-template.mjs';
