/**
 * The falling-arrow field, in PixiJS.
 *
 * Four lanes, arrows travelling toward a receptor line. Thirty years of rhythm
 * games have settled on this and it is readable in a way hop//beat's approach
 * rings never became: distance to the receptor IS time to the beat, so a
 * player reads timing spatially without being taught anything.
 *
 * The renderer owns no game state. It is handed a frame's worth and draws it,
 * so it can be destroyed and rebuilt without disturbing a song in progress.
 */
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { ActiveArrow, Judgment } from '../engine/LaneJudge.ts';
import { LANES, LANE_INDEX, type Lane } from '../charts/schema.ts';
import { CatDancer } from './CatDancer.ts';

const LANE_COLOUR: Record<Lane, number> = {
  left: 0xf472b6,
  down: 0x38bdf8,
  up: 0x4ade80,
  right: 0xf5c451,
};

const JUDGMENT_COLOUR: Record<Judgment, number> = {
  PERFECT: 0x4ade80,
  NICE: 0x38bdf8,
  OKAY: 0xf5c451,
  OOPS: 0xfb923c,
  MISS: 0xf87171,
};

/**
 * How far ahead an arrow appears, in milliseconds of song.
 *
 * Time rather than distance, so scroll speed is the same musical distance on
 * every screen: an arrow always spends this long travelling, whatever the
 * window height.
 */
export const DEFAULT_LEAD_MS = 1600;

/** Where the receptor sits, as a fraction of height from the top. */
const RECEPTOR_Y = 0.82;

const ARROW_SIZE = 0.5; // fraction of lane width

interface Popup {
  text: Text;
  bornAt: number;
  lane: Lane;
}

interface Flash {
  graphic: Graphics;
  bornAt: number;
  colour: number;
  lane: Lane;
}

export interface LaneRenderState {
  arrows: readonly ActiveArrow[];
  playbackTimeMs: number;
  heldLanes: ReadonlySet<Lane>;
  leadMs: number;
  nowMs: number;
  /** Tempo for the cat's idle bob. Zero means stand still. */
  bpm?: number;
}

const POPUP_MS = 520;
const FLASH_MS = 260;

export class LaneRenderer {
  private app: Application | null = null;
  private fieldLayer = new Container();
  private catLayer = new Container();
  private arrowLayer = new Container();
  private effectLayer = new Container();
  private cat = new CatDancer();

  /** What the cat is reacting to. */
  private lastLane: Lane | null = null;
  private lastHitAtMs = 0;
  private lastMissAtMs = 0;
  private fieldGraphics = new Graphics();
  private arrowGraphics = new Graphics();

  private popups: Popup[] = [];
  private flashes: Flash[] = [];

  private width = 0;
  private height = 0;

  /**
   * PixiJS creates its own canvas rather than being handed one.
   *
   * Learned the hard way in hop//beat: React StrictMode mounts every effect
   * twice, and two Applications sharing a canvas means destroying the
   * cancelled one takes the WebGL context out from under the live one. The
   * symptom is a game that runs perfectly while drawing nothing.
   */
  async init(container: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({
      resizeTo: container,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });

    app.canvas.className = 'field__canvas';
    container.appendChild(app.canvas);
    // The cat sits behind the arrows: she is the reason to look at the screen,
    // but never the thing in the way of reading one.
    app.stage.addChild(this.fieldLayer, this.catLayer, this.arrowLayer, this.effectLayer);
    this.catLayer.addChild(this.cat.view);
    this.fieldLayer.addChild(this.fieldGraphics);
    this.arrowLayer.addChild(this.arrowGraphics);

    this.app = app;
    this.resize();
  }

  resize(): void {
    if (!this.app) return;
    // `screen` is the view in CSS pixels — the same space the layout is in.
    this.width = this.app.renderer.screen.width;
    this.height = this.app.renderer.screen.height;
  }

  isReady(): boolean {
    return this.app !== null;
  }

  private laneWidth(): number {
    return this.width / LANES.length;
  }

  private laneCentreX(lane: Lane): number {
    return this.laneWidth() * (LANE_INDEX[lane] + 0.5);
  }

  private receptorY(): number {
    return this.height * RECEPTOR_Y;
  }

  render(state: LaneRenderState): void {
    if (!this.app) return;
    this.resize();
    this.drawField(state);
    this.drawCat(state);
    this.drawArrows(state);
    this.updateEffects(state.nowMs);
  }

  private drawField(state: LaneRenderState): void {
    const g = this.fieldGraphics;
    g.clear();

    const laneWidth = this.laneWidth();
    const receptorY = this.receptorY();
    const size = laneWidth * ARROW_SIZE;

    for (const lane of LANES) {
      const cx = this.laneCentreX(lane);
      const colour = LANE_COLOUR[lane];
      const held = state.heldLanes.has(lane);

      // Lane column, barely there — it separates without competing.
      g.rect(cx - laneWidth / 2, 0, laneWidth, this.height)
        .fill({ color: colour, alpha: held ? 0.07 : 0.025 });

      // Receptor: the thing an arrow is travelling toward. Lit while held, so
      // a player can see their own input independently of whether it scored.
      this.drawArrowShape(g, cx, receptorY, size, lane);
      g.stroke({ width: held ? 4 : 2, color: colour, alpha: held ? 1 : 0.55 });
      if (held) {
        this.drawArrowShape(g, cx, receptorY, size, lane);
        g.fill({ color: colour, alpha: 0.25 });
      }
    }

    // The receptor line itself, so the row reads as one target rather than four.
    g.moveTo(0, receptorY).lineTo(this.width, receptorY)
      .stroke({ width: 1, color: 0xffffff, alpha: 0.12 });
  }

  private drawArrows(state: LaneRenderState): void {
    const g = this.arrowGraphics;
    g.clear();

    const laneWidth = this.laneWidth();
    const size = laneWidth * ARROW_SIZE;
    const receptorY = this.receptorY();

    for (const active of state.arrows) {
      if (active.judgment !== null) continue;

      const remaining = active.timeMs - state.playbackTimeMs;
      if (remaining > state.leadMs || remaining < -200) continue;

      // Distance to the receptor IS time to the beat. That is the whole idea:
      // the player reads timing spatially and never has to be told how.
      const progress = 1 - remaining / state.leadMs;
      const y = progress * receptorY;
      const cx = this.laneCentreX(active.arrow.lane);
      const colour = LANE_COLOUR[active.arrow.lane];

      // Fade in at the top so arrows arrive rather than blink into being.
      const alpha = Math.min(1, progress * 5);

      this.drawArrowShape(g, cx, y, size, active.arrow.lane);
      g.fill({ color: colour, alpha: alpha * 0.9 });
      this.drawArrowShape(g, cx, y, size, active.arrow.lane);
      g.stroke({ width: 2, color: 0xffffff, alpha: alpha * 0.5 });
    }
  }

  /** A chevron pointing the way its lane does. */
  private drawArrowShape(g: Graphics, cx: number, cy: number, size: number, lane: Lane): void {
    const h = size / 2;
    const rotations: Record<Lane, number> = {
      left: Math.PI / 2,
      down: 0,
      up: Math.PI,
      right: -Math.PI / 2,
    };
    const angle = rotations[lane];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // A downward chevron, rotated into the lane's direction.
    const points: Array<[number, number]> = [
      [0, h], [-h, 0], [-h * 0.45, 0], [-h * 0.45, -h], [h * 0.45, -h], [h * 0.45, 0], [h, 0],
    ];
    const mapped = points.map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
    g.poly(mapped.flat());
  }

  /**
   * The cat, on the stage between the receptors and the bottom edge.
   *
   * Below the receptor line on purpose: that strip is otherwise dead space, and
   * putting her there means she is visible without ever sitting under a falling
   * arrow the player is trying to read.
   */
  private drawCat(state: LaneRenderState): void {
    const stageTop = this.receptorY();
    const available = this.height - stageTop;
    if (available < 40) {
      this.cat.view.visible = false;
      return;
    }

    this.cat.view.visible = true;
    const size = Math.min(available * 0.78, this.width * 0.18);
    this.cat.draw(
      {
        lane: this.lastLane,
        hitAtMs: this.lastHitAtMs,
        missAtMs: this.lastMissAtMs,
        bpm: state.bpm ?? 0,
        playbackMs: state.playbackTimeMs,
        nowMs: state.nowMs,
      },
      this.width / 2,
      this.height - available * 0.08,
      size,
    );
  }

  /** Feedback for one judgment, fired straight from the engine's output. */
  showJudgment(judgment: Judgment, lane: Lane, nowMs: number): void {
    if (!this.app) return;

    // The cat reacts to what the player did, so the movement is a consequence
    // of playing rather than an animation running alongside it.
    if (judgment === 'MISS') {
      this.lastMissAtMs = nowMs;
    } else {
      this.lastLane = lane;
      this.lastHitAtMs = nowMs;
    }

    const colour = JUDGMENT_COLOUR[judgment];
    const cx = this.laneCentreX(lane);

    if (judgment !== 'MISS') {
      const graphic = new Graphics();
      graphic.position.set(cx, this.receptorY());
      this.effectLayer.addChild(graphic);
      this.flashes.push({ graphic, bornAt: nowMs, colour, lane });
    }

    const text = new Text({
      text: judgment,
      style: {
        fill: colour,
        fontSize: judgment === 'PERFECT' ? 22 : 18,
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontWeight: '700',
        letterSpacing: 1.2,
      },
    });
    text.anchor.set(0.5);
    text.position.set(cx, this.receptorY() - this.laneWidth() * 0.55);
    this.effectLayer.addChild(text);
    this.popups.push({ text, bornAt: nowMs, lane });
  }

  private updateEffects(nowMs: number): void {
    const size = this.laneWidth() * ARROW_SIZE;

    this.flashes = this.flashes.filter((flash) => {
      const age = (nowMs - flash.bornAt) / FLASH_MS;
      if (age >= 1) {
        flash.graphic.destroy();
        return false;
      }
      const eased = 1 - (1 - age) ** 3;
      flash.graphic.clear();
      flash.graphic
        .circle(0, 0, size * (0.6 + eased * 1.1))
        .stroke({ width: 3 * (1 - age), color: flash.colour, alpha: 1 - age });
      return true;
    });

    this.popups = this.popups.filter((popup) => {
      const age = (nowMs - popup.bornAt) / POPUP_MS;
      if (age >= 1) {
        popup.text.destroy();
        return false;
      }
      popup.text.alpha = 1 - age ** 2;
      popup.text.y -= 0.5;
      return true;
    });
  }

  clearEffects(): void {
    for (const f of this.flashes) f.graphic.destroy();
    for (const p of this.popups) p.text.destroy();
    this.flashes = [];
    this.popups = [];
    this.lastLane = null;
    this.lastHitAtMs = 0;
    this.lastMissAtMs = 0;
  }

  destroy(): void {
    this.clearEffects();
    this.app?.destroy(true, { children: true });
    this.app = null;
  }

  /** Pose the cat from a key press, before any judgment is known. */
  reactToPress(lane: Lane, nowMs: number): void {
    this.lastLane = lane;
    this.lastHitAtMs = nowMs;
  }
}
