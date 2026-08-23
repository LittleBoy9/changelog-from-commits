import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, parse as parsePath, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ChangelogConfig, TypeConfig } from './types.js';

/** Config file names, in resolution order. The first one found wins. */
export const CONFIG_FILENAMES = [
  'changelog.config.js',
  'changelog.config.mjs',
  'changelog.config.cjs',
  'changelog.config.json',
  '.changelogrc.js',
  '.changelogrc.mjs',
  '.changelogrc.cjs',
  '.changelogrc.json',
  '.changelogrc',
];

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface LoadedConfig {
  config: ChangelogConfig;
  /** Absolute path of the file that was loaded, or `null` when none was found. */
  filepath: string | null;
}

/**
 * `require` bound to an absolute base, so it works identically from the CJS and
 * ESM builds. We always call it with an absolute path, so the base only needs to
 * exist as a resolution anchor.
 */
const requireConfig = createRequire(join(process.cwd(), '__changelog_from_commits__.js'));

/** Node's error codes for "this is ESM, you must import it". */
const ESM_ONLY = new Set(['ERR_REQUIRE_ESM', 'ERR_REQUIRE_ASYNC_MODULE']);

/**
 * Load a JS config file, whether it is CommonJS or ESM.
 *
 * `require` handles both on Node >= 22.12 and CommonJS everywhere. Older Node
 * rejects real ESM, so we fall back to a dynamic import there.
 */
async function importConfigModule(filepath: string): Promise<unknown> {
  try {
    const loaded = requireConfig(filepath) as unknown;
    return unwrapDefault(loaded);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!code || !ESM_ONLY.has(code)) throw error;
  }

  const module = (await import(pathToFileURL(filepath).href)) as Record<string, unknown>;
  return unwrapDefault(module);
}

function unwrapDefault(module: unknown): unknown {
  if (module && typeof module === 'object' && 'default' in module) {
    return (module as { default: unknown }).default;
  }
  return module;
}

/** Search `cwd` and its ancestors for a config file. */
export function findConfigFile(cwd: string): string | null {
  let dir = resolve(cwd);

  for (;;) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }

    const parent = dirname(dir);
    if (parent === dir || dir === parsePath(dir).root) return null;
    dir = parent;
  }
}

/**
 * Load a config file.
 *
 * When `explicitPath` is given the file must exist; otherwise we search upward
 * and quietly return an empty config if there is nothing to load.
 */
export async function loadConfig(cwd: string, explicitPath?: string | null): Promise<LoadedConfig> {
  let filepath: string | null;

  if (explicitPath) {
    filepath = isAbsolute(explicitPath) ? explicitPath : resolve(cwd, explicitPath);
    if (!existsSync(filepath)) {
      throw new ConfigError(`Config file not found: ${explicitPath}`);
    }
  } else {
    filepath = findConfigFile(cwd);
  }

  if (!filepath) return { config: {}, filepath: null };

  const raw = await readConfigFile(filepath);
  return { config: validateConfig(raw, filepath), filepath };
}

async function readConfigFile(filepath: string): Promise<unknown> {
  if (/\.(json|changelogrc)$/.test(filepath) || filepath.endsWith('.changelogrc')) {
    try {
      return JSON.parse(readFileSync(filepath, 'utf8'));
    } catch (error) {
      throw new ConfigError(`Could not parse ${filepath}: ${(error as Error).message}`);
    }
  }

  let value: unknown;
  try {
    value = await importConfigModule(filepath);
  } catch (error) {
    throw new ConfigError(`Could not load ${filepath}: ${(error as Error).message}`);
  }

  // A config file may export a function so it can compute values lazily.
  return typeof value === 'function' ? (value as () => unknown)() : value;
}

/** Check the shape of a loaded config and drop unknown keys. */
export function validateConfig(raw: unknown, source = 'config'): ChangelogConfig {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError(`${source} must export an object.`);
  }

  const input = raw as Record<string, unknown>;
  const config: ChangelogConfig = {};

  for (const key of ['from', 'to', 'output', 'version', 'tagPrefix', 'otherTitle'] as const) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      throw new ConfigError(`${source}: "${key}" must be a string.`);
    }
    config[key] = value;
  }

  for (const key of [
    'includeAll',
    'linkReferences',
    'pairReverts',
    'showReferences',
    'keepEmoji',
  ] as const) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'boolean') {
      throw new ConfigError(`${source}: "${key}" must be a boolean.`);
    }
    config[key] = value;
  }

  if (input.repoUrl !== undefined && input.repoUrl !== null) {
    if (typeof input.repoUrl !== 'string') {
      throw new ConfigError(`${source}: "repoUrl" must be a string.`);
    }
    config.repoUrl = input.repoUrl;
  }

  if (input.prereleaseTags !== undefined && input.prereleaseTags !== null) {
    if (
      typeof input.prereleaseTags !== 'string' ||
      !['auto', 'skip', 'include'].includes(input.prereleaseTags)
    ) {
      throw new ConfigError(`${source}: "prereleaseTags" must be auto, skip, or include.`);
    }
    config.prereleaseTags = input.prereleaseTags as ChangelogConfig['prereleaseTags'];
  }

  if (input.paths !== undefined && input.paths !== null) {
    if (!Array.isArray(input.paths) || input.paths.some((v) => typeof v !== 'string')) {
      throw new ConfigError(`${source}: "paths" must be an array of strings.`);
    }
    config.paths = input.paths as string[];
  }

  if (input.aliases !== undefined && input.aliases !== null) {
    if (
      typeof input.aliases !== 'object' ||
      Array.isArray(input.aliases) ||
      Object.values(input.aliases as Record<string, unknown>).some((v) => typeof v !== 'string')
    ) {
      throw new ConfigError(`${source}: "aliases" must be an object of string to string.`);
    }
    config.aliases = Object.fromEntries(
      Object.entries(input.aliases as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v.toLowerCase(),
      ]),
    );
  }

  if (input.types !== undefined && input.types !== null) {
    config.types = validateTypes(input.types, source);
  }

  return config;
}

function validateTypes(value: unknown, source: string): TypeConfig[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(`${source}: "types" must be an array.`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ConfigError(`${source}: types[${index}] must be an object.`);
    }

    const { type, title, hidden } = entry as Record<string, unknown>;
    if (typeof type !== 'string' || !type) {
      throw new ConfigError(`${source}: types[${index}].type must be a non-empty string.`);
    }
    if (title !== undefined && typeof title !== 'string') {
      throw new ConfigError(`${source}: types[${index}].title must be a string.`);
    }
    if (hidden !== undefined && typeof hidden !== 'boolean') {
      throw new ConfigError(`${source}: types[${index}].hidden must be a boolean.`);
    }

    return {
      type: type.toLowerCase(),
      title: (title as string) ?? type,
      hidden: Boolean(hidden),
    };
  });
}
