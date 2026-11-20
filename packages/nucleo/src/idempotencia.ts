// Idempotência por chave (idempotencia_operacao): a mesma chave com a mesma entrada devolve o resultado da primeira
// execução sem gravar de novo; com outra entrada, ou usada por outra pessoa, é recusada (422). O registro é
// gravado na mesma transação da operação; duas execuções simultâneas da mesma chave: a segunda espera a trava da
// chave única e recebe 409 requisicao-em-andamento.
import { createHash } from 'node:crypto';
import { erroRequisicaoEmAndamento, restricaoUnicaViolada } from './erros.js';
import { paraJson } from './trilha.js';
import type { Escritor, Leitor } from './transacao.js';

export const FORMATO_CHAVE_IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;
export const RESTRICAO_IDEMPOTENCIA = 'uq_idempotencia_operacao_chave';

/** Valores de resultado guardados e devolvidos à repetição: só ids e códigos. */
export type ResultadoOperacao = Readonly<Record<string, number | string | boolean | null>>;

/** JSON canônico (chaves em ordem) para o hash da entrada. */
export function jsonCanonico(v: unknown): string {
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (typeof v === 'bigint') return JSON.stringify(v.toString());
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function hashEntrada(operacao: string, entrada: unknown): string {
  return createHash('sha256')
    .update(`${operacao}\u0000${jsonCanonico(entrada)}`, 'utf8')
    .digest('hex');
}

export interface RegistroIdempotencia {
  readonly hashEntrada: string;
  readonly usuario: number | null;
  readonly resultado: ResultadoOperacao;
  readonly trilha: number | null;
}

/** A execução anterior da chave nesta operação, ou null. */
export async function lerIdempotencia(
  l: Leitor,
  operacao: string,
  chave: string,
): Promise<RegistroIdempotencia | null> {
  const r = await l.uma<{
    hash_entrada: string;
    usuario_id: number | null;
    resultado: unknown;
    trilha_auditoria_id: number | null;
  }>(
    'SELECT hash_entrada, usuario_id, resultado, trilha_auditoria_id FROM idempotencia_operacao WHERE operacao = ? AND chave = ?',
    [operacao, chave],
  );
  if (!r) return null;
  const resultado = (
    typeof r.resultado === 'string' ? JSON.parse(r.resultado) : r.resultado
  ) as ResultadoOperacao;
  return {
    hashEntrada: r.hash_entrada,
    usuario: r.usuario_id === null ? null : Number(r.usuario_id),
    resultado,
    trilha: r.trilha_auditoria_id === null ? null : Number(r.trilha_auditoria_id),
  };
}

export interface NovoRegistroIdempotencia {
  readonly operacao: string;
  readonly chave: string;
  readonly estabelecimento: number | null;
  readonly usuario: number | null;
  readonly hashEntrada: string;
  readonly resultado: ResultadoOperacao;
  readonly trilha: number | null;
  readonly agora: Date;
}

/** Grava o registro da chave; a chave já gravada por outra transação vira 409 requisicao-em-andamento. */
export async function gravarIdempotencia(e: Escritor, r: NovoRegistroIdempotencia): Promise<void> {
  try {
    await e.inserir(
      'INSERT INTO idempotencia_operacao (operacao, chave, estabelecimento_id, usuario_id, hash_entrada, resultado, trilha_auditoria_id, criado_em, criado_por, versao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
      [
        r.operacao,
        r.chave,
        r.estabelecimento,
        r.usuario,
        r.hashEntrada,
        paraJson(r.resultado),
        r.trilha,
        r.agora,
        r.usuario,
      ],
    );
  } catch (erro) {
    if (restricaoUnicaViolada(erro) === RESTRICAO_IDEMPOTENCIA) throw erroRequisicaoEmAndamento();
    throw erro;
  }
}
