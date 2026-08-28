/**
 * The cat, standing, assembled from cut-out parts.
 *
 * A **static pose**, deliberately. `CatDancer` still draws every animated cat
 * in the game from numbers, and nothing here replaces it — this exists so the
 * drawn art can be seen in the real renderer, and so the cut-and-assemble
 * pipeline is proven before any of the posing work depends on it.
 *
 * ## Why this is not `CatDancer` with textures
 *
 * `CatDancer` takes a `CatPose` — seven continuous values — and draws whatever
 * they say. This takes no pose at all. That gap is not laziness; it is what the
 * art can currently support:
 *
 * - The limbs are drawn **already curved**, and `ART-BRIEF.md` §4 rule 2 is
 *   that a part drawn already-bent bends twice. They hang correctly and rotate
 *   badly.
 * - There are **four finished tail curves**, not the three segments the brief
 *   asks for. `CatPose.tail` is continuous from -1 to 1 and there is no way to
 *   interpolate between four discrete shapes, so a swayed tail would snap.
 * - Faces are **baked into the heads**, so expression is a head swap rather
 *   than a layer. Three states, and they cannot combine with anything.
 *
 * None of that stops a cat standing still, which is what this draws.
 *
 * ## Layer order, and the one thing it fixes
 *
 * Back to front: tail, legs, arms, torso, head. The arms go **behind** the
 * torso and not in front, which is not a style choice — drawn in front, each
 * arm's pale ball cap sits on the belly as a visible disc. Behind it, only the
 * lower arm and paw show past the body's edge, and the joint is covered, which
 * is the whole point of the cap.
 */
import { Assets, Container, Sprite, type Texture } from 'pixi.js';
import { CAT_PARTS, type CatHead, type CatPartName, type CatTail } from './catParts.ts';

/**
 * Where every part sits, in units of the torso's height.
 *
 * Tuned by eye against the real art, which is the only way this can be tuned —
 * the numbers describe how a particular drawing fits together, and there is no
 * derivation that would produce them. Positions are the part's CENTRE, and
 * rotation is about that centre, because that is the frame they were tuned in.
 *
 * `ballAnchor` in `catParts.ts` is the pivot a *rotating* limb wants. It is
 * deliberately not used here: nothing rotates in a standing pose, and quietly
 * switching frames would move every part by an amount nobody measured.
 */
export interface CatLayout {
  /** Positive x is the cat's right on screen; positive y is down. */
  readonly headY: number;
  readonly headScale: number;
  readonly armX: number;
  readonly armY: number;
  readonly armScale: number;
  /** Degrees, mirrored between the two sides. */
  readonly armTilt: number;
  readonly legX: number;
  readonly legY: number;
  readonly legScale: number;
  readonly tailX: number;
  readonly tailY: number;
  readonly tailScale: number;
}

export const STANDING: CatLayout = {
  headY: -0.62,
  headScale: 0.62,
  armX: 0.5,
  armY: 0.18,
  armScale: 0.62,
  armTilt: 8,
  legX: 0.2,
  legY: 0.44,
  legScale: 0.52,
  tailX: 0.5,
  tailY: 0.26,
  tailScale: 0.85,
};

export interface CatSpriteOptions {
  head?: CatHead;
  tail?: CatTail;
  layout?: CatLayout;
}

/** Where the PNGs are served from. Respects a non-root base path. */
function partUrl(name: CatPartName): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base.endsWith('/') ? base : `${base}/`}cat/${name}.png`;
}

/**
 * Load every part once.
 *
 * All of them, not the ones the current cat happens to use: the heads are an
 * expression swap and the tails are a variant, so a cat that blinks would
 * otherwise pop the first time it does it, on the frame it can least afford to.
 */
export async function loadCatParts(): Promise<void> {
  await Assets.load((Object.keys(CAT_PARTS) as CatPartName[]).map(partUrl));
}

export class CatSprite {
  readonly view = new Container();

  private readonly parts = new Map<CatPartName, Sprite>();
  private readonly layout: CatLayout;
  private head: CatHead;
  private tail: CatTail;

  constructor(options: CatSpriteOptions = {}) {
    this.layout = options.layout ?? STANDING;
    this.head = options.head ?? 'head-open';
    this.tail = options.tail ?? 'tail-curl';
    this.build();
  }

  private sprite(name: CatPartName, flipX = false): Sprite {
    const texture = Assets.get(partUrl(name)) as Texture | undefined;
    const sprite = texture ? new Sprite(texture) : new Sprite();
    sprite.anchor.set(0.5, 0.5);
    if (flipX) sprite.scale.x = -1;
    this.parts.set(name, sprite);
    return sprite;
  }

  private build(): void {
    this.view.removeChildren();
    this.parts.clear();
    // The tail is flipped so its thick end meets the body: every tail on the
    // sheet is drawn with the pale tip leading, and unflipped the cat wears it
    // backwards — a narrow tip growing out of the hip into a heavy end.
    this.view.addChild(this.sprite(this.tail, true));
    this.view.addChild(this.sprite('leg-left'));
    this.view.addChild(this.sprite('leg-right'));
    this.view.addChild(this.sprite('arm-left'));
    this.view.addChild(this.sprite('arm-right'));
    this.view.addChild(this.sprite('torso'));
    this.view.addChild(this.sprite(this.head));
  }

  /** Swap the expression. Cheap — the textures are already loaded. */
  setHead(head: CatHead): void {
    if (head === this.head) return;
    this.head = head;
    this.build();
  }

  setTail(tail: CatTail): void {
    if (tail === this.tail) return;
    this.tail = tail;
    this.build();
  }

  /**
   * @param size the torso's height in pixels. Every other part is a fraction
   *   of it, so the cat is the same shape at any scale — the same contract
   *   `CatDancer.draw` offers, so the two can stand side by side.
   */
  draw(x: number, y: number, size: number): void {
    const l = this.layout;
    const unit = size / CAT_PARTS.torso.height;
    const place = (
      name: CatPartName,
      ux: number,
      uy: number,
      scale: number,
      tiltDegrees = 0,
      flipX = false,
    ) => {
      const sprite = this.parts.get(name);
      if (!sprite) return;
      sprite.x = x + ux * size;
      sprite.y = y + uy * size;
      const k = unit * scale;
      sprite.scale.set(flipX ? -k : k, k);
      sprite.rotation = (tiltDegrees * Math.PI) / 180;
    };

    place(this.tail, l.tailX, l.tailY, l.tailScale, 0, true);
    place('leg-left', -l.legX, l.legY, l.legScale);
    place('leg-right', l.legX, l.legY, l.legScale);
    place('arm-left', -l.armX, l.armY, l.armScale, -l.armTilt);
    place('arm-right', l.armX, l.armY, l.armScale, l.armTilt);
    place('torso', 0, 0, 1);
    place(this.head, 0, l.headY, l.headScale);
  }

  destroy(): void {
    this.view.destroy({ children: true });
    this.parts.clear();
  }
}
