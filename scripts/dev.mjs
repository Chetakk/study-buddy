// Runs the API server (restarting on change) and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  spawn(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--watch-path=server', 'server/index.ts'],
    { stdio: 'inherit' },
  ),
  spawn('npx', ['vite'], { stdio: 'inherit' }),
];

const stop = () => {
  for (const p of procs) p.kill();
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', stop);
