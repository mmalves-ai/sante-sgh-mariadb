// Regras 1, 2, 7 e 8 do M43: o painel do fim da coexistência por hospital (campo 7). Cada item do critério de
// acompanhamento (cap-15 §15.3.5; DP-5, padrão aprovado em 2026-10-19) e do conjunto do cap-14 §14.9.4 (ao lado,
// regra 2) sai com valor, parcelas, fonte, situação e a data em que ficou verde. Falha fechada: o que não se mediu é
// "sem medida", nunca verde. O fim é registrável quando os cinco itens do cap-15 estão verdes e a contingência
// pós-coexistência está pronta (regra 7); quem registra é o dono, e registrar não desliga nada (regra 8).
import {
  DIAS_SEM_SESSAO,
  ENSAIOS_CONTINGENCIA,
  type EnsaioContingencia,
  FONTE_ITEM_FIM,
  type ItemFim,
  type ItemFimCap14,
  type ItemFimCap15,
  type ItemPainelFim,
  type PainelFimCoexistencia,
  type ParcelaFim,
  type RegistroFimCoexistencia,
} from '@sgh/contratos';
import { type DiaAvaliado, sequenciaSemSessao } from './sem-sessao.js';

/** Operação de uso real do hospital, com o estado nele e o último resultado de assinatura. */
export interface OperacaoUsoReal {
  readonly nome: string;
  readonly estado: string;
  /** Último teste de assinatura do hospital: verde (0 diferença), com diferença, ou null sem execução. */
  readonly assinatura: 'verde' | 'diferenca' | null;
}

export interface EntradaFim {
  readonly estabelecimento: string;
  /** Dia da medida (AAAA-MM-DD) e o instante (ISO). */
  readonly hoje: string;
  readonly medidoEm: string;
  /** Operações de uso real do hospital; null: catálogo não lido. */
  readonly operacoes: readonly OperacaoUsoReal[] | null;
  /** Ativos (critério do M37): total, com trilha concluída e com acesso ao novo; null sem medida. */
  readonly usuarios: {
    readonly ativos: number;
    readonly comTrilhaEAcesso: number;
    readonly semTrilha: number;
    readonly semAcesso: number;
  } | null;
  /** Dias avaliados (regra 3), já sem as contas combinadas. */
  readonly dias: readonly DiaAvaliado[];
  /** Última competência: convênios que fecharam e lotes enviados; null sem medida. */
  readonly competencia: {
    readonly competencia: string;
    readonly conveniosDoHospital: number;
    readonly fechadosPeloNovo: number;
    readonly lotes: number;
    readonly lotesPeloNovo: number;
  } | null;
  /** Chamados S1 abertos no hospital; null sem medida. */
  readonly s1Abertos: number | null;
  /** Registro versionado do fim (ensaios, exceções, aceite, fim registrado). */
  readonly registro: RegistroFimCoexistencia;
  /** Primeiro dia da sequência verde de cada item, das medidas anteriores (persistido pelo painel); vazio sem histórico. */
  readonly verdeDesdeAnterior: Readonly<Partial<Record<ItemFim, string>>>;
}

const item = (
  i: ItemFim,
  conjunto: 'cap15' | 'cap14',
  verde: boolean | null,
  valor: string | null,
  parcelas: ParcelaFim[],
  motivo: string | null,
  verdeDesde: string | null,
): ItemPainelFim => ({
  item: i,
  conjunto,
  situacao: verde === null ? 'sem-medida' : verde ? 'verde' : 'pendente',
  valor,
  parcelas,
  fonte: FONTE_ITEM_FIM[i],
  verdeDesde: verde ? verdeDesde : null,
  motivo: verde ? null : motivo,
});

/** Ensaios aprovados por tipo (o último registro de cada tipo vale; reprovado depois de aprovado volta a faltar). */
export function ensaiosPendentes(r: RegistroFimCoexistencia): EnsaioContingencia[] {
  const ultimo = new Map<EnsaioContingencia, { data: string; ok: boolean }>();
  for (const e of r.ensaios) {
    const a = ultimo.get(e.tipo);
    if (!a || e.data >= a.data) ultimo.set(e.tipo, { data: e.data, ok: e.resultado === 'aprovado' });
  }
  return ENSAIOS_CONTINGENCIA.filter((t) => !ultimo.get(t)?.ok);
}

const dataContingenciaPronta = (r: RegistroFimCoexistencia): string | null => {
  if (ensaiosPendentes(r).length > 0) return null;
  const datas = ENSAIOS_CONTINGENCIA.map((t) =>
    r.ensaios
      .filter((e) => e.tipo === t && e.resultado === 'aprovado')
      .map((e) => e.data)
      .sort()
      .at(-1)!,
  );
  return datas.sort().at(-1) ?? null;
};

/** Monta o painel do fim de um hospital. */
export function avaliarFimCoexistencia(e: EntradaFim): PainelFimCoexistencia {
  const desde = (i: ItemFim) => e.verdeDesdeAnterior[i] ?? e.hoje;
  const excecoes = new Set(e.registro.excecoesOperacao.map((x) => x.operacao));

  // 1. Operações de uso real liberadas (as que ficam no sistema anterior por decisão saem da conta, listadas).
  let ops: ItemPainelFim;
  if (e.operacoes === null)
    ops = item('operacoes-liberadas', 'cap15', null, null, [], 'catálogo de operações não lido', null);
  else {
    const contadas = e.operacoes.filter((o) => !excecoes.has(o.nome));
    const liberadas = contadas.filter((o) => o.estado === 'liberada').length;
    ops = item(
      'operacoes-liberadas',
      'cap15',
      contadas.length > 0 && liberadas === contadas.length,
      `${liberadas} de ${contadas.length}`,
      [
        { rotulo: 'liberadas', valor: liberadas },
        { rotulo: 'fora de liberada', valor: contadas.length - liberadas },
        { rotulo: 'no sistema anterior por decisão', valor: e.operacoes.length - contadas.length },
      ],
      contadas.length === 0
        ? 'nenhuma operação de uso real'
        : `${contadas.length - liberadas} fora de liberada`,
      desde('operacoes-liberadas'),
    );
  }

  // 2. Ativos com trilha concluída e acesso ao novo.
  const u = e.usuarios;
  const usuarios = u
    ? item(
        'usuarios-com-trilha',
        'cap15',
        u.ativos > 0 && u.comTrilhaEAcesso === u.ativos,
        `${u.comTrilhaEAcesso} de ${u.ativos}`,
        [
          { rotulo: 'com trilha e acesso', valor: u.comTrilhaEAcesso },
          { rotulo: 'sem trilha concluída', valor: u.semTrilha },
          { rotulo: 'sem acesso ao novo', valor: u.semAcesso },
        ],
        `${u.ativos - u.comTrilhaEAcesso} ativo(s) sem trilha ou sem acesso`,
        desde('usuarios-com-trilha'),
      )
    : item('usuarios-com-trilha', 'cap15', null, null, [], 'usuários não medidos', null);

  // 3. Sem sessão de pessoa no sistema anterior (14 dias no cap-15, 30 no cap-14; regra 3).
  const semSessao = (
    i: 'sem-sessao-14-dias' | 'sem-sessao-30-dias',
    conjunto: 'cap15' | 'cap14',
    n: number,
  ) => {
    const s = sequenciaSemSessao(e.dias, e.hoje, n);
    const medido = s.dias > 0 || s.paradaSemMedida === null;
    const motivo =
      s.paradaSemMedida !== null && s.dias < n
        ? `sem medida em ${s.paradaSemMedida}`
        : `${s.dias} de ${n} dias seguidos${s.ultimaSessao ? `; última sessão de pessoa em ${s.ultimaSessao}` : ''}`;
    return item(
      i,
      conjunto,
      medido ? s.dias >= n : null,
      medido ? `${s.dias} dia(s)` : null,
      [
        { rotulo: 'dias seguidos sem sessão', valor: s.dias },
        { rotulo: 'dias exigidos', valor: n },
      ],
      motivo,
      s.verdeDesde,
    );
  };

  // 4. Competência inteira fechada e enviada pelo novo.
  const c = e.competencia;
  const competencia = c
    ? item(
        'competencia-pelo-novo',
        'cap15',
        c.conveniosDoHospital > 0 &&
          c.fechadosPeloNovo === c.conveniosDoHospital &&
          c.lotes > 0 &&
          c.lotesPeloNovo === c.lotes,
        c.competencia,
        [
          { rotulo: 'convênios da competência', valor: c.conveniosDoHospital },
          { rotulo: 'fechados pelo novo', valor: c.fechadosPeloNovo },
          { rotulo: 'lotes', valor: c.lotes },
          { rotulo: 'lotes enviados pelo novo', valor: c.lotesPeloNovo },
        ],
        `competência ${c.competencia}: ${c.conveniosDoHospital - c.fechadosPeloNovo} convênio(s) e ${c.lotes - c.lotesPeloNovo} lote(s) fora deste sistema`,
        desde('competencia-pelo-novo'),
      )
    : item('competencia-pelo-novo', 'cap15', null, null, [], 'competência não medida', null);

  // 5. Nenhum S1 aberto.
  const s1 =
    e.s1Abertos === null
      ? item('sem-s1-aberto', 'cap15', null, null, [], 'chamados não lidos', null)
      : item(
          'sem-s1-aberto',
          'cap15',
          e.s1Abertos === 0,
          String(e.s1Abertos),
          [{ rotulo: 'S1 abertos', valor: e.s1Abertos }],
          `${e.s1Abertos} S1 aberto(s)`,
          desde('sem-s1-aberto'),
        );

  // Conjunto do cap-14 (regra 2): 30 dias, toda operação de uso real com assinatura verde, contingência e aceite.
  let assinaturas: ItemPainelFim;
  if (e.operacoes === null)
    assinaturas = item('assinaturas-verdes', 'cap14', null, null, [], 'catálogo de operações não lido', null);
  else {
    const verdes = e.operacoes.filter((o) => o.assinatura === 'verde').length;
    const dif = e.operacoes.filter((o) => o.assinatura === 'diferenca').length;
    const sem = e.operacoes.length - verdes - dif;
    assinaturas = item(
      'assinaturas-verdes',
      'cap14',
      e.operacoes.length > 0 && verdes === e.operacoes.length,
      `${verdes} de ${e.operacoes.length}`,
      [
        { rotulo: 'verdes', valor: verdes },
        { rotulo: 'com diferença', valor: dif },
        { rotulo: 'sem execução', valor: sem },
      ],
      `${dif} com diferença e ${sem} sem execução`,
      desde('assinaturas-verdes'),
    );
  }
  const pendEnsaios = ensaiosPendentes(e.registro);
  const contingencia = item(
    'contingencia-pronta',
    'cap14',
    pendEnsaios.length === 0,
    `${ENSAIOS_CONTINGENCIA.length - pendEnsaios.length} de ${ENSAIOS_CONTINGENCIA.length}`,
    [
      { rotulo: 'ensaios aprovados', valor: ENSAIOS_CONTINGENCIA.length - pendEnsaios.length },
      { rotulo: 'ensaios pendentes', valor: pendEnsaios.length },
    ],
    `faltam: ${pendEnsaios.join(', ')}`,
    dataContingenciaPronta(e.registro),
  );
  const aceite = item(
    'aceite-diretoria',
    'cap14',
    e.registro.aceiteDiretoria !== null,
    e.registro.aceiteDiretoria?.data ?? null,
    [],
    'aceite da diretoria não registrado',
    e.registro.aceiteDiretoria?.data ?? null,
  );

  const cap15 = [
    ops,
    usuarios,
    semSessao('sem-sessao-14-dias', 'cap15', DIAS_SEM_SESSAO.cap15),
    competencia,
    s1,
  ];
  const cap14 = [
    semSessao('sem-sessao-30-dias', 'cap14', DIAS_SEM_SESSAO.cap14),
    assinaturas,
    contingencia,
    aceite,
  ];

  const pendencias = [
    ...cap15.filter((i) => i.situacao !== 'verde').map((i) => `${i.item}: ${i.motivo ?? 'pendente'}`),
    ...(pendEnsaios.length > 0 ? [`contingência pós-coexistência: faltam ${pendEnsaios.join(', ')}`] : []),
  ];
  const v15 = cap15.every((i) => i.situacao === 'verde');
  const v14 = cap14.every((i) => i.situacao === 'verde');
  const divergencias: string[] = [];
  if (v15 && !v14)
    divergencias.push(
      `critério do cap-15 verde e conjunto do cap-14 não: ${cap14
        .filter((i) => i.situacao !== 'verde')
        .map((i) => i.item)
        .join(', ')}`,
    );
  return {
    estabelecimento: e.estabelecimento,
    medidoEm: e.medidoEm,
    cap15,
    cap14,
    fimRegistravel: v15 && pendEnsaios.length === 0,
    pendencias,
    fimRegistradoEm: e.registro.fimRegistrado?.data ?? null,
    divergencias,
  };
}

/**
 * Atualiza o "verde desde" de cada item depois de uma medida: item verde guarda o primeiro dia da sequência; item que
 * deixou de ser verde sai (a próxima vez em que ficar verde recomeça a data).
 */
export function proximoVerdeDesde(
  painel: Pick<PainelFimCoexistencia, 'cap15' | 'cap14'>,
): Partial<Record<ItemFimCap15 | ItemFimCap14, string>> {
  const r: Partial<Record<ItemFim, string>> = {};
  for (const i of [...painel.cap15, ...painel.cap14])
    if (i.situacao === 'verde' && i.verdeDesde) r[i.item] = i.verdeDesde;
  return r;
}
