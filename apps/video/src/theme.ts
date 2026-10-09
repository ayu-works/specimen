import { loadFont as loadDot } from '@remotion/google-fonts/DotGothic16';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import { loadFont as loadSilk } from '@remotion/google-fonts/Silkscreen';

/** Brand colours (docs/HANDOFF.md). Never change the critter's. */
export const C = {
  purple: '#7C6CF5',
  shine: '#A99BFF',
  red: '#FF6B6B',
  yellow: '#FFD166',
  green: '#06D6A0',
  blue: '#4D96FF',
  pink: '#FF9FB8',
  ink: '#1b1b2f',
  night: '#0e0e16',
  paper: '#F6F1E7',
  paperDark: '#EAE2D3',
  white: '#FFFFFF',
  grey: '#B9B5AE',
} as const;

export const TUFT = [C.red, C.yellow, C.green, C.blue] as const;
export const POP = [C.purple, C.red, C.yellow, C.green, C.blue] as const;

/** The made-up website we "scan". Not a real brand. */
export const SITE = {
  background: '#FBF7F1',
  surface: '#FFFFFF',
  text: '#1F1B16',
  muted: '#6E665C',
  accent: '#E8553D',
  link: '#2F6FDB',
  border: '#E3D9CB',
} as const;

export const FONT = {
  display: loadSilk('normal', { weights: ['400', '700'], subsets: ['latin'] }).fontFamily,
  jp: loadDot('normal', { weights: ['400'], ignoreTooManyRequestsWarning: true }).fontFamily,
  body: loadInter('normal', { weights: ['500', '700', '800'], subsets: ['latin'] }).fontFamily,
  mono: loadMono('normal', { weights: ['500', '700'], subsets: ['latin'] }).fontFamily,
};
