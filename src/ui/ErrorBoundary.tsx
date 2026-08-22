/**
 * The last thing between a thrown error and a white screen.
 *
 * React unmounts the entire tree when a render throws and nothing catches it.
 * With no boundary the result is a blank page — no menu, no chat, no way back,
 * and nothing on screen saying what happened. For a game that is running on
 * someone else's machine across the room, "it went white" is the whole of the
 * bug report you will ever receive.
 *
 * Boundaries only catch errors thrown during rendering, in lifecycle methods,
 * and in constructors below them. They do NOT catch:
 *
 *   - event handlers — a throw in an onClick is caught by React and rethrown
 *     globally, so those need their own try/catch
 *   - anything asynchronous: setTimeout, requestAnimationFrame, promises
 *   - errors thrown by the boundary itself
 *
 * That is why the game loop and the socket handlers do their own guarding.
 * This is a floor, not a substitute.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Named in the message, so a report says which part failed. */
  area: string;
  /** Rendered instead of the default notice. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the only reporting channel there is. Keep the component
    // stack — it is the difference between "something broke" and a file name.
    console.error(`[${this.props.area}]`, error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="panel panel--error" role="alert">
        <h2>The {this.props.area} stopped working.</h2>
        <p className="hint">{error.message || 'No message was given.'}</p>
        <p className="hint">
          Nothing else was lost — your charts are saved and the room is still
          there. Try again, and reload the page if it keeps happening.
        </p>
        <button className="button--primary" onClick={this.reset}>
          Try again
        </button>
      </div>
    );
  }
}
