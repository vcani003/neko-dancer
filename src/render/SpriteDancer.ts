/**
 * The dance sheets, on the existing room.
 *
 * `CatDancer` rebuilt every vector of the figure sixty times a second.
 * These are five frames on a PNG. Same `draw(state, x, y, size)` contract
 * so `LaneRenderer` does not grow a second stage.
 *
 * Sheet order, left to right: idle, up, down, left, right.
 */
import { Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { Lane } from '../charts/schema.ts';
import { POSE_HOLD_MS, type CatState } from './CatPose.ts';

export const DANCER_KINDS = ['cat', 'bunny'] as const;
export type DancerKind = (typeof DANCER_KINDS)[number];

export type DancePose = 'idle' | Lane;

export const DANCE_SHEET_ORDER = ['idle', 'up', 'down', 'left', 'right'] as const;

const SHEET_URL: Record<DancerKind, string> = {
  cat: '/dancers/cat-dance.png',
  bunny: '/dancers/bunny-dance.png',
};

export function danceFrameIndex(pose: DancePose): number {
  const index = DANCE_SHEET_ORDER.indexOf(pose);
  return index === -1 ? 0 : index;
}

/** The sheet pose for this instant. No blending — a frame is a frame. */
export function dancePoseOf(state: CatState): DancePose {
  if (state.lane && state.nowMs - state.hitAtMs < POSE_HOLD_MS) return state.lane;
  return 'idle';
}

function sliceSheet(texture: Texture): Texture[] {
  const width = texture.width / DANCE_SHEET_ORDER.length;
  const height = texture.height;
  return DANCE_SHEET_ORDER.map((_, i) =>
    new Texture({
      source: texture.source,
      frame: new Rectangle(i * width, 0, width, height),
    }),
  );
}

export type DanceSheets = Record<DancerKind, Texture[]>;

export async function loadDanceSheets(): Promise<DanceSheets> {
  const cat = (await Assets.load(SHEET_URL.cat)) as Texture;
  const bunny = (await Assets.load(SHEET_URL.bunny)) as Texture;
  return { cat: sliceSheet(cat), bunny: sliceSheet(bunny) };
}

export class SpriteDancer {
  readonly view = new Container();
  private readonly sprite: Sprite;
  private readonly frames: Texture[];

  constructor(frames: Texture[]) {
    this.frames = frames;
    this.sprite = new Sprite(frames[0]);
    this.sprite.anchor.set(0.5, 1);
    this.view.addChild(this.sprite);
  }

  draw(state: CatState, x: number, y: number, size: number): void {
    const frame = this.frames[danceFrameIndex(dancePoseOf(state))] ?? this.frames[0];
    if (frame && this.sprite.texture !== frame) this.sprite.texture = frame;
    this.view.position.set(x, y);
    const height = this.sprite.texture.height || 1;
    this.sprite.scale.set(size / height);
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
