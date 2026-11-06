// ============================================================
// VoicePicker — choose the teacher's voice by hearing it.
//
// Clicking a voice selects it and plays a short sample spoken by that voice in
// the currently chosen language ("My name is Shivani…"). Clicking the voice
// that is playing stops it. Samples are fetched once per voice+language and
// kept as object URLs for the life of the picker.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { fetchVoicePreview } from '../api.ts';
import type { LanguageId, VoiceOption } from '../protocol.ts';

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
    return <p className="setup__hint">Voices are unavailable — is the agent server running?</p>;
  }

  return (
    <>
      <div className="voices" role="radiogroup" aria-label="Teacher voice">
        {voices.map((v) => {
          const selected = value === v.id;
          const state = loading === v.id ? 'loading' : playing === v.id ? 'playing' : 'idle';
          return (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`voice${selected ? ' is-selected' : ''} is-${state}`}
              onClick={() => void pick(v.id)}
              title={state === 'playing' ? 'Stop sample' : `Hear ${v.id}`}
            >
              <span className="voice__icon" aria-hidden="true">
                {state === 'loading' ? '…' : state === 'playing' ? '■' : '▶'}
              </span>
              <span className="voice__name">{v.id}</span>
              <span className="voice__meta">
                {v.gender} · {v.persona}
                {v.language ? ` · ${v.language}` : ''}
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <p className="setup__error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
