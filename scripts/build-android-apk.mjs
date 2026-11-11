import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ANDROID_DIR = join(ROOT, 'apps/mobile/android')
const GRADLEW = join(ANDROID_DIR, 'gradlew')
const RELEASE_DIR = join(ANDROID_DIR, 'app/build/outputs/apk/release')
const SIGNED_APK = join(RELEASE_DIR, 'app-release.apk')
const UNSIGNED_APK = join(RELEASE_DIR, 'app-release-unsigned.apk')
const TRANSPORT_SCRIPT = join(ROOT, 'scripts/build-android-transport.mjs')
const UPDATE_DESCRIPTOR_SCRIPT = join(ROOT, 'scripts/write-android-update-descriptor.mjs')
// Mirrors the Qurvis desktop channel layout, so APKs and the desktop packages share one CDN:
// https://img1.rrzuji.cn/qurvis-package/latest/QuWork-1.6.5-win-x64.exe
const CDN_BASE_URL = 'https://img1.rrzuji.cn/qurvis-package/latest'
const DEFAULT_CREDENTIALS = join(homedir(), '.quwork-signing.txt')
const DEFAULT_NDK_VERSION = '25.2.9519653'
const DEFAULT_RUST_TOOLCHAIN = '1.99.1'
const RUSTLS_INIT_SCRIPT = join(homedir(), '.gradle/rustls-local-mirror.init.gradle.kts')
const RUST_TARGETS = ['aarch64-linux-android', 'x86_64-linux-android']
/** The two variables the app's build script reads to select the native transport. */
const SIGNING_VARIABLES = Object.freeze({
  KEYSTORE: 'DSH_ANDROID_KEYSTORE_FILE',
  STORE_PASSWORD: 'DSH_ANDROID_KEYSTORE_PASSWORD',
  KEY_ALIAS: 'DSH_ANDROID_KEY_ALIAS',
  KEY_PASSWORD: 'DSH_ANDROID_KEY_PASSWORD',
})
const VARIANTS = Object.freeze({ full: 'iroh', compat: 'compat' })

const USAGE = `Usage: node scripts/build-android-apk.mjs [options]

Builds signed release APKs for this repository, archives them outside the Gradle
build directory and verifies signature, ABI payload and ZIP alignment.

Options:
  --variant=both|full|compat   Which packages to build (default: both)
  --out=<directory>            Archive directory (default: <repo>/dist/android)
  --prefix=<name>              Artifact name prefix (default: quwork)
  --sdk=<directory>            Android SDK root (default: $ANDROID_HOME)
  --ndk=<directory>            NDK directory for the iroh package (default: $ANDROID_NDK_HOME)
  --build-tools=<directory>    Build-tools directory (default: newest installed)
  --credentials=<file>         KEY=VALUE signing file (default: ~/.quwork-signing.txt)
  --rust-toolchain=<name>      Rust toolchain for the iroh package (default: ${DEFAULT_RUST_TOOLCHAIN})
  --download-page=<url>        Page the App opens for a manual download (default: GitHub releases)
  --update-descriptor=<url>    Descriptor the App polls once per launch
                               (default: ${CDN_BASE_URL}/quwork-android-release.json; pass an
                               empty value to disable update checking)
  --base-url=<url>             Prefix the generated descriptor's APK links point at
                               (default: ${CDN_BASE_URL})
  --unsigned                   Build without signing (produces an uninstallable APK)
  --skip-verify                Skip apksigner and package payload checks
  --no-daemon                  Pass --no-daemon to Gradle
  --help                       Print this message

Signing is taken from the DSH_ANDROID_* environment variables when they are all
set, otherwise from the --credentials file. Without either, the build stops:
an unsigned release APK cannot be installed.

Update delivery is opt-in. Pass --download-page and --update-descriptor once your
release site or OSS bucket exists; --base-url only rewrites the APK links inside
the descriptor this script archives, and never changes the built App.`

function fail(message) {
  throw new Error(message)
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function parseArgs(argv) {
  const options = {
    variants: ['full', 'compat'],
    out: join(ROOT, 'dist/android'),
    prefix: 'quwork',
    // Upload target for the APKs, and the descriptor an installed App polls once per launch.
    baseUrl: CDN_BASE_URL,
    updateDescriptor: `${CDN_BASE_URL}/quwork-android-release.json`,
    rustToolchain: process.env.RUSTUP_TOOLCHAIN || DEFAULT_RUST_TOOLCHAIN,
    unsigned: false,
    skipVerify: false,
    noDaemon: false,
    help: false,
  }
  const valued = {
    '--variant': value => {
      if (value === 'both') options.variants = ['full', 'compat']
      else if (Object.hasOwn(VARIANTS, value)) options.variants = [value]
      else fail(`unsupported --variant: ${value}`)
    },
    '--out': value => { options.out = resolve(value) },
    '--prefix': value => { options.prefix = value },
    '--sdk': value => { options.sdk = resolve(value) },
    '--ndk': value => { options.ndk = resolve(value) },
    '--build-tools': value => { options.buildTools = resolve(value) },
    '--credentials': value => { options.credentials = resolve(value) },
    '--rust-toolchain': value => { options.rustToolchain = value },
    '--download-page': value => { options.downloadPage = value },
    '--update-descriptor': value => { options.updateDescriptor = value },
    '--base-url': value => { options.baseUrl = value },
  }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--help' || token === '-h') { options.help = true; continue }
    if (token === '--unsigned') { options.unsigned = true; continue }
    if (token === '--skip-verify') { options.skipVerify = true; continue }
    if (token === '--no-daemon') { options.noDaemon = true; continue }
    const flag = token.includes('=') ? token.slice(0, token.indexOf('=')) : token
    const handler = valued[flag]
    if (!handler) fail(`unknown argument: ${token}`)
    let value = token.includes('=') ? token.slice(token.indexOf('=') + 1) : undefined
    if (value === undefined) {
      value = argv[index + 1]
      if (!value || value.startsWith('--')) fail(`${flag} requires a value`)
      index += 1
    }
    handler(value)
  }
  return options
}

async function readKeyValueFile(path) {
  const content = await readFile(path, 'utf8')
  const values = {}
  for (const raw of content.split(/\r?\n/u)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/u, '$2')
  }
  return values
}

/** Signing lives in the environment on CI and in a KEY=VALUE file locally. */
async function resolveSigning(options) {
  if (options.unsigned) return { env: {}, source: 'none (--unsigned)' }
  const fromEnvironment = Object.values(SIGNING_VARIABLES).every(name => process.env[name])
  if (fromEnvironment) {
    return { env: Object.fromEntries(Object.values(SIGNING_VARIABLES).map(name => [name, process.env[name]])), source: 'environment' }
  }
  const file = options.credentials ?? DEFAULT_CREDENTIALS
  if (!(await exists(file))) {
    fail(`no signing credentials: set all of ${Object.values(SIGNING_VARIABLES).join(', ')} or provide ${file}`)
  }
  const values = await readKeyValueFile(file)
  const env = {}
  for (const [alias, name] of Object.entries(SIGNING_VARIABLES)) {
    const value = values[alias] ?? values[name]
    if (!value) fail(`${file} is missing ${alias}`)
    env[name] = value
  }
  if (!(await exists(env[SIGNING_VARIABLES.KEYSTORE]))) fail(`keystore not found: ${env[SIGNING_VARIABLES.KEYSTORE]}`)
  return { env, source: file }
}

async function resolveSdk(options) {
  const candidates = [options.sdk, process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]
  const localProperties = join(ANDROID_DIR, 'local.properties')
  if (await exists(localProperties)) {
    candidates.push(/^sdk\.dir=(.+)$/mu.exec(await readFile(localProperties, 'utf8'))?.[1]?.trim())
  }
  candidates.push(join(homedir(), 'Library/Android/sdk'), join(homedir(), 'Android/Sdk'))
  for (const candidate of candidates) {
    if (candidate && (await exists(candidate))) return resolve(candidate)
  }
  return fail('Android SDK not found: export ANDROID_HOME or pass --sdk')
}

async function listDirectories(path) {
  const { readdir } = await import('node:fs/promises')
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
  } catch {
    return []
  }
}

function compareVersions(left, right) {
  const parts = value => value.split(/[.\-]/u).map(part => (/^\d+$/u.test(part) ? Number(part) : part))
  const a = parts(left)
  const b = parts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = a[index] ?? 0
    const y = b[index] ?? 0
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return String(x).localeCompare(String(y))
  }
  return 0
}

async function resolveBuildTools(sdk, options) {
  if (options.buildTools) return options.buildTools
  const names = await listDirectories(join(sdk, 'build-tools'))
  const usable = []
  for (const name of names) {
    if (await exists(join(sdk, 'build-tools', name, 'apksigner'))) usable.push(name)
  }
  if (usable.length === 0) fail(`no build-tools with apksigner under ${join(sdk, 'build-tools')}`)
  return join(sdk, 'build-tools', usable.sort(compareVersions).at(-1))
}

async function resolveNdk(sdk, options) {
  if (options.ndk) return options.ndk
  const configured = process.env.ANDROID_NDK_HOME || process.env.ANDROID_NDK_ROOT
  if (configured) return resolve(configured)
  const explicit = join(sdk, 'ndk', DEFAULT_NDK_VERSION)
  if (await exists(join(explicit, 'source.properties'))) return explicit
  const names = await listDirectories(join(sdk, 'ndk'))
  if (names.length === 0) fail('no NDK installed: the iroh package needs NDK 25.2.9519653 (--ndk)')
  return join(sdk, 'ndk', names.sort(compareVersions).at(-1))
}

/** release.json is the release source of truth; Gradle must agree or the tag lies. */
async function readVersion() {
  const release = JSON.parse(await readFile(join(ROOT, 'apps/mobile/release.json'), 'utf8'))
  const gradle = await readFile(join(ANDROID_DIR, 'app/build.gradle.kts'), 'utf8')
  const versionName = /versionName = "([^"]+)"/u.exec(gradle)?.[1]
  const versionCode = Number(/versionCode = (\d+)/u.exec(gradle)?.[1])
  if (versionName !== release.version || versionCode !== release.versionCode) {
    console.warn(`warning: apps/mobile/release.json (${release.version}/${release.versionCode}) differs from app/build.gradle.kts (${versionName}/${versionCode})`)
  }
  if (!release.version) fail('apps/mobile/release.json has no version')
  return release.version
}

async function checkRustTargets(toolchain) {
  const result = spawnSync('rustup', ['target', 'list', '--toolchain', toolchain, '--installed'], { encoding: 'utf8', windowsHide: true })
  if (result.error) {
    console.warn(`warning: rustup is not available; cannot confirm ${toolchain} targets`)
    return
  }
  const installed = new Set((result.stdout ?? '').split(/\r?\n/u).map(line => line.trim()))
  const missing = RUST_TARGETS.filter(target => !installed.has(target))
  if (missing.length) {
    fail(`Rust toolchain ${toolchain} lacks ${missing.join(', ')}: rustup target add ${missing.join(' ')} --toolchain ${toolchain}`)
  }
}

async function preflight(options, sdk, ndk) {
  if (!(await exists(GRADLEW))) fail(`${GRADLEW} is missing`)
  for (const variant of options.variants) {
    if (variant !== 'full') continue
    if (!(await exists(join(ndk, 'source.properties')))) fail(`${ndk} is not an NDK directory (no source.properties)`)
    await checkRustTargets(options.rustToolchain)
    if (!(await exists(RUSTLS_INIT_SCRIPT))) {
      console.warn(`warning: ${RUSTLS_INIT_SCRIPT} is absent; org.rustls will be fetched from GitHub and may fail behind this network`)
    }
  }
}

function gradleArguments(variant, context) {
  const args = []
  if (context.options.noDaemon) args.push('--no-daemon')
  args.push('--console=plain')
  if (variant === 'full') {
    if (context.rustlsInit) args.push('-I', RUSTLS_INIT_SCRIPT)
    args.push('-PirohNative=true', `-PirohNdk=${context.ndk}`)
  } else {
    args.push('-PirohNative=false')
  }
  // An explicit empty value reaches Gradle as -Pname=, which disables that URL.
  if (context.options.downloadPage !== undefined) args.push(`-PmobileDownloadPageUrl=${context.options.downloadPage}`)
  if (context.options.updateDescriptor !== undefined) args.push(`-PmobileUpdateDescriptorUrl=${context.options.updateDescriptor}`)
  args.push('assembleRelease')
  return args
}

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, ...options })
  if (result.error) fail(`${command} failed to start: ${result.error.message}`)
  if (result.status !== 0) fail(`${command} exited with code ${result.status}`)
  return result
}

async function sha256(path) {
  const bytes = await readFile(path)
  return createHash('sha256').update(bytes).digest('hex')
}

function artifactName(options, version, variant) {
  const suffix = variant === 'full' ? `-${VARIANTS.full}` : ''
  return `${options.prefix}-android-v${version}${suffix}.apk`
}

async function verifyApk(apk, buildTools, variant) {
  const apksigner = join(buildTools, 'apksigner')
  const result = spawnSync(apksigner, ['verify', '--verbose', '--print-certs', apk], { encoding: 'utf8', windowsHide: true })
  if (result.error) fail(`cannot run ${apksigner}: ${result.error.message}`)
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const lines = output.split(/\r?\n/u)
  if (result.status !== 0 || !lines.includes('Verifies')) fail(`APK signature check failed:\n${output}`)
  // A single stale scheme (v1 only) still installs on old targets but not on modern ones.
  if (!lines.some(line => /^Verified using v[23](?:\.1)? scheme .*: true$/u.test(line))) {
    fail(`APK is not signed with a modern signature scheme:\n${output}`)
  }
  const digest = /Signer #1 certificate SHA-256 digest: ([a-f\d]{64})/u.exec(output)?.[1]
  run(process.execPath, [TRANSPORT_SCRIPT, '--verify-apk', apk, '--build-tools', buildTools,
    ...(variant === 'full' ? [] : ['--variant', 'compatibility'])], { cwd: ROOT })
  return digest
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }
  const started = Date.now()
  const sdk = await resolveSdk(options)
  const buildTools = await resolveBuildTools(sdk, options)
  const ndk = options.variants.includes('full') ? await resolveNdk(sdk, options) : undefined
  const signing = await resolveSigning(options)
  const version = await readVersion()
  await preflight(options, sdk, ndk)
  await mkdir(options.out, { recursive: true })

  console.log(`SDK:         ${sdk}`)
  console.log(`Build tools: ${buildTools}`)
  if (ndk) console.log(`NDK:         ${ndk}`)
  console.log(`Signing:     ${signing.source}`)
  console.log(`Output:      ${options.out}`)

  const sourceApk = options.unsigned ? UNSIGNED_APK : SIGNED_APK
  const artifacts = []
  for (const variant of options.variants) {
    console.log(`\n=== building ${variant} package ===`)
    const env = {
      ...process.env,
      ...signing.env,
      ANDROID_HOME: sdk,
      ANDROID_SDK_ROOT: sdk,
    }
    if (variant === 'full') env.RUSTUP_TOOLCHAIN = options.rustToolchain
    run('bash', [GRADLEW, ...gradleArguments(variant, { options, ndk, rustlsInit: variant === 'full' })], {
      cwd: ANDROID_DIR,
      env,
    })
    if (!(await exists(sourceApk))) {
      fail(options.unsigned
        ? `build produced no APK at ${sourceApk}`
        : `build produced no signed APK at ${sourceApk}; the app-release-unsigned.apk fallback means signing was not configured`)
    }
    const archive = join(options.out, artifactName(options, version, variant))
    await copyFile(sourceApk, archive)
    artifacts.push({ variant, path: archive, sha256: await sha256(archive) })
  }

  if (!options.skipVerify && !options.unsigned) {
    console.log('\n=== verifying packages ===')
    for (const artifact of artifacts) {
      artifact.certificate = await verifyApk(artifact.path, buildTools, artifact.variant)
      if (artifact.certificate) console.log(`certificate SHA-256 ${artifact.certificate}`)
    }
  }

  const lines = artifacts.map(artifact => `${artifact.sha256}  ${artifact.path.split('/').at(-1)}`)
  await writeFile(join(options.out, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`)

  // The descriptor is what an installed App polls; upload it beside the APKs it points at.
  const descriptorPath = join(options.out, 'quwork-android-release.json')
  const descriptorArgs = [
    UPDATE_DESCRIPTOR_SCRIPT,
    ...artifacts.map(artifact => artifact.path),
    `--base-url=${options.baseUrl}`,
    `--out=${descriptorPath}`,
  ]
  run(process.execPath, descriptorArgs, { cwd: ROOT })

  console.log('\n=== release artifacts ===')
  for (const artifact of artifacts) {
    console.log(`${artifact.path}`)
    console.log(`  variant ${artifact.variant}  sha256 ${artifact.sha256}`)
  }
  console.log(`\nChecksums:  ${join(options.out, 'SHA256SUMS.txt')}`)
  console.log(`Descriptor: ${descriptorPath}`)
  console.log(`Upload to:  ${options.baseUrl}/`)
  console.log(`Update URL: ${options.updateDescriptor}`)
  console.log(`Elapsed:   ${((Date.now() - started) / 1000).toFixed(1)}s`)
  console.log(`Install:   adb install -r "${artifacts[0].path}"`)
}

main().catch(error => {
  console.error(`\nrelease build failed: ${error.message}`)
  process.exitCode = 1
})
