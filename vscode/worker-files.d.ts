// `oc:worker-files` exists only at build time: scripts/build-vscode.mjs
// resolves it to each Monaco worker's label mapped to the file it built for
// that worker, relative to the page.
declare module 'oc:worker-files' {
  const workerFiles: Record<string, string>
  export default workerFiles
}
