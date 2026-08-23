import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, findConfigFile, loadConfig, validateConfig } from '../src/config.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cfc-config-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('findConfigFile', () => {
  it('returns null when there is nothing to find', () => {
    expect(findConfigFile(tempDir())).toBeNull();
  });

  it('finds a config in the directory itself', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.changelogrc.json'), '{}');
    expect(findConfigFile(dir)).toBe(join(dir, '.changelogrc.json'));
  });

  it('searches upward from a subdirectory', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'changelog.config.json'), '{}');
    const nested = join(dir, 'packages', 'app');
    mkdirSync(nested, { recursive: true });
    expect(findConfigFile(nested)).toBe(join(dir, 'changelog.config.json'));
  });

  it('prefers changelog.config.js over .changelogrc.json', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.changelogrc.json'), '{}');
    writeFileSync(join(dir, 'changelog.config.js'), 'module.exports = {};');
    expect(findConfigFile(dir)).toBe(join(dir, 'changelog.config.js'));
  });
});

describe('loadConfig', () => {
  it('returns an empty config when no file exists', async () => {
    expect(await loadConfig(tempDir())).toEqual({ config: {}, filepath: null });
  });

  it('loads JSON config', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.changelogrc.json'), JSON.stringify({ tagPrefix: 'v' }));
    const { config } = await loadConfig(dir);
    expect(config.tagPrefix).toBe('v');
  });

  it('loads an extensionless .changelogrc as JSON', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.changelogrc'), '{"output":"HISTORY.md"}');
    expect((await loadConfig(dir)).config.output).toBe('HISTORY.md');
  });

  it('loads a CommonJS config', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'changelog.config.cjs'), 'module.exports = { tagPrefix: "v" };');
    expect((await loadConfig(dir)).config.tagPrefix).toBe('v');
  });

  it('loads an ESM config', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'changelog.config.mjs'), 'export default { output: "OUT.md" };');
    expect((await loadConfig(dir)).config.output).toBe('OUT.md');
  });

  it('calls a config that exports a function', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'changelog.config.cjs'), 'module.exports = () => ({ tagPrefix: "fn" });');
    expect((await loadConfig(dir)).config.tagPrefix).toBe('fn');
  });

  it('loads an explicit path', async () => {
    const dir = tempDir();
    const path = join(dir, 'custom.json');
    writeFileSync(path, '{"tagPrefix":"custom"}');
    const { config, filepath } = await loadConfig(dir, 'custom.json');
    expect(config.tagPrefix).toBe('custom');
    expect(filepath).toBe(path);
  });

  it('errors when an explicit path is missing', async () => {
    await expect(loadConfig(tempDir(), 'nope.json')).rejects.toThrow(/Config file not found/);
  });

  it('errors on malformed JSON', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.changelogrc.json'), '{ not json');
    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
  });
});

describe('validateConfig', () => {
  it('accepts an empty or absent config', () => {
    expect(validateConfig({})).toEqual({});
    expect(validateConfig(null)).toEqual({});
  });

  it('drops unknown keys', () => {
    expect(validateConfig({ tagPrefix: 'v', nonsense: 1 })).toEqual({ tagPrefix: 'v' });
  });

  it('rejects a non-object', () => {
    expect(() => validateConfig([])).toThrow(/must export an object/);
    expect(() => validateConfig('nope')).toThrow(/must export an object/);
  });

  it('rejects wrong types', () => {
    expect(() => validateConfig({ tagPrefix: 1 })).toThrow(/"tagPrefix" must be a string/);
    expect(() => validateConfig({ includeAll: 'yes' })).toThrow(/"includeAll" must be a boolean/);
    expect(() => validateConfig({ types: {} })).toThrow(/"types" must be an array/);
  });

  it('accepts a paths array', () => {
    expect(validateConfig({ paths: ['packages/web'] }).paths).toEqual(['packages/web']);
  });

  it('rejects a malformed paths value', () => {
    expect(() => validateConfig({ paths: 'packages/web' })).toThrow(/array of strings/);
    expect(() => validateConfig({ paths: [1] })).toThrow(/array of strings/);
  });

  it('accepts pairReverts', () => {
    expect(validateConfig({ pairReverts: false }).pairReverts).toBe(false);
    expect(() => validateConfig({ pairReverts: 'no' })).toThrow(/must be a boolean/);
  });

  it('accepts prereleaseTags', () => {
    expect(validateConfig({ prereleaseTags: 'skip' }).prereleaseTags).toBe('skip');
    expect(() => validateConfig({ prereleaseTags: 'sometimes' })).toThrow(/auto, skip, or include/);
    expect(() => validateConfig({ prereleaseTags: 1 })).toThrow(/auto, skip, or include/);
  });

  it('accepts showReferences', () => {
    expect(validateConfig({ showReferences: false }).showReferences).toBe(false);
    expect(() => validateConfig({ showReferences: 'no' })).toThrow(/must be a boolean/);
  });

  it('accepts an aliases map and lowercases it', () => {
    expect(validateConfig({ aliases: { Enhancement: 'FEAT' } }).aliases).toEqual({
      enhancement: 'feat',
    });
  });

  it('rejects a malformed aliases map', () => {
    expect(() => validateConfig({ aliases: ['feat'] })).toThrow(/object of string to string/);
    expect(() => validateConfig({ aliases: { feature: 1 } })).toThrow(/object of string to string/);
  });

  it('accepts keepEmoji', () => {
    expect(validateConfig({ keepEmoji: true }).keepEmoji).toBe(true);
    expect(() => validateConfig({ keepEmoji: 'yes' })).toThrow(/must be a boolean/);
  });

  it('normalizes the types table', () => {
    const config = validateConfig({ types: [{ type: 'FEAT', title: 'Features' }, { type: 'chore' }] });
    expect(config.types).toEqual([
      { type: 'feat', title: 'Features', hidden: false },
      { type: 'chore', title: 'chore', hidden: false },
    ]);
  });

  it('rejects a malformed types entry', () => {
    expect(() => validateConfig({ types: [{ title: 'No type' }] })).toThrow(/must be a non-empty string/);
    expect(() => validateConfig({ types: [{ type: 'feat', hidden: 'yes' }] })).toThrow(/must be a boolean/);
  });
});
