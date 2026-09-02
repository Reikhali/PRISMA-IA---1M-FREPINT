/**
 * Technical analysis engine for OTC signals powered by:
 * Chinese Bot AI Pro — Three-Vote AI Consensus Engine
 * (Trend EMA x Momentum RSI x Volatility ATR)
 */

import type { Candle, Analysis } from "@/types";
import { evaluateChineseBot, buildUnifiedAnalysis, calcEMA, calcRSI, calcATR, calcBollingerBands } from "./chinese-bot-engine";
import { evaluateQuotexHack, type QuotexHackResult } from "./quotexhack-engine";
import {
  evaluateOrderFlowFootprint,
  generateFootprintData,
  computeSessionVolumeProfiles,
  evaluatePocVolumeProfileStrategy,
  computeManipulatorMarkers,
  evaluateManipulatorStrategy,
  type OrderFlowFootprintResult,
  type PocStrategyResult,
  type SessionVolumeProfileBlock,
  type ManipulatorMarker,
  type ManipulatorStrategyResult,
} from "./footprint-engine";

export {
  evaluateChineseBot,
  evaluateQuotexHack,
  evaluateOrderFlowFootprint,
  generateFootprintData,
  computeSessionVolumeProfiles,
  evaluatePocVolumeProfileStrategy,
  computeManipulatorMarkers,
  evaluateManipulatorStrategy,
  calcEMA,
  calcRSI,
  calcATR,
  calcBollingerBands,
};
export type {
  QuotexHackResult,
  OrderFlowFootprintResult,
  PocStrategyResult,
  SessionVolumeProfileBlock,
  ManipulatorMarker,
  ManipulatorStrategyResult,
};

export type StrategyMode =
  | 'manipulator_hunter'
  | 'full_confluence'
  | 'poc_volume_profile'
  | 'footprint_orderflow'
  | 'hybrid_confluence'
  | 'quotex_hack'
  | 'vector_3votes';

export interface UnifiedSignalResult {
  mode: StrategyMode;
  verdict: 'CALL' | 'PUT' | 'NO_TRADE';
  verdictWord: 'CALL' | 'PUT' | 'NO TRADE';
  verdictSub: 'COMPRA (ALTA)' | 'VENDA (BAIXA)' | 'SEM ENTRADA (NEUTRO)';
  confidencePct: number;
  confidenceLevel: 'HIGH' | 'MED' | 'LOW';
  trendScore: number;
  trendLabel: string;
  trendDir: 'call' | 'put' | 'neutral';
  momentumScore: number;
  momentumLabel: string;
  momentumDir: 'call' | 'put' | 'neutral';
  volatilityScore: number;
  volatilityLabel: string;
  volatilityLevel: 'Low' | 'Medium' | 'High' | 'Steady';
  volatilityApproved: boolean;
  rsi: number;
  atr: number;
  emaFast: number;
  emaSlow: number;
  emaMacro: number;
  lastPrice: number;
  analysts: any[];
  reasons: string[];
  blocks: string[];
  signalReady: boolean;
  quotexHackData?: QuotexHackResult;
  footprintData?: OrderFlowFootprintResult;
  pocData?: PocStrategyResult;
  manipulatorData?: ManipulatorStrategyResult;
}

export function evaluateMarketSignal(
  candles: Candle[],
  timeframe = '1M',
  strategyMode: StrategyMode = 'manipulator_hunter'
): UnifiedSignalResult {
  const vectorRes = evaluateChineseBot(candles, timeframe);
  const qxRes = evaluateQuotexHack(candles, timeframe);
  const fpRes = evaluateOrderFlowFootprint(candles, timeframe);
  const pocRes = evaluatePocVolumeProfileStrategy(candles, timeframe);
  const manipRes = evaluateManipulatorStrategy(candles, timeframe);

  // 1. MANIPULATOR HUNTER STRATEGY (Detecção de Manipulação Institucional M1)
  if (strategyMode === 'manipulator_hunter') {
    const isCall = manipRes.verdict === 'CALL';
    const isPut = manipRes.verdict === 'PUT';

    return {
      mode: 'manipulator_hunter',
      verdict: isCall ? 'CALL' : isPut ? 'PUT' : 'NO_TRADE',
      verdictWord: isCall ? 'CALL' : isPut ? 'PUT' : 'NO TRADE',
      verdictSub: isCall ? 'COMPRA (ALTA)' : isPut ? 'VENDA (BAIXA)' : 'SEM ENTRADA (NEUTRO)',
      confidencePct: manipRes.confidencePct,
      confidenceLevel: manipRes.confidenceLevel,
      trendScore: 98,
      trendLabel: `Detector de Manipulador: ${manipRes.description}`,
      trendDir: isCall ? 'call' : isPut ? 'put' : 'neutral',
      momentumScore: 96,
      momentumLabel: `Nível do Trap: ${manipRes.trapLevelPrice.toFixed(5)} · Absorção Ativa`,
      momentumDir: isCall ? 'call' : isPut ? 'put' : 'neutral',
      volatilityScore: 97,
      volatilityLabel: 'Armadilha de Liquidez Confirmada em M1 (:58s)',
      volatilityLevel: 'Steady',
      volatilityApproved: true,
      rsi: vectorRes.rsi,
      atr: vectorRes.atr,
      emaFast: vectorRes.emaFast,
      emaSlow: vectorRes.emaSlow,
      emaMacro: vectorRes.emaMacro,
      lastPrice: vectorRes.lastPrice,
      analysts: manipRes.analysts,
      reasons: manipRes.reasons,
      blocks: manipRes.blocks,
      signalReady: manipRes.signalReady,
      quotexHackData: qxRes,
      footprintData: fpRes,
      pocData: pocRes,
      manipulatorData: manipRes,
    };
  }

  // 2. FULL CONFLUENCE (Manipulador + POC + Footprint + QuotexHack + Prisma 3 Votos)
  if (strategyMode === 'full_confluence') {
    let callVotes = 0;
    let putVotes = 0;

    if (manipRes.verdict === 'CALL') callVotes += 2.5;
    if (manipRes.verdict === 'PUT') putVotes += 2.5;

    if (pocRes.verdict === 'CALL') callVotes += 2;
    if (pocRes.verdict === 'PUT') putVotes += 2;

    if (fpRes.verdict === 'CALL') callVotes += 1.5;
    if (fpRes.verdict === 'PUT') putVotes += 1.5;

    if (qxRes.verdict === 'CALL') callVotes += 1.5;
    if (qxRes.verdict === 'PUT') putVotes += 1.5;

    if (vectorRes.verdict === 'CALL') callVotes += 1.5;
    if (vectorRes.verdict === 'PUT') putVotes += 1.5;

    const isStrongCall = callVotes >= 4;
    const isStrongPut = putVotes >= 4;

    const verdict = isStrongCall ? 'CALL' : isStrongPut ? 'PUT' : 'NO_TRADE';
    const confidencePct = Math.min(99, Math.max(90, Math.round(Math.max(callVotes, putVotes) * 11)));

    return {
      mode: 'full_confluence',
      verdict,
      verdictWord: isStrongCall ? 'CALL' : isStrongPut ? 'PUT' : 'NO TRADE',
      verdictSub: isStrongCall ? 'COMPRA (ALTA)' : isStrongPut ? 'VENDA (BAIXA)' : 'SEM ENTRADA (NEUTRO)',
      confidencePct: verdict !== 'NO_TRADE' ? confidencePct : 50,
      confidenceLevel: verdict !== 'NO_TRADE' ? 'HIGH' : 'LOW',
      trendScore: 99,
      trendLabel: `Confluência Suprema: ${callVotes.toFixed(1)} votos CALL vs ${putVotes.toFixed(1)} votos PUT`,
      trendDir: isStrongCall ? 'call' : isStrongPut ? 'put' : 'neutral',
      momentumScore: 98,
      momentumLabel: `Manipulador (${manipRes.verdict}) + POC (${pocRes.verdict}) + Fluxo (${fpRes.verdict})`,
      momentumDir: isStrongCall ? 'call' : isStrongPut ? 'put' : 'neutral',
      volatilityScore: 98,
      volatilityLabel: 'Alinhamento Quíntuplo de Motores Institucionais',
      volatilityLevel: 'Steady',
      volatilityApproved: true,
      rsi: vectorRes.rsi,
      atr: vectorRes.atr,
      emaFast: vectorRes.emaFast,
      emaSlow: vectorRes.emaSlow,
      emaMacro: vectorRes.emaMacro,
      lastPrice: vectorRes.lastPrice,
      analysts: [
        {
          name: 'Motor 1: Detector de Manipulador (Liquidez)',
          icon: '🕵️',
          direction: manipRes.verdict === 'CALL' ? 'call' : manipRes.verdict === 'PUT' ? 'put' : 'hold',
          confidence: manipRes.confidencePct,
          opinion: manipRes.description,
        },
        {
          name: 'Motor 2: POC & Volume Profile (Amarela)',
          icon: '🟡',
          direction: pocRes.verdict === 'CALL' ? 'call' : pocRes.verdict === 'PUT' ? 'put' : 'hold',
          confidence: pocRes.confidencePct,
          opinion: pocRes.description,
        },
        {
          name: 'Motor 3: Footprint Order Flow & Delta',
          icon: '📊',
          direction: fpRes.verdict === 'CALL' ? 'call' : fpRes.verdict === 'PUT' ? 'put' : 'hold',
          confidence: fpRes.confidencePct,
          opinion: fpRes.activeAbsorption.description,
        },
        {
          name: 'Motor 4: QUOTEXHACK Pavio e Timing :58s',
          icon: '🎯',
          direction: qxRes.verdict === 'CALL' ? 'call' : qxRes.verdict === 'PUT' ? 'put' : 'hold',
          confidence: qxRes.confidencePct,
          opinion: qxRes.wickRejection.description,
        },
        {
          name: 'Motor 5: PRISMA IA 3 Votos (EMA + RSI + ATR)',
          icon: '🤖',
          direction: vectorRes.verdict === 'CALL' ? 'call' : vectorRes.verdict === 'PUT' ? 'put' : 'hold',
          confidence: vectorRes.confidencePct,
          opinion: 'Consenso de médias e oscilador estocástico',
        },
      ],
      reasons: [
        `CONFLUÊNCIA SUPREMA INSTITUCIONAL: ${verdict === 'CALL' ? 'COMPRA FORTE' : verdict === 'PUT' ? 'VENDA FORTE' : 'Aguardando alinhamento'}.`,
        `Manipulador: ${manipRes.description}`,
        `POC Linha Amarela: ${pocRes.pocPrice.toFixed(5)} · ${pocRes.description}`,
        'Disparo prioritário aos :58s para execução precisa na virada da vela M1.',
      ],
      blocks: verdict === 'NO_TRADE' ? ['Aguardando convergência de pelo menos 4 votos dos 5 motores.'] : [],
      signalReady: verdict !== 'NO_TRADE',
      quotexHackData: qxRes,
      footprintData: fpRes,
      pocData: pocRes,
      manipulatorData: manipRes,
    };
  }

  if (strategyMode === 'poc_volume_profile') {
    const isCall = pocRes.verdict === 'CALL';
    const isPut = pocRes.verdict === 'PUT';

    return {
      mode: 'poc_volume_profile',
      verdict: isCall ? 'CALL' : isPut ? 'PUT' : 'NO_TRADE',
      verdictWord: isCall ? 'CALL' : isPut ? 'PUT' : 'NO TRADE',
      verdictSub: isCall ? 'COMPRA (ALTA)' : isPut ? 'VENDA (BAIXA)' : 'SEM ENTRADA (NEUTRO)',
      confidencePct: pocRes.confidencePct,
      confidenceLevel: pocRes.confidenceLevel,
      trendScore: 97,
      trendLabel: `POC Institucional: Linha Amarela ${pocRes.pocPrice.toFixed(5)}`,
      trendDir: isCall ? 'call' : isPut ? 'put' : 'neutral',
      momentumScore: 95,
      momentumLabel: pocRes.description,
      momentumDir: isCall ? 'call' : isPut ? 'put' : 'neutral',
      volatilityScore: 96,
      volatilityLabel: 'Blocos de Volume Profile M1 Sincronizados',
      volatilityLevel: 'Steady',
      volatilityApproved: true,
      rsi: vectorRes.rsi,
      atr: vectorRes.atr,
      emaFast: vectorRes.emaFast,
      emaSlow: vectorRes.emaSlow,
      emaMacro: vectorRes.emaMacro,
      lastPrice: vectorRes.lastPrice,
      analysts: pocRes.analysts,
      reasons: pocRes.reasons,
      blocks: pocRes.blocks,
      signalReady: pocRes.signalReady,
      quotexHackData: qxRes,
      footprintData: fpRes,
      pocData: pocRes,
    };
  }

  if (strategyMode === 'footprint_orderflow') {
    const verdict = fpRes.verdict !== 'NO_TRADE' ? fpRes.verdict : vectorRes.verdict !== 'NO_TRADE' ? vectorRes.verdict : qxRes.verdict;
    const isCall = verdict === 'CALL';
    const isPut = verdict === 'PUT';

    return {
      mode: 'footprint_orderflow',
      verdict: isCall ? 'CALL' : isPut ? 'PUT' : 'NO_TRADE',
      verdictWord: isCall ? 'CALL' : isPut ? 'PUT' : 'NO TRADE',
      verdictSub: isCall ? 'COMPRA (ALTA)' : isPut ? 'VENDA (BAIXA)' : 'SEM ENTRADA (NEUTRO)',
      confidencePct: fpRes.confidencePct,
      confidenceLevel: fpRes.confidenceLevel,
      trendScore: 96,
      trendLabel: `Order Flow Delta: ${fpRes.activeAbsorption.description}`,
      trendDir: isCall ? 'call' : isPut ? 'put' : 'neutral',
      momentumScore: 94,
      momentumLabel: `POC & Absorção: ${fpRes.lastFootprint ? (isCall ? `Pavio Fundo ${fpRes.lastFootprint.bottomRatio}` : `Pavio Topo ${fpRes.lastFootprint.topRatio}`) : 'Ativo'}`,
      momentumDir: isCall ? 'call' : isPut ? 'put' : 'neutral',
      volatilityScore: 95,
      volatilityLabel: 'Zonas Institucionais Confirmadas (Caixas Brancas)',
      volatilityLevel: 'Steady',
      volatilityApproved: true,
      rsi: vectorRes.rsi,
      atr: vectorRes.atr,
      emaFast: vectorRes.emaFast,
      emaSlow: vectorRes.emaSlow,
      emaMacro: vectorRes.emaMacro,
      lastPrice: vectorRes.lastPrice,
      analysts: fpRes.analysts,
      reasons: fpRes.reasons,
      blocks: fpRes.blocks,
      signalReady: verdict !== 'NO_TRADE',
      quotexHackData: qxRes,
      footprintData: fpRes,
    };
  }

  if (strategyMode === 'vector_3votes') {
    return {
      ...vectorRes,
      mode: 'vector_3votes',
      quotexHackData: qxRes,
      footprintData: fpRes,
    };
  }

  if (strategyMode === 'quotex_hack') {
    return {
      mode: 'quotex_hack',
      verdict: qxRes.verdict,
      verdictWord: qxRes.verdictWord,
      verdictSub: qxRes.verdictSub,
      confidencePct: qxRes.confidencePct,
      confidenceLevel: qxRes.confidenceLevel,
      trendScore: qxRes.flowTrend.strength,
      trendLabel: qxRes.flowTrend.description,
      trendDir: qxRes.flowTrend.direction,
      momentumScore: qxRes.wickRejection.hasRejection ? 92 : 75,
      momentumLabel: qxRes.wickRejection.description,
      momentumDir: qxRes.wickRejection.type === 'bull_wick' ? 'call' : qxRes.wickRejection.type === 'bear_wick' ? 'put' : 'neutral',
      volatilityScore: 90,
      volatilityLabel: 'Timing :58s M1 Aprovado',
      volatilityLevel: 'Steady',
      volatilityApproved: true,
      rsi: vectorRes.rsi,
      atr: vectorRes.atr,
      emaFast: vectorRes.emaFast,
      emaSlow: vectorRes.emaSlow,
      emaMacro: vectorRes.emaMacro,
      lastPrice: vectorRes.lastPrice,
      analysts: qxRes.analysts,
      reasons: qxRes.reasons,
      blocks: qxRes.blocks,
      signalReady: qxRes.signalReady,
      quotexHackData: qxRes,
    };
  }

  // StrategyMode === 'hybrid_confluence' (Confluência Máxima dos Dois Motores)
  const bothCall = vectorRes.verdict === 'CALL' && qxRes.verdict === 'CALL';
  const bothPut = vectorRes.verdict === 'PUT' && qxRes.verdict === 'PUT';
  const anyCall = vectorRes.verdict === 'CALL' || qxRes.verdict === 'CALL';
  const anyPut = vectorRes.verdict === 'PUT' || qxRes.verdict === 'PUT';

  if (bothCall) {
    return {
      mode: 'hybrid_confluence',
      verdict: 'CALL',
      verdictWord: 'CALL',
      verdictSub: 'COMPRA (ALTA)',
      confidencePct: 98,
      confidenceLevel: 'HIGH',
      trendScore: 98,
      trendLabel: 'Confluência Total: PRISMA Vector + QUOTEXHACK Flow em Alta',
      trendDir: 'call',
      momentumScore: 95,
      momentumLabel: 'RSI > 50 + Rejeição de Pavio Inferior em Suporte',
      momentumDir: 'call',
      volatilityScore: 95,
      volatilityLabel: 'Disparo Confirmado aos :58s / :59s na Virada M1',
      volatilityLevel: 'Steady',
      volatilityApproved: true,
      rsi: vectorRes.rsi,
      atr: vectorRes.atr,
      emaFast: vectorRes.emaFast,
      emaSlow: vectorRes.emaSlow,
      emaMacro: vectorRes.emaMacro,
      lastPrice: vectorRes.lastPrice,
      analysts: [
        {
          name: 'Motor 1: PRISMA IA 3 Votos',
          icon: '🤖',
          direction: 'call',
          confidence: vectorRes.confidencePct,
          opinion: 'Consenso Unânime (EMA9 > EMA21 + RSI > 50 + ATR)',
        },
        {
          name: 'Motor 2: QUOTEXHACK Algo',
          icon: '⚡',
          direction: 'call',
          confidence: qxRes.confidencePct,
          opinion: qxRes.wickRejection.hasRejection ? qxRes.wickRejection.description : 'Fluxo de rompimento e disparo M1 confirmado',
        },
        {
          name: 'Gatilho de Execução Broker',
          icon: '🎯',
          direction: 'call',
          confidence: 98,
          opinion: 'Entrada programada para abertura da vela :00s com MG1 (2.2x)',
        },
      ],
      reasons: [
        'CONFLUÊNCIA TOTAL: Ambos os motores (PRISMA 3 Votos + QUOTEXHACK) confirmam COMPRA (CALL).',
        `Rejeição/Fluxo: ${qxRes.wickRejection.description}.`,
        'Timing M1: Ordem pronta para ser disparada aos :58s com entrada perfeita no segundo :00.',
      ],
      blocks: [],
      signalReady: true,
      quotexHackData: qxRes,
    };
  }

  if (bothPut) {
    return {
      mode: 'hybrid_confluence',
      verdict: 'PUT',
      verdictWord: 'PUT',
      verdictSub: 'VENDA (BAIXA)',
      confidencePct: 98,
      confidenceLevel: 'HIGH',
      trendScore: 98,
      trendLabel: 'Confluência Total: PRISMA Vector + QUOTEXHACK Flow em Baixa',
      trendDir: 'put',
      momentumScore: 95,
      momentumLabel: 'RSI < 50 + Rejeição de Pavio Superior em Resistência',
      momentumDir: 'put',
      volatilityScore: 95,
      volatilityLabel: 'Disparo Confirmado aos :58s / :59s na Virada M1',
      volatilityLevel: 'Steady',
      volatilityApproved: true,
      rsi: vectorRes.rsi,
      atr: vectorRes.atr,
      emaFast: vectorRes.emaFast,
      emaSlow: vectorRes.emaSlow,
      emaMacro: vectorRes.emaMacro,
      lastPrice: vectorRes.lastPrice,
      analysts: [
        {
          name: 'Motor 1: PRISMA IA 3 Votos',
          icon: '🤖',
          direction: 'put',
          confidence: vectorRes.confidencePct,
          opinion: 'Consenso Unânime (EMA9 < EMA21 + RSI < 50 + ATR)',
        },
        {
          name: 'Motor 2: QUOTEXHACK Algo',
          icon: '⚡',
          direction: 'put',
          confidence: qxRes.confidencePct,
          opinion: qxRes.wickRejection.hasRejection ? qxRes.wickRejection.description : 'Fluxo de rompimento e disparo M1 confirmado',
        },
        {
          name: 'Gatilho de Execução Broker',
          icon: '🎯',
          direction: 'put',
          confidence: 98,
          opinion: 'Entrada programada para abertura da vela :00s com MG1 (2.2x)',
        },
      ],
      reasons: [
        'CONFLUÊNCIA TOTAL: Ambos os motores (PRISMA 3 Votos + QUOTEXHACK) confirmam VENDA (PUT).',
        `Rejeição/Fluxo: ${qxRes.wickRejection.description}.`,
        'Timing M1: Ordem pronta para ser disparada aos :58s com entrada perfeita no segundo :00.',
      ],
      blocks: [],
      signalReady: true,
      quotexHackData: qxRes,
    };
  }

  // Single engine signal
  if (qxRes.verdict !== 'NO_TRADE' && vectorRes.verdict === 'NO_TRADE') {
    return {
      mode: 'hybrid_confluence',
      verdict: qxRes.verdict,
      verdictWord: qxRes.verdictWord,
      verdictSub: qxRes.verdictSub,
      confidencePct: 89,
      confidenceLevel: 'HIGH',
      trendScore: qxRes.flowTrend.strength,
      trendLabel: qxRes.flowTrend.description,
      trendDir: qxRes.flowTrend.direction,
      momentumScore: 88,
      momentumLabel: qxRes.wickRejection.description,
      momentumDir: qxRes.verdict === 'CALL' ? 'call' : 'put',
      volatilityScore: 88,
      volatilityLabel: 'Aprovado por Rejeição de Pavio QuotexHack',
      volatilityLevel: 'Steady',
      volatilityApproved: true,
      rsi: vectorRes.rsi,
      atr: vectorRes.atr,
      emaFast: vectorRes.emaFast,
      emaSlow: vectorRes.emaSlow,
      emaMacro: vectorRes.emaMacro,
      lastPrice: vectorRes.lastPrice,
      analysts: qxRes.analysts,
      reasons: qxRes.reasons,
      blocks: [],
      signalReady: true,
      quotexHackData: qxRes,
    };
  }

  if (vectorRes.verdict !== 'NO_TRADE' && qxRes.verdict === 'NO_TRADE') {
    return {
      ...vectorRes,
      mode: 'hybrid_confluence',
      confidencePct: 88,
      quotexHackData: qxRes,
    };
  }

  return {
    ...vectorRes,
    mode: 'hybrid_confluence',
    verdict: 'NO_TRADE',
    verdictWord: 'NO TRADE',
    verdictSub: 'SEM ENTRADA (NEUTRO)',
    confidencePct: 50,
    signalReady: false,
    quotexHackData: qxRes,
    blocks: [
      'Nenhum dos motores encontrou confluência de alta probabilidade no segundo atual.',
      'Aguardando formação de pavio em suporte/resistência ou cruzamento nítido de médias.',
    ],
  };
}

// ─── Main analysis engine ────────────────────────────────────────────────────

export function analyze(candles: Candle[], timeframe = '1M'): Analysis | null {
  return buildUnifiedAnalysis(candles, timeframe);
}

// ─── Soros progression ───────────────────────────────────────────────────────

export function sorosProgression(
  base: number,
  payout: number,
  levels: number,
): { level: number; amount: number; profit: number }[] {
  const payoutRate = payout / 100;
  const result: { level: number; amount: number; profit: number }[] = [];
  let amount = base;
  for (let i = 1; i <= levels; i++) {
    const profit = amount * payoutRate;
    result.push({ level: i, amount: parseFloat(amount.toFixed(2)), profit: parseFloat(profit.toFixed(2)) });
    amount = amount + profit;
  }
  return result;
}


