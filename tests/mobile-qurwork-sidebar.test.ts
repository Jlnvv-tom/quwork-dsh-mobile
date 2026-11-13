import { describe, expect, it, vi } from 'vitest'
import {
  QUWORK_HIDDEN_ATTRIBUTE,
  QUWORK_MORE_ITEM_LABEL_SELECTOR,
  QUWORK_MORE_ITEM_ROW_SELECTOR,
  QUWORK_MORE_MENU_SELECTOR,
  QUWORK_SIDEBAR_ACTIONS_SELECTOR,
  QUWORK_SIDEBAR_HIDE_STYLES,
  hideQuworkSidebarMoreItems,
  installMobileQuworkSidebarHiding,
} from '../src/mobile-qurwork-sidebar.js'

interface FakeRow {
  readonly attributes: Map<string, string>
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
}

function row(): FakeRow {
  const attributes = new Map<string, string>()
  return {
    attributes,
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => { attributes.set(name, value) },
  }
}

interface FakeItem extends FakeRow {
  readonly label: unknown
  readonly textContent: string
  readonly row: FakeRow | null
  querySelector(selector: string): { textContent: string } | null
  closest(selector: string): FakeRow | null
}

function item(label: string, wrapper: FakeRow | null = row()): FakeItem {
  const base = row()
  return {
    ...base,
    label,
    textContent: label,
    row: wrapper,
    querySelector: (selector: string) => selector === QUWORK_MORE_ITEM_LABEL_SELECTOR ? { textContent: label } : null,
    closest: (selector: string) => selector === QUWORK_MORE_ITEM_ROW_SELECTOR ? wrapper : null,
  }
}

function menu(items: FakeItem[]): { isConnected: boolean; querySelectorAll: (selector: string) => unknown } {
  return {
    isConnected: true,
    querySelectorAll: (selector: string) => selector === 'button[role="menuitem"]' ? items : [],
  }
}

function asParent(node: ReturnType<typeof menu>): ParentNode {
  return node as unknown as ParentNode
}

function fakePage(withMobileClass: boolean, moreMenu: unknown) {
  const head = { children: [] as unknown[], append: vi.fn((node: { removed?: boolean }) => { head.children.push(node) }) }
  const classes = new Set<string>(withMobileClass ? ['dsh-native-mobile-active'] : [])
  const documentElement = { classList: { contains: (name: string) => classes.has(name) } }
  const observers: Array<{ callback: () => void; disconnect: () => void; observed: boolean; options: MutationObserverInit | undefined }> = []
  class FakeObserver {
    private readonly entry: { callback: () => void; disconnect: () => void; observed: boolean; options: MutationObserverInit | undefined }
    constructor(callback: () => void) {
      this.entry = { callback, disconnect: () => { this.entry.observed = false }, observed: false, options: undefined }
      observers.push(this.entry)
    }
    observe(_target: unknown, options?: MutationObserverInit): void { this.entry.observed = true; this.entry.options = options }
    disconnect(): void { this.entry.disconnect() }
  }
  const page = {
    documentElement,
    head,
    body: {},
    defaultView: { MutationObserver: FakeObserver },
    createElement: () => ({ dataset: {} as Record<string, string>, textContent: '', remove: vi.fn() }),
    querySelector: (selector: string) => selector === QUWORK_MORE_MENU_SELECTOR ? moreMenu as Element | null : null,
  }
  return { page, observers }
}

describe('hideQuworkSidebarMoreItems', () => {
  it('tags only the desktop-only rows and stays idempotent', () => {
    const plugins = item('插件管理', row())
    const content = item('内容创作', row())
    const automation = item('自动化任务', row())
    const more = menu([plugins, content, automation])
    expect(hideQuworkSidebarMoreItems(asParent(more))).toBe(1)
    expect(content.row?.getAttribute(QUWORK_HIDDEN_ATTRIBUTE)).toBe('true')
    expect(plugins.row?.getAttribute(QUWORK_HIDDEN_ATTRIBUTE)).toBeNull()
    expect(automation.row?.getAttribute(QUWORK_HIDDEN_ATTRIBUTE)).toBeNull()
    expect(hideQuworkSidebarMoreItems(asParent(more))).toBe(0)
  })

  it('falls back to the button itself when DSH omits the row wrapper', () => {
    const content = item('内容创作', null)
    expect(hideQuworkSidebarMoreItems(asParent(menu([content])))).toBe(1)
    expect(content.getAttribute(QUWORK_HIDDEN_ATTRIBUTE)).toBe('true')
  })

  it('tolerates labels DSH pads with whitespace', () => {
    const content = item('  内容创作 ', row())
    expect(hideQuworkSidebarMoreItems(asParent(menu([content])))).toBe(1)
  })
})

describe('installMobileQuworkSidebarHiding', () => {
  it('hides the injected container and the More-menu entry on the mobile page', () => {
    const content = item('内容创作', row())
    const { page, observers } = fakePage(true, menu([content]))
    installMobileQuworkSidebarHiding({ page: page as unknown as Document })
    expect(page.head.append).toHaveBeenCalledTimes(1)
    expect(content.row?.getAttribute(QUWORK_HIDDEN_ATTRIBUTE)).toBe('true')
    expect(observers[0]?.observed).toBe(true)
    expect(QUWORK_SIDEBAR_HIDE_STYLES).toContain(QUWORK_SIDEBAR_ACTIONS_SELECTOR)
    expect(QUWORK_SIDEBAR_HIDE_STYLES).toContain(`html.dsh-native-mobile-active ${QUWORK_SIDEBAR_ACTIONS_SELECTOR}`)
  })

  it('keeps the desktop sidebar untouched when the mobile layout is not active', () => {
    const content = item('内容创作', row())
    const { page, observers } = fakePage(false, menu([content]))
    installMobileQuworkSidebarHiding({ page: page as unknown as Document })
    expect(content.row?.getAttribute(QUWORK_HIDDEN_ATTRIBUTE)).toBeNull()
    expect(observers[0]?.observed).toBe(true)
  })

  it('re-checks the More menu when DSH renders it later', () => {
    const content = item('内容创作', row())
    let moreMenu: unknown = null
    const { page, observers } = fakePage(true, moreMenu)
    page.querySelector = (selector: string) => selector === QUWORK_MORE_MENU_SELECTOR ? moreMenu as Element | null : null
    installMobileQuworkSidebarHiding({ page: page as unknown as Document })
    expect(content.row?.getAttribute(QUWORK_HIDDEN_ATTRIBUTE)).toBeNull()
    moreMenu = menu([content])
    observers[0]?.callback()
    expect(content.row?.getAttribute(QUWORK_HIDDEN_ATTRIBUTE)).toBe('true')
  })

  it('removes the stylesheet and disconnects on teardown', () => {
    const { page, observers } = fakePage(true, null)
    const remove = installMobileQuworkSidebarHiding({ page: page as unknown as Document })
    const style = page.head.children[0] as { remove: ReturnType<typeof vi.fn> }
    remove()
    expect(style.remove).toHaveBeenCalledTimes(1)
    expect(observers[0]?.observed).toBe(false)
  })
})
