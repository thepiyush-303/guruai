// ============================================================
// VoicePicker — choose the teacher's voice by hearing it.
//
// A short list (filterable by Female / Male). Clicking a voice selects it and plays a short sample spoken by that voice in
// the currently chosen language ("My name is Shivani…"). Clicking the voice
// that is playing stops it. Samples are fetched once per voice+language and
// kept as object URLs for the life of the picker.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { fetchVoicePreview } from '../api.ts';
import type { LanguageId, VoiceOption } from '../protocol.ts';
import { Icon } from './Icon.tsx';

interface Props {
  voices: VoiceOption[];
  value: string | undefined;
  language: LanguageId;
  onChange: (voice: string) => void;
}

export function VoicePicker({ voices, value, language, onChange }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'Female' | 'Male'>('all');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlsRef = useRef(new Map<string, string>());
  // The latest click wins: a slow sample that arrives late must not play over a newer one.
  const requestRef = useRef(0);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      audioRef.current?.pause();
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  // A language change makes the playing sample stale. Pausing fires the
  // element's onpause, which clears `playing`.
  useEffect(() => {
    audioRef.current?.pause();
  }, [language]);

  const audio = () => {
    if (!audioRef.current) {
      const el = new Audio();
      el.onended = () => setPlaying(null);
      el.onpause = () => setPlaying(null);
      audioRef.current = el;
    }
    return audioRef.current;
  };

  const pick = async (voice: string) => {
    onChange(voice);
    setError(null);
    const el = audio();

    if (playing === voice) {
      el.pause();
      return;
    }
    el.pause();

    const request = ++requestRef.current;
    const key = `${voice}|${language}`;
    let url = urlsRef.current.get(key);
    if (!url) {
      setLoading(voice);
      try {
        url = await fetchVoicePreview(voice, language);
        urlsRef.current.set(key, url);
      } catch (err) {
        if (request === requestRef.current) setError(`Couldn't play ${voice}: ${(err as Error).message}`);
        return;
      } finally {
        if (request === requestRef.current) setLoading(null);
      }
    }
    if (request !== requestRef.current) return;

    el.src = url;
    try {
      await el.play();
      setPlaying(voice);
    } catch {
      setError('Your browser blocked audio playback. Click the voice again.');
    }
  };

  if (voices.length === 0) {
    return <p className="field__hint">Voices are unavailable — is the GuruAI server running?</p>;
  }

  const shown = filter === 'all' ? voices : voices.filter((v) => v.gender === filter);

  return (
    <div className="voice-picker">
      <div className="segmented" role="radiogroup" aria-label="Filter voices">
        {(['all', 'Female', 'Male'] as const).map((f) => (
          <button key={f} role="radio" aria-checked={filter === f} className={filter === f ? 'is-active' : ''} type="button" onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f}
          </button>
        ))}
      </div>
      <div className="voice-list" role="radiogroup" aria-label="Teacher voice">
        {shown.map((v) => {
          const selected = value === v.id;
          const state = loading === v.id ? 'loading' : playing === v.id ? 'playing' : 'idle';
          return (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`voice-row${selected ? ' is-selected' : ''} is-${state}`}
              onClick={() => void pick(v.id)}
              title={state === 'playing' ? 'Stop the sample' : `Choose ${v.id} and hear a sample`}
            >
              <span className="voice-row__play" aria-hidden="true">
                {state === 'loading' ? <span className="spinner" /> : <Icon name={state === 'playing' ? 'stop' : 'play'} size={14} />}
              </span>
              <span className="voice-row__text">
                <span className="voice-row__name">{v.id}</span>
                <span className="voice-row__meta">
                  {v.gender} · {v.persona}
                </span>
              </span>
              <span className="voice-row__check" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
