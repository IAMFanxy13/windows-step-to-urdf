import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { JobStore } from './job-store.mjs';
import { defaultJobsRoot } from './job-paths.mjs';

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(value)}\n`);
}

function readBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('Request body is too large')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function decodeFilename(value) {
  try { return decodeURIComponent(String(value || '')); } catch { throw new Error('Invalid STEP filename header'); }
}

export function startStepWorker({ projectRoot, store, id, pythonExecutable = process.env.STEP_URDF_PYTHON || 'python' }) {
  const worker = path.join(projectRoot, 'scripts', 'step_import_worker.py');
  const child = spawn(pythonExecutable, [worker, '--job-dir', store.jobDirectory(id)], {
    cwd: projectRoot, windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.on('error', error => store.writeStatus(id, { state: 'failed', kind: 'step-import', message: `无法启动 STEP 分析器：${error.message}` }));
  child.on('exit', code => {
    if (code && store.readStatus(id).state !== 'failed') {
      store.writeStatus(id, { state: 'failed', kind: 'step-import', message: stderr.trim() || `STEP 分析器退出码 ${code}` });
    }
  });
}

export function createStepJobMiddleware(projectRoot, options = {}) {
  const jobsRoot = options.jobsRoot || defaultJobsRoot(projectRoot);
  const store = new JobStore(jobsRoot, options);
  const workerStarter = options.workerStarter || startStepWorker;
  return async function stepJobMiddleware(request, response, next) {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/step-jobs')) return next();
    try {
      if (request.method === 'POST' && url.pathname === '/api/step-jobs') {
        const body = await readBody(request, store.maxUploadBytes);
        const filename = decodeFilename(request.headers['x-step-filename']);
        const job = store.createSource(body, filename, {
          extensions: ['.step', '.stp'], sourceFilename: 'source.step', kind: 'step-import', message: 'STEP 已接收，等待精确 B-Rep 分析',
        });
        workerStarter({ projectRoot, store, id: job.id, pythonExecutable: options.pythonExecutable });
        return sendJson(response, 202, { jobId: job.id, status: store.readStatus(job.id) });
      }
      const statusMatch = url.pathname.match(/^\/api\/step-jobs\/([^/]+)\/status$/);
      if (request.method === 'GET' && statusMatch) return sendJson(response, 200, store.readStatus(statusMatch[1]));

      const exportMatch = url.pathname.match(/^\/api\/step-jobs\/([^/]+)\/export$/);
      if (request.method === 'POST' && exportMatch) {
        const id = exportMatch[1];
        const status = store.readStatus(id);
        if (status.state !== 'ready') return sendJson(response, 409, { error: 'STEP analysis is not ready' });
        const body = await readBody(request, 16 * 1024 * 1024);
        JSON.parse(body.toString('utf8'));
        fs.writeFileSync(path.join(store.jobDirectory(id), 'export_request.json'), body, { flag: 'w' });
        store.writeStatus(id, { ...status, exportState: 'validating' });
        const script = path.join(projectRoot, 'scripts', 'package_step_job.py');
        const child = spawn(options.pythonExecutable || process.env.STEP_URDF_PYTHON || 'python', [script, '--job-dir', store.jobDirectory(id), '--project-root', projectRoot], {
          cwd: projectRoot, windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'],
        });
        let stderr = '';
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.on('exit', code => {
          const current = store.readStatus(id);
          store.writeStatus(id, code
            ? { ...current, exportState: 'failed', exportError: stderr.trim() || `exporter exit code ${code}` }
            : { ...current, exportState: 'ready' });
        });
        return sendJson(response, 202, { state: 'validating' });
      }

      const bundleMatch = url.pathname.match(/^\/api\/step-jobs\/([^/]+)\/bundle$/);
      if (request.method === 'GET' && bundleMatch) {
        const bundle = path.join(store.jobDirectory(bundleMatch[1]), 'output-step', 'step_urdf_bundle.zip');
        if (!fs.existsSync(bundle)) return sendJson(response, 404, { error: 'STEP URDF bundle not found' });
        response.statusCode = 200;
        response.setHeader('content-type', 'application/zip');
        response.setHeader('content-disposition', 'attachment; filename="step_urdf_bundle.zip"');
        return fs.createReadStream(bundle).pipe(response);
      }

      const artifactMatch = url.pathname.match(/^\/api\/step-jobs\/([^/]+)\/artifacts\/(.+)$/);
      if (request.method === 'GET' && artifactMatch) {
        const base = path.resolve(store.jobDirectory(artifactMatch[1]), 'analysis');
        const relative = decodeURIComponent(artifactMatch[2]);
        const target = path.resolve(base, relative);
        if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error('Unsafe artifact path');
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return sendJson(response, 404, { error: 'Artifact not found' });
        response.statusCode = 200;
        response.setHeader('content-type', target.endsWith('.json') ? 'application/json; charset=utf-8' : 'model/stl');
        return fs.createReadStream(target).pipe(response);
      }
      return sendJson(response, 404, { error: 'Unknown STEP job route' });
    } catch (error) {
      return sendJson(response, /not found/i.test(error.message) ? 404 : 400, { error: error.message });
    }
  };
}

export function stepJobApiPlugin(options = {}) {
  return {
    name: 'step-servo-urdf-job-api',
    configureServer(server) { server.middlewares.use(createStepJobMiddleware(server.config.root, options)); },
  };
}
