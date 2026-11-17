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
  // The published APK itself, so one click in the control panel installs the App; there is no
  // separate download landing page to keep in sync.
  downloadPageUrl: 'https://space-static.quwork.cn/file-center/files/2611/16/quwork-android-v0.7.7-d70d07cd.apk',
  releaseDescriptorUrl: 'https://space-static.quwork.cn/file-center/files/2611/16/quwork-android-release-84eaa7d5.json',
  releaseNotesUrl: 'https://quwork.example.com/mobile/releases',
} as const

export type Brand = typeof BRAND
