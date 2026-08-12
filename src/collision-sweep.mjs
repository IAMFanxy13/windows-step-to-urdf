import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

function boundsTreeFor(geometry) {
  if (!geometry.boundsTree) {
    geometry.boundsTree = new MeshBVH(geometry);
  }
  return geometry.boundsTree;
}

export function geometriesIntersect(
  geometryA,
  matrixWorldA,
  geometryB,
  matrixWorldB,
) {
  const bvhA = boundsTreeFor(geometryA);
  boundsTreeFor(geometryB);
  const geometryBToA = new THREE.Matrix4()
    .copy(matrixWorldA)
    .invert()
    .multiply(matrixWorldB);
  return bvhA.intersectsGeometry(geometryB, geometryBToA);
}

export function collisionPairKey(linkA, linkB) {
  return [linkA, linkB].sort().join('|');
}

export function findNewCollisionPairs(currentPairs, baselinePairs) {
  return [...currentPairs]
    .filter(pair => !baselinePairs.has(pair))
    .sort();
}

export function deriveSymmetricSafePreviewLimit(samples, requestedLimit = 20) {
  const collisions = samples
    .filter(sample => sample.newPairs?.length)
    .map(sample => Math.abs(Number(sample.degrees)))
    .filter(Number.isFinite);
  if (!collisions.length) return requestedLimit;
  const firstCollision = Math.min(...collisions);
  const clearMagnitudes = samples
    .filter(sample => !sample.newPairs?.length)
    .map(sample => Math.abs(Number(sample.degrees)))
    .filter(value => Number.isFinite(value) && value < firstCollision && value <= requestedLimit);
  return clearMagnitudes.length ? Math.max(...clearMagnitudes) : 0;
}

export function findCollisionPairs(meshes, excludedPairs = new Set()) {
  const pairs = new Set();
  for (let a = 0; a < meshes.length; a += 1) {
    for (let b = a + 1; b < meshes.length; b += 1) {
      const meshA = meshes[a];
      const meshB = meshes[b];
      const key = collisionPairKey(meshA.name, meshB.name);
      if (excludedPairs.has(key)) continue;
      if (
        geometriesIntersect(
          meshA.geometry,
          meshA.matrixWorld,
          meshB.geometry,
          meshB.matrixWorld,
        )
      ) {
        pairs.add(key);
      }
    }
  }
  return pairs;
}
