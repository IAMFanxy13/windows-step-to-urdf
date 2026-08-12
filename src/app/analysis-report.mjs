import { buildAnomalyQueue } from './anomaly-queue.mjs';

export function buildAnalysisValidationReport({ assembly, candidates = {}, model, validation, softwareVersion = '0.3.0-product-upgrade' }) {
  const queue = buildAnomalyQueue({ model, validationIssues: validation?.issues || [] });
  const edges = assembly?.contactGraph?.edges || [];
  const validationPassed = validation?.ok ?? validation?.canExport ?? false;
  return {
    schema: 'step-servo-urdf/analysis-validation-report/v1', generatedAt: new Date().toISOString(), softwareVersion,
    step: { schema: assembly?.source?.stepSchema || null, unit: assembly?.source?.unitName || assembly?.units?.length || null, definitions: assembly?.definitions?.length || 0, occurrences: assembly?.occurrences?.length || 0, sourceSha256: assembly?.source?.sha256 || null },
    servoCandidates: structuredClone(candidates.servoTemplateCandidates || []), templateResults: structuredClone(model?.servoInstances || []),
    contactGraph: {
      nodes: assembly?.contactGraph?.nodes?.length || 0,
      edges: edges.length,
      exactMinimumDistanceEdges: edges.filter(edge => Number.isFinite(edge.exactMinimumDistanceMeters)).length,
      exactContactAreaEdges: edges.filter(edge => Number.isFinite(edge.contactAreaSquareMeters) && edge.contactAreaMethod === 'EXACT_BREP_COMMON_SURFACE').length,
      estimatedContactAreaEdges: edges.filter(edge => Number.isFinite(edge.contactAreaEstimateM2)).length,
      interfaceClasses: Object.fromEntries([...new Set(edges.map(edge => edge.interfaceClass).filter(Boolean))].map(value => [value, edges.filter(edge => edge.interfaceClass === value).length])),
      contactAreaNature: 'exact B-Rep common-surface areas and AABB overlap estimates are stored as separate evidence',
    },
    automaticPassed: queue.passed, userModified: (model?.joints || []).filter(value => value.lastModifiedBy === 'user'), unresolved: [...queue.blockers, ...queue.warnings],
    joints: (model?.joints || []).map(joint => ({ name: joint.name, originMeters: joint.originMeters, axis: joint.axis, parentLinkId: joint.parentLinkId, childLinkId: joint.childLinkId, limits: joint.limits, verificationStatus: joint.verificationStatus, provenance: joint.provenance || null })),
    exportGate: { blocked: !validationPassed || queue.blockers.length > 0, blockers: queue.blockers, warnings: queue.warnings },
    limitations: ['STEP may not preserve source CAD mate semantics.', 'contactAreaEstimateM2 remains an AABB overlap estimate; only contactAreaSquareMeters with EXACT_BREP_COMMON_SURFACE is exact.', 'Mirrored instances require a baked right-handed mesh before formal export.', 'Automatic recognition is evidence-based and is not claimed to be error-free.'],
  };
}
