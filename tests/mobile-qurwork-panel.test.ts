import { describe, expect, it, vi } from 'vitest'
import {
  QUWORK_ACCOUNT_METHOD,
  QUWORK_APP_SETTINGS_EVENT,
  QUWORK_PROFILE_TRIGGER_SELECTOR,
  QUWORK_RPC_BASE,
  installMobileQuworkPanel,
  quworkAccountFromResponse,
  quworkAccountRows,
  quworkAccountSummary,
  quworkPanelCopy,
} from '../src/mobile-qurwork-panel.js'

class FakeElement {
  readonly tag: string
  className = ''
  readonly dataset: Record<string, string> = {}
  readonly attributes: Record<string, string> = {}
  readonly children: FakeElement[] = []
  parent: FakeElement | undefined
  textContent = ''
  hidden = false
  type = ''
  src = ''
  alt = ''
  focused = false
  readonly listeners: Array<{ type: string; handler: (event: unknown) => void; capture: boolean }> = []

  constructor(tag: string) { this.tag = tag }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parent = this
      this.children.push(node)
    }
  }

  remove(): void {
    if (this.parent === undefined) return
    const index = this.parent.children.indexOf(this)
    if (index >= 0) this.parent.children.splice(index, 1)
    this.parent = undefined
  }

  setAttribute(name: string, value: string): void { this.attributes[name] = value }

  focus(): void { this.focused = true }

  addEventListener(type: string, handler: (event: unknown) => void, capture = false): void {
    this.listeners.push({ type, handler, capture })
  }

  removeEventListener(type: string, handler: (event: unknown) => void, capture = false): void {
    const index = this.listeners.findIndex(listener => listener.type === type && listener.handler === handler && listener.capture === capture)
    if (index >= 0) this.listeners.splice(index, 1)
  }
}

class FakeDocument extends FakeElement {
  readonly head = new FakeElement('head')
  readonly body = new FakeElement('body')
  constructor() { super('document') }
  createElement(tag: string): FakeElement { return new FakeElement(tag) }
}

function flatten(node: FakeElement): string {
  return [node.textContent, ...node.children.map(flatten)].join(' ')
}

function find(root: FakeElement, predicate: (node: FakeElement) => boolean): FakeElement | undefined {
  if (predicate(root)) return root
  for (const child of root.children) {
    const hit = find(child, predicate)
    if (hit !== undefined) return hit
  }
  return undefined
}

function press(root: FakeElement): void {
  for (const listener of [...root.listeners]) listener.handler({ type: 'click', preventDefault: () => undefined, stopPropagation: () => undefined })
}

function mount(rpcCall?: (base: string, method: string, payload: unknown) => Promise<unknown>) {
  const page = new FakeDocument()
  const view = new FakeElement('window') as FakeElement & { navigator: { clipboard: { writeText: (value: string) => Promise<void> } } }
  view.navigator = { clipboard: { writeText: () => Promise.resolve() } }
  const call = vi.fn(rpcCall ?? (() => Promise.resolve({ ok: true, value: { accepted: true, profile: { displayName: '张三' }, account: { id: 'u1', username: 'zhangsan' } } })))
  const context = {
    get: (name: string) => name === 'connection' && rpcCall !== null ? { rpc: { call } } : undefined,
  }
  const remove = installMobileQuworkPanel(context, {
    view: view as unknown as Window,
    page: page as unknown as Document,
    locale: () => 'zh',
  })
  return { page, view, call, remove }
}

describe('quworkAccountFromResponse', () => {
  it('keeps displayable fields from the account projection', () => {
    const account = quworkAccountFromResponse({
      ok: true,
      value: { accepted: true, profile: { displayName: '张三', avatarUrl: 'https://x/a.png' }, account: { id: 'u1', username: 'zhangsan', isStaff: true, affCode: 'A1' } },
    })
    expect(account).toEqual({
      signedIn: true,
      staff: true,
      displayName: '张三',
      avatarUrl: 'https://x/a.png',
      username: 'zhangsan',
      accountId: 'u1',
      affCode: 'A1',
    })
  })

  it('degrades unknown payloads to signed out', () => {
    expect(quworkAccountFromResponse(undefined)).toEqual({ signedIn: false, staff: false })
    expect(quworkAccountFromResponse({ ok: false })).toEqual({ signedIn: false, staff: false })
    expect(quworkAccountFromResponse({ accepted: false })).toEqual({ signedIn: false, staff: false })
  })
})

describe('account presentation helpers', () => {
  it('lists only known rows and a stable summary', () => {
    const copy = quworkPanelCopy('zh')
    const rows = quworkAccountRows({ signedIn: true, staff: false, username: 'zhangsan' }, copy)
    expect(rows).toEqual([
      { label: copy.labelUsername, value: 'zhangsan' },
      { label: copy.labelRole, value: copy.roleMember },
    ])
    expect(quworkAccountSummary({ signedIn: true, staff: false, displayName: '张三', username: 'zhangsan' })).toBe('张三 / zhangsan')
  })

  it('falls back to English copy for unexpected locales', () => {
    expect(quworkPanelCopy('fr' as never)).toBe(quworkPanelCopy('en'))
  })
})

describe('installMobileQuworkPanel', () => {
  it('opens the account sheet from the QuWork trigger and reads the projection', async () => {
    const { page, call } = mount()
    const trigger: FakeElement & { closest: (selector: string) => FakeElement | null } = Object.assign(new FakeElement('button'), {
      closest: (selector: string) => selector === QUWORK_PROFILE_TRIGGER_SELECTOR ? trigger : null,
    })
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    const handler = page.listeners.find(listener => listener.type === 'click' && listener.capture)?.handler
    expect(handler).toBeDefined()
    handler?.({ target: trigger, preventDefault, stopPropagation })
    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
    expect(call).toHaveBeenCalledWith(QUWORK_RPC_BASE, QUWORK_ACCOUNT_METHOD, {})
    await Promise.resolve()
    await Promise.resolve()
    const root = find(page.body, node => node.attributes['data-dsh-mobile-qurwork'] !== undefined)
    expect(root).toBeDefined()
    expect(root?.hidden).toBe(false)
    expect(flatten(root as FakeElement)).toContain('张三')
    expect(flatten(root as FakeElement)).toContain('zhangsan')
  })

  it('routes the app settings event to the settings sheet', () => {
    const { view, page } = mount()
    const handler = view.listeners.find(listener => listener.type === QUWORK_APP_SETTINGS_EVENT)?.handler
    expect(handler).toBeDefined()
    handler?.({})
    const root = find(page.body, node => node.attributes['data-dsh-mobile-qurwork'] !== undefined)
    expect(root?.attributes['data-mode']).toBe('settings')
    expect(flatten(root as FakeElement)).toContain(quworkPanelCopy('zh').settingsHint)
  })

  it('reports an unavailable account when no connection service exists', () => {
    const page = new FakeDocument()
    const view = new FakeElement('window')
    installMobileQuworkPanel({ get: () => undefined }, {
      view: view as unknown as Window,
      page: page as unknown as Document,
      locale: () => 'zh',
    })
    const handler = page.listeners.find(listener => listener.type === 'click' && listener.capture)?.handler
    const trigger = Object.assign(new FakeElement('button'), { closest: () => ({}) as FakeElement })
    handler?.({ target: trigger, preventDefault: () => undefined, stopPropagation: () => undefined })
    const root = find(page.body, node => node.attributes['data-dsh-mobile-qurwork'] !== undefined)
    expect(flatten(root as FakeElement)).toContain(quworkPanelCopy('zh').unavailable)
  })

  it('closes on backdrop press and removes everything on teardown', () => {
    const { page, view, remove } = mount()
    const handler = page.listeners.find(listener => listener.type === 'click' && listener.capture)?.handler
    const trigger = Object.assign(new FakeElement('button'), { closest: () => ({}) as FakeElement })
    handler?.({ target: trigger, preventDefault: () => undefined, stopPropagation: () => undefined })
    const root = find(page.body, node => node.attributes['data-dsh-mobile-qurwork'] !== undefined) as FakeElement
    const backdrop = find(root, node => node.className === 'dsh-mobile-qurwork-backdrop') as FakeElement
    press(backdrop)
    expect(root.hidden).toBe(true)
    remove()
    expect(page.body.children).toHaveLength(0)
    expect(page.head.children).toHaveLength(0)
    expect(page.listeners).toHaveLength(0)
    expect(view.listeners).toHaveLength(0)
  })
})
