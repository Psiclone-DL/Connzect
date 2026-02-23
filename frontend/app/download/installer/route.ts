import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const INSTALLER_FILE_NAME = 'Connzect-Setup-latest.exe';
const INSTALLER_CONTENT_TYPE = 'application/vnd.microsoft.portable-executable';
const DOWNLOADS_PATH_SEGMENT = path.join('downloads', INSTALLER_FILE_NAME);
const DEFAULT_RELEASE_INSTALLER_URL =
  'https://github.com/Psiclone-DL/Connzect/releases/latest/download/Connzect-Setup-latest.exe';

const resolveLocalInstallerPath = async (): Promise<string | null> => {
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
  const redirectUrl = process.env.CONNZECT_DESKTOP_INSTALLER_URL;
  if (redirectUrl) {
    return NextResponse.redirect(redirectUrl);
  }

  const localFilePath = await resolveLocalInstallerPath();
  if (!localFilePath) {
    return NextResponse.redirect(DEFAULT_RELEASE_INSTALLER_URL);
  }

  try {
    const file = await fs.readFile(localFilePath);
    return new NextResponse(file, {
      status: 200,
      headers: {
        'Content-Type': INSTALLER_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${INSTALLER_FILE_NAME}"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch {
    return NextResponse.redirect(DEFAULT_RELEASE_INSTALLER_URL);
  }
}
