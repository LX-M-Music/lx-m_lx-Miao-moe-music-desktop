const QUALITY_ORDER = ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master']
const EXTRA_QUALITYS = new Set(['hires', 'atmos', 'atmos_plus', 'master'])
export const isExtraDownloadQuality = type => EXTRA_QUALITYS.has(type)
const HIGH_QUALITYS = new Set(['flac24bit', ...EXTRA_QUALITYS])
const OLD_WY_QUALITY_ORDER = ['128k', '320k', 'flac', 'flac24bit']

// Older artist lists contain each chargeInfoList rate followed by every higher rate
// because the singer parser's switch fell through. Recover the original rates only
// when the saved sequence matches that exact pattern.
const recoverOldWyArtistQualitys = (musicInfo, qualitys) => {
  if (musicInfo.source != 'wy' || qualitys.length == new Set(qualitys.map(q => q.type)).size) return qualitys
  const recovered = []
  for (let index = 0; index < qualitys.length;) {
    const firstType = qualitys[index]?.type
    const start = OLD_WY_QUALITY_ORDER.indexOf(firstType)
    if (start < 0) return qualitys
    const suffix = OLD_WY_QUALITY_ORDER.slice(start)
    if (!suffix.every((type, offset) => qualitys[index + offset]?.type == type)) return qualitys
    recovered.push(qualitys[index])
    index += suffix.length
  }
  return recovered
}

export const shouldRefreshDownloadQuality = (musicInfo, sourceQualityList, listId) => Boolean(
  listId && musicInfo?.source !== 'local' && musicInfo?.name && musicInfo?.id &&
  !musicInfo.meta?._qualitys?.flac24bit && sourceQualityList.some(type => HIGH_QUALITYS.has(type)),
)

export const mergeMatchedSearchQuality = (musicInfo, searchList) => {
  const match = searchList.find(item => item?.source === musicInfo.source && item.id === musicInfo.id)
  if (!Array.isArray(match?.meta?.qualitys) || !match.meta._qualitys) return musicInfo
  return {
    ...musicInfo,
    meta: { ...musicInfo.meta, qualitys: match.meta.qualitys, _qualitys: match.meta._qualitys },
  }
}

export const getDownloadQualityOptions = (musicInfo, sourceQualityList) => {
  const rawQualitys = Array.isArray(musicInfo.meta?.qualitys) ? musicInfo.meta.qualitys : []
  const songQualitys = rawQualitys.length
    ? recoverOldWyArtistQualitys(musicInfo, rawQualitys)
    : Object.entries(musicInfo.meta?._qualitys || {}).map(([type, detail]) => ({ type, size: detail?.size ?? null }))
  const supported = new Set(sourceQualityList)
  const options = new Map()
  for (const quality of songQualitys) {
    if (!supported.has(quality.type) || !QUALITY_ORDER.includes(quality.type)) continue
    const item = { ...quality, size: quality.size || musicInfo.meta?._qualitys?.[quality.type]?.size || null }
    const previous = options.get(quality.type)
    if (!previous || (!previous.size && item.size)) options.set(quality.type, item)
  }

  // Custom sources may expose additional formats for a song with 24-bit audio.
  if (songQualitys.some(quality => quality.type == 'flac24bit')) {
    for (const type of sourceQualityList) {
      if (EXTRA_QUALITYS.has(type) && !options.has(type)) options.set(type, { type, size: musicInfo.meta?._qualitys?.[type]?.size || null })
    }
  }
  // Explicit Master downloads also accept lossless songs without a 24-bit flag.
  if (supported.has('master') && songQualitys.some(quality => quality.type == 'flac') && !options.has('master')) {
    options.set('master', { type: 'master', size: musicInfo.meta?._qualitys?.master?.size || null })
  }
  if (!options.size && supported.has('128k')) options.set('128k', { type: '128k', size: null })
  return [...options.values()].sort((a, b) => QUALITY_ORDER.indexOf(a.type) - QUALITY_ORDER.indexOf(b.type))
}
