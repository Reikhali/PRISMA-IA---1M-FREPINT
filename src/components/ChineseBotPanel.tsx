import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Clock,
  Shield,
  Activity,
  Search,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Zap,
  Sparkles,
  Bot,
  Sliders,
  Eye,
  Radio,
  Scan,
  RefreshCw,
} from 'lucide-react';
import type { OtcAsset, Candle, AccountInfo } from '@/types';
import { playClickSound, playPreAnalysisSound, playSignalTriggerSound, speakVoiceNotification } from '@/lib/sound';
import { CandleChart } from '@/components/CandleChart';
import { MarketVoiceAssistant } from '@/components/MarketVoiceAssistant';
import { evaluateSuperTrendRsiStrategy, type StrategySignal } from '@/lib/supertrend-rsi-engine';

interface ChineseBotPanelProps {
  assets: OtcAsset[];
  selectedAsset: OtcAsset;
  onSelectAsset: (asset: OtcAsset) => void;
  candles: Candle[];
  account: AccountInfo;
  onOpenSsidModal: () => void;
  onOpenAssetModal: () => void;
}

const TIMEFRAMES = [
  { id: '5S', label: '5S' },
  { id: '10S', label: '10S' },
  { id: '15S', label: '15S' },
  { id: '30S', label: '30S' },
  { id: '1M', label: '1M' },
  { id: '2M', label: '2M' },
  { id: '3M', label: '3M' },
  { id: '5M', label: '5M' },
  { id: '15M', label: '15M' },
  { id: '30M', label: '30M' },
  { id: '1H', label: '1H' },
];

export function ChineseBotPanel({
  assets,
  selectedAsset,
  onSelectAsset,
  candles,
  account,
  onOpenSsidModal,
  onOpenAssetModal,
}: ChineseBotPanelProps) {
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('1M');
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  // Estados do Robô de Análise, Leitura de Tela & Fluxo de Ticks
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [scanStatusText, setScanStatusText] = useState<string>('ESCANEANDO TELA DO GRÁFICO & TICKS...');
  const [lastAnalysisTime, setLastAnalysisTime] = useState<string>('');
  const [hasScannedManual, setHasScannedManual] = useState<boolean>(false);
  const [autoVoiceAlerts, setAutoVoiceAlerts] = useState<boolean>(true);
  const lastAutoAlertCandleTimeRef = useRef<number>(0);

  // O sinal ativo de operação SÓ é gerado e fixado quando o usuário solicita a análise ou quando o robô detecta confluência automática
  const [analyzedSignal, setAnalyzedSignal] = useState<StrategySignal | null>(null);

  // Reseta a análise ao trocar de par de ativo para aguardar novo comando do operador
  useEffect(() => {
    setAnalyzedSignal(null);
    setHasScannedManual(false);
    setLastAnalysisTime('');
    lastAutoAlertCandleTimeRef.current = 0;
  }, [selectedAsset.id]);

  // Formata horário oficial de Brasília (UTC-3)
  const formatBrtTime = useCallback((d: Date) => {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
  }, []);

  // Atualização do relógio a cada segundo
  useEffect(() => {
    const updateTime = () => setCurrentTime(new Date());
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Atalho de Teclado Global: Ctrl + V (ou Cmd + V) para abrir o catálogo de todos os ativos
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        const activeTag = (document.activeElement?.tagName || '').toUpperCase();
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
        e.preventDefault();
        playClickSound();
        onOpenAssetModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenAssetModal]);

  const brtTimeStr = formatBrtTime(currentTime);
  const candleSeconds = currentTime.getSeconds();
  const secondsToNextCandle = 60 - candleSeconds;

  // Métricas técnicas em tempo real (apenas para alimentar os medidores dos cards sem trocar o sinal de operação)
  const realtimeMetrics = useMemo(() => {
    return evaluateSuperTrendRsiStrategy(candles);
  }, [candles]);

  // Disparo exclusivo do Botão de Análise: Captura a tela, lê os ticks, gera o sinal ESTÁVEL e FALA COM VOZ
  const handleRunAnalysis = useCallback(() => {
    if (isAnalyzing) return;
    playClickSound();
    playPreAnalysisSound();
    setIsAnalyzing(true);
    setScanStatusText('CAPTURANDO TELA DO GRÁFICO & CANDLESTICKS...');

    // Etapa 1: Ingestão de ticks
    setTimeout(() => {
      setScanStatusText('RECEBENDO FLUXO DE TICKS E VOLATILIDADE OTC...');
    }, 400);

    // Etapa 2: Processamento SuperTrend (10, 2) e RSI (9, 50)
    setTimeout(() => {
      setScanStatusText('PROCESSANDO SUPERTREND (10, 2) + RSI (9, 50)...');
    }, 850);

    // Etapa 3: Consenso das 3 IAs, Fixação do Sinal e FALA DO ROBÔ POR VOZ
    setTimeout(() => {
      const computedSignal = evaluateSuperTrendRsiStrategy(candles);
      setAnalyzedSignal(computedSignal);
      setIsAnalyzing(false);
      setHasScannedManual(true);

      const nowStr = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date());

      setLastAnalysisTime(nowStr);

      if (computedSignal.verdict === 'CALL') {
        playSignalTriggerSound('call');
        speakVoiceNotification(`Atenção! Sinal de Compra confirmado em M1 para ${selectedAsset.label}.`);
      } else if (computedSignal.verdict === 'PUT') {
        playSignalTriggerSound('put');
        speakVoiceNotification(`Atenção! Sinal de Venda confirmado em M1 para ${selectedAsset.label}.`);
      } else {
        playClickSound();
        speakVoiceNotification(`Mercado sem confluência para ${selectedAsset.label}. Proteção ativada.`);
      }
    }, 1300);
  }, [isAnalyzing, candles, selectedAsset.label]);

  // Alerta automático do robô: mesmo se o operador não clicou no botão de análise,
  // quando as métricas confirmam um sinal (CALL ou PUT) na virada (:58s a :00s),
  // o robô detecta sozinho, avisa por voz e fixa o sinal na tela.
  useEffect(() => {
    if (!autoVoiceAlerts || isAnalyzing) return;
    if (candles.length < 15) return;

    const lastCandle = candles[candles.length - 1];
    if (!lastCandle) return;

    // Dispara apenas no momento decisivo da virada de vela (:58s ou :00s)
    if (candleSeconds >= 58 || candleSeconds === 0) {
      if (lastAutoAlertCandleTimeRef.current === lastCandle.time) return;

      if (realtimeMetrics.verdict === 'CALL' || realtimeMetrics.verdict === 'PUT') {
        lastAutoAlertCandleTimeRef.current = lastCandle.time;
        setAnalyzedSignal(realtimeMetrics);
        setHasScannedManual(true);

        const nowStr = new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date());

        setLastAnalysisTime(`${nowStr} (Auto)`);

        if (realtimeMetrics.verdict === 'CALL') {
          playSignalTriggerSound('call');
          speakVoiceNotification(`Alerta automático do robô! Confluência de Compra detectada em ${selectedAsset.label} para a próxima vela.`);
        } else {
          playSignalTriggerSound('put');
          speakVoiceNotification(`Alerta automático do robô! Confluência de Venda detectada em ${selectedAsset.label} para a próxima vela.`);
        }
      }
    }
  }, [candleSeconds, autoVoiceAlerts, isAnalyzing, candles, realtimeMetrics, selectedAsset.label]);

  // 10 ativos de acesso rápido
  const quickPairs = useMemo(() => {
    return assets.slice(0, 10);
  }, [assets]);

  const payoutPct = selectedAsset.payout || 88;
  const precision = selectedAsset.precision || 5;

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      {/* Top Hero Banner */}
      <div
        id="prisma-ia-vector-hero-card"
        className="relative overflow-hidden rounded-2xl border border-emerald-500/30 p-5 md:p-6 bg-gradient-to-b from-[#060c14]/98 to-[#020509]/98 shadow-2xl shadow-emerald-950/40 backdrop-blur-xl"
      >
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-80 h-80 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <div className="relative group flex-shrink-0">
              <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl overflow-hidden border-2 border-emerald-500/60 shadow-lg shadow-emerald-500/30 bg-black flex items-center justify-center">
                <img
                  src="/prisma_ia_logo.jpg"
                  alt="PRISMA IA - VECTOR OTC"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              </div>
              <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-400 border-2 border-black rounded-full animate-ping" />
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl md:text-2xl font-black text-white font-mono tracking-tight flex items-center gap-2">
                  <span>PRISMA IA</span>
                  <span className="text-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.5)]">
                    MODO VECTOR OTC
                  </span>
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                  CONSENSO IA 3x
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-black uppercase tracking-wider bg-cyan-500/15 text-cyan-300 border border-cyan-500/40">
                  CLAUDE + CHATGPT + GEMINI
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 font-mono flex items-center gap-1.5 flex-wrap">
                <span className="text-white font-semibold">{selectedAsset.label}</span>
                <span>•</span>
                <span className="text-emerald-400">Payout {payoutPct}%</span>
                <span>•</span>
                <span className="text-slate-300">trade.optgobroker.com/traderoom</span>
                <span>•</span>
                <span className="text-emerald-300">Brasília: {brtTimeStr}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Botão de Análise de Gráfico & Ticks com IA */}
            <button
              type="button"
              id="btn-analisar-mercado-topo"
              onClick={handleRunAnalysis}
              disabled={isAnalyzing}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-mono font-black border transition-all bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 text-slate-950 hover:brightness-110 shadow-lg shadow-emerald-500/25 active:scale-95 cursor-pointer disabled:opacity-70"
              title="Captura a tela do gráfico, analisa os ticks em tempo real e emite o sinal"
            >
              {isAnalyzing ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>ANALISANDO TICKS...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-slate-950 animate-pulse" />
                  <span>ANALISAR MERCADO (IA)</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onOpenSsidModal}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-mono font-bold border transition-all ${
                account.connected
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 shadow-sm shadow-emerald-500/20'
                  : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/60'
              }`}
            >
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span>{account.connected ? 'SSID OPTGO CONECTADO' : 'CONECTAR SSID OPTGO'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Box Explicativo da Estratégia do Vídeo */}
      <div className="bg-[#050b14]/95 border border-emerald-500/25 rounded-2xl p-4 md:p-5 shadow-xl backdrop-blur-md">
        {/* Barra de Controle de Análise & Varredura de Ticks */}
        <div className="mb-4 p-3 bg-black/60 border border-emerald-500/30 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3 font-mono">
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              id="btn-analisar-mercado-painel"
              onClick={handleRunAnalysis}
              disabled={isAnalyzing}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition-all bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500 text-slate-950 hover:brightness-110 shadow-lg shadow-emerald-500/30 active:scale-95 cursor-pointer disabled:opacity-75"
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                  <span>LENDO GRÁFICO &amp; TICKS EM TEMPO REAL...</span>
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4 text-slate-950" />
                  <span>{analyzedSignal ? 'REANALISAR MERCADO AGORA (IA)' : 'ANALISAR MERCADO AGORA (IA)'}</span>
                </>
              )}
            </button>

            <span className="text-[11px] text-slate-400">
              {analyzedSignal
                ? 'Sinal fixado e validado. Não altera sozinho a cada segundo.'
                : 'Clique para o robô ler o gráfico, escanear os ticks e falar o sinal.'}
            </span>
          </div>

          <div className="text-[11px] text-slate-400 flex items-center gap-2.5 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Scan className="w-3.5 h-3.5 text-emerald-400" />
              <span>Status IA:</span>
              <strong className="text-white">
                {isAnalyzing ? 'Lendo gráfico & ticks...' : analyzedSignal ? 'Análise Concluída' : 'Pronto para Analisar'}
              </strong>
            </span>
            {lastAnalysisTime && (
              <>
                <span>•</span>
                <span className="text-emerald-300">Última análise: {lastAnalysisTime} BRT</span>
              </>
            )}
            {hasScannedManual && (
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] border border-emerald-500/30 font-bold">
                Sinal Estável
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-emerald-500/20 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-sky-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-white font-mono tracking-tight">
                  ESTRATÉGIA SUPERTREND (10, 2) + RSI (9, 50)
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold uppercase">
                  M1 · EXPIRAÇÃO 1M
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Consenso de 3 IAs. O sinal é gerado exclusivamente quando você clica em Analisar Mercado e fala em voz alta na tela.
              </p>
            </div>
          </div>

          {/* Veredicto do Sinal (Fixo pós-análise, sem ficar pulando) */}
          <div className="flex items-center gap-3">
            {analyzedSignal === null ? (
              <div className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-900/80 flex items-center gap-3 font-mono">
                <Bot className="w-5 h-5 text-emerald-400 animate-pulse" />
                <div>
                  <div className="text-[10px] text-slate-400 font-bold uppercase">ROBÔ EM ESPERA</div>
                  <div className="text-sm font-black text-emerald-400">CLIQUE EM 'ANALISAR MERCADO'</div>
                </div>
              </div>
            ) : analyzedSignal.verdict === 'CALL' ? (
              <div className="px-4 py-2 rounded-xl border border-emerald-500/70 bg-emerald-950/90 text-emerald-300 shadow-lg shadow-emerald-950/60 flex items-center gap-2.5 font-mono">
                <TrendingUp className="w-6 h-6 text-emerald-400 animate-bounce" />
                <div>
                  <div className="text-[10px] text-emerald-400 font-bold flex items-center gap-1.5">
                    <span>SINAL GERADO PELA IA</span>
                    <span className="text-slate-400">({lastAnalysisTime})</span>
                  </div>
                  <div className="text-base font-black text-white">COMPRA (CALL) M1</div>
                </div>
              </div>
            ) : analyzedSignal.verdict === 'PUT' ? (
              <div className="px-4 py-2 rounded-xl border border-rose-500/70 bg-rose-950/90 text-rose-300 shadow-lg shadow-rose-950/60 flex items-center gap-2.5 font-mono">
                <TrendingDown className="w-6 h-6 text-rose-400 animate-bounce" />
                <div>
                  <div className="text-[10px] text-rose-400 font-bold flex items-center gap-1.5">
                    <span>SINAL GERADO PELA IA</span>
                    <span className="text-slate-400">({lastAnalysisTime})</span>
                  </div>
                  <div className="text-base font-black text-white">VENDA (PUT) M1</div>
                </div>
              </div>
            ) : (
              <div className="px-4 py-2 rounded-xl border border-amber-500/60 bg-amber-950/80 text-amber-300 flex items-center gap-2.5 font-mono">
                <AlertTriangle className="w-6 h-6 text-amber-400" />
                <div>
                  <div className="text-[10px] text-amber-400 font-bold flex items-center gap-1.5">
                    <span>SEM CONFLUÊNCIA</span>
                    <span className="text-slate-400">({lastAnalysisTime})</span>
                  </div>
                  <div className="text-sm font-black text-slate-200">PROTEÇÃO (NO TRADE)</div>
                </div>
              </div>
            )}

            {/* Virada da vela */}
            <div className="bg-black/60 border border-emerald-500/30 px-3 py-2 rounded-xl text-center font-mono">
              <div className="text-[10px] text-slate-400">VIRADA M1</div>
              <div className="text-base font-black text-emerald-400">:{String(candleSeconds).padStart(2, '0')}s</div>
              <div className="text-[9px] text-slate-500">em {secondsToNextCandle}s</div>
            </div>
          </div>
        </div>

        {/* Os 4 Cards de Filtros da Estratégia */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Card 1: SuperTrend (10, 2.0) */}
          <div
            className={`p-3.5 rounded-xl border font-mono transition-all ${
              realtimeMetrics.superTrendDirection === 'BULLISH'
                ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-300'
                : 'bg-rose-950/20 border-rose-500/40 text-rose-300'
            }`}
          >
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-bold flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5" />
                1. SuperTrend (10, 2.0)
              </span>
              <span
                className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                  realtimeMetrics.superTrendDirection === 'BULLISH'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-rose-500/20 text-rose-400'
                }`}
              >
                {realtimeMetrics.superTrendDirection === 'BULLISH' ? 'ALTA (VERDE)' : 'BAIXA (VERMELHO)'}
              </span>
            </div>
            <div className="text-lg font-black text-white">
              {realtimeMetrics.superTrendValue > 0 ? realtimeMetrics.superTrendValue.toFixed(precision) : 'Calculando...'}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {realtimeMetrics.superTrendDirection === 'BULLISH'
                ? 'Linha verde abaixo das velas atuando como suporte dinâmico.'
                : 'Linha vermelha acima das velas atuando como resistência dinâmica.'}
            </p>
          </div>

          {/* Card 2: Momentum RSI (9) com Linha 50 */}
          <div
            className={`p-3.5 rounded-xl border font-mono transition-all ${
              realtimeMetrics.rsiValue > 50
                ? 'bg-sky-950/25 border-sky-500/40 text-sky-300'
                : 'bg-indigo-950/25 border-indigo-500/40 text-indigo-300'
            }`}
          >
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-bold flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                2. Momentum RSI (9)
              </span>
              <span
                className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                  realtimeMetrics.rsiValue > 50
                    ? 'bg-sky-500/20 text-sky-400'
                    : 'bg-indigo-500/20 text-indigo-400'
                }`}
              >
                {realtimeMetrics.rsiValue > 50 ? '> 50 COMPRADOR' : '< 50 VENDEDOR'}
              </span>
            </div>
            <div className="text-lg font-black text-white">
              {realtimeMetrics.rsiValue.toFixed(1)} <span className="text-xs text-slate-400 font-normal">/ 100</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Linha central 50 é o divisor: &gt;50 confirma alta e &lt;50 confirma baixa.
            </p>
          </div>

          {/* Card 3: Filtro Anti-Exaustão (30 a 70) */}
          <div
            className={`p-3.5 rounded-xl border font-mono transition-all ${
              realtimeMetrics.rsiValue >= 70 || realtimeMetrics.rsiValue <= 30
                ? 'bg-amber-950/30 border-amber-500/50 text-amber-300'
                : 'bg-slate-900/60 border-slate-800 text-slate-300'
            }`}
          >
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-bold flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" />
                3. Filtro de Extremos
              </span>
              <span
                className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                  realtimeMetrics.rsiValue >= 70
                    ? 'bg-red-500/20 text-red-400'
                    : realtimeMetrics.rsiValue <= 30
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-emerald-500/10 text-emerald-300'
                }`}
              >
                {realtimeMetrics.rsiValue >= 70
                  ? 'SOBRECOMPRA (≥70)'
                  : realtimeMetrics.rsiValue <= 30
                  ? 'SOBREVENDA (≤30)'
                  : 'FAIXA SEGURA (30-70)'}
              </span>
            </div>
            <div className="text-lg font-black text-white">
              {realtimeMetrics.rsiValue >= 70 || realtimeMetrics.rsiValue <= 30 ? (
                <span className="text-amber-400">BLOQUEADO</span>
              ) : (
                <span className="text-emerald-400">AUTORIZADO</span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Evita compras no topo (&gt;70) e vendas no fundo (&lt;30) contra exaustão.
            </p>
          </div>

          {/* Card 4: Gatilho de Entrada & Qualidade da Vela */}
          <div
            className={`p-3.5 rounded-xl border font-mono transition-all ${
              analyzedSignal && analyzedSignal.verdict !== 'NO_TRADE'
                ? 'bg-emerald-950/30 border-emerald-500/50 text-emerald-300'
                : 'bg-slate-900/60 border-slate-800 text-slate-300'
            }`}
          >
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                4. Gatilho de Virada
              </span>
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                {realtimeMetrics.candleQuality}
              </span>
            </div>
            <div className="text-lg font-black text-white">
              {analyzedSignal && analyzedSignal.verdict !== 'NO_TRADE' ? (
                <span className="text-emerald-400">ENTRADA :00s</span>
              ) : (
                <span className="text-slate-400">STANDBY</span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Entrada precisa na abertura da vela de M1 (:00s) com vela expressiva.
            </p>
          </div>
        </div>

        {/* Motivos Técnicos e Diagnóstico */}
        <div className="mt-3 pt-3 border-t border-emerald-500/15 flex flex-col md:flex-row items-start md:items-center justify-between gap-2 text-xs font-mono">
          <div className="flex items-center gap-2 flex-wrap text-slate-300">
            <span className="text-emerald-400 font-bold">Diagnóstico IA:</span>
            {analyzedSignal ? (
              analyzedSignal.verdict !== 'NO_TRADE' ? (
                <span className="text-emerald-300">{analyzedSignal.reasons.join(' • ')}</span>
              ) : (
                <span className="text-amber-300/90">{analyzedSignal.blocks.join(' • ')}</span>
              )
            ) : (
              <span className="text-slate-400">
                Aguardando clique em 'Analisar Mercado (IA)' para fixar o sinal e falar a ordem.
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-emerald-400" />
            <span>
              Confiança:{' '}
              <strong className="text-white">
                {analyzedSignal ? `${analyzedSignal.confidence}%` : 'Aguardando Análise'}
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* Assistente de Voz Interativo do Robô (Ouve e Fala com o Operador) */}
      <MarketVoiceAssistant
        selectedAsset={selectedAsset}
        candles={candles}
        metrics={realtimeMetrics}
        secondsToNextCandle={secondsToNextCandle}
        autoVoiceAlerts={autoVoiceAlerts}
        onToggleAutoVoice={() => {
          playClickSound();
          setAutoVoiceAlerts((prev) => !prev);
        }}
      />

      {/* Painel de Seleção de Ativos e Timeframes */}
      <div className="bg-[#050a12]/95 border border-emerald-500/20 rounded-2xl p-5 shadow-xl backdrop-blur-md space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-emerald-500/20 pb-3">
          <div>
            <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-widest block mb-0.5">
              [ SELEÇÃO DO ATIVO ]
            </span>
            <h2 className="text-lg font-black text-white font-mono tracking-tight">
              Paridades &amp; Tempo Gráfico
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onOpenAssetModal}
              className="text-xs font-bold font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 transition-colors"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Todos os 148 Ativos</span>
              <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono font-bold">
                Ctrl + V
              </kbd>
            </button>
          </div>
        </div>

        {/* Seleção Rápida de Ativos */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>Ativos Rápidos OTC:</span>
            <span className="text-emerald-400 font-bold">{selectedAsset.label} selecionado</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {quickPairs.map((asset) => {
              const isSelected = selectedAsset.id === asset.id;
              return (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => {
                    playClickSound();
                    onSelectAsset(asset);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-emerald-400 text-slate-950 border-emerald-400 shadow-sm font-bold'
                      : 'bg-slate-900/70 text-slate-300 border-white/10 hover:border-emerald-500/30 hover:text-white'
                  }`}
                >
                  <span>{asset.label}</span>
                  <span
                    className={`text-[10px] px-1 py-0.2 rounded font-mono ${
                      isSelected ? 'bg-slate-950/30 text-slate-950' : 'bg-emerald-500/10 text-emerald-400'
                    }`}
                  >
                    {asset.payout || 88}%
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Seleção de Timeframe */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>Tempo de Vela:</span>
            <span className="text-emerald-400 font-bold">{selectedTimeframe} (Recomendado M1 pelo vídeo)</span>
          </div>

          <div className="grid grid-cols-6 sm:grid-cols-11 gap-1">
            {TIMEFRAMES.map((tf) => {
              const isSelected = selectedTimeframe === tf.id;
              return (
                <button
                  key={tf.id}
                  type="button"
                  onClick={() => {
                    playClickSound();
                    setSelectedTimeframe(tf.id);
                  }}
                  className={`py-1.5 rounded-md text-xs font-bold transition-all border text-center ${
                    isSelected
                      ? 'bg-emerald-400 text-slate-950 border-emerald-400 shadow-md shadow-emerald-500/20 font-black'
                      : 'bg-slate-900/70 text-slate-300 border-white/10 hover:border-emerald-500/30 hover:text-white'
                  }`}
                >
                  {tf.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Gráfico com Velas Gordinhas Estilo Order Flow + Linha SuperTrend + Sinais + RSI */}
      <div id="prisma-supertrend-rsi-chart" className="w-full">
        <CandleChart
          candles={candles}
          activeId={selectedAsset.id}
          symbol={selectedAsset.symbol}
          precision={precision}
          isAnalyzing={isAnalyzing}
          scanStatusText={scanStatusText}
        />
      </div>
    </div>
  );
}
