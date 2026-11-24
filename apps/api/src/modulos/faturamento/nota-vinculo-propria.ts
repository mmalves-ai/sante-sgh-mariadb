// A nota fiscal de serviço que documenta a fatura do convênio ou a conta do particular, sobre o banco do cliente
// (F3.7, 06-FAT linha 36). Leitura pelo Leitor, gravação pelo Executor (trilha, autoria e idempotência na mesma
// transação). A regra é do @sgh/dominio-faturamento (conta/nota-vinculo): aqui só se lê, confere pelo domínio e grava.
// - Visão do alvo: quanto a fatura ou a conta vale, quanto já está documentado por nota, as notas ligadas e as notas
//   candidatas (da mesma fonte pagadora, com saldo, primeiro as emitidas para o próprio alvo) com o valor sugerido.
// - Ligar de novo uma nota já ligada ajusta o valor na mesma linha; desligar marca o vínculo como excluído (autor e
//   data) e o religamento restaura a mesma linha. Nada se apaga.
import {
  saldosVinculo,
  SITUACOES_NOTA_VINCULAVEIS,
  situacaoDocumentacao,
  type TipoAlvoNota,
  validarVinculoNota,
  valorDocumentavelFatura,
} from '@sgh/dominio-faturamento';
import { definirOperacao, type ContextoOperacao, type Executor, type Leitor, recusa } from '@sgh/nucleo';
import { z } from 'zod';

type Linha = Record<string, unknown>;
type Consulta = Pick<Leitor, 'consultar' | 'uma'>;

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));
const p2 = (x: number, t = 2) => String(x).padStart(t, '0');
function dataHora(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date)
    return `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}T${p2(v.getHours())}:${p2(v.getMinutes())}:${p2(v.getSeconds())}`;
  return String(v).replace(' ', 'T').slice(0, 19);
}
const agoraBanco = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p2(d.getMilliseconds(), 3)}`;
};

function estDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.', { campos: [] });
  return ctx.estabelecimento;
}
const colunaAlvo = (t: TipoAlvoNota) => (t === 'fatura' ? 'fatura_fonte_pagadora_id' : 'conta_hospitalar_id');

/** Alvo (fatura ou conta) do estabelecimento, com o valor a documentar e o já documentado por nota. */
async function alvoDo(l: Consulta, est: number, tipo: TipoAlvoNota, id: number, travar = false) {
  const sufixo = travar ? ' FOR UPDATE' : '';
  const a =
    tipo === 'fatura'
      ? await l.uma<Linha>(
          `SELECT id, numero, situacao, fonte_pagadora_id, valor_apresentado, valor_acrescimo, valor_desconto
             FROM fatura_fonte_pagadora WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL${sufixo}`,
          [id, est],
        )
      : await l.uma<Linha>(
          `SELECT id, numero, situacao, fonte_pagadora_id, valor_total
             FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL${sufixo}`,
          [id, est],
        );
  if (!a)
    throw recusa('nao-encontrado', tipo === 'fatura' ? 'Fatura não encontrada.' : 'Conta não encontrada.', {
      campos: ['alvoId'],
    });
  const valorDocumentavel =
    tipo === 'fatura'
      ? valorDocumentavelFatura({
          valorApresentado: n(a['valor_apresentado']),
          valorAcrescimo: n(a['valor_acrescimo']),
          valorDesconto: n(a['valor_desconto']),
        })
      : n(a['valor_total']);
  const doc = await l.uma<Linha>(
    `SELECT COALESCE(SUM(v.valor_apropriado), 0) AS s FROM vinculo_nota_faturamento v
       JOIN nota_servico ns ON ns.id = v.nota_servico_id
      WHERE v.${colunaAlvo(tipo)} = ? AND v.excluido_em IS NULL AND ns.situacao IN ('rascunho','rps_gerado','enviada','autorizada')`,
    [id],
  );
  return {
    tipo,
    id,
    numero: String(a['numero']),
    situacao: String(a['situacao']),
    fontePagadoraId: nn(a['fonte_pagadora_id']),
    valorDocumentavel,
    valorDocumentado: n(doc?.['s']),
  };
}

async function notaDa(l: Consulta, est: number, id: number, travar = false) {
  const ns = await l.uma<Linha>(
    `SELECT id, situacao, valor_servicos, fonte_pagadora_id FROM nota_servico
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL${travar ? ' FOR UPDATE' : ''}`,
    [id, est],
  );
  if (!ns) throw recusa('nao-encontrado', 'Nota fiscal não encontrada.', { campos: ['notaServicoId'] });
  return ns;
}
async function apropriadoDaNota(l: Consulta, notaId: number, semVinculo: number | null) {
  const r = await l.uma<Linha>(
    `SELECT COALESCE(SUM(valor_apropriado), 0) AS s FROM vinculo_nota_faturamento
      WHERE nota_servico_id = ? AND excluido_em IS NULL AND id <> ?`,
    [notaId, semVinculo ?? 0],
  );
  return n(r?.['s']);
}

/** Visão da documentação fiscal da fatura ou da conta: valores, notas ligadas e candidatas com o valor sugerido. */
export async function documentacaoFiscalPropria(l: Leitor, est: number, tipo: TipoAlvoNota, id: number) {
  const alvo = await alvoDo(l, est, tipo, id);
  const ligadas = await l.consultar<Linha>(
    `SELECT v.id, v.versao, v.nota_servico_id, v.valor_apropriado, v.valor_desconto, v.valor_acrescimo, v.criado_em,
            ns.numero_nota, ns.numero_rps, ns.serie_rps, ns.situacao AS situacao_nota, ns.data_emissao, ns.valor_servicos
       FROM vinculo_nota_faturamento v JOIN nota_servico ns ON ns.id = v.nota_servico_id
      WHERE v.${colunaAlvo(tipo)} = ? AND v.excluido_em IS NULL ORDER BY v.id`,
    [id],
  );
  const situacoes = [...SITUACOES_NOTA_VINCULAVEIS];
  const candidatas = await l.consultar<Linha>(
    `SELECT ns.id, ns.numero_nota, ns.numero_rps, ns.serie_rps, ns.situacao, ns.data_emissao, ns.valor_servicos,
            ns.fonte_pagadora_id, (ns.${colunaAlvo(tipo)} <=> ?) AS do_alvo,
            (SELECT COALESCE(SUM(v.valor_apropriado), 0) FROM vinculo_nota_faturamento v
              WHERE v.nota_servico_id = ns.id AND v.excluido_em IS NULL) AS apropriado
       FROM nota_servico ns
      WHERE ns.estabelecimento_id = ? AND ns.excluido_em IS NULL AND ns.situacao IN (${situacoes.map(() => '?').join(',')})
        AND (ns.fonte_pagadora_id IS NULL OR ns.fonte_pagadora_id <=> ?)
        AND NOT EXISTS (SELECT 1 FROM vinculo_nota_faturamento x WHERE x.nota_servico_id = ns.id
                         AND x.${colunaAlvo(tipo)} = ? AND x.excluido_em IS NULL)
      ORDER BY do_alvo DESC, ns.data_emissao DESC LIMIT 50`,
    [id, est, ...situacoes, alvo.fontePagadoraId, id],
  );
  const saldoAlvo = Math.max(0, Math.round((alvo.valorDocumentavel - alvo.valorDocumentado) * 100) / 100);
  return {
    alvo: {
      ...alvo,
      saldo: saldoAlvo,
      documentacao: situacaoDocumentacao(alvo.valorDocumentavel, alvo.valorDocumentado),
    },
    ligadas: ligadas.map((r) => ({
      id: n(r['id']),
      versao: n(r['versao']),
      notaServicoId: n(r['nota_servico_id']),
      numeroNota: txt(r['numero_nota']),
      rps: `${txt(r['serie_rps']) ?? ''}${txt(r['serie_rps']) ? '-' : ''}${n(r['numero_rps'])}`,
      situacaoNota: String(r['situacao_nota']),
      emitidaEm: dataHora(r['data_emissao']),
      valorServicos: n(r['valor_servicos']),
      valorApropriado: n(r['valor_apropriado']),
      valorDesconto: n(r['valor_desconto']),
      valorAcrescimo: n(r['valor_acrescimo']),
    })),
    candidatas: candidatas
      .map((r) => {
        const nota = {
          situacao: String(r['situacao']),
          valorServicos: n(r['valor_servicos']),
          valorJaApropriado: n(r['apropriado']),
          fontePagadoraId: nn(r['fonte_pagadora_id']),
        };
        const { saldoNota, sugerido } = saldosVinculo(nota, {
          tipo,
          situacao: alvo.situacao,
          valorDocumentavel: alvo.valorDocumentavel,
          valorJaDocumentado: alvo.valorDocumentado,
          fontePagadoraId: alvo.fontePagadoraId,
        });
        return {
          id: n(r['id']),
          numeroNota: txt(r['numero_nota']),
          rps: `${txt(r['serie_rps']) ?? ''}${txt(r['serie_rps']) ? '-' : ''}${n(r['numero_rps'])}`,
          situacao: nota.situacao,
          emitidaEm: dataHora(r['data_emissao']),
          emitidaParaEste: n(r['do_alvo']) === 1,
          valorServicos: nota.valorServicos,
          saldoNota,
          sugerido,
        };
      })
      .filter((c) => c.saldoNota > 0),
  };
}

const id = z.coerce.number().int().positive();
const dinheiro = z.coerce.number().finite();
export const esquemaVincularNota = z.object({
  tipo: z.enum(['fatura', 'conta']),
  alvoId: id,
  notaServicoId: id,
  valorApropriado: dinheiro,
  valorDesconto: dinheiro.default(0),
  valorAcrescimo: dinheiro.default(0),
});

export const opVincularNota = definirOperacao({
  nome: 'faturamento.vincular-nota-servico',
  tabelas: ['vinculo_nota_faturamento'],
  entrada: esquemaVincularNota,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    // Trava a nota e o alvo: duas ligações simultâneas não passam juntas do saldo de nenhum dos lados.
    const ns = await notaDa(tx, est, e.notaServicoId, true);
    const alvo = await alvoDo(tx, est, e.tipo, e.alvoId, true);
    const col = colunaAlvo(e.tipo);
    const existente = await tx.uma<Linha>(
      `SELECT id, versao, valor_apropriado, excluido_em FROM vinculo_nota_faturamento
        WHERE nota_servico_id = ? AND ${col} = ?`,
      [e.notaServicoId, e.alvoId],
    );
    const ativo = existente && existente['excluido_em'] === null ? n(existente['id']) : null;
    const jaNaNota = await apropriadoDaNota(tx, e.notaServicoId, ativo);
    const jaNoAlvo = alvo.valorDocumentado - (ativo ? n(existente?.['valor_apropriado']) : 0);
    const erros = validarVinculoNota(
      {
        situacao: String(ns['situacao']),
        valorServicos: n(ns['valor_servicos']),
        valorJaApropriado: jaNaNota,
        fontePagadoraId: nn(ns['fonte_pagadora_id']),
      },
      { ...alvo, valorJaDocumentado: jaNoAlvo },
      e,
    );
    const campos = Object.keys(erros);
    if (campos.length) throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos, erros });
    const valores = {
      valor_apropriado: e.valorApropriado,
      valor_desconto: e.valorDesconto,
      valor_acrescimo: e.valorAcrescimo,
    };
    if (existente) {
      const vid = n(existente['id']);
      await tx.alterar('vinculo_nota_faturamento', vid, n(existente['versao']), {
        ...valores,
        excluido_em: null,
        excluido_por: null,
      });
      return { id: vid, acao: ativo ? 'ajustado' : 'religado' };
    }
    const novo = await tx.incluir('vinculo_nota_faturamento', {
      nota_servico_id: e.notaServicoId,
      [col]: e.alvoId,
      ...valores,
    });
    return { id: novo, acao: 'ligado' };
  },
  alvo: (_e, s) => ({ tabela: 'vinculo_nota_faturamento', id: s.id }),
});

export const esquemaDesvincularNota = z.object({ id, versao: z.number().int().positive() });

export const opDesvincularNota = definirOperacao({
  nome: 'faturamento.desvincular-nota-servico',
  tabelas: ['vinculo_nota_faturamento'],
  entrada: esquemaDesvincularNota,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const v = await tx.uma<Linha>(
      `SELECT v.id FROM vinculo_nota_faturamento v JOIN nota_servico ns ON ns.id = v.nota_servico_id
        WHERE v.id = ? AND v.excluido_em IS NULL AND ns.estabelecimento_id = ?`,
      [e.id, est],
    );
    if (!v) throw recusa('nao-encontrado', 'Vínculo não encontrado.', { campos: ['id'] });
    await tx.alterar('vinculo_nota_faturamento', e.id, e.versao, {
      excluido_em: agoraBanco(),
      excluido_por: ctx.usuario,
    });
    return { id: e.id };
  },
  alvo: (_e, s) => ({ tabela: 'vinculo_nota_faturamento', id: s.id }),
});

export const OPERACOES_NOTA_VINCULO = {
  vincular: opVincularNota,
  desvincular: opDesvincularNota,
} as const;
export type NomeOperacaoNotaVinculo = keyof typeof OPERACOES_NOTA_VINCULO;

export async function gravarNotaVinculo(
  executor: Executor,
  nome: NomeOperacaoNotaVinculo,
  ctx: ContextoOperacao,
  entrada: unknown,
): Promise<Record<string, unknown>> {
  const op = OPERACOES_NOTA_VINCULO[nome] as Parameters<Executor['executar']>[0];
  const r = await executor.executar(op, ctx.cliente, entrada, ctx);
  return r.resultado as Record<string, unknown>;
}
