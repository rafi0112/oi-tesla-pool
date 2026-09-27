/**
 * Mirrors POOL_POLICY in the API's matching rule. The server is always the
 * authority — these values only drive what the console displays, never what it
 * allows, so a drift shows up as a wrong countdown, never as a bad decision.
 */
export const POOL_WINDOW_MINUTES = 10
export const MAX_BEARING_DIFF_DEG = 90
export const POOL_DISCOUNT_PERCENT = 20
