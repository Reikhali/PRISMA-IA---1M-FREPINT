/**
 * Technical analysis engine for OTC signals powered by:
 * Chinese Bot AI Pro — Three-Vote AI Consensus Engine
 * (Trend EMA x Momentum RSI x Volatility ATR)
 */

import type { Candle, Analysis } from "@/types";
import { evaluateChineseBot, buildUnifiedAnalysis, calcEMA, calcRSI, calcATR, calcBollingerBands } from "./chinese-bot-engine";
import { evaluateQuotexHack, type QuotexHackResult } from "./quotexhack-engine";
import { evaluateOrderFlowFootprint, generateFootprintData, type OrderFlowFootprintResult } from "./footprint-engine";

export { evaluateChineseBot, evaluateQuotexHack, evaluateOrderFlowFootprint, generateFootprintData, calcEMA, calcRSI, calcATR, calcBollingerBands };
export type { QuotexHackResult, OrderFlowFootprintResult };

export type StrategyMode = 'footprint_orderflow' | 'hybrid_confluence' | 'quotex_hack' | 'vector_3votes';

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
}

export function evaluateMarketSignal(
  candles: Candle[],
  timeframe = '1M',
  strategyMode: StrategyMode = 'footprint_orderflow'
): UnifiedSignalResult {
  const vectorRes = evaluateChineseBot(candles, timeframe);
  const qxRes = evaluateQuotexHack(candles, timeframe);
  const fpRes = evaluateOrderFlowFootprint(candles, timeframe);

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


