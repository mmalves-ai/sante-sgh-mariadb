// Gravação do valor do índice de cobrança e do porte por vigência (06-FAT linha 5), pelo Executor (trilha, autoria e
// idempotência na mesma transação). A mudança de valor é sempre uma vigência NOVA: nada se altera nem se apaga (o
// histórico fica, e a leitura vale a maior vigência ≤ data). A validação é do @sgh/dominio-preco
// (validarRegistroIndice); aqui se confere o escopo da sessão e grava.
//   preco.registrar-indice            valor_indice: CH, UCO ou filme do acordo (sem tabela) ou de uma tabela do acordo
//   preco.registrar-porte             valor_porte_medico: porte de honorário do acordo ou de uma tabela do acordo
//   preco.registrar-porte-anestesico  valor_porte_anestesico: porte anestésico (0 a 8) de uma tabela do acordo
// Só para a fonte pagadora com acordo no estabelecimento da sessão; a tabela é sempre deste estabelecimento, e o valor
// do acordo (sem tabela) é gravado para o estabelecimento da sessão (estabelecimento_id): nunca muda a cobrança de outro.
import { validarRegistroIndice } from '@sgh/dominio-preco';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

type Linha = Record<string, unknown>;

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '';

const comum = {
  fonteId: id,
  tabelaId: id.nullable().default(null),
  vigenciaInicio: data,
  valor: z.number().finite(),
  motivoAlteracao: z.string().max(500).nullable().default(null),
};
function trilhaMotivo<T extends { motivoAlteracao: string | null }>(e: T): Record<string, string> {
  return e.motivoAlteracao?.trim() ? { motivo: e.motivoAlteracao.trim() } : {};
}

function estDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.', { campos: [] });
  return ctx.estabelecimento;
}

function exigirValido(erros: Record<string, string>) {
  const campos = Object.keys(erros);
  if (campos.length) throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos });
}

/** A fonte tem acordo (fora do rascunho) no estabelecimento; a tabela, quando dada, é de honorários do acordo. */
async function conferirEscopo(tx: TxOperacao, fonte: number, est: number, tabela: number | null) {
  const k = await tx.uma<Linha>(
    `SELECT id FROM contrato_fonte_pagadora
      WHERE fonte_pagadora_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'rascunho' LIMIT 1`,
    [fonte, est],
  );
  if (!k)
    throw recusa(
      'sem-acordo',
      'A fonte pagadora não tem acordo neste estabelecimento: cadastre o contrato antes dos índices.',
      { campos: ['fonteId'] },
    );
  if (tabela === null) return;
  const t = await tx.uma<Linha>(
    `SELECT ctv.id FROM contrato_tabela_vigencia ctv
       JOIN contrato_fonte_pagadora k ON k.id = ctv.contrato_fonte_pagadora_id
       JOIN tabela_preco t ON t.id = ctv.tabela_preco_id AND t.estabelecimento_id = k.estabelecimento_id
      WHERE k.fonte_pagadora_id = ? AND k.estabelecimento_id = ? AND k.excluido_em IS NULL AND ctv.tabela_preco_id = ?
        AND ctv.tipo_item IN ('honorario_internacao', 'honorario_ambulatorial') LIMIT 1`,
    [fonte, est, tabela],
  );
  if (!t)
    throw recusa('referencia-inexistente', 'A tabela não é de honorários do acordo deste estabelecimento.', {
      campos: ['tabelaId'],
    });
}

const inicios = (ls: Linha[]) => ls.map((r) => dataIso(r['vigencia_inicio']));

async function agoraDoBanco(tx: TxOperacao): Promise<Date> {
  const r = await tx.uma<Linha>('SELECT NOW(3) AS agora', []);
  return r?.['agora'] instanceof Date ? (r['agora'] as Date) : new Date();
}

// ── Índice (CH, UCO, filme) ────────────────────────────────────────────────────────────────────────────

export const esquemaRegistrarIndice = z.object({ ...comum, indiceId: id });

export const opRegistrarIndice = definirOperacao({
  nome: 'preco.registrar-indice',
  tabelas: ['valor_indice'],
  entrada: esquemaRegistrarIndice,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    await conferirEscopo(tx, e.fonteId, est, e.tabelaId);
    const ic = await tx.uma<Linha>('SELECT id FROM indice_cobranca WHERE id = ? AND ativo = TRUE', [
      e.indiceId,
    ]);
    if (!ic)
      throw recusa('referencia-inexistente', 'O índice não existe ou está inativo.', {
        campos: ['indiceId'],
      });
    // Escopo da linha: o acordo (fonte, sem tabela) neste estabelecimento ou a tabela do acordo (sem fonte), como a
    // leitura lê.
    const fonte = e.tabelaId === null ? e.fonteId : null;
    const estDaLinha = e.tabelaId === null ? est : null;
    const existentes = await tx.consultar<Linha>(
      `SELECT vigencia_inicio FROM valor_indice
        WHERE indice_cobranca_id = ? AND fonte_pagadora_id <=> ? AND tabela_preco_id <=> ? AND estabelecimento_id <=> ?
          AND operacao <> 'exclusao'`,
      [e.indiceId, fonte, e.tabelaId, estDaLinha],
    );
    exigirValido(
      validarRegistroIndice({
        tipo: 'indice',
        vigenciaInicio: e.vigenciaInicio,
        valor: e.valor,
        vigenciasExistentes: inicios(existentes),
      }),
    );
    const novo = await tx.incluir('valor_indice', {
      indice_cobranca_id: e.indiceId,
      operacao: 'inclusao',
      ocorrido_em: await agoraDoBanco(tx),
      usuario_id: ctx.usuario,
      fonte_pagadora_id: fonte,
      tabela_preco_id: e.tabelaId,
      estabelecimento_id: estDaLinha,
      vigencia_inicio: e.vigenciaInicio,
      valor_indice: e.valor,
    });
    return { id: novo };
  },
  alvo: (_e, s) => ({ tabela: 'valor_indice', id: s.id }),
  trilha: (e) => trilhaMotivo(e),
});

// ── Porte de honorário ─────────────────────────────────────────────────────────────────────────────────

export const esquemaRegistrarPorte = z.object({ ...comum, porte: z.string().trim().min(1).max(10) });

export const opRegistrarPorte = definirOperacao({
  nome: 'preco.registrar-porte',
  tabelas: ['valor_porte_medico'],
  entrada: esquemaRegistrarPorte,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    await conferirEscopo(tx, e.fonteId, est, e.tabelaId);
    const po = await tx.uma<Linha>(
      "SELECT id FROM porte_procedimento WHERE codigo = ? AND tipo_porte = 'honorario'",
      [e.porte],
    );
    if (!po)
      throw recusa('referencia-inexistente', 'O porte de honorário não existe.', { campos: ['porte'] });
    const fonte = e.tabelaId === null ? e.fonteId : null;
    const estDaLinha = e.tabelaId === null ? est : null;
    const existentes = await tx.consultar<Linha>(
      `SELECT vigencia_inicio FROM valor_porte_medico
        WHERE porte_procedimento_id = ? AND fonte_pagadora_id <=> ? AND tabela_preco_id <=> ? AND estabelecimento_id <=> ?
          AND operacao <> 'exclusao'`,
      [Number(po['id']), fonte, e.tabelaId, estDaLinha],
    );
    exigirValido(
      validarRegistroIndice({
        tipo: 'porte',
        vigenciaInicio: e.vigenciaInicio,
        valor: e.valor,
        vigenciasExistentes: inicios(existentes),
      }),
    );
    const novo = await tx.incluir('valor_porte_medico', {
      porte_procedimento_id: Number(po['id']),
      operacao: 'inclusao',
      ocorrido_em: await agoraDoBanco(tx),
      usuario_id: ctx.usuario,
      fonte_pagadora_id: fonte,
      tabela_preco_id: e.tabelaId,
      estabelecimento_id: estDaLinha,
      vigencia_inicio: e.vigenciaInicio,
      valor: e.valor,
    });
    return { id: novo };
  },
  alvo: (_e, s) => ({ tabela: 'valor_porte_medico', id: s.id }),
  trilha: (e) => trilhaMotivo(e),
});

// ── Porte anestésico (da tabela de honorários do acordo) ───────────────────────────────────────────────

export const esquemaRegistrarPorteAnestesico = z.object({
  ...comum,
  tabelaId: id,
  porte: z.string().regex(/^[0-8]$/),
  valorHorarioEspecial: z.number().finite().nullable().default(null),
});

export const opRegistrarPorteAnestesico = definirOperacao({
  nome: 'preco.registrar-porte-anestesico',
  tabelas: ['valor_porte_anestesico'],
  entrada: esquemaRegistrarPorteAnestesico,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    await conferirEscopo(tx, e.fonteId, est, e.tabelaId);
    const existentes = await tx.consultar<Linha>(
      `SELECT vigencia_inicio FROM valor_porte_anestesico
        WHERE tabela_preco_id = ? AND porte_anestesico = ? AND operacao <> 'exclusao'`,
      [e.tabelaId, e.porte],
    );
    exigirValido(
      validarRegistroIndice({
        tipo: 'porte-anestesico',
        vigenciaInicio: e.vigenciaInicio,
        valor: e.valor,
        valorHorarioEspecial: e.valorHorarioEspecial,
        vigenciasExistentes: inicios(existentes),
      }),
    );
    const novo = await tx.incluir('valor_porte_anestesico', {
      tabela_preco_id: e.tabelaId,
      operacao: 'inclusao',
      ocorrido_em: await agoraDoBanco(tx),
      usuario_id: ctx.usuario,
      porte_anestesico: e.porte,
      vigencia_inicio: e.vigenciaInicio,
      valor: e.valor,
      valor_horario_especial: e.valorHorarioEspecial,
    });
    return { id: novo };
  },
  alvo: (_e, s) => ({ tabela: 'valor_porte_anestesico', id: s.id }),
  trilha: (e) => trilhaMotivo(e),
});

export const OPERACOES_INDICES = {
  indice: opRegistrarIndice,
  porte: opRegistrarPorte,
  'porte-anestesico': opRegistrarPorteAnestesico,
} as const;
export type TipoGravacaoIndice = keyof typeof OPERACOES_INDICES;

/** Gravação dos valores de índice e de porte pelo Executor (trilha, autoria e idempotência). */
export class GravadorIndices {
  private readonly executor: Executor;
  constructor(nucleo: NucleoProprio, executor?: Executor) {
    this.executor = executor ?? nucleo.criarExecutor({});
  }
  async gravar(tipo: TipoGravacaoIndice, ctx: ContextoOperacao, entrada: unknown): Promise<{ id: number }> {
    const op = OPERACOES_INDICES[tipo] as Parameters<Executor['executar']>[0];
    const r = await this.executor.executar(op, ctx.cliente, entrada, ctx);
    return r.resultado as { id: number };
  }
}
