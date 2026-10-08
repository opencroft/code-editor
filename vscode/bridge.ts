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
  /** This App instance's address, `<space>.<slug>` — what `app_call` takes. */
  app: string
  dark: boolean
  /** Ask the App to show its terminal and folder picker. */
  openFolder(): void
  /** What the reader has open or selected, for the App's chat; null for nothing. */
  onSelection(selection: ChatSelection | null): void
  /** The title bar's logo spot, for the App to render the opened workspace into. */
  onTitleSlot(slot: HTMLElement): void
}

/** As the host's selection scope takes it: `label` is shown, `content` is sent. */
export interface ChatSelection {
  label: string
  content: string
}

export function getBridge(): Bridge {
  const bridge = (window.frameElement as (Element & { __ocBridge?: Bridge }) | null)?.__ocBridge
  if (!bridge) {
    throw new Error('The Code Editor page was opened outside its App')
  }
  return bridge
}
