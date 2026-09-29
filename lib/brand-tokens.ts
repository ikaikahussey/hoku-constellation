/**
 * Design tokens for renderers that cannot read CSS variables: email HTML and PDF/DOCX output.
 * Mirrors the @theme block in app/globals.css; tests/design-tokens.test.ts asserts they match.
 * Allowlisted in the design-token lint because it is the one place outside globals.css that holds literals.
 */
export const TOKENS = {
  ink: '#000000',
  paper: '#FFFFFF',
  link: '#CC0000',
  muted: '#595959',
  rule: '#E5E5E5',
  gray100: '#F5F5F5',
} as const

export type TokenName = keyof typeof TOKENS

/** 0–1 channel values for pdf-lib / docx. */
export function tokenRgb(name: TokenName): { r: number; g: number; b: number } {
  const hex = TOKENS[name].slice(1)
  return { r: parseInt(hex.slice(0, 2), 16) / 255, g: parseInt(hex.slice(2, 4), 16) / 255, b: parseInt(hex.slice(4, 6), 16) / 255 }
}

/** Bare hex (no '#') for docx. */
export const tokenHex = (name: TokenName) => TOKENS[name].slice(1)

export const FONT_STACK = '"Helvetica Neue", Helvetica, Arial, sans-serif'
