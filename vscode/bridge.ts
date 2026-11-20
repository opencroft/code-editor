/**
 * What the Code Editor App hands its VS Code page. The page runs in an iframe
 * of the same origin (the extension's "vscode" route), and the App sets this on
 * the iframe element before navigating it, so the page reaches it through
 * `window.frameElement`.
 */
export interface Bridge {
  /** The App instance's action, run as the signed-in person (callAppAction). */
  call<T = unknown>(action: string, params: Record<string, unknown>): Promise<T>
  /** "node-id/handle-id" of the terminal the folder was opened on. */
  terminal: string
  /** The opened folder, absolute. */
  folder: string
  dark: boolean
  /** Ask the App to show its terminal and folder picker. */
  openFolder(): void
  /** The file the reader has open and what is highlighted in it, for the App's chat; null when no file is open. */
  onOpenFile(file: OpenFile | null): void
  /** The title bar's logo spot, for the App to render the opened workspace into. */
  onTitleSlot(slot: HTMLElement): void
}

/** A file open in the editor, as the page reports it. */
export interface OpenFile {
  /** Absolute, on the opened terminal. */
  path: string
  /**
   * The highlighted text, from the editor's buffer (so unsaved edits are in
   * it), and where it is: 1-based lines, and the column it ends before.
   * Absent when nothing is highlighted.
   */
  highlight?: { startLine: number; endLine: number; endColumn: number; text: string }
}

export function getBridge(): Bridge {
  const bridge = (window.frameElement as (Element & { __ocBridge?: Bridge }) | null)?.__ocBridge
  if (!bridge) {
    throw new Error('The Code Editor page was opened outside its App')
  }
  return bridge
}
