/**
 * The costume. Not an identity — two people can both be the cat.
 *
 * Stored next to the person, not on them. The cookie is who you are;
 * this is which sheet the room draws. Tests pass a bag of strings so
 * they never touch `localStorage`.
 */
import { DANCER_KINDS, type DancerKind } from '../../../../../src/render/SpriteDancer.ts';

export const FIGURE_KEY = 'neko.figure';

export interface FigureBag {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readFigure(bag: FigureBag = localStorage): DancerKind {
  const raw = bag.getItem(FIGURE_KEY);
  return DANCER_KINDS.includes(raw as DancerKind) ? (raw as DancerKind) : 'cat';
}

export function writeFigure(kind: DancerKind, bag: FigureBag = localStorage): void {
  bag.setItem(FIGURE_KEY, kind);
}
