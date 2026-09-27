// These IDs are created only by LXM's Cookie playlist importer. Other LX
// clients use the same list wire format but cannot acquire these playlists.
const privateListId = /^userlist_(?:wy|tx|kg|kw|mg)_sync_.+$/

export const isPrivatePlaylistId = (id: unknown): boolean => typeof id === 'string' && privateListId.test(id)

export const sharedPlaylistData = <T extends { userList: Array<{ id: string }> }>(data: T): T => ({
  ...data,
  userList: data.userList.filter(list => !isPrivatePlaylistId(list.id)),
})

export const retainPrivatePlaylists = <T extends { userList: Array<{ id: string }> }>(incoming: T, local: T): T => {
  const shared = sharedPlaylistData(incoming)
  return {
    ...shared,
    userList: [...shared.userList, ...local.userList.filter(list => isPrivatePlaylistId(list.id))],
  }
}

// Convert a public-list index from the wire format to the local list index,
// where private lists may be interleaved with public ones.
export const localPlaylistPosition = (lists: Array<{ id: string }>, position: number, movingIds: string[] = []): number => {
  const remaining = lists.filter(list => !movingIds.includes(list.id))
  const publicIndices = remaining.flatMap((list, index) => isPrivatePlaylistId(list.id) ? [] : [index])
  return publicIndices[position] ?? remaining.length
}

export const publicPlaylistPosition = (lists: Array<{ id: string }>, id: string): number => {
  const index = lists.findIndex(list => list.id === id)
  return lists.slice(0, index < 0 ? lists.length : index).filter(list => !isPrivatePlaylistId(list.id)).length
}
