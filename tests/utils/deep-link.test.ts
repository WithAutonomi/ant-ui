import { describe, it, expect } from 'vitest'
import { isValidPublicAddress, parseAutonomiDeepLink } from '~/utils/validators'

const ADDR = '9703216cb34a6d736ce768cac8859d2bb7efabfb7e92d9cac85f880133a7f471' // 64 hex

describe('isValidPublicAddress', () => {
  it('accepts a 64-hex address with and without 0x', () => {
    expect(isValidPublicAddress(ADDR)).toBe(true)
    expect(isValidPublicAddress(`0x${ADDR}`)).toBe(true)
    expect(isValidPublicAddress(`  ${ADDR}  `)).toBe(true)
  })

  it('rejects wrong-length or non-hex values', () => {
    expect(isValidPublicAddress('')).toBe(false)
    expect(isValidPublicAddress('deadbeef')).toBe(false) // too short
    expect(isValidPublicAddress(ADDR + 'ab')).toBe(false) // too long
    expect(isValidPublicAddress(ADDR.replace('9', 'g'))).toBe(false) // non-hex
  })
})

describe('parseAutonomiDeepLink', () => {
  it('parses a bare autonomi:// address', () => {
    expect(parseAutonomiDeepLink(`autonomi://${ADDR}`)).toEqual({ address: ADDR, name: undefined })
  })

  it('tolerates a trailing slash (as the OS often appends)', () => {
    expect(parseAutonomiDeepLink(`autonomi://${ADDR}/`)).toEqual({ address: ADDR, name: undefined })
  })

  it('tolerates the scheme without //', () => {
    expect(parseAutonomiDeepLink(`autonomi:${ADDR}`)?.address).toBe(ADDR)
  })

  it('extracts the optional ?name= filename', () => {
    expect(parseAutonomiDeepLink(`autonomi://${ADDR}?name=book.epub`)).toEqual({
      address: ADDR,
      name: 'book.epub',
    })
    // trailing slash before the query, too
    expect(parseAutonomiDeepLink(`autonomi://${ADDR}/?name=book.epub`)?.name).toBe('book.epub')
  })

  it('returns null for non-autonomi or invalid-address URLs', () => {
    expect(parseAutonomiDeepLink('https://example.com')).toBeNull()
    expect(parseAutonomiDeepLink('autonomi://not-an-address')).toBeNull()
    expect(parseAutonomiDeepLink(`autonomi://${ADDR}xy`)).toBeNull() // wrong length
    expect(parseAutonomiDeepLink('')).toBeNull()
  })
})
