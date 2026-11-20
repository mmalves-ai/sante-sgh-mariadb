// Regra 15a (DP-44 b, decidida em 2026-10-19): toda comunicação com o paciente (WhatsApp, webchat, SMS, lembretes,
// confirmações) é feita pela Hal-AI. O Sante SGH chama as APIs da Hal-AI (ou recursos MCP criados nela) e NÃO
// implementa canal próprio nem provedor direto de WhatsApp ou SMS. Aqui ficam a lista do que conta como canal próprio
// (dependências e endereços de provedores) e as conferências puras; o teste varre os package.json e o código.

/** Pacotes de provedor direto de mensagem (WhatsApp, SMS, chat) que nunca entram no monorepo. */
export const PACOTES_DE_CANAL_PROPRIO = [
  'twilio',
  '@twilio/conversations',
  'zenvia',
  '@zenvia/sdk',
  'whatsapp-web.js',
  '@whiskeysockets/baileys',
  'baileys',
  'venom-bot',
  '@wppconnect-team/wppconnect',
  'messagebird',
  '@vonage/server-sdk',
  'nexmo',
  'plivo',
  'telesignsdk',
  '@infobip-api/sdk',
  'africastalking',
  'clicksend',
  'sinch',
  '@sinch/sdk-core',
  'botbuilder',
  'socket.io-client-whatsapp',
] as const;

/** Endereços de API de provedor de mensagem (código que falasse direto com eles seria canal próprio). */
export const ENDERECOS_DE_CANAL_PROPRIO = [
  /api\.twilio\.com/i,
  /graph\.facebook\.com\/v\d+(?:\.\d+)?\/\d+\/messages/i,
  /api\.zenvia\.com/i,
  /api\.z-api\.io/i,
  /api\.gupshup\.io/i,
  /api\.infobip\.com/i,
  /rest\.nexmo\.com|api\.nexmo\.com/i,
  /api\.plivo\.com/i,
  /api\.messagebird\.com/i,
  /sms\.comtele\.com\.br/i,
] as const;

export interface PacoteDeclarado {
  readonly arquivo: string;
  readonly dependencias: Readonly<Record<string, string>>;
}

/** Dependências de canal próprio declaradas (vazio = conforme). */
export function dependenciasDeCanalProprio(pacotes: readonly PacoteDeclarado[]): string[] {
  const proibidos = new Set<string>(PACOTES_DE_CANAL_PROPRIO);
  const achados: string[] = [];
  for (const p of pacotes)
    for (const d of Object.keys(p.dependencias)) if (proibidos.has(d)) achados.push(`${p.arquivo}: ${d}`);
  return achados.sort();
}

/** Endereços de provedor de mensagem no texto do código (vazio = conforme). */
export function enderecosDeCanalProprio(arquivo: string, conteudo: string): string[] {
  return ENDERECOS_DE_CANAL_PROPRIO.filter((r) => r.test(conteudo)).map((r) => `${arquivo}: ${r.source}`);
}

/** Destino de toda mensagem ao paciente: a Hal-AI (e nada mais). */
export const DESTINO_MENSAGEM_PACIENTE = 'hal-ai' as const;

/**
 * Pode enviar mensagem ao paciente? Só pela Hal-AI, só com a funcionalidade ligada (DP-44 a: base legal) e, fora de
 * produção, só para endereço local (a trava de saídas).
 */
export function podeEnviarAoPaciente(c: {
  readonly ligado: boolean;
  readonly endereco: string | null;
  readonly producao: boolean;
}): { pode: boolean; motivo: string | null } {
  if (!c.ligado)
    return {
      pode: false,
      motivo: 'O envio ao paciente está desligado até a base legal da comunicação (DP-44 a).',
    };
  if (!c.endereco) return { pode: false, motivo: 'Endereço da API da Hal-AI não configurado.' };
  let host: string;
  try {
    host = new URL(c.endereco).hostname;
  } catch {
    return { pode: false, motivo: 'Endereço da API da Hal-AI inválido.' };
  }
  if (!c.producao && !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host))
    return {
      pode: false,
      motivo: 'Fora de produção, só endereço local (nenhuma mensagem real ao paciente).',
    };
  return { pode: true, motivo: null };
}
