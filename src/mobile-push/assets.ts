import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface MobilePushAssetResponse {
  readonly contentType: 'application/manifest+json; charset=utf-8' | 'image/png'
  readonly body: string | Uint8Array
}

const ICON_FILES: Readonly<Record<string, string>> = Object.freeze({
  '/mobile-access/push/icon-180.png': 'icon-180.png',
  '/mobile-access/push/icon-192.png': 'icon-192.png',
  '/mobile-access/push/icon-512.png': 'icon-512.png',
})
const MANIFEST_PATH = '/mobile-access/push/manifest.webmanifest'
/**
 * Home-screen identity shared with the head metadata injected into the dedicated
 * mobile document. iOS reads `apple-mobile-web-app-title`, every other browser
 * reads the manifest, so both names come from one constant.
 */
export const MOBILE_APP_NAME = 'QuWork'
/** Dark canvas from the design system; iOS ignores this and uses the head meta. */
export const MOBILE_APP_THEME_COLOR = '#0F172A'
const MANIFEST = JSON.stringify({
  id: '/',
  name: MOBILE_APP_NAME,
  short_name: MOBILE_APP_NAME,
  start_url: '/',
  scope: '/',
  display: 'standalone',
  theme_color: MOBILE_APP_THEME_COLOR,
  background_color: MOBILE_APP_THEME_COLOR,
  icons: [
    { src: '/mobile-access/push/icon-180.png', sizes: '180x180', type: 'image/png' },
    { src: '/mobile-access/push/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/mobile-access/push/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
})

/** Create a fixed-allowlist loader rooted at a package root containing assets/mobile-push. */
export function createMobilePushAssetLoader(packageRoot: string): (path: string) => Promise<MobilePushAssetResponse | undefined> {
  const root = resolve(packageRoot)
  return async path => {
    if (path === MANIFEST_PATH) return { contentType: 'application/manifest+json; charset=utf-8', body: MANIFEST }
    const filename = ICON_FILES[path]
    if (!filename) return undefined
    const body = await readFile(join(root, 'assets', 'mobile-push', filename))
    return { contentType: 'image/png', body }
  }
}

// Anchor at the package root without naming the package. This build ships under
// several installed identities (the upstream name, this fork's name, and the
// profile-facing `quwork-mobile-plugin`), so resolving one hard-coded specifier
// throws MODULE_NOT_FOUND at import time and takes the whole plugin down.
// Walk up to the nearest package.json instead: `lib/index.mjs` finds the package
// root on its first step, and the source layout resolves the same way.
function resolvePackageRoot(moduleUrl: string): string {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl))
  let directory = moduleDirectory
  for (;;) {
    if (existsSync(join(directory, 'package.json'))) return directory
    const parent = dirname(directory)
    if (parent === directory) return dirname(moduleDirectory)
    directory = parent
  }
}

const packageRoot = resolvePackageRoot(import.meta.url)
const loadFromPackage = createMobilePushAssetLoader(packageRoot)

/** Return only a known push manifest/icon; optional packageRoot enables explicit host injection. */
export function mobilePushAsset(path: string, root = packageRoot): Promise<MobilePushAssetResponse | undefined> {
  return root === packageRoot ? loadFromPackage(path) : createMobilePushAssetLoader(root)(path)
}
