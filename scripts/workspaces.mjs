import { spawnSync } from 'node:child_process';
import './copy-notices.mjs';

const command = process.argv[2];
if (!['build', 'test', 'typecheck'].includes(command)) throw new Error('Expected build, test, or typecheck.');
const names = ['@won005/feedback-core', '@won005/feedback-react', '@won005/feedback-react-native'];
if (command !== 'test') names.push('@screen-feedback/example-web');
if (command === 'typecheck') names.push('@screen-feedback/example-mobile');
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm scripts.');
for (const name of names) {
  const result = spawnSync(process.execPath, [npm, 'run', command, '--if-present', '--workspace', name], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
