import { Emitter } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event'
import {
  type ITerminalChildProcess,
  SimpleTerminalBackend,
  SimpleTerminalProcess,
} from '@codingame/monaco-vscode-terminal-service-override'

import type { Bridge } from './bridge'

interface Connection {
  type: 'ssh' | 'local' | 'wsl'
  config: Record<string, unknown>
}

// The host's terminal socket names the opening message by connection type
// (connectMessage in @opencroft/terminal's client).
const OPEN_MESSAGE: Record<Connection['type'], string> = { ssh: 'connect', local: 'local', wsl: 'wsl' }

let nextId = 1

/**
 * The cwd VS Code asks for, as a path on the terminal. VS Code hands it over in
 * the browser's OS style, so a reader on Windows sends "\\srv\\app" for
 * /srv/app; the terminal is always POSIX.
 */
function terminalPath(cwd: unknown): string {
  const raw = typeof cwd === 'string' ? cwd : ((cwd as { path?: string } | undefined)?.path ?? '')
  return raw.replace(/^[a-zA-Z]:(?=[\\/])/, '').replace(/\\/g, '/')
}

/**
 * VS Code's integrated terminal over the host's terminal socket
 * (/api/ws/terminal), opened on the editor's terminal in the requested cwd —
 * the opened folder unless VS Code asks for another. No session key: closing
 * the terminal closes the socket, and an unkeyed session ends with it.
 */
export class HostTerminalBackend extends SimpleTerminalBackend {
  constructor(private readonly bridge: Bridge) {
    super()
  }

  override getDefaultSystemShell = async (): Promise<string> => 'sh'

  override createProcess = async (
    _shellLaunchConfig: unknown,
    cwd: string,
    cols: number,
    rows: number,
  ): Promise<ITerminalChildProcess> => {
    const bridge = this.bridge
    const dir = terminalPath(cwd) || bridge.folder
    const data = new Emitter<string>()
    const exit = new Emitter<number | undefined>()

    class HostTerminalProcess extends SimpleTerminalProcess {
      private socket?: WebSocket
      private size = { cols, rows }

      async start(): Promise<undefined> {
        const connection = await bridge.call<Connection>('terminalConnection', { terminal: bridge.terminal, cwd: dir })
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const socket = new WebSocket(`${protocol}//${window.location.host}/api/ws/terminal`)
        this.socket = socket
        socket.onopen = () => {
          socket.send(
            JSON.stringify({
              type: OPEN_MESSAGE[connection.type] ?? 'local',
              payload: { ...connection.config, cols: this.size.cols, rows: this.size.rows },
            }),
          )
        }
        socket.onmessage = (event) => {
          let msg: { type: string; payload?: { data?: string; message?: string; reason?: string } }
          try {
            msg = JSON.parse(String(event.data))
          } catch {
            return
          }
          if (msg.type === 'data' && msg.payload?.data) {
            data.fire(msg.payload.data)
          } else if (msg.type === 'error') {
            data.fire(`\r\n\x1b[31m[${msg.payload?.message ?? 'error'}]\x1b[0m\r\n`)
          } else if (msg.type === 'disconnected') {
            exit.fire(0)
          }
        }
        socket.onclose = () => exit.fire(undefined)
        return undefined
      }

      override input(text: string): void {
        if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({ type: 'data', payload: { data: text } }))
        }
      }

      resize(c: number, r: number): void {
        this.size = { cols: c, rows: r }
        if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({ type: 'resize', payload: { cols: c, rows: r } }))
        }
      }

      override shutdown(): void {
        this.socket?.close()
      }

      override clearBuffer(): void {}

      override sendSignal(): void {}
    }

    const process = new HostTerminalProcess(nextId++, 0, dir, data.event)
    ;(process as unknown as { onProcessExit: typeof exit.event }).onProcessExit = exit.event
    return process
  }
}
