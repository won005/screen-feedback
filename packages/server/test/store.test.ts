import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { FeedbackDatabase } from '../src/store.ts';

const screen = { id: 'board' };
const input = { screen, anchor: { id: 'data:card', x: .2, y: .3, width: 100, height: 100, viewportWidth: 1000, viewportHeight: 800, scrollX: 0, scrollY: 0 }, body: 'persisted question', clientMutationId: 'first' };

test('SQLite commits shared comments and restores them after restart; current membership wins', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'feedback-db-')), file = join(directory, 'data.sqlite');
  let db = new FeedbackDatabase(file, 'https://feedback.example.test');
  try {
    db.createProject('one'); db.grant('one', 'alice', 'Alice', true); db.grant('one', 'bob', 'Bob'); db.createProject('two'); db.grant('two', 'alice', 'Alice');
    const first = await db.rpc('one', 'alice', 'createThread', [input]);
    const id = (first as { id: string }).id;
    await db.rpc('one', 'bob', 'addComment', [id, { body: 'shared reply', clientMutationId: 'reply' }]);
    await db.close(); db = new FeedbackDatabase(file, 'https://feedback.example.test');
    assert.equal((await db.rpc('one', 'alice', 'listThreads', [screen]) as unknown[]).length, 1);
    assert.deepEqual(await db.rpc('two', 'alice', 'listThreads', [screen]), []);
    await assert.rejects(db.rpc('two', 'bob', 'listThreads', [screen]), { code: 'ACCESS_DENIED' });
    db.revoke('one', 'bob');
    assert.deepEqual(await db.rpc('one', 'bob', 'getAccess', []), { userId: 'bob', allowed: false, canDeleteAny: false });
    await assert.rejects(db.rpc('one', 'bob', 'getUsers', []), { code: 'ACCESS_DENIED' });
    await assert.rejects(db.rpc('one', 'alice', '__proto__', []));
    await assert.rejects(db.rpc('one', 'alice', 'createThread', [{ ...input, clientMutationId: 'bad', body: '' }]));
    assert.equal((await db.rpc('one', 'alice', 'listThreads', [screen]) as unknown[]).length, 1);
  } finally { await db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('operator subject typos cannot poison a project with duplicate normalized identities', async () => {
  const db = new FeedbackDatabase(':memory:', 'https://feedback.example.test');
  try {
    db.createProject('one'); db.grant('one', 'alice', 'Alice');
    assert.throws(() => db.grant('one', ' alice ', 'Duplicate'), { code: 'INVALID_INPUT' });
    assert.equal((await db.rpc('one', 'alice', 'getUsers', []) as unknown[]).length, 1);
  } finally { await db.close(); }
});

test('photo cleanup excludes a concurrent process attachment commit from its stale snapshot', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'feedback-prune-')), file = join(directory, 'data.sqlite');
  const db = new FeedbackDatabase(file, 'https://feedback.example.test');
  try {
    db.createProject('one'); db.grant('one', 'alice', 'Alice'); await db.rpc('one', 'alice', 'createThread', [input]);
    const photo = await db.upload('one', 'alice', 'image.png', 'image/png', new Uint8Array([1, 2, 3]));
    const connection = (db as unknown as { db: DatabaseSync }).db, prepare = connection.prepare.bind(connection);
    connection.prepare = (sql: string) => {
      const statement = prepare(sql);
      if (sql === 'SELECT id,state FROM projects') {
        const all = statement.all.bind(statement);
        statement.all = (...args) => {
          const stale = all(...args);
          spawnSync(process.execPath, ['--input-type=module', '-e', `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA busy_timeout=0');try{db.prepare("UPDATE projects SET state=json_set(state,'$.threads[0].comments[0].attachments',json(?)) WHERE id='one'").run(process.argv[2]);}catch{process.exitCode=2;}finally{db.close();}`, file, JSON.stringify([photo])], { timeout: 5000, stdio: 'ignore' });
          return stale;
        };
      }
      return statement;
    };
    await db.prunePhotos(Date.now() + 1); connection.prepare = prepare;
    const threads = await db.rpc('one', 'alice', 'listThreads', [screen]) as { comments: { attachments: unknown[] }[] }[];
    const referenced = threads[0]!.comments[0]!.attachments.length > 0;
    let available = true; try { db.readPhoto('one', 'alice', photo.id); } catch { available = false; }
    assert.equal(referenced, available, 'Cleanup must never leave a committed comment referring to deleted bytes.');
  } finally { await db.close(); assert.ok(directory.startsWith(join(tmpdir(), 'feedback-prune-'))); rmSync(directory, { recursive: true, force: true }); }
});

test('storage-limit failures roll back instead of leaving a partially created question', async () => {
  const db = new FeedbackDatabase(':memory:', 'https://feedback.example.test', 64);
  try {
    db.createProject('one'); db.grant('one', 'alice', 'Alice');
    await assert.rejects(db.rpc('one', 'alice', 'createThread', [input]), { code: 'INVALID_INPUT' });
    assert.deepEqual(await db.rpc('one', 'alice', 'listThreads', [screen]), []);
  } finally { await db.close(); }
});

test('backups include photos and attached files survive orphan cleanup and restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'feedback-backup-')), file = join(directory, 'backup.sqlite');
  const db = new FeedbackDatabase(':memory:', 'https://feedback.example.test');
  try {
    db.createProject('one'); db.grant('one', 'alice', 'Alice');
    const photo = await db.upload('one', 'alice', 'image.png', 'image/png', new Uint8Array([1, 2, 3]));
    await db.upload('one', 'alice', 'orphan.png', 'image/png', new Uint8Array([4, 5]));
    const thread = await db.rpc('one', 'alice', 'createThread', [{ ...input, attachments: [photo] }]) as { id: string };
    assert.equal(await db.prunePhotos(Date.now() + 1), 1);
    await db.backup(file);
    const restored = new FeedbackDatabase(file, 'https://feedback.example.test');
    try {
      assert.deepEqual([...restored.readPhoto('one', 'alice', photo.id).data], [1, 2, 3]);
      await restored.rpc('one', 'alice', 'deleteThread', [thread.id]);
      assert.throws(() => restored.readPhoto('one', 'alice', photo.id), { code: 'NOT_FOUND' });
    } finally { await restored.close(); }
  } finally { await db.close(); assert.ok(directory.startsWith(join(tmpdir(), 'feedback-backup-'))); rmSync(directory, { recursive: true, force: true }); }
});
