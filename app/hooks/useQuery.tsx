// app/hooks/useQuery.tsx
'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useConnection } from './useConnection';
import { useToast } from '../components/ui/use-toast';
import { DuckDBClient } from '../lib/db/duckdb';

export interface QueryResult {
  columns: Array<{name: string, type: string}>;
  rows: Record<string, any>[];
}

interface QueryContextType {
  executeQuery: (sql: string) => Promise<void>;
  currentQuery: string;
  setCurrentQuery: (query: string) => void;
  results: QueryResult | null;
  isExecuting: boolean;
  error: Error | null;
  queryHistory: Array<{id: number, query: string, executed_at: string}>;
  clearResults: () => void;
}

const QueryContext = createContext<QueryContextType | undefined>(undefined);

export function QueryProvider({ children }: { children: ReactNode }) {
  const [currentQuery, setCurrentQuery] = useState<string>('');
  const [results, setResults] = useState<QueryResult | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [queryHistory, setQueryHistory] = useState<Array<{id: number, query: string, executed_at: string}>>([]);
  
  const { toast } = useToast();
  const { connectionType, bigQueryClient } = useConnection();
  
  // クエリ履歴を取得
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const history = await DuckDBClient.getQueryHistory();
        setQueryHistory(history);
      } catch (err) {
        console.error('クエリ履歴取得エラー:', err);
      }
    };
    
    fetchHistory();
  }, []);
  
  // クエリを実行する関数
  const executeQuery = async (sql: string) => {
    if (!sql.trim()) {
      toast({
        title: "エラー",
        description: "実行するSQLを入力してください",
        variant: "destructive",
      });
      return;
    }
    
    setIsExecuting(true);
    setError(null);
    
    try {
      let queryResult: QueryResult;
      
      // 接続タイプに応じたクエリ実行
      if (connectionType === 'bigquery' && bigQueryClient) {
        queryResult = await bigQueryClient.executeQuery(sql);
      } else {
        // デフォルトはDuckDB
        queryResult = await DuckDBClient.executeQuery(sql);
      }
      
      setResults(queryResult);
      
      // クエリ履歴を保存
      await DuckDBClient.saveQueryHistory(sql);
      
      // 履歴を更新
      const history = await DuckDBClient.getQueryHistory();
      setQueryHistory(history);
      
      toast({
        title: "クエリ実行完了",
        description: `${queryResult.rows.length} 行が返されました`,
      });
    } catch (err) {
      console.error('クエリ実行エラー:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
      
      toast({
        title: "クエリ実行エラー",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsExecuting(false);
    }
  };
  
  // 結果をクリア
  const clearResults = () => {
    setResults(null);
    setError(null);
  };
  
  return (
    <QueryContext.Provider
      value={{
        executeQuery,
        currentQuery,
        setCurrentQuery,
        results,
        isExecuting,
        error,
        queryHistory,
        clearResults,
      }}
    >
      {children}
    </QueryContext.Provider>
  );
}

export function useQuery() {
  const context = useContext(QueryContext);
  if (context === undefined) {
    throw new Error('useQuery must be used within a QueryProvider');
  }
  return context;
}