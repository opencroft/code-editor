import { getService, ICodeEditorService } from '@codingame/monaco-vscode-api'

import type { Bridge } from './bridge'

/**
 * Tells the App which file the reader has open and what is highlighted in it,
 * for the chat beside the editor. The App turns the report into the items of
 * its selection (src/app/editor-selection.ts); only the editor knows the
 * highlighted text, which may hold edits not yet saved.
 */
export async function reportOpenFile(bridge: Bridge): Promise<void> {
  const editors = await getService(ICodeEditorService)
  let timer: ReturnType<typeof setTimeout> | undefined

  const report = () => {
    const editor = editors.getFocusedCodeEditor() ?? editors.getActiveCodeEditor()
    const model = editor?.getModel()
    if (!editor || !model || model.uri.scheme !== 'file') {
      bridge.onOpenFile(null)
      return
    }
    const selection = editor.getSelection()
    bridge.onOpenFile({
      path: model.uri.path,
      highlight:
        selection && !selection.isEmpty()
          ? {
              startLine: selection.startLineNumber,
              endLine: selection.endLineNumber,
              endColumn: selection.endColumn,
              text: model.getValueInRange(selection),
            }
          : undefined,
    })
  }

  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(report, 250)
  }

  const watch = (editor: ReturnType<typeof editors.listCodeEditors>[number]) => {
    editor.onDidChangeCursorSelection(schedule)
    editor.onDidChangeModelContent(schedule)
    editor.onDidFocusEditorText(schedule)
    editor.onDidChangeModel(schedule)
  }
  editors.listCodeEditors().forEach(watch)
  editors.onCodeEditorAdd(watch)
  // A removed editor may have held the open file, and removal is not a model change.
  editors.onCodeEditorRemove(schedule)
  report()
}
