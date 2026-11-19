import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { FeedbackError } from '@won005/feedback-core';
import { type Authenticate, type Identity } from './auth.ts';
import { FeedbackDatabase, WRITES } from './store.ts';
import { checkImage, PhotoTickets } from './photos.ts';

class RequestError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
function json(response: ServerResponse, status: number, value: unknown) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); }
async function read(request: IncomingMessage, maximum: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { const bytes = Buffer.from(chunk as Uint8Array); size += bytes.byteLength; if (size > maximum) throw new RequestError(413, 'INVALID_INPUT', 'Request size limit reached.'); chunks.push(bytes); }
  return Buffer.concat(chunks);
}

export function createFeedbackServer(options: { database: FeedbackDatabase; authenticate: Authenticate; publicBaseUrl: string; photoKey: Uint8Array; allowedOrigins: string[]; accessCheckMs?: number }) {
  const { database, authenticate } = options, tickets = new PhotoTickets(options.photoKey, options.publicBaseUrl);
  const origins = new Set(options.allowedOrigins);
  for (const origin of origins) if (new URL(origin).origin !== origin || origin === '*') throw new Error('Provide exact allowed origins.');
  const sockets = new Map<WebSocket, { project: string; identity: Identity }>();
  const rates = new Map<string, { count: number; until: number }>();
  function rate(key: string, maximum: number) {
    const at = Date.now();
    if (rates.size > 5000) for (const [id, value] of rates) if (value.until < at) rates.delete(id);
    if (rates.size > 5000 && !rates.has(key)) throw new RequestError(429, 'RATE_LIMIT', 'Try again later.');
    const entry = rates.get(key);
    if (!entry || entry.until <= at) rates.set(key, { count: 1, until: at + 60000 });
    else if (++entry.count > maximum) throw new RequestError(429, 'RATE_LIMIT', 'Try again later.');
  }
  function originAllowed(request: IncomingMessage): boolean { return !request.headers.origin || origins.has(request.headers.origin); }
  async function identity(request: IncomingMessage): Promise<Identity> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new RequestError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
    try { return await authenticate(header.slice(7)); } catch { rate(`invalid-auth:${request.socket.remoteAddress ?? 'unknown'}`, 120); throw new RequestError(401, 'AUTH_REQUIRED', 'Sign in to continue.'); }
  }
  function broadcast(project: string) { for (const [socket, info] of sockets) if (info.project === project && socket.readyState === WebSocket.OPEN && database.access(project, info.identity.subject).allowed && info.identity.expiresAt > Date.now()) socket.send('{"type":"changed"}'); }
  const server = createServer((request, response) => { void (async () => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer');
    if (!originAllowed(request)) throw new RequestError(403, 'ACCESS_DENIED', 'Origin is not allowed.');
    if (request.headers.origin) { response.setHeader('Access-Control-Allow-Origin', request.headers.origin); response.setHeader('Vary', 'Origin'); }
    if (request.method === 'OPTIONS') { response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-File-Name'); response.writeHead(204); response.end(); return; }
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/healthz') { json(response, 200, { status: 'ok' }); return; }
    const match = /^\/v1\/projects\/([a-zA-Z0-9_-]{1,80})\/(rpc|photos)(?:\/([a-f0-9-]{36}))?$/u.exec(url.pathname);
    if (!match) throw new RequestError(404, 'NOT_FOUND', 'Not found.');
    const project = match[1]!, endpoint = match[2], photoId = match[3];
    // The reverse proxy is the HTTP peer. Valid identities have independent budgets;
    // this separate global ceiling provides backpressure without trusting forwarded headers.
    rate('global', 6000);
    if (request.method === 'GET' && endpoint === 'photos' && photoId) {
      const subject = tickets.verify(url.searchParams.get('ticket') ?? '', project, photoId);
      const photo = database.readPhoto(project, subject, photoId);
      response.setHeader('Content-Type', photo.mime); response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox"); response.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(photo.name)}`);
      response.end(photo.data); return;
    }
    if (request.method !== 'POST' || photoId) throw new RequestError(405, 'INVALID_INPUT', 'Method not allowed.');
    const actor = await identity(request); rate(`user:${project}:${actor.subject}`, 180);
    if (endpoint === 'rpc') {
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new RequestError(415, 'INVALID_INPUT', 'Use application/json.');
      const bytes = await read(request, 64 * 1024);
      let body: { method?: unknown; args?: unknown };
      try { body = JSON.parse(bytes.toString('utf8')) as typeof body; } catch { throw new RequestError(400, 'INVALID_INPUT', 'Invalid JSON.'); }
      if (!body || typeof body !== 'object' || typeof body.method !== 'string' || !Array.isArray(body.args)) throw new RequestError(400, 'INVALID_INPUT', 'Invalid RPC request.');
      const fresh = await identity(request);
      const result = await database.rpc(project, fresh.subject, body.method, body.args);
      if (WRITES.has(body.method)) broadcast(project);
      json(response, 200, { result: tickets.hydrate(result, project, fresh.subject) });
    } else {
      if (!database.access(project, actor.subject).allowed) throw new FeedbackError('ACCESS_DENIED', 'Feedback access has not been granted.');
      const data = await read(request, 5 * 1024 * 1024);
      const mime = await checkImage(data, request.headers['content-type'] ?? '');
      const rawName = request.headers['x-file-name']; let name: string;
      try { name = typeof rawName === 'string' ? decodeURIComponent(rawName) : ''; } catch { throw new RequestError(400, 'INVALID_INPUT', 'Invalid image name.'); }
      const fresh = await identity(request);
      const photo = await database.upload(project, fresh.subject, name, mime, data);
      json(response, 201, { result: tickets.attach(photo, project, fresh.subject) });
    }
  })().catch(error => {
    if (response.headersSent) { response.destroy(); return; }
    if (error instanceof RequestError) json(response, error.status, { error: { code: error.code, message: error.message } });
    else if (error instanceof FeedbackError) json(response, error.code === 'INVALID_INPUT' ? 400 : error.code.endsWith('CONFLICT') ? 409 : error.code === 'NOT_FOUND' ? 404 : 403, { error: { code: error.code, message: error.message } });
    else json(response, 500, { error: { code: 'SERVER_ERROR', message: 'The request could not be completed.' } });
  }); });
  server.requestTimeout = 30000; server.headersTimeout = 10000; server.maxHeadersCount = 40;
  const events = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/v1/events' || !originAllowed(request) || events.clients.size >= 256) { socket.destroy(); return; }
    events.handleUpgrade(request, socket, head, ws => events.emit('connection', ws, request));
  });
  events.on('connection', (socket: WebSocket) => {
    const timeout = setTimeout(() => socket.close(1008), 5000); let authenticating = false;
    socket.on('error', () => {}); socket.on('close', () => { clearTimeout(timeout); sockets.delete(socket); });
    socket.on('message', data => { void (async () => {
      if (authenticating || sockets.has(socket)) { socket.close(1008); return; } authenticating = true;
      const value = JSON.parse(data.toString()) as { type?: unknown; token?: unknown; projectId?: unknown };
      if (value.type !== 'auth' || typeof value.token !== 'string' || typeof value.projectId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/u.test(value.projectId)) throw new Error();
      const actor = await authenticate(value.token);
      if (!database.access(value.projectId, actor.subject).allowed || actor.expiresAt <= Date.now()) throw new Error();
      if (socket.readyState !== WebSocket.OPEN) return;
      clearTimeout(timeout); sockets.set(socket, { project: value.projectId, identity: actor }); socket.send('{"type":"ready"}');
    })().catch(() => { socket.send('{"type":"access-changed"}', () => socket.close(1008)); }); });
  });
  const check = setInterval(() => {
    for (const [socket, info] of sockets) {
      if (info.identity.expiresAt <= Date.now() || !database.access(info.project, info.identity.subject).allowed) { sockets.delete(socket); if (socket.readyState === WebSocket.OPEN) socket.send('{"type":"access-changed"}'); socket.close(1008); }
      else if (socket.readyState === WebSocket.OPEN) socket.ping();
    }
  }, options.accessCheckMs ?? 5000); check.unref();
  return {
    server,
    async close() { clearInterval(check); for (const socket of events.clients) socket.terminate(); events.close(); server.closeAllConnections(); if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
