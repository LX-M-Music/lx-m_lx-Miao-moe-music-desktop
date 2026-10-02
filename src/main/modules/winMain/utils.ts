// import fs from 'fs'
import path from 'node:path'
import { type WindowSize, windowSizeList } from '@common/config'
import { nativeImage } from 'electron'

export const getWindowSizeInfo = (windowSizeId: number | string, width = 0, height = 0): WindowSize => {
  const preset = windowSizeList.find(i => i.id == windowSizeId) ?? windowSizeList[0]
  return Number.isFinite(width) && Number.isFinite(height) && width >= 1 && height >= 1 && width <= 32768 && height <= 32768
    ? { ...preset, width: Math.round(width), height: Math.round(height) }
    : preset
}

export const getWindowSizing = (size: Pick<WindowSize, 'width' | 'height'>, area: Pick<Electron.Rectangle, 'width' | 'height'>) => {
  const minimumScale = Math.max(windowSizeList[0].width / size.width, windowSizeList[0].height / size.height)
  const maximumScale = Math.min(area.width / size.width, area.height / size.height)
  const scale = Math.min(Math.max(1, minimumScale), maximumScale)
  const minimum = Math.min(minimumScale, maximumScale)
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
    minWidth: Math.max(1, Math.floor(size.width * minimum)),
    minHeight: Math.max(1, Math.floor(size.height * minimum)),
  }
}

const getIconPath = (name: string): Electron.NativeImage => {
  return nativeImage.createFromPath(path.join(global.staticPath, 'images/taskbar', name + '.png'))
}

export const createTaskBarButtons = ({
  empty = false,
  collect = false,
  play = false,
  next = true,
  prev = true,
}: LX.TaskBarButtonFlags, onClick: (action: LX.Player.StatusButtonActions) => void): Electron.ThumbarButton[] => {
  const buttons: Electron.ThumbarButton[] = [
    collect
      ? {
          icon: getIconPath('collected'),
          click() {
            onClick('unCollect')
          },
          tooltip: '取消收藏',
          flags: ['nobackground'],
        }
      : {
          icon: getIconPath('collect'),
          click() {
            onClick('collect')
          },
          tooltip: '收藏',
          flags: ['nobackground'],
        },
    {
      icon: getIconPath('prev'),
      click() {
        onClick('prev')
      },
      tooltip: '上一曲',
      flags: prev ? ['nobackground'] : ['nobackground', 'disabled'],
    },
    play
      ? {
          icon: getIconPath('pause'),
          click() {
            onClick('pause')
          },
          tooltip: '暂停',
          flags: ['nobackground'],
        }
      : {
          icon: getIconPath('play'),
          click() {
            onClick('play')
          },
          tooltip: '播放',
          flags: ['nobackground'],
        },
    {
      icon: getIconPath('next'),
      click() {
        onClick('next')
      },
      tooltip: '下一曲',
      flags: next ? ['nobackground'] : ['nobackground', 'disabled'],
    },
  ]
  if (empty) {
    for (const button of buttons) {
      button.flags = ['nobackground', 'disabled']
    }
  }
  return buttons
}
