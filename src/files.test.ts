import { describe, expect, it, vi } from 'vitest'
import {
  changedOnDisk,
  checkFolder,
  classifyName,
  filesToCheck,
  designspaceSources,
  fromProjectFolder,
  InputError,
  normalizeRelative,
  shouldSkip,
  type Folder,
} from './files'

describe('classifyName', () => {
  it('recognises UFO folders and archives', () => {
    expect(classifyName('Font-Regular.ufo')).toBe('folder')
    expect(classifyName('Font-Regular.UFOZ')).toBe('ufoz')
    expect(classifyName('Font.designspace')).toBeNull()
    expect(classifyName('Font.glyphs')).toBeNull()
  })
})

describe('shouldSkip', () => {
  it('skips hidden files only', () => {
    expect(shouldSkip('images/a.png')).toBe(false)
    expect(shouldSkip('data/com.x/file')).toBe(false)
    expect(shouldSkip('.DS_Store')).toBe(true)
    expect(shouldSkip('glyphs/.hidden')).toBe(true)
    expect(shouldSkip('glyphs/A_.glif')).toBe(false)
    expect(shouldSkip('glyphs.background/data.glif')).toBe(false)
    expect(shouldSkip('kerning.plist')).toBe(false)
  })
})

describe('checkFolder', () => {
  it('requires metainfo.plist at the root', () => {
    expect(() => checkFolder('A.ufo', ['metainfo.plist', 'glyphs/A_.glif'])).not.toThrow()
    expect(() => checkFolder('A.ufo', ['glyphs/metainfo.plist'])).toThrow(InputError)
  })
})

describe('designspaceSources', () => {
  it('lists source UFOs in order, once, with entities decoded', () => {
    const xml = `<designspace format="5.0"><sources>
      <source filename="A.ufo" name="a"><location/></source>
      <source name='b' filename='masters/B&amp;C.ufo'/>
      <source filename="A.ufo" layer="support"/>
      <source name="no file"/>
    </sources></designspace>`
    expect(designspaceSources(xml)).toEqual(['A.ufo', 'masters/B&C.ufo'])
  })
})

describe('normalizeRelative', () => {
  it('resolves dots and refuses paths leaving the root', () => {
    expect(normalizeRelative('A.ufo')).toBe('A.ufo')
    expect(normalizeRelative('./m/../A.ufo/')).toBe('A.ufo')
    expect(normalizeRelative('m\\A.ufo')).toBe('m/A.ufo')
    expect(normalizeRelative('../A.ufo')).toBeNull()
    expect(normalizeRelative('/abs/A.ufo')).toBeNull()
    expect(normalizeRelative('C:/A.ufo')).toBeNull()
  })
})

/** An in-memory folder tree: nested objects are folders, strings are file contents. */
type Tree = { [name: string]: Tree | string }

function fakeFolder(name: string, tree: Tree, reads: string[], path = name): Folder {
  return {
    name,
    list: async () =>
      Object.entries(tree).map(([n, v]) =>
        typeof v === 'string'
          ? { kind: 'file' as const, name: n, file: async () => (reads.push(`${path}/${n}`), new File([v], n)) }
          : { kind: 'directory' as const, name: n, folder: fakeFolder(n, v, reads, `${path}/${n}`) },
      ),
    sub: async (rel) => {
      let node: Tree | string = tree
      for (const part of rel.split('/')) {
        if (typeof node === 'string' || !(part in node)) throw new Error('NotFound')
        node = node[part]
      }
      if (typeof node === 'string') throw new Error('NotADirectory')
      return fakeFolder(rel.split('/').pop()!, node, reads, `${path}/${rel}`)
    },
  }
}

const UFO: Tree = { 'metainfo.plist': 'm', 'groups.plist': 'g', glyphs: { 'A_.glif': 'a' }, '.DS_Store': 'x' }
const DS = (...files: string[]) => `<designspace><sources>${files.map((f) => `<source filename="${f}"/>`).join('')}</sources></designspace>`

describe('fromProjectFolder', () => {
  it('asks which designspace and reads only its masters', async () => {
    const reads: string[] = []
    const project = fakeFolder('P', { 'a.designspace': DS('A.ufo'), 'b.designspace': DS('B.ufo'), 'A.ufo': UFO, 'B.ufo': UFO, logs: { big: 'x' } }, reads)
    const choose = vi.fn(async () => 'b.designspace')
    const got = await fromProjectFolder(project, choose, Promise.resolve(null))
    expect(choose).toHaveBeenCalledWith(['a.designspace', 'b.designspace'])
    expect(got!.input.main).toBe('P/b.designspace')
    expect(got!.input.files.map((f) => f.path).sort()).toEqual([
      'P/B.ufo/glyphs/A_.glif',
      'P/B.ufo/groups.plist',
      'P/B.ufo/metainfo.plist',
      'P/b.designspace',
    ])
    expect(reads.some((r) => r.includes('A.ufo') || r.includes('logs'))).toBe(false)
  })

  it('cancelled choice opens nothing', async () => {
    const project = fakeFolder('P', { 'a.designspace': DS('A.ufo'), 'b.designspace': DS('A.ufo'), 'A.ufo': UFO }, [])
    expect(await fromProjectFolder(project, async () => null, Promise.resolve(null))).toBeNull()
  })

  it('refuses missing, outside and non-UFO sources', async () => {
    const open = (tree: Tree) => fromProjectFolder(fakeFolder('P', tree, []), async () => null, Promise.resolve(null))
    await expect(open({ 'a.designspace': DS('Missing.ufo') })).rejects.toThrow(/not found in P/)
    await expect(open({ 'a.designspace': DS('../A.ufo') })).rejects.toThrow(/outside this folder/)
    await expect(open({ 'a.designspace': DS('A.ufo'), 'A.ufo': { 'groups.plist': 'g' } })).rejects.toThrow(InputError)
    await expect(open({ 'readme.txt': 'x' })).rejects.toThrow(/no .designspace/)
  })
})

const enc = (t: string) => new TextEncoder().encode(t).buffer as ArrayBuffer
const stored = (paths: Record<string, string>) => Object.entries(paths).map(([path, t]) => ({ path, bytes: enc(t) }))

/** A FileSystemDirectoryHandle stand-in over a nested object of strings. */
function fakeHandle(name: string, tree: Tree): FileSystemDirectoryHandle {
  const notFound = () => new DOMException('missing', 'NotFoundError')
  return {
    name,
    kind: 'directory',
    getDirectoryHandle: async (n: string) => {
      const v = tree[n]
      if (v === undefined || typeof v === 'string') throw notFound()
      return fakeHandle(n, v)
    },
    getFileHandle: async (n: string) => {
      const v = tree[n]
      if (typeof v !== 'string') throw notFound()
      return { getFile: async () => new File([v], n) }
    },
  } as unknown as FileSystemDirectoryHandle
}

describe('filesToCheck', () => {
  it('lists what Save could overwrite', () => {
    const files = stored({
      'P/F.designspace': 'ds',
      'P/A.ufo/metainfo.plist': 'm',
      'P/A.ufo/groups.plist': 'g',
      'P/A.ufo/glyphs/a.glif': 'x',
      'P/sub/B.ufo/metainfo.plist': 'm',
    })
    expect(filesToCheck(files)).toEqual([
      'A.ufo/groups.plist',
      'A.ufo/kerning.plist',
      'F.designspace',
      'sub/B.ufo/groups.plist',
      'sub/B.ufo/kerning.plist',
    ])
    expect(filesToCheck(stored({ 'Font.ufo/metainfo.plist': 'm' }))).toEqual(['groups.plist', 'kerning.plist'])
  })
})

describe('changedOnDisk', () => {
  it('reports changed, deleted and newly created plists', async () => {
    const files = stored({
      'P/F.designspace': 'ds',
      'P/A.ufo/metainfo.plist': 'm',
      'P/A.ufo/groups.plist': 'g',
      'P/A.ufo/kerning.plist': 'k',
      'P/B.ufo/metainfo.plist': 'm',
      'P/B.ufo/groups.plist': 'g',
    })
    const same = fakeHandle('P', { 'F.designspace': 'ds', 'A.ufo': { 'groups.plist': 'g', 'kerning.plist': 'k' }, 'B.ufo': { 'groups.plist': 'g' } })
    expect(await changedOnDisk(same, files)).toEqual([])
    const moved = fakeHandle('P', {
      'F.designspace': 'ds',
      'A.ufo': { 'groups.plist': 'g', 'kerning.plist': 'k2' },
      'B.ufo': { 'kerning.plist': 'new' },
    })
    expect(await changedOnDisk(moved, files)).toEqual(['A.ufo/kerning.plist', 'B.ufo/groups.plist', 'B.ufo/kerning.plist'])
  })
})
