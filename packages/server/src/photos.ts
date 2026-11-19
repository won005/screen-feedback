import { createHmac, timingSafeEqual } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { FeedbackError, type FeedbackAttachment } from '@won005/feedback-core';

const mimes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp', 'image/heic', 'image/heif']);
export async function checkImage(data: Uint8Array, expected: string): Promise<string> {
  const type = await fileTypeFromBuffer(data).catch(() => undefined);
  if (!type || !mimes.has(type.mime) || type.mime !== expected || data.byteLength > 5 * 1024 * 1024) throw new FeedbackError('INVALID_INPUT', 'The image type or size is not supported.');
  return type.mime;
}

export class PhotoTickets {
  private readonly key: Uint8Array;
  private readonly base: string;
  private readonly lifetimeMs: number;
  constructor(key: Uint8Array, base: string, lifetimeMs = 5 * 60 * 1000) {
    this.key = key; this.base = base; this.lifetimeMs = lifetimeMs;
    if (key.byteLength < 32) throw new Error('Photo ticket key must have at least 32 bytes.');
  }
  private signature(body: string): Buffer { return createHmac('sha256', this.key).update('feedback-photo-v1.').update(body).digest(); }
  attach(photo: FeedbackAttachment, project: string, subject: string): FeedbackAttachment {
    const body = Buffer.from(JSON.stringify({ project, subject, id: photo.id, expires: Date.now() + this.lifetimeMs })).toString('base64url');
    const url = new URL(`/v1/projects/${encodeURIComponent(project)}/photos/${photo.id}`, this.base);
    url.searchParams.set('ticket', `${body}.${this.signature(body).toString('base64url')}`);
    return { ...photo, url: url.href };
  }
  verify(ticket: string, project: string, id: string): string {
    try {
      if (ticket.length > 2048) throw new Error();
      const parts = ticket.split('.');
      if (parts.length !== 2) throw new Error();
      const body = parts[0]!, signature = Buffer.from(parts[1]!, 'base64url'), expected = this.signature(body);
      if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new Error();
      const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { project: unknown; subject: unknown; id: unknown; expires: unknown };
      if (value.project !== project || value.id !== id || typeof value.subject !== 'string' || typeof value.expires !== 'number' || !Number.isSafeInteger(value.expires) || value.expires <= Date.now()) throw new Error();
      return value.subject;
    } catch { throw new FeedbackError('ACCESS_DENIED', 'Photo access expired or is invalid.'); }
  }
  hydrate(value: unknown, project: string, subject: string): unknown {
    if (Array.isArray(value)) return value.map(item => this.hydrate(item, project, subject));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, key === 'attachments' && Array.isArray(entry) ? entry.map(photo => this.attach(photo as FeedbackAttachment, project, subject)) : this.hydrate(entry, project, subject)]));
    return value;
  }
}
