import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { BRAND } from './brand.js'
import { DSH_MOBILE_VERSION } from './version.js'

/**
 * QuWork ships this plugin inside its own desktop client, so there is no npm or
 * GitHub release channel to query. The manager below reports the bundled
 * versions only; it never contacts an upstream registry and never replaces the
 * installed profile package. Update discovery belongs to the QuWork client.
 */
const PACKAGE_NAME = 'qurwork-mobile'

const bundledAndroidRelease: unknown = createRequire(import.meta.url)('../apps/mobile/release.json')

const NUMERIC_VERSION_IDENTIFIER = '(?:0|[1-9]\\d*)'
const WILDCARD_VERSION_IDENTIFIER = '(?:[xX*])'
const PARTIAL_VERSION = `(?:${WILDCARD_VERSION_IDENTIFIER}|${NUMERIC_VERSION_IDENTIFIER}(?:\\.(?:${WILDCARD_VERSION_IDENTIFIER}|${NUMERIC_VERSION_IDENTIFIER}(?:\\.(?:${WILDCARD_VERSION_IDENTIFIER}|${NUMERIC_VERSION_IDENTIFIER}))?))?)`
const FULL_VERSION = `${NUMERIC_VERSION_IDENTIFIER}\\.${NUMERIC_VERSION_IDENTIFIER}\\.${NUMERIC_VERSION_IDENTIFIER}(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?`
const RANGE_VERSION = `(?:${FULL_VERSION}|${PARTIAL_VERSION})`
const COMPARATOR = new RegExp(`^(?:<=|>=|<|>|=|~|\\^)?${RANGE_VERSION}$`, 'u')
const HYPHEN_RANGE = new RegExp(`^${RANGE_VERSION} +[-] +${RANGE_VERSION}$`, 'u')
const DIST_TAG = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u

interface Semver {
  readonly core: readonly [number, number, number]
  readonly prerelease: readonly (number | string)[]
}

/** Release information safe to return through the loopback administration API. */
export interface PluginReleaseStatus {
  readonly installedVersion: string
  readonly latestVersion?: string
  readonly updateAvailable: boolean
  readonly updateSupported: boolean
  readonly androidVersion?: string
  readonly androidDownloadUrl: string
  /** Actual byte sizes of the published APKs, resolved from the GitHub release assets. */
  readonly androidCompatBytes?: number
  readonly androidIrohBytes?: number
  /** Trimmed GitHub release notes for the selected npm version. */
  readonly releaseNotes?: string
}

/** Result returned after the profile package has been replaced successfully. */
export interface PluginUpdateResult {
  readonly installedVersion: string
  readonly restartRequired: true
}

interface PluginReleaseManagerOptions {
  readonly profileDirectory?: string | undefined
  readonly installedVersion?: string
}

function parseSemver(value: string): Semver | undefined {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value)
  if (match === null) return undefined
  const core = [Number(match[1]), Number(match[2]), Number(match[3])] as const
  if (core.some(part => !Number.isSafeInteger(part))) return undefined
  const prerelease = match[4] === undefined
    ? []
    : match[4].split('.').map((part): number | string => /^\d+$/u.test(part) ? Number(part) : part)
  if (prerelease.some(part => typeof part === 'number' && !Number.isSafeInteger(part))) return undefined
  return Object.freeze({ core, prerelease: Object.freeze(prerelease) })
}

/** Compare two strict SemVer strings, including prerelease precedence. */
export function comparePluginVersions(left: string, right: string): number | undefined {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (a === undefined || b === undefined) return undefined
  for (let index = 0; index < a.core.length; index += 1) {
    const difference = a.core[index]! - b.core[index]!
    if (difference !== 0) return Math.sign(difference)
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1
    if (leftPart === rightPart) continue
    if (typeof leftPart === 'number' && typeof rightPart === 'number') return Math.sign(leftPart - rightPart)
    if (typeof leftPart === 'number') return -1
    if (typeof rightPart === 'number') return 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

function isComparatorSet(value: string): boolean {
  if (HYPHEN_RANGE.test(value)) return true
  const normalized = value.replace(/(<=|>=|<|>|=|~|\^) +/gu, '$1')
  const comparators = normalized.split(/ +/u)
  return comparators.length > 0 && comparators.every(comparator => COMPARATOR.test(comparator))
}

function isNpmVersionRange(value: string): boolean {
  if (!/^[0-9xX*<>=~^|.+\- ]+$/u.test(value)) return false
  const alternatives = value.split(/ *\|\| */u)
  return alternatives.length > 0 && alternatives.every(alternative => alternative !== '' && isComparatorSet(alternative))
}

/** Return whether a dependency spec names an npm version, range, or tag. */
export function isRegistryPluginSpec(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() !== value || value === '' || /[\u0000-\u001f\u007f]/u.test(value)) return false
  if (/\.(?:tgz|tar(?:\.gz)?)$/iu.test(value)) return false
  return parseSemver(value) !== undefined || isNpmVersionRange(value) || DIST_TAG.test(value)
}

/** Resolve the DSH profile named by the current launcher arguments. */
export function launchedProfileName(argv: readonly string[]): string {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--profile') {
      const candidate = argv[index + 1]
      if (candidate !== undefined && /^[\w.-]+$/u.test(candidate)) return candidate
    }
    const match = /^--profile=([\w.-]+)$/u.exec(argv[index] ?? '')
    if (match?.[1] !== undefined) return match[1]
  }
  return 'web'
}

interface DesktopProfiles {
  readonly current?: { readonly dir?: string }
}

function profileInstallingModule(dshHome: string, moduleUrl: string): string | undefined {
  let directory: string
  try {
    directory = dirname(fileURLToPath(moduleUrl))
  } catch {
    return undefined
  }
  const profilesRoot = resolve(dshHome, 'profiles')
  for (let depth = 0; depth < 16; depth += 1) {
    const candidate = resolve(directory)
    const fromProfiles = relative(profilesRoot, candidate)
    if (fromProfiles !== '' && !fromProfiles.startsWith('..') && !isAbsolute(fromProfiles)) {
      try {
        const manifest = JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8')) as {
          readonly dependencies?: Readonly<Record<string, unknown>>
          readonly dsh?: { readonly profile?: unknown }
        }
        if (typeof manifest.dependencies?.[PACKAGE_NAME] === 'string'
          && typeof manifest.dsh?.profile === 'object' && manifest.dsh.profile !== null) {
          return candidate
        }
      } catch { /* Keep walking toward the profile root. */ }
    }
    const parent = dirname(candidate)
    if (parent === candidate) break
    directory = parent
  }
  return undefined
}

/** Resolve the launcher-owned Desktop profile, or the CLI profile outside Desktop. */
export function releaseProfileDirectory(
  ctx: Pick<Context, 'get'>,
  dshHome: string,
  argv: readonly string[],
  moduleUrl: string = import.meta.url,
): string | undefined {
  const desktopProfiles = ctx.get('desktopProfiles') as DesktopProfiles | undefined
  const desktopDirectory = desktopProfiles?.current?.dir
  if (typeof desktopDirectory === 'string' && isAbsolute(desktopDirectory)) return desktopDirectory
  const installedProfile = profileInstallingModule(dshHome, moduleUrl)
  if (installedProfile !== undefined) return installedProfile
  // Desktop selects its profile outside argv; never update an unrelated Web profile.
  if (desktopProfiles !== undefined || ctx.get('desktopRuntime') !== undefined) return undefined
  return join(dshHome, 'profiles', launchedProfileName(argv))
}

/** Version of the App bundled beside this plugin, or undefined when unreadable. */
function bundledAndroidVersion(): string | undefined {
  if (typeof bundledAndroidRelease !== 'object' || bundledAndroidRelease === null) return undefined
  const fields = bundledAndroidRelease as { readonly version?: unknown; readonly versionCode?: unknown }
  return Number.isSafeInteger(fields.versionCode) && Number(fields.versionCode) > 0
    && typeof fields.version === 'string' && parseSemver(fields.version) !== undefined
    ? fields.version
    : undefined
}

/** Reports the bundled plugin/App versions; the QuWork client owns update delivery. */
export class PluginReleaseManager {
  private readonly installedVersion: string

  constructor(options: PluginReleaseManagerOptions = {}) {
    this.installedVersion = options.installedVersion ?? DSH_MOBILE_VERSION
  }

  /** Report bundled versions only. No external lookup happens on this path. */
  async status(): Promise<PluginReleaseStatus> {
    const android = bundledAndroidVersion()
    return Object.freeze({
      installedVersion: this.installedVersion,
      ...(android === undefined ? {} : { androidVersion: android }),
      androidDownloadUrl: BRAND.downloadPageUrl,
      updateAvailable: false,
      updateSupported: false,
    })
  }

  /** No background work remains because external release lookups were removed. */
  async dispose(): Promise<void> {}

  /** Bundled plugins are updated together with the QuWork client. */
  async update(): Promise<PluginUpdateResult> {
    throw new Error('plugin_update_unsupported')
  }
}
