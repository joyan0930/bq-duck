// app/lib/db/bigquery.ts
import { QueryResult } from '../../types/query';

// BigQueryデータ転送サイズ上限（1GB）
const MAX_TRANSFER_SIZE_BYTES = 1024 * 1024 * 1024;

export interface BigQueryOptions {
  projectId: string;
  location: string;
  accessToken: string;
}

export class BigQueryClient {
  private options: BigQueryOptions;
  
  constructor(options: BigQueryOptions) {
    this.options = options;
  }
  
  /**
   * BigQuery API呼び出しのための共通ヘッダー
   */
  private getHeaders(): HeadersInit {
    return {
      'Authorization': `Bearer ${this.options.accessToken}`,
      'Content-Type': 'application/json',
    };
  }
  
  /**
   * BigQuery REST APIのベースURL
   */
  private getBaseUrl(): string {
    return `https://bigquery.googleapis.com/bigquery/v2/projects/${this.options.projectId}`;
  }
  
  /**
   * SQLクエリの実行
   */
  async executeQuery(sql: string, maxResults: number = 10000): Promise<QueryResult> {
    try {
      // クエリジョブを作成
      const jobResponse = await fetch(`${this.getBaseUrl()}/jobs`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          configuration: {
            query: {
              query: sql,
              useLegacySql: false,
            },
          },
        }),
      });
      
      if (!jobResponse.ok) {
        const errorData = await jobResponse.json();
        throw new Error(`BigQuery API Error: ${errorData.error.message}`);
      }
      
      const jobData = await jobResponse.json();
      const jobId = jobData.jobReference.jobId;
      
      // ジョブが完了するまでポーリング
      let isComplete = false;
      let queryResults;
      
      while (!isComplete) {
        const statusResponse = await fetch(
          `${this.getBaseUrl()}/jobs/${jobId}`,
          { headers: this.getHeaders() }
        );
        
        if (!statusResponse.ok) {
          const errorData = await statusResponse.json();
          throw new Error(`BigQuery API Error: ${errorData.error.message}`);
        }
        
        const statusData = await statusResponse.json();
        isComplete = statusData.status.state === 'DONE';
        
        if (isComplete) {
          if (statusData.status.errorResult) {
            throw new Error(`BigQuery Error: ${statusData.status.errorResult.message}`);
          }
          
          // クエリ結果を取得
          const resultsResponse = await fetch(
            `${this.getBaseUrl()}/jobs/${jobId}/results?maxResults=${maxResults}`,
            { headers: this.getHeaders() }
          );
          
          if (!resultsResponse.ok) {
            const errorData = await resultsResponse.json();
            throw new Error(`BigQuery API Error: ${errorData.error.message}`);
          }
          
          queryResults = await resultsResponse.json();
        } else {
          // 少し待機してから再試行
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // 結果サイズチェック
      const resultSizeEstimate = JSON.stringify(queryResults).length;
      if (resultSizeEstimate > MAX_TRANSFER_SIZE_BYTES) {
        throw new Error(`結果のサイズ(${resultSizeEstimate}バイト)がデータ転送上限(${MAX_TRANSFER_SIZE_BYTES}バイト)を超えています`);
      }
      
      // 結果をアプリケーションフォーマットに変換
      const schema = queryResults.schema;
      const columns = schema.fields.map((field: any) => ({
        name: field.name,
        type: field.type,
      }));
      
      const rows = queryResults.rows ? queryResults.rows.map((row: any) => {
        const resultRow: Record<string, any> = {};
        for (let i = 0; i < columns.length; i++) {
          const column = columns[i];
          const value = row.f[i].v;
          
          // 型に応じた変換
          switch (column.type) {
            case 'INTEGER':
              resultRow[column.name] = value !== null ? parseInt(value, 10) : null;
              break;
            case 'FLOAT':
            case 'NUMERIC':
            case 'BIGNUMERIC':
              resultRow[column.name] = value !== null ? parseFloat(value) : null;
              break;
            case 'BOOLEAN':
              resultRow[column.name] = value === 'true';
              break;
            case 'TIMESTAMP':
              resultRow[column.name] = value !== null ? new Date(parseFloat(value) * 1000).toISOString() : null;
              break;
            default:
              resultRow[column.name] = value;
          }
        }
        return resultRow;
      }) : [];
      
      return { columns, rows };
    } catch (err) {
      console.error('BigQueryクエリ実行エラー:', err);
      throw err;
    }
  }
  
  /**
   * プロジェクト内のデータセット一覧を取得
   */
  async listDatasets(): Promise<Array<{id: string, name: string}>> {
    try {
      const response = await fetch(
        `${this.getBaseUrl()}/datasets`,
        { headers: this.getHeaders() }
      );
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`BigQuery API Error: ${errorData.error.message}`);
      }
      
      const data = await response.json();
      
      return data.datasets ? data.datasets.map((dataset: any) => ({
        id: dataset.datasetReference.datasetId,
        name: dataset.datasetReference.datasetId,
      })) : [];
    } catch (err) {
      console.error('データセット一覧取得エラー:', err);
      throw err;
    }
  }
  
  /**
   * データセット内のテーブル一覧を取得
   */
  async listTables(datasetId: string): Promise<Array<{id: string, name: string}>> {
    try {
      const response = await fetch(
        `${this.getBaseUrl()}/datasets/${datasetId}/tables`,
        { headers: this.getHeaders() }
      );
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`BigQuery API Error: ${errorData.error.message}`);
      }
      
      const data = await response.json();
      
      return data.tables ? data.tables.map((table: any) => ({
        id: table.tableReference.tableId,
        name: table.tableReference.tableId,
      })) : [];
    } catch (err) {
      console.error('テーブル一覧取得エラー:', err);
      throw err;
    }
  }
  
  /**
   * テーブルのスキーマ情報を取得
   */
  async getTableSchema(datasetId: string, tableId: string): Promise<Array<{name: string, type: string}>> {
    try {
      const response = await fetch(
        `${this.getBaseUrl()}/datasets/${datasetId}/tables/${tableId}`,
        { headers: this.getHeaders() }
      );
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`BigQuery API Error: ${errorData.error.message}`);
      }
      
      const data = await response.json();
      
      return data.schema.fields.map((field: any) => ({
        name: field.name,
        type: field.type,
      }));
    } catch (err) {
      console.error('スキーマ取得エラー:', err);
      throw err;
    }
  }
}