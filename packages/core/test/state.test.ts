import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStatefulFeedbackStore } from '../src/index.ts';

const options = { users: [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }], allowedUserIds: ['alice', 'bob'], createId: randomUUID };
const screen = { id: 'board', resourceId: 'example' };
const input = { screen, anchor: { id: 'data:card', x: .2, y: .3, width: 100, height: 100, viewportWidth: 1000, viewportHeight: 800, scrollX: 0, scrollY: 0 }, body: '@Bob question', mentions: ['bob'], clientMutationId: 'first' };

test('trusted snapshots preserve comments, likes, status, inbox and retry receipts across restart', async () => {
  const first = createStatefulFeedbackStore(options);
  const thread = await first.forUser('alice').createThread(input);
  await first.forUser('bob').addComment(thread.id, { body: 'reply', clientMutationId: 'reply' });
  await first.forUser('bob').toggleLike(thread.id, thread.comments[0]!.id);
  const latest = (await first.forUser('alice').listThreads(screen))[0]!;
  await first.forUser('alice').setResolved(thread.id, true, latest.version);
  const next = createStatefulFeedbackStore(options, JSON.parse(JSON.stringify(first.exportState())));
  const restored = await next.forUser('alice').createThread(input);
  assert.equal(restored.id, thread.id); assert.equal(restored.comments.length, 2);
  assert.equal(restored.resolved, true); assert.deepEqual(restored.comments[0]!.likedBy, ['bob']);
  assert.equal((await next.forUser('bob').getNotifications())[0]!.kind, 'mention');
});

test('deleted data stays deleted after restore and delayed mutation retry', async () => {
  const first = createStatefulFeedbackStore(options), actor = first.forUser('alice');
  const thread = await actor.createThread(input); await actor.deleteThread(thread.id);
  const state = first.exportState();
  assert.equal(JSON.stringify(state).includes('@Bob question'), false);
  const next = createStatefulFeedbackStore(options, state);
  await assert.rejects(next.forUser('alice').createThread(input), { code: 'NOT_FOUND' });
  assert.deepEqual(await next.forUser('bob').getNotifications(), []);
});

test('snapshot input and output are independent copies and grants come from current host options', async () => {
  const first = createStatefulFeedbackStore(options); await first.forUser('alice').createThread(input);
  const state = first.exportState(); state.threads[0]!.comments[0]!.body = 'changed outside';
  assert.equal((await first.forUser('alice').listThreads(screen))[0]!.comments[0]!.body, input.body);
  const next = createStatefulFeedbackStore({ ...options, allowedUserIds: ['alice'] }, state);
  state.threads.length = 0;
  assert.equal((await next.forUser('alice').listThreads(screen)).length, 1);
  await assert.rejects(next.forUser('bob').listThreads(screen), { code: 'ACCESS_DENIED' });
  assert.throws(() => createStatefulFeedbackStore(options, { ...state, format: 2 } as never), { code: 'INVALID_INPUT' });
});
