import { isPrivatePlaylistId, sharedPlaylistData } from '@common/privatePlaylists'
import { WebDAVError } from './errors'
import { validateData } from './data'

interface MobilePlaylistFile {
  version?: string
  lastModified: number
  data: LX.List.ListDataFull & Record<string, unknown>
  [key: string]: unknown
}

const record = (value: unknown): value is Record<string, unknown> => value != null && typeof value == 'object' && !Array.isArray(value)

export const parseMobilePlaylists = (content: string) => {
  let raw: unknown
  try { raw = JSON.parse(content) } catch { throw new WebDAVError('invalid_data', ['playlists']) }
  if (!record(raw) || (raw.version !== undefined && raw.version !== '2') || !Number.isSafeInteger(raw.lastModified) || (raw.lastModified as number) < 0 || !record(raw.data) || !Array.isArray(raw.data.tempList) || !Array.isArray(raw.data.userList) || raw.data.userList.some((list: unknown) => !record(list))) throw new WebDAVError('invalid_data', ['playlists'])
  const file = raw as unknown as MobilePlaylistFile
  const playlists = sharedPlaylistData({ defaultList: file.data.defaultList, loveList: file.data.loveList, userList: file.data.userList })
  validateData({ playlists }, ['playlists'])
  return { file, playlists, containsPrivate: file.data.userList.some(list => isPrivatePlaylistId(list?.id)) }
}

export const buildMobilePlaylists = (previous: MobilePlaylistFile | undefined, playlists: LX.Sync.List.ListData): MobilePlaylistFile => {
  const data = sharedPlaylistData(playlists)
  validateData({ playlists: data }, ['playlists'])
  if (previous?.lastModified === Number.MAX_SAFE_INTEGER) throw new WebDAVError('invalid_data', ['playlists'])
  return {
    ...previous,
    version: '2',
    lastModified: Math.max(Date.now(), (previous?.lastModified ?? 0) + 1),
    data: { ...previous?.data, ...data, tempList: previous?.data.tempList ?? [] },
  }
}
