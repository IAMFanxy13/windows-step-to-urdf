import { defineConfig } from 'vite';

import { stepJobApiPlugin } from './server/step-job-api.mjs';

export default defineConfig({
  plugins: [stepJobApiPlugin({ jobsRoot: process.env.STEP_URDF_JOBS_ROOT || undefined })],
  server: { host: '127.0.0.1', port: 5173 },
  test: { exclude: ['**/node_modules/**', '**/.git/**', '**/.worktrees/**'] },
});
