# Code Editor

An OpenCroft App that runs the VS Code workbench
([monaco-vscode-api](https://github.com/CodinGame/monaco-vscode-api)) on a
terminal: you open a terminal and a folder instead of a local folder, and the
explorer, search and integrated terminal all work on that terminal's machine.

- Files are read and written through the terminal with POSIX `sh` (`server/fs.sh`).
- The integrated terminal opens in the chosen folder.
- Extensions come from Open VSX and run in the browser's web extension host.
- The App's chat sees the terminal, the open file and the current selection.

## Building

The workbench is bundled by `scripts/build-vscode.mjs` with esbuild, because
the host's extension compiler has no loaders for its workers, CSS and fonts.
The script runs as the package's `postinstall`, and the host installs an
extension's dependencies before compiling it, so an install from the registry
needs no extra step. It writes `assets/vscode`, `src/vscode-build.ts`,
`server/fs-script.ts` and `server/html-assets.ts`; none of them is in git.

The host reinstalls only when `package.json` or the lockfile changes. After
editing `vscode/` or `server/fs.sh` in a checkout, rebuild before compiling:

```sh
npm run build
```
