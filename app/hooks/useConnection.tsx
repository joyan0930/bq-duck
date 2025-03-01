// app/hooks/useConnection.tsx
'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { BigQueryClient } from '../lib/db/bigquery';
import { DuckDBClient } from '../lib/db/duckdb';
import { useToast } from '../components/ui/use-toast';

// スキーマ情報の型定義
export interface SchemaInfo {
  tables: Array<{
    name: string;
    rowCount: number;
    columns?: Array<{name: string, type: string}>;
  }>;
}

// 接続タイプ
export type ConnectionType = 'bigquery' | 'duckdb';

interface ConnectionContextType {
  connectionType: ConnectionType;
  setConnectionType: (type: ConnectionType) => void;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  schemaInfo: SchemaInfo | null;
  refreshSchema: () => Promise<void>;
  bigQueryClient: BigQueryClient | null;
  importToDuckDB: (
    tableName: string, 
    data: Record<string, any>[], 
    schema: Array<{name: string, type: string}>
  ) => Promise<void>;
  projects: Array<{id: string, name: string}>;
  selectedProject: string;
  setSelectedProject: (projectId: string) => void;
  datasets: Array<{id: string, name: string}>;
  selectedDataset: string;
  setSelectedDataset: (datasetId: string) => void;
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const { toast } = useToast();
  
  const [connectionType, setConnectionType] = useState<ConnectionType>('duckdb');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [schemaInfo, setSchemaInfo] = useState<SchemaInfo | null>(null);
  const [bigQueryClient, setBigQueryClient] = useState<BigQueryClient | null>(null);
  
  // BigQuery関連の状態
  const [projects, setProjects] = useState<Array<{id: string, name: string}>>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [datasets, setDatasets] = useState<Array<{id: string, name: string}>>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>('');
  
  // 接続を確立
  const connect = async () => {
    try {
      if (connectionType === 'bigquery') {
        if (status !== 'authenticated') {
          // Googleでログイン
          await signIn('google', { callbackUrl: window.location.href });
          return;
        }
        
        // アクセストークンを取得
        const accessToken = (session as any)?.accessToken;
        if (!accessToken) {
          throw new Error('アクセストークンが取得できませんでした');
        }
        
        // デフォルトプロジェクトを取得
        const response = await fetch('/api/bigquery/projects', {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        });
        
        if (!response.ok) {
          throw new Error('BigQueryプロジェクト情報の取得に失敗しました');
        }
        
        const projectsData = await response.json();
        setProjects(projectsData);
        
        if (projectsData.length > 0) {
          const defaultProject = projectsData[0].id;
          setSelectedProject(defaultProject);
          
          // BigQueryクライアントを初期化
          const client = new BigQueryClient({
            projectId: defaultProject,
            location: 'US',
            accessToken,
          });
          
          setBigQueryClient(client);
          
          // データセット一覧を取得
          const datasetsData = await client.listDatasets();
          setDatasets(datasetsData);
          
          if (datasetsData.length > 0) {
            setSelectedDataset(datasetsData[0].id);
          }
        }
      } else {
        // DuckDBの初期化
        await DuckDBClient.initialize();
        
        // テーブル一覧を取得
        const tables = await DuckDBClient.listTables();
        const tableInfo = [];
        
        // 各テーブルの行数を取得
        for (const tableName of tables) {
          try {
            const countResult = await DuckDBClient.executeQuery(`SELECT COUNT(*) AS count FROM "${tableName}"`);
            const rowCount = countResult.rows[0]?.count || 0;
            
            // カラム情報を取得
            const schemaResult = await DuckDBClient.executeQuery(`DESCRIBE "${tableName}"`);
            const columns = schemaResult.rows.map(row => ({
              name: row.column_name,
              type: row.column_type,
            }));
            
            tableInfo.push({
              name: tableName,
              rowCount,
              columns,
            });
          } catch (err) {
            console.error(`テーブル ${tableName} の情報取得エラー:`, err);
          }
        }
        
        setSchemaInfo({ tables: tableInfo });
      }
      
      setIsConnected(true);
      
      toast({
        title: "接続成功",
        description: `${connectionType === 'bigquery' ? 'BigQuery' : 'DuckDB'} に接続しました`,
      });
    } catch (err) {
      console.error('接続エラー:', err);
      
      toast({
        title: "接続エラー",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };
  
  // 接続を切断
  const disconnect = async () => {
    try {
      if (connectionType === 'duckdb') {
        // DuckDBの接続を終了
        await DuckDBClient.close();
      }
      
      setIsConnected(false);
      setSchemaInfo(null);
      setBigQueryClient(null);
      
      toast({
        title: "切断しました",
        description: `${connectionType === 'bigquery' ? 'BigQuery' : 'DuckDB'} から切断しました`,
      });
    } catch (err) {
      console.error('切断エラー:', err);
      
      toast({
        title: "切断エラー",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };
  
  // スキーマ情報を更新
  const refreshSchema = async () => {
    try {
      if (connectionType === 'bigquery' && bigQueryClient && selectedDataset) {
        // BigQueryのテーブル一覧を取得
        const tables = await bigQueryClient.listTables(selectedDataset);
        const tableInfo = [];
        
        // 各テーブルのスキーマ情報を取得
        for (const table of tables) {
          try {
            const schema = await bigQueryClient.getTableSchema(selectedDataset, table.id);
            
            // テーブルの行数を取得（最大値に制限する）
            const countResult = await bigQueryClient.executeQuery(
              `SELECT COUNT(*) AS count FROM \`${selectedProject}.${selectedDataset}.${table.id}\` LIMIT 1000000`
            );
            const rowCount = countResult.rows[0]?.count || 0;
            
            tableInfo.push({
              name: table.name,
              rowCount,
              columns: schema,
            });
          } catch (err) {
            console.error(`テーブル ${table.name} の情報取得エラー:`, err);
          }
        }
        
        setSchemaInfo({ tables: tableInfo });
      } else if (connectionType === 'duckdb') {
        // DuckDBのテーブル一覧を取得
        const tables = await DuckDBClient.listTables();
        const tableInfo = [];
        
        // 各テーブルの行数とスキーマを取得
        for (const tableName of tables) {
          try {
            const countResult = await DuckDBClient.executeQuery(`SELECT COUNT(*) AS count FROM "${tableName}"`);
            const rowCount = countResult.rows[0]?.count || 0;
            
            // カラム情報を取得
            const schemaResult = await DuckDBClient.executeQuery(`DESCRIBE "${tableName}"`);
            const columns = schemaResult.rows.map(row => ({
              name: row.column_name,
              type: row.column_type,
            }));
            
            tableInfo.push({
              name: tableName,
              rowCount,
              columns,
            });
          } catch (err) {
            console.error(`テーブル ${tableName} の情報取得エラー:`, err);
          }
        }
        
        setSchemaInfo({ tables: tableInfo });
      }
      
      toast({
        title: "スキーマ更新",
        description: "テーブル情報を更新しました",
      });
    } catch (err) {
      console.error('スキーマ更新エラー:', err);
      
      toast({
        title: "スキーマ更新エラー",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };
  
  // BigQueryデータをDuckDBにインポート
  const importToDuckDB = async (
    tableName: string, 
    data: Record<string, any>[], 
    schema: Array<{name: string, type: string}>
  ) => {
    try {
      await DuckDBClient.importFromBigQuery(tableName, data, schema);
      
      // スキーマ情報を更新
      await refreshSchema();
      
      toast({
        title: "インポート完了",
        description: `${data.length} 行のデータを ${tableName} にインポートしました`,
      });
    } catch (err) {
      console.error('インポートエラー:', err);
      
      toast({
        title: "インポートエラー",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      
      throw err;
    }
  };
  
  // プロジェクト選択時のデータセット読み込み
  useEffect(() => {
    if (bigQueryClient && selectedProject) {
      const fetchDatasets = async () => {
        try {
          // BigQueryクライアントを更新
          const accessToken = (session as any)?.accessToken;
          const client = new BigQueryClient({
            projectId: selectedProject,
            location: 'US',
            accessToken,
          });
          
          setBigQueryClient(client);
          
          // データセット一覧を取得
          const datasetsData = await client.listDatasets();
          setDatasets(datasetsData);
          
          if (datasetsData.length > 0) {
            setSelectedDataset(datasetsData[0].id);
          } else {
            setSelectedDataset('');
          }
        } catch (err) {
          console.error('データセット取得エラー:', err);
          
          toast({
            title: "データセット取得エラー",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        }
      };
      
      fetchDatasets();
    }
  }, [selectedProject, session]);
  
  // データセット選択時のスキーマ読み込み
  useEffect(() => {
    if (bigQueryClient && selectedDataset) {
      refreshSchema();
    }
  }, [selectedDataset]);
  
  // 接続タイプ変更時に再接続
  useEffect(() => {
    if (isConnected) {
      disconnect().then(() => connect());
    }
  }, [connectionType]);
  
  return (
    <ConnectionContext.Provider
      value={{
        connectionType,
        setConnectionType,
        isConnected,
        connect,
        disconnect,
        schemaInfo,
        refreshSchema,
        bigQueryClient,
        importToDuckDB,
        projects,
        selectedProject,
        setSelectedProject,
        datasets,
        selectedDataset,
        setSelectedDataset,
      }}
    >
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection() {
  const context = useContext(ConnectionContext);
  if (context === undefined) {
    throw new Error('useConnection must be used within a ConnectionProvider');
  }
  return context;
}