// app/components/visualization/chart-view.tsx
'use client';

import React, { useState, useMemo } from 'react';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '../../components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { Slider } from '../../components/ui/slider';
import { 
  ChevronDown, 
  DownloadIcon, 
  Settings, 
  BarChart, 
  LineChart as LineChartIcon, 
  PieChart as PieChartIcon,
  ScatterChart
} from 'lucide-react';

// 棒グラフ
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts';

// 折れ線グラフ
import { 
  LineChart, 
  Line 
} from 'recharts';

// 円グラフ
import { 
  PieChart, 
  Pie, 
  Cell 
} from 'recharts';

// 散布図
import {
  ScatterChart as RechartsScatterChart,
  Scatter,
  ZAxis
} from 'recharts';

// 型定義
export interface ColumnInfo {
  name: string;
  type: string;
}

export interface ChartViewProps {
  data: Record<string, any>[];
  columns: ColumnInfo[];
}

// カラータイプの判定
function getColumnType(column: ColumnInfo): 'numeric' | 'categorical' | 'datetime' | 'unknown' {
  const type = column.type.toLowerCase();
  
  if (
    type === 'integer' || 
    type === 'int' || 
    type === 'float' || 
    type === 'double' || 
    type === 'decimal' || 
    type === 'numeric' || 
    type === 'real'
  ) {
    return 'numeric';
  }
  
  if (
    type === 'date' || 
    type === 'datetime' || 
    type === 'timestamp'
  ) {
    return 'datetime';
  }
  
  if (
    type === 'string' || 
    type === 'varchar' || 
    type === 'char' || 
    type === 'text' || 
    type === 'boolean'
  ) {
    return 'categorical';
  }
  
  return 'unknown';
}

// グラフタイプの定義
type ChartType = 'bar' | 'line' | 'pie' | 'scatter';

// カラーパレット
const COLORS = [
  '#3366CC', '#DC3912', '#FF9900', '#109618', '#990099', 
  '#3B3EAC', '#0099C6', '#DD4477', '#66AA00', '#B82E2E'
];

export function ChartView({ data, columns }: ChartViewProps) {
  // 利用可能なカラム
  const numericColumns = useMemo(() => 
    columns.filter(col => getColumnType(col) === 'numeric'),
    [columns]
  );
  
  const categoricalColumns = useMemo(() => 
    columns.filter(col => 
      getColumnType(col) === 'categorical' || 
      getColumnType(col) === 'datetime'
    ),
    [columns]
  );
  
  // グラフの状態
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [xAxisColumn, setXAxisColumn] = useState<string>(
    categoricalColumns.length > 0 ? categoricalColumns[0].name : ''
  );
  const [yAxisColumn, setYAxisColumn] = useState<string>(
    numericColumns.length > 0 ? numericColumns[0].name : ''
  );
  const [valueColumn, setValueColumn] = useState<string>(
    numericColumns.length > 0 ? numericColumns[0].name : ''
  );
  const [labelColumn, setLabelColumn] = useState<string>(
    categoricalColumns.length > 0 ? categoricalColumns[0].name : ''
  );
  const [showGrid, setShowGrid] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [chartTitle, setChartTitle] = useState('');
  const [xAxisLabel, setXAxisLabel] = useState('');
  const [yAxisLabel, setYAxisLabel] = useState('');
  
  // 散布図の設定
  const [scatterSize, setScatterSize] = useState<string>(
    numericColumns.length > 2 ? numericColumns[2].name : ''
  );
  
  // タブの状態
  const [activeTab, setActiveTab] = useState('preview');
  
  // グラフデータの準備
  const prepareBarLineData = useMemo(() => {
    if (!xAxisColumn || !yAxisColumn || !data.length) return [];
    
    // X軸の値でグループ化
    const groups = data.reduce((acc, row) => {
      const key = String(row[xAxisColumn]);
      if (!acc[key]) {
        acc[key] = { [xAxisColumn]: key };
      }
      acc[key][yAxisColumn] = (acc[key][yAxisColumn] || 0) + Number(row[yAxisColumn] || 0);
      return acc;
    }, {} as Record<string, any>);
    
    return Object.values(groups);
  }, [data, xAxisColumn, yAxisColumn]);
  
  // 円グラフデータの準備
  const preparePieData = useMemo(() => {
    if (!labelColumn || !valueColumn || !data.length) return [];
    
    // ラベルでグループ化
    const groups = data.reduce((acc, row) => {
      const key = String(row[labelColumn]);
      if (!acc[key]) {
        acc[key] = { name: key, value: 0 };
      }
      acc[key].value += Number(row[valueColumn] || 0);
      return acc;
    }, {} as Record<string, {name: string, value: number}>);
    
    return Object.values(groups);
  }, [data, labelColumn, valueColumn]);
  
  // 散布図データの準備
  const prepareScatterData = useMemo(() => {
    if (!xAxisColumn || !yAxisColumn || !data.length) return [];
    
    return data.map(row => ({
      x: Number(row[xAxisColumn] || 0),
      y: Number(row[yAxisColumn] || 0),
      z: scatterSize ? Number(row[scatterSize] || 1) : 1,
      name: row[labelColumn] || '',
    }));
  }, [data, xAxisColumn, yAxisColumn, scatterSize, labelColumn]);

  // グラフをSVGとして保存
  const downloadChart = () => {
    const svgElement = document.querySelector('.recharts-surface');
    if (!svgElement) return;
    
    // SVGをシリアライズ
    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svgElement);
    
    // SVG文字列をBlobに変換
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    // ダウンロードリンクを作成
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = `chart_${new Date().toISOString().slice(0,10)}.svg`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };
  
  // グラフを表示するコンポーネント
  const renderChart = () => {
    switch (chartType) {
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={prepareBarLineData}>
              {showGrid && <CartesianGrid strokeDasharray="3 3" />}
              <XAxis 
                dataKey={xAxisColumn} 
                label={xAxisLabel ? { value: xAxisLabel, position: 'insideBottom', offset: -5 } : undefined} 
              />
              <YAxis 
                label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft' } : undefined} 
              />
              <Tooltip />
              {showLegend && <Legend />}
              <Bar dataKey={yAxisColumn} fill={COLORS[0]} />
            </BarChart>
          </ResponsiveContainer>
        );
        
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={prepareBarLineData}>
              {showGrid && <CartesianGrid strokeDasharray="3 3" />}
              <XAxis 
                dataKey={xAxisColumn} 
                label={xAxisLabel ? { value: xAxisLabel, position: 'insideBottom', offset: -5 } : undefined} 
              />
              <YAxis 
                label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft' } : undefined} 
              />
              <Tooltip />
              {showLegend && <Legend />}
              <Line 
                type="monotone" 
                dataKey={yAxisColumn} 
                stroke={COLORS[0]} 
                activeDot={{ r: 8 }} 
              />
            </LineChart>
          </ResponsiveContainer>
        );
        
      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={400}>
            <PieChart>
              <Pie
                data={preparePieData}
                cx="50%"
                cy="50%"
                labelLine={true}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={150}
                fill="#8884d8"
                dataKey="value"
              >
                {preparePieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              {showLegend && <Legend />}
            </PieChart>
          </ResponsiveContainer>
        );
        
      case 'scatter':
        return (
          <ResponsiveContainer width="100%" height={400}>
            <RechartsScatterChart>
              {showGrid && <CartesianGrid strokeDasharray="3 3" />}
              <XAxis 
                type="number" 
                dataKey="x" 
                name={xAxisColumn} 
                label={xAxisLabel ? { value: xAxisLabel, position: 'insideBottom', offset: -5 } : undefined} 
              />
              <YAxis 
                type="number" 
                dataKey="y" 
                name={yAxisColumn} 
                label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft' } : undefined} 
              />
              <ZAxis type="number" dataKey="z" range={[40, 160]} name={scatterSize} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} />
              {showLegend && <Legend />}
              <Scatter 
                name={`${xAxisColumn} vs ${yAxisColumn}`} 
                data={prepareScatterData} 
                fill={COLORS[0]} 
              />
            </RechartsScatterChart>
          </ResponsiveContainer>
        );
        
      default:
        return <div>グラフタイプを選択してください</div>;
    }
  };
  
  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex justify-between items-center mb-4">
          <TabsList>
            <TabsTrigger value="preview">プレビュー</TabsTrigger>
            <TabsTrigger value="settings">設定</TabsTrigger>
          </TabsList>
          
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={downloadChart}>
              <DownloadIcon className="mr-2 h-4 w-4" />
              エクスポート
            </Button>
          </div>
        </div>
        
        <TabsContent value="preview" className="p-4 border rounded-md">
          {chartTitle && (
            <h3 className="text-lg font-bold text-center mb-4">{chartTitle}</h3>
          )}
          {renderChart()}
        </TabsContent>
        
        <TabsContent value="settings">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>グラフタイプ</CardTitle>
                <CardDescription>表示するグラフの種類を選択します</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    variant={chartType === 'bar' ? 'default' : 'outline'} 
                    onClick={() => setChartType('bar')}
                    className="flex flex-col items-center justify-center p-4"
                  >
                    <BarChart className="h-6 w-6 mb-2" />
                    棒グラフ
                  </Button>
                  <Button 
                    variant={chartType === 'line' ? 'default' : 'outline'} 
                    onClick={() => setChartType('line')}
                    className="flex flex-col items-center justify-center p-4"
                  >
                    <LineChartIcon className="h-6 w-6 mb-2" />
                    折れ線グラフ
                  </Button>
                  <Button 
                    variant={chartType === 'pie' ? 'default' : 'outline'} 
                    onClick={() => setChartType('pie')}
                    className="flex flex-col items-center justify-center p-4"
                  >
                    <PieChartIcon className="h-6 w-6 mb-2" />
                    円グラフ
                  </Button>
                  <Button 
                    variant={chartType === 'scatter' ? 'default' : 'outline'} 
                    onClick={() => setChartType('scatter')}
                    className="flex flex-col items-center justify-center p-4"
                  >
                    <ScatterChart className="h-6 w-6 mb-2" />
                    散布図
                  </Button>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>データマッピング</CardTitle>
                <CardDescription>データと軸のマッピングを設定します</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {(chartType === 'bar' || chartType === 'line' || chartType === 'scatter') && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="x-axis">X軸</Label>
                      <Select value={xAxisColumn} onValueChange={setXAxisColumn}>
                        <SelectTrigger id="x-axis">
                          <SelectValue placeholder="X軸のカラムを選択" />
                        </SelectTrigger>
                        <SelectContent>
                          {chartType === 'scatter' 
                            ? numericColumns.map(col => (
                                <SelectItem key={col.name} value={col.name}>
                                  {col.name} ({col.type})
                                </SelectItem>
                              ))
                            : categoricalColumns.map(col => (
                                <SelectItem key={col.name} value={col.name}>
                                  {col.name} ({col.type})
                                </SelectItem>
                              ))
                          }
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="y-axis">Y軸</Label>
                      <Select value={yAxisColumn} onValueChange={setYAxisColumn}>
                        <SelectTrigger id="y-axis">
                          <SelectValue placeholder="Y軸のカラムを選択" />
                        </SelectTrigger>
                        <SelectContent>
                          {numericColumns.map(col => (
                            <SelectItem key={col.name} value={col.name}>
                              {col.name} ({col.type})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {chartType === 'scatter' && (
                      <div className="space-y-2">
                        <Label htmlFor="size">サイズ（オプション）</Label>
                        <Select value={scatterSize} onValueChange={setScatterSize}>
                          <SelectTrigger id="size">
                            <SelectValue placeholder="サイズのカラムを選択" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">なし</SelectItem>
                            {numericColumns.map(col => (
                              <SelectItem key={col.name} value={col.name}>
                                {col.name} ({col.type})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </>
                )}
                
                {chartType === 'pie' && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="label">ラベル</Label>
                      <Select value={labelColumn} onValueChange={setLabelColumn}>
                        <SelectTrigger id="label">
                          <SelectValue placeholder="ラベルのカラムを選択" />
                        </SelectTrigger>
                        <SelectContent>
                          {categoricalColumns.map(col => (
                            <SelectItem key={col.name} value={col.name}>
                              {col.name} ({col.type})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="value">値</Label>
                      <Select value={valueColumn} onValueChange={setValueColumn}>
                        <SelectTrigger id="value">
                          <SelectValue placeholder="値のカラムを選択" />
                        </SelectTrigger>
                        <SelectContent>
                          {numericColumns.map(col => (
                            <SelectItem key={col.name} value={col.name}>
                              {col.name} ({col.type})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>グラフ設定</CardTitle>
                <CardDescription>グラフの表示設定</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="chart-title">グラフタイトル</Label>
                  <Input 
                    id="chart-title" 
                    value={chartTitle} 
                    onChange={e => setChartTitle(e.target.value)} 
                    placeholder="グラフのタイトル" 
                  />
                </div>
                
                {chartType !== 'pie' && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="x-axis-label">X軸ラベル</Label>
                      <Input 
                        id="x-axis-label" 
                        value={xAxisLabel} 
                        onChange={e => setXAxisLabel(e.target.value)} 
                        placeholder="X軸のラベル" 
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="y-axis-label">Y軸ラベル</Label>
                      <Input 
                        id="y-axis-label" 
                        value={yAxisLabel} 
                        onChange={e => setYAxisLabel(e.target.value)} 
                        placeholder="Y軸のラベル" 
                      />
                    </div>
                  </>
                )}
                
                <div className="flex items-center space-x-2">
                  <Switch 
                    id="show-grid" 
                    checked={showGrid} 
                    onCheckedChange={setShowGrid} 
                  />
                  <Label htmlFor="show-grid">グリッド線を表示</Label>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Switch 
                    id="show-legend" 
                    checked={showLegend} 
                    onCheckedChange={setShowLegend} 
                  />
                  <Label htmlFor="show-legend">凡例を表示</Label>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}