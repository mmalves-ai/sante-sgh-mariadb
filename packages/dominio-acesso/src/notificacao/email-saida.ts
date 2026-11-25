// Saída do e-mail do sistema (01-ADM L77): regras puras de por onde e com que texto sai cada mensagem automática.
// - O servidor é o cadastrado no cliente (servidor_email): o da finalidade antes do geral, o do estabelecimento antes
//   do de todos, o padrão antes dos outros; só os ativos.
// - Fora de produção (nenhuma mensagem externa) a conexão é SEMPRE a captura local do ambiente, sem autenticação nem
//   senha; do servidor cadastrado vêm só o remetente e o "responder para". Em produção, o servidor cadastrado com a
//   segurança dele e a senha lida do cofre pela referência; sem servidor cadastrado, o servidor do ambiente.
// - O texto vem do modelo vigente da finalidade (modelo_email): os marcadores são trocados pelos valores do alerta;
//   marcador sem valor devolve `faltando` e quem envia usa o texto padrão (o alerta nunca se perde por um modelo
//   incompleto).
import { preencherModelo, type SegurancaEmail, SEGURANCAS_EMAIL } from './email-configuracao.js';

/** A finalidade (finalidade_email.codigo, carga inicial da migração 02_ADM/99) de cada alerta da fila de e-mail. */
export const FINALIDADE_DO_ALERTA: Readonly<Record<string, string>> = {
  'alerta-emergencia': 'ALERTA_EMERGENCIA',
  'alerta-suporte': 'ALERTA_SUPORTE',
  'alerta-leitura': 'ALERTA_LEITURA',
  'alerta-chamado': 'ALERTA_CHAMADO',
};

export interface ServidorDeSaida {
  readonly id: number;
  /** Nulo: vale para todos os estabelecimentos. */
  readonly estabelecimento: number | null;
  /** Nulo: atende todas as finalidades. */
  readonly finalidade: number | null;
  readonly host: string;
  readonly porta: number;
  readonly seguranca: string;
  readonly exigeAutenticacao: boolean;
  readonly usuarioAutenticacao: string | null;
  readonly referenciaCofre: string | null;
  readonly remetenteEmail: string;
  readonly remetenteNome: string | null;
  readonly responderPara: string | null;
  readonly tempoLimiteSegundos: number;
  readonly padrao: boolean;
  readonly ativo: boolean;
}

/** O servidor que atende a finalidade no estabelecimento (null: nenhum cadastrado serve). */
export function servidorDaSaida<S extends ServidorDeSaida>(
  servidores: readonly S[],
  finalidade: number | null,
  estabelecimento: number | null,
): S | null {
  const servem = servidores.filter(
    (s) =>
      s.ativo &&
      (s.finalidade === null || s.finalidade === finalidade) &&
      (s.estabelecimento === null || s.estabelecimento === estabelecimento),
  );
  servem.sort(
    (a, b) =>
      Number(b.finalidade !== null) - Number(a.finalidade !== null) ||
      Number(b.estabelecimento !== null) - Number(a.estabelecimento !== null) ||
      Number(b.padrao) - Number(a.padrao) ||
      a.id - b.id,
  );
  return servem[0] ?? null;
}

/** Por onde a mensagem sai: endereço, segurança e, quando autentica, o usuário e a referência da senha no cofre. */
export interface ConexaoDeSaida {
  readonly host: string;
  readonly porta: number;
  readonly seguranca: SegurancaEmail;
  readonly tempoLimiteSegundos: number;
  readonly usuario: string | null;
  readonly referenciaCofre: string | null;
  readonly remetente: string;
  readonly remetenteNome: string | null;
  readonly responderPara: string | null;
  /** O servidor cadastrado usado (nulo: o do ambiente); vai ao registro de envio. */
  readonly servidor: number | null;
}

export type RecusaSaida = 'sem-servidor' | 'senha-indisponivel';
export const MENSAGEM_SAIDA: Readonly<Record<RecusaSaida, string>> = {
  'sem-servidor': 'Nenhum servidor de e-mail cadastrado nem configurado no ambiente.',
  'senha-indisponivel': 'A senha do servidor de e-mail não está no cofre.',
};

export interface AmbienteDeSaida {
  readonly producao: boolean;
  /** O servidor do ambiente (fora de produção, a captura local). */
  readonly local: { readonly host: string; readonly porta: number } | null;
  /** Remetente padrão quando nada cadastrado o define. */
  readonly remetentePadrao: string;
}

export function conexaoDaSaida(
  servidor: ServidorDeSaida | null,
  amb: AmbienteDeSaida,
): ConexaoDeSaida | { readonly recusa: RecusaSaida } {
  const doCadastro = {
    remetente: servidor?.remetenteEmail ?? amb.remetentePadrao,
    remetenteNome: servidor?.remetenteNome ?? null,
    responderPara: servidor?.responderPara ?? null,
  };
  const pelaCaptura = (servidorId: number | null): ConexaoDeSaida | { recusa: RecusaSaida } =>
    amb.local
      ? {
          host: amb.local.host,
          porta: amb.local.porta,
          seguranca: 'nenhuma',
          tempoLimiteSegundos: 30,
          usuario: null,
          referenciaCofre: null,
          ...doCadastro,
          servidor: servidorId,
        }
      : { recusa: 'sem-servidor' };
  if (!amb.producao) return pelaCaptura(servidor?.id ?? null);
  if (!servidor) return pelaCaptura(null);
  const seguranca = (SEGURANCAS_EMAIL as readonly string[]).includes(servidor.seguranca)
    ? (servidor.seguranca as SegurancaEmail)
    : 'starttls';
  return {
    host: servidor.host,
    porta: servidor.porta,
    seguranca,
    tempoLimiteSegundos: Math.min(Math.max(servidor.tempoLimiteSegundos, 5), 300),
    usuario: servidor.exigeAutenticacao ? servidor.usuarioAutenticacao : null,
    referenciaCofre: servidor.exigeAutenticacao ? servidor.referenciaCofre : null,
    ...doCadastro,
    servidor: servidor.id,
  };
}

/** O texto simples de um corpo HTML (quando o modelo não tem a versão em texto). */
export function textoDoHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface ModeloDeSaida {
  readonly id: number;
  readonly assunto: string;
  readonly corpoHtml: string;
  readonly corpoTexto: string | null;
  readonly remetenteEmail: string | null;
  readonly remetenteNome: string | null;
  readonly responderPara: string | null;
}

export type TextoDoModelo =
  | {
      readonly assunto: string;
      readonly texto: string;
      readonly remetente: string | null;
      readonly remetenteNome: string | null;
      readonly responderPara: string | null;
    }
  | { readonly faltando: readonly string[] };

/** Assunto e texto pelo modelo, com os valores (o assunto sem quebra de linha). */
export function textoPeloModelo(m: ModeloDeSaida, valores: Readonly<Record<string, string>>): TextoDoModelo {
  const assunto = preencherModelo(m.assunto, valores);
  const corpo = preencherModelo(m.corpoTexto?.trim() ? m.corpoTexto : textoDoHtml(m.corpoHtml), valores);
  const faltando = [...new Set([...assunto.faltando, ...corpo.faltando])];
  if (faltando.length > 0) return { faltando };
  return {
    assunto: assunto.texto.replace(/\s+/g, ' ').trim().slice(0, 250),
    texto: corpo.texto,
    remetente: m.remetenteEmail,
    remetenteNome: m.remetenteNome,
    responderPara: m.responderPara,
  };
}

/**
 * Os valores dos marcadores de um alerta: cada campo simples do alerta como `alerta.<campo>` (em minúsculas com
 * sublinhado, como o marcador exige: idEmergencia vira alerta.id_emergencia) e o texto padrão como
 * `alerta.assunto` e `alerta.texto` (o modelo pode só envolver o texto padrão).
 */
export function valoresDoAlerta(
  dados: unknown,
  padrao: { readonly assunto: string; readonly texto: string },
): Record<string, string> {
  const r: Record<string, string> = { 'alerta.assunto': padrao.assunto, 'alerta.texto': padrao.texto };
  if (typeof dados === 'object' && dados !== null)
    for (const [k, v] of Object.entries(dados))
      if (/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k) && (typeof v === 'string' || typeof v === 'number'))
        r[`alerta.${k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`] = String(v);
  return r;
}
