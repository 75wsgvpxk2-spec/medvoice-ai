import type { Clinic } from '../../../shared/types';
import { DEFAULT_BRAND } from '../../../shared/types';

/**
 * Repaints the interface chrome in a clinic's own colours.
 *
 * Only the brand tokens are touched. Urgency colours — critical, watch,
 * managed, stable — are never rewritten from here: red means critical in this
 * system, and a clinic that could recolour it could make a hypertensive crisis
 * look like a routine note. That is the one place Section 9's "colour carries
 * clinical meaning and nothing else" is load-bearing rather than stylistic.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

const toHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

/** Mixes towards white by `amount` (0–1), for the washes and hairlines. */
function lighten(hex: string, amount: number): string {
  const [r, g, b] = channels(hex);
  return toHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

function mix(a: string, b: string, weight: number): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return toHex(
    ar + (br - ar) * weight,
    ag + (bg - ag) * weight,
    ab + (bb - ab) * weight,
  );
}

/**
 * Relative luminance, used to decide whether a chosen colour is light enough
 * that white text on it would be unreadable. A clinic picking pale yellow
 * should get a legible sidebar, not a broken one.
 */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function applyBranding(clinic: Clinic | null): void {
  const root = document.documentElement;

  const dark = clinic?.brandDark && HEX.test(clinic.brandDark) ? clinic.brandDark : DEFAULT_BRAND.brandDark;
  const light = clinic?.brandLight && HEX.test(clinic.brandLight) ? clinic.brandLight : DEFAULT_BRAND.brandLight;

  // White sits on the dark colour throughout the sidebar and on filled buttons.
  // If the clinic picked something too pale for that, darken it until it works
  // rather than shipping an unreadable interface.
  let base = dark;
  let guard = 0;
  while (luminance(base) > 0.32 && guard < 12) {
    base = mix(base, '#000000', 0.15);
    guard += 1;
  }

  const mid = mix(base, light, 0.55);

  root.style.setProperty('--brand-navy', base);
  root.style.setProperty('--brand-deep', mid);
  root.style.setProperty('--brand-blue', light);
  root.style.setProperty('--brand-light', lighten(light, 0.25));
  root.style.setProperty('--brand-glow', lighten(light, 0.45));
  root.style.setProperty('--brand-wash', lighten(light, 0.92));
  root.style.setProperty('--brand-line', lighten(light, 0.72));
  root.style.setProperty(
    '--brand-gradient',
    `linear-gradient(135deg, ${base} 0%, ${mid} 55%, ${light} 100%)`,
  );
  root.style.setProperty('--brand-gradient-soft', `linear-gradient(135deg, ${lighten(light, 0.92)} 0%, ${lighten(light, 0.86)} 100%)`);
}

/** Preview a pair without persisting, for the colour picker. */
export function previewBranding(brandDark: string, brandLight: string): void {
  applyBranding({ brandDark, brandLight } as Clinic);
}
