import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createStepJobMiddleware } from '../server/step-job-api.mjs';

const servers = [];
afterEach(async () => Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve)))));

async function start(middleware) {
  const server = http.createServer((request, response) => middleware(request, response, () => {
    response.statusCode = 404;
    response.end();
  }));
  servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

describe('STEP job API', () => {
  it('creates a generic STEP job and exposes status through the local worker boundary', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'step-api-'));
    const jobsRoot = path.join(projectRoot, 'jobs');
    let started = null;
    const middleware = createStepJobMiddleware(projectRoot, {
      jobsRoot,
      workerStarter: ({ id, store }) => {
        started = id;
        store.writeStatus(id, { ...store.readStatus(id), state: 'ready' });
      },
    });
    const url = await start(middleware);
    const created = await fetch(`${url}/api/step-jobs`, {
      method: 'POST', headers: { 'x-step-filename': encodeURIComponent('通用机器人.AP242.step') }, body: 'ISO-10303-21;',
    });
    expect(created.status).toBe(202);
    const value = await created.json();
    expect(value.jobId).toBe(started);
    expect(fs.existsSync(path.join(jobsRoot, value.jobId, 'source.step'))).toBe(true);
    const status = await fetch(`${url}/api/step-jobs/${value.jobId}/status`).then(response => response.json());
    expect(status).toMatchObject({ state: 'ready', kind: 'step-import', originalFilename: '通用机器人.AP242.step' });
  });

  it('rejects ZIP input at the STEP endpoint', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'step-api-'));
    const url = await start(createStepJobMiddleware(projectRoot, { workerStarter: () => {} }));
    const response = await fetch(`${url}/api/step-jobs`, {
      method: 'POST', headers: { 'x-step-filename': 'robot.zip' }, body: 'zip',
    });
    expect(response.status).toBe(400);
  });
});
