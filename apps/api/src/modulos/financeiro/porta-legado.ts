// Porta do financeiro sobre o núcleo do legado (M32): leituras READ ONLY pelos repositórios de @sgh/legado; gravações
// pelo EXECUTOR (receitas financeiro.*, com a trilha na mesma transação); as só do novo em transação SGH_ com a
// SGH_TRILHA junto. Em dev sobre a cópia compartilhada, o executor só de leitura recusa as gravações (como nos outros
// módulos). `portaFinanceiroNaTransacao`: a mesma porta sobre UMA transação aberta (integração na cópia, desfeita).
import {
  adiantamentos,
  aprovacoesDosTitulos,
  aprovarTituloSgh,
  atribuirCreditoSgh,
  apropriacoesGerenciais,
  basesDre,
  basesIndicadores,
  borderos,
  classificacoes,
  confirmarConciliacaoSgh,
  contaCorrenteConvenios,
  contasDeRetencao,
  contasDoEscopo,
  contasSemTituloLidas,
  creditosPendentes,
  deParaContabil,
  documentoDoCredor,
  type Escritor,
  escrituracaoEntradas,
  type Executor,
  filaAprovacao,
  formasPagamento,
  type FonteCatalogo,
  gravarTrilha,
  historicosConvenio,
  hojeFinanceiro,
  importarExtratoSgh,
  lancamentosFluxo,
  type Leitor,
  lerFaixasAlcada,
  linhasExtrato,
  type MetricasExecutor,
  movimentoDaConta,
  type NucleoLegado,
  operacao,
  registrarDeclaracaoSgh,
  registrarGlosaTituloSgh,
  registrarLoteContabilSgh,
  registrarNfseSgh,
  registrarRemessaSgh,
  registrosFiscais,
  renegociacoes,
  retencoesDaCompetencia,
  salvarFaixaAlcadaSgh,
  tituloDoItem,
  tituloPagarDetalhe,
  tituloReceberDetalhe,
  titulosPagar,
  titulosReceber,
} from '@sgh/legado';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoFinanceiro,
  type GravadorSghFinanceiro,
  METODOS_PORTA_FINANCEIRO,
  type PortaFinanceiro,
} from './porta.js';

function gravador(e: Escritor, hospital: string): GravadorSghFinanceiro {
  return {
    salvarFaixa: (d) => salvarFaixaAlcadaSgh(e, { hospital, ...d }),
    aprovarTitulo: (d) => aprovarTituloSgh(e, { hospital, ...d }),
    registrarGlosaTitulo: (d) => registrarGlosaTituloSgh(e, { hospital, ...d }),
    importarExtrato: (d) => importarExtratoSgh(e, { hospital, ...d }),
    conciliar: (d) => confirmarConciliacaoSgh(e, { hospital, ...d }),
    atribuirCredito: (d) => atribuirCreditoSgh(e, { hospital, ...d }),
    registrarRemessa: (d) => registrarRemessaSgh(e, { hospital, ...d }),
    registrarNfse: (d) => registrarNfseSgh(e, { hospital, ...d }),
    registrarDeclaracao: (d) => registrarDeclaracaoSgh(e, { hospital, ...d }),
    registrarLoteContabil: (d) => registrarLoteContabilSgh(e, { hospital, ...d }),
  };
}

type Ler = <T>(c: ContextoFinanceiro, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaFinanceiro, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    hoje: (c) => ler(c, (l) => hojeFinanceiro(l)),
    contas: (c, u) => ler(c, (l) => contasDoEscopo(l, u)),
    classificacoes: (c) => ler(c, (l) => classificacoes(l)),
    retencoes: (c) => ler(c, (l) => contasDeRetencao(l)),
    formasPagamento: (c) => ler(c, (l) => formasPagamento(l)),
    titulosPagar: (c, f) => ler(c, (l) => titulosPagar(l, f)),
    tituloPagar: (c, id, hoje) => ler(c, (l) => tituloPagarDetalhe(l, c.hospital, id, hoje)),
    documentoCredor: (c, t) => ler(c, (l) => documentoDoCredor(l, t)),
    filaAprovacao: (c, hoje, ate) => ler(c, (l) => filaAprovacao(l, hoje, ate)),
    faixas: (c) => ler(c, (l) => lerFaixasAlcada(l, c.hospital)),
    aprovacoesDosTitulos: (c, ids) => ler(c, (l) => aprovacoesDosTitulos(l, c.hospital, ids)),
    borderos: (c, de, ate) => ler(c, (l) => borderos(l, de, ate)),
    adiantamentos: (c) => ler(c, (l) => adiantamentos(l)),
    titulosReceber: (c, f) => ler(c, (l) => titulosReceber(l, c.hospital, f)),
    tituloReceber: (c, id, hoje) => ler(c, (l) => tituloReceberDetalhe(l, c.hospital, id, hoje)),
    tituloDoItem: (c, item) => ler(c, (l) => tituloDoItem(l, item)),
    contasSemTitulo: (c, f) => ler(c, (l) => contasSemTituloLidas(l, f)),
    contaCorrenteConvenios: (c) => ler(c, (l) => contaCorrenteConvenios(l)),
    renegociacoes: (c) => ler(c, (l) => renegociacoes(l)),
    movimento: (c, conta, de, ate) => ler(c, (l) => movimentoDaConta(l, conta, de, ate)),
    linhasExtrato: (c, conta, s) => ler(c, (l) => linhasExtrato(l, c.hospital, conta, s)),
    creditosPendentes: (c, desde) => ler(c, (l) => creditosPendentes(l, c.hospital, desde)),
    lancamentosFluxo: (c, de, ate) => ler(c, (l) => lancamentosFluxo(l, de, ate)),
    historicosConvenio: (c, desde) => ler(c, (l) => historicosConvenio(l, desde)),
    basesDre: (c, de, ate) => ler(c, (l) => basesDre(l, c.hospital, de, ate)),
    apropriacoes: (c, f) => ler(c, (l) => apropriacoesGerenciais(l, c.hospital, f)),
    basesIndicadores: (c, de, ate) => ler(c, (l) => basesIndicadores(l, c.hospital, de, ate)),
    escrituracao: (c, a, m) => ler(c, (l) => escrituracaoEntradas(l, a, m)),
    deParaContabil: (c) => ler(c, (l) => deParaContabil(l)),
    retencoesDaCompetencia: (c, a, m) => ler(c, (l) => retencoesDaCompetencia(l, a, m)),
    registrosFiscais: (c, t) => ler(c, (l) => registrosFiscais(l, c.hospital, t)),
  };
}

export function portaFinanceiroLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaFinanceiro {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoFinanceiro) => ({ rede: c.rede, hospital: c.hospital, traceId: 'financeiro' });
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx);
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    gravarSgh: (c, trilha, fn) =>
      nucleo.gravarSgh(ctx(c), async (e) => {
        const r = await fn(gravador(e, c.hospital));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      }),
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

export function portaFinanceiroNaTransacao(e: Escritor, executor: Executor): PortaFinanceiro {
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx, { escritor: e });
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    async gravarSgh(c, trilha, fn) {
      const r = await fn(gravador(e, c.hospital));
      await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaFinanceiroIndisponivel(): PortaFinanceiro {
  return portaIndisponivel<PortaFinanceiro>(METODOS_PORTA_FINANCEIRO);
}
