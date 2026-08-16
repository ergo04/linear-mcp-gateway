/**
 * mcp-headers.ts — the Base64 sentinel encoding Streamable HTTP uses for header
 * values that cannot travel as plain ASCII (`=?base64?<payload>?=`).
 *
 * Needed on both sides: encoding when calling Linear, decoding before comparing
 * an incoming `Mcp-Name` against the request body.
 */

const SENTINEL_PREFIX = "=?base64?"
const SENTINEL_SUFFIX = "?="

/** Visible ASCII, space and tab, with no leading or trailing whitespace. */
function isPlainAscii(value: string): boolean {
  if (value !== value.trim()) return false
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E\x09]*$/.test(value)
}

function isSentinel(value: string): boolean {
  return value.startsWith(SENTINEL_PREFIX) && value.endsWith(SENTINEL_SUFFIX)
}

export function encodeHeaderValue(value: string): string {
  // A plain value that happens to look like the sentinel must be encoded too,
  // otherwise the receiver would decode something that was never encoded.
  if (isPlainAscii(value) && !isSentinel(value)) return value
  return SENTINEL_PREFIX + Buffer.from(value, "utf8").toString("base64") + SENTINEL_SUFFIX
}

export function decodeHeaderValue(value: string): string {
  if (!isSentinel(value)) return value
  const payload = value.slice(SENTINEL_PREFIX.length, -SENTINEL_SUFFIX.length)
  try {
    return Buffer.from(payload, "base64").toString("utf8")
  } catch {
    return value
  }
}
