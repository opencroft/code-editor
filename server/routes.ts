import { assetUrl } from '@opencroft/server/extension'

import { VSCODE_ENTRY } from '../src/vscode-build'
import { HTML_PAGES } from './html-assets'

// The VS Code page the App's iframe loads. A real same-origin URL rather than a
// srcdoc document: VS Code resolves its module and worker locations against
// location.href, which in a srcdoc frame is "about:srcdoc" and resolves nothing.
// Served here, not from assets/, because the host serves assets with an
// unknown extension (.html) as octet-stream. The page itself is never cached;
// the scripts it loads carry content hashes.
function vscodePage(request: Request): Response {
  // The App's theme, so the frame paints in the same scheme from its first
  // frame, transparent over the App's own background, rather than white.
  // VS Code's logo spot in its title bar shows the opened terminal instead
  // (vscode/title-slot.ts claims it, the App renders into it).
  const scheme = new URL(request.url).searchParams.get('theme') === 'dark' ? 'dark' : 'light'
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="${scheme}"><title>Code Editor</title><style>html,body,#workbench{margin:0;height:100%;overflow:hidden;background:transparent}.monaco-workbench .window-appicon{width:auto!important;background-image:none!important;display:flex!important;align-items:center;padding:0 10px!important;cursor:pointer;color:inherit;text-decoration:none}</style></head><body><div id="workbench"></div><script type="module" src="${assetUrl(VSCODE_ENTRY)}"></script></body></html>`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

function htmlPage(html: string): Response {
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

// Session routes: a plain route function is public. These are VS Code's own
// static pages, but nothing here is meant for anyone not signed in.
export const routes: Record<string, { session: 'person'; handler: (request: Request) => Response }> = {
  vscode: { session: 'person', handler: vscodePage },
  // VS Code's own pages — the web extension host's iframe, webviews — by the
  // route names the build gave them (scripts/build-vscode.mjs).
  ...Object.fromEntries(
    Object.entries(HTML_PAGES).map(([name, html]) => [
      name,
      { session: 'person' as const, handler: () => htmlPage(html) },
    ]),
  ),
}
