#!/usr/bin/env node
/**
 * Writes the public Android update descriptor that installed Apps poll.
 *
 * The descriptor is the only thing an App needs in order to notice a new build, so an owner can
 * publish it (and the APKs it points at) on any https host: a web site, OSS/COS/R2 bucket or CDN.
 * Nothing here talks to a repository service; URLs are derived from --base-url or from a GitHub
 * release tag.
 *
 * Usage:
 *   node scripts/write-android-update-descriptor.mjs dist/android/quwork-android-v0.7.2*.apk \
 *     --base-url=https://dl.example.com/android --out=dist/android/update.json
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GRADLE_FILE = join(ROOT, 'apps/mobile/android/app/build.gradle.kts')
// Same CDN layout the Qurvis desktop channel publishes to, so both products share one bucket:
// https://img1.rrzuji.cn/qurvis-package/latest/QuWork-1.6.5-win-x64.exe
const CDN_BASE_URL = 'https://img1.rrzuji.cn/qurvis-package/latest'

function fail(message) {
  console.error(`update descriptor: ${message}`)
  process.exit(1)
}

function parseArguments(argv) {
  const options = { apks: [], out: undefined, baseUrl: undefined, github: false, repo: undefined, releaseTag: undefined, version: undefined, versionCode: undefined, notesUrl: undefined }
  for (const argument of argv) {
    if (argument.startsWith('--out=')) options.out = argument.slice(6)
    else if (argument === '--github') options.github = true
    else if (argument.startsWith('--base-url=')) options.baseUrl = argument.slice(11)
    else if (argument.startsWith('--repo=')) options.repo = argument.slice(7)
    else if (argument.startsWith('--release-tag=')) options.releaseTag = argument.slice(14)
    else if (argument.startsWith('--version=')) options.version = argument.slice(10)
    else if (argument.startsWith('--version-code=')) options.versionCode = Number(argument.slice(15))
    else if (argument.startsWith('--notes-url=')) options.notesUrl = argument.slice(12)
    else if (argument === '--help' || argument === '-h') options.help = true
    else if (argument.startsWith('--')) fail(`unsupported option ${argument}`)
    else options.apks.push(argument)
  }
  return options
}

/** Version numbers still live in the Gradle build file, which release checks already validate. */
async function readVersion() {
  const gradle = await readFile(GRADLE_FILE, 'utf8')
  const versionName = gradle.match(/^\s*versionName\s*=\s*"([^"]+)"\s*$/m)?.[1]
  const versionCode = Number(gradle.match(/^\s*versionCode\s*=\s*(\d+)\s*$/m)?.[1])
  if (!versionName || !Number.isSafeInteger(versionCode) || versionCode <= 0) {
    fail(`cannot read versionName/versionCode from ${GRADLE_FILE}`)
  }
  return { version: versionName, versionCode }
}

function httpsUrl(value, label) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    fail(`${label} must be an absolute https URL, got ${JSON.stringify(value)}`)
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname) fail(`${label} must be an absolute https URL, got ${JSON.stringify(value)}`)
  return value.replace(/\/+$/u, '')
}

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

const options = parseArguments(process.argv.slice(2))
if (options.help) {
  console.log(`Usage: node scripts/write-android-update-descriptor.mjs <apk...> [options]

  --base-url=<url>       Prefix the APKs are uploaded to (default
                         https://img1.rrzuji.cn/qurvis-package/latest).
  --github               Derive the links from a GitHub release instead of the CDN.
  --repo=<owner/name>    GitHub repository used with --github.
  --release-tag=<tag>    Release tag for --github links (default android-v<version>).
  --version=<x.y.z>      Override the version read from build.gradle.kts.
  --version-code=<n>     Override the versionCode read from build.gradle.kts.
  --notes-url=<url>      Optional release notes page.
  --out=<file>           Write here instead of stdout.
`)
  process.exit(0)
}

if (options.apks.length === 0) fail('pass at least one APK path')
const build = options.version
  ? { version: options.version, versionCode: options.versionCode ?? fail('--version requires --version-code') }
  : await readVersion()
if (!Number.isSafeInteger(build.versionCode) || build.versionCode <= 0) fail('versionCode must be a positive safe integer')
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(build.version)) fail(`invalid version ${JSON.stringify(build.version)}`)

const releaseTag = options.releaseTag ?? `android-v${build.version}`
const repo = options.repo ?? 'Jlnvv-tom/quwork-dsh-mobile'
const baseUrl = httpsUrl(
  options.github
    ? `https://github.com/${repo}/releases/download/${releaseTag}`
    : options.baseUrl ?? CDN_BASE_URL,
  options.github ? 'release URL' : '--base-url',
)

const downloads = {}
const checksums = {}
for (const apk of options.apks) {
  const name = basename(apk)
  const variant = /-iroh\.apk$/u.test(name) ? 'iroh' : 'compatibility'
  if (downloads[variant]) fail(`duplicate ${variant} APK: ${apk}`)
  downloads[variant] = `${baseUrl}/${encodeURIComponent(name)}`
  checksums[variant] = await sha256(apk)
}

const descriptor = {
  version: build.version,
  versionCode: build.versionCode,
  releaseTag,
  downloads,
  sha256: checksums,
  ...(options.notesUrl ? { notesUrl: httpsUrl(options.notesUrl, '--notes-url') } : {}),
}
const json = `${JSON.stringify(descriptor, null, 2)}\n`
if (options.out) await writeFile(options.out, json)
else process.stdout.write(json)
