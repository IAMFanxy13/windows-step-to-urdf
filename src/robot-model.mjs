export const ROBOT_MODEL_SCHEMA = 'step-servo-urdf/robot-model/v1';

export function createEmptyRobotModel(jobId) {
  return { schema: ROBOT_MODEL_SCHEMA, jobId, sourcePoseIsZero: true, rigidGroups: [], joints: [], rootLinkId: null, definitionDensities: {} };
}

const finiteTuple = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);
const unitVector = value => finiteTuple(value, 3) && Math.abs(Math.hypot(...value) - 1) <= 1e-6;

function validInertia(matrix) {
  if (!finiteTuple(matrix, 9)) return false;
  const symmetric = Math.abs(matrix[1] - matrix[3]) <= 1e-10 && Math.abs(matrix[2] - matrix[6]) <= 1e-10 && Math.abs(matrix[5] - matrix[7]) <= 1e-10;
  const minor2 = matrix[0] * matrix[4] - matrix[1] * matrix[3];
  const determinant =
    matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7]) -
    matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6]) +
    matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6]);
  return symmetric && matrix[0] > 0 && minor2 > 0 && determinant > 0;
}

export function validateRobotModel(model, { forExport = false } = {}) {
  const errors = [];
  const groups = Array.isArray(model?.rigidGroups) ? model.rigidGroups : [];
  const joints = Array.isArray(model?.joints) ? model.joints : [];
  const groupIds = new Set();
  const names = new Set();
  if (forExport && (model?.mirroredOccurrences || []).some(item => !item.meshBaked)) errors.push('Mirrored STEP instances require reflection-baked meshes before URDF export');
  for (const group of groups) {
    if (!group?.id || groupIds.has(group.id)) errors.push(`Duplicate or missing link id: ${group?.id ?? ''}`);
    groupIds.add(group?.id);
    if (!group?.name || names.has(group.name)) errors.push(`Duplicate or missing link name: ${group?.name ?? ''}`);
    names.add(group?.name);
    if (!Array.isArray(group?.occurrenceIds) || group.occurrenceIds.length === 0) errors.push(`${group?.name ?? group?.id}: rigid group has no occurrences`);
    if (forExport) {
      if (!Number.isFinite(group?.inertial?.massKilograms) || group.inertial.massKilograms <= 0) errors.push(`${group?.name ?? group?.id}: positive mass is required`);
      if (!finiteTuple(group?.inertial?.centerOfMassMeters, 3)) errors.push(`${group?.name ?? group?.id}: center of mass is required in metres`);
      if (!validInertia(group?.inertial?.inertiaKgSquareMeters)) errors.push(`${group?.name ?? group?.id}: inertia matrix must be symmetric positive definite`);
      if (!group?.inertial?.source) errors.push(`${group?.name ?? group?.id}: inertial provenance is required`);
    }
  }

  const incoming = new Map();
  const outgoing = new Map(groups.map(group => [group.id, []]));
  const jointIds = new Set();
  const jointNames = new Set();
  if (forExport && model?.automation?.globalSolverSearchExhaustive === false) {
    errors.push('Global kinematic topology search is incomplete and requires review');
  }
  for (const joint of joints) {
    const label = joint?.name || joint?.id || 'unnamed joint';
    const housingRoles = new Set(joint?.componentRoleOccurrenceIds?.housing || []);
    const fusedRoleOccurrences = (joint?.componentRoleOccurrenceIds?.output || []).filter(id => housingRoles.has(id));
    if (fusedRoleOccurrences.length) errors.push(`${label}: actuator occurrences cannot be both housing and moving output geometry (${fusedRoleOccurrences.join(', ')})`);
    if (!joint?.id || jointIds.has(joint.id)) errors.push(`Duplicate or missing joint id: ${joint?.id ?? ''}`);
    jointIds.add(joint?.id);
    if (!joint?.name || jointNames.has(joint.name)) errors.push(`Duplicate or missing joint name: ${joint?.name ?? ''}`);
    jointNames.add(joint?.name);
    if (joint?.type !== 'revolute') errors.push(`${label}: only revolute joints are supported`);
    if (!groupIds.has(joint?.parentLinkId)) errors.push(`${label}: unknown parent link`);
    if (!groupIds.has(joint?.childLinkId)) errors.push(`${label}: unknown child link`);
    if (incoming.has(joint?.childLinkId)) errors.push(`${label}: child link has multiple parents`);
    incoming.set(joint?.childLinkId, joint?.parentLinkId);
    outgoing.get(joint?.parentLinkId)?.push(joint?.childLinkId);
    if (joint?.movingSideLinkId !== joint?.childLinkId) errors.push(`${label}: moving side must be represented by the URDF child subtree`);
    if (!finiteTuple(joint?.originMeters, 3)) errors.push(`${label}: origin must contain three finite metre values`);
    if (!unitVector(joint?.axis)) errors.push(`${label}: axis must be a unit vector`);
    if (forExport) {
      const lower = joint?.limits?.lowerRadians;
      const upper = joint?.limits?.upperRadians;
      if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower >= upper || joint?.limits?.source !== 'user' || joint?.confirmation?.limits !== true) {
        errors.push(`${label}: user-confirmed lower/upper limits are required`);
      }
      if (!(joint?.dynamics?.effort > 0) || !(joint?.dynamics?.velocity > 0) || joint?.dynamics?.source !== 'user') {
        errors.push(`${label}: user-supplied positive effort and velocity are required`);
      }
      for (const key of ['axis', 'topology', 'movingSide']) {
        if (joint?.confirmation?.[key] !== true) errors.push(`${label}: ${key} requires confirmation`);
      }
    }
  }

  const roots = groups.filter(group => !incoming.has(group.id)).map(group => group.id);
  if (roots.length !== 1) errors.push(`Expected exactly one root link, found ${roots.length}`);
  if (model?.rootLinkId && roots.length === 1 && model.rootLinkId !== roots[0]) errors.push(`Selected root ${model.rootLinkId} does not match the tree root ${roots[0]}`);

  const state = new Map();
  let hasCycle = false;
  const visit = id => {
    if (state.get(id) === 1) { hasCycle = true; return; }
    if (state.get(id) === 2) return;
    state.set(id, 1);
    for (const child of outgoing.get(id) || []) visit(child);
    state.set(id, 2);
  };
  for (const group of groups) visit(group.id);
  if (hasCycle) errors.push('Kinematic graph contains a cycle');
  if (roots.length === 1 && !hasCycle) {
    const reached = new Set();
    const walk = id => { if (reached.has(id)) return; reached.add(id); for (const child of outgoing.get(id) || []) walk(child); };
    walk(roots[0]);
    if (reached.size !== groups.length) errors.push('Kinematic graph contains isolated links');
  }
  return { ok: errors.length === 0, errors, counts: { links: groups.length, revoluteJoints: joints.filter(joint => joint?.type === 'revolute').length, roots: roots.length }, roots };
}

const ACTION_LABELS = {
  'select-root': '重新选择固定底座',
  'inspect-tree': '检查运动树',
  'edit-topology': '修改固定侧和运动侧',
  'reselect-axis': '重新选择旋转轴',
  'edit-origin': '修改关节原点',
  'edit-limits': '填写运动范围',
  'inspect-joint': '定位到该关节',
  'inspect-link': '定位到该结构',
  'edit-inertial': '检查质量与惯性',
  'confirm-result': '检查并确认自动结果',
  'rename': '修改名称',
};

function repairActions(...ids) {
  return ids.map(id => ({ id, label: ACTION_LABELS[id] || id }));
}

export function validateRobotModelDetailed(model, { forExport = false } = {}) {
  const issues = [];
  const groups = Array.isArray(model?.rigidGroups) ? model.rigidGroups : [];
  const joints = Array.isArray(model?.joints) ? model.joints : [];
  const add = (severity, code, message, target, actions = [], evidence = []) => {
    const key = `${severity}:${code}:${target?.type || 'model'}:${target?.id || ''}`;
    if (issues.some(item => item.key === key)) return;
    issues.push({ key, severity, code, message, target: target || { type: 'model', id: model?.jobId || 'robot' }, actions: repairActions(...actions), evidence });
  };

  if (forExport) for (const item of model?.mirroredOccurrences || []) {
    if (!item.meshBaked) add('BLOCKER', 'MIRRORED_MESH_NOT_BAKED', `镜像实例 ${item.occurrenceId} 不能把反射矩阵直接写入 URDF；必须烘焙独立网格并重建右手坐标系。`, { type: 'occurrence', id: item.occurrenceId }, ['inspect-link'], [`determinant ${item.determinant}`]);
  }

  if ((model?.automation?.candidatesSkipped || 0) > 0) {
    add(
      'BLOCKER', 'AUTOMATIC_CANDIDATES_SKIPPED',
      `有 ${model.automation.candidatesSkipped} 个关节候选因可能造成循环、重复父节点或错误合并而未自动加入整机，必须人工检查。`,
      { type: 'model', id: model?.jobId || 'robot' }, ['inspect-tree'],
      [`received ${model.automation.jointCandidatesReceived || 0} candidates`, `applied ${model.automation.jointsApplied || 0} safe candidates`],
    );
  }
  if (model?.automation?.globalSolverSearchExhaustive === false) {
    add(
      'BLOCKER', 'GLOBAL_SOLVER_SEARCH_INCOMPLETE',
      '全局运动树搜索达到计算上限，当前拓扑只是临时候选，必须检查运动树后才能正式导出。',
      { type: 'model', id: model?.jobId || 'robot' }, ['inspect-tree'],
      [`visited ${model?.kinematicSolver?.searchDiagnostics?.nodesVisited || 'unknown'} search nodes`],
    );
  }

  const groupIds = new Set();
  const groupNames = new Set();
  for (const group of groups) {
    const target = { type: 'link', id: group?.id, name: group?.name || group?.id };
    if (!group?.id || groupIds.has(group.id)) add('BLOCKER', 'LINK_ID_INVALID', `结构 ${target.name || '未命名'} 的内部标识缺失或重复。`, target, ['inspect-link']);
    groupIds.add(group?.id);
    if (!group?.name || groupNames.has(group.name)) add('BLOCKER', 'LINK_NAME_INVALID', `结构 ${target.name || '未命名'} 的名称缺失或重复。`, target, ['rename']);
    groupNames.add(group?.name);
    if (!Array.isArray(group?.occurrenceIds) || !group.occurrenceIds.length) add('BLOCKER', 'LINK_EMPTY', `${target.name} 没有包含任何 STEP 零件。`, target, ['inspect-link']);
    if (group?.name && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(group.name)) add('WARNING', 'LINK_NAME_NOT_RECOMMENDED', `${group.name} 不符合推荐的 URDF 名称格式。`, target, ['rename']);
    if (forExport) {
      if (!Number.isFinite(group?.inertial?.massKilograms) || group.inertial.massKilograms <= 0) add('BLOCKER', 'LINK_MASS_INVALID', `${target.name} 缺少有效的正质量。`, target, ['edit-inertial']);
      if (!finiteTuple(group?.inertial?.centerOfMassMeters, 3)) add('BLOCKER', 'LINK_COM_INVALID', `${target.name} 的质心包含缺失或非法数值。`, target, ['edit-inertial']);
      if (!validInertia(group?.inertial?.inertiaKgSquareMeters)) add('BLOCKER', 'LINK_INERTIA_INVALID', `${target.name} 的惯性矩阵不是有效的对称正定矩阵。`, target, ['edit-inertial']);
      if (!group?.inertial?.source) add('BLOCKER', 'LINK_INERTIA_SOURCE_MISSING', `${target.name} 的质量与惯性缺少来源记录。`, target, ['edit-inertial']);
    }
    if (/default|estimated|fallback/i.test(group?.inertial?.source || '')) add('WARNING', 'INERTIAL_ESTIMATED', `${target.name} 使用了估算密度或近似惯性。`, target, ['edit-inertial']);
  }

  const incoming = new Map();
  const outgoing = new Map(groups.map(group => [group.id, []]));
  const jointIds = new Set();
  const jointNames = new Set();
  for (const joint of joints) {
    const label = joint?.name || joint?.id || '未命名关节';
    const target = { type: 'joint', id: joint?.id, name: label };
    const housingRoles = new Set(joint?.componentRoleOccurrenceIds?.housing || []);
    const fusedRoleOccurrences = (joint?.componentRoleOccurrenceIds?.output || []).filter(id => housingRoles.has(id));
    if (fusedRoleOccurrences.length) {
      add(
        'BLOCKER', 'UNSPLITTABLE_ACTUATOR_GEOMETRY',
        `${label} 中的 ${fusedRoleOccurrences.join('、')} 同时被标为舵机外壳和运动输出端；一个 STEP occurrence 不能同时属于两个 URDF Link。`,
        target, ['edit-topology', 'inspect-joint'],
        ['请在 STEP 中保留独立舵盘/输出零件，或在高级模式中修正舵机组件角色'],
      );
    }
    if (!joint?.id || jointIds.has(joint.id)) add('BLOCKER', 'JOINT_ID_INVALID', `${label} 的内部标识缺失或重复。`, target, ['inspect-joint']);
    jointIds.add(joint?.id);
    if (!joint?.name || jointNames.has(joint.name)) add('BLOCKER', 'JOINT_NAME_INVALID', `${label} 的名称缺失或重复。`, target, ['rename']);
    jointNames.add(joint?.name);
    if (joint?.name && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(joint.name)) add('WARNING', 'JOINT_NAME_NOT_RECOMMENDED', `${label} 不符合推荐的 URDF 名称格式。`, target, ['rename']);
    if (joint?.type !== 'revolute') add('BLOCKER', 'JOINT_TYPE_UNSUPPORTED', `${label} 不是当前产品支持的旋转关节。`, target, ['inspect-joint']);
    if (joint?.parentLinkId === joint?.childLinkId) add('BLOCKER', 'PARENT_EQUALS_CHILD', `${label} 的固定侧和运动侧不能是同一个结构。`, target, ['edit-topology']);
    if (!groupIds.has(joint?.parentLinkId)) add('BLOCKER', 'PARENT_LINK_MISSING', `${label} 引用了不存在的固定侧结构。`, target, ['edit-topology']);
    if (!groupIds.has(joint?.childLinkId)) add('BLOCKER', 'CHILD_LINK_MISSING', `${label} 引用了不存在的运动侧结构。`, target, ['edit-topology']);
    if (groupIds.has(joint?.childLinkId)) {
      if (incoming.has(joint.childLinkId)) add('BLOCKER', 'MULTIPLE_PARENT_JOINTS', `${label} 的运动侧已经有另一个父关节。`, target, ['inspect-tree', 'edit-topology']);
      else incoming.set(joint.childLinkId, joint.parentLinkId);
    }
    if (groupIds.has(joint?.parentLinkId) && groupIds.has(joint?.childLinkId)) outgoing.get(joint.parentLinkId)?.push(joint.childLinkId);
    if (joint?.movingSideLinkId !== joint?.childLinkId) add('BLOCKER', 'MOVING_SIDE_MISMATCH', `${label} 的实际运动侧尚未正确表示为 Child 子树。`, target, ['edit-topology']);
    if (!finiteTuple(joint?.originMeters, 3)) add('BLOCKER', 'JOINT_ORIGIN_INVALID', `${label} 的旋转中心包含缺失或非法数值。`, target, ['edit-origin', 'reselect-axis']);
    if (!unitVector(joint?.axis)) add('BLOCKER', 'JOINT_AXIS_INVALID', `${label} 尚未设置有效的单位旋转轴。`, target, ['reselect-axis', 'inspect-joint']);

    const lower = joint?.limits?.lowerRadians;
    const upper = joint?.limits?.upperRadians;
    if (forExport && (!Number.isFinite(lower) || !Number.isFinite(upper) || lower >= upper || joint?.limits?.source !== 'user' || joint?.confirmation?.limits !== true)) {
      add('BLOCKER', 'JOINT_LIMITS_REQUIRED', `${label} 尚未填写并确认有效的最小和最大运动角度，因此无法正式导出。`, target, ['edit-limits', 'inspect-joint']);
    } else if (Number.isFinite(lower) && Number.isFinite(upper) && !(lower <= 0 && upper >= 0)) {
      add('BLOCKER', 'ZERO_OUTSIDE_LIMITS', `${label} 的运动范围不包含当前 STEP 零位 0°。`, target, ['edit-limits']);
    }
    if (forExport && (!(joint?.dynamics?.effort > 0) || !(joint?.dynamics?.velocity > 0) || joint?.dynamics?.source !== 'user')) {
      add(
        'BLOCKER', 'JOINT_DYNAMICS_REQUIRED',
        `${label} 尚未填写并确认有效的 effort 和 velocity；预览占位值不能用于正式导出。`,
        target, ['edit-limits', 'inspect-joint'],
      );
    }
    if (['UNRESOLVED', 'INVALID'].includes(joint?.verificationStatus)) {
      add('BLOCKER', 'HIGH_RISK_AMBIGUITY', `${label} 的自动识别仍存在高风险歧义，必须检查运动部分、轴心和方向。`, target, ['confirm-result', 'inspect-joint'], joint?.evidence || []);
    } else if (joint?.verificationStatus === 'AUTOMATIC_UNVERIFIED') {
      add('WARNING', 'AUTOMATIC_RESULT_UNVERIFIED', `${label} 尚未通过模板或用户运动验证；允许继续，但建议检查异常。`, target, ['inspect-joint'], joint?.evidence || []);
    } else if (joint?.confidence && joint.confidence !== 'HIGH' && joint?.lastModifiedBy === 'user') {
      add('WARNING', 'LOW_CONFIDENCE_CONFIRMED', `${label} 原自动识别置信度较低，但已经由用户确认。`, target, ['inspect-joint'], joint?.evidence || []);
    }
    if (forExport) {
      for (const [key, action] of [['axis', 'reselect-axis'], ['topology', 'edit-topology'], ['movingSide', 'inspect-joint']]) {
        if (joint?.confirmation?.[key] !== true) add('BLOCKER', `JOINT_${key.toUpperCase()}_UNCONFIRMED`, `${label} 的${key === 'axis' ? '旋转轴' : key === 'topology' ? '固定侧和运动侧' : '实际运动部分'}尚未确认。`, target, [action]);
      }
    }
  }

  const roots = groups.filter(group => !incoming.has(group.id)).map(group => group.id);
  if (roots.length !== 1) add('BLOCKER', 'ROOT_COUNT_INVALID', `运动树需要且只能有一个固定底座，目前检测到 ${roots.length} 个根结构。`, { type: 'model', id: model?.jobId || 'robot' }, ['select-root', 'inspect-tree']);
  if (model?.rootLinkId && roots.length === 1 && model.rootLinkId !== roots[0]) add('BLOCKER', 'ROOT_SELECTION_MISMATCH', '用户选择的固定底座与当前运动树根节点不一致。', { type: 'link', id: model.rootLinkId }, ['select-root', 'inspect-tree']);
  const state = new Map();
  let hasCycle = false;
  const visit = id => {
    if (state.get(id) === 1) { hasCycle = true; return; }
    if (state.get(id) === 2) return;
    state.set(id, 1);
    for (const child of outgoing.get(id) || []) visit(child);
    state.set(id, 2);
  };
  for (const group of groups) visit(group.id);
  if (hasCycle) add('BLOCKER', 'KINEMATIC_CYCLE', '运动树中出现循环，URDF 不支持闭环机构。', { type: 'model', id: model?.jobId || 'robot' }, ['inspect-tree']);
  if (roots.length === 1 && !hasCycle) {
    const reached = new Set();
    const walk = id => { if (reached.has(id)) return; reached.add(id); for (const child of outgoing.get(id) || []) walk(child); };
    walk(roots[0]);
    if (reached.size !== groups.length) add('BLOCKER', 'ISOLATED_LINKS', `有 ${groups.length - reached.size} 个结构没有连接到固定底座。`, { type: 'model', id: model?.jobId || 'robot' }, ['inspect-tree']);
  }

  add('INFO', 'MODEL_COUNTS', `已识别 ${groups.length} 个 Link 和 ${joints.filter(joint => joint?.type === 'revolute').length} 个旋转关节。`, { type: 'model', id: model?.jobId || 'robot' });
  const summary = {
    blockers: issues.filter(issue => issue.severity === 'BLOCKER').length,
    warnings: issues.filter(issue => issue.severity === 'WARNING').length,
    info: issues.filter(issue => issue.severity === 'INFO').length,
  };
  return { canExport: summary.blockers === 0, issues, summary, counts: { links: groups.length, revoluteJoints: joints.filter(joint => joint?.type === 'revolute').length, roots: roots.length }, roots };
}
