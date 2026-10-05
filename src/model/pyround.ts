/** Python's round(): halves go to the even neighbour (banker's rounding). */
export function pyRound(x: number): number {
  const floor = Math.floor(x)
  const diff = x - floor
  if (diff === 0.5) return floor % 2 === 0 ? floor : floor + 1
  return Math.round(x)
}
