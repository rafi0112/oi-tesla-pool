/**
 * Mirrors POOL_POLICY in the API's matching rule. The server is always the
 * authority — these values only drive what the console displays, never what it
 * allows, so a drift shows up as a wrong countdown, never as a bad decision.
 */
export const MAX_WAIT_MINUTES = 10
export const MAX_BEARING_DIFF_DEG = 90
export const POOL_DISCOUNT_PERCENT = 20

/** Offered choices for "how long can you wait for others?" when booking. */
export const WAIT_MINUTES_OPTIONS = [
  { minutes: 0,  label: "Don't wait" },
  { minutes: 3,  label: '3 min' },
  { minutes: 5,  label: '5 min' },
  { minutes: 10, label: '10 min' },
] as const

/** Mirrors FARE_POLICY.maxBonusPaisa in the API's fare rule. */
export const MAX_BONUS_PAISA = 5000

/** Offered choices for "add a bonus to attract a driver faster" when booking. */
export const BONUS_PAISA_OPTIONS = [
  { paisa: 0,    label: 'None' },
  { paisa: 1000, label: '+৳10' },
  { paisa: 2500, label: '+৳25' },
  { paisa: 5000, label: '+৳50' },
] as const

/** A REQUESTED ride nobody has matched within this long expires on its own. */
export const REQUEST_EXPIRY_MINUTES = 15
