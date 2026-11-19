import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const name of ['core', 'http', 'server', 'react', 'react-native']) {
  const directory = join(root, 'packages', name);
  if (!existsSync(directory)) continue;
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) copyFileSync(join(root, file), join(directory, file));
}
