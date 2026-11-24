// Índices de cobrança e portes do M12 sobre o banco do cliente (06-FAT linha 5): o valor do índice (coeficiente de
// honorário, custo operacional, filme) por vigência em valor_indice, o valor de cada porte de honorário em
// valor_porte_medico e o valor do porte anestésico em valor_porte_anestesico. O honorário pelo índice (modelo CH ou
// PORTE do @sgh/dominio-preco) sai destes valores na data do atendimento.
// Escopo: o valor do acordo com a fonte pagadora (fonte_pagadora_id) prevalece sobre o da tabela de honorários do
// acordo (tabela_preco_id da regra de tabela vigente na data); a tabela é sempre a do estabelecimento da sessão.
// A linha com operação de exclusão nunca vale (o histórico do valor fica no banco).
import type { Leitor } from '@sgh/nucleo';
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
 * Tabelas de honorários do acordo da fonte pagadora no estabelecimento, vigentes na data (null: todas as que o
 * acordo já teve, para o histórico da tela).
 */
const SQL_TABELAS_DO_ACORDO = (comData: boolean) => `
  SELECT DISTINCT ctv.tabela_preco_id FROM contrato_tabela_vigencia ctv
    JOIN contrato_fonte_pagadora k ON k.id = ctv.contrato_fonte_pagadora_id
    JOIN tabela_preco t ON t.id = ctv.tabela_preco_id AND t.estabelecimento_id = k.estabelecimento_id
   WHERE k.fonte_pagadora_id = ? AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
     AND ctv.tipo_item IN ('honorario_internacao', 'honorario_ambulatorial')${
       comData ? ' AND ctv.vigencia_inicio <= ? AND (ctv.vigencia_fim IS NULL OR ctv.vigencia_fim >= ?)' : ''
     }`;

/** Filtro de escopo: o acordo da fonte pagadora ou uma das tabelas do acordo (fonte primeiro na ordenação). */
function escopo(alias: string, tabelas: readonly number[]): { sql: string; p: unknown[] } {
  const emTabelas = tabelas.length
    ? ` OR (${alias}.fonte_pagadora_id IS NULL AND ${alias}.tabela_preco_id IN (${tabelas.map(() => '?').join(', ')}))`
    : '';
  return { sql: `(${alias}.fonte_pagadora_id = ?${emTabelas})`, p: [...tabelas] };
}

async function tabelasDoAcordo(l: Leitor, conv: number, est: number, data: string | null): Promise<number[]> {
  const ls = await l.consultar(
    SQL_TABELAS_DO_ACORDO(data !== null),
    data !== null ? [conv, est, data, data] : [conv, est],
    { teto: 100 },
  );
  return ls.map((r) => Number(r['tabela_preco_id']));
}

/** Índices do convênio na data: chave do índice → valor (o do acordo prevalece; a maior vigência ≤ data). */
export async function indicesNaDataPropria(
  l: Leitor,
  est: number,
  conv: number,
  data: string,
): Promise<Map<number, number>> {
  const tabelas = await tabelasDoAcordo(l, conv, est, data);
  const e = escopo('v', tabelas);
  const ls = await l.consultar(
    `SELECT ic.tipo_indice, v.valor_indice, v.valor_honorario, v.valor_custo_operacional, v.valor_filme_m2
       FROM valor_indice v JOIN indice_cobranca ic ON ic.id = v.indice_cobranca_id
      WHERE ic.ativo = TRUE AND v.operacao <> 'exclusao' AND ${e.sql}
        AND v.vigencia_inicio <= ? AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= ?)
      ORDER BY (v.fonte_pagadora_id IS NULL), v.vigencia_inicio DESC, v.id DESC`,
    [conv, ...e.p, data, data],
    { teto: 500 },
  );
  const m = new Map<number, number>();
  for (const r of ls) {
    const chave = CHAVE_DO_TIPO_INDICE[String(r['tipo_indice'])];
    if (chave !== undefined && !m.has(chave)) m.set(chave, valorDoIndice(r));
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
  const tabelas = await tabelasDoAcordo(l, conv, est, data);
  const e = escopo('v', tabelas);
  const r = await l.uma(
    `SELECT v.valor FROM valor_porte_medico v JOIN porte_procedimento po ON po.id = v.porte_procedimento_id
      WHERE po.codigo = ? AND po.tipo_porte = 'honorario' AND v.operacao <> 'exclusao' AND ${e.sql}
        AND v.vigencia_inicio <= ? AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= ?)
      ORDER BY (v.fonte_pagadora_id IS NULL), v.vigencia_inicio DESC, v.id DESC LIMIT 1`,
    [porte, conv, ...e.p, data, data],
  );
  return r ? Number(r['valor']) : null;
}

/** Todas as vigências de índice e de porte do convênio (a tela do contrato marca a vigente). */
export async function indicesConvenioPropria(
  l: Leitor,
  est: number,
  conv: number,
): Promise<IndiceConvenio[]> {
  const tabelas = await tabelasDoAcordo(l, conv, est, null);
  const e = escopo('v', tabelas);
  const indices = await l.consultar(
    `SELECT ic.tipo_indice, ic.codigo, v.vigencia_inicio, v.valor_indice, v.valor_honorario,
            v.valor_custo_operacional, v.valor_filme_m2
       FROM valor_indice v JOIN indice_cobranca ic ON ic.id = v.indice_cobranca_id
      WHERE v.operacao <> 'exclusao' AND ${e.sql}
      ORDER BY ic.tipo_indice, (v.fonte_pagadora_id IS NULL), v.vigencia_inicio DESC, v.id DESC`,
    [conv, ...e.p],
    { teto: 2_000 },
  );
  const portes = await l.consultar(
    `SELECT po.codigo, v.vigencia_inicio, v.valor
       FROM valor_porte_medico v JOIN porte_procedimento po ON po.id = v.porte_procedimento_id
      WHERE po.tipo_porte = 'honorario' AND v.operacao <> 'exclusao' AND ${e.sql}
      ORDER BY po.ordem, po.codigo, (v.fonte_pagadora_id IS NULL), v.vigencia_inicio DESC, v.id DESC`,
    [conv, ...e.p],
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
