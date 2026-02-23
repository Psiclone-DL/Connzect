Place downloadable binaries here when you want local file serving instead of redirect URLs:

- app-release.apk (preferred)
- Connzect-latest.apk (legacy fallback)
- Connzect-Setup-latest.exe

Homepage buttons download from:

- /download/apk
- /download/installer

If environment variables are set, these routes redirect instead:

- CONNZECT_ANDROID_APK_URL
- CONNZECT_DESKTOP_INSTALLER_URL

You can auto-copy artifacts here from repo root:

```bash
npm run prepare:downloads
```
