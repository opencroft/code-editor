import type { Selection, SelectionItem } from '@opencroft/client/chat'

import type { OpenFile } from '../../vscode/bridge'

type FileItem = Extract<SelectionItem, { kind: 'file' }>

/**
 * What the editor offers the chat: the open file, with the highlighted lines
 * and their text when there are any, or the opened folder when no file is
 * open. Each is a `file` item on the workspace's terminal, so the host writes
 * the `remote_read` or `ls` call that reaches it.
 *
 * The highlighted text goes whole: the host caps what a message carries and
 * says how much it cut, which it can only count from the whole text.
 *
 * `file` comes from the VS Code page's window. Every value is read out of it
 * as a primitive into a new object, because the host's scope compares and
 * serialises what it is given as objects of its own window.
 */
export function editorSelection(
  workspace: { terminal: string; folder: string; terminalName?: string },
  file: OpenFile | null,
): Selection {
  const on = workspace.terminalName ? { on: workspace.terminalName } : {}
  if (!file) {
    return { items: [{ kind: 'file', terminal: workspace.terminal, path: workspace.folder, folder: true }] }
  }
  const item: FileItem = { kind: 'file', terminal: workspace.terminal, path: String(file.path), ...on }
  const highlight = file.highlight
  if (highlight && String(highlight.text)) {
    const from = Number(highlight.startLine)
    const end = Number(highlight.endLine)
    // A highlight that ends at the very start of a line (a whole-line
    // selection by Shift+Down or a triple click) holds nothing of that line.
    // It always spans two lines: within one line it would be empty.
    const to = Number(highlight.endColumn) === 1 ? end - 1 : end
    item.lines = { from, to }
    item.text = String(highlight.text)
  }
  return { items: [item] }
}
