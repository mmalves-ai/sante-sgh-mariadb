// Serviço do cálculo mensal da folha, fatia F2 (M53.3; ficha do M53, seções 4 a 8, regras 7 e 8): o salário contratual
// do vínculo, os parâmetros da folha da empresa, o cálculo da competência (prévia ou gravado, com a memória por vínculo e
// rubrica), o detalhe com a prova da soma e o descarte. Lê o vínculo e os dependentes (contagem) desta porta, o ponto
// fechado e o sobreaviso aprovado das portas do M52, os afastamentos da interface (M53-F0) e as rubricas e tabelas legais
// do M53-F1; a conta é a regra pura de @sgh/dominio-pessoas. Grava o salário, os parâmetros, o processamento e as
// linhas pela porta da folha, com a trilha na mesma transação (o nome de tabela da trilha troca na onda; pedido 03-07), atrás da chave `pessoas.folha` (POL-3). Nenhuma resposta traz CPF ou nome.
import { createHash } from 'node:crypto';
import {
  type ApoioCalculoFolha,
  type CabecalhoProcessoFolha,
  type CalcularFolhaEntrada,
  CHAVE_PESSOAS_FOLHA,
  type ColaboradorCalculado,
  type ConferenciaCalculoFolha,
  type DescartarProcessoFolhaEntrada,
  type DetalheProcessoFolha,
  EVENTOS_AUDITAVEIS,
  esquemaParametrosFolha,
  type FiltroProcessosFolha,
  type LinhasDoVinculoFolha,
  type ListaParametrosFolha,
  type ListaProcessosFolha,
  type ListaSalarios,
  type MeuHolerite,
  PAPEIS_CALCULO_FOLHA,
  PAPEIS_FORA_DO_HOLERITE,
  type RegistrarParametrosFolhaEntrada,
  type RegistrarSalarioEntrada,
  type ResultadoCalculoFolha,
  type ResultadoFolha,
  type ResumoProcessoFolha,
  type SalarioVinculo,
  TIPO_DO_PAPEL,
} from '@sgh/contratos';
import {
  calcularFolhaCompetencia,
  conferirCalculo,
  estadoDoPeriodo,
  eventosDoFechamento,
  horasDoFechamento,
  jsonCanonico,
  periodoDaCompetencia,
  type PontoFechadoParaCalculo,
  type FeriasNoMesParaCalculo,
  type ResultadoCalculoFolhaPuro,
  type VinculoParaCalculo,
} from '@sgh/dominio-pessoas';
import type { TipoVinculoTrabalho } from '@sgh/contratos';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import type { PortaRealizado } from '../escala/porta-realizado.js';
import type { PortaPonto } from '../ponto/porta-ponto.js';
import type { PortaPessoas } from '../porta.js';
import type { PortaRubricas } from '../rubricas/porta-rubricas.js';
import type { ContextoCalculoFolha, GravadorCalculoFolha, PortaCalculoFolha } from './porta-calculo.js';
import type { PortaFolha } from './porta-folha.js';
import { type EventoDoPeriodo } from '../ponto/tipos-ponto.js';
import {
  type LinhaCalculoDoVinculo,
  type ProcessoDaFolha,
  type ResumoVinculoDoProcesso,
  type SalarioDoVinculo,
} from './tipos-folha.js';
import {
  TETO_AFASTAMENTOS,
  TETO_PLANTOES_REALIZADO,
  TETO_PROCESSOS_FOLHA,
  TETO_VINCULOS_FOLHA,
  exigirCadastroDoCalculo,
} from './apoio-folha.js';

export const PERMISSOES_CALCULO_FOLHA = {
  ler: 'pessoas.folha.ler',
  calcular: 'pessoas.folha.calcular',
  salarioLer: 'pessoas.salario.ler',
  salarioEditar: 'pessoas.salario.editar',
  parametros: 'pessoas.parametroFolha.editar',
  /** As parcelas do 13º (processamentos `decimo1` e `decimo2`) se calculam e se descartam por esta permissão. */
  decimo: 'pessoas.decimo.calcular',
} as const;
const P = PERMISSOES_CALCULO_FOLHA;
const TIPOS_DECIMO: readonly string[] = ['decimo1', 'decimo2'];
const E = EVENTOS_AUDITAVEIS;

/** A frase do holerite enquanto a folha não está liberada neste estabelecimento (sem link para fora; ADR 0023). */
export const MENSAGEM_HOLERITE_FORA =
  'O holerite aparece aqui quando a folha de pagamento estiver liberada neste sistema. Até lá, consulte o RH.';

const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const p2 = (x: number) => String(x).padStart(2, '0');

function competenciaAnterior(hoje: string): string {
  const a = Number(hoje.slice(0, 4));
  const m = Number(hoje.slice(5, 7));
  return m === 1 ? `${a - 1}-12` : `${a}-${p2(m - 1)}`;
}
function proximaCompetencia(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number) as [number, number];
  return m === 12 ? `${a + 1}-01` : `${a}-${p2(m + 1)}`;
}

/** O que o cálculo leu da própria folha, para conferir depois da trava sem nova montagem (D-MONTAGEM-533). */
interface InsumosDaFolha {
  readonly vinculos: readonly number[];
  /** Salários e parâmetros lidos, em texto canônico (a ordem da leitura não importa). */
  readonly carimbo: string;
}

const carimboDosInsumos = (sal: readonly unknown[], par: readonly unknown[]): string =>
  [sal, par]
    .map((xs) =>
      xs
        .map((x) => JSON.stringify(x))
        .sort()
        .join('\n'),
    )
    .join('\n--\n');

/** D-PERM-SAL-533: o que revela o salário contratual de um colaborador exige `pessoas.salario.ler`, não só `pessoas.folha.ler`. */
const semPermissaoSalario = () =>
  new ErroProblema(
    'sem-permissao',
    403,
    'Sem permissão',
    'Ver os valores e a memória do cálculo de cada colaborador exige a permissão de consultar o salário.',
    { codigo: 'sem-permissao' },
  );

const semPermissaoDecimo = () =>
  new ErroProblema(
    'sem-permissao',
    403,
    'Sem permissão',
    'Descartar uma parcela do 13º exige a permissão de calcular o 13º.',
    { codigo: 'sem-permissao' },
  );

/** D-PERM-SAL-533: o recibo de férias tem um colaborador só, então os totais dele são o recibo individual. */
const semPermissaoReciboFerias = () =>
  new ErroProblema(
    'sem-permissao',
    403,
    'Sem permissão',
    'O recibo de férias e a rescisão mostram valores do salário de um colaborador: exigem a permissão de consultar o salário.',
    { codigo: 'sem-permissao' },
  );

const naoEncontrado = (o: string) =>
  new ErroProblema(
    'nao-encontrado',
    404,
    `${o} não encontrado`,
    'O registro não existe neste estabelecimento.',
  );
const recusa = (codigo: string, mensagem: string, campo: string | null = null) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, {
    codigo,
    ...(campo ? { campos: [campo] } : {}),
  });

const TIPOS_VINCULO: readonly TipoVinculoTrabalho[] = [
  'clt',
  'estatutario',
  'cooperado',
  'pj',
  'residente',
  'estagiario',
  'terceiro',
];

export function resumoDoProcesso(p: ProcessoDaFolha): ResumoProcessoFolha {
  return {
    id: p.id,
    empresa: p.empresa,
    competencia: p.competencia,
    tipo: p.tipo,
    numero: p.numero,
    situacao: p.situacao,
    pagamento: p.pagamento,
    totais: { ...p.totais },
    tabelaLegal: p.tabelaLegal,
    parametros: p.parametros,
    foraDaFolha: p.foraDaFolha,
    resumo: p.resumo,
    calculadoPor: p.calculadoPor,
    calculadoEm: p.calculadoEm,
    situacaoPor: p.situacaoPor,
    situacaoEm: p.situacaoEm,
    motivo: p.motivo,
    versao: p.versao,
  };
}

/** O cabeçalho sem os totais nem o resumo, para quem não consulta salário (D-PERM-SAL-533). */
export function cabecalhoDoProcesso(p: ProcessoDaFolha): CabecalhoProcessoFolha {
  return {
    id: p.id,
    empresa: p.empresa,
    competencia: p.competencia,
    tipo: p.tipo,
    numero: p.numero,
    situacao: p.situacao,
    pagamento: p.pagamento,
    tabelaLegal: p.tabelaLegal,
    parametros: p.parametros,
    foraDaFolha: p.foraDaFolha,
    calculadoPor: p.calculadoPor,
    calculadoEm: p.calculadoEm,
    situacaoPor: p.situacaoPor,
    situacaoEm: p.situacaoEm,
    motivo: p.motivo,
    versao: p.versao,
  };
}

/** O resumo do vínculo a partir das somas por papel que o banco devolve. */
export function colaboradorDoResumo(
  r: ResumoVinculoDoProcesso,
  matricula: string | null,
): ColaboradorCalculado {
  const v = (p: keyof typeof r.porPapel) => r.porPapel[p] ?? 0;
  return {
    vinculo: r.vinculo,
    matricula,
    centroCusto: r.centroCusto,
    diasPagos: r.diasPagos,
    proventos: r.proventos,
    descontos: r.descontos,
    liquido: r.proventos - r.descontos,
    baseInss: v('baseInss'),
    baseIrrf: v('baseIrrf'),
    baseFgts: v('baseFgts'),
    // M53.4: no recibo de férias e no 13º a retenção tem papel próprio (uma só por processamento).
    inss: v('inss') + v('inssFerias') + v('inssDecimo'),
    irrf: v('irrf') + v('irrfFerias') + v('irrfDecimo'),
    fgts: v('fgts'),
    encargos: v('inssPatronal') + v('rat') + v('terceiros'),
  };
}

const paraSalario = (x: SalarioDoVinculo): SalarioVinculo => ({
  id: x.id,
  vinculo: x.vinculo,
  inicio: x.inicio,
  salario: x.salario,
  insalubridade: x.insalubridade,
  periculosidade: x.periculosidade,
  motivo: x.motivo,
  registradoPor: x.registradoPor,
  registradoEm: x.registradoEm,
});

/** O conteúdo que o SHA-256 do processamento prova (sem nome nem CPF: vínculos, papéis, rubricas e valores). */
export function resumoDoCalculo(empresa: number, competencia: string, r: ResultadoCalculoFolhaPuro): string {
  return sha256(
    jsonCanonico({
      empresa,
      competencia,
      tabelaLegal: r.tabelaLegal,
      parametros: r.parametros,
      totais: r.totais,
      colaboradores: r.colaboradores.map((c) => ({ resumo: c.resumo, linhas: c.linhas })),
    }),
  );
}

/** Os minutos de sobreaviso realizados e aprovados por vínculo (os plantões da modalidade sobreaviso). */
export function sobreavisoPorVinculo(
  realizados: readonly { readonly plantao: number; readonly vinculo: number; readonly minutos: number }[],
  plantoes: readonly { readonly plantao: number; readonly tipo: string }[],
): Map<number, number> {
  const modalidade = new Map(plantoes.map((p) => [p.plantao, p.tipo]));
  const out = new Map<number, number>();
  for (const r of realizados)
    if (modalidade.get(r.plantao) === 'sobreaviso') out.set(r.vinculo, (out.get(r.vinculo) ?? 0) + r.minutos);
  return out;
}

/** O ponto FECHADO da competência por vínculo (minutos por tipo de integração e por tipo de hora do fechamento). */
export function pontoFechadoPorVinculo(
  eventosPeriodo: readonly EventoDoPeriodo[],
): Map<number, PontoFechadoParaCalculo> {
  const porVinculo = new Map<number, EventoDoPeriodo[]>();
  for (const e of eventosPeriodo) porVinculo.set(e.vinculo, [...(porVinculo.get(e.vinculo) ?? []), e]);
  const ponto = new Map<number, PontoFechadoParaCalculo>();
  for (const [v, xs] of porVinculo) {
    const est = estadoDoPeriodo(
      xs.map((e) => ({
        id: e.id,
        acao: e.acao,
        ref: e.ref,
        concorda: e.concorda,
        registradoPor: e.registradoPor,
        registradoEm: e.registradoEm,
      })),
    );
    if (est.estado !== 'fechado') continue;
    const totais = xs.find((x) => x.id === est.fechamento)?.totais ?? null;
    ponto.set(v, { eventos: eventosDoFechamento(totais) ?? {}, horas: horasDoFechamento(totais) ?? {} });
  }
  return ponto;
}

/**
 * As férias com recibo gravado na competência por vínculo (D-FERMES-534): os dias de gozo dentro do mês e, só na
 * competência do recibo (a do início do gozo), a base do INSS e o INSS retido no recibo.
 */
export function feriasDoMes(
  fs: readonly {
    vinculo: number;
    inicio: string;
    fim: string;
    competencia: string;
    baseInss: number;
    inss: number;
  }[],
  competencia: string,
  inicio: string,
  fim: string,
): Map<number, FeriasNoMesParaCalculo> {
  const dia = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;
  const out = new Map<number, FeriasNoMesParaCalculo>();
  for (const f of fs) {
    const de = Math.max(dia(f.inicio), dia(inicio));
    const ate = Math.min(dia(f.fim), dia(fim));
    const dias = ate >= de ? ate - de + 1 : 0;
    const doRecibo = f.competencia === competencia;
    const a = out.get(f.vinculo) ?? { dias: 0, baseInss: 0, inss: 0 };
    out.set(f.vinculo, {
      dias: Math.min(30, a.dias + dias),
      baseInss: a.baseInss + (doRecibo ? f.baseInss : 0),
      inss: a.inss + (doRecibo ? f.inss : 0),
    });
  }
  return out;
}

export class ServicoCalculoFolha {
  readonly apoio: ApoioGravacao<GravadorCalculoFolha>;

  constructor(
    readonly porta: PortaCalculoFolha,
    readonly folha: PortaFolha,
    readonly rubricas: PortaRubricas,
    readonly pessoas: PortaPessoas,
    readonly ponto: PortaPonto,
    readonly realizado: PortaRealizado,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    this.apoio = new ApoioGravacao<GravadorCalculoFolha>(
      { chave: CHAVE_PESSOAS_FOLHA, nome: 'a folha de pagamento', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private ctx(s: SessaoCadastro): ContextoCalculoFolha {
    return s.porta;
  }

  private async exigirEmpresa(s: SessaoCadastro, empresa: number): Promise<void> {
    const es = await this.folha.empresas(this.ctx(s));
    if (!es.some((e) => e.codigo === empresa)) throw naoEncontrado('Empresa');
  }

  // ── Apoio ───────────────────────────────────────────────────────────────────────────────────────────────────

  async apoioTela(s: SessaoCadastro): Promise<ApoioCalculoFolha> {
    const c = this.ctx(s);
    const [relogio, empresas, gravacao] = await Promise.all([
      this.folha.relogio(c),
      this.folha.empresas(c),
      this.apoio.gravacao(s, { calcular: P.calcular, salario: P.salarioEditar, parametros: P.parametros }),
    ]);
    const op = (k: string) => gravacao.operacoes[k]?.pode ?? false;
    const negadas = ['calcular', 'salario', 'parametros']
      .map((k) => gravacao.operacoes[k])
      .filter((o) => o && !o.pode);
    return {
      hoje: relogio.hoje,
      competenciaSugerida: competenciaAnterior(relogio.hoje),
      gravacao: { ligada: gravacao.ligada, motivo: gravacao.motivo },
      acoes: {
        calcular: op('calcular'),
        salario: op('salario'),
        verSalario: s.pode(P.salarioLer),
        parametros: op('parametros'),
        motivo: negadas.length === 3 ? (negadas[0]?.motivo ?? gravacao.motivo) : null,
      },
      empresas: empresas.map((e) => ({ codigo: e.codigo, rotulo: e.rotulo })),
      papeis: PAPEIS_CALCULO_FOLHA.map((papel) => ({ papel, tipo: TIPO_DO_PAPEL[papel] })),
    };
  }

  // ── Salário contratual ──────────────────────────────────────────────────────────────────────────────────────

  async listarSalarios(s: SessaoCadastro, vinculo: number): Promise<ListaSalarios> {
    const v = await this.pessoas.vinculo(s.porta, vinculo);
    if (!v) throw naoEncontrado('Colaborador');
    const xs = await this.porta.salarios(this.ctx(s), [vinculo]);
    return {
      vinculo,
      matricula: v.matricula,
      itens: [...xs].sort((a, b) => b.inicio.localeCompare(a.inicio)).map(paraSalario),
    };
  }

  async registrarSalario(s: SessaoCadastro, e: RegistrarSalarioEntrada): Promise<ResultadoFolha> {
    await this.apoio.exigirLiberacao(s);
    const v = await this.pessoas.vinculo(s.porta, e.vinculo);
    if (!v) throw naoEncontrado('Colaborador');
    if (e.inicio < v.admissao)
      throw recusa(
        'antes-da-admissao',
        'A vigência do salário não pode começar antes da admissão.',
        'inicio',
      );
    if (v.desligamento !== null && e.inicio > v.desligamento)
      throw recusa('depois-do-desligamento', 'O colaborador já está desligado nesta data.', 'inicio');
    const r = await this.apoio.sgh(
      s,
      E.pessoasSalarioGravado.codigo,
      CHAVE_PESSOAS_FOLHA,
      (x: { id: number }) => ({ tabela: 'SGH_PES_SALARIO', id: String(x.id) }),
      async (g) => {
        const id = await g.incluirSalario({
          vinculo: e.vinculo,
          inicio: e.inicio,
          salario: e.salario,
          insalubridade: e.insalubridade,
          periculosidade: e.periculosidade,
          motivo: e.motivo,
          por: s.login,
        });
        return { id };
      },
    );
    return { ok: true, id: r.id, mensagem: 'Salário registrado.' };
  }

  // ── Parâmetros da folha ─────────────────────────────────────────────────────────────────────────────────────

  async listarParametros(s: SessaoCadastro, empresa: number): Promise<ListaParametrosFolha> {
    await this.exigirEmpresa(s, empresa);
    return { empresa, itens: await this.porta.parametros(this.ctx(s), empresa) };
  }

  async registrarParametros(s: SessaoCadastro, e: RegistrarParametrosFolhaEntrada): Promise<ResultadoFolha> {
    await this.apoio.exigirLiberacao(s);
    await this.exigirEmpresa(s, e.empresa);
    const p = esquemaParametrosFolha.parse(e);
    // Toda rubrica apontada existe na empresa e serve ao papel (tipo); a vigência fica para a conferência do cálculo.
    const rs = await this.rubricas.rubricas(this.ctx(s), e.empresa);
    for (const papel of PAPEIS_CALCULO_FOLHA) {
      const id = p.rubricas[papel];
      if (id === null) continue;
      const r = rs.find((x) => x.id === id);
      const t = TIPO_DO_PAPEL[papel];
      const tipoOk =
        r &&
        (t === 'provento'
          ? r.tipo === 'provento'
          : t === 'desconto'
            ? r.tipo === 'desconto'
            : r.tipo === 'base' || r.tipo === 'informativa' || r.tipo === 'informativaDedutora');
      if (!tipoOk)
        throw recusa(
          'rubrica-invalida',
          'A rubrica escolhida não existe na empresa ou não é do tipo do papel no cálculo.',
          `rubricas.${papel}`,
        );
    }
    const r = await this.apoio.sgh(
      s,
      E.pessoasParametroFolhaGravado.codigo,
      CHAVE_PESSOAS_FOLHA,
      (x: { id: number }) => ({ tabela: 'SGH_PES_FOLHA_PARAMETRO', id: String(x.id) }),
      async (g) => ({ id: await g.incluirParametros({ ...p, por: s.login }) }),
    );
    return { ok: true, id: r.id, mensagem: 'Parâmetros da folha registrados.' };
  }

  // ── Processamentos ──────────────────────────────────────────────────────────────────────────────────────────

  async listarProcessos(s: SessaoCadastro, f: FiltroProcessosFolha): Promise<ListaProcessosFolha> {
    const ps = await this.porta.processos(this.ctx(s), {
      ...(f.empresa !== undefined ? { empresa: f.empresa } : {}),
      ...(f.competencia !== undefined ? { competencia: f.competencia } : {}),
      ...(f.tipo !== undefined ? { tipo: f.tipo } : {}),
      // D-PERM-SAL-533: o recibo de férias (um colaborador só) não entra na lista de quem não consulta salário.
      // M53.5: a rescisão também é de um colaborador só.
      ...(s.pode(P.salarioLer) ? {} : { semTipos: ['ferias', 'rescisao'] as const }),
    });
    return {
      itens: ps.slice(0, TETO_PROCESSOS_FOLHA).map(resumoDoProcesso),
      limitado: ps.length > TETO_PROCESSOS_FOLHA,
    };
  }

  /** Lê tudo o que o cálculo da competência junta e calcula (regra pura). */
  async montar(
    s: SessaoCadastro,
    empresa: number,
    competencia: string,
  ): Promise<
    ResultadoCalculoFolhaPuro & { matriculas: Map<number, string | null>; insumos: InsumosDaFolha }
  > {
    const c = this.ctx(s);
    const { inicio, fim } = periodoDaCompetencia(competencia);
    const [
      relogio,
      vinculos,
      afastamentos,
      eventosPeriodo,
      realizados,
      rubricas,
      tabelas,
      dias,
      parametros,
      feriasLidas,
    ] = await Promise.all([
      this.folha.relogio(c),
      this.porta.vinculos(c, inicio, fim),
      this.folha.afastamentos(c, { de: inicio, ate: fim }),
      this.ponto.eventosDaCompetencia(c, competencia),
      this.realizado.realizadosAprovados(
        c,
        `${competencia}-01T00:00`,
        `${proximaCompetencia(competencia)}-01T00:00`,
      ),
      this.rubricas.rubricas(c, empresa),
      this.rubricas.tabelasLegais(c),
      this.rubricas.diasAfastamento(c),
      this.porta.parametros(c, empresa),
      this.porta.feriasNaCompetencia(c, inicio, fim),
    ]);
    if (
      vinculos.length > TETO_VINCULOS_FOLHA ||
      afastamentos.length > TETO_AFASTAMENTOS ||
      realizados.length > TETO_PLANTOES_REALIZADO
    )
      throw recusa(
        'acima-do-teto',
        'A competência tem mais colaboradores, afastamentos ou plantões do que um cálculo comporta: fale com o suporte.',
        'competencia',
      );
    const ids = vinculos.map((v) => v.id);
    const [salarios, dependentes, plantoes] = await Promise.all([
      this.porta.salarios(c, ids),
      this.porta.dependentes(c, ids, fim),
      this.realizado.plantoesPorIds(c, [...new Set(realizados.map((r) => r.plantao))]),
    ]);
    const sobreaviso = sobreavisoPorVinculo(realizados, plantoes);
    const ponto = pontoFechadoPorVinculo(eventosPeriodo);

    const paraCalculo: VinculoParaCalculo[] = exigirCadastroDoCalculo(vinculos).map((v) => ({
      id: v.id,
      matricula: v.matricula,
      tipo: (TIPOS_VINCULO as readonly string[]).includes(v.tipo)
        ? (v.tipo as TipoVinculoTrabalho)
        : 'terceiro',
      admissao: v.admissao,
      desligamento: v.desligamento,
      centroCusto: v.centroCusto,
      cargaSemanal: v.cargaSemanal,
    }));
    const ferias = feriasDoMes(feriasLidas, competencia, inicio, fim);
    const r = calcularFolhaCompetencia({
      empresa,
      competencia,
      ferias,
      hoje: relogio.hoje,
      vinculos: paraCalculo,
      salarios: salarios.map((x) => ({
        vinculo: x.vinculo,
        inicio: x.inicio,
        salario: x.salario,
        dependentesIrrf: dependentes.get(x.vinculo)?.irrf ?? 0,
        dependentesSalarioFamilia: dependentes.get(x.vinculo)?.salarioFamilia ?? 0,
        insalubridade: x.insalubridade,
        periculosidade: x.periculosidade,
      })),
      ponto,
      sobreaviso,
      afastamentos: afastamentos.map((a) => ({
        vinculo: a.vinculo,
        inicio: a.inicio,
        fim: a.fim,
        situacao: a.situacao,
      })),
      tabelasLegais: tabelas,
      diasAfastamento: dias,
      parametros,
      rubricas,
    });
    return {
      ...r,
      matriculas: new Map(vinculos.map((v) => [v.id, v.matricula])),
      insumos: { vinculos: ids, carimbo: carimboDosInsumos(salarios, parametros) },
    };
  }

  async calcular(s: SessaoCadastro, e: CalcularFolhaEntrada): Promise<ResultadoCalculoFolha> {
    if (!e.simular) await this.apoio.exigirLiberacao(s);
    await this.exigirEmpresa(s, e.empresa);
    // A montagem é feita UMA vez, fora da transação (D-MONTAGEM-533): com pendência (ou na prévia), nada é gravado e a
    // tela mostra o que falta. Dentro da transação não se abre outra conexão (nenhuma leitura pela porta): segurar a
    // conexão de gravação esperando leituras do mesmo pool trava o estabelecimento com cálculos simultâneos.
    const previa = await this.montar(s, e.empresa, e.competencia);
    const resposta = (r: ResultadoCalculoFolhaPuro) => ({
      totais: r.totais,
      colaboradores: r.colaboradores.map((c) => c.resumo),
      conferencia: conferirCalculo(r.colaboradores, r.totais) as ConferenciaCalculoFolha,
    });
    if (previa.pendencias.length > 0 || e.simular)
      return {
        calculado: false,
        simulado: e.simular,
        processo: null,
        pendencias: previa.pendencias,
        ...resposta(previa),
        substituido: null,
      };

    const r = await this.apoio.sgh(
      s,
      E.pessoasFolhaCalculada.codigo,
      CHAVE_PESSOAS_FOLHA,
      (x: { id: number }) => ({ tabela: 'SGH_PES_FOLHA_PROCESSO', id: String(x.id) }),
      async (g) => {
        const { vigente, proximoNumero } = await g.emVigorComTrava(e.empresa, e.competencia);
        // Depois da trava, os insumos da própria folha (salários e parâmetros) são relidos NA transação e comparados com os
        // da montagem: se mudaram, o cálculo é recusado (regra 8). Ponto fechado, afastamentos, plantões e rubricas vêm
        // dos outros módulos e foram lidos na montagem logo antes.
        const calc = previa;
        const relidosSal = await g.salarios(calc.insumos.vinculos);
        const relidosPar = await g.parametros(e.empresa);
        if (carimboDosInsumos(relidosSal, relidosPar) !== calc.insumos.carimbo)
          throw recusa(
            'calculo-mudou',
            'Os dados da competência mudaram durante o cálculo: calcule de novo.',
            'competencia',
          );
        const conf = conferirCalculo(calc.colaboradores, calc.totais);
        if (!conf.ok)
          throw recusa('soma-divergente', 'A prova da soma do cálculo não fechou: fale com o suporte.');
        if (vigente)
          await g.situacaoProcesso({
            id: vigente.id,
            versao: vigente.versao,
            de: 'calculada',
            para: 'substituida',
            motivo: null,
            por: s.login,
          });
        const id = await g.incluirProcesso({
          empresa: e.empresa,
          competencia: e.competencia,
          numero: proximoNumero,
          totais: calc.totais,
          foraDaFolha: calc.foraDaFolha,
          tabelaLegal: calc.tabelaLegal!,
          parametros: calc.parametros!,
          resumo: resumoDoCalculo(e.empresa, e.competencia, calc),
          por: s.login,
        });
        const linhas: LinhaCalculoDoVinculo[] = calc.colaboradores.flatMap((c) =>
          c.linhas.map((l) => ({
            ...l,
            vinculo: c.resumo.vinculo,
            centroCusto: c.resumo.centroCusto,
            diasPagos: c.resumo.diasPagos,
          })),
        );
        await g.incluirLinhas(id, linhas);
        // Prova pós-escrita: o resumo relido do banco bate com o calculado.
        const relidos = await g.resumoVinculos(id);
        const prova = conferirCalculo(
          relidos.map((x) => ({ resumo: colaboradorDoResumo(x, null) })),
          calc.totais,
        );
        if (!prova.ok)
          throw recusa(
            'soma-divergente',
            'A releitura do cálculo gravado não fechou com a soma: nada foi gravado.',
          );
        const gravado = await g.processo(id);
        return { id, gravado, calc, substituido: vigente?.id ?? null };
      },
    );
    return {
      calculado: true,
      simulado: false,
      processo: r.gravado ? resumoDoProcesso(r.gravado) : null,
      pendencias: [],
      ...resposta(r.calc),
      substituido: r.substituido,
    };
  }

  private async processoOu404(s: SessaoCadastro, id: number): Promise<ProcessoDaFolha> {
    const p = await this.porta.processo(this.ctx(s), id);
    if (!p) throw naoEncontrado('Cálculo da folha');
    return p;
  }

  async detalhe(s: SessaoCadastro, id: number): Promise<DetalheProcessoFolha> {
    const p = await this.processoOu404(s, id);
    if ((p.tipo === 'ferias' || p.tipo === 'rescisao') && !s.pode(P.salarioLer))
      throw semPermissaoReciboFerias();
    const c = this.ctx(s);
    const { inicio, fim } = periodoDaCompetencia(p.competencia);
    const [rs, vs] = await Promise.all([
      this.porta.resumoVinculos(c, id),
      this.porta.vinculos(c, inicio, fim),
    ]);
    const mat = new Map(vs.map((v) => [v.id, v.matricula]));
    const colaboradores = rs.map((r) => colaboradorDoResumo(r, mat.get(r.vinculo) ?? null));
    const verSalario = s.pode(P.salarioLer);
    return {
      processo: resumoDoProcesso(p),
      // D-PERM-SAL-533: proventos, líquido e encargos por colaborador revelam o salário; sem a permissão, só os totais.
      colaboradores: verSalario ? colaboradores : [],
      colaboradoresOcultos: !verSalario,
      conferencia: conferirCalculo(
        colaboradores.map((resumo) => ({ resumo })),
        p.totais,
      ),
    };
  }

  /** Recusa (403) a leitura por colaborador a quem não tem `pessoas.salario.ler` (D-PERM-SAL-533). */
  exigirVerSalario(s: SessaoCadastro): void {
    if (!s.pode(P.salarioLer)) throw semPermissaoSalario();
  }

  async linhasDoVinculo(s: SessaoCadastro, id: number, vinculo: number): Promise<LinhasDoVinculoFolha> {
    this.exigirVerSalario(s);
    await this.processoOu404(s, id);
    const ls = await this.porta.linhasDoVinculo(this.ctx(s), id, vinculo);
    if (ls.length === 0) throw naoEncontrado('Colaborador no cálculo');
    const v = await this.pessoas.vinculo(s.porta, vinculo);
    return {
      processo: id,
      vinculo,
      matricula: v?.matricula ?? null,
      linhas: ls.map((l) => ({
        papel: l.papel,
        tipo: l.tipo,
        rubrica: l.rubrica,
        codigoRubrica: l.codigoRubrica,
        quantidade: l.quantidade,
        unidade: l.unidade,
        valor: l.valor,
        memoria: l.memoria,
      })),
    };
  }

  /**
   * O holerite do próprio colaborador (autosserviço): as linhas do vínculo no cálculo em vigor da competência, sem os
   * encargos da empresa. O escopo (só o próprio vínculo) é conferido por quem chama; aqui só a liberação da folha.
   */
  async holerite(
    s: SessaoCadastro,
    vinculo: number | null,
    competencia: string | null,
  ): Promise<MeuHolerite> {
    const [{ hoje }, l] = await Promise.all([this.folha.relogio(this.ctx(s)), this.apoio.liberacao(s)]);
    const comp = competencia ?? competenciaAnterior(hoje);
    const vazio: MeuHolerite = {
      hoje,
      competencia: comp,
      disponivel: l.ligada,
      mensagem: l.ligada ? null : MENSAGEM_HOLERITE_FORA,
      vinculo,
      matricula: null,
      calculado: false,
      calculadoEm: null,
      linhas: [],
      proventos: 0,
      descontos: 0,
      liquido: 0,
    };
    // Desligada a chave ou sem vínculo do login, nada pessoal é lido (POL-3).
    if (!l.ligada || vinculo === null) return vazio;
    const c = this.ctx(s);
    const ps = await this.porta.processos(c, { competencia: comp, situacao: 'calculada', tipo: 'mensal' });
    for (const p of ps) {
      const ls = await this.porta.linhasDoVinculo(c, p.id, vinculo);
      if (ls.length === 0) continue;
      const v = await this.pessoas.vinculo(s.porta, vinculo);
      const linhas = ls
        .filter((x) => !PAPEIS_FORA_DO_HOLERITE.includes(x.papel))
        .map((x) => ({
          papel: x.papel,
          tipo: x.tipo,
          rubrica: x.rubrica,
          codigoRubrica: x.codigoRubrica,
          quantidade: x.quantidade,
          unidade: x.unidade,
          valor: x.valor,
          memoria: x.memoria,
        }));
      const soma = (t: string) => linhas.filter((x) => x.tipo === t).reduce((a, x) => a + x.valor, 0);
      const proventos = soma('provento');
      const descontos = soma('desconto');
      return {
        ...vazio,
        matricula: v?.matricula ?? null,
        calculado: true,
        calculadoEm: p.calculadoEm,
        linhas,
        proventos,
        descontos,
        liquido: proventos - descontos,
      };
    }
    return vazio;
  }

  /**
   * Descarta o processamento em vigor. Pela rota do cálculo (`folha`, com `pessoas.folha.calcular`), uma parcela do 13º
   * exige também `pessoas.decimo.calcular`; pela rota do 13º (`decimo`, com `pessoas.decimo.calcular`), só as parcelas
   * do 13º se descartam.
   */
  async descartar(
    s: SessaoCadastro,
    id: number,
    e: DescartarProcessoFolhaEntrada,
    origem: 'folha' | 'decimo' = 'folha',
  ): Promise<ResultadoFolha> {
    await this.apoio.exigirLiberacao(s);
    const lido = await this.processoOu404(s, id);
    const ehDecimo = TIPOS_DECIMO.includes(lido.tipo);
    if (origem === 'decimo' && !ehDecimo) throw naoEncontrado('Parcela do 13º');
    if (ehDecimo && !s.pode(P.decimo)) throw semPermissaoDecimo();
    await this.apoio.sgh(
      s,
      E.pessoasFolhaCalculoDescartado.codigo,
      CHAVE_PESSOAS_FOLHA,
      { tabela: 'SGH_PES_FOLHA_PROCESSO', id: String(id) },
      async (g) => {
        const p = await g.processo(id);
        if (!p) throw naoEncontrado('Cálculo da folha');
        if (p.situacao !== 'calculada')
          throw recusa('nao-calculada', 'Só o cálculo em vigor da competência pode ser descartado.');
        // M53.4: o recibo de férias sai pelo cancelamento das férias (a fração volta ao saldo junto); a 1ª parcela do 13º
        // não sai depois da parcela final do ano (que desconta o adiantamento).
        if (p.tipo === 'ferias')
          throw recusa(
            'recibo-de-ferias',
            'O recibo de férias é cancelado pela tela de férias do colaborador, que devolve os dias ao saldo.',
          );
        // M53.5: a rescisão sai pelo cancelamento da rescisão (a rescisão registrada vai junto).
        if (p.tipo === 'rescisao')
          throw recusa(
            'termo-de-rescisao',
            'A rescisão é cancelada pela tela de rescisão do colaborador, que cancela o termo junto.',
          );
        if (p.tipo === 'decimo1') {
          const ano = p.competencia.slice(0, 4);
          const { vigente } = await g.emVigorComTrava(p.empresa, `${ano}-12`, 'decimo2');
          if (vigente)
            throw recusa(
              'parcela-final-calculada',
              'A parcela final do 13º deste ano já foi calculada com este adiantamento: descarte-a antes.',
            );
        }
        if (p.versao !== e.versao)
          throw recusa(
            'desatualizado',
            'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
          );
        await g.situacaoProcesso({
          id,
          versao: e.versao,
          de: 'calculada',
          para: 'descartada',
          motivo: e.motivo,
          por: s.login,
        });
        return { id };
      },
    );
    return { ok: true, id, mensagem: 'Cálculo descartado.' };
  }
}
