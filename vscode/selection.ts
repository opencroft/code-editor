import { getService, ICodeEditorService } from '@codingame/monaco-vscode-api'

import type { Bridge } from './bridge'

const MAX_SELECTION_CHARS = 20_000

/**
 * Tells the App what the reader has open, for the chat beside the editor: a
 * reference to what is open and how the agent reaches it itself (this App's
 * actions, or its own remote tools on the same terminal) — plus the selected
 * text, which only the editor can give.
 * The host shows `label` as a badge and sends `content` with the next message
 * while the reader's pass toggle is on.
 */
export async function publishSelection(bridge: Bridge): Promise<void> {
  const editors = await getService(ICodeEditorService)
  let timer: ReturnType<typeof setTimeout> | undefined

  const reach = (path: string) =>
    [
      `Read or write it with app_call on ${bridge.app}: read {"terminal":"${bridge.terminal}","path":"${path}"} / write {..., "content": ...},`,
      `or with the remote_* tools on target "${bridge.terminal}".`,
    ].join('\n')

  const workspace = () => [
    `Code Editor App ${bridge.app}: VS Code on terminal "${bridge.terminal}", folder ${bridge.folder}.`,
  ]

  const publish = () => {
    const editor = editors.getFocusedCodeEditor() ?? editors.getActiveCodeEditor()
    const model = editor?.getModel()
    const folderName = bridge.folder.split('/').filter(Boolean).pop() ?? '/'
    if (!editor || !model || model.uri.scheme !== 'file') {
      bridge.onSelection({ label: folderName, content: [...workspace(), reach(bridge.folder)].join('\n') })
      return
    }
    const path = model.uri.path
    const name = path.slice(path.lastIndexOf('/') + 1)
    const lines = [...workspace(), `Open file: ${path} (${model.getLanguageId()}, ${model.getLineCount()} lines).`]
    const selection = editor.getSelection()
    let label = name
    if (selection && !selection.isEmpty()) {
      const { startLineNumber: from, endLineNumber: to } = selection
      const text = model.getValueInRange(selection)
      label = `${name}:${from}${to !== from ? `-${to}` : ''}`
      lines.push(`Selected ${to !== from ? `lines ${from}-${to}` : `line ${from}`}:`)
      lines.push(`\`\`\`${model.getLanguageId()}`, text.slice(0, MAX_SELECTION_CHARS), '```')
      if (text.length > MAX_SELECTION_CHARS) {
        lines.push(`(selection cut at ${MAX_SELECTION_CHARS} of ${text.length} characters)`)
      }
    } else {
      const position = editor.getPosition()
      if (position) {
        label = `${name}:${position.lineNumber}`
        lines.push(`Cursor at line ${position.lineNumber}, column ${position.column}.`)
      }
    }
    lines.push(reach(path))
    bridge.onSelection({ label, content: lines.join('\n') })
  }

  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(publish, 250)
  }

  const watch = (editor: ReturnType<typeof editors.listCodeEditors>[number]) => {
    editor.onDidChangeCursorSelection(schedule)
    editor.onDidFocusEditorText(schedule)
    editor.onDidChangeModel(schedule)
  }
  editors.listCodeEditors().forEach(watch)
  editors.onCodeEditorAdd(watch)
  publish()
}
