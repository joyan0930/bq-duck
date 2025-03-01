// app/types/query.ts

/**
 * クエリ結果の型定義
 */
export interface QueryResult {
  columns: Array<{
    name: string;
    type: string;
  }>;
  rows: Record<string, any>[];
}
