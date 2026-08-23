import { describe, expect, it } from 'vitest';
import { buildLinks, normalizeRemoteUrl, parseLog } from '../src/git.js';

describe('normalizeRemoteUrl', () => {
  it('normalizes scp-style ssh remotes', () => {
    expect(normalizeRemoteUrl('git@github.com:acme/widgets.git')).toBe(
      'https://github.com/acme/widgets',
    );
  });

  it('normalizes ssh:// remotes', () => {
    expect(normalizeRemoteUrl('ssh://git@github.com/acme/widgets.git')).toBe(
      'https://github.com/acme/widgets',
    );
  });

  it('normalizes https remotes', () => {
    expect(normalizeRemoteUrl('https://github.com/acme/widgets.git')).toBe(
      'https://github.com/acme/widgets',
    );
  });

  it('strips credentials from https remotes', () => {
    expect(normalizeRemoteUrl('https://user:token@github.com/acme/widgets.git')).toBe(
      'https://github.com/acme/widgets',
    );
  });

  it('keeps nested group paths, as GitLab uses', () => {
    expect(normalizeRemoteUrl('git@gitlab.com:group/sub/proj.git')).toBe(
      'https://gitlab.com/group/sub/proj',
    );
  });

  it('handles a remote without the .git suffix', () => {
    expect(normalizeRemoteUrl('https://github.com/acme/widgets')).toBe(
      'https://github.com/acme/widgets',
    );
  });

  it('handles a trailing slash', () => {
    expect(normalizeRemoteUrl('https://github.com/acme/widgets/')).toBe(
      'https://github.com/acme/widgets',
    );
  });

  it('returns null for unusable remotes', () => {
    expect(normalizeRemoteUrl('')).toBeNull();
    expect(normalizeRemoteUrl('   ')).toBeNull();
  });
});

describe('buildLinks', () => {
  it('builds GitHub URLs', () => {
    const links = buildLinks('https://github.com/acme/widgets');
    expect(links.host).toBe('github');
    expect(links.commit('abc')).toBe('https://github.com/acme/widgets/commit/abc');
    expect(links.pull(7)).toBe('https://github.com/acme/widgets/pull/7');
    expect(links.compare('v1', 'v2')).toBe('https://github.com/acme/widgets/compare/v1...v2');
  });

  it('builds GitLab URLs', () => {
    const links = buildLinks('https://gitlab.com/acme/widgets');
    expect(links.host).toBe('gitlab');
    expect(links.commit('abc')).toBe('https://gitlab.com/acme/widgets/-/commit/abc');
    expect(links.pull(7)).toBe('https://gitlab.com/acme/widgets/-/merge_requests/7');
  });

  it('builds Bitbucket URLs', () => {
    const links = buildLinks('https://bitbucket.org/acme/widgets');
    expect(links.host).toBe('bitbucket');
    expect(links.pull(7)).toBe('https://bitbucket.org/acme/widgets/pull-requests/7');
  });

  it('falls back to the GitHub URL shape for unknown hosts', () => {
    const links = buildLinks('https://git.example.com/acme/widgets');
    expect(links.host).toBe('unknown');
    expect(links.commit('abc')).toBe('https://git.example.com/acme/widgets/commit/abc');
  });

  it('tolerates a trailing slash', () => {
    expect(buildLinks('https://github.com/acme/widgets/').commit('abc')).toBe(
      'https://github.com/acme/widgets/commit/abc',
    );
  });
});

describe('parseLog', () => {
  it('returns nothing for empty output', () => {
    expect(parseLog('')).toEqual([]);
    expect(parseLog('  \n ')).toEqual([]);
  });

  it('keeps a body that itself contains a field separator', () => {
    const record = ['h', 's', 'n', 'e', 'd', 'p', 'subject', 'body\x1fwith sep'].join('\x1f') + '\x1e';
    expect(parseLog(record)[0]!.body).toBe('body\x1fwith sep');
  });
});
