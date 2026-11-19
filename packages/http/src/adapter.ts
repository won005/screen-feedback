import type { FeedbackAdapter, FeedbackAttachment, FeedbackEvent } from '@won005/feedback-core';

export interface NativeFeedbackImage { bytes: Uint8Array; name: string; mimeType: string }
export interface HttpFeedbackOptions {
  baseUrl: string;
  projectId: string;
  /** Refresh this identity's JWT here. Create a new adapter when the signed-in account changes. */
  getToken: () => string | Promise<string>;
  fetch?: typeof globalThis.fetch;
  createWebSocket?: (url: string) => WebSocket;
  onError?: (error: unknown) => void;
}
export class FeedbackTransportError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, message: string, status = 0) { super(message); this.name = 'FeedbackTransportError'; this.code = code; this.status = status; }
}

export function createHttpFeedbackAdapter(options: HttpFeedbackOptions): FeedbackAdapter {
  const base = new URL(options.baseUrl);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) throw new Error('Use an HTTPS origin, or localhost for development.');
  if (!/^[a-zA-Z0-9_-]{1,80}$/u.test(options.projectId)) throw new Error('Invalid project identifier.');
  const endpoint = new URL(`/v1/projects/${options.projectId}/`, base).href;
  const request = options.fetch ?? globalThis.fetch;
  if (typeof request !== 'function') throw new Error('A fetch implementation is required.');
  const listeners = new Set<{ listener: (event: FeedbackEvent) => void }>();
  let socket: WebSocket | null = null, attempt = 0, generation = 0;
  let reconnect: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined, refreshPhotos: ReturnType<typeof setInterval> | undefined;
  const report = (error: unknown) => { try { options.onError?.(error); } catch { /* Host observers do not own the transport. */ } };
  const emit = (event: FeedbackEvent) => { for (const { listener } of [...listeners]) { try { listener(event); } catch { /* Isolate subscribers. */ } } };
  const token = async () => { const value = await options.getToken(); if (typeof value !== 'string' || !value || value.length > 16000) throw new FeedbackTransportError('AUTH_REQUIRED', 'Sign in to continue.'); return value; };
  const post = async <T>(path: string, init: RequestInit): Promise<T> => {
    const response = await request(endpoint + path, { ...init, credentials: 'omit', redirect: 'error', headers: { ...init.headers, Authorization: `Bearer ${await token()}` } });
    let data: { result?: T; error?: { code?: string; message?: string } };
    try { data = await response.json() as typeof data; } catch { throw new FeedbackTransportError('INVALID_RESPONSE', 'The feedback server returned an invalid response.', response.status); }
    if (!response.ok) throw new FeedbackTransportError(data.error?.code ?? 'REQUEST_FAILED', data.error?.message ?? 'The request failed.', response.status);
    return data.result as T;
  };
  const rpc = <T>(method: string, args: unknown[] = []) => post<T>('rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) });
  function connect() {
    if (!listeners.size) return;
    const owner = ++generation;
    const url = new URL('/v1/events', base); url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    const retry = () => { if (owner !== generation || !listeners.size) return; clearTimeout(deadline); socket = null; reconnect = setTimeout(connect, Math.min(30000, 500 * 2 ** Math.min(attempt++, 6))); };
    try {
      const current = options.createWebSocket ? options.createWebSocket(url.href) : new globalThis.WebSocket(url.href);
      socket = current;
      deadline = setTimeout(() => { if (owner === generation) current.close(); }, 10000);
      current.onopen = () => { void token().then(value => { if (owner === generation && listeners.size) current.send(JSON.stringify({ type: 'auth', projectId: options.projectId, token: value })); }).catch(error => { report(error); current.close(); }); };
      current.onmessage = event => {
        if (owner !== generation || !listeners.size || typeof event.data !== 'string') return;
        try {
          const value = JSON.parse(event.data) as { type?: unknown };
          if (value.type === 'ready') { clearTimeout(deadline); attempt = 0; emit({ type: 'changed' }); }
          else if (value.type === 'changed' || value.type === 'access-changed') emit({ type: value.type });
        } catch { report(new FeedbackTransportError('INVALID_EVENT', 'An invalid feedback event was ignored.')); }
      };
      current.onerror = () => report(new FeedbackTransportError('CONNECTION_FAILED', 'The feedback connection was interrupted.'));
      current.onclose = retry;
    } catch (error) { report(error); retry(); }
  }
  return {
    getAccess: () => rpc('getAccess'), getUsers: () => rpc('getUsers'), listThreads: screen => rpc('listThreads', [screen]),
    createThread: input => rpc('createThread', [input]), addComment: (id, input) => rpc('addComment', [id, input]),
    editComment: (id, commentId, input) => rpc('editComment', [id, commentId, input]), deleteComment: (id, commentId) => rpc('deleteComment', [id, commentId]),
    setResolved: (id, resolved, version) => rpc('setResolved', [id, resolved, version]), deleteThread: id => rpc('deleteThread', [id]),
    toggleLike: (id, commentId) => rpc('toggleLike', [id, commentId]), getNotifications: () => rpc('getNotifications'), markNotificationRead: id => rpc('markNotificationRead', [id]),
    async uploadAttachment(value: unknown): Promise<FeedbackAttachment> {
      let image: NativeFeedbackImage;
      if (typeof Blob !== 'undefined' && value instanceof Blob) image = { bytes: new Uint8Array(await value.arrayBuffer()), name: 'name' in value && typeof value.name === 'string' ? value.name : 'image', mimeType: value.type };
      else if (value && typeof value === 'object' && 'bytes' in value && value.bytes instanceof Uint8Array && 'name' in value && typeof value.name === 'string' && 'mimeType' in value && typeof value.mimeType === 'string') image = value as NativeFeedbackImage;
      else throw new FeedbackTransportError('INVALID_INPUT', 'Provide an image File or native image bytes.');
      if (!image.bytes.byteLength || image.bytes.byteLength > 5 * 1024 * 1024 || !image.name || image.name.length > 255) throw new FeedbackTransportError('INVALID_INPUT', 'Photo size or name is invalid.');
      return post('photos', { method: 'POST', headers: { 'Content-Type': image.mimeType, 'X-File-Name': encodeURIComponent(image.name) }, body: Uint8Array.from(image.bytes).buffer });
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new Error('A feedback listener is required.');
      const registration = { listener }; listeners.add(registration);
      if (listeners.size === 1) { connect(); refreshPhotos = setInterval(() => emit({ type: 'changed' }), 120000); }
      return () => {
        if (!listeners.delete(registration)) return;
        if (!listeners.size) { generation++; clearTimeout(reconnect); clearTimeout(deadline); clearInterval(refreshPhotos); const old = socket; socket = null; if (old) { old.onclose = null; old.close(); } attempt = 0; }
      };
    },
  };
}
