// Reajuste em lote e desfazer pelo lote no banco próprio (06-FAT linha 3), pelo Executor do @sgh/nucleo: o lote em
// lote_reajuste, cada preço alterado em lote_reajuste_item (componentes anteriores e novos) e a vigência nova em
// preco_procedimento_valor. O desfazer NUNCA apaga: grava a linha de exclusão da vigência (operacao = 'exclusao',
// com o retrato dos valores desfeitos), marca o item do lote como desfeito e atualiza o lote (parcial ou inteiro).
// Uma vigência vale enquanto não houver exclusão dela registrada depois (VALOR_VALIDO); a vigência pode ser criada de
// novo depois do desfazer. Regras reconferidas sob a transação (a proposta pode ter envelhecido): a data é hoje no
// fuso do estabelecimento, o item existe na tabela do estabelecimento, está ativo e é por valor (o modelo por índice
// sai de índice × quantidade), nenhuma vigência válida na data, e a base lida é a vigente. O desfazer recusa o item
// fora do lote, já desfeito, alterado por fora depois do lote ou já lançado em conta na vigência do lote.
import type { DesfazerReajusteEntrada, ReajustarEntrada } from '@sgh/contratos';
import { definirOperacao, type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import type { z } from 'zod';
import { FUSO_PADRAO, relogioNoFuso } from '../exames/relogio.js';
import { OPERACOES_PRECO } from './operacoes.js';
import type { AutoriaPreco } from './tipos.js';

type Linha = Record<string, unknown>;
type Componentes = ReajustarEntrada['itens'][number]['novos'];
const n = (v: unknown) => Number(v ?? 0);
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Condição (alias x) de uma linha de valor que vale: não é exclusão e nenhuma exclusão da mesma vigência gravada depois. */
export const VALOR_VALIDO = `x.operacao <> 'exclusao' AND NOT EXISTS (
  SELECT 1 FROM preco_procedimento_valor z WHERE z.preco_procedimento_id = x.preco_procedimento_id
     AND z.vigencia_inicio = x.vigencia_inicio AND z.operacao = 'exclusao' AND z.id > x.id)`;

const componentesDe = (r: Linha): Componentes => ({
  ch: n(r['valor_honorario']),
  co: n(r['valor_custo_operacional']),
  filme: n(r['valor_filme']),
  anes: n(r['valor_anestesia']),
  outros: n(r['valor_outros']),
});
const total = (c: Componentes) => r2(c.ch + c.co + c.filme + c.anes + c.outros);
const CHAVES = ['ch', 'co', 'filme', 'anes', 'outros'] as const;
export const mesmosComponentes = (a: Componentes, b: Componentes) =>
  CHAVES.every((k) => Math.abs(Number(a[k] ?? 0) - Number(b[k] ?? 0)) < 0.005);

async function hojeNoEstabelecimento(l: Leitor, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return relogioNoFuso(r?.fuso_horario || FUSO_PADRAO).hoje;
}

/** A vigência válida de maior início até a data (a base do reajuste), ou null. */
async function vigenteNaData(l: Leitor, pp: number, data: string): Promise<Linha | null> {
  return l.uma<Linha>(
    `SELECT x.* FROM preco_procedimento_valor x
      WHERE x.preco_procedimento_id = ? AND x.vigencia_inicio <= ? AND ${VALOR_VALIDO}
      ORDER BY x.vigencia_inicio DESC, x.id DESC LIMIT 1`,
    [pp, data],
  );
}

function exigirEstabelecimento(tx: TxOperacao): number {
  const est = tx.contexto.estabelecimento;
  if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return est;
}

// ── Reajuste ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const OP_REAJUSTAR = definirOperacao<
  ReajustarEntrada,
  { tabela: number; linhas: number; parte: number }
>({
  nome: 'preco.reajustar',
  tabelas: ['lote_reajuste', 'lote_reajuste_item', 'preco_procedimento_valor'],
  entrada: OPERACOES_PRECO['preco.reajustar'].entrada as z.ZodType<ReajustarEntrada>,
  critica: true,
  async gravar(tx, e) {
    const est = exigirEstabelecimento(tx);
    const tab = await tx.uma<Linha>(
      'SELECT id FROM tabela_preco WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.tabela, est],
    );
    if (!tab) throw recusa('tabela-inexistente', `A tabela ${e.tabela} não é deste estabelecimento.`);
    if (e.data !== (await hojeNoEstabelecimento(tx, est)))
      throw recusa('data-fora-de-hoje', 'A vigência do reajuste começa na data de hoje.');
    // Tabela usada por mais de uma fonte pagadora na data: a confirmação é exigida também aqui.
    const usos = await tx.uma<{ q: unknown }>(
      `SELECT COUNT(DISTINCT c.fonte_pagadora_id) AS q FROM contrato_tabela_vigencia v
         JOIN contrato_fonte_pagadora c ON c.id = v.contrato_fonte_pagadora_id
        WHERE v.tabela_preco_id = ? AND v.vigencia_inicio <= ? AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= ?)
          AND c.excluido_em IS NULL`,
      [e.tabela, e.data, e.data],
    );
    if (n(usos?.q) > 1 && !e.confirmacoes.tabelaCompartilhada)
      throw recusa('confirmacao-pendente', `A tabela ${e.tabela} é usada por mais de um convênio: confirme.`);

    const alvos: { i: (typeof e.itens)[number]; pp: Linha; base: Linha | null }[] = [];
    for (const i of e.itens) {
      const [pp] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, item_faturavel_id, ativo, modelo_valor FROM preco_procedimento WHERE id = ? AND tabela_preco_id = ? AND excluido_em IS NULL',
        [i.codigo, e.tabela],
      );
      if (!pp) throw recusa('item-inexistente', `O item ${i.codigo} não existe mais na tabela.`);
      if (!(pp['ativo'] === true || pp['ativo'] === 1 || pp['ativo'] === '1'))
        throw recusa('item-inativo', `O item ${i.codigo} está inativo.`);
      if (String(pp['modelo_valor'] ?? '') === 'indice')
        throw recusa(
          'modelo-indice',
          `O item ${i.codigo} é cobrado por índice: o valor sai do índice, não do reajuste.`,
        );
      const naData = await tx.uma(
        `SELECT 1 AS um FROM preco_procedimento_valor x WHERE x.preco_procedimento_id = ? AND x.vigencia_inicio = ? AND ${VALOR_VALIDO}`,
        [i.codigo, e.data],
      );
      if (naData) throw recusa('vigencia-existente', `Já existe vigência do item ${i.codigo} em ${e.data}.`);
      const base = await vigenteNaData(tx, i.codigo, e.data);
      const igual =
        (i.base === null && base === null) ||
        (i.base !== null &&
          base !== null &&
          dataIso(base['vigencia_inicio']) === i.base.vigencia &&
          mesmosComponentes(componentesDe(base), i.base.valores));
      if (!igual)
        throw recusa('proposta-desatualizada', 'O preço mudou depois da proposta. Refaça a proposta.');
      alvos.push({ i, pp, base });
    }

    // O lote: criado na primeira parte, acumulado nas seguintes (cada parte é uma transação curta).
    const [lote] = await tx.consultarParaAtualizar<Linha>(
      'SELECT id, versao, quantidade_itens, tabela_preco_id FROM lote_reajuste WHERE identificador = ?',
      [e.lote],
    );
    if (lote && n(lote['tabela_preco_id']) !== e.tabela)
      throw recusa('lote-de-outra-tabela', `O lote ${e.lote} é de outra tabela.`);
    if (!lote && e.parte !== 1)
      throw recusa('lote-inexistente', `A parte ${e.parte} chegou antes da primeira.`);
    let arquivo: number | null = null;
    if (e.carga !== null) {
      const c = await tx.uma<{ arquivo_id: unknown }>(
        'SELECT arquivo_id FROM carga_tabela_preco WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.carga, est],
      );
      if (!c) throw recusa('carga-inexistente', `A carga ${e.carga} não é deste estabelecimento.`);
      arquivo = c.arquivo_id === null || c.arquivo_id === undefined ? null : n(c.arquivo_id);
    }
    // Planilha sem arquivo guardado: os valores ficam por item no lote (modo valor); o modo arquivo exige o arquivo.
    const modo = e.modo === 'arquivo' && arquivo === null ? 'valor' : e.modo;
    const situacao = e.parte === e.partes ? 'aplicado' : 'em_aplicacao';
    let loteId: number;
    let sequencia = 0;
    if (!lote) {
      loteId = await tx.incluir('lote_reajuste', {
        identificador: e.lote,
        tipo_lote: e.origem,
        escopo: 'itens',
        tabela_preco_id: e.tabela,
        modo,
        percentual: modo === 'percentual' ? e.percentual : null,
        arquivo_id: modo === 'arquivo' ? arquivo : null,
        vigencia_inicio: e.data,
        justificativa: e.justificativa,
        confirmou_tabela_compartilhada: e.confirmacoes.tabelaCompartilhada,
        confirmou_percentual_tabela: e.confirmacoes.percentualTabela,
        autor_usuario_id: tx.contexto.usuario,
        aplicado_em: new Date(),
        total_partes: e.partes,
        quantidade_itens: alvos.length,
        situacao,
      });
    } else {
      loteId = n(lote['id']);
      sequencia = n(lote['quantidade_itens']);
      await tx.alterar('lote_reajuste', loteId, n(lote['versao']), {
        quantidade_itens: sequencia + alvos.length,
        situacao,
      });
    }
    const agora = new Date();
    for (const a of alvos) {
      sequencia += 1;
      const novos = a.i.novos;
      await tx.incluir('preco_procedimento_valor', {
        preco_procedimento_id: a.i.codigo,
        operacao: 'inclusao',
        dados: JSON.stringify({ lote: e.lote, origem: e.origem }),
        ocorrido_em: agora,
        usuario_id: tx.contexto.usuario,
        vigencia_inicio: e.data,
        valor_honorario: novos.ch,
        valor_custo_operacional: novos.co,
        valor_filme: novos.filme,
        valor_anestesia: novos.anes,
        valor_outros: novos.outros,
        valor_total: total(novos),
      });
      const anteriores = a.base ? componentesDe(a.base) : null;
      await tx.incluir('lote_reajuste_item', {
        lote_reajuste_id: loteId,
        sequencia,
        item_faturavel_id: n(a.pp['item_faturavel_id']),
        preco_procedimento_id: a.i.codigo,
        parte: e.parte,
        vigencia_base: a.base ? dataIso(a.base['vigencia_inicio']) : null,
        valor_anterior: anteriores ? total(anteriores) : null,
        valor_novo: total(novos),
        componentes_anteriores: anteriores ? JSON.stringify(anteriores) : null,
        componentes_novos: JSON.stringify(novos),
      });
    }
    return { tabela: e.tabela, linhas: alvos.length, parte: e.parte };
  },
  alvo: (e) => ({ tabela: 'tabela_preco', id: e.tabela }),
  trilha: (e) => ({ motivo: e.justificativa, dados: { lote: e.lote, parte: e.parte, partes: e.partes } }),
});

// ── Desfazer ───────────────────────────────────────────────────────────────────────────────────────────────────────

interface ItemConferido {
  readonly codigo: number;
  readonly itemLote: Linha;
  readonly valor: Linha;
  readonly lote: Linha;
}

/** As condições do desfazer de uma parte, só leitura (a pré-conferência de todas as partes e a própria parte). */
export async function conferirDesfazer(
  l: Leitor,
  est: number,
  p: DesfazerReajusteEntrada,
): Promise<ItemConferido[]> {
  const lote = await l.uma<Linha>(
    `SELECT lr.* FROM lote_reajuste lr JOIN tabela_preco t ON t.id = lr.tabela_preco_id
      WHERE lr.identificador = ? AND t.estabelecimento_id = ? AND lr.excluido_em IS NULL`,
    [p.lote, est],
  );
  if (!lote) throw recusa('nao-encontrado', `O lote ${p.lote} não existe neste estabelecimento.`);
  if (n(lote['tabela_preco_id']) !== p.tabela || dataIso(lote['vigencia_inicio']) !== p.data)
    throw recusa('fora-do-lote', 'A tabela ou a data não são as do lote.');
  const conferidos: ItemConferido[] = [];
  for (const i of p.itens) {
    const il = await l.uma<Linha>(
      `SELECT * FROM lote_reajuste_item WHERE lote_reajuste_id = ? AND preco_procedimento_id = ? AND excluido_em IS NULL`,
      [lote['id'], i.codigo],
    );
    if (!il) throw recusa('fora-do-lote', `O item ${i.codigo} não foi gravado por este lote.`);
    if (il['desfeito'] === true || il['desfeito'] === 1 || il['desfeito'] === '1')
      throw recusa('sem-efeito', `O item ${i.codigo} deste lote já foi desfeito.`);
    const valor = await l.uma<Linha>(
      `SELECT x.* FROM preco_procedimento_valor x WHERE x.preco_procedimento_id = ? AND x.vigencia_inicio = ? AND ${VALOR_VALIDO}
        ORDER BY x.id DESC LIMIT 1`,
      [i.codigo, p.data],
    );
    if (!valor) throw recusa('vigencia-inexistente', 'A vigência do lote não existe mais.');
    const doLote = JSON.parse(String(il['componentes_novos'])) as Componentes;
    if (!mesmosComponentes(componentesDe(valor), doLote) || !mesmosComponentes(doLote, i.valores))
      throw recusa('alterado-por-fora', `A vigência do item ${i.codigo} foi alterada depois do reajuste.`);
    const usado = await l.uma(
      `SELECT 1 AS um FROM conta_hospitalar_item ci JOIN conta_hospitalar ch ON ch.id = ci.conta_hospitalar_id
        WHERE ci.item_faturavel_id = ? AND ci.realizado_em >= ? AND ci.excluido_em IS NULL
          AND ci.tipo_valorizacao = 'tabela' AND ch.estabelecimento_id = ? LIMIT 1`,
      [il['item_faturavel_id'], p.data, est],
    );
    if (usado)
      throw recusa(
        'vigencia-usada',
        `Há lançamento de conta do item ${i.codigo} com data na vigência do lote.`,
      );
    conferidos.push({ codigo: i.codigo, itemLote: il, valor, lote });
  }
  return conferidos;
}

export const OP_DESFAZER = definirOperacao<
  DesfazerReajusteEntrada,
  { tabela: number; linhas: number; parte: number }
>({
  nome: 'preco.desfazer-reajuste',
  tabelas: ['lote_reajuste', 'lote_reajuste_item', 'preco_procedimento_valor'],
  entrada: OPERACOES_PRECO['preco.desfazerReajuste'].entrada as z.ZodType<DesfazerReajusteEntrada>,
  critica: true,
  async gravar(tx, e) {
    const est = exigirEstabelecimento(tx);
    await tx.consultarParaAtualizar('SELECT id FROM lote_reajuste WHERE identificador = ?', [e.lote]);
    const itens = await conferirDesfazer(tx, est, e);
    const agora = new Date();
    for (const c of itens) {
      const v = componentesDe(c.valor);
      await tx.incluir('preco_procedimento_valor', {
        preco_procedimento_id: c.codigo,
        operacao: 'exclusao',
        dados: JSON.stringify({ lote: e.lote, desfeito: v, valorDesfeito: n(c.valor['id']) }),
        ocorrido_em: agora,
        usuario_id: tx.contexto.usuario,
        vigencia_inicio: e.data,
      });
      await tx.alterar('lote_reajuste_item', n(c.itemLote['id']), n(c.itemLote['versao']), {
        desfeito: true,
        desfeito_em: agora,
      });
    }
    const lote = await tx.uma<Linha>('SELECT * FROM lote_reajuste WHERE identificador = ?', [e.lote]);
    const desfeitos = n(lote?.['quantidade_desfeitos']) + itens.length;
    await tx.alterar('lote_reajuste', n(lote?.['id']), n(lote?.['versao']), {
      quantidade_desfeitos: desfeitos,
      situacao: desfeitos >= n(lote?.['quantidade_itens']) ? 'desfeito' : 'desfeito_parcial',
      desfeito_em: agora,
      desfeito_por_usuario_id: tx.contexto.usuario,
      motivo_desfazer: e.justificativa,
    });
    return { tabela: e.tabela, linhas: itens.length, parte: e.parte };
  },
  alvo: (e) => ({ tabela: 'tabela_preco', id: e.tabela }),
  trilha: (e) => ({ motivo: e.justificativa, dados: { lote: e.lote, parte: e.parte, partes: e.partes } }),
});

/** Quem gravou cada vigência do item pelo reajuste ou pela importação (os itens desfeitos saem). */
export async function autoriaDoItemPropria(
  l: Leitor,
  est: number,
  tab: number,
  cod: number,
  quando: (v: unknown) => string,
): Promise<AutoriaPreco[]> {
  return (
    await l.consultar(
      `SELECT lr.vigencia_inicio, lr.tipo_lote, lr.identificador, i.criado_em, u.login
         FROM lote_reajuste_item i JOIN lote_reajuste lr ON lr.id = i.lote_reajuste_id
         JOIN tabela_preco t ON t.id = lr.tabela_preco_id
         LEFT JOIN usuario u ON u.id = lr.autor_usuario_id
        WHERE i.preco_procedimento_id = ? AND lr.tabela_preco_id = ? AND t.estabelecimento_id = ?
          AND i.desfeito = FALSE AND i.excluido_em IS NULL AND lr.excluido_em IS NULL
        ORDER BY lr.vigencia_inicio DESC, i.id DESC`,
      [cod, tab, est],
      { teto: 1_000 },
    )
  ).map((r) => ({
    data: dataIso(r['vigencia_inicio']) ?? '',
    autor: String(r['login'] ?? ''),
    quando: quando(r['criado_em']),
    origem: String(r['tipo_lote'] ?? ''),
    lote: r['identificador'] === null || r['identificador'] === undefined ? null : String(r['identificador']),
  }));
}
