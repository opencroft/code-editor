import { defineExtension } from '@opencroft/client/extension'

import { CodeEditorApp } from './app/code-editor-app'

export default defineExtension({
  manifest: {},
  nodes: [],
  provides: {
    apps: [
      {
        type: 'code-editor',
        title: 'Code Editor',
        description: "VS Code on a folder of one of the space's terminals.",
        icon: 'Code',
        component: CodeEditorApp,
      },
    ],
  },
})
