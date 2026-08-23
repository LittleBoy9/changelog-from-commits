import { describe, expect, it } from 'vitest';
import { applyToChangelog, CHANGELOG_HEADER, hasVersionHeading } from '../src/changelog.js';

const section = '## 1.1.0 (2026-08-21)\n\n### Features\n\n* something new (abc1234)\n';

describe('applyToChangelog', () => {
  it('writes a header when there is no existing file', () => {
    const output = applyToChangelog(null, section);
    expect(output.startsWith(CHANGELOG_HEADER)).toBe(true);
    expect(output).toContain('## 1.1.0');
  });

  it('treats a whitespace-only file as empty', () => {
    expect(applyToChangelog('\n  \n', section).startsWith(CHANGELOG_HEADER)).toBe(true);
  });

  it('inserts above the newest existing release', () => {
    const existing = `# Changelog\n\nSome preamble.\n\n## 1.0.0 (2026-01-01)\n\n### Features\n\n* old thing (999aaaa)\n`;
    const output = applyToChangelog(existing, section);

    expect(output.indexOf('## 1.1.0')).toBeLessThan(output.indexOf('## 1.0.0'));
    expect(output.indexOf('Some preamble.')).toBeLessThan(output.indexOf('## 1.1.0'));
    expect(output).toContain('* old thing (999aaaa)');
  });

  it('appends when the file has a preamble but no releases yet', () => {
    const output = applyToChangelog('# Changelog\n\nNothing released yet.\n', section);
    expect(output.indexOf('Nothing released yet.')).toBeLessThan(output.indexOf('## 1.1.0'));
  });

  it('does not add leading blank lines to a file with no preamble', () => {
    const existing = '## 1.0.0 (2026-01-01)\n\n* old (999aaaa)\n';
    const output = applyToChangelog(existing, section);
    expect(output.startsWith('## 1.1.0')).toBe(true);
    expect(output.indexOf('## 1.1.0')).toBeLessThan(output.indexOf('## 1.0.0'));
  });

  it('normalizes CRLF line endings', () => {
    const existing = '# Changelog\r\n\r\n## 1.0.0 (2026-01-01)\r\n\r\n* old (999aaaa)\r\n';
    expect(applyToChangelog(existing, section)).not.toContain('\r');
  });

  it('leaves exactly one blank line around the new section', () => {
    const existing = '# Changelog\n\n## 1.0.0 (2026-01-01)\n\n* old (999aaaa)\n';
    const output = applyToChangelog(existing, section);
    expect(output).not.toMatch(/\n{3,}/);
  });

  it('ends with a single trailing newline', () => {
    const output = applyToChangelog('# Changelog\n\n## 1.0.0\n\n* old (999aaaa)\n', section);
    expect(output.endsWith('\n')).toBe(true);
    expect(output.endsWith('\n\n')).toBe(false);
  });

  it('is stable across repeated applications', () => {
    const once = applyToChangelog(null, section);
    const twice = applyToChangelog(once, '## 1.2.0 (2026-08-22)\n\n* newer (bbb2222)\n');
    expect(twice.indexOf('## 1.2.0')).toBeLessThan(twice.indexOf('## 1.1.0'));
    expect(twice.startsWith(CHANGELOG_HEADER)).toBe(true);
  });
});

describe('hasVersionHeading', () => {
  const existing = '# Changelog\n\n## [1.1.0](https://x/compare/a...b) (2026-08-21)\n\n## 1.0.0 (2026-01-01)\n';

  it('finds a plain heading', () => {
    expect(hasVersionHeading(existing, '1.0.0')).toBe(true);
  });

  it('finds a linked heading', () => {
    expect(hasVersionHeading(existing, '1.1.0')).toBe(true);
  });

  it('returns false for an unreleased version', () => {
    expect(hasVersionHeading(existing, '1.2.0')).toBe(false);
  });

  it('does not treat a version as a regex', () => {
    expect(hasVersionHeading(existing, '1.0.0'.replace(/0/g, '.'))).toBe(false);
  });

  it('does not match a prefix of a longer version', () => {
    expect(hasVersionHeading('## 1.0.0-beta.1 (2026-01-01)\n', '1.0.0')).toBe(false);
  });

  it('finds a heading with no trailing newline at end of file', () => {
    expect(hasVersionHeading('# Changelog\n\n## 1.0.0', '1.0.0')).toBe(true);
  });

  it('handles a missing file', () => {
    expect(hasVersionHeading(null, '1.0.0')).toBe(false);
  });
});
