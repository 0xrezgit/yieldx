import 'server-only';

/** Server-only entry: the browser reaches the sources only through /api/lending. */
export { getLendingFeed } from './feed';
