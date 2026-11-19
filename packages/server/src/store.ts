import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createStatefulFeedbackStore, FeedbackError, type FeedbackState, type FeedbackThread, type FeedbackAttachment, type FeedbackUser } from '@won005/feedback-core';

export const RPC_ARITY = new Map(Object.entries({ getAccess: 0, getUsers: 0, listThreads: 1, createThread: 1, addComment: 2, editComment: 3, deleteComment: 2, setResolved: 3, deleteThread: 1, toggleLike: 2, getNotifications: 0, markNotificationRead: 1 }));
export const WRITES = new Set(['createThread', 'addComment', 'editComment', 'deleteComment', 'setResolved', 'deleteThread', 'toggleLike', 'markNotificationRead']);
export interface Member { subject: string; name: string; allowed: number; moderator: number }
export interface Photo { id: string; project: string; owner: string; name: string; mime: string; data: Uint8Array; created: number }
function denied(): never { throw new FeedbackError('ACCESS_DENIED', 'Feedback access has not been granted.'); }
function invalid(message = 'Invalid request.'): never { throw new FeedbackError('INVALID_INPUT', message); }
function identifier(value: string): string { if (!/^[a-zA-Z0-9_-]{1,80}$/u.test(value)) invalid('Invalid project identifier.'); return value; }

/** One process owns writes. SQLite transactions commit snapshots and attachments together. */
export class FeedbackDatabase {
  private readonly db: DatabaseSync;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly publicBase: string;
  private readonly stateLimit: number;
  constructor(file: string, publicBase: string, stateLimit = 8 * 1024 * 1024) {
    this.publicBase = publicBase; this.stateLimit = stateLimit;
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version > 1) { this.db.close(); throw new Error('Unsupported database version.'); }
    this.db.exec(`CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, state TEXT);
      CREATE TABLE IF NOT EXISTS members(project TEXT NOT NULL REFERENCES projects(id), subject TEXT NOT NULL, name TEXT NOT NULL, allowed INTEGER NOT NULL, moderator INTEGER NOT NULL, PRIMARY KEY(project,subject));
      CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id), owner TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS photos_project ON photos(project); PRAGMA user_version=1;`);
  }
  createProject(project: string): void { this.db.prepare('INSERT INTO projects(id) VALUES(?) ON CONFLICT DO NOTHING').run(identifier(project)); }
  grant(project: string, subject: string, name: string, moderator = false): void {
    identifier(project);
    if (!subject.trim() || subject !== subject.trim() || subject.length > 128 || !name.trim() || name.length > 100) invalid();
    this.db.prepare('INSERT INTO members(project,subject,name,allowed,moderator) VALUES(?,?,?,1,?) ON CONFLICT(project,subject) DO UPDATE SET name=excluded.name,allowed=1,moderator=excluded.moderator').run(project, subject, name.trim(), Number(moderator));
  }
  revoke(project: string, subject: string): void {
    identifier(project); if (!subject.trim() || subject !== subject.trim() || subject.length > 128) invalid();
    this.db.prepare('UPDATE members SET allowed=0 WHERE project=? AND subject=?').run(project, subject);
  }
  access(project: string, subject: string): { userId: string; allowed: boolean; canDeleteAny: boolean } {
    const member = this.db.prepare('SELECT allowed,moderator FROM members WHERE project=? AND subject=?').get(project, subject) as Member | undefined;
    return { userId: subject, allowed: member?.allowed === 1, canDeleteAny: member?.allowed === 1 && member.moderator === 1 };
  }
  private requireAccess(project: string, subject: string): void { if (!this.access(project, subject).allowed) denied(); }
  private serial<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(operation); this.tail = result.catch(() => {}); return result;
  }
  rpc(project: string, subject: string, method: string, args: unknown[]): Promise<unknown> {
    return this.serial(async () => {
      if (!Array.isArray(args) || RPC_ARITY.get(method) !== args.length) invalid();
      if (method === 'getAccess') return this.access(project, subject);
      this.requireAccess(project, subject);
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const row = this.db.prepare('SELECT state FROM projects WHERE id=?').get(project) as { state: string | null } | undefined;
        if (!row) denied();
        const members = this.db.prepare('SELECT subject,name,allowed,moderator FROM members WHERE project=?').all(project) as unknown as Member[];
        const store = createStatefulFeedbackStore({ users: members.map((m): FeedbackUser => ({ id: m.subject, name: m.name })), allowedUserIds: members.filter(m => m.allowed).map(m => m.subject), moderatorIds: members.filter(m => m.moderator).map(m => m.subject), createId: randomUUID }, row.state ? JSON.parse(row.state) as FeedbackState : undefined);
        const before = store.exportState();
        const input = [...args];
        if (method === 'createThread' || method === 'addComment') {
          const index = method === 'createThread' ? 0 : 1;
          const value = input[index];
          if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
          const raw = value as { attachments?: unknown };
          if (raw.attachments !== undefined && (!Array.isArray(raw.attachments) || raw.attachments.length > 5)) invalid();
          const attachments = (raw.attachments ?? []) as unknown[];
          input[index] = { ...raw, attachments: attachments.map(value => {
            if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string') invalid();
            const photo = this.photoRow(project, value.id);
            if (!photo || photo.owner !== subject) denied();
            return this.photoMetadata(photo); // Stable metadata keeps mutation retry fingerprints independent of signed URLs.
          }) };
        }
        const adapter = store.forUser(subject);
        const operation = adapter[method as keyof typeof adapter];
        if (typeof operation !== 'function') invalid();
        const result: unknown = await Reflect.apply(operation, adapter, input);
        if (WRITES.has(method)) {
          const state = store.exportState(), serialized = JSON.stringify(state);
          if (Buffer.byteLength(serialized) > this.stateLimit) invalid('Project feedback storage limit reached.');
          this.db.prepare('UPDATE projects SET state=? WHERE id=?').run(serialized, project);
          const remaining = this.photoIds(state.threads);
          for (const id of this.photoIds(before.threads)) if (!remaining.has(id)) this.db.prepare('DELETE FROM photos WHERE id=? AND project=?').run(id, project);
        }
        this.db.exec('COMMIT'); return result;
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    });
  }
  private photoIds(threads: FeedbackThread[]): Set<string> { return new Set(threads.flatMap(thread => thread.comments.flatMap(comment => comment.attachments.map(photo => photo.id)))); }
  private photoRow(project: string, id: string): Photo | undefined { return this.db.prepare('SELECT * FROM photos WHERE project=? AND id=?').get(project, id) as unknown as Photo | undefined; }
  private photoMetadata(photo: Photo): FeedbackAttachment { return { id: photo.id, name: photo.name, mimeType: photo.mime, url: new URL(`/v1/projects/${encodeURIComponent(photo.project)}/photos/${photo.id}`, this.publicBase).href }; }
  upload(project: string, subject: string, name: string, mime: string, data: Uint8Array): Promise<FeedbackAttachment> {
    return this.serial(() => {
      this.requireAccess(project, subject);
      if (!data.byteLength || data.byteLength > 5 * 1024 * 1024 || !name.trim() || name.length > 255) invalid();
      const used = this.db.prepare('SELECT COALESCE(SUM(length(data)),0) AS total FROM photos WHERE project=?').get(project) as { total: number };
      if (used.total + data.byteLength > 256 * 1024 * 1024) invalid('Project photo storage limit reached.');
      const photo: Photo = { id: randomUUID(), project, owner: subject, name: name.trim(), mime, data, created: Date.now() };
      this.db.prepare('INSERT INTO photos(id,project,owner,name,mime,data,created) VALUES(?,?,?,?,?,?,?)').run(photo.id, project, subject, photo.name, mime, data, photo.created);
      return this.photoMetadata(photo);
    });
  }
  readPhoto(project: string, subject: string, id: string): Photo {
    this.requireAccess(project, subject);
    const photo = this.photoRow(project, id);
    if (!photo) throw new FeedbackError('NOT_FOUND', 'Photo not found.');
    const row = this.db.prepare('SELECT state FROM projects WHERE id=?').get(project) as { state: string | null };
    const attached = row.state ? this.photoIds((JSON.parse(row.state) as FeedbackState).threads).has(id) : false;
    if (!attached && photo.owner !== subject) denied();
    return photo;
  }
  async backup(destination: string): Promise<void> { await this.serial(() => { this.db.prepare('VACUUM INTO ?').run(destination); }); }
  async prunePhotos(before = Date.now() - 24 * 60 * 60 * 1000): Promise<number> {
    return this.serial(() => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
      let removed = 0;
      const projects = this.db.prepare('SELECT id,state FROM projects').all() as unknown as { id: string; state: string | null }[];
      for (const project of projects) {
        const attached = project.state ? this.photoIds((JSON.parse(project.state) as FeedbackState).threads) : new Set<string>();
        const photos = this.db.prepare('SELECT id FROM photos WHERE project=? AND created<?').all(project.id, before) as unknown as { id: string }[];
        for (const photo of photos) if (!attached.has(photo.id)) { this.db.prepare('DELETE FROM photos WHERE id=? AND project=?').run(photo.id, project.id); removed++; }
      }
      this.db.exec('COMMIT'); return removed;
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    });
  }
  async close(): Promise<void> { await this.tail; this.db.close(); }
}
