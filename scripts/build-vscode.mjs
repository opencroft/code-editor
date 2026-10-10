// Builds the Code Editor's VS Code page (vscode/main.ts) into assets/vscode/,
// which the host serves at assetUrl('vscode/...'). None of the output is in
// git: npm runs this as `postinstall`, and the host installs dependencies
// before it compiles an extension. An install is skipped while package.json
// and the lockfile are unchanged, so after changing vscode/ or server/fs.sh in
// a checkout, run `npm run build` before compiling.
//
// Why not the host's extension compiler: @codingame/monaco-vscode-api needs CSS
// imported as text, workers, and files referenced with
// `new URL('./x', import.meta.url)` (grammars, wasm, icons), and that compiler
// has loaders for none of them.
//
// The host serves assets with a year-long immutable cache, so every file name
// carries a content hash; src/vscode-build.ts tells the App which entry to load.
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')

const OUT = 'assets/vscode'
const INLINE_MIME = { '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif' }
const FONT_MIME = { '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2' }

const hash = (data) => createHash('sha256').update(data).digest('hex').slice(0, 12)

// server/fs.sh -> server/fs-script.ts: the host's server compiler has no .sh loader.
const fsScript = await readFile('server/fs.sh', 'utf-8')
await writeFile(
  'server/fs-script.ts',
  `// Generated from fs.sh by scripts/build-vscode.mjs — edit fs.sh, not this file.\nexport const FS_SCRIPT = ${JSON.stringify(fsScript)}\n`,
)

await rm(OUT, { recursive: true, force: true })
await mkdir(`${OUT}/assets`, { recursive: true })

// new URL('<relative>', import.meta.url) in package code: the file is copied
// to assets/ under a hashed name (images are inlined, since the host serves
// them as octet-stream), and the reference rewritten to that copy. Every
// bundle file sits at the root of OUT, so "./assets/..." resolves from any.
//
// HTML pages (the extension host's iframe, webviews) cannot be served from
// assets/, which the host serves as octet-stream; they go to
// server/html-assets.ts instead, each served by its own session route
// "vscode-html-<name>". VS Code appends its own "?..." to these URLs, so the
// name is in the path, never a query. From a bundle file
// (/api/ext/<id>/assets/vscode/x.js) the route is ../../http/<route>.
const emitted = new Map()
const htmlPages = {}
async function emitAsset(file) {
  if (emitted.has(file)) return emitted.get(file)
  const data = await readFile(file)
  const ext = path.extname(file)
  let ref
  if (ext === '.html') {
    const route = `vscode-html-${path.basename(file, ext).replace(/[^\w-]/g, '-')}-${hash(data)}`
    htmlPages[route] = data.toString('utf-8')
    ref = `../../http/${route}`
  } else if (INLINE_MIME[ext]) {
    ref = `data:${INLINE_MIME[ext]};base64,${data.toString('base64')}`
  } else {
    ref = `./assets/${path.basename(file, ext)}-${hash(data)}${ext}`
    await writeFile(path.join(OUT, ref), data)
  }
  emitted.set(file, ref)
  return ref
}

const URL_RE = /\bnew\s+URL\s*\(\s*('[^']+'|"[^"]+")\s*,\s*import\.meta\.url\s*\)/g
const assetUrls = {
  name: 'asset-urls',
  setup(build) {
    build.onLoad({ filter: /node_modules[\\/].*\.js$/ }, async (args) => {
      const code = await readFile(args.path, 'utf-8')
      if (!code.includes('import.meta.url')) return undefined
      let out = ''
      let at = 0
      for (const match of code.matchAll(URL_RE)) {
        const rel = match[1].slice(1, -1)
        if (!rel.startsWith('.')) continue
        const file = path.resolve(path.dirname(args.path), rel)
        const ref = await emitAsset(file).catch(() => null)
        if (!ref) continue
        out += `${code.slice(at, match.index)}new URL(${JSON.stringify(ref)}, import.meta.url)`
        at = match.index + match[0].length
      }
      return { contents: out + code.slice(at), loader: 'js' }
    })
  },
}

// CSS is imported as text (what monaco-vscode-api's registerCss expects), with
// fonts and images in url() inlined so the text stands alone.
const cssAsText = {
  name: 'css-as-text',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      let css = await readFile(args.path, 'utf-8')
      for (const [whole, , ref] of [...css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)]) {
        if (/^(data:|https?:|#)/.test(ref)) continue
        const file = path.resolve(path.dirname(args.path), ref.split(/[?#]/)[0])
        const ext = path.extname(file)
        const mime = FONT_MIME[ext] ?? INLINE_MIME[ext] ?? 'application/octet-stream'
        const data = await readFile(file).catch(() => null)
        if (data) css = css.split(whole).join(`url(data:${mime};base64,${data.toString('base64')})`)
      }
      return { contents: css, loader: 'text' }
    })
  },
}

// Node-only branches (@vscode/diff reading node:fs/promises, xterm's ligature
// addon reaching for node:diagnostics_channel) never do real work in the
// browser. A CommonJS proxy stands in: any named import resolves, and anything
// touched at module load returns the same inert proxy instead of throwing.
const nodeStub = {
  name: 'node-stub',
  setup(build) {
    build.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, namespace: 'node-stub' }))
    build.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => ({
      contents:
        'const p = new Proxy(function () {}, { get: (_, k) => (k === "then" ? undefined : k === Symbol.toPrimitive ? () => "" : p), apply: () => p, construct: () => p }); module.exports = p',
      loader: 'js',
    }))
  },
}

const common = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  // The bundled packages' license notices stay in the files that are served.
  legalComments: 'eof',
  logLevel: 'warning',
  loader: {
    '.ttf': 'dataurl',
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
    '.png': 'dataurl',
    '.svg': 'dataurl',
    '.wasm': 'binary',
  },
}

// Workers: each its own self-contained module, named by the label VS Code asks for.
const WORKERS = {
  editorWorkerService: '@codingame/monaco-vscode-editor-api/esm/vs/editor/editor.worker.js',
  TextMateWorker: '@codingame/monaco-vscode-textmate-service-override/worker',
  OutputLinkDetectionWorker: '@codingame/monaco-vscode-output-service-override/worker',
  LocalFileSearchWorker: '@codingame/monaco-vscode-search-service-override/worker',
  extensionHostWorkerMain: '@codingame/monaco-vscode-api/workers/extensionHost.worker',
}
const workerFiles = {}
for (const [label, entry] of Object.entries(WORKERS)) {
  const result = await esbuild.build({
    ...common,
    stdin: { contents: `import ${JSON.stringify(entry)}`, resolveDir: process.cwd() },
    write: false,
    plugins: [assetUrls, cssAsText, nodeStub],
  })
  const code = result.outputFiles[0].contents
  const name = `${label}-${hash(code)}.js`
  await writeFile(path.join(OUT, name), code)
  workerFiles[label] = `./${name}`
}

const workerFilesModule = {
  name: 'worker-files',
  setup(build) {
    build.onResolve({ filter: /^oc:worker-files$/ }, () => ({ path: 'worker-files', namespace: 'oc' }))
    build.onLoad({ filter: /.*/, namespace: 'oc' }, () => ({
      contents: `export default ${JSON.stringify(workerFiles)}`,
      loader: 'js',
    }))
  },
}

const main = await esbuild.build({
  ...common,
  entryPoints: { main: 'vscode/main.ts' },
  outdir: OUT,
  splitting: true,
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[hash]',
  metafile: true,
  plugins: [workerFilesModule, assetUrls, cssAsText, nodeStub],
})
const entry = Object.entries(main.metafile.outputs).find(([, o]) => o.entryPoint === 'vscode/main.ts')[0]
await writeFile(
  'src/vscode-build.ts',
  `// Generated by scripts/build-vscode.mjs — the VS Code page's entry under assets/.\nexport const VSCODE_ENTRY = ${JSON.stringify(path.relative('assets', entry))}\n`,
)
await writeFile(
  'server/html-assets.ts',
  `// Generated by scripts/build-vscode.mjs — VS Code's HTML pages, by route name.\nexport const HTML_PAGES: Record<string, string> = ${JSON.stringify(htmlPages)}\n`,
)
console.log(`html pages ${Object.keys(htmlPages).join(', ')}`)
console.log(`entry ${entry}; ${emitted.size} assets; workers ${Object.keys(workerFiles).join(', ')}`)
