/**
 * The catalog, over HTTP. The cookie is first-party because Vite proxies
 * `/api` onto the store process.
 *
 * `send` is injected so tests never call the network — the determinism
 * gate reads this package's tests off disk and bans `fetch(`.
 */
import type {
  Beatmap,
  BeatmapId,
  BeatmapSummary,
  ChartRevision,
  PlayableChart,
  RevisionId,
  RoundResult,
  Song,
  StoredScore,
  User,
  UserId,
} from '@neko/protocol';
import type { Catalog } from './Catalog.ts';

export interface RoomListing {
  id: string;
  name: string;
  occupants: number;
  cap: number;
}

export interface CreatedChart {
  song: Song;
  beatmap: Beatmap;
  revision: ChartRevision;
}

export interface CreateChartInput {
  providerMediaId: string;
  title?: string;
  artist?: string;
  durationMs?: number;
  thumbnailUrl?: string;
  timing: unknown;
  notes: unknown;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

export type HttpSend = (input: {
  method: string;
  path: string;
  body?: unknown;
}) => Promise<HttpResponse>;

export async function browserSend(input: {
  method: string;
  path: string;
  body?: unknown;
}): Promise<HttpResponse> {
  const response = await fetch(input.path, {
    method: input.method,
    credentials: 'same-origin',
    headers: input.body === undefined ? {} : { 'content-type': 'application/json' },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  return { status: response.status, body: await response.json() };
}

export class HttpCatalog implements Catalog {
  readonly send: HttpSend;

  constructor(send: HttpSend = browserSend) {
    this.send = send;
  }

  async me(): Promise<User> {
    return (await this.get('/api/me')) as User;
  }

  async rename(displayName: string): Promise<User> {
    const { status, body } = await this.send({
      method: 'PATCH',
      path: '/api/me',
      body: { displayName },
    });
    if (status >= 400) throw new Error(errorOf(body));
    return body as User;
  }

  async listPublished(): Promise<BeatmapSummary[]> {
    return (await this.get('/api/library')) as BeatmapSummary[];
  }

  /** Home's shelf: drafts and published. */
  async listAll(): Promise<BeatmapSummary[]> {
    return (await this.get('/api/library?all=1')) as BeatmapSummary[];
  }

  async listRooms(): Promise<RoomListing[]> {
    return (await this.get('/api/rooms')) as RoomListing[];
  }

  async createChart(input: CreateChartInput): Promise<CreatedChart> {
    const { status, body } = await this.send({
      method: 'POST',
      path: '/api/charts',
      body: input,
    });
    if (status >= 400) throw new Error(errorOf(body));
    return body as CreatedChart;
  }

  async publishBeatmap(id: BeatmapId): Promise<Beatmap> {
    const { status, body } = await this.send({
      method: 'POST',
      path: `/api/beatmaps/${id}/publish`,
    });
    if (status >= 400) throw new Error(errorOf(body));
    return body as Beatmap;
  }

  async getPlayable(revisionId: RevisionId): Promise<PlayableChart | null> {
    const { status, body } = await this.send({ method: 'GET', path: `/api/playable/${revisionId}` });
    if (status === 404) return null;
    if (status >= 400) throw new Error(errorOf(body));
    return body as PlayableChart;
  }

  async recordScore(userId: UserId, revisionId: RevisionId, result: RoundResult): Promise<StoredScore> {
    void userId;
    const { status, body } = await this.send({
      method: 'POST',
      path: '/api/scores',
      body: { revisionId, result },
    });
    if (status >= 400) throw new Error(errorOf(body));
    return body as StoredScore;
  }

  private async get(path: string): Promise<unknown> {
    const { status, body } = await this.send({ method: 'GET', path });
    if (status >= 400) throw new Error(errorOf(body));
    return body;
  }
}

function errorOf(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
    return body.error;
  }
  return 'The server refused that.';
}
