// app/lib/db/duckdb.ts
import * as duckdb from '@duckdb/duckdb-wasm';
import { AsyncDuckDBConnection, AsyncDuckDB } from '@duckdb/duckdb-wasm';
import { QueryResult } from '../../types/query';

// DuckDB WAsmのインスタンスとバンドルURLを定義
const DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: '/duckdb-wasm/duckdb-mvp.wasm',
    mainWorker: '/duckdb-wasm/duckdb-browser-mvp.worker.js',
  },
  eh: {
    mainModule: '/duckdb-wasm/duckdb-eh.wasm',
    mainWorker: '/duckdb-wasm/duckdb-browser-eh.worker.js',
  },
};

// DB容量上限（1GB）
const MAX_DB_SIZE_BYTES = 1024 * 1024 * 1024;

// シングルトンインスタンス
let _db: AsyncDuckDB | null = null;
let _conn: AsyncDuckDBConnection | null = null;
let _dbInitPromise: Promise<void> | null = null;

export class DuckDBClient {
  private static DB_NAME = 'sql_editor_db';

  /**
   * DuckDBインスタンスの初期化
   */
  static async initialize(): Promise<void> {
    if (_dbInitPromise) return _dbInitPromise;

    _dbInitPromise = (async () => {
      try {
        // DuckDBをロード
        const bundle = await duckdb.selectBundle(DUCKDB_BUNDLES);
        const worker = new Worker(bundle.mainWorker);
        const logger = new duckdb.ConsoleLogger();
        
        _db = new duckdb.AsyncDuckDB(logger, worker);
        await _db.instantiate(bundle.mainModule, bundle.pthreadWorker);
        
        // OPFSの初期化
        try {
          // OPFS（ブラウザの永続ストレージ）にデータベースファイルを作成
          const dbFile = await _db.registerFileHandle(
            this.DB_NAME,
            await duckdb.getSecurityPolicyReadOnlyFileHandle(),
            true, // useAtomic
            true, // create
          );
          
          // メモリ上限を設定
          await _db.open({
            path: this.DB_NAME,
            memory: false,
            config: {
              memory_limit: `${Math.floor(MAX_DB_SIZE_BYTES / (1024 * 1024))}MB`,
            },
          });
        } catch (err) {
          console.error('OPFS初期化エラー:', err);
          
          // フォールバック：メモリDB
          await _db.open({
            path: ':memory:',
          });
        }
        
        // 接続を作成
        _conn = await _db.connect();
        
        // 環境情報を取得
        const versionResult = await _conn.query('SELECT version()');
        console.log('DuckDB初期化完了:', versionResult.toString());
        
      } catch (err) {
        console.error('DuckDB初期化エラー:', err);
        _db = null;
        _conn = null;
        throw err;
      }
    })();
    
    return _dbInitPromise;
  }
  
  /**
   * SQLクエリの実行
   */
  static async executeQuery(sql: string): Promise<QueryResult> {
    if (!_conn) {
      await this.initialize();
      if (!_conn) throw new Error('DuckDB接続が確立できませんでした');
    }
    
    try {
      const result = await _conn.query(sql);
      
      // 結果をアプリケーションフォーマットに変換
      const columns = result.schema.fields.map(field => ({
        name: field.name,
        type: field.typeId.toString(),
      }));
      
      const rows = [];
      for (let i = 0; i < result.length; i++) {
        const row: Record<string, any> = {};
        for (const [key, value] of Object.entries(result.getRow(i))) {
          row[key] = value;
        }
        rows.push(row);
      }
      
      return { columns, rows };
    } catch (err) {
      console.error('クエリ実行エラー:', err);
      throw err;
    }
  }
  
  /**
   * BigQuery結果をDuckDBにインポート
   */
  static async importFromBigQuery(
    tableName: string, 
    data: Record<string, any>[], 
    schema: Array<{ name: string, type: string }>
  ): Promise<void> {
    if (!_conn) {
      await this.initialize();
      if (!_conn) throw new Error('DuckDB接続が確立できませんでした');
    }
    
    try {
      // テーブルが存在する場合は削除
      await _conn.query(`DROP TABLE IF EXISTS ${tableName}`);
      
      // データサイズをチェック
      const dataSize = JSON.stringify(data).length;
      if (dataSize > MAX_DB_SIZE_BYTES) {
        throw new Error(`データサイズ(${dataSize}バイト)が上限(${MAX_DB_SIZE_BYTES}バイト)を超えています`);
      }
      
      // スキーマからCREATE TABLE文を生成
      const columnDefs = schema.map(col => {
        // SQL型に変換
        let duckDbType: string;
        switch (col.type.toLowerCase()) {
          case 'string': duckDbType = 'VARCHAR'; break;
          case 'integer': duckDbType = 'INTEGER'; break;
          case 'float': duckDbType = 'DOUBLE'; break;
          case 'boolean': duckDbType = 'BOOLEAN'; break;
          case 'timestamp': duckDbType = 'TIMESTAMP'; break;
          case 'date': duckDbType = 'DATE'; break;
          default: duckDbType = 'VARCHAR'; break;
        }
        return `"${col.name}" ${duckDbType}`;
      }).join(', ');
      
      // テーブル作成
      const createTableSQL = `CREATE TABLE ${tableName} (${columnDefs})`;
      await _conn.query(createTableSQL);
      
      // データをバッチに分割してインサート
      const BATCH_SIZE = 1000;
      for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const batch = data.slice(i, i + BATCH_SIZE);
        
        // INSERTステートメントを構築
        for (const row of batch) {
          const values = schema.map(col => {
            const value = row[col.name];
            if (value === null || value === undefined) return 'NULL';
            
            // 型に応じた適切なフォーマット
            switch (col.type.toLowerCase()) {
              case 'string': return `'${value.replace(/'/g, "''")}'`;
              case 'timestamp': 
              case 'date': return `'${value}'`;
              default: return value;
            }
          }).join(', ');
          
          await _conn.query(`INSERT INTO ${tableName} VALUES (${values})`);
        }
      }
      
      console.log(`${data.length}行をテーブル${tableName}にインポートしました`);
    } catch (err) {
      console.error('BigQueryデータのインポートエラー:', err);
      throw err;
    }
  }
  
  /**
   * 利用可能なテーブル一覧を取得
   */
  static async listTables(): Promise<string[]> {
    if (!_conn) {
      await this.initialize();
      if (!_conn) throw new Error('DuckDB接続が確立できませんでした');
    }
    
    try {
      const result = await _conn.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'main'
      `);
      
      return result.toArray().map((row: any) => row.table_name);
    } catch (err) {
      console.error('テーブル一覧取得エラー:', err);
      throw err;
    }
  }
  
  /**
   * クエリ履歴を保存
   */
  static async saveQueryHistory(query: string): Promise<void> {
    if (!_conn) {
      await this.initialize();
      if (!_conn) throw new Error('DuckDB接続が確立できませんでした');
    }
    
    try {
      // 履歴テーブルが存在しない場合は作成
      await _conn.query(`
        CREATE TABLE IF NOT EXISTS query_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          query TEXT NOT NULL,
          executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // クエリを保存
      await _conn.query(`
        INSERT INTO query_history (query) VALUES (?)
      `, [query]);
    } catch (err) {
      console.error('クエリ履歴保存エラー:', err);
      throw err;
    }
  }
  
  /**
   * クエリ履歴を取得
   */
  static async getQueryHistory(limit: number = 50): Promise<Array<{id: number, query: string, executed_at: string}>> {
    if (!_conn) {
      await this.initialize();
      if (!_conn) throw new Error('DuckDB接続が確立できませんでした');
    }
    
    try {
      // 履歴テーブルが存在しない場合は作成
      await _conn.query(`
        CREATE TABLE IF NOT EXISTS query_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          query TEXT NOT NULL,
          executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // 最新のクエリを取得
      const result = await _conn.query(`
        SELECT id, query, executed_at
        FROM query_history
        ORDER BY executed_at DESC
        LIMIT ?
      `, [limit]);
      
      return result.toArray().map((row: any) => ({
        id: row.id,
        query: row.query,
        executed_at: row.executed_at
      }));
    } catch (err) {
      console.error('クエリ履歴取得エラー:', err);
      throw err;
    }
  }
  
  /**
   * すべてのストレージ情報を取得
   */
  static async getStorageInfo(): Promise<{
    tables: Array<{name: string, row_count: number, size_bytes: number}>,
    total_size_bytes: number
  }> {
    if (!_conn) {
      await this.initialize();
      if (!_conn) throw new Error('DuckDB接続が確立できませんでした');
    }
    
    try {
      // テーブルのサイズと行数を取得
      const tableInfoResult = await _conn.query(`
        SELECT 
          table_name, 
          SUM(estimated_size) AS size_bytes
        FROM pragma_database_size()
        GROUP BY table_name
      `);
      
      const tableInfoArray = tableInfoResult.toArray();
      const tableInfo = [];
      let totalSize = 0;
      
      for (const info of tableInfoArray) {
        const tableName = info.table_name;
        const sizeBytes = info.size_bytes;
        
        // 行数を取得
        const countResult = await _conn.query(`
          SELECT COUNT(*) AS row_count FROM "${tableName}"
        `);
        const rowCount = countResult.toArray()[0].row_count;
        
        tableInfo.push({
          name: tableName,
          row_count: rowCount,
          size_bytes: sizeBytes
        });
        
        totalSize += sizeBytes;
      }
      
      return {
        tables: tableInfo,
        total_size_bytes: totalSize
      };
    } catch (err) {
      console.error('ストレージ情報取得エラー:', err);
      throw err;
    }
  }
  
  /**
   * DuckDBインスタンスを終了
   */
  static async close(): Promise<void> {
    if (_conn) {
      try {
        await _conn.close();
        _conn = null;
      } catch (err) {
        console.error('接続終了エラー:', err);
      }
    }
    
    if (_db) {
      try {
        await _db.terminate();
        _db = null;
      } catch (err) {
        console.error('DBインスタンス終了エラー:', err);
      }
    }
    
    _dbInitPromise = null;
  }
}