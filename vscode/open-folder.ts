import { CommandsRegistry } from '@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands'
import { MenuId, MenuRegistry } from '@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions'

import type { Bridge } from './bridge'

const OPEN_FOLDER = 'opencroft.codeEditor.openFolder'

/**
 * File > Open Folder…, which the web workbench leaves out: here a folder is a
 * terminal and a path, so it opens the App's own picker for both.
 */
export function registerOpenFolder(bridge: Bridge): void {
  CommandsRegistry.registerCommand(OPEN_FOLDER, () => bridge.openFolder())
  const command = { id: OPEN_FOLDER, title: 'Open Folder…' }
  MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, { group: '2_open', order: 2, command })
  MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { ...command, title: 'File: Open Folder…' } })
}
