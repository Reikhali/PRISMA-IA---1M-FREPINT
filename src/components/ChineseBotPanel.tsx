import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Zap,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Clock,
  Shield,
  Bot,
  Activity,
  Sparkles,
  AlertTriangle,
  Search,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from 'lucide-react';
import type { OtcAsset, Candle, Analysis, AccountInfo } from '@/types';
import { evaluateMarketSignal, type StrategyMode, type UnifiedSignalResult } from '@/lib/analysis';
import { playClickSound, playSignalTriggerSound } from '@/lib/sound';
import { CandleChart } from '@/components/CandleChart';

interface ChineseBotPanelProps {
  assets: OtcAsset[];
  selectedAsset: OtcAsset;
  onSelectAsset: (asset: OtcAsset) => void;
  candles: Candle[];
  analysis: Analysis | null;
  account: AccountInfo;
  isDemo: boolean;
  onToggleAccountType: (demo: boolean) => void;
  onOpenSsidModal: () => void;
  onOpenAssetModal: () => void;
  onExecuteOrder: (direction: 'call' | 'put', amount: number, strategy: string) => Promise<void>;
  executing: boolean;
  robotActive: boolean;
  onToggleRobot: (active: boolean) => void;
  currentSorosLevel: number;
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
  analysis,
  account,
  onOpenSsidModal,
  onOpenAssetModal,
  onExecuteOrder,
  executing,
  robotActive,
  onToggleRobot,
  currentSorosLevel,
}: ChineseBotPanelProps) {
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('1M');
  const [selectedStrategyMode, setSelectedStrategyMode] = useState<StrategyMode>('poc_volume_profile');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [orderAmount, setOrderAmount] = useState<number>(10);
  const [managementMode, setManagementMode] = useState<'fixed' | 'soros' | 'martingale'>('fixed');
  const [showStrategyGuide, setShowStrategyGuide] = useState<boolean>(false);

  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [scanStepText, setScanStepText] = useState<string>('');
  
  // Stored active signal: does NOT change unless deliberately scanned or automated by robot
  const [analyzedSignal, setAnalyzedSignal] = useState<UnifiedSignalResult | null>(null);
  const [signalAnalyzedAt, setSignalAnalyzedAt] = useState<string | null>(null);
  const [signalNextEntryTime, setSignalNextEntryTime] = useState<string | null>(null);
  const [signalEntryTimestamp, setSignalEntryTimestamp] = useState<number | null>(null);
  const [signalExpireTimestamp, setSignalExpireTimestamp] = useState<number | null>(null);
  const [signalLifecycleStatus, setSignalLifecycleStatus] = useState<'IDLE' | 'WAITING_ENTRY' | 'IN_TRADE' | 'FINISHED'>('IDLE');
  const [lastFinishedSignalInfo, setLastFinishedSignalInfo] = useState<{ dir: string; time: string } | null>(null);

  // Auto-Fire on Next Candle birth (:58s / :00s)
  const [autoFireNextCandle, setAutoFireNextCandle] = useState<boolean>(true);
  const [lastExecutedCandleTime, setLastExecutedCandleTime] = useState<string | null>(null);

  const lastAutoAnalysisMinuteRef = useRef<number>(-1);
  const lastAutoOrderMinuteRef = useRef<number>(-1);

  // Synchronized refs to eliminate React closure lag during millisecond triggers
  const analyzedSignalRef = useRef<UnifiedSignalResult | null>(analyzedSignal);
  analyzedSignalRef.current = analyzedSignal;

  const autoFireNextCandleRef = useRef<boolean>(autoFireNextCandle);
  autoFireNextCandleRef.current = autoFireNextCandle;

  const robotActiveRef = useRef<boolean>(robotActive);
  robotActiveRef.current = robotActive;

  const candlesRef = useRef<Candle[]>(candles);
  candlesRef.current = candles;

  const selectedStrategyModeRef = useRef<StrategyMode>(selectedStrategyMode);
  selectedStrategyModeRef.current = selectedStrategyMode;

  const effectiveStakeRef = useRef<number>(orderAmount);

  const onExecuteOrderRef = useRef(onExecuteOrder);
  onExecuteOrderRef.current = onExecuteOrder;

  // Format Brasília Time (UTC-3)
  const formatBrtTime = useCallback((d: Date) => {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
  }, []);

  // Update real-time Brasília clock
  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      setCurrentTime(now);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

  const brtTimeStr = formatBrtTime(currentTime);

  // Compute next candle entry time (in Brasília Timezone)
  const nextCandleDate = new Date(currentTime.getTime() + (60 - currentTime.getSeconds()) * 1000);
  const nextEntryStr = formatBrtTime(nextCandleDate);

  // Calculate dynamic stake amount based on Management Mode
  const effectiveStake = React.useMemo(() => {
    if (managementMode === 'soros') {
      const payout = (selectedAsset.payout || 88) / 100;
      if (currentSorosLevel === 1) return orderAmount;
      if (currentSorosLevel === 2) return Number((orderAmount + orderAmount * payout).toFixed(2));
      if (currentSorosLevel === 3) {
        const lvl2 = orderAmount + orderAmount * payout;
        return Number((lvl2 + lvl2 * payout).toFixed(2));
      }
      const lvl3 = orderAmount * Math.pow(1 + payout, 2);
      return Number((lvl3 + lvl3 * payout).toFixed(2));
    }
    if (managementMode === 'martingale') {
      return Number((orderAmount * 2.2).toFixed(2));
    }
    return orderAmount;
  }, [managementMode, orderAmount, currentSorosLevel, selectedAsset.payout]);

  effectiveStakeRef.current = effectiveStake;

  // Clear signal when asset changes to avoid confusion
  useEffect(() => {
    setAnalyzedSignal(null);
    setSignalLifecycleStatus('IDLE');
    setSignalEntryTimestamp(null);
    setSignalExpireTimestamp(null);
  }, [selectedAsset.id]);

  // Manual Trigger: User clicks "ANALISAR MERCADO AGORA"
  const handleRescan = useCallback(() => {
    playClickSound();
    setIsScanning(true);
    setLastFinishedSignalInfo(null);
    setScanStepText('1/3: Sincronizando com Horário Oficial de Brasília (UTC-3)...');

    setTimeout(() => {
      setScanStepText('2/3: Lendo Velas M1, Rejeição de Pavio e Linha da POC da Corretora...');
    }, 250);

    setTimeout(() => {
      setScanStepText(
        selectedStrategyMode === 'poc_volume_profile'
          ? '3/3: Calculando Blocos de Volume Profile, Nível Amarelo da POC e Reteste...'
          : '3/3: Calculando Clusters de Volume, POC Institucional, Delta e Zonas de Absorção...'
      );
    }, 500);

    setTimeout(() => {
      setIsScanning(false);
      setScanStepText('');

      const now = new Date();
      const currentSeconds = now.getSeconds();
      const secondsToEntry = 60 - currentSeconds;
      const entryTimestamp = now.getTime() + secondsToEntry * 1000;
      const expireTimestamp = entryTimestamp + 60 * 1000; // 1M timeframe candle expiration

      // Evaluate analysis on closed candles for maximum precision
      const evaluation = evaluateMarketSignal(candles, selectedTimeframe, selectedStrategyMode);
      setAnalyzedSignal(evaluation);
      setSignalAnalyzedAt(formatBrtTime(now));

      const nextEntryDate = new Date(entryTimestamp);
      setSignalNextEntryTime(formatBrtTime(nextEntryDate));
      setSignalEntryTimestamp(entryTimestamp);
      setSignalExpireTimestamp(expireTimestamp);

      if (evaluation.verdict !== 'NO_TRADE') {
        setSignalLifecycleStatus('WAITING_ENTRY');
        playSignalTriggerSound(evaluation.verdict === 'CALL' ? 'call' : 'put');
      } else {
        setSignalLifecycleStatus('IDLE');
      }
    }, 750);
  }, [candles, selectedTimeframe, selectedStrategyMode, formatBrtTime]);

  // Reset Signal manually
  const handleClearSignal = useCallback(() => {
    playClickSound();
    setAnalyzedSignal(null);
    setSignalLifecycleStatus('IDLE');
    setSignalEntryTimestamp(null);
    setSignalExpireTimestamp(null);
  }, []);

  // Seconds remaining calculations
  const nowMs = currentTime.getTime();
  const secondsToNextCandle = 60 - currentTime.getSeconds();
  const secondsToEntryCandle = signalEntryTimestamp
    ? Math.max(0, Math.ceil((signalEntryTimestamp - nowMs) / 1000))
    : secondsToNextCandle;
  const secondsToTradeFinish = signalExpireTimestamp
    ? Math.max(0, Math.ceil((signalExpireTimestamp - nowMs) / 1000))
    : 0;

  // Signal Lifecycle Timer & Auto-Reset when entered candle closes
  useEffect(() => {
    if (!analyzedSignal || analyzedSignal.verdict === 'NO_TRADE' || !signalEntryTimestamp || !signalExpireTimestamp) {
      return;
    }

    const now = Date.now();

    // 1. If we are before the entry timestamp: WAITING_ENTRY
    if (now < signalEntryTimestamp) {
      if (signalLifecycleStatus !== 'WAITING_ENTRY') {
        setSignalLifecycleStatus('WAITING_ENTRY');
      }
    }
    // 2. If we are within the trade candle (between entry and expiration): IN_TRADE
    else if (now >= signalEntryTimestamp && now < signalExpireTimestamp) {
      if (signalLifecycleStatus !== 'IN_TRADE') {
        setSignalLifecycleStatus('IN_TRADE');
      }
    }
    // 3. When the entered candle FINISHES (now >= signalExpireTimestamp): RESET SIGNAL!
    else if (now >= signalExpireTimestamp) {
      setLastFinishedSignalInfo({
        dir: analyzedSignal.verdictWord,
        time: formatBrtTime(new Date(signalExpireTimestamp)),
      });
      setSignalLifecycleStatus('FINISHED');
      setAnalyzedSignal(null);
      setSignalEntryTimestamp(null);
      setSignalExpireTimestamp(null);
    }
  }, [currentTime, analyzedSignal, signalEntryTimestamp, signalExpireTimestamp, signalLifecycleStatus, formatBrtTime]);

  // High-Precision Broker Execution Engine (matching IQ Option / Bullex API WebSocket timing)
  useEffect(() => {
    const autoInterval = setInterval(() => {
      const now = new Date();
      const sec = now.getSeconds();
      const minute = now.getMinutes() + now.getHours() * 60;

      // 1. Robot Auto-Scan at :58s of current candle
      if (robotActiveRef.current && sec >= 58 && lastAutoAnalysisMinuteRef.current !== minute) {
        lastAutoAnalysisMinuteRef.current = minute;
        const evaluation = evaluateMarketSignal(candlesRef.current, selectedTimeframe, selectedStrategyModeRef.current);
        setAnalyzedSignal(evaluation);
        setSignalAnalyzedAt(formatBrtTime(now));

        const secondsToEntry = 60 - sec;
        const entryTimestamp = now.getTime() + (secondsToEntry <= 0 ? 60 : secondsToEntry) * 1000;
        const expireTimestamp = entryTimestamp + 60 * 1000;

        const nextEntry = new Date(entryTimestamp);
        setSignalNextEntryTime(formatBrtTime(nextEntry));
        setSignalEntryTimestamp(entryTimestamp);
        setSignalExpireTimestamp(expireTimestamp);

        if (evaluation.verdict !== 'NO_TRADE') {
          setSignalLifecycleStatus('WAITING_ENTRY');
        }
      }

      // 2. Automated Trade Execution at Candle Birth (:59s - :00s)
      // Fires if robot is active OR if manual signal has autoFireNextCandle enabled
      const shouldAutoExecute =
        robotActiveRef.current ||
        (autoFireNextCandleRef.current && analyzedSignalRef.current && analyzedSignalRef.current.verdict !== 'NO_TRADE');

      if (shouldAutoExecute && sec === 0 && lastAutoOrderMinuteRef.current !== minute) {
        lastAutoOrderMinuteRef.current = minute;
        const currentSig = analyzedSignalRef.current;

        if (currentSig && currentSig.verdict !== 'NO_TRADE') {
          const dir = currentSig.verdict === 'CALL' ? 'call' : 'put';
          playSignalTriggerSound(dir);

          const stratLabel =
            selectedStrategyModeRef.current === 'poc_volume_profile'
              ? `POC_VOLUME_PROFILE (${currentSig.verdictWord})`
              : `ORDER_FLOW_FOOTPRINT (${currentSig.verdictWord})`;

          onExecuteOrderRef.current(dir, effectiveStakeRef.current, stratLabel);
          setLastExecutedCandleTime(formatBrtTime(now));
          setSignalLifecycleStatus('IN_TRADE');
        }
      }
    }, 200);

    return () => clearInterval(autoInterval);
  }, [formatBrtTime]);

  // Filter top quick pairs (all assets are OTC)
  const quickPairs = React.useMemo(() => {
    return assets.slice(0, 10);
  }, [assets]);

  const handleManualTrade = async () => {
    if (!analyzedSignal || analyzedSignal.verdict === 'NO_TRADE') return;
    const dir = analyzedSignal.verdict === 'CALL' ? 'call' : 'put';
    playSignalTriggerSound(dir);
    const stratLabel =
      selectedStrategyMode === 'poc_volume_profile'
        ? `POC & VOLUME PROFILE (${analyzedSignal.verdictWord})`
        : `ORDER FLOW FOOTPRINT (${analyzedSignal.verdictWord})`;
    await onExecuteOrder(dir, effectiveStake, stratLabel);
  };

  const payoutPct = selectedAsset.payout || 88;
  const potentialProfit = (effectiveStake * (payoutPct / 100)).toFixed(2);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      {/* Hero Banner */}
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
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  CONSENSO 3 VOTOS
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                  OPTGO BROKER
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 font-mono flex items-center gap-1.5 flex-wrap">
                <span className="text-emerald-400">Tendência EMA (9, 21)</span>
                <span>•</span>
                <span className="text-emerald-300">Momento RSI (14)</span>
                <span>•</span>
                <span className="text-emerald-400">Filtro ATR</span>
                <span>•</span>
                <span className="text-slate-300">trade.optgobroker.com/traderoom</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowStrategyGuide(!showStrategyGuide)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 text-xs font-mono font-bold hover:bg-emerald-900/60 transition-colors"
            >
              <HelpCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span>{showStrategyGuide ? 'Ocultar Estratégia' : 'Como Funciona os 3 Votos'}</span>
            </button>

            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 border border-emerald-500/30 text-slate-200 text-xs font-mono font-semibold">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>148 ATIVOS OTC</span>
            </div>

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
              <span>{account.connected ? 'SSID OPTGO ATIVO' : 'CONECTAR SSID OPTGO'}</span>
            </button>
          </div>
        </div>

        {/* Strategy Guide Drawer */}
        {showStrategyGuide && (
          <div className="mt-4 pt-4 border-t border-emerald-500/20 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
            <div className="bg-[#020509]/90 border border-amber-500/30 rounded-xl p-3 space-y-1">
              <span className="text-amber-400 font-bold block uppercase">🟡 1. POC &amp; Volume Profile (Linha Amarela &amp; Reteste)</span>
              <p className="text-slate-300">
                Calcula o nível de maior volume negociado da sessão (Linha Amarela da POC). Gera sinal de CALL no reteste comprador ou PUT na rejeição de topo com confirmação de blocos de perfil.
              </p>
            </div>

            <div className="bg-[#020509]/90 border border-emerald-500/30 rounded-xl p-3 space-y-1">
              <span className="text-emerald-400 font-bold block uppercase">📊 2. Footprint Order Flow (Clusters &amp; Delta)</span>
              <p className="text-slate-300">
                Mapeia os clusters de volume bid/ask em cada nível de preço da vela e calcula a absorção nas zonas institucionais (caixas brancas) para antecipar a reversão de fluxo.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Main 2-Column Application Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Setup & Analysis Parameters */}
        <div id="chinese-bot-controls" className="lg:col-span-6 space-y-4 bg-[#050a12]/95 border border-emerald-500/20 rounded-2xl p-5 shadow-xl backdrop-blur-md">
          <div className="border-b border-emerald-500/20 pb-3 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-widest block mb-0.5">
                [ PAINEL OPERACIONAL ]
              </span>
              <h2 className="text-lg font-black text-white font-mono tracking-tight">Parâmetros do Sinal Vector</h2>
            </div>
            <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
              M1 OTC ENGINE
            </span>
          </div>

          {/* Step 1: Broker Integration Status */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-emerald-400 text-black font-mono font-black text-xs flex items-center justify-center">
                  1
                </span>
                <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">Corretora de Operação</span>
              </div>
              <span className="text-[10px] font-mono font-bold uppercase bg-emerald-500/15 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">
                {account.connected ? 'Optgo Broker Sincronizada' : 'Modo Simulado / SSID Disponível'}
              </span>
            </div>

            {/* Official Broker Card */}
            <div className="bg-[#020509]/90 border border-emerald-500/20 rounded-xl p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/40 flex items-center justify-center font-mono font-black text-sm shadow-inner">
                  OG
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-white font-mono">OPTGO Broker (trade.optgobroker.com)</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  </div>
                  <p className="text-[11px] text-slate-400 font-mono">
                    ID: {account.id} · {account.name} · Payouts até 98%
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onOpenSsidModal}
                className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-mono font-bold border border-emerald-500/30 transition-colors"
              >
                {account.connected ? 'Gerenciar SSID' : 'Conectar SSID'}
              </button>
            </div>
          </div>

          {/* Step 2: Market Type */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-emerald-400 text-slate-950 font-black text-xs flex items-center justify-center">
                  2
                </span>
                <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">Tipo de Mercado</span>
              </div>
              <span className="text-[10px] font-mono uppercase bg-emerald-500/20 px-2 py-0.5 rounded text-emerald-300 border border-emerald-500/40 font-bold">
                VECTOR OTC 24/7 ATIVO
              </span>
            </div>

            <div className="bg-[#020509]/90 border border-emerald-500/20 rounded-xl p-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                <div>
                  <span className="text-xs font-bold text-white font-mono block">OTC (24h / Finais de Semana / Dias Úteis)</span>
                  <span className="text-[11px] text-slate-400 font-mono">Todos os ativos operados pelo robô são OTC da OPTGO Broker</span>
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold uppercase bg-emerald-950/80 text-emerald-400 px-2.5 py-1 rounded border border-emerald-500/30 whitespace-nowrap">
                148 ATIVOS
              </span>
            </div>
          </div>

          {/* Step 3: Asset / Currency Pair */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-emerald-400 text-slate-950 font-black text-xs flex items-center justify-center">
                  3
                </span>
                <span className="text-xs font-bold text-white uppercase tracking-wider">Ativo da Corretora</span>
              </div>
              <button
                type="button"
                onClick={onOpenAssetModal}
                className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
              >
                <Search className="w-3 h-3" />
                <span>Ver todos 148 Ativos ({payoutPct}%)</span>
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
              {quickPairs.map((asset) => {
                const isSelected = selectedAsset.id === asset.id;
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => {
                      playClickSound();
                      onSelectAsset(asset);
                      setAnalyzedSignal(null);
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

          {/* Step 4: Strategy Mode Selection (POC + FOOTPRINT) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-emerald-400 text-slate-950 font-black text-xs flex items-center justify-center">
                  4
                </span>
                <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">Estratégia de Sinal</span>
              </div>
              <span className="text-[10px] font-mono uppercase bg-emerald-500/20 px-2 py-0.5 rounded text-emerald-300 border border-emerald-500/40 font-bold">
                {selectedStrategyMode === 'poc_volume_profile'
                  ? '🟡 POC & VOLUME PROFILE'
                  : '📊 ORDER FLOW CLUSTERS'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Option 1: POC & Volume Profile */}
              <button
                type="button"
                onClick={() => {
                  playClickSound();
                  setSelectedStrategyMode('poc_volume_profile');
                  setAnalyzedSignal(null);
                }}
                className={`p-3.5 rounded-xl text-left border transition-all ${
                  selectedStrategyMode === 'poc_volume_profile'
                    ? 'bg-amber-500/20 border-amber-400 shadow-md shadow-amber-500/20 ring-1 ring-amber-400/50'
                    : 'bg-[#020509]/80 border-white/10 hover:border-amber-500/30'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold font-mono text-amber-400 flex items-center gap-1.5">
                    🟡 POC &amp; PERFIL
                  </span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-400 text-black font-black">M1 FOTO</span>
                </div>
                <p className="text-[11px] text-slate-300 font-mono leading-tight">
                  Reteste na Linha Amarela da POC + Blocos de Volume Profile
                </p>
              </button>

              {/* Option 2: Footprint Order Flow */}
              <button
                type="button"
                onClick={() => {
                  playClickSound();
                  setSelectedStrategyMode('footprint_orderflow');
                  setAnalyzedSignal(null);
                }}
                className={`p-3.5 rounded-xl text-left border transition-all ${
                  selectedStrategyMode === 'footprint_orderflow'
                    ? 'bg-emerald-500/20 border-emerald-400 shadow-md shadow-emerald-500/20 ring-1 ring-emerald-400/50'
                    : 'bg-[#020509]/80 border-white/10 hover:border-emerald-500/30'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold font-mono text-emerald-400 flex items-center gap-1.5">
                    📊 ORDER FLOW
                  </span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-400 text-black font-black">CLUSTERS</span>
                </div>
                <p className="text-[11px] text-slate-300 font-mono leading-tight">
                  Clusters de Volume M1 + Delta e Zonas de Absorção
                </p>
              </button>
            </div>
          </div>

          {/* Step 5: Timeframe */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-emerald-400 text-slate-950 font-black text-xs flex items-center justify-center">
                  5
                </span>
                <span className="text-xs font-bold text-white uppercase tracking-wider">Tempo de Vela</span>
              </div>
              <span className="text-[10px] font-mono bg-slate-900/80 px-2 py-0.5 rounded text-emerald-400 border border-white/5">
                {selectedTimeframe}
              </span>
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
                      setAnalyzedSignal(null);
                    }}
                    className={`py-1.5 rounded-md text-xs font-bold transition-all border text-center ${
                      isSelected
                        ? 'bg-emerald-400 text-slate-950 border-emerald-400 shadow-md shadow-emerald-500/20'
                        : 'bg-slate-900/70 text-slate-300 border-white/10 hover:border-emerald-500/30 hover:text-white'
                    }`}
                  >
                    {tf.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 6: Big Analysis Action Trigger */}
          <div className="pt-2">
            <button
              type="button"
              id="analyze-market-now-btn"
              onClick={handleRescan}
              disabled={isScanning}
              className="w-full group relative overflow-hidden py-4 px-4 rounded-xl bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-500 hover:from-emerald-400 hover:to-emerald-300 text-black font-mono font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/30 active:scale-[0.98] transition-all cursor-pointer"
            >
              <Zap className={`w-5 h-5 fill-black ${isScanning ? 'animate-bounce' : 'group-hover:scale-110'} transition-transform`} />
              <span>
                {isScanning
                  ? 'ANALISANDO OS SINAIS DO MERCADO...'
                  : `ANALISAR MERCADO AGORA (${selectedAsset.label})`}
              </span>
            </button>
            <p className="text-[11px] text-center text-slate-400 mt-1.5 font-mono">
              Horário Oficial de Brasília: <strong className="text-emerald-400">{brtTimeStr}</strong> · Entrada Próxima Vela: <strong className="text-white">{nextEntryStr}</strong>
            </p>
          </div>
        </div>

        {/* Right Column: AI Verdict Signal Card & Broker Execution */}
        <div id="prisma-vector-verdict-card" className="lg:col-span-6 space-y-4">
          <div className="bg-[#050a12]/95 border border-emerald-500/30 rounded-2xl p-5 shadow-2xl relative overflow-hidden backdrop-blur-xl">
            {/* Top Bar */}
            <div className="flex items-center justify-between gap-4 pb-3 border-b border-emerald-500/20">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-black text-white font-mono">{selectedAsset.label}</span>
                  <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    {selectedTimeframe}
                  </span>
                </div>
                <span className="text-xs text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
                  <span>Payout {payoutPct}%</span>
                  <span>•</span>
                  <span>OPTGO Broker</span>
                  <span>•</span>
                  <span className="text-emerald-400 font-bold">{brtTimeStr} BRT</span>
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRescan}
                  disabled={isScanning}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#020509] hover:bg-emerald-950/40 text-emerald-300 border border-emerald-500/30 text-xs font-mono font-bold transition-all active:scale-95"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-emerald-400' : ''}`} />
                  <span>Analisar Novamente</span>
                </button>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-[10px] font-mono font-black uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>3 VOTOS CONECTADOS</span>
                </div>
              </div>
            </div>

            {/* Scanning State Animation */}
            {isScanning ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                <div className="relative w-20 h-20 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border-4 border-emerald-900/40 border-t-emerald-400 animate-spin" />
                  <div className="absolute inset-2 rounded-full border-2 border-emerald-500/20 border-b-emerald-300 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                    <Zap className="w-5 h-5 fill-emerald-400" />
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-black text-white font-mono">{scanStepText || 'Processando Consenso dos 3 Votos...'}</h3>
                  <p className="text-xs text-emerald-400 mt-1 font-mono">
                    Horário de Brasília: {brtTimeStr} · Conectado ao Feed OPTGO
                  </p>
                </div>
              </div>
            ) : analyzedSignal ? (
              /* Analyzed Verdict Display (Active only while waiting for entry and during the entered candle) */
              <div className="py-3 space-y-4">
                {/* Signal Timing & Lifecycle Status Bar */}
                <div className={`border rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 font-mono text-xs ${
                  signalLifecycleStatus === 'IN_TRADE'
                    ? 'bg-amber-950/40 border-amber-500/50 shadow-lg shadow-amber-950/30'
                    : 'bg-[#020509]/90 border-emerald-500/30'
                }`}>
                  <div className="flex items-center gap-2">
                    <Clock className={`w-4 h-4 ${signalLifecycleStatus === 'IN_TRADE' ? 'text-amber-400 animate-spin' : 'text-emerald-400 animate-pulse'}`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 font-bold">
                          {signalLifecycleStatus === 'IN_TRADE' ? 'EM OPERAÇÃO NA VELA:' : 'ENTRADA NA PRÓXIMA VELA:'}
                        </span>
                        <strong className="text-white text-sm bg-black/60 px-2 py-0.5 rounded border border-white/10">
                          {signalNextEntryTime || nextEntryStr}
                        </strong>
                      </div>
                      <span className="text-[10px] text-slate-400">
                        {signalLifecycleStatus === 'IN_TRADE'
                          ? `⚡ Vela ativa! O sinal sumirá automaticamente em ${secondsToTradeFinish}s`
                          : `⏳ Prepare sua entrada para a virada de vela em ${secondsToEntryCandle}s`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-black uppercase flex items-center gap-1.5 ${
                      signalLifecycleStatus === 'IN_TRADE'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${signalLifecycleStatus === 'IN_TRADE' ? 'bg-amber-400' : 'bg-emerald-400'} animate-ping`} />
                      <span>{signalLifecycleStatus === 'IN_TRADE' ? `NA VELA (${secondsToTradeFinish}s)` : `ARMADO (${secondsToEntryCandle}s)`}</span>
                    </div>

                    <button
                      type="button"
                      onClick={handleClearSignal}
                      title="Resetar Sinal Agora"
                      className="px-2 py-1 rounded bg-slate-900 hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 border border-white/10 hover:border-rose-500/40 text-[10px] font-mono transition-all"
                    >
                      Resetar
                    </button>
                  </div>
                </div>

                {/* Big Verdict Badge */}
                <div
                  className={`p-5 rounded-2xl border text-center flex flex-col items-center justify-center transition-all ${
                    analyzedSignal.verdict === 'CALL'
                      ? 'bg-gradient-to-b from-emerald-950/60 to-[#020509] border-emerald-500/70 shadow-2xl shadow-emerald-500/20'
                      : analyzedSignal.verdict === 'PUT'
                        ? 'bg-gradient-to-b from-rose-950/60 to-[#020509] border-rose-500/70 shadow-2xl shadow-rose-500/20'
                        : 'bg-gradient-to-b from-amber-950/40 to-[#020509] border-amber-500/50'
                  }`}
                >
                  <div
                    className={`w-14 h-14 rounded-full flex items-center justify-center mb-2 ${
                      analyzedSignal.verdict === 'CALL'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 shadow-lg shadow-emerald-500/30'
                        : analyzedSignal.verdict === 'PUT'
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50 shadow-lg shadow-rose-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/50'
                    }`}
                  >
                    {analyzedSignal.verdict === 'CALL' ? (
                      <TrendingUp className="w-7 h-7 stroke-[3]" />
                    ) : analyzedSignal.verdict === 'PUT' ? (
                      <TrendingDown className="w-7 h-7 stroke-[3]" />
                    ) : (
                      <Minus className="w-7 h-7 stroke-[3]" />
                    )}
                  </div>

                  <span
                    className={`text-4xl md:text-5xl font-black font-mono tracking-tight ${
                      analyzedSignal.verdict === 'CALL'
                        ? 'text-emerald-400 drop-shadow-[0_0_25px_rgba(52,211,153,0.6)]'
                        : analyzedSignal.verdict === 'PUT'
                          ? 'text-rose-400 drop-shadow-[0_0_25px_rgba(244,63,94,0.6)]'
                          : 'text-amber-400'
                    }`}
                  >
                    {analyzedSignal.verdictWord}
                  </span>

                  <span className="text-xs font-mono font-bold uppercase tracking-widest text-slate-300 mt-1">
                    {analyzedSignal.verdictSub}
                  </span>

                  {/* Auto-Reset Countdown Notice */}
                  <div className="mt-3 px-3 py-1 rounded-full bg-black/60 border border-white/10 text-[11px] font-mono text-slate-300 flex items-center gap-1.5">
                    <span className="text-amber-400">ℹ️</span>
                    <span>
                      {signalLifecycleStatus === 'IN_TRADE'
                        ? `Vela em andamento: encerra e reseta o sinal em ${secondsToTradeFinish}s`
                        : `Sinal ativo para a vela das ${signalNextEntryTime || nextEntryStr} (${secondsToEntryCandle}s para entrada)`}
                    </span>
                  </div>
                </div>

                {/* AI Confidence Bar */}
                <div className="space-y-1.5 bg-[#020509]/80 p-3 rounded-xl border border-emerald-500/20">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 font-mono font-semibold flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                      Confiança da Confluência (Consenso dos 3 Votos)
                    </span>
                    <span className="text-sm font-black text-emerald-400 font-mono">{analyzedSignal.confidencePct}%</span>
                  </div>
                  <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-emerald-500/20">
                    <div
                      className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-emerald-600 via-emerald-400 to-emerald-300"
                      style={{ width: `${analyzedSignal.confidencePct}%` }}
                    />
                  </div>
                </div>

                {/* 4 Pillars Consensus Cards (Supertrend, CCI+RSI, Wick Rejection, Doji/Noise Filter) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {/* Pillar 1: Supertrend Duplo & EMAs */}
                  <div className="bg-[#020509]/80 p-2.5 rounded-xl border border-emerald-500/20 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 font-mono flex items-center gap-1">
                        <span>📈</span> Supertrend Duplo
                      </span>
                      <span
                        className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded uppercase ${
                          analyzedSignal.trendDir === 'call'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : analyzedSignal.trendDir === 'put'
                              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {analyzedSignal.trendDir === 'call' ? 'ALTA (CALL)' : analyzedSignal.trendDir === 'put' ? 'BAIXA (PUT)' : 'NEUTRO'}
                      </span>
                    </div>
                    <p className="text-xs font-mono font-bold text-white leading-tight line-clamp-2">{analyzedSignal.trendLabel}</p>
                    <span className="text-[10px] font-mono text-emerald-400 block">7x2 + 14x3 &amp; EMA 9/21</span>
                  </div>

                  {/* Pillar 2: Momentum CCI + RSI */}
                  <div className="bg-[#020509]/80 p-2.5 rounded-xl border border-emerald-500/20 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 font-mono flex items-center gap-1">
                        <span>⚡</span> CCI (14) + RSI (14)
                      </span>
                      <span
                        className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded uppercase ${
                          analyzedSignal.momentumDir === 'call'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : analyzedSignal.momentumDir === 'put'
                              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {analyzedSignal.momentumDir === 'call' ? 'COMPRA (CALL)' : analyzedSignal.momentumDir === 'put' ? 'VENDA (PUT)' : 'NEUTRO'}
                      </span>
                    </div>
                    <p className="text-xs font-mono font-bold text-white leading-tight line-clamp-2">{analyzedSignal.momentumLabel}</p>
                    <span className="text-[10px] font-mono text-emerald-400 block">Next Candle Prediction</span>
                  </div>

                  {/* Pillar 3: Wick Rejection > 35% */}
                  <div className="bg-[#020509]/80 p-2.5 rounded-xl border border-emerald-500/20 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 font-mono flex items-center gap-1">
                        <span>🎯</span> Rejeição Pavio &gt;35%
                      </span>
                      <span
                        className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded uppercase ${
                          analyzedSignal.quotexHackData?.wickRejection?.hasRejection
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border border-white/5'
                        }`}
                      >
                        {analyzedSignal.quotexHackData?.wickRejection?.hasRejection
                          ? analyzedSignal.quotexHackData.wickRejection.type === 'bull_wick' ? 'COMPRADOR' : 'VENDEDOR'
                          : 'NORMAL'}
                      </span>
                    </div>
                    <p className="text-xs font-mono font-bold text-white leading-tight line-clamp-2">
                      {analyzedSignal.quotexHackData?.wickRejection?.description || 'Aguardando exaustão em suporte/resistência'}
                    </p>
                    <span className="text-[10px] font-mono text-emerald-400 block">Pavio Rejection &amp; Zonas</span>
                  </div>

                  {/* Pillar 4: Doji & Noise Filter */}
                  <div className="bg-[#020509]/80 p-2.5 rounded-xl border border-emerald-500/20 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 font-mono flex items-center gap-1">
                        <span>🛡️</span> Filtro Ruído &amp; Doji
                      </span>
                      <span
                        className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded uppercase ${
                          analyzedSignal.volatilityApproved
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {analyzedSignal.volatilityApproved ? 'APROVADO' : 'BLOQUEADO'}
                      </span>
                    </div>
                    <p className="text-xs font-mono font-bold text-white leading-tight line-clamp-2">{analyzedSignal.volatilityLabel}</p>
                    <span className="text-[10px] font-mono text-emerald-400 block">ATR 14 &amp; Anti-Loss</span>
                  </div>
                </div>

                {/* QuotexHack Indicator Badge & Confluence Details */}
                {analyzedSignal.quotexHackData && (
                  <div className="bg-[#020509]/90 border border-emerald-500/30 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-bold text-emerald-400 flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 fill-emerald-400" />
                        <span>MÉTRICAS QUOTEXHACK (ALGO & PAVIO)</span>
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
                        {analyzedSignal.quotexHackData.triggerTiming.entryAt}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
                      <div className="bg-black/50 p-2 rounded-lg border border-white/5">
                        <span className="text-[10px] text-slate-400 block">Rejeição de Pavio</span>
                        <span className={`font-bold ${analyzedSignal.quotexHackData.wickRejection.hasRejection ? 'text-emerald-400' : 'text-slate-300'}`}>
                          {analyzedSignal.quotexHackData.wickRejection.hasRejection
                            ? analyzedSignal.quotexHackData.wickRejection.type === 'bull_wick' ? '▲ Pavio Inferior (Alta)' : '▼ Pavio Superior (Baixa)'
                            : 'Neutro / Sem Rejeição'}
                        </span>
                      </div>

                      <div className="bg-black/50 p-2 rounded-lg border border-white/5">
                        <span className="text-[10px] text-slate-400 block">Suporte / Resistência</span>
                        <span className="font-bold text-white">
                          {analyzedSignal.quotexHackData.levelReversal.levelType === 'support'
                            ? '🟢 Próximo ao Suporte'
                            : analyzedSignal.quotexHackData.levelReversal.levelType === 'resistance'
                              ? '🔴 Próximo à Resistência'
                              : 'Meio de Canal'}
                        </span>
                      </div>

                      <div className="bg-black/50 p-2 rounded-lg border border-white/5 col-span-2 sm:col-span-1">
                        <span className="text-[10px] text-slate-400 block">Plano de Recuperação</span>
                        <span className="font-bold text-emerald-400">
                          {analyzedSignal.quotexHackData.martingalePlan.recommendedMG} ({analyzedSignal.quotexHackData.martingalePlan.multiplier}x)
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Reason Tag */}
                <div className="p-3 bg-[#020509]/90 border border-emerald-500/20 rounded-xl space-y-1">
                  <span className="text-[10px] font-mono text-slate-400 block uppercase tracking-wider">
                    Confluência Técnica ({signalAnalyzedAt ? `Analisado às ${signalAnalyzedAt}` : 'Recente'}):
                  </span>
                  <div className="text-xs font-mono text-slate-200 space-y-0.5">
                    {analyzedSignal.reasons.map((r, i) => (
                      <p key={i} className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                        <span>{r}</span>
                      </p>
                    ))}
                    {analyzedSignal.blocks.map((b, i) => (
                      <p key={`b-${i}`} className="flex items-center gap-1.5 text-amber-300">
                        <XCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                        <span>{b}</span>
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* Idle / Awaiting Analysis Prompt */
              <div className="py-10 flex flex-col items-center justify-center text-center space-y-4">
                {lastFinishedSignalInfo ? (
                  <div className="w-full bg-emerald-950/40 border border-emerald-500/40 p-3.5 rounded-xl text-left font-mono space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>Sinal Anterior Finalizado com Sucesso</span>
                      </span>
                      <span className="text-[10px] text-slate-400">Vela das {lastFinishedSignalInfo.time}</span>
                    </div>
                    <p className="text-xs text-slate-300">
                      A vela da operação <strong className="text-white">({lastFinishedSignalInfo.dir})</strong> encerrou. O painel resetou para você não se confundir.
                    </p>
                  </div>
                ) : null}

                <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-lg">
                  <Zap className="w-8 h-8 fill-emerald-400/20 text-emerald-400" />
                </div>
                <div className="max-w-sm space-y-1">
                  <h3 className="text-base font-black text-white font-mono">Scanner Pronto · Aguardando Gatilho</h3>
                  <p className="text-xs text-slate-400 font-mono">
                    Clique no botão abaixo ou ative o Robô Vector para gerar o sinal de entrada na próxima vela de <strong>{selectedAsset.label}</strong>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRescan}
                  className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-400 hover:to-emerald-300 text-black font-mono font-black text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-emerald-500/25 active:scale-95 transition-all cursor-pointer"
                >
                  <Zap className="w-4 h-4 fill-black" />
                  <span>ANALISAR {selectedAsset.label} AGORA</span>
                </button>
              </div>
            )}

            {/* Manual Trade Actions & Direct Broker Execution */}
            <div className="space-y-3 pt-3 border-t border-emerald-500/20">
              {/* Stake Amount Selector */}
              <div className="bg-[#020509] p-3 rounded-xl border border-emerald-500/20 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="text-xs text-slate-400 font-mono block">Valor da Entrada ({account.currency})</span>
                    <span className="text-[10px] text-emerald-400/80 font-mono">Permitido a partir de $1.00</span>
                  </div>

                  {/* Manual Typing Input Field */}
                  <div className="flex items-center gap-1.5 bg-black/60 border border-emerald-500/40 rounded-lg px-2.5 py-1">
                    <span className="text-xs font-bold text-emerald-400 font-mono">$</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={orderAmount}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val >= 1) {
                          setOrderAmount(val);
                        } else if (e.target.value === '') {
                          setOrderAmount(1);
                        }
                      }}
                      className="w-20 bg-transparent text-sm font-black text-white font-mono focus:outline-none text-right"
                    />
                  </div>

                  <div className="text-right font-mono">
                    <span className="text-[11px] text-slate-400 block">Retorno Estimado</span>
                    <span className="text-sm font-black text-emerald-400">+${potentialProfit}</span>
                  </div>
                </div>

                {/* Fast Preset Buttons (including $1 and $2) */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-white/5">
                  {[1, 2, 5, 10, 25, 50, 100].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => {
                        playClickSound();
                        setOrderAmount(amt);
                      }}
                      className={`flex-1 min-w-[38px] py-1 rounded-md text-xs font-mono font-bold border transition-all text-center ${
                        orderAmount === amt
                          ? 'bg-emerald-400 text-black border-emerald-400 shadow-sm shadow-emerald-500/20'
                          : 'bg-slate-900/80 text-slate-300 border-white/10 hover:text-white hover:border-emerald-500/30'
                      }`}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Next Candle Auto-Fire & Trade Lifecycle Status Banner */}
              {analyzedSignal && analyzedSignal.verdict !== 'NO_TRADE' && (
                <div className="bg-[#040c14] border border-emerald-500/40 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className={`w-4 h-4 ${signalLifecycleStatus === 'IN_TRADE' ? 'text-amber-400 animate-spin' : 'text-emerald-400 animate-pulse'}`} />
                      <span className="text-xs font-mono font-bold text-white uppercase">
                        {signalLifecycleStatus === 'IN_TRADE' ? 'Vela da Operação em Andamento' : 'Gatilho de Execução na Próxima Vela'}
                      </span>
                    </div>
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                      signalLifecycleStatus === 'IN_TRADE'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    }`}>
                      {signalLifecycleStatus === 'IN_TRADE' ? `Vela das ${signalNextEntryTime || nextEntryStr}` : `Entrada às ${signalNextEntryTime || nextEntryStr}`}
                    </span>
                  </div>

                  {/* Auto-Fire Toggle & Countdown */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-white/5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          playClickSound();
                          setAutoFireNextCandle(!autoFireNextCandle);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all border flex items-center gap-1.5 ${
                          autoFireNextCandle
                            ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-sm shadow-emerald-500/20'
                            : 'bg-slate-900 border-white/10 text-slate-400 hover:text-white'
                        }`}
                      >
                        <Zap className={`w-3.5 h-3.5 ${autoFireNextCandle ? 'fill-emerald-400 text-emerald-400' : ''}`} />
                        <span>{autoFireNextCandle ? 'AUTO-DISPARO ARMADO' : 'AUTO-DISPARO DESATIVADO'}</span>
                      </button>
                    </div>

                    <div className="text-right">
                      <span className="text-[11px] font-mono text-slate-300">
                        {signalLifecycleStatus === 'IN_TRADE' ? (
                          <span className="text-amber-400 font-bold">
                            ⚡ Encerramento da vela em <strong className="text-white text-xs">{secondsToTradeFinish}s</strong>
                          </span>
                        ) : autoFireNextCandle ? (
                          <span className="text-emerald-400 font-bold">
                            ⏳ Disparo da entrada em <strong className="text-white text-xs">{secondsToEntryCandle}s</strong>
                          </span>
                        ) : (
                          <span className="text-slate-400">Aguardando entrada manual</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Visual Progress Bar to Next Candle / Expiration */}
                  <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden border border-white/5">
                    <div
                      className={`h-full transition-all duration-300 ${
                        signalLifecycleStatus === 'IN_TRADE'
                          ? 'bg-amber-400'
                          : analyzedSignal.verdict === 'CALL'
                            ? 'bg-emerald-400'
                            : 'bg-rose-400'
                      }`}
                      style={{
                        width: signalLifecycleStatus === 'IN_TRADE'
                          ? `${((60 - secondsToTradeFinish) / 60) * 100}%`
                          : `${((60 - secondsToEntryCandle) / 60) * 100}%`,
                      }}
                    />
                  </div>

                  {lastExecutedCandleTime && (
                    <div className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span>Última ordem executada na virada às {lastExecutedCandleTime}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Direct Buy / Sell Action Trigger */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  id="manual-execute-order-btn"
                  onClick={handleManualTrade}
                  disabled={executing || !analyzedSignal || analyzedSignal.verdict === 'NO_TRADE'}
                  className={`py-3.5 px-4 rounded-xl font-mono font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-xl transition-all ${
                    analyzedSignal?.verdict === 'CALL'
                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-400 text-black hover:from-emerald-400 hover:to-emerald-300 shadow-emerald-500/30 active:scale-[0.98]'
                      : analyzedSignal?.verdict === 'PUT'
                        ? 'bg-gradient-to-r from-rose-500 to-rose-400 text-white hover:from-rose-400 hover:to-rose-300 shadow-rose-500/30 active:scale-[0.98]'
                        : 'bg-slate-900 text-slate-500 border border-slate-800 cursor-not-allowed'
                  }`}
                >
                  {executing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Enviando Ordem para Broker...</span>
                    </>
                  ) : analyzedSignal?.verdict === 'CALL' ? (
                    <>
                      <TrendingUp className="w-4 h-4 stroke-[3]" />
                      <span>EXECUTAR CALL AGORA (${effectiveStake})</span>
                    </>
                  ) : analyzedSignal?.verdict === 'PUT' ? (
                    <>
                      <TrendingDown className="w-4 h-4 stroke-[3]" />
                      <span>EXECUTAR PUT AGORA (${effectiveStake})</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      <span>Aguardando Análise</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleRescan}
                  disabled={isScanning}
                  className="py-3.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/10 hover:border-emerald-500/40 text-white font-mono font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
                >
                  <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin text-emerald-400' : 'text-slate-400'}`} />
                  <span>{isScanning ? 'Reanalisando...' : 'Reanalisar Ativo'}</span>
                </button>
              </div>

              {/* Automatic Trading Robot Sub-Panel */}
              <div className="bg-[#020509]/90 p-3.5 rounded-xl border border-emerald-500/25 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bot className={`w-4 h-4 ${robotActive ? 'text-emerald-400' : 'text-slate-400'}`} />
                    <div>
                      <span className="text-xs font-bold text-white font-mono block">Robô de Auto-Operação Vector</span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {robotActive
                          ? 'Escaneia os 3 votos a cada :58s e dispara na virada :00s'
                          : 'Desativado (opera apenas quando você clicar em Analisar)'}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      playClickSound();
                      onToggleRobot(!robotActive);
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-mono font-bold transition-all border ${
                      robotActive
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400 shadow-sm shadow-emerald-500/20'
                        : 'bg-slate-900 border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    {robotActive ? 'ROBÔ ATIVO' : 'ROBÔ DESLIGADO'}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-emerald-500/15">
                  <button
                    type="button"
                    onClick={() => setManagementMode('fixed')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-mono font-bold border transition-all ${
                      managementMode === 'fixed'
                        ? 'bg-emerald-400 text-black border-emerald-400'
                        : 'bg-black/50 text-slate-300 border-white/5'
                    }`}
                  >
                    Valor Fixo
                  </button>
                  <button
                    type="button"
                    onClick={() => setManagementMode('soros')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-mono font-bold border transition-all ${
                      managementMode === 'soros'
                        ? 'bg-emerald-400 text-black border-emerald-400'
                        : 'bg-black/50 text-slate-300 border-white/5'
                    }`}
                  >
                    Soros (Nv {currentSorosLevel})
                  </button>
                  <button
                    type="button"
                    onClick={() => setManagementMode('martingale')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-mono font-bold border transition-all ${
                      managementMode === 'martingale'
                        ? 'bg-emerald-400 text-black border-emerald-400'
                        : 'bg-black/50 text-slate-300 border-white/5'
                    }`}
                  >
                    Martingale
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Gráfico de Velas M1 OTC da OPTGO Broker */}
      <div id="prisma-candlestick-chart-section" className="w-full">
        <CandleChart
          candles={candles}
          activeId={selectedAsset.id}
          symbol={selectedAsset.symbol}
          precision={selectedAsset.precision || 5}
          gatilhoTaxa50={analysis?.gatilhoTaxa50}
          nextDir={analyzedSignal?.verdict === 'CALL' ? 'call' : analyzedSignal?.verdict === 'PUT' ? 'put' : undefined}
          nextProb={analyzedSignal?.confidencePct}
        />
      </div>
    </div>
  );
}
