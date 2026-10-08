import { React, routeUrl } from '@ext/host'
import { type AppComponentProps, callAppAction, describeGraphRefs, type GraphRefDescription, legacy, TerminalSelector } from '@opencroft/client'
import { FolderOpen } from 'lucide-react'
import { createPortal } from 'react-dom'

import { ChatDock, type ChatSelection } from './chat-dock'


const { useEffect, useRef, useState } = React

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

function OpenForm({ instanceId, spaceSlug, initial, onOpen, onCancel }: {
  instanceId: string
  spaceSlug: string
  initial?: Workspace
  onOpen: (w: Workspace) => void
  onCancel?: () => void
}) {
  const [terminal, setTerminal] = useState(initial?.terminal ?? '')
  // Empty means the terminal's own starting folder, asked of it on Open.
  const [folder, setFolder] = useState(initial?.folder ?? '')
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const valid = Boolean(terminal) && (!folder.trim() || folder.trim().startsWith('/'))

  const submit = async () => {
    setError(undefined)
    let path = folder.trim()
    if (!path) {
      setOpening(true)
      try {
        path = (await callAppAction<{ folder: string }>(instanceId, 'defaultFolder', { terminal })).folder
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return
      } finally {
        setOpening(false)
      }
    }
    onOpen({ terminal, folder: path })
  }

  return (
    <form
      className='mx-auto flex w-full max-w-md flex-col gap-3 p-6'
      onSubmit={(e) => {
        e.preventDefault()
        if (valid && !opening) {
          void submit()
        }
      }}
    >
      <div className='text-base font-medium'>Open a folder</div>
      <label className='flex flex-col gap-1 text-sm'>
        Terminal
        <TerminalSelector spaceSlug={spaceSlug} value={terminal} onChange={setTerminal} placeholder='Pick a terminal' />
      </label>
      <label className='flex flex-col gap-1 text-sm'>
        Folder
        <input
          className='h-9 rounded-md border border-input bg-background px-2 font-mono text-sm'
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="The terminal's own folder"
        />
      </label>
      {error && <div className='text-sm text-destructive'>{error}</div>}
      <div className='flex gap-2'>
        {onCancel && (
          <button
            type='button'
            onClick={onCancel}
            className='inline-flex h-9 flex-1 items-center justify-center rounded-md border px-3 text-sm hover:bg-muted'
          >
            Cancel
          </button>
        )}
        <button
          type='submit'
          disabled={!valid || opening}
          className='inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/80 disabled:opacity-50'
        >
          <FolderOpen className='size-4' />
          {opening ? 'Opening…' : 'Open'}
        </button>
      </div>
    </form>
  )
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
  const iconSet = legacy.icons as unknown as Record<string, React.ComponentType<{ size?: number }>>
  const Icon = (desc?.icon && iconSet[desc.icon]) || iconSet.SquareTerminal
  const name = desc ? (desc.detail ? `${desc.name} · ${desc.detail}` : desc.name) : workspace.terminal
  const tooltip = [`Terminal: ${name}`, `cwd: ${workspace.folder}`, 'Click to open another terminal or folder'].join('\n')
  return (
    <span title={tooltip} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', fontSize: 12, maxWidth: 280 }}>
      {Icon && <Icon size={14} />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
    </span>
  )
}

function Workbench({ instanceId, workspace, onOpenFolder, onSelection }: {
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
        callbacks.current.onSelection(selection ? { label: String(selection.label), content: String(selection.content) } : null),
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

  if (!workspace) {
    return (
      <div className='flex h-full min-h-0 flex-col'>
        <OpenForm instanceId={instanceId} spaceSlug={spaceSlug} onOpen={open} />
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
      {picking && (
        <div className='absolute inset-0 z-10 flex items-start justify-center bg-background/80 pt-[10vh] backdrop-blur-sm'>
          <div className='w-full max-w-md rounded-lg border bg-background shadow-lg'>
            <OpenForm instanceId={instanceId} spaceSlug={spaceSlug} initial={workspace} onOpen={open} onCancel={() => setPicking(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
