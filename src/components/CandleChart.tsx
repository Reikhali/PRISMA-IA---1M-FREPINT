import React, { useState, useMemo, useEffect, useRef } from 'react';
import type { Candle, TaxaDivididaMarker } from '@/types';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  UTCTimestamp,
  CandlestickSeries,
} from 'lightweight-charts';
import { Layers, Eye, Zap, Sparkles, Filter, Activity, BarChart2, CheckCircle2 } from 'lucide-react';

interface CandleChartProps {
  candles: Candle[];
  activeId?: number;
  emaMacro?: number;
  emaInter?: number;
  gatilhoTaxa50?: number | null;
  markers?: TaxaDivididaMarker[];
  nextDir?: 'call' | 'put' | 'hold';
  nextProb?: number;
  symbol: string;
  precision?: number;
}

interface ClusterLevel {
  price: number;
  volume: number;
  delta: number;
  isPoc: boolean;
  isBuyImbalance: boolean;
  isSellImbalance: boolean;
}

interface CandleFootprintData {
  time: number;
  topScore: string;
  topSub?: string;
  bottomScore: string;
  levels: ClusterLevel[];
  pocPrice: number;
}

interface ImbalanceZone {
  topPrice: number;
  bottomPrice: number;
  startIndex: number;
  endIndex: number;
  color: string;
}

export function CandleChart({
  candles,
  activeId = 76,
  gatilhoTaxa50,
  markers = [],
  nextDir,
  nextProb,
  symbol,
  precision = 5,
}: CandleChartProps) {
  const [chartMode, setChartMode] = useState<'footprint' | 'tradingview'>('footprint');
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);
  const [showFootprint, setShowFootprint] = useState<boolean>(true);
  const [showZones, setShowZones] = useState<boolean>(true);
  const [showWatermark, setShowWatermark] = useState<boolean>(true);

  // ─── LIGHTWEIGHT CHARTS REF ───────────────────────────────────────────────
  const tvContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const currentAssetSymbolRef = useRef<string>(symbol);

  // 1. INICIALIZAÇÃO DO GRÁFICO TRADINGVIEW (Executa só quando monta ou troca de ativo)
  useEffect(() => {
    if (chartMode !== 'tradingview' || !tvContainerRef.current) return;

    currentAssetSymbolRef.current = symbol;

    // Remove gráfico antigo se existir para não duplicar instâncias
    if (chartRef.current) {
      try {
        chartRef.current.remove();
      } catch {}
      chartRef.current = null;
      seriesRef.current = null;
    }

    const chart = createChart(tvContainerRef.current, {
      width: tvContainerRef.current.clientWidth || 800,
      height: 480,
      layout: {
        background: { color: '#040911' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: 'rgba(30, 41, 59, 0.4)' },
        horzLines: { color: 'rgba(30, 41, 59, 0.4)' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        borderColor: '#1e293b',
      },
      rightPriceScale: {
        borderColor: '#1e293b',
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', // Verde Compra
      downColor: '#ef4444', // Vermelho Venda
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    // 2. ORDENAÇÃO E DEDUPLICAÇÃO DE VELAS (Evita timestamps invertidos ou duplicados)
    const sortedMap = new Map<number, CandlestickData>();
    for (const c of candles) {
      if (!c || isNaN(c.time) || isNaN(c.close)) continue;
      const timeSec = Math.floor(c.time) as UTCTimestamp;
      sortedMap.set(timeSec, {
        time: timeSec,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      });
    }

    const cleanData = Array.from(sortedMap.values()).sort(
      (a, b) => (a.time as number) - (b.time as number)
    );

    if (cleanData.length > 0) {
      candleSeries.setData(cleanData);
    }

    chartRef.current = chart;
    seriesRef.current = candleSeries;

    // 3. RESPONSIVIDADE AUTOMÁTICA VIA ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || !entries[0].contentRect) return;
      if (chartRef.current) {
        chartRef.current.applyOptions({
          width: entries[0].contentRect.width,
        });
      }
    });

    resizeObserver.observe(tvContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch {}
        chartRef.current = null;
        seriesRef.current = null;
      }
    };
  }, [symbol, chartMode]);

  // 4. ATUALIZAÇÃO CIRÚRGICA EM TEMPO REAL VIA SSE (Sem recarregar o gráfico e sem resetar zoom)
  useEffect(() => {
    if (chartMode !== 'tradingview') return;

    const eventSource = new EventSource(`/api/stream?activeId=${activeId}`);

    eventSource.addEventListener('candle', (event) => {
      try {
        const c: Candle = JSON.parse(event.data);
        if (!seriesRef.current || !c || isNaN(c.time) || isNaN(c.close)) return;

        // Atualiza cirurgicamente apenas a ponta da vela atual
        seriesRef.current.update({
          time: Math.floor(c.time) as UTCTimestamp,
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
        });
      } catch (err) {
        // ignora erros de parse pontuais
      }
    });

    return () => {
      eventSource.close();
    };
  }, [activeId, chartMode]);

  // ─── FOOTPRINT ORDER FLOW CALCULATIONS ───────────────────────────────────
  const candleCount = showFootprint ? 24 : 38;
  const displayCandles = useMemo(() => {
    if (!candles || candles.length === 0) return [];
    return candles.slice(-candleCount);
  }, [candles, candleCount]);

  // Compute Footprint Cluster data (Volume Profile by Candle, POC, Delta Imbalance & Top/Bottom Metrics)
  const footprintData = useMemo(() => {
    if (!displayCandles || displayCandles.length === 0) return [];

    return displayCandles.map((c, idx) => {
      const isUp = c.close >= c.open;
      const range = Math.max(c.high - c.low, 0.0001);
      const topWick = c.high - Math.max(c.open, c.close);
      const botWick = Math.min(c.open, c.close) - c.low;

      // Seed pseudo-deterministic clusters based on candle timestamp and price delta
      const seed = Math.abs(Math.sin(c.time + c.close * 1000));
      const seed2 = Math.abs(Math.cos(c.time * 2 + c.open * 500));

      const numLevels = Math.min(8, Math.max(4, Math.floor(5 + seed * 4)));
      const step = range / (numLevels + 1);

      const levels: ClusterLevel[] = [];
      let maxVol = 0;
      let pocIdx = Math.floor(numLevels / 2);

      for (let l = 0; l < numLevels; l++) {
        const lvlPrice = c.low + step * (l + 0.5);
        const lvlSeed = Math.abs(Math.sin(c.time + l * 37 + c.close));
        
        // Base volume per price level
        const baseVol = Math.floor(10 + lvlSeed * 85);
        const delta = isUp ? Math.floor(baseVol * 0.45) : -Math.floor(baseVol * 0.45);

        levels.push({
          price: lvlPrice,
          volume: baseVol,
          delta,
          isPoc: false,
          isBuyImbalance: false,
          isSellImbalance: false,
        });

        if (baseVol > maxVol) {
          maxVol = baseVol;
          pocIdx = l;
        }
      }

      // Mark Point of Control (POC)
      if (levels[pocIdx]) {
        levels[pocIdx].isPoc = true;
        levels[pocIdx].volume = Math.max(levels[pocIdx].volume, Math.floor(65 + seed2 * 45));
      }

      // Mark Buy / Sell Imbalances
      levels.forEach((lvl, lIdx) => {
        // High buyer rejection / momentum cluster -> Green circle
        if (
          (isUp && (lIdx <= 2 || lvl.isPoc) && lvl.volume >= 40) ||
          (botWick > topWick && lIdx === 0 && lvl.volume >= 35)
        ) {
          lvl.isBuyImbalance = true;
        }
        // High seller resistance / absorption cluster -> Red/Orange box
        else if (
          (!isUp && (lIdx >= numLevels - 3 || lvl.isPoc) && lvl.volume >= 45) ||
          (topWick > botWick && lIdx === numLevels - 1 && lvl.volume >= 38)
        ) {
          lvl.isSellImbalance = true;
        }
      });

      // Top metric (Imbalance / Delta absorption score e.g. 1.86, 1.44, 3.60)
      const topScoreVal = (1.2 + seed * 2.5).toFixed(2);
      const topSubVal = idx % 2 === 0 ? `${Math.floor(1 + seed2 * 2)}` : undefined;

      // Bottom metric (e.g. 0.18, 4.50, 2.25)
      const botScoreVal = (seed2 * 5.2).toFixed(2);

      return {
        time: c.time,
        topScore: topScoreVal,
        topSub: topSubVal,
        bottomScore: botScoreVal,
        levels,
        pocPrice: levels[pocIdx]?.price || (c.high + c.low) / 2,
      } as CandleFootprintData;
    });
  }, [displayCandles]);

  // Compute Horizontal Imbalance / Absorption Zones (White rectangular boxes on high absorption levels)
  const imbalanceZones = useMemo(() => {
    if (!displayCandles || displayCandles.length < 5 || !footprintData || footprintData.length < 5) return [];

    const zones: ImbalanceZone[] = [];
    const n = displayCandles.length;

    // Scan for resistance zones (top high absorption cluster)
    for (let i = 2; i < n - 3; i += 5) {
      const c = displayCandles[i];
      const nextC = displayCandles[i + 1];
      const next2C = displayCandles[i + 2];
      
      const highCluster = Math.max(c.high, nextC.high, next2C.high);
      const avgClose = (c.close + nextC.close) / 2;
      const zoneThickness = Math.abs(highCluster - avgClose) * 0.35 || 0.00015;

      zones.push({
        topPrice: highCluster,
        bottomPrice: highCluster - zoneThickness,
        startIndex: Math.max(0, i - 1),
        endIndex: Math.min(n - 1, i + 4),
        color: '#ffffff',
      });
    }

    // Bottom support absorption zone
    if (n >= 8) {
      const lastSegment = displayCandles.slice(-8);
      const minLow = Math.min(...lastSegment.map((c) => c.low));
      const zoneThickness = (Math.max(...lastSegment.map((c) => c.high)) - minLow) * 0.12 || 0.00018;

      zones.push({
        topPrice: minLow + zoneThickness,
        bottomPrice: minLow,
        startIndex: Math.max(0, n - 7),
        endIndex: n - 1,
        color: '#ffffff',
      });
    }

    return zones;
  }, [displayCandles, footprintData]);

  // SVG Chart Geometry
  const W = 1120;
  const H = 480;
  const PAD = { top: 40, bottom: 44, left: 16, right: 88 };

  const { minPrice, maxPrice } = useMemo(() => {
    if (!displayCandles || displayCandles.length === 0) {
      return { minPrice: 0, maxPrice: 1 };
    }
    let min = Infinity;
    let max = -Infinity;
    for (const c of displayCandles) {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
    }
    const margin = (max - min) * 0.12 || 0.0005;
    return { minPrice: min - margin, maxPrice: max + margin };
  }, [displayCandles]);

  const priceRange = Math.max(maxPrice - minPrice, 0.00001);

  const toY = (price: number) => {
    const norm = (price - minPrice) / priceRange;
    return H - PAD.bottom - norm * (H - PAD.top - PAD.bottom);
  };

  const candleW = Math.max(16, (W - PAD.left - PAD.right) / Math.max(displayCandles.length, 1) - 10);
  const candleGap = (W - PAD.left - PAD.right) / Math.max(displayCandles.length, 1);

  const toX = (index: number) => {
    return PAD.left + index * candleGap + candleGap / 2;
  };

  const priceGridLevels = useMemo(() => {
    const levels = [];
    const step = priceRange / 6;
    for (let i = 0; i <= 6; i++) {
      const p = minPrice + step * i;
      levels.push(p);
    }
    return levels;
  }, [minPrice, priceRange]);

  const lastCandle = displayCandles[displayCandles.length - 1];

  return (
    <div className="w-full bg-[#030712]/95 border border-emerald-500/25 rounded-2xl overflow-hidden shadow-2xl p-3 sm:p-4 space-y-3">
      {/* Chart Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-black text-white font-mono tracking-wide">{symbol}</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                M1 OTC FEED
              </span>
              <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                SSE 1000ms
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              Último Preço: <strong className="text-emerald-400">{lastCandle ? lastCandle.close.toFixed(precision) : '0.00000'}</strong>
            </p>
          </div>
        </div>

        {/* View Mode & Indicator Toggles */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Switcher Mode */}
          <div className="bg-[#020509] p-1 rounded-xl border border-white/10 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setChartMode('footprint')}
              className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                chartMode === 'footprint'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>🔬 FOOTPRINT ORDER FLOW</span>
            </button>

            <button
              type="button"
              onClick={() => setChartMode('tradingview')}
              className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                chartMode === 'tradingview'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>📊 TRADINGVIEW CANDLES</span>
            </button>
          </div>

          {/* Sub-Filters */}
          {chartMode === 'footprint' && (
            <>
              <button
                type="button"
                onClick={() => setShowFootprint(!showFootprint)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all border ${
                  showFootprint
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                    : 'bg-black/40 border-white/10 text-slate-400'
                }`}
              >
                Clusters: {showFootprint ? 'ON' : 'OFF'}
              </button>

              <button
                type="button"
                onClick={() => setShowZones(!showZones)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all border ${
                  showZones
                    ? 'bg-white/20 border-white/40 text-white'
                    : 'bg-black/40 border-white/10 text-slate-400'
                }`}
              >
                Zonas: {showZones ? 'ON' : 'OFF'}
              </button>

              <button
                type="button"
                onClick={() => setShowWatermark(!showWatermark)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all border ${
                  showWatermark
                    ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                    : 'bg-black/40 border-white/10 text-slate-400'
                }`}
              >
                DEMO: {showWatermark ? 'ON' : 'OFF'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ─── RENDER CONTAINER ──────────────────────────────────────────────── */}
      {chartMode === 'tradingview' ? (
        /* TRADINGVIEW LIGHTWEIGHT CHARTS CANVAS */
        <div className="w-full relative rounded-xl overflow-hidden border border-slate-800 bg-[#040911]">
          <div ref={tvContainerRef} className="w-full h-[480px]" />
          <div className="absolute top-3 left-4 z-10 pointer-events-none flex items-center gap-2">
            <span className="text-xs font-black text-white/80 font-mono">{symbol}</span>
            <span className="text-[10px] text-emerald-400 font-mono bg-emerald-950/70 px-1.5 py-0.5 rounded border border-emerald-500/30 font-bold">
              1M Candlesticks
            </span>
          </div>
        </div>
      ) : (
        /* FOOTPRINT CLUSTERS & ORDER FLOW VISUALIZER */
        <div className="relative w-full bg-[#020509] rounded-xl overflow-hidden border border-emerald-500/20">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[480px] select-none block" preserveAspectRatio="none">
            {/* Background Grid Lines */}
            {priceGridLevels.map((p, i) => {
              const y = toY(p);
              return (
                <g key={`grid-${i}`}>
                  <line
                    x1={PAD.left}
                    y1={y}
                    x2={W - PAD.right}
                    y2={y}
                    stroke="rgba(255, 255, 255, 0.05)"
                    strokeDasharray="2,3"
                    strokeWidth="1"
                  />
                  <text
                    x={W - PAD.right + 6}
                    y={y + 3.5}
                    fill="#64748b"
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {p.toFixed(precision)}
                  </text>
                </g>
              );
            })}

            {/* DEMO Watermark Overlay */}
            {showWatermark && (
              <g opacity="0.12" pointerEvents="none">
                <text
                  x={W / 2}
                  y={H / 2 + 10}
                  fill="#ffffff"
                  fontSize="120"
                  fontWeight="900"
                  fontFamily="sans-serif"
                  textAnchor="middle"
                  letterSpacing="12"
                >
                  DEMO
                </text>
              </g>
            )}

            {/* Horizontal Imbalance / Absorption Zones (White rectangular boxes) */}
            {showZones &&
              imbalanceZones.map((zone, zIdx) => {
                const xStart = toX(zone.startIndex) - candleW / 2;
                const xEnd = toX(zone.endIndex) + candleW / 2;
                const width = Math.max(20, xEnd - xStart);
                const yTop = toY(zone.topPrice);
                const yBot = toY(zone.bottomPrice);
                const height = Math.max(4, Math.abs(yBot - yTop));

                return (
                  <g key={`zone-${zIdx}`}>
                    <rect
                      x={xStart}
                      y={Math.min(yTop, yBot)}
                      width={width}
                      height={height}
                      fill="#ffffff"
                      fillOpacity="0.08"
                      stroke="#ffffff"
                      strokeWidth="1.2"
                      rx="2"
                    />
                  </g>
                );
              })}

            {/* Candles & Footprint Cluster Columns */}
            {displayCandles.map((c, i) => {
              const isUp = c.close >= c.open;
              const x = toX(i);
              const yOpen = toY(c.open);
              const yClose = toY(c.close);
              const yHigh = toY(c.high);
              const yLow = toY(c.low);

              const bodyY = Math.min(yOpen, yClose);
              const bodyH = Math.max(Math.abs(yClose - yOpen), 2);

              const fp = footprintData[i];
              const isLastCandle = i === displayCandles.length - 1;
              const timeStr = new Date(c.time * 1000).toLocaleTimeString('pt-BR', {
                minute: '2-digit',
                second: '2-digit',
              });

              return (
                <g key={`candle-${c.time}-${i}`} className="cursor-pointer">
                  {/* Wick */}
                  <line
                    x1={x}
                    y1={yHigh}
                    x2={x}
                    y2={yLow}
                    stroke={isUp ? '#10b981' : '#ef4444'}
                    strokeWidth="1.5"
                    opacity="0.9"
                  />

                  {/* Candle Body */}
                  <rect
                    x={x - candleW / 2}
                    y={bodyY}
                    width={candleW}
                    height={bodyH}
                    fill={isUp ? '#064e3b' : '#7f1d1d'}
                    fillOpacity="0.85"
                    stroke={isUp ? '#10b981' : '#ef4444'}
                    strokeWidth="1.2"
                    rx="1.5"
                  />

                  {/* Top Metric / Exaustão Ratio */}
                  {showFootprint && fp && (
                    <g transform={`translate(${x}, ${yHigh - 12})`}>
                      <text
                        x="0"
                        y="0"
                        fill={isUp ? '#34d399' : '#f87171'}
                        fontSize="8"
                        fontWeight="bold"
                        fontFamily="monospace"
                        textAnchor="middle"
                      >
                        {fp.topScore}
                      </text>
                      {fp.topSub && (
                        <text
                          x="0"
                          y="-7"
                          fill="#94a3b8"
                          fontSize="7"
                          fontFamily="monospace"
                          textAnchor="middle"
                        >
                          {fp.topSub}
                        </text>
                      )}
                    </g>
                  )}

                  {/* Bottom Metric / Absorção Ratio */}
                  {showFootprint && fp && (
                    <g transform={`translate(${x}, ${yLow + 14})`}>
                      <text
                        x="0"
                        y="0"
                        fill={isUp ? '#34d399' : '#f87171'}
                        fontSize="8"
                        fontWeight="bold"
                        fontFamily="monospace"
                        textAnchor="middle"
                      >
                        {fp.bottomScore}
                      </text>
                    </g>
                  )}

                  {/* Footprint Cluster Numbers Inside the Candle */}
                  {showFootprint && fp && fp.levels && (
                    <g>
                      {fp.levels.map((lvl, lIdx) => {
                        const lvlY = toY(lvl.price);
                        if (lvlY < yHigh || lvlY > yLow) return null;

                        return (
                          <g key={`lvl-${lIdx}`}>
                            {/* Buy Imbalance Green Circle */}
                            {lvl.isBuyImbalance && (
                              <circle
                                cx={x}
                                cy={lvlY}
                                r={Math.min(9, candleW / 2.2)}
                                fill="#059669"
                                fillOpacity="0.9"
                                stroke="#10b981"
                                strokeWidth="1"
                              />
                            )}

                            {/* POC / Sell Imbalance Red Box */}
                            {lvl.isSellImbalance && (
                              <rect
                                x={x - candleW / 2 + 1}
                                y={lvlY - 5.5}
                                width={candleW - 2}
                                height="11"
                                fill="#b91c1c"
                                fillOpacity="0.9"
                                stroke="#ef4444"
                                strokeWidth="1"
                                rx="2"
                              />
                            )}

                            {/* Normal Level Volume Text */}
                            <text
                              x={x}
                              y={lvlY + 3}
                              fill={
                                lvl.isBuyImbalance
                                  ? '#ffffff'
                                  : lvl.isSellImbalance
                                    ? '#ffffff'
                                    : lvl.isPoc
                                      ? '#fbbf24'
                                      : '#cbd5e1'
                              }
                              fontSize="8"
                              fontWeight={lvl.isBuyImbalance || lvl.isSellImbalance || lvl.isPoc ? '900' : 'normal'}
                              fontFamily="monospace"
                              textAnchor="middle"
                            >
                              {lvl.volume}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  )}

                  {/* Time Marks */}
                  {i % 4 === 0 && (
                    <text
                      x={x}
                      y={H - 10}
                      fill="#64748b"
                      fontSize="8.5"
                      fontFamily="monospace"
                      textAnchor="middle"
                    >
                      {timeStr}
                    </text>
                  )}

                  {/* Signal Call/Put Visual Markers */}
                  {isLastCandle && nextDir === 'call' && (
                    <g transform={`translate(${x}, ${yLow + 26})`}>
                      <polygon points="0,-8 6,0 2,0 2,6 -2,6 -2,0 -6,0" fill="#00e676" />
                      <rect x="-22" y="8" width="44" height="13" rx="3" fill="#022c22" stroke="#00e676" strokeWidth="1" />
                      <text x="0" y="17.5" fill="#00e676" fontSize="7.5" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                        ▲ CALL
                      </text>
                    </g>
                  )}

                  {isLastCandle && nextDir === 'put' && (
                    <g transform={`translate(${x}, ${yHigh - 24})`}>
                      <polygon points="0,8 6,0 2,0 2,-6 -2,-6 -2,0 -6,0" fill="#ff1744" />
                      <rect x="-22" y="-22" width="44" height="13" rx="3" fill="#4c0519" stroke="#ff1744" strokeWidth="1" />
                      <text x="0" y="-12.5" fill="#ff1744" fontSize="7.5" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                        ▼ PUT
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Current Price Line */}
            {lastCandle && (
              <g>
                <line
                  x1={PAD.left}
                  y1={toY(lastCandle.close)}
                  x2={W - PAD.right}
                  y2={toY(lastCandle.close)}
                  stroke="#00e676"
                  strokeWidth="1.2"
                  strokeDasharray="3,3"
                />
                <circle cx={toX(displayCandles.length - 1)} cy={toY(lastCandle.close)} r="3" fill="#ffffff" />
                <rect x={W - PAD.right + 2} y={toY(lastCandle.close) - 8} width="68" height="16" rx="4" fill="#00e676" />
                <text x={W - PAD.right + 6} y={toY(lastCandle.close) + 3.5} fill="#000000" fontSize="9" fontWeight="900" fontFamily="monospace">
                  {lastCandle.close.toFixed(precision)}
                </text>
              </g>
            )}
          </svg>
        </div>
      )}

      {/* Chart Footer */}
      <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 font-mono px-1">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-white font-bold">Motor Order Flow & Candlestick M1</span>
          <span className="text-slate-500">|</span>
          <span className="text-emerald-400">Zero Lag · Deduplicação Ativa</span>
        </div>
        <div className="text-slate-400">
          Corretora OPTGO / Gambol Feed (Sincronizado :58s)
        </div>
      </div>
    </div>
  );
}
