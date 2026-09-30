import type { Opportunity } from '../../types/opportunity';

/** Health of one upstream source, shown next to the list. */
export interface SourceStatus {
  id: string;
  name: string;
  /** ok: fresh; stale: last good copy after a failed refresh; error: nothing to show. */
  state: 'ok' | 'stale' | 'error';
  fetchedAt: string | null;
  count: number;
  error: string | null;
}

export interface LendingFeed {
  opportunities: Opportunity[];
  sources: SourceStatus[];
  fetchedAt: string;
}
