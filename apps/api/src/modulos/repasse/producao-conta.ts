// Produção do repasse a partir da conta do paciente (F3, motores; regras puras em @sgh/dominio-repasse, producao.ts).
// Roda DENTRO da transação de quem muda a conta (lançar item, fechar conta, estornar ou glosar item) ou pela operação
// própria repasse.sincronizar-producao-conta. Contrato de efeito (producao-conta.int.spec.ts):
//   - lançamento (repasse.momentoProducao = lancamento) ou fechamento: uma producao_repasse 'pendente' por profissional
//     e função do item cobrado (executor na função do item ou na titular; ou a equipe paga pelo hospital), com a base
//     faturada, o tipo de lançamento do item e a prévia do repasse pela regra vigente na data do item (o mesmo motor e
//     as mesmas dimensões que a apuração usa: o teste dourado da produção bate 100%);
//   - item estornado, sem cobrança, transferido ou excluído: a produção não apurada passa a 'estornado' (sai da
//     apuração); a já apurada ou paga ganha estorno_repasse 'pendente' do restante no período seguinte e passa a
//     'estornado';
//   - glosa (repasse.estornoEmGlosa): antes da apuração reduz a base (total: estorna); depois, estorno_repasse
//     proporcional (motivo glosa, ligado ao glosa_item do item), só a diferença do já estornado;
//   - produção que o item não gera mais (participante removido ou pago fora do hospital, função, recebedor ou executor
//     trocado): tratada como item sem cobrança; a chave nova nasce pela regra do momento;
//   - glosa revertida: antes da apuração a base volta (a estornada volta a 'pendente'); depois, o débito pendente a
//     mais é cancelado (o excesso já descontado numa apuração conferida fica como pendência 'credito-apos-desconto');
//   - o débito cai no primeiro período aberto a partir do seguinte ao da conta e do mês do evento (competenciaDoDebito)
//     e é descontado pela apuração desse período (porta-propria.ts, gravarApuracao).
// Idempotente: sincronizar de novo não duplica produção nem débito; a conta é travada (FOR UPDATE) antes da leitura,
// e duas sincronizações da mesma conta correm em fila. Nenhum gatilho: tudo aqui, na mesma transação.
import { type BaseCalculoRepasse, definicaoParametro, type ItemProducao } from '@sgh/contratos';
import {
  type AcaoEstornoProducao,
  calcularItem,
  centavos as emCentavos,
  competenciaDoDebito,
  estornoDaProducao,
  type EventoProducao,
  type FormaPagamentoParticipante,
  funcaoTitular,
  geraNoEvento,
  type ItemContaProducao,
  type ModoAdicional,
  momentoDoParametro,
  type OpcoesCalculo,
  type ProducaoPlanejada,
  producoesDoItem,
  type RegraRepasse,
  reais,
} from '@sgh/dominio-repasse';
import {
  type ContextoOperacao,
  definirOperacao,
  garantirSequencia,
  type Leitor,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { civil, FUSO_PADRAO } from '../exames/relogio.js';
import { codigoProcedimento, lerIntegraisParticular, PREFIXO_INTEGRAL, regraDe, SQL_REGRAS } from './porta-propria.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const marcas = (xs: readonly unknown[]) => xs.map(() => '?').join(', ');

/** Tabelas que a sincronização grava (a operação que a chama as declara também). */
export const TABELAS_PRODUCAO_CONTA: readonly string[] = ['producao_repasse', 'estorno_repasse', 'sequencia_negocio'];

export interface ResumoProducaoConta {
  readonly geradas: number;
  readonly estornadas: number;
  readonly reduzidas: number;
  readonly debitos: number;
  /** Produções com débito a mais desfeito (glosa revertida depois da apuração). */
  readonly creditos: number;
  /** Itens que não geraram produção, por motivo (contagem). */
  readonly pendencias: Readonly<Record<string, number>>;
}

const padrao = (chave: string) => definicaoParametro(chave)?.padrao ?? '';

/** Os parâmetros do repasse no estabelecimento (o valor vigente do estabelecimento, senão o da rede, senão o padrão). */
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
    m.set(k, v === null || v === undefined ? padrao(k) : String(v).trim());
  }
  return m;
}

const CHAVES = [
  'repasse.momentoProducao',
  'repasse.estornoEmGlosa',
  'repasse.basePadrao',
  'repasse.adicionalModo',
  'repasse.feriados',
] as const;

interface ItemLido {
  readonly item: ItemContaProducao;
  readonly realizado: Date;
  readonly procedimento: number;
  readonly grupoAto: number | null;
  readonly centroCusto: number | null;
  readonly tipoLancamento: number | null;
}

const chave = (p: { profissional: number; prestador: number | null; funcao: number }) =>
  `${p.profissional}:${p.prestador ?? 0}:${p.funcao}`;

/**
 * Sincroniza a produção do repasse com os itens da conta (todos, ou só os informados). Chamada na transação de quem
 * mudou a conta; o contexto traz o estabelecimento e o usuário da sessão.
 */
export async function sincronizarProducaoDaConta(
  tx: TxOperacao,
  d: { readonly conta: number; readonly itens?: readonly number[]; readonly evento: EventoProducao },
  ctx: Pick<ContextoOperacao, 'estabelecimento' | 'usuario'>,
): Promise<ResumoProducaoConta> {
  const est = ctx.estabelecimento;
  if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  const usuario = ctx.usuario;
  if (usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  // A trava da conta põe em fila as sincronizações da mesma conta (lançamento, fechamento, a operação própria): a
  // chave única da produção aceita NULL no prestador e no tipo de lançamento e não barra a duplicata sozinha.
  const travada = await tx.consultarParaAtualizar<Linha>(
    'SELECT id FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [d.conta, est],
  );
  if (travada.length === 0)
    throw recusa('conta-inexistente', 'A conta não existe neste estabelecimento.', { campos: ['conta'] });
  const conta = await tx.uma<Linha>(
    `SELECT ch.id, ch.fonte_pagadora_id, ch.natureza, ch.competencia, ch.situacao, at.especialidade_medica_id,
            at.local_atendimento_id, at.unidade_assistencial_id, at.centro_custo_id, e.fuso_horario
       FROM conta_hospitalar ch
       JOIN atendimento at ON at.id = ch.atendimento_id
       JOIN estabelecimento e ON e.id = ch.estabelecimento_id
      WHERE ch.id = ? AND ch.estabelecimento_id = ? AND ch.excluido_em IS NULL`,
    [d.conta, est],
  );
  if (!conta) throw recusa('conta-inexistente', 'A conta não existe neste estabelecimento.', { campos: ['conta'] });
  const fuso = texto(conta['fuso_horario']) || FUSO_PADRAO;
  const competenciaConta = texto(
    conta['competencia'] instanceof Date
      ? (conta['competencia'] as Date).toISOString()
      : conta['competencia'],
  ).slice(0, 7);
  const par = await parametros(tx, est, CHAVES);
  const momento = momentoDoParametro(par.get('repasse.momentoProducao'));
  const estornoEmGlosa = par.get('repasse.estornoEmGlosa') !== 'false';
  const opcoesBase = {
    basePadrao: (par.get('repasse.basePadrao') || 'cobrado') as BaseCalculoRepasse,
    modoAdicional: (par.get('repasse.adicionalModo') || 'sobre-valor') as ModoAdicional,
    feriados: new Set(
      (par.get('repasse.feriados') ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  };

  // Os itens da conta (com os excluídos: o excluído estorna a produção que já existia).
  const filtro = d.itens && d.itens.length > 0 ? ` AND chi.id IN (${marcas(d.itens)})` : '';
  const ls = await tx.consultar<Linha>(
    `SELECT chi.id, chi.situacao, chi.excluido_em, chi.quantidade, chi.valor_total, chi.valor_honorario, chi.valor_glosado,
            chi.pertence_pacote, chi.executante_profissional_id, chi.funcao_equipe_cobranca_id, chi.realizado_em,
            chi.centro_custo_id, chi.tipo_lancamento_id, ifa.codigo AS procedimento, ifa.grupo_ato_id
       FROM conta_hospitalar_item chi
       JOIN item_faturavel ifa ON ifa.id = chi.item_faturavel_id
      WHERE chi.conta_hospitalar_id = ?${filtro}
      ORDER BY chi.id`,
    [conta['id'], ...(d.itens ?? [])],
    { teto: 20000 },
  );
  const contaFechada = ['fechada', 'faturada', 'enviada', 'paga'].includes(texto(conta['situacao']));
  const resumo = {
    geradas: 0,
    estornadas: 0,
    reduzidas: 0,
    debitos: 0,
    creditos: 0,
    pendencias: {} as Record<string, number>,
  };
  if (ls.length === 0) return resumo;
  const ids = ls.map((r) => n(r['id']));
  const participantes = new Map<number, ItemContaProducao['participantes'][number][]>();
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
      forma: texto(r['forma_pagamento']) as FormaPagamentoParticipante,
      valorBaseRepasse: r['valor_base_repasse'] === null ? null : n(r['valor_base_repasse']),
      valorAto: n(r['valor_ato']),
    });
    participantes.set(k, lista);
  }
  const itens: ItemLido[] = ls.map((r) => ({
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
    realizado: r['realizado_em'] instanceof Date ? r['realizado_em'] : new Date(String(r['realizado_em'])),
    procedimento: codigoProcedimento(r['procedimento']),
    grupoAto: nn(r['grupo_ato_id']),
    centroCusto: nn(r['centro_custo_id']),
    tipoLancamento: nn(r['tipo_lancamento_id']),
  }));
  const titular = funcaoTitular(
    (
      await tx.consultar<Linha>(
        'SELECT id, tipo_funcao, ativo, ordem_apresentacao FROM funcao_equipe_cobranca',
        [],
        { teto: 1000 },
      )
    ).map((r) => ({
      id: n(r['id']),
      tipo: texto(r['tipo_funcao']),
      ativo: Boolean(n(r['ativo'])),
      ordem: nn(r['ordem_apresentacao']),
    })),
  );
  // As produções que já existem, travadas, com o que a apuração já levou e o já estornado.
  const existentes = await tx.consultarParaAtualizar<Linha>(
    `SELECT p.id, p.versao, p.conta_hospitalar_item_id, p.profissional_id, p.prestador_terceiro_id,
            p.funcao_equipe_cobranca_id, p.situacao, p.valor_base, p.valor_repasse, p.apuracao_repasse_id
       FROM producao_repasse p
      WHERE p.conta_hospitalar_item_id IN (${marcas(ids)}) AND p.estabelecimento_id = ? AND p.excluido_em IS NULL
      ORDER BY p.id`,
    [...ids, est],
    { teto: 20000 },
  );
  const pids = existentes.map((p) => n(p['id']));
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
      apurado.set(n(r['producao_repasse_id']), emCentavos(n(r['valor_repasse'])));
    for (const r of await tx.consultar<Linha>(
      `SELECT producao_repasse_id, SUM(valor) AS v FROM estorno_repasse
        WHERE producao_repasse_id IN (${marcas(pids)}) AND excluido_em IS NULL AND situacao <> 'cancelado'
        GROUP BY producao_repasse_id`,
      pids,
      { teto: 20000 },
    ))
      estornado.set(n(r['producao_repasse_id']), emCentavos(n(r['v'])));
  }
  // Competência do débito: períodos com apuração já conferida (não se recalculam mais) passam adiante.
  const fechadas = new Set(
    (
      await tx.consultar<Linha>(
        `SELECT DATE_FORMAT(competencia, '%Y-%m') AS c FROM apuracao_repasse
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND competencia > ?
            AND situacao NOT IN ('em_apuracao', 'apurada', 'cancelada')
          ORDER BY competencia`,
        [est, `${competenciaConta}-01`],
        { teto: 1000 },
      )
    ).map((r) => texto(r['c'])),
  );
  const competenciaDebito = competenciaDoDebito(competenciaConta, civil(new Date(), fuso).data.slice(0, 7), fechadas);
  const porItem = new Map<number, Linha[]>();
  for (const p of existentes) {
    const k = n(p['conta_hospitalar_item_id']);
    porItem.set(k, [...(porItem.get(k) ?? []), p]);
  }

  const regrasDoDia = new Map<string, { regras: RegraRepasse[]; opcoes: OpcoesCalculo }>();
  const motorDoDia = async (data: string) => {
    let m = regrasDoDia.get(data);
    if (!m) {
      const regras = (
        await tx.consultar<Linha>(
          `${SQL_REGRAS} AND r.codigo NOT LIKE ? ORDER BY i.id`,
          [est, data, data, n(conta['fonte_pagadora_id']), PREFIXO_INTEGRAL],
          { teto: 20000 },
        )
      ).map(regraDe);
      const x = await lerIntegraisParticular(tx, est, data);
      m = { regras, opcoes: { ...opcoesBase, ...x } };
      regrasDoDia.set(data, m);
    }
    return m;
  };
  const cooperativas = new Map<number, number | null>();
  const cooperativaDe = async (profissional: number) => {
    if (!cooperativas.has(profissional)) {
      const r = await tx.uma<Linha>('SELECT cooperativa_medica_id FROM profissional WHERE id = ?', [profissional]);
      cooperativas.set(profissional, nn(r?.['cooperativa_medica_id']));
    }
    return cooperativas.get(profissional) ?? null;
  };

  for (const it of itens) {
    const plano = producoesDoItem(it.item, titular);
    if (plano.pendencia) resumo.pendencias[plano.pendencia] = (resumo.pendencias[plano.pendencia] ?? 0) + 1;
    const planejadas = new Map(plano.producoes.map((p) => [chave(p), p]));
    const gravadas = porItem.get(it.item.id) ?? [];
    const vistas = new Set<string>();
    for (const g of gravadas) {
      const k = chave({
        profissional: n(g['profissional_id']),
        prestador: nn(g['prestador_terceiro_id']),
        funcao: n(g['funcao_equipe_cobranca_id']),
      });
      vistas.add(k);
      const id = n(g['id']);
      const situacao = texto(g['situacao']);
      const integrada = apurado.has(id) || situacao === 'apurado' || situacao === 'pago';
      const base = emCentavos(n(g['valor_base']));
      const acao = estornoDaProducao(
        it.item,
        {
          situacao,
          integrada,
          vigente: planejadas.has(k),
          baseCentavos: base,
          baseOriginalCentavos: planejadas.get(k)?.baseCentavos ?? base,
          repassadoCentavos: apurado.get(id) ?? emCentavos(n(g['valor_repasse'])),
          jaEstornadoCentavos: estornado.get(id) ?? 0,
          competenciaDebito,
        },
        estornoEmGlosa,
      );
      await aplicar(tx, acao, { id, versao: n(g['versao']), est, usuario, conta: d.conta, item: it.item.id }, resumo);
    }
    if (!geraNoEvento(momento, d.evento, contaFechada)) continue;
    for (const p of plano.producoes) {
      if (vistas.has(chave(p))) continue;
      // Glosa já registrada no item quando a produção nasce: a mesma regra do estorno antes da apuração.
      const antes = estornoDaProducao(
        it.item,
        {
          situacao: 'pendente',
          integrada: false,
          vigente: true,
          baseCentavos: p.baseCentavos,
          baseOriginalCentavos: p.baseCentavos,
          repassadoCentavos: 0,
          jaEstornadoCentavos: 0,
          competenciaDebito,
        },
        estornoEmGlosa,
      );
      if (antes.acao === 'estornar') continue;
      const baseCentavos = antes.acao === 'reduzir' ? antes.baseCentavos : p.baseCentavos;
      await gerar(tx, { ...p, baseCentavos }, it, {
        est,
        conta,
        fuso,
        motor: await motorDoDia(civil(it.realizado, fuso).data),
        cooperativa: await cooperativaDe(p.profissional),
      });
      resumo.geradas += 1;
    }
  }
  return resumo;
}

async function gerar(
  tx: TxOperacao,
  p: ProducaoPlanejada,
  it: ItemLido,
  x: {
    est: number;
    conta: Linha;
    fuso: string;
    motor: { regras: RegraRepasse[]; opcoes: OpcoesCalculo };
    cooperativa: number | null;
  },
): Promise<number> {
  const quando = civil(it.realizado, x.fuso);
  // As mesmas dimensões que a apuração lê da produção (porta-propria.ts, producao): a prévia bate com o recálculo.
  const item: ItemProducao = {
    id: it.item.id,
    data: quando.data,
    hora: quando.hora.slice(0, 5),
    convenio: n(x.conta['fonte_pagadora_id']),
    procedimento: it.procedimento,
    especialidade: nn(x.conta['especialidade_medica_id']),
    ato: p.funcao,
    grupoAto: it.grupoAto,
    local: nn(x.conta['local_atendimento_id']),
    unidade: nn(x.conta['unidade_assistencial_id']),
    centroCusto: it.centroCusto ?? nn(x.conta['centro_custo_id']),
    cooperativa: x.cooperativa,
    tipoLancamento: it.tipoLancamento,
    tipoConta: texto(x.conta['natureza']) === 'internacao' ? 'I' : 'E',
    executante: p.profissional,
    cobrado: reais(p.baseCentavos),
    pago: 0,
    recursoDeferido: 0,
    conciliado: false,
  };
  const m = calcularItem(item, x.motor.regras, x.motor.opcoes);
  const agora = new Date();
  return tx.incluir('producao_repasse', {
    estabelecimento_id: x.est,
    conta_hospitalar_item_id: it.item.id,
    conta_hospitalar_id: n(x.conta['id']),
    profissional_id: p.profissional,
    prestador_terceiro_id: p.prestador,
    funcao_equipe_cobranca_id: p.funcao,
    tipo_lancamento_id: it.tipoLancamento,
    quantidade: p.quantidade,
    valor_base: reais(p.baseCentavos),
    percentual: m.pendencia ? null : m.percentual || null,
    valor_repasse: m.pendencia ? null : reais(m.valorCentavos),
    pertence_pacote: it.item.pertencePacote ? 1 : 0,
    integrado_em: agora,
    situacao: 'pendente',
  });
}

type Resumo = { estornadas: number; reduzidas: number; debitos: number; creditos: number; pendencias: Record<string, number> };
type AlvoProducao = { id: number; versao: number; est: number; usuario: number; conta: number; item: number };

async function aplicar(tx: TxOperacao, acao: AcaoEstornoProducao, p: AlvoProducao, resumo: Resumo): Promise<void> {
  if (acao.acao === 'nada') return;
  if (acao.acao === 'estornar') {
    await tx.alterar('producao_repasse', p.id, p.versao, { situacao: 'estornado' });
    resumo.estornadas += 1;
    return;
  }
  if (acao.acao === 'reduzir' || acao.acao === 'reativar') {
    // A prévia do repasse é refeita pela apuração (o recálculo usa a base nova); aqui ela sai até lá.
    await tx.alterar('producao_repasse', p.id, p.versao, {
      valor_base: reais(acao.baseCentavos),
      valor_repasse: null,
      percentual: null,
      ...(acao.acao === 'reativar' ? { situacao: 'pendente' } : {}),
    });
    resumo.reduzidas += 1;
    return;
  }
  if (acao.acao === 'debitar') {
    await incluirDebito(tx, p, acao.valorCentavos, acao.competencia, acao.motivo);
    if (acao.encerrar) await tx.alterar('producao_repasse', p.id, p.versao, { situacao: 'estornado' });
    resumo.debitos += 1;
    return;
  }
  // Débito a mais (glosa revertida): cancela os débitos ainda não descontados (pendentes, ou aplicados numa apuração
  // ainda aberta, que o recálculo refaz), do mais novo ao mais velho; o que passar do excesso volta como débito novo.
  const abertos = await tx.consultarParaAtualizar<Linha>(
    `SELECT e.id, e.versao, e.valor FROM estorno_repasse e
       LEFT JOIN apuracao_repasse a ON a.id = e.apuracao_repasse_id
      WHERE e.producao_repasse_id = ? AND e.excluido_em IS NULL
        AND (e.situacao = 'pendente' OR (e.situacao = 'aplicado' AND a.situacao IN ('em_apuracao', 'apurada')))
      ORDER BY e.id DESC`,
    [p.id],
    { teto: 1000 },
  );
  let cancelado = 0;
  for (const e of abertos) {
    if (cancelado >= acao.valorCentavos) break;
    await tx.alterar('estorno_repasse', n(e['id']), n(e['versao']), { situacao: 'cancelado' });
    cancelado += emCentavos(n(e['valor']));
  }
  if (cancelado > acao.valorCentavos)
    await incluirDebito(tx, p, cancelado - acao.valorCentavos, acao.competencia, 'glosa');
  if (cancelado < acao.valorCentavos)
    // O excesso já descontado numa apuração conferida não se desfaz aqui: fica como pendência (contagem).
    resumo.pendencias['credito-apos-desconto'] = (resumo.pendencias['credito-apos-desconto'] ?? 0) + 1;
  if (acao.reabrir) await tx.alterar('producao_repasse', p.id, p.versao, { situacao: 'apurado' });
  resumo.creditos += 1;
}

/** Débito no período do débito, ligado à produção (e ao glosa_item do item, na glosa). */
async function incluirDebito(
  tx: TxOperacao,
  p: AlvoProducao,
  valorCentavos: number,
  competencia: string,
  motivoPedido: 'glosa' | 'ajuste',
): Promise<void> {
  const glosa =
    motivoPedido === 'glosa'
      ? await tx.uma<Linha>(
          `SELECT gi.id FROM glosa_item gi WHERE gi.conta_hospitalar_item_id = ? AND gi.excluido_em IS NULL
            ORDER BY gi.id DESC LIMIT 1`,
          [p.item],
        )
      : null;
  const motivo = motivoPedido === 'glosa' && glosa ? 'glosa' : 'ajuste';
  await garantirSequencia(
    tx,
    { tipo: 'estorno_repasse', estabelecimento: p.est, prefixo: 'ER-' },
    { usuario: p.usuario, agora: new Date() },
  );
  const numero = await tx.proximoNumero('estorno_repasse');
  await tx.incluir('estorno_repasse', {
    estabelecimento_id: p.est,
    numero: numero.formatado,
    producao_repasse_id: p.id,
    glosa_item_id: motivo === 'glosa' ? n(glosa?.['id']) : null,
    conta_hospitalar_id: p.conta,
    motivo,
    valor: reais(valorCentavos),
    competencia: `${competencia}-01`,
    justificativa:
      motivoPedido === 'glosa'
        ? 'Glosa do item da conta depois da apuração do repasse.'
        : 'Item da conta estornado (ou produção que o item não gera mais) depois da apuração do repasse.',
    situacao: 'pendente',
    usuario_id: p.usuario,
  });
}

export const esquemaSincronizarProducaoConta = z
  .object({
    conta: z.number().int().positive(),
    itens: z.array(z.number().int().positive()).max(5000).optional(),
    evento: z.enum(['lancamento', 'fechamento', 'mudanca-item']),
  })
  .strict();
export type SincronizarProducaoContaEntrada = z.infer<typeof esquemaSincronizarProducaoConta>;

/** A operação própria (tela de conferência do repasse, reprocessamento): a mesma sincronização numa transação. */
export const sincronizarProducaoConta = definirOperacao<SincronizarProducaoContaEntrada, ResultadoOperacao>({
  nome: 'repasse.sincronizar-producao-conta',
  tabelas: TABELAS_PRODUCAO_CONTA,
  entrada: esquemaSincronizarProducaoConta,
  async gravar(tx, e, ctx) {
    const r = await sincronizarProducaoDaConta(
      tx,
      { conta: e.conta, evento: e.evento, ...(e.itens ? { itens: e.itens } : {}) },
      ctx,
    );
    return {
      conta: e.conta,
      geradas: r.geradas,
      estornadas: r.estornadas,
      reduzidas: r.reduzidas,
      debitos: r.debitos,
      creditos: r.creditos,
      pendencias: Object.values(r.pendencias).reduce((a, b) => a + b, 0),
    };
  },
  alvo: (e) => ({ tabela: 'conta_hospitalar', id: e.conta }),
});
