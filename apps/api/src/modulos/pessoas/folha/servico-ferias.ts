// Serviço de férias e 13º, fatia F3 (M53.4; ficha do M53, seções 4 a 8, regras 7 e 8): o saldo dos períodos aquisitivos
// do vínculo, a escala de férias, a programação de uma fração (conferida contra a CLT), o recibo de férias (prévia ou
// gravado: um processamento `ferias` com a memória por rubrica), o cancelamento, as férias do próprio colaborador e as
// duas parcelas do 13º da empresa (processamentos `decimo1` e `decimo2`). A conta é a regra pura de
// @sgh/dominio-pessoas; grava a programação de férias, o processamento e as linhas pela porta da folha, com a trilha na mesma transação, atrás
// da chave `pessoas.folha` (POL-3). Nenhuma resposta traz CPF ou nome.
import { createHash } from 'node:crypto';
import {
  type ApoioFeriasDecimo,
  type AvisoCalculoFerias,
  type CalcularDecimoEntrada,
  type CalcularFeriasEntrada,
  type CancelarFeriasEntrada,
  CHAVE_PESSOAS_FOLHA,
  type ConferenciaCalculoFolha,
  type DetalheFerias,
  EVENTOS_AUDITAVEIS,
  type FeriasDoVinculo,
  type FiltroDecimo,
  type FiltroFerias,
  type LinhaCalculoFolha,
  type ListaFerias,
  type ListaProcessosFolha,
  type MinhasFerias,
  type ProgramarFeriasEntrada,
  type RecusaProgramacaoFerias,
  type ResultadoCalculoDecimo,
  type ResultadoCalculoFerias,
  type ResultadoFolha,
  type ResultadoProgramacaoFerias,
  type SaldoFerias,
  type TipoVinculoTrabalho,
} from '@sgh/contratos';
import {
  calcularDecimoTerceiro,
  calcularFerias,
  competenciaDoDecimo,
  conferirCalculo,
  conferirProgramacao,
  type FeriasRegistrada,
  jsonCanonico,
  type ResultadoCalculoDecimoPuro,
  saldoDosPeriodos,
  totalizarCalculo,
  type VinculoCalculado,
  type VinculoParaCalculo,
  vigenteNaData,
} from '@sgh/dominio-pessoas';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import type { PortaPessoas } from '../porta.js';
import type { PortaRubricas } from '../rubricas/porta-rubricas.js';
import type { ContextoCalculoFolha, GravadorCalculoFolha, PortaCalculoFolha } from './porta-calculo.js';
import type { PortaFolha } from './porta-folha.js';
import { cabecalhoDoProcesso, colaboradorDoResumo, resumoDoProcesso } from './servico-calculo.js';
import {
  type FeriasDoVinculo as FeriasRegistradas,
  type HistoricoDaFolha,
  type LinhaCalculoDoVinculo,
} from './tipos-folha.js';
import {
  TETO_FERIAS_LISTA,
  TETO_PROCESSOS_FOLHA,
  TETO_VINCULOS_FOLHA,
  exigirCadastroDoCalculo,
} from './apoio-folha.js';
import { type VinculoColaborador } from '../tipos-pessoas.js';

export const PERMISSOES_FERIAS_FOLHA = {
  ler: 'pessoas.ferias.ler',
  programar: 'pessoas.ferias.programar',
  calcular: 'pessoas.ferias.calcular',
  decimo: 'pessoas.decimo.calcular',
  folhaLer: 'pessoas.folha.ler',
  salarioLer: 'pessoas.salario.ler',
} as const;
const P = PERMISSOES_FERIAS_FOLHA;
const E = EVENTOS_AUDITAVEIS;

/** A frase das férias do autosserviço enquanto a folha não está liberada (sem link para fora; ADR 0023). */
export const MENSAGEM_FERIAS_FORA =
  'As suas férias aparecem aqui quando a folha de pagamento estiver liberada neste sistema. Até lá, consulte o RH.';

/** O texto de cada recusa da programação (texto de produto; a tela também traduz pelo código). */
export const MENSAGEM_RECUSA_FERIAS: Readonly<Record<RecusaProgramacaoFerias, string>> = {
  'vinculo-sem-ferias': 'Este tipo de vínculo não tem férias pela CLT.',
  'periodo-inexistente': 'O período aquisitivo escolhido não é deste colaborador.',
  'aquisitivo-incompleto': 'As férias só começam depois do fim do período aquisitivo.',
  'inicio-no-passado': 'O início das férias não pode ser antes de hoje.',
  'depois-do-desligamento': 'As férias passam da data de desligamento do colaborador.',
  'fracao-minima': 'Cada fração de férias tem no mínimo 5 dias (e o que sobrar do saldo também).',
  'fracao-quatorze':
    'Uma das frações precisa ter 14 dias ou mais; com menos de 14 dias de direito, o gozo é de uma vez.',
  'tres-fracoes': 'O período aquisitivo já tem três frações de férias.',
  'saldo-insuficiente': 'Os dias de gozo e de abono passam do saldo do período aquisitivo.',
  'abono-acima': 'O abono pecuniário é de até um terço dos dias de direito.',
  'abono-repetido': 'O abono pecuniário deste período aquisitivo já foi pedido.',
  'vespera-de-descanso':
    'As férias não começam nos dois dias antes do repouso semanal (sexta-feira ou sábado).',
  sobreposicao: 'As datas cruzam outra fração de férias do colaborador.',
  'adiantamento-repetido': 'O adiantamento do 13º deste ano já foi pago ou pedido.',
};

const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

const naoEncontrado = (o: string) =>
  new ErroProblema(
    'nao-encontrado',
    404,
    `${o} não encontrado`,
    'O registro não existe neste estabelecimento.',
  );
const recusa = (codigo: string, mensagem: string, campo: string | null = null, extra: object = {}) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, {
    codigo,
    ...(campo ? { campos: [campo] } : {}),
    ...extra,
  });
const desatualizado = () =>
  recusa(
    'desatualizado',
    'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  );
const semPermissao = (mensagem: string) =>
  new ErroProblema('sem-permissao', 403, 'Sem permissão', mensagem, { codigo: 'sem-permissao' });

const TIPOS_VINCULO: readonly TipoVinculoTrabalho[] = [
  'clt',
  'estatutario',
  'cooperado',
  'pj',
  'residente',
  'estagiario',
  'terceiro',
];
const tipoVinculo = (t: string): TipoVinculoTrabalho =>
  (TIPOS_VINCULO as readonly string[]).includes(t) ? (t as TipoVinculoTrabalho) : 'terceiro';

/** O vínculo da porta de pessoas no cálculo: sem centro de custo ou carga semanal, recusa (422) com o motivo. */
const paraCalculo = (v: VinculoColaborador): VinculoParaCalculo =>
  paraCalculoCompleto(exigirCadastroDoCalculo([v])[0]!);
const paraCalculoCompleto = (v: {
  id: number;
  matricula: string | null;
  tipo: string;
  admissao: string;
  desligamento: string | null;
  centroCusto: number;
  cargaSemanal: number;
}): VinculoParaCalculo => ({
  id: v.id,
  matricula: v.matricula,
  tipo: tipoVinculo(v.tipo),
  admissao: v.admissao,
  desligamento: v.desligamento,
  centroCusto: v.centroCusto,
  cargaSemanal: v.cargaSemanal,
});

export const paraFerias = (f: FeriasRegistradas): FeriasDoVinculo => ({
  id: f.id,
  vinculo: f.vinculo,
  empresa: f.empresa,
  aquisitivoInicio: f.aquisitivoInicio,
  aquisitivoFim: f.aquisitivoFim,
  inicio: f.inicio,
  fim: f.fim,
  dias: f.dias,
  abono: f.abono,
  dobra: f.dobra,
  adiantarDecimo: f.adiantarDecimo,
  pagamento: f.pagamento,
  situacao: f.situacao,
  processo: f.processo,
  motivo: f.motivo,
  registradoPor: f.registradoPor,
  registradoEm: f.registradoEm,
  situacaoPor: f.situacaoPor,
  situacaoEm: f.situacaoEm,
  versao: f.versao,
});

const registrada = (f: FeriasRegistradas): FeriasRegistrada => ({
  id: f.id,
  aquisitivoInicio: f.aquisitivoInicio,
  inicio: f.inicio,
  fim: f.fim,
  dias: f.dias,
  abono: f.abono,
  adiantarDecimo: f.adiantarDecimo,
  situacao: f.situacao,
});

const p2 = (x: number) => String(x).padStart(2, '0');
const competenciaMais = (c: string, n: number) => {
  const t = Number(c.slice(0, 4)) * 12 + Number(c.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${p2((t % 12) + 1)}`;
};

/** O carimbo das frações lidas (id, situação e versão): muda se outra pessoa gravou no colaborador. */
const carimboFerias = (fs: readonly FeriasRegistradas[]) =>
  fs
    .map((f) => `${f.id}:${f.situacao}:${f.versao}`)
    .sort()
    .join(',');
const carimboInsumos = (sal: readonly unknown[], par: readonly unknown[]): string =>
  [sal, par]
    .map((xs) =>
      xs
        .map((x) => JSON.stringify(x))
        .sort()
        .join('\n'),
    )
    .join('\n--\n');

const linhaSaida = (l: LinhaCalculoDoVinculo | LinhaCalculoFolha): LinhaCalculoFolha => ({
  papel: l.papel,
  tipo: l.tipo,
  rubrica: l.rubrica,
  codigoRubrica: l.codigoRubrica,
  quantidade: l.quantidade,
  unidade: l.unidade,
  valor: l.valor,
  memoria: l.memoria,
});

const historicoDe = (hs: readonly HistoricoDaFolha[], vinculo: number) =>
  hs
    .filter((h) => h.vinculo === vinculo)
    .map((h) => ({ competencia: h.competencia, papel: h.papel, quantidade: h.quantidade, valor: h.valor }));

/** A programação conferida e ainda não gravada (`ServicoFeriasFolha.prepararProgramacao`). */
export interface ProgramacaoFeriasPreparada {
  readonly nova: Omit<Parameters<GravadorCalculoFolha['incluirFerias']>[0], 'por'>;
  readonly avisos: ResultadoProgramacaoFerias['avisos'];
  /** As frações lidas na conferência: depois da trava no colaborador, as relidas têm de ser as mesmas. */
  readonly carimbo: string;
}

/** Grava a programação preparada na transação de quem chama (trava o colaborador e confere o carimbo). */
export async function gravarProgramacaoFerias(
  g: Pick<GravadorCalculoFolha, 'feriasDoVinculoComTrava' | 'incluirFerias'>,
  p: ProgramacaoFeriasPreparada,
  por: string,
): Promise<number> {
  const relidas = await g.feriasDoVinculoComTrava(p.nova.vinculo);
  if (carimboFerias(relidas) !== p.carimbo) throw desatualizado();
  return g.incluirFerias({ ...p.nova, por });
}

export class ServicoFeriasFolha {
  readonly apoio: ApoioGravacao<GravadorCalculoFolha>;

  constructor(
    readonly porta: PortaCalculoFolha,
    readonly folha: PortaFolha,
    readonly rubricas: PortaRubricas,
    readonly pessoas: PortaPessoas,
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

  private async vinculoOu404(s: SessaoCadastro, id: number): Promise<VinculoColaborador> {
    const v = await this.pessoas.vinculo(s.porta, id);
    if (!v) throw naoEncontrado('Colaborador');
    return v;
  }

  private async feriasOu404(s: SessaoCadastro, id: number): Promise<FeriasRegistradas> {
    const f = await this.porta.feriasPorId(this.ctx(s), id);
    if (!f) throw naoEncontrado('Férias');
    return f;
  }

  // ── Apoio ───────────────────────────────────────────────────────────────────────────────────────────────────

  async apoioTela(s: SessaoCadastro): Promise<ApoioFeriasDecimo> {
    const c = this.ctx(s);
    const [relogio, empresas, gravacao] = await Promise.all([
      this.folha.relogio(c),
      this.folha.empresas(c),
      this.apoio.gravacao(s, {
        programar: P.programar,
        calcularFerias: P.calcular,
        calcularDecimo: P.decimo,
      }),
    ]);
    const op = (k: string) => gravacao.operacoes[k]?.pode ?? false;
    const negadas = ['programar', 'calcularFerias', 'calcularDecimo']
      .map((k) => gravacao.operacoes[k])
      .filter((o) => o && !o.pode);
    return {
      hoje: relogio.hoje,
      gravacao: { ligada: gravacao.ligada, motivo: gravacao.motivo },
      acoes: {
        programar: op('programar'),
        calcularFerias: op('calcularFerias'),
        calcularDecimo: op('calcularDecimo'),
        verSalario: s.pode(P.salarioLer),
        motivo: negadas.length === 3 ? (negadas[0]?.motivo ?? gravacao.motivo) : null,
      },
      empresas: empresas.map((e) => ({ codigo: e.codigo, rotulo: e.rotulo })),
    };
  }

  // ── Saldo e escala ──────────────────────────────────────────────────────────────────────────────────────────

  /** O saldo dos períodos do vínculo, com as frações lidas (para a programação conferir depois da trava). */
  private async montarSaldo(s: SessaoCadastro, v: VinculoColaborador, hoje: string) {
    const c = this.ctx(s);
    const ate = hoje.slice(0, 7);
    const [ferias, afastamentos, historico, dias] = await Promise.all([
      this.porta.ferias(c, { vinculo: v.id }),
      this.folha.afastamentos(c, { vinculo: v.id }),
      this.porta.historico(c, [v.id], v.admissao.slice(0, 7), ate),
      this.rubricas.diasAfastamento(c),
    ]);
    const diasEmpresa = vigenteNaData(dias, hoje)?.dias ?? 0;
    const periodos = saldoDosPeriodos({
      vinculo: paraCalculo(v),
      hoje,
      historico: historicoDe(historico, v.id),
      afastamentos: afastamentos.map((a) => ({
        vinculo: a.vinculo,
        inicio: a.inicio,
        fim: a.fim,
        situacao: a.situacao,
      })),
      diasEmpresa,
      ferias: ferias.map(registrada),
    });
    return { ferias, periodos };
  }

  async saldo(s: SessaoCadastro, vinculo: number): Promise<SaldoFerias> {
    const v = await this.vinculoOu404(s, vinculo);
    const { hoje } = await this.folha.relogio(this.ctx(s));
    const { ferias, periodos } = await this.montarSaldo(s, v, hoje);
    return {
      hoje,
      vinculo: v.id,
      matricula: v.matricula,
      temDireito: tipoVinculo(v.tipo) === 'clt',
      periodos,
      ferias: ferias.map(paraFerias),
    };
  }

  async listar(s: SessaoCadastro, f: FiltroFerias): Promise<ListaFerias> {
    const xs = await this.porta.ferias(this.ctx(s), {
      ...(f.vinculo !== undefined ? { vinculo: f.vinculo } : {}),
      ...(f.empresa !== undefined ? { empresa: f.empresa } : {}),
      ...(f.de !== undefined ? { de: f.de } : {}),
      ...(f.ate !== undefined ? { ate: f.ate } : {}),
      ...(f.situacao !== undefined ? { situacao: f.situacao } : {}),
    });
    return { itens: xs.slice(0, TETO_FERIAS_LISTA).map(paraFerias), limitado: xs.length > TETO_FERIAS_LISTA };
  }

  // ── Programação ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Confere a programação pedida (CLT, como a tela da folha) sem gravar e devolve o que a gravação precisa. A aprovação
   * da solicitação de férias do autoatendimento (W0-06, M3) usa isto e grava na própria transação, com
   * `gravarProgramacaoFerias`.
   */
  async prepararProgramacao(
    s: SessaoCadastro,
    e: ProgramarFeriasEntrada,
  ): Promise<ProgramacaoFeriasPreparada> {
    await this.apoio.exigirLiberacao(s);
    await this.exigirEmpresa(s, e.empresa);
    const v = await this.vinculoOu404(s, e.vinculo);
    const c = this.ctx(s);
    const { hoje } = await this.folha.relogio(c);
    const [{ ferias, periodos }, adiantados] = await Promise.all([
      this.montarSaldo(s, v, hoje),
      this.porta.adiantamentosDecimo(c, e.empresa, Number(e.inicio.slice(0, 4))),
    ]);
    const periodo = periodos.find((p) => p.inicio === e.aquisitivoInicio) ?? null;
    const conf = conferirProgramacao({
      vinculo: paraCalculo(v),
      hoje,
      periodo,
      ferias: ferias.map(registrada),
      decimoAdiantadoNoAno: (adiantados.get(v.id) ?? 0) > 0,
      nova: { inicio: e.inicio, dias: e.dias, abono: e.abono, adiantarDecimo: e.adiantarDecimo },
    });
    if (conf.recusas.length > 0) {
      const [primeira] = conf.recusas;
      throw recusa(primeira!, MENSAGEM_RECUSA_FERIAS[primeira!], 'inicio', { recusas: conf.recusas });
    }
    return {
      nova: {
        vinculo: v.id,
        empresa: e.empresa,
        aquisitivoInicio: periodo!.inicio,
        aquisitivoFim: periodo!.fim,
        inicio: e.inicio,
        fim: conf.fim,
        dias: e.dias,
        abono: e.abono,
        dobra: conf.dobra,
        adiantarDecimo: e.adiantarDecimo,
        pagamento: conf.pagamento,
      },
      avisos: conf.avisos,
      carimbo: carimboFerias(ferias),
    };
  }

  async programar(s: SessaoCadastro, e: ProgramarFeriasEntrada): Promise<ResultadoProgramacaoFerias> {
    const p = await this.prepararProgramacao(s, e);
    const r = await this.apoio.sgh(
      s,
      E.pessoasFeriasProgramada.codigo,
      CHAVE_PESSOAS_FOLHA,
      (x: { id: number }) => ({ tabela: 'SGH_PES_FERIAS', id: String(x.id) }),
      async (g) => ({ id: await gravarProgramacaoFerias(g, p, s.login) }),
    );
    const gravada = await this.porta.feriasPorId(this.ctx(s), r.id);
    return {
      ok: true,
      id: r.id,
      mensagem: 'Férias programadas.',
      avisos: p.avisos,
      ferias: gravada ? paraFerias(gravada) : null,
    };
  }

  // ── Recibo ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** Lê o que o recibo junta e calcula (regra pura), com os avisos e o carimbo dos insumos. */
  private async montarRecibo(s: SessaoCadastro, f: FeriasRegistradas) {
    const c = this.ctx(s);
    const v = await this.vinculoOu404(s, f.vinculo);
    const competencia = f.inicio.slice(0, 7);
    const comps = {
      de: competenciaMais(f.aquisitivoInicio.slice(0, 7), 0),
      ate: competenciaMais(competencia, 0),
    };
    const [salarios, dependentes, historico, afastamentos, dias, tabelas, parametros, rubricas, mensais] =
      await Promise.all([
        this.porta.salarios(c, [v.id]),
        this.porta.dependentes(c, [v.id], f.inicio),
        this.porta.historico(c, [v.id], comps.de, comps.ate),
        this.folha.afastamentos(c, { vinculo: v.id }),
        this.rubricas.diasAfastamento(c),
        this.rubricas.tabelasLegais(c),
        this.porta.parametros(c, f.empresa),
        this.rubricas.rubricas(c, f.empresa),
        this.porta.processos(c, {
          empresa: f.empresa,
          tipo: 'mensal',
          situacao: 'calculada',
          competenciaDe: competencia,
          competenciaAte: f.fim.slice(0, 7),
        }),
      ]);
    const dep = dependentes.get(v.id);
    const puro = calcularFerias({
      empresa: f.empresa,
      vinculo: paraCalculo(v),
      ferias: {
        aquisitivoInicio: f.aquisitivoInicio,
        inicio: f.inicio,
        dias: f.dias,
        abono: f.abono,
        dobra: f.dobra,
        adiantarDecimo: f.adiantarDecimo,
      },
      salarios: salarios.map((x) => ({
        vinculo: x.vinculo,
        inicio: x.inicio,
        salario: x.salario,
        dependentesIrrf: dep?.irrf ?? 0,
        dependentesSalarioFamilia: dep?.salarioFamilia ?? 0,
        insalubridade: x.insalubridade,
        periculosidade: x.periculosidade,
      })),
      historico: historicoDe(historico, v.id),
      afastamentos: afastamentos.map((a) => ({
        vinculo: a.vinculo,
        inicio: a.inicio,
        fim: a.fim,
        situacao: a.situacao,
      })),
      diasAfastamento: dias,
      tabelasLegais: tabelas,
      parametros,
      rubricas,
    });
    const avisos: { codigo: AvisoCalculoFerias; competencias: string[] }[] = [];
    const ja = [...new Set(mensais.map((p) => p.competencia))].sort();
    if (ja.length > 0) avisos.push({ codigo: 'folha-mensal-calculada', competencias: ja });
    if (puro.competenciasSemCalculo.length > 0)
      avisos.push({ codigo: 'competencias-sem-calculo', competencias: [...puro.competenciasSemCalculo] });
    return { puro, avisos, carimbo: carimboInsumos(salarios, parametros) };
  }

  async calcular(s: SessaoCadastro, id: number, e: CalcularFeriasEntrada): Promise<ResultadoCalculoFerias> {
    if (!e.simular) await this.apoio.exigirLiberacao(s);
    const f = await this.feriasOu404(s, id);
    if (f.situacao !== 'programada')
      throw recusa('nao-programada', 'Só as férias programadas (ainda sem recibo) podem ser calculadas.');
    if (f.versao !== e.versao) throw desatualizado();
    const { puro, avisos, carimbo } = await this.montarRecibo(s, f);
    const resumo = puro.recibo?.resumo ?? null;
    const linhas = puro.recibo ? puro.recibo.linhas.map(linhaSaida) : [];
    const totais = puro.recibo ? totalizarCalculo([puro.recibo]) : null;
    const conferencia =
      puro.recibo && totais ? (conferirCalculo([puro.recibo], totais) as ConferenciaCalculoFolha) : null;
    const previa: ResultadoCalculoFerias = {
      calculado: false,
      simulado: e.simular,
      ferias: paraFerias(f),
      processo: null,
      pendencias: puro.pendencias,
      avisos,
      resumo,
      linhas,
      conferencia,
    };
    if (puro.pendencias.length > 0 || e.simular || !puro.recibo || !totais) return previa;
    const recibo = puro.recibo;
    const r = await this.apoio.sgh(
      s,
      E.pessoasFeriasCalculada.codigo,
      CHAVE_PESSOAS_FOLHA,
      (x: { processo: number }) => ({ tabela: 'SGH_PES_FOLHA_PROCESSO', id: String(x.processo) }),
      async (g) => {
        const relidas = await g.feriasDoVinculoComTrava(f.vinculo);
        const atual = relidas.find((x) => x.id === f.id);
        if (!atual || atual.situacao !== 'programada' || atual.versao !== f.versao) throw desatualizado();
        const [sal, par] = await Promise.all([g.salarios([f.vinculo]), g.parametros(f.empresa)]);
        if (carimboInsumos(sal, par) !== carimbo)
          throw recusa(
            'calculo-mudou',
            'O salário ou os parâmetros mudaram durante o cálculo: calcule de novo.',
          );
        if (!conferirCalculo([recibo], totais).ok)
          throw recusa('soma-divergente', 'A prova da soma do recibo não fechou: fale com o suporte.');
        const { proximoNumero } = await g.emVigorComTrava(f.empresa, puro.competencia, 'ferias');
        const processo = await g.incluirProcesso({
          empresa: f.empresa,
          competencia: puro.competencia,
          tipo: 'ferias',
          pagamento: f.pagamento,
          numero: proximoNumero,
          totais,
          foraDaFolha: 0,
          tabelaLegal: puro.tabelaLegal!,
          parametros: puro.parametros!,
          resumo: sha256(
            jsonCanonico({
              ferias: f.id,
              competencia: puro.competencia,
              resumo: recibo.resumo,
              linhas: recibo.linhas,
            }),
          ),
          por: s.login,
        });
        await g.incluirLinhas(
          processo,
          recibo.linhas.map((l) => ({
            ...l,
            vinculo: f.vinculo,
            centroCusto: recibo.resumo.centroCusto,
            diasPagos: recibo.resumo.diasPagos,
          })),
        );
        await g.situacaoFerias({
          id: f.id,
          versao: f.versao,
          de: 'programada',
          para: 'calculada',
          processo,
          motivo: null,
          por: s.login,
        });
        const relidos = await g.resumoVinculos(processo);
        if (
          !conferirCalculo(
            relidos.map((x) => ({ resumo: colaboradorDoResumo(x, null) })),
            totais,
          ).ok
        )
          throw recusa(
            'soma-divergente',
            'A releitura do recibo gravado não fechou com a soma: nada foi gravado.',
          );
        return { processo, gravado: await g.processo(processo) };
      },
    );
    const depois = await this.porta.feriasPorId(this.ctx(s), f.id);
    return {
      ...previa,
      calculado: true,
      ferias: paraFerias(depois ?? f),
      processo: r.gravado ? resumoDoProcesso(r.gravado) : null,
    };
  }

  async detalhe(s: SessaoCadastro, id: number): Promise<DetalheFerias> {
    const f = await this.feriasOu404(s, id);
    const c = this.ctx(s);
    const p = f.processo !== null ? await this.porta.processo(c, f.processo) : null;
    const verSalario = s.pode(P.salarioLer);
    const linhas =
      p && verSalario ? (await this.porta.linhasDoVinculo(c, p.id, f.vinculo)).map(linhaSaida) : [];
    return {
      ferias: paraFerias(f),
      // D-PERM-SAL-533: o recibo tem um colaborador só; sem o salário, os totais e o resumo também ficam de fora.
      processo: p ? (verSalario ? resumoDoProcesso(p) : cabecalhoDoProcesso(p)) : null,
      linhas,
      linhasOcultas: p !== null && !verSalario,
    };
  }

  /** O aviso e o recibo para o PDF: os valores revelam o salário, então exige `pessoas.salario.ler` (D-PERM-SAL-533). */
  async recibo(s: SessaoCadastro, id: number): Promise<{ detalhe: DetalheFerias; matricula: string | null }> {
    if (!s.pode(P.salarioLer))
      throw semPermissao(
        'O recibo de férias mostra valores do salário: exige a permissão de consultar salário.',
      );
    const detalhe = await this.detalhe(s, id);
    const v = await this.vinculoOu404(s, detalhe.ferias.vinculo);
    return { detalhe, matricula: v.matricula };
  }

  async cancelar(s: SessaoCadastro, id: number, e: CancelarFeriasEntrada): Promise<ResultadoFolha> {
    await this.apoio.exigirLiberacao(s);
    const f = await this.feriasOu404(s, id);
    if (f.situacao === 'cancelada') throw recusa('ja-cancelada', 'Estas férias já estão canceladas.');
    // D-PERM-534: cancelar o recibo calculado (valor) é de quem calcula; a programação, de quem programa.
    if (f.situacao === 'calculada' && !s.pode(P.calcular))
      throw semPermissao('Cancelar um recibo de férias já calculado exige a permissão de calcular férias.');
    await this.apoio.sgh(
      s,
      E.pessoasFeriasCancelada.codigo,
      CHAVE_PESSOAS_FOLHA,
      { tabela: 'SGH_PES_FERIAS', id: String(id) },
      async (g) => {
        const relidas = await g.feriasDoVinculoComTrava(f.vinculo);
        const atual = relidas.find((x) => x.id === id);
        if (!atual || atual.situacao !== f.situacao || atual.versao !== e.versao) throw desatualizado();
        if (atual.situacao === 'calculada' && atual.processo !== null) {
          const p = await g.processo(atual.processo);
          if (p && p.situacao === 'calculada')
            await g.situacaoProcesso({
              id: p.id,
              versao: p.versao,
              de: 'calculada',
              para: 'descartada',
              motivo: e.motivo,
              por: s.login,
            });
        }
        await g.situacaoFerias({
          id,
          versao: e.versao,
          de: atual.situacao,
          para: 'cancelada',
          motivo: e.motivo,
          por: s.login,
        });
        return { id };
      },
    );
    return { ok: true, id, mensagem: 'Férias canceladas.' };
  }

  /** As férias do próprio colaborador (autosserviço): o escopo (só o próprio vínculo) é conferido por quem chama. */
  async minhas(s: SessaoCadastro, vinculo: number | null): Promise<MinhasFerias> {
    const [{ hoje }, l] = await Promise.all([this.folha.relogio(this.ctx(s)), this.apoio.liberacao(s)]);
    const vazio: MinhasFerias = {
      hoje,
      disponivel: l.ligada,
      mensagem: l.ligada ? null : MENSAGEM_FERIAS_FORA,
      saldo: null,
    };
    // Desligada a chave ou sem vínculo do login, nada pessoal é lido (POL-3).
    if (!l.ligada || vinculo === null) return vazio;
    return { ...vazio, saldo: await this.saldo(s, vinculo) };
  }

  // ── 13º salário ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Lê o que a parcela do 13º junta e calcula (regra pura). */
  async montarDecimo(
    s: SessaoCadastro,
    e: Omit<CalcularDecimoEntrada, 'simular'>,
  ): Promise<ResultadoCalculoDecimoPuro & { matriculas: Map<number, string | null>; carimbo: string }> {
    const c = this.ctx(s);
    const de = `${e.ano}-01-01`;
    const ate = `${e.ano}-12-31`;
    const ref = e.parcela === 1 ? e.pagamento : ate;
    const [relogio, vinculos, afastamentos, dias, tabelas, parametros, rubricas, adiantamentos] =
      await Promise.all([
        this.folha.relogio(c),
        this.porta.vinculos(c, de, ate),
        this.folha.afastamentos(c, { de, ate }),
        this.rubricas.diasAfastamento(c),
        this.rubricas.tabelasLegais(c),
        this.porta.parametros(c, e.empresa),
        this.rubricas.rubricas(c, e.empresa),
        // Na 1ª parcela, só o adiantamento pago com as férias tira o vínculo (a 1ª parcela anterior é a que se refaz).
        this.porta.adiantamentosDecimo(
          c,
          e.empresa,
          e.ano,
          e.parcela === 1 ? ['ferias'] : ['decimo1', 'ferias'],
        ),
      ]);
    if (vinculos.length > TETO_VINCULOS_FOLHA)
      throw recusa(
        'acima-do-teto',
        'O ano tem mais colaboradores do que um cálculo comporta: fale com o suporte.',
        'ano',
      );
    const ids = vinculos.map((v) => v.id);
    const [salarios, dependentes, historico] = await Promise.all([
      this.porta.salarios(c, ids),
      this.porta.dependentes(c, ids, ref),
      e.parcela === 2 ? this.porta.historico(c, ids, `${e.ano}-01`, `${e.ano}-11`) : Promise.resolve([]),
    ]);
    const porVinculo = new Map<number, ReturnType<typeof historicoDe>>();
    for (const v of ids) porVinculo.set(v, historicoDe(historico, v));
    const r = calcularDecimoTerceiro({
      empresa: e.empresa,
      ano: e.ano,
      parcela: e.parcela,
      pagamento: e.pagamento,
      hoje: relogio.hoje,
      vinculos: exigirCadastroDoCalculo(vinculos).map(paraCalculoCompleto),
      salarios: salarios.map((x) => ({
        vinculo: x.vinculo,
        inicio: x.inicio,
        salario: x.salario,
        dependentesIrrf: dependentes.get(x.vinculo)?.irrf ?? 0,
        dependentesSalarioFamilia: dependentes.get(x.vinculo)?.salarioFamilia ?? 0,
        insalubridade: x.insalubridade,
        periculosidade: x.periculosidade,
      })),
      afastamentos: afastamentos.map((a) => ({
        vinculo: a.vinculo,
        inicio: a.inicio,
        fim: a.fim,
        situacao: a.situacao,
      })),
      diasAfastamento: dias,
      historico: porVinculo,
      adiantamentos,
      tabelasLegais: tabelas,
      parametros,
      rubricas,
    });
    const calculados = new Set(r.colaboradores.map((x) => x.resumo.vinculo));
    return {
      ...r,
      matriculas: new Map(vinculos.map((v) => [v.id, v.matricula])),
      carimbo: carimboInsumos(
        salarios.filter((x) => calculados.has(x.vinculo)),
        parametros,
      ),
    };
  }

  async calcularDecimo(s: SessaoCadastro, e: CalcularDecimoEntrada): Promise<ResultadoCalculoDecimo> {
    if (!e.simular) await this.apoio.exigirLiberacao(s);
    await this.exigirEmpresa(s, e.empresa);
    const previa = await this.montarDecimo(s, e);
    const resposta = (r: {
      colaboradores: readonly VinculoCalculado[];
      totais: ResultadoCalculoDecimoPuro['totais'];
    }) => ({
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
        avisos: previa.avisos,
        ...resposta(previa),
        substituido: null,
      };
    const tipo = e.parcela === 1 ? 'decimo1' : 'decimo2';
    const competencia = competenciaDoDecimo(e.ano, e.parcela, e.pagamento);
    const r = await this.apoio.sgh(
      s,
      E.pessoasDecimoCalculado.codigo,
      CHAVE_PESSOAS_FOLHA,
      (x: { id: number }) => ({ tabela: 'SGH_PES_FOLHA_PROCESSO', id: String(x.id) }),
      async (g) => {
        const ano = { de: `${e.ano}-01`, ate: `${e.ano}-12` };
        const { vigente, proximoNumero } = await g.emVigorComTrava(
          e.empresa,
          competencia,
          tipo,
          e.parcela === 1 ? ano : null,
        );
        if (e.parcela === 1) {
          const final = await g.emVigorComTrava(e.empresa, `${e.ano}-12`, 'decimo2');
          if (final.vigente)
            throw recusa(
              'parcela-final-calculada',
              'A parcela final do 13º deste ano já foi calculada: descarte-a antes de refazer o adiantamento.',
              'parcela',
            );
        }
        // Depois da trava, os salários dos vínculos calculados e os parâmetros relidos NA transação batem com a montagem.
        const sal = await g.salarios(previa.colaboradores.map((x) => x.resumo.vinculo));
        const par = await g.parametros(e.empresa);
        if (carimboInsumos(sal, par) !== previa.carimbo)
          throw recusa('calculo-mudou', 'Os dados do 13º mudaram durante o cálculo: calcule de novo.', 'ano');
        const conf = conferirCalculo(previa.colaboradores, previa.totais);
        if (!conf.ok)
          throw recusa('soma-divergente', 'A prova da soma do 13º não fechou: fale com o suporte.');
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
          competencia,
          tipo,
          pagamento: e.pagamento,
          numero: proximoNumero,
          totais: previa.totais,
          foraDaFolha: previa.foraDaFolha,
          tabelaLegal: previa.tabelaLegal!,
          parametros: previa.parametros!,
          resumo: sha256(
            jsonCanonico({
              empresa: e.empresa,
              ano: e.ano,
              parcela: e.parcela,
              pagamento: e.pagamento,
              totais: previa.totais,
              colaboradores: previa.colaboradores.map((c) => ({ resumo: c.resumo, linhas: c.linhas })),
            }),
          ),
          por: s.login,
        });
        await g.incluirLinhas(
          id,
          previa.colaboradores.flatMap((c) =>
            c.linhas.map((l) => ({
              ...l,
              vinculo: c.resumo.vinculo,
              centroCusto: c.resumo.centroCusto,
              diasPagos: c.resumo.diasPagos,
            })),
          ),
        );
        const relidos = await g.resumoVinculos(id);
        if (
          !conferirCalculo(
            relidos.map((x) => ({ resumo: colaboradorDoResumo(x, null) })),
            previa.totais,
          ).ok
        )
          throw recusa(
            'soma-divergente',
            'A releitura do 13º gravado não fechou com a soma: nada foi gravado.',
          );
        return { id, gravado: await g.processo(id), substituido: vigente?.id ?? null };
      },
    );
    return {
      calculado: true,
      simulado: false,
      processo: r.gravado ? resumoDoProcesso(r.gravado) : null,
      pendencias: [],
      avisos: previa.avisos,
      ...resposta(previa),
      substituido: r.substituido,
    };
  }

  /** As parcelas do 13º (processamentos `decimo1` e `decimo2`) da empresa e do ano. */
  async listarDecimo(s: SessaoCadastro, f: FiltroDecimo): Promise<ListaProcessosFolha> {
    const c = this.ctx(s);
    const faixa = f.ano !== undefined ? { competenciaDe: `${f.ano}-01`, competenciaAte: `${f.ano}-12` } : {};
    const emp = f.empresa !== undefined ? { empresa: f.empresa } : {};
    const [um, dois] = await Promise.all([
      this.porta.processos(c, { ...emp, ...faixa, tipo: 'decimo1' }),
      this.porta.processos(c, { ...emp, ...faixa, tipo: 'decimo2' }),
    ]);
    const ps = [...dois, ...um].sort(
      (a, b) => b.competencia.localeCompare(a.competencia) || a.empresa - b.empresa || b.numero - a.numero,
    );
    return {
      itens: ps.slice(0, TETO_PROCESSOS_FOLHA).map(resumoDoProcesso),
      limitado: ps.length > TETO_PROCESSOS_FOLHA,
    };
  }
}
