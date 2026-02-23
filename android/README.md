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

For local testing you can also build debug:

```bash
./gradlew assembleDebug
```

Copy the built APK to website downloads from repo root:

```bash
npm run prepare:downloads -- --apk android/app/build/outputs/apk/release/app-release.apk
```
