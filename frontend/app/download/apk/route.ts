import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const APK_FILE_NAME = 'app-release.apk';
const LEGACY_APK_FILE_NAME = 'Connzect-latest.apk';
const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';
const DEFAULT_RELEASE_APK_URL = 'https://github.com/Psiclone-DL/Connzect/releases/latest/download/app-release.apk';

type ResolvedLocalApk = {
  filePath: string;
  downloadName: string;
};

const normalizeReleaseApkUrl = (url: string): string => {
  return url.replace('/Connzect-latest.apk', '/app-release.apk');
};

const resolveLocalApkPath = async (): Promise<ResolvedLocalApk | null> => {
  const candidates = [
    {
      filePath: path.join(process.cwd(), 'public', 'downloads', APK_FILE_NAME),
      downloadName: APK_FILE_NAME
    },
    {
      filePath: path.join(process.cwd(), 'frontend', 'public', 'downloads', APK_FILE_NAME),
      downloadName: APK_FILE_NAME
    },
    {
      filePath: path.join(process.cwd(), 'public', 'downloads', LEGACY_APK_FILE_NAME),
      downloadName: LEGACY_APK_FILE_NAME
    },
    {
      filePath: path.join(process.cwd(), 'frontend', 'public', 'downloads', LEGACY_APK_FILE_NAME),
      downloadName: LEGACY_APK_FILE_NAME
    }
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate.filePath);
      return candidate;
    } catch {
      // Continue searching candidate paths.
    }
  }

  return null;
};

export async function GET() {
  const redirectUrl = process.env.CONNZECT_ANDROID_APK_URL?.trim();
  if (redirectUrl) {
    return NextResponse.redirect(normalizeReleaseApkUrl(redirectUrl));
  }

  const localApk = await resolveLocalApkPath();
  if (!localApk) {
    return NextResponse.redirect(DEFAULT_RELEASE_APK_URL);
  }

  try {
    const file = await fs.readFile(localApk.filePath);
    return new NextResponse(file, {
      status: 200,
      headers: {
        'Content-Type': APK_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${localApk.downloadName}"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch {
    return NextResponse.redirect(DEFAULT_RELEASE_APK_URL);
  }
}
