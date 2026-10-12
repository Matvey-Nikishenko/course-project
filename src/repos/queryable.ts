import type { QueryResult, QueryResultRow } from 'pg';

/**
 * Pool in production, a single Client with an open BEGIN in a ROLLBACK suite.
 * Repositories never import `pg` Pool directly so isolation can swap the handle.
 */
export type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
};
