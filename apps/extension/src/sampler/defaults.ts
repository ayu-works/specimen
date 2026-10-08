import type { StyleKey } from '@specimen/core/styleKeys';

/**
 * Initial/default computed values. A style equal to its default is omitted from a
 * sample to keep RawPage small. A missing key therefore means "the default".
 *
 * `display` and the inherited text properties (`color`, `fontFamily`, `fontSize`,
 * `fontWeight`) have no default entry: they are always meaningful. Inherited keys are
 * emitted only on text-bearing samples (see `INHERITED_TEXT_KEYS`).
 */
export const DEFAULTS: Partial<Record<StyleKey, string>> = {
  backgroundColor: 'rgba(0, 0, 0, 0)',
  backgroundImage: 'none',
  borderRadius: '0px',
  boxShadow: 'none',
  lineHeight: 'normal',
  letterSpacing: 'normal',
  textTransform: 'none',
  paddingTop: '0px',
  paddingRight: '0px',
  paddingBottom: '0px',
  paddingLeft: '0px',
  marginTop: '0px',
  marginRight: '0px',
  marginBottom: '0px',
  marginLeft: '0px',
  gap: 'normal',
  rowGap: 'normal',
  columnGap: 'normal',
  flexDirection: 'row',
  gridTemplateColumns: 'none',
  justifyContent: 'normal',
  alignItems: 'normal',
  maxWidth: 'none',
  width: 'auto',
  position: 'static',
  opacity: '1',
  transitionDuration: '0s',
  transitionTimingFunction: 'ease',
};

/** Inherited typography keys: only recorded on samples that actually render text. */
export const INHERITED_TEXT_KEYS: readonly StyleKey[] = [
  'color',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textTransform',
];

/** Border keys come in (color, width, style) triplets per side. */
export const BORDER_SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const;
