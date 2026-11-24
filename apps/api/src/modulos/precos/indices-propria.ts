// Índices de cobrança e portes do M12 sobre o banco do cliente (06-FAT linha 5): o valor do índice (coeficiente de
// honorário, custo operacional, filme) por vigência em valor_indice, o valor de cada porte de honorário em
// valor_porte_medico e o valor do porte anestésico em valor_porte_anestesico. O honorário pelo índice (modelo CH ou
// PORTE do @sgh/dominio-preco) sai destes valores na data do atendimento.
// Escopo: só vale para o estabelecimento que tem acordo com a fonte pagadora (fora do rascunho, vigente na data). O
// valor do acordo (fonte_pagadora_id, sem tabela ou com uma tabela do acordo deste estabelecimento) prevalece sobre o
// da tabela de honorários do acordo (tabela_preco_id da regra de tabela vigente na data); a tabela é sempre a do
// estabelecimento da sessão. Dois índices diferentes do mesmo tipo no mesmo nível recusam (nunca um em silêncio).
// A linha com operação de exclusão nunca vale (o histórico do valor fica no banco).
import { type Leitor, recusa } from '@sgh/nucleo';
import type { IndiceConvenio, Pagina } from './tipos.js';

type Linha = Record<string, unknown>;

/** Tipo do índice no modelo → chave do índice na porta (a mesma da explicação do valor: 1 CH, 4 filme, 5 UCO). */
export const CHAVE_DO_TIPO_INDICE: Readonly<Record<string, number>> = {
  coeficiente_honorario: 1,
  filme: 4,
  custo_operacional: 5,
};

const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '';

/** Valor do índice pelo tipo: o valor específico do componente quando informado, senão o valor unitário. */
export function valorDoIndice(r: Linha): number {
  const tipo = String(r['tipo_indice'] ?? '');
  const especifico =
    tipo === 'coeficiente_honorario'
      ? r['valor_honorario']
      : tipo === 'custo_operacional'
        ? r['valor_custo_operacional']
        : tipo === 'filme'
          ? r['valor_filme_m2']
          : null;
  return Number(especifico ?? r['valor_indice'] ?? 0);
}

/**
 * O acordo da fonte pagadora no estabelecimento: existe (fora do rascunho, não excluído e, com data, com a vigência
 * cobrindo a data) e quais são as tabelas de honorários dele vigentes na data (sem data: todas as que já teve, para a
 * linha do tempo da tela). Sem acordo, nada do índice nem do porte vale para o estabelecimento.
 */
const SQL_ACORDO = (comData: boolean) => `
  SELECT k.id AS contrato, ctv.tabela_preco_id
    FROM contrato_fonte_pagadora k
    LEFT JOIN contrato_tabela_vigencia ctv ON ctv.contrato_fonte_pagadora_id = k.id
         AND ctv.tipo_item IN ('honorario_internacao', 'honorario_ambulatorial')${
           comData ? ' AND ctv.vigencia_inicio <= ? AND (ctv.vigencia_fim IS NULL OR ctv.vigencia_fim >= ?)' : ''
         }
         AND EXISTS (SELECT 1 FROM tabela_preco t WHERE t.id = ctv.tabela_preco_id AND t.estabelecimento_id = k.estabelecimento_id)
   WHERE k.fonte_pagadora_id = ? AND k.estabelecimento_id = ? AND k.excluido_em IS NULL AND k.situacao <> 'rascunho'${
     comData ? ' AND k.vigencia_inicio <= ? AND (k.vigencia_fim IS NULL OR k.vigencia_fim >= ?)' : ''
   }`;

interface Acordo {
  readonly existe: boolean;
  readonly tabelas: readonly number[];
}

/**
 * Filtro de escopo: a linha do acordo da fonte pagadora (sem tabela, ou com uma tabela do acordo deste
 * estabelecimento) ou a linha de uma das tabelas do acordo. A linha da fonte com tabela de outro estabelecimento nunca
 * entra. Sem acordo, o filtro não aceita nada.
 */
function escopo(alias: string, conv: number, a: Acordo): { sql: string; p: unknown[] } {
  if (!a.existe) return { sql: 'FALSE', p: [] };
  const em = a.tabelas.map(() => '?').join(', ');
  if (!a.tabelas.length)
    return { sql: `(${alias}.fonte_pagadora_id = ? AND ${alias}.tabela_preco_id IS NULL)`, p: [conv] };
  return {
    sql: `((${alias}.fonte_pagadora_id = ? AND (${alias}.tabela_preco_id IS NULL OR ${alias}.tabela_preco_id IN (${em})))
       OR (${alias}.fonte_pagadora_id IS NULL AND ${alias}.tabela_preco_id IN (${em})))`,
    p: [conv, ...a.tabelas, ...a.tabelas],
  };
}

async function acordo(l: Leitor, conv: number, est: number, data: string | null): Promise<Acordo> {
  const ls = await l.consultar(
    SQL_ACORDO(data !== null),
    data !== null ? [data, data, conv, est, data, data] : [conv, est],
    { teto: 200 },
  );
  const tabelas = [
    ...new Set(
      ls.filter((r) => r['tabela_preco_id'] !== null && r['tabela_preco_id'] !== undefined).map((r) => Number(r['tabela_preco_id'])),
    ),
  ];
  return { existe: ls.length > 0, tabelas };
}

/** Índices do convênio na data: chave do índice → valor (o do acordo prevalece; a maior vigência ≤ data). */
export async function indicesNaDataPropria(
  l: Leitor,
  est: number,
  conv: number,
  data: string,
): Promise<Map<number, number>> {
  const e = escopo('v', conv, await acordo(l, conv, est, data));
  const ls = await l.consultar(
    `SELECT ic.id AS indice, ic.codigo, ic.tipo_indice, (v.fonte_pagadora_id IS NULL) AS da_tabela, v.valor_indice, v.valor_honorario, v.valor_custo_operacional, v.valor_filme_m2
       FROM valor_indice v JOIN indice_cobranca ic ON ic.id = v.indice_cobranca_id
      WHERE ic.ativo = TRUE AND v.operacao <> 'exclusao' AND ${e.sql}
        AND v.vigencia_inicio <= ? AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= ?)
      ORDER BY (v.fonte_pagadora_id IS NULL), v.vigencia_inicio DESC, v.id DESC`,
    [...e.p, data, data],
    { teto: 500 },
  );
  // Por chave, vale a primeira linha da ordenação (acordo antes da tabela, maior vigência). Dois índices diferentes
  // do mesmo tipo valorados no mesmo nível (os dois no acordo, ou os dois na tabela) tornam o valor ambíguo: recusa,
  // em vez de escolher um em silêncio.
  const m = new Map<number, number>();
  const vencedor = new Map<number, { indice: number; daTabela: boolean; codigo: string }>();
  for (const r of ls) {
    const chave = CHAVE_DO_TIPO_INDICE[String(r['tipo_indice'])];
    if (chave === undefined) continue;
    const atual = { indice: Number(r['indice']), daTabela: Number(r['da_tabela']) === 1, codigo: String(r['codigo']) };
    const v = vencedor.get(chave);
    if (!v) {
      vencedor.set(chave, atual);
      m.set(chave, valorDoIndice(r));
    } else if (v.indice !== atual.indice && v.daTabela === atual.daTabela)
      throw recusa(
        'indice-ambiguo',
        `Dois índices do mesmo tipo (${v.codigo} e ${atual.codigo}) estão valorados na data no mesmo nível do acordo; encerre a vigência de um deles.`,
      );
  }
  return m;
}

/** Valor do porte de honorário (pelo código do porte, ex.: 3A) do convênio na data, ou null. */
export async function porteNaDataPropria(
  l: Leitor,
  est: number,
  conv: number,
  porte: string,
  data: string,
): Promise<number | null> {
  const e = escopo('v', conv, await acordo(l, conv, est, data));
  const r = await l.uma(
    `SELECT v.valor FROM valor_porte_medico v JOIN porte_procedimento po ON po.id = v.porte_procedimento_id
      WHERE po.codigo = ? AND po.tipo_porte = 'honorario' AND v.operacao <> 'exclusao' AND ${e.sql}
        AND v.vigencia_inicio <= ? AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= ?)
      ORDER BY (v.fonte_pagadora_id IS NULL), v.vigencia_inicio DESC, v.id DESC LIMIT 1`,
    [porte, ...e.p, data, data],
  );
  return r ? Number(r['valor']) : null;
}

/** Todas as vigências de índice e de porte do convênio (a tela do contrato marca a vigente). */
export async function indicesConvenioPropria(
  l: Leitor,
  est: number,
  conv: number,
): Promise<IndiceConvenio[]> {
  const e = escopo('v', conv, await acordo(l, conv, est, null));
  const indices = await l.consultar(
    `SELECT ic.tipo_indice, ic.codigo, v.vigencia_inicio, v.valor_indice, v.valor_honorario,
            v.valor_custo_operacional, v.valor_filme_m2
       FROM valor_indice v JOIN indice_cobranca ic ON ic.id = v.indice_cobranca_id
      WHERE ic.ativo = TRUE AND v.operacao <> 'exclusao' AND ${e.sql}
      ORDER BY ic.tipo_indice, (v.fonte_pagadora_id IS NULL), v.vigencia_inicio DESC, v.id DESC`,
    e.p,
    { teto: 2_000 },
  );
  const portes = await l.consultar(
    `SELECT po.codigo, v.vigencia_inicio, v.valor
       FROM valor_porte_medico v JOIN porte_procedimento po ON po.id = v.porte_procedimento_id
      WHERE po.tipo_porte = 'honorario' AND v.operacao <> 'exclusao' AND ${e.sql}
      ORDER BY po.ordem, po.codigo, (v.fonte_pagadora_id IS NULL), v.vigencia_inicio DESC, v.id DESC`,
    e.p,
    { teto: 2_000 },
  );
  const vistos = new Set<string>();
  const unico = (k: string) => (vistos.has(k) ? false : (vistos.add(k), true));
  return [
    ...indices
      .map((r) => {
        const chave = CHAVE_DO_TIPO_INDICE[String(r['tipo_indice'])];
        return {
          tipo: 'indice' as const,
          chave: chave !== undefined ? String(chave) : String(r['codigo']),
          data: dataIso(r['vigencia_inicio']),
          valor: valorDoIndice(r),
        };
      })
      .filter((i) => unico(`i|${i.chave}|${i.data}`)),
    ...portes
      .map((r) => ({
        tipo: 'porte' as const,
        chave: String(r['codigo']),
        data: dataIso(r['vigencia_inicio']),
        valor: Number(r['valor']),
      }))
      .filter((i) => unico(`p|${i.chave}|${i.data}`)),
  ];
}

const COLUNAS_PORTE: [string, string][] = [
  ['tabela', 'Tabela de porte'],
  ['porte', 'Porte anestésico'],
  ['data', 'Vigência'],
  ['valor', 'Valor'],
  ['valorHorarioEspecial', 'Valor em horário especial'],
];

/** Portes anestésicos por tabela e vigência (tabela null: todas as do estabelecimento). */
export async function portesPropria(
  l: Leitor,
  est: number,
  tab: number | null,
  pagina: number,
  porPagina: number,
): Promise<Pagina> {
  const de = `FROM valor_porte_anestesico v JOIN tabela_preco t ON t.id = v.tabela_preco_id
     WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND v.operacao <> 'exclusao'${
       tab !== null ? ' AND v.tabela_preco_id = ?' : ''
     }`;
  const p = tab !== null ? [est, tab] : [est];
  const total = await l.uma<{ total: unknown }>(`SELECT COUNT(*) AS total ${de}`, p);
  const ls = await l.consultar(
    `SELECT v.tabela_preco_id, v.porte_anestesico, v.vigencia_inicio, v.valor, v.valor_horario_especial ${de}
      ORDER BY v.tabela_preco_id, LPAD(v.porte_anestesico, 4, '0'), v.vigencia_inicio DESC, v.id DESC
      LIMIT ? OFFSET ?`,
    [...p, porPagina, pagina * porPagina],
  );
  return {
    colunas: COLUNAS_PORTE.map(([campo, rotulo]) => ({ campo, rotulo })),
    itens: ls.map((r) => ({
      tabela: Number(r['tabela_preco_id']),
      porte: String(r['porte_anestesico']),
      data: dataIso(r['vigencia_inicio']),
      valor: Number(r['valor']),
      valorHorarioEspecial:
        r['valor_horario_especial'] === null || r['valor_horario_especial'] === undefined
          ? null
          : Number(r['valor_horario_especial']),
    })),
    total: Number(total?.total ?? 0),
  };
}

/** Regime do atendimento para escolher a tabela de honorários do acordo (e, com ela, a do porte anestésico). */
export type RegimePorte = 'internacao' | 'ambulatorial';

/**
 * Tabela do porte anestésico do acordo na data do atendimento: a de honorários do regime (internação ou
 * ambulatorial) vigente na data; sem a do regime, a do outro regime. O porte anestésico mora na tabela de honorários
 * (valor_porte_anestesico por tabela), por isso a tabela sai do acordo pelo regime e pela data, nunca pela data de hoje.
 */
export async function tabelaPorteAnestesicoNaDataPropria(
  l: Leitor,
  est: number,
  conv: number,
  regime: RegimePorte,
  data: string,
): Promise<number | null> {
  const r = await l.uma(
    `SELECT ctv.tabela_preco_id FROM contrato_tabela_vigencia ctv
       JOIN contrato_fonte_pagadora k ON k.id = ctv.contrato_fonte_pagadora_id
       JOIN tabela_preco t ON t.id = ctv.tabela_preco_id AND t.estabelecimento_id = k.estabelecimento_id
      WHERE k.fonte_pagadora_id = ? AND k.estabelecimento_id = ? AND k.excluido_em IS NULL AND k.situacao <> 'rascunho'
        AND k.vigencia_inicio <= ? AND (k.vigencia_fim IS NULL OR k.vigencia_fim >= ?)
        AND ctv.tipo_item IN ('honorario_internacao', 'honorario_ambulatorial')
        AND ctv.vigencia_inicio <= ? AND (ctv.vigencia_fim IS NULL OR ctv.vigencia_fim >= ?)
      ORDER BY (ctv.tipo_item = ?) DESC, ctv.vigencia_inicio DESC, ctv.id DESC LIMIT 1`,
    [conv, est, data, data, data, data, regime === 'internacao' ? 'honorario_internacao' : 'honorario_ambulatorial'],
  );
  return r ? Number(r['tabela_preco_id']) : null;
}

/** Valor do porte anestésico do acordo na data e no regime (com o valor em horário especial), ou null. */
export async function porteAnestesicoNaDataPropria(
  l: Leitor,
  est: number,
  conv: number,
  regime: RegimePorte,
  porte: string,
  data: string,
): Promise<{ tabela: number; valor: number; valorHorarioEspecial: number | null } | null> {
  const tabela = await tabelaPorteAnestesicoNaDataPropria(l, est, conv, regime, data);
  if (tabela === null) return null;
  const r = await l.uma(
    `SELECT v.valor, v.valor_horario_especial FROM valor_porte_anestesico v
      WHERE v.tabela_preco_id = ? AND v.porte_anestesico = ? AND v.operacao <> 'exclusao'
        AND v.vigencia_inicio <= ? AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= ?)
      ORDER BY v.vigencia_inicio DESC, v.id DESC LIMIT 1`,
    [tabela, porte, data, data],
  );
  if (!r) return null;
  const he = r['valor_horario_especial'];
  return { tabela, valor: Number(r['valor']), valorHorarioEspecial: he === null || he === undefined ? null : Number(he) };
}
