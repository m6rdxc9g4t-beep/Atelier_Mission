// Conversion camelCase → snake_case des sorties du nœud Atelier (Suite Atelier §7.1 : propriétés en snake_case).
export function snakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}

export function toSnake(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toSnake)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [snakeKey(k), toSnake(v)]))
  }
  return value
}
