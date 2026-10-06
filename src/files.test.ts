import { describe, expect, it } from 'vitest'
import { checkFolder, classifyName, designspaceSources, InputError, normalizeRelative, shouldSkip } from './files'

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
