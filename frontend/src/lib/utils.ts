import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Cloudflare IP ranges
// https://www.cloudflare.com/ips/
const CLOUDFLARE_IPV4_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
]

const CLOUDFLARE_IPV6_RANGES = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
]

/**
 * Convert IPv4 address to a 32-bit number
 */
function ipv4ToNumber(ip: string): number {
  const parts = ip.split('.').map(Number)
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

/**
 * Check if an IPv4 address is within a CIDR range
 */
function isIpv4InCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split('/')
  const prefix = parseInt(prefixStr, 10)
  const mask = ~((1 << (32 - prefix)) - 1) >>> 0
  const ipNum = ipv4ToNumber(ip)
  const rangeNum = ipv4ToNumber(rangeIp)
  return (ipNum & mask) === (rangeNum & mask)
}

/**
 * Expand IPv6 address to full form (8 groups of 4 hex digits)
 */
function expandIpv6(ip: string): string {
  // Handle :: expansion
  const parts = ip.split('::')
  let left = parts[0] ? parts[0].split(':') : []
  let right = parts[1] ? parts[1].split(':') : []
  const missing = 8 - left.length - right.length
  const middle = Array(missing).fill('0000')
  const full = [...left, ...middle, ...right]
  return full.map(p => p.padStart(4, '0')).join(':')
}

/**
 * Convert IPv6 address to BigInt
 */
function ipv6ToBigInt(ip: string): bigint {
  const expanded = expandIpv6(ip)
  const hex = expanded.replace(/:/g, '')
  return BigInt('0x' + hex)
}

/**
 * Check if an IPv6 address is within a CIDR range
 */
function isIpv6InCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split('/')
  const prefix = parseInt(prefixStr, 10)
  const mask = (BigInt(1) << BigInt(128 - prefix)) - BigInt(1)
  const inverseMask = ~mask
  const ipNum = ipv6ToBigInt(ip)
  const rangeNum = ipv6ToBigInt(rangeIp)
  return (ipNum & inverseMask) === (rangeNum & inverseMask)
}

/**
 * Check if an IP address is a Cloudflare IP
 */
export function isCloudflareIp(ip: string): boolean {
  if (!ip) return false

  // Check if IPv6
  if (ip.includes(':')) {
    return CLOUDFLARE_IPV6_RANGES.some(cidr => {
      try {
        return isIpv6InCidr(ip, cidr)
      } catch {
        return false
      }
    })
  }

  // IPv4
  return CLOUDFLARE_IPV4_RANGES.some(cidr => {
    try {
      return isIpv4InCidr(ip, cidr)
    } catch {
      return false
    }
  })
}
