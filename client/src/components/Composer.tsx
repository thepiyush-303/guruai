// ============================================================
// Composer — the bar at the bottom of a session: the mic, a text box to
// type a question instead, Send, Stop (while GuruAI talks), and whether
// replies are spoken at all.
// ============================================================

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Turn } from '../protocol.ts';
import { Icon } from './Icon.tsx';

interface Props {
  connected: boolean;
  muted: boolean;
  onToggleMute: () => void;
  turn: Turn;
  status: string;
  canSend: boolean;
  onSend: (text: string) => boolean;
  speaking: boolean;
  onStop: () => void;
  voiceOutput: boolean;
  onToggleVoiceOutput: () => void;
  /** A small live orb beside the bar (once the conversation has started). */
  orb?: ReactNode;
}

const MAX_CHARS = 2000;

export function Composer(p: Props) {
  const [text, setText] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    if (p.onSend(text)) {
      setText('');
      if (areaRef.current) areaRef.current.style.height = '';
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const sendable = p.canSend && text.trim().length > 0;
  const micLabel = p.muted ? 'Turn the microphone on' : 'Turn the microphone off';

  return (
    <div className="composer">
      <div className="composer__bar">
        {p.orb && <span className="composer__orb">{p.orb}</span>}
        <button
          className={`mic-btn${p.muted ? ' is-muted' : ' is-live'}${p.turn === 'listening' ? ' is-listening' : ''}`}
          onClick={p.onToggleMute}
          disabled={!p.connected}
          aria-pressed={!p.muted}
          aria-label={micLabel}
          title={micLabel}
        >
          <Icon name={p.muted ? 'micOff' : 'mic'} size={20} />
        </button>

        <label className="composer__field">
          <span className="visually-hidden">Type a question</span>
          <textarea
            ref={areaRef}
            rows={1}
            value={text}
            maxLength={MAX_CHARS}
            placeholder={p.connected ? 'Type a question, or just speak…' : 'Connecting…'}
            disabled={!p.connected}
            onChange={(e) => {
              setText(e.target.value);
              grow(e.target);
            }}
            onKeyDown={onKey}
          />
        </label>

        {p.speaking ? (
          <button className="icon-btn icon-btn--solid" onClick={p.onStop} aria-label="Stop speaking" title="Stop speaking">
            <Icon name="stop" size={18} />
          </button>
        ) : null}
        <button
          className="icon-btn icon-btn--primary"
          onClick={submit}
          disabled={!sendable}
          aria-label="Send"
          title={p.canSend ? 'Send (Enter)' : 'Wait for the answer to finish'}
        >
          <Icon name="send" size={18} />
        </button>
        <button
          className={p.voiceOutput ? 'icon-btn' : 'icon-btn is-off'}
          onClick={p.onToggleVoiceOutput}
          aria-pressed={p.voiceOutput}
          aria-label={p.voiceOutput ? 'Spoken replies on — switch to text only' : 'Text only — switch spoken replies on'}
          title={p.voiceOutput ? 'Spoken replies: on' : 'Spoken replies: off (text only)'}
        >
          <Icon name={p.voiceOutput ? 'volume' : 'volumeOff'} size={18} />
        </button>
      </div>
      <p className={`composer__status is-${p.turn}`} role="status">
        <span className="composer__dot" aria-hidden="true" />
        {p.status}
        {!p.voiceOutput && <span className="composer__tag">Text only</span>}
      </p>
    </div>
  );
}
