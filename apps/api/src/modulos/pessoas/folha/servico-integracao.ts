// Serviço da integração da folha com o financeiro e o contábil, fatia F8 (M53.9; ficha do M53, seções 4 a 8, regras 6,
// 10 e 11): o apoio da tela (empresas, cadastro de rotinas, destinos, sugestão do perfil, de-para vigente), a vigência
// do de-para, a prévia dos títulos de uma origem (período fechado da folha calculada ou retorno conferido da folha
// externa) com as parcelas impressas, as pendências e os avisos, o lançamento pelos cenários `origem-folha` e
// `origem-encargo` de `financeiro.criarTituloPagar` (os títulos, o registro SGH_ e o evento do custo de pessoal numa
// transação só), a lista e o detalhe dos lançamentos e o custo de pessoal por centro de custo. Atrás da chave
// `pessoas.folha` (POL-3). Nenhuma resposta traz CPF ou nome: credor é código de fornecedor; valores em centavos.
//
// D-RESUMO-539 (POL-5): o resumo que a prévia mostra e o lançamento confere é o SHA-256 do plano com os vencimentos
// SUGERIDOS (o de-para e as datas de pagamento) e dos fatos; os vencimentos ajustados pela pessoa entram por chave do
// título e não mudam o resumo. Mudou a origem, o de-para ou o cadastro de rotinas: o resumo muda e o lançamento é
// recusado (`plano-mudou`).
// D-TRILHA-539 (POL-5): a trilha do lançamento é a do executor (`financeiro.titulo_pagar.gravado`, alvo com a chave
// natural `folha:<empresa>:<apuração>:<período>:<origem>:<id>`), na mesma transação; não há linha de trilha à parte.
import { createHash } from 'node:crypto';
import {
  type ApoioIntegracaoFolha,
  CHAVE_PESSOAS_FOLHA,
  type CustoPessoalPeriodo,
  DESTINOS_TITULO_FOLHA,
  EVENTOS_AUDITAVEIS,
  type FatoContabilFolha,
  type FiltroCustoPessoal,
  type FiltroLancamentosFolha,
  type FiltroOrigensFolha,
  type BuscaCredoresFolha,
  type ListaCredoresFolha,
  type GravarIntegracaoFolhaEntrada,
  type IncluirTitulosFolhaEntrada,
  type IntegracaoFolhaLida,
  type LancamentoFolha,
  type LancarTitulosFolhaEntrada,
  type ListaLancamentosFolha,
  type ListaOrigensFolha,
  type OrigemTitulosFolha,
  type PendenciaTituloFolha,
  type PreviaTitulosFolha,
  type PreviaTitulosFolhaEntrada,
  type ResultadoLancamentoFolha,
  ROTINA_DO_DESTINO,
  type RotinaIntegracaoFolha,
  type TituloFolhaPlanejado,
  type ApuracaoFolha,
  cenarioDoDestino,
} from '@sgh/contratos';
import {
  avisosDeLancamentoManual,
  conferirSomaTitulos,
  esperadoDoFechamento,
  fatosDaFolha,
  fatosDoRetorno,
  montarPlanoTitulos,
  type ParcelaOrigemFolha,
  parcelasDoFechamento,
  parcelasDoRetorno,
  type ProcessoParaTitulos,
  SUGESTAO_CLASSIFICACAO_FOLHA,
  textoResumoPlano,
} from '@sgh/dominio-pessoas';
import { integracaoVigenteEm, type LancamentoFolhaLido, mesDaData } from '@sgh/legado';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import type { PortaCalculoFolha } from './porta-calculo.js';
import type { PortaFolha } from './porta-folha.js';
import type {
  ContextoIntegracaoFolha,
  GravadorIntegracaoFolha,
  PortaIntegracaoFolha,
} from './porta-integracao.js';

export const PERMISSOES_INTEGRACAO_FOLHA = {
  ler: 'pessoas.integracao.ler',
  configurar: 'pessoas.integracao.configurar',
  lancar: 'pessoas.integracao.lancar',
} as const;
const P = PERMISSOES_INTEGRACAO_FOLHA;
const E = EVENTOS_AUDITAVEIS;
export const OPERACAO_TITULOS_FOLHA = 'financeiro.criarTituloPagar';

const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const naoEncontrado = (o: string) =>
  new ErroProblema(
    'nao-encontrado',
    404,
    `${o} não encontrado`,
    'O registro não existe neste estabelecimento.',
  );
const recusa = (codigo: string, mensagem: string, extra: object = {}) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, { codigo, ...extra });

/** A origem lida e montada: o que a prévia mostra e o lançamento manda ao executor. */
interface OrigemMontada {
  readonly apuracao: ApuracaoFolha;
  readonly periodo: string;
  readonly parcelas: readonly ParcelaOrigemFolha[];
  readonly fatos: readonly FatoContabilFolha[];
  readonly liquido: number;
  readonly encargos: number;
  readonly pendencias: readonly PendenciaTituloFolha[];
}

interface PlanoMontado {
  readonly previa: PreviaTitulosFolha;
  readonly origem: OrigemMontada;
}

export class ServicoIntegracaoFolha {
  readonly apoio: ApoioGravacao<GravadorIntegracaoFolha>;

  constructor(
    readonly porta: PortaIntegracaoFolha,
    readonly calculo: PortaCalculoFolha,
    readonly folha: PortaFolha,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    this.apoio = new ApoioGravacao<GravadorIntegracaoFolha>(
      {
        chave: CHAVE_PESSOAS_FOLHA,
        nome: 'a integração da folha',
        operacoes: { [OPERACAO_TITULOS_FOLHA]: P.lancar },
      },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private ctx(s: SessaoCadastro): ContextoIntegracaoFolha {
    return s.porta;
  }

  private async exigirEmpresa(s: SessaoCadastro, empresa: number): Promise<void> {
    const es = await this.folha.empresas(this.ctx(s));
    if (!es.some((e) => e.codigo === empresa)) throw naoEncontrado('Empresa');
  }

  /** O apoio da tela: empresas, cadastro de rotinas, destinos, a sugestão do perfil e o de-para vigente hoje. */
  async apoioTela(s: SessaoCadastro, empresa: number | null): Promise<ApoioIntegracaoFolha> {
    const c = this.ctx(s);
    const [empresas, rotinas, { hoje }] = await Promise.all([
      this.folha.empresas(c),
      this.porta.rotinas(c),
      this.folha.relogio(c),
    ]);
    const alvo = empresa ?? empresas[0]?.codigo ?? null;
    if (empresa !== null && !empresas.some((e) => e.codigo === empresa)) throw naoEncontrado('Empresa');
    const vigente = alvo === null ? null : integracaoVigenteEm(await this.porta.integracoes(c, alvo), hoje);
    const [classificacoes, credores] = await Promise.all([
      this.porta.classificacoes(c),
      vigente ? this.porta.credores(c, { codigos: vigente.destinos.map((d) => d.credor) }) : [],
    ]);
    return {
      empresas: empresas.map((e) => ({ codigo: e.codigo, nome: e.rotulo })),
      rotinas,
      destinos: DESTINOS_TITULO_FOLHA.map((d) => ({ destino: d, rotina: ROTINA_DO_DESTINO[d] })),
      sugestao: DESTINOS_TITULO_FOLHA.map((d) => ({
        destino: d,
        classificacao: SUGESTAO_CLASSIFICACAO_FOLHA[d],
      })),
      vigente,
      classificacoes,
      credores,
      hoje,
    };
  }

  /** A busca de credores do de-para (por parte do nome ou pelo código). */
  async credores(s: SessaoCadastro, f: BuscaCredoresFolha): Promise<ListaCredoresFolha> {
    return { itens: await this.porta.credores(this.ctx(s), { termo: f.termo }) };
  }

  async integracoes(s: SessaoCadastro, empresa: number): Promise<IntegracaoFolhaLida[]> {
    await this.exigirEmpresa(s, empresa);
    return this.porta.integracoes(this.ctx(s), empresa);
  }

  /** Nova vigência do de-para (completa), só SGH_ com a trilha; a rotina de cada destino tem de integrar ao financeiro. */
  async gravarIntegracao(s: SessaoCadastro, x: GravarIntegracaoFolhaEntrada): Promise<IntegracaoFolhaLida> {
    await this.exigirEmpresa(s, x.empresa);
    const rotinas = await this.porta.rotinas(this.ctx(s));
    const semFinanceiro = x.destinos.filter(
      (d) => !rotinas.find((r) => r.id === ROTINA_DO_DESTINO[d.destino])?.financeiro,
    );
    if (semFinanceiro.length)
      throw recusa(
        'rotina-sem-financeiro',
        'A rotina de um destino não integra ao financeiro no cadastro de rotinas.',
        {
          destinos: semFinanceiro.map((d) => d.destino),
        },
      );
    const id = await this.apoio.sgh(
      s,
      E.pessoasFolhaIntegracaoAlterada.codigo,
      CHAVE_PESSOAS_FOLHA,
      (y: number) => ({
        tabela: 'SGH_PES_FOLHA_INTEGRACAO',
        id: String(y),
        chave: `${x.empresa}:${x.inicio}`,
      }),
      async (g) => {
        const vs = await g.integracoes(x.empresa);
        if (vs.some((v) => v.inicio === x.inicio))
          throw recusa(
            'vigencia-repetida',
            'Já existe um de-para com este início para a empresa: escolha outra data.',
          );
        return g.incluirIntegracao({
          empresa: x.empresa,
          inicio: x.inicio,
          destinos: x.destinos,
          por: s.login,
        });
      },
    );
    const vs = await this.porta.integracoes(this.ctx(s), x.empresa);
    const v = vs.find((y) => y.inicio === x.inicio);
    if (!v) throw naoEncontrado(`De-para ${id}`);
    return v;
  }

  /** A origem: o período fechado (processamentos fixados, com os vínculos) ou o retorno conferido. */
  private async origem(
    s: SessaoCadastro,
    x: PreviaTitulosFolhaEntrada,
    rotinas: readonly RotinaIntegracaoFolha[],
  ): Promise<OrigemMontada> {
    const c = this.ctx(s);
    const pendencias: PendenciaTituloFolha[] = [];
    if (x.origem === 'fechamento') {
      const f = await this.calculo.fechamento(c, x.id);
      if (!f || f.empresa !== x.empresa) throw naoEncontrado('Fechamento');
      if (f.situacao !== 'fechada') pendencias.push({ codigo: 'origem-nao-fechada', destino: null });
      const processos: (ProcessoParaTitulos & {
        vinculos: Awaited<ReturnType<PortaCalculoFolha['resumoVinculos']>>;
      })[] = [];
      for (const p of f.processos) {
        const lido = await this.calculo.processo(c, p.id);
        if (!lido) throw naoEncontrado(`Processamento ${p.id}`);
        processos.push({
          id: p.id,
          tipo: p.tipo,
          pagamento: p.pagamento ?? f.pagamento,
          totais: lido.totais,
          vinculos: await this.calculo.resumoVinculos(c, p.id),
        });
      }
      const { liquido, encargos } = esperadoDoFechamento(processos);
      return {
        apuracao: f.apuracao,
        periodo: f.periodo,
        parcelas: parcelasDoFechamento(processos),
        fatos: fatosDaFolha(processos, rotinas),
        liquido,
        encargos,
        pendencias,
      };
    }
    const r = await this.porta.retorno(c, x.id);
    if (!r || r.empresa !== x.empresa || r.sentido !== 'recebido')
      throw naoEncontrado('Retorno da folha externa');
    if (r.situacao === 'lancado') pendencias.push({ codigo: 'ja-lancado', destino: null });
    else if (r.situacao !== 'conferido') pendencias.push({ codigo: 'lote-divergente', destino: null });
    const { parcelas, semDestino } = parcelasDoRetorno(r);
    if (semDestino > 0) pendencias.push({ codigo: 'encargo-sem-destino', destino: null });
    return {
      apuracao: 'mensal',
      periodo: r.competencia,
      parcelas,
      fatos: fatosDoRetorno(r.proventos, rotinas),
      liquido: r.liquido,
      encargos: parcelas.filter((p) => !p.destino.startsWith('liquido-')).reduce((a, p) => a + p.valor, 0),
      pendencias,
    };
  }

  /** Monta a prévia: o plano com os vencimentos sugeridos (o resumo) e o plano com os confirmados (o que se lança). */
  private async montar(
    s: SessaoCadastro,
    x: PreviaTitulosFolhaEntrada,
    emissao: string,
    vencimentos: ReadonlyMap<string, string>,
  ): Promise<PlanoMontado> {
    await this.exigirEmpresa(s, x.empresa);
    const c = this.ctx(s);
    const rotinas = await this.porta.rotinas(c);
    const o = await this.origem(s, x, rotinas);
    const dePara = integracaoVigenteEm(await this.porta.integracoes(c, x.empresa), emissao)?.destinos ?? [];
    const base = { apuracao: o.apuracao, periodo: o.periodo, parcelas: o.parcelas, dePara, rotinas, emissao };
    const sugerido = montarPlanoTitulos(base);
    const plano = vencimentos.size ? montarPlanoTitulos({ ...base, vencimentos }) : sugerido;
    const pendencias: PendenciaTituloFolha[] = [...o.pendencias, ...plano.pendencias];
    const pender = (p: PendenciaTituloFolha) => {
      if (!pendencias.some((y) => y.codigo === p.codigo && y.destino === p.destino)) pendencias.push(p);
    };
    const soma = conferirSomaTitulos(plano.titulos, o.liquido + o.encargos);
    if (soma) pender(soma);
    const [daOrigem, chaves] = await Promise.all([
      this.porta.lancamentoDaOrigem(c, x.origem, x.id),
      this.porta.chavesLancadas(c, x.empresa, o.apuracao, o.periodo),
    ]);
    if (daOrigem || plano.titulos.some((t) => chaves.includes(`${t.destino}:${t.vencimento}`)))
      pender({ codigo: 'ja-lancado', destino: null });
    const contagens = await Promise.all(
      plano.titulos
        .filter((t) => t.credor !== null && t.classificacao !== null)
        .map(async (t) => ({
          destino: t.destino,
          titulos: await this.porta.titulosManuais(c, {
            empresa: x.empresa,
            credor: t.credor!,
            ...t.classificacao!,
            ...mesDaData(t.vencimento),
          }),
        })),
    );
    const resumo = sha256(textoResumoPlano(x.origem, x.id, sugerido.titulos, o.fatos));
    const previa: PreviaTitulosFolha = {
      empresa: x.empresa,
      origem: x.origem,
      id: x.id,
      apuracao: o.apuracao,
      periodo: o.periodo,
      titulos: plano.titulos,
      fatos: o.fatos,
      conta: plano.conta,
      parcelas: plano.parcelas,
      total: plano.total,
      esperado: o.liquido + o.encargos,
      pendencias,
      avisos: avisosDeLancamentoManual(contagens),
      resumo,
      podeLancar: pendencias.length === 0 && s.pode(P.lancar),
    };
    return { previa, origem: o };
  }

  /** A prévia dos títulos de uma origem (a emissão é hoje; os vencimentos, os sugeridos). */
  // D-VENC-PREVIA-539 (POL-5): na prévia, o vencimento sugerido que já passou (a folha lançada com atraso) não barra: a
  // tela marca o título e pede o vencimento novo antes de lançar; o lançamento confere de novo com a emissão e os
  // vencimentos confirmados e recusa o que ficar antes da emissão (`titulos-com-pendencias`).
  async previa(s: SessaoCadastro, x: PreviaTitulosFolhaEntrada): Promise<PreviaTitulosFolha> {
    const { hoje } = await this.folha.relogio(this.ctx(s));
    const p = (await this.montar(s, x, hoje, new Map())).previa;
    const pendencias = p.pendencias.filter((y) => y.codigo !== 'vencimento-antes-da-emissao');
    return { ...p, pendencias, podeLancar: pendencias.length === 0 && s.pode(P.lancar) };
  }

  /** Lança os títulos da prévia conferida: o resumo igual, sem pendência; tudo numa transação do executor. */
  async lancar(s: SessaoCadastro, x: LancarTitulosFolhaEntrada): Promise<ResultadoLancamentoFolha> {
    const vencimentos = new Map(x.vencimentos.map((v) => [v.chave, v.vencimento]));
    const { previa: p, origem: o } = await this.montar(s, x, x.emissao, vencimentos);
    if (p.resumo !== x.resumo)
      throw recusa(
        'plano-mudou',
        'A folha, o de-para ou o cadastro de rotinas mudou depois da prévia: abra a prévia de novo.',
      );
    if (p.pendencias.length)
      throw recusa('titulos-com-pendencias', 'A prévia tem pendências: resolva antes de lançar.', {
        pendencias: p.pendencias,
      });
    const entrada: IncluirTitulosFolhaEntrada = {
      acao: 'incluir-folha',
      empresa: x.empresa,
      origem: x.origem,
      idOrigem: x.id,
      apuracao: o.apuracao,
      periodo: o.periodo,
      resumo: p.resumo,
      emissao: x.emissao,
      liquido: o.liquido,
      encargos: o.encargos,
      titulos: p.titulos.map((t) => ({
        chave: t.chave,
        destino: t.destino,
        rotina: t.rotina,
        credor: t.credor!,
        documento: t.documento,
        vencimento: t.vencimento,
        valor: t.valor,
        classificacao: t.classificacao!,
        referente: t.referente,
      })),
      fatos: [...o.fatos],
    };
    await this.apoio.executar(
      s,
      OPERACAO_TITULOS_FOLHA,
      entrada,
      'Títulos da folha lançados no contas a pagar.',
    );
    const l = await this.porta.lancamentoDaOrigem(this.ctx(s), x.origem, x.id);
    if (!l) throw naoEncontrado('Lançamento');
    return { lancamento: await this.completo(s, l), conta: p.conta };
  }

  private async completo(s: SessaoCadastro, l: LancamentoFolhaLido): Promise<LancamentoFolha> {
    const ts = await this.porta.titulosDoLancamento(this.ctx(s), l.id);
    const titulos = ts.map((t) => ({
      chave: `${t.destino}:${t.vencimento}`,
      destino: t.destino,
      rotina: t.rotina,
      cenario: cenarioDoDestino(t.destino),
      credor: t.credor,
      classificacao: null,
      documento: t.documento,
      valor: t.valor,
      vencimento: t.vencimento,
      referente: '',
      titulo: t.titulo,
      pago: t.pago,
    })) satisfies (TituloFolhaPlanejado & { titulo: number; pago: boolean })[];
    return { ...this.cabecalho(l), titulos };
  }

  /** O lançamento sem a contagem de títulos (a resposta traz os títulos em si ou nenhum). */
  private cabecalho(l: LancamentoFolhaLido): Omit<LancamentoFolha, 'titulos'> {
    return {
      id: l.id,
      empresa: l.empresa,
      origem: l.origem,
      idOrigem: l.idOrigem,
      apuracao: l.apuracao,
      periodo: l.periodo,
      resumo: l.resumo,
      total: l.total,
      liquido: l.liquido,
      encargos: l.encargos,
      fatos: l.fatos,
      lancadoPor: l.lancadoPor,
      lancadoEm: l.lancadoEm,
    };
  }

  async listar(s: SessaoCadastro, f: FiltroLancamentosFolha): Promise<ListaLancamentosFolha> {
    await this.exigirEmpresa(s, f.empresa);
    const ls = await this.porta.lancamentos(this.ctx(s), f.empresa, f.ano);
    return { itens: ls.map((l) => this.cabecalho(l)) };
  }

  /**
   * As origens do ano para a prévia: os fechamentos (fechados e reabertos; a prévia acusa o reaberto) e os retornos
   * recebidos da folha externa, com o lançamento já feito de cada uma. Sem valores: a prévia monta e confere.
   */
  async origens(s: SessaoCadastro, f: FiltroOrigensFolha): Promise<ListaOrigensFolha> {
    await this.exigirEmpresa(s, f.empresa);
    const c = this.ctx(s);
    const ano = String(f.ano);
    const [fs, ls, lancs] = await Promise.all([
      this.calculo.fechamentos(c, { empresa: f.empresa, ano }),
      this.folha.lotes(c, { empresa: f.empresa }),
      this.porta.lancamentos(c, f.empresa, f.ano),
    ]);
    const feito = new Map(lancs.map((l) => [`${l.origem}:${l.idOrigem}`, l.id]));
    const itens: OrigemTitulosFolha[] = [
      ...fs.map((x) => ({
        origem: 'fechamento' as const,
        id: x.id,
        apuracao: x.apuracao,
        periodo: x.periodo,
        numero: x.numero,
        situacao: x.situacao,
        lancamento: feito.get(`fechamento:${x.id}`) ?? null,
      })),
      ...ls
        .filter((l) => l.sentido === 'recebido' && l.competencia.startsWith(`${ano}-`))
        .map((l) => ({
          origem: 'interface' as const,
          id: l.id,
          apuracao: 'mensal' as const,
          periodo: l.competencia,
          numero: l.id,
          situacao: l.situacao,
          lancamento: feito.get(`interface:${l.id}`) ?? null,
        })),
    ];
    itens.sort((a, b) => (a.periodo === b.periodo ? b.id - a.id : a.periodo < b.periodo ? 1 : -1));
    return { itens };
  }

  async detalhe(s: SessaoCadastro, id: number): Promise<LancamentoFolha> {
    const l = await this.porta.lancamento(this.ctx(s), id);
    if (!l) throw naoEncontrado('Lançamento');
    return this.completo(s, l);
  }

  /** Regra 11: o custo de pessoal do período por centro de custo (dos fatos dos lançamentos). */
  async custo(s: SessaoCadastro, f: FiltroCustoPessoal): Promise<CustoPessoalPeriodo> {
    await this.exigirEmpresa(s, f.empresa);
    const r = await this.porta.custoPessoal(this.ctx(s), f.empresa, f.periodo);
    return {
      empresa: f.empresa,
      periodo: f.periodo,
      centros: r.centros,
      total: r.centros.reduce((a, x) => a + x.total, 0),
      lancamentos: r.lancamentos,
    };
  }
}
