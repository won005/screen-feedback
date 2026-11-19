import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpFeedbackAdapter, FeedbackTransportError } from '../src/index.ts';

test('HTTP adapter reads a fresh host token, routes the project, and never retries writes implicitly', async () => {
  const calls: { url: string; input?: RequestInit }[] = []; let token = 'first', fail = false;
  const adapter = createHttpFeedbackAdapter({ baseUrl: 'https://feedback.example.test', projectId: 'one', getToken: () => token, fetch: async (url, input) => { calls.push({ url: String(url), ...(input ? { input } : {}) }); return new Response(JSON.stringify(fail ? { error: { code: 'VERSION_CONFLICT', message: 'Refresh first.' } } : { result: [] }), { status: fail ? 409 : 200 }); } });
  await adapter.getUsers(); token = 'refreshed'; fail = true;
  await assert.rejects(adapter.toggleLike('thread', 'comment'), (error: unknown) => error instanceof FeedbackTransportError && error.code === 'VERSION_CONFLICT');
  assert.equal(calls.length, 2); assert.equal(calls[0]!.url, 'https://feedback.example.test/v1/projects/one/rpc');
  assert.equal(new Headers(calls[1]!.input?.headers).get('Authorization'), 'Bearer refreshed');
  assert.deepEqual(JSON.parse(calls[1]!.input?.body as string), { method: 'toggleLike', args: ['thread', 'comment'] });
});

test('duplicate callback registrations share one socket and release resources only after the final unsubscribe', () => {
  const sockets: { closeCount: number; close(): void }[] = [], intervals: ReturnType<typeof setInterval>[] = [];
  const nativeInterval = globalThis.setInterval;
  globalThis.setInterval = ((handler: () => void, ms: number) => { const id = nativeInterval(handler, ms); intervals.push(id); return id; }) as typeof setInterval;
  const adapter = createHttpFeedbackAdapter({ baseUrl: 'https://feedback.example.test', projectId: 'one', getToken: () => 'token', createWebSocket: () => { const socket = { closeCount: 0, onclose: null, close() { this.closeCount++; }, send() {} }; sockets.push(socket); return socket as unknown as WebSocket; } });
  const callback = () => {};
  const first = adapter.subscribe(callback), second = adapter.subscribe(callback);
  try {
    assert.equal(sockets.length, 1); assert.equal(intervals.length, 1);
    first(); first(); assert.equal(sockets[0]!.closeCount, 0);
    second(); assert.equal(sockets[0]!.closeCount, 1);
  } finally { first(); second(); intervals.forEach(clearInterval); globalThis.setInterval = nativeInterval; }
});

test('browser Blob and native byte uploads carry metadata without local URIs', async () => {
  const calls: RequestInit[] = [];
  const adapter = createHttpFeedbackAdapter({ baseUrl: 'https://feedback.example.test', projectId: 'one', getToken: () => 'token', fetch: async (_url, input) => { calls.push(input!); return new Response(JSON.stringify({ result: { id: 'photo' } })); } });
  await adapter.uploadAttachment!({ bytes: Buffer.from([1, 2, 3]), name: '앱 사진.png', mimeType: 'image/png' });
  await adapter.uploadAttachment!(new File(['test'], 'web.png', { type: 'image/png' }));
  assert.equal(new Headers(calls[0]!.headers).get('X-File-Name'), encodeURIComponent('앱 사진.png'));
  assert.deepEqual([...new Uint8Array(calls[0]!.body as ArrayBuffer)], [1, 2, 3]);
  assert.equal(new Headers(calls[1]!.headers).get('Content-Type'), 'image/png');
  await assert.rejects(adapter.uploadAttachment!({ uri: 'file:///private/photo.png' }));
  assert.equal(calls.length, 2);
});
