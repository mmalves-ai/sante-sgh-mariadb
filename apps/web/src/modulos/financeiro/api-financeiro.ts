// Cliente das telas do financeiro e fiscal (M32): contas a pagar (lançamento, aprovação na alçada, borderô e
// pagamento, remessa ao simulador, adiantamentos), contas a receber (título da conta e da competência, baixa manual,
// glosa no título, conta corrente de convênios, renegociação), tesouraria (movimento, extrato, conciliação, créditos
// não identificados, fluxo de caixa), gerencial (DRE em duas réguas, indicadores), parâmetros (alçadas) e fiscal
// (escrituração, NFS-e, DMED, EFD-REINF e lote contábil). As gravações vão com o CSRF e a Idempotency-Key (uma por
// intenção de gravar); Problem Details viram ErroApi e a recusa de negócio traz o texto em português do servidor.
import type {
  AdiantamentoResposta,
  ApoioFinanceiro,
  BorderoResposta,
  ConciliacaoResposta,
  ContaSemTituloResposta,
  CreditoPendenteResposta,
  DetalheTituloPagarResposta,
  DetalheTituloReceberResposta,
  DreResposta,
  EscrituracaoResposta,
  FaixaAlcadaResposta,
  FluxoCaixaResposta,
  GravacaoFinanceiro,
  IndicadorResposta,
  ItemFilaAprovacao,
  ListaApropriacoes,
  ListaTitulosPagar,
  ListaTitulosReceber,
  MovimentoResposta,
  RegistroFiscalResposta,
  ResultadoFinanceiro,
  WorklistFinanceiro,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const F = '/api/financeiro';
/** As respostas são conferidas pelo servidor (contratos); aqui só a forma de objeto. */
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const lista = <X>() => z.array(confiar<X>());

let sequencia = 0;
export function novaChave(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m32.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

const gravar = <X = ResultadoFinanceiro>(url: string, corpo: unknown, chave: string): Promise<X> =>
  enviar(url, corpo, confiar<X>(), chave);
type Filtro = Record<string, string | number | null | undefined | boolean>;

// ── Situação, apoio, fila e indicadores ─────────────────────────────────────────────────────────────────────────
export const lerGravacao = () => ler(`${F}/gravacao`, confiar<GravacaoFinanceiro>());
export const lerApoio = () => ler(`${F}/apoio`, confiar<ApoioFinanceiro>());
export const lerWorklist = () => ler(`${F}/worklist`, confiar<WorklistFinanceiro>());
export const lerIndicadores = (f: Filtro) => ler(`${F}/indicadores${qs(f)}`, lista<IndicadorResposta>());

// ── Contas a pagar ──────────────────────────────────────────────────────────────────────────────────────────────
export const listarTitulosPagar = (f: Filtro) =>
  ler(`${F}/pagar/titulos${qs(f)}`, confiar<ListaTitulosPagar>());
export const lerTituloPagar = (id: number) =>
  ler(`${F}/pagar/titulos/${id}`, confiar<DetalheTituloPagarResposta>());

export interface NovoTituloPagar {
  tipo: string;
  credor: number;
  profissional: number | null;
  documento: number;
  serie: string;
  emissao: string;
  valorDocumento: number;
  referente: string;
  observacao: string;
  parcelas: { parcela: number; vencimento: string; valor: number }[];
  classificacao: { grupo: number; subgrupo: number; item: number };
  retencoes: { codigo: number; valor: number }[];
  centroCusto: number | null;
  /** M55 (etapa 3): o contrato com o fornecedor que o título consome. */
  contrato?: { contrato: number; excecao: number | null; pedidoDeOrigem: number | null };
}
export const criarTituloPagar = (corpo: NovoTituloPagar, chave: string) =>
  gravar(`${F}/pagar/titulos`, corpo, chave);
export const excluirTituloPagar = (id: number, versao: string | null, chave: string) =>
  gravar(`${F}/pagar/titulos/${id}/excluir`, { versao }, chave);
export const lerFilaAprovacao = (dias: number) =>
  ler(`${F}/pagar/aprovacao${qs({ dias })}`, lista<ItemFilaAprovacao>());
export const aprovarTitulo = (id: number, observacao: string, chave: string) =>
  gravar(`${F}/pagar/titulos/${id}/aprovar`, { observacao }, chave);
export const lerAlcadas = () => ler(`${F}/alcadas`, lista<FaixaAlcadaResposta>());
export const salvarAlcada = (corpo: Omit<FaixaAlcadaResposta, 'id'> & { id: number | null }, chave: string) =>
  gravar(`${F}/alcadas`, corpo, chave);
export const listarBorderos = (f: Filtro) => ler(`${F}/pagar/borderos${qs(f)}`, lista<BorderoResposta>());
export const pagarTitulos = (
  corpo: {
    titulos: { titulo: number; versao: string | null }[];
    conta: number;
    dataPagamento: string;
    formaPagamento: number;
    porBordero: boolean;
  },
  chave: string,
) => gravar(`${F}/pagar/baixa`, corpo, chave);
export const listarRemessas = () => ler(`${F}/pagar/remessas`, lista<RegistroFiscalResposta>());
export const gerarRemessa = (
  corpo: { conta: number; titulos: number[]; leiaute: 'cnab240' | 'api' },
  chave: string,
) => gravar(`${F}/pagar/remessas`, corpo, chave);
export const listarAdiantamentos = () => ler(`${F}/pagar/adiantamentos`, lista<AdiantamentoResposta>());
/** O documento do credor por inteiro: leitura auditada, com a finalidade escrita por quem pede. */
export const mostrarDocumento = (titulo: number, finalidade: string, chave: string) =>
  gravar<{ valor: string }>(`${F}/dados/mostrar`, { tipo: 'documento-credor', titulo, finalidade }, chave);

// ── Contas a receber ────────────────────────────────────────────────────────────────────────────────────────────
export const listarTitulosReceber = (f: Filtro) =>
  ler(`${F}/receber/titulos${qs(f)}`, confiar<ListaTitulosReceber>());
export const lerTituloReceber = (id: number) =>
  ler(`${F}/receber/titulos/${id}`, confiar<DetalheTituloReceberResposta>());
export const contasSemTitulo = (f: Filtro) =>
  ler(`${F}/receber/contas-sem-titulo${qs(f)}`, lista<ContaSemTituloResposta>());
export const criarTituloReceber = (
  corpo: {
    contas: { conta: number; versao: string | null }[];
    vencimento: string;
    documento: number;
    referente: string;
  },
  chave: string,
) => gravar(`${F}/receber/titulos`, corpo, chave);
export const titulosDaCompetencia = (
  corpo: { convenio: number; ano: number; mes: number; vencimento: string; documento: number },
  chave: string,
) => gravar(`${F}/receber/competencia`, corpo, chave);
export const baixaManual = (
  id: number,
  corpo: {
    versao: string | null;
    conta: number;
    dataRecebimento: string;
    valorRecebido: number;
    formaPagamento: number;
    motivo: string;
  },
  chave: string,
) => gravar(`${F}/receber/titulos/${id}/baixa`, corpo, chave);
export const registrarGlosa = (
  id: number,
  corpo: {
    item: number | null;
    situacao: 'aceita' | 'recurso-deferido' | 'recurso-indeferido';
    valor: number;
    motivo: string;
  },
  chave: string,
) => gravar(`${F}/receber/titulos/${id}/glosa`, corpo, chave);

export interface CreditoConvenio {
  id: number;
  data: string | null;
  documento: number;
  valor: number;
  devedor: string;
  codigo: number;
  historico: string;
  conta: number | null;
}
export const contaCorrenteConvenios = () => ler(`${F}/receber/convenios`, lista<CreditoConvenio>());
export const listarRenegociacoes = () =>
  ler(
    `${F}/receber/renegociacoes`,
    lista<{ id: number; em: string; responsavel: string; titulos: number }>(),
  );

// ── Tesouraria ──────────────────────────────────────────────────────────────────────────────────────────────────
export const lerMovimento = (f: Filtro) =>
  ler(`${F}/tesouraria/movimento${qs(f)}`, lista<MovimentoResposta>());
export const lancarMovimento = (
  corpo: {
    tipo: string;
    data: string;
    contaCredito: number | null;
    contaDebito: number | null;
    valor: number;
    historico: string;
    classificacao: { grupo: number; subgrupo: number; item: number };
  },
  chave: string,
) => gravar(`${F}/tesouraria/movimento`, corpo, chave);
export const lerConciliacao = (conta: number) =>
  ler(`${F}/tesouraria/conciliacao${qs({ conta })}`, confiar<ConciliacaoResposta>());
export const importarExtrato = (
  corpo: { conta: number; origem: 'ofx' | 'csv'; conteudo: string },
  chave: string,
) => gravar(`${F}/tesouraria/extratos`, corpo, chave);
export type AlvoConciliacao =
  { tipo: 'movimento' | 'titulo-pagar' | 'titulo-receber'; id: number } | { tipo: 'credito-pendente' };
export const conciliar = (
  corpo: {
    linha: number;
    alvo: AlvoConciliacao;
    regra: 'valor-data' | 'valor-janela' | 'documento' | 'manual';
  },
  chave: string,
) => gravar(`${F}/tesouraria/conciliacao`, corpo, chave);
export const listarCreditos = () => ler(`${F}/tesouraria/creditos`, lista<CreditoPendenteResposta>());
export const atribuirCredito = (
  id: number,
  corpo: { tituloReceber: number; observacao: string },
  chave: string,
) => gravar(`${F}/tesouraria/creditos/${id}/atribuir`, corpo, chave);
export const lerFluxoCaixa = (f: Filtro) =>
  ler(`${F}/tesouraria/fluxo-caixa${qs(f)}`, confiar<FluxoCaixaResposta>());

// ── Gerencial ───────────────────────────────────────────────────────────────────────────────────────────────────
export const lerDre = (f: Filtro) => ler(`${F}/gerencial/dre${qs(f)}`, confiar<DreResposta>());
export const listarApropriacoes = (f: Filtro) =>
  ler(`${F}/gerencial/apropriacoes${qs(f)}`, confiar<ListaApropriacoes>());

// ── Fiscal e contábil ───────────────────────────────────────────────────────────────────────────────────────────
export const lerEntradas = (f: Filtro) => ler(`${F}/fiscal/entradas${qs(f)}`, lista<EscrituracaoResposta>());
export const listarNfse = () => ler(`${F}/fiscal/nfse`, lista<RegistroFiscalResposta>());
export const emitirNfse = (
  corpo: {
    tituloReceber: number | null;
    conta: number | null;
    momento: 'apresentacao' | 'recebimento';
    classificacao: string;
    itemServico: string;
    valorServicos: number;
    aliquotaIss: number;
    issRetido: boolean;
  },
  chave: string,
) => gravar(`${F}/fiscal/nfse`, corpo, chave);
export const listarDeclaracoes = (tipo: 'dmed' | 'reinf') =>
  ler(`${F}/fiscal/declaracoes${tipo === 'dmed' ? '/dmed' : ''}`, lista<RegistroFiscalResposta>());
export const gerarDeclaracao = (
  corpo: { tipo: 'dmed' | 'reinf-r2000' | 'reinf-r4000'; periodo: string },
  chave: string,
) => gravar(`${F}/fiscal/declaracoes/${corpo.tipo === 'dmed' ? 'dmed' : 'reinf'}`, corpo, chave);
export const listarLotes = () => ler(`${F}/contabil/lotes`, lista<RegistroFiscalResposta>());
export interface DeParaContabil {
  convenio: number;
  tipoConta: string;
  tipoLancamento: number;
  grupo: number;
  subgrupo: number;
  item: number;
  conta: number | null;
}
export const lerDePara = () => ler(`${F}/contabil/de-para`, lista<DeParaContabil>());
export const exportarLote = (corpo: { periodo: string; regua: 'competencia' | 'caixa' }, chave: string) =>
  gravar(`${F}/contabil/lotes`, corpo, chave);
