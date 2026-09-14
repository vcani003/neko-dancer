/**
 * The three doors. Home is the shelf, Rooms is the floor, Create is the desk.
 */
export function Nav({ here }: { here: 'home' | 'rooms' | 'create' }) {
  return (
    <nav className="nav">
      <a className="nav__mark" href="/">
        neko <span>dancer</span>
      </a>
      <div className="nav__links">
        <a href="/" className={here === 'home' ? 'is-here' : undefined}>
          Home
        </a>
        <a href="/rooms.html" className={here === 'rooms' ? 'is-here' : undefined}>
          Room
        </a>
        <a href="/create.html" className={here === 'create' ? 'is-here' : undefined}>
          Create
        </a>
      </div>
    </nav>
  );
}
