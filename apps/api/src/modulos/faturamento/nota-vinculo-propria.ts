// A nota fiscal de serviço que documenta a fatura do convênio ou a conta do particular, sobre o banco do cliente
// (F3.7, 06-FAT linha 36). Leitura pelo Leitor, gravação pelo Executor (trilha, autoria e idempotência na mesma
// transação). A regra é do @sgh/dominio-faturamento (conta/nota-vinculo): aqui só se lê, confere pelo domínio e grava.
// - Visão do alvo: quanto a fatura ou a conta vale, quanto já está documentado por nota, as notas ligadas (com a
//   situação da nota: a cancelada segue à vista, marcada como "não documenta mais"), as notas candidatas (só as que
//   servem ao alvo pelo domínio: mesma fonte pagadora ou tomador que é o paciente, um responsável da conta ou a fonte;
//   nenhuma emitida para outra fatura ou conta) com o valor sugerido, e o histórico do vínculo.
// - Ligar de novo uma nota já ligada ajusta o valor na mesma linha; desligar pede motivo e marca o vínculo como
//   excluído (autor e data); o religamento restaura a mesma linha. Cada ligação, ajuste, desligamento e religamento
//   grava uma linha em evento_vinculo_nota_faturamento (valor anterior e novo, motivo, situação da nota). Nada se apaga.
import {
  type AlvoParaVinculo,
  type NotaParaVinculo,
  notaDocumenta,
  notaServeAoAlvo,
  saldosVinculo,
  SITUACOES_NOTA_VINCULAVEIS,
  situacaoDocumentacao,
  type TipoAlvoNota,
  validarDesligamentoNota,
  validarVinculoNota,
  valorDocumentavelFatura,
} from '@sgh/dominio-faturamento';
import { definirOperacao, type ContextoOperacao, type Executor, type Leitor, recusa } from '@sgh/nucleo';
import { z } from 'zod';

type Linha = Record<string, unknown>;
type Consulta = Pick<Leitor, 'consultar' | 'uma'> & {
  consultarParaAtualizar?: (sql: string, p?: readonly unknown[], o?: { teto?: number }) => Promise<Linha[]>;
};
/** Uma linha; com trava, pelo SELECT ... FOR UPDATE do escritor (o caminho de leitura recusa a trava escrita à mão). */
async function linhaUnica(
  l: Consulta,
  sql: string,
  p: readonly unknown[],
  travar: boolean,
): Promise<Linha | null> {
  if (!travar) return l.uma<Linha>(sql, p);
  if (!l.consultarParaAtualizar) throw new Error('Trava de linha pedida fora da gravação.');
  const [r] = await l.consultarParaAtualizar(sql, p, { teto: 1 });
  return r ?? null;
}

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
  const a =
    tipo === 'fatura'
      ? await linhaUnica(
          l,
          `SELECT id, numero, situacao, fonte_pagadora_id, valor_apresentado, valor_acrescimo, valor_desconto
             FROM fatura_fonte_pagadora WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [id, est],
          travar,
        )
      : await linhaUnica(
          l,
          `SELECT id, numero, situacao, fonte_pagadora_id, valor_total, paciente_id
             FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [id, est],
          travar,
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
  // Quem pode ser o tomador da nota emitida sem fonte pagadora: o CNPJ da fonte e, na conta, o CPF do paciente e o
  // CPF ou CNPJ dos responsáveis financeiros ou legais vigentes.
  const docs = await l.consultar<Linha>(
    `SELECT pj.cnpj AS doc FROM fonte_pagadora fp JOIN pessoa_juridica pj ON pj.id = fp.pessoa_juridica_id
      WHERE fp.id = ?
     UNION SELECT pf.cpf FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE p.id = ?
     UNION SELECT COALESCE(rf.cpf, rj.cnpj) FROM responsavel_paciente r
       LEFT JOIN pessoa_fisica rf ON rf.id = r.pessoa_fisica_id
       LEFT JOIN pessoa_juridica rj ON rj.id = r.pessoa_juridica_id
      WHERE r.paciente_id = ? AND r.papel IN ('responsavel_financeiro','responsavel_legal')
        AND r.vigencia_inicio <= CURDATE() AND (r.vigencia_fim IS NULL OR r.vigencia_fim >= CURDATE())`,
    [nn(a['fonte_pagadora_id']) ?? 0, nn(a['paciente_id']) ?? 0, nn(a['paciente_id']) ?? 0],
  );
  return {
    tipo,
    id,
    documentosTomador: docs.map((d) => txt(d['doc'])).filter((d): d is string => !!d),
    numero: String(a['numero']),
    situacao: String(a['situacao']),
    fontePagadoraId: nn(a['fonte_pagadora_id']),
    valorDocumentavel,
    valorDocumentado: n(doc?.['s']),
  };
}

async function notaDa(l: Consulta, est: number, id: number, travar = false) {
  const ns = await linhaUnica(
    l,
    `SELECT id, situacao, valor_servicos, fonte_pagadora_id, conta_hospitalar_id, fatura_fonte_pagadora_id,
            tomador_documento FROM nota_servico
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
    travar,
  );
  if (!ns) throw recusa('nao-encontrado', 'Nota fiscal não encontrada.', { campos: ['notaServicoId'] });
  return ns;
}
const notaParaVinculo = (r: Linha, apropriado: number): NotaParaVinculo => ({
  situacao: String(r['situacao']),
  valorServicos: n(r['valor_servicos']),
  valorJaApropriado: apropriado,
  fontePagadoraId: nn(r['fonte_pagadora_id']),
  contaHospitalarId: nn(r['conta_hospitalar_id']),
  faturaFontePagadoraId: nn(r['fatura_fonte_pagadora_id']),
  tomadorDocumento: txt(r['tomador_documento']),
});
type AlvoLido = Awaited<ReturnType<typeof alvoDo>>;
const alvoParaVinculo = (a: AlvoLido, jaDocumentado = a.valorDocumentado): AlvoParaVinculo => ({
  tipo: a.tipo,
  id: a.id,
  situacao: a.situacao,
  valorDocumentavel: a.valorDocumentavel,
  valorJaDocumentado: jaDocumentado,
  fontePagadoraId: a.fontePagadoraId,
  documentosTomador: a.documentosTomador,
});

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
            ns.fonte_pagadora_id, ns.conta_hospitalar_id, ns.fatura_fonte_pagadora_id, ns.tomador_documento,
            (ns.${colunaAlvo(tipo)} <=> ?) AS do_alvo,
            (SELECT COALESCE(SUM(v.valor_apropriado), 0) FROM vinculo_nota_faturamento v
              WHERE v.nota_servico_id = ns.id AND v.excluido_em IS NULL) AS apropriado
       FROM nota_servico ns
      WHERE ns.estabelecimento_id = ? AND ns.excluido_em IS NULL AND ns.situacao IN (${situacoes.map(() => '?').join(',')})
        AND (ns.fonte_pagadora_id IS NULL OR ns.fonte_pagadora_id <=> ?)
        AND ((ns.conta_hospitalar_id IS NULL AND ns.fatura_fonte_pagadora_id IS NULL) OR ns.${colunaAlvo(tipo)} <=> ?)
        AND NOT EXISTS (SELECT 1 FROM vinculo_nota_faturamento x WHERE x.nota_servico_id = ns.id
                         AND x.${colunaAlvo(tipo)} = ? AND x.excluido_em IS NULL)
      ORDER BY do_alvo DESC, ns.data_emissao DESC LIMIT 50`,
    [id, est, ...situacoes, alvo.fontePagadoraId, id, id],
  );
  const historico = await l.consultar<Linha>(
    `SELECT h.id, h.vinculo_nota_faturamento_id, h.acao, h.valor_apropriado_anterior, h.valor_apropriado,
            h.situacao_nota, h.motivo, h.criado_em, h.criado_por, v.nota_servico_id
       FROM evento_vinculo_nota_faturamento h JOIN vinculo_nota_faturamento v ON v.id = h.vinculo_nota_faturamento_id
      WHERE v.${colunaAlvo(tipo)} = ? ORDER BY h.id DESC LIMIT 100`,
    [id],
  );
  // Os documentos do tomador aceitos (CPF e CNPJ) servem só à conferência: não vão para a tela.
  const alvoVisivel = {
    tipo: alvo.tipo,
    id: alvo.id,
    numero: alvo.numero,
    situacao: alvo.situacao,
    fontePagadoraId: alvo.fontePagadoraId,
    valorDocumentavel: alvo.valorDocumentavel,
    valorDocumentado: alvo.valorDocumentado,
  };
  const saldoAlvo = Math.max(0, Math.round((alvo.valorDocumentavel - alvo.valorDocumentado) * 100) / 100);
  return {
    alvo: {
      ...alvoVisivel,
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
      documenta: notaDocumenta(String(r['situacao_nota'])),
      emitidaEm: dataHora(r['data_emissao']),
      valorServicos: n(r['valor_servicos']),
      valorApropriado: n(r['valor_apropriado']),
      valorDesconto: n(r['valor_desconto']),
      valorAcrescimo: n(r['valor_acrescimo']),
    })),
    candidatas: candidatas
      .map((r) => ({ r, nota: notaParaVinculo(r, n(r['apropriado'])) }))
      // Só a nota que serve ao alvo (a regra é do domínio, a mesma da gravação).
      .filter(({ nota }) => notaServeAoAlvo(nota, alvoParaVinculo(alvo)) === null)
      .map(({ r, nota }) => {
        const { saldoNota, sugerido } = saldosVinculo(nota, alvoParaVinculo(alvo));
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
    historico: historico.map((h) => ({
      id: n(h['id']),
      vinculoId: n(h['vinculo_nota_faturamento_id']),
      notaServicoId: n(h['nota_servico_id']),
      acao: String(h['acao']),
      valorAnterior: h['valor_apropriado_anterior'] === null ? null : n(h['valor_apropriado_anterior']),
      valor: h['valor_apropriado'] === null ? null : n(h['valor_apropriado']),
      situacaoNota: String(h['situacao_nota']),
      motivo: txt(h['motivo']),
      em: dataHora(h['criado_em']),
      por: nn(h['criado_por']),
    })),
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
  tabelas: ['vinculo_nota_faturamento', 'evento_vinculo_nota_faturamento'],
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
    const erros = validarVinculoNota(notaParaVinculo(ns, jaNaNota), alvoParaVinculo(alvo, jaNoAlvo), e);
    const campos = Object.keys(erros);
    if (campos.length) throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos });
    const valores = {
      valor_apropriado: e.valorApropriado,
      valor_desconto: e.valorDesconto,
      valor_acrescimo: e.valorAcrescimo,
    };
    const historico = (vid: number, acao: string, anterior: number | null) =>
      tx.incluir('evento_vinculo_nota_faturamento', {
        vinculo_nota_faturamento_id: vid,
        acao,
        valor_apropriado_anterior: anterior,
        ...valores,
        situacao_nota: String(ns['situacao']),
      });
    if (existente) {
      const vid = n(existente['id']);
      await tx.alterar('vinculo_nota_faturamento', vid, n(existente['versao']), {
        ...valores,
        excluido_em: null,
        excluido_por: null,
      });
      const acao = ativo ? 'ajustado' : 'religado';
      await historico(vid, acao, ativo ? n(existente['valor_apropriado']) : null);
      return { id: vid, acao };
    }
    const novo = await tx.incluir('vinculo_nota_faturamento', {
      nota_servico_id: e.notaServicoId,
      [col]: e.alvoId,
      ...valores,
    });
    await historico(novo, 'ligado', null);
    return { id: novo, acao: 'ligado' };
  },
  alvo: (_e, s) => ({ tabela: 'vinculo_nota_faturamento', id: s.id }),
});

export const esquemaDesvincularNota = z.object({
  id,
  versao: z.number().int().positive(),
  motivo: z.string().default(''),
});

export const opDesvincularNota = definirOperacao({
  nome: 'faturamento.desvincular-nota-servico',
  tabelas: ['vinculo_nota_faturamento', 'evento_vinculo_nota_faturamento'],
  entrada: esquemaDesvincularNota,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const erros = validarDesligamentoNota(e.motivo);
    if (Object.keys(erros).length)
      throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos: Object.keys(erros) });
    const v = await tx.uma<Linha>(
      `SELECT v.id, v.valor_apropriado, v.valor_desconto, v.valor_acrescimo, ns.situacao AS situacao_nota
         FROM vinculo_nota_faturamento v JOIN nota_servico ns ON ns.id = v.nota_servico_id
        WHERE v.id = ? AND v.excluido_em IS NULL AND ns.estabelecimento_id = ?`,
      [e.id, est],
    );
    if (!v) throw recusa('nao-encontrado', 'Vínculo não encontrado.', { campos: ['id'] });
    await tx.alterar('vinculo_nota_faturamento', e.id, e.versao, {
      excluido_em: agoraBanco(),
      excluido_por: ctx.usuario,
    });
    await tx.incluir('evento_vinculo_nota_faturamento', {
      vinculo_nota_faturamento_id: e.id,
      acao: 'desligado',
      valor_apropriado_anterior: n(v['valor_apropriado']),
      valor_apropriado: null,
      valor_desconto: n(v['valor_desconto']),
      valor_acrescimo: n(v['valor_acrescimo']),
      situacao_nota: String(v['situacao_nota']),
      motivo: e.motivo.trim(),
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

export interface FiltroFaturasNota {
  /** Mês da competência, `AAAA-MM`. */
  readonly competencia?: string | null;
  readonly fontePagadoraId?: number | null;
  readonly documentacao?: 'sem_nota' | 'parcial' | 'documentada' | null;
}

/**
 * Lista das faturas ao pagador do estabelecimento com a documentação fiscal de cada uma (quanto vale, quanto as notas
 * que documentam cobrem e o que falta), de onde se abre a tela da nota fiscal da fatura. O valor documentável e a
 * situação vêm da regra do domínio, a mesma da tela da fatura; a nota cancelada não conta.
 */
export async function faturasDocumentacaoPropria(l: Leitor, est: number, filtro: FiltroFaturasNota = {}) {
  const situacoes = [...SITUACOES_NOTA_VINCULAVEIS];
  const onde: string[] = ['f.estabelecimento_id = ?', 'f.excluido_em IS NULL'];
  const p: unknown[] = [...situacoes, est];
  if (filtro.competencia) {
    onde.push('f.competencia = ?');
    p.push(`${filtro.competencia}-01`);
  }
  if (filtro.fontePagadoraId) {
    onde.push('f.fonte_pagadora_id = ?');
    p.push(filtro.fontePagadoraId);
  }
  const linhas = await l.consultar<Linha>(
    `SELECT f.id, f.numero, f.situacao, f.competencia, f.fonte_pagadora_id, fp.nome AS fonte_nome,
            f.valor_apresentado, f.valor_acrescimo, f.valor_desconto,
            (SELECT COALESCE(SUM(v.valor_apropriado), 0) FROM vinculo_nota_faturamento v
               JOIN nota_servico ns ON ns.id = v.nota_servico_id
              WHERE v.fatura_fonte_pagadora_id = f.id AND v.excluido_em IS NULL
                AND ns.situacao IN (${situacoes.map(() => '?').join(',')})) AS documentado,
            (SELECT COUNT(*) FROM vinculo_nota_faturamento v
              WHERE v.fatura_fonte_pagadora_id = f.id AND v.excluido_em IS NULL) AS notas
       FROM fatura_fonte_pagadora f LEFT JOIN fonte_pagadora fp ON fp.id = f.fonte_pagadora_id
      WHERE ${onde.join(' AND ')}
      ORDER BY f.competencia DESC, f.id DESC LIMIT 300`,
    p,
  );
  return linhas
    .map((r) => {
      const valorDocumentavel = valorDocumentavelFatura({
        valorApresentado: n(r['valor_apresentado']),
        valorAcrescimo: n(r['valor_acrescimo']),
        valorDesconto: n(r['valor_desconto']),
      });
      const valorDocumentado = n(r['documentado']);
      return {
        id: n(r['id']),
        numero: String(r['numero']),
        situacao: String(r['situacao']),
        competencia: dataHora(r['competencia'])?.slice(0, 7) ?? null,
        fontePagadoraId: nn(r['fonte_pagadora_id']),
        fontePagadora: txt(r['fonte_nome']),
        valorDocumentavel,
        valorDocumentado,
        saldo: Math.max(0, Math.round((valorDocumentavel - valorDocumentado) * 100) / 100),
        notasLigadas: n(r['notas']),
        documentacao: situacaoDocumentacao(valorDocumentavel, valorDocumentado),
      };
    })
    .filter((f) => !filtro.documentacao || f.documentacao === filtro.documentacao);
}
