import { ChatDock as HostChatDock, SelectionProvider, useSelection } from '@opencroft/client/chat'
import { type ReactNode, useEffect } from 'react'

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
  useEffect(() => {
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
export function ChatDock({
  space,
  threadId,
  selection,
  children,
}: {
  space: string
  threadId: string
  selection: ChatSelection | null
  children: ReactNode
}) {
  return (
    <SelectionProvider>
      <HostChatDock space={space} id={threadId} title={`Chat · ${space}`}>
        <SelectionBridge selection={selection} />
        <div className='flex min-h-0 min-w-0 flex-1 flex-col'>{children}</div>
      </HostChatDock>
    </SelectionProvider>
  )
}
