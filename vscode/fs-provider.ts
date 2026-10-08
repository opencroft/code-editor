import { Emitter, Event } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event'
import { Disposable, type IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle'
import type { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri'
import {
  FileSystemProviderCapabilities,
  FileSystemProviderError,
  FileSystemProviderErrorCode,
  FileType,
  type IFileDeleteOptions,
  type IFileOverwriteOptions,
  type IFileSystemProviderWithFileReadWriteCapability,
  type IFileWriteOptions,
  type IStat,
} from '@codingame/monaco-vscode-files-service-override'

import type { Bridge } from './bridge'

const ERROR_CODES: Record<string, FileSystemProviderErrorCode> = {
  ENOENT: FileSystemProviderErrorCode.FileNotFound,
  EEXIST: FileSystemProviderErrorCode.FileExists,
  EISDIR: FileSystemProviderErrorCode.FileIsADirectory,
  ENOTDIR: FileSystemProviderErrorCode.FileNotADirectory,
  EACCES: FileSystemProviderErrorCode.NoPermissions,
  EFBIG: FileSystemProviderErrorCode.FileTooLarge,
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * `file://` as seen from the opened terminal: every operation is one of the
 * App's file actions on that terminal. Errors come back as "<CODE>: path" and
 * are turned into the provider errors VS Code tells apart (a missing file must
 * be FileNotFound, or settings and recent-file lookups report failures).
 */
export class TerminalFileSystemProvider implements IFileSystemProviderWithFileReadWriteCapability {
  readonly capabilities = FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.PathCaseSensitive
  readonly onDidChangeCapabilities = Event.None
  private readonly changes = new Emitter<readonly import('@codingame/monaco-vscode-files-service-override').IFileChange[]>()
  readonly onDidChangeFile = this.changes.event

  constructor(private readonly bridge: Bridge) {}

  private async call<T>(action: string, params: Record<string, unknown>): Promise<T> {
    try {
      return await this.bridge.call<T>(action, { terminal: this.bridge.terminal, ...params })
    } catch (err) {
      // Thrown in the App's window, so not an instance of this window's Error.
      const message = (err as { message?: string } | null)?.message ?? String(err)
      const code = ERROR_CODES[/\b(E[A-Z]+):/.exec(message)?.[1] ?? '']
      throw FileSystemProviderError.create(message, code ?? FileSystemProviderErrorCode.Unknown)
    }
  }

  watch(): IDisposable {
    // No change notifications from a terminal; edits made elsewhere show on refresh.
    return Disposable.None
  }

  async stat(resource: URI): Promise<IStat> {
    const s = await this.call<{ type: FileType; size: number; mtime: number }>('stat', { path: resource.path })
    return { type: s.type, size: s.size, mtime: s.mtime, ctime: s.mtime }
  }

  async readdir(resource: URI): Promise<[string, FileType][]> {
    return (await this.call<{ entries: [string, FileType][] }>('readdir', { path: resource.path })).entries
  }

  async readFile(resource: URI): Promise<Uint8Array> {
    return fromBase64((await this.call<{ base64: string }>('readFile', { path: resource.path })).base64)
  }

  async writeFile(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void> {
    await this.call('writeFile', { path: resource.path, base64: toBase64(content), create: opts.create, overwrite: opts.overwrite })
  }

  async mkdir(resource: URI): Promise<void> {
    await this.call('mkdir', { path: resource.path })
  }

  async delete(resource: URI, opts: IFileDeleteOptions): Promise<void> {
    await this.call('delete', { path: resource.path, recursive: opts.recursive })
  }

  async rename(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void> {
    await this.call('rename', { from: from.path, to: to.path, overwrite: opts.overwrite })
  }
}
