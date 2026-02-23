import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const APK_FILE_NAME = 'Connzect-latest.apk';
const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';
const DOWNLOADS_PATH_SEGMENT = path.join('downloads', APK_FILE_NAME);
const DEFAULT_RELEASE_APK_URL = 'https://github.com/Psiclone-DL/Connzect/releases/latest/download/Connzect-latest.apk';

const resolveLocalApkPath = async (): Promise<string | null> => {
  const candidates = [
    path.join(process.cwd(), 'public', DOWNLOADS_PATH_SEGMENT),
    path.join(process.cwd(), 'frontend', 'public', DOWNLOADS_PATH_SEGMENT)
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Continue searching candidate paths.
    }
  }

  return null;
};

export async function GET() {
  const redirectUrl = process.env.CONNZECT_ANDROID_APK_URL;
  if (redirectUrl) {
    return NextResponse.redirect(redirectUrl);
  }

  const localFilePath = await resolveLocalApkPath();
  if (!localFilePath) {
    return NextResponse.redirect(DEFAULT_RELEASE_APK_URL);
  }

  try {
    const file = await fs.readFile(localFilePath);
    return new NextResponse(file, {
      status: 200,
      headers: {
        'Content-Type': APK_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${APK_FILE_NAME}"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch {
    return NextResponse.redirect(DEFAULT_RELEASE_APK_URL);
  }
}
