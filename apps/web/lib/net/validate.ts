/**
 * Address and hostname validation for the guarded fetch layer (BRIEF 9.3).
 *
 * Everything here is pure string and integer work: no DNS, no network, no
 * platform imports. The guard resolves names elsewhere and passes every
 * resolved address through checkAddress, so one set of range rules covers
 * IP literals typed into URLs and the addresses a DNS name resolves to.
 *
 * Fail closed: anything that does not parse as a routable public address
 * is refused. The IPv4 parser accepts the full historical inet_aton
 * vocabulary (single 32-bit integers, hex and octal components, partial
 * dotted quads) because those forms are exactly how loopback gets smuggled
 * past naive string checks, and the WHATWG URL parser normalizes most of
 * them into plain dotted quads anyway.
 */

export type AddressCheck = { ok: true } | { ok: false; reason: string }

export type HostnameCheck =
  | { ok: true; kind: 'ip'; address: string }
  | { ok: true; kind: 'name'; hostname: string }
  | { ok: false; reason: string }

type Ipv4 = [number, number, number, number]

type Ipv4Range = { base: Ipv4; bits: number; reason: string }

const IPV4_BLOCKLIST: readonly Ipv4Range[] = [
  { base: [0, 0, 0, 0], bits: 8, reason: 'the "this network" range (0.0.0.0/8)' },
  { base: [10, 0, 0, 0], bits: 8, reason: 'the RFC 1918 private range (10.0.0.0/8)' },
  { base: [100, 64, 0, 0], bits: 10, reason: 'carrier-grade NAT (100.64.0.0/10)' },
  { base: [127, 0, 0, 0], bits: 8, reason: 'loopback (127.0.0.0/8)' },
  {
    base: [169, 254, 0, 0],
    bits: 16,
    reason: 'link-local (169.254.0.0/16, home of the cloud metadata endpoint)',
  },
  { base: [172, 16, 0, 0], bits: 12, reason: 'the RFC 1918 private range (172.16.0.0/12)' },
  { base: [192, 0, 0, 0], bits: 24, reason: 'IETF protocol assignments (192.0.0.0/24)' },
  { base: [192, 0, 2, 0], bits: 24, reason: 'documentation TEST-NET-1 (192.0.2.0/24)' },
  { base: [192, 168, 0, 0], bits: 16, reason: 'the RFC 1918 private range (192.168.0.0/16)' },
  { base: [198, 18, 0, 0], bits: 15, reason: 'benchmarking (198.18.0.0/15)' },
  { base: [198, 51, 100, 0], bits: 24, reason: 'documentation TEST-NET-2 (198.51.100.0/24)' },
  { base: [203, 0, 113, 0], bits: 24, reason: 'documentation TEST-NET-3 (203.0.113.0/24)' },
  { base: [224, 0, 0, 0], bits: 4, reason: 'multicast (224.0.0.0/4)' },
  { base: [240, 0, 0, 0], bits: 4, reason: 'reserved space including broadcast (240.0.0.0/4)' },
]

function ipv4ToU32(octets: Ipv4): number {
  const [a, b, c, d] = octets
  return (((a << 24) | (b << 16) | (c << 8) | d) >>> 0)
}

function inRange(octets: Ipv4, range: Ipv4Range): boolean {
  const mask = range.bits === 0 ? 0 : (~0 << (32 - range.bits)) >>> 0
  return (ipv4ToU32(octets) & mask) === (ipv4ToU32(range.base) & mask)
}

/** One inet_aton component: decimal, 0x-prefixed hex, or 0-prefixed octal. */
function parseIpv4Part(part: string): number | null {
  let radix = 10
  let digits = part
  if (part.startsWith('0x') || part.startsWith('0X')) {
    radix = 16
    digits = part.slice(2)
  } else if (part.length > 1 && part.startsWith('0')) {
    radix = 8
    digits = part.slice(1)
  }
  if (digits === '') return null
  const pattern = radix === 16 ? /^[0-9a-fA-F]+$/ : radix === 8 ? /^[0-7]+$/ : /^[0-9]+$/
  if (!pattern.test(digits)) return null
  const value = parseInt(digits, radix)
  return Number.isSafeInteger(value) ? value : null
}

/**
 * Parses an IPv4 literal in any inet_aton form into canonical octets.
 * Returns null for anything that is not an IPv4 literal, which is how a
 * hostname gets classified as a DNS name.
 */
export function parseIpv4(text: string): Ipv4 | null {
  if (text.length === 0) return null
  const parts = text.split('.')
  if (parts.length > 4 || parts.some((part) => part.length === 0)) return null
  const values: number[] = []
  for (const part of parts) {
    const value = parseIpv4Part(part)
    if (value === null) return null
    values.push(value)
  }
  const head = values.slice(0, -1)
  const last = values[values.length - 1] ?? 0
  if (head.some((value) => value > 255)) return null
  const tailBytes = 4 - head.length
  if (last >= 2 ** (8 * tailBytes)) return null
  const octets = [...head]
  for (let i = tailBytes - 1; i >= 0; i--) octets.push((last >>> (8 * i)) & 0xff)
  return [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0]
}

/** Strict dotted quad for the tail of an IPv6 literal: four decimal parts. */
function parseStrictDottedQuad(text: string): Ipv4 | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (!match) return null
  const octets = match.slice(1).map((part) => Number(part))
  if (octets.some((value) => value > 255)) return null
  return [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0]
}

/**
 * Parses an IPv6 literal (bracketed or bare, with or without a zone index,
 * with or without an embedded IPv4 tail) into its 16 bytes. Returns null
 * for anything malformed.
 */
export function parseIpv6(text: string): Uint8Array | null {
  let s = text
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1)
  const zone = s.indexOf('%')
  if (zone !== -1) s = s.slice(0, zone)
  if (!s.includes(':')) return null

  if (s.includes('.')) {
    const lastColon = s.lastIndexOf(':')
    const quad = parseStrictDottedQuad(s.slice(lastColon + 1))
    if (quad === null) return null
    const [a, b, c, d] = quad
    const hex = (hi: number, lo: number): string => ((hi << 8) | lo).toString(16)
    s = s.slice(0, lastColon + 1) + hex(a, b) + ':' + hex(c, d)
  }

  const halves = s.split('::')
  if (halves.length > 2) return null
  const splitGroups = (half: string | undefined): string[] =>
    half === undefined || half === '' ? [] : half.split(':')
  const headGroups = splitGroups(halves[0])
  const tailGroups = halves.length === 2 ? splitGroups(halves[1]) : []
  const total = headGroups.length + tailGroups.length
  if (halves.length === 1 && total !== 8) return null
  if (halves.length === 2 && total > 7) return null

  const parseGroup = (group: string): number | null =>
    /^[0-9a-fA-F]{1,4}$/.test(group) ? parseInt(group, 16) : null

  const groups: number[] = []
  for (const group of headGroups) {
    const value = parseGroup(group)
    if (value === null) return null
    groups.push(value)
  }
  for (let i = total; i < 8; i++) groups.push(0)
  for (const group of tailGroups) {
    const value = parseGroup(group)
    if (value === null) return null
    groups.push(value)
  }
  if (groups.length !== 8) return null

  const bytes = new Uint8Array(16)
  for (let i = 0; i < 8; i++) {
    const group = groups[i] ?? 0
    bytes[2 * i] = group >> 8
    bytes[2 * i + 1] = group & 0xff
  }
  return bytes
}

function checkIpv4(text: string, octets: Ipv4): AddressCheck {
  for (const range of IPV4_BLOCKLIST) {
    if (inRange(octets, range)) {
      return { ok: false, reason: `${text} is in ${range.reason}` }
    }
  }
  return { ok: true }
}

/** Reads four bytes out of an IPv6 address as an embedded IPv4 address. */
function embeddedIpv4(bytes: Uint8Array, offset: number): Ipv4 {
  return [
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  ]
}

function checkEmbedded(text: string, bytes: Uint8Array, offset: number, how: string): AddressCheck {
  const quad = embeddedIpv4(bytes, offset)
  const inner = checkIpv4(quad.join('.'), quad)
  if (!inner.ok) return { ok: false, reason: `${text} ${how} ${inner.reason}` }
  return { ok: true }
}

function checkIpv6(text: string, bytes: Uint8Array): AddressCheck {
  const zeroRange = (start: number, end: number): boolean => {
    for (let i = start; i <= end; i++) if (bytes[i] !== 0) return false
    return true
  }
  const zeroThrough = (end: number): boolean => zeroRange(0, end)
  const b0 = bytes[0] ?? 0
  const b1 = bytes[1] ?? 0

  if (zeroThrough(15)) return { ok: false, reason: `${text} is the unspecified address (::)` }
  if (zeroThrough(14) && bytes[15] === 1) {
    return { ok: false, reason: `${text} is IPv6 loopback (::1)` }
  }
  if (b0 === 0xfe && (b1 & 0xc0) === 0x80) {
    return { ok: false, reason: `${text} is IPv6 link-local (fe80::/10)` }
  }
  if ((b0 & 0xfe) === 0xfc) {
    return { ok: false, reason: `${text} is IPv6 unique-local (fc00::/7)` }
  }
  if (b0 === 0xff) return { ok: false, reason: `${text} is IPv6 multicast (ff00::/8)` }
  if (b0 === 0x20 && b1 === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return { ok: false, reason: `${text} is the IPv6 documentation range (2001:db8::/32)` }
  }
  // IPv4-mapped (::ffff:0:0/96): the connection is really IPv4, so the
  // embedded address decides.
  if (zeroThrough(9) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return checkEmbedded(text, bytes, 12, 'is IPv4-mapped and embeds')
  }
  // NAT64 well-known prefix (64:ff9b::/96) reaches IPv4 space directly.
  if (b0 === 0 && b1 === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && zeroRange(4, 11)) {
    return checkEmbedded(text, bytes, 12, 'is NAT64 and embeds')
  }
  // Deprecated IPv4-compatible form (::a.b.c.d).
  if (zeroThrough(11)) {
    return checkEmbedded(text, bytes, 12, 'is IPv4-compatible and embeds')
  }
  // 6to4 (2002::/16) encodes the IPv4 endpoint in bytes 2..5.
  if (b0 === 0x20 && b1 === 0x02) {
    return checkEmbedded(text, bytes, 2, 'is 6to4 and embeds')
  }
  return { ok: true }
}

/**
 * Decides whether one concrete address (an IP literal from a URL, or one
 * answer from a DNS resolution) is safe to connect to. Anything that does
 * not parse as an IP address at all is refused: this function only ever
 * sees strings that are supposed to be addresses.
 */
export function checkAddress(address: string): AddressCheck {
  const v4 = parseIpv4(address)
  if (v4 !== null) return checkIpv4(address, v4)
  const v6 = parseIpv6(address)
  if (v6 !== null) return checkIpv6(address, v6)
  return { ok: false, reason: `${address} did not parse as an IP address; refusing to connect` }
}

/**
 * Classifies a URL hostname: a safe IP literal, a DNS name that still needs
 * resolving and re-checking, or a refusal. IPv6 literals arrive bracketed
 * from the WHATWG URL hostname getter and are handled either way.
 */
export function checkHostname(hostname: string): HostnameCheck {
  if (hostname === '') return { ok: false, reason: 'the URL has an empty hostname' }
  if (hostname.startsWith('[') || hostname.includes(':')) {
    const v6 = parseIpv6(hostname)
    if (v6 === null) return { ok: false, reason: `${hostname} is not a valid IPv6 literal` }
    const check = checkIpv6(hostname, v6)
    return check.ok ? { ok: true, kind: 'ip', address: hostname } : check
  }
  const v4 = parseIpv4(hostname)
  if (v4 !== null) {
    const check = checkIpv4(hostname, v4)
    return check.ok ? { ok: true, kind: 'ip', address: hostname } : check
  }
  const name = hostname.toLowerCase().replace(/\.$/, '')
  if (name === 'localhost' || name.endsWith('.localhost')) {
    return { ok: false, reason: `${hostname} is a localhost name` }
  }
  return { ok: true, kind: 'name', hostname: name }
}
