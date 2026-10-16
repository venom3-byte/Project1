import type { SceneObject } from './types'

export type Orientation = 'auto' | 'landscape' | 'portrait'

export interface ExportSettings {
  appName: string
  appId: string
  orientation: Orientation
}

const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue',
  'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if',
  'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private',
  'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this',
  'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null',
])

/** Returns an error message, or null when the Android application id is valid. */
export function validateAppId(id: string): string | null {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(id)) {
    return 'Use lowercase letters, digits and underscores in at least two dot-separated parts, e.g. com.mystudio.mygame'
  }
  const bad = id.split('.').find((p) => JAVA_KEYWORDS.has(p))
  if (bad) return `"${bad}" is a reserved word and cannot be used in an app id`
  return null
}

export function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'game'
}

export function suggestAppId(name: string): string {
  const part = slug(name).replace(/-/g, '_').replace(/^[0-9_]+/, '') || 'game'
  return `com.example.${JAVA_KEYWORDS.has(part) ? `${part}_game` : part}`
}

/** Problems that would make the exported game confusing; the export still works. */
export function preflight(objects: SceneObject[]): string[] {
  const out: string[] = []
  const players = objects.filter((o) => o.behavior === 'player')
  if (players.length === 0) out.push('No object has the Player behavior, so nothing can be controlled.')
  if (players.length > 1) out.push('More than one Player object: only the first one is controlled.')
  if (!objects.some((o) => o.solid)) out.push('No solid objects: the player will fall forever. Mark a ground object as Solid.')
  if (!objects.some((o) => o.behavior === 'goal' || o.behavior === 'collectible')) {
    out.push('There is no goal or collectible, so the game has no way to be won.')
  }
  return out
}

async function fetchPlayer(): Promise<string> {
  const res = await fetch(new URL('/player/player.js', window.location.origin).toString(), { cache: 'no-cache' })
  if (!res.ok) throw new Error('Could not load the game player runtime.')
  const text = await res.text()
  if (text.length < 10000) throw new Error('The game player runtime looks incomplete.')
  return text
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export function buildHtml(name: string, objects: SceneObject[]): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>${escapeHtml(name)}</title>
<style>html,body{margin:0;height:100%;background:#1b2130;overflow:hidden;-webkit-user-select:none;user-select:none}</style>
</head>
<body>
<div id="game"></div>
<script id="game-scene" type="application/json">${safeJson({ name, objects })}</script>
<script src="player.js"></script>
</body>
</html>
`
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export async function exportWebZip(name: string, objects: SceneObject[]): Promise<Blob> {
  const [{ default: JSZip }, player] = await Promise.all([import('jszip'), fetchPlayer()])
  const zip = new JSZip()
  zip.file('index.html', buildHtml(name, objects))
  zip.file('player.js', player)
  zip.file(
    'README.txt',
    'Open index.html through any static web server (or upload this folder to a static host) to play the game.\n',
  )
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

function workflowYaml(orientation: Orientation): string {
  const orient =
    orientation === 'auto'
      ? ''
      : `      - name: Lock screen orientation
        run: |
          sed -i 's|<activity|<activity android:screenOrientation="${orientation}"|' android/app/src/main/AndroidManifest.xml
          grep -q 'screenOrientation="${orientation}"' android/app/src/main/AndroidManifest.xml
`
  return `name: Build Android APK

on:
  push:
    branches: [main, master]
  workflow_dispatch:

jobs:
  apk:
    runs-on: ubuntu-latest
    timeout-minutes: 40
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21

      - uses: android-actions/setup-android@v3

      - name: Install dependencies
        run: npm install

      - name: Create the Android project
        run: |
          rm -rf android
          npx cap add android
          npx cap sync android

${orient}      - name: Build debug APK
        working-directory: android
        run: |
          chmod +x gradlew
          ./gradlew assembleDebug --no-daemon

      - name: Upload APK
        uses: actions/upload-artifact@v4
        with:
          name: game-apk
          path: android/app/build/outputs/apk/debug/app-debug.apk
          if-no-files-found: error
`
}

function readme(s: ExportSettings): string {
  return `${s.appName} - Android project
====================================

This folder builds a real Android APK in the cloud for free. You do not need Android Studio.

1. Create a new repository on github.com (private is fine).
2. Upload every file in this folder to it (drag and drop in the GitHub web page works).
   Make sure the hidden folder ".github" is uploaded too.
3. Open the repository's "Actions" tab. The "Build Android APK" workflow starts automatically
   (or press "Run workflow"). It takes about 5-10 minutes.
4. When it turns green, open the run and download the "game-apk" artifact. Unzip it to get app-debug.apk.
5. Copy app-debug.apk to your phone and install it (allow "install unknown apps" when asked).

Notes
- app id: ${s.appId}
- This is a debug-signed APK: perfect for testing and sharing. Publishing on Google Play needs a
  release-signed Android App Bundle with your own keystore.
- Toolchain: Capacitor 8, Node 22, JDK 21, Android SDK 36.

----

الخطوات بالعربية:
1. أنشئ مستودعاً جديداً على github.com.
2. ارفع كل ملفات هذا المجلد إليه (ومنها المجلد المخفي .github).
3. افتح تبويب Actions وانتظر انتهاء البناء (5 إلى 10 دقائق).
4. نزّل الملف game-apk من نتيجة التشغيل وفك ضغطه لتحصل على app-debug.apk.
5. انقله إلى هاتفك وثبّته.
`
}

export async function exportAndroidZip(objects: SceneObject[], settings: ExportSettings): Promise<Blob> {
  const idError = validateAppId(settings.appId)
  if (idError) throw new Error(idError)
  const name = settings.appName.trim() || 'Game'
  const [{ default: JSZip }, player] = await Promise.all([import('jszip'), fetchPlayer()])
  const zip = new JSZip()

  zip.file('www/index.html', buildHtml(name, objects))
  zip.file('www/player.js', player)

  zip.file(
    'package.json',
    JSON.stringify(
      {
        name: slug(name),
        version: '1.0.0',
        private: true,
        dependencies: {
          '@capacitor/android': '^8.0.0',
          '@capacitor/core': '^8.0.0',
        },
        devDependencies: {
          '@capacitor/cli': '^8.0.0',
        },
      },
      null,
      2,
    ) + '\n',
  )

  zip.file(
    'capacitor.config.json',
    JSON.stringify(
      {
        appId: settings.appId,
        appName: name,
        webDir: 'www',
        backgroundColor: '#1b2130',
        server: { androidScheme: 'https' },
      },
      null,
      2,
    ) + '\n',
  )

  zip.file('.github/workflows/build-apk.yml', workflowYaml(settings.orientation))
  zip.file('.gitignore', 'node_modules/\nandroid/\n')
  zip.file('README.md', readme({ ...settings, appName: name }))

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}
