// Serviço do repasse médico (M33; ficha, seções 4, 5, 7 e 8): o motor puro (@sgh/dominio-repasse) sobre o que a porta lê,
// as transições conferidas no domínio e gravadas no estado relido (SGH_), e as receitas pelo executor (lançamento, RPA,
// apuração gravada e inclusão da regra aprovada). A tela nunca manda valor apurado, retenção nem número de RPA.
import {
  type ApoioRepasse,
  type ApuracaoResposta,
  type ApurarRepasseEntrada,
  type BaseCalculoRepasse,
  type ContaDoMedicoResposta,
  type DecidirApuracaoEntrada,
  type DecidirRegraRepasseEntrada,
  type DemonstrativoResposta,
  type EmitirRpaEntrada,
  type EstadoApuracao,
  type EstadoVersaoRegra,
  EVENTOS_AUDITAVEIS,
  type ExtratoRepasseResposta,
  type GravacaoRepasse,
  type IndicadorRepasse,
  type ItemProducao,
  type LancamentoRepasseResposta,
  type LancarEventoRepasseEntrada,
  type ListaRegrasRepasse,
  type ItemPendenteApuracaoResposta,
  ITENS_PENDENTES_NA_APURACAO,
  type MemoriaItemResposta,
  type PendenciaApuracao,
  PENDENCIAS_APURACAO,
  type PendentesApuracaoResposta,
  type PrestadorRepasseResposta,
  type PreviaRpaResposta,
  type ProporRegraRepasseEntrada,
  type RegraRepasse,
  type ResultadoRepasse,
  type RpaResposta,
  type SimulacaoRepasseResposta,
  type SimularRepasseEntrada,
  type VersaoRegraResposta,
  esquemaProporRegraRepasse,
} from '@sgh/contratos';
import {
  calcularItem,
  calcularPeriodo,
  calcularRpa,
  type CalculoRpa,
  lancamentosLivres,
  lerAliquota,
  lerFeriados,
  lerTabelaIrrf,
  type MemoriaCalculo,
  type ModoAdicional,
  type OpcoesCalculo,
  podeApurarPeriodo,
  reais,
  centavos,
  descontoDoDebito,
  ratearDebito,
  type ContaParaRpa,
  type DadoFiscalParaRpa,
  destinoDoPagamento,
  parametrosDoProfissional,
  totalizar,
  transicaoApuracao,
  transicaoVersaoRegra,
} from '@sgh/dominio-repasse';
import {
  type ApuracaoRepasseRegistrada,
  type LancamentoRepasseRegistrado,
  limitesCompetencia,
  type ItemPendenteRegistrado,
  type MemoriaCalculoParaGravar,
  type MemoriaCalculoRegistrada,
  type RpaDetalhe,
  type VersaoRegraRegistrada,
} from './tipos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { exigir, type SessaoCadastro } from '../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../config/public-api.js';
import { ApoioGravacao } from '../exames/public-api.js';
import type { ContextoRepasse, FiltroRegrasPorta, GravadorRepasse, PortaRepasse } from './porta.js';

const ctx = (s: SessaoCadastro): ContextoRepasse => s.porta;

/**
 * O dado fiscal e a conta principal do profissional que valem no dia (a leitura `destinoDoRepasse` do complemento do
 * cadastro, F3.1). Sem a fonte (porta em memória), o RPA usa a regra geral dos parâmetros.
 */
export type FonteFiscalRepasse = (
  c: ContextoRepasse,
  profissional: number,
  dia: string,
) => Promise<{ dadoFiscal: DadoFiscalParaRpa | null; conta: ContaParaRpa | null }>;
const E = EVENTOS_AUDITAVEIS;
/** Página padrão e máxima da lista de pendentes da apuração. */
const TAMANHO_PENDENTES = 50;
const TAMANHO_MAXIMO_PENDENTES = 200;
const naoEncontrado = (o: string) => new ErroProblema('nao-encontrado', 404, `${o} não encontrado`);
const recusar = (codigo: string, titulo: string, detalhe: string, status = 409) =>
  new ErroProblema('recusa-de-negocio', status, titulo, detalhe, { codigo });

/** As operações da tela e a permissão de agir de cada uma (vale também no servidor). */
export const OPERACOES_REPASSE_TELA = {
  'repasse.lancarEvento': 'repasse.lancamento.criar',
  'repasse.emitirRpa': 'repasse.rpa.emitir',
  'repasse.integrarItens': 'repasse.apuracao.aprovar',
  'repasse.incluirRegra': 'repasse.regra.aprovar',
} as const;

const EXTRAS = {
  proporRegra: 'repasse.regra.propor',
  aprovarRegra: 'repasse.regra.aprovar',
  apurar: 'repasse.apuracao.apurar',
  aprovarApuracao: 'repasse.apuracao.aprovar',
} as const;

const reaisBr = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number) =>
  `${v.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}%`;

/** A conta escrita da memória (o médico vê a regra e a conta de cada valor). */
export function contaDaMemoria(m: {
  baseValor: number;
  percentual: number;
  valorFixo: number;
  valorSemAdicional: number;
  valor: number;
  adicional: { tipo: string; percentual: number } | null;
  pendencia: string | null;
}): string {
  if (m.pendencia) return `sem repasse (${m.pendencia})`;
  const principal =
    m.percentual > 0
      ? `${reaisBr(m.baseValor)} × ${pct(m.percentual)} = ${reaisBr(m.valorSemAdicional)}`
      : `valor fixo ${reaisBr(m.valorFixo)}`;
  return m.adicional && m.valor !== m.valorSemAdicional
    ? `${principal}; + ${m.adicional.tipo} ${pct(m.adicional.percentual)} = ${reaisBr(m.valor)}`
    : principal;
}

export function memoriaResposta(m: MemoriaCalculo): MemoriaItemResposta {
  const r = {
    item: m.item,
    beneficiario: m.beneficiario,
    regra: m.regra,
    dimensoes: [...m.dimensoes],
    ignoradas: m.ignoradas.map((i) => ({ regra: i.regra, motivo: i.motivo })),
    base: m.base,
    baseValor: reais(m.baseCentavos),
    percentual: m.percentual,
    valorFixo: reais(m.valorFixoCentavos),
    valorSemAdicional: reais(m.valorSemAdicionalCentavos),
    adicional: m.adicional ? { tipo: m.adicional.tipo, percentual: m.adicional.percentual } : null,
    valor: reais(m.valorCentavos),
    pendencia: m.pendencia,
  };
  return { ...r, conta: contaDaMemoria(r) };
}

function memoriaRegistradaResposta(m: MemoriaCalculoRegistrada): MemoriaItemResposta {
  const adicional = m.adicional ? JSON.parse(m.adicional) : null;
  const r = {
    item: m.item,
    beneficiario: m.prestador,
    regra: m.regra,
    dimensoes: m.dimensoes ? m.dimensoes.split(',') : [],
    ignoradas: m.ignoradas ? (JSON.parse(m.ignoradas) as { regra: number; motivo: string }[]) : [],
    base: m.base as BaseCalculoRepasse | null,
    baseValor: m.baseValor,
    percentual: m.percentual,
    valorFixo: m.valorFixo,
    valorSemAdicional: m.valorSemAdicional,
    adicional,
    valor: m.valor,
    pendencia: m.pendencia as MemoriaItemResposta['pendencia'],
  };
  return { ...r, conta: contaDaMemoria(r) };
}

export function itemPendenteResposta(m: ItemPendenteRegistrado): ItemPendenteApuracaoResposta {
  return {
    ...memoriaRegistradaResposta(m),
    referencia: {
      conta: m.contaId,
      contaNumero: m.contaNumero,
      atendimento: m.atendimentoNumero,
      prontuario: m.prontuario,
      procedimento: m.procedimento,
      procedimentoDescricao: m.procedimentoDescricao,
      realizadoEm: m.realizadoEm,
      profissional: m.profissionalNome,
    },
  };
}

function paraGravar(m: MemoriaCalculo): MemoriaCalculoParaGravar {
  return {
    item: m.item,
    prestador: m.beneficiario,
    regra: m.regra,
    dimensoes: m.dimensoes.join(','),
    ignoradas: JSON.stringify(m.ignoradas.slice(0, 20).map((i) => ({ regra: i.regra, motivo: i.motivo }))),
    base: m.base,
    baseValor: reais(m.baseCentavos),
    percentual: m.percentual,
    valorFixo: reais(m.valorFixoCentavos),
    valorSemAdicional: reais(m.valorSemAdicionalCentavos),
    adicional: m.adicional
      ? JSON.stringify({ tipo: m.adicional.tipo, percentual: m.adicional.percentual })
      : null,
    valor: reais(m.valorCentavos),
    pendencia: m.pendencia,
  };
}

/** A proposta como regra do motor (o simulador usa a versão em rascunho com ID negativo). */
export function regraDaProposta(id: number, p: ProporRegraRepasseEntrada): RegraRepasse {
  return {
    id,
    vigencia: p.vigencia,
    beneficiario: p.beneficiario,
    profissional: p.beneficiario === 'M' ? p.profissional : null,
    prestador: p.profissional,
    convenio: p.convenio,
    procedimentoInicial: p.procedimentoInicial,
    procedimentoFinal: p.procedimentoFinal,
    especialidade: p.especialidade,
    ato: p.ato,
    grupoAto: p.grupoAto,
    local: null,
    unidade: p.unidade,
    centroCusto: null,
    cooperativa: null,
    tipoLancamento: p.tipoLancamento,
    tipoConta: p.tipoConta,
    horaInicial: '00:00',
    horaFinal: '23:59',
    percentual: p.percentual,
    valorFixo: p.valorFixo,
    percentualFeriado: p.percentualFeriado,
    percentualFimDeSemana: p.percentualFimDeSemana,
    base: p.base,
    evento: p.evento,
  };
}

function versaoResposta(v: VersaoRegraRegistrada): VersaoRegraResposta {
  return {
    id: v.id,
    estado: v.estado as EstadoVersaoRegra,
    proposta: esquemaProporRegraRepasse.parse(JSON.parse(v.proposta)),
    autor: v.autor,
    propostaEm: v.propostaEm ?? '',
    decididaPor: v.decididaPor,
    decididaEm: v.decididaEm,
    justificativaDecisao: v.justificativaDecisao,
    regraIncluida: v.regraIncluida,
    simulada: v.simulada,
  };
}

function retencoesResposta(c: CalculoRpa) {
  const r = {
    bruto: reais(c.brutoCentavos),
    baseInss: reais(c.baseInssCentavos),
    inss: reais(c.inssCentavos),
    baseIrrf: reais(c.baseIrrfCentavos),
    irrf: reais(c.irrfCentavos),
    iss: reais(c.issCentavos),
    liquido: reais(c.liquidoCentavos),
  };
  return {
    ...r,
    conta: `${reaisBr(r.bruto)} − INSS ${reaisBr(r.inss)} − IRRF ${reaisBr(r.irrf)} − ISS ${reaisBr(r.iss)} = ${reaisBr(r.liquido)}`,
  };
}

/** Página das regras vigentes na tela (o servidor devolve `depoisDe` quando há mais). */
const PAGINA_REGRAS = 500;

/** Teto de páginas da produção numa apuração (2.000 itens por página). */
const PAGINAS_PRODUCAO = 25;

export class ServicoRepasse {
  readonly apoio: ApoioGravacao<GravadorRepasse>;

  constructor(
    readonly porta: PortaRepasse,
    private readonly trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
    private readonly fiscal: FonteFiscalRepasse | null = null,
  ) {
    this.apoio = new ApoioGravacao<GravadorRepasse>(
      { chave: 'repasse', nome: 'o repasse médico', operacoes: OPERACOES_REPASSE_TELA, semLiberacao: true },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  // ── Apoio e parâmetros ────────────────────────────────────────────────────────────────────────────────────────

  async gravacao(s: SessaoCadastro): Promise<GravacaoRepasse> {
    const g = await this.apoio.gravacao(s, EXTRAS);
    return {
      ligada: g.ligada,
      motivo: g.motivo,
      operacoes: Object.fromEntries(
        Object.entries(g.operacoes).map(([op, v]) => {
          return [op, { ligada: v.pode, motivo: v.motivo ?? null }];
        }),
      ),
    };
  }

  private async texto(s: SessaoCadastro, chave: string): Promise<string> {
    const v = await this.apoio.parametroValor(s, chave);
    return v === null || v === undefined ? '' : String(v);
  }

  /**
   * As opções do motor. Com a data, também a regra integral da consulta particular (ADR 0009: 100% do valor cobrado,
   * antes das regras comuns e sem adicional) e o grupo de faturamento dos procedimentos que ela alcança.
   */
  private async opcoesCalculo(s: SessaoCadastro, data?: string): Promise<OpcoesCalculo> {
    const base = {
      basePadrao: ((await this.texto(s, 'repasse.basePadrao')) || 'cobrado') as BaseCalculoRepasse,
      modoAdicional: ((await this.texto(s, 'repasse.adicionalModo')) || 'sobre-valor') as ModoAdicional,
      feriados: lerFeriados(await this.texto(s, 'repasse.feriados')),
    };
    if (data === undefined) return base;
    const x = await this.porta.integraisParticular(ctx(s), data);
    return {
      ...base,
      integrais: x.integrais,
      grupoDoProcedimento: x.grupoDoProcedimento,
      fontesParticulares: x.fontesParticulares,
    };
  }

  /** Os parâmetros do RPA (regra 7): sem a tabela vigente definida, o RPA não é emitido. */
  private async parametrosRpa(s: SessaoCadastro) {
    const inss = lerAliquota(await this.texto(s, 'repasse.inssAliquotaPct'), 'Alíquota do INSS');
    const tetoTexto = await this.texto(s, 'repasse.inssTeto');
    const irrf = lerTabelaIrrf(await this.texto(s, 'repasse.irrfTabela'));
    const iss = lerAliquota(await this.texto(s, 'repasse.issAliquotaPct'), 'Alíquota do ISS');
    const tetoNum = Number(tetoTexto);
    for (const l of [inss, irrf, iss]) if (!l.ok) return { ok: false as const, motivo: l.motivo };
    if (!tetoTexto || !Number.isFinite(tetoNum) || tetoNum <= 0)
      return { ok: false as const, motivo: 'Teto do INSS vigente não definido.' };
    return {
      ok: true as const,
      valor: {
        inssAliquota: (inss as { valor: number }).valor,
        inssTetoCentavos: centavos(tetoNum),
        irrf: (irrf as { valor: { ateCentavos: number | null; aliquota: number; deducaoCentavos: number }[] })
          .valor,
        issAliquota: (iss as { valor: number }).valor,
        reterIss: true,
        reterInss: true,
        reterIrrf: true,
      },
    };
  }

  async apoioTela(s: SessaoCadastro): Promise<ApoioRepasse> {
    const [hoje, op, gravacao, rpa] = await Promise.all([
      this.porta.hoje(ctx(s)),
      this.porta.opcoes(ctx(s)),
      this.gravacao(s),
      this.parametrosRpa(s),
    ]);
    const meta = await this.apoio.parametro(s, 'repasse.douradoMetaPct');
    return {
      hoje,
      empresas: [{ codigo: 1, rotulo: 'Empresa 1' }],
      eventos: op.eventos,
      convenios: op.convenios,
      basePadrao: (await this.opcoesCalculo(s)).basePadrao,
      metaDouradoPct: meta || 97,
      metaAAprovar: true,
      rpaConfigurado: rpa.ok,
      gravacao,
    };
  }

  // ── Regras, versões e simulador ───────────────────────────────────────────────────────────────────────────────

  /** As regras vigentes (ficha §4: por convênio, procedimento e profissional), em páginas por keyset do ID. */
  async regras(s: SessaoCadastro, f: FiltroRegrasPorta): Promise<ListaRegrasRepasse> {
    const pagina = Math.min(f.teto ?? PAGINA_REGRAS, PAGINA_REGRAS);
    // Lê uma linha a mais para saber se há a página seguinte sem contar a tabela inteira.
    const lidas = await this.porta.regras(ctx(s), { ...f, teto: pagina + 1 });
    const regras = lidas.slice(0, pagina);
    const usadas = await this.porta.regrasUsadas(
      ctx(s),
      regras.map((r) => r.id),
    );
    return {
      regras,
      depoisDe: lidas.length > pagina ? (regras.at(-1)?.id ?? null) : null,
      usadas: [...usadas],
    };
  }

  /** A busca de médicos das telas (nome e conselho; devolve o código do prestador e o registro). */
  async prestadores(s: SessaoCadastro, termo: string): Promise<PrestadorRepasseResposta[]> {
    return this.porta.buscarPrestadores(ctx(s), termo.slice(0, 60));
  }

  async versoes(s: SessaoCadastro): Promise<VersaoRegraResposta[]> {
    return (await this.porta.versoes(ctx(s))).map(versaoResposta);
  }

  async proporRegra(s: SessaoCadastro, e: ProporRegraRepasseEntrada): Promise<ResultadoRepasse> {
    // Regra 3: no novo, a regra usada não muda; a nova versão (substitui) é outra regra, com vigência nova.
    const r = await this.apoio.sgh(
      s,
      E.repasseRegraProposta.codigo,
      'repasse.regra',
      (x: { versao: number }) => ({ tabela: 'regra_repasse_versao', id: String(x.versao) }),
      (g) =>
        g.proporVersao({
          substitui: e.substitui,
          proposta: JSON.stringify(e),
          justificativa: e.justificativa,
          autor: s.login,
        }),
    );
    return {
      ok: true,
      mensagem: `Regra proposta (versão ${r.versao}): simule e peça a aprovação do supervisor.`,
      ids: { versao: r.versao },
      repetida: false,
    };
  }

  async simular(s: SessaoCadastro, e: SimularRepasseEntrada): Promise<SimulacaoRepasseResposta> {
    const vigentes = await this.porta.todasRegras(ctx(s), { convenio: e.convenio, data: e.data });
    let regras: RegraRepasse[] = vigentes;
    if (e.versao !== null) {
      const v = await this.porta.versao(ctx(s), e.versao);
      if (!v) throw naoEncontrado('Versão da regra');
      const proposta = esquemaProporRegraRepasse.parse(JSON.parse(v.proposta));
      // A versão em rascunho entra com ID negativo; a regra que ela substitui sai.
      regras = [...vigentes.filter((r) => r.id !== proposta.substitui), regraDaProposta(-v.id, proposta)];
    }
    const item: ItemProducao = {
      id: 0,
      data: e.data,
      hora: '10:00',
      convenio: e.convenio,
      procedimento: e.procedimento,
      especialidade: null,
      ato: null,
      grupoAto: null,
      local: null,
      unidade: null,
      centroCusto: null,
      cooperativa: null,
      tipoLancamento: null,
      tipoConta: e.tipoConta,
      executante: e.profissional,
      cobrado: e.valorCobrado,
      pago: e.valorRecebido ?? 0,
      recursoDeferido: 0,
      conciliado: e.valorRecebido !== null,
    };
    const m = calcularItem(item, regras, await this.opcoesCalculo(s, e.data));
    if (e.versao !== null && s.pode('repasse.regra.propor'))
      await this.apoio.sgh(
        s,
        E.repasseRegraProposta.codigo,
        'repasse.regra',
        { tabela: 'regra_repasse_versao', id: String(e.versao) },
        (g) => g.marcarSimulada({ versao: e.versao as number }),
      );
    return { memoria: memoriaResposta(m), regrasConsideradas: regras.length };
  }

  async decidirRegra(s: SessaoCadastro, e: DecidirRegraRepasseEntrada): Promise<ResultadoRepasse> {
    const v = await this.porta.versao(ctx(s), e.versao);
    if (!v) throw naoEncontrado('Versão da regra');
    const hoje = await this.porta.hoje(ctx(s));
    const proposta = esquemaProporRegraRepasse.parse(JSON.parse(v.proposta));
    const t = transicaoVersaoRegra(
      { estado: v.estado as EstadoVersaoRegra, autor: v.autor, vigencia: proposta.vigencia },
      e.decisao,
      { usuario: s.login, hoje },
    );
    if (!t.ok) throw recusar('transicao-recusada', 'Decisão recusada', t.motivo);
    await this.apoio.sgh(
      s,
      E.repasseRegraDecidida.codigo,
      'repasse.regra',
      { tabela: 'regra_repasse_versao', id: String(v.id) },
      (g) =>
        g.decidirVersao({
          versao: v.id,
          para: t.estado as 'aprovada' | 'recusada',
          por: s.login,
          justificativa: e.justificativa,
        }),
    );
    if (t.estado !== 'aprovada')
      return { ok: true, mensagem: 'Regra recusada.', ids: { versao: v.id }, repetida: false };
    // Aprovada: a inclusão no cadastro de regras pela receita (a porta própria grava a regra com a vigência).
    try {
      const r = await this.apoio.executar(
        s,
        'repasse.incluirRegra',
        {
          versao: v.id,
          vigencia: proposta.vigencia,
          beneficiario: proposta.beneficiario,
          prestador: proposta.profissional ?? 0,
          profissional: null,
          convenio: proposta.convenio ?? 0,
          procedimentoInicial: proposta.procedimentoInicial ?? 0,
          procedimentoFinal: proposta.procedimentoFinal ?? 0,
          especialidade: proposta.especialidade ?? 0,
          ato: proposta.ato ?? 0,
          grupoAto: proposta.grupoAto ?? 0,
          unidade: proposta.unidade ?? 0,
          tipoConta: proposta.tipoConta,
          tipoLancamento: proposta.tipoLancamento ?? 0,
          percentual: proposta.percentual,
          valorFixo: proposta.valorFixo,
          percentualFeriado: proposta.percentualFeriado,
          percentualFimDeSemana: proposta.percentualFimDeSemana,
          evento: proposta.evento,
        },
        'Regra aprovada e incluída com a vigência.',
      );
      return { ok: true, mensagem: r.mensagem, ids: { versao: v.id, ...r.resultado }, repetida: r.repetida };
    } catch (erro) {
      if (erro instanceof ErroProblema && erro.getStatus() < 500)
        return {
          ok: true,
          mensagem: `Regra aprovada, mas o cadastro de regras recusou a inclusão: ${erro.message}`,
          ids: { versao: v.id },
          repetida: false,
        };
      throw erro;
    }
  }

  // ── Apuração ─────────────────────────────────────────────────────────────────────────────────────────────────

  private apuracaoResposta(
    a: ApuracaoRepasseRegistrada | null,
    empresa: number,
    competencia: string,
    outro: { lancamentos: number; daApuracao: number },
    porBeneficiario: ApuracaoResposta['porBeneficiario'],
    itensPendentes: ApuracaoResposta['itensPendentes'] = [],
  ): ApuracaoResposta {
    if (!a)
      return {
        id: null,
        empresa,
        competencia,
        sistema: outro.daApuracao > 0 ? 'outro-sistema' : 'nenhum',
        estado: null,
        simulacao: false,
        apuradoPor: null,
        conferidoPor: null,
        aprovadoPor: null,
        itens: 0,
        comRepasse: 0,
        pendentes: 0,
        pendenciasPorMotivo: {},
        base: 0,
        valor: 0,
        porBeneficiario: [],
        itensPendentes: [],
        lancamentosOutroSistema: outro.daApuracao,
        aviso:
          outro.daApuracao > 0
            ? 'O período já foi apurado no outro sistema: a apuração continua lá (uma apuração por período e empresa).'
            : null,
      };
    return {
      id: a.id,
      empresa: a.empresa,
      competencia: a.competencia,
      sistema: 'novo',
      estado: a.estado as EstadoApuracao,
      simulacao: a.simulacao,
      apuradoPor: a.apuradoPor,
      conferidoPor: a.conferidoPor,
      aprovadoPor: a.aprovadoPor,
      itens: a.itens,
      comRepasse: a.comRepasse,
      pendentes: a.pendentes,
      pendenciasPorMotivo: a.pendencias ? (JSON.parse(a.pendencias) as Record<string, number>) : {},
      base: a.base,
      valor: a.valor,
      porBeneficiario,
      itensPendentes,
      lancamentosOutroSistema: outro.daApuracao,
      aviso: a.simulacao
        ? 'Apuração em simulação: a memória de cálculo fica no novo; a gravação da apuração continua no outro sistema.'
        : null,
    };
  }

  private async porBeneficiario(s: SessaoCadastro, a: ApuracaoRepasseRegistrada | null) {
    if (!a) return [];
    const ms = await this.porta.memorias(ctx(s), a.id, null);
    const mapa = new Map<number, { itens: number; base: number; valor: number }>();
    for (const m of ms) {
      if (m.pendencia || m.prestador === null) continue;
      const x = mapa.get(m.prestador) ?? { itens: 0, base: 0, valor: 0 };
      x.itens += 1;
      x.base += centavos(m.baseValor);
      x.valor += centavos(m.valor);
      mapa.set(m.prestador, x);
    }
    return [...mapa.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(([prestador, x]) => ({ prestador, itens: x.itens, base: reais(x.base), valor: reais(x.valor) }));
  }

  /** O valor apurado de cada profissional por fonte pagadora da conta (centavos; fonte nula: sem fonte na memória). */
  private async porBeneficiarioEFonte(s: SessaoCadastro, a: ApuracaoRepasseRegistrada) {
    const ms = await this.porta.memorias(ctx(s), a.id, null);
    const mapa = new Map<number, Map<number | null, number>>();
    for (const m of ms) {
      if (m.pendencia || m.prestador === null) continue;
      const fontes = mapa.get(m.prestador) ?? new Map<number | null, number>();
      const fonte = m.fontePagadora ?? null;
      fontes.set(fonte, (fontes.get(fonte) ?? 0) + centavos(m.valor));
      mapa.set(m.prestador, fontes);
    }
    // uma fonte com saldo negativo (glosa maior que a produção nela) não se lança sozinha: o total do profissional
    // vai num lançamento só, pelos favorecidos gerais, como antes
    return new Map(
      [...mapa.entries()].map(([prestador, fontes]) => {
        const total = [...fontes.values()].reduce((t, c) => t + c, 0);
        const lista = [...fontes.entries()].sort((x, y) => (x[0] ?? 0) - (y[0] ?? 0));
        const separa = lista.every(([, c]) => c >= 0);
        const partes = separa
          ? lista.filter(([, c]) => c > 0).map(([fonte, c]) => ({ fonte, centavos: c }))
          : total > 0
            ? [{ fonte: null, centavos: total }]
            : [];
        return [prestador, partes] as const;
      }),
    );
  }

  async apuracao(s: SessaoCadastro, empresa: number, competencia: string): Promise<ApuracaoResposta> {
    const [a, outro] = await Promise.all([
      this.porta.apuracaoDoPeriodo(ctx(s), empresa, competencia),
      this.porta.estadoPeriodo(ctx(s), empresa, competencia),
    ]);
    // A memória dos itens pendentes (sem beneficiário ou sem regra) vai à tela da apuração, só os primeiros (o total é
    // `pendentes`; a lista inteira é paginada em pendentes()); a de cada médico abre no demonstrativo dele.
    const [porBeneficiario, pendentes] = await Promise.all([
      this.porBeneficiario(s, a),
      a
        ? this.porta.itensPendentes(ctx(s), a.id, {
            motivo: null,
            deslocamento: 0,
            limite: ITENS_PENDENTES_NA_APURACAO,
          })
        : null,
    ]);
    return this.apuracaoResposta(
      a,
      empresa,
      competencia,
      outro,
      porBeneficiario,
      (pendentes?.itens ?? []).map(itemPendenteResposta),
    );
  }

  /** Os itens pendentes da apuração, por página e pelo motivo, com a referência da conta para corrigir o item. */
  async pendentes(
    s: SessaoCadastro,
    apuracao: number,
    f: { motivo: string | null; pagina: number; tamanho: number },
  ): Promise<PendentesApuracaoResposta> {
    const motivo = f.motivo === null || f.motivo === '' ? null : f.motivo;
    if (motivo !== null && !(PENDENCIAS_APURACAO as readonly string[]).includes(motivo))
      throw new ErroProblema('entrada-invalida', 400, 'Motivo de pendência desconhecido', motivo);
    const pagina = Math.max(1, Math.trunc(f.pagina) || 1);
    const tamanho = Math.min(
      TAMANHO_MAXIMO_PENDENTES,
      Math.max(1, Math.trunc(f.tamanho) || TAMANHO_PENDENTES),
    );
    const a = await this.porta.apuracao(ctx(s), apuracao);
    if (!a) throw naoEncontrado('Apuração');
    const r = await this.porta.itensPendentes(ctx(s), apuracao, {
      motivo,
      deslocamento: (pagina - 1) * tamanho,
      limite: tamanho,
    });
    return {
      apuracao,
      motivo: motivo as PendenciaApuracao | null,
      pagina,
      tamanho,
      total: r.total,
      itens: r.itens.map(itemPendenteResposta),
    };
  }

  async apurar(s: SessaoCadastro, e: ApurarRepasseEntrada): Promise<ResultadoRepasse> {
    const [atual, outro] = await Promise.all([
      this.porta.apuracaoDoPeriodo(ctx(s), e.empresa, e.competencia),
      this.porta.estadoPeriodo(ctx(s), e.empresa, e.competencia),
    ]);
    // Regra 10: uma apuração por período e empresa; a aberta é recalculada, a fechada não reabre.
    const p = podeApurarPeriodo({
      lancamentosDaApuracaoNoPeriodo: outro.daApuracao,
      apuracaoFechada: atual !== null && atual.estado !== 'aberta',
    });
    if (!p.ok)
      throw recusar(
        'periodo-ja-apurado',
        'Período já apurado',
        outro.daApuracao > 0
          ? 'O período já tem lançamentos da apuração aprovada: a correção entra no período seguinte.'
          : 'A apuração do período já foi conferida: a correção entra no período seguinte.',
      );
    const itens: ItemProducao[] = [];
    let depoisDe = 0;
    for (let i = 0; i < PAGINAS_PRODUCAO; i++) {
      const pg = await this.porta.producao(ctx(s), e.competencia, depoisDe);
      itens.push(...pg.itens);
      if (pg.ultimo === null) break;
      depoisDe = pg.ultimo;
    }
    const fim = `${e.competencia}-31`;
    const regrasPorConvenio = new Map<number, RegraRepasse[]>();
    for (const c of new Set(itens.map((i) => i.convenio)))
      regrasPorConvenio.set(c, await this.porta.todasRegras(ctx(s), { convenio: c, data: fim }));
    const ja = await this.porta.jaIntegrados(
      ctx(s),
      itens.map((i) => i.id),
    );
    const o = await this.opcoesCalculo(s, fim);
    const memorias = itens.flatMap((i) =>
      calcularPeriodo([i], regrasPorConvenio.get(i.convenio) ?? [], ja, o),
    );
    const t = totalizar(memorias);
    // A apuração gravada é a que vale (o sistema é o de registro do repasse): nunca simulação.
    const simulacao = false;
    const r = await this.apoio.sgh(
      s,
      E.repasseApuracaoGravada.codigo,
      'repasse.apuracao',
      (x: { apuracao: number }) => ({ tabela: 'apuracao_repasse', id: String(x.apuracao) }),
      (g) =>
        g.gravarApuracao({
          empresa: e.empresa,
          competencia: e.competencia,
          apuradoPor: s.login,
          simulacao,
          totais: {
            itens: t.itens,
            comRepasse: t.comRepasse,
            pendentes: t.pendentes,
            pendencias: JSON.stringify(t.pendenciasPorMotivo),
            base: reais(t.baseCentavos),
            valor: reais(t.repasseCentavos),
          },
          memorias: memorias.map(paraGravar),
        }),
    );
    return {
      ok: true,
      mensagem: `Período apurado: ${t.comRepasse} item(ns) com repasse, ${t.pendentes} pendente(s), total ${reaisBr(reais(t.repasseCentavos))}.`,
      ids: { apuracao: r.apuracao, recalculada: r.recalculada },
      repetida: false,
    };
  }

  async decidirApuracao(s: SessaoCadastro, e: DecidirApuracaoEntrada): Promise<ResultadoRepasse> {
    const a = await this.porta.apuracao(ctx(s), e.apuracao);
    if (!a) throw naoEncontrado('Apuração');
    const exigida = e.acao === 'conferir' ? 'repasse.apuracao.apurar' : 'repasse.apuracao.aprovar';
    // A permissão de agir vai à trilha de permissão negada como a da rota (helper do cadastro).
    await exigir(s, exigida, this.trilha);
    const t = transicaoApuracao(
      { estado: a.estado as EstadoApuracao, apuradoPor: a.apuradoPor },
      e.acao,
      s.login,
    );
    if (!t.ok) throw recusar('transicao-recusada', 'Ação recusada', t.motivo);
    await this.apoio.sgh(
      s,
      E.repasseApuracaoGravada.codigo,
      'repasse.apuracao',
      { tabela: 'apuracao_repasse', id: String(a.id) },
      (g) =>
        g.transicionarApuracao({
          apuracao: a.id,
          de: a.estado,
          para: t.estado,
          por: s.login,
          ...(e.justificativa ? { justificativa: e.justificativa } : {}),
        }),
    );
    const msg = {
      conferir: 'Apuração conferida.',
      aprovar: 'Apuração aprovada.',
      devolver: 'Apuração devolvida.',
    };
    return { ok: true, mensagem: msg[e.acao], ids: { apuracao: a.id, estado: t.estado }, repetida: false };
  }

  demonstrativo(s: SessaoCadastro, apuracao: number, prestador: number): Promise<DemonstrativoResposta> {
    return this.demonstrativoNo(ctx(s), apuracao, prestador);
  }

  private async demonstrativoNo(
    c: ContextoRepasse,
    apuracao: number,
    prestador: number,
  ): Promise<DemonstrativoResposta> {
    const a = await this.porta.apuracao(c, apuracao);
    if (!a) throw naoEncontrado('Apuração');
    const itens = (await this.porta.memorias(c, apuracao, prestador)).map(memoriaRegistradaResposta);
    const com = itens.filter((i) => !i.pendencia);
    return {
      apuracao,
      empresa: a.empresa,
      competencia: a.competencia,
      prestador,
      estado: a.estado as EstadoApuracao,
      itens,
      base: reais(com.reduce((t, i) => t + centavos(i.baseValor), 0)),
      valor: reais(com.reduce((t, i) => t + centavos(i.valor), 0)),
    };
  }

  /** Lança o total de cada beneficiário da apuração aprovada (repasse.lancarEvento, origem apuração). */
  async lancarApuracao(s: SessaoCadastro, apuracao: number, evento: number): Promise<ResultadoRepasse> {
    const a = await this.porta.apuracao(ctx(s), apuracao);
    if (!a) throw naoEncontrado('Apuração');
    if (a.estado !== 'aprovada')
      throw recusar(
        'apuracao-nao-aprovada',
        'Apuração não aprovada',
        'Só a apuração aprovada gera lançamentos.',
      );
    // D-DOURADO-33: a apuração em simulação não gera lançamento (a gravação do período continua no outro sistema;
    // lançar aqui pagaria o período duas vezes). A receita confere o mesmo no estado relido.
    if (a.simulacao)
      throw recusar(
        'apuracao-em-simulacao',
        'Apuração em simulação',
        'A apuração está em simulação: ela não gera lançamento, e o período continua sendo lançado no outro sistema.',
      );
    const hoje = await this.porta.hoje(ctx(s));
    const data = hoje.startsWith(a.competencia) ? hoje : `${a.competencia}-28`;
    // O débito do repasse descontado nesta apuração (estornos de produção) abate o lançamento de cada profissional:
    // um lançamento de estorno ligado ao da apuração (o RPA soma os dois). A apuração já levou ao período seguinte o
    // que não coube no bruto (debitosNaApuracao); por isso todo profissional com débito tem bruto que o cobre. Se não
    // tiver (dado fora da regra), recusa antes de lançar: o débito nunca se perde calado.
    const debitos = await this.porta.debitosDaApuracao(ctx(s), a.id);
    const beneficiarios = await this.porBeneficiario(s, a);
    const bruto = new Map(beneficiarios.map((b) => [b.prestador, centavos(b.valor)]));
    const descobertos = [...debitos.entries()].filter(
      ([prestador, valor]) => descontoDoDebito(bruto.get(prestador) ?? 0, centavos(valor)).saldoCentavos > 0,
    );
    if (descobertos.length > 0)
      throw recusar(
        'debito-acima-do-bruto',
        'Débito acima do bruto',
        `${descobertos.length} profissional(is) com débito do repasse acima do bruto da apuração: recalcule a apuração para levar o saldo ao período seguinte.`,
      );
    // F3.7-11 (06-FAT linha 46): a produção do profissional se lança por fonte pagadora (o favorecido de uma fonte
    // substitui os gerais nela); cada lançamento se divide pelos favorecidos (porta). O débito se rateia pela proporção
    // de todas as partes lançadas do profissional (ratearDebito): cada estorno fica no seu lançamento, sem passar dele.
    const porFonte = await this.porBeneficiarioEFonte(s, a);
    const ids: number[] = [];
    for (const b of beneficiarios) {
      const profissional = await this.registroDoPrestador(s, b.prestador);
      const partes: { lancamento: number; centavos: number }[] = [];
      for (const f of porFonte.get(b.prestador) ?? []) {
        const r = await this.apoio.executar(
          s,
          'repasse.lancarEvento',
          {
            origem: 'apuracao',
            empresa: a.empresa,
            competencia: a.competencia,
            data,
            evento,
            tipo: 'M',
            prestador: b.prestador,
            profissional,
            valor: reais(f.centavos),
            justificativa: `Total do prestador na apuração ${a.id} aprovada`,
            apuracao: a.id,
            fontePagadora: f.fonte,
          },
          'Lançado.',
          // sem fonte, a chave de antes (a apuração já lançada não lança de novo)
          { chaveIdempotencia: `rep-ap-${a.id}-${b.prestador}${f.fonte === null ? '' : `-f${f.fonte}`}` },
        );
        // as partes da divisão (a porta devolve os lançamentos e os centavos de cada um; sem divisão, um só)
        const lancados = (r.resultado['lancamentos'] as unknown as number[] | undefined) ?? [
          Number(r.resultado['lancamento']),
        ];
        const cents = (r.resultado['centavos'] as unknown as number[] | undefined) ?? [f.centavos];
        lancados.forEach((id, i) => {
          ids.push(Number(id));
          partes.push({ lancamento: Number(id), centavos: Number(cents[i] ?? 0) });
        });
      }
      const desconto = descontoDoDebito(centavos(b.valor), centavos(debitos.get(b.prestador) ?? 0));
      if (desconto.estornoCentavos <= 0) continue;
      const rateio = ratearDebito(partes, desconto.estornoCentavos);
      if (!rateio.ok) throw recusar(rateio.codigo, 'Débito acima do bruto', rateio.mensagem);
      for (const [i, x] of rateio.estornos.entries()) {
        const r = await this.apoio.executar(
          s,
          'repasse.lancarEvento',
          {
            origem: 'estorno',
            empresa: a.empresa,
            competencia: a.competencia,
            data,
            evento,
            tipo: 'M',
            prestador: b.prestador,
            profissional,
            valor: -reais(x.centavos),
            justificativa: `Débito do repasse (glosa ou estorno de produção) descontado na apuração ${a.id}`,
            estornaDe: x.lancamento,
          },
          'Lançado.',
          { chaveIdempotencia: `rep-ap-${a.id}-${b.prestador}-debito${i === 0 ? '' : `-${i}`}` },
        );
        ids.push(Number(r.resultado['lancamento']));
      }
    }
    return {
      ok: true,
      mensagem: `${ids.length} lançamento(s) da apuração incluído(s).`,
      ids: { lancamentos: ids.join(',') },
      repetida: false,
    };
  }

  /** O id do profissional (médico) pelo código do prestador. */
  private registroDoPrestador(s: SessaoCadastro, prestador: number): Promise<number | null> {
    return this.porta.registroDoPrestador(ctx(s), prestador);
  }

  // ── Lançamentos, estorno e RPA ───────────────────────────────────────────────────────────────────────────────

  async lancamentos(
    s: SessaoCadastro,
    f: { empresa: number; competencia: string; prestador?: number },
  ): Promise<LancamentoRepasseResposta[]> {
    const [ls, op] = await Promise.all([this.porta.lancamentos(ctx(s), f), this.porta.opcoes(ctx(s))]);
    return this.lancamentosResposta(ctx(s), ls, op.eventos);
  }

  private async lancamentosResposta(
    c: ContextoRepasse,
    ls: readonly LancamentoRepasseRegistrado[],
    eventos: readonly { codigo: number; rotulo: string }[],
  ): Promise<LancamentoRepasseResposta[]> {
    const estornos = await this.porta.estornos(
      c,
      ls.map((l) => l.id),
    );
    const rotulo = new Map(eventos.map((e) => [e.codigo, e.rotulo]));
    return ls.map((l) => ({
      ...l,
      eventoRotulo: rotulo.get(l.evento) ?? `Evento ${l.evento}`,
      estornaDe: estornos.get(l.id) ?? null,
    }));
  }

  async lancar(s: SessaoCadastro, e: LancarEventoRepasseEntrada): Promise<ResultadoRepasse> {
    // O lançamento da apuração só sai pela apuração aprovada (um por prestador, com a chave de idempotência dela).
    if (e.origem === 'apuracao')
      throw recusar(
        'origem-pela-apuracao',
        'Lançamento da apuração',
        'O lançamento da apuração sai da tela de apuração, depois da aprovação.',
      );
    // M52.6: o plantão realizado só é lançado pela gestão de pessoas (o relatório ao repasse, com a chave e a DP-33).
    if (e.origem === 'plantao')
      throw recusar(
        'origem-pela-escala',
        'Lançamento de plantões',
        'Os plantões realizados são lançados pelo relatório de plantões realizados, na escala de plantão.',
      );
    const r = await this.apoio.executar(
      s,
      'repasse.lancarEvento',
      e,
      e.origem === 'estorno' ? 'Estorno lançado e ligado ao lançamento original.' : 'Lançamento incluído.',
    );
    return {
      ok: true,
      mensagem: r.mensagem ?? 'Lançamento incluído.',
      ids: r.resultado,
      repetida: r.repetida,
    };
  }

  async rpas(s: SessaoCadastro, f: { empresa: number; competencia: string }): Promise<RpaResposta[]> {
    return (await this.porta.rpas(ctx(s), f)).map((r) => ({ ...r, valor: 0, titulo: null }));
  }

  /**
   * O cálculo do RPA no servidor: os parâmetros gerais ajustados pelo dado fiscal do profissional vigente hoje no
   * estabelecimento (o que é retido, a alíquota do ISS e o percentual do INSS) e o destino do pagamento (a conta
   * principal, mascarada). Quem recebe por empresa no dia é recusado (o repasse sai em demonstrativo).
   */
  private async calcularRpa(
    s: SessaoCadastro,
    e: EmitirRpaEntrada,
  ): Promise<{
    calculo: CalculoRpa;
    ids: number[];
    origemFiscal: 'dado-fiscal' | 'regra-geral';
    destinoPagamento: string | null;
  }> {
    const p = await this.parametrosRpa(s);
    if (!p.ok) throw recusar('rpa-sem-tabela', 'Tabelas do RPA não definidas', p.motivo);
    const destino =
      this.fiscal && e.tipo === 'M' && e.profissional
        ? await this.fiscal(ctx(s), e.profissional, await this.porta.hoje(ctx(s)))
        : { dadoFiscal: null, conta: null };
    const doProfissional = parametrosDoProfissional(p.valor, destino.dadoFiscal);
    if (!doProfissional.ok)
      throw recusar(doProfissional.codigo, 'RPA não se aplica', doProfissional.motivo, 422);
    const ls = await this.porta.lancamentos(ctx(s), {
      empresa: e.empresa,
      competencia: e.competencia,
      prestador: e.prestador,
    });
    const pedidos = new Map(ls.map((l) => [l.id, l]));
    const ids = [...new Set(e.lancamentos)];
    if (ids.some((i) => !pedidos.has(i)))
      throw recusar(
        'lancamento-de-outro-prestador',
        'Lançamento fora do RPA',
        'Algum lançamento não é do prestador e da competência.',
      );
    const livres = lancamentosLivres(ids, await this.porta.jaEmRpa(ctx(s), ids));
    if (!livres.ok)
      throw recusar('ja-em-rpa', 'Lançamento já em RPA', `Já estão em RPA: ${livres.emRpa.join(', ')}.`);
    const bruto = ids.reduce((t, i) => t + centavos(pedidos.get(i)!.valor), 0);
    return {
      calculo: calcularRpa(
        { brutoCentavos: bruto, baseInssOutrasEmpresasCentavos: 0 },
        doProfissional.parametros,
      ),
      ids,
      origemFiscal: doProfissional.origem,
      destinoPagamento: destinoDoPagamento(destino.conta),
    };
  }

  async previaRpa(s: SessaoCadastro, e: EmitirRpaEntrada): Promise<PreviaRpaResposta> {
    const { calculo, ids, origemFiscal, destinoPagamento } = await this.calcularRpa(s, e);
    return {
      prestador: e.prestador,
      lancamentos: ids,
      retencoes: retencoesResposta(calculo),
      documento: e.tipo === 'M' ? 'rpa' : 'demonstrativo',
      origemFiscal,
      destinoPagamento,
    };
  }

  /** Operação crítica (M05): `reautenticadoEm` vem da senha conferida no controlador, nunca do relógio. */
  async emitirRpa(
    s: SessaoCadastro,
    e: EmitirRpaEntrada,
    reautenticadoEm: number,
  ): Promise<ResultadoRepasse> {
    const { calculo } = await this.calcularRpa(s, e);
    const r = retencoesResposta(calculo);
    const x = await this.apoio.executar(
      s,
      'repasse.emitirRpa',
      {
        ...e,
        retencoes: {
          bruto: r.bruto,
          baseInss: r.baseInss,
          inss: r.inss,
          baseIrrf: r.baseIrrf,
          faixaIrrf: calculo.faixaIrrf,
          irrf: r.irrf,
          iss: r.iss,
          liquido: r.liquido,
        },
      },
      `RPA emitido: ${r.conta}; o título a pagar foi criado.`,
      { reautenticadoEm },
    );
    return { ok: true, mensagem: x.mensagem ?? 'RPA emitido.', ids: x.resultado, repetida: x.repetida };
  }

  /** O RPA emitido, relido do banco para o documento (número, série, parcelas, título e o contribuinte mascarado). */
  async rpaEmitido(s: SessaoCadastro, id: number): Promise<RpaDetalhe & { eventos: Map<number, string> }> {
    const [r, op] = await Promise.all([this.porta.rpaDetalhe(ctx(s), id), this.porta.opcoes(ctx(s))]);
    if (!r) throw naoEncontrado('RPA');
    return { ...r, eventos: new Map(op.eventos.map((e) => [e.codigo, e.rotulo])) };
  }

  // ── Extrato do médico e indicadores ───────────────────────────────────────────────────────────────────────────

  /** Regra 12: só o próprio médico (o vínculo do usuário com o profissional, resolvido no servidor). */
  async extrato(
    s: SessaoCadastro,
    f: { desde: string; competencia: string | null },
  ): Promise<ExtratoRepasseResposta> {
    return this.extratoDosPrestadores(ctx(s), await this.porta.prestadoresDoUsuario(ctx(s), s.login), f);
  }

  /**
   * O extrato dos códigos de prestador dados, já resolvidos no servidor (o vínculo do usuário interno, regra 12; ou o
   * vínculo da conta do portal do médico externo com o corpo clínico, M50 etapa 3). Nunca códigos vindos da tela.
   */
  async extratoDosPrestadores(
    c: ContextoRepasse,
    prestadores: readonly number[],
    f: { desde: string; competencia: string | null },
  ): Promise<ExtratoRepasseResposta> {
    if (prestadores.length === 0)
      return {
        prestadores: [],
        competencia: f.competencia,
        lancamentos: [],
        rpas: [],
        total: 0,
        adiantamentos: 0,
      };
    const lim = f.competencia ? limitesCompetencia(f.competencia) : null;
    const desde = lim?.inicio ?? f.desde;
    const ate = lim?.fim ?? null;
    const [ls, rpas, op, adiant] = await Promise.all([
      this.porta.lancamentosDosPrestadores(c, prestadores, desde, ate),
      this.porta.rpasDosPrestadores(c, prestadores, desde, ate),
      this.porta.opcoes(c),
      this.porta.adiantamentos(c, prestadores),
    ]);
    const lancamentos = await this.lancamentosResposta(c, ls, op.eventos);
    return {
      prestadores: [...prestadores],
      competencia: f.competencia,
      lancamentos,
      rpas,
      total: reais(lancamentos.reduce((t, l) => t + centavos(l.valor), 0)),
      adiantamentos: adiant,
    };
  }

  /**
   * A conta do próprio médico (o objetivo da ficha: o médico vê a regra e a conta de cada valor): a memória de cálculo
   * da apuração da competência, só dos itens em que ele é o beneficiário (regra 12: o vínculo resolvido no servidor;
   * nenhum outro médico).
   */
  async contaDoMedico(s: SessaoCadastro, competencia: string): Promise<ContaDoMedicoResposta> {
    return this.contaDosPrestadores(
      ctx(s),
      await this.porta.prestadoresDoUsuario(ctx(s), s.login),
      competencia,
    );
  }

  /** A conta da competência só dos códigos de prestador dados (resolvidos no servidor; ver extratoDosPrestadores). */
  async contaDosPrestadores(
    c: ContextoRepasse,
    prestadores: readonly number[],
    competencia: string,
  ): Promise<ContaDoMedicoResposta> {
    const a = prestadores.length ? await this.porta.apuracaoDoPeriodo(c, 1, competencia) : null;
    if (!a) return { competencia, demonstrativos: [] };
    const demonstrativos: DemonstrativoResposta[] = [];
    for (const p of prestadores) {
      const d = await this.demonstrativoNo(c, a.id, p);
      if (d.itens.length) demonstrativos.push(d);
    }
    return { competencia, demonstrativos };
  }

  async indicadores(s: SessaoCadastro, de: string, ate: string): Promise<IndicadorRepasse[]> {
    const b = await this.porta.basesIndicadores(ctx(s), de, ate);
    const perc = b.honorarios > 0 ? Math.round((b.repasse / b.honorarios) * 10_000) / 100 : null;
    const prazo = b.rpasPagos > 0 ? Math.round((b.diasAtePagamento / b.rpasPagos) * 10) / 10 : null;
    return [
      {
        codigo: 'percentual-medio',
        rotulo: 'Repasse ÷ receita de honorários (linha de base 18,5%)',
        valor: perc,
        unidade: '%',
        parcelas: `${reaisBr(b.repasse)} ÷ ${reaisBr(b.honorarios)} em ${b.linhas} item(ns)`,
      },
      {
        codigo: 'prazo-pagamento',
        rotulo: 'Prazo médio do RPA ao pagamento do título',
        valor: prazo,
        unidade: 'dias',
        parcelas: `${b.diasAtePagamento} dia(s) somados ÷ ${b.rpasPagos} título(s) pago(s) de ${b.rpas}`,
      },
      {
        codigo: 'estornos',
        rotulo: 'Estornos por glosa',
        valor: b.estornos,
        unidade: 'itens',
        parcelas: `${b.estornos} estorno(s), ${reaisBr(b.valorEstornos)}`,
      },
    ];
  }

  /** Mensagem do domínio para o tipo do lançamento (só para a tela). */
  static rotuloOrigem(o: string): string {
    return o === 'V' ? 'Valor' : o === 'R' ? 'Rateio' : o;
  }
}
