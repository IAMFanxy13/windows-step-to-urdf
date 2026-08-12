export const RESULT_TYPES = Object.freeze(['EXACT_GEOMETRY', 'GEOMETRY_ESTIMATE', 'HEURISTIC', 'TEMPLATE_MATCH', 'USER_CONFIRMED']);

export function createProvenance({ resultType, evidence = [], algorithmVersion = 'unknown', thresholdValues = {}, unit = null, source = 'automatic_system', timestamp = new Date().toISOString(), userOverride = false, previousValue = null }) {
  if (!RESULT_TYPES.includes(resultType)) throw new Error(`Unknown provenance resultType ${resultType}`);
  return { resultType, evidence: [...evidence], algorithmVersion, thresholdValues: structuredClone(thresholdValues), unit, source, timestamp, userOverride: Boolean(userOverride), previousValue: structuredClone(previousValue) };
}

export function evidenceLabel(provenance) {
  if (provenance.resultType === 'USER_CONFIRMED') return '人工确认';
  if (provenance.resultType === 'EXACT_GEOMETRY' && provenance.evidence.length >= 1) return '高证据';
  if (['GEOMETRY_ESTIMATE', 'TEMPLATE_MATCH'].includes(provenance.resultType) && provenance.evidence.length >= 1) return '中等证据';
  return '需要检查';
}

export function simpleSourceLabel(provenance = {}) {
  if (provenance.required) return '必须填写';
  if (provenance.userOverride || provenance.resultType === 'USER_CONFIRMED') return '用户修改';
  if (provenance.resultType === 'TEMPLATE_MATCH') return '来自已验证模板';
  if (provenance.resultType === 'EXACT_GEOMETRY') return '自动识别';
  return '推荐设置';
}
