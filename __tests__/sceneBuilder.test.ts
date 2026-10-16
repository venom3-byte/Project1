import { describe, expect, it } from 'vitest'
import { findMtlAssetName } from '../src/shared/sceneBuilder'

describe('findMtlAssetName', () => {
  it('selects an OBJ companion material library by its extension', () => {
    expect(findMtlAssetName({
      'F16C_Block50.obj': 'https://example.test/F16C_Block50.obj',
      'F16C_Block50.mtl': 'https://example.test/F16C_Block50.mtl',
    })).toBe('F16C_Block50.mtl')
  })

  it('matches the material extension case-insensitively', () => {
    expect(findMtlAssetName({ 'airframe.MTL': 'https://example.test/airframe.MTL' }))
      .toBe('airframe.MTL')
  })

  it('returns undefined when the asset has no MTL companion', () => {
    expect(findMtlAssetName({ 'F16C_Block50.obj': 'https://example.test/F16C_Block50.obj' }))
      .toBeUndefined()
    expect(findMtlAssetName(undefined)).toBeUndefined()
  })
})
