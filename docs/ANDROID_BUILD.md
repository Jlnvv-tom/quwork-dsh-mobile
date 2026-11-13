# Android 构建环境与本地打包

[English](ANDROID_BUILD.en.md) · [App 手册](../apps/mobile/README.zh-CN.md) · [贡献指南](../CONTRIBUTING.md)

这篇指南说明在本地生成 APK 需要安装什么、命令怎么写，以及本地产物与 [Android Release](../.github/workflows/android-release.yml) 流水线产物的差别。CI 才是发布依据；本机构建用于自测和排查。

## 三档构建

| 档位 | Gradle 任务 | Rust 与 NDK | 签名 | 结果 |
| --- | --- | --- | --- | --- |
| Debug | `assembleDebug -PirohNative=false` | 不需要 | 自动 debug key | `app-debug.apk`，包名 `io.github.sayach.dshmobile.debug`，与正式版并存 |
| 兼容 Release | `assembleRelease -PirohNative=false` | 不需要 | 需要 keystore，否则不产出可安装包 | 对应发布里的 `quwork-android-v<版本>.apk`，无 JNI 库，覆盖 32 位设备 |
| 完整 Release | `assembleRelease -PirohNative=true -PirohNdk=<ndk>` | 需要 | 同上 | 对应 `quwork-android-v<版本>-iroh.apk`，仅 arm64-v8a / x86_64 |

只想在手机上看到界面时用 Debug 档，它是唯一不需要 Rust、NDK 和 keystore 的路径。

## 环境清单

版本与 [Android Release](../.github/workflows/android-release.yml) 保持一致，漂移会导致本地与发布产物行为不同。

| 组件 | 版本 | 用途 |
| --- | --- | --- |
| JDK | 17（Temurin） | Gradle 与 AGP 编译 |
| Node.js | 24.x | 运行 `scripts/` 下的校验脚本 |
| Android SDK Platform | android-36 | 编译目标 |
| Build-Tools | 36.0.0 | aapt2、apksigner |
| NDK | 25.2.9519653 | iroh 原生库交叉编译 |
| Rust | 1.99.1，附 `aarch64-linux-android`、`x86_64-linux-android` | 构建 iroh 传输层 |
| Gradle | 9.8.2 | 仓库自带 Wrapper，无需单独安装 |
| Go | 1.26.6 | 仅构建 funnel 组件与插件包时需要，不参与 APK |
| keystore | 仓库 Secrets 中的那把 key | 只有正式签名需要 |

## 安装

macOS：

```sh
brew install --cask temurin@17
echo "sdk.dir=$HOME/Library/Android/sdk" > apps/mobile/android/local.properties

sdkmanager "platforms;android-36" "build-tools;36.0.0" "ndk;25.2.9519653"

rustup toolchain install 1.99.1
rustup target add --toolchain 1.99.1 aarch64-linux-android x86_64-linux-android
```

Linux 用发行版的 Temurin 17 包，SDK 通过 command-line tools 的 `sdkmanager` 安装同一组包。Windows 的 PowerShell 写法见 [App 手册的构建章节](../apps/mobile/README.md#build)。`local.properties` 与 `ANDROID_HOME` 任一能让 Gradle 找到 SDK 即可；`local.properties` 不入库。

## 构建

两次 Release 构建输出同一个 `app-release.apk`，因此**先构建完整版并拷走，再构建兼容版**，否则兼容版会覆盖完整版。

```sh
cd apps/mobile/android

# 完整版（含 iroh）
./gradlew assembleRelease -PirohNative=true -PirohNdk="$HOME/Library/Android/sdk/ndk/25.2.9519653"
cp app/build/outputs/apk/release/app-release.apk ~/quwork-android-v0.7.5-iroh.apk

# 兼容版（无原生库）
./gradlew assembleRelease -PirohNative=false
cp app/build/outputs/apk/release/app-release.apk ~/quwork-android-v0.7.5.apk
```

发布流水线在 Release 构建前还跑 `lintDebug testDebugUnitTest`；提交前建议照做，并跳过两条只在 CI 有意义的分析任务：

```sh
./gradlew lintDebug testDebugUnitTest assembleRelease -PirohNative=false \
  -x lintAnalyzeDebugUnitTest -x lintAnalyzeDebugAndroidTest
```

## 本地签名

不提供 keystore 时得到的是非正式签名的包，只能自测，不能覆盖任何已安装的正式版。要用同一把 key 复现发布签名，需要从仓库 Secrets 导出 `.jks` 并设置四个变量：

```sh
export DSH_ANDROID_KEYSTORE_FILE="$HOME/.android/dsh-mobile-release.jks"
export DSH_ANDROID_KEYSTORE_PASSWORD=...
export DSH_ANDROID_KEY_ALIAS=...
export DSH_ANDROID_KEY_PASSWORD=...
```

Android 只接受同一 signer 的覆盖安装。从 0.7.5 起本仓库的正式包由 QuWork 的 key 签名，与上游项目的 key 不同，因此装有上游 App 的设备必须先卸载；不要为了绕过签名不匹配而清除用户数据。

## 验证产物

```sh
node scripts/build-android-transport.mjs --verify-apk ~/quwork-android-v0.7.5.apk \
  --variant compatibility --build-tools "$HOME/Library/Android/sdk/build-tools/36.0.0"

apksigner verify --verbose --print-certs ~/quwork-android-v0.7.5.apk
shasum -a 256 ~/quwork-android-v0.7.5*.apk
```

校验脚本检查 ABI、JNI 库残留、TLS 校验类和清单条目；兼容版必须不含原生库。发布还要求每个 APK 不超过 40 MB。需要依赖清单时运行：

```sh
./gradlew :app:dependencies --configuration releaseRuntimeClasspath -PirohNative=false
```

## 与流水线的对应

| 流水线步骤 | 本地等价 |
| --- | --- |
| `check:android-release-tag` | `GITHUB_REF_NAME=android-v<版本> npm run check:android-release-tag` |
| 安装 JDK / SDK / NDK / Rust | 本页「安装」一节 |
| 写入 keystore | 本页「本地签名」四个变量 |
| `lintDebug testDebugUnitTest assembleRelease` | 本节两条命令，先完整后兼容 |
| `--verify-apk`、`apksigner`、体积与依赖清单 | 本页「验证产物」|
| `gh release create` | 无本地等价：发布只在维护者授权后由流水线执行 |

本机能复现编译过程，但复现不了发布的事实依据：Secrets 里的签名、干净的一次性环境、以及流水线对两个 APK 的独立校验。因此本地产物可以作为自测证据，不能当作发布证据。

## 平台差异

CI 每次都从零安装环境，本地复用缓存，版本更容易漂移；构建异常时先用 `./gradlew --version` 和 `java -version` 对照上表。

在 macOS 上跑仓库的 `npm test` 会有与 Android 构建无关的平台差异失败：UDP 广播发现向不存在的网段发送会返回 `EADDRNOTAVAIL`，cpolar 组件只在 win32 可用，iroh 在 darwin 没有本地产物。这些是测试按 Linux 语义写成造成的，CI 的 ubuntu 结果才是判定依据。
