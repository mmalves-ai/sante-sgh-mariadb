// Consultas comuns da contabilidade sobre o banco do cliente (API e worker usam as mesmas): o plano de contas vigente
// do estabelecimento, as contas, os fatos contábeis, as partidas, os períodos, as regras publicadas e o de-para da
// receita, com as conversões da linha do banco para as formas do contrato. Toda leitura filtra o estabelecimento e os
// registros excluídos. Somente leitura: a gravação está em gravacao.ts.
import { createHash } from 'node:crypto';
import {
  type GrupoConta,
  type LadoPartida,
  type OrigemLancamento,
  type PartidaGerada,
  type SituacaoFato,
  TIPOS_FATO,
  type TipoFato,
} from '@sgh/contratos';
import type { Leitor } from '@sgh/nucleo';
import { avisoDoBloqueio } from './bloqueio.js';
import type {
  ContaPlanoVersionada,
  FatoRegistrado,
  ItemDePara,
  LancamentoGravadoDoFato,
  LeituraParaContabilizar,
  PartidaRegistrada,
  PeriodoRegistrado,
  RegraPublicada,
} from './tipos.js';

export type Linha = Record<string, unknown>;
export const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
export const num = (v: unknown): number => Number(v ?? 0);
export const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
export const textoOuNulo = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);
export const bool = (v: unknown): boolean => v === true || Number(v) === 1;
export const corta = (s: string | null, n: number) => (s === null ? null : s.slice(0, n));
/** Competência AAAA-MM ↔ primeiro dia do mês. */
export const diaUm = (competencia: string) => `${competencia.slice(0, 7)}-01`;
export const reais = (centavos: number) => (centavos / 100).toFixed(2);
export const INSTANTE = `'%Y-%m-%dT%H:%i:%s'`;
export const CENTAVOS = (expr: string) => `CAST(ROUND(COALESCE(${expr}, 0) * 100) AS SIGNED)`;

/** Grupo da tela ↔ natureza da conta no modelo. */
export const NATUREZA_DO_GRUPO: Readonly<Record<GrupoConta, string>> = {
  ativo: 'ativo',
  passivo: 'passivo',
  patrimonioLiquido: 'patrimonio_liquido',
  receita: 'receita',
  custo: 'custo',
  despesa: 'despesa',
  compensacao: 'compensacao',
};
export function grupoDaNatureza(natureza: string, saldo: string): GrupoConta {
  const g = (Object.keys(NATUREZA_DO_GRUPO) as GrupoConta[]).find((k) => NATUREZA_DO_GRUPO[k] === natureza);
  return g ?? (saldo === 'credora' ? 'receita' : 'despesa');
}

/** Situação do fato na tela ↔ no modelo. */
export const SITUACAO_FATO_MODELO: Readonly<Record<SituacaoFato, string>> = {
  pendente: 'pendente',
  contabilizado: 'contabilizado',
  semRegra: 'sem_regra',
  semConta: 'sem_conta',
  substituido: 'substituido',
  ignorado: 'ignorado',
};
export const situacaoFatoDe = (s: unknown): SituacaoFato =>
  (Object.keys(SITUACAO_FATO_MODELO) as SituacaoFato[]).find((k) => SITUACAO_FATO_MODELO[k] === s) ??
  'pendente';

export const ladoDe = (lado: unknown): LadoPartida => (lado === 'credito' ? 'C' : 'D');
export const ladoModelo = (lado: LadoPartida) => (lado === 'C' ? 'credito' : 'debito');
export const origemDoTipo = (tipo: string): OrigemLancamento =>
  ((TIPOS_FATO as Readonly<Record<string, { origem: number }>>)[tipo]?.origem ?? 11) as OrigemLancamento;
export const tiposDaOrigem = (origem: number): string[] =>
  Object.entries(TIPOS_FATO as Readonly<Record<string, { origem: number }>>)
    .filter(([, v]) => v.origem === origem)
    .map(([k]) => k);

/** Chave idempotente do lançamento no banco: o hash da chave do domínio no estabelecimento, na forma de UUID. */
export function chaveDoLancamento(estabelecimento: number, chave: string): string {
  const h = createHash('sha256').update(`${estabelecimento}:${chave}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export const SQL_PLANO = `SELECT COALESCE(
    (SELECT pe.plano_contas_id FROM periodo_contabil pe
      WHERE pe.estabelecimento_id = ? AND pe.plano_contas_id IS NOT NULL AND pe.excluido_em IS NULL
      ORDER BY pe.competencia DESC LIMIT 1),
    (SELECT pc.id FROM plano_contas pc
      WHERE pc.tipo = 'contabil' AND pc.ativo = TRUE AND pc.excluido_em IS NULL AND pc.grupo_consolidacao_id IS NULL
        AND pc.vigencia_inicio <= CURRENT_DATE AND (pc.vigencia_fim IS NULL OR pc.vigencia_fim >= CURRENT_DATE)
      ORDER BY pc.numero_versao DESC, pc.id DESC LIMIT 1)) AS id`;

export const SQL_CONTAS = `SELECT c.id, c.classificacao, c.descricao, c.natureza, c.natureza_saldo, c.tipo, c.exige_centro_custo,
    c.ativo, c.versao, cr.codigo_referencial, cr.plano_referencial_id,
    DATE_FORMAT(COALESCE(c.alterado_em, c.criado_em), ${INSTANTE}) AS alterado_em,
    COALESCE(ua.login, uc.login, '') AS alterado_por
  FROM conta_contabil c
  LEFT JOIN conta_referencial cr ON cr.id = c.conta_referencial_id
  LEFT JOIN usuario ua ON ua.id = c.alterado_por
  LEFT JOIN usuario uc ON uc.id = c.criado_por
  WHERE c.plano_contas_id = ? AND c.excluido_em IS NULL`;

export const SQL_FATOS = `SELECT f.id, f.estabelecimento_id, f.entidade_origem, f.entidade_origem_id, ev.codigo AS tipo,
    DATE_FORMAT(f.data_fato, '%Y-%m-%d') AS data_fato, DATE_FORMAT(f.competencia, '%Y-%m') AS competencia,
    ${CENTAVOS('f.valor')} AS centavos, f.centro_custo_id, f.documento, f.campos, f.impressao, f.estorno,
    fe.impressao AS referencia, f.situacao, f.motivo, f.versao_regra_contabil_id,
    DATE_FORMAT(f.criado_em, ${INSTANTE}) AS lido_em
  FROM fato_contabil f
  JOIN evento_contabil ev ON ev.id = f.evento_contabil_id
  LEFT JOIN fato_contabil fe ON fe.id = f.estornado_fato_contabil_id
  WHERE f.estabelecimento_id = ? AND f.excluido_em IS NULL`;

export const SQL_PARTIDAS = `SELECT p.id, p.lancamento_contabil_id, p.sequencia, p.lado, c.classificacao,
    ${CENTAVOS('p.valor')} AS centavos, p.centro_custo_id, p.complemento, p.conciliacao_conta_contabil_id
  FROM partida_contabil p JOIN conta_contabil c ON c.id = p.conta_contabil_id
  WHERE p.excluido_em IS NULL AND p.lancamento_contabil_id IN `;

export const SQL_PERIODOS = `SELECT p.id, DATE_FORMAT(p.competencia, '%Y-%m') AS competencia, p.situacao, p.versao,
    DATE_FORMAT(p.bloqueado_ate, '%Y-%m-%d') AS bloqueado_ate,
    p.justificativa_reabertura, DATE_FORMAT(p.encerrado_em, ${INSTANTE}) AS encerrado_em, ue.login AS encerrado_por,
    DATE_FORMAT(p.reaberto_em, ${INSTANTE}) AS reaberto_em, ur.login AS reaberto_por,
    (SELECT COUNT(*) FROM lancamento_contabil l WHERE l.periodo_contabil_id = p.id AND l.excluido_em IS NULL) AS lancamentos,
    (SELECT ${CENTAVOS('SUM(x.valor)')} FROM partida_contabil x JOIN lancamento_contabil l ON l.id = x.lancamento_contabil_id
      WHERE l.periodo_contabil_id = p.id AND l.excluido_em IS NULL AND x.excluido_em IS NULL AND x.lado = 'debito') AS debitos,
    (SELECT ${CENTAVOS('SUM(x.valor)')} FROM partida_contabil x JOIN lancamento_contabil l ON l.id = x.lancamento_contabil_id
      WHERE l.periodo_contabil_id = p.id AND l.excluido_em IS NULL AND x.excluido_em IS NULL AND x.lado = 'credito') AS creditos
  FROM periodo_contabil p
  LEFT JOIN usuario ue ON ue.id = p.encerrante_usuario_id
  LEFT JOIN usuario ur ON ur.id = p.reabertura_usuario_id
  WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL`;

export const SQL_REGRAS = `SELECT v.id, v.conteudo, v.impressao, v.justificativa, COALESCE(u.login, '') AS publicada_por,
    DATE_FORMAT(v.publicada_em, ${INSTANTE}) AS publicada_em
  FROM versao_regra_contabil v
  JOIN evento_contabil ev ON ev.id = v.evento_contabil_id
  LEFT JOIN usuario u ON u.id = v.publicador_usuario_id
  WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL`;

export function regraPublicadaDe(r: Linha): RegraPublicada {
  const conteudo = r['conteudo'];
  return {
    id: num(r['id']),
    regra: (typeof conteudo === 'string' ? JSON.parse(conteudo) : conteudo) as RegraPublicada['regra'],
    impressao: texto(r['impressao']),
    justificativa: texto(r['justificativa']),
    publicadaPor: texto(r['publicada_por']),
    publicadaEm: texto(r['publicada_em']),
  };
}

export function contaDe(r: Linha, est: number): ContaPlanoVersionada {
  return {
    empresa: est,
    codigo: texto(r['classificacao']),
    nome: texto(r['descricao']),
    grupo: grupoDaNatureza(texto(r['natureza']), texto(r['natureza_saldo'])),
    tipo: r['tipo'] === 'sintetica' ? 'sintetica' : 'analitica',
    natureza: r['natureza_saldo'] === 'credora' ? 'credora' : 'devedora',
    referencialTipo: numOuNulo(r['plano_referencial_id']),
    referencialConta: textoOuNulo(r['codigo_referencial']),
    contaExportacao: null,
    exigeCentroCusto: bool(r['exige_centro_custo']),
    ativa: bool(r['ativo']),
    versao: num(r['versao']),
    alteradoPor: texto(r['alterado_por']),
    alteradoEm: texto(r['alterado_em']),
  };
}

export function camposDe(v: unknown): Readonly<Record<string, string | number | null>> {
  if (v === null || v === undefined) return {};
  const o: unknown = typeof v === 'string' ? JSON.parse(v) : v;
  return o && typeof o === 'object' ? (o as Record<string, string | number | null>) : {};
}

export function fatoDe(r: Linha): FatoRegistrado {
  const tipo = texto(r['tipo']);
  return {
    tabela: texto(r['entidade_origem']),
    id: num(r['entidade_origem_id']),
    tipo: tipo as TipoFato,
    origem: origemDoTipo(tipo),
    empresa: num(r['estabelecimento_id']),
    data: texto(r['data_fato']),
    competencia: texto(r['competencia']),
    valorCentavos: num(r['centavos']),
    centroCusto: numOuNulo(r['centro_custo_id']),
    documento: texto(r['documento']),
    campos: camposDe(r['campos']),
    impressao: texto(r['impressao']),
    carimbo: null,
    estorno: bool(r['estorno']),
    referencia: textoOuNulo(r['referencia']),
    idFato: num(r['id']),
    situacao: situacaoFatoDe(r['situacao']),
    motivo: textoOuNulo(r['motivo']),
    regraId: numOuNulo(r['versao_regra_contabil_id']),
    lidoEm: texto(r['lido_em']),
  };
}

export function partidaDe(r: Linha): PartidaRegistrada {
  return {
    id: num(r['id']),
    lancamento: num(r['lancamento_contabil_id']),
    ordem: num(r['sequencia']),
    lado: ladoDe(r['lado']),
    conta: texto(r['classificacao']),
    valorCentavos: num(r['centavos']),
    centroCusto: numOuNulo(r['centro_custo_id']),
    historico: texto(r['complemento']),
    conciliacao: numOuNulo(r['conciliacao_conta_contabil_id']),
  };
}

export function periodoDe(r: Linha, est: number): PeriodoRegistrado {
  return {
    empresa: est,
    competencia: texto(r['competencia']),
    // O contrato ainda não tem "bloqueado" (pedido do lote): o período bloqueado aparece aberto, com o aviso na
    // observação, e o lançamento nele é recusado na gravação (bloqueioDoLancamento).
    situacao: r['situacao'] === 'encerrado' ? 'encerrado' : 'aberto',
    lancamentos: num(r['lancamentos']),
    debitos: num(r['debitos']),
    creditos: num(r['creditos']),
    observacao:
      [
        avisoDoBloqueio({ situacao: texto(r['situacao']), bloqueadoAte: textoOuNulo(r['bloqueado_ate']) }),
        textoOuNulo(r['justificativa_reabertura']),
      ]
        .filter((x): x is string => x !== null)
        .join(' ') || null,
    encerradoPor: textoOuNulo(r['encerrado_por']),
    encerradoEm: textoOuNulo(r['encerrado_em']),
    reabertoPor: textoOuNulo(r['reaberto_por']),
    reabertoEm: textoOuNulo(r['reaberto_em']),
    versao: num(r['versao']),
  };
}

/** O plano de contas vigente do estabelecimento (o do último período, ou o contábil vigente da rede). */
export async function lerIdDoPlano(l: Leitor, est: number): Promise<number | null> {
  return numOuNulo((await l.uma(SQL_PLANO, [est]))?.['id']);
}

/** As contas do plano vigente do estabelecimento, em ordem de classificação. */
export async function lerPlano(l: Leitor, est: number): Promise<ContaPlanoVersionada[]> {
  const plano = await lerIdDoPlano(l, est);
  if (plano === null) return [];
  return (await l.consultar(`${SQL_CONTAS} ORDER BY c.classificacao`, [plano])).map((r) => contaDe(r, est));
}

/** O de-para contábil da receita do estabelecimento (só as linhas ativas, pela prioridade). */
export async function lerDePara(l: Leitor, est: number): Promise<ItemDePara[]> {
  const r = await l.consultar(
    `SELECT fonte_pagadora_id, tipo_conta_id, tipo_lancamento_id, conta_receita_id FROM regra_contabil_receita
      WHERE estabelecimento_id = ? AND ativo = TRUE ORDER BY prioridade, id`,
    [est],
  );
  return r.map((x) => ({
    empresa: est,
    convenio: numOuNulo(x['fonte_pagadora_id']),
    tipoConta: texto(x['tipo_conta_id']),
    tipoLancamento: numOuNulo(x['tipo_lancamento_id']),
    tipoAto: null,
    subtipoDiaria: null,
    contaExportacao: numOuNulo(x['conta_receita_id']),
  }));
}

/** Versões publicadas das regras (todas, para o domínio conferir a versão seguinte e a vigência). */
export async function lerRegras(
  l: Leitor,
  est: number,
  f: { readonly tipoFato?: string; readonly origem?: number },
): Promise<RegraPublicada[]> {
  const tipos =
    f.tipoFato !== undefined ? [f.tipoFato] : f.origem !== undefined ? tiposDaOrigem(f.origem) : null;
  if (tipos !== null && tipos.length === 0) return [];
  const filtro = tipos === null ? '' : ` AND ev.codigo IN (${lista(tipos.length)})`;
  return (
    await l.consultar(`${SQL_REGRAS}${filtro} ORDER BY ev.codigo, v.nome, v.numero_versao, v.id`, [
      est,
      ...(tipos ?? []),
    ])
  )
    .map(regraPublicadaDe)
    .filter((r) => f.origem === undefined || r.regra.origem === f.origem);
}

/** Os períodos contábeis do estabelecimento, em ordem de competência. */
export async function lerPeriodos(l: Leitor, est: number): Promise<PeriodoRegistrado[]> {
  return (await l.consultar(`${SQL_PERIODOS} ORDER BY p.competencia`, [est])).map((r) => periodoDe(r, est));
}

/** As partidas dos lançamentos, por lançamento, em ordem. */
export async function lerPartidas(
  l: Leitor,
  ids: readonly number[],
): Promise<Map<number, PartidaRegistrada[]>> {
  const m = new Map<number, PartidaRegistrada[]>();
  if (ids.length === 0) return m;
  const linhas = await l.consultar(
    `${SQL_PARTIDAS} (${lista(ids.length)}) ORDER BY p.lancamento_contabil_id, p.sequencia`,
    [...ids],
  );
  for (const r of linhas) {
    const p = partidaDe(r);
    m.set(p.lancamento, [...(m.get(p.lancamento) ?? []), p]);
  }
  return m;
}

/**
 * O que a contabilização dos fatos lê de uma vez: os candidatos nas situações pedidas (até o lote, por id), todos os
 * fatos das mesmas origens (o ativo e o original do estorno) e os lançamentos automáticos já gravados deles.
 */
export async function lerParaContabilizar(
  l: Leitor,
  est: number,
  situacoes: readonly SituacaoFato[],
  competencia: string | null,
  lote: number,
): Promise<LeituraParaContabilizar> {
  if (situacoes.length === 0)
    return { candidatos: [], registrados: [], lancamentos: new Map(), restam: false };
  const p: unknown[] = [est, ...situacoes.map((s) => SITUACAO_FATO_MODELO[s])];
  const lidos = (
    await l.consultar(
      `${SQL_FATOS} AND f.situacao IN (${lista(situacoes.length)})${competencia ? ' AND f.competencia = ?' : ''}
        ORDER BY f.id LIMIT ?`,
      [...p, ...(competencia ? [diaUm(competencia)] : []), lote + 1],
      { teto: lote + 1 },
    )
  ).map(fatoDe);
  const candidatos = lidos.slice(0, lote);
  const origens = [...new Set(candidatos.map((f) => `${f.tabela}\u0000${f.id}`))].map((k) =>
    k.split('\u0000'),
  );
  const registrados: FatoRegistrado[] = [];
  for (let i = 0; i < origens.length; i += 200) {
    const parte = origens.slice(i, i + 200);
    registrados.push(
      ...(
        await l.consultar(
          `${SQL_FATOS} AND (${parte.map(() => '(f.entidade_origem = ? AND f.entidade_origem_id = ?)').join(' OR ')}) ORDER BY f.id`,
          [est, ...parte.flatMap(([t, id]) => [t, Number(id)])],
        )
      ).map(fatoDe),
    );
  }
  const lancamentos = new Map<number, LancamentoGravadoDoFato>();
  const ids = registrados.map((f) => f.idFato);
  if (ids.length > 0) {
    const ls = await l.consultar(
      `SELECT l.id, l.fato_contabil_id,
              (SELECT e.id FROM lancamento_contabil e WHERE e.estornado_lancamento_contabil_id = l.id LIMIT 1) AS estornado_por
         FROM lancamento_contabil l
        WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL AND l.tipo = 'automatico'
          AND l.fato_contabil_id IN (${lista(ids.length)}) ORDER BY l.id`,
      [est, ...ids],
    );
    const partidas = await lerPartidas(
      l,
      ls.map((x) => num(x['id'])),
    );
    for (const x of ls)
      lancamentos.set(num(x['fato_contabil_id']), {
        id: num(x['id']),
        idFato: num(x['fato_contabil_id']),
        partidas: (partidas.get(num(x['id'])) ?? []).map((pp): PartidaGerada => ({
          lado: pp.lado,
          conta: pp.conta,
          valorCentavos: pp.valorCentavos,
          historico: pp.historico,
          centroCusto: pp.centroCusto,
        })),
        estornadoPor: numOuNulo(x['estornado_por']),
      });
  }
  return { candidatos, registrados, lancamentos, restam: lidos.length > lote };
}
