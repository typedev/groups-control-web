import { describe, expect, it } from 'vitest'
import { checkFolder, classifyName, InputError, shouldSkip } from './files'

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
