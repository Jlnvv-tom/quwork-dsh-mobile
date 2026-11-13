import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../scripts/write-android-update-descriptor.mjs', import.meta.url))
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

/** The release workflow quotes option values; the parser must accept that form as well as `--x=y`. */
async function fixture(): Promise<{ root: string; apks: string[] }> {
  const root = await mkdtemp(join(tmpdir(), 'quwork-descriptor-test-'))
  roots.push(root)
  const apks = [join(root, 'quwork-android-v0.9.0.apk'), join(root, 'quwork-android-v0.9.0-iroh.apk')]
  await writeFile(apks[0]!, 'compatibility')
  await writeFile(apks[1]!, 'iroh')
  return { root, apks }
}

function run(arguments_: string[], cwd: string) {
  return spawnSync(process.execPath, [script, ...arguments_], { cwd, encoding: 'utf8' })
}

async function descriptor(root: string, arguments_: string[]): Promise<Record<string, unknown>> {
  const result = run(arguments_, root)
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
  return JSON.parse(await readFile(join(root, 'quwork-android-release.json'), 'utf8')) as Record<string, unknown>
}

describe('Android update descriptor', () => {
  it('accepts separately quoted option values', async () => {
    const { root, apks } = await fixture()
    const written = await descriptor(root, [
      ...apks,
      '--version', '0.9.0',
      '--version-code', '91',
      '--repo', 'owner/repo',
      '--release-tag', 'android-v0.9.0',
      '--base-url', 'https://dl.example.com/android',
      '--out', join(root, 'quwork-android-release.json'),
    ])
    expect(written).toMatchObject({
      version: '0.9.0',
      versionCode: 91,
      releaseTag: 'android-v0.9.0',
      downloads: {
        compatibility: 'https://dl.example.com/android/quwork-android-v0.9.0.apk',
        iroh: 'https://dl.example.com/android/quwork-android-v0.9.0-iroh.apk',
      },
    })
  })

  it('produces the same descriptor for the joined form', async () => {
    const { root, apks } = await fixture()
    const written = await descriptor(root, [
      ...apks,
      '--version=0.9.0',
      '--version-code=91',
      '--repo=owner/repo',
      '--release-tag=android-v0.9.0',
      '--base-url=https://dl.example.com/android',
      `--out=${join(root, 'quwork-android-release.json')}`,
    ])
    expect(written.downloads).toEqual({
      compatibility: 'https://dl.example.com/android/quwork-android-v0.9.0.apk',
      iroh: 'https://dl.example.com/android/quwork-android-v0.9.0-iroh.apk',
    })
  })

  it('rejects an unknown option and a value-less option', async () => {
    const { root, apks } = await fixture()
    const unknown = run([...apks, '--unknown=1'], root)
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toContain('unsupported option --unknown=1')

    const missing = run([...apks, '--repo'], root)
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('--repo requires a value')
  })
})
