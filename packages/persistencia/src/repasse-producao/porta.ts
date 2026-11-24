// Porta de persistência da produção do repasse a partir da conta do paciente (F3, motores). Só SQL e conversão: a regra
// (o que nasce, o que estorna, o débito e o crédito) é de @sgh/dominio-repasse (producao-conta.ts,
// sincronizarProducaoDaConta), que recebe esta porta. A API (faturamento, repasse, operadora/TISS) e o worker (glosa do
// financeiro) a montam sobre a transação de quem mudou a conta: a sincronização corre na mesma transação, sem gatilho.
// O objeto devolvido tem a forma da PortaProducaoConta do domínio (conferida pelo TypeScript em quem chama).
import { definicaoParametro, FUSO_PADRAO, instanteParaDataHora, type RegraRepasse } from '@sgh/contratos';
import { type ContextoOperacao, garantirSequencia, type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoN = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
const marcas = (xs: readonly unknown[]) => xs.map(() => '?').join(', ');

/** Tabelas que a sincronização grava (a operação que a chama as declara também). */
export const TABELAS_PRODUCAO_CONTA: readonly string[] = [
  'conta_hospitalar_item',
  'producao_repasse',
  'estorno_repasse',
  'lancamento_repasse',
  'sequencia_negocio',
];

/** Data civil e hora "HH:MM" de um instante no fuso do estabelecimento (fuso inválido: o padrão). */
export function civilNoFuso(instante: Date, fuso: string = FUSO_PADRAO): { data: string; hora: string } {
  try {
    return { ...instanteParaDataHora(instante.toISOString(), fuso) };
  } catch {
    return { ...instanteParaDataHora(instante.toISOString(), FUSO_PADRAO) };
  }
}

/** Código das regras de repasse integral da consulta particular gravadas pelo conector (ADR 0009). */
export const PREFIXO_INTEGRAL = 'INTEGRAL-PART-%';

export const SQL_REGRAS = `
  SELECT i.id, r.vigencia_inicio, r.beneficiario, r.base_calculo, i.profissional_id, i.fonte_pagadora_id, i.codigo_procedimento_inicial,
         i.codigo_procedimento_final, i.especialidade_medica_id, i.funcao_equipe_cobranca_id, i.grupo_ato_id, i.local_atendimento_id,
         i.unidade_assistencial_id, i.centro_custo_id, i.cooperativa_medica_id, i.tipo_lancamento_id, i.escopo_conta,
         i.hora_inicio, i.hora_fim, i.percentual, i.valor_fixo, i.percentual_feriado, i.percentual_fim_semana,
         COALESCE(i.evento_repasse_id, r.evento_repasse_id) AS evento
    FROM regra_repasse r
    JOIN regra_repasse_item i ON i.regra_repasse_id = r.id AND i.excluido_em IS NULL
   WHERE r.estabelecimento_id = ? AND r.ativo = TRUE AND r.vigencia_inicio <= ?
     AND (r.vigencia_fim IS NULL OR r.vigencia_fim >= ?) AND (i.fonte_pagadora_id = ? OR i.fonte_pagadora_id IS NULL)`;

const CONTA_DO_ESCOPO: Readonly<Record<string, RegraRepasse['tipoConta']>> = {
  todas: 'A',
  externa: 'E',
  internacao: 'I',
};

export function regraDe(r: Linha): RegraRepasse {
  const cod = (v: unknown) =>
    v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v);
  return {
    id: n(r['id']),
    vigencia: dataIso(r['vigencia_inicio']) ?? '',
    beneficiario: texto(r['beneficiario']) === 'prestador' ? 'P' : 'M',
    // Regra de um profissional (a dimensão mais forte); null: vale para todos.
    profissional: nn(r['profissional_id']),
    prestador: null,
    convenio: nn(r['fonte_pagadora_id']),
    procedimentoInicial: cod(r['codigo_procedimento_inicial']),
    procedimentoFinal: cod(r['codigo_procedimento_final']),
    especialidade: nn(r['especialidade_medica_id']),
    ato: nn(r['funcao_equipe_cobranca_id']),
    // O grupo de ato do procedimento (o "ato" da regra da origem); casa com o grupo do item faturável.
    grupoAto: nn(r['grupo_ato_id']),
    local: nn(r['local_atendimento_id']),
    unidade: nn(r['unidade_assistencial_id']),
    centroCusto: nn(r['centro_custo_id']),
    cooperativa: nn(r['cooperativa_medica_id']),
    tipoLancamento: nn(r['tipo_lancamento_id']),
    tipoConta: CONTA_DO_ESCOPO[texto(r['escopo_conta'])] ?? 'A',
    // Sem horário na regra: vale o dia todo (o domínio compara a hora do item com a janela).
    horaInicial: textoN(r['hora_inicio'])?.slice(0, 5) || '00:00',
    horaFinal: textoN(r['hora_fim'])?.slice(0, 5) || '23:59',
    percentual: n(r['percentual']),
    valorFixo: n(r['valor_fixo']),
    percentualFeriado: n(r['percentual_feriado']),
    percentualFimDeSemana: n(r['percentual_fim_semana']),
    base: (textoN(r['base_calculo']) as RegraRepasse['base']) ?? null,
    evento: nn(r['evento']),
  };
}

/**
 * O código de negócio do procedimento (item faturável) como número, para casar com a faixa da regra. Um código que não
 * é só de dígitos fica fora de qualquer faixa (0: as faixas da regra começam em 1); a regra sem faixa vale para ele.
 */
export function codigoProcedimento(v: unknown): number {
  const t = texto(v).trim();
  return /^\d{1,15}$/.test(t) ? Number(t) : 0;
}

/** ADR 0009: as regras integrais da consulta particular vigentes na data, como gravadas (o domínio as confere). */
export async function lerIntegraisBrutas(
  l: Leitor,
  est: number,
  data: string,
): Promise<{
  brutas: {
    fontePagadoraId: number;
    tipoFonte: string;
    profissionalId: number | null;
    itemFaturavelId: number | null;
    grupoFaturamentoId: number | null;
  }[];
  grupoDoProcedimento: Map<number, number>;
}> {
  const rs = await l.consultar(
    `SELECT i.fonte_pagadora_id, f.tipo AS tipo_fonte, i.profissional_id, ifa.codigo AS item_codigo, i.grupo_faturamento_id
       FROM regra_repasse r
       JOIN regra_repasse_item i ON i.regra_repasse_id = r.id AND i.excluido_em IS NULL
       -- Só a fonte particular: a marca "consulta particular inteira ao médico" nunca vale num convênio.
       JOIN fonte_pagadora f ON f.id = i.fonte_pagadora_id AND f.tipo = 'particular'
       LEFT JOIN item_faturavel ifa ON ifa.id = i.item_faturavel_id
      WHERE r.estabelecimento_id = ? AND r.ativo = TRUE AND r.codigo LIKE ? AND r.vigencia_inicio <= ?
        AND (r.vigencia_fim IS NULL OR r.vigencia_fim >= ?) AND i.percentual = 100
        AND i.fonte_pagadora_id IS NOT NULL AND (i.item_faturavel_id IS NOT NULL OR i.grupo_faturamento_id IS NOT NULL)
      ORDER BY i.id`,
    [est, PREFIXO_INTEGRAL, data, data],
    { teto: 500 },
  );
  const brutas = [];
  for (const r of rs) {
    const item = r['item_codigo'] == null ? null : codigoProcedimento(r['item_codigo']);
    if (item === 0) continue; // código que não é só de dígitos: nenhum item de produção casa com ele
    brutas.push({
      fontePagadoraId: n(r['fonte_pagadora_id']),
      tipoFonte: String(r['tipo_fonte']),
      profissionalId: nn(r['profissional_id']),
      itemFaturavelId: item,
      grupoFaturamentoId: item === null ? nn(r['grupo_faturamento_id']) : null,
    });
  }
  const grupos = [
    ...new Set(brutas.flatMap((x) => (x.grupoFaturamentoId === null ? [] : [x.grupoFaturamentoId]))),
  ];
  const grupoDoProcedimento = new Map<number, number>();
  if (grupos.length > 0)
    for (const r of await l.consultar(
      `SELECT codigo, grupo_faturamento_id FROM item_faturavel
        WHERE grupo_faturamento_id IN (${marcas(grupos)}) AND excluido_em IS NULL`,
      grupos,
      { teto: 20000 },
    )) {
      const cod = codigoProcedimento(r['codigo']);
      if (cod !== 0) grupoDoProcedimento.set(cod, n(r['grupo_faturamento_id']));
    }
  return { brutas, grupoDoProcedimento };
}

/** Os parâmetros no estabelecimento (o valor vigente do estabelecimento, senão o da rede, senão o padrão). */
async function parametros(l: Leitor, est: number, chaves: readonly string[]): Promise<Map<string, string>> {
  const rs = await l.consultar(
    `SELECT d.chave, d.valor_padrao,
            (SELECT v.valor FROM parametro_valor v
              WHERE v.parametro_definicao_id = d.id AND v.vigencia_inicio <= NOW()
                AND (v.vigencia_fim IS NULL OR v.vigencia_fim > NOW())
                AND ((v.nivel = 'estabelecimento' AND v.estabelecimento_id = ?) OR v.nivel = 'rede')
              ORDER BY FIELD(v.nivel, 'estabelecimento', 'rede'), v.vigencia_inicio DESC, v.id DESC
              LIMIT 1) AS valor
       FROM parametro_definicao d
      WHERE d.ativo AND d.chave IN (${marcas(chaves)})`,
    [est, ...chaves],
    { teto: chaves.length },
  );
  const m = new Map<string, string>();
  for (const k of chaves) {
    const r = rs.find((x) => x['chave'] === k);
    const v = r ? (r['valor'] ?? r['valor_padrao']) : null;
    m.set(k, v === null || v === undefined ? (definicaoParametro(k)?.padrao ?? '') : String(v).trim());
  }
  return m;
}

/** Um débito do repasse (estorno_repasse 'pendente'), com o número de negócio da sequência do estabelecimento. */
export async function incluirEstornoRepasse(
  tx: TxOperacao,
  est: number,
  usuario: number,
  d: {
    producao: number;
    conta: number | null;
    glosaItem: number | null;
    motivo: string;
    valor: number;
    /** AAAA-MM. */
    competencia: string;
    justificativa: string;
    /** O débito de origem, quando este leva adiante o saldo devedor dele (não coube no bruto da apuração). */
    origem?: number;
  },
): Promise<number> {
  await garantirSequencia(
    tx,
    { tipo: 'estorno_repasse', estabelecimento: est, prefixo: 'ER-' },
    { usuario, agora: new Date() },
  );
  const numero = await tx.proximoNumero('estorno_repasse');
  return tx.incluir('estorno_repasse', {
    estabelecimento_id: est,
    numero: numero.formatado,
    producao_repasse_id: d.producao,
    glosa_item_id: d.glosaItem,
    conta_hospitalar_id: d.conta,
    motivo: d.motivo,
    valor: d.valor,
    competencia: `${d.competencia}-01`,
    justificativa: d.justificativa,
    situacao: 'pendente',
    usuario_id: usuario,
    ...(d.origem !== undefined ? { origem_estorno_repasse_id: d.origem } : {}),
  });
}

/**
 * A porta da sincronização sobre a transação de quem mudou a conta. O contexto traz o estabelecimento e o usuário da
 * sessão (o worker passa os do evento).
 */
export function portaProducaoConta(
  tx: TxOperacao,
  ctx: Pick<ContextoOperacao, 'estabelecimento' | 'usuario'>,
) {
  const est = ctx.estabelecimento;
  if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  const usuario = ctx.usuario;
  if (usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  let fuso = FUSO_PADRAO;

  const incluirDebito = async (d: {
    producao: number;
    conta: number;
    item: number;
    valor: number;
    competencia: string;
    motivo: 'glosa' | 'ajuste';
  }) => {
    const glosa =
      d.motivo === 'glosa'
        ? await tx.uma<Linha>(
            `SELECT gi.id FROM glosa_item gi WHERE gi.conta_hospitalar_item_id = ? AND gi.excluido_em IS NULL
              ORDER BY gi.id DESC LIMIT 1`,
            [d.item],
          )
        : null;
    const motivo = d.motivo === 'glosa' && glosa ? 'glosa' : 'ajuste';
    await incluirEstornoRepasse(tx, est, usuario, {
      producao: d.producao,
      conta: d.conta,
      glosaItem: motivo === 'glosa' ? n(glosa?.['id']) : null,
      motivo,
      valor: d.valor,
      competencia: d.competencia,
      justificativa:
        d.motivo === 'glosa'
          ? 'Glosa do item da conta depois da apuração do repasse.'
          : 'Item da conta estornado (ou produção que o item não gera mais) depois da apuração do repasse.',
    });
  };

  return {
    async travarConta(id: number) {
      // A trava da conta põe em fila as sincronizações da mesma conta (lançamento, fechamento, glosa, a operação
      // própria): a chave única da produção aceita NULL no prestador e no tipo de lançamento e não barra a duplicata.
      const travada = await tx.consultarParaAtualizar<Linha>(
        'SELECT id FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [id, est],
      );
      const c =
        travada.length === 0
          ? null
          : await tx.uma<Linha>(
              `SELECT ch.id, ch.fonte_pagadora_id, ch.natureza, ch.competencia, ch.situacao, at.especialidade_medica_id,
                      at.local_atendimento_id, at.unidade_assistencial_id, at.centro_custo_id, e.fuso_horario
                 FROM conta_hospitalar ch
                 JOIN atendimento at ON at.id = ch.atendimento_id
                 JOIN estabelecimento e ON e.id = ch.estabelecimento_id
                WHERE ch.id = ? AND ch.estabelecimento_id = ? AND ch.excluido_em IS NULL`,
              [id, est],
            );
      if (!c)
        throw recusa('conta-inexistente', 'A conta não existe neste estabelecimento.', { campos: ['conta'] });
      fuso = texto(c['fuso_horario']) || FUSO_PADRAO;
      const comp =
        c['competencia'] instanceof Date ? c['competencia'].toISOString() : texto(c['competencia']);
      return {
        id: n(c['id']),
        fontePagadora: n(c['fonte_pagadora_id']),
        natureza: texto(c['natureza']),
        competencia: comp.slice(0, 7),
        situacao: texto(c['situacao']),
        especialidade: nn(c['especialidade_medica_id']),
        local: nn(c['local_atendimento_id']),
        unidade: nn(c['unidade_assistencial_id']),
        centroCusto: nn(c['centro_custo_id']),
        mesAtual: civilNoFuso(new Date(), fuso).data.slice(0, 7),
      };
    },
    parametros: (chaves: readonly string[]) => parametros(tx, est, chaves),
    async itens(conta: number, itens?: readonly number[]) {
      // Com os excluídos: o excluído estorna a produção que já existia.
      const filtro = itens && itens.length > 0 ? ` AND chi.id IN (${marcas(itens)})` : '';
      const ls = await tx.consultar<Linha>(
        `SELECT chi.id, chi.situacao, chi.excluido_em, chi.quantidade, chi.valor_total, chi.valor_honorario, chi.valor_glosado,
                chi.pertence_pacote, chi.executante_profissional_id, chi.funcao_equipe_cobranca_id, chi.realizado_em,
                chi.centro_custo_id, chi.tipo_lancamento_id, ifa.codigo AS procedimento, ifa.grupo_ato_id
           FROM conta_hospitalar_item chi
           JOIN item_faturavel ifa ON ifa.id = chi.item_faturavel_id
          WHERE chi.conta_hospitalar_id = ?${filtro}
          ORDER BY chi.id`,
        [conta, ...(itens ?? [])],
        { teto: 20000 },
      );
      if (ls.length === 0) return [];
      const ids = ls.map((r) => n(r['id']));
      const participantes = new Map<
        number,
        {
          profissional: number;
          funcao: number;
          recebedor: number | null;
          forma: 'via_hospital' | 'direto_fonte_pagadora' | 'paciente' | 'sem_cobranca';
          valorBaseRepasse: number | null;
          valorAto: number;
        }[]
      >();
      for (const r of await tx.consultar<Linha>(
        `SELECT conta_hospitalar_item_id, profissional_id, funcao_equipe_cobranca_id, recebedor_prestador_terceiro_id,
                forma_pagamento, valor_base_repasse, valor_ato
           FROM conta_hospitalar_item_participante
          WHERE conta_hospitalar_item_id IN (${marcas(ids)}) AND excluido_em IS NULL
          ORDER BY conta_hospitalar_item_id, sequencia`,
        ids,
        { teto: 20000 },
      )) {
        const k = n(r['conta_hospitalar_item_id']);
        const lista = participantes.get(k) ?? [];
        lista.push({
          profissional: n(r['profissional_id']),
          funcao: n(r['funcao_equipe_cobranca_id']),
          recebedor: nn(r['recebedor_prestador_terceiro_id']),
          forma: texto(r['forma_pagamento']) as 'via_hospital',
          valorBaseRepasse: r['valor_base_repasse'] === null ? null : n(r['valor_base_repasse']),
          valorAto: n(r['valor_ato']),
        });
        participantes.set(k, lista);
      }
      return ls.map((r) => {
        const realizado =
          r['realizado_em'] instanceof Date ? r['realizado_em'] : new Date(String(r['realizado_em']));
        const quando = civilNoFuso(realizado, fuso);
        return {
          item: {
            id: n(r['id']),
            situacao: texto(r['situacao']),
            excluido: r['excluido_em'] !== null && r['excluido_em'] !== undefined,
            quantidade: n(r['quantidade']),
            valorTotal: n(r['valor_total']),
            valorHonorario: n(r['valor_honorario']),
            valorGlosado: n(r['valor_glosado']),
            pertencePacote: Boolean(n(r['pertence_pacote'])),
            executante: nn(r['executante_profissional_id']),
            funcao: nn(r['funcao_equipe_cobranca_id']),
            participantes: participantes.get(n(r['id'])) ?? [],
          },
          data: quando.data,
          hora: quando.hora,
          procedimento: codigoProcedimento(r['procedimento']),
          grupoAto: nn(r['grupo_ato_id']),
          centroCusto: nn(r['centro_custo_id']),
          tipoLancamento: nn(r['tipo_lancamento_id']),
        };
      });
    },
    async funcoes() {
      return (
        await tx.consultar<Linha>(
          'SELECT id, tipo_funcao, ativo, ordem_apresentacao FROM funcao_equipe_cobranca',
          [],
          {
            teto: 1000,
          },
        )
      ).map((r) => ({
        id: n(r['id']),
        tipo: texto(r['tipo_funcao']),
        ativo: Boolean(n(r['ativo'])),
        ordem: nn(r['ordem_apresentacao']),
      }));
    },
    async producoes(itens: readonly number[]) {
      if (itens.length === 0) return [];
      const ps = await tx.consultarParaAtualizar<Linha>(
        `SELECT p.id, p.versao, p.conta_hospitalar_item_id, p.profissional_id, p.prestador_terceiro_id,
                p.funcao_equipe_cobranca_id, p.situacao, p.valor_base, p.valor_repasse
           FROM producao_repasse p
          WHERE p.conta_hospitalar_item_id IN (${marcas(itens)}) AND p.estabelecimento_id = ? AND p.excluido_em IS NULL
          ORDER BY p.id`,
        [...itens, est],
        { teto: 20000 },
      );
      const pids = ps.map((p) => n(p['id']));
      const apurado = new Map<number, number>();
      const estornado = new Map<number, number>();
      if (pids.length > 0) {
        // Integrada: está numa apuração que já passou da fase aberta (a aberta é recalculada e larga a estornada).
        for (const r of await tx.consultar<Linha>(
          `SELECT ai.producao_repasse_id, ai.valor_repasse
             FROM apuracao_repasse_item ai
             JOIN apuracao_repasse a ON a.id = ai.apuracao_repasse_id
            WHERE ai.producao_repasse_id IN (${marcas(pids)}) AND ai.excluido_em IS NULL AND a.excluido_em IS NULL
              AND a.situacao NOT IN ('em_apuracao', 'apurada', 'cancelada')
            ORDER BY ai.id`,
          pids,
          { teto: 20000 },
        ))
          apurado.set(n(r['producao_repasse_id']), n(r['valor_repasse']));
        // O já estornado é líquido dos créditos já lançados (glosa revertida depois do desconto). O saldo devedor
        // levado adiante (origem_estorno_repasse_id) é parte do débito de origem: não conta de novo.
        for (const r of await tx.consultar<Linha>(
          `SELECT x.p, SUM(x.v) AS v FROM (
             SELECT producao_repasse_id AS p, valor AS v FROM estorno_repasse
              WHERE producao_repasse_id IN (${marcas(pids)}) AND excluido_em IS NULL AND situacao <> 'cancelado'
                AND origem_estorno_repasse_id IS NULL
             UNION ALL
             SELECT producao_repasse_id, -valor FROM lancamento_repasse
              WHERE producao_repasse_id IN (${marcas(pids)}) AND excluido_em IS NULL AND situacao <> 'cancelado'
           ) x GROUP BY x.p`,
          [...pids, ...pids],
          { teto: 20000 },
        ))
          estornado.set(n(r['p']), n(r['v']));
      }
      return ps.map((p) => {
        const id = n(p['id']);
        return {
          id,
          versao: n(p['versao']),
          item: n(p['conta_hospitalar_item_id']),
          profissional: n(p['profissional_id']),
          prestador: nn(p['prestador_terceiro_id']),
          funcao: n(p['funcao_equipe_cobranca_id']),
          situacao: texto(p['situacao']),
          valorBase: n(p['valor_base']),
          valorRepasse: nn(p['valor_repasse']),
          apurado: apurado.get(id) ?? null,
          estornado: estornado.get(id) ?? 0,
        };
      });
    },
    async competenciasFechadas(depoisDe: string) {
      // Períodos com apuração já conferida (não se recalculam mais): o débito passa adiante.
      return new Set(
        (
          await tx.consultar<Linha>(
            `SELECT DATE_FORMAT(competencia, '%Y-%m') AS c FROM apuracao_repasse
              WHERE estabelecimento_id = ? AND excluido_em IS NULL AND competencia > ?
                AND situacao NOT IN ('em_apuracao', 'apurada', 'cancelada')
              ORDER BY competencia`,
            [est, `${depoisDe}-01`],
            { teto: 1000 },
          )
        ).map((r) => texto(r['c'])),
      );
    },
    async regras(data: string, fontePagadora: number) {
      return (
        await tx.consultar<Linha>(
          `${SQL_REGRAS} AND r.codigo NOT LIKE ? ORDER BY i.id`,
          [est, data, data, fontePagadora, PREFIXO_INTEGRAL],
          { teto: 20000 },
        )
      ).map(regraDe);
    },
    integrais: (data: string) => lerIntegraisBrutas(tx, est, data),
    async cooperativa(profissional: number) {
      const r = await tx.uma<Linha>('SELECT cooperativa_medica_id FROM profissional WHERE id = ?', [
        profissional,
      ]);
      return nn(r?.['cooperativa_medica_id']);
    },
    async incluirProducao(p: {
      item: number;
      conta: number;
      profissional: number;
      prestador: number | null;
      funcao: number;
      tipoLancamento: number | null;
      quantidade: number;
      valorBase: number;
      percentual: number | null;
      valorRepasse: number | null;
      pertencePacote: boolean;
    }) {
      return tx.incluir('producao_repasse', {
        estabelecimento_id: est,
        conta_hospitalar_item_id: p.item,
        conta_hospitalar_id: p.conta,
        profissional_id: p.profissional,
        prestador_terceiro_id: p.prestador,
        funcao_equipe_cobranca_id: p.funcao,
        tipo_lancamento_id: p.tipoLancamento,
        quantidade: p.quantidade,
        valor_base: p.valorBase,
        percentual: p.percentual,
        valor_repasse: p.valorRepasse,
        pertence_pacote: p.pertencePacote ? 1 : 0,
        integrado_em: new Date(),
        situacao: 'pendente',
      });
    },
    async alterarProducao(
      id: number,
      versao: number,
      c: { readonly situacao?: string; readonly valorBase?: number; readonly limparPrevia?: boolean },
    ) {
      await tx.alterar('producao_repasse', id, versao, {
        ...(c.situacao !== undefined ? { situacao: c.situacao } : {}),
        ...(c.valorBase !== undefined ? { valor_base: c.valorBase } : {}),
        ...(c.limparPrevia ? { valor_repasse: null, percentual: null } : {}),
      });
    },
    async debitosAbertos(producao: number) {
      return (
        await tx.consultarParaAtualizar<Linha>(
          `SELECT e.id, e.versao, e.valor FROM estorno_repasse e
             LEFT JOIN apuracao_repasse a ON a.id = e.apuracao_repasse_id
            WHERE e.producao_repasse_id = ? AND e.excluido_em IS NULL
              AND (e.situacao = 'pendente' OR (e.situacao = 'aplicado' AND a.situacao IN ('em_apuracao', 'apurada')))
            ORDER BY e.id DESC`,
          [producao],
          { teto: 1000 },
        )
      ).map((e) => ({ id: n(e['id']), versao: n(e['versao']), valor: n(e['valor']) }));
    },
    async glosasDoItem(item: number) {
      return (
        await tx.consultarParaAtualizar<Linha>(
          `SELECT gi.decisao, gi.valor_aceito FROM glosa_item gi JOIN glosa g ON g.id = gi.glosa_id
            WHERE gi.conta_hospitalar_item_id = ? AND gi.excluido_em IS NULL AND g.excluido_em IS NULL
              AND g.situacao <> 'cancelada'
            ORDER BY gi.id`,
          [item],
          { teto: 500 },
        )
      ).map((g) => ({ decisao: texto(g['decisao']), valorAceito: n(g['valor_aceito']) }));
    },
    async gravarGlosadoDoItem(item: number, valor: number) {
      const ci = await tx.uma<Linha>('SELECT versao, valor_glosado FROM conta_hospitalar_item WHERE id = ?', [
        item,
      ]);
      if (ci && Math.round(n(ci['valor_glosado']) * 100) !== Math.round(valor * 100))
        await tx.alterar('conta_hospitalar_item', item, n(ci['versao']), { valor_glosado: valor });
    },
    async cancelarDebito(id: number, versao: number) {
      await tx.alterar('estorno_repasse', id, versao, { situacao: 'cancelado' });
    },
    incluirDebito,
    /**
     * O crédito ao profissional: lançamento de ajuste, positivo, ligado à produção, com o favorecido e o evento do
     * lançamento da apuração em que o débito foi descontado. Sem esse lançamento (a apuração conferida ainda não foi
     * lançada): falso, e o crédito sai na próxima sincronização depois do lançamento.
     */
    async incluirCredito(c: {
      producao: number;
      conta: number;
      item: number;
      valor: number;
      competencia: string;
    }) {
      const o = await tx.uma<Linha>(
        `SELECT l.favorecido_repasse_id, l.tipo_favorecido, l.profissional_id, l.evento_repasse_id
           FROM estorno_repasse e
           JOIN producao_repasse p ON p.id = e.producao_repasse_id
           JOIN lancamento_repasse l ON l.apuracao_repasse_id = e.apuracao_repasse_id AND l.profissional_id = p.profissional_id
                                    AND l.tipo_lancamento = 'apuracao' AND l.excluido_em IS NULL AND l.situacao <> 'cancelado'
          WHERE e.producao_repasse_id = ? AND e.situacao = 'aplicado' AND e.excluido_em IS NULL
          ORDER BY e.id DESC, l.id DESC LIMIT 1`,
        [c.producao],
      );
      if (!o) return false;
      await tx.incluir('lancamento_repasse', {
        estabelecimento_id: est,
        favorecido_repasse_id: n(o['favorecido_repasse_id']),
        tipo_favorecido: texto(o['tipo_favorecido']),
        profissional_id: n(o['profissional_id']),
        evento_repasse_id: n(o['evento_repasse_id']),
        tipo_lancamento: 'ajuste',
        producao_repasse_id: c.producao,
        competencia: `${c.competencia}-01`,
        data_lancamento: civilNoFuso(new Date(), fuso).data,
        valor: c.valor,
        valor_calculado: 1,
        referente: 'Crédito da glosa revertida',
        justificativa:
          'Glosa revertida depois que o débito do repasse já foi descontado numa apuração conferida.',
      });
      return true;
    },
  };
}
