/**
 * Single source of truth for every externally visible QuWork brand string and
 * product URL. User-facing copy must reference this module instead of inlining
 * brand words, so upstream merges stay conflict-free and the brand stays
 * consistent across the plugin, the mobile Web client and the Android App.
 */
export const BRAND = {
  productName: 'QuWork',
  shortName: 'QuWork',
  fullName: 'QuWork 移动端',
  androidAppName: 'QuWork',
  brandColor: '#1F6FEB',
  helpUrl: 'https://quwork.example.com/help/mobile',
  downloadPageUrl: 'https://quwork.cn/',
  releaseDescriptorUrl: 'https://quwork.example.com/api/mobile/release.json',
  releaseNotesUrl: 'https://quwork.example.com/mobile/releases',
} as const

export type Brand = typeof BRAND
