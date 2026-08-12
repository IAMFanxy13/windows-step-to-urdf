export function collisionEvidenceForAlternative(collisionEvidence, candidateId, alternativeIndex) {
  const source = collisionEvidence?.[candidateId]?.[alternativeIndex]
    || collisionEvidence?.[`${candidateId}:${alternativeIndex}`]
    || {};
  const newCollisionCount = Math.max(0, Number(source.newCollisionCount) || 0);
  return {
    status: 'ADVISORY_ONLY',
    newCollisionCount,
    penalty: Math.min(4, newCollisionCount * 0.25),
    evidence: newCollisionCount
      ? [`${newCollisionCount} new collision pairs contribute a bounded ranking penalty`]
      : ['no new collision pair was supplied for this alternative'],
  };
}
