import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  PluginReleaseManager,
  comparePluginVersions,
  isRegistryPluginSpec,
  launchedProfileName,
  releaseProfileDirectory,
} from '../src/release-update.js'
import { BRAND } from '../src/brand.js'

const temporaryDirectories: string[] = []
const bundledApp = JSON.parse(readFileSync(new URL('../apps/mobile/release.json', import.meta.url), 'utf8')) as { readonly version: string; readonly versionCode: number; readonly releaseTag: string }

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function profileDirectory(spec: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'quwork-mobile-release-'))
  temporaryDirectories.push(directory)
  await writeFile(join(directory, 'package.json'), JSON.stringify({ dependencies: { 'quwork-mobile': spec } }))
  return directory
}

describe('bundled release reporting', () => {
  it('reports bundled plugin and App versions without any upstream request', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    const manager = new PluginReleaseManager({ installedVersion: '0.3.2' })

    await expect(manager.status()).resolves.toEqual({
      installedVersion: '0.3.2',
      androidVersion: bundledApp.version,
      androidDownloadUrl: BRAND.downloadPageUrl,
      updateAvailable: false,
      updateSupported: false,
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('defaults the installed version to the plugin build version', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('upstream must not be contacted') }))
    const status = await new PluginReleaseManager().status()
    expect(status.installedVersion).toMatch(/^\d+\.\d+\.\d+/u)
    expect(status.updateAvailable).toBe(false)
    expect(status.updateSupported).toBe(false)
  })

  it('refuses to replace the installed package from inside the client', async () => {
    const manager = new PluginReleaseManager({ profileDirectory: await profileDirectory('^0.3.2') })
    await expect(manager.update()).rejects.toThrow('plugin_update_unsupported')
  })

  it('resolves dispose without background work', async () => {
    await expect(new PluginReleaseManager().dispose()).resolves.toBeUndefined()
  })
})

describe('release helpers', () => {
  it('compares stable and prerelease SemVer values', () => {
    expect(comparePluginVersions('0.3.3', '0.3.2')).toBe(1)
    expect(comparePluginVersions('0.4.0', '0.3.2')).toBe(1)
    expect(comparePluginVersions('0.4.0-alpha.2', '0.4.0-alpha.1')).toBe(1)
    expect(comparePluginVersions('0.4.0-alpha.1', '0.4.0')).toBe(-1)
    expect(comparePluginVersions('not-a-version', '0.4.0')).toBeUndefined()
  })

  it('recognises npm registry dependency specs and CLI profiles', () => {
    expect(isRegistryPluginSpec('0.4.0')).toBe(true)
    expect(isRegistryPluginSpec('^0.3.2')).toBe(true)
    expect(isRegistryPluginSpec('>=0.3.0 <0.5.0')).toBe(true)
    expect(isRegistryPluginSpec('0.3.x || >=1.0.0 <2.0.0')).toBe(true)
    expect(isRegistryPluginSpec('0.3.0 - 0.4.0')).toBe(true)
    expect(isRegistryPluginSpec('latest')).toBe(true)
    expect(isRegistryPluginSpec('link:C:/develop/dsh-mobile')).toBe(false)
    expect(isRegistryPluginSpec('file:../dsh-mobile')).toBe(false)
    expect(isRegistryPluginSpec('../dsh-mobile')).toBe(false)
    expect(isRegistryPluginSpec('C:\\develop\\dsh-mobile')).toBe(false)
    expect(isRegistryPluginSpec('github:saya-ch/dsh-mobile')).toBe(false)
    expect(isRegistryPluginSpec('git+ssh://git@github.com/saya-ch/dsh-mobile.git')).toBe(false)
    expect(isRegistryPluginSpec('https://example.com/dsh-mobile.tgz')).toBe(false)
    expect(isRegistryPluginSpec('dsh-mobile-0.4.0.tgz')).toBe(false)
    expect(launchedProfileName(['node', 'dsh', '--profile', 'work'])).toBe('work')
    expect(launchedProfileName(['node', 'dsh', '--profile=web'])).toBe('web')
    expect(launchedProfileName(['node', 'dsh'])).toBe('web')
  })
})

describe('profile resolution', () => {
  it('uses the launcher-selected Desktop directory instead of the CLI Web profile', async () => {
    const directory = await profileDirectory('^0.3.2')
    const ctx = new Context()
    ctx.provide('desktopRuntime', { platform: 'win32' })
    ctx.provide('desktopProfiles', { current: { name: 'desktop-test', dir: directory } })
    const selectedDirectory = releaseProfileDirectory(ctx, tmpdir(), ['--profile', 'web'])
    expect(selectedDirectory).toBe(directory)
  })

  it('resolves the Desktop profile from the module installation when the launcher omits it', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'quwork-mobile-home-'))
    temporaryDirectories.push(dshHome)
    const desktopProfile = join(dshHome, 'profiles', 'desktop')
    const moduleDirectory = join(desktopProfile, 'node_modules', 'quwork-mobile', 'lib')
    await mkdir(moduleDirectory, { recursive: true })
    await writeFile(join(desktopProfile, 'package.json'), JSON.stringify({
      dependencies: { 'quwork-mobile': '^0.8.5' },
      dsh: { profile: { bundles: ['quwork-mobile'] } },
    }))
    const ctx = new Context()
    ctx.provide('desktopRuntime', { platform: 'win32' })
    const moduleUrl = pathToFileURL(join(moduleDirectory, 'index.mjs')).href

    expect(releaseProfileDirectory(ctx, dshHome, ['--profile', 'web'], moduleUrl)).toBe(desktopProfile)
  })

  it('does not use a module installation outside the managed profile root as the Desktop fallback', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'quwork-mobile-home-'))
    const externalProfile = await mkdtemp(join(tmpdir(), 'quwork-mobile-external-'))
    temporaryDirectories.push(dshHome, externalProfile)
    const moduleDirectory = join(externalProfile, 'node_modules', 'quwork-mobile', 'lib')
    await mkdir(moduleDirectory, { recursive: true })
    await writeFile(join(externalProfile, 'package.json'), JSON.stringify({
      dependencies: { 'quwork-mobile': '^0.8.5' },
      dsh: { profile: { bundles: ['quwork-mobile'] } },
    }))
    const ctx = new Context()
    ctx.provide('desktopRuntime', { platform: 'win32' })

    expect(releaseProfileDirectory(ctx, dshHome, ['--profile', 'web'],
      pathToFileURL(join(moduleDirectory, 'index.mjs')).href)).toBeUndefined()
  })

  it.each([
    undefined,
    {},
    { current: {} },
    { current: { dir: '' } },
    { current: { dir: './profiles/desktop' } },
  ])('disables updating when Desktop has no usable current directory: %j', profiles => {
    const ctx = new Context()
    ctx.provide('desktopRuntime', { platform: 'win32' })
    if (profiles !== undefined) ctx.provide('desktopProfiles', profiles)
    expect(releaseProfileDirectory(ctx, tmpdir(), ['--profile', 'web'])).toBeUndefined()
  })

  it('does not fall back to Web when only the Desktop profile service is present', () => {
    const ctx = new Context()
    ctx.provide('desktopProfiles', { current: {} })
    expect(releaseProfileDirectory(ctx, tmpdir(), ['--profile', 'web'])).toBeUndefined()
  })

  it('retains default and explicit CLI profile resolution outside Desktop', () => {
    const ctx = new Context()
    expect(releaseProfileDirectory(ctx, tmpdir(), [])).toBe(join(tmpdir(), 'profiles', 'web'))
    expect(releaseProfileDirectory(ctx, tmpdir(), ['--profile', 'work'])).toBe(join(tmpdir(), 'profiles', 'work'))
    expect(releaseProfileDirectory(ctx, tmpdir(), ['--profile=work'])).toBe(join(tmpdir(), 'profiles', 'work'))
  })
})
