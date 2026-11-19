import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createJwtAuthenticator } from './auth.ts';
import { FeedbackDatabase } from './store.ts';
import { createFeedbackServer } from './server.ts';

const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value; };
async function main() {
  const [command, project, subject, name, role] = process.argv.slice(2);
  const dataDir = process.env.DATA_DIR ?? './data'; mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const base = process.env.PUBLIC_BASE_URL ?? 'http://localhost:8080', url = new URL(base);
  if (url.origin !== base || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('PUBLIC_BASE_URL must be an HTTPS origin, or localhost for development.');
  const database = new FeedbackDatabase(join(dataDir, 'feedback.sqlite'), base);
  if (command !== 'serve') {
    try {
      if (command === 'project' && project) database.createProject(project);
      else if (command === 'grant' && project && subject && name && (!role || role === 'moderator')) database.grant(project, subject, name, role === 'moderator');
      else if (command === 'revoke' && project && subject) database.revoke(project, subject);
      else if (command === 'backup' && project) await database.backup(project);
      else if (command === 'prune-photos') await database.prunePhotos();
      else throw new Error('Usage: project <id> | grant <project> <subject> <name> [moderator] | revoke <project> <subject> | backup <new-file> | prune-photos | serve');
      process.stdout.write('Completed.\n');
    } finally { await database.close(); }
    return;
  }
  const key = Buffer.from(required('PHOTO_TICKET_KEY'), 'base64');
  const authenticate = createJwtAuthenticator({ issuer: required('AUTH_ISSUER'), audience: required('AUTH_AUDIENCE'), jwksUrl: required('AUTH_JWKS_URL') });
  const app = createFeedbackServer({ database, authenticate, publicBaseUrl: base, photoKey: key, allowedOrigins: required('ALLOWED_ORIGINS').split(',').map(value => value.trim()).filter(Boolean) });
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  const prune = setInterval(() => { void database.prunePhotos().catch(() => process.stderr.write('Photo cleanup failed.\n')); }, 60 * 60 * 1000); prune.unref();
  const stop = async () => { clearInterval(prune); await app.close(); await database.close(); process.exit(0); };
  process.once('SIGTERM', () => { void stop(); }); process.once('SIGINT', () => { void stop(); });
  app.server.listen(port, process.env.HOST ?? '127.0.0.1', () => process.stdout.write('Feedback server started.\n'));
}
void main().catch(error => { process.stderr.write(error instanceof Error && /^(AUTH_|PHOTO_|ALLOWED_|PUBLIC_|Invalid PORT|Usage:)/u.test(error.message) ? `${error.message}\n` : 'Feedback server could not start.\n'); process.exitCode = 1; });
