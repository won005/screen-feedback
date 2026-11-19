import { createRemoteJWKSet, createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
export interface Identity { subject: string; expiresAt: number }
export type Authenticate = (token: string) => Promise<Identity>;

export function createJwtAuthenticator(options: { issuer: string; audience: string; jwksUrl?: string; jwks?: JSONWebKeySet }): Authenticate {
  if (!options.issuer || !options.audience) throw new Error('JWT issuer and audience are required.');
  if (Boolean(options.jwks) === Boolean(options.jwksUrl)) throw new Error('Provide exactly one JWKS source.');
  const url = options.jwksUrl ? new URL(options.jwksUrl) : null;
  if (url && (url.protocol !== 'https:' || url.username || url.password)) throw new Error('JWKS URL must use HTTPS.');
  const key = options.jwks ? createLocalJWKSet(options.jwks) : createRemoteJWKSet(url!, { timeoutDuration: 5000 });
  return async token => {
    if (typeof token !== 'string' || token.length > 16000) throw new Error('Invalid token.');
    const { payload } = await jwtVerify(token, key, { issuer: options.issuer, audience: options.audience, algorithms: ['RS256', 'ES256'], requiredClaims: ['sub', 'iat', 'exp'], maxTokenAge: '1h' });
    const expiresAt = Math.min(payload.exp!, payload.iat! + 3600) * 1000;
    if (!payload.sub?.trim() || payload.sub !== payload.sub.trim() || payload.sub.length > 128 || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat) || expiresAt <= Date.now()) throw new Error('Invalid token claims.');
    return { subject: payload.sub, expiresAt };
  };
}
