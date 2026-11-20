// Trilha de auditoria (trilha_auditoria) e saída de integração (integracao_mensagem, o outbox): gravadas pelo
// executor no mesmo Escritor da gravação, portanto na mesma transação. Desfeita a operação, as duas somem juntas.
// A carga do evento leva só ids e códigos.
import { createHash } from 'node:crypto';
import type { Escritor } from './transacao.js';

export const ACOES_TRILHA = [
  'inclusao',
  'alteracao',
  'exclusao',
  'consulta',
  'impressao',
  'exportacao',
  'login',
  'logout',
  'acesso_negado',
  'quebra_de_vidro',
  'operacao',
] as const;
export type AcaoTrilha = (typeof ACOES_TRILHA)[number];

export interface LinhaTrilha {
  readonly estabelecimento: number | null;
  readonly usuario: number | null;
  readonly acao: AcaoTrilha;
  /** Nome da tabela afetada. */
  readonly entidade: string;
  readonly entidadeId: number | null;
  readonly dadosAntes?: unknown;
  readonly dadosDepois?: unknown;
  readonly motivo?: string | null;
  readonly enderecoIp?: string | null;
  readonly correlacao: string | null;
  readonly ocorridoEm: Date;
}

/** JSON para as colunas JSON (Date em ISO, bigint em texto); undefined vira NULL. */
export function paraJson(v: unknown): string | null {
  if (v === undefined) return null;
  return JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x));
}

/** Grava uma linha da trilha; devolve o id dela. */
export async function gravarTrilha(e: Escritor, l: LinhaTrilha): Promise<number> {
  if (!(ACOES_TRILHA as readonly string[]).includes(l.acao)) throw new Error('Ação de trilha inválida.');
  return e.inserir(
    'INSERT INTO trilha_auditoria (estabelecimento_id, usuario_id, ocorrido_em, acao, entidade, entidade_id, dados_antes, dados_depois, motivo, endereco_ip, correlacao, criado_em, criado_por, versao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
    [
      l.estabelecimento,
      l.usuario,
      l.ocorridoEm,
      l.acao,
      l.entidade.slice(0, 64),
      l.entidadeId,
      paraJson(l.dadosAntes),
      paraJson(l.dadosDepois),
      l.motivo?.slice(0, 500) ?? null,
      l.enderecoIp?.slice(0, 45) ?? null,
      l.correlacao?.slice(0, 64) ?? null,
      l.ocorridoEm,
      l.usuario,
    ],
  );
}

export type CargaEvento = Readonly<Record<string, number | string | boolean | null>>;

export interface MensagemSaida {
  readonly estabelecimento: number | null;
  /** Ponto de integração (o tipo do evento). */
  readonly ponto: string;
  readonly entidade: string | null;
  readonly entidadeId: number | null;
  /** Chave única do evento (vai em referencia_externa; o relay a usa para não enviar duas vezes). */
  readonly chave: string;
  readonly carga: CargaEvento;
  readonly usuario: number | null;
  readonly agora: Date;
}

/** Chave do evento (64 hex): cliente, operação, chave de idempotência e posição. */
export function chaveDoEvento(
  cliente: string,
  operacao: string,
  chaveIdempotencia: string,
  i: number,
): string {
  return createHash('sha256')
    .update(`${cliente}\u0000${operacao}\u0000${chaveIdempotencia}\u0000${i}`, 'utf8')
    .digest('hex');
}

export const FORMATO_PONTO = /^[a-z][a-z0-9_.]{0,79}$/;

/** Grava a mensagem de saída pendente (outbox); devolve o id. O envio é do relay, depois do COMMIT. */
export async function gravarOutbox(e: Escritor, m: MensagemSaida): Promise<number> {
  if (!FORMATO_PONTO.test(m.ponto)) throw new Error('Ponto de integração inválido.');
  return e.inserir(
    "INSERT INTO integracao_mensagem (estabelecimento_id, ponto, direcao, situacao, tentativas, entidade, entidade_id, referencia_externa, conteudo, criado_em, criado_por, versao) VALUES (?, ?, 'saida', 'pendente', 0, ?, ?, ?, ?, ?, ?, 1)",
    [
      m.estabelecimento,
      m.ponto,
      m.entidade?.slice(0, 64) ?? null,
      m.entidadeId,
      m.chave.slice(0, 120),
      paraJson(m.carga),
      m.agora,
      m.usuario,
    ],
  );
}
