# Android build setup and local packaging

[简体中文](ANDROID_BUILD.md) · [Android app manual](../apps/mobile/README.md#build) · [Contributing](../CONTRIBUTING.md)

This guide lists what a local APK build needs, how to run it, and how a local artifact differs from what the [Android Release](../.github/workflows/android-release.yml) workflow produces. CI is the publication authority; local builds are for self-testing and diagnosis.

## Three build lanes

| Lane | Gradle task | Rust and NDK | Signing | Result |
| --- | --- | --- | --- | --- |
| Debug | `assembleDebug -PirohNative=false` | Not needed | Automatic debug key | `app-debug.apk`, package `io.github.sayach.dshmobile.debug`, installs beside the official App |
| Compatibility Release | `assembleRelease -PirohNative=false` | Not needed | Needs a keystore, otherwise no installable package | Matches `quwork-android-v<version>.apk`, no JNI libraries, covers 32-bit devices |
| Full Release | `assembleRelease -PirohNative=true -PirohNdk=<ndk>` | Required | Same | Matches `quwork-android-v<version>-iroh.apk`, arm64-v8a / x86_64 only |

Use the Debug lane to see the interface on a phone: it is the only path that needs neither Rust, NDK nor a keystore.

## Toolchain

Keep these versions equal to [Android Release](../.github/workflows/android-release.yml); drift changes local behaviour against the published build.

| Component | Version | Purpose |
| --- | --- | --- |
| JDK | 17 (Temurin) | Gradle and AGP compilation |
| Node.js | 24.x | Runs the `scripts/` checks |
| Android SDK Platform | android-36 | Compile target |
| Build-Tools | 36.0.0 | aapt2 and apksigner |
| NDK | 25.2.9519653 | Cross-compiles the iroh native libraries |
| Rust | 1.99.1 with `aarch64-linux-android` and `x86_64-linux-android` | Builds the iroh transport |
| Gradle | 9.8.2 | Shipped by the repository Wrapper; install nothing |
| Go | 1.26.6 | Only for the funnel component and the plugin package, not the APK |
| keystore | The key held in the repository Secrets | Required for official signing only |

## Install

macOS:

```sh
brew install --cask temurin@17
echo "sdk.dir=$HOME/Library/Android/sdk" > apps/mobile/android/local.properties

sdkmanager "platforms;android-36" "build-tools;36.0.0" "ndk;25.2.9519653"

rustup toolchain install 1.99.1
rustup target add --toolchain 1.99.1 aarch64-linux-android x86_64-linux-android
```

Linux uses the distribution's Temurin 17 packages and installs the same SDK packages through `sdkmanager` from the command-line tools. The Windows PowerShell form lives in the [app manual build section](../apps/mobile/README.md#build). Either `local.properties` or `ANDROID_HOME` must let Gradle find the SDK; `local.properties` is not committed.

## Build

Both Release lanes write the same `app-release.apk`, so build the full variant, copy it away, and only then build the compatibility variant. Otherwise the second build overwrites the first.

```sh
cd apps/mobile/android

# Full variant with iroh
./gradlew assembleRelease -PirohNative=true -PirohNdk="$HOME/Library/Android/sdk/ndk/25.2.9519653"
cp app/build/outputs/apk/release/app-release.apk ~/quwork-android-v0.7.5-iroh.apk

# Compatibility variant without native libraries
./gradlew assembleRelease -PirohNative=false
cp app/build/outputs/apk/release/app-release.apk ~/quwork-android-v0.7.5.apk
```

The release workflow also runs `lintDebug testDebugUnitTest` before packaging. Do the same before committing, skipping the two analysis tasks that only matter in CI:

```sh
./gradlew lintDebug testDebugUnitTest assembleRelease -PirohNative=false \
  -x lintAnalyzeDebugUnitTest -x lintAnalyzeDebugAndroidTest
```

## Local signing

Without a keystore the build is not officially signed and can only be self-tested; it cannot replace any installed official App. Reproducing the release signature requires exporting the `.jks` from the repository Secrets and setting four variables:

```sh
export DSH_ANDROID_KEYSTORE_FILE="$HOME/.android/dsh-mobile-release.jks"
export DSH_ANDROID_KEYSTORE_PASSWORD=...
export DSH_ANDROID_KEY_ALIAS=...
export DSH_ANDROID_KEY_PASSWORD=...
```

Android only replaces an install signed by the same signer. From 0.7.5 this repository's official builds carry the QuWork key, which differs from the upstream project's key, so a device with the upstream App has to uninstall it first. Do not clear a user's data to work around a signing mismatch.

## Verify the artifacts

```sh
node scripts/build-android-transport.mjs --verify-apk ~/quwork-android-v0.7.5.apk \
  --variant compatibility --build-tools "$HOME/Library/Android/sdk/build-tools/36.0.0"

apksigner verify --verbose --print-certs ~/quwork-android-v0.7.5.apk
shasum -a 256 ~/quwork-android-v0.7.5*.apk
```

The verifier checks ABIs, leftover JNI libraries, the TLS verifier classes and manifest entries; the compatibility build must contain no native library. Publication also caps each APK at 40 MB. Record runtime dependencies with:

```sh
./gradlew :app:dependencies --configuration releaseRuntimeClasspath -PirohNative=false
```

## Mapping to the workflow

| Workflow step | Local equivalent |
| --- | --- |
| `check:android-release-tag` | `GITHUB_REF_NAME=android-v<version> npm run check:android-release-tag` |
| Installing JDK, SDK, NDK and Rust | The "Install" section of this page |
| Writing the keystore | The four variables in "Local signing" |
| `lintDebug testDebugUnitTest assembleRelease` | Both commands above, full variant first |
| `--verify-apk`, `apksigner`, size and dependency checks | The "Verify the artifacts" section |
| `gh release create` | No local equivalent: publication runs in the workflow after maintainer authorisation |

A local machine reproduces the compilation, not the publication: the Secrets-held signing key, the clean disposable environment and the workflow's independent checks of both APKs cannot be reproduced locally. A local artifact is self-test evidence, never release evidence.

## Platform differences

CI installs everything from scratch on every run while a local machine reuses caches, so versions drift more easily. When a build misbehaves, compare `./gradlew --version` and `java -version` against the table above.

Running the repository's `npm test` on macOS also produces platform-only failures unrelated to the Android build: UDP discovery returns `EADDRNOTAVAIL` when the configured broadcast target belongs to an absent network, the cpolar component only exists on win32, and iroh has no local artifact on darwin. Those tests are written for Linux semantics; the ubuntu CI result decides.
