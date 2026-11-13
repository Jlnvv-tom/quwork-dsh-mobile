/**
 * QuWork-only entries rendered into the DSH page by the desktop bridge plugin.
 *
 * The desktop client renders its account popover and app settings in its own
 * Electron renderer. A phone only receives the DSH page, so tapping the
 * injected profile button used to open a window on the computer and nothing
 * at all on the phone. This module keeps the tap local: it intercepts the
 * QuWork triggers in the mobile page, renders a mobile sheet and reads the
 * read-only account projection over the same DSH `/qurwork` RPC used by the
 * bridge client. Computer-only actions stay stated as such.
 */
import type { MobileControlLocale } from './client-messages.js'

/** Profile trigger the QuWork bridge client renders into the sidebar footer. */
export const QUWORK_PROFILE_TRIGGER_SELECTOR = '[data-qurwork-profile]'
/** Fixed event the QuWork runtime patch dispatches from the DSH account menu. */
export const QUWORK_APP_SETTINGS_EVENT = 'qurwork:open-app-settings'
export const QUWORK_RPC_BASE = '/qurwork'
export const QUWORK_ACCOUNT_METHOD = 'profile/get'
/** Short ceiling so a missing bridge cannot keep the sheet spinning. */
export const QUWORK_ACCOUNT_TIMEOUT_MS = 8_000

export type QuworkPanelMode = 'profile' | 'settings'

/** Account fields the mobile sheet may show. */
export interface QuworkAccountView {
  readonly signedIn: boolean
  readonly staff: boolean
  readonly displayName?: string
  readonly username?: string
  readonly accountId?: string
  readonly affCode?: string
  readonly avatarUrl?: string
}

export interface QuworkRpcClient {
  call(base: string, method: string, payload: unknown): Promise<unknown>
}

export interface QuworkPanelContext {
  get(name: string): unknown
}

export interface QuworkPanelCopy {
  readonly profileTitle: string
  readonly settingsTitle: string
  readonly close: string
  readonly loading: string
  readonly failed: string
  readonly unavailable: string
  readonly retry: string
  readonly copyAccount: string
  readonly copied: string
  readonly signedOut: string
  readonly signedOutHint: string
  readonly desktopOnly: string
  readonly labelUsername: string
  readonly labelAccountId: string
  readonly labelRole: string
  readonly labelAffCode: string
  readonly roleStaff: string
  readonly roleMember: string
  readonly settingsHint: string
}

const COPY: Record<MobileControlLocale, QuworkPanelCopy> = {
  zh: {
    profileTitle: '个人中心',
    settingsTitle: '应用设置',
    close: '关闭',
    loading: '正在读取账号…',
    failed: '读取账号信息失败，请稍后重试。',
    unavailable: '手机端暂时无法读取账号信息，请确认电脑端 QuWork 已登录并在运行。',
    retry: '重新读取',
    copyAccount: '复制账号信息',
    copied: '已复制',
    signedOut: '电脑端未登录 QuWork 账号',
    signedOutHint: '先在电脑端登录 QuWork，回到这里点“重新读取”。',
    desktopOnly: '充值、订阅、邀请、客服与应用设置仍需在电脑端 QuWork 操作。',
    labelUsername: '用户名',
    labelAccountId: '账号 ID',
    labelRole: '身份',
    labelAffCode: '邀请码',
    roleStaff: '员工',
    roleMember: '普通用户',
    settingsHint: '应用设置只在电脑端 QuWork 提供。手机端的移动页面选项在 DSH 设置里。',
  },
  en: {
    profileTitle: 'Account',
    settingsTitle: 'App settings',
    close: 'Close',
    loading: 'Reading the account…',
    failed: 'Could not read the account. Try again later.',
    unavailable: 'The account is unavailable here. Make sure QuWork is signed in and running on the computer.',
    retry: 'Read again',
    copyAccount: 'Copy account',
    copied: 'Copied',
    signedOut: 'QuWork is not signed in on the computer',
    signedOutHint: 'Sign in on the computer, then tap “Read again”.',
    desktopOnly: 'Recharge, subscription, invites, support and app settings still run in QuWork on the computer.',
    labelUsername: 'Username',
    labelAccountId: 'Account ID',
    labelRole: 'Role',
    labelAffCode: 'Invite code',
    roleStaff: 'Staff',
    roleMember: 'Member',
    settingsHint: 'App settings exist only in QuWork on the computer. Mobile page options live in DSH settings.',
  },
  it: {
    profileTitle: 'Account',
    settingsTitle: 'Impostazioni app',
    close: 'Chiudi',
    loading: 'Lettura account…',
    failed: 'Impossibile leggere l’account. Riprova più tardi.',
    unavailable: 'Account non disponibile qui. Verifica che QuWork sia connesso e in esecuzione sul computer.',
    retry: 'Rileggi',
    copyAccount: 'Copia account',
    copied: 'Copiato',
    signedOut: 'QuWork non ha effettuato l’accesso sul computer',
    signedOutHint: 'Accedi sul computer, poi tocca “Rileggi”.',
    desktopOnly: 'Ricarica, abbonamento, inviti, assistenza e impostazioni app restano su QuWork per computer.',
    labelUsername: 'Nome utente',
    labelAccountId: 'ID account',
    labelRole: 'Ruolo',
    labelAffCode: 'Codice invito',
    roleStaff: 'Staff',
    roleMember: 'Utente',
    settingsHint: 'Le impostazioni app esistono solo in QuWork per computer. Le opzioni della pagina mobile sono nelle impostazioni DSH.',
  },
}

/** Copy lookup with an English fallback for unexpected locales. */
export function quworkPanelCopy(locale: MobileControlLocale): QuworkPanelCopy {
  return COPY[locale] ?? COPY.en
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Unwrap a `/qurwork` response and keep only displayable account fields.
 *
 * The Host answers `{ accepted, profile, account }`, optionally wrapped as
 * `{ ok: true, value }`. Anything else degrades to signed out instead of
 * inventing an identity.
 */
export function quworkAccountFromResponse(response: unknown): QuworkAccountView {
  const envelope = record(response)
  const payload = record(envelope?.ok === true ? envelope.value : response)
  const profile = record(payload?.profile)
  const account = record(payload?.account)
  const displayName = text(profile?.displayName) ?? text(account?.username)
  const username = text(account?.username)
  const accountId = text(account?.id)
  const affCode = text(account?.affCode)
  const avatarUrl = text(profile?.avatarUrl)
  const view: QuworkAccountView = {
    signedIn: profile !== undefined || account !== undefined,
    staff: account?.isStaff === true,
    ...displayName === undefined ? {} : { displayName },
    ...username === undefined ? {} : { username },
    ...accountId === undefined ? {} : { accountId },
    ...affCode === undefined ? {} : { affCode },
    ...avatarUrl === undefined ? {} : { avatarUrl },
  }
  return view.displayName === undefined && view.username === undefined && !view.signedIn
    ? { signedIn: false, staff: false }
    : view
}

/** Label/value rows for the account sheet. */
export function quworkAccountRows(account: QuworkAccountView, copy: QuworkPanelCopy): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  if (account.username !== undefined) rows.push({ label: copy.labelUsername, value: account.username })
  if (account.accountId !== undefined) rows.push({ label: copy.labelAccountId, value: account.accountId })
  rows.push({ label: copy.labelRole, value: account.staff ? copy.roleStaff : copy.roleMember })
  if (account.affCode !== undefined) rows.push({ label: copy.labelAffCode, value: account.affCode })
  return rows
}

/** Single-line account summary used by the copy action. */
export function quworkAccountSummary(account: QuworkAccountView): string {
  return [account.displayName, account.username, account.accountId]
    .filter((value): value is string => value !== undefined)
    .join(' / ')
}

export const QUWORK_PANEL_STYLES = `
[data-dsh-mobile-qurwork] { position:fixed; z-index:262; inset:0; display:flex; align-items:flex-end; }
[data-dsh-mobile-qurwork][hidden] { display:none; }
.dsh-mobile-qurwork-backdrop { position:absolute; inset:0; margin:0; padding:0; border:0; background:rgb(15 23 42 / 32%); }
.dsh-mobile-qurwork-sheet { position:relative; display:flex; flex-direction:column; box-sizing:border-box; width:100%; max-height:82dvh; background:var(--dsw-alias-bg-layer-1,#fff); border-radius:20px 20px 0 0; box-shadow:0 -18px 46px rgb(15 23 42 / 18%); padding-bottom:env(safe-area-inset-bottom); }
.dsh-mobile-qurwork-header { display:flex; align-items:center; gap:8px; padding:10px 8px 10px 16px; border-bottom:1px solid var(--dsw-alias-border-l2,#e8ebef); }
.dsh-mobile-qurwork-title { flex:1; margin:0; font-size:17px; line-height:24px; font-weight:600; color:var(--dsw-alias-label-primary,#0f172a); }
.dsh-mobile-qurwork-close { flex:none; box-sizing:border-box; min-width:44px; height:44px; padding:0 12px; border:0; border-radius:10px; background:transparent; color:var(--dsw-alias-label-secondary,#667085); font:inherit; font-size:14px; cursor:pointer; }
.dsh-mobile-qurwork-body { display:flex; flex-direction:column; gap:14px; overflow-y:auto; padding:16px; }
.dsh-mobile-qurwork-identity { display:flex; align-items:center; gap:12px; }
.dsh-mobile-qurwork-avatar { flex:none; display:inline-flex; align-items:center; justify-content:center; width:48px; height:48px; border-radius:50%; overflow:hidden; background:var(--dsw-alias-bg-layer-2,#f3f4f6); color:var(--dsw-alias-label-secondary,#667085); font-size:18px; font-weight:600; }
.dsh-mobile-qurwork-avatar > img { width:100%; height:100%; object-fit:cover; }
.dsh-mobile-qurwork-name { font-size:17px; line-height:24px; font-weight:600; color:var(--dsw-alias-label-primary,#0f172a); overflow-wrap:anywhere; }
.dsh-mobile-qurwork-sub { font-size:13px; line-height:20px; color:var(--dsw-alias-label-secondary,#667085); overflow-wrap:anywhere; }
.dsh-mobile-qurwork-rows { display:flex; flex-direction:column; gap:1px; margin:0; border-radius:12px; overflow:hidden; background:var(--dsw-alias-bg-layer-2,#f3f4f6); }
.dsh-mobile-qurwork-row { display:flex; align-items:baseline; gap:12px; padding:10px 12px; background:var(--dsw-alias-bg-layer-1,#fff); font-size:14px; line-height:20px; }
.dsh-mobile-qurwork-row > dt { flex:none; min-width:72px; margin:0; color:var(--dsw-alias-label-secondary,#667085); }
.dsh-mobile-qurwork-row > dd { flex:1; margin:0; color:var(--dsw-alias-label-primary,#0f172a); overflow-wrap:anywhere; }
.dsh-mobile-qurwork-hint { margin:0; font-size:13px; line-height:20px; color:var(--dsw-alias-label-secondary,#667085); }
.dsh-mobile-qurwork-actions { display:flex; gap:8px; }
.dsh-mobile-qurwork-action { flex:1; box-sizing:border-box; min-height:44px; padding:0 12px; border:1px solid var(--dsw-alias-border-l2,#e8ebef); border-radius:12px; background:var(--dsw-alias-bg-layer-1,#fff); color:var(--dsw-alias-label-primary,#0f172a); font:inherit; font-size:14px; cursor:pointer; }
.dsh-mobile-qurwork-action[data-primary] { border-color:transparent; background:var(--dsw-alias-button-primary-fill,#1f6feb); color:var(--dsw-alias-label-primary-foreground,#fff); }
.dsh-mobile-qurwork-action:disabled { opacity:.6; cursor:default; }
`

interface PanelRefs {
  readonly root: HTMLElement
  readonly backdrop: HTMLButtonElement
  readonly sheet: HTMLElement
  readonly title: HTMLElement
  readonly close: HTMLButtonElement
  slot: HTMLElement
}

export interface MobileQuworkPanelOptions {
  readonly view: Window
  readonly page: Document
  readonly locale: () => MobileControlLocale
}

type PanelState = 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable'

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('qurwork-account-timeout')) }, milliseconds)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error) },
    )
  })
}

/**
 * Intercept QuWork-only triggers on the mobile page and render the sheet.
 * @param context - Client context used to resolve the DSH connection service.
 * @param options - Window, document and locale resolver.
 * @returns Teardown for listeners, sheet and styles.
 */
export function installMobileQuworkPanel(context: QuworkPanelContext, options: MobileQuworkPanelOptions): () => void {
  const { view, page, locale } = options
  const create = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
    const created = page.createElement(tag)
    created.className = className
    return created
  }

  const style = create('style', '')
  style.dataset.plugin = 'dsh-mobile-qurwork'
  style.textContent = QUWORK_PANEL_STYLES
  page.head.append(style)

  let refs: PanelRefs | undefined
  let mode: QuworkPanelMode = 'profile'
  let serial = 0
  let state: PanelState = 'idle'
  let account: QuworkAccountView | undefined

  function resolveRpc(): QuworkRpcClient | undefined {
    const connection = context.get('connection')
    if (typeof connection !== 'object' || connection === null) return undefined
    const rpc = (connection as { rpc?: unknown }).rpc
    if (typeof rpc !== 'object' || rpc === null) return undefined
    return typeof (rpc as { call?: unknown }).call === 'function' ? rpc as QuworkRpcClient : undefined
  }

  function hint(value: string): HTMLElement {
    const paragraph = create('p', 'dsh-mobile-qurwork-hint')
    paragraph.textContent = value
    return paragraph
  }

  function action(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
    const button = create('button', 'dsh-mobile-qurwork-action')
    button.type = 'button'
    button.textContent = label
    if (primary) button.dataset.primary = 'true'
    button.addEventListener('click', onClick)
    return button
  }

  function identity(copy: QuworkPanelCopy): HTMLElement {
    const wrapper = create('div', 'dsh-mobile-qurwork-identity')
    const avatar = create('div', 'dsh-mobile-qurwork-avatar')
    const name = account?.displayName ?? account?.username
    if (account?.avatarUrl !== undefined) {
      const image = create('img', '')
      image.src = account.avatarUrl
      image.alt = ''
      avatar.append(image)
    } else {
      avatar.textContent = name === undefined ? '?' : Array.from(name)[0] ?? '?'
    }
    const labels = create('div', '')
    const title = create('div', 'dsh-mobile-qurwork-name')
    title.textContent = name ?? copy.signedOut
    const sub = create('div', 'dsh-mobile-qurwork-sub')
    sub.textContent = name === undefined ? copy.signedOutHint : (account?.staff === true ? copy.roleStaff : copy.roleMember)
    labels.append(title, sub)
    wrapper.append(avatar, labels)
    return wrapper
  }

  function renderProfile(body: HTMLElement, copy: QuworkPanelCopy): void {
    if (state === 'loading') {
      body.append(hint(copy.loading))
      return
    }
    if (state === 'unavailable') {
      body.append(hint(copy.unavailable))
      return
    }
    if (state === 'failed') {
      body.append(hint(copy.failed))
      const actions = create('div', 'dsh-mobile-qurwork-actions')
      actions.append(action(copy.retry, true, () => { void load() }))
      body.append(actions)
      return
    }
    if (account === undefined) return
    if (!account.signedIn) {
      body.append(hint(copy.signedOut))
      body.append(hint(copy.signedOutHint))
    } else {
      body.append(identity(copy))
      const rows = create('dl', 'dsh-mobile-qurwork-rows')
      for (const row of quworkAccountRows(account, copy)) {
        const line = create('div', 'dsh-mobile-qurwork-row')
        const term = create('dt', '')
        term.textContent = row.label
        const value = create('dd', '')
        value.textContent = row.value
        line.append(term, value)
        rows.append(line)
      }
      body.append(rows)
      body.append(hint(copy.desktopOnly))
    }
    const actions = create('div', 'dsh-mobile-qurwork-actions')
    actions.append(action(copy.retry, !account.signedIn, () => { void load() }))
    const summary = account.signedIn ? quworkAccountSummary(account) : ''
    if (summary !== '') {
      const clipboard = view.navigator.clipboard
      if (clipboard !== undefined) {
        actions.append(action(copy.copyAccount, false, () => {
          void clipboard.writeText(summary).catch(() => undefined)
        }))
      }
    }
    body.append(actions)
  }

  function paint(): void {
    const current = refs
    if (current === undefined) return
    const copy = quworkPanelCopy(locale())
    current.title.textContent = mode === 'profile' ? copy.profileTitle : copy.settingsTitle
    current.close.textContent = copy.close
    current.close.setAttribute('aria-label', copy.close)
    current.backdrop.setAttribute('aria-label', copy.close)
    current.sheet.setAttribute('aria-label', mode === 'profile' ? copy.profileTitle : copy.settingsTitle)
    const body = create('div', 'dsh-mobile-qurwork-body')
    if (mode === 'settings') body.append(hint(copy.settingsHint))
    else renderProfile(body, copy)
    current.slot.remove()
    current.sheet.append(body)
    current.slot = body
  }

  async function load(): Promise<void> {
    const current = ++serial
    const client = resolveRpc()
    account = undefined
    if (client === undefined) {
      state = 'unavailable'
      paint()
      return
    }
    state = 'loading'
    paint()
    try {
      const response = await withTimeout(
        client.call(QUWORK_RPC_BASE, QUWORK_ACCOUNT_METHOD, {}),
        QUWORK_ACCOUNT_TIMEOUT_MS,
      )
      if (current !== serial) return
      account = quworkAccountFromResponse(response)
      state = 'ready'
    } catch {
      if (current !== serial) return
      state = 'failed'
    }
    paint()
  }

  function close(): void {
    serial += 1
    if (refs !== undefined) refs.root.hidden = true
  }

  function ensureRoot(): PanelRefs {
    if (refs !== undefined) return refs
    const root = create('div', 'dsh-mobile-qurwork')
    root.setAttribute('data-dsh-mobile-qurwork', '')
    root.hidden = true
    const backdrop = create('button', 'dsh-mobile-qurwork-backdrop')
    backdrop.type = 'button'
    const sheet = create('section', 'dsh-mobile-qurwork-sheet')
    sheet.setAttribute('role', 'dialog')
    sheet.setAttribute('aria-modal', 'true')
    const header = create('header', 'dsh-mobile-qurwork-header')
    const title = create('h2', 'dsh-mobile-qurwork-title')
    const closeButton = create('button', 'dsh-mobile-qurwork-close')
    closeButton.type = 'button'
    header.append(title, closeButton)
    const slot = create('div', 'dsh-mobile-qurwork-body')
    sheet.append(header, slot)
    root.append(backdrop, sheet)
    page.body.append(root)
    backdrop.addEventListener('click', close)
    closeButton.addEventListener('click', close)
    refs = { root, backdrop, sheet, title, close: closeButton, slot }
    return refs
  }

  function open(next: QuworkPanelMode): void {
    mode = next
    const current = ensureRoot()
    current.root.hidden = false
    current.root.setAttribute('data-mode', next)
    if (next === 'profile') {
      void load()
    } else {
      serial += 1
      state = 'idle'
      paint()
    }
    current.close.focus()
  }

  function onDocumentClick(event: Event): void {
    const target = event.target as Element | null
    const trigger = target?.closest?.(QUWORK_PROFILE_TRIGGER_SELECTOR) ?? null
    if (trigger === null) return
    event.preventDefault()
    event.stopPropagation()
    open('profile')
  }

  function onAppSettings(): void {
    open('settings')
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    if (refs === undefined || refs.root.hidden) return
    event.stopPropagation()
    close()
  }

  page.addEventListener('click', onDocumentClick, true)
  page.addEventListener('keydown', onKeydown, true)
  view.addEventListener(QUWORK_APP_SETTINGS_EVENT, onAppSettings)

  return () => {
    serial += 1
    page.removeEventListener('click', onDocumentClick, true)
    page.removeEventListener('keydown', onKeydown, true)
    view.removeEventListener(QUWORK_APP_SETTINGS_EVENT, onAppSettings)
    style.remove()
    if (refs !== undefined) {
      refs.root.remove()
      refs = undefined
    }
  }
}
