import { describe, expect, it } from 'vitest'
import { freeName, nameProblem } from './naming'

const groups = { 'public.kern1.O': [], 'public.kern1.O_2': [] }

describe('naming', () => {
  it('reports problems like naming.py', () => {
    expect(nameProblem('', 'public.kern1.', groups)).toBe('The name is empty.')
    expect(nameProblem('a b', 'public.kern1.', groups)).toBe('A group name cannot contain spaces.')
    expect(nameProblem('O', 'public.kern1.', groups)).toBe("Group 'O' already exists.")
    expect(nameProblem('O', 'public.kern2.', groups)).toBeNull()
  })
  it('finds a free name', () => {
    expect(freeName('O', 'public.kern1.', groups)).toBe('O_3')
    expect(freeName('Q', 'public.kern1.', groups)).toBe('Q')
  })
})
