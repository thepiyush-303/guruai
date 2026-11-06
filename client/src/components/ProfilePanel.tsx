// ============================================================
// ProfilePanel — "About you": everything GuruAI remembers about the
// student across sessions, with a way to delete any of it and to switch
// remembering off. Facts are only what the student said about themselves;
// sensitive categories are never stored (see src/memory/learnerProfile.ts).
// ============================================================

import { useEffect, useState } from 'react';
import * as api from '../api.ts';
import type { LearnerProfile } from '../protocol.ts';

const FIELDS: Array<{ key: keyof LearnerProfile; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'class', label: 'Class' },
  { key: 'board', label: 'Board' },
  { key: 'school', label: 'School' },
  { key: 'city', label: 'City' },
  { key: 'exam_goal', label: 'Preparing for' },
  { key: 'interests', label: 'Interests' },
  { key: 'learning_preferences', label: 'Learns best with' },
  { key: 'strengths', label: 'Strong at' },
  { key: 'difficulties', label: 'Finds hard' },
  { key: 'notes', label: 'Other' },
];

export function ProfilePanel({ open }: { open: boolean }) {
  const [snap, setSnap] = useState<api.ProfileSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  // Re-read whenever the panel is shown: facts are learned in the background.
  useEffect(() => {
    if (!open) return;
    let live = true;
    api
      .fetchProfile()
      .then((s) => live && setSnap(s))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [open]);

  const run = async (fn: () => Promise<api.ProfileSnapshot>) => {
    try {
      setSnap(await fn());
      setError(null);
      setConfirmAll(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!snap) return <p className="sessions__empty">{error ?? 'Loading…'}</p>;
  const profile = snap.profile;
  const known = FIELDS.filter(({ key }) => {
    const v = profile[key];
    return Array.isArray(v) ? v.length > 0 : !!v;
  });

  return (
    <div className="profile">
      <p className="profile__lede">
        GuruAI remembers things you tell it about yourself, so it can use your interests in examples and pitch lessons
        right. Only what you said; never religion, caste, health, money or contact details.
      </p>

      <label className="profile__switch">
        <input
          type="checkbox"
          checked={snap.memory_enabled}
          onChange={(e) => void run(() => api.setMemoryEnabled(e.target.checked))}
        />
        Remember things about me
      </label>

      {known.length === 0 ? (
        <p className="sessions__empty">Nothing remembered yet. Tell GuruAI your name, your class or what you enjoy.</p>
      ) : (
        <dl className="profile__facts">
          {known.map(({ key, label }) => {
            const v = profile[key]!;
            return (
              <div className="profile__fact" key={key}>
                <dt>{label}</dt>
                <dd>
                  {Array.isArray(v) ? (
                    <ul className="profile__chips">
                      {v.map((item) => (
                        <li key={item}>
                          {item}
                          <button aria-label={`Forget ${item}`} onClick={() => void run(() => api.forgetFact(key, item))}>
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="profile__value">
                      {v}
                      <button aria-label={`Forget ${label}`} onClick={() => void run(() => api.forgetFact(key))}>
                        ×
                      </button>
                    </span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      {known.length > 0 &&
        (confirmAll ? (
          <button className="btn btn--small btn--danger" onClick={() => void run(api.forgetEverything)}>
            Forget everything — sure?
          </button>
        ) : (
          <button className="btn btn--small btn--quiet" onClick={() => setConfirmAll(true)}>
            Forget everything
          </button>
        ))}
      {error && (
        <p className="setup__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
