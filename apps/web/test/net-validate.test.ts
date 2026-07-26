import { describe, expect, it } from 'vitest'
import { checkAddress, checkHostname, parseIpv4, parseIpv6 } from '../lib/net/validate'

/**
 * BRIEF 9.3: reject loopback, link-local (including the cloud metadata
 * endpoint), RFC 1918, carrier-grade NAT, IPv6 unique-local and link-local,
 * and every historical IPv4 literal trick that smuggles those ranges past a
 * naive string check. Everything here is pure parsing, no network.
 */

describe('parseIpv4', () => {
  it('parses a plain dotted quad', () => {
    expect(parseIpv4('127.0.0.1')).toEqual([127, 0, 0, 1])
    expect(parseIpv4('93.184.216.34')).toEqual([93, 184, 216, 34])
  })

  it('parses the single 32-bit integer form', () => {
    expect(parseIpv4('2130706433')).toEqual([127, 0, 0, 1])
  })

  it('parses hex components', () => {
    expect(parseIpv4('0x7f.0.0.1')).toEqual([127, 0, 0, 1])
    expect(parseIpv4('0x7f000001')).toEqual([127, 0, 0, 1])
  })

  it('parses octal components', () => {
    expect(parseIpv4('0177.0.0.1')).toEqual([127, 0, 0, 1])
    expect(parseIpv4('017700000001')).toEqual([127, 0, 0, 1])
  })

  it('parses partial dotted quads the way inet_aton does', () => {
    expect(parseIpv4('127.1')).toEqual([127, 0, 0, 1])
    expect(parseIpv4('192.168.257')).toEqual([192, 168, 1, 1])
  })

  it('rejects names, out-of-range parts, and malformed strings', () => {
    expect(parseIpv4('example.com')).toBeNull()
    expect(parseIpv4('256.1.1.1')).toBeNull()
    expect(parseIpv4('1.2.3.4.5')).toBeNull()
    expect(parseIpv4('')).toBeNull()
    expect(parseIpv4('1.2.3.')).toBeNull()
    expect(parseIpv4('0x.1.1.1')).toBeNull()
    expect(parseIpv4('4294967296')).toBeNull()
  })
})

describe('parseIpv6', () => {
  it('parses loopback in bare and bracketed form', () => {
    const loopback = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]
    expect(Array.from(parseIpv6('::1') ?? [])).toEqual(loopback)
    expect(Array.from(parseIpv6('[::1]') ?? [])).toEqual(loopback)
  })

  it('parses a full eight-group address', () => {
    const bytes = parseIpv6('2606:4700:0:0:0:0:6810:84e5')
    expect(bytes).not.toBeNull()
    expect(Array.from(bytes ?? []).slice(0, 4)).toEqual([0x26, 0x06, 0x47, 0x00])
  })

  it('parses compressed groups', () => {
    const bytes = parseIpv6('2001:db8::1')
    expect(bytes).not.toBeNull()
    expect(Array.from(bytes ?? [])).toEqual([
      0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ])
  })

  it('parses an embedded IPv4 tail', () => {
    expect(Array.from(parseIpv6('::ffff:127.0.0.1') ?? [])).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 127, 0, 0, 1,
    ])
  })

  it('ignores a zone index', () => {
    const bytes = parseIpv6('fe80::1%eth0')
    expect(bytes).not.toBeNull()
    expect((bytes ?? new Uint8Array(16))[0]).toBe(0xfe)
  })

  it('rejects malformed addresses', () => {
    expect(parseIpv6(':::1')).toBeNull()
    expect(parseIpv6('1:2:3:4:5:6:7:8:9')).toBeNull()
    expect(parseIpv6('zz::1')).toBeNull()
    expect(parseIpv6('1::2::3')).toBeNull()
    expect(parseIpv6('1:2:3:4:5:6:7')).toBeNull()
    expect(parseIpv6('example.com')).toBeNull()
  })
})

describe('checkAddress: IPv4 blocked ranges', () => {
  const refused = [
    '127.0.0.1',
    '127.255.255.254',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.10',
    '169.254.169.254',
    '169.254.0.1',
    '100.64.0.1',
    '100.127.255.255',
    '0.0.0.0',
    '0.1.2.3',
    '192.0.0.1',
    '192.0.2.44',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
  ]
  for (const address of refused) {
    it(`refuses ${address}`, () => {
      const result = checkAddress(address)
      expect(result.ok).toBe(false)
    })
  }

  it('names the metadata-bearing range in the link-local reason', () => {
    const result = checkAddress('169.254.169.254')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/link-local/)
  })

  const allowed = ['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '11.0.0.1']
  for (const address of allowed) {
    it(`allows public ${address}`, () => {
      expect(checkAddress(address).ok).toBe(true)
    })
  }
})

describe('checkAddress: IPv6 blocked ranges', () => {
  const refused = [
    '::1',
    '::',
    'fe80::1',
    'febf::1',
    'fc00::1',
    'fdff::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '64:ff9b::a00:1',
    '2001:db8::1',
    '::0.0.0.1',
    '2002:7f00:1::1',
  ]
  for (const address of refused) {
    it(`refuses ${address}`, () => {
      expect(checkAddress(address).ok).toBe(false)
    })
  }

  const allowed = ['2606:4700::6810:84e5', '2600:1f18::5', '::ffff:93.184.216.34']
  for (const address of allowed) {
    it(`allows public ${address}`, () => {
      expect(checkAddress(address).ok).toBe(true)
    })
  }

  it('explains what an IPv4-mapped refusal wraps', () => {
    const result = checkAddress('::ffff:127.0.0.1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/127\.0\.0\.1/)
  })
})

describe('checkAddress: fail closed', () => {
  it('refuses anything that does not parse as an IP at all', () => {
    expect(checkAddress('not-an-ip').ok).toBe(false)
    expect(checkAddress('').ok).toBe(false)
  })
})

describe('checkHostname', () => {
  it('classifies a DNS name as a name', () => {
    const result = checkHostname('example.com')
    expect(result).toEqual({ ok: true, kind: 'name', hostname: 'example.com' })
  })

  it('classifies a public IP literal as an ip', () => {
    const result = checkHostname('93.184.216.34')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.kind).toBe('ip')
  })

  it('refuses localhost by name in every spelling', () => {
    expect(checkHostname('localhost').ok).toBe(false)
    expect(checkHostname('LOCALHOST').ok).toBe(false)
    expect(checkHostname('localhost.').ok).toBe(false)
    expect(checkHostname('foo.localhost').ok).toBe(false)
  })

  it('refuses the empty hostname', () => {
    expect(checkHostname('').ok).toBe(false)
  })

  it('refuses private IP literals', () => {
    expect(checkHostname('127.0.0.1').ok).toBe(false)
    expect(checkHostname('169.254.169.254').ok).toBe(false)
    expect(checkHostname('[::1]').ok).toBe(false)
  })

  it('refuses every dotted-quad trick after WHATWG URL normalization', () => {
    const tricks = [
      'http://2130706433/',
      'http://0x7f.0.0.1/',
      'http://0177.0.0.1/',
      'http://127.1/',
      'http://0.0.0.0/',
    ]
    for (const raw of tricks) {
      const hostname = new URL(raw).hostname
      expect(checkHostname(hostname).ok, `${raw} normalized to ${hostname}`).toBe(false)
    }
  })

  it('refuses IPv4-mapped IPv6 loopback in URL form', () => {
    const hostname = new URL('http://[::ffff:127.0.0.1]/').hostname
    expect(checkHostname(hostname).ok).toBe(false)
  })
})
