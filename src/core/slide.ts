import type { Board, Direction, MergeEvent, SlideResult, Tile, TileMotion } from './types.ts'
import { allocateTile, copyBoard, increment, tileValue } from './board.ts'
import { assertDirection, assertNextTileId, assertSize, assertTile, boardSize } from './validation.ts'
function same(a: Board, b: Board) { return a.every((tile, i) => tile?.id === b[i]?.id && tile?.power === b[i]?.power) }
function mergeLine(line: Board, indices: readonly number[], nextId: number): SlideResult {
  const inputs: { tile: Tile; from: number }[] = []
  line.forEach((tile, i) => { if (tile) inputs.push({ tile, from: indices[i]! }) })
  const output: (Tile | null)[] = [], motions: TileMotion[] = [], merges: MergeEvent[] = []
  let scoreGain = 0n
  for (let i = 0; i < inputs.length;) {
    const current = inputs[i]!, next = inputs[i + 1], to = indices[output.length]!
    if (next && current.tile.power === next.tile.power) {
      const tile = allocateTile(nextId, current.tile.power + 1); nextId = increment(nextId)
      output.push(tile); scoreGain += tileValue(tile)
      motions.push({ sourceId: current.tile.id, from: current.from, to, resultId: tile.id }, { sourceId: next.tile.id, from: next.from, to, resultId: tile.id })
      merges.push({ sourceIds: Object.freeze([current.tile.id, next.tile.id] as const), tile, at: to })
      i += 2 // Read original inputs only; an output tile can never merge again.
    } else {
      output.push(current.tile); motions.push({ sourceId: current.tile.id, from: current.from, to, resultId: current.tile.id }); i++
    }
  }
  while (output.length < line.length) output.push(null)
  return { board: copyBoard(output), scoreGain, changed: !same(line, output), nextTileId: nextId, motions, merges }
}
function freezeResult(result: SlideResult): SlideResult {
  return Object.freeze({ ...result, motions: Object.freeze(result.motions.map(m => Object.freeze(m))), merges: Object.freeze(result.merges.map(m => Object.freeze(m))) })
}
export function slideLine(line: Board, nextTileId: number): SlideResult {
  assertSize(line.length)
  if (!Array.from({ length: line.length }, (_, i) => Object.hasOwn(line, i)).every(Boolean)) throw new RangeError('Sparse lines are not supported')
  const ids = new Set<number>()
  for (const tile of line) { if (tile === null) continue; assertTile(tile); if (ids.has(tile.id)) throw new RangeError('Duplicate tile ID'); ids.add(tile.id) }
  assertNextTileId(line, nextTileId)
  const result = mergeLine(line, Array.from({ length: line.length }, (_, i) => i), nextTileId)
  return freezeResult(result.changed ? result : { ...result, board: line, motions: [], merges: [] })
}
export function slideBoard(board: Board, direction: Direction, nextTileId: number): SlideResult {
  const size = boardSize(board)
  assertDirection(direction); assertNextTileId(board, nextTileId)
  const output: (Tile | null)[] = Array<Tile | null>(size * size).fill(null), motions: TileMotion[] = [], merges: MergeEvent[] = []
  let scoreGain = 0n, id = nextTileId
  for (let line = 0; line < size; line++) {
    const indices = Array.from({ length: size }, (_, offset) => {
      const n = direction === 'right' || direction === 'down' ? size - 1 - offset : offset
      return direction === 'left' || direction === 'right' ? line * size + n : n * size + line
    })
    const result = mergeLine(indices.map(i => board[i]!), indices, id)
    result.board.forEach((tile, offset) => { output[indices[offset]!] = tile })
    scoreGain += result.scoreGain; id = result.nextTileId; motions.push(...result.motions); merges.push(...result.merges)
  }
  const changed = !same(board, output)
  return freezeResult({ board: changed ? copyBoard(output) : board, changed, scoreGain, nextTileId: id, motions: changed ? motions : [], merges })
}
export function slideSelectedTile(board: Board, direction: Direction, selectedIndex: number, nextTileId: number): SlideResult {
  const size = boardSize(board)
  assertDirection(direction); assertNextTileId(board, nextTileId)
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= board.length) throw new RangeError('Invalid selected tile index')
  const selected = board[selectedIndex]
  if (!selected) return freezeResult({ board, changed: false, scoreGain: 0n, nextTileId, motions: [], merges: [] })

  const step = direction === 'left' ? -1 : direction === 'right' ? 1 : direction === 'up' ? -size : size
  const output = [...board]
  let destination = selectedIndex
  let mergeIndex: number | null = null
  while (true) {
    const next = destination + step
    if (next < 0 || next >= board.length
      || (direction === 'left' && Math.floor(next / size) !== Math.floor(destination / size))
      || (direction === 'right' && Math.floor(next / size) !== Math.floor(destination / size))) break
    const occupant = board[next]
    if (!occupant) { destination = next; continue }
    if (occupant.power === selected.power) mergeIndex = next
    break
  }
  if (destination === selectedIndex && mergeIndex === null) {
    return freezeResult({ board, changed: false, scoreGain: 0n, nextTileId, motions: [], merges: [] })
  }

  if (mergeIndex !== null) {
    const tile = allocateTile(nextTileId, selected.power + 1)
    output[selectedIndex] = null
    output[mergeIndex] = tile
    return freezeResult({
      board: copyBoard(output), changed: true, scoreGain: tileValue(tile), nextTileId: increment(nextTileId),
      motions: [
        { sourceId: selected.id, from: selectedIndex, to: mergeIndex, resultId: tile.id },
        { sourceId: board[mergeIndex]!.id, from: mergeIndex, to: mergeIndex, resultId: tile.id },
      ],
      merges: [{ sourceIds: Object.freeze([selected.id, board[mergeIndex]!.id] as const), tile, at: mergeIndex }],
    })
  }

  output[selectedIndex] = null
  output[destination] = selected
  return freezeResult({
    board: copyBoard(output), changed: true, scoreGain: 0n, nextTileId,
    motions: [{ sourceId: selected.id, from: selectedIndex, to: destination, resultId: selected.id }], merges: [],
  })
}
