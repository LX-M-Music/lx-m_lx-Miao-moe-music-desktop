/** Choose a reachable display URL without changing the artwork stored in music metadata. */
export const getCoverThumbnail = (source: string, pixels = 96): string => {
  if (!/^https?:\/\//i.test(source)) return source
  const requested = Number.isFinite(pixels) ? Math.max(1, pixels) : 96
  const size = [96, 160, 320, 480, 640].find(size => size >= requested) ?? 640
  try {
    const url = new URL(source)
    if ([...url.searchParams.keys()].some(key => /^(sign|signature|token|auth_key|expires|x-amz-)/i.test(key))) return source
    // Kuwo's legacy CDN returns HTTP links and its HTTPS endpoint can fail TLS.
    // The matching image host serves the same artwork over HTTPS; the caller
    // keeps the original URL as a fallback if that host is unavailable.
    if (/^img\d+\.kwcdn\.kuwo\.cn$/.test(url.hostname) && url.pathname.startsWith('/star/')) {
      url.hostname = url.hostname.replace('.kwcdn.kuwo.cn', '.kuwo.cn')
      url.protocol = 'https:'
      return url.href
    }
    if (/^p\d+\.music\.126\.net$/.test(url.hostname)) {
      url.searchParams.set('param', `${size}y${size}`)
      return url.href
    }
    if (url.hostname === 'y.gtimg.cn' && /^\/music\/photo_new\/T00[12]R\d+x\d+M000/.test(url.pathname)) {
      const size = [90, 150, 300, 500, 800].find(size => size >= requested) ?? 800
      url.pathname = url.pathname.replace(/R\d+x\d+M000/, `R${size}x${size}M000`)
      return url.href
    }
  } catch {}
  // Unknown CDNs, signed links and local artwork retain their original URL.
  return source
}
