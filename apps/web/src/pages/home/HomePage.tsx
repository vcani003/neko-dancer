/**
 * Who you are, who dances, our songs, which room you walk into.
 *
 * Home is a library shelf, not a DJ request. Tapping a song here does
 * not put it on in Public. Published songs from this list are what
 * Public shuffles later.
 */
import { useEffect, useMemo, useState } from 'react';
import type { BeatmapSummary, User } from '@neko/protocol';
import type { DancerKind } from '../../../../../src/render/SpriteDancer.ts';
import { HttpCatalog, type RoomListing } from '../../play/HttpCatalog.ts';
import { Nav } from '../shared/Nav.tsx';
import { readFigure, writeFigure } from '../shared/figure.ts';

export function HomePage() {
  const catalog = useMemo(() => new HttpCatalog(), []);
  const [user, setUser] = useState<User | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [kind, setKind] = useState<DancerKind>(() => readFigure());
  const [library, setLibrary] = useState<BeatmapSummary[]>([]);
  const [rooms, setRooms] = useState<RoomListing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await catalog.me();
        const listed = await catalog.listAll();
        const open = await catalog.listRooms();
        if (cancelled) return;
        setUser(me);
        setNameDraft(me.displayName);
        setLibrary(listed);
        setRooms(open);
      } catch {
        if (!cancelled) {
          setError('The store is not running. In another terminal, from this repo: npm run api');
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog]);

  async function saveName(): Promise<void> {
    if (!user || nameDraft === user.displayName) return;
    try {
      const next = await catalog.rename(nameDraft);
      setUser(next);
      setNameDraft(next.displayName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that name.');
    }
  }

  function pick(next: DancerKind): void {
    setKind(next);
    writeFigure(next);
  }

  const publicRoom = rooms[0] ?? { id: 'public', name: 'Public', occupants: 0, cap: 6 };
  const full = publicRoom.occupants >= publicRoom.cap;

  return (
    <div className="door">
      <Nav here="home" />
      <h1>
        neko <span>dancer</span>
      </h1>
      <p className="hint">
        A name, a figure, our songs. Join the room when you want to dance.
        Open as <code>http://&lt;hostname&gt;.local:5180/</code>.
      </p>

      {user && (
        <form
          className="who"
          onSubmit={(event) => {
            event.preventDefault();
            void saveName();
          }}
        >
          <label htmlFor="display-name">playing as</label>
          <input
            id="display-name"
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={() => void saveName()}
          />
        </form>
      )}

      <div className="cast__buttons">
        <button type="button" className={kind === 'cat' ? 'is-active' : undefined} onClick={() => pick('cat')}>
          Cat
        </button>
        <button type="button" className={kind === 'bunny' ? 'is-active' : undefined} onClick={() => pick('bunny')}>
          Bunny
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <h2>Room</h2>
      <div className="roomcard">
        <div>
          <div className="roomcard__name">{publicRoom.name}</div>
          <div className="roomcard__meta">
            {publicRoom.occupants} / {publicRoom.cap}
            {full ? ' — full' : ''}
          </div>
        </div>
        {full ? (
          <button type="button" disabled>
            Join
          </button>
        ) : (
          <a className="button--primary" href="/rooms.html">
            Join
          </a>
        )}
      </div>

      <h2>Our songs</h2>
      <p className="hint">The store. Drafts stay here. Published ones are what Public shuffles.</p>
      <div className="songlist">
        {busy && library.length === 0 && <p className="hint">Loading the library…</p>}
        {!busy && library.length === 0 && <p className="hint">Nothing on the shelf yet. Create one.</p>}
        {library.map((row) => (
          <div key={row.revisionId} className="songrow">
            <span>
              <span className="songrow__title">{row.title}</span>
              <br />
              <span className="songrow__meta">
                {row.artist} · {row.difficulty} · {row.noteCount} notes · {row.authorName}
              </span>
            </span>
            <span className={row.status === 'draft' ? 'badge badge--draft' : 'badge'}>{row.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
