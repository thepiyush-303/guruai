// ============================================================
// NewSessionPage — "Start learning". The learner picks a path (school,
// college, exams or open chat), then a program, subject and topic — or
// searches for a topic directly. The last step is a sheet with what the
// topic covers, language and voice, and Start: the session opens and
// GuruAI begins teaching that topic at once.
//
// Where the learner is lives in the URL (see router.ts PickerState), so
// Back goes up one level and every step can be linked to.
// ============================================================

import { useState } from 'react';
import { findCategory, findTopic, useCatalog } from '../catalog.ts';
import { Icon } from '../components/Icon.tsx';
import { Link } from '../components/Link.tsx';
import { Landing, OpenAreas, SubjectView, TrackView } from '../components/picker/Browse.tsx';
import { AreaSheet, TopicSheet, type StartChoice } from '../components/picker/StartSheet.tsx';
import { useLibrary } from '../library.ts';
import type { Catalog, Preferences } from '../protocol.ts';
import { navigate, pickerHref, type FreshSessionState, type PickerState } from '../router.ts';
import { loadPrefs, savePrefs } from '../settings.ts';

export function NewSessionPage({ groupId, picker }: { groupId: string | null; picker: PickerState }) {
  const state = useCatalog();
  if (state.status === 'loading') return <div className="page-loading">Loading the syllabus…</div>;
  if (state.status === 'error') {
    return (
      <div className="page page--narrow">
        <p className="banner" role="alert">
          Could not load the syllabus ({state.message}). Is the GuruAI server running?
        </p>
      </div>
    );
  }
  return <Picker catalog={state.catalog} groupId={groupId} picker={picker} />;
}

function Picker({ catalog, groupId: initialGroup, picker }: { catalog: Catalog; groupId: string | null; picker: PickerState }) {
  const lib = useLibrary();
  const [prefs, setPrefs] = useState<Preferences>(loadPrefs);
  const [groupId, setGroupId] = useState<string | null>(initialGroup);

  // A remembered voice / group only counts if it still exists.
  const voice = prefs.voice && lib.voices.some((v) => v.id === prefs.voice) ? prefs.voice : lib.defaultVoice ?? undefined;
  const group = groupId && lib.groups.some((g) => g.id === groupId) ? groupId : null;

  const start = ({ prefs: chosen, groupId: g }: StartChoice) => {
    savePrefs(chosen);
    const s: FreshSessionState = { fresh: true, prefs: chosen, groupId: g };
    navigate(`/s/${crypto.randomUUID()}`, s);
  };
  const quickStart = () => start({ prefs: { ...prefs, voice, study: undefined }, groupId: group });

  // Resolve the URL against the catalog; unknown ids simply fall back a level.
  const isOpen = picker.track === 'open';
  const track = catalog.tracks.find((t) => t.id === picker.track) ?? null;
  const program = track
    ? track.programs.find((p) => p.id === picker.program) ?? (track.programs.length === 1 ? track.programs[0] : null)
    : null;
  const subject = program?.subjects.find((s) => s.id === picker.subject) ?? null;
  const topic = findTopic(catalog, picker.topic);
  const area = isOpen ? findCategory(catalog, picker.area) : null;

  // Closing a sheet goes Back when the sheet was opened in-app, else just drops it from the URL.
  const closeSheet = () => {
    if ((window.history.state as { sheet?: boolean } | null)?.sheet) window.history.back();
    else navigate(pickerHref({ ...picker, topic: null, area: null }, initialGroup), null, { replace: true, keepScroll: true });
  };

  const crumbs: Array<{ label: string; href: string }> = [{ label: 'Start', href: pickerHref({}, initialGroup) }];
  if (isOpen) crumbs.push({ label: 'Open chat', href: pickerHref({ track: 'open' }, initialGroup) });
  if (track) crumbs.push({ label: track.title, href: pickerHref({ track: track.id }, initialGroup) });
  if (track && program && track.programs.length > 1) {
    crumbs.push({ label: program.title, href: pickerHref({ track: track.id, program: program.id }, initialGroup) });
  }
  if (track && program && subject) {
    crumbs.push({ label: subject.title, href: pickerHref({ track: track.id, program: program.id, subject: subject.id }, initialGroup) });
  }

  let body;
  if (isOpen) body = <OpenAreas categories={catalog.open_categories} picker={picker} groupId={initialGroup} />;
  else if (track && program && subject) body = <SubjectView program={program} subject={subject} picker={picker} groupId={initialGroup} />;
  else if (track) body = <TrackView track={track} program={program} picker={picker} groupId={initialGroup} />;
  else body = <Landing catalog={catalog} groupId={initialGroup} onQuickStart={quickStart} />;

  const sheetProps = { prefs, onPrefs: setPrefs, voice, groupId: group, onGroup: setGroupId, onClose: closeSheet, onStart: start };

  return (
    <div className="page picker">
      {crumbs.length > 1 && (
        <nav className="crumbs" aria-label="Where you are">
          <Link href={crumbs[crumbs.length - 2].href} className="icon-btn crumbs__back" aria-label="Back one level">
            <Icon name="back" />
          </Link>
          <ol>
            {crumbs.map((c, i) => (
              <li key={c.href}>
                {i === crumbs.length - 1 ? <span aria-current="page">{c.label}</span> : <Link href={c.href}>{c.label}</Link>}
              </li>
            ))}
          </ol>
        </nav>
      )}

      {body}

      {topic && !isOpen && <TopicSheet key={topic.topic.id} place={topic} {...sheetProps} />}
      {area && <AreaSheet key={area.id} category={area} {...sheetProps} />}
    </div>
  );
}
