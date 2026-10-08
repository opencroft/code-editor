// The Code Editor's VS Code page: the full workbench, opened on one folder of
// one terminal. Built by scripts/build-vscode.mjs into assets/vscode/, loaded by
// the page server/routes.ts serves, in an iframe the App renders.
import { initialize, LogLevel } from '@codingame/monaco-vscode-api'
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri'
import getAccessibilityServiceOverride from '@codingame/monaco-vscode-accessibility-service-override'
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override'
import { initUserConfiguration } from '@codingame/monaco-vscode-configuration-service-override/common'
import getDialogsServiceOverride from '@codingame/monaco-vscode-dialogs-service-override'
import getExplorerServiceOverride from '@codingame/monaco-vscode-explorer-service-override'
import getExtensionGalleryServiceOverride from '@codingame/monaco-vscode-extension-gallery-service-override'
import getExtensionServiceOverride from '@codingame/monaco-vscode-extensions-service-override'
import { createIndexedDBProviders, registerFileSystemOverlay } from '@codingame/monaco-vscode-files-service-override'
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override'
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override'
import getLifecycleServiceOverride from '@codingame/monaco-vscode-lifecycle-service-override'
import getLogServiceOverride from '@codingame/monaco-vscode-log-service-override'
import getMarkersServiceOverride from '@codingame/monaco-vscode-markers-service-override'
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override'
import getNotificationServiceOverride from '@codingame/monaco-vscode-notifications-service-override'
import getOutlineServiceOverride from '@codingame/monaco-vscode-outline-service-override'
import getOutputServiceOverride from '@codingame/monaco-vscode-output-service-override'
import getPreferencesServiceOverride from '@codingame/monaco-vscode-preferences-service-override'
import getQuickAccessServiceOverride from '@codingame/monaco-vscode-quickaccess-service-override'
import getSearchServiceOverride from '@codingame/monaco-vscode-search-service-override'
import getSnippetServiceOverride from '@codingame/monaco-vscode-snippets-service-override'
import getStorageServiceOverride from '@codingame/monaco-vscode-storage-service-override'
import getTerminalServiceOverride from '@codingame/monaco-vscode-terminal-service-override'
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override'
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override'
import getBannerServiceOverride from '@codingame/monaco-vscode-view-banner-service-override'
import getStatusBarServiceOverride from '@codingame/monaco-vscode-view-status-bar-service-override'
import getWorkbenchServiceOverride from '@codingame/monaco-vscode-workbench-service-override'
import getWorkingCopyServiceOverride from '@codingame/monaco-vscode-working-copy-service-override'
import getWorkspaceTrustOverride from '@codingame/monaco-vscode-workspace-trust-service-override'

import '@codingame/monaco-vscode-theme-defaults-default-extension'
import '@codingame/monaco-vscode-theme-seti-default-extension'
import '@codingame/monaco-vscode-cpp-default-extension'
import '@codingame/monaco-vscode-css-default-extension'
import '@codingame/monaco-vscode-diff-default-extension'
import '@codingame/monaco-vscode-docker-default-extension'
import '@codingame/monaco-vscode-dotenv-default-extension'
import '@codingame/monaco-vscode-go-default-extension'
import '@codingame/monaco-vscode-html-default-extension'
import '@codingame/monaco-vscode-ini-default-extension'
import '@codingame/monaco-vscode-java-default-extension'
import '@codingame/monaco-vscode-javascript-default-extension'
import '@codingame/monaco-vscode-json-default-extension'
import '@codingame/monaco-vscode-log-default-extension'
import '@codingame/monaco-vscode-lua-default-extension'
import '@codingame/monaco-vscode-make-default-extension'
import '@codingame/monaco-vscode-markdown-basics-default-extension'
import '@codingame/monaco-vscode-php-default-extension'
import '@codingame/monaco-vscode-python-default-extension'
import '@codingame/monaco-vscode-ruby-default-extension'
import '@codingame/monaco-vscode-rust-default-extension'
import '@codingame/monaco-vscode-shellscript-default-extension'
import '@codingame/monaco-vscode-sql-default-extension'
import '@codingame/monaco-vscode-typescript-basics-default-extension'
import '@codingame/monaco-vscode-xml-default-extension'
import '@codingame/monaco-vscode-yaml-default-extension'

// @ts-expect-error resolved by scripts/build-vscode.mjs: worker label -> file next to this one
import WORKER_FILES from 'oc:worker-files'

import { getBridge } from './bridge'
import { TerminalFileSystemProvider } from './fs-provider'
import { registerOpenFolder } from './open-folder'
import { getTerminalSearchServiceOverride } from './search'
import { publishSelection } from './selection'
import { provideTitleSlot } from './title-slot'
import { HostTerminalBackend } from './terminal-backend'

const bridge = getBridge()

const workerFiles = WORKER_FILES as Record<string, string>
;(globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
  getWorkerUrl: (_moduleId: string, label: string) =>
    workerFiles[label] ? new URL(workerFiles[label], import.meta.url).toString() : undefined,
  getWorkerOptions: () => ({ type: 'module' }),
}

// file:// is the opened terminal's file system. User settings, keybindings and
// state live in the browser (IndexedDB), as in vscode.dev.
registerFileSystemOverlay(1, new TerminalFileSystemProvider(bridge))
await createIndexedDBProviders()
await initUserConfiguration(
  JSON.stringify({
    'workbench.colorTheme': bridge.dark ? 'Default Dark Modern' : 'Default Light Modern',
    'workbench.iconTheme': 'vs-seti',
    'window.menuBarVisibility': 'compact',
    'workbench.startupEditor': 'none',
    'files.watcherExclude': {},
  }),
)

const container = document.getElementById('workbench')!

registerOpenFolder(bridge)

await initialize(
  {
    ...getLogServiceOverride(),
    // Web extensions (the ones vscode.dev runs) in a worker extension host, and
    // the Extensions view installing them from Open VSX — the registry
    // code-server and VSCodium use; Microsoft's marketplace is licensed to
    // Microsoft's products only. Installed extensions live in the browser.
    // Not isolated: the host's iframe is same-origin with OpenCroft, so an
    // installed extension runs with the reader's session. Isolating it takes a
    // separate origin (iframeAlternateDomain).
    ...getExtensionServiceOverride({ enableWorkerExtensionHost: true }),
    ...getExtensionGalleryServiceOverride({ webOnly: true }),
    ...getModelServiceOverride(),
    ...getNotificationServiceOverride(),
    ...getDialogsServiceOverride(),
    ...getConfigurationServiceOverride(),
    ...getKeybindingsServiceOverride(),
    ...getTextmateServiceOverride(),
    ...getThemeServiceOverride(),
    ...getLanguagesServiceOverride(),
    ...getPreferencesServiceOverride(),
    ...getBannerServiceOverride(),
    ...getStatusBarServiceOverride(),
    ...getOutputServiceOverride(),
    ...getTerminalServiceOverride(new HostTerminalBackend(bridge)),
    ...getAccessibilityServiceOverride(),
    ...getStorageServiceOverride(),
    ...getLifecycleServiceOverride(),
    ...getWorkspaceTrustOverride(),
    ...getWorkingCopyServiceOverride(),
    ...getExplorerServiceOverride(),
    // The search views from the override, the search itself over the terminal.
    ...getSearchServiceOverride(),
    ...getTerminalSearchServiceOverride(bridge),
    ...getMarkersServiceOverride(),
    ...getSnippetServiceOverride(),
    ...getOutlineServiceOverride(),
    ...getWorkbenchServiceOverride(),
    ...getQuickAccessServiceOverride({
      isKeybindingConfigurationVisible: () => true,
      shouldUseGlobalPicker: () => true,
    }),
  },
  container,
  {
    workspaceProvider: {
      trusted: true,
      workspace: { folderUri: URI.file(bridge.folder) },
      // "Open Folder" means another terminal and path: the App's picker.
      async open() {
        bridge.openFolder()
        return true
      },
    },
    developmentOptions: { logLevel: LogLevel.Warning },
    productConfiguration: {
      nameShort: 'Code Editor',
      nameLong: 'OpenCroft Code Editor',
      extensionsGallery: {
        serviceUrl: 'https://open-vsx.org/vscode/gallery',
        resourceUrlTemplate: 'https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}',
        extensionUrlTemplate: 'https://open-vsx.org/vscode/gallery/{publisher}/{name}/latest',
        controlUrl: '',
        nlsBaseUrl: '',
      },
    },
  },
  // Home is the opened folder; otherwise VS Code takes "/" for it.
  { userHome: URI.file(bridge.folder) },
)

void publishSelection(bridge)
provideTitleSlot(bridge)
