// Font-Rover groups_control/naming.py, for the dialogs; the worker checks again.

export function nameProblem(shortName: string, prefix: string, groups: Record<string, unknown>): string | null {
  if (!shortName) return 'The name is empty.'
  if (/\s/.test(shortName)) return 'A group name cannot contain spaces.'
  if (prefix + shortName in groups) return `Group '${shortName}' already exists.`
  return null
}

/** The short name itself if free, else the first free name_2, name_3… */
export function freeName(shortName: string, prefix: string, groups: Record<string, unknown>): string {
  if (!(prefix + shortName in groups)) return shortName
  let n = 2
  while (`${prefix}${shortName}_${n}` in groups) n++
  return `${shortName}_${n}`
}
