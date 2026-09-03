import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Bot,
  Sparkles,
  Send,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Square,
  Play,
  HelpCircle,
} from 'lucide-react';
import type { Candle, OtcAsset } from '@/types';
import type { StrategySignal } from '@/lib/supertrend-rsi-engine';
import { speakVoiceNotification, stopSpeaking, playClickSound } from '@/lib/sound';

interface MarketVoiceAssistantProps {
  selectedAsset: OtcAsset;
  candles: Candle[];
  metrics: StrategySignal;
  secondsToNextCandle: number;
  autoVoiceAlerts: boolean;
  onToggleAutoVoice: () => void;
}

interface Message {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  time: string;
}

export const MarketVoiceAssistant: React.FC<MarketVoiceAssistantProps> = ({
  selectedAsset,
  candles,
  metrics,
  secondsToNextCandle,
  autoVoiceAlerts,
  onToggleAutoVoice,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [speechSupported, setSpeechSupported] = useState<boolean>(true);
  const [inputText, setInputText] = useState<string>('');
  const [transcript, setTranscript] = useState<string>('');
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'msg-welcome',
      sender: 'bot',
      text: `Olá! Sou o Assistente de Voz do Robô Prisma IA. Estou monitorando ${selectedAsset.label} em tempo real. Pressione "FALAR NO MICROFONE", me faça qualquer pergunta e eu vou te entender e responder em voz alta!`,
      time: new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(
        new Date()
      ),
    },
  ]);

  const recognitionRef = useRef<any>(null);
  const capturedTextRef = useRef<string>('');
  const hasSubmittedRef = useRef<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Verifica suporte a reconhecimento de voz no navegador
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
    }
  }, []);

  // Rola mensagens para o final
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Inteligência de Resposta Contextual Baseada nos Dados Reais de Mercado
  const generateMarketExplanation = useCallback(
    (query: string): string => {
      const q = query.toLowerCase();
      const lastCandle = candles[candles.length - 1];
      const isGreen = lastCandle ? lastCandle.close >= lastCandle.open : true;
      const stDir = metrics.superTrendDirection === 'BULLISH' ? 'Alta' : 'Baixa';
      const rsiVal = metrics.rsiValue.toFixed(1);
      const rsiSide = metrics.rsiValue > 50 ? 'comprador acima de 50' : 'vendedor abaixo de 50';

      // Comando de voz para silenciar ou ligar áudio
      if (q.includes('silenciar') || q.includes('mudo') || q.includes('desligar voz') || q.includes('parar áudio')) {
        if (autoVoiceAlerts) onToggleAutoVoice();
        return 'Entendido! Silenciei os avisos automáticos de voz do robô.';
      }
      if (q.includes('ativar voz') || q.includes('ligar voz') || q.includes('falar')) {
        if (!autoVoiceAlerts) onToggleAutoVoice();
        return 'Pronto! Os avisos de voz automáticos do robô foram ativados com sucesso.';
      }

      // Pergunta sobre Zonas de Oferta e Demanda / True Supply & Demand / POC
      if (
        q.includes('oferta') ||
        q.includes('demanda') ||
        q.includes('poc') ||
        q.includes('zona') ||
        q.includes('supply') ||
        q.includes('demand') ||
        q.includes('suporte') ||
        q.includes('resistência') ||
        q.includes('resistencia')
      ) {
        const sd = metrics.supplyDemandAnalysis;
        if (!sd) {
          return `O indicador True Supply & Demand está mapeando as zonas institucionais de ${selectedAsset.label}.`;
        }
        const demPoc = sd.nearestDemand
          ? sd.nearestDemand.pocPrice.toFixed(selectedAsset.precision || 5)
          : 'não detectada';
        const supPoc = sd.nearestSupply
          ? sd.nearestSupply.pocPrice.toFixed(selectedAsset.precision || 5)
          : 'não detectada';

        return `Análise institucional de True Supply & Demand para ${selectedAsset.label}: A Demanda compradora mais próxima está com POC em ${demPoc}. A Oferta vendedora está com POC em ${supPoc}. Situação atual: ${metrics.supplyDemandStatus || 'Zonas livres sem bloqueios imediatos'}.`;
      }

      // Pergunta sobre Comprar, Vender ou Sinal
      if (
        q.includes('compr') ||
        q.includes('vend') ||
        q.includes('sinal') ||
        q.includes('entr') ||
        q.includes('devo') ||
        q.includes('call') ||
        q.includes('put') ||
        q.includes('gatilho')
      ) {
        if (metrics.verdict === 'CALL') {
          return `O robô identificou confluência de COMPRA na vela atual no par ${selectedAsset.label}! O SuperTrend está verde confirmando suporte dinâmico, e o RSI está em ${rsiVal} com momentum comprador ativo sem exaustão. ${metrics.supplyDemandOk ? 'Temos apoio de Demanda Institucional e POC.' : ''} O gatilho abre no nascimento da vela aos 00 segundos.`;
        } else if (metrics.verdict === 'PUT') {
          return `O robô identificou confluência de VENDA na vela atual no par ${selectedAsset.label}! O SuperTrend está vermelho confirmando resistência dinâmica, e o RSI está em ${rsiVal} com fluxo vendedor ativo sem exaustão. ${metrics.supplyDemandOk ? 'Temos rejeição em Oferta Institucional e POC.' : ''} O gatilho abre no nascimento da vela aos 00 segundos.`;
        } else {
          return `Na vela atual recomendo cautela e proteção no par ${selectedAsset.label}. ${metrics.blocks.join('. ')}. ${metrics.priceAction ? `Comportamento atual: ${metrics.priceAction}.` : ''} O robô aguarda o próximo nascimento aos 00 segundos para validar confluência unânime.`;
        }
      }

      // Pergunta sobre Vela Atual / Tempo / Nascimento
      if (
        q.includes('vela') ||
        q.includes('candle') ||
        q.includes('nascimento') ||
        q.includes('tempo') ||
        q.includes('segundo') ||
        q.includes('fechamento')
      ) {
        const seg = secondsToNextCandle;
        const color = isGreen ? 'verde de avanço comprador' : 'vermelha de recuo vendedor';
        return `A vela atual de 1 minuto em ${selectedAsset.label} é ${color}. Faltam exatamente ${seg} segundos para o nascimento da próxima vela. Lembre-se: o robô executa rigorosamente no nascimento entre 00 e 08 segundos para capturar o verdadeiro movimento do preço.`;
      }

      // Pergunta sobre Tendência / SuperTrend
      if (
        q.includes('tend') ||
        q.includes('supertrend') ||
        q.includes('direção') ||
        q.includes('direcao') ||
        q.includes('alta ou baixa')
      ) {
        return `A tendência calculada pelo SuperTrend(10, 2) para ${selectedAsset.label} é de ${stDir.toUpperCase()}, posicionado em ${metrics.superTrendValue.toFixed(selectedAsset.precision || 5)}. O RSI está em ${rsiVal}. ${metrics.priceAction || ''}`;
      }

      // Pergunta sobre RSI / Momentum
      if (
        q.includes('rsi') ||
        q.includes('momentum') ||
        q.includes('força') ||
        q.includes('forca') ||
        q.includes('exaustão') ||
        q.includes('exaustao')
      ) {
        const exhaustionStatus =
          metrics.rsiValue >= 70
            ? 'em sobrecompra (acima de 70)'
            : metrics.rsiValue <= 30
            ? 'em sobrevenda (abaixo de 30)'
            : 'em zona de equilíbrio saudável entre 30 e 70';
        return `O oscilador RSI de período 9 está em ${rsiVal}, indicando fluxo ${rsiSide}. O mercado está ${exhaustionStatus}, mantendo a vela atual dentro dos parâmetros da estratégia.`;
      }

      // Pergunta sobre a Estratégia / Como funciona
      if (
        q.includes('estratégia') ||
        q.includes('estrategia') ||
        q.includes('como funciona') ||
        q.includes('regras') ||
        q.includes('robô') ||
        q.includes('robo')
      ) {
        return `A estratégia Prisma IA opera em velas de 1 minuto OTC com 5 pilares: 1) SuperTrend dinâmico (10, 2), 2) Momentum do RSI(9) acima ou abaixo de 50 sem exaustão, 3) Zonas de True Supply & Demand com POC institucional, 4) Rejeição de velas travadas ou dojis, e 5) Entrada instantânea nos primeiros segundos do nascimento da vela.`;
      }

      // Saudações e Ajuda
      if (
        q.includes('olá') ||
        q.includes('ola') ||
        q.includes('oi') ||
        q.includes('bom dia') ||
        q.includes('boa tarde') ||
        q.includes('boa noite') ||
        q.includes('ajuda') ||
        q.includes('quem é você')
      ) {
        return `Olá! Sou a inteligência de voz do robô Prisma IA. Você pode me perguntar se deve comprar ou vender, onde estão as zonas de Oferta e Demanda com POC, como está o SuperTrend e o RSI, ou quanto tempo falta para o nascimento da próxima vela.`;
      }

      // Pergunta geral / Análise da vela atual
      return `Análise em tempo real de ${selectedAsset.label}: Gráfico M1 OTC. SuperTrend em ${stDir} (${metrics.superTrendValue.toFixed(selectedAsset.precision || 5)}), RSI em ${rsiVal} (${rsiSide}). ${metrics.supplyDemandStatus ? `True Supply & Demand: ${metrics.supplyDemandStatus}.` : ''} Diagnóstico da vela atual: ${metrics.verdict === 'CALL' ? 'Sinal ativo de COMPRA' : metrics.verdict === 'PUT' ? 'Sinal ativo de VENDA' : 'Mercado sem confluência, aguardando nascimento da próxima vela'}.`;
    },
    [candles, metrics, selectedAsset, secondsToNextCandle, autoVoiceAlerts, onToggleAutoVoice]
  );

  // Processa a pergunta do usuário, exibe no chat e FALA a resposta por voz
  const handleUserQuery = useCallback(
    (text: string) => {
      const cleanText = text.trim();
      if (!cleanText) return;

      const nowTime = new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date());

      // Adiciona a pergunta do usuário no chat
      setMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, sender: 'user', text: cleanText, time: nowTime },
      ]);
      setInputText('');
      setTranscript('');
      setVoiceError(null);

      // Gera resposta do robô
      const botReply = generateMarketExplanation(cleanText);

      setTimeout(() => {
        const replyTime = new Intl.DateTimeFormat('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date());

        setMessages((prev) => [
          ...prev,
          { id: `bot-${Date.now()}`, sender: 'bot', text: botReply, time: replyTime },
        ]);

        // Executa a resposta em voz alta pelo sintetizador nativo
        speakVoiceNotification(botReply, {
          onStart: () => setIsSpeaking(true),
          onEnd: () => setIsSpeaking(false),
        });
      }, 350);
    },
    [generateMarketExplanation]
  );

  // Inicia o reconhecimento de voz do microfone
  const startListening = useCallback(() => {
    playClickSound();
    setVoiceError(null);

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceError('Seu navegador não suporta reconhecimento de voz. Você pode digitar sua pergunta abaixo.');
      return;
    }

    try {
      // Para qualquer gravação anterior
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          // ignore
        }
      }

      const recognition = new SpeechRecognition();
      recognition.lang = 'pt-BR';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      capturedTextRef.current = '';
      hasSubmittedRef.current = false;
      setTranscript('');

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let finalStr = '';
        let interimStr = '';

        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            finalStr += res[0].transcript + ' ';
          } else {
            interimStr += res[0].transcript;
          }
        }

        const totalCaptured = (finalStr + interimStr).trim();
        setTranscript(totalCaptured);
        capturedTextRef.current = totalCaptured;
      };

      recognition.onerror = (event: any) => {
        console.warn('Erro de reconhecimento de voz:', event.error);
        setIsListening(false);
        if (event.error === 'not-allowed') {
          setVoiceError('Permissão do microfone negada. Clique no ícone de cadeado do navegador para permitir o microfone.');
        } else if (event.error === 'no-speech') {
          // Usuário não falou a tempo
          setVoiceError('Não detectamos sua voz. Fale mais perto do microfone.');
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        const textToSubmit = capturedTextRef.current.trim();
        if (textToSubmit && !hasSubmittedRef.current) {
          hasSubmittedRef.current = true;
          handleUserQuery(textToSubmit);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.warn('Falha ao acionar microfone:', err);
      setIsListening(false);
      setVoiceError('Não foi possível iniciar o microfone. Tente novamente ou digite no campo.');
    }
  }, [handleUserQuery]);

  // Interrompe o microfone manualmente e envia o que foi falado
  const stopListening = useCallback(() => {
    playClickSound();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // ignore
      }
    }
    setIsListening(false);
    const textToSubmit = capturedTextRef.current.trim();
    if (textToSubmit && !hasSubmittedRef.current) {
      hasSubmittedRef.current = true;
      handleUserQuery(textToSubmit);
    }
  }, [handleUserQuery]);

  // Interrompe a fala do robô
  const handleStopSpeaking = () => {
    playClickSound();
    stopSpeaking();
    setIsSpeaking(false);
  };

  // Reouvir uma mensagem específica do robô
  const handleReplayMessage = (text: string) => {
    playClickSound();
    speakVoiceNotification(text, {
      onStart: () => setIsSpeaking(true),
      onEnd: () => setIsSpeaking(false),
    });
  };

  const quickQuestions = [
    'Devo comprar ou vender na vela atual?',
    'Onde estão as zonas de Oferta e Demanda (POC)?',
    'Qual a tendência calculada pelo SuperTrend?',
    'Como está o RSI e o momentum?',
    'Quanto tempo falta para a próxima vela?',
  ];

  return (
    <div className="bg-[#050b14]/95 border border-emerald-500/30 rounded-2xl shadow-2xl backdrop-blur-md overflow-hidden font-mono">
      {/* Header do Assistente */}
      <div className="p-4 bg-gradient-to-r from-emerald-950/60 via-slate-900 to-black/80 border-b border-emerald-500/20 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <Bot className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black text-white">ASSISTENTE DE VOZ IA DO ROBÔ</h3>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                AO VIVO
              </span>
              {isSpeaking && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold animate-pulse flex items-center gap-1">
                  <Volume2 className="w-3 h-3" /> ROBÔ FALANDO...
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              Aperte o microfone, faça sua pergunta e o robô vai te responder por voz
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Botão de interromper voz se o robô estiver falando */}
          {isSpeaking && (
            <button
              type="button"
              id="btn-stop-voice"
              onClick={handleStopSpeaking}
              className="text-xs px-2.5 py-1 rounded-lg border border-amber-500/50 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 flex items-center gap-1.5 cursor-pointer font-bold animate-pulse"
              title="Interromper a fala do robô"
            >
              <Square className="w-3 h-3 fill-amber-300" />
              <span>PARAR FALA</span>
            </button>
          )}

          {/* Toggle de Alertas Automáticos por Voz */}
          <button
            type="button"
            id="btn-toggle-auto-voice"
            onClick={onToggleAutoVoice}
            className={`text-xs px-2.5 py-1 rounded-lg border font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
              autoVoiceAlerts
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
            title="O robô avisa por voz automaticamente quando detectar um sinal novo"
          >
            {autoVoiceAlerts ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Avisos por Voz:</span>
            <span>{autoVoiceAlerts ? 'LIGADO' : 'MUDO'}</span>
          </button>

          {/* Minimizar / Expandir */}
          <button
            type="button"
            id="btn-toggle-assistant-accordion"
            onClick={() => setIsOpen(!isOpen)}
            className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
            title={isOpen ? 'Recolher assistente' : 'Expandir assistente'}
          >
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="p-4 space-y-3">
          {/* Caixa de Diálogo do Robô */}
          <div className="h-48 overflow-y-auto space-y-2.5 pr-1 bg-black/50 border border-slate-800 rounded-xl p-3 text-xs">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2.5 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.sender === 'bot' && (
                  <div className="w-6 h-6 rounded bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center flex-shrink-0 text-emerald-400 mt-0.5">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] p-2.5 rounded-xl ${
                    msg.sender === 'user'
                      ? 'bg-emerald-600/30 border border-emerald-500/40 text-emerald-100 rounded-br-none'
                      : 'bg-slate-900 border border-slate-700 text-slate-200 rounded-bl-none'
                  }`}
                >
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  <div className="flex items-center justify-between gap-2 mt-1 pt-1 border-t border-slate-800/60 text-[9px] text-slate-400">
                    <span>{msg.sender === 'user' ? 'Você (via Voz/Texto)' : 'Prisma IA Voz'}</span>
                    <div className="flex items-center gap-2">
                      {msg.sender === 'bot' && (
                        <button
                          type="button"
                          onClick={() => handleReplayMessage(msg.text)}
                          className="hover:text-emerald-400 flex items-center gap-1 transition-colors cursor-pointer"
                          title="Ouvir esta resposta novamente"
                        >
                          <Play className="w-2.5 h-2.5 fill-current" />
                          <span>Ouvir</span>
                        </button>
                      )}
                      <span>{msg.time}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Indicador de fala / escuta ativa */}
          {isListening && (
            <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-500/60 flex items-center gap-3 animate-pulse">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-4 bg-emerald-400 rounded-full animate-bounce" />
                <span className="w-1.5 h-6 bg-emerald-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-8 bg-emerald-400 rounded-full animate-bounce [animation-delay:300ms]" />
                <span className="w-1.5 h-5 bg-emerald-400 rounded-full animate-bounce [animation-delay:450ms]" />
              </div>
              <div className="text-xs text-emerald-300 flex-1">
                <strong className="text-white block">Estou ouvindo você... Pode falar agora!</strong>
                <span className="text-emerald-400 italic">
                  {transcript || 'Exemplo: "Devo comprar ou vender na vela atual?" ou "Onde está a Oferta e Demanda?"'}
                </span>
              </div>
              <button
                type="button"
                onClick={stopListening}
                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer"
              >
                Concluir
              </button>
            </div>
          )}

          {/* Notificação de Erro no Microfone, se houver */}
          {voiceError && (
            <div className="p-2.5 rounded-xl bg-amber-950/50 border border-amber-500/40 text-amber-300 text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 flex-shrink-0 text-amber-400" />
                <span>{voiceError}</span>
              </div>
              <button
                type="button"
                onClick={() => setVoiceError(null)}
                className="text-[10px] underline hover:text-white cursor-pointer flex-shrink-0"
              >
                Fechar
              </button>
            </div>
          )}

          {/* Atalhos de Perguntas Rápidas */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] scrollbar-none">
            <span className="text-slate-500 flex items-center gap-1 text-[10px] uppercase font-bold flex-shrink-0">
              <MessageSquare className="w-3 h-3 text-emerald-400" /> Comandos Rápidos:
            </span>
            {quickQuestions.map((q, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  playClickSound();
                  handleUserQuery(q);
                }}
                className="whitespace-nowrap px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-emerald-950/50 border border-slate-800 hover:border-emerald-500/30 text-slate-300 hover:text-emerald-300 transition-colors cursor-pointer text-xs"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Barra de Input & Botão Principal de Microfone */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleUserQuery(inputText);
            }}
            className="flex items-center gap-2 pt-1"
          >
            {/* Botão de Falar no Microfone */}
            <button
              type="button"
              id="btn-speak-into-microphone"
              onClick={isListening ? stopListening : startListening}
              className={`px-4 py-2.5 rounded-xl border font-mono font-bold flex items-center gap-2 transition-all cursor-pointer ${
                isListening
                  ? 'bg-rose-600 hover:bg-rose-500 text-white border-rose-400 animate-pulse shadow-lg shadow-rose-600/40'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 border-emerald-300 shadow-md shadow-emerald-500/25 active:scale-95'
              }`}
              title="Clique para falar no microfone. O robô entenderá e responderá por voz."
            >
              {isListening ? (
                <>
                  <MicOff className="w-4 h-4 text-white" />
                  <span className="text-xs font-black">PARAR GRAVAÇÃO</span>
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4 text-slate-950" />
                  <span className="text-xs font-black">FALAR NO MICROFONE</span>
                </>
              )}
            </button>

            <input
              type="text"
              id="input-voice-assistant-text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Digite ou aperte o microfone para falar..."
              className="flex-1 bg-black/60 border border-slate-800 focus:border-emerald-500/60 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 outline-none transition-colors"
            />

            <button
              type="submit"
              id="btn-send-assistant-message"
              disabled={!inputText.trim()}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-emerald-600 disabled:opacity-40 text-white border border-slate-700 hover:border-emerald-500 transition-colors cursor-pointer"
              title="Enviar pergunta por texto"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
