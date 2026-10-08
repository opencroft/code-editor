import { Schemas } from '@codingame/monaco-vscode-api/vscode/vs/base/common/network'
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri'
import { SyncDescriptor } from '@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors'
import {
  type IFileMatch,
  type IFileQuery,
  type ISearchComplete,
  type ISearchProgressItem,
  type ISearchResultProvider,
  type ITextQuery,
  OneLineRange,
  SearchProviderType,
  TextSearchMatch,
} from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search'
import { ISearchService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search.service'
import { SearchService } from '@codingame/monaco-vscode-search-service-override/vscode/vs/workbench/services/search/common/searchService'

import type { Bridge } from './bridge'

const FILE_LIST_TTL_MS = 30_000

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Fuzzy, as Go to File expects: every typed character in order, case-insensitive. */
function fuzzyMatches(path: string, pattern: string): boolean {
  const haystack = path.toLowerCase()
  let at = 0
  for (const ch of pattern.toLowerCase()) {
    if (ch === ' ') {
      continue
    }
    at = haystack.indexOf(ch, at)
    if (at < 0) {
      return false
    }
    at++
  }
  return true
}

/**
 * Go to File and the Search view over the opened terminal: one `find` or one
 * `grep` there per query, instead of monaco-vscode-api's default for a non-
 * browser file system, which indexes the whole folder through the file system
 * at startup (one terminal round trip per entry — from "/" it never finishes).
 */
class TerminalSearchProvider implements ISearchResultProvider {
  private fileLists = new Map<string, { at: number; files: Promise<{ files: string[]; limitHit: boolean }> }>()

  constructor(private readonly bridge: Bridge) {}

  async getAIName(): Promise<string | undefined> {
    return undefined
  }

  private listFiles(folder: string) {
    const cached = this.fileLists.get(folder)
    if (cached && Date.now() - cached.at < FILE_LIST_TTL_MS) {
      return cached.files
    }
    const files = this.bridge.call<{ files: string[]; limitHit: boolean }>('findFiles', { terminal: this.bridge.terminal, folder })
    files.catch(() => this.fileLists.delete(folder))
    this.fileLists.set(folder, { at: Date.now(), files })
    return files
  }

  async fileSearch(query: IFileQuery): Promise<ISearchComplete> {
    const results: IFileMatch[] = []
    let limitHit = false
    const max = query.maxResults ?? Number.MAX_SAFE_INTEGER
    for (const fq of query.folderQueries) {
      const { files, limitHit: truncated } = await this.listFiles(fq.folder.path)
      limitHit ||= truncated
      for (const rel of files) {
        if (query.filePattern && !fuzzyMatches(rel, query.filePattern)) {
          continue
        }
        if (query.exists) {
          return { results: [], limitHit: true, messages: [] }
        }
        results.push({ resource: URI.joinPath(fq.folder, rel) })
        if (results.length >= max) {
          return { results, limitHit: true, messages: [] }
        }
      }
    }
    return { results, limitHit, messages: [] }
  }

  async textSearch(query: ITextQuery, onProgress?: (p: ISearchProgressItem) => void): Promise<ISearchComplete> {
    const { pattern, isRegExp, isCaseSensitive, isWordMatch } = query.contentPattern
    const source = isRegExp ? pattern : escapeRegExp(pattern)
    let re: RegExp | undefined
    try {
      re = new RegExp(isWordMatch ? `\\b(?:${source})\\b` : source, isCaseSensitive ? 'g' : 'gi')
    } catch {
      re = undefined
    }
    const byFile = new Map<string, IFileMatch>()
    let limitHit = false
    for (const fq of query.folderQueries) {
      const result = await this.bridge.call<{ matches: { path: string; line: number; text: string }[]; limitHit: boolean }>('searchText', {
        terminal: this.bridge.terminal,
        folder: fq.folder.path,
        pattern,
        isRegExp,
        isCaseSensitive,
        isWordMatch,
        maxLines: query.maxResults,
      })
      limitHit ||= result.limitHit
      for (const { path, line, text } of result.matches) {
        const ranges: OneLineRange[] = []
        if (re) {
          re.lastIndex = 0
          for (const m of text.matchAll(re)) {
            if (m[0].length === 0) {
              break
            }
            ranges.push(new OneLineRange(line - 1, m.index ?? 0, (m.index ?? 0) + m[0].length))
          }
        }
        if (ranges.length === 0) {
          ranges.push(new OneLineRange(line - 1, 0, text.length))
        }
        const resource = URI.joinPath(fq.folder, path)
        let match = byFile.get(resource.toString())
        if (!match) {
          match = { resource, results: [] }
          byFile.set(resource.toString(), match)
        }
        const textMatch = new TextSearchMatch(text, ranges, query.previewOptions)
        match.results!.push(textMatch)
        onProgress?.({ resource, results: [textMatch] })
      }
    }
    return { results: [...byFile.values()], limitHit, messages: [] }
  }

  async clearCache(): Promise<void> {
    this.fileLists.clear()
  }
}

let bridgeForSearch: Bridge | undefined

class TerminalSearchService extends SearchService {
  constructor(...args: ConstructorParameters<typeof SearchService>) {
    super(...args)
    const provider = new TerminalSearchProvider(bridgeForSearch!)
    this.registerSearchResultProvider(Schemas.file, SearchProviderType.file, provider)
    this.registerSearchResultProvider(Schemas.file, SearchProviderType.text, provider)
  }
}

/** Replaces the search override's ISearchService; keep its views and the rest. */
export function getTerminalSearchServiceOverride(bridge: Bridge) {
  bridgeForSearch = bridge
  return { [ISearchService.toString()]: new SyncDescriptor(TerminalSearchService, [], true) }
}
