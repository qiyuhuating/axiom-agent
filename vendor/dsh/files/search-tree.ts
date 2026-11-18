export function matchRanges(name: string, query: string): readonly (readonly [number, number])[] {
  if (query === '') return []
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  return [...name.matchAll(pattern)].map(match => [match.index, match.index + match[0].length] as const)
}
