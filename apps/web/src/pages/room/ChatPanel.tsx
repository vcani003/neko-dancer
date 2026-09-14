/**
 * The side-panel chat from the prototype. Not a second messenger.
 *
 * The server names the speaker. Typing here is not a lane —
 * `KeyboardInput` already refuses keys inside a text field.
 */
import { useEffect, useRef, useState } from 'react';
import { MAX_CHAT_LENGTH } from '@neko/protocol';

export interface ChatLine {
  id: number;
  text: string;
  from?: string;
  system?: boolean;
}

interface ChatPanelProps {
  lines: ChatLine[];
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function ChatPanel({ lines, onSend, disabled }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    log.scrollTop = log.scrollHeight;
  }, [lines]);

  return (
    <div className="card">
      <h2 className="side__heading">Chat</h2>
      <div className="chat" ref={logRef}>
        {lines.length === 0 && <p className="hint">Say hello.</p>}
        {lines.map((line) => (
          <div key={line.id} className={line.system ? 'chat__line--system' : ''}>
            {line.from && <span className="chat__from">{line.from}: </span>}
            {line.text}
          </div>
        ))}
      </div>
      <form
        className="chat__form"
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (!text) return;
          onSend(text);
          setDraft('');
        }}
      >
        <input
          value={draft}
          placeholder="message"
          maxLength={MAX_CHAT_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={disabled}>
          Send
        </button>
      </form>
    </div>
  );
}
