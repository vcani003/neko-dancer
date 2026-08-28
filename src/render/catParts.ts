/**
 * The cat part table. GENERATED — do not edit.
 *
 * Written by `scripts/cut-parts.py`, which cuts the part sheet into
 * `public/cat/*.png` and measures what it produced. Re-run that script
 * rather than changing anything here; a hand edit is a number that
 * disagrees with the image it describes.
 */

export const CAT_HEADS = ['head-open', 'head-closed', 'head-happy'] as const;
export const CAT_TAILS = ['tail-curl', 'tail-raised', 'tail-wave', 'tail-arc'] as const;
export const CAT_LIMBS = ['arm-left', 'arm-right', 'leg-left', 'leg-right'] as const;

export type CatHead = (typeof CAT_HEADS)[number];
export type CatTail = (typeof CAT_TAILS)[number];
export type CatLimb = (typeof CAT_LIMBS)[number];
export type CatPartName = CatHead | CatTail | CatLimb | 'torso';

export interface CatPartMeta {
  readonly width: number;
  readonly height: number;
  /**
   * Centre of the limb's rounded cap, as a fraction of the texture.
   *
   * The pivot a rotating limb needs — a flat-cut shoulder opens a gap the
   * instant an arm lifts, and the cap is what keeps the joint covered
   * (`ART-BRIEF.md` §4 rule 1). The standing pose does not rotate anything,
   * so nothing reads this yet; it is measured now because it is measured
   * from the art, and the art is what changes.
   */
  readonly ballAnchor: readonly [number, number] | null;
}

export const CAT_PARTS: Record<CatPartName, CatPartMeta> = {
  'head-open': { width: 373, height: 344, ballAnchor: null },
  'head-closed': { width: 347, height: 343, ballAnchor: null },
  'head-happy': { width: 351, height: 344, ballAnchor: null },
  'torso': { width: 291, height: 310, ballAnchor: null },
  'arm-left': { width: 127, height: 224, ballAnchor: [0.6417, 0.1987] },
  'arm-right': { width: 125, height: 224, ballAnchor: [0.36, 0.1964] },
  'leg-left': { width: 105, height: 254, ballAnchor: [0.519, 0.1909] },
  'leg-right': { width: 105, height: 254, ballAnchor: [0.4714, 0.1909] },
  'tail-curl': { width: 268, height: 164, ballAnchor: null },
  'tail-raised': { width: 213, height: 243, ballAnchor: null },
  'tail-wave': { width: 278, height: 196, ballAnchor: null },
  'tail-arc': { width: 244, height: 178, ballAnchor: null },
};
