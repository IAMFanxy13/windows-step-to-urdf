const divide = (numerator, denominator, emptyValue = 0) => denominator ? numerator / denominator : emptyValue;

export function precisionRecall(predictedIds, goldIds) {
  const predicted = new Set(predictedIds || []), gold = new Set(goldIds || []);
  const truePositive = [...predicted].filter(id => gold.has(id)).length;
  const falsePositive = predicted.size - truePositive;
  const falseNegative = gold.size - truePositive;
  const precision = divide(truePositive, truePositive + falsePositive, gold.size ? 0 : 1);
  const recall = divide(truePositive, truePositive + falseNegative, 1);
  const f1 = divide(2 * precision * recall, precision + recall, 0);
  return { truePositive, falsePositive, falseNegative, precision, recall, f1 };
}

const dot = (left, right) => left.reduce((sum, value, index) => sum + value * right[index], 0);
const cross = (left, right) => [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]];
const length = value => Math.hypot(...value);
const normalize = value => { const size = length(value); if (!(size > 1e-12)) throw new Error('axis direction must be non-zero'); return value.map(item => item / size); };

export function axisLineError(predicted, gold) {
  const predictedDirection = normalize(predicted.direction), goldDirection = normalize(gold.direction);
  const cosine = Math.max(-1, Math.min(1, Math.abs(dot(predictedDirection, goldDirection))));
  const angleDegrees = Math.acos(cosine) * 180 / Math.PI;
  const delta = predicted.origin.map((value, index) => value - gold.origin[index]);
  const perpendicular = cross(predictedDirection, goldDirection);
  const perpendicularLength = length(perpendicular);
  const lineDistanceMeters = perpendicularLength <= 1e-10
    ? length(cross(delta, goldDirection))
    : Math.abs(dot(delta, perpendicular)) / perpendicularLength;
  return { angleDegrees: Math.abs(angleDegrees) < 1e-12 ? 0 : angleDegrees, lineDistanceMeters: Math.abs(lineDistanceMeters) < 1e-15 ? 0 : lineDistanceMeters };
}

function groupPairs(groups) {
  const result = [];
  for (const group of groups || []) {
    const ids = [...new Set(group)].sort();
    for (let left = 0; left < ids.length; left += 1) for (let right = left + 1; right < ids.length; right += 1) result.push(`${ids[left]}|${ids[right]}`);
  }
  return result;
}

export function rigidGroupingMetrics(predictedGroups, goldGroups) {
  return { pairwise: precisionRecall(groupPairs(predictedGroups), groupPairs(goldGroups)) };
}

export function topologyMetrics(predictedJoints, goldJoints) {
  const predicted = new Map((predictedJoints || []).map(item => [item.actuatorId, item]));
  const comparable = (goldJoints || []).filter(item => predicted.has(item.actuatorId));
  let endpointCorrect = 0, orientedCorrect = 0;
  for (const gold of comparable) {
    const actual = predicted.get(gold.actuatorId);
    const actualEndpoints = [actual.parent, actual.child].sort().join('|');
    const goldEndpoints = [gold.parent, gold.child].sort().join('|');
    if (actualEndpoints === goldEndpoints) endpointCorrect += 1;
    if (actual.parent === gold.parent && actual.child === gold.child) orientedCorrect += 1;
  }
  return {
    compared: comparable.length,
    endpointAccuracy: divide(endpointCorrect, comparable.length, 1),
    orientedParentChildAccuracy: divide(orientedCorrect, comparable.length, 1),
  };
}
