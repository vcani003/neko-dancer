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
import { createWalker, depthScale, step, type Walker } from './Wander.ts';

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

/**
 * The lane strip: a narrow column down the left, not the whole screen.
 *
 * The arrows are the thing being read, but they are not the thing being
 * watched. Giving them a column leaves the rest of the room to the cats, which
 * is the point of a dancing game — you play in the corner of your eye and look
 * at the party.
 */
const LANE_STRIP_WIDTH = 0.26;
const LANE_STRIP_MAX_PX = 320;

/** Where the receptor sits within the strip, as a fraction of its height. */
const RECEPTOR_Y = 0.78;

const ARROW_SIZE = 0.46; // fraction of lane width

export interface RoomPlayerView {
  id: string;
  name: string;
  isMe: boolean;
  /** The lane they last hit, so their cat poses. */
  lane?: Lane | null;
  hitAtMs?: number;
  missAtMs?: number;
}

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
  /** Everyone in the room, including the local player. */
  players?: readonly RoomPlayerView[];
  /** Cats stop strolling and dance in place while a round runs. */
  roundRunning?: boolean;
}

const POPUP_MS = 520;
const FLASH_MS = 260;

export class LaneRenderer {
  private app: Application | null = null;
  private roomLayer = new Container();
  private fieldLayer = new Container();
  private catLayer = new Container();
  private arrowLayer = new Container();
  private effectLayer = new Container();
  private roomGraphics = new Graphics();

  /** One cat and one walker per player, kept between frames. */
  private cats = new Map<string, { dancer: CatDancer; walker: Walker; label: Text }>();
  private lastFrameMs = 0;

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
    app.stage.addChild(
      this.roomLayer,
      this.catLayer,
      this.fieldLayer,
      this.arrowLayer,
      this.effectLayer,
    );
    this.roomLayer.addChild(this.roomGraphics);
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

  /** The strip the lanes live in: left edge, full height, capped width. */
  private stripWidth(): number {
    return Math.min(this.width * LANE_STRIP_WIDTH, LANE_STRIP_MAX_PX);
  }

  private laneWidth(): number {
    return this.stripWidth() / LANES.length;
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
    const deltaMs = this.lastFrameMs ? Math.min(200, state.nowMs - this.lastFrameMs) : 16;
    this.lastFrameMs = state.nowMs;

    this.drawRoom(state);
    this.drawCats(state, deltaMs);
    this.drawField(state);
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
        .fill({ color: colour, alpha: held ? 0.09 : 0.03 });

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
    g.moveTo(0, receptorY).lineTo(this.stripWidth(), receptorY)
      .stroke({ width: 1, color: 0xffffff, alpha: 0.14 });

    // A soft edge where the strip ends and the room begins.
    g.moveTo(this.stripWidth(), 0).lineTo(this.stripWidth(), this.height)
      .stroke({ width: 1, color: 0xffffff, alpha: 0.07 });
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
   * The room: a floor the cats stand on, to the right of the lane strip.
   *
   * Just enough of a horizon to read as a place rather than a background. The
   * cats supply the interest; the room only has to stop them floating.
   */
  private drawRoom(state: LaneRenderState): void {
    const g = this.roomGraphics;
    g.clear();

    const left = this.stripWidth();
    const width = this.width - left;
    if (width <= 0) return;

    const horizon = this.height * 0.42;

    // Back wall, then floor, with the join left visible.
    g.rect(left, 0, width, horizon).fill({ color: 0x1a1220 });
    g.rect(left, horizon, width, this.height - horizon).fill({ color: 0x241a2c });
    g.moveTo(left, horizon).lineTo(this.width, horizon)
      .stroke({ width: 1, color: 0xffffff, alpha: 0.06 });

    // Floorboards receding, which is most of what sells a floor.
    for (let i = 1; i < 7; i++) {
      const t = i / 7;
      const y = horizon + (this.height - horizon) * t * t;
      g.moveTo(left, y).lineTo(this.width, y)
        .stroke({ width: 1, color: 0xffffff, alpha: 0.04 });
    }

    // A pool of light where the dancing happens.
    const glowY = this.height * 0.78;
    g.ellipse(left + width / 2, glowY, width * 0.42, this.height * 0.16)
      .fill({ color: 0xf472b6, alpha: state.roundRunning ? 0.07 : 0.035 });
  }

  /**
   * Everyone's cat, walking about between rounds and dancing during one.
   *
   * Cats are drawn back to front so a nearer one overlaps a further one, which
   * is the whole payoff of giving the room any depth at all.
   */
  private drawCats(state: LaneRenderState, deltaMs: number): void {
    const players = state.players ?? [];
    const left = this.stripWidth();
    const width = this.width - left;

    // Retire cats whose player has gone.
    const present = new Set(players.map((p) => p.id));
    for (const [id, entry] of this.cats) {
      if (present.has(id)) continue;
      entry.dancer.destroy();
      entry.label.destroy();
      this.cats.delete(id);
    }

    const drawn: Array<{ y: number; entry: { dancer: CatDancer; label: Text }; player: RoomPlayerView; size: number; x: number }> = [];

    for (const player of players) {
      let entry = this.cats.get(player.id);
      if (!entry) {
        const dancer = new CatDancer();
        const label = new Text({
          text: player.name,
          style: {
            fill: player.isMe ? 0xf472b6 : 0xbfb2cc,
            fontSize: 11,
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontWeight: '600',
          },
        });
        label.anchor.set(0.5);
        this.catLayer.addChild(dancer.view, label);
        entry = { dancer, walker: createWalker(player.id, state.nowMs), label };
        this.cats.set(player.id, entry);
      }

      entry.walker = step(entry.walker, player.id, state.nowMs, deltaMs, {
        frozen: state.roundRunning,
      });

      const scale = depthScale(entry.walker.position.y);
      const x = left + entry.walker.position.x * width;
      const y = entry.walker.position.y * this.height;
      const size = Math.min(this.height * 0.2, width * 0.16) * scale;

      drawn.push({ y, entry, player, size, x });
    }

    // Painter's algorithm: further up the room is further away.
    drawn.sort((a, b) => a.y - b.y);
    for (const item of drawn) {
      this.catLayer.setChildIndex(item.entry.dancer.view, this.catLayer.children.length - 1);
      this.catLayer.setChildIndex(item.entry.label, this.catLayer.children.length - 1);

      // The local player's cat is posed from what the renderer itself saw,
      // which is a frame earlier than anything that could arrive over a socket.
      const mine = item.player.isMe;
      item.entry.dancer.draw(
        {
          lane: mine ? this.lastLane : (item.player.lane ?? null),
          hitAtMs: mine ? this.lastHitAtMs : (item.player.hitAtMs ?? 0),
          missAtMs: mine ? this.lastMissAtMs : (item.player.missAtMs ?? 0),
          bpm: state.roundRunning ? (state.bpm ?? 0) : 0,
          playbackMs: state.playbackTimeMs,
          nowMs: state.nowMs,
        },
        item.x,
        item.y,
        item.size,
      );

      item.entry.label.position.set(item.x, item.y + item.size * 0.16);
      item.entry.label.scale.set(Math.max(0.7, item.size / (this.height * 0.2)));
    }
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
