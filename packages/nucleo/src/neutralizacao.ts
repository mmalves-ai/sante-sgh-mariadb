// Neutralização fora de produção (AGENTS, regra 6): em dev, ci, homologação e treino nada sai para fora. O banco é
// de loopback, o e-mail vai para a captura local, WhatsApp e SMS ficam desligados e todo endereço de integração
// (TISS, laboratório, governo…) aponta para destino local ou falso. O envio externo só existe com
// AMBIENTE=producao. As mensagens citam só o nome da chave, nunca o valor (pode haver segredo).
import type { Ambiente } from './ambiente.js';
import { ErroConfiguracao } from './erros.js';

export const AMBIENTES = ['dev', 'ci', 'homolog', 'treino', 'producao'] as const;
export type NomeAmbiente = (typeof AMBIENTES)[number];

export interface ItemNeutralizacao {
  readonly regra: string;
  readonly ok: boolean;
  readonly detalhe: string;
}

export interface ResultadoNeutralizacao {
  readonly ambiente: NomeAmbiente;
  /** Em produção a neutralização não se aplica. */
  readonly aplicavel: boolean;
  readonly itens: readonly ItemNeutralizacao[];
  readonly ok: boolean;
}

/** O ambiente (AMBIENTE; ausente é dev). Valor fora da lista é erro. */
export function ambienteDe(env: Ambiente): NomeAmbiente {
  const a = env['AMBIENTE']?.trim() || 'dev';
  if (!(AMBIENTES as readonly string[]).includes(a))
    throw new ErroConfiguracao(`AMBIENTE deve ser ${AMBIENTES.join(' | ')}.`);
  return a as NomeAmbiente;
}

/** O envio para fora (e-mail real, WhatsApp, SMS, TISS, laboratório) só existe em produção. */
export function envioExternoPermitido(env: Ambiente): boolean {
  return ambienteDe(env) === 'producao';
}

export class ErroEnvioNeutralizado extends Error {
  override readonly name = 'ErroEnvioNeutralizado';
}

/** Guarda dos adaptadores de saída: fora de produção, lança antes de qualquer envio externo. */
export function exigirEnvioExterno(env: Ambiente, canal: string): void {
  if (!envioExternoPermitido(env))
    throw new ErroEnvioNeutralizado(`Envio externo (${canal}) neutralizado: AMBIENTE=${ambienteDe(env)}.`);
}

export function ehLoopback(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(?:\.\d{1,3}){3}$/.test(h);
}

// Rótulo sem ponto que o resolvedor lê como endereço IP (0x08080808, 010.., 134744072): nunca é nome de container.
const ROTULO_NUMERICO = /^(?:0x[0-9a-f]*|\d+)$/i;

/**
 * Destino que não sai da máquina: loopback, nomes reservados (.invalid, .test, .localhost, .example) ou um container
 * local declarado em `containers` (SGH_CONTAINERS_LOCAIS). Nome sem ponto fora da lista é recusado: o domínio de busca
 * ou o /etc/hosts podem resolvê-lo para fora, e a forma numérica (hexadecimal, octal, decimal) é um IP.
 */
export function ehDestinoLocal(host: string, containers: readonly string[] = []): boolean {
  const h = host.trim().toLowerCase();
  if (ehLoopback(h)) return true;
  if (/^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.(?:invalid|test|localhost|example)$/.test(h)) return true;
  if (ROTULO_NUMERICO.test(h)) return false;
  return /^[a-z][a-z0-9_-]*$/.test(h) && containers.some((c) => c.trim().toLowerCase() === h);
}

/** Containers locais aceitos como destino (SGH_CONTAINERS_LOCAIS, separados por vírgula). */
export function containersLocais(env: Ambiente): string[] {
  return (env['SGH_CONTAINERS_LOCAIS'] ?? '')
    .split(/[,\s]+/)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

/** Hosts citados num valor de configuração (URL, host[:porta] ou lista separada por vírgula). */
export function hostsDoValor(valor: string): string[] {
  const hosts: string[] = [];
  for (const parte of valor.split(/[,\s]+/).filter(Boolean)) {
    try {
      const u = new URL(parte.includes('://') ? parte : `x://${parte}`);
      if (u.hostname) hosts.push(u.hostname);
    } catch {
      hosts.push('<ilegível>');
    }
  }
  return hosts;
}

const CHAVE_DE_ENDERECO = /(?:_URL|_URI|_HOST|_ENDPOINT|_ENDERECO|_SERVIDOR|_WSDL|_DSN)$/;
// Canais de mensagem a pessoas (WhatsApp, SMS, push e os provedores comuns deles).
const CANAL_DESLIGAVEL = /^(?:WHATSAPP|WPP|SMS|TWILIO|ZENVIA|GUPSHUP|TELEGRAM|PUSH|FCM|ONESIGNAL|META_WA|MENSAGERIA)_/;
const CREDENCIAL = /_(?:TOKEN|CHAVE|SENHA|SEGREDO|SECRET|KEY|APIKEY|API_KEY|PASSWORD|SID)$/;
const LIGADO = /^(?:1|sim|true|ligado|ativo|on)$/i;

function item(regra: string, falhas: readonly string[], okDetalhe: string): ItemNeutralizacao {
  return falhas.length === 0
    ? { regra, ok: true, detalhe: okDetalhe }
    : { regra, ok: false, detalhe: `fora do permitido: ${falhas.join(', ')}` };
}

/** Confere a configuração. Em produção não se aplica. */
export function verificarNeutralizacao(env: Ambiente): ResultadoNeutralizacao {
  const ambiente = ambienteDe(env);
  if (ambiente === 'producao') return { ambiente, aplicavel: false, itens: [], ok: true };
  const chaves = Object.keys(env).sort();
  const containers = containersLocais(env);
  const banco = env['SGH_MARIADB_HOST']?.trim() || '127.0.0.1';
  const smtp = env['SMTP_HOST']?.trim();
  const canais = chaves.filter(
    (k) =>
      CANAL_DESLIGAVEL.test(k) &&
      /_(?:HABILITADO|ATIVO|LIGADO)$/.test(k) &&
      LIGADO.test(env[k]?.trim() ?? ''),
  );
  const credenciaisDeCanal = chaves.filter(
    (k) =>
      CANAL_DESLIGAVEL.test(k) && CREDENCIAL.test(k) && (env[k]?.trim() ?? '') !== '',
  );
  const enderecos = chaves.filter(
    (k) =>
      k !== 'SGH_MARIADB_HOST' &&
      k !== 'SMTP_HOST' &&
      CHAVE_DE_ENDERECO.test(k) &&
      (env[k]?.trim() ?? '') !== '' &&
      hostsDoValor(env[k] ?? '').some((h) => !ehDestinoLocal(h, containers)),
  );
  const itens = [
    item('banco em loopback', ehLoopback(banco) ? [] : ['SGH_MARIADB_HOST'], 'MariaDB só em loopback'),
    item(
      'e-mail na captura local',
      smtp && hostsDoValor(smtp).some((h) => !ehDestinoLocal(h, containers)) ? ['SMTP_HOST'] : [],
      'SMTP local ou ausente',
    ),
    item(
      'WhatsApp e SMS desligados',
      [...canais, ...credenciaisDeCanal],
      'canais desligados e sem credencial',
    ),
    item('integrações para destino local ou falso', enderecos, 'nenhum endereço externo'),
  ];
  return { ambiente, aplicavel: true, itens, ok: itens.every((i) => i.ok) };
}

/** Fora de produção, recusa subir com a configuração não neutralizada (cita só as chaves). */
export function exigirNeutralizacao(env: Ambiente): ResultadoNeutralizacao {
  const r = verificarNeutralizacao(env);
  if (!r.ok) throw new ErroConfiguracao(formatarNeutralizacao(r));
  return r;
}

export function formatarNeutralizacao(r: ResultadoNeutralizacao): string {
  if (!r.aplicavel) return `AMBIENTE=${r.ambiente}: neutralização não se aplica.`;
  return [
    `Neutralização (AMBIENTE=${r.ambiente}):`,
    ...r.itens.map((i) => `  ${i.ok ? 'ok   ' : 'FALHA'}  ${i.regra}: ${i.detalhe}`),
    r.ok ? 'Resultado: ok (nada sai para fora)' : 'Resultado: FALHA (o processo não sobe)',
  ].join('\n');
}
