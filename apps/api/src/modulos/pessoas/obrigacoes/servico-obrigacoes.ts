// Serviço do FGTS Digital e das obrigações legais, fatia F7 (M53.8; ficha do M53, seções 1, 4, 6 a 8; regras 3 e 7):
// os parâmetros das obrigações por empresa com vigência (regimes, leiautes, responsável), a apuração do FGTS Digital da
// competência (conferida com o eSocial), a geração (prévia ou gravação) da obrigação do período FECHADO na folha (o
// FGTS Digital, a SEFIP, o CAGED, a RAIS), o arquivo para baixar (cifrado no banco; a leitura é auditada), a entrega
// registrada (no FGTS Digital, a guia conciliada) e o cancelamento. Nada se transmite ao governo (regra 3): o arquivo vai
// ao programa oficial pelas mãos do DP. Grava pelo gravador da folha, com a trilha na mesma transação, atrás da chave `pessoas.folha`
// (POL-3). Nenhuma resposta traz CPF, NIS ou nome; os valores só com `pessoas.salario.ler`.
//
// D-FONTE-OBR-538 (POL-5): os valores vêm dos processamentos `calculada` das competências do período, que o fechamento
// fixa (folha mensal, férias e rescisão); o período mensal (na RAIS, os 12 meses e o anual) tem de estar fechado, e a
// gravação relê os fechamentos com a linha-guarda do período: reaberto no meio, a geração sai `desatualizado`.
// D-ENTREGA-538 (POL-5): a entrega só se registra para o arquivo gerado com o leiaute JÁ conferido (marcado nos
// parâmetros vigentes no período): o DP gera, confere no programa oficial, marca o leiaute, gera de novo (o mesmo
// conteúdo e a mesma soma de verificação) e registra a entrega deste.
// D-TETO-OBR-538 (POL-5): até 3.000 trabalhadores por geração, lidos 8 por vez (cada um decifra o CPF e a ficha).
import { createHash } from 'node:crypto';
import {
  APURACAO_DA_OBRIGACAO,
  type ApoioObrigacoes,
  type ApuracaoFgtsDigital,
  CHAVE_PESSOAS_FOLHA,
  type CancelarObrigacaoEntrada,
  type CodigoAvisoObrigacao,
  type ConferenciaObrigacao,
  EVENTOS_AUDITAVEIS,
  FONTES_REGIMES_OBRIGACOES,
  type FiltroApuracaoFgts,
  type FiltroObrigacoes,
  type GerarObrigacaoEntrada,
  type ListaObrigacoes,
  type ListaParametrosObrigacoes,
  type ObrigacaoLegal,
  type ParametrosObrigacoes,
  type ParametrosObrigacoesLidos,
  type PendenciaObrigacao,
  REGIMES_SUGERIDOS_OBRIGACOES,
  type RegistrarEntregaObrigacaoEntrada,
  type ResultadoGeracaoObrigacao,
  TIPOS_OBRIGACAO,
  type TipoObrigacao,
  type TotaisObrigacao,
  type TrabalhadorApuracaoFgts,
} from '@sgh/contratos';
import {
  apurarFgts,
  type ArquivoObrigacao,
  competenciasDaObrigacao,
  conciliarGuiaFgts,
  conferirApuracaoFgts,
  conferirParametrosObrigacoes,
  type EventoParaFgts,
  fimDaCompetenciaObrigacao,
  obrigacaoExigida,
  parametrosObrigacoesNa,
  pendenciaObrigacao,
  periodoEncerrado,
  type ProcessoParaObrigacao,
  type ResumoParaObrigacao,
  semEventoAceito,
  type VinculoParaObrigacao,
} from '@sgh/dominio-pessoas';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import type { ServicoEsocial } from '../esocial/servico-esocial.js';
import {
  type CatalogoObrigacoesOficiais,
  catalogoObrigacoesNa,
  exigirObrigacaoComGerador,
} from '../folha/catalogo-obrigacoes-oficiais.js';
import type { GravadorCalculoFolha } from '../folha/porta-calculo.js';

// Os registros da folha como a porta do cálculo os entrega (tipos de negócio do módulo da folha, sem cópia local).
type ObrigacaoGravada = NonNullable<Awaited<ReturnType<GravadorCalculoFolha['obrigacaoComTrava']>>>;
type FechamentoDaFolha = NonNullable<
  Awaited<ReturnType<GravadorCalculoFolha['fechamentoEmVigorComTrava']>>['vigente']
>;
type ProcessoDaFolha = NonNullable<Awaited<ReturnType<GravadorCalculoFolha['processo']>>>;

/** Teto da lista de obrigações de uma consulta (acima dele a resposta sai marcada como limitada). */
export const TETO_OBRIGACOES = 300;

export const PERMISSOES_OBRIGACOES = {
  ler: 'pessoas.obrigacao.ler',
  gerar: 'pessoas.obrigacao.gerar',
  salarioLer: 'pessoas.salario.ler',
} as const;
const P = PERMISSOES_OBRIGACOES;
const E = EVENTOS_AUDITAVEIS;

/** Teto de trabalhadores de uma geração (D-TETO-OBR-538). */
export const TETO_TRABALHADORES_OBRIGACAO = 3_000;

const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const naoEncontrado = (o: string) =>
  new ErroProblema(
    'nao-encontrado',
    404,
    `${o} não encontrada`,
    'O registro não existe neste estabelecimento.',
  );
const recusa = (codigo: string, mensagem: string, extra: object = {}) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, { codigo, ...extra });

const p2 = (n: number) => String(n).padStart(2, '0');
/** A competência anterior à de hoje (AAAA-MM-DD → AAAA-MM). */
export function competenciaAnterior(hoje: string): string {
  const a = Number(hoje.slice(0, 4));
  const m = Number(hoje.slice(5, 7));
  return m === 1 ? `${a - 1}-12` : `${a}-${p2(m - 1)}`;
}

/** A obrigação para a API: os valores só com `pessoas.salario.ler` (as quantidades ficam). */
export const paraObrigacaoApi = (o: ObrigacaoGravada, verValores: boolean): ObrigacaoLegal => ({
  id: o.id,
  empresa: o.empresa,
  tipo: o.tipo,
  periodo: o.periodo,
  numero: o.numero,
  situacao: o.situacao,
  leiaute: o.leiaute,
  leiauteConferido: o.leiauteConferido,
  nomeArquivo: o.nomeArquivo,
  tamanho: o.tamanho,
  resumo: o.resumo,
  totais: verValores ? o.totais : null,
  trabalhadores: o.totais.trabalhadores,
  fechamentos: o.fechamentos,
  geradoPor: o.geradoPor,
  geradoEm: o.geradoEm,
  entrega:
    o.situacao === 'entregue' && o.protocolo && o.entregueEm
      ? {
          protocolo: o.protocolo,
          data: o.entregueEm,
          valorGuia: verValores ? o.valorGuia : null,
          acrescimos: verValores ? o.acrescimos : null,
          por: o.entreguePor ?? '',
          em: o.entregaRegistrada ?? '',
        }
      : null,
  motivo: o.motivo,
  situacaoPor: o.situacaoPor,
  situacaoEm: o.situacaoEm,
  versao: o.versao,
});

const paraProcesso = (p: ProcessoDaFolha): ProcessoParaObrigacao => ({
  id: p.id,
  tipo: p.tipo,
  competencia: p.competencia,
});

/** O arquivo de conferência do FGTS Digital (CSV sem dado pessoal: vínculo, matrícula, valores e o eSocial). */
export function csvApuracaoFgts(
  competencia: string,
  ts: readonly TrabalhadorApuracaoFgts[],
  t: TotaisObrigacao,
) {
  const linhas = [
    'competencia;vinculo;matricula;categoria;base_fgts;fgts;base_13;fgts_13;rescisorio;esocial',
    ...ts.map((x) =>
      [
        competencia,
        x.vinculo,
        x.matricula ?? '',
        x.categoria ?? '',
        x.baseFgts,
        x.fgts,
        x.baseDecimo,
        x.fgtsDecimo,
        x.rescisorio,
        x.esocial,
      ].join(';'),
    ),
    [competencia, 'total', '', '', t.remuneracao, t.fgts, t.remuneracaoDecimo, '', t.rescisorio, ''].join(
      ';',
    ),
  ];
  return `${linhas.join('\r\n')}\r\n`;
}

/** O que a geração monta antes de gravar (a prévia devolve o mesmo, sem o conteúdo). */
interface Montagem {
  readonly pendencias: PendenciaObrigacao[];
  readonly avisos: CodigoAvisoObrigacao[];
  readonly arquivo: ArquivoObrigacao | null;
  readonly totais: TotaisObrigacao | null;
  readonly conferencia: ConferenciaObrigacao | null;
  readonly fechamentos: readonly FechamentoDaFolha[];
  readonly parametros: ParametrosObrigacoesLidos | null;
  readonly trabalhadoresFgts: readonly TrabalhadorApuracaoFgts[] | null;
  readonly vigentes: readonly ObrigacaoGravada[];
}

export class ServicoObrigacoes {
  readonly apoio: ApoioGravacao<GravadorCalculoFolha>;

  constructor(
    readonly esocial: ServicoEsocial,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    this.apoio = new ApoioGravacao<GravadorCalculoFolha>(
      { chave: CHAVE_PESSOAS_FOLHA, nome: 'a folha de pagamento', operacoes: {} },
      esocial.calculo,
      trilha,
      configuracao,
      cache,
    );
  }

  private get calculo() {
    return this.esocial.calculo;
  }
  private get folha() {
    return this.esocial.folha;
  }

  private async exigirEmpresa(s: SessaoCadastro, empresa: number): Promise<void> {
    const es = await this.folha.empresas(s.porta);
    if (!es.some((e) => e.codigo === empresa)) throw naoEncontrado('Empresa');
  }

  /**
   * O catálogo oficial das obrigações acessórias na data de hoje do relógio da folha: cada uma vigente, futura ou
   * encerrada (com o ato e a data da substituição). A tela gera só as vigentes com gerador e consulta as encerradas.
   */
  async catalogo(s: SessaoCadastro): Promise<CatalogoObrigacoesOficiais> {
    const { hoje } = await this.folha.relogio(s.porta);
    return catalogoObrigacoesNa(hoje);
  }

  async apoioTela(s: SessaoCadastro): Promise<ApoioObrigacoes> {
    const [empresas, { hoje }] = await Promise.all([
      this.folha.empresas(s.porta),
      this.folha.relogio(s.porta),
    ]);
    return {
      tipos: TIPOS_OBRIGACAO,
      regimesSugeridos: REGIMES_SUGERIDOS_OBRIGACOES,
      fontes: FONTES_REGIMES_OBRIGACOES,
      empresas: empresas.map((e) => ({ codigo: e.codigo, rotulo: e.rotulo })),
      competenciaSugerida: competenciaAnterior(hoje),
      anoSugerido: String(Number(hoje.slice(0, 4)) - 1),
      hoje,
    };
  }

  // ── Parâmetros ──────────────────────────────────────────────────────────────────────────────────────────────

  async parametros(s: SessaoCadastro, empresa: number): Promise<ListaParametrosObrigacoes> {
    await this.exigirEmpresa(s, empresa);
    return { empresa, itens: await this.calculo.parametrosObrigacoes(s.porta, empresa) };
  }

  /** Nova vigência dos parâmetros (a correção é sempre uma vigência nova). */
  async registrarParametros(s: SessaoCadastro, x: ParametrosObrigacoes): Promise<ListaParametrosObrigacoes> {
    await this.exigirEmpresa(s, x.empresa);
    const erros = conferirParametrosObrigacoes(x);
    if (erros.length)
      throw new ErroProblema('entrada-invalida', 422, 'Parâmetros inválidos', erros.join(' '), {
        codigo: 'parametros-invalidos',
      });
    const { empresa, inicio, ...dados } = x;
    await this.apoio.sgh(
      s,
      E.pessoasObrigacaoParametrosGravados.codigo,
      P.gerar,
      (id: number) => ({ tabela: 'SGH_PES_OBRIGACAO_PARAM', id: String(id), chave: `${empresa}:${inicio}` }),
      (g) => g.incluirParametrosObrigacoes({ empresa, inicio, dados: JSON.stringify(dados), por: s.login }),
    );
    return this.parametros(s, empresa);
  }

  // ── Leituras das obrigações ─────────────────────────────────────────────────────────────────────────────────

  async listar(s: SessaoCadastro, f: FiltroObrigacoes): Promise<ListaObrigacoes> {
    const xs = await this.calculo.obrigacoes(s.porta, {
      ...(f.empresa !== undefined ? { empresa: f.empresa } : {}),
      ...(f.tipo ? { tipo: f.tipo } : {}),
      ...(f.ano ? { ano: f.ano } : {}),
      ...(f.situacao ? { situacoes: [f.situacao] } : {}),
    });
    const ver = s.pode(P.salarioLer);
    return {
      itens: xs.slice(0, TETO_OBRIGACOES).map((x) => paraObrigacaoApi(x, ver)),
      limitado: xs.length > TETO_OBRIGACOES,
    };
  }

  private async obrigacaoOu404(s: SessaoCadastro, id: number): Promise<ObrigacaoGravada> {
    const o = await this.calculo.obrigacao(s.porta, id);
    if (!o) throw naoEncontrado('Obrigação');
    return o;
  }

  async detalhe(s: SessaoCadastro, id: number): Promise<ObrigacaoLegal> {
    return paraObrigacaoApi(await this.obrigacaoOu404(s, id), s.pode(P.salarioLer));
  }

  /** O arquivo decifrado para baixar (`pessoas.obrigacao.gerar`; a rota audita a leitura). */
  async arquivo(
    s: SessaoCadastro,
    id: number,
  ): Promise<{ nome: string; conteudo: string; obrigacao: ObrigacaoGravada }> {
    const o = await this.obrigacaoOu404(s, id);
    const cifrado = await this.calculo.conteudoObrigacao(s.porta, id);
    if (cifrado === null) throw naoEncontrado('Obrigação');
    const conteudo = this.esocial.exigirCifra().decifrarTexto(cifrado);
    if (conteudo === null || sha256(conteudo) !== o.resumo)
      throw recusa(
        'arquivo-divergente',
        'O arquivo gravado não confere com a soma de verificação: gere de novo.',
      );
    return { nome: o.nomeArquivo, conteudo, obrigacao: o };
  }

  // ── Montagem (prévia e gravação) ────────────────────────────────────────────────────────────────────────────

  /** Os fechamentos vigentes do período (mensal: o da competência; RAIS: os 12 meses e o anual) e os que faltam. */
  private async fechamentosDoPeriodo(
    s: SessaoCadastro,
    empresa: number,
    tipo: TipoObrigacao,
    periodo: string,
  ) {
    const competencias = competenciasDaObrigacao(tipo, periodo);
    const ano = APURACAO_DA_OBRIGACAO[tipo] === 'anual' ? periodo : periodo.slice(0, 4);
    const fs = await this.calculo.fechamentos(s.porta, { empresa, ano, situacao: 'fechada' });
    const mensais = competencias.map(
      (c) => fs.find((f) => f.apuracao === 'mensal' && f.periodo === c) ?? null,
    );
    const anual = fs.find((f) => f.apuracao === 'anual' && f.periodo === ano) ?? null;
    const faltam = competencias.filter((_, i) => !mensais[i]);
    if (tipo === 'rais' && !anual) faltam.push(ano);
    const presentes = [...mensais, ...(tipo === 'rais' ? [anual] : [])].filter(
      (f): f is FechamentoDaFolha => f !== null,
    );
    return { competencias, presentes, faltam, anualFechado: anual !== null };
  }

  /** Os processamentos `calculada` das competências e o resumo de cada vínculo neles. */
  private async processosEResumos(s: SessaoCadastro, empresa: number, competencias: readonly string[]) {
    const ps = await this.calculo.processos(s.porta, {
      empresa,
      competenciaDe: competencias[0]!,
      competenciaAte: competencias.at(-1)!,
      situacao: 'calculada',
    });
    const processos = ps.map(paraProcesso);
    const resumos = new Map<number, ResumoParaObrigacao[]>();
    for (const p of ps) resumos.set(p.id, await this.calculo.resumoVinculos(s.porta, p.id));
    return { processos, resumos };
  }

  private async eventosFgts(
    s: SessaoCadastro,
    empresa: number,
    competencia: string,
  ): Promise<EventoParaFgts[]> {
    const [mensais, anuais] = await Promise.all([
      this.esocial.porta.eventos(s.porta, {
        empresa,
        eventos: ['S-1200', 'S-2299'],
        de: competencia,
        ate: `${competencia}-99`,
      }),
      competencia.endsWith('-12')
        ? this.esocial.porta.eventos(s.porta, {
            empresa,
            eventos: ['S-1200'],
            de: competencia.slice(0, 4),
            ate: competencia.slice(0, 4),
          })
        : Promise.resolve([]),
    ]);
    return [...mensais, ...anuais].map((e) => ({
      vinculo: e.vinculo,
      evento: e.evento,
      situacao: e.situacao,
      dataReferencia: e.dataReferencia,
    }));
  }

  private async montar(s: SessaoCadastro, x: GerarObrigacaoEntrada): Promise<Montagem> {
    const c = s.porta;
    const pendencias: PendenciaObrigacao[] = [];
    const avisos: CodigoAvisoObrigacao[] = [];
    const vazio = (
      fechamentos: readonly FechamentoDaFolha[] = [],
      vigentes: readonly ObrigacaoGravada[] = [],
    ) => ({
      pendencias,
      avisos,
      arquivo: null,
      totais: null,
      conferencia: null,
      fechamentos,
      parametros: null,
      trabalhadoresFgts: null,
      vigentes,
    });
    const competenciaRef = APURACAO_DA_OBRIGACAO[x.tipo] === 'anual' ? `${x.periodo}-12` : x.periodo;
    const [{ hoje }, vs, vigentesTodas] = await Promise.all([
      this.folha.relogio(c),
      this.calculo.parametrosObrigacoes(c, x.empresa),
      this.calculo.obrigacoes(c, {
        empresa: x.empresa,
        tipo: x.tipo,
        periodo: x.periodo,
        situacoes: ['gerada', 'entregue'],
      }),
    ]);
    const vigentes = vigentesTodas;
    // O catálogo oficial da data: SEFIP, CAGED e RAIS estão encerradas (só histórico e consulta, sem gerador).
    exigirObrigacaoComGerador(await this.calculo.catalogosObrigacoes(c, hoje), x.tipo);
    if (vigentes.some((o) => o.situacao === 'entregue'))
      pendencias.push(
        pendenciaObrigacao(
          'ja-entregue',
          'O período já tem a obrigação entregue: registre a retificação no programa oficial antes de gerar de novo.',
        ),
      );
    if (!periodoEncerrado(x.tipo, x.periodo, hoje))
      pendencias.push(pendenciaObrigacao('periodo-em-curso', 'O período ainda não terminou.'));
    const parametros = parametrosObrigacoesNa(vs, x.empresa, competenciaRef);
    if (!parametros) {
      pendencias.push(
        pendenciaObrigacao(
          'sem-parametros',
          'A empresa não tem os parâmetros das obrigações vigentes no período: registre-os antes de gerar.',
        ),
      );
      return vazio([], vigentes);
    }
    const regime = parametros.regimes[x.tipo];
    if (!obrigacaoExigida(regime, x.tipo, x.periodo)) {
      pendencias.push(
        pendenciaObrigacao(
          'nao-exigida',
          'Pelo regime gravado, esta obrigação não é exigida no período (substituída pelo eSocial ou pelo FGTS Digital, ou ainda não vigente).',
        ),
      );
      return { ...vazio([], vigentes), parametros };
    }
    if (!regime.leiauteConferido) avisos.push('leiaute-nao-conferido');
    const fech = await this.fechamentosDoPeriodo(s, x.empresa, x.tipo, x.periodo);
    if (fech.faltam.length)
      pendencias.push(
        pendenciaObrigacao(
          'folha-nao-fechada',
          `Feche na folha o período antes de gerar: ${fech.faltam.join(', ')}.`,
        ),
      );
    const { processos, resumos } = await this.processosEResumos(s, x.empresa, fech.competencias);
    if (!fech.anualFechado && processos.some((p) => p.tipo === 'decimo1' || p.tipo === 'decimo2'))
      avisos.push('decimo-em-aberto');
    const base = { ...vazio(fech.presentes, vigentes), parametros };
    if (pendencias.length) return base;
    // Só o FGTS Digital tem gerador (o catálogo oficial barrou as encerradas acima).
    return this.montarFgts(s, x, base, processos, resumos, fech.presentes);
  }

  private async montarFgts(
    s: SessaoCadastro,
    x: GerarObrigacaoEntrada,
    base: Montagem,
    processos: readonly ProcessoParaObrigacao[],
    resumos: ReadonlyMap<number, readonly ResumoParaObrigacao[]>,
    fechamentos: readonly FechamentoDaFolha[],
  ): Promise<Montagem> {
    const fim = fimDaCompetenciaObrigacao(x.periodo);
    const [eventos, vinculosPeriodo] = await Promise.all([
      this.eventosFgts(s, x.empresa, x.periodo),
      this.calculo.vinculos(s.porta, `${x.periodo}-01`, fim),
    ]);
    const vinculos = new Map<number, VinculoParaObrigacao>(
      vinculosPeriodo.map((v) => [
        v.id,
        {
          vinculo: v.id,
          matricula: v.matricula,
          categoria: null,
          admissao: v.admissao,
          desligamento: v.desligamento,
        },
      ]),
    );
    const a = apurarFgts(x.periodo, processos, resumos, vinculos, eventos);
    const pendencias = [...base.pendencias];
    if (!a.trabalhadores.length)
      pendencias.push(pendenciaObrigacao('sem-trabalhadores', 'Nenhum colaborador com FGTS na competência.'));
    const sem = semEventoAceito(a.trabalhadores);
    if (sem.length)
      pendencias.push(
        pendenciaObrigacao(
          'evento-esocial-pendente',
          'Colaboradores com FGTS sem o evento aceito no eSocial (S-1200 ou S-2299): o FGTS Digital monta a guia a partir dele.',
          sem,
        ),
      );
    const mensal = fechamentos.find((f) => f.apuracao === 'mensal' && f.periodo === x.periodo) ?? null;
    const conferencia = conferirApuracaoFgts(a, mensal?.totais.fgts ?? null);
    const arquivo = pendencias.length
      ? null
      : {
          nomeArquivo: `FGTSDIGITAL${x.periodo.replace('-', '')}.csv`,
          conteudo: csvApuracaoFgts(x.periodo, a.trabalhadores, a.totais),
          linhas: a.trabalhadores.length + 2,
        };
    return {
      ...base,
      pendencias,
      arquivo,
      totais: a.totais,
      conferencia,
      trabalhadoresFgts: a.trabalhadores,
    };
  }

  /** A apuração do FGTS Digital da competência (a prévia da geração, com os trabalhadores). */
  async apuracaoFgts(s: SessaoCadastro, f: FiltroApuracaoFgts): Promise<ApuracaoFgtsDigital> {
    await this.exigirEmpresa(s, f.empresa);
    const m = await this.montar(s, {
      empresa: f.empresa,
      tipo: 'fgts-digital',
      periodo: f.competencia,
      simular: true,
      recolhimento: null,
    });
    const ver = s.pode(P.salarioLer);
    const mensal = m.fechamentos.find((x) => x.apuracao === 'mensal' && x.periodo === f.competencia) ?? null;
    const vigente = m.vigentes[0] ?? null;
    return {
      empresa: f.empresa,
      competencia: f.competencia,
      exigida: !m.pendencias.some((p) => p.codigo === 'nao-exigida' || p.codigo === 'sem-parametros'),
      fechamento: mensal ? { id: mensal.id, numero: mensal.numero } : null,
      trabalhadores: ver ? m.trabalhadoresFgts : null,
      totais: ver ? m.totais : null,
      conferencia: ver ? m.conferencia : null,
      pendencias: m.pendencias,
      avisos: m.avisos,
      vigente: vigente ? paraObrigacaoApi(vigente, ver) : null,
    };
  }

  // ── Gravações ────────────────────────────────────────────────────────────────────────────────────────────────

  /** Prévia (`simular`) ou geração do período; pendência barra. */
  async gerar(s: SessaoCadastro, x: GerarObrigacaoEntrada): Promise<ResultadoGeracaoObrigacao> {
    if (!x.simular) await this.apoio.exigirLiberacao(s);
    await this.exigirEmpresa(s, x.empresa);
    if (!x.simular) this.esocial.exigirCifra();
    const m = await this.montar(s, x);
    const ver = s.pode(P.salarioLer);
    const resposta = (o: ObrigacaoLegal | null): ResultadoGeracaoObrigacao => ({
      gerado: o !== null,
      simulado: x.simular,
      obrigacao: o,
      nomeArquivo: m.arquivo?.nomeArquivo ?? null,
      tamanho: m.arquivo ? Buffer.byteLength(m.arquivo.conteudo, 'utf8') : 0,
      totais: ver ? m.totais : null,
      trabalhadores: m.totais?.trabalhadores ?? 0,
      pendencias: m.pendencias,
      avisos: m.avisos,
      conferencia: ver ? m.conferencia : null,
    });
    if (x.simular) return resposta(null);
    if (
      m.pendencias.length ||
      !m.arquivo ||
      !m.totais ||
      !m.parametros ||
      (m.conferencia && !m.conferencia.ok)
    )
      throw recusa('obrigacao-com-pendencias', 'O período tem pendências: confira a prévia antes de gerar.', {
        pendencias: m.pendencias,
        divergencias: m.conferencia?.divergencias ?? [],
      });
    const arquivo = m.arquivo;
    const totais = m.totais;
    const regime = m.parametros.regimes[x.tipo];
    const conteudoCifrado = this.esocial.exigirCifra().cifrarTexto(arquivo.conteudo);
    const resumo = sha256(arquivo.conteudo);
    const fechados = m.fechamentos.map((f) => ({ id: f.id, apuracao: f.apuracao, periodo: f.periodo }));
    const id = await this.apoio.sgh(
      s,
      E.pessoasObrigacaoGerada.codigo,
      P.gerar,
      (r: number) => ({
        tabela: 'SGH_PES_OBRIGACAO',
        id: String(r),
        chave: `${x.empresa}:${x.tipo}:${x.periodo}`,
      }),
      async (g) => {
        // Os fechamentos relidos com a linha-guarda: reaberto depois da prévia, a geração não vale.
        for (const f of fechados) {
          const { vigente } = await g.fechamentoEmVigorComTrava(x.empresa, f.apuracao, f.periodo);
          if (vigente?.id !== f.id)
            throw recusa(
              'desatualizado',
              'A folha do período foi reaberta ou fechada de novo: abra a prévia outra vez.',
            );
        }
        const { vigentes, proximoNumero } = await g.obrigacoesEmVigorComTrava(x.empresa, x.tipo, x.periodo);
        if (vigentes.some((o) => o.situacao === 'entregue'))
          throw recusa('obrigacao-ja-entregue', 'O período já tem a obrigação entregue.');
        for (const o of vigentes) await g.substituirObrigacao({ id: o.id, versao: o.versao, por: s.login });
        return g.incluirObrigacao({
          empresa: x.empresa,
          tipo: x.tipo,
          periodo: x.periodo,
          numero: proximoNumero,
          leiaute: regime.leiaute,
          leiauteConferido: regime.leiauteConferido,
          nomeArquivo: arquivo.nomeArquivo,
          conteudoCifrado,
          tamanho: Buffer.byteLength(arquivo.conteudo, 'utf8'),
          resumo,
          totais,
          fechamentos: fechados.map((f) => f.id),
          por: s.login,
        });
      },
    );
    const gravada = await this.calculo.obrigacao(s.porta, id);
    return resposta(gravada ? paraObrigacaoApi(gravada, ver) : null);
  }

  /** Registra a entrega feita no programa oficial (D-ENTREGA-538). */
  async registrarEntrega(
    s: SessaoCadastro,
    id: number,
    x: RegistrarEntregaObrigacaoEntrada,
  ): Promise<ObrigacaoLegal> {
    const o = await this.obrigacaoOu404(s, id);
    this.conferirEntrega(o, x);
    await this.apoio.sgh(
      s,
      E.pessoasObrigacaoEntregue.codigo,
      P.gerar,
      { tabela: 'SGH_PES_OBRIGACAO', id: String(id), chave: `${o.empresa}:${o.tipo}:${o.periodo}` },
      async (g) => {
        const atual = await g.obrigacaoComTrava(id);
        if (!atual) throw naoEncontrado('Obrigação');
        this.conferirEntrega(atual, x);
        const fgts = atual.tipo === 'fgts-digital';
        await g.registrarEntregaObrigacao({
          id,
          versao: x.versao,
          protocolo: x.protocolo,
          data: x.data,
          valorGuia: fgts ? x.valorGuia : null,
          acrescimos: fgts ? (x.acrescimos ?? 0) : null,
          por: s.login,
        });
      },
    );
    return this.detalhe(s, id);
  }

  private conferirEntrega(o: ObrigacaoGravada, x: RegistrarEntregaObrigacaoEntrada): void {
    if (o.situacao === 'entregue')
      throw recusa('obrigacao-ja-entregue', 'A obrigação já tem a entrega registrada.');
    if (o.situacao !== 'gerada')
      throw recusa(
        'obrigacao-nao-gerada',
        'Só a obrigação gerada (não substituída nem cancelada) se entrega.',
      );
    if (!o.leiauteConferido)
      throw recusa(
        'leiaute-nao-conferido',
        'O arquivo foi gerado com o leiaute ainda não conferido: confira-o no programa oficial, marque o leiaute como conferido nos parâmetros e gere de novo antes de registrar a entrega.',
      );
    if (o.tipo === 'fgts-digital') {
      if (x.valorGuia === null)
        throw recusa('entrega-sem-guia', 'Informe o valor da guia emitida no FGTS Digital.', {
          campos: ['valorGuia'],
        });
      const c = conciliarGuiaFgts(o.totais, x.valorGuia, x.acrescimos ?? 0);
      if (!c.ok) throw recusa('guia-divergente', c.divergencias.join(' '), { conferencia: c });
    }
  }

  async cancelar(s: SessaoCadastro, id: number, x: CancelarObrigacaoEntrada): Promise<ObrigacaoLegal> {
    const o = await this.obrigacaoOu404(s, id);
    if (o.situacao !== 'gerada')
      throw recusa(
        o.situacao === 'entregue' ? 'obrigacao-ja-entregue' : 'obrigacao-nao-gerada',
        'Só a obrigação gerada, ainda não entregue, se cancela.',
      );
    await this.apoio.sgh(
      s,
      E.pessoasObrigacaoCancelada.codigo,
      P.gerar,
      { tabela: 'SGH_PES_OBRIGACAO', id: String(id), chave: `${o.empresa}:${o.tipo}:${o.periodo}` },
      (g) => g.cancelarObrigacao({ id, versao: x.versao, motivo: x.motivo, por: s.login }),
    );
    return this.detalhe(s, id);
  }
}
