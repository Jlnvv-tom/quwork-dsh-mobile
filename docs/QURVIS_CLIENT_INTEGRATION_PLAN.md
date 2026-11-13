# QuWork 桌面客户端（Qurvis）适配分析与计划

本文回答一个问题：本仓库的插件（`quwork-mobile` 0.8.7）要装进 `/Users/wujihuan/work/rrzu/Qurvis` 这个 DSH 二次改造的桌面客户端，需要做哪些改造、按什么顺序做、如何验收。

结论先行：

- **运行时兼容性风险低**。Qurvis 内置 DSH `0.2.2-rc.1`，与本插件当前打包验证目标一致；Qurvis 用 `--port 0` 随机端口，插件已按 `ctx.webServer.port` 跟随上游，并通过 `ctx.connection.authenticatedUrl()` 换取 DSH 启动令牌对应的认证 cookie。
- **真正的改造成本在"分发/装载形态"和"手机页与 QuWork 自有 Client 定制共存"两处**，不在 DSH 协议层。
- 推荐通道：**npm-vendor 内置插件**（dshmarket 同款离线 vendor），不要用 `source: local`，也不要用 `delivery: remote`。理由见 §2.1。

已有改造基线见 [QUWORK_FORK_GUIDE.md](QUWORK_FORK_GUIDE.md)；其中的品牌、包名、上游更新链路切断（`src/release-update.ts` 已改为只报随包版本）已经落地，本文只覆盖"进 QuWork"这一段。

## 1 QuWork 侧关键机制（已核对）

| 机制 | 事实 | 证据 |
| --- | --- | --- |
| DSH 版本 | bundled `0.2.2-rc.1`，补丁集 `qurwork-client-ui-runtime-fixes` | `config/app.public.config.js`、`patches/dsh-runtime/README.md` |
| 启动方式 | `node ... <dshEntry> web --patch <abs> --no-open --host 127.0.0.1 --port 0` | `src/main/dsh/process-controller.ts:258-282` |
| DSH_HOME | `~/.qurwork-desktop-dsh/.dsh`；`DSH_HOME` 由 Main 注入 | `config/app.public.config.js:47`、`src/main/dsh/process-controller.ts:325` |
| 插件生效通道 A | Host-only 本地插件 → Main 生成 `active/cordis.patch.yml`（`insert[].name = file://…`）经 `--patch` 注入 | `src/main/dsh/builtin-plugin-service.ts:218-321` |
| 插件生效通道 B | 双半 / npm-vendor 插件 → 写入 `profiles/web/package.json` 的 `file:<id>.tgz` 依赖 + `dsh.profile.bundles` + 合并 vendor lockfile | `src/main/dsh/builtin-npm-plugin-installer.ts:926-1010` |
| 本地 bundled tarball 白名单 | 仅 `package.json`、`lib`、`client`、`skills`、`cordis.patch.yml` | `src/main/dsh/builtin-plugin-service.ts:463` |
| npm-vendor 形态 | `builtin-dsh-plugins/<id>/{plugin.json,vendor/}`，vendor 内含 `package.tgz` + `offline-store.tgz` + `pnpm-lock.yaml`，由 `scripts/vendor-builtin-dsh-npm-plugin.ts --id --package <name@version>` 产出，registry 固定 `registry.npmjs.org` | `builtin-dsh-plugins/dshmarket/`、`scripts/builtin-dsh-plugin-schema.ts:7` |
| 远程插件 | `delivery: remote` + `remote.method: npm` 精确版本，装成功只到 `installed-pending-restart`，需完整重启 | `src/main/plugin-market/remote-builtin-plugin-service.ts` |
| 内置插件启用 | 每次启动强制把内置插件 `setEnabled(..., true, { allowProtected: true })`，用户不可长期禁用 | `src/main/plugin-market/builtin-plugin-enabled-state-service.ts:115-128` |
| 插件页隐藏 | 运行时补丁把 `delivery !== 'runtime'` 的包名追加进 `HIDDEN_BUNDLES`（当前不含 `quwork-mobile`） | `patches/dsh-runtime/0.2.2-rc.1/README.md` |
| 侧栏/账号菜单 | 运行时补丁改了 `settings-account` 客户端产物：菜单收敛为「Harness 设置 / 应用设置 / 退出登录」，「应用设置」派发 `qurwork:open-app-settings` 由 bridge 转 `/qurwork` RPC | 同上 |
| DSH Web 认证 | 303 换 `dsh-auth-*` HttpOnly cookie，存于 `persist:qurwork-deepseek-harness` 分区；页面 URL 去掉 token | `src/main/main.ts:177-190, 1282-1315` |
| guest 策略 | webview `src` 必须与当前 DSH origin（`http://127.0.0.1:<port>`）完全同源、指定 partition、强制 sandbox/contextIsolation，禁止危险参数 | `src/main/dsh/guest-policy.ts:479-523` |
| 轻量重启 | `lightRestart()` 只重启 DSH 进程（新随机端口），不重建 Profile | `src/main/dsh/runtime-manager.ts:253` |

## 2 本仓库现状（与 QuWork 相关的部分）

| 项 | 现值 | 影响 |
| --- | --- | --- |
| 包/入口 | `quwork-mobile@0.8.7`，`main = ./index.mjs`，`bin.quwork-mobile = lib/cli.js` | `index.mjs` 在根目录，**不在本地 bundled tarball 白名单内** |
| patch | `cordis.patch.yml` 两条 insert：`mobile-access`（`name: quwork-mobile`，`inject: [webServer, connection]`，含 `!!js dshHomePath(...)`）与 `dsh-ui-fixes`（`./packages/question-fixes/lib/index.mjs`） | `packages/`、`assets/`、`apps/`、`bin/` 同样不在白名单 |
| 运行期依赖 | `ws`、`qrcode`、`selfsigned`、`web-push`、`bonjour-service`、`eventsource-parser`、`zod`、`@noble/hashes`、`@deepseek-ai/schemastery` | `lib/index.mjs` 里这些是 **external import**，profile 必须能解析到 `node_modules` |
| 上游跟随 | `ctx.webServer.port` → `upstreamOrigin`，`setup.json` 仅做诊断快照 | 与 QuWork `--port 0` 兼容 |
| 上游认证 | `ctx.connection.authenticatedUrl(origin)` → 303 换 cookie 并缓存续期 | 与 QuWork 的 `dsh-auth-*` cookie 机制一致 |
| 首次启用 | 无 `setup.json` 时状态为 `unconfigured`，需 `quwork-mobile setup` CLI 或管理面板内的局域网准备接口 | QuWork 没有面向用户的 CLI/shell，必须走 UI |
| 移动布局 | `mobile-layout.js` 由**网关**注入到代理后的 HTML（`config.ts:428`、`gateway.ts:142,701`） | QuWork 桌面 WebView 直连 DSH origin，**不会**被注入移动布局，桌面外观不受影响 |
| 客户端模块 | `dsh.client.inject` 依赖 5 个 DSH 客户端包；桌面端只注册 `settings.general.item` 与 `sidebar.footer.action` | 与 `qurwork-dsh-bridge` 的侧栏接管有交叠风险（§2.2） |
| 自更新 | 已改为只报随包版本，不再访问 npm/GitHub | 版本节奏完全交给 QuWork 发版 |

### 2.1 分发通道选型

| 方案 | 可行性 | 代价 |
| --- | --- | --- |
| A. `npm-vendor`（推荐） | 保留插件完整包布局（`index.mjs`、`packages/`、`apps/mobile/release.json`、`bin/` 与全部依赖）与离线安装能力，和 dshmarket 同一条已验证链路 | 需把 `quwork-mobile` 精确版本发布到 `registry.npmjs.org`，或给 `scripts/vendor-builtin-dsh-npm-plugin.ts` 增加"本地 tarball + 本地 pnpm store"输入（Qurvis 侧约一个脚本改动） |
| B. `source: local` bundled | 只能带白名单 5 项 | 需要把产物重排到 `lib/`、内联 `apps/mobile/release.json`、迁移 `packages/question-fixes`、处理 `bin/` 与 `assets/`，并把 9 个第三方依赖打进 bundle；等价于改构建产物形态，风险高于 A |
| C. `delivery: remote`（npm） | 安装成功率高（走 pnpm 真实 install） | 依赖公网 + registry 无凭据可读；失败只到 `installed-pending-restart` 且需完整重启；首次启动离线用户直接失去能力 |

### 2.2 手机页与 QuWork Client 定制的冲突面

`qurwork-dsh-bridge` 的客户端产物会改写 DSH 侧栏：合并「插件·技能」入口、隐藏非保留 `panelRow`、改官方 More 菜单、注入个人中心 Portal，并依赖 `settings-account` 补丁后的账号菜单结构。这些代码在**手机页也会执行**（手机页同样是 DSH 前端，只是布局被网关换成移动壳）。已可用的缓解手段是网关的客户端模块排除（`excludedClientModules`，见 `src/client-module-preferences.ts`、`gateway.ts:671`），但默认清单为空，且未针对 QuWork 内置模块做特判。

## 3 差距清单

优先级：P0 = 不做就无法交付；P1 = 影响体验/支持面；P2 = 可后置。

| # | 差距 | 影响 | 改造动作 | 仓库 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| 1 | 插件没有可被 QuWork 消费的分发形态 | 无法内置 | 采用 npm-vendor：发布精确版本 + 生成 `builtin-dsh-plugins/quwork-mobile/vendor/`（`package.tgz`、`offline-store.tgz`、`pnpm-lock.yaml`） | Qurvis + 发布流水线 | P0 |
| 2 | `vendor` 脚本只接受公共 registry 的 `name@version` | 无计划公开发布时卡住 | 为 `scripts/vendor-builtin-dsh-npm-plugin.ts` 增加 `--tarball <path>`（本地打包 + 本地 store），并放宽 schema 的 `tarballUrl` 断言 | Qurvis | P0 |
| 3 | 内置清单无条目 | 不装载 | `builtin-dsh-plugins/builtin-plugins.json` 追加 `{ id: quwork-mobile, delivery: bundled, visibleInPluginManagement: false }`，并补 `plugin.json`（`dshVersionRange` 覆盖 `0.2.2-rc.1`） | Qurvis | P0 |
| 4 | 移动端能力默认关闭（`initiallyEnabled: false`）且 QuWork 强制启用内置插件 | 用户在一处看到开关却无效 | 随包 patch 改 `initiallyEnabled: true`，但保持 `listenHost: 127.0.0.1`、`allowedCidrs: [127.0.0.0/8]`、`tls.mode: disabled`，局域网必须由用户在 UI 内显式开启 | 本仓库 | P0 |
| 5 | 首次启用依赖 CLI | 用户无法完成初始化 | 确认并打通管理面板内的局域网准备接口（`plugin.ts:1423-1445` 的 `lan_setup_*`），把「未配置」态做成开箱引导：选网卡 → 生成证书 → 显示配对二维码；补一条"无 CLI 环境下首次配置"的 smoke | 本仓库 | P0 |
| 6 | 插件页会把它当普通用户插件展示 | 用户可开关、可卸载、认知混乱 | 在运行时补丁的 `HIDDEN_BUNDLES` 追加 `quwork-mobile`，重建 runtime artifact、更新 SHA 与测试 | Qurvis | P1 |
| 7 | `qurwork-dsh-bridge` 客户端在手机页执行 | 侧栏接管与移动壳争 DOM；个人中心/QuWork 账号入口在手机上点了无效 | 网关默认排除清单加入 `qurwork-dsh-bridge` 等 QuWork 桌面专属客户端模块；QuWork 支持能力探测，不再假设这些模块一定存在 | 本仓库 + Qurvis | P1 |
| 8 | 账号菜单多出「应用设置」项（派发 Electron 事件） | 手机上点了无反应 | 移动布局侧按 `settings-account` 补丁后的选择器隐藏/降级该项；补回归用例 | 本仓库 | P1 |
| 9 | 端口 `3443` 与其它移动类插件默认端口一致 | 端口冲突时网关起不来 | 启动探测可用端口并在管理面板展示实际端口；文档与错误码同步（不能静默改端口，否则旧配对失效） | 本仓库 | P1 |
| 10 | 移动壳选择器基于上游 DSH DOM，QuWork 补丁改了模型选择菜单与账号菜单 | 移动端局部样式/行为回归风险 | 在 `0.2.2-rc.1 + qurwork patches` 目标上跑 `smoke:native-layout`、`smoke:mobile-sidebar`、`smoke:composer-toolbar`；`check:dsh-compatibility` 增加 QuWork 补丁目标 | 本仓库 | P1 |
| 11 | QuWork 桌面端无法内嵌预览手机页（guest 只允许同源） | 想做"桌面预览手机页面"会撞策略 | 产品上改为"显示二维码 + 用真实手机验证"；若确需内嵌，需 QuWork 明确放开一条受控策略（不建议） | Qurvis（决策） | P2 |
| 12 | 手机页缺少 QuWork 专属信息（账号、应用设置） | 与桌面体验不一致 | 先隐藏，账号打通单列项目；`/qurwork` RPC 依赖 Electron 进程，手机端不得依赖 | 本仓库 + 产品 | P2 |
| 13 | App 仍是上游身份与发布地址 | 不可对外分发 | 按 fork 指南阶段三/六执行：`applicationId`、签名、图标、`apps/mobile/release.json`、下载页、release 接口 | 本仓库 | P0（对外发布前） |
| 14 | 版本节奏 | 插件随 QuWork 发版，App 独立发版 | 明确"内置版本随客户端、App 走自有通道"两条线；`check:mobile-release` 与 `check:release-version` 保留 | 本仓库 | P1 |

## 4 分阶段计划

### 阶段 0：兼容性验证 spike（1–2 天，不改代码）

在 QuWork dev 环境把当前 `npm pack` 产物手工装进 `~/.qurwork-desktop-dsh/.dsh/profiles/web`，验证并记录：

1. 网关照常启动、`ctx.connection.authenticatedUrl()` 换 cookie 成功（`smoke:upstream-auth` 逻辑在 QuWork 上的实际表现）。
2. 手机浏览器配对 + 会话可用；`lightRestart()` 后手机端自动恢复（端口变化跟随）。
3. `qurwork-dsh-bridge` 与移动壳的实际 DOM 冲突截图清单（侧栏、More 菜单、账号菜单、个人中心）。
4. QuWork 运行时补丁（模型菜单、插件页隐藏、账号菜单）在手机页的表现。

产出：`docs/` 下一份验证记录（含截图与失败码），作为后续阶段的验收基线。

### 阶段 1：插件侧产品化（约 1 周）

- 开箱引导：`unconfigured` 态在管理面板内完成网卡选择、证书生成、二维码展示；错误态给出可操作文案（无 CLI）。
- 安全默认：仅 loopback 监听；局域网/公网通道为显式动作；配对有效期与设备列表可撤销。
- QuWork 共存：手机页默认排除 QuWork 桌面专属客户端模块；隐藏「应用设置」等 Electron-only 入口；端口占用时的降级与提示。
- 兼容矩阵：`check:dsh-compatibility` 增加 `0.2.2-rc.1 + qurwork patches` 目标；保留 `npm run verify` 全绿。

### 阶段 2：Qurvis 内置集成（约 1 周）

- vendor 链路：发布或本地 tarball → 生成 `vendor/` → `plugin.json` + `builtin-plugins.json` → `npm run runtime:plugins:build` 通过审计。
- 运行时补丁：`HIDDEN_BUNDLES` 追加 `quwork-mobile`；如需隐藏账号菜单项，优先判断能否由 bridge 客户端在窄屏下自降级完成（避免再次改 runtime 补丁与 SHA）。
- Main 侧：内置插件启用归一化已强制启用，确认不与应用内"移动访问"开关冲突（建议 QuWork 只展示状态，不做二次开关）。
- 测试：全新用户目录启动 → 内置插件 active → 移动入口可见；Profile 恢复/迁移用例覆盖新增 bundle 条目。

### 阶段 3：App 与对外发布（约 1–2 周）

- App 身份、签名、图标、`release.json`、内核要求提示（沿用 fork 指南阶段三/六）。
- 发布通道：静态 release 描述接口 + CDN 产物；插件不再自查更新，版本随客户端。
- 文档与合规：Apache-2.0 声明、第三方 notices、修改文件标注。

### 阶段 4（后续独立项目）

账号打通、免配对直连、推送统一、iOS。

## 5 验收清单

| 阶段 | 验收项 | 判定 |
| --- | --- | --- |
| 0 | 手工装入可用、手机可配对、重启后自愈 | 记录在案，无未解释失败 |
| 1 | 无 CLI 也能完成首次配置 | 全新用户目录 + 图形界面走通 |
| 1 | 默认不暴露局域网 | `lsof -i :3443` 仅 loopback；外部设备访问被拒 |
| 1 | 手机页无 QuWork 桌面专属入口残留 | 侧栏/账号菜单/插件页逐项核对 |
| 2 | 内置版本随客户端安装即生效 | 全新启动即出现移动入口，插件页不出现该插件 |
| 2 | Profile 事务与回滚不被破坏 | QuWork 插件安装/恢复用例全绿 |
| 3 | 签名指纹固定、可覆盖安装 | 签名校验脚本通过 |
| 回归 | 本仓库 `npm run verify` | 全绿 |

## 6 风险登记

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 依赖只能靠 profile 解析，本地 bundled 白名单不含 `node_modules` | 内置后网关卡在 import 阶段 | 选 npm-vendor；spike 阶段先验证真实装载 |
| QuWork 每次启动强制启用内置插件 | 用户以为可在插件页关闭 | 插件页隐藏 + 应用内只做状态展示 |
| DSH 随机端口 + `lightRestart()` | 手机端短时断连 | 已有上游跟随逻辑；补一条重启后自动恢复的 smoke |
| 手机页执行 bridge 客户端 | 蒙灰/无效入口/争 DOM | 默认排除清单 + 能力探测 |
| QuWork runtime 补丁变更 DSH 客户端产物 | 移动壳选择器回归 | 把 QuWork 补丁版本纳入兼容矩阵，补对应 smoke |
| 端口 3443 冲突 | 网关不启动 | 探测 + 明确错误提示，不静默改端口 |
| 公开发布 `quwork-mobile` 到公共 registry | 品牌与维护面暴露 | 优先走本地 tarball vendor；公开发布仅用于内部构建源 |

## 7 待决策项

1. 分发通道：本地 tarball vendor（需 Qurvis 脚本小改）还是发布到公共/私有 registry。
2. 局域网默认策略：保持默认关闭（推荐）还是首启引导后默认开启。
3. App 是否随 QuWork 客户端同版本节奏发布，还是独立版本号。
4. 手机端是否需要 QuWork 账号与"应用设置"（决定是隐藏，还是做账号打通）。
5. 是否接受"不支持桌面内嵌预览手机页"这一产品限制（guest 同源策略）。
