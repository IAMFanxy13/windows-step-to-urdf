import { validateRobotModel } from './robot-model.mjs';

const escapeXml = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const number = value => String(Math.abs(value) < 1e-12 ? 0 : Number(value.toFixed(12)));
const tuple = values => values.map(number).join(' ');

export function deriveLinkFrames(model) {
  const incoming = new Set(model.joints.map(joint => joint.childLinkId));
  const roots = model.rigidGroups.filter(group => !incoming.has(group.id)).map(group => group.id);
  const frames = new Map(roots.map(rootId => [rootId, [0, 0, 0, 0, 0, 0]]));
  if (!frames.size && model.rootLinkId) frames.set(model.rootLinkId, [0, 0, 0, 0, 0, 0]);
  const outgoing = new Map();
  for (const joint of model.joints) {
    if (!outgoing.has(joint.parentLinkId)) outgoing.set(joint.parentLinkId, []);
    outgoing.get(joint.parentLinkId).push(joint);
  }
  const visit = groupId => {
    for (const joint of outgoing.get(groupId) || []) {
      frames.set(joint.childLinkId, [...joint.originMeters, 0, 0, 0]);
      visit(joint.childLinkId);
    }
  };
  for (const rootId of frames.keys()) visit(rootId);
  return frames;
}

export function visualMatrixInLink(sourceMatrix, linkFrame) {
  const result = [...sourceMatrix];
  result[3] -= linkFrame[0];
  result[7] -= linkFrame[1];
  result[11] -= linkFrame[2];
  return result;
}

function matrixRpy(matrix) {
  const pitch = Math.asin(Math.max(-1, Math.min(1, -matrix[8])));
  const cosine = Math.cos(pitch);
  if (Math.abs(cosine) > 1e-8) return [Math.atan2(matrix[9], matrix[10]), pitch, Math.atan2(matrix[4], matrix[0])];
  return [Math.atan2(-matrix[6], matrix[5]), pitch, 0];
}

function inertialLines(inertial) {
  const matrix = inertial.inertiaKgSquareMeters;
  return [
    '    <inertial>',
    `      <origin xyz="${tuple(inertial.centerOfMassMeters)}" rpy="0 0 0"/>`,
    `      <mass value="${number(inertial.massKilograms)}"/>`,
    `      <inertia ixx="${number(matrix[0])}" ixy="${number(matrix[1])}" ixz="${number(matrix[2])}" iyy="${number(matrix[4])}" iyz="${number(matrix[5])}" izz="${number(matrix[8])}"/>`,
    '    </inertial>',
  ];
}

export function renderGenericUrdf(model, assembly, {
  robotName = 'step_robot',
  temporaryCollisionFromVisual = true,
  preview = false,
  attachPreviewForest = false,
  meshPrefix = 'meshes/',
} = {}) {
  const validation = validateRobotModel(model, { forExport: !preview });
  const previewAllowedErrors = validation.errors.filter(error => !/^Expected exactly one root link, found \d+$/.test(error));
  if (!validation.ok && !(preview && attachPreviewForest && previewAllowedErrors.length === 0)) {
    throw new Error(`Robot model is not exportable: ${validation.errors.join('; ')}`);
  }
  const frames = deriveLinkFrames(model);
  const occurrences = new Map(assembly.occurrences.map(item => [item.id, item]));
  const definitions = new Map(assembly.definitions.map(item => [item.id, item]));
  const lines = [
    '<?xml version="1.0"?>',
    `<robot name="${escapeXml(robotName)}">`,
    `  <!-- Source STEP SHA-256: ${escapeXml(assembly.source?.sha256 || 'unknown')} -->`,
  ];
  if (temporaryCollisionFromVisual) lines.push('  <!-- Collision meshes currently reuse visual meshes and require review. -->');

  for (const group of model.rigidGroups) {
    const frame = frames.get(group.id);
    lines.push(`  <link name="${escapeXml(group.name)}">`);
    if (group.inertial) lines.push(...inertialLines(group.inertial));
    group.occurrenceIds.forEach((occurrenceId, index) => {
      const occurrence = occurrences.get(occurrenceId);
      const definition = definitions.get(occurrence?.definitionId);
      if (!occurrence || !definition) throw new Error(`Missing STEP occurrence or definition for ${occurrenceId}`);
      const meshTransform = occurrence.meshReflectionBaked && occurrence.meshTransformMeters
        ? occurrence.meshTransformMeters
        : occurrence.sourceTransformMeters;
      const relative = visualMatrixInLink(meshTransform, frame);
      const xyz = [relative[3], relative[7], relative[11]];
      const rpy = matrixRpy(relative);
      const mesh = `${meshPrefix}${(occurrence.mesh || definition.mesh).replaceAll('\\', '/')}`;
      const geometry = [
        `      <origin xyz="${tuple(xyz)}" rpy="${tuple(rpy)}"/>`,
        '      <geometry>', `        <mesh filename="${escapeXml(mesh)}" scale="1 1 1"/>`, '      </geometry>',
      ];
      lines.push(`    <visual name="${escapeXml(group.name)}_visual_${index}">`, ...geometry, '    </visual>');
      if (temporaryCollisionFromVisual) {
        lines.push(`    <collision name="${escapeXml(group.name)}_collision_${index}">`, ...geometry, '    </collision>');
      } else {
        const collisionPath = occurrence.collisionMesh || definition.collisionMesh;
        if (collisionPath) {
          const collisionMesh = `${meshPrefix}${collisionPath.replaceAll('\\', '/')}`;
          const collisionGeometry = [
            `      <origin xyz="${tuple(xyz)}" rpy="${tuple(rpy)}"/>`,
            `      <!-- collision geometry source: ${escapeXml(occurrence.collisionMeshSource || definition.collisionMeshSource || 'explicit')} -->`,
            '      <geometry>', `        <mesh filename="${escapeXml(collisionMesh)}" scale="1 1 1"/>`, '      </geometry>',
          ];
          lines.push(`    <collision name="${escapeXml(group.name)}_collision_${index}">`, ...collisionGeometry, '    </collision>');
        }
      }
    });
    lines.push('  </link>');
  }

  for (const joint of model.joints) {
    const parent = model.rigidGroups.find(group => group.id === joint.parentLinkId);
    const child = model.rigidGroups.find(group => group.id === joint.childLinkId);
    const parentFrame = frames.get(joint.parentLinkId);
    const origin = joint.originMeters.map((value, index) => value - parentFrame[index]);
    const effort = Number.isFinite(joint.dynamics?.effort) ? joint.dynamics.effort : 1;
    const velocity = Number.isFinite(joint.dynamics?.velocity) ? joint.dynamics.velocity : 1;
    lines.push(
      `  <joint name="${escapeXml(joint.name)}" type="revolute">`,
      `    <parent link="${escapeXml(parent.name)}"/>`,
      `    <child link="${escapeXml(child.name)}"/>`,
      `    <origin xyz="${tuple(origin)}" rpy="0 0 0"/>`,
      `    <axis xyz="${tuple(joint.axis)}"/>`,
      `    <limit lower="${number(Number.isFinite(joint.limits?.lowerRadians) ? joint.limits.lowerRadians : -20 * Math.PI / 180)}" upper="${number(Number.isFinite(joint.limits?.upperRadians) ? joint.limits.upperRadians : 20 * Math.PI / 180)}" effort="${number(effort)}" velocity="${number(velocity)}"/>`,
      '  </joint>',
    );
  }
  if (preview && attachPreviewForest && validation.roots.length > 1) {
    const primaryRoot = model.rigidGroups.find(group => group.id === model.rootLinkId)
      || model.rigidGroups.find(group => group.id === validation.roots[0]);
    for (const rootId of validation.roots) {
      if (rootId === primaryRoot?.id) continue;
      const extraRoot = model.rigidGroups.find(group => group.id === rootId);
      lines.push(
        `  <!-- Preview-only attachment: disconnected candidate structure remains an export Blocker. -->`,
        `  <joint name="preview_attach_${escapeXml(rootId)}" type="fixed">`,
        `    <parent link="${escapeXml(primaryRoot.name)}"/>`,
        `    <child link="${escapeXml(extraRoot.name)}"/>`,
        '    <origin xyz="0 0 0" rpy="0 0 0"/>',
        '  </joint>',
      );
    }
  }
  lines.push('</robot>', '');
  return lines.join('\n');
}
