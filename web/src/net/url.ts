/**
 * Robot base-URL normalisation and path-segment encoding.
 *
 * The normalised base string (`scheme://host:port`, no trailing slash) is also the key under which
 * sync baselines / tombstones are stored, so two spellings of the same robot share state.
 */

export const DEFAULT_ROBOT_PORT = 8888;

export interface ParsedRobotUrl {
  readonly scheme: 'http' | 'https';
  /** Lower-cased host; IPv6 literals keep their square brackets. */
  readonly host: string;
  readonly port: number;
  /** `scheme://host:port` — canonical, used as sync key and request prefix. */
  readonly base: string;
}

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//;
const HOST_RE = /^(?:\[[0-9a-fA-F:.%A-Za-z]+\]|[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?)$/;

/**
 * Accepts `192.168.43.1`, `host:port`, `http(s)://host[:port][/ignored/path]`.
 * Default scheme `http`, default port {@link DEFAULT_ROBOT_PORT}. Returns `null` when unusable.
 */
export function parseRobotUrl(input: string): ParsedRobotUrl | null {
  let text = input.trim();
  if (text === '') return null;

  let scheme: 'http' | 'https' = 'http';
  const m = SCHEME_RE.exec(text);
  if (m) {
    const s = (m[1] ?? '').toLowerCase();
    if (s !== 'http' && s !== 'https') return null;
    scheme = s;
    text = text.slice(m[0].length);
  }

  // Strip path / query / fragment — only the authority matters.
  const cut = text.search(/[/?#]/);
  const authority = cut >= 0 ? text.slice(0, cut) : text;
  if (authority === '' || authority.includes('@') || /\s/.test(authority)) return null;

  let host: string;
  let portText: string | undefined;
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    if (end < 0) return null;
    host = authority.slice(0, end + 1);
    const rest = authority.slice(end + 1);
    if (rest !== '') {
      if (!rest.startsWith(':')) return null;
      portText = rest.slice(1);
    }
  } else {
    const colon = authority.lastIndexOf(':');
    if (colon >= 0) {
      host = authority.slice(0, colon);
      portText = authority.slice(colon + 1);
    } else {
      host = authority;
    }
  }

  if (!HOST_RE.test(host)) return null;
  host = host.toLowerCase();

  let port = DEFAULT_ROBOT_PORT;
  if (portText !== undefined) {
    if (!/^\d{1,5}$/.test(portText)) return null;
    port = Number(portText);
    if (port < 1 || port > 65535) return null;
  }

  return { scheme, host, port, base: `${scheme}://${host}:${port}` };
}

/** Normalised base URL string, or `null` if the input cannot be a robot address. */
export function normalizeRobotUrl(input: string): string | null {
  return parseRobotUrl(input)?.base ?? null;
}

/** Hosts a browser treats as potentially trustworthy even over plain http. */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || /^127\.\d+\.\d+\.\d+$/.test(h) || h === '[::1]';
}

/**
 * True when an https page would be blocked from calling `url` (plain-http, non-loopback target).
 * `pageProtocol` is e.g. `location.protocol` (`'https:'`).
 */
export function isMixedContentCandidate(pageProtocol: string | undefined, url: string): boolean {
  if (pageProtocol !== 'https:') return false;
  const parsed = /^http:\/\/(\[[^\]]*\]|[^/:?#]*)/i.exec(url);
  if (!parsed) return false;
  return !isLoopbackHost(parsed[1] ?? '');
}

const HEX = '0123456789ABCDEF';

/** Percent-encode UTF-8 bytes, leaving only `A-Za-z0-9-._~` (stricter than encodeURIComponent). */
export function pathSegment(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let out = '';
  for (const v of bytes) {
    const isUnreserved =
      (v >= 0x41 && v <= 0x5a) || (v >= 0x61 && v <= 0x7a) || (v >= 0x30 && v <= 0x39) ||
      v === 0x2d || v === 0x2e || v === 0x5f || v === 0x7e;
    if (isUnreserved) out += String.fromCharCode(v);
    else out += '%' + HEX[v >>> 4] + HEX[v & 0x0f];
  }
  return out;
}

/**
 * Key-part escaping of ConfigRouteSyncBaselineStore.kt: UTF-8 percent-encoding that keeps only
 * `a-zA-Z0-9-_.` (so `~`, `:` and `/` ARE escaped and `:` is a safe separator).
 */
export function escapeKeyPart(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let out = '';
  for (const v of bytes) {
    const keep =
      (v >= 0x41 && v <= 0x5a) || (v >= 0x61 && v <= 0x7a) || (v >= 0x30 && v <= 0x39) ||
      v === 0x2d || v === 0x5f || v === 0x2e;
    if (keep) out += String.fromCharCode(v);
    else out += '%' + HEX[v >>> 4] + HEX[v & 0x0f];
  }
  return out;
}
