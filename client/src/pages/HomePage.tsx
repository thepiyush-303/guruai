// ============================================================
// HomePage — what GuruAI is, in one screen, and the way in: start a new
// session, or continue the last one.
// ============================================================

import { Icon, type IconName } from '../components/Icon.tsx';
import { Link } from '../components/Link.tsx';
import { relativeDay, useLibrary } from '../library.ts';
import { LANGUAGE_OPTIONS, languageOption } from '../protocol.ts';

const FEATURES: Array<{ icon: IconName; title: string; text: string }> = [
  {
    icon: 'bulb',
    title: 'Intuition first',
    text: 'One small idea at a time: what it is, why it matters, then an everyday analogy — cricket, chai, a pressure cooker — before the textbook term.',
  },
  {
    icon: 'globe',
    title: 'In your language',
    text: 'Learn in English, Hindi, Hinglish, Bengali, Tamil, Telugu and five more. Technical terms stay in English, the way good teachers say them.',
  },
  {
    icon: 'notes',
    title: 'Notes while you listen',
    text: 'Definitions, formulas, examples and tips are written beside the lesson as it happens — download them as a PDF any time.',
  },
  {
    icon: 'heart',
    title: 'Remembers you',
    text: 'Your class, what you find easy or hard, and where you stopped. Come back to any session and carry on. You can see and delete it all.',
  },
];

const STEPS: Array<{ title: string; text: string }> = [
  { title: 'Pick a language and a voice', text: 'Choose how GuruAI speaks to you, and your class and board if you like.' },
  { title: 'Ask — by voice or by typing', text: 'Talk naturally, or type. Turn spoken replies off whenever you only want text.' },
  { title: 'Learn step by step', text: 'Answer the check questions, ask for examples, and keep the notes for revision.' },
];

export function HomePage() {
  const lib = useLibrary();
  const last = lib.sessions[0];
  const recent = lib.sessions.slice(0, 6);

  return (
    <div className="page page--home">
      <section className="hero">
        <div className="hero__copy">
          <p className="eyebrow">Your patient study teacher</p>
          <h1 className="hero__title">Understand anything, in your own language.</h1>
          <p className="hero__lede">
            GuruAI explains one idea at a time with examples from your daily life, checks that it made sense, and writes your
            notes while you listen. Speak or type — in {LANGUAGE_OPTIONS.length} Indian languages.
          </p>
          <div className="hero__actions">
            <Link href="/new" className="btn btn--primary btn--large">
              <Icon name="plus" />
              Start a new session
            </Link>
            {last && (
              <Link href={`/s/${last.id}`} className="btn btn--large" title={last.title ?? undefined}>
                Continue “{truncate(last.title || 'last session', 34)}”
                <Icon name="arrowRight" />
              </Link>
            )}
          </div>
          <ul className="hero__langs" aria-label="Languages">
            {LANGUAGE_OPTIONS.map((l) => (
              <li key={l.id} lang={l.id === 'hinglish' ? 'hi' : l.id}>
                {l.nativeLabel}
              </li>
            ))}
          </ul>
        </div>
        <LessonCover />
      </section>

      {recent.length > 0 && (
        <section className="home-section">
          <div className="home-section__head">
            <h2>Pick up where you left off</h2>
            <Link href="/new" className="text-link">
              New session
            </Link>
          </div>
          <ul className="card-grid">
            {recent.map((s) => {
              const exchanges = Math.ceil(s.turn_count / 2);
              return (
                <li key={s.id}>
                  <Link href={`/s/${s.id}`} className="card session-card">
                    <span className="session-card__title">{s.title || 'New session'}</span>
                    {s.last_text && <span className="session-card__excerpt">{truncate(s.last_text, 110)}</span>}
                    <span className="session-card__meta">
                      <span className="badge" lang={s.language === 'hinglish' ? 'hi' : s.language}>
                        {languageOption(s.language).nativeLabel}
                      </span>
                      {relativeDay(s.updated_ts)} · {exchanges} {exchanges === 1 ? 'exchange' : 'exchanges'}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="home-section">
        <h2>How GuruAI teaches</h2>
        <ul className="feature-grid">
          {FEATURES.map((f) => (
            <li className="card feature" key={f.title}>
              <span className="feature__icon">
                <Icon name={f.icon} size={20} />
              </span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="home-section">
        <h2>How it works</h2>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li className="step" key={s.title}>
              <span className="step__num">{i + 1}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <Link href="/new" className="btn btn--primary">
          Start learning
          <Icon name="arrowRight" />
        </Link>
      </section>
    </div>
  );
}

/** A picture of one lesson, workbook-cover style: how GuruAI teaches a chunk. */
function LessonCover() {
  return (
    <div className="cover" aria-hidden="true">
      <p className="cover__label">Lesson · Class 9 · Physics</p>
      <p className="cover__title">Newton&rsquo;s First Law</p>
      <p className="cover__subtitle">Why you lurch forward when the bus brakes</p>
      <ol className="cover__steps">
        <li>
          <span>Intuition first</span>
          <em>Things keep doing what they were doing</em>
        </li>
        <li>
          <span>An everyday analogy</span>
          <em>The bus stops — your body doesn&rsquo;t</em>
        </li>
        <li>
          <span>The real term</span>
          <em>Inertia</em>
        </li>
        <li>
          <span>Your turn</span>
          <em>&ldquo;Why do we wear seat belts?&rdquo;</em>
        </li>
      </ol>
      <p className="cover__foot">
        <span>GuruAI</span>
        <span>Notes ready · PDF</span>
      </p>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}
