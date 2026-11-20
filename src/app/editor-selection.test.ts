import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import { editorSelection } from './editor-selection.ts'

const workspace = { terminal: 'node-1/terminal', folder: '/srv/app', terminalName: 'dev box' }

test('with no file open, the opened folder is the item', () => {
  assert.deepEqual(editorSelection(workspace, null), {
    items: [{ kind: 'file', terminal: 'node-1/terminal', path: '/srv/app', folder: true }],
  })
})

test('an open file with nothing highlighted is the file alone', () => {
  assert.deepEqual(editorSelection(workspace, { path: '/srv/app/deploy.sh' }), {
    items: [{ kind: 'file', terminal: 'node-1/terminal', path: '/srv/app/deploy.sh', on: 'dev box' }],
  })
})

test('a highlight gives its lines and its text', () => {
  const selection = editorSelection(workspace, {
    path: '/srv/app/deploy.sh',
    highlight: { startLine: 3, endLine: 5, endColumn: 4, text: 'set -e\necho hi\nrun' },
  })
  assert.deepEqual(selection.items, [
    {
      kind: 'file',
      terminal: 'node-1/terminal',
      path: '/srv/app/deploy.sh',
      on: 'dev box',
      lines: { from: 3, to: 5 },
      text: 'set -e\necho hi\nrun',
    },
  ])
})

test('a highlight ending at the start of a line leaves that line out', () => {
  const [item] = editorSelection(workspace, {
    path: '/srv/app/deploy.sh',
    highlight: { startLine: 3, endLine: 6, endColumn: 1, text: 'a\nb\nc\n' },
  }).items
  assert.deepEqual(item.kind === 'file' && item.lines, { from: 3, to: 5 })
})

test('a highlight inside one line keeps that line', () => {
  const [one] = editorSelection(workspace, {
    path: '/srv/app/deploy.sh',
    highlight: { startLine: 7, endLine: 7, endColumn: 5, text: 'echo' },
  }).items
  assert.deepEqual(one.kind === 'file' && one.lines, { from: 7, to: 7 })
})

test('the highlighted text goes whole, however long', () => {
  const text = 'x'.repeat(25_000)
  const [item] = editorSelection(workspace, {
    path: '/srv/app/big.txt',
    highlight: { startLine: 1, endLine: 1, endColumn: 25_001, text },
  }).items
  assert.equal(item.kind === 'file' && item.text?.length, 25_000)
})

test('without the terminal name the item names no terminal', () => {
  const [item] = editorSelection({ terminal: 'node-1/terminal', folder: '/srv/app' }, { path: '/srv/app/a' }).items
  assert.equal(Object.hasOwn(item, 'on'), false)
})

test("the page's report is copied into objects of this window", () => {
  // The report as the VS Code page's own window makes it.
  const report = runInNewContext(
    '({ path: "/srv/app/deploy.sh", highlight: { startLine: 2, endLine: 3, endColumn: 2, text: "a\\nb" } })',
  )
  const [item] = editorSelection(workspace, report).items
  assert.equal(Object.getPrototypeOf(item), Object.prototype)
  assert.equal(item.kind === 'file' && Object.getPrototypeOf(item.lines), Object.prototype)
  assert.deepEqual(item, {
    kind: 'file',
    terminal: 'node-1/terminal',
    path: '/srv/app/deploy.sh',
    on: 'dev box',
    lines: { from: 2, to: 3 },
    text: 'a\nb',
  })
})
