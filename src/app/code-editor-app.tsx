import { callAppAction } from '@opencroft/client/actions'
import type { AppComponentProps } from '@opencroft/client/app'
import { routeUrl } from '@opencroft/client/extension'
import { describeGraphRefs, type GraphRefDescription } from '@opencroft/client/graph'
import { TerminalSelector } from '@opencroft/client/terminal'
import * as lucide from 'lucide-react'
import { type LucideIcon, SquareTerminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ChatDock, type ChatSelection } from './chat-dock'
import {
  type TerminalFolder,
  TerminalFolderDialog,
  TerminalFolderForm,
  type TerminalPickerSlot,
} from './terminal-folder-dialog'

// The space's main conversation.
const CHAT_THREAD_ID = 'main'

/** A terminal and a folder on it: what the editor opens, in place of VS Code's "Open Folder". */
interface Workspace {
  terminal: string
  folder: string
}

// The workspace opened last in this instance, per browser.
function storageKey(instanceId: string): string {
  return `code-editor:${instanceId}:workspace`
}

function readWorkspace(instanceId: string): Workspace | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(instanceId)) ?? 'null')
    return value?.terminal && value?.folder ? value : undefined
  } catch {
    return undefined
  }
}

// The terminal field of the kit's form: the host's picker, limited to this space.
function terminalPicker(spaceSlug: string) {
  return ({ value, onChange }: TerminalPickerSlot) => (
    <TerminalSelector spaceSlug={spaceSlug} value={value} onChange={onChange} placeholder='Pick a terminal' />
  )
}

// The directory bit of the `stat` action's `type`, which is VS Code's FileType
// (FileType.Directory), as the server's FILE_TYPE spells out.
const FILE_TYPE_DIRECTORY = 2

// An empty folder is the terminal's own starting folder, asked of it on Open.
// A typed one must be a folder on that terminal: the editor would otherwise
// open on nothing, where no file can be created. A failure rejects, which the
// form shows under its fields.
async function resolveWorkspace(instanceId: string, choice: TerminalFolder): Promise<Workspace> {
  if (!choice.folder) {
    const { folder } = await callAppAction<{ folder: string }>(instanceId, 'defaultFolder', {
      terminal: choice.terminal,
    })
    return { terminal: choice.terminal, folder }
  }
  const found = await callAppAction<{ type: number }>(instanceId, 'stat', {
    terminal: choice.terminal,
    path: choice.folder,
  }).catch((err: unknown) => {
    // The action's errors start with the file-system code ("ENOENT: /path").
    if (err instanceof Error && err.message.startsWith('ENOENT')) {
      throw new Error(`There is no folder ${choice.folder} on this terminal.`)
    }
    throw err
  })
  if (!(found.type & FILE_TYPE_DIRECTORY)) {
    throw new Error(`${choice.folder} is a file, not a folder.`)
  }
  return choice
}

/**
 * The opened workspace in VS Code's title bar, where its logo was: the
 * terminal as TerminalRef shows it (its type's icon and name), the terminal
 * and folder on hover. Rendered into the VS Code page, which has none of
 * OpenCroft's styles, so it styles itself and takes the title bar's colour.
 */
function WorkspaceBadge({ workspace }: { workspace: Workspace }) {
  const [desc, setDesc] = useState<GraphRefDescription | null>(null)
  useEffect(() => {
    let live = true
    describeGraphRefs([workspace.terminal])
      .then((refs) => live && setDesc(refs[workspace.terminal] ?? null))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [workspace.terminal])
  // The icon is named by data, so it is looked up on the module. The host's
  // icon set draws a placeholder for a name it does not have, but this
  // namespace is the bundler's copy of its exports, where such a name is
  // `undefined`: the terminal's own icon stands in for it.
  const Icon =
    (desc?.icon ? ((lucide as Record<string, unknown>)[desc.icon] as LucideIcon) : undefined) ?? SquareTerminal
  const name = desc ? (desc.detail ? `${desc.name} · ${desc.detail}` : desc.name) : workspace.terminal
  const tooltip = [`Terminal: ${name}`, `cwd: ${workspace.folder}`, 'Click to open another terminal or folder'].join(
    '\n',
  )
  return (
    <span
      title={tooltip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        whiteSpace: 'nowrap',
        fontSize: 12,
        maxWidth: 280,
      }}
    >
      <Icon size={14} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
    </span>
  )
}

function Workbench({
  instanceId,
  workspace,
  onOpenFolder,
  onSelection,
}: {
  instanceId: string
  workspace: Workspace
  onOpenFolder: () => void
  onSelection: (selection: ChatSelection | null) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  // The instance's address, for the chat reference; the props only carry its id.
  const [app, setApp] = useState<string>()
  useEffect(() => {
    let live = true
    callAppAction<{ address: string }>(instanceId, 'appInfo', {})
      .then((info) => live && setApp(info.address))
      .catch(() => live && setApp(instanceId))
    return () => {
      live = false
    }
  }, [instanceId])
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null)
  const callbacks = useRef({ onOpenFolder, onSelection })
  callbacks.current = { onOpenFolder, onSelection }

  useEffect(() => {
    const el = frame.current
    if (!el || !app) {
      return
    }
    // The page (served by the extension's "vscode" route) is same-origin, so it
    // reaches this on its iframe element. Set before navigating, so the page's
    // script always finds it; the query only makes each workspace a fresh load.
    const dark = document.documentElement.classList.contains('dark')
    ;(el as HTMLIFrameElement & { __ocBridge?: unknown }).__ocBridge = {
      // The page's objects belong to its own window, whose Object.prototype the
      // host's serializer does not recognise, so params are copied into this one.
      call: (action: string, params: Record<string, unknown>) =>
        callAppAction(instanceId, action, JSON.parse(JSON.stringify(params)) as Record<string, unknown>),
      terminal: workspace.terminal,
      folder: workspace.folder,
      app,
      dark,
      openFolder: () => callbacks.current.onOpenFolder(),
      // Copied out of the page's window into plain strings of this one.
      onSelection: (selection: ChatSelection | null) =>
        callbacks.current.onSelection(
          selection ? { label: String(selection.label), content: String(selection.content) } : null,
        ),
      onTitleSlot: (slot: HTMLElement) => setTitleSlot(slot),
    }
    el.src = `${routeUrl('vscode')}?theme=${dark ? 'dark' : 'light'}&workspace=${encodeURIComponent(`${workspace.terminal}:${workspace.folder}`)}`
  }, [instanceId, app, workspace.terminal, workspace.folder])

  return (
    <>
      <iframe ref={frame} title='Code Editor' className='min-h-0 w-full flex-1 border-0 bg-background' />
      {titleSlot && createPortal(<WorkspaceBadge workspace={workspace} />, titleSlot)}
    </>
  )
}

/** The Code Editor App: VS Code's workbench on a folder of one of the space's terminals. */
export function CodeEditorApp({ instanceId, spaceSlug }: AppComponentProps) {
  const [workspace, setWorkspace] = useState(() => readWorkspace(instanceId))
  const [picking, setPicking] = useState(!workspace)
  const [selection, setSelection] = useState<ChatSelection | null>(null)

  const open = (next: Workspace) => {
    localStorage.setItem(storageKey(instanceId), JSON.stringify(next))
    setWorkspace(next)
    setPicking(false)
  }

  const submit = async (choice: TerminalFolder) => open(await resolveWorkspace(instanceId, choice))

  if (!workspace) {
    return (
      <div className='flex h-full min-h-0 flex-col'>
        <div className='mx-auto flex w-full max-w-md flex-col gap-3 p-6'>
          <div className='text-base font-medium'>Open a folder</div>
          <TerminalFolderForm renderTerminalPicker={terminalPicker(spaceSlug)} onSubmit={submit} />
        </div>
      </div>
    )
  }

  return (
    <div className='relative flex h-full min-h-0 flex-col'>
      <ChatDock space={spaceSlug} threadId={CHAT_THREAD_ID} selection={selection}>
        <Workbench
          key={`${workspace.terminal}:${workspace.folder}`}
          instanceId={instanceId}
          workspace={workspace}
          onOpenFolder={() => setPicking(true)}
          onSelection={setSelection}
        />
      </ChatDock>
      {/* Over the running editor rather than instead of it: VS Code, its unsaved
          edits and its terminals stay until another folder is actually opened. */}
      <TerminalFolderDialog
        open={picking}
        onOpenChange={setPicking}
        defaultValue={workspace}
        renderTerminalPicker={terminalPicker(spaceSlug)}
        onSubmit={submit}
      />
    </div>
  )
}
