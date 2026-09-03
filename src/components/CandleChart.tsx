import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { Candle } from '@/types';
import {
  calculateSuperTrend,
  calculateRSI,
  calculateTrueSupplyDemandZones,
  SuperTrendPoint,
  SupplyDemandZone,
} from '@/lib/supertrend-rsi-engine';
import {
  Maximize2,
  TrendingUp,
  TrendingDown,
  Activity,
  Crosshair,
  Layers,
} from 'lucide-react';

interface CandleChartProps {
  candles: Candle[];
  activeId?: number;
  symbol: string;
  precision?: number;
  isAnalyzing?: boolean;
  scanStatusText?: string;
  enableSupplyDemand?: boolean;
  onToggleSupplyDemand?: () => void;
}

export function CandleChart({
  candles,
  activeId = 76,
  symbol,
  precision = 5,
  isAnalyzing = false,
  scanStatusText = 'ESCANEANDO TELA DO GRÁFICO & TICKS...',
  enableSupplyDemand,
  onToggleSupplyDemand,
}: CandleChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Controle de ativação/desativação do True Supply & Demand
  const [showSupplyDemandInternal, setShowSupplyDemandInternal] = useState<boolean>(true);
  const isSupplyDemandActive =
    enableSupplyDemand !== undefined ? enableSupplyDemand : showSupplyDemandInternal;

  const handleToggleSupplyDemand = () => {
    if (onToggleSupplyDemand) {
      onToggleSupplyDemand();
    } else {
      setShowSupplyDemandInternal((prev) => !prev);
    }
  };

  // Estados de controle e navegação
  const [visibleCount, setVisibleCount] = useState<number>(32); // 32 velas garante velas bem "gordinhas"
  const [panOffset, setPanOffset] = useState<number>(0);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStartX, setDragStartX] = useState<number>(0);

  // Cotação e dados em tempo real
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);

  // Cálculos matemáticos dos indicadores para todas as velas
  const { superTrendPoints, rsiValues, supplyDemandAnalysis } = useMemo(() => {
    if (candles.length === 0) {
      return { superTrendPoints: [], rsiValues: [], supplyDemandAnalysis: null };
    }
    const st = calculateSuperTrend(candles, 10, 2.0);
    const rsi = calculateRSI(candles.map((c) => c.close), 9);
    const sd = calculateTrueSupplyDemandZones(candles);
    return { superTrendPoints: st, rsiValues: rsi, supplyDemandAnalysis: sd };
  }, [candles]);

  // Escuta o stream em tempo real SSE
  useEffect(() => {
    const eventSource = new EventSource(`/api/stream?activeId=${activeId}`);

    eventSource.addEventListener('candle', (event) => {
      try {
        const c: Candle = JSON.parse(event.data);
        if (c && !isNaN(c.close)) {
          setCurrentPrice(c.close);
          setPriceChange(c.close - c.open);
        }
      } catch {}
    });

    return () => {
      eventSource.close();
    };
  }, [activeId]);

  // Redimensionamento e ajuste responsivo
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || candles.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Divisão vertical do canvas:
    // 74% superior para o Gráfico de Candlestick + SuperTrend
    // 26% inferior para o Oscilador RSI(9) com linha central 50
    const rsiHeight = Math.max(90, height * 0.25);
    const mainHeight = height - rsiHeight - 10;
    const rightMargin = 75; // Espaço para a régua de preços à direita

    // 1. Fundo Gradiente Elegante
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, '#040810');
    bgGrad.addColorStop(1, '#020408');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // 2. Velas a exibir
    const totalCandles = candles.length;
    const count = Math.min(totalCandles, Math.max(16, visibleCount));
    const maxOffset = Math.max(0, totalCandles - count);
    const currentOffset = Math.min(maxOffset, Math.max(0, panOffset));
    const startIdx = totalCandles - count - currentOffset;
    const endIdx = totalCandles - currentOffset;

    const visibleCandles = candles.slice(startIdx, endIdx);
    const visibleSt = superTrendPoints.slice(startIdx, endIdx);
    const visibleRsi = rsiValues.slice(startIdx, endIdx);

    if (visibleCandles.length === 0) return;

    // 3. Faixa de Preço do Gráfico Principal
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    visibleCandles.forEach((c) => {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
    });

    // Inclui SuperTrend na escala para não cortar a linha
    visibleSt.forEach((st) => {
      if (st && st.value > 0) {
        if (st.value < minPrice) minPrice = st.value;
        if (st.value > maxPrice) maxPrice = st.value;
      }
    });

    // Se Supply & Demand estiver ativo, inclui as zonas mais próximas na escala do gráfico
    if (isSupplyDemandActive && supplyDemandAnalysis) {
      if (supplyDemandAnalysis.nearestSupply) {
        const sTop = supplyDemandAnalysis.nearestSupply.topPrice;
        if (sTop > maxPrice && sTop < maxPrice * 1.03) {
          maxPrice = sTop;
        }
      }
      if (supplyDemandAnalysis.nearestDemand) {
        const dBot = supplyDemandAnalysis.nearestDemand.bottomPrice;
        if (dBot < minPrice && dBot > minPrice * 0.97) {
          minPrice = dBot;
        }
      }
    }

    const priceMargin = (maxPrice - minPrice) * 0.14 || 0.0001;
    minPrice -= priceMargin;
    maxPrice += priceMargin;
    const priceRange = maxPrice - minPrice;

    // 4. Grade Suave de Preços e Tempo
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.lineWidth = 1;
    for (let y = 30; y < mainHeight; y += 35) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width - rightMargin, y);
      ctx.stroke();
    }

    // 5. Linhas de Preço na Escala Direita
    const priceSteps = 6;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'left';
    for (let i = 0; i <= priceSteps; i++) {
      const p = minPrice + (priceRange * i) / priceSteps;
      const y = mainHeight - (i / priceSteps) * (mainHeight - 40) - 20;
      ctx.fillText(p.toFixed(precision), width - rightMargin + 8, y + 3);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width - rightMargin, y);
      ctx.stroke();
    }

    // 6. Cálculo da Largura "Gordinha" da Vela
    const chartWidth = width - rightMargin;
    const slotWidth = chartWidth / visibleCandles.length;
    // Largura da vela: preenche ~75% do slot (dá o visual robusto "gordinho" do Order Flow)
    const candleWidth = Math.max(14, Math.min(42, slotWidth * 0.74));

    const getX = (i: number) => i * slotWidth + slotWidth / 2;
    const getY = (price: number) =>
      mainHeight - ((price - minPrice) / priceRange) * (mainHeight - 40) - 20;

    // 6.5. Desenho das Verdadeiras Zonas de Oferta e Demanda (True Supply & Demand Levels + POC)
    if (isSupplyDemandActive && supplyDemandAnalysis) {
      const chartRight = width - rightMargin;

      // Desenha Zonas de Demanda (Suporte Institucional - Esmeralda)
      supplyDemandAnalysis.activeDemandZones.forEach((zone) => {
        const topY = getY(zone.topPrice);
        const bottomY = getY(zone.bottomPrice);
        const pocY = getY(zone.pocPrice);
        const h = Math.max(6, bottomY - topY);

        if (bottomY < 0 || topY > mainHeight) return;

        ctx.save();
        // Gradiente translúcido de Demanda
        const grad = ctx.createLinearGradient(0, topY, 0, bottomY);
        grad.addColorStop(0, 'rgba(16, 185, 129, 0.22)');
        grad.addColorStop(1, 'rgba(6, 78, 59, 0.35)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, topY, chartRight, h);

        // Bordas neon da zona de demanda
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.65)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, topY);
        ctx.lineTo(chartRight, topY);
        ctx.moveTo(0, bottomY);
        ctx.lineTo(chartRight, bottomY);
        ctx.stroke();

        // Linha do Point of Control (POC - Ponto de Liquidez Máxima)
        ctx.strokeStyle = '#34d399';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(52, 211, 153, 0.6)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(0, pocY);
        ctx.lineTo(chartRight, pocY);
        ctx.stroke();

        // Tag visual da zona com POC
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(2, 44, 34, 0.92)';
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1;
        const tagBoxY = Math.max(10, Math.min(mainHeight - 20, pocY - 8));
        ctx.roundRect(8, tagBoxY, 172, 17, 3);
        ctx.fill();
        ctx.stroke();

        ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
        ctx.fillStyle = '#6ee7b7';
        ctx.textAlign = 'left';
        ctx.fillText(`DEMAND ZONE · POC: ${zone.pocPrice.toFixed(precision)}`, 13, tagBoxY + 11.5);
        ctx.restore();
      });

      // Desenha Zonas de Oferta (Resistência Institucional - Vermelho Rubi)
      supplyDemandAnalysis.activeSupplyZones.forEach((zone) => {
        const topY = getY(zone.topPrice);
        const bottomY = getY(zone.bottomPrice);
        const pocY = getY(zone.pocPrice);
        const h = Math.max(6, bottomY - topY);

        if (bottomY < 0 || topY > mainHeight) return;

        ctx.save();
        // Gradiente translúcido de Oferta
        const grad = ctx.createLinearGradient(0, topY, 0, bottomY);
        grad.addColorStop(0, 'rgba(127, 29, 29, 0.35)');
        grad.addColorStop(1, 'rgba(239, 68, 68, 0.22)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, topY, chartRight, h);

        // Bordas neon da zona de oferta
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, topY);
        ctx.lineTo(chartRight, topY);
        ctx.moveTo(0, bottomY);
        ctx.lineTo(chartRight, bottomY);
        ctx.stroke();

        // Linha do Point of Control (POC - Ponto de Liquidez Máxima)
        ctx.strokeStyle = '#f87171';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(248, 113, 113, 0.6)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(0, pocY);
        ctx.lineTo(chartRight, pocY);
        ctx.stroke();

        // Tag visual da zona com POC
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(69, 10, 10, 0.92)';
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1;
        const tagBoxY = Math.max(10, Math.min(mainHeight - 20, pocY - 8));
        ctx.roundRect(8, tagBoxY, 172, 17, 3);
        ctx.fill();
        ctx.stroke();

        ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
        ctx.fillStyle = '#fca5a5';
        ctx.textAlign = 'left';
        ctx.fillText(`SUPPLY ZONE · POC: ${zone.pocPrice.toFixed(precision)}`, 13, tagBoxY + 11.5);
        ctx.restore();
      });
    }

    // 7. Desenho da Linha SuperTrend (ATR 10, Multiplicador 2.0)
    if (visibleSt.length > 1) {
      for (let i = 0; i < visibleSt.length - 1; i++) {
        const st1 = visibleSt[i];
        const st2 = visibleSt[i + 1];
        if (!st1 || !st2 || st1.value <= 0 || st2.value <= 0) continue;

        const x1 = getX(i);
        const y1 = getY(st1.value);
        const x2 = getX(i + 1);
        const y2 = getY(st2.value);

        const isBullish = st2.direction === 'BULLISH';
        const color = isBullish ? '#10b981' : '#ef4444';

        // Sombra de brilho da linha
        ctx.save();
        ctx.shadowColor = isBullish ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();

        // Ponto de transição do SuperTrend (quando vira a cor)
        if (st1.direction !== st2.direction) {
          ctx.save();
          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(x2, y2, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // 8. Desenho das Velas Candlestick Estilo Order Flow ("Gordinhas" com bordas e cantos arredondados)
    visibleCandles.forEach((c, i) => {
      const x = getX(i);
      const isGreen = c.close >= c.open;
      const openY = getY(c.open);
      const closeY = getY(c.close);
      const highY = getY(c.high);
      const lowY = getY(c.low);

      const topY = Math.min(openY, closeY);
      const bodyH = Math.max(3, Math.abs(closeY - openY));

      const isLast = i === visibleCandles.length - 1;

      // Cores vibrantes neon
      const wickColor = isGreen ? '#34d399' : '#f87171';
      const bodyFill = isGreen
        ? 'rgba(16, 185, 129, 0.88)' // Verde esmeralda rico
        : 'rgba(239, 68, 68, 0.88)'; // Vermelho rubi rico
      const strokeColor = isGreen ? '#10b981' : '#ef4444';

      // Pavio (Wick)
      ctx.strokeStyle = wickColor;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();

      // Corpo da Vela Gordinha com Cantos Arredondados
      ctx.save();
      if (isLast) {
        // Efeito de pulso suave na vela aberta
        ctx.shadowColor = isGreen ? 'rgba(52, 211, 153, 0.6)' : 'rgba(248, 113, 113, 0.6)';
        ctx.shadowBlur = 12;
      }

      ctx.fillStyle = bodyFill;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.5;

      const radius = Math.min(5, candleWidth / 4, bodyH / 2);
      ctx.beginPath();
      const left = x - candleWidth / 2;
      ctx.roundRect(left, topY, candleWidth, bodyH, [radius, radius, radius, radius]);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Reflexo sutil de volume/luz no corpo da vela
      if (bodyH > 8) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(left + 2, topY + 2, Math.max(2, candleWidth * 0.25), bodyH - 4);
      }

      // 9. Marcação de Sinais da Estratégia (Setas CALL / PUT no Gráfico)
      const st = visibleSt[i];
      const rsi = visibleRsi[i];
      const prevSt = visibleSt[i - 1];

      // Gatilho de sinal:
      // CALL: SuperTrend BULLISH, RSI > 50 e RSI < 70, e preço fechou a favor
      // PUT: SuperTrend BEARISH, RSI < 50 e RSI > 30, e preço fechou a favor
      const isCallSignal =
        st &&
        st.direction === 'BULLISH' &&
        c.close >= st.value &&
        rsi !== undefined &&
        rsi > 50 &&
        rsi < 70 &&
        (!prevSt || prevSt.direction === 'BEARISH' || (visibleRsi[i - 1] ?? 0) <= 50);

      const isPutSignal =
        st &&
        st.direction === 'BEARISH' &&
        c.close <= st.value &&
        rsi !== undefined &&
        rsi < 50 &&
        rsi > 30 &&
        (!prevSt || prevSt.direction === 'BULLISH' || (visibleRsi[i - 1] ?? 0) >= 50);

      if (isCallSignal) {
        // Seta e Badge CALL abaixo da vela
        const tagY = lowY + 24;
        ctx.save();
        ctx.fillStyle = '#10b981';
        ctx.shadowColor = '#10b981';
        ctx.shadowBlur = 10;

        // Triângulo apontando para cima
        ctx.beginPath();
        ctx.moveTo(x, lowY + 8);
        ctx.lineTo(x - 6, lowY + 16);
        ctx.lineTo(x + 6, lowY + 16);
        ctx.closePath();
        ctx.fill();

        // Badge CALL
        ctx.fillStyle = 'rgba(6, 78, 59, 0.9)';
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1;
        ctx.roundRect(x - 22, tagY - 6, 44, 16, 4);
        ctx.fill();
        ctx.stroke();

        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.fillStyle = '#6ee7b7';
        ctx.textAlign = 'center';
        ctx.fillText('CALL', x, tagY + 5);
        ctx.restore();
      } else if (isPutSignal) {
        // Seta e Badge PUT acima da vela
        const tagY = highY - 24;
        ctx.save();
        ctx.fillStyle = '#ef4444';
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 10;

        // Triângulo apontando para baixo
        ctx.beginPath();
        ctx.moveTo(x, highY - 8);
        ctx.lineTo(x - 6, highY - 16);
        ctx.lineTo(x + 6, highY - 16);
        ctx.closePath();
        ctx.fill();

        // Badge PUT
        ctx.fillStyle = 'rgba(127, 29, 29, 0.9)';
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1;
        ctx.roundRect(x - 20, tagY - 6, 40, 16, 4);
        ctx.fill();
        ctx.stroke();

        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.fillStyle = '#fca5a5';
        ctx.textAlign = 'center';
        ctx.fillText('PUT', x, tagY + 5);
        ctx.restore();
      }
    });

    // 10. Linha e Etiqueta do Preço Atual
    const lastCandle = visibleCandles[visibleCandles.length - 1];
    if (lastCandle) {
      const currentY = getY(lastCandle.close);
      const isGreen = lastCandle.close >= lastCandle.open;
      const pColor = isGreen ? '#10b981' : '#ef4444';

      // Linha tracejada até a régua
      ctx.save();
      ctx.strokeStyle = pColor;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, currentY);
      ctx.lineTo(width - rightMargin, currentY);
      ctx.stroke();

      // Pill na Régua
      ctx.setLineDash([]);
      ctx.fillStyle = pColor;
      ctx.shadowColor = pColor;
      ctx.shadowBlur = 8;
      ctx.roundRect(width - rightMargin + 2, currentY - 10, rightMargin - 6, 20, 4);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(lastCandle.close.toFixed(precision), width - rightMargin + (rightMargin - 6) / 2 + 2, currentY + 3.5);
      ctx.restore();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 11. SUB-GRÁFICO DO OSCILADOR RSI (Período 9)
    // ──────────────────────────────────────────────────────────────────────────
    const rsiTop = mainHeight + 10;
    const rsiBottom = height - 16;
    const rsiPlotHeight = rsiBottom - rsiTop;

    // Fundo do RSI
    ctx.fillStyle = '#03060c';
    ctx.fillRect(0, rsiTop, width, rsiPlotHeight + 16);

    // Divisor entre os gráficos
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, rsiTop);
    ctx.lineTo(width, rsiTop);
    ctx.stroke();

    // Função de mapeamento do valor RSI (0 a 100) para Y
    const getRsiY = (val: number) => rsiBottom - (val / 100) * rsiPlotHeight;

    // Níveis de Referência do RSI
    // Linha 70 (Sobrecompra - Vermelho)
    const y70 = getRsiY(70);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, y70);
    ctx.lineTo(width - rightMargin, y70);
    ctx.stroke();

    // Linha 50 (Divisor Central de Momentum - Dourado / Ciano)
    const y50 = getRsiY(50);
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y50);
    ctx.lineTo(width - rightMargin, y50);
    ctx.stroke();

    // Linha 30 (Sobrevenda - Verde)
    const y30 = getRsiY(30);
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, y30);
    ctx.lineTo(width - rightMargin, y30);
    ctx.stroke();
    ctx.setLineDash([]);

    // Rótulos dos níveis do RSI na régua
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ef4444';
    ctx.fillText('70 OB', width - rightMargin + 8, y70 + 3);
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('50 MID', width - rightMargin + 8, y50 + 3);
    ctx.fillStyle = '#10b981';
    ctx.fillText('30 OS', width - rightMargin + 8, y30 + 3);

    // Faixa entre 30 e 70 com preenchimento muito sutil
    ctx.fillStyle = 'rgba(56, 189, 248, 0.025)';
    ctx.fillRect(0, y70, width - rightMargin, y30 - y70);

    // Desenho da Curva do RSI(9)
    if (visibleRsi.length > 1) {
      ctx.save();
      ctx.beginPath();
      let firstX = 0;
      let firstY = 0;

      visibleRsi.forEach((rsi, i) => {
        const x = getX(i);
        const y = getRsiY(rsi);
        if (i === 0) {
          firstX = x;
          firstY = y;
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      // Linha brilhante do RSI
      ctx.strokeStyle = '#38bdf8'; // Ciano neon
      ctx.lineWidth = 2.2;
      ctx.shadowColor = 'rgba(56, 189, 248, 0.6)';
      ctx.shadowBlur = 6;
      ctx.stroke();

      // Ponto atual do RSI na última vela
      const lastRsiVal = visibleRsi[visibleRsi.length - 1] ?? 50;
      const lastX = getX(visibleRsi.length - 1);
      const lastY = getRsiY(lastRsiVal);

      ctx.fillStyle = lastRsiVal > 50 ? '#10b981' : '#ef4444';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // Pill com valor atual do RSI
      ctx.fillStyle = '#38bdf8';
      ctx.roundRect(width - rightMargin + 4, lastY - 9, rightMargin - 8, 18, 4);
      ctx.fill();

      ctx.fillStyle = '#020617';
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(lastRsiVal.toFixed(1), width - rightMargin + (rightMargin - 8) / 2 + 4, lastY + 3);
      ctx.restore();
    }

    // Título do Subgráfico RSI
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'left';
    ctx.fillText('RSI (9) OSCILLATOR · LINHA 50 GATILHO', 12, rsiTop + 14);

    // 12. Crosshair ao passar o mouse
    if (mousePos && mousePos.x < width - rightMargin) {
      const hoveredIdx = Math.floor(mousePos.x / slotWidth);
      if (hoveredIdx >= 0 && hoveredIdx < visibleCandles.length) {
        const hc = visibleCandles[hoveredIdx];
        const hx = getX(hoveredIdx);
        const hy = mousePos.y;
        const hSt = visibleSt[hoveredIdx];
        const hRsi = visibleRsi[hoveredIdx];

        ctx.save();
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);

        // Linha vertical
        ctx.beginPath();
        ctx.moveTo(hx, 0);
        ctx.lineTo(hx, height);
        ctx.stroke();

        // Linha horizontal
        ctx.beginPath();
        ctx.moveTo(0, hy);
        ctx.lineTo(width - rightMargin, hy);
        ctx.stroke();

        // Tooltip elegante no topo
        const dateStr = new Date(hc.time * 1000).toLocaleTimeString('pt-BR');
        const infoText = `${dateStr}  |  A: ${hc.open.toFixed(precision)}  M: ${hc.high.toFixed(precision)}  B: ${hc.low.toFixed(precision)}  F: ${hc.close.toFixed(precision)}  |  ST: ${hSt ? hSt.value.toFixed(precision) : '-'} (${hSt?.direction})  |  RSI(9): ${hRsi?.toFixed(1) ?? '-'}`;

        ctx.fillStyle = 'rgba(2, 6, 23, 0.9)';
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.roundRect(10, 8, Math.min(width - rightMargin - 20, 560), 22, 5);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#e2e8f0';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(infoText, 18, 23);
        ctx.restore();
      }
    }
  }, [candles, superTrendPoints, rsiValues, visibleCount, panOffset, mousePos, precision]);

  // Executa o desenho com ResizeObserver
  useEffect(() => {
    redraw();
    const handleResize = () => redraw();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [redraw]);

  // Controle de Zoom com o Scroll do mouse
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      // Zoom in (menos velas visíveis = velas ainda mais gordinhas)
      setVisibleCount((prev) => Math.max(16, prev - 2));
    } else {
      // Zoom out (mais velas)
      setVisibleCount((prev) => Math.min(candles.length || 60, prev + 2));
    }
  };

  // Arrastar gráfico (Pan)
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStartX(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x, y });

    if (isDragging) {
      const deltaX = e.clientX - dragStartX;
      if (Math.abs(deltaX) > 10) {
        const candlesMoved = Math.round(deltaX / 15);
        setPanOffset((prev) => Math.max(0, prev + candlesMoved));
        setDragStartX(e.clientX);
      }
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    setMousePos(null);
  };

  const handleResetZoom = () => {
    setVisibleCount(32);
    setPanOffset(0);
  };

  const isPositive = priceChange >= 0;
  const lastSt = superTrendPoints[superTrendPoints.length - 1];
  const lastRsi = rsiValues[rsiValues.length - 1] ?? 50;

  return (
    <div className="w-full bg-[#030712] rounded-2xl border border-emerald-500/25 shadow-2xl overflow-hidden">
      {/* Header do Gráfico */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-[#050c18] border-b border-emerald-500/20">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <h3 className="font-mono font-black text-sm text-white tracking-wide">
              {symbol}
            </h3>
          </div>

          <span className="text-[10px] font-mono font-black px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 uppercase">
            VELAS GORDINHAS (ESTILO ORDER FLOW)
          </span>

          <div className="hidden lg:flex items-center gap-2 text-[11px] font-mono">
            <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700">
              ST(10, 2.0)
            </span>
            <span className="px-2 py-0.5 rounded bg-sky-950/70 text-sky-300 border border-sky-500/30">
              RSI(9) MID: 50
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 font-mono">
          {/* Status do SuperTrend Atual */}
          {lastSt && (
            <div
              className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold ${
                lastSt.direction === 'BULLISH'
                  ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/70 border-rose-500/40 text-rose-300'
              }`}
            >
              {lastSt.direction === 'BULLISH' ? (
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
              )}
              <span>ST: {lastSt.value.toFixed(precision)}</span>
            </div>
          )}

          {/* Status do RSI Atual */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold ${
              lastRsi > 50
                ? 'bg-sky-950/70 border-sky-500/40 text-sky-300'
                : 'bg-indigo-950/70 border-indigo-500/40 text-indigo-300'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-sky-400" />
            <span>RSI: {lastRsi.toFixed(1)}</span>
            <span className="text-[10px] text-slate-400">
              ({lastRsi > 50 ? '>50 ALTA' : '<50 BAIXA'})
            </span>
          </div>

          {/* Botão de Ativar/Desativar True Supply & Demand (Zonas de Oferta e Demanda + POC) */}
          <button
            type="button"
            id="btn-toggle-true-supply-demand"
            onClick={handleToggleSupplyDemand}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-mono font-bold transition-all cursor-pointer ${
              isSupplyDemandActive
                ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.25)]'
                : 'bg-slate-900/80 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Ativar ou Desativar True Supply & Demand Levels (Zonas de Oferta e Demanda Institucionais + POC)"
          >
            <Layers className="w-3.5 h-3.5 text-amber-400" />
            <span>TRUE S&D: {isSupplyDemandActive ? 'ATIVADO' : 'DESATIVADO'}</span>
            <span
              className={`w-2 h-2 rounded-full ${
                isSupplyDemandActive ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'
              }`}
            />
          </button>

          {/* Cotação Atual */}
          {currentPrice !== null && (
            <div className="flex items-center gap-1.5">
              <span
                className={`text-sm font-black px-2.5 py-1 rounded-lg border ${
                  isPositive
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                    : 'bg-rose-950/80 text-rose-300 border-rose-500/40'
                }`}
              >
                {currentPrice.toFixed(precision)}
              </span>
            </div>
          )}

          {/* Botão de Ajustar Zoom */}
          <button
            type="button"
            onClick={handleResetZoom}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 text-xs transition-colors"
            title="Ajustar zoom para 32 velas gordinhas"
          >
            <Maximize2 className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Reset Zoom</span>
          </button>
        </div>
      </div>

      {/* Canvas Interativo */}
      <div
        ref={containerRef}
        className="relative w-full h-[580px] select-none cursor-crosshair overflow-hidden"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <canvas ref={canvasRef} className="w-full h-full block" />

        {/* Efeito Visual de Scanner de Tela & Ticks quando isAnalyzing está ativo */}
        {isAnalyzing && (
          <div className="absolute inset-0 pointer-events-none z-20 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-150">
            {/* Feixe de Laser Varrendo o Gráfico */}
            <div className="absolute inset-x-0 h-1.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_20px_#10b981] animate-pulse top-1/2 -translate-y-1/2" />
            <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 via-emerald-500/15 to-transparent animate-pulse" />

            {/* HUD Central de Diagnóstico da IA */}
            <div className="relative z-30 bg-[#03070d]/95 border-2 border-emerald-500/80 rounded-2xl px-6 py-4 shadow-2xl shadow-emerald-500/40 flex items-center gap-4 font-mono max-w-md mx-4">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center text-emerald-300 flex-shrink-0">
                <Activity className="w-5 h-5 animate-spin" />
              </div>
              <div>
                <div className="text-xs font-black text-white tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span>{scanStatusText}</span>
                </div>
                <p className="text-[11px] text-emerald-400/90 mt-0.5">
                  SuperTrend (10, 2) + RSI (9, 50) · Consenso 3x IA (Claude, ChatGPT, Gemini)
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer com Guia Visual dos Indicadores */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-[#020509] border-t border-emerald-500/20 text-xs font-mono text-slate-400">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-1 bg-emerald-400 rounded-full" />
            <span>SuperTrend Verde = Suporte / Alta</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-1 bg-rose-500 rounded-full" />
            <span>SuperTrend Vermelho = Resistência / Baixa</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-emerald-500/30 border border-emerald-400 rounded" />
            <span className="text-emerald-300 font-bold">▲ CALL (Compra)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-rose-500/30 border border-rose-400 rounded" />
            <span className="text-rose-300 font-bold">▼ PUT (Venda)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-2 bg-emerald-500/20 border border-emerald-400 border-dashed rounded-sm" />
            <span className="text-emerald-400">Demand (Suporte/POC)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-2 bg-rose-500/20 border border-rose-400 border-dashed rounded-sm" />
            <span className="text-rose-400">Supply (Oferta/POC)</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span>Roda do mouse: Zoom</span>
          <span>•</span>
          <span>Arrastar: Navegar no histórico</span>
        </div>
      </div>
    </div>
  );
}
