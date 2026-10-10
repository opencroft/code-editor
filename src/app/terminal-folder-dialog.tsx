'use client'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@opencroft/client/ui'
import { FolderOpen, Loader2 } from 'lucide-react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { useId, useState } from 'react'

/** A terminal and a folder on it. An empty folder means the terminal's own. */
export interface TerminalFolder {
  /** The terminal as the host's picker names it, e.g. "node-id/handle-id". */
  terminal: string
  folder: string
}

export interface TerminalPickerSlot {
  value: string
  onChange: (value: string) => void
}

export interface TerminalFolderFormProps {
  /**
   * Draws the terminal field. The host's picker knows where terminals come
   * from; this form only holds which one is chosen.
   */
  renderTerminalPicker: (slot: TerminalPickerSlot) => ReactNode
  /** What the fields start with. Read when the form mounts. */
  defaultValue?: Partial<TerminalFolder>
  /**
   * Called with the choice. While a returned promise is pending the form shows
   * progress; a rejection keeps the fields as they are and shows its message.
   */
  onSubmit: (value: TerminalFolder) => void | Promise<void>
  /** Shown as a Cancel button when given. */
  onCancel?: () => void
  submitLabel?: string
}

/** The fields and buttons, for a page of their own. */
export function TerminalFolderForm({
  renderTerminalPicker,
  defaultValue,
  onSubmit,
  onCancel,
  submitLabel = 'Open',
}: TerminalFolderFormProps) {
  const folderId = useId()
  const [terminal, setTerminal] = useState(defaultValue?.terminal ?? '')
  const [folder, setFolder] = useState(defaultValue?.folder ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const path = folder.trim()
  // A relative path would be read against wherever the terminal happens to
  // start, which is the empty field's meaning already, said less plainly.
  const folderValid = !path || path.startsWith('/')
  const valid = Boolean(terminal) && folderValid

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!valid || busy) {
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await onSubmit({ terminal, folder: path })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className='flex flex-col gap-4' onSubmit={submit}>
      <fieldset className='min-w-0'>
        <legend className='mb-2 text-sm font-medium'>Terminal</legend>
        {renderTerminalPicker({ value: terminal, onChange: setTerminal })}
      </fieldset>
      <div className='flex flex-col gap-2'>
        <Label htmlFor={folderId}>Folder</Label>
        <Input
          id={folderId}
          value={folder}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setFolder(event.target.value)}
          placeholder="The terminal's own folder"
          aria-invalid={!folderValid || undefined}
          className='font-mono'
        />
        {!folderValid ? (
          <p className='text-xs text-destructive'>A folder is an absolute path, starting with /.</p>
        ) : null}
      </div>
      {error ? (
        <p role='alert' className='rounded-md bg-destructive/10 px-3 py-2 text-sm whitespace-pre-wrap text-destructive'>
          {error}
        </p>
      ) : null}
      <div className='flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'>
        {onCancel ? (
          <Button type='button' variant='outline' onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type='submit' disabled={!valid || busy}>
          {busy ? <Loader2 className='animate-spin' /> : <FolderOpen />}
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

export interface TerminalFolderDialogProps extends Omit<TerminalFolderFormProps, 'onCancel'> {
  open: boolean
  /** Called with `false` on Cancel, Escape, the backdrop, and after a successful open. */
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
}

/** The same form over a running app, which stays as it is until a choice is made. */
export function TerminalFolderDialog({
  open,
  onOpenChange,
  title = 'Open a folder',
  description = 'Choose a terminal, and the folder on it to open.',
  onSubmit,
  ...form
}: TerminalFolderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {/* Mounted with the dialog, so each opening starts from defaultValue. */}
        {open ? (
          <TerminalFolderForm
            {...form}
            onSubmit={async (value) => {
              await onSubmit(value)
              onOpenChange(false)
            }}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
