import { type AppActionContext, type AppsExport, type HostAppInstance, apps as hostApps } from '@opencroft/server/apps'
import { graph } from '@opencroft/server/graph'
import {
  type ExecOptions,
  type ExecResult,
  type TerminalContext,
  terminal as terminalApi,
} from '@opencroft/server/terminal'

import { FS_SCRIPT } from './fs-script'

export { routes } from './routes'

// Every action names the terminal it works on ("node-id/handle-id"), and that
// terminal must belong to the instance's own space: an instance reaches the
// terminals of the space it was added to and nothing else.

const MAX_READ_BYTES = 50 * 1024 * 1024
// One write chunk travels in an environment variable, and a single variable is
// capped near 128 KB by the kernel, so content goes over in pieces below that.
const WRITE_CHUNK_CHARS = 96_000
const TERMINAL_CONTEXT_HANDLE_TYPE = 'builtin.core.terminal-context'

type Params = Record<string, unknown>

// Which terminals a space has comes from the host's listHandles, which walks
// every graph and expands every dynamic handle (each Git worktree, each running
// container) — seconds, where the file operation itself takes a fraction of
// one. So it runs once per space for a burst of calls, it is
// warmed when the App loads, and a terminal found there once is not waited on
// again: past its freshness it is re-checked in the background while the
// operation goes ahead (a terminal that has since left the space is refused
// from the next call on).
const HANDLES_TTL_MS = 60_000
const AUTHORISED_TTL_MS = 10 * 60_000
const spaceTerminals = new Map<string, { at: number; pending: boolean; terminals: Promise<Set<string>> }>()
const authorised = new Map<string, number>()

function terminalsOf(space: string, refresh = false): Promise<Set<string>> {
  const cached = spaceTerminals.get(space)
  // One fetch at a time per space: a refresh joins the one already under way.
  if (cached && (cached.pending || (!refresh && Date.now() - cached.at < HANDLES_TTL_MS))) {
    return cached.terminals
  }
  const entry = { at: Date.now(), pending: true, terminals: Promise.resolve(new Set<string>()) }
  entry.terminals = graph
    .listHandles({ role: 'source', handleType: TERMINAL_CONTEXT_HANDLE_TYPE })
    .then((handles) => new Set(handles.filter((h) => h.spaceSlug === space).map((h) => `${h.nodeId}/${h.handleId}`)))
    .finally(() => {
      entry.pending = false
    })
  entry.terminals.catch(() => {
    if (spaceTerminals.get(space) === entry) {
      spaceTerminals.delete(space)
    }
  })
  spaceTerminals.set(space, entry)
  return entry.terminals
}

async function terminalOf(ctx: AppActionContext, params: Params): Promise<TerminalContext> {
  const terminal = typeof params.terminal === 'string' ? params.terminal : ''
  const slash = terminal.indexOf('/')
  if (slash <= 0) {
    throw new Error('"terminal" is required, as "node-id/handle-id"')
  }
  const key = `${ctx.spaceSlug}|${terminal}`
  const fresh = authorised.get(key)
  if (fresh === undefined) {
    // A list of any age that has the terminal will do (the warm one from load,
    // typically); one that lacks it is fetched again before refusing, since the
    // terminal may simply be newer than the list.
    const known = await spaceTerminals.get(ctx.spaceSlug)?.terminals.catch(() => undefined)
    if (!known?.has(terminal) && !(await terminalsOf(ctx.spaceSlug, true)).has(terminal)) {
      throw new Error(`Terminal "${terminal}" is not in space "${ctx.spaceSlug}"`)
    }
    authorised.set(key, Date.now() + AUTHORISED_TTL_MS)
  } else if (fresh < Date.now()) {
    authorised.set(key, Date.now() + AUTHORISED_TTL_MS)
    terminalsOf(ctx.spaceSlug)
      .then((terminals) => {
        if (!terminals.has(terminal)) {
          authorised.delete(key)
        }
      })
      .catch(() => {})
  }
  return terminalApi.getContext(terminal.slice(0, slash), terminal.slice(slash + 1))
}

/** Normalise an absolute path: collapse "." and "..", never above "/". */
function absolute(raw: unknown): string {
  const parts: string[] = []
  for (const part of String(raw ?? '').split('/')) {
    if (!part || part === '.') {
      continue
    }
    if (part === '..') {
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return `/${parts.join('/')}`
}

// VS Code fires file operations in bursts (a folder expanding stats every
// entry), and over ssh each one is a channel on the host's pooled connection
// to that machine — one connection shared with everything else reaching it,
// agents' remote tools included — which sshd caps (MaxSessions, 10 by
// default); past it the channel open fails. So at most 8 run per machine
// at a time, leaving a little of the cap to everyone else, and a refused
// channel is retried.
const MAX_CONCURRENT_PER_MACHINE = 8
const CHANNEL_RETRIES = 3
const lanes = new Map<string, { running: number; waiting: (() => void)[] }>()

async function inLane<T>(key: string, run: () => Promise<T>): Promise<T> {
  let lane = lanes.get(key)
  if (!lane) {
    lane = { running: 0, waiting: [] }
    lanes.set(key, lane)
  }
  const { waiting } = lane
  if (lane.running >= MAX_CONCURRENT_PER_MACHINE) {
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  lane.running++
  try {
    return await run()
  } finally {
    lane.running--
    lane.waiting.shift()?.()
  }
}

function isChannelRefusal(err: unknown): boolean {
  return /channel open failure|open failed/i.test(err instanceof Error ? err.message : String(err))
}

/** The machine a context's commands run on: its ssh endpoint, or this host. */
function machineOf(terminal: TerminalContext): string {
  const ssh = terminal.type === 'ssh' ? terminal : terminal.via?.type === 'ssh' ? terminal.via : undefined
  return ssh ? `ssh:${ssh.username ?? ''}@${ssh.host ?? ''}:${ssh.port ?? 22}` : 'local'
}

async function runLimited(terminal: TerminalContext, args: string[], opts: ExecOptions): Promise<ExecResult> {
  const key = machineOf(terminal)
  for (let attempt = 0; ; attempt++) {
    try {
      return await inLane<ExecResult>(key, () => terminalApi.runResult(terminal, args, opts))
    } catch (err) {
      if (attempt >= CHANNEL_RETRIES || !isChannelRefusal(err)) {
        throw err
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt))
    }
  }
}

function flag(value: unknown): string {
  return value ? '1' : '0'
}

/**
 * Run one fs.sh operation. A failure the script names becomes an Error whose
 * message starts with that code ("ENOENT: /path"), which the editor maps onto
 * its own file-system error codes.
 */
async function fsOp(
  terminal: TerminalContext,
  op: string,
  args: string[],
  env?: Record<string, string>,
  maxOutputBytes?: number,
): Promise<string> {
  const result = await runLimited(terminal, ['sh', '-c', FS_SCRIPT, 'sh', op, ...args], { env, maxOutputBytes })
  if (result.exitCode !== 0) {
    const code = /OCERR:([A-Z]+)/.exec(result.stderr)?.[1]
    throw new Error(
      code ? `${code}: ${args[0] ?? ''}` : result.stderr.trim() || `${op} exited with code ${result.exitCode}`,
    )
  }
  if (result.truncated) {
    throw new Error(`EFBIG: ${args[0] ?? ''}`)
  }
  return result.stdout
}

const FILE_TYPE = { unknown: 0, file: 1, directory: 2, symlink: 64 }

function fileType(kind: string, link: string): number {
  let type = FILE_TYPE.unknown
  if (kind === 'directory') {
    type = FILE_TYPE.directory
  } else if (kind.startsWith('regular')) {
    type = FILE_TYPE.file
  }
  return link === 'L' ? type | FILE_TYPE.symlink : type
}

async function stat(ctx: AppActionContext, params: Params) {
  const out = await fsOp(await terminalOf(ctx, params), 'stat', [absolute(params.path)])
  const [kind, size, mtime, link] = out.trim().split('|')
  return { type: fileType(kind, link), size: Number(size) || 0, mtime: (Number(mtime) || 0) * 1000 }
}

async function readdir(ctx: AppActionContext, params: Params) {
  const out = await fsOp(await terminalOf(ctx, params), 'readdir', [absolute(params.path)])
  const entries: [string, number][] = []
  for (const line of out.split('\n')) {
    const first = line.indexOf('|')
    const second = line.indexOf('|', first + 1)
    if (first < 0 || second < 0) {
      continue
    }
    entries.push([line.slice(second + 1), fileType(line.slice(0, first), line.slice(first + 1, second))])
  }
  return { entries }
}

async function readFile(ctx: AppActionContext, params: Params) {
  const out = await fsOp(
    await terminalOf(ctx, params),
    'read',
    [absolute(params.path)],
    undefined,
    Math.ceil(MAX_READ_BYTES * 1.4),
  )
  return { base64: out.replace(/\s+/g, '') }
}

async function writeFile(ctx: AppActionContext, params: Params) {
  const terminal = await terminalOf(ctx, params)
  const path = absolute(params.path)
  const data = typeof params.base64 === 'string' ? params.base64 : ''
  const temp = (
    await fsOp(terminal, 'write-check', [path, flag(params.create ?? true), flag(params.overwrite ?? true)])
  ).trim()
  for (let at = 0; at < data.length; at += WRITE_CHUNK_CHARS) {
    // Chunk boundaries fall on multiples of 4 characters, so each decodes on its own.
    await fsOp(terminal, 'write-chunk', [temp], { OC_DATA: data.slice(at, at + WRITE_CHUNK_CHARS) })
  }
  await fsOp(terminal, 'write-commit', [temp, path])
  return { ok: true }
}

async function mkdir(ctx: AppActionContext, params: Params) {
  await fsOp(await terminalOf(ctx, params), 'mkdir', [absolute(params.path)])
  return { ok: true }
}

async function remove(ctx: AppActionContext, params: Params) {
  await fsOp(await terminalOf(ctx, params), 'delete', [absolute(params.path), flag(params.recursive)])
  return { ok: true }
}

async function rename(ctx: AppActionContext, params: Params) {
  await fsOp(await terminalOf(ctx, params), 'rename', [
    absolute(params.from),
    absolute(params.to),
    flag(params.overwrite),
  ])
  return { ok: true }
}

const MAX_FOUND_FILES = 50_000
const MAX_TEXT_MATCH_LINES = 5_000

/** Every file under `folder` (relative paths), for the editor's Go to File. */
async function findFiles(ctx: AppActionContext, params: Params) {
  const out = await fsOp(
    await terminalOf(ctx, params),
    'find',
    [absolute(params.folder), String(MAX_FOUND_FILES + 1)],
    undefined,
    64 * 1024 * 1024,
  )
  const files = out
    .split('\n')
    .filter(Boolean)
    .map((line) => line.replace(/^\.\//, ''))
  return { files: files.slice(0, MAX_FOUND_FILES), limitHit: files.length > MAX_FOUND_FILES }
}

/** Lines under `folder` matching a pattern, for the editor's Search view. */
async function searchText(ctx: AppActionContext, params: Params) {
  const max = Math.min(Number(params.maxLines) || MAX_TEXT_MATCH_LINES, MAX_TEXT_MATCH_LINES)
  const flags = `${params.isRegExp ? 'E' : 'F'}${params.isCaseSensitive ? '' : 'i'}${params.isWordMatch ? 'w' : ''}`
  const out = await fsOp(
    await terminalOf(ctx, params),
    'grep',
    [absolute(params.folder), String(max + 1), flags],
    { OC_PATTERN: String(params.pattern ?? '') },
    16 * 1024 * 1024,
  )
  const matches: { path: string; line: number; text: string }[] = []
  for (const raw of out.split('\n')) {
    const m = /^\.\/(.*?):(\d+):(.*)$/.exec(raw)
    if (m) {
      matches.push({ path: m[1], line: Number(m[2]), text: m[3] })
    }
  }
  return { matches: matches.slice(0, max), limitHit: matches.length > max }
}

/**
 * Where the terminal starts: the folder the editor opens when none is given.
 * Asked of the terminal itself, so it is whatever its context sets — a handle's
 * own cwd (a Git worktree's), a container's WORKDIR, the ssh user's home.
 */
async function defaultFolder(ctx: AppActionContext, params: Params) {
  const result = await runLimited(await terminalOf(ctx, params), ['sh', '-c', 'pwd'], {})
  const folder = result.stdout.trim()
  if (result.exitCode !== 0 || !folder.startsWith('/')) {
    throw new Error(result.stderr.trim() || 'The terminal did not report a working directory')
  }
  return { folder }
}

/** The instance's own address, for the chat reference the editor hands its agent. */
async function appInfo(ctx: AppActionContext) {
  return { address: `${ctx.spaceSlug}.${ctx.slug}` }
}

// Text conveniences for agents, over the same operations.
async function read(ctx: AppActionContext, params: Params) {
  const { base64 } = await readFile(ctx, params)
  return { content: Buffer.from(base64, 'base64').toString('utf-8') }
}

async function write(ctx: AppActionContext, params: Params) {
  return writeFile(ctx, { ...params, base64: Buffer.from(String(params.content ?? ''), 'utf-8').toString('base64') })
}

// A docker-exec context flattened into the command that opens a login shell in
// its container, run over the context's own transport (ssh, wsl or this host):
// the way the host's Terminal node opens one, with the working directory set
// to the opened folder.
const SHELL_FALLBACK_INNER = 'command -v bash >/dev/null 2>&1 && exec bash -l || exec sh -l'

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function dockerExecConnection(value: Record<string, unknown>, cwd: string) {
  const via = (value.via as Record<string, unknown> | undefined) ?? { type: 'local' }
  const ctxArgs = value.contextName ? ['--context', String(value.contextName)] : []
  const userArgs = value.user ? ['-u', String(value.user)] : []
  const inner = value.shell ? `exec ${value.shell} -l` : SHELL_FALLBACK_INNER
  const execArgs = [...ctxArgs, 'exec', '-w', cwd, ...userArgs, '-it', String(value.containerId), 'sh', '-lc', inner]
  const { type: _type, ...viaConfig } = via
  if (via.type === 'ssh') {
    return { type: 'ssh', config: { ...viaConfig, command: `docker ${execArgs.map(shellQuote).join(' ')}` } }
  }
  if (via.type === 'wsl') {
    return { type: 'wsl', config: { ...viaConfig, command: 'docker', args: execArgs } }
  }
  return { type: 'local', config: { command: 'docker', args: execArgs } }
}

/**
 * How the editor's integrated terminal opens a shell on the opened terminal,
 * started in `cwd`: the connection the host's terminal socket takes.
 */
async function terminalConnection(ctx: AppActionContext, params: Params) {
  const value = await terminalOf(ctx, params)
  const cwd = absolute(params.cwd)
  if (value.type === 'docker-exec') {
    return dockerExecConnection(value, cwd)
  }
  const { type, ...config } = value
  return { type: type ?? 'local', config: { ...config, cwd } }
}

export const apps: AppsExport = {
  'code-editor': {
    actions: {
      stat,
      readdir,
      readFile,
      writeFile,
      mkdir,
      delete: remove,
      rename,
      read,
      write,
      terminalConnection,
      defaultFolder,
      appInfo,
      findFiles,
      searchText,
    },
  },
}

// Warm every instance's space terminal list when the extension activates
// (server start, a rebuild), so the first file operation does not wait on it.
export async function load(): Promise<void> {
  const instances: HostAppInstance[] = await hostApps.listInstances('code-editor').catch(() => [])
  for (const space of new Set(instances.map((i) => i.spaceSlug))) {
    terminalsOf(space).catch(() => {})
  }
}
