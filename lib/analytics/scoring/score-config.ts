/**
 * Influence score weights and config.
 * Adjust weights here to tune the composite score without touching dimension logic.
 */

export const SCORE_WEIGHTS = {
  political_money: 0.25,
  institutional_position: 0.20,
  lobbying: 0.20,
  economic_footprint: 0.15,
  network_centrality: 0.10,
  public_visibility: 0.10,
} as const

export const SCORE_VERSION = 1
export const TOP_N_THRESHOLD = 500

/** Title → institutional position tier (0–100). Used by dimension-scores. */
export const TITLE_TIERS: Record<string, number> = {
  governor: 100,
  'lieutenant governor': 90,
  'us senator': 100,
  'us representative': 85,
  'state senator': 70,
  'state representative': 65,
  mayor: 65,
  'cabinet director': 75,
  'department director': 75,
  'board chair': 60,
  'state board member': 40,
  'ceo': 80,
  'board member': 15,
}
