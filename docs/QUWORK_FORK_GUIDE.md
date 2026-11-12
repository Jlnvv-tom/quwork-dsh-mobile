# QuWork 移动端二次开发改造执行指南

本文是 `dsh-mobile`（插件 + Android App）改造为 QuWork 自有移动端产品的执行手册。内容基于仓库当前状态核对，涉及的行号与文件名随上游演进可能漂移，执行前请重新定位。

## 1 适用范围与前置判断

### 1.1 本指南覆盖什么

- 插件包的品牌、包名、文案、图标的替换
- 上游更新链路的切断与自有发布通道的建立
- Android App 的应用身份、签名、版本、图标的改造
- 以 QuWork 内置插件（bundled）形态集成进桌面端
- 与其它移动类插件的互斥治理与冲突自检
- 发布流水线迁移与验收清单

### 1.2 本指南不覆盖

- DSH 上游源码或已安装前端产物的修改（仓库 `AGENTS.md` 明确禁止）
- QuWork 账号体系统一登录、免配对直连（属于后续独立项目）
- iOS 端

### 1.3 三个必须先确定的前提

| 决策项 | 建议 | 原因 |
| --- | --- | --- |
| fork 还是双品牌 | 独立 fork，新仓库新包名 | 双品牌共用 `dsh-mobile` 包名时，插件市场与 npm 仍会装到上游版本，品牌化改动会被直接覆盖 |
| 许可证处理 | Apache-2.0，可商用闭源再分发 | 需保留 `LICENSE`、`THIRD_PARTY_NOTICES.md`、`FUNNEL_THIRD_PARTY_LICENSES.txt`，标注修改过的文件，且不得使用原作者商标 |
| 上游同步方式 | 保留 `upstream` remote，品牌化改动集中到少数文件 | 品牌词当前散落在大量文件中，全局替换会导致后续同步持续冲突 |

## 2 绝对不能改的部分

以下内容属于运行时契约或状态持久化位置，一旦改动会导致已配对设备失效、App 与插件无法通信，或历史数据丢失。品牌化过程中应把它们当作只读。

| 类别 | 具体内容 | 位置 |
| --- | --- | --- |
| 插件状态路径 | `mobile-access/setup.json`、`devices.json`、`control.json`、`mobile.css`、`mobile.js` | `cordis.patch.yml` 的 `setupFile` 等配置项 |
| 协议版本 | `MOBILE_METADATA_VERSION = 1`、`MINIMUM_ANDROID_APP_VERSION = '0.2.2'` | `src/version.ts` |
| 浏览器端存储键 | `dsh-mobile.*` 前缀的 localStorage 键，例如 `dsh-mobile.frp-vps-form.v1` | `src/client.ts` |
| DOM 与 CSS 标识 | `dsh-mobile-*` 类名前缀、`data-dsh-mobile-*` 属性、`x-dsh-mobile-csrf` 头名 | `src/client.ts`、`src/native-mobile.ts`、`src/client-module-ui.ts`、`src/mobile-layout.ts` |
| App 本地存储名 | `dsh_mobile`、`dsh_mobile_devices_v1` 两个 SharedPreferences 名称 | `MainActivity.kt`、`PairedDeviceStore.kt` |
| 认证链路 | 配对、证书固定、CSRF、会话续期相关逻辑 | `src/auth-pages.ts`、`PinnedTls.kt`、`NativeAuthClient.kt` 等 |

说明：`PREFERENCES_NAME` 在更换 `applicationId` 后本来就会因应用隔离而失效，但 App 内部两处名称必须保持一致，不能只改一处。

## 3 阶段零：仓库准备

1. 从上游 fork，保留完整的 git 历史与原作者提交记录。
2. 添加 `upstream` 指向原仓库，禁止向其推送。
3. 新建改造分支，例如 `feat/qurwork-branding`。
4. 记录基线：`npm run verify` 在未改造前必须全绿，作为后续回归对照。
5. 记录当前 Android 签名指纹，作为对照（新包名需要重新生成签名，旧指纹仅作参考）：

```bash
keytool -list -v -keystore <your.jks> | grep "SHA-256"
```

## 4 阶段一：插件身份与品牌化

### 4.1 建立品牌单点

新增 `src/brand.ts`，作为所有对外可见文案与地址的唯一出口。建议字段：

```ts
export const BRAND = {
  productName: 'QuWork',
  shortName: 'QuWork',
  fullName: 'QuWork 移动端',
  androidAppName: 'QuWork',
  brandColor: '#1F6FEB',
  helpUrl: 'https://<quwork-domain>/help/mobile',
  downloadPageUrl: 'https://<quwork-domain>/download/mobile',
  releaseDescriptorUrl: 'https://<quwork-domain>/api/mobile/release.json',
  releaseNotesUrl: 'https://<quwork-domain>/mobile/releases',
} as const
```

后续所有品牌字符串都引用该模块，避免再次散落。

### 4.2 改动清单

| 序号 | 文件 | 现状 | 改法 |
| --- | --- | --- | --- |
| 1 | `package.json` | `name: "dsh-mobile"`，`bin.dsh-mobile`，`description` 含 DSH 品牌 | 改为 `quwork-mobile`，bin 同名，重写描述；`files` 白名单保持 |
| 2 | `cordis.patch.yml` | 条目 `name: dsh-mobile`、`id: mobile-access` | 改 `name: quwork-mobile`；`id` 与配置路径保持不变 |
| 3 | `src/brand.ts` | 不存在 | 新增，见 4.1 |
| 4 | `src/client-messages.ts` | 中英文词条含 `DSH Mobile`、`DeepSeek Harness` | 词条改为引用 `BRAND`，保持键名不变 |
| 5 | `src/auth-pages.ts` | 配对页、重连页标题含 DSH 品牌 | 引用 `BRAND.fullName` |
| 6 | `src/mobile-customization-notice.ts` | 扩展提示语含插件名 | 引用 `BRAND.productName` |
| 7 | `src/native-mobile.ts` 约 1983 行 | 硬编码把 `DSH Local Build` 回填为 `DeepSeek Harness` | 改为回填 `BRAND.productName` |
| 8 | `assets/mobile-push/icon-180.png` 等三张 | 上游图标（推送与 PWA 用） | 替换为 QuWork 图标，保持文件名与尺寸 |
| 9 | `assets/brand/app-icon-master.png`、`app-icon-rounded.svg` | 上游母图 | 换 QuWork 母图 |
| 10 | `apps/mobile/brand/app-icon-master.png` | Android 图标母图 | 同步替换 |
| 11 | `apps/mobile/android/app/src/main/res/values/strings.xml` | `app_name` 为 `DeepSeek Harness` | 改 `QuWork`；同步 `values-zh-rCN`、`values-it` |
| 12 | `README.md`、`README.en.md`、`docs/README.md` | 上游项目介绍与下载链接 | 改写为 QuWork 文档；注意 `check:docs` 会校验链接与标题锚点 |

### 4.3 文案改写的边界

- 只改"给用户看的"文本，不改日志、诊断码、协议字段名。
- 中英文词条必须成对修改，`src/client-messages.ts` 里缺失英文会导致界面回落。
- 改完执行 `npm run typecheck` 与 `npm test`，词条缺失通常会被现有测试捕获。
- 文档类改动后执行 `npm run check:docs`。

## 5 阶段二：切断上游更新链路

这是最容易出事的一步。当前插件会主动访问上游地址获取版本、更新说明，并在"立即更新"时从 npm 安装上游包。产品化后必须先切断。

### 5.1 上游硬编码位置

| 位置 | 现值 | 作用 |
| --- | --- | --- |
| `src/release-update.ts` | `PACKAGE_NAME = 'dsh-mobile'` | 更新时安装的包名 |
| `src/release-update.ts` | `NPM_LATEST_URL = 'https://registry.npmjs.org/dsh-mobile/latest'` | 查询插件最新版本 |
| `src/release-update.ts` | `ANDROID_RELEASE_DESCRIPTOR_URL = 'https://raw.githubusercontent.com/.../apps/mobile/release.json'` | 查询 App 最新版本 |
| `src/release-update.ts` | `GITHUB_RELEASE_API = 'https://api.github.com/repos/.../releases/tags/'` | 拉取更新说明与 APK 体积 |
| `src/release-update.ts` | `GITHUB_RELEASES_URL = 'https://github.com/.../releases'` | 兜底下载页 |
| `src/client.ts` 约 559 行 | 用 `GITHUB_RELEASES_URL` 拼 `quwork-android-v<ver>.apk` | 生成 APK 下载链接 |
| `apps/mobile/android/.../MainActivity.kt` 约 4233 行 | `APP_RELEASES_URL = 'https://github.com/.../releases/latest'` | App 内"下载更新"跳转 |

### 5.2 方案 A：关闭自动更新（第一阶段推荐，成本最低）

1. 让 `PluginReleaseStatus` 恒定返回 `updateAvailable: false`、`updateSupported: false`。
2. 客户端隐藏"立即更新""更新插件"入口，保留版本展示。
3. App 内 `APP_RELEASES_URL` 指向 QuWork 下载页，或直接去掉更新弹窗。

优点是一天内可完成且不可能回连上游；缺点是版本提示依赖 QuWork 客户端统一发版提示。

### 5.3 方案 B：接入自有发布通道（第二阶段）

自定义一个静态 JSON 接口，字段与现有 `PluginReleaseStatus` 对齐，前端无需改动：

```json
{
  "pluginVersion": "1.0.3",
  "androidVersion": "1.0.3",
  "androidVersionCode": 103,
  "androidDownloadUrl": "https://<cdn>/quwork-android-v1.0.3.apk",
  "androidCompatBytes": 0,
  "androidIrohBytes": 41230000,
  "releaseNotes": "更新说明"
}
```

配套要求：

- `apps/mobile/release.json` 继续作为随包内嵌的兜底版本描述，字段为 `version`、`versionCode`、`releaseTag`。
- 接口需带缓存，且离线时回落到内嵌值，不能让设置页报错。
- 保留 `scripts/check-release-version.mjs` 的版本一致性校验，它是防止版本漂移的核心防线。

## 6 阶段三：Android App 身份改造

### 6.1 不可逆提示

`applicationId` 一旦更换，即为全新应用：

- 旧版 `io.github.sayach.dshmobile` 的配对记录、WebView cookie、localStorage 全部不可继承；
- 用户必须重新安装并重新扫码配对；
- 两个应用可并存，但不会共享任何登录态。

跨应用读取旧数据在 Android 上不可行，只能由服务端重新下发配对。建议直接接受该代价，并在首启引导页强调"扫码连接 QuWork 电脑端"。

### 6.2 改造步骤

1. 迁移 Kotlin 包目录：

```bash
cd apps/mobile/android/app/src/main/java
mkdir -p com/quwork
git mv io/github/sayach/dshmobile com/quwork/mobile
rmdir io/github/sayach io/github 2>/dev/null || true
```

2. 批量替换包声明与导入：

```bash
cd apps/mobile/android
grep -rl "io\.github\.sayach\.dshmobile" app/src | xargs sed -i '' 's/io\.github\.sayach\.dshmobile/com.quwork.mobile/g'
```

3. 修改 `app/build.gradle.kts`：

```kotlin
android {
    namespace = "com.quwork.mobile"
    defaultConfig {
        applicationId = "com.quwork.mobile"
        versionCode = <你的版本号>
        versionName = "<你的版本名>"
    }
}
```

`debug` 构建的 `applicationIdSuffix = ".debug"` 保留，方便与正式包并存。

4. `AndroidManifest.xml` 无需改动包名相关字段：组件名使用相对写法，`fileprovider` 的 `authorities` 已是 `${applicationId}.fileprovider`。

5. 更新 `apps/mobile/release.json` 的 `version`、`versionCode`、`releaseTag`，与 Gradle 保持一致。

### 6.3 启动图标与别名收敛

清单中包含 6 个 `activity-alias`（吉祥物与若干鲸鱼变体），由 `LauncherIconPolicy.kt` 在运行时切换。产品化建议：

- 只保留一个 QuWork 图标别名并默认启用，其余删除或全部置为 `android:enabled="false"`；
- 同步删除 `res/mipmap-*` 中不再使用的 `ic_launcher_whale*` 资源；
- 简化 `LauncherIconPolicy.kt` 的切换逻辑，或整体移除该策略及其测试。

### 6.4 签名

- 用 QuWork 自有 keystore 替换现有 CI secret：`ANDROID_KEYSTORE_BASE64`、`DSH_ANDROID_KEYSTORE_PASSWORD`、`DSH_ANDROID_KEY_ALIAS`、`DSH_ANDROID_KEY_PASSWORD`（变量名建议一并改为 `QURWORK_*`，需同步 `app/build.gradle.kts` 的 `providers.environmentVariable` 与工作流）。
- 首次发布即固定签名，之后不可更换，否则用户无法覆盖安装。
- `scripts/verify-android-signature.mjs` 依据 `keytool -printcert` 输出比对指纹，改造后需把基线指纹换成新证书（或改为读取 `QURWORK_` 前缀环境变量）。

### 6.5 双 APK 策略

现有发布包含 `iroh` 完整版与兼容版，由 Gradle 属性 `irohNative` 与 `irohAbis` 控制，产物形如 `quwork-android-v<ver>.apk` 和 `quwork-android-v<ver>-iroh.apk`。

产品化建议只发行 `iroh` 完整版：`irohNative=true` 默认开启，兼容版仅作为内部兜底，减少支持面与测试矩阵。若保留双包，必须同时更新发布脚本、`release.json` 与下载链接拼装逻辑。

## 7 阶段四：内置进 QuWork 桌面端

### 7.1 声明内置插件

在 QuWork 仓库的 `builtin-dsh-plugins/` 下新增目录，参照现有 `qurwork-dsh-bridge/plugin.json` 的字段：

```json
{
  "id": "quwork-mobile",
  "displayName": "QuWork 移动端",
  "version": "1.0.0",
  "source": "local",
  "dshVersionRange": ">=0.2.1-rc.3 <0.3.0-0",
  "entryId": "quwork:mobile",
  "packageName": "quwork-mobile",
  "packageRoot": "package",
  "config": {}
}
```

`dshVersionRange` 必须与 QuWork 内置的 DSH 版本段一致，否则插件不会被加载。

### 7.2 注册到内置清单

在 `builtin-dsh-plugins/builtin-plugins.json` 的 `plugins` 数组追加：

```json
{
  "id": "quwork-mobile",
  "packageName": "quwork-mobile",
  "displayName": "QuWork 移动端",
  "delivery": "bundled",
  "visibleInPluginManagement": false
}
```

`delivery` 取 `bundled` 表示随客户端分发，不走 npm 远程拉取；`visibleInPluginManagement: false` 使其成为产品能力而非可选插件。若仍需在插件管理里可见，改为 `true`。

### 7.3 入口与打包

- `cordis.patch.yml` 中的 `id` 决定配置归属，`entryId` 决定 UI 入口标识，二者需与桌面端约定一致。
- 插件配置项 `initiallyEnabled: false` 建议改为 `true`，让移动端能力默认可用；`listenHost`、`listenPort`、`allowedCidrs`、`tls` 沿用，但端口需与 QuWork 其它服务核对，避免冲突。
- 打包时把插件产物整体放入 `packageRoot` 指向的目录，`scripts/check-companion-package.mjs` 的等价校验应在新仓库保留。

## 8 阶段五：多插件共存与冲突治理

### 8.1 当前冲突根因

同一 DSH profile 中同时存在四套移动相关插件：

```
bundles: dsh-plugin-tether, dsh-plugin-mobile-gateway, dsh-mobile, dsh-pocket
```

`dsh-pocket` 的抽屉遮罩判定依赖宿主属性：它取 `[data-shell-overlay]` 的父节点作为 frame，监听其 `data-sidebar-collapsed` 属性来决定 `open`。而 `dsh-mobile` 用 `.dshm-shell` 接管外框，并把 `data-sidebar-collapsed` 打在自己的 `aside` 抽屉上（`src/mobile-layout.ts` 约 965 行），因此 pocket 找到的 frame 永远没有该属性，判定恒为"抽屉已打开"，`rgba(0,0,0,.45)` 全屏遮罩常驻，表现为整页蒙灰。

### 8.2 治理原则：单一所有权

| 职责 | 唯一归属 | 说明 |
| --- | --- | --- |
| 网关（HTTPS / 监听 / 证书） | `dsh-mobile` 或 `mobile-gateway`，二选一 | 两者都监听端口会冲突，默认端口 `3443` |
| 传输（公网通道） | `dsh-plugin-tether` 或插件内置的 cloudflared / frp / iroh，二选一 | 出场只开局域网与 iroh，其余折叠进高级选项 |
| 移动端 UI 壳 | `dsh-mobile` | 不允许第二个插件接管 shell/DOM |

结论：QuWork 内置 `quwork-mobile` 后，必须从 profile 的 `bundles` 中移除 `dsh-pocket`，并明确 `dsh-plugin-tether`、`dsh-plugin-mobile-gateway` 是否保留。

### 8.3 启动自检（建议实现）

在插件客户端初始化、接管 DOM 之前加互斥检测，避免用户自行安装后再次踩坑：

```ts
// 已在别处存在移动导航壳时放弃接管，只记录一次提示
const conflictingShell = document.querySelector('[data-mobile-nav="frame"],[data-mobile-nav="backdrop"]')
if (conflictingShell !== null) {
  console.warn('[quwork-mobile] another mobile shell detected, skip takeover')
  return
}
```

同时给宿主的 `[data-shell-overlay]` 父节点补写 `data-sidebar-collapsed` 同步，可让遗留用户暂时共存（一行动手改动，但只作为过渡，不替代移除）。

### 8.4 用户侧修复动作

升级说明中必须写清楚：在 QuWork 插件管理里禁用 `dsh-pocket`，或从 `~/.qurwork-desktop-dsh/.dsh/profiles/web/package.json` 的 `dsh.bundle.bundles` 中删除该条目后重启。仅靠 `quwork-mobile` 内置无法自动清理用户既有 profile。

上游同名插件同理：`quwork-mobile` 与 `dsh-mobile` 是不同包名，装在一起时 profile 会同时保留两条 bundle 记录；上游那条的 `mobile-access`、`dsh-ui-fixes` 条目会占住同一个 patch id，让本插件的条目被丢弃（表现为移动访问整块消失）。迁移必须先移除上游 bundle 再安装本插件，这一步由 CI 的「migrating off the published 0.6.2 bundle」用例覆盖。

## 9 阶段六：发布流水线迁移

### 9.1 现有工作流

| 文件 | 触发 | 关键内容 |
| --- | --- | --- |
| `.github/workflows/android-release.yml` | tag `android-v*` | `check:android-release-tag`、Java 17、Rust 1.99.1 加 android 目标、API 36 与 NDK 25.2.9519653、keystore 解密、Gradle 打包与签名校验 |
| `.github/workflows/release.yml` | tag `v*` | `check:release-tag`、插件打包、npm 发布 |
| `.github/workflows/ci.yml` | push / PR | 类型检查、单测、Android 单测、文档校验 |
| `.github/workflows/caddy-component.yml` | 独立 tag | Caddy 组件分发 |

### 9.2 迁移要点

1. 目标仓库与 tag 前缀改为 QuWork 体系，例如 `mobile-v<ver>` 与 `mobile-android-v<ver>`。
2. 发布 secret 全部换新，禁止沿用上游密钥。
3. 产物上传至自有对象存储或 CDN，并回写 release 接口与 `apps/mobile/release.json`。
4. 保留 `npm run verify` 全链路：`check:version`、`check:docs`、`check:companion-package`、`check:funnel-licenses`、`check:mobile-release`、`typecheck`、`test`、`build`、`npm pack --dry-run`。
5. 保留签名校验步骤，防止误用错误 keystore 出包。
6. 若不再发布到公共 npm，删除 `release.yml` 中的发布步骤，改为上传私有 registry 或直接产出 tarball 供内置打包使用。

## 10 验收清单

按阶段逐项确认，未通过不进下一阶段。

| 阶段 | 验收项 | 判定方法 |
| --- | --- | --- |
| 一 | 插件列表、设置页、配对页无上游品牌残留 | 全局搜索 `DeepSeek Harness`、`DSH Mobile`、`saya-ch`，剩余项逐一说明 |
| 一 | 文案中英文成对 | 切换语言后人工核对主要页面 |
| 二 | 无任何请求发往上游域名 | 抓包或代理观察设置页刷新与更新按钮 |
| 二 | 离线时版本信息不报错 | 断网打开设置页，应展示内嵌版本 |
| 三 | 新旧包可共存、旧包数据不串 | 同时安装两包，分别配对 |
| 三 | 签名指纹固定且校验通过 | 运行签名校验脚本 |
| 四 | 首次启动即具备移动端入口 | 全新用户目录启动 QuWork |
| 五 | 手机端无全屏蒙灰 | 打开抽屉与关闭抽屉各验证一次，观察 `[data-mobile-nav="backdrop"]` 是否存在 |
| 五 | 端口无冲突 | `lsof -i :3443` 单一监听者 |
| 六 | 一条命令可复现发布 | CI 全绿后从干净环境出包 |

回归测试至少覆盖：`npm run typecheck`、`npm run test`、`npm run check:docs`、`npm run check:mobile-release`、`npm run smoke:mobile-settings`、`npm run smoke:layout-ownership`。

## 11 回滚与上游同步

### 11.1 回滚

- 品牌化改动集中在独立提交，按阶段打 tag，任意阶段可回退。
- Android 身份改造单独成 commit，与品牌化分离，便于在签名或包名出问题时只回退该部分。
- 已发布的 APK 不可撤回，因此签名与包名必须在首次发布前定稿。

### 11.2 上游同步节奏

建议每 2 至 4 周执行一次：

1. `git fetch upstream`
2. 在新分支上 `rebase` 到上游最新 tag
3. 冲突优先集中在 `src/brand.ts` 引用点与 `src/release-update.ts`
4. 同步后必须重跑第 10 节验收清单

控制冲突的关键是让品牌化改动尽量"薄"：所有替换都通过 `BRAND` 常量间接完成，而不是把文案直接写进业务文件。

## 12 风险登记

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 更换 `applicationId` 导致老用户状态丢失 | 需重新配对 | 首启引导 + 升级公告，不提供迁移 |
| 签名更换 | 无法覆盖安装 | 首次发布前定稿，密钥离线备份 |
| 上游新增功能与本地品牌化冲突 | 同步成本上升 | 品牌改动集中化，定期 rebase |
| 用户 profile 中仍残留 `dsh-pocket` | 蒙灰问题复现 | 内置插件启动自检 + 升级说明 |
| 端口 `3443` 被占用 | 网关起不来 | 启动时探测并回退端口，状态页展示实际端口 |
| 自动更新误连上游 | 用户被装回上游版本 | 第一阶段直接关闭更新能力 |
| Apache-2.0 合规缺失 | 法务风险 | 保留许可证与第三方声明，标注修改文件 |

## 13 建议排期

| 周 | 目标 | 交付物 |
| --- | --- | --- |
| 第 1 周 | 品牌常量、包名、App 身份、关闭上游更新 | 可安装、可配对、显示为 QuWork |
| 第 2 周 | 内置进 QuWork、移除 `dsh-pocket`、冲突自检 | 全新用户开箱即用，无蒙灰 |
| 第 3 周 | 自有发布接口、应用内更新、引导页文案 | 可对外分发 |
| 后续 | 账号打通、推送统一、免配对直连 | 体验对齐商业化产品 |
