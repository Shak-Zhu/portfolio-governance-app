// 单用户网页登录（email + password）与 HMAC 签名 Session Cookie
// - 凭据从 Worker Secret 读取（SHAK_PMO_WEB_LOGIN_EMAIL / SHAK_PMO_WEB_LOGIN_PASSWORD）
// - Session Secret: SHAK_PMO_SESSION_SECRET（HMAC-SHA256 签名 + 32 字节随机 nonce）
// - 时序安全比较（Web Crypto subtle.timingSafeEqual 等价实现）
// - HttpOnly; Secure; SameSite=Strict; Path=/; 8 小时有效
// - 凭据与 Cookie 派生值绝不写入 D1/R2/Git/public/Skill/manifest/日志/RESULT

export const SESSION_COOKIE_NAME = 'shak_pmo_session';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface AuthEnv {
  SHAK_PMO_WEB_LOGIN_EMAIL?: string;
  SHAK_PMO_WEB_LOGIN_PASSWORD?: string;
  SHAK_PMO_SESSION_SECRET?: string;
}

export interface SessionPayload {
  sub: string;
  exp: number; // ms 过期时间
  nonce: string;
  issuedAt: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

// ============ 时序安全比较 ============
// 真实场景下口令 / token 比对需要：
//   1. 长度不同时仍消耗时间，不侧信道泄漏长度；
//   2. 字符差异时仍遍历至末尾。
// Node 的 crypto.timingSafeEqual 只接受 Buffer；这里用 Web Crypto 实现等价语义。
//
// 方法：
//   - 将 a, b 各自 UTF-8 编码；
//   - 分别做 SHA-256 摘要（仍是常量时间路径，输出恒等长 32 字节）；
//   - 再对两段摘要做等长字节 XOR 累积；
//   - 长度差异也并入 diff；
//   - 始终遍历到 max 长度。
// 这种实现保留了 Node `timingSafeEqual` 的核心：比较两个等长“摘要”，不提前返。
async function sha256(s: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return new Uint8Array(buf);
}

export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  // 把两个字符串分别做 SHA-256（常量时间路径）；再对两段 32 字节摘要做
  // 字节 XOR（等长定长，无提前返）。
  const sa = await sha256(a);
  const sb = await sha256(b);
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa[i] ^ sb[i];
  // 长度差异并入：长度本身分别 ASCII 入栈 8 字节，与摘要异或同样等长定长。
  const la = new Uint8Array(8);
  const lb = new Uint8Array(8);
  // 大端填充长度（用临时 let，TS 不允许 const +=/>>>=）
  let av_tmp = a.length;
  let bv_tmp = b.length;
  for (let i = 7; i >= 0; i--) {
    la[i] = av_tmp & 0xff; av_tmp >>>= 8;
    lb[i] = bv_tmp & 0xff; bv_tmp >>>= 8;
  }
  for (let i = 0; i < 8; i++) diff |= la[i] ^ lb[i];
  return diff === 0;
}

// ============ 十六进制与字节 ============
function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < out.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ============ 随机字节（Web Crypto）============
function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

// ============ HMAC-SHA256 ============
async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return bytesToHex(new Uint8Array(sig));
}

async function verifyHmac(secret: string, data: string, sigHex: string): Promise<boolean> {
  // Web Crypto subtle.verify 的官方签名是：
  //   verify(algorithm, key, signature, data)
  // 早期版本曾误写为 verify(..., data, signature)；这是 WP-006 QC 指出的 P0 修复点。
  // 错误实现：crypto.subtle.verify('HMAC', key, enc.encode(data), sigBytes)
  // 正确实现：crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data))
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
  } catch {
    return false;
  }
  let sigBytes: Uint8Array;
  try {
    sigBytes = hexToBytes(sigHex);
  } catch {
    return false;
  }
  try {
    return await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data));
  } catch {
    return false;
  }
}

// ============ 凭据校验（不允许空 fallback） ============
export interface LoginOk { ok: true; sub: string }
export interface LoginFail { ok: false; reason: string }

export async function verifyLoginCredentials(
  env: AuthEnv,
  email: string,
  password: string
): Promise<LoginOk | LoginFail> {
  const e = (env.SHAK_PMO_WEB_LOGIN_EMAIL || '').trim();
  const p = env.SHAK_PMO_WEB_LOGIN_PASSWORD || '';
  if (!e || !p) {
    return { ok: false, reason: '服务未配置登录凭据' };
  }
  const emailOk = await timingSafeEqual(String(email || '').trim().toLowerCase(), e.toLowerCase());
  const pwdOk = await timingSafeEqual(String(password || ''), p);
  if (!emailOk || !pwdOk) {
    return { ok: false, reason: '邮箱或密码错误' };
  }
  return { ok: true, sub: e };
}

// ============ Session：签发与验证 ============
export async function issueSession(secret: string, sub: string): Promise<string> {
  const payload: SessionPayload = {
    sub,
    exp: Date.now() + SESSION_TTL_MS,
    nonce: bytesToHex(randomBytes(16)),
    issuedAt: Date.now(),
  };
  const body = bytesToBase64Url(enc.encode(JSON.stringify(payload)));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

export async function verifySession(secret: string, token: string | null | undefined): Promise<SessionPayload | null> {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let ok = false;
  try {
    ok = await verifyHmac(secret, body, sig);
  } catch {
    return null;
  }
  if (!ok) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(dec.decode(base64UrlToBytes(body))) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null;
  if (typeof payload.sub !== 'string' || !payload.sub) return null;
  return payload;
}

// ============ Cookie 序列化 ============
export function buildSessionCookie(token: string, secure: boolean): string {
  // HttpOnly; SameSite=Strict; Path=/; Secure（当 secure=true，本地 dev 为 false 便于 curl 测试）
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildLogoutCookie(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// ============ Cookie 解析 ============
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(eq + 1));
  }
  return out;
}
