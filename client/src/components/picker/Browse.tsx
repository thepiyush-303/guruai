// ============================================================
// Browse — the levels of the "Start learning" picker:
//   Landing      search any topic, or pick a path (school, college, exams, open chat)
//   TrackView    pick a program (Class 10, B.Tech CSE, JEE…), then a subject
//   SubjectView  units (accordion) and their topics
//   OpenAreas    open-chat areas
// Every choice is a link, so the URL holds the state and Back goes up a level.
// ============================================================

import { useId, useMemo, useState } from 'react';
import { countTopics, searchTopics } from '../../catalog.ts';
import { relativeDay, useLibrary } from '../../library.ts';
import type { Catalog, CatalogProgram, CatalogSubject, CatalogTrack, OpenCategory } from '../../protocol.ts';
import { pickerHref, type PickerState } from '../../router.ts';
import { Icon, type IconName } from '../Icon.tsx';
import { Link } from '../Link.tsx';
import { iconOf, SHEET_STATE } from './shared.ts';

// ── Landing ───────────────────────────────────────────────────

export function Landing({ catalog, groupId, onQuickStart }: { catalog: Catalog; groupId: string | null; onQuickStart: () => void }) {
  const lib = useLibrary();
  const recent = lib.sessions.filter((s) => s.study?.kind === 'topic').slice(0, 3);
  const topicTotal = useMemo(
    () => catalog.tracks.filter((t) => t.id !== 'exam').reduce((n, t) => n + t.programs.reduce((m, p) => m + p.subjects.reduce((k, s) => k + countTopics(s), 0), 0), 0),
    [catalog],
  );

  const paths: Array<{ href: string; icon: IconName; title: string; blurb: string; meta: string }> = [
    ...catalog.tracks.map((t) => ({
      href: pickerHref({ track: t.id }, groupId),
      icon: iconOf(t.icon),
      title: t.title,
      blurb: t.blurb,
      meta: t.programs.map((p) => p.title).join(' · '),
    })),
    {
      href: pickerHref({ track: 'open' }, groupId),
      icon: 'chat',
      title: 'Open chat',
      blurb: 'Anything outside a syllabus — coding, gadgets, careers, life, big ideas.',
      meta: catalog.open_categories.slice(0, 4).map((c) => c.title).join(' · '),
    },
  ];

  return (
    <>
      <header className="picker-hero">
        <p className="eyebrow">Start learning</p>
        <h1>What would you like to understand today?</h1>
        <p className="picker-hero__lede">
          Pick a topic from your syllabus and GuruAI starts teaching it right away — or open a chat about anything else.
        </p>
        <TopicSearch catalog={catalog} groupId={groupId} placeholder={`Search ${topicTotal} topics — Ohm's law, deadlock, photosynthesis…`} />
      </header>

      <section className="picker-section" aria-labelledby="paths-title">
        <h2 id="paths-title" className="picker-section__title">
          Choose your path
        </h2>
        <ul className="path-grid">
          {paths.map((p) => (
            <li key={p.href}>
              <Link href={p.href} className="path-card">
                <span className="path-card__icon">
                  <Icon name={p.icon} size={26} />
                </span>
                <span className="path-card__title">{p.title}</span>
                <span className="path-card__blurb">{p.blurb}</span>
                <span className="path-card__meta">{p.meta}</span>
                <span className="path-card__go" aria-hidden="true">
                  <Icon name="arrowRight" size={18} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="picker-quick">
          Just want to talk?{' '}
          <button type="button" className="text-link" onClick={onQuickStart}>
            Start a conversation without choosing
          </button>
        </p>
      </section>

      {recent.length > 0 && (
        <section className="picker-section" aria-labelledby="recent-title">
          <h2 id="recent-title" className="picker-section__title">
            Jump back in
          </h2>
          <ul className="recent-row">
            {recent.map((s) => (
              <li key={s.id}>
                <Link href={`/s/${s.id}`} className="recent-chip">
                  <span className="recent-chip__title">{s.study?.title}</span>
                  <span className="recent-chip__meta">
                    {s.study?.subtitle} · {relativeDay(s.updated_ts)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Live search over every topic; a result opens the topic's sheet at its home place. */
function TopicSearch({ catalog, groupId, placeholder }: { catalog: Catalog; groupId: string | null; placeholder: string }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => searchTopics(catalog, q), [catalog, q]);
  const listId = useId();
  const searching = q.trim().length > 1;

  return (
    <div className="topic-search">
      <label className="topic-search__box">
        <Icon name="search" size={20} />
        <span className="visually-hidden">Search topics</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-controls={listId}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {searching && (
        <ul className="topic-search__results" id={listId} aria-live="polite">
          {hits.length === 0 && (
            <li className="topic-search__empty">
              No syllabus topic matches “{q.trim()}”.{' '}
              <Link href={pickerHref({ track: 'open', area: 'anything' }, groupId)} state={SHEET_STATE} className="text-link">
                Ask it in open chat
              </Link>
            </li>
          )}
          {hits.map(({ place }) => (
            <li key={place.topic.id}>
              <Link
                href={pickerHref({ track: place.track.id, program: place.program.id, subject: place.subject.id, topic: place.topic.id }, groupId)}
                state={SHEET_STATE}
                className="search-hit"
              >
                <span className="search-hit__icon">
                  <Icon name={iconOf(place.subject.icon)} size={18} />
                </span>
                <span className="search-hit__text">
                  <span className="search-hit__title">{place.topic.title}</span>
                  <span className="search-hit__path">
                    {place.program.title} · {place.subject.title} · {place.unit.title}
                  </span>
                </span>
                <Icon name="chevron" size={16} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── A track: programs, then subjects ──────────────────────────

export function TrackView({ track, program, picker, groupId }: { track: CatalogTrack; program: CatalogProgram | null; picker: PickerState; groupId: string | null }) {
  const single = track.programs.length === 1;
  return (
    <>
      <header className="picker-head">
        <span className="picker-head__icon">
          <Icon name={iconOf(track.icon)} size={24} />
        </span>
        <div>
          <h1>{program && !single ? program.title : track.title}</h1>
          <p>{program ? program.note : track.blurb}</p>
        </div>
      </header>

      {!single && (
        <nav className={program ? 'program-chips' : 'program-grid'} aria-label={track.id === 'school' ? 'Your class' : 'Program'}>
          {track.programs.map((p) => {
            const active = program?.id === p.id;
            return (
              <Link
                key={p.id}
                href={pickerHref({ track: picker.track, program: p.id }, groupId)}
                className={active ? 'program-chip is-active' : 'program-chip'}
                aria-current={active ? 'page' : undefined}
              >
                <span className="program-chip__title">{p.title}</span>
                {!program && <span className="program-chip__note">{p.note}</span>}
                {!program && (
                  <span className="program-chip__note">
                    {p.subjects.map((s) => s.title).join(' · ')}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      )}

      {program ? (
        <section className="picker-section" aria-labelledby="subjects-title">
          <h2 id="subjects-title" className="picker-section__title">
            Pick a subject
          </h2>
          <ul className="subject-grid">
            {program.subjects.map((s) => (
              <li key={s.id}>
                <Link href={pickerHref({ track: picker.track, program: program.id, subject: s.id }, groupId)} className="subject-card">
                  <span className="subject-card__icon">
                    <Icon name={iconOf(s.icon)} size={22} />
                  </span>
                  <span className="subject-card__title">{s.title}</span>
                  <span className="subject-card__meta">
                    {s.units.length} {s.units.length === 1 ? 'unit' : 'units'} · {countTopics(s)} topics
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        track.id === 'school' && <p className="picker-note">Topics follow NCERT, so they suit most State boards as well.</p>
      )}
    </>
  );
}

// ── A subject: units and topics ───────────────────────────────

export function SubjectView({
  program,
  subject,
  picker,
  groupId,
}: {
  program: CatalogProgram;
  subject: CatalogSubject;
  picker: PickerState;
  groupId: string | null;
}) {
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const units = useMemo(
    () =>
      subject.units
        .map((u) => ({
          unit: u,
          topics: f
            ? u.topics.filter((t) => `${t.title} ${t.keyTerms.join(' ')} ${t.chunks.join(' ')} ${u.title}`.toLowerCase().includes(f))
            : u.topics,
        }))
        .filter((u) => u.topics.length > 0),
    [subject, f],
  );

  return (
    <>
      <header className="picker-head">
        <span className="picker-head__icon">
          <Icon name={iconOf(subject.icon)} size={24} />
        </span>
        <div>
          <h1>{subject.title}</h1>
          <p>
            {program.title} · {subject.units.length} units · {countTopics(subject)} topics
          </p>
        </div>
      </header>

      <label className="filter-box">
        <Icon name="search" size={16} />
        <span className="visually-hidden">Filter topics</span>
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${subject.title} topics`} />
      </label>

      {units.length === 0 && <p className="picker-note">No topic here matches “{filter.trim()}”.</p>}

      <div className="unit-list">
        {units.map(({ unit, topics }, i) => (
          <details key={unit.id} className="unit" open={f ? true : i === 0 || topics.some((t) => t.id === picker.topic)}>
            <summary className="unit__head">
              <span className="unit__num">{String(subject.units.indexOf(unit) + 1).padStart(2, '0')}</span>
              <span className="unit__title">{unit.title}</span>
              <span className="unit__count">{topics.length}</span>
              <Icon name="chevron" size={16} className="unit__chev" />
            </summary>
            <ul className="topic-list">
              {topics.map((t) => (
                <li key={t.id}>
                  <Link
                    href={pickerHref({ ...picker, area: null, topic: t.id }, groupId)}
                    state={SHEET_STATE}
                    keepScroll
                    className={picker.topic === t.id ? 'topic-row is-active' : 'topic-row'}
                  >
                    <span className="topic-row__text">
                      <span className="topic-row__title">{t.title}</span>
                      <span className="topic-row__summary">{t.summary}</span>
                    </span>
                    <span className="topic-row__parts">{t.chunks.length} parts</span>
                    <Icon name="play" size={14} className="topic-row__go" />
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </>
  );
}

// ── Open chat areas ───────────────────────────────────────────

export function OpenAreas({ categories, picker, groupId }: { categories: OpenCategory[]; picker: PickerState; groupId: string | null }) {
  return (
    <>
      <header className="picker-head">
        <span className="picker-head__icon">
          <Icon name="chat" size={24} />
        </span>
        <div>
          <h1>Open chat</h1>
          <p>Talk about anything. Pick an area so GuruAI knows how to help.</p>
        </div>
      </header>
      <ul className="area-grid">
        {categories.map((c) => (
          <li key={c.id}>
            <Link
              href={pickerHref({ track: 'open', area: c.id }, groupId)}
              state={SHEET_STATE}
              keepScroll
              className={picker.area === c.id ? 'area-card is-active' : 'area-card'}
            >
              <span className="area-card__icon">
                <Icon name={iconOf(c.icon)} size={22} />
              </span>
              <span className="area-card__title">{c.title}</span>
              <span className="area-card__blurb">{c.blurb}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
