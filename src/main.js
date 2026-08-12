const { THREE, OrbitControls, STLLoader, URDFLoader } = await import('./three/runtime.mjs');

import {
  createStepJob,
  fetchStepJobStatus,
  requestStepExport,
} from './step-job-client.mjs';
import { RobotEditor } from './editor-store.mjs';
import { computeRigidGroupInertial } from './mass-properties.mjs';
import { clearSavedProjects, loadProjectCheckpoint, saveProjectCheckpoint } from './project-store.mjs';
import {
  chooseTemplateAxis, createServoTemplate,
  setTemplateInstances, worldAxisToLocal,
} from './servo-template-controller.mjs';
import { localPortToWorld, teachTopologyPattern } from './servo-functional-template.mjs';
import { topologyPatternFromRepresentative } from './contact-graph.mjs';
import { runKinematicInference } from './kinematic-inference-controller.mjs';
import { contactGraphLineSpecs, occurrenceRenderSpec } from './preview-adapter.mjs';
import { validateRobotModel, validateRobotModelDetailed } from './robot-model.mjs';
import { WorkflowController } from './app/workflow-controller.mjs';
import { createNotificationService } from './app/notification-service.mjs';
import { createProductShell } from './app/app-shell.mjs';
import { buildAnomalyQueue } from './app/anomaly-queue.mjs';
import { buildAnalysisValidationReport } from './app/analysis-report.mjs';
import { createProvenance } from './app/provenance.mjs';
import { evaluateExportReadiness, EXPORT_LEVELS } from './domain/export-policy.mjs';
import { renderAnomalyQueue } from './views/anomaly-queue-view.mjs';
import { renderEvidencePanel } from './views/evidence-panel.mjs';
import { jointCardCopy, servoCardCopy } from './views/review-card-presentation.mjs';
import {
  deriveLinkFrames as deriveGenericLinkFrames,
  renderGenericUrdf,
} from './urdf-serializer.mjs';
import './styles.css';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const viewport = document.getElementById('viewport');
const statusElement = document.getElementById('status');
const activeJointElement = document.getElementById('active-joint');
const stepFileElement = document.getElementById('step-file');
const analyzeStepElement = document.getElementById('analyze-step');
const stepJobStatusElement = document.getElementById('step-job-status');
const stepInspectorElement = document.getElementById('step-inspector');
const servoTemplateStageElement = document.getElementById('servo-template-stage');
const servoTemplateCardsElement = document.getElementById('servo-template-cards');
const stepAssemblyListElement = document.getElementById('step-assembly-list');
const stepFeatureSummaryElement = document.getElementById('step-feature-summary');
const rigidGroupEditorElement = document.getElementById('rigid-group-editor');
const stepAxisListElement = document.getElementById('step-axis-list');
const genericJointEditorElement = document.getElementById('generic-joint-editor');
const genericValidationElement = document.getElementById('generic-validation');
const exportStepJobElement = document.getElementById('export-step-job');
const exportPreviewElement = document.getElementById('export-preview');
const reviewProgressElement = document.getElementById('review-progress');
const workflowMapElement = document.getElementById('workflow-map');
const currentTaskCardElement = document.getElementById('current-task-card');
const analysisProgressElement = document.getElementById('analysis-progress-panel');
const notificationCenterElement = document.getElementById('notification-center');
const anomalyQueueElement = document.getElementById('anomaly-queue');
const evidencePanelContentElement = document.getElementById('evidence-panel-content');
const exportReviewElement = document.getElementById('export-review-panel');
const autosaveStatusElement = document.getElementById('autosave-status');
const workflowController = new WorkflowController();
const notificationService = createNotificationService();
createProductShell({ workflowController, notificationService, elements: { workflowMap: workflowMapElement, taskCard: currentTaskCardElement, analysisProgress: analysisProgressElement, notifications: notificationCenterElement } });
const diagnosticElement = document.createElement('script');
diagnosticElement.id = 'step-urdf-test-state';
diagnosticElement.type = 'application/json';
document.head.appendChild(diagnosticElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x161b22);

const camera = new THREE.PerspectiveCamera(42, 1, 0.001, 20);
camera.position.set(0.85, 0.55, 0.85);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.16, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
keyLight.position.set(1.2, 1.5, 0.8);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x88aaff, 1.2);
fillLight.position.set(-1, 0.4, -0.8);
scene.add(fillLight);

const grid = new THREE.GridHelper(1.2, 24, 0x4d6078, 0x2c3746);
scene.add(grid);

let axesVisible = true;
let sequenceRunning = false;
let activeStepJobId = null;
let stepModeActive = false;
let stepPreviewGroup = null;
let stepAssembly = null;
let stepFeatures = null;
let stepCandidates = null;
let selectedOccurrenceId = null;
let selectedAxisCandidate = null;
let stepEditor = null;
let servoTemplates = [];
let activeServoTemplateIndex = 0;
let currentValidationReport = null;
let genericPreviewRobot = null;
let genericZeroGhost = null;
let genericSelectedJointId = null;
const genericAxisHelpers = [];
const stepAxisHelpers = [];
const contactGraphHelpers = [];
let contactGraphVisible = false;
const loaderErrors = [];

window.addEventListener('unhandledrejection', event => {
  event.preventDefault();
  notificationService.unexpected(event.reason, { title: '后台操作没有正常完成', impact: '当前操作未生效，已保留之前的工程状态', recommendation: '检查问题说明后安全重试', recoverability: 'RETRYABLE' });
});
window.addEventListener('error', event => notificationService.unexpected(event.error || new Error(event.message), { title: '页面发生未预期错误', impact: '当前步骤可能没有完成', recommendation: '可以恢复最近检查点或重试当前操作', recoverability: 'CHECKPOINT_OR_RETRY' }));

const runtime = {
  ready: false,
  errors: loaderErrors,
  get counts() {
    if (genericPreviewRobot) {
      return {
        links: Object.keys(genericPreviewRobot.links || {}).length,
        joints: Object.values(genericPreviewRobot.joints || {}).filter(j => j.jointType === 'revolute').length,
        sliders: genericJointEditorElement.querySelectorAll('input.generic-joint-slider').length,
      };
    }
    return { links: 0, joints: 0, sliders: 0 };
  },
  get selectedJoint() {
    return genericSelectedJointId;
  },
  getJointValuesDeg,
  getLinkWorldMatrices,
  getExpectedMovingLinks,
  resetAll,
  selectJoint,
  setJointDegrees,
  runAutomatedSequence,
};
window.__STEP_URDF_TEST__ = runtime;

function publishDiagnostics() {
  const selectedJoint = stepEditor?.model.joints.find(joint => joint.id === genericSelectedJointId) || null;
  const state = {
    ready: runtime.ready,
    errors: [...loaderErrors],
    counts: runtime.counts,
    selectedJoint: genericSelectedJointId,
    jointValuesDeg: getJointValuesDeg(),
    linkWorldMatrices: getLinkWorldMatrices(),
    expectedMovingLinks: selectedJoint ? getExpectedMovingLinks(selectedJoint.id) : [],
    selectedActuation: selectedJoint ? {
      parentLinkId: selectedJoint.parentLinkId,
      childLinkId: selectedJoint.childLinkId,
      actuationMode: selectedJoint.actuationMode,
    } : null,
  };
  diagnosticElement.textContent = JSON.stringify(state);
  document.documentElement.dataset.testReady = String(state.ready);
}
publishDiagnostics();

function resize() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function renderLoop() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(renderLoop);
}
renderLoop();

function fitRobot(object = genericPreviewRobot || stepPreviewGroup) {
  if (!object) return;
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() * 0.72, 0.04);
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(radius, radius * 0.55, radius));
  camera.near = Math.max(radius / 1000, 0.001);
  camera.far = radius * 20;
  camera.updateProjectionMatrix();
  controls.update();
}

function asMaterials(material) {
  return Array.isArray(material) ? material : [material];
}

function restoreGenericHighlights() {
  if (!genericPreviewRobot) return;
  genericPreviewRobot.traverse(object => {
    if (!object.isMesh) return;
    for (const material of asMaterials(object.material)) {
      if (material.userData.baseColor && material.color) material.color.copy(material.userData.baseColor);
      if (material.userData.baseEmissive && material.emissive) {
        material.emissive.copy(material.userData.baseEmissive);
        material.emissiveIntensity = material.userData.baseEmissiveIntensity ?? 1;
      }
    }
  });
}

function clearGenericZeroGhost() {
  if (!genericZeroGhost) return;
  genericZeroGhost.removeFromParent();
  genericZeroGhost.traverse(object => {
    if (!object.isMesh) return;
    for (const material of asMaterials(object.material)) material.dispose?.();
  });
  genericZeroGhost = null;
}

function showGenericZeroGhost(jointId) {
  clearGenericZeroGhost();
  const joint = stepEditor?.model.joints.find(item => item.id === jointId);
  const childGroup = joint && stepEditor.model.rigidGroups.find(group => group.id === joint.childLinkId);
  const source = childGroup && genericPreviewRobot?.links?.[childGroup.name];
  if (!source) return;
  source.updateWorldMatrix(true, true);
  const ghost = source.clone(true);
  ghost.name = `q0_ghost_${jointId}`;
  ghost.traverse(object => {
    if (!object.isMesh) return;
    object.material = asMaterials(object.material).map(material => {
      const next = material.clone();
      next.color?.set(0x9aa4b2);
      next.emissive?.set(0x303842);
      next.transparent = true;
      next.opacity = 0.22;
      next.depthWrite = false;
      return next;
    });
  });
  ghost.matrix.copy(source.matrixWorld);
  ghost.matrix.decompose(ghost.position, ghost.quaternion, ghost.scale);
  scene.add(ghost);
  genericZeroGhost = ghost;
}

function colorGenericLink(groupId, color) {
  const group = stepEditor?.model.rigidGroups.find(item => item.id === groupId);
  const link = group && genericPreviewRobot?.links?.[group.name];
  if (!link) return;
  link.traverse(object => {
    if (!object.isMesh) return;
    for (const material of asMaterials(object.material)) {
      material.color?.lerp(new THREE.Color(color), 0.58);
      if (material.emissive) {
        material.emissive.set(color);
        material.emissiveIntensity = 0.18;
      }
    }
  });
}

function genericDescendantLinkIds(linkId) {
  const children = new Map();
  for (const joint of stepEditor?.model.joints || []) {
    if (!children.has(joint.parentLinkId)) children.set(joint.parentLinkId, []);
    children.get(joint.parentLinkId).push(joint.childLinkId);
  }
  const descendants = [];
  const visit = id => {
    if (descendants.includes(id)) return;
    descendants.push(id);
    for (const child of children.get(id) || []) visit(child);
  };
  visit(linkId);
  return descendants;
}

function selectGenericJoint(jointId) {
  const joint = stepEditor?.model.joints.find(item => item.id === jointId);
  if (!joint || !genericPreviewRobot) return;
  genericSelectedJointId = jointId;
  restoreGenericHighlights();
  colorGenericLink(joint.parentLinkId, 0xffa726);
  colorGenericLink(joint.childLinkId, 0x26c6da);
  for (const descendantId of genericDescendantLinkIds(joint.childLinkId).slice(1)) {
    colorGenericLink(descendantId, 0xab47bc);
  }
  const parent = stepEditor.model.rigidGroups.find(group => group.id === joint.parentLinkId)?.name;
  const child = stepEditor.model.rigidGroups.find(group => group.id === joint.childLinkId)?.name;
  activeJointElement.textContent = `当前关节：${joint.name} | 固定 Parent ${parent}，运动 Child ${child}；青色与紫色结构应随轴转动。`;
  for (const card of genericJointEditorElement.querySelectorAll('.generic-joint-card')) {
    card.classList.toggle('active', card.dataset.jointId === jointId);
  }
  publishDiagnostics();
}

function setGenericSingleJointDegrees(jointId, degrees) {
  if (!genericPreviewRobot || !stepEditor) return;
  const active = stepEditor.model.joints.find(item => item.id === jointId);
  if (!active) return;
  for (const joint of stepEditor.model.joints) genericPreviewRobot.joints[joint.name]?.setJointValue(0);
  scene.updateMatrixWorld(true);
  if (Number(degrees) !== 0) showGenericZeroGhost(jointId);
  else clearGenericZeroGhost();
  genericPreviewRobot.joints[active.name]?.setJointValue(Number(degrees) * DEG2RAD);
  for (const slider of genericJointEditorElement.querySelectorAll('input.generic-joint-slider')) {
    const value = slider.dataset.jointId === jointId ? Number(degrees) : 0;
    slider.value = String(value);
    const output = slider.closest('.generic-joint-card')?.querySelector('output');
    if (output) output.value = `${value.toFixed(1)}°`;
  }
  selectGenericJoint(jointId);
  scene.updateMatrixWorld(true);
}

function resolveGenericJoint(jointNameOrId) {
  return stepEditor?.model.joints.find(joint => joint.id === jointNameOrId || joint.name === jointNameOrId) || null;
}

function selectJoint(jointNameOrId) {
  const joint = resolveGenericJoint(jointNameOrId);
  if (!joint) throw new Error(`Unknown joint ${jointNameOrId}`);
  selectGenericJoint(joint.id);
}

function setJointDegrees(jointNameOrId, degrees) {
  const joint = resolveGenericJoint(jointNameOrId);
  if (!joint) throw new Error(`Unknown joint ${jointNameOrId}`);
  setGenericSingleJointDegrees(joint.id, degrees);
}

function getJointValuesDeg() {
  if (!genericPreviewRobot || !stepEditor) return {};
  return Object.fromEntries(stepEditor.model.joints.map(joint => [
    joint.name,
    (genericPreviewRobot.joints[joint.name]?.jointValue?.[0] || 0) * RAD2DEG,
  ]));
}

function resetAll() {
  if (!genericPreviewRobot || !stepEditor) return;
  for (const joint of stepEditor.model.joints) {
    genericPreviewRobot.joints[joint.name]?.setJointValue(0);
  }
  for (const slider of genericJointEditorElement.querySelectorAll('input.generic-joint-slider')) {
    slider.value = '0';
    const output = slider.closest('.generic-joint-card')?.querySelector('output');
    if (output) output.value = '0.0°';
  }
  restoreGenericHighlights();
  genericSelectedJointId = null;
  activeJointElement.textContent = '当前关节：未选择（全部为 0°）';
  scene.updateMatrixWorld(true);
  publishDiagnostics();
}

function getLinkWorldMatrices() {
  if (!genericPreviewRobot) return {};
  scene.updateMatrixWorld(true);
  return Object.fromEntries(
    Object.entries(genericPreviewRobot.links || {}).map(([name, link]) => [
      name,
      link.matrixWorld.toArray(),
    ]),
  );
}

function getExpectedMovingLinks(jointNameOrId) {
  const joint = resolveGenericJoint(jointNameOrId);
  if (!joint) throw new Error(`Unknown joint ${jointNameOrId}`);
  return genericDescendantLinkIds(joint.childLinkId)
    .map(id => stepEditor.model.rigidGroups.find(group => group.id === id)?.name)
    .filter(Boolean);
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function runAutomatedSequence({ delayMs = 350 } = {}) {
  if (sequenceRunning || !genericPreviewRobot || !stepEditor) return;
  sequenceRunning = true;
  document.getElementById('run-sequence').disabled = true;
  try {
    for (const joint of stepEditor.model.joints) {
      for (const degrees of [0, 10, 0, -10, 0]) {
        setGenericSingleJointDegrees(joint.id, degrees);
        await wait(delayMs);
      }
    }
    resetAll();
  } finally {
    sequenceRunning = false;
    document.getElementById('run-sequence').disabled = false;
  }
}

document.getElementById('reset-all').addEventListener('click', resetAll);
document.getElementById('run-sequence').addEventListener('click', () => runAutomatedSequence());
document.getElementById('toggle-axes').addEventListener('click', () => {
  axesVisible = !axesVisible;
  stepAxisHelpers.forEach(helper => {
    helper.visible = axesVisible;
  });
  genericAxisHelpers.forEach(helper => {
    helper.visible = axesVisible;
  });
});
document.getElementById('toggle-grid').addEventListener('click', () => {
  grid.visible = !grid.visible;
});
document.getElementById('toggle-contact-graph').addEventListener('click', () => {
  contactGraphVisible = !contactGraphVisible;
  for (const helper of contactGraphHelpers) helper.visible = contactGraphVisible;
});

function rebuildContactGraphHelpers() {
  for (const helper of contactGraphHelpers.splice(0)) scene.remove(helper);
  if (!stepAssembly) return;
  for (const spec of contactGraphLineSpecs(stepAssembly)) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...spec.start), new THREE.Vector3(...spec.end),
    ]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: spec.color, transparent: true, opacity: 0.8 }));
    line.name = `contact:${spec.edgeId}`;
    line.userData = spec;
    line.visible = contactGraphVisible;
    contactGraphHelpers.push(line);
    scene.add(line);
  }
}

function renderStepJobStatus(status) {
  const counts = Number.isFinite(status.occurrenceCount)
    ? ` | ${status.occurrenceCount} 个装配实例 / ${status.definitionCount} 种零件`
    : '';
  stepJobStatusElement.textContent = `${status.message || status.state}${counts}`;
  stepJobStatusElement.dataset.state = status.state;
}

async function pollStepJob(jobId) {
  for (;;) {
    const status = await fetchStepJobStatus(jobId);
    renderStepJobStatus(status);
    if (['ready', 'failed'].includes(status.state)) return status;
    await wait(400);
  }
}

function clearStepAxes() {
  for (const helper of stepAxisHelpers.splice(0)) scene.remove(helper);
}

function occurrenceMatrix(occurrence) {
  return new THREE.Matrix4().set(...occurrence.sourceTransformMeters);
}

function makeCircleEdgeHelper(origin, axis, radius, userData) {
  const normal = axis.clone().normalize();
  const reference = Math.abs(normal.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3().crossVectors(normal, reference).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  const points = Array.from({ length: 65 }, (_, index) => {
    const angle = index / 64 * Math.PI * 2;
    return origin.clone().addScaledVector(tangent, Math.cos(angle) * radius).addScaledVector(bitangent, Math.sin(angle) * radius);
  });
  const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x42d392 }));
  ring.userData = userData;
  return ring;
}

function selectStepOccurrence(occurrenceId) {
  selectedOccurrenceId = occurrenceId;
  selectedAxisCandidate = null;
  clearStepAxes();
  stepAxisListElement.replaceChildren();
  for (const button of stepAssemblyListElement.querySelectorAll('.assembly-item')) {
    button.classList.toggle('selected', button.dataset.occurrenceId === occurrenceId);
  }
  const occurrence = stepAssembly?.occurrences.find(item => item.id === occurrenceId);
  if (!occurrence?.definitionId) return;
  const matrix = occurrenceMatrix(occurrence);
  const seen = new Set();
  const candidates = stepFeatures.faces.filter(face =>
    face.id.startsWith(`${occurrence.definitionId}/face/`) && face.cylinder);
  for (const face of candidates) {
    const { originMeters, axis, radiusMeters } = face.cylinder;
    const key = [...originMeters, ...axis, radiusMeters].map(value => value.toFixed(5)).join('|');
    if (seen.has(key) || seen.size >= 24) continue;
    seen.add(key);
    const origin = new THREE.Vector3(...originMeters).applyMatrix4(matrix);
    const direction = new THREE.Vector3(...axis).transformDirection(matrix).normalize();
    const helper = new THREE.ArrowHelper(direction, origin, Math.max(radiusMeters * 2.5, 0.012), 0xffc107, 0.004, 0.0025);
    helper.userData = { faceId: face.id, occurrenceId, originMeters: origin.toArray(), axis: direction.toArray() };
    scene.add(helper);
    stepAxisHelpers.push(helper);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'axis-candidate';
    button.dataset.faceId = face.id;
    button.textContent = `${face.id.split('/').slice(-2).join('/')} | r=${(radiusMeters * 1000).toFixed(3)} mm`;
    button.addEventListener('click', () => {
      selectedAxisCandidate = { occurrenceId, faceId: face.id, originMeters: origin.toArray(), axis: direction.toArray() };
      for (const item of stepAxisListElement.querySelectorAll('.axis-candidate')) item.classList.toggle('selected', item === button);
    });
    stepAxisListElement.appendChild(button);
  }
  const circleEdges = stepFeatures.edges.filter(edge => edge.id.startsWith(`${occurrence.definitionId}/edge/`) && edge.circle);
  for (const edge of circleEdges.slice(0, 48)) {
    const { originMeters, axis, radiusMeters } = edge.circle;
    const origin = new THREE.Vector3(...originMeters).applyMatrix4(matrix);
    const direction = new THREE.Vector3(...axis).transformDirection(matrix).normalize();
    const ring = makeCircleEdgeHelper(origin, direction, radiusMeters, {
      edgeId: edge.id, occurrenceId, originMeters: origin.toArray(), axis: direction.toArray(),
    });
    scene.add(ring);
    stepAxisHelpers.push(ring);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'axis-candidate circle-edge';
    button.dataset.edgeId = edge.id;
    button.textContent = `${edge.id.split('/').slice(-2).join('/')} 圆边 | r=${(radiusMeters * 1000).toFixed(3)} mm`;
    button.addEventListener('click', () => {
      selectedAxisCandidate = { occurrenceId, edgeId: edge.id, originMeters: origin.toArray(), axis: direction.toArray() };
      for (const item of stepAxisListElement.querySelectorAll('.axis-candidate')) item.classList.toggle('selected', item === button);
    });
    stepAxisListElement.appendChild(button);
  }
  for (const candidate of stepCandidates?.jointCandidates?.filter(item => item.actuatorOccurrenceId === occurrenceId) || []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'axis-candidate automatic';
    button.textContent = `自动候选 ${candidate.id} | ${candidate.confidence} | ${candidate.axisFaceId}`;
    button.addEventListener('click', () => {
      selectedAxisCandidate = { occurrenceId, faceId: candidate.axisFaceId, originMeters: candidate.originMeters, axis: candidate.axis };
      for (const item of stepAxisListElement.querySelectorAll('.axis-candidate')) item.classList.toggle('selected', item === button);
    });
    stepAxisListElement.prepend(button);
  }
  stepFeatureSummaryElement.textContent = `${occurrence.name}：${candidates.length} 个圆柱面、${circleEdges.length} 条圆边；黄色箭头和绿色圆环都可用于定义旋转轴。`;
}

renderer.domElement.addEventListener('pointerdown', event => {
  if (!stepModeActive || event.button !== 0) return;
  const bounds = renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line.threshold = 0.002;
  raycaster.setFromCamera(pointer, camera);
  const targets = [...stepAxisHelpers, ...(stepPreviewGroup?.children || [])];
  const hit = raycaster.intersectObjects(targets, true)[0];
  if (!hit) return;
  let owner = hit.object;
  while (owner && !owner.userData?.faceId && !owner.userData?.edgeId && !owner.userData?.occurrenceId) owner = owner.parent;
  if (owner?.userData?.faceId || owner?.userData?.edgeId) {
    selectedAxisCandidate = {
      occurrenceId: owner.userData.occurrenceId,
      faceId: owner.userData.faceId,
      edgeId: owner.userData.edgeId,
      originMeters: owner.userData.originMeters,
      axis: owner.userData.axis,
    };
    for (const item of stepAxisListElement.querySelectorAll('.axis-candidate')) item.classList.toggle('selected',
      item.dataset.faceId === owner.userData.faceId || item.dataset.edgeId === owner.userData.edgeId);
    stepFeatureSummaryElement.textContent = owner.userData.edgeId
      ? `已选择精确 B-Rep 圆边 ${owner.userData.edgeId}，轴心和方向已自动计算。`
      : `已选择精确 B-Rep 圆柱面 ${owner.userData.faceId}，轴心和方向已自动计算。`;
  } else if (owner?.userData?.occurrenceId) {
    const occurrenceId = owner.userData.occurrenceId;
    const definition = stepAssembly?.definitions.find(item => item.id === owner.userData.definitionId);
    const range = Number.isInteger(hit.faceIndex)
      ? definition?.triangleFaceRanges?.find(item => hit.faceIndex >= item.triangleStart && hit.faceIndex < item.triangleStart + item.triangleCount)
      : null;
    selectStepOccurrence(occurrenceId);
    const face = range && stepFeatures.faces.find(item => item.id === range.faceId);
    if (face?.cylinder) {
      const occurrence = stepAssembly.occurrences.find(item => item.id === occurrenceId);
      const matrix = occurrenceMatrix(occurrence);
      const origin = new THREE.Vector3(...face.cylinder.originMeters).applyMatrix4(matrix);
      const direction = new THREE.Vector3(...face.cylinder.axis).transformDirection(matrix).normalize();
      selectedAxisCandidate = { occurrenceId, faceId: face.id, originMeters: origin.toArray(), axis: direction.toArray() };
      let button = stepAxisListElement.querySelector(`[data-face-id="${CSS.escape(face.id)}"]`);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'axis-candidate';
        button.dataset.faceId = face.id;
        button.textContent = `${face.id.split('/').slice(-2).join('/')} | clicked B-Rep cylinder`;
        stepAxisListElement.prepend(button);
      }
      for (const item of stepAxisListElement.querySelectorAll('.axis-candidate')) item.classList.toggle('selected', item === button);
      stepFeatureSummaryElement.textContent = `已从网格三角形反查并选择精确 B-Rep 圆柱面 ${face.id}。`;
    } else if (range) {
      stepFeatureSummaryElement.textContent = `已选择 B-Rep 面 ${range.faceId}；该面不是圆柱面，不能直接定义旋转轴。`;
    }
  }
});

function updateNewJointSelectors() {
  const parent = document.getElementById('new-joint-parent');
  const child = document.getElementById('new-joint-child');
  const selectedParent = parent.value;
  const selectedChild = child.value;
  parent.replaceChildren();
  child.replaceChildren();
  for (const group of stepEditor?.model.rigidGroups || []) {
    for (const select of [parent, child]) {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = group.name;
      select.appendChild(option);
    }
  }
  if ([...parent.options].some(option => option.value === selectedParent)) parent.value = selectedParent;
  if ([...child.options].some(option => option.value === selectedChild)) child.value = selectedChild;
  else if (child.options.length > 1) child.selectedIndex = 1;
}

function prepareGenericExportModel() {
  const model = structuredClone(stepEditor.model);
  const topology = validateRobotModel(model);
  if (!topology.ok) throw new Error(topology.errors.join('; '));
  const frames = deriveGenericLinkFrames(model);
  for (const group of model.rigidGroups) {
    group.inertial = computeRigidGroupInertial(group, stepAssembly, {
      densityKgPerCubicMeter: group.densityKgPerCubicMeter,
      densityByDefinitionId: Object.keys(model.definitionDensities || {}).length ? model.definitionDensities : null,
      linkFrameMeters: frames.get(group.id).slice(0, 3),
    });
  }
  return model;
}

function refreshGenericValidation() {
  if (!stepEditor) return;
  let report = validateRobotModelDetailed(stepEditor.model, { forExport: true });
  const deferredInertialCodes = new Set([
    'LINK_MASS_INVALID', 'LINK_COM_INVALID', 'LINK_INERTIA_INVALID', 'LINK_INERTIA_SOURCE_MISSING',
  ]);
  report = structuredClone(report);
  report.issues = report.issues.filter(issue => !deferredInertialCodes.has(issue.code));
  const occurrenceDefinitions = new Map(stepAssembly.occurrences.map(item => [item.id, item.definitionId]));
  const missingDensityGroups = stepEditor.model.rigidGroups.filter(group => {
    if (Number.isFinite(group.densityKgPerCubicMeter) && group.densityKgPerCubicMeter > 0) return false;
    const definitionIds = [...new Set(group.occurrenceIds.map(id => occurrenceDefinitions.get(id)).filter(Boolean))];
    return definitionIds.some(id => !(stepEditor.model.definitionDensities?.[id]?.value > 0));
  });
  for (const group of missingDensityGroups) {
    report.issues.push({
      key: `BLOCKER:DENSITY_REQUIRED:link:${group.id}`,
      severity: 'BLOCKER',
      code: 'DENSITY_REQUIRED',
      message: `${group.name} 尚未填写材料密度，无法从精确 B-Rep 体积计算质量和惯性。`,
      target: { type: 'link', id: group.id, name: group.name },
      actions: [{ id: 'edit-inertial', label: '填写结构材料密度' }],
      evidence: [],
    });
  }
  if (!missingDensityGroups.length) try {
    const exportModel = prepareGenericExportModel();
    report = validateRobotModelDetailed(exportModel, { forExport: true });
  } catch (error) {
    report.issues.unshift({
      key: 'BLOCKER:INERTIAL_COMPUTATION:model', severity: 'BLOCKER', code: 'INERTIAL_COMPUTATION',
      message: `质量与惯性尚未就绪：${error.message || error}`,
      target: { type: 'model', id: stepEditor.model.jobId },
      actions: [{ id: 'edit-inertial', label: '填写结构材料密度' }], evidence: [],
    });
  }
  report.summary = {
    blockers: report.issues.filter(issue => issue.severity === 'BLOCKER').length,
    warnings: report.issues.filter(issue => issue.severity === 'WARNING').length,
    info: report.issues.filter(issue => issue.severity === 'INFO').length,
  };
  report.canExport = report.summary.blockers === 0;
  currentValidationReport = report;
  renderValidationReport(report);
  const queue = buildAnomalyQueue({ model: stepEditor.model, validationIssues: report.issues });
  renderAnomalyQueue(anomalyQueueElement, queue, { onAction: handleAnomalyAction });
  workflowController.update({ counts: { blockers: queue.blockers.length, warnings: queue.warnings.length, automaticPassed: queue.passed.length } });
  renderExportReview(queue, report);
  const readiness = evaluateExportReadiness({
    validationIssues: report.issues,
    unresolvedRecognition: stepEditor.model.joints
      .filter(joint => ['UNRESOLVED', 'INVALID'].includes(joint.verificationStatus))
      .map(joint => ({ id: joint.id, risk: 'high', status: joint.verificationStatus })),
    engineeringValues: {
      limitsComplete: stepEditor.model.joints.every(joint => joint.confirmation?.limits),
      inertialsReliable: missingDensityGroups.length === 0,
      hardwareLimitsReliable: stepEditor.model.joints.every(joint =>
        joint.dynamics?.source === 'user' && joint.dynamics.effort > 0 && joint.dynamics.velocity > 0),
    },
  });
  exportPreviewElement.disabled = !readiness[EXPORT_LEVELS.PREVIEW].allowed;
  exportPreviewElement.textContent = readiness[EXPORT_LEVELS.PREVIEW].allowed
    ? '导出预览模型（仅用于查看）'
    : '预览模型仍有结构错误';
  const engineeringReady = readiness[EXPORT_LEVELS.ENGINEERING].allowed;
  exportStepJobElement.disabled = !engineeringReady;
  exportStepJobElement.textContent = engineeringReady
    ? '导出已验证工程模型'
    : report.summary.blockers
      ? `工程模型（${report.summary.blockers} 个必须处理项）`
      : '工程模型（还需真实力矩/速度来源）';
}

function handleAnomalyAction(issue, action) {
  if (issue.source === 'robot_validation' && issue.target) locateValidationTarget({ target: issue.target }, action);
  const joint = stepEditor?.model.joints.find(item => item.id === issue.targetId || item.actuatorOccurrenceId === issue.targetId);
  if (joint) {
    selectGenericJoint(joint.id);
    if (action === 'reselect-axis' && joint.actuatorOccurrenceId) startAxisCorrection(joint);
    const card = genericJointEditorElement.querySelector(`[data-joint-id="${CSS.escape(joint.id)}"]`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (stepAssembly?.occurrences.some(item => item.id === issue.targetId)) {
    selectStepOccurrence(issue.targetId);
    fitRobot(stepPreviewGroup);
  }
  const resultType = issue.source === 'template_instance_status' ? 'TEMPLATE_MATCH' : issue.source === 'transform_validation' ? 'EXACT_GEOMETRY' : 'HEURISTIC';
  renderEvidencePanel(evidencePanelContentElement, createProvenance({ resultType, evidence: issue.evidence, algorithmVersion: issue.source === 'template_instance_status' ? 'servo-functional-template/v1' : 'robot-validation/v1', source: issue.source }));
  notificationService.info({ title: '已定位检查项目', whatHappened: issue.title, impact: issue.category, recommendation: action === 'reselect-axis' ? '点击真正的圆柱面或圆边' : '在三维视窗检查高亮结构和轴线' });
}

function renderExportReview(queue, report) {
  exportReviewElement.hidden = false;
  const gate = queue.blockers.length
    ? { icon: '🔒', title: `还差 ${queue.blockers.length} 项`, hint: '修完红色项目即可导出' }
    : queue.warnings.length
      ? { icon: '⚠️', title: '可以导出', hint: `${queue.warnings.length} 个提醒` }
      : { icon: '📦', title: '可以导出 URDF', hint: '检查已通过' };
  exportReviewElement.innerHTML = `<div class="export-gate"><span aria-hidden="true">${gate.icon}</span><div><h2>${gate.title}</h2><p>${gate.hint}</p></div></div><div class="review-counts advanced-only"><span>已通过 <strong>${queue.passed.length}</strong></span><span>警告 <strong>${queue.warnings.length}</strong></span><span>阻止项 <strong>${queue.blockers.length}</strong></span><span>人工修改 <strong>${stepEditor.model.joints.filter(item => item.lastModifiedBy === 'user').length}</strong></span></div>`;
}

function locateValidationTarget(issue, actionId) {
  if (issue.target?.type === 'joint') {
    const card = genericJointEditorElement.querySelector(`[data-joint-id="${CSS.escape(issue.target.id)}"]`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card?.classList.add('attention');
    setTimeout(() => card?.classList.remove('attention'), 1400);
    if (actionId === 'edit-limits') card?.querySelector('.joint-lower')?.focus();
    if (actionId === 'edit-origin') card?.querySelector('.joint-origin-x')?.focus();
    const joint = stepEditor.model.joints.find(item => item.id === issue.target.id);
    if (actionId === 'reselect-axis' && joint?.actuatorOccurrenceId) startAxisCorrection(joint);
  } else if (issue.target?.type === 'link') {
    document.getElementById('structure-correction-tools').open = true;
    const card = rigidGroupEditorElement.querySelector(`[data-group-id="${CSS.escape(issue.target.id)}"]`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card?.classList.add('attention');
    setTimeout(() => card?.classList.remove('attention'), 1400);
  }
}

function renderValidationReport(report) {
  genericValidationElement.replaceChildren();
  genericValidationElement.dataset.state = report.canExport ? 'ready' : 'failed';
  const advanced = document.body.classList.contains('advanced-mode');
  const visibleIssues = advanced ? report.issues : simplifyValidationForDefaultMode(report.issues);
  const visibleBlockers = visibleIssues.filter(issue => issue.severity === 'BLOCKER').length;
  const visibleWarnings = visibleIssues.filter(issue => issue.severity === 'WARNING').length;
  const heading = document.createElement('strong');
  heading.textContent = report.canExport
    ? `检查完成，可以正式导出${visibleWarnings ? `（${visibleWarnings} 个提醒）` : ''}`
    : advanced
      ? `尚不可导出：${report.summary.blockers} 个关键错误，${report.summary.warnings} 个提醒`
      : `还需完成 ${visibleBlockers} 项，完成后即可导出`;
  genericValidationElement.appendChild(heading);
  for (const issue of visibleIssues.filter(item => item.severity !== 'INFO' || item.code === 'MODEL_COUNTS')) {
    const row = document.createElement('div');
    row.className = `validation-issue severity-${issue.severity.toLowerCase()}`;
    row.dataset.issueCode = issue.code;
    const message = document.createElement('span');
    message.textContent = `${issue.severity === 'BLOCKER' ? '必须修复' : issue.severity === 'WARNING' ? '建议检查' : '信息'}：${issue.message}`;
    row.appendChild(message);
    for (const action of issue.actions || []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.addEventListener('click', () => locateValidationTarget(issue, action.id));
      row.appendChild(button);
    }
    genericValidationElement.appendChild(row);
  }
}

function simplifyValidationForDefaultMode(issues) {
  const result = [];
  const jointGroups = new Map();
  for (const issue of issues) {
    if (issue.target?.type !== 'joint') {
      result.push(issue);
      continue;
    }
    if (!jointGroups.has(issue.target.id)) jointGroups.set(issue.target.id, []);
    jointGroups.get(issue.target.id).push(issue);
  }
  const expectedReviewCodes = new Set([
    'JOINT_LIMITS_REQUIRED', 'HIGH_RISK_AMBIGUITY', 'JOINT_AXIS_UNCONFIRMED',
    'JOINT_TOPOLOGY_UNCONFIRMED', 'JOINT_MOVINGSIDE_UNCONFIRMED',
  ]);
  for (const [jointId, jointIssues] of jointGroups) {
    const joint = stepEditor?.model.joints.find(item => item.id === jointId);
    const serious = jointIssues.find(issue => issue.severity === 'BLOCKER' && !expectedReviewCodes.has(issue.code));
    const needsMotionReview = jointIssues.some(issue => ['HIGH_RISK_AMBIGUITY', 'JOINT_AXIS_UNCONFIRMED', 'JOINT_TOPOLOGY_UNCONFIRMED', 'JOINT_MOVINGSIDE_UNCONFIRMED'].includes(issue.code));
    const needsLimits = jointIssues.some(issue => issue.code === 'JOINT_LIMITS_REQUIRED');
    const warnings = jointIssues.filter(issue => issue.severity === 'WARNING');
    if (serious) {
      result.push({ ...serious, message: `${joint?.name || jointId}：${serious.message}` });
    } else if (needsMotionReview || needsLimits) {
      const tasks = [];
      if (needsMotionReview) tasks.push('拖动确认运动部分、轴心和方向');
      if (needsLimits) tasks.push('填写真实最小/最大角度');
      result.push({
        key: `BLOCKER:DEFAULT_JOINT_TASK:${jointId}`,
        severity: 'BLOCKER', code: 'DEFAULT_JOINT_TASK',
        message: `${joint?.name || jointId}：${tasks.join('，然后')}`,
        target: { type: 'joint', id: jointId, name: joint?.name || jointId },
        actions: [{ id: 'inspect-joint', label: '去检查这个关节' }], evidence: [],
      });
    }
    result.push(...warnings);
  }
  return result;
}

function renderRigidGroups() {
  rigidGroupEditorElement.replaceChildren();
  for (const group of stepEditor.model.rigidGroups) {
    const card = document.createElement('div');
    card.className = 'group-card';
    card.dataset.groupId = group.id;
    const heading = document.createElement('label');
    heading.innerHTML = `<input type="checkbox" class="merge-group" value="${group.id}" /> 合并选择 | ${group.occurrenceIds.length} occurrences`;
    const root = document.createElement('label');
    root.innerHTML = `<input type="radio" name="root-link" value="${group.id}" ${stepEditor.model.rootLinkId === group.id ? 'checked' : ''}/> 根 Link`;
    root.querySelector('input').addEventListener('change', () => { stepEditor.setRoot(group.id); renderGenericEditor(); });
    const name = document.createElement('label');
    name.textContent = 'Link 名称';
    const nameInput = document.createElement('input');
    nameInput.value = group.name;
    nameInput.addEventListener('change', () => { try { stepEditor.renameLink(group.id, nameInput.value); renderGenericEditor(); notificationService.success({ title: 'Link 名称已更新', whatHappened: `${group.name} 已重命名`, impact: 'RobotModel 与预览保持同步', recommendation: '继续处理当前任务' }); } catch (error) { notificationService.unexpected(error, { title: 'Link 重命名失败', impact: '原名称保持不变', recommendation: '使用唯一且符合 URDF 规则的名称', recoverability: 'UNDO_OR_RETRY' }); } });
    name.appendChild(nameInput);
    const density = document.createElement('label');
    density.textContent = '材料密度 kg/m³（正式导出必填）';
    const densityInput = document.createElement('input');
    densityInput.type = 'number';
    densityInput.min = '0';
    densityInput.step = '1';
    densityInput.placeholder = '例如 PLA 1240；必须由用户确认';
    densityInput.value = Number.isFinite(group.densityKgPerCubicMeter) ? group.densityKgPerCubicMeter : '';
    densityInput.addEventListener('change', () => {
      stepEditor.change(model => { model.rigidGroups.find(item => item.id === group.id).densityKgPerCubicMeter = Number(densityInput.value); });
      refreshGenericValidation();
    });
    density.appendChild(densityInput);
    card.append(heading, root, name, density);
    const definitionIds = [...new Set(group.occurrenceIds
      .map(id => stepAssembly.occurrences.find(item => item.id === id)?.definitionId)
      .filter(Boolean))];
    if (definitionIds.length) {
      const overrides = document.createElement('details');
      overrides.className = 'advanced-only';
      const summary = document.createElement('summary');
      summary.textContent = '按 STEP 零件定义设置材料密度';
      overrides.appendChild(summary);
      for (const definitionId of definitionIds) {
        const definition = stepAssembly.definitions.find(item => item.id === definitionId);
        const label = document.createElement('label');
        label.textContent = `${definition?.name || definitionId}（kg/m³）`;
        const input = document.createElement('input');
        input.type = 'number'; input.min = '0'; input.step = '1';
        input.value = stepEditor.model.definitionDensities?.[definitionId]?.value || '';
        input.addEventListener('change', () => {
          stepEditor.change(model => {
            model.definitionDensities ||= {};
            const value = Number(input.value);
            if (Number.isFinite(value) && value > 0) model.definitionDensities[definitionId] = { value, source: 'user_definition_density' };
            else delete model.definitionDensities[definitionId];
          });
          refreshGenericValidation();
        });
        label.appendChild(input); overrides.appendChild(label);
      }
      card.appendChild(overrides);
    }
    if (group.occurrenceIds.length > 1) {
      for (const occurrenceId of group.occurrenceIds) {
        const split = document.createElement('button');
        split.type = 'button';
        split.textContent = `拆出 ${occurrenceId}`;
        split.addEventListener('click', () => { stepEditor.splitOccurrence(group.id, occurrenceId, `${group.name}_split`); renderGenericEditor(); });
        card.appendChild(split);
      }
    }
    rigidGroupEditorElement.appendChild(card);
  }
}

function renderGenericJoints() {
  genericJointEditorElement.replaceChildren();
  const motionReviewComplete = joint => [0, 5, -5].every(value => joint.motionVerification?.posesTestedDegrees?.includes(value))
    && ['movingPartsCorrect', 'pivotCorrect', 'directionCorrect'].every(key => joint.motionVerification?.[key] === true);
  const activeJointId = stepEditor.model.joints.find(item => item.reviewRequired === true || !item.confirmation?.axis || !item.confirmation?.topology || !item.confirmation?.movingSide || !motionReviewComplete(item))?.id
    || stepEditor.model.joints[0]?.id;
  for (const [jointIndex, joint] of stepEditor.model.joints.entries()) {
    const card = document.createElement('div');
    const view = jointCardCopy(joint, jointIndex + 1, stepEditor.model.joints.length);
    card.className = `generic-joint-card ${joint.id === activeJointId ? 'is-active' : 'is-summary'}`;
    card.dataset.jointId = joint.id;
    const parent = stepEditor.model.rigidGroups.find(group => group.id === joint.parentLinkId)?.name;
    const child = stepEditor.model.rigidGroups.find(group => group.id === joint.childLinkId)?.name;
    const lower = Number.isFinite(joint.limits?.lowerRadians) ? (joint.limits.lowerRadians * RAD2DEG).toFixed(2) : '未填';
    const upper = Number.isFinite(joint.limits?.upperRadians) ? (joint.limits.upperRadians * RAD2DEG).toFixed(2) : '未填';
    const evidenceText = Array.isArray(joint.evidence) ? joint.evidence.join('；') : Object.entries(joint.evidence || {}).map(([key, value]) => `${key}: ${value}`).join('；');
    const reviewed = joint.reviewRequired !== true && joint.confirmation?.axis && joint.confirmation?.topology && joint.confirmation?.movingSide && motionReviewComplete(joint);
    const actuationMode = joint.actuationMode || 'direct';
    card.innerHTML = `
      <div class="joint-review-heading">
        <strong><span aria-hidden="true">${view.icon}</span> ${view.title} <small>${view.name}</small></strong>
        <span class="review-badge ${reviewed ? 'reviewed' : 'pending'}">${reviewed ? '✅ 已确认' : '👀 待检查'}</span>
      </div>
      <small>${parent} → ${child}</small>
      <p class="plain-question">${view.question}</p>
      <details class="evidence-details"><summary>为什么软件这样识别？</summary><p class="confidence confidence-${String(joint.confidence || 'LOW').toLowerCase()}">${joint.confidence || 'LOW'}：${evidenceText || '尚无识别依据'}</p></details>
      <small class="advanced-only">axis ${joint.axis.map(value => value.toFixed(6)).join(' ')} | origin ${joint.originMeters.map(value => value.toFixed(6)).join(' ')}</small>`;
    const nameInput = document.createElement('input');
    nameInput.className = 'advanced-only';
    nameInput.value = joint.name;
    nameInput.title = 'Joint 名称';
    nameInput.addEventListener('change', () => { stepEditor.renameJoint(joint.id, nameInput.value); renderGenericEditor(); });
    const parentSelect = document.createElement('select');
    const childSelect = document.createElement('select');
    parentSelect.className = childSelect.className = 'advanced-only';
    for (const group of stepEditor.model.rigidGroups) {
      for (const select of [parentSelect, childSelect]) {
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.name;
        select.appendChild(option);
      }
    }
    parentSelect.value = joint.parentLinkId;
    childSelect.value = joint.childLinkId;
    const applyTopology = () => { stepEditor.setJointTopology(joint.id, parentSelect.value, childSelect.value); refreshGenericEditorAndPreview(); };
    parentSelect.addEventListener('change', applyTopology);
    childSelect.addEventListener('change', applyTopology);
    const swap = document.createElement('button');
    swap.type = 'button';
    swap.className = 'advanced-only';
    swap.textContent = '高级：交换 Parent / Child';
    swap.addEventListener('click', () => { stepEditor.setJointTopology(joint.id, joint.childLinkId, joint.parentLinkId); refreshGenericEditorAndPreview(); });
    const lowerInput = document.createElement('input');
    const upperInput = document.createElement('input');
    lowerInput.type = upperInput.type = 'number';
    lowerInput.className = 'joint-lower';
    upperInput.className = 'joint-upper';
    lowerInput.step = upperInput.step = '0.1';
    lowerInput.placeholder = '最小角度°';
    upperInput.placeholder = '最大角度°';
    lowerInput.value = lower === '未填' ? '' : lower;
    upperInput.value = upper === '未填' ? '' : upper;
    const applyLimits = document.createElement('button');
    applyLimits.type = 'button';
    applyLimits.textContent = '保存真实角度范围';
    applyLimits.addEventListener('click', () => {
      try { stepEditor.setJointLimitsDegrees(joint.id, Number(lowerInput.value), Number(upperInput.value)); renderGenericEditor(); }
      catch (error) { genericValidationElement.textContent = error.message; }
    });
    const effortInput = document.createElement('input');
    const velocityInput = document.createElement('input');
    effortInput.type = velocityInput.type = 'number';
    effortInput.min = velocityInput.min = '0';
    effortInput.step = velocityInput.step = '0.01';
    effortInput.placeholder = '最大 effort（执行器单位）';
    velocityInput.placeholder = '最大 velocity（rad/s）';
    effortInput.value = Number.isFinite(joint.dynamics?.effort) ? joint.dynamics.effort : '';
    velocityInput.value = Number.isFinite(joint.dynamics?.velocity) ? joint.dynamics.velocity : '';
    const applyDynamics = document.createElement('button');
    applyDynamics.type = 'button';
    applyDynamics.textContent = '保存执行器 effort / velocity';
    applyDynamics.addEventListener('click', () => {
      try { stepEditor.setJointDynamics(joint.id, Number(effortInput.value), Number(velocityInput.value)); renderGenericEditor(); }
      catch (error) { genericValidationElement.textContent = error.message; }
    });
    const reverse = document.createElement('button');
    reverse.type = 'button';
    reverse.textContent = '方向相反：反转正负方向';
    reverse.addEventListener('click', () => { stepEditor.reverseJointAxis(joint.id); refreshGenericEditorAndPreview(); });
    const useSelectedAxis = document.createElement('button');
    useSelectedAxis.type = 'button';
    useSelectedAxis.textContent = '应用刚才选中的圆柱面/圆边';
    useSelectedAxis.addEventListener('click', () => {
      try {
        if (!selectedAxisCandidate) throw new Error('请先点击真正的旋转圆柱面或圆边');
        stepEditor.setJointAxis(joint.id, {
          originMeters: selectedAxisCandidate.originMeters,
          axis: selectedAxisCandidate.axis,
          evidence: selectedAxisCandidate.edgeId
            ? { edgeId: selectedAxisCandidate.edgeId, geometryType: 'circle' }
            : { faceId: selectedAxisCandidate.faceId, geometryType: 'cylinder' },
          source: selectedAxisCandidate.edgeId ? 'user_selected_brep_edge' : 'user_selected_brep_face',
        });
        refreshGenericEditorAndPreview();
      } catch (error) { genericValidationElement.textContent = error.message; }
    });
    const restoreTemplate = document.createElement('button');
    restoreTemplate.type = 'button';
    restoreTemplate.textContent = '恢复这个实例的模板轴';
    restoreTemplate.hidden = !joint.templateId;
    restoreTemplate.addEventListener('click', () => {
      try {
        const template = stepEditor.model.servoTemplates?.find(item => item.templateId === joint.templateId);
        const occurrence = stepAssembly.occurrences.find(item => item.id === joint.actuatorOccurrenceId);
        if (!template || !occurrence) throw new Error('这个关节没有可恢复的舵机模板');
        const worldPort = localPortToWorld(template.outputPort, occurrence.sourceTransformMeters);
        stepEditor.setJointAxis(joint.id, {
          originMeters: worldPort.interfaceCenter, axis: worldPort.axisLine.direction,
          evidence: { templateId: template.templateId, restoredByUser: true }, source: 'user_restored_servo_template',
        });
        stepEditor.change(model => { model.joints.find(item => item.id === joint.id).overrides = {}; });
        refreshGenericEditorAndPreview();
      } catch (error) { genericValidationElement.textContent = error.message; }
    });
    const updateTemplate = document.createElement('button');
    updateTemplate.type = 'button';
    updateTemplate.textContent = '将当前选轴更新为模板并应用全部';
    updateTemplate.hidden = !joint.templateId;
    updateTemplate.addEventListener('click', () => {
      try {
        if (!selectedAxisCandidate) throw new Error('请先选择当前实例真正的输出面或圆边');
        const selectedOccurrence = stepAssembly.occurrences.find(item => item.id === selectedAxisCandidate.occurrenceId);
        if (!selectedOccurrence || selectedOccurrence.id !== joint.actuatorOccurrenceId) throw new Error('选中的轴必须属于当前舵机实例');
        const local = worldAxisToLocal({ origin: selectedAxisCandidate.originMeters, direction: selectedAxisCandidate.axis }, selectedOccurrence.sourceTransformMeters);
        stepEditor.change(model => {
          const template = model.servoTemplates.find(item => item.templateId === joint.templateId);
          template.outputPort.axisLine = local;
          template.outputPort.interfaceCenter = [...local.origin];
          template.outputPort.selectedFaceIds = selectedAxisCandidate.faceId ? [selectedAxisCandidate.faceId] : [];
          template.outputPort.selectedEdgeIds = selectedAxisCandidate.edgeId ? [selectedAxisCandidate.edgeId] : [];
          template.lastModifiedBy = 'user';
          for (const targetJoint of model.joints.filter(item => item.templateId === joint.templateId)) {
            const occurrence = stepAssembly.occurrences.find(item => item.id === targetJoint.actuatorOccurrenceId);
            const world = localPortToWorld(template.outputPort, occurrence.sourceTransformMeters);
            targetJoint.originMeters = world.interfaceCenter;
            targetJoint.axis = world.axisLine.direction;
            targetJoint.overrides = {};
            targetJoint.reviewRequired = true;
            targetJoint.confirmation.axis = false;
            targetJoint.source = 'user_updated_servo_template';
            targetJoint.lastModifiedBy = 'user';
          }
        });
        refreshGenericEditorAndPreview();
      } catch (error) { genericValidationElement.textContent = error.message; }
    });
    const chooseAxis = document.createElement('button');
    chooseAxis.type = 'button';
    chooseAxis.textContent = '旋转中心不对：重新选择轴';
    chooseAxis.addEventListener('click', () => startAxisCorrection(joint));
    const direct = document.createElement('button');
    direct.type = 'button';
    direct.className = `actuation-choice ${actuationMode === 'direct' ? 'selected' : ''}`;
    direct.textContent = '主动驱动：舵机本体固定，输出盘带动手臂';
    direct.addEventListener('click', () => {
      try { stepEditor.setJointActuationMode(joint.id, 'direct'); refreshGenericEditorAndPreview(); }
      catch (error) { genericValidationElement.textContent = error.message; }
    });
    const reaction = document.createElement('button');
    reaction.type = 'button';
    reaction.className = `actuation-choice ${actuationMode === 'reaction' ? 'selected' : ''}`;
    reaction.textContent = '反作用驱动：输出端固定，舵机本体带着结构转动';
    reaction.addEventListener('click', () => {
      try { stepEditor.setJointActuationMode(joint.id, 'reaction'); refreshGenericEditorAndPreview(); }
      catch (error) { genericValidationElement.textContent = error.message; }
    });
    const motionReview = document.createElement('div');
    motionReview.className = 'motion-review-grid';
    if (reviewed) {
      motionReview.textContent = joint.verificationStatus === 'TEMPLATE_VERIFIED' ? '✓ 模板接口与拓扑签名一致，无需逐实例重复确认' : '✓ 已完成三姿态运动验证';
    } else {
      const poseHint = document.createElement('p');
      poseHint.textContent = '依次查看三个姿态，每次只让当前关节运动：';
      const poseButtons = document.createElement('div'); poseButtons.className = 'toolbar';
      for (const degrees of [0, 5, -5]) {
        const poseLabels = { 0: '⏺️ 0°', 5: '↗️ +5°', '-5': '↙️ -5°' };
        const poseAriaLabels = { 0: '回到初始位置', 5: '向一个方向小幅转动', '-5': '向另一个方向小幅转动' };
        const button = document.createElement('button'); button.type = 'button'; button.textContent = poseLabels[degrees];
        button.setAttribute('aria-label', poseAriaLabels[degrees]);
        button.title = `内部测试角度 ${degrees > 0 ? '+' : ''}${degrees}°`;
        button.classList.toggle('selected', joint.motionVerification?.posesTestedDegrees?.includes(degrees));
        button.addEventListener('click', () => {
          setGenericSingleJointDegrees(joint.id, degrees);
          stepEditor.recordJointReviewPose(joint.id, degrees);
          button.classList.add('selected');
        });
        poseButtons.appendChild(button);
      }
      const aspectButtons = document.createElement('div'); aspectButtons.className = 'motion-aspects';
      for (const [aspect, text, shortText] of [['movingPartsCorrect', '运动零件正确', '🤖 运动'], ['pivotCorrect', '轴心正确', '⭕ 轴心'], ['directionCorrect', '方向正确', '➡️ 方向']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = joint.motionVerification?.[aspect] ? `✅ ${shortText}` : shortText;
        button.setAttribute('aria-label', text);
        button.classList.toggle('selected', joint.motionVerification?.[aspect]);
        button.addEventListener('click', () => {
          stepEditor.confirmJointMotionAspect(joint.id, aspect);
          const updated = stepEditor.model.joints.find(item => item.id === joint.id);
          if (updated.verificationStatus === 'USER_VERIFIED') renderGenericEditor();
          else { button.classList.add('selected'); button.textContent = `✅ ${shortText}`; }
        });
        aspectButtons.appendChild(button);
      }
      motionReview.append(poseHint, poseButtons, aspectButtons);
    }
    const originInputs = joint.originMeters.map((value, index) => {
      const input = document.createElement('input');
      input.type = 'number'; input.step = '0.000001'; input.value = value;
      input.className = `advanced-only joint-origin-${'xyz'[index]}`;
      input.title = `Joint origin ${'xyz'[index]} (m)`;
      return input;
    });
    const applyOrigin = document.createElement('button');
    applyOrigin.type = 'button'; applyOrigin.className = 'advanced-only'; applyOrigin.textContent = '应用 origin xyz';
    applyOrigin.addEventListener('click', () => {
      try { stepEditor.setJointOrigin(joint.id, originInputs.map(input => Number(input.value))); renderGenericEditor(); }
      catch (error) { genericValidationElement.textContent = error.message; }
    });
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'danger'; remove.textContent = '自动多识别了：删除这个关节';
    remove.addEventListener('click', () => {
      if (window.confirm(`确定删除关节 ${joint.name}？可以使用“撤销”恢复。`)) { stepEditor.deleteJoint(joint.id); renderGenericEditor(); }
    });
    {
      const previewJointAvailable = Boolean(genericPreviewRobot?.joints?.[joint.name]);
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'generic-joint-slider';
      slider.dataset.jointId = joint.id;
      slider.setAttribute('aria-label', `${joint.name} 角度`);
      slider.min = Number.isFinite(joint.limits?.lowerRadians) ? joint.limits.lowerRadians * RAD2DEG : -20;
      slider.max = Number.isFinite(joint.limits?.upperRadians) ? joint.limits.upperRadians * RAD2DEG : 20;
      slider.step = '0.1';
      slider.value = '0';
      slider.disabled = !previewJointAvailable;
      slider.addEventListener('input', () => setGenericSingleJointDegrees(joint.id, slider.value));
      const output = document.createElement('output');
      output.value = '0.0°';
      const hint = document.createElement('small');
      hint.textContent = previewJointAvailable
        ? '用鼠标按住蓝色滑块圆点，左右拖动；也可以点击滑条位置。'
        : '当前运动预览尚未生成，所以暂时不能拖动。请点“重新生成运动预览”并按错误提示修复结构。';
      const sliderRow = document.createElement('div');
      sliderRow.className = 'joint-slider-row';
      sliderRow.append(slider, output);
      card.append(sliderRow, hint);
    }
    card.appendChild(motionReview);
    const correction = document.createElement('details');
    correction.className = 'joint-correction';
    const correctionSummary = document.createElement('summary');
    correctionSummary.textContent = '🛠️ 转动不对';
    const modeQuestion = document.createElement('p');
    modeQuestion.textContent = '舵机应该怎样带动这一侧？';
    const axisHint = document.createElement('p');
    axisHint.className = 'why-note';
    axisHint.textContent = '换驱动方式会改变舵机本体属于固定侧还是运动侧，不会随意翻转整棵机器人树。';
    correction.append(correctionSummary, modeQuestion, direct, reaction, axisHint, chooseAxis, useSelectedAxis, updateTemplate, restoreTemplate, reverse, swap, remove);
    card.appendChild(correction);
    const limits = document.createElement('details');
    limits.className = 'joint-limits-section';
    const limitsSummary = document.createElement('summary');
    limitsSummary.textContent = joint.confirmation?.limits
      ? `真实角度范围：${lower}° 到 ${upper}°`
      : '📐 填写真实角度';
    limits.append(limitsSummary, lowerInput, upperInput, applyLimits);
    const dynamics = document.createElement('details');
    dynamics.className = 'joint-limits-section advanced-only';
    const dynamicsSummary = document.createElement('summary');
    dynamicsSummary.textContent = joint.dynamics?.source === 'user'
      ? `执行器参数：effort ${joint.dynamics.effort}，velocity ${joint.dynamics.velocity}`
      : '填写执行器 effort / velocity（正式导出必填）';
    dynamics.append(dynamicsSummary, effortInput, velocityInput, applyDynamics);
    card.appendChild(limits);
    card.appendChild(dynamics);
    card.append(nameInput, parentSelect, childSelect, ...originInputs, applyOrigin);
    genericJointEditorElement.appendChild(card);
  }
}

function refreshGenericEditorAndPreview() {
  renderGenericEditor();
  if (genericPreviewRobot) {
    mountGenericPreview().catch(error => {
      genericValidationElement.dataset.state = 'failed';
      genericValidationElement.textContent = `运动预览更新失败：${error.message || error}`;
    });
  }
}

function startAxisCorrection(joint) {
  const tools = document.getElementById('axis-correction-tools');
  tools.open = true;
  if (genericPreviewRobot) genericPreviewRobot.removeFromParent();
  if (stepPreviewGroup && !stepPreviewGroup.parent) scene.add(stepPreviewGroup);
  selectStepOccurrence(joint.actuatorOccurrenceId);
  fitRobot(stepPreviewGroup);
  tools.scrollIntoView({ behavior: 'smooth', block: 'center' });
  stepFeatureSummaryElement.textContent = `⭕ ${joint.name}：请选择圆柱面或圆边`;
}

function renderGenericEditor() {
  renderRigidGroups();
  updateNewJointSelectors();
  renderGenericJoints();
  refreshGenericValidation();
  const reviewed = stepEditor.model.joints.filter(joint => joint.reviewRequired !== true && joint.confirmation?.axis && joint.confirmation?.topology && joint.confirmation?.movingSide).length;
  const total = stepEditor.model.joints.length;
  reviewProgressElement.textContent = reviewed === total
    ? `✅ ${total}/${total} 个关节已确认`
    : `🎚️ ${reviewed}/${total} 已确认`;
  reviewProgressElement.dataset.state = reviewed === total ? 'ready' : 'pending';
  if (stepAssembly?.source?.sha256 && stepEditor) {
    const saved = saveProjectCheckpoint(localStorage, stepAssembly.source.sha256, { model: stepEditor.model, workflow: workflowController.state, mode: workflowController.state.mode, notifications: notificationService.list(), metadata: { jobId: activeStepJobId, automationEngineVersion: stepEditor.model.automation?.engineVersion } });
    autosaveStatusElement.textContent = `已自动保存检查点 ${new Date(saved.savedAt).toLocaleTimeString()}`;
  }
}

function renderStepAssemblyList() {
  stepAssemblyListElement.replaceChildren();
  for (const occurrence of stepAssembly.occurrences) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'assembly-item';
    button.dataset.occurrenceId = occurrence.id;
    button.innerHTML = `<span>${occurrence.name}</span><small>${occurrence.kind}</small>`;
    button.addEventListener('click', () => selectStepOccurrence(occurrence.id));
    stepAssemblyListElement.appendChild(button);
  }
}

function highlightServoDefinition(definitionId, includedIds = null) {
  const included = includedIds ? new Set(includedIds) : null;
  for (const mesh of stepPreviewGroup?.children || []) {
    mesh.visible = true;
    const isFamily = mesh.userData.definitionId === definitionId;
    const isIncluded = !included || included.has(mesh.userData.occurrenceId);
    mesh.material.emissive.setHex(isFamily && isIncluded ? 0x5c4400 : 0x000000);
    mesh.material.emissiveIntensity = isFamily && isIncluded ? 0.85 : 0;
    mesh.material.opacity = isFamily ? 1 : 0.24;
    mesh.material.transparent = !isFamily;
  }
}

function templateCandidateWithLocalAxis(candidate, index) {
  if (candidate.outputAxisLocal) return candidate;
  const first = stepCandidates.jointCandidates.find(item => item.definitionId === candidate.definitionId)
    || stepCandidates.jointCandidates.find(item => candidate.instanceIds?.includes(item.actuatorOccurrenceId));
  const occurrence = stepAssembly.occurrences.find(item => item.id === first?.actuatorOccurrenceId);
  if (!first || !occurrence) throw new Error(`候选 ${candidate.definitionId} 缺少可转换的局部输出轴`);
  const local = worldAxisToLocal({ origin: first.originMeters, direction: first.axis }, occurrence.sourceTransformMeters);
  return {
    ...candidate,
    instanceIds: candidate.instanceIds || stepAssembly.occurrences.filter(item => item.definitionId === candidate.definitionId).map(item => item.id),
    outputAxisLocal: local,
    outputFaceId: first.axisFaceId || null,
  };
}

async function finishServoTemplateStage() {
  const confirmed = servoTemplates.filter(item => ['confirmed_all', 'confirmed_partial'].includes(item.status?.identityStatus) && item.status?.outputPortStatus === 'user_confirmed' && item.status?.topologyPatternStatus === 'taught');
  const inference = runKinematicInference({
    assembly: stepAssembly,
    analysisCandidates: stepCandidates,
    confirmedTemplates: confirmed,
    jobId: activeStepJobId,
  });
  const templateCandidates = inference.candidates;
  stepCandidates = {
    ...stepCandidates,
    jointCandidates: templateCandidates,
    servoTemplates: confirmed,
    servoInstances: inference.model.servoInstances,
    contactRigidGroups: inference.rigidGroups,
    kinematicSolver: inference.solver,
  };
  const automaticDraft = inference.model;
  const savedCheckpoint = loadProjectCheckpoint(localStorage, stepAssembly.source.sha256);
  const savedSnapshot = savedCheckpoint?.model;
  const recovered = savedSnapshot?.automation?.engineVersion === automaticDraft.automation.engineVersion ? savedSnapshot : null;
  if (recovered) recovered.jobId = activeStepJobId;
  stepEditor = new RobotEditor(recovered || automaticDraft);
  if (recovered && savedCheckpoint?.workflow) workflowController.update(savedCheckpoint.workflow);
  else workflowController.transition('REVIEW', { completedStage: 'RESULTS', counts: { blockers: stepEditor.model.automation.candidatesSkipped, automaticPassed: templateCandidates.filter(item => item.verificationStatus === 'TEMPLATE_VERIFIED').length } });
  renderStepAssemblyList();
  renderGenericEditor();
  servoTemplateStageElement.hidden = true;
  stepInspectorElement.hidden = false;
  const high = templateCandidates.filter(item => item.confidence === 'HIGH').length;
  const unresolved = inference.anomalies.length;
  stepFeatureSummaryElement.textContent = `🦾 ${templateCandidates.length} 个舵机 · 🎚️ ${stepEditor.model.joints.length} 个关节 · ${unresolved ? `🔴 ${unresolved}` : '✅'}`;
  try { await mountGenericPreview(); } catch (error) {
    statusElement.textContent = `批量轴已应用，但整机预览还需修复拓扑：${error.message || error}`;
  }
  statusElement.textContent = `🟢 ${high} · 🟡 ${templateCandidates.length - high - unresolved} · 🔴 ${unresolved}`;
  runtime.ready = true;
  if (unresolved === 0 && workflowController.state.currentStage === 'REVIEW') {
    workflowController.transition('MOTION_TEST', { completedStage: 'REVIEW' });
  }
  notificationService.success({ title: '相同舵机设置已批量应用', whatHappened: `${templateCandidates.length} 个实例已获得相同的输出端设置`, impact: unresolved ? `${unresolved} 个不同实例仍会阻止导出` : '可以进入运动测试与真实限位填写', recommendation: unresolved ? '先处理异常队列中的阻止项' : '依次检查初始位置和两个方向的小幅转动' });
  publishDiagnostics();
}

function renderServoTemplateCard() {
  servoTemplateCardsElement.replaceChildren();
  const template = servoTemplates[activeServoTemplateIndex];
  if (!template) {
    const empty = document.createElement('div');
    empty.className = 'servo-confirm-card';
    empty.innerHTML = '<h2>没有找到可批量确认的重复舵机零件</h2><p>软件不会静默猜测。可以继续到高级工具逐个建立候选。</p>';
    const continueButton = document.createElement('button');
    continueButton.textContent = '继续人工检查';
    continueButton.addEventListener('click', finishServoTemplateStage);
    empty.appendChild(continueButton);
    servoTemplateCardsElement.appendChild(empty);
    return;
  }
  highlightServoDefinition(template.definitionId, template.instanceIds.filter(id => !template.excludedInstanceIds.includes(id)));
  const card = document.createElement('article');
  card.className = 'servo-confirm-card';
  const view = servoCardCopy(template, { instances: template.instanceIds.length });
  const identityConfirmed = ['confirmed_all', 'confirmed_partial'].includes(template.status?.identityStatus);
  const outputConfirmed = template.status?.outputPortStatus === 'user_confirmed';
  const evidence = template.evidence.map(item => `<li>${item}</li>`).join('');
  card.innerHTML = `
    <div class="card-step">${activeServoTemplateIndex + 1}/${servoTemplates.length}</div>
    <h2><span aria-hidden="true">${view.icon}</span> ${view.title}</h2>
    <p><strong>${view.name}</strong> · ${view.summary}</p>
    <div class="confidence confidence-${template.confidence.toLowerCase()}">${template.confidence === 'HIGH' ? '🟢 很像舵机' : template.confidence === 'MEDIUM' ? '🟡 建议看一下' : '🔴 无法确定'}</div>
    <details><summary>为什么这样判断？</summary><ul>${evidence}</ul><code class="advanced-only">${template.geometryFingerprint || '旧分析结果尚无指纹'}</code></details>
    <div class="toolbar identity-actions"></div>
    <details class="instance-picker"><summary>其中只有部分实例是舵机</summary><div class="instance-checks"></div></details>
    <section class="servo-focus-section axis-section" ${identityConfirmed ? '' : 'hidden'}>
      <h2>⭕ 输出端正确吗？</h2>
      <p>看黄色箭头</p>
      <div class="toolbar axis-actions"></div>
      <p class="template-axis-readout advanced-only">接口中心 ${template.outputPort.interfaceCenter.map(v => v.toFixed(6)).join(', ')} m；轴线方向 ${template.outputPort.axisLine.direction.map(v => v.toFixed(6)).join(', ')}</p>
    </section>
    <section class="servo-focus-section topology-section" ${outputConfirmed ? '' : 'hidden'}>
      <h2>🔄 运动部分正确吗？</h2>
      <p>确认一个，自动应用全部</p>
      <div class="topology-teach"></div>
    </section>
  `;
  const identityActions = card.querySelector('.identity-actions');
  const yes = document.createElement('button'); yes.textContent = '✅ 是'; yes.setAttribute('aria-label', '是，这是舵机');
  const no = document.createElement('button'); no.textContent = '❌ 不是'; no.setAttribute('aria-label', '不是舵机');
  const isolate = document.createElement('button'); isolate.textContent = '👁️ 单独看'; isolate.setAttribute('aria-label', '独立预览这个零件');
  let isolated = false;
  isolate.addEventListener('click', () => {
    isolated = !isolated;
    const representativeId = template.instanceIds.find(id => !template.excludedInstanceIds.includes(id));
    for (const mesh of stepPreviewGroup.children) mesh.visible = !isolated || mesh.userData.occurrenceId === representativeId;
    if (isolated) fitRobot(stepPreviewGroup.children.find(mesh => mesh.userData.occurrenceId === representativeId)); else fitRobot(stepPreviewGroup);
    isolate.textContent = isolated ? '返回整机实例位置' : '独立预览这个零件';
  });
  const replace = document.createElement('button'); replace.textContent = '🎯 换一个'; replace.setAttribute('aria-label', '用当前选中零件重新识别');
  replace.addEventListener('click', () => {
    const occurrence = stepAssembly.occurrences.find(item => item.id === selectedOccurrenceId);
    if (!occurrence || occurrence.definitionId === template.definitionId) { statusElement.textContent = '请先在三维整机或零件列表点击另一种零件，再点此按钮。'; return; }
    const siblings = stepAssembly.occurrences.filter(item => item.kind === 'part' && item.definitionId === occurrence.definitionId);
    const face = stepFeatures.faces.find(item => item.id.startsWith(`${occurrence.definitionId}/face/`) && item.cylinder);
    if (!face) { statusElement.textContent = '这个零件没有精确圆柱面，请使用圆边或两点轴的高级工具。'; return; }
    servoTemplates[activeServoTemplateIndex] = createServoTemplate({
      definitionId: occurrence.definitionId, displayName: occurrence.name, geometryFingerprint: `user-selected:${occurrence.definitionId}`,
      instanceIds: siblings.map(item => item.id), outputAxisLocal: { origin: face.cylinder.originMeters, direction: face.cylinder.axis },
      outputFaceId: face.id, confidence: 'LOW', evidence: ['user replaced the automatically suggested servo definition'],
    }, activeServoTemplateIndex);
    renderServoTemplateCard();
  });
  identityActions.append(yes, no, isolate, replace);
  const checks = card.querySelector('.instance-checks');
  for (const id of template.instanceIds) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${id}" ${template.excludedInstanceIds.includes(id) ? '' : 'checked'} /> ${id}`;
    checks.appendChild(label);
  }
  const syncInstances = () => {
    servoTemplates[activeServoTemplateIndex] = setTemplateInstances(template, [...checks.querySelectorAll('input:checked')].map(item => item.value));
    renderServoTemplateCard();
  };
  checks.addEventListener('change', syncInstances);
  yes.addEventListener('click', () => {
    servoTemplates[activeServoTemplateIndex] = setTemplateInstances(template, template.instanceIds.filter(id => !template.excludedInstanceIds.includes(id)));
    renderServoTemplateCard();
  });
  no.addEventListener('click', () => {
    servoTemplates[activeServoTemplateIndex] = { ...template, status: { ...template.status, identityStatus: 'rejected' }, lastModifiedBy: 'user' };
    activeServoTemplateIndex += 1;
    renderServoTemplateCard();
  });
  const axisActions = card.querySelector('.axis-actions');
  const acceptAxis = document.createElement('button'); acceptAxis.textContent = '✅ 正确'; acceptAxis.setAttribute('aria-label', '输出接口正确，进入代表实例教学');
  const reselect = document.createElement('button'); reselect.textContent = '🎯 重新选'; reselect.setAttribute('aria-label', '使用我选中的面/圆边');
  const reverse = document.createElement('button'); reverse.textContent = '↔️ 反向'; reverse.setAttribute('aria-label', '反转轴方向');
  axisActions.append(acceptAxis, reselect, reverse);
  acceptAxis.disabled = !identityConfirmed;
  reselect.disabled = !identityConfirmed;
  reverse.disabled = !identityConfirmed;
  const representative = template.instanceIds.find(id => !template.excludedInstanceIds.includes(id));
  if (representative) selectStepOccurrence(representative);
  acceptAxis.addEventListener('click', async () => {
    if (!identityConfirmed) { statusElement.textContent = '请先确认这种零件是否为舵机；确认输出接口不会隐式确认舵机身份。'; return; }
    const next = chooseTemplateAxis(template, template.outputPort.axisLine, { interfaceCenter: template.outputPort.interfaceCenter, faceId: template.outputPort.selectedFaceIds?.[0], edgeId: template.outputPort.selectedEdgeIds?.[0], source: 'user_confirmed_automatic_brep_axis' });
    servoTemplates[activeServoTemplateIndex] = next;
    renderServoTemplateCard();
  });
  reselect.addEventListener('click', async () => {
    if (!identityConfirmed) { statusElement.textContent = '请先确认这种零件是否为舵机。'; return; }
    if (!selectedAxisCandidate) { statusElement.textContent = '请先在三维视图或下方候选列表点击真正的输出圆柱面/圆边。'; return; }
    const occurrence = stepAssembly.occurrences.find(item => item.id === selectedAxisCandidate.occurrenceId);
    const local = worldAxisToLocal({ origin: selectedAxisCandidate.originMeters, direction: selectedAxisCandidate.axis }, occurrence.sourceTransformMeters);
    const next = chooseTemplateAxis(template, local, { faceId: selectedAxisCandidate.faceId, edgeId: selectedAxisCandidate.edgeId });
    servoTemplates[activeServoTemplateIndex] = next;
    renderServoTemplateCard();
  });
  reverse.addEventListener('click', () => {
    servoTemplates[activeServoTemplateIndex] = { ...template, outputPort: { ...template.outputPort, axisLine: { ...template.outputPort.axisLine, direction: template.outputPort.axisLine.direction.map(v => -v) }, interfaceNormal: template.outputPort.interfaceNormal.map(v => -v) }, lastModifiedBy: 'user' };
    renderServoTemplateCard();
  });
  const topologyTeach = card.querySelector('.topology-teach');
  if (template.status.outputPortStatus !== 'user_confirmed') {
    topologyTeach.innerHTML = '<p class="why-note">先完成上面的舵机身份和输出接口确认，才能教学运动侧。</p>';
  } else {
    const graphEdges = stepAssembly.contactGraph?.edges?.filter(edge => edge.a === representative || edge.b === representative) || [];
    const graphNeighborIds = graphEdges.map(edge => edge.a === representative ? edge.b : edge.a);
    const original = stepCandidates.jointCandidates.find(item => item.actuatorOccurrenceId === representative);
    const fallbackIds = original?.neighborOccurrenceCandidates || [];
    const neighborIds = [...new Set([...graphNeighborIds, ...fallbackIds])].filter(id => id !== representative);
    const suggestion = original?.topologyAlternatives?.[0];
    const rows = document.createElement('div'); rows.className = 'topology-contact-rows';
    for (const id of neighborIds) {
      const occurrence = stepAssembly.occurrences.find(item => item.id === id);
      const label = document.createElement('label');
      const select = document.createElement('select'); select.dataset.occurrenceId = id;
      for (const [value, text] of [['ignore', '忽略/紧固件'], ['housing', '外壳固定侧'], ['output', '输出盘运动侧']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; select.appendChild(option);
      }
      select.value = id === suggestion?.parentOccurrenceId ? 'housing' : id === suggestion?.childOccurrenceId ? 'output' : 'ignore';
      label.append(`${occurrence?.name || id}：`, select); rows.appendChild(label);
    }
    const mode = document.createElement('select'); mode.innerHTML = '<option value="direct">主动驱动：外壳固定</option><option value="reaction">反作用驱动：输出端固定</option>';
    mode.value = template.defaultActuationMode;
    const confirmPattern = document.createElement('button'); confirmPattern.type = 'button'; confirmPattern.textContent = '✅ 应用到全部'; confirmPattern.setAttribute('aria-label', '确认代表实例并批量应用相同拓扑');
    confirmPattern.addEventListener('click', async () => {
      try {
        const selected = [...rows.querySelectorAll('select')];
        const housingOccurrenceIds = selected.filter(item => item.value === 'housing').map(item => item.dataset.occurrenceId);
        const outputOccurrenceIds = selected.filter(item => item.value === 'output').map(item => item.dataset.occurrenceId);
        const pattern = topologyPatternFromRepresentative({ representativeInstanceId: representative, housingOccurrenceIds, outputOccurrenceIds, assembly: stepAssembly, outputPort: template.outputPort, defaultActuationMode: mode.value, ignoredFastenerTypes: ['screw', 'bolt', 'nut', 'washer', 'bearing'] });
        servoTemplates[activeServoTemplateIndex] = teachTopologyPattern(template, pattern);
        activeServoTemplateIndex += 1;
        if (activeServoTemplateIndex < servoTemplates.length) renderServoTemplateCard(); else await finishServoTemplateStage();
      } catch (error) { statusElement.textContent = `代表实例尚未完成：${error.message}`; }
    });
    topologyTeach.append(rows, mode, confirmPattern);
  }
  servoTemplateCardsElement.appendChild(card);
}

async function mountStepAssembly(jobId) {
  stepModeActive = true;
  runtime.ready = false;
  if (stepPreviewGroup) scene.remove(stepPreviewGroup);
  clearStepAxes();
  [stepAssembly, stepFeatures, stepCandidates] = await Promise.all([
    fetch(`/api/step-jobs/${jobId}/artifacts/assembly.json`).then(response => {
      if (!response.ok) throw new Error(`assembly.json HTTP ${response.status}`);
      return response.json();
    }),
    fetch(`/api/step-jobs/${jobId}/artifacts/brep_features.json`).then(response => {
      if (!response.ok) throw new Error(`brep_features.json HTTP ${response.status}`);
      return response.json();
    }),
    fetch(`/api/step-jobs/${jobId}/artifacts/joint_candidates.json`).then(response => {
      if (!response.ok) throw new Error(`joint_candidates.json HTTP ${response.status}`);
      return response.json();
    }),
  ]);
  localStorage.setItem('step-urdf:last-step-job', JSON.stringify({ jobId, sourceSha256: stepAssembly.source?.sha256 || null, savedAt: new Date().toISOString() }));
  const definitions = new Map(stepAssembly.definitions.map(item => [item.id, item]));
  const geometryPromises = new Map();
  const stlLoader = new STLLoader();
  stepPreviewGroup = new THREE.Group();
  stepPreviewGroup.name = 'step-import-preview';
  for (const occurrence of stepAssembly.occurrences.filter(item => item.kind === 'part')) {
    const definition = definitions.get(occurrence.definitionId);
    const renderSpec = occurrenceRenderSpec(occurrence, definition);
    if (!geometryPromises.has(renderSpec.cacheKey)) {
      const url = `/api/step-jobs/${jobId}/artifacts/${renderSpec.meshPath}`;
      geometryPromises.set(renderSpec.cacheKey, stlLoader.loadAsync(url));
    }
    const geometry = await geometryPromises.get(renderSpec.cacheKey);
    geometry.computeVertexNormals();
    const hue = ([...occurrence.id].reduce((sum, char) => sum + char.codePointAt(0), 0) * 47) % 360;
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(`hsl(${hue}, 45%, 68%)`), roughness: 0.72, metalness: 0.05 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = occurrence.name;
    mesh.userData = { occurrenceId: occurrence.id, definitionId: occurrence.definitionId };
    mesh.matrix.copy(new THREE.Matrix4().set(...renderSpec.transformMeters));
    mesh.matrixAutoUpdate = false;
    stepPreviewGroup.add(mesh);
  }
  scene.add(stepPreviewGroup);
  rebuildContactGraphHelpers();
  fitRobot(stepPreviewGroup);
  renderStepAssemblyList();
  stepEditor = null;
  stepInspectorElement.hidden = true;
  const familyCandidates = stepCandidates.servoTemplateCandidates || stepCandidates.suspectedActuatorFamilies || [];
  servoTemplates = familyCandidates.map((candidate, index) => createServoTemplate(templateCandidateWithLocalAxis(candidate, index), index));
  activeServoTemplateIndex = 0;
  servoTemplateStageElement.hidden = false;
  renderServoTemplateCard();
  workflowController.transition('RESULTS', { completedStage: 'ANALYZE', counts: { blockers: 0, warnings: servoTemplates.length, automaticPassed: 0 } });
  const partCount = stepAssembly.occurrences.filter(item => item.kind === 'part').length;
  stepFeatureSummaryElement.innerHTML = `🧩 ${partCount} 个零件 · ${stepAssembly.definitions.length} 种形状<span class="advanced-only"> · 精确几何：${stepFeatures.faces.length} 个面，${stepFeatures.edges.length} 条边</span>`;
  statusElement.textContent = `🤖 ${partCount} 个零件 · 🦾 ${servoTemplates.length} 个舵机候选`;
  notificationService.success({ title: '自动分析完成', whatHappened: `读取了 ${partCount} 个零件和 ${stepAssembly.definitions.length} 种不同形状`, impact: `发现 ${servoTemplates.length} 种可能的舵机，需要确认零件身份和输出端`, recommendation: '查看当前任务卡，只确认一种代表舵机' });
  runtime.ready = false;
  publishDiagnostics();
}

async function analyzeStep() {
  return analyzeStepFile(stepFileElement.files?.[0]);
}

async function analyzeStepFile(file) {
  if (!file) return;
  analyzeStepElement.disabled = true;
  stepFileElement.disabled = true;
  document.getElementById('try-example').disabled = true;
  analyzeStepElement.setAttribute('aria-busy', 'true');
  try {
    workflowController.transition('ANALYZE', { completedStage: 'IMPORT' });
    workflowController.setAnalysisTask('assembly', 'running');
    notificationService.info({ title: '开始自动分析', whatHappened: '正在读取零件、形状和装配连接', impact: '分析完成前不能生成运动结构', recommendation: '等待当前本地任务完成' });
    const created = await createStepJob(file);
    activeStepJobId = created.jobId;
    renderStepJobStatus(created.status);
    const finalStatus = await pollStepJob(activeStepJobId);
    if (finalStatus.state !== 'ready') throw new Error(finalStatus.message || 'STEP 解析失败');
    workflowController.setAnalysisTask('assembly', 'complete');
    workflowController.setAnalysisTask('mechanisms', 'complete');
    workflowController.setAnalysisTask('contacts', 'complete');
    workflowController.setAnalysisTask('tree', 'running');
    await mountStepAssembly(activeStepJobId);
    workflowController.setAnalysisTask('tree', 'complete');
  } catch (error) {
    stepJobStatusElement.dataset.state = 'failed';
    stepJobStatusElement.textContent = `导入失败：${error.message || error}`;
    notificationService.unexpected(error, { title: 'STEP 自动分析失败', possibleCause: '文件结构、单位、后端解析或本地任务异常', impact: '没有覆盖已有工程检查点', recommendation: '检查 STEP 是否为完整装配体后安全重试', recoverability: 'RETRYABLE' });
  } finally {
    analyzeStepElement.disabled = false;
    stepFileElement.disabled = false;
    analyzeStepElement.removeAttribute('aria-busy');
    document.getElementById('try-example').disabled = false;
  }
}

analyzeStepElement.addEventListener('click', analyzeStep);
stepFileElement.addEventListener('change', async () => {
  const file = stepFileElement.files?.[0];
  if (!file) return;
  await analyzeStepFile(file);
});
document.getElementById('try-example').addEventListener('click', async () => {
  try {
    const response = await fetch('/examples/two_joint_servo_arm_ap242.step');
    if (!response.ok) throw new Error(`示例文件 HTTP ${response.status}`);
    const file = new File([await response.blob()], 'two_joint_servo_arm_ap242.step', { type: 'model/step' });
    await analyzeStepFile(file);
  } catch (error) {
    stepJobStatusElement.dataset.state = 'failed';
    stepJobStatusElement.textContent = `示例加载失败：${error.message || error}`;
  }
});

document.getElementById('editor-undo').addEventListener('click', () => { if (stepEditor?.undo()) renderGenericEditor(); });
document.getElementById('editor-redo').addEventListener('click', () => { if (stepEditor?.redo()) renderGenericEditor(); });
document.getElementById('review-next').addEventListener('click', () => {
  const joint = stepEditor?.model.joints.find(item => item.reviewRequired === true || !item.confirmation?.axis || !item.confirmation?.topology || !item.confirmation?.movingSide);
  if (!joint) {
    reviewProgressElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const card = genericJointEditorElement.querySelector(`[data-joint-id="${CSS.escape(joint.id)}"]`);
  card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setGenericSingleJointDegrees(joint.id, 10);
});
document.getElementById('merge-groups').addEventListener('click', () => {
  const selected = [...rigidGroupEditorElement.querySelectorAll('.merge-group:checked')].map(input => input.value);
  try {
    stepEditor.mergeGroups(selected, stepEditor.model.rigidGroups.find(group => group.id === selected[0])?.name || 'merged_link');
    renderGenericEditor();
  } catch (error) {
    genericValidationElement.dataset.state = 'failed';
    genericValidationElement.textContent = error.message;
  }
});

document.getElementById('add-revolute-joint').addEventListener('click', () => {
  try {
    if (!selectedAxisCandidate) throw new Error('请先选择一个圆柱轴候选');
    const parentLinkId = document.getElementById('new-joint-parent').value;
    const childLinkId = document.getElementById('new-joint-child').value;
    stepEditor.addJoint({
      name: document.getElementById('new-joint-name').value,
      parentLinkId,
      childLinkId,
      originMeters: selectedAxisCandidate.originMeters,
      axis: selectedAxisCandidate.axis,
      evidence: { faceId: selectedAxisCandidate.faceId, occurrenceId: selectedAxisCandidate.occurrenceId, source: 'user_selected_brep_candidate' },
    });
    const joint = stepEditor.model.joints.at(-1);
    const lower = Number(document.getElementById('new-joint-lower').value);
    const upper = Number(document.getElementById('new-joint-upper').value);
    if (Number.isFinite(lower) && Number.isFinite(upper) && lower < upper) stepEditor.setJointLimitsDegrees(joint.id, lower, upper);
    document.getElementById('new-joint-name').value = `joint_${stepEditor.model.joints.length + 1}`;
    renderGenericEditor();
  } catch (error) {
    genericValidationElement.dataset.state = 'failed';
    genericValidationElement.textContent = error.message;
  }
});

async function mountGenericPreview() {
  const validation = validateRobotModel(stepEditor.model);
  const previewBlockingErrors = validation.errors.filter(error => !/^Expected exactly one root link, found \d+$/.test(error));
  if (previewBlockingErrors.length) throw new Error(previewBlockingErrors.join('; '));
  const urdf = renderGenericUrdf(stepEditor.model, stepAssembly, {
    robotName: 'step_robot_preview', preview: true, temporaryCollisionFromVisual: false,
    attachPreviewForest: true,
    // URDFLoader resolves filenames against workingPath="/"; keep this
    // relative or it becomes a protocol-relative //api URL.
    meshPrefix: `api/step-jobs/${activeStepJobId}/artifacts/`,
  });
  clearGenericZeroGhost();
  if (stepPreviewGroup) scene.remove(stepPreviewGroup);
  if (genericPreviewRobot) scene.remove(genericPreviewRobot);
  clearStepAxes();
  await new Promise((resolve, reject) => {
    const manager = new THREE.LoadingManager();
    manager.onError = url => reject(new Error(`Preview mesh failed: ${url}`));
    manager.onLoad = resolve;
    const loader = new URDFLoader(manager);
    loader.parseCollision = false;
    loader.workingPath = '/';
    genericPreviewRobot = loader.parse(urdf);
    scene.add(genericPreviewRobot);
  });
  genericPreviewRobot.traverse(object => {
    if (!object.isMesh) return;
    object.material = Array.isArray(object.material)
      ? object.material.map(material => material.clone())
      : object.material.clone();
    for (const material of asMaterials(object.material)) {
      material.userData.baseColor = material.color?.clone();
      material.userData.baseEmissive = material.emissive?.clone();
      material.userData.baseEmissiveIntensity = material.emissiveIntensity;
    }
  });
  genericAxisHelpers.splice(0).forEach(helper => helper.removeFromParent());
  for (const joint of stepEditor.model.joints) {
    const urdfJoint = genericPreviewRobot.joints[joint.name];
    if (!urdfJoint) continue;
    const helper = new THREE.ArrowHelper(
      new THREE.Vector3(...joint.axis).normalize(),
      new THREE.Vector3(0, 0, 0),
      0.035,
      0xffeb3b,
      0.009,
      0.005,
    );
    helper.visible = axesVisible;
    urdfJoint.add(helper);
    genericAxisHelpers.push(helper);
  }
  fitRobot(genericPreviewRobot);
  statusElement.textContent = validation.roots.length > 1
    ? `运动检查预览：${validation.counts.links} 个结构 / ${validation.counts.revoluteJoints} 个关节；${validation.roots.length} 个断开分支已临时固定，仅用于逐关节纠错，正式导出仍被阻止。`
    : `运动预览：${validation.counts.links} 个结构 / ${validation.counts.revoluteJoints} 个关节；初始位置保持 STEP 姿态。`;
  renderGenericJoints();
}

document.getElementById('preview-generic-robot').addEventListener('click', () => {
  mountGenericPreview().catch(error => {
    genericValidationElement.dataset.state = 'failed';
    genericValidationElement.textContent = `预览失败：${error.message || error}`;
  });
});

document.getElementById('default-mode').addEventListener('click', () => {
  document.body.classList.remove('advanced-mode');
  document.getElementById('default-mode').classList.add('selected');
  document.getElementById('advanced-mode').classList.remove('selected');
  workflowController.setMode('novice');
  refreshGenericValidation();
});
document.getElementById('advanced-mode').addEventListener('click', () => {
  document.body.classList.add('advanced-mode');
  document.getElementById('advanced-mode').classList.add('selected');
  document.getElementById('default-mode').classList.remove('selected');
  workflowController.setMode('advanced');
  refreshGenericValidation();
});

document.getElementById('workflow-help').addEventListener('click', event => {
  const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
  event.currentTarget.setAttribute('aria-expanded', String(!expanded));
  if (!expanded) notificationService.info({ title: '为什么分为六个步骤？', whatHappened: '读取、自动判断、人工检查、运动测试和导出的数据性质不同', impact: '分步可以避免把估算或未确认结果误当作工程参数', recommendation: '只完成当前任务卡要求的一项操作' });
});

document.getElementById('start-new-project').addEventListener('click', () => {
  if (!window.confirm('开始新工程会清除本工具保存的检查点和当前恢复记录。其他网站数据不会受影响。是否继续？')) return;
  clearSavedProjects(localStorage);
  window.location.reload();
});

document.getElementById('restore-last-project').addEventListener('click', () => {
  restoreRecentStepJob();
});

exportPreviewElement.addEventListener('click', () => {
  try {
    const urdf = renderGenericUrdf(stepEditor.model, stepAssembly, {
      robotName: 'step_robot_preview', preview: true, attachPreviewForest: true,
      temporaryCollisionFromVisual: true,
    });
    const notice = '<!-- PREVIEW_ONLY: NOT_FOR_CONTROL_OR_SAFETY; placeholders may be present. -->\n';
    const blob = new Blob([notice, urdf], { type: 'application/xml' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'step_robot_PREVIEW_ONLY.urdf'; link.click(); URL.revokeObjectURL(url);
    notificationService.warning({ title: '已导出预览模型', whatHappened: '文件只用于查看结构和运动', impact: '占位限位、力矩、速度、质量或碰撞网格不能用于控制和安全判断', recommendation: '填写并验证真实工程参数后再导出工程模型' });
  } catch (error) {
    notificationService.blocker({ title: '预览模型无法导出', whatHappened: error.message || String(error), impact: '结构或几何错误会让预览产生误导', recommendation: '前往异常队列处理对应位置' });
  }
});

document.getElementById('download-analysis-report').addEventListener('click', () => {
  if (!stepAssembly || !stepEditor || !currentValidationReport) {
    notificationService.warning({ title: '尚无可导出的分析报告', whatHappened: '当前还没有完成 STEP 分析', impact: '不会生成空报告', recommendation: '先导入 STEP 并完成自动分析' });
    return;
  }
  const report = buildAnalysisValidationReport({ assembly: stepAssembly, candidates: stepCandidates, model: stepEditor.model, validation: currentValidationReport });
  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = 'step_urdf_analysis_validation_report.json'; link.click(); URL.revokeObjectURL(url);
  notificationService.success({ title: '分析与验证报告已生成', whatHappened: 'JSON 报告包含证据性质、模板结果、ContactGraph 摘要和导出门禁', impact: '可用于审阅和问题复现', recommendation: '与 STEP 工程文件一同保存' });
});

exportStepJobElement.addEventListener('click', async () => {
  exportStepJobElement.disabled = true;
  try {
    const exportModel = prepareGenericExportModel();
    const validation = validateRobotModel(exportModel, { forExport: true });
    if (!validation.ok) throw new Error(validation.errors.join('; '));
    const urdf = renderGenericUrdf(exportModel, stepAssembly, {
      robotName: 'step_robot',
      temporaryCollisionFromVisual: false,
    });
    await requestStepExport(activeStepJobId, { urdf, robotModel: exportModel });
    for (;;) {
      const status = await fetchStepJobStatus(activeStepJobId);
      renderStepJobStatus(status);
      if (status.exportState === 'ready') break;
      if (status.exportState === 'failed') throw new Error(status.exportError || '服务端 URDF 校验失败');
      await wait(300);
    }
    window.location.assign(`/api/step-jobs/${activeStepJobId}/bundle`);
  } catch (error) {
    genericValidationElement.dataset.state = 'failed';
    genericValidationElement.textContent = `导出失败：${error.message || error}`;
  } finally {
    refreshGenericValidation();
  }
});

function initializeEmptyWorkspace() {
  runtime.ready = false;
  statusElement.textContent = '📥 等待 STEP';
  stepJobStatusElement.textContent = '📥 请选择 STEP 文件';
  document.documentElement.dataset.appReady = 'true';
  publishDiagnostics();
}

initializeEmptyWorkspace();

const restoreLastProjectElement = document.getElementById('restore-last-project');
restoreLastProjectElement.hidden = !localStorage.getItem('step-urdf:last-step-job');

async function restoreRecentStepJob() {
  let pointer;
  try { pointer = JSON.parse(localStorage.getItem('step-urdf:last-step-job')); } catch { return; }
  if (!pointer?.jobId || !pointer?.sourceSha256) return;
  try {
    const status = await fetchStepJobStatus(pointer.jobId);
    if (status.state !== 'ready') return;
    const checkpoint = loadProjectCheckpoint(localStorage, pointer.sourceSha256);
    if (!checkpoint?.model) return;
    workflowController.transition('ANALYZE', { completedStage: 'IMPORT' });
    activeStepJobId = pointer.jobId;
    await mountStepAssembly(activeStepJobId);
    const recovered = structuredClone(checkpoint.model); recovered.jobId = activeStepJobId;
    stepEditor = new RobotEditor(recovered);
    servoTemplateStageElement.hidden = true; stepInspectorElement.hidden = false;
    workflowController.update(checkpoint.workflow || { currentStage: 'REVIEW', completedStages: ['IMPORT', 'ANALYZE', 'RESULTS'] });
    if (checkpoint.mode === 'advanced') { document.body.classList.add('advanced-mode'); document.getElementById('advanced-mode').classList.add('selected'); document.getElementById('default-mode').classList.remove('selected'); }
    renderGenericEditor(); await mountGenericPreview(); runtime.ready = true; publishDiagnostics();
    notificationService.success({ title: '已恢复最近检查点', whatHappened: `恢复了 ${checkpoint.savedAt || '上次'} 保存的 RobotModel 和任务阶段`, impact: '人工修改、关节确认和撤销前状态没有因刷新丢失', recommendation: '继续当前任务或导入新的 STEP' });
  } catch (error) {
    notificationService.warning({ title: '最近检查点暂时无法恢复', whatHappened: error.message || String(error), impact: '没有删除保存的数据', recommendation: '可重新导入同一 STEP 后恢复模型，或开始新任务', recoverability: 'RETRYABLE' });
  }
}
