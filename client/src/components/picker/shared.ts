// Small helpers shared by the picker components.
import type { IconName } from '../Icon.tsx';

const ICONS = new Set<string>(['school', 'cap', 'target', 'chat', 'atom', 'flask', 'leaf', 'sigma', 'code', 'chip', 'book', 'globe', 'heart', 'bulb']);

/** A catalog icon name as an Icon, with a book for anything unknown. */
export const iconOf = (name: string): IconName => (ICONS.has(name) ? (name as IconName) : 'book');

/** Opening a sheet marks the history entry, so closing it can go Back. */
export const SHEET_STATE = { sheet: true };
