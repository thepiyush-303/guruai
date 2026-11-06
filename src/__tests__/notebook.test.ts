// ============================================================
// notebook.test.ts — applyNotesPatch is the only way notes change.
// ============================================================

import { applyNotesPatch, emptyNotebook, outlineOf, parseNotebook, MAX_BLOCKS_PER_SECTION } from '../notes/notebook';

const first = {
  should_record: true,
  subject: 'भौतिकी (Physics)',
  topic: 'न्यूटन के गति के नियम',
  ops: [
    { op: 'add_section', heading: 'पहला नियम (First Law)', blocks: [
      { kind: 'definition', text: 'जड़त्व (Inertia): वस्तु अपनी अवस्था बनाए रखती है।' },
      { kind: 'example', text: 'बस के अचानक रुकने पर यात्री आगे की ओर झुकते हैं।' },
    ] },
  ],
};

describe('applyNotesPatch', () => {
  it('sets the headline and adds a section with server-assigned ids', () => {
    const { notebook, changed } = applyNotesPatch(emptyNotebook(), first);
    expect(changed).toBe(true);
    expect(notebook.subject).toBe('भौतिकी (Physics)');
    expect(notebook.version).toBe(1);
    expect(notebook.sections[0]).toMatchObject({ id: 's1', heading: 'पहला नियम (First Law)' });
    expect(notebook.sections[0].blocks.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('does not modify its input', () => {
    const nb = emptyNotebook();
    applyNotesPatch(nb, first);
    expect(nb).toEqual(emptyNotebook());
  });

  it('should_record:false changes nothing', () => {
    const nb = applyNotesPatch(emptyNotebook(), first).notebook;
    expect(applyNotesPatch(nb, { should_record: false, ops: first.ops })).toEqual({ notebook: nb, changed: false });
  });

  it('appends by id, skips duplicates, and ignores unknown ids and ops', () => {
    const nb = applyNotesPatch(emptyNotebook(), first).notebook;
    const { notebook, changed } = applyNotesPatch(nb, {
      ops: [
        { op: 'append', section_id: 's1', blocks: [
          { kind: 'formula', text: 'F बल, m द्रव्यमान, a त्वरण', latex: 'F = ma' },
          { kind: 'definition', text: 'जड़त्व (inertia) : वस्तु अपनी अवस्था बनाए रखती है' }, // duplicate (punctuation/case)
        ] },
        { op: 'append', section_id: 's99', blocks: [{ text: 'lost' }] },
        { op: 'delete_everything' },
      ],
    });
    expect(changed).toBe(true);
    expect(notebook.version).toBe(2);
    expect(notebook.sections[0].blocks.map((b) => b.kind)).toEqual(['definition', 'example', 'formula']);
    expect(JSON.stringify(notebook)).not.toContain('lost');
  });

  it('merges an add_section into an existing section with the same heading', () => {
    const nb = applyNotesPatch(emptyNotebook(), first).notebook;
    const { notebook } = applyNotesPatch(nb, { ops: [{ op: 'add_section', heading: 'पहला नियम (first law)', blocks: [{ text: 'नया बिंदु' }] }] });
    expect(notebook.sections).toHaveLength(1);
    expect(notebook.sections[0].blocks).toHaveLength(3);
  });

  it('a patch of only duplicates is not a change (version stays)', () => {
    const nb = applyNotesPatch(emptyNotebook(), first).notebook;
    const r = applyNotesPatch(nb, { ops: [{ op: 'add_section', heading: 'Brand new', blocks: first.ops[0].blocks }] });
    expect(r.changed).toBe(false);
    expect(r.notebook.version).toBe(1);
    expect(r.notebook.sections).toHaveLength(1); // no empty section created
  });

  it('updates a block the teacher corrected', () => {
    const nb = applyNotesPatch(emptyNotebook(), first).notebook;
    const { notebook } = applyNotesPatch(nb, { ops: [{ op: 'update_block', block_id: 'b2', text: 'सुधरा हुआ उदाहरण' }] });
    expect(notebook.sections[0].blocks[1].text).toBe('सुधरा हुआ उदाहरण');
  });

  it('caps blocks per section and block length', () => {
    const blocks = Array.from({ length: 50 }, (_, i) => ({ text: `point ${i} ${'x'.repeat(500)}` }));
    const { notebook } = applyNotesPatch(emptyNotebook(), { ops: [{ op: 'add_section', heading: 'h', blocks }] });
    expect(notebook.sections[0].blocks).toHaveLength(MAX_BLOCKS_PER_SECTION);
    expect(notebook.sections[0].blocks[0].text.length).toBeLessThanOrEqual(400);
  });

  it('a block with only latex becomes a formula', () => {
    const { notebook } = applyNotesPatch(emptyNotebook(), { ops: [{ op: 'add_section', heading: 'h', blocks: [{ latex: 'E = mc^2' }] }] });
    expect(notebook.sections[0].blocks[0]).toMatchObject({ kind: 'formula', latex: 'E = mc^2' });
  });

  it('rejects garbage', () => {
    const nb = emptyNotebook();
    expect(applyNotesPatch(nb, null).changed).toBe(false);
    expect(applyNotesPatch(nb, [1, 2]).changed).toBe(false);
    expect(applyNotesPatch(nb, { ops: 'nope' }).changed).toBe(false);
  });
});

describe('outlineOf / parseNotebook', () => {
  it('outlines with ids and truncated text', () => {
    const nb = applyNotesPatch(emptyNotebook(), {
      ops: [{ op: 'add_section', heading: 'Light', blocks: [{ text: 'a'.repeat(200) }] }],
    }).notebook;
    const o = outlineOf(nb);
    expect(o).toContain('[s1] Light');
    expect(o).toContain('(b1, point)');
    expect(o.length).toBeLessThan(120);
    expect(outlineOf(emptyNotebook())).toContain('empty');
  });

  it('round-trips and survives corrupt JSON', () => {
    const nb = applyNotesPatch(emptyNotebook(), first).notebook;
    expect(parseNotebook(JSON.stringify(nb))).toEqual(nb);
    expect(parseNotebook('{oops')).toEqual(emptyNotebook());
    expect(parseNotebook(null)).toEqual(emptyNotebook());
  });
});
