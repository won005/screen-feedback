import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { WebSocket } from 'ws';
import { FeedbackDatabase } from '../src/store.ts';
import { createJwtAuthenticator } from '../src/auth.ts';
import { createFeedbackServer } from '../src/server.ts';
import { createHttpFeedbackAdapter } from '../../http/src/index.ts';

const keys = await generateKeyPair('ES256');
const jwk = { ...await exportJWK(keys.publicKey), kid: 'test-key', alg: 'ES256' };
const authenticate = createJwtAuthenticator({ issuer: 'https://identity.example.test', audience: 'feedback', jwks: { keys: [jwk] } });
const token = (subject: string, options: { issuer?: string; audience?: string; expires?: number; issued?: number } = {}) => new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'test-key' }).setSubject(subject).setIssuer(options.issuer ?? 'https://identity.example.test').setAudience(options.audience ?? 'feedback').setIssuedAt(options.issued ?? Math.floor(Date.now() / 1000)).setExpirationTime(options.expires ?? Math.floor(Date.now() / 1000) + 300).sign(keys.privateKey);
const screen = { id: 'board' };
const question = { screen, anchor: { id: 'data:card', x: .2, y: .3, width: 100, height: 100, viewportWidth: 1000, viewportHeight: 800, scrollX: 0, scrollY: 0 }, body: 'question', clientMutationId: 'first' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function fixture() {
  const db = new FeedbackDatabase(':memory:', 'https://feedback.example.test');
  for (const project of ['one', 'two']) { db.createProject(project); db.grant(project, 'alice', 'Alice', true); }
  db.grant('one', 'bob', 'Bob');
  const app = createFeedbackServer({ database: db, authenticate, publicBaseUrl: 'https://feedback.example.test', photoKey: randomBytes(32), allowedOrigins: ['https://host.example.test'], accessCheckMs: 20 });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); if (!address || typeof address === 'string') throw new Error();
  const base = `http://127.0.0.1:${address.port}`, alice = await token('alice');
  const rpc = async (method: string, args: unknown[] = [], auth = alice, project = 'one', origin?: string) => fetch(`${base}/v1/projects/${project}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}`, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ method, args }) });
  return { db, app, base, alice, rpc, close: async () => { await app.close(); await db.close(); } };
}

test('JWT signature, expiry, issuer and audience are verified; unlisted subjects and origins cannot read', async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(`${f.base}/v1/projects/one/rpc`, { method: 'POST' })).status, 401);
    for (const auth of [await token('alice', { issuer: 'https://wrong.example.test' }), await token('alice', { audience: 'other' }), await token('alice', { expires: 1 }), f.alice.slice(0, -8) + 'invalid!']) assert.equal((await f.rpc('getUsers', [], auth)).status, 401);
    assert.equal((await f.rpc('getUsers', [], await token('unknown'))).status, 403);
    assert.equal((await f.rpc('getUsers', [], f.alice, 'one', 'https://evil.example.test')).status, 403);
    assert.equal((await f.rpc('getUsers', [], f.alice, 'one', 'https://host.example.test')).status, 200);
    assert.equal((await f.rpc('constructor')).status, 400);
    const revoked = await f.rpc('getAccess', [], await token('unknown'));
    assert.equal((await revoked.json() as { result: { allowed: boolean } }).result.allowed, false);
  } finally { await f.close(); }
});

test('WebSocket receives the same effective token deadline as HTTP and noncanonical subjects are rejected', async () => {
  const issued = Math.floor(Date.now() / 1000) - 3500;
  const identity = await authenticate(await token('alice', { issued, expires: issued + 86400 }));
  assert.equal(identity.expiresAt, (issued + 3600) * 1000);
  await assert.rejects(authenticate(await token(' alice ')));
});

test('independent authenticated users behind one proxy do not share the former 600-request allowance', async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 61; index++) {
      const subject = `tester${index}`, auth = await token(subject); f.db.grant('one', subject, subject);
      for (let request = 0; request < 10; request++) assert.equal((await f.rpc('getAccess', [], auth)).status, 200);
    }
  } finally { await f.close(); }
});

test('photos validate bytes, bind ownership/project, normalize retry URLs, and disappear with their question', async () => {
  const f = await fixture();
  const upload = (data: Buffer, mime = 'image/png') => fetch(`${f.base}/v1/projects/one/photos`, { method: 'POST', headers: { Authorization: `Bearer ${f.alice}`, 'Content-Type': mime, 'X-File-Name': encodeURIComponent('image.png') }, body: data });
  try {
    assert.equal((await upload(Buffer.from('<svg>bad</svg>'))).status, 400);
    assert.equal((await upload(png, 'image/jpeg')).status, 400);
    const response = await upload(png); assert.equal(response.status, 201);
    const photo = (await response.json() as { result: { id: string; url: string } }).result;
    const path = new URL(photo.url);
    assert.equal((await fetch(`${f.base}${path.pathname}${path.search}`)).status, 200);
    assert.equal((await fetch(`${f.base}${path.pathname}`)).status, 403);
    assert.equal((await fetch(`${f.base}${path.pathname.replace('/one/', '/two/')}${path.search}`)).status, 403);
    assert.equal((await f.rpc('createThread', [{ ...question, attachments: [photo] }], await token('bob'))).status, 403);
    const first = await f.rpc('createThread', [{ ...question, attachments: [{ ...photo, url: 'https://untrusted.example.test/wrong', name: 'forged.svg', mimeType: 'image/svg+xml' }] }]);
    assert.equal(first.status, 200);
    const thread = (await first.json() as { result: { id: string; comments: { attachments: { url: string; name: string; mimeType: string }[] }[] } }).result;
    assert.equal(thread.comments[0]!.attachments[0]!.name, 'image.png'); assert.equal(thread.comments[0]!.attachments[0]!.mimeType, 'image/png');
    assert.equal((await f.rpc('createThread', [{ ...question, attachments: [photo] }])).status, 200);
    assert.equal((await f.rpc('deleteThread', [thread.id])).status, 200);
    assert.equal((await fetch(`${f.base}${path.pathname}${path.search}`)).status, 404);
  } finally { await f.close(); }
});

test('WebSocket has an authentication deadline and only authorized project changes; revocation closes access', async () => {
  const f = await fixture();
  const socket = new WebSocket(`${f.base.replace('http:', 'ws:')}/v1/events`);
  try {
    await once(socket, 'open');
    const ready = once(socket, 'message'); socket.send(JSON.stringify({ type: 'auth', projectId: 'one', token: f.alice }));
    assert.equal(JSON.parse(String((await ready)[0])).type, 'ready');
    const changed = once(socket, 'message'); await f.rpc('createThread', [question]);
    assert.deepEqual(JSON.parse(String((await changed)[0])), { type: 'changed' });
    const revoked = once(socket, 'message'); f.db.revoke('one', 'alice');
    assert.deepEqual(JSON.parse(String((await revoked)[0])), { type: 'access-changed' });
    assert.equal((await f.rpc('getUsers')).status, 403);
  } finally { socket.terminate(); await f.close(); }
});

test('web and native callers share the HTTP adapter including notifications, conflicts and live refresh', async () => {
  const f = await fixture(), bobToken = await token('bob');
  const alice = createHttpFeedbackAdapter({ baseUrl: f.base, projectId: 'one', getToken: () => f.alice });
  const bob = createHttpFeedbackAdapter({ baseUrl: f.base, projectId: 'one', getToken: () => bobToken });
  let stop = () => {};
  try {
    let notify: (() => void) | undefined;
    const ready = new Promise<void>(resolve => { notify = resolve; });
    stop = bob.subscribe(event => { if (event.type === 'changed') notify?.(); });
    await ready;
    const changed = new Promise<void>(resolve => { notify = resolve; });
    const thread = await alice.createThread({ ...question, body: '@Bob shared', mentions: ['bob'] });
    await changed;
    assert.equal((await bob.listThreads(screen))[0]!.id, thread.id);
    assert.equal((await bob.getNotifications())[0]!.kind, 'mention');
    const reply = await bob.addComment(thread.id, { body: 'reply from app transport', clientMutationId: 'native' });
    assert.equal((await alice.listThreads(screen))[0]!.comments.length, 2);
    await assert.rejects(alice.setResolved(thread.id, true, thread.version), { code: 'VERSION_CONFLICT' });
    await bob.toggleLike(thread.id, reply.comments[0]!.id);
    assert.deepEqual((await alice.listThreads(screen))[0]!.comments[0]!.likedBy, ['bob']);
    const photo = await bob.uploadAttachment!({ bytes: png, name: 'native.png', mimeType: 'image/png' });
    assert.equal(photo.mimeType, 'image/png');
  } finally { stop(); await f.close(); }
});
