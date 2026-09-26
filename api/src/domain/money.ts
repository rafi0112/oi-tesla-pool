declare const __paisa: unique symbol
export type Paisa = number & { readonly [__paisa]: true }

export function taka(paisa: number): Paisa {
  return Math.round(paisa) as Paisa
}

export function toTaka(paisa: Paisa): number {
  return paisa / 100
}

export function formatTaka(paisa: Paisa): string {
  return `৳${toTaka(paisa).toFixed(2)}`
}
