import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROBOT_PORT,
  escapeKeyPart,
  isLoopbackHost,
  isMixedContentCandidate,
  normalizeRobotUrl,
  parseRobotUrl,
  pathSegment,
} from '../../src/net/url';

describe('normalizeRobotUrl', () => {
  it('adds default scheme and port', () => {
    expect(normalizeRobotUrl('192.168.43.1')).toBe('http://192.168.43.1:8888');
    expect(DEFAULT_ROBOT_PORT).toBe(8888);
  });

  it('keeps an explicit port and scheme, lower-cases the host', () => {
    expect(normalizeRobotUrl('Robot.LOCAL:9000')).toBe('http://robot.local:9000');
    expect(normalizeRobotUrl('HTTPS://Example.com:8443')).toBe('https://example.com:8443');
    expect(normalizeRobotUrl('http://10.0.0.5')).toBe('http://10.0.0.5:8888');
  });

  it('ignores path, query, fragment and surrounding whitespace', () => {
    expect(normalizeRobotUrl('  http://192.168.43.1:8888/api/v2/health?x=1#frag  ')).toBe('http://192.168.43.1:8888');
    expect(normalizeRobotUrl('192.168.43.1/')).toBe('http://192.168.43.1:8888');
  });

  it('two spellings of one robot normalise to the same key', () => {
    expect(normalizeRobotUrl('192.168.43.1')).toBe(normalizeRobotUrl('http://192.168.43.1:8888/'));
  });

  it('supports IPv6 literals', () => {
    expect(normalizeRobotUrl('[::1]')).toBe('http://[::1]:8888');
    expect(normalizeRobotUrl('http://[fe80::1]:9001/x')).toBe('http://[fe80::1]:9001');
    expect(normalizeRobotUrl('[::1')).toBeNull();
    expect(normalizeRobotUrl('[::1]x')).toBeNull();
  });

  it.each([
    '', '   ', 'ftp://robot', 'ws://robot', 'http://', 'host:abc', 'host:0', 'host:65536', 'host:-1',
    'user@host', 'a b', 'http://:8888', '-bad-.', 'host:', 'ho$t',
  ])('rejects %j', (input) => {
    expect(normalizeRobotUrl(input)).toBeNull();
  });

  it('parseRobotUrl exposes the parts', () => {
    expect(parseRobotUrl('https://r.local:1')).toEqual({ scheme: 'https', host: 'r.local', port: 1, base: 'https://r.local:1' });
  });
});

describe('mixed content', () => {
  it('flags plain-http non-loopback targets from an https page only', () => {
    expect(isMixedContentCandidate('https:', 'http://192.168.43.1:8888/api')).toBe(true);
    expect(isMixedContentCandidate('https:', 'http://localhost:8888/api')).toBe(false);
    expect(isMixedContentCandidate('https:', 'http://127.0.0.1:8888')).toBe(false);
    expect(isMixedContentCandidate('https:', 'http://[::1]:8888')).toBe(false);
    expect(isMixedContentCandidate('https:', 'https://robot.local:8888')).toBe(false);
    expect(isMixedContentCandidate('http:', 'http://192.168.43.1:8888')).toBe(false);
    expect(isMixedContentCandidate(undefined, 'http://192.168.43.1:8888')).toBe(false);
  });

  it('isLoopbackHost', () => {
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('a.localhost')).toBe(true);
    expect(isLoopbackHost('127.9.9.9')).toBe(true);
    expect(isLoopbackHost('192.168.0.1')).toBe(false);
  });
});

describe('path segment encoding', () => {
  it('matches the contract-test encoding of a Chinese route name', () => {
    expect(pathSegment('蓝 路径(A)')).toBe('%E8%93%9D%20%E8%B7%AF%E5%BE%84%28A%29');
  });

  it('keeps only unreserved characters', () => {
    expect(pathSegment('aZ09-._~')).toBe('aZ09-._~');
    expect(pathSegment('a/b?c#d%e+f')).toBe('a%2Fb%3Fc%23d%25e%2Bf');
    expect(pathSegment('😀')).toBe('%F0%9F%98%80');
  });

  it('escapeKeyPart also escapes ~ and :', () => {
    expect(escapeKeyPart('http://h:8888')).toBe('http%3A%2F%2Fh%3A8888');
    expect(escapeKeyPart('a~b')).toBe('a%7Eb');
    expect(escapeKeyPart('ok-_.')).toBe('ok-_.');
  });
});
