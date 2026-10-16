import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildHtml,
  exportAndroidZip,
  exportWebZip,
  preflight,
  slug,
  suggestAppId,
  validateAppId,
} from '../src/editor/exporter'
import { makeObject, starterScene } from '../src/editor/starter'

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as ArrayBuffer)
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(blob)
  })
}

async function unzip(blob: Blob) {
  return JSZip.loadAsync(await readBlob(blob))
}

describe('validateAppId', () => {
  it('accepts valid ids', () => {
    expect(validateAppId('com.example.mygame')).toBeNull()
    expect(validateAppId('com.studio_name.game2')).toBeNull()
  })

  it('rejects invalid ids', () => {
    expect(validateAppId('mygame')).not.toBeNull()
    expect(validateAppId('Com.Example.Game')).not.toBeNull()
    expect(validateAppId('com.example.2fast')).not.toBeNull()
    expect(validateAppId('com.example.new')).not.toBeNull()
    expect(validateAppId('com..game')).not.toBeNull()
    expect(validateAppId('')).not.toBeNull()
  })

  it('always suggests a valid id', () => {
    for (const name of ['My Game', '123 Runner', 'Class', 'مشروع', '  ', 'A!!B', 'new']) {
      expect(validateAppId(suggestAppId(name))).toBeNull()
    }
  })
})

describe('slug', () => {
  it('makes safe file names', () => {
    expect(slug('My Cool Game!')).toBe('my-cool-game')
    expect(slug('مشروع')).toBe('game')
  })
})

describe('buildHtml', () => {
  it('embeds the scene and cannot be broken by script-closing text', () => {
    const objects = [makeObject('box', { name: '</script><script>alert(1)</script>' })]
    const html = buildHtml('A & B "game"', objects)
    expect(html.match(/<\/script>/g)?.length).toBe(2)
    expect(html).toContain('<title>A &amp; B &quot;game&quot;</title>')
    const json = html.split('type="application/json">')[1].split('</script>')[0]
    const parsed = JSON.parse(json) as { objects: { name: string }[] }
    expect(parsed.objects[0].name).toBe('</script><script>alert(1)</script>')
  })
})

describe('preflight', () => {
  it('is quiet for the starter scene', () => {
    expect(preflight(starterScene())).toEqual([])
  })

  it('warns about missing player, ground and goal', () => {
    expect(preflight([makeObject('box')]).length).toBe(3)
  })
})

describe('exports', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => `/*player*/${'x'.repeat(20000)}` }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a web build', async () => {
    const zip = await unzip(await exportWebZip('Test', starterScene()))
    expect(Object.keys(zip.files).sort()).toEqual(['README.txt', 'index.html', 'player.js'])
    const html = await zip.file('index.html')!.async('string')
    expect(html).toContain('game-scene')
    expect(html).toContain('<script src="player.js">')
  })

  it('creates an Android project that builds an APK in GitHub Actions', async () => {
    const blob = await exportAndroidZip(starterScene(), {
      appName: 'Sky Runner',
      appId: 'com.example.skyrunner',
      orientation: 'landscape',
    })
    const zip = await unzip(blob)
    const names = Object.keys(zip.files)
    for (const f of ['package.json', 'capacitor.config.json', 'README.md', 'www/index.html', 'www/player.js', '.github/workflows/build-apk.yml']) {
      expect(names).toContain(f)
    }

    const cap = JSON.parse(await zip.file('capacitor.config.json')!.async('string')) as {
      appId: string
      appName: string
      webDir: string
    }
    expect(cap).toMatchObject({ appId: 'com.example.skyrunner', appName: 'Sky Runner', webDir: 'www' })

    const pkg = JSON.parse(await zip.file('package.json')!.async('string')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(pkg.dependencies['@capacitor/android']).toBe('^8.0.0')
    expect(pkg.dependencies['@capacitor/core']).toBe('^8.0.0')
    expect(pkg.devDependencies['@capacitor/cli']).toBe('^8.0.0')

    const yml = await zip.file('.github/workflows/build-apk.yml')!.async('string')
    expect(yml).toContain('node-version: 22')
    expect(yml).toContain('java-version: 21')
    expect(yml).toContain('android-actions/setup-android@v3')
    expect(yml).toContain('npx cap add android')
    expect(yml).toContain('./gradlew assembleDebug')
    expect(yml).toContain('screenOrientation="landscape"')
    expect(yml).toContain('if-no-files-found: error')
    // every step in the workflow starts at the same indentation
    const steps = yml.split('\n').filter((l) => /^ +- (uses|name):/.test(l))
    expect(new Set(steps.map((l) => l.search(/\S/))).size).toBe(1)
  })

  it('omits the orientation step when following the device', async () => {
    const zip = await unzip(
      await exportAndroidZip(starterScene(), { appName: 'G', appId: 'com.example.g', orientation: 'auto' }),
    )
    const yml = await zip.file('.github/workflows/build-apk.yml')!.async('string')
    expect(yml).not.toContain('screenOrientation')
  })

  it('refuses an invalid app id', async () => {
    await expect(
      exportAndroidZip(starterScene(), { appName: 'G', appId: 'bad id', orientation: 'auto' }),
    ).rejects.toThrow()
  })

  it('fails clearly when the player runtime cannot be loaded', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, text: async () => '' }))
    await expect(exportWebZip('G', starterScene())).rejects.toThrow(/player/i)
  })
})
