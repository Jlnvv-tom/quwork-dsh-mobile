import { readFileSync } from 'node:fs'

/**
 * Name of the installed package, which is also the Client module-loader id.
 *
 * DSH keys the boot graph, the `/plugins` row, the module loader and the
 * profile's patch row by this name, so the Host must read it from the manifest
 * it ships in instead of assuming one of the identities this bundle can be
 * installed under.
 */
export const MOBILE_PACKAGE_NAME: string = (() => {
  const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const name = typeof manifest === 'object' && manifest !== null && 'name' in manifest
    ? (manifest as { readonly name?: unknown }).name
    : undefined
  if (typeof name !== 'string' || name === '') throw new Error('package manifest has no name')
  return name
})()
