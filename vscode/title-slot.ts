import type { Bridge } from './bridge'

/**
 * Hands the App the spot where VS Code draws its logo in the title bar, for
 * the App to show the opened terminal there (it renders into it through a
 * portal; this document has none of OpenCroft's styles, so that rendering
 * carries its own). Clicking it opens the App's terminal and folder picker.
 * The title bar is rebuilt on some layout changes, so the spot is claimed
 * again whenever a fresh one appears.
 */
export function provideTitleSlot(bridge: Bridge): void {
  const claim = () => {
    const icon = document.querySelector<HTMLElement>('.monaco-workbench .window-appicon')
    if (!icon || icon.dataset.ocSlot) {
      return
    }
    icon.dataset.ocSlot = '1'
    icon.removeAttribute('href')
    const slot = document.createElement('span')
    slot.className = 'oc-workspace-slot'
    icon.replaceChildren(slot)
    icon.addEventListener('click', (event) => {
      event.preventDefault()
      bridge.openFolder()
    })
    bridge.onTitleSlot(slot)
  }
  claim()
  new MutationObserver(claim).observe(document.body, { childList: true, subtree: true })
}
