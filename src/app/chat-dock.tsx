import host, { React } from '@ext/host'

// The host's chat surface, taken off the host object (the shim's named exports
// do not include it) and read defensively, so a host without it renders the
// editor alone.
const HostChatDock = host?.ChatDock
const SelectionProvider = host?.SelectionProvider
const useSelection = host?.useSelection

const chatDockSupported = Boolean(HostChatDock && SelectionProvider && useSelection)

export interface ChatSelection {
  label: string
  content: string
}

// Publishes what the editor reports into the host's selection scope. Renders
// nothing; it is its own component because the hook must run inside the provider.
function SelectionBridge({ selection }: { selection: ChatSelection | null }) {
  const { setSelection, clearSelection } = useSelection()
  const label = selection?.label ?? ''
  const content = selection?.content ?? ''
  React.useEffect(() => {
    if (!label) {
      clearSelection()
      return
    }
    setSelection({ label, content })
    // Keyed on the values: the editor reports a fresh object every time.
  }, [label, content, setSelection, clearSelection])
  return null
}

/** The editor with the space's chat beside it, and what the reader has selected passed into it. */
export function ChatDock({ space, threadId, selection, children }: {
  space: string
  threadId: string
  selection: ChatSelection | null
  children: React.ReactNode
}) {
  if (!chatDockSupported) {
    return <>{children}</>
  }
  return (
    <SelectionProvider>
      <HostChatDock space={space} id={threadId} title={`Chat · ${space}`}>
        <SelectionBridge selection={selection} />
        <div className='flex min-h-0 min-w-0 flex-1 flex-col'>{children}</div>
      </HostChatDock>
    </SelectionProvider>
  )
}
