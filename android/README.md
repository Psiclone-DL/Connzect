# Connzect Android APK

This folder contains a native Android WebView wrapper for Connzect.

## Configure target web URL

Default URL is `http://5.75.169.93:3002`.

To override it at build time:

```bash
./gradlew assembleRelease -PCONNZECT_WEB_URL=https://your-domain.example
```

## Build APK

1. Open `android/` in Android Studio (recommended) and let it install the required SDK/Gradle tooling.
2. Build APK from Android Studio:
   - `Build > Build Bundle(s) / APK(s) > Build APK(s)`
3. Optional terminal build (after Gradle wrapper is available in `android/`):

```bash
./gradlew assembleRelease
```

Output:

- `android/app/build/outputs/apk/release/app-release.apk`

## Signed release APK (required for install)

Unsigned APKs are often rejected by Android with messages like "package appears to be invalid".

For release install builds, configure signing in CI via GitHub repo secrets:

- `ANDROID_KEYSTORE_BASE64`: base64 of your `.jks` keystore file
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Alternative naming supported:

- `ANDROIDAPP` (same as `ANDROID_KEYSTORE_BASE64`)
- `ANDROIDAPP_KEYSTORE_PASSWORD`
- `ANDROIDAPP_KEY_ALIAS`
- `ANDROIDAPP_KEY_PASSWORD`

If no keystore base64 secret is valid, CI generates a managed keystore automatically, validates it, and caches it for future runs.

The workflow `Android APK Release Asset` now:

1. Decodes keystore from secrets
2. Builds a signed `assembleRelease` APK
3. Verifies signature with `apksigner verify`
4. Uploads to GitHub Release as `Connzect-latest.apk`

For local testing you can also build debug:

```bash
./gradlew assembleDebug
```

Copy the built APK to website downloads from repo root:

```bash
npm run prepare:downloads -- --apk android/app/build/outputs/apk/release/app-release.apk
```
