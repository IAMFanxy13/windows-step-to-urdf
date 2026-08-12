export const RIGID_DECISION = Object.freeze({
  FIXED_CONFIRMED: 'FIXED_CONFIRMED',
  FIXED_LIKELY: 'FIXED_LIKELY',
  ROTATIONAL_INTERFACE: 'ROTATIONAL_INTERFACE',
  INCIDENTAL_CONTACT: 'INCIDENTAL_CONTACT',
  UNKNOWN: 'UNKNOWN',
});

export function classifyContactEdge(edge, {
  protectedRotational = false,
  minimumFixedAreaSquareMeters = 1e-8,
} = {}) {
  const decision = edge?.rigidDecision || RIGID_DECISION.UNKNOWN;
  const area = Number(edge?.contactAreaSquareMeters) || 0;
  const exactPlanarEvidence = edge?.contactAreaMethod === 'EXACT_BREP_COMMON_SURFACE'
    && edge?.faceNormalRelation === 'OPPOSED'
    && !edge?.coaxialRelation
    && area >= minimumFixedAreaSquareMeters;
  if (protectedRotational || decision === RIGID_DECISION.ROTATIONAL_INTERFACE || edge?.coaxialRelation) {
    return { classification: RIGID_DECISION.ROTATIONAL_INTERFACE, autoMerge: false, confidence: 'HIGH', evidence: ['protected or analytic rotational interface'] };
  }
  if (edge?.fastenerSuppressed) {
    return { classification: 'FASTENER_REVIEW', autoMerge: false, confidence: 'MEDIUM', evidence: ['fastener edge retained as evidence but not used as a direct rigid union'] };
  }
  if (decision === RIGID_DECISION.FIXED_CONFIRMED) {
    return { classification: decision, autoMerge: true, confidence: 'HIGH', evidence: ['fixed interface explicitly confirmed'] };
  }
  if (decision === RIGID_DECISION.FIXED_LIKELY && exactPlanarEvidence) {
    return { classification: decision, autoMerge: true, confidence: 'HIGH', evidence: [`opposed exact planar common area ${area} m^2`] };
  }
  return {
    classification: decision === RIGID_DECISION.FIXED_LIKELY ? RIGID_DECISION.UNKNOWN : decision,
    autoMerge: false,
    confidence: 'LOW',
    evidence: ['distance/contact alone does not prove a rigid connection'],
  };
}
