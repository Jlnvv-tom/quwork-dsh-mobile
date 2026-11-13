/**
 * QuWork-only sidebar entries that cannot act inside the mobile page.
 *
 * The desktop bridge renders two entries whose click ends in its Electron
 * renderer: 「插件 · 技能」 (`plugin-market/open`) and 「内容创作」 in DSH's
 * sidebar More menu (`content-creation/open`). A phone only receives the DSH
 * page, so both taps resolve to nothing while the entries keep occupying the
 * mobile drawer. The account entry is the exception — `mobile-qurwork-panel`
 * owns that tap and renders a mobile sheet, so it stays visible.
 *
 * DSH's own 「更多」 panel trigger (`PanelMoreMenu`) only opens the menu of
 * panels this page already hides, and it expands to a rail icon with no
 * reachable action on a phone, so it goes with them.
 *
 * The injected container carries a bridge marker and hides by stylesheet; the
 * More menu is DSH's own markup, so the matching row is tagged with an
 * attribute instead of guessed at by CSS. DSH hashes the CSS-module prefix of
 * its class names but keeps the `_panelList` / `_moreAnchor` suffixes, which is
 * the same contract the bridge itself relies on.
 */

/** Container the bridge appends to the DSH sidebar root. */
export const QUWORK_SIDEBAR_ACTIONS_SELECTOR = '[data-qurwork-sidebar-actions]'
/** DSH sidebar panel list that owns the rail's panel triggers. */
export const QUWORK_PANEL_LIST_SELECTOR = '[class*="_panelList"]'
/** DSH 「更多」 panel trigger wrapper (`PanelMoreMenu` anchors the menu here). */
export const QUWORK_PANEL_MORE_SELECTOR = `${QUWORK_PANEL_LIST_SELECTOR} [class*="_moreAnchor"]`
/** The trigger button itself, in case a DSH build drops the wrapper class. */
export const QUWORK_PANEL_MORE_BUTTON_SELECTOR = `${QUWORK_PANEL_LIST_SELECTOR} button[aria-haspopup="menu"]`
/** DSH sidebar More popup, which the bridge extends with its own entries. */
export const QUWORK_MORE_MENU_SELECTOR = '[class*="_moreMenu"]'
export const QUWORK_MORE_ITEM_LABEL_SELECTOR = '[class*="_itemLabel"]'
export const QUWORK_MORE_ITEM_ROW_SELECTOR = '[class*="_itemWrap"]'
/** Menu labels whose only action is a desktop endpoint. */
export const QUWORK_DESKTOP_ONLY_MENU_LABELS: readonly string[] = ['内容创作']
export const QUWORK_HIDDEN_ATTRIBUTE = 'data-dsh-mobile-quwork-hidden'

/**
 * Root class `native-mobile.ts` publishes on every non-desktop page. Rules stay
 * inside it so a wide desktop browser keeps the stock sidebar.
 */
const MOBILE_LAYOUT_CLASS = 'dsh-native-mobile-active'

/**
 * The bridge pins the injected container to `display:contents !important` on a
 * wider selector, so hiding the container alone leaves its buttons in the grid;
 * the children get their own rule for that reason.
 */
export const QUWORK_SIDEBAR_HIDE_STYLES = `
  html.${MOBILE_LAYOUT_CLASS} ${QUWORK_SIDEBAR_ACTIONS_SELECTOR},
  html.${MOBILE_LAYOUT_CLASS} ${QUWORK_SIDEBAR_ACTIONS_SELECTOR} > * { display:none !important; }
  html.${MOBILE_LAYOUT_CLASS} ${QUWORK_PANEL_MORE_SELECTOR},
  html.${MOBILE_LAYOUT_CLASS} ${QUWORK_PANEL_MORE_BUTTON_SELECTOR} { display:none !important; }
  [${QUWORK_HIDDEN_ATTRIBUTE}="true"] { display:none !important; }
`

export interface MobileQuworkSidebarOptions {
  readonly page: Document
}

function normalizedLabel(value: string | null | undefined): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/**
 * Tag the desktop-only rows inside one sidebar More menu.
 * @param menu - The More popup root (DSH markup grown by the bridge).
 * @returns How many rows this call tagged.
 */
export function hideQuworkSidebarMoreItems(menu: ParentNode): number {
  let hidden = 0
  for (const item of menu.querySelectorAll('button[role="menuitem"]')) {
    const label = normalizedLabel(item.querySelector(QUWORK_MORE_ITEM_LABEL_SELECTOR)?.textContent ?? item.textContent)
    if (!QUWORK_DESKTOP_ONLY_MENU_LABELS.includes(label)) continue
    const row = item.closest(QUWORK_MORE_ITEM_ROW_SELECTOR) ?? item
    if (row.getAttribute(QUWORK_HIDDEN_ATTRIBUTE) === 'true') continue
    row.setAttribute(QUWORK_HIDDEN_ATTRIBUTE, 'true')
    hidden += 1
  }
  return hidden
}

/**
 * Hide the desktop-only QuWork entries in the mobile sidebar.
 * @param options - Host document to scan and style.
 * @returns Teardown for the observer and the stylesheet.
 */
export function installMobileQuworkSidebarHiding(options: MobileQuworkSidebarOptions): () => void {
  const { page } = options
  const style = page.createElement('style')
  style.dataset.plugin = 'dsh-mobile-qurwork-sidebar'
  style.textContent = QUWORK_SIDEBAR_HIDE_STYLES
  page.head.append(style)

  let menu: Element | undefined
  const sync = (): void => {
    if (!page.documentElement.classList.contains(MOBILE_LAYOUT_CLASS)) return
    if (menu !== undefined && !menu.isConnected) menu = undefined
    menu ??= page.querySelector(QUWORK_MORE_MENU_SELECTOR) ?? undefined
    if (menu === undefined) return
    hideQuworkSidebarMoreItems(menu)
  }
  sync()

  const Observer = page.defaultView?.MutationObserver ?? globalThis.MutationObserver
  if (typeof Observer !== 'function') return () => { style.remove() }
  const observer = new Observer(sync)
  observer.observe(page.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    style.remove()
  }
}
