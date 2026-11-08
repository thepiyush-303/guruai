// ============================================================
// App — the shell: the sidebar on the left, the current page on the right.
//
//   /            HomePage        what GuruAI is; continue or start
//   /new         NewSessionPage  pick a syllabus topic or open chat; language, voice
//   /s/<id>      SessionPage     the voice teacher (mic, composer, notes)
//   /settings    SettingsPage    theme, replies, notes, memory
//
// Saved sessions, groups and voices load once here and are shared through
// LibraryContext. Only the session page opens a connection.
// ============================================================

import { useEffect, useState } from 'react';
import { Icon } from './components/Icon.tsx';
import { Link } from './components/Link.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { LibraryContext, useLibraryState } from './library.ts';
import { HomePage } from './pages/HomePage.tsx';
import { NewSessionPage } from './pages/NewSessionPage.tsx';
import { SessionPage } from './pages/SessionPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { useRoute } from './router.ts';
import { useSidebarCollapsed, useTheme } from './settings.ts';

const TITLES = { home: 'GuruAI', new: 'Start learning · GuruAI', settings: 'Settings · GuruAI', session: 'GuruAI' } as const;

export default function App() {
  const library = useLibraryState();
  const route = useRoute();
  useTheme(); // applies the saved theme to <html>
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    document.title = TITLES[route.name];
  }, [route.name]);

  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  return (
    <LibraryContext.Provider value={library}>
      <div className={collapsed ? 'shell is-collapsed' : 'shell'}>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Sidebar
          route={route}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed(!collapsed)}
          open={drawer}
          onClose={() => setDrawer(false)}
        />
        <div className="shell__main">
          <header className="topbar">
            <button className="icon-btn" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer}>
              <Icon name="menu" />
            </button>
            <Link href="/" className="brand">
              <span className="brand__mark" aria-hidden="true">
                G
              </span>
              <span className="brand__name">GuruAI</span>
            </Link>
            <Link href="/new" className="icon-btn" aria-label="New session" title="New session">
              <Icon name="plus" />
            </Link>
          </header>
          <main id="main" className="shell__page">
            {route.name === 'home' && <HomePage />}
            {route.name === 'new' && <NewSessionPage key={route.groupId ?? ''} groupId={route.groupId} picker={route.picker} />}
            {route.name === 'session' && <SessionPage key={route.id} id={route.id} />}
            {route.name === 'settings' && <SettingsPage />}
          </main>
        </div>
      </div>
    </LibraryContext.Provider>
  );
}
