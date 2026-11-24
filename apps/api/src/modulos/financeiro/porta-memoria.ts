// Porta do financeiro em MEMÓRIA (M32): a sessão sintética de dev/ci (E2E). Credores, títulos, contas bancárias,
// contas do faturamento, itens glosados e movimentos SINTÉTICOS (nenhum dado real; nada vai à cópia), com as mesmas
// validações (Zod dos contratos) e as mesmas regras do domínio que o porta do banco confere (credor, parcelas,
// chave natural, exclusão em aberto, alçada e segregação, baixa manual, conta que gera título, movimento por tipo e
// escopo por conta). Semeadura: os fornecedores 5001 e 5002, o médico 7001 (profissional 70), as contas bancárias 1 e
// 2, a faixa de alçada geral (até R$ 10.000,00, uma aprovação) e a da diretoria (acima, duas aprovações), o título de
// convênio 9001 (convênio 91, com 3 itens baixados e 1 glosado) e as contas 9301 e 9302 da competência fechada do
// convênio 92, sem título (o evento da competência).
import type {
  AdiantamentoResposta,
  ContaBancariaResposta,
  ContaSemTituloResposta,
  CreditoPendenteResposta,
  EscrituracaoResposta,
  LinhaExtratoResposta,
  ListaApropriacoes,
  RegistroFiscalResposta,
  TituloPagarResposta,
  TituloReceberResposta,
} from '@sgh/contratos';
import {
  alcadaAplicavel,
  aposUso,
  type AprovacaoRegistrada,
  calcularRateio,
  centavos,
  conferirAprovacao,
  conferirBaixaManual,
  conferirCompensacao,
  conferirConcessao,
  conferirDevolucao,
  conferirContaParaTitulo,
  conferirCredor,
  conferirExclusao,
  conferirFaixas,
  conferirMovimento,
  conferirPagamento,
  conferirPedidoEmAberto,
  conferirSaida,
  tipoAlcadaDoAdiantamento,
  conferirParcelas,
  conferirSegregacao,
  devedorDaConta,
  type FaixaAlcada,
  mesmaPessoa,
  regrasDoCredor,
  serieGravada,
  situacaoAprovacao,
  conferirAlcadaProrrogacao,
  conferirProrrogacao,
  situacaoTituloPagar,
  type TipoCredor,
  tpPgtoVisto,
} from '@sgh/dominio-financeiro';
import type { EstadoOperacao } from '@sgh/contratos';
import { type ContextoOperacao, ErroOperacao, recusa } from '@sgh/nucleo';
import type { LiberacaoGravacao } from '../exames/public-api.js';
import { ESQUEMAS_OPERACAO_FINANCEIRO } from './esquemas.js';
import type {
  BasesDrePorta,
  BasesIndicadoresPorta,
  ContextoFinanceiro,
  DeParaContabilPorta,
  FiltroPagar,
  FiltroReceber,
  GravadorSghFinanceiro,
  MotivoProrrogacaoPorta,
  ProrrogacaoPorta,
  LancamentoFluxoPorta,
  PortaFinanceiro,
  RetencaoReinfPorta,
} from './porta.js';

const SENTINELA = '1899-12-30';

interface TituloPagarM {
  id: number;
  credor: number;
  documento: number;
  parcela: number;
  tipo: TipoCredor;
  serie: string;
  emissao: string;
  vencimento: string;
  valor: number;
  valorDocumento: number;
  pago: number;
  dataPagamento: string | null;
  bordero: number;
  status: number;
  conta: number | null;
  formaPagamento: number;
  lancadoPor: string;
  referente: string;
  classificacao: { grupo: number; subgrupo: number; item: number } | null;
  retencoes: { codigo: number; valor: number; tipo: number }[];
  profissional: number | null;
  versao: number;
  origem: string;
}

interface TituloReceberM {
  id: number;
  devedor: string;
  codigo: number;
  convenio: number;
  documento: number;
  apresentacao: string;
  vencimento: string;
  valor: number;
  recebido: number;
  dataRecebimento: string | null;
  origem: string;
  origemBaixa: string;
  /** A conta que recebeu (na baixa). */
  conta?: number;
  nome: string;
  versao: number;
}

interface ContaFatM {
  id: number;
  convenio: number;
  tipo: 'E' | 'I';
  competencia: string;
  fechada: string;
  total: number;
  apresentacao: string;
  titulo: number | null;
  particular: boolean;
  versao: number;
  itens: { id: number; valorCobrado: number; valorPago: number; glosado: string }[];
}

interface MovimentoM {
  id: number;
  data: string;
  documento: number;
  tipo: string;
  valor: number;
  historico: string;
  contaCredito: number | null;
  contaDebito: number | null;
  classificacao: string;
  usuario: string;
}

interface Estado {
  hoje: string;
  seq: number;
  titulos: Map<number, TituloPagarM>;
  receber: Map<number, TituloReceberM>;
  contasFat: Map<number, ContaFatM>;
  movimentos: MovimentoM[];
  faixas: FaixaAlcada[];
  aprovacoes: { titulo: number; aprovador: string; faixa: number; ordem: 1 | 2; em: string }[];
  borderos: {
    id: number;
    numero: number;
    data: string;
    valor: number;
    conta: number;
    usuario: string;
    titulos: number;
  }[];
  glosas: {
    id: number;
    titulo: number;
    item: number | null;
    situacao: string;
    valor: number;
    motivo: string;
    em: string;
    chave: string | null;
  }[];
  extratos: { id: number; conta: number; hash: string; linhas: number }[];
  linhas: ({ -readonly [K in keyof LinhaExtratoResposta]: LinhaExtratoResposta[K] } & { conta: number })[];
  conciliacoes: {
    id: number;
    linha: number;
    tipo: string;
    alvo: number | null;
    regra: string;
    por: string;
  }[];
  creditos: CreditoPendenteResposta[];
  /** O adiantamento com quem pediu e quem aprovou (a segregação dos dois olhos antes da saída). */
  adiantamentos: (AdiantamentoResposta & { pedidoPor: string; aprovadores: AprovacaoRegistrada[] })[];
  rateios: { documento: number; credor: number; centroCusto: number; percentual: number; valor: number }[];
  fiscais: Record<'nfse' | 'declaracao' | 'lote' | 'remessa', RegistroFiscalResposta[]>;
  pagosPeloNovo: Set<number>;
  idem: Map<string, { hash: string; resultado: Record<string, number | string> }>;
}

const FORNECEDORES: Readonly<Record<number, string>> = {
  5001: 'FORNECEDOR SINTETICO A',
  5002: 'FORNECEDOR SINTETICO B',
};
const MEDICOS: Readonly<Record<number, { profissional: number; nome: string }>> = {
  7001: { profissional: 70, nome: 'MEDICO SINTETICO' },
};
const CONTAS: readonly Omit<ContaBancariaResposta, 'saldo'>[] = [
  {
    id: 1,
    banco: 104,
    agencia: 6174,
    codigo: 1001,
    descricao: 'SINTETICO MOVIMENTO',
    situacao: 'A',
    saldoFechadoEm: '2026-09-30',
    saldoApuradoOutroSistema: 50_000,
  },
  {
    id: 2,
    banco: 200,
    agencia: 1,
    codigo: 2002,
    descricao: 'SINTETICO APLICACAO',
    situacao: 'A',
    saldoFechadoEm: '2026-09-30',
    saldoApuradoOutroSistema: 120_000,
  },
];
const SALDO_FECHADO: Readonly<Record<number, number>> = { 1: 50_000, 2: 120_000 };
/**
 * O escopo por conta (permissão por conta bancária) dos usuários sintéticos restritos (regra 15): só a conta 1. Quem não está aqui vê as
 * duas contas (como o parâmetro REST_CTA_USU desligado).
 */
const ESCOPO_SINTETICO: Readonly<Record<string, readonly number[]>> = {
  'SINT.FIN.TESFIS': [1],
  // M42: quem acompanha a competência com o escopo de uma conta só (o movimento da conta 2 não aparece).
  'SINT.COMPETENCIA.CONTA1': [1],
};
const contasDoUsuario = (usuario: string | null) => {
  const lista = usuario ? ESCOPO_SINTETICO[usuario.toUpperCase()] : undefined;
  return lista ? CONTAS.filter((x) => lista.includes(x.id)) : CONTAS;
};
/** M42: as contas bancárias (IDs) do escopo do usuário sintético; null = todas (sem restrição). */
export function contasBancariasSinteticasDoEscopo(usuario: string | null): number[] | null {
  const lista = usuario ? ESCOPO_SINTETICO[usuario.toUpperCase()] : undefined;
  return lista ? [...lista] : null;
}
const foraDoEscopo = () =>
  new ErroOperacao(
    403,
    'fora-do-escopo',
    'Fora do escopo',
    'A conta bancária não está no seu escopo de contas.',
  );
const CLASSIFICACOES = [
  { grupo: 216, subgrupo: 2, item: 1, nome: 'SINTETICO MATERIAL DE CONSUMO' },
  { grupo: 210, subgrupo: 1, item: 1, nome: 'SINTETICO SERVICOS DE TERCEIROS' },
  { grupo: 100, subgrupo: 1, item: 1, nome: 'SINTETICO RECEITA DE CONVENIOS' },
  { grupo: 190, subgrupo: 2, item: 1, nome: 'SINTETICO TARIFAS BANCARIAS' },
];
const RETENCOES = [
  { codigo: 301, descricao: 'IRRF SINTETICO', tipo: 6 },
  { codigo: 302, descricao: 'INSS SINTETICO', tipo: 2 },
  { codigo: 303, descricao: 'CSRF SINTETICO', tipo: 4 },
];
const FORMAS = [
  { codigo: 0, nome: 'Borderô' },
  { codigo: 1, nome: 'Transferência' },
  { codigo: 11, nome: 'Boleto' },
];

const p2 = (n: number) => String(n).padStart(2, '0');
const somarDias = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const versao = (n: number) => `m-${String(n).padStart(10, '0')}`;
const conflito = () =>
  new ErroOperacao(409, 'conflito-versao', 'Registro alterado', 'O título mudou desde a leitura; releia.');

/** Estado de cada operação no catálogo de operações do estabelecimento (null = operação desconhecida). */
export interface CatalogoOperacoesFinanceiro {
  estado(operacao: string, estabelecimento: string): EstadoOperacao | null;
}

/** Estabelecimento da sessão como chave do estado em memória. */
const chaveDe = (c: ContextoFinanceiro) => String(c.estabelecimento ?? 0);
/** Login de quem grava (o contexto da gravação da API leva o login; sem ele, um rótulo pelo id). */
const loginDoContexto = (ctx: ContextoOperacao): string =>
  (ctx as ContextoOperacao & { login?: string }).login ?? `USUARIO.${ctx.usuario ?? 0}`;

export class PortaFinanceiroMemoria implements PortaFinanceiro {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();

  constructor(private readonly catalogo: CatalogoOperacoesFinanceiro | null) {}

  private e(c: ContextoFinanceiro): Estado {
    let s = this.estados.get(chaveDe(c));
    if (!s) {
      s = this.semear();
      this.estados.set(chaveDe(c), s);
    }
    return s;
  }

  private semear(): Estado {
    const d = new Date();
    const hoje = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
    const s: Estado = {
      hoje,
      seq: 100,
      titulos: new Map(),
      receber: new Map(),
      contasFat: new Map(),
      movimentos: [],
      faixas: [
        {
          id: 1,
          empresa: 1,
          centroCusto: null,
          tipoCredor: null,
          valorDe: 0,
          valorAte: 10_000,
          aprovacoes: 1,
          permissao: 'financeiro.tituloPagar.aprovar',
          vigenciaInicio: '2026-01-01',
          vigenciaFim: null,
          ativa: true,
        },
        {
          id: 2,
          empresa: 1,
          centroCusto: null,
          tipoCredor: null,
          valorDe: 10_000.01,
          valorAte: null,
          aprovacoes: 2,
          permissao: 'financeiro.tituloPagar.aprovarDiretoria',
          vigenciaInicio: '2026-01-01',
          vigenciaFim: null,
          ativa: true,
        },
      ],
      aprovacoes: [],
      borderos: [],
      glosas: [],
      extratos: [],
      linhas: [],
      conciliacoes: [],
      creditos: [],
      adiantamentos: [
        {
          id: 1,
          credor: 5001,
          tipoCredor: 'fornecedor',
          numero: 'AD-1',
          documento: 1,
          emissao: '2026-01-10',
          prazo: null,
          referente: 'Compra emergencial',
          situacao: 'compensado_parcial',
          valor: 1_000,
          compensado: 400,
          saldo: 600,
          conta: null,
          aprovacoes: 1,
          exigidas: 1,
          pedidoPor: 'SINT.FIN.LANCA',
          aprovadores: [],
        },
      ],
      rateios: [],
      fiscais: { nfse: [], declaracao: [], lote: [], remessa: [] },
      pagosPeloNovo: new Set(),
      idem: new Map(),
    };
    // Um título pago no outro sistema (sem aprovação: o indicador dos dois sistemas) e um em aberto lançado lá.
    s.titulos.set(11, {
      id: 11,
      credor: 5001,
      documento: 4001,
      parcela: 1,
      tipo: 'F',
      serie: 'F',
      emissao: somarDias(hoje, -40),
      vencimento: somarDias(hoje, -10),
      valor: 800,
      valorDocumento: 800,
      pago: 800,
      dataPagamento: somarDias(hoje, -10),
      bordero: 0,
      status: 1,
      conta: 1,
      formaPagamento: 1,
      lancadoPor: 'OUTRO.SISTEMA',
      referente: 'SINTETICO PAGO NO OUTRO SISTEMA',
      classificacao: { grupo: 216, subgrupo: 2, item: 1 },
      retencoes: [],
      profissional: null,
      versao: 1,
      origem: 'F',
    });
    s.titulos.set(12, {
      id: 12,
      credor: 5002,
      documento: 4002,
      parcela: 1,
      tipo: 'F',
      serie: 'F',
      emissao: somarDias(hoje, -5),
      vencimento: somarDias(hoje, 3),
      valor: 1_500,
      valorDocumento: 1_500,
      pago: 0,
      dataPagamento: null,
      bordero: 0,
      status: 0,
      conta: null,
      formaPagamento: 0,
      lancadoPor: 'OUTRO.SISTEMA',
      referente: 'SINTETICO EM ABERTO',
      classificacao: { grupo: 210, subgrupo: 1, item: 1 },
      retencoes: [],
      profissional: null,
      versao: 1,
      origem: 'F',
    });
    // O título de convênio 9001 com as contas 9101 e 9102 (os itens baixados: GLOSADO 'T').
    s.receber.set(9001, {
      id: 9001,
      devedor: 'C',
      codigo: 91,
      convenio: 91,
      documento: 70001,
      apresentacao: somarDias(hoje, -30),
      vencimento: somarDias(hoje, 15),
      valor: 3_000,
      recebido: 0,
      dataRecebimento: null,
      origem: 'V',
      origemBaixa: 'M',
      nome: 'CONVENIO SINTETICO 91',
      versao: 1,
    });
    s.contasFat.set(9101, {
      id: 9101,
      convenio: 91,
      tipo: 'E',
      competencia: hoje.slice(0, 7),
      fechada: 'A',
      total: 1_000,
      apresentacao: somarDias(hoje, -30),
      titulo: 9001,
      particular: false,
      versao: 1,
      itens: [
        { id: 91011, valorCobrado: 600, valorPago: 600, glosado: 'T' },
        { id: 91012, valorCobrado: 400, valorPago: 250, glosado: 'T' },
      ],
    });
    s.contasFat.set(9102, {
      id: 9102,
      convenio: 91,
      tipo: 'E',
      competencia: hoje.slice(0, 7),
      fechada: 'A',
      total: 2_000,
      apresentacao: somarDias(hoje, -30),
      titulo: 9001,
      particular: false,
      versao: 1,
      itens: [
        { id: 91021, valorCobrado: 1_200, valorPago: 1_200, glosado: 'T' },
        { id: 91022, valorCobrado: 800, valorPago: 0, glosado: 'F' },
      ],
    });
    // As contas da competência fechada do convênio 92, sem título (o evento da competência gera).
    for (const [id, total] of [
      [9301, 700],
      [9302, 300],
    ] as const)
      s.contasFat.set(id, {
        id,
        convenio: 92,
        tipo: 'E',
        competencia: hoje.slice(0, 7),
        fechada: 'A',
        total,
        apresentacao: hoje,
        titulo: null,
        particular: false,
        versao: 1,
        itens: [{ id: id * 10 + 1, valorCobrado: total, valorPago: total - 50, glosado: 'T' }],
      });
    s.movimentos.push({
      id: 501,
      data: somarDias(hoje, -2),
      documento: 1,
      tipo: 'O',
      valor: 35.9,
      historico: 'SINTETICO TARIFA',
      contaCredito: null,
      contaDebito: 1,
      classificacao: '190.2.1',
      usuario: 'OUTRO.SISTEMA',
    });
    return s;
  }

  private estadoOp(op: string, hospital: string) {
    return this.catalogo?.estado(op, hospital) ?? 'verde';
  }

  /**
   * M33: o título que nasce do RPA do repasse (origem R) na sessão sintética: o repasse em memória o pede aqui, como a
   * receita repasse.emitirRpa pede ao financeiro na mesma transação no banco. Devolve o ID do título.
   */
  incluirTituloRepasse(
    c: ContextoFinanceiro,
    t: {
      credor: number;
      documento: number;
      tipo: 'M' | 'E';
      emissao: string;
      vencimento: string;
      valor: number;
      profissional: number | null;
      usuario: string;
    },
  ): number {
    const s = this.e(c);
    const id = ++s.seq;
    s.titulos.set(id, {
      id,
      credor: t.credor,
      documento: t.documento,
      parcela: 1,
      tipo: t.tipo,
      serie: 'RPA',
      emissao: t.emissao,
      vencimento: t.vencimento,
      valor: t.valor,
      valorDocumento: t.valor,
      pago: 0,
      dataPagamento: null,
      bordero: 0,
      status: 0,
      conta: null,
      formaPagamento: 0,
      lancadoPor: t.usuario,
      referente: `RPA ${t.documento}`,
      classificacao: { grupo: 216, subgrupo: 2, item: 1 },
      retencoes: [],
      profissional: t.profissional,
      versao: 1,
      origem: 'R',
    });
    return id;
  }

  async podeGravar(c: ContextoFinanceiro, op: string): Promise<LiberacaoGravacao> {
    const e = this.estadoOp(op, chaveDe(c));
    if (e === null || e === 'bloqueada')
      return {
        pode: false,
        codigo: 'operacao-bloqueada',
        motivo: 'A gravação está bloqueada neste estabelecimento.',
      };
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(c: ContextoFinanceiro, op: string, entradaBruta: unknown, ctx: ContextoOperacao) {
    const esquema = ESQUEMAS_OPERACAO_FINANCEIRO[op];
    if (!esquema) throw recusa('operacao-desconhecida', 'Operação desconhecida no financeiro.');
    const analise = esquema.safeParse(entradaBruta);
    if (!analise.success)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(analise.error.issues.map((i) => i.path.join('.') || '(entrada)'))],
      });
    const s = this.e(c);
    const chave = `${op}:${ctx.chaveIdempotencia}`;
    const hash = JSON.stringify(analise.data);
    const anterior = s.idem.get(chave);
    if (anterior) {
      if (anterior.hash !== hash)
        throw new ErroOperacao(
          422,
          'idempotencia-divergente',
          'Pedido repetido diferente',
          'A mesma chave veio com outro conteúdo.',
        );
      return { resultado: anterior.resultado, repetida: true, trilha: null };
    }
    const resultado = this.aplicar(s, op, analise.data as never, loginDoContexto(ctx));
    s.idem.set(chave, { hash, resultado });
    return { resultado, repetida: false, trilha: null };
  }

  private recusar(r: { codigo: string; mensagem: string; campos?: readonly string[] } | null): void {
    if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
  }

  private aplicar(s: Estado, op: string, e: never, usuario: string): Record<string, number | string> {
    switch (op) {
      case 'financeiro.criarTituloPagar':
        return this.criarTituloPagar(s, e, usuario);
      case 'financeiro.baixarTitulo':
        return this.baixar(s, e, usuario);
      case 'financeiro.criarTituloReceber':
        return this.criarTituloReceber(s, e, usuario);
      case 'financeiro.lancarMovimento':
        return this.lancarMovimento(s, e, usuario);
      default:
        throw recusa('operacao-desconhecida', `A operação ${op} não existe no financeiro.`);
    }
  }

  private criarTituloPagar(
    s: Estado,
    e: import('@sgh/contratos').CriarTituloPagarEntrada,
    usuario: string,
  ): Record<string, number | string> {
    // M53.9: os títulos da folha são lançados pela integração da folha (a porta dela em memória), não por esta tela.
    if (e.acao === 'incluir-folha')
      throw recusa('operacao-desconhecida', 'Os títulos da folha são lançados pela integração da folha.');
    if (e.acao === 'excluir') {
      const t = s.titulos.get(e.titulo);
      if (!t) throw recusa('titulo-inexistente', 'O título não existe (talvez já excluído).');
      if (e.versao && e.versao !== versao(t.versao)) throw conflito();
      this.recusar(conferirExclusao({ pago: t.pago, dataPagamento: t.dataPagamento, bordero: t.bordero }));
      s.titulos.delete(t.id);
      return {
        titulo: t.id,
        parcelas: 1,
        documento: t.documento,
        credor: t.credor,
        tipo: t.tipo,
        serie: t.serie,
        acao: 'excluir',
        ids: String(t.id),
      };
    }
    const medico = MEDICOS[e.credor];
    this.recusar(
      conferirCredor({
        tipo: e.tipo,
        credorExiste: e.tipo === 'M' ? !!medico : !!FORNECEDORES[e.credor],
        profissional: e.profissional,
        profissionalExiste: e.tipo === 'M' ? medico?.profissional === e.profissional : true,
        comRetencao: e.retencoes.length > 0,
      }),
    );
    this.recusar(conferirParcelas(e.parcelas, e.valorDocumento, e.emissao));
    if (
      !CLASSIFICACOES.some(
        (x) =>
          x.grupo === e.classificacao.grupo &&
          x.subgrupo === e.classificacao.subgrupo &&
          x.item === e.classificacao.item,
      )
    )
      throw recusa('classificacao-inexistente', 'A classificação gerencial não existe no cadastro.', {
        campos: ['classificacao'],
      });
    const serie = serieGravada(e.serie);
    if (
      [...s.titulos.values()].some(
        (t) => t.credor === e.credor && t.documento === e.documento && t.tipo === e.tipo && t.serie === serie,
      )
    )
      throw recusa(
        'duplicado',
        'Já existe título com este credor, documento, parcela, tipo e série: abra o título existente.',
        {
          campos: ['documento'],
        },
      );
    const ret = e.retencoes.map((r) => {
      const x = RETENCOES.find((y) => y.codigo === r.codigo);
      if (!x)
        throw recusa('retencao-inexistente', 'A conta de retenção não existe no cadastro.', {
          campos: ['retencoes'],
        });
      return { codigo: r.codigo, valor: r.valor, tipo: x.tipo };
    });
    if (e.rateio.length) {
      const r = calcularRateio(e.rateio, e.valorDocumento);
      if (!r.ok) this.recusar(r.recusa);
      else for (const l of r.rateio) s.rateios.push({ documento: e.documento, credor: e.credor, ...l });
    }
    const ids: number[] = [];
    for (const p of e.parcelas) {
      const id = ++s.seq;
      ids.push(id);
      s.titulos.set(id, {
        id,
        credor: e.credor,
        documento: e.documento,
        parcela: p.parcela,
        tipo: e.tipo,
        serie,
        emissao: e.emissao,
        vencimento: p.vencimento,
        valor: p.valor,
        valorDocumento: e.valorDocumento,
        pago: 0,
        dataPagamento: null,
        bordero: 0,
        status: 0,
        conta: null,
        formaPagamento: 0,
        lancadoPor: usuario,
        referente: e.referente,
        classificacao: p.parcela === 1 ? e.classificacao : null,
        retencoes: p.parcela === 1 ? ret : [],
        profissional: e.tipo === 'M' ? e.profissional : null,
        versao: 1,
        origem: 'F',
      });
    }
    void regrasDoCredor;
    return {
      titulo: ids[0] ?? 0,
      parcelas: ids.length,
      documento: e.documento,
      credor: e.credor,
      tipo: e.tipo,
      serie,
      acao: 'incluir',
      ids: ids.join(','),
    };
  }

  private faixaDo(s: Estado, t: TituloPagarM): FaixaAlcada | null {
    const centro = s.rateios
      .filter((r) => r.documento === t.documento && r.credor === t.credor)
      .sort((a, b) => b.percentual - a.percentual)[0];
    return alcadaAplicavel(
      s.faixas,
      { empresa: 1, centroCusto: centro?.centroCusto ?? null, tipo: t.tipo, valor: t.valorDocumento },
      s.hoje,
    );
  }

  private faixaDoAdiantamento(
    s: Estado,
    tipo: 'fornecedor' | 'profissional',
    valor: number,
  ): FaixaAlcada | null {
    return alcadaAplicavel(
      s.faixas,
      { empresa: 1, centroCusto: null, tipo: tipoAlcadaDoAdiantamento(tipo), valor },
      s.hoje,
    );
  }

  private aprovacoesDo(s: Estado, id: number): AprovacaoRegistrada[] {
    return s.aprovacoes
      .filter((a) => a.titulo === id)
      .map((a) => ({ aprovador: a.aprovador, ordem: a.ordem, faixa: a.faixa, em: a.em }));
  }

  private baixar(
    s: Estado,
    e: import('@sgh/contratos').BaixarTituloEntrada,
    usuario: string,
  ): Record<string, number | string> {
    if (!tpPgtoVisto(e.formaPagamento))
      throw recusa(
        'forma-pagamento-nao-vista',
        'Essa forma de pagamento nunca foi usada: escolha uma da lista.',
        { campos: ['formaPagamento'] },
      );
    const conta = contasDoUsuario(usuario).find((x) => x.id === e.conta);
    if (!conta)
      throw recusa('fora-do-escopo', 'A conta bancária não está no seu escopo de contas.', {
        campos: ['conta'],
      });
    if (e.cenario === 'receber') {
      const t = s.receber.get(e.titulo);
      if (!t) throw recusa('titulo-inexistente', 'O título não existe.');
      if (e.versao && e.versao !== versao(t.versao))
        throw recusa('titulo-ja-baixado', 'O título mudou depois da leitura: releia.');
      const r = conferirBaixaManual({
        emAberto: t.dataRecebimento === null,
        valorTitulo: t.valor,
        valorRecebido: e.valorRecebido,
        motivo: e.motivo,
        temPermissaoManual: true,
      });
      if (r)
        throw recusa(
          r.codigo === 'titulo-baixado' ? 'titulo-ja-baixado' : r.codigo,
          r.mensagem,
          r.campos ? { campos: r.campos } : {},
        );
      t.recebido = e.valorRecebido;
      t.dataRecebimento = e.dataRecebimento;
      t.origemBaixa = 'M';
      t.conta = conta.id;
      t.versao += 1;
      return {
        cenario: 'receber-manual',
        titulos: 1,
        bordero: 0,
        idBordero: 0,
        valor: e.valorRecebido,
        ids: String(t.id),
        conta: conta.id,
      };
    }
    const lidos: TituloPagarM[] = [];
    for (const it of [...e.titulos].sort((a, b) => a.titulo - b.titulo)) {
      const t = s.titulos.get(it.titulo);
      if (!t) throw recusa('titulo-inexistente', 'O título não existe.');
      if (it.versao && it.versao !== versao(t.versao))
        throw recusa('titulo-ja-baixado', 'O título mudou depois da leitura: releia antes de baixar.');
      if (t.pago > 0 || t.dataPagamento || t.bordero > 0)
        throw recusa('titulo-ja-baixado', 'O título já foi baixado por outra via: releia.');
      this.recusar(
        conferirPagamento({
          faixa: this.faixaDo(s, t),
          aprovacoes: this.aprovacoesDo(s, t.id),
          pagador: usuario,
          lancador: t.lancadoPor,
        }),
      );
      lidos.push(t);
    }
    const total = centavos(lidos.reduce((x, t) => x + t.valor, 0));
    let bordero = 0;
    let idBordero = 0;
    if (e.porBordero) {
      bordero = Math.max(15_000, ...s.borderos.map((b) => b.numero)) + 1;
      idBordero = ++s.seq;
      s.borderos.push({
        id: idBordero,
        numero: bordero,
        data: e.dataPagamento,
        valor: total,
        conta: conta.id,
        usuario,
        titulos: lidos.length,
      });
    }
    for (const t of lidos) {
      t.pago = t.valor;
      t.dataPagamento = e.dataPagamento;
      t.bordero = bordero;
      t.conta = conta.id;
      t.formaPagamento = e.formaPagamento;
      t.status = 0;
      t.versao += 1;
      s.pagosPeloNovo.add(t.id);
    }
    return {
      cenario: e.porBordero ? 'pagar-por-bordero' : 'pagar-sem-bordero',
      titulos: lidos.length,
      bordero,
      idBordero,
      valor: total,
      ids: lidos.map((t) => t.id).join(','),
      conta: conta.id,
    };
  }

  private criarTituloReceber(
    s: Estado,
    e: import('@sgh/contratos').CriarTituloReceberEntrada,
    usuario: string,
  ): Record<string, number | string> {
    const contas = e.contas.map((x) => {
      const c = s.contasFat.get(x.conta);
      if (!c) throw recusa('conta-inexistente', 'A conta não existe.', { campos: ['contas'] });
      if (x.versao && x.versao !== versao(c.versao))
        throw recusa('conta-alterada', 'A conta mudou depois da leitura: releia.');
      this.recusar(conferirContaParaTitulo({ fechada: c.fechada, titulo: c.titulo, valor: c.total }));
      return c;
    });
    const p = contas[0];
    if (!p) throw recusa('sem-contas', 'Informe ao menos uma conta.');
    if (contas.some((c) => c.convenio !== p.convenio || c.tipo !== p.tipo || c.competencia !== p.competencia))
      throw recusa('contas-misturadas', 'As contas de um título são do mesmo convênio, tipo e competência.', {
        campos: ['contas'],
      });
    const dev = devedorDaConta({ particular: p.particular, tipoConta: p.tipo });
    if (dev === 'C' && !(e.documento > 0))
      throw recusa('documento-obrigatorio', 'Informe o número da fatura do convênio.', {
        campos: ['documento'],
      });
    const id = ++s.seq;
    const valor = centavos(contas.reduce((x, c) => x + c.total, 0));
    s.receber.set(id, {
      id,
      devedor: dev,
      codigo: dev === 'C' ? p.convenio : p.id,
      convenio: p.convenio,
      documento: dev === 'C' ? e.documento : p.id,
      apresentacao: p.apresentacao,
      vencimento: e.vencimento,
      valor,
      recebido: 0,
      dataRecebimento: null,
      origem: 'V',
      origemBaixa: 'M',
      nome: dev === 'C' ? `CONVENIO SINTETICO ${p.convenio}` : 'PACIENTE SINTETICO',
      versao: 1,
    });
    for (const c of contas) {
      c.titulo = id;
      c.versao += 1;
    }
    void usuario;
    return {
      titulo: id,
      idMfctarec: id,
      contas: contas.length,
      dev,
      valor,
      documento: e.documento,
      ids: contas.map((c) => c.id).join(','),
      convenio: p.convenio,
    };
  }

  private lancarMovimento(
    s: Estado,
    e: import('@sgh/contratos').LancarMovimentoEntrada,
    usuario: string,
  ): Record<string, number | string> {
    this.recusar(conferirMovimento(e));
    for (const c of [e.contaCredito, e.contaDebito])
      if (c && !contasDoUsuario(usuario).some((x) => x.id === c))
        throw recusa('fora-do-escopo', 'A conta bancária não está no seu escopo de contas.');
    if (
      !CLASSIFICACOES.some(
        (x) =>
          x.grupo === e.classificacao.grupo &&
          x.subgrupo === e.classificacao.subgrupo &&
          x.item === e.classificacao.item,
      )
    )
      throw recusa('classificacao-inexistente', 'A classificação gerencial não existe no cadastro.', {
        campos: ['classificacao'],
      });
    const doc = Math.max(0, ...s.movimentos.filter((m) => m.data === e.data).map((m) => m.documento)) + 1;
    const id = ++s.seq;
    s.movimentos.push({
      id,
      data: e.data,
      documento: doc,
      tipo: e.tipo,
      valor: e.valor,
      historico: e.historico,
      contaCredito: e.contaCredito,
      contaDebito: e.contaDebito,
      classificacao: `${e.classificacao.grupo}.${e.classificacao.subgrupo}.${e.classificacao.item}`,
      usuario,
    });
    return { movimento: id, doc, tipo: e.tipo, valor: e.valor };
  }

  async gravarSgh<T>(
    c: ContextoFinanceiro,
    _trilha: unknown,
    fn: (g: GravadorSghFinanceiro) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    const g: GravadorSghFinanceiro = {
      salvarFaixa: async (d) => {
        const nova: FaixaAlcada = {
          id: d.id ?? ++s.seq,
          empresa: 1,
          centroCusto: d.centroCusto,
          tipoCredor: d.tipoCredor,
          valorDe: d.valorDe,
          valorAte: d.valorAte,
          aprovacoes: d.aprovacoes,
          permissao: d.permissao,
          vigenciaInicio: d.vigenciaInicio,
          vigenciaFim: d.vigenciaFim,
          ativa: d.ativa,
        };
        if (d.id !== null && !s.faixas.some((f) => f.id === d.id))
          throw recusa('faixa-inexistente', 'A faixa de alçada não existe.');
        this.recusar(conferirFaixas([...s.faixas.filter((f) => f.id !== nova.id), nova]));
        s.faixas = [...s.faixas.filter((f) => f.id !== nova.id), nova];
        return { id: nova.id };
      },
      prorrogarVencimento: async (d) => {
        const t = s.titulos.get(d.parcela);
        if (!t) throw recusa('titulo-inexistente', 'A parcela não existe (talvez já excluída).');
        const m = PortaFinanceiroMemoria.MOTIVOS_PRORROGACAO.find((x) => x.id === d.motivo) ?? null;
        const pago = t.pago > 0 || !!t.dataPagamento;
        this.recusar(
          conferirProrrogacao(
            {
              situacao: pago ? 'paga' : 'aberta',
              saldo: pago ? 0 : t.valor,
              vencimento: t.vencimento,
              emLotePendente: this.emRemessaPendente(s).has(t.id),
            },
            d.vencimento,
            m ? { ativo: m.ativo, aplicaPagar: true, exigeJustificativa: m.exigeJustificativa } : null,
            d.justificativa,
          ) ??
            conferirAlcadaProrrogacao({
              tituloAprovado: !!situacaoAprovacao(this.faixaDo(s, t), this.aprovacoesDo(s, t.id)).aprovado,
              lancadoPeloUsuario: t.lancadoPor === d.usuario,
              podeAprovar: d.podeAprovar,
            }),
        );
        const h = this.prorrogacoesDo(s);
        const anterior = t.vencimento;
        if (!h.original.has(t.id)) h.original.set(t.id, anterior);
        t.vencimento = d.vencimento;
        t.versao += 1;
        const id = ++s.seq;
        h.passos.push({
          id,
          parcela: t.id,
          vencimentoAnterior: anterior,
          vencimentoNovo: d.vencimento,
          motivo: m?.descricao ?? '',
          justificativa: d.justificativa.trim(),
          usuario: d.usuario,
          em: new Date().toISOString(),
        });
        return {
          id,
          vencimentoAnterior: anterior,
          vencimento: d.vencimento,
          vencimentoOriginal: h.original.get(t.id) ?? anterior,
        };
      },
      aprovarTitulo: async (d) => {
        const t = s.titulos.get(d.titulo);
        if (!t) throw recusa('titulo-inexistente', 'O título não existe (talvez já excluído).');
        const faixa = this.faixaDo(s, t);
        const aprovacoes = this.aprovacoesDo(s, t.id);
        this.recusar(
          conferirSegregacao('aprovar', d.usuario, { lancou: t.lancadoPor, aprovaram: [], pagou: null }) ??
            conferirAprovacao({
              faixa,
              aprovacoes,
              aprovador: d.usuario,
              lancador: t.lancadoPor,
              temPermissaoDaFaixa: faixa ? d.temPermissao(faixa.permissao) : false,
              valor: t.valorDocumento,
              emAberto: !(t.pago > 0) && !t.dataPagamento && t.bordero === 0,
            }),
        );
        if (!faixa) throw recusa('sem-alcada', 'Nenhuma faixa de alçada cobre o título.');
        const ordem = aprovacoes.filter((a) => a.faixa === faixa.id).length + 1;
        s.aprovacoes.push({
          titulo: t.id,
          aprovador: d.usuario,
          faixa: faixa.id,
          ordem: ordem >= 2 ? 2 : 1,
          em: s.hoje,
        });
        return {
          id: ++s.seq,
          ordem,
          aprovado: ordem >= faixa.aprovacoes,
          faltam: Math.max(0, faixa.aprovacoes - ordem),
        };
      },
      registrarGlosaTitulo: async (d) => {
        if (d.chaveEvento) {
          const ja = s.glosas.find((x) => x.chave === d.chaveEvento);
          if (ja) return { id: ja.id, repetida: true };
        }
        const t = s.receber.get(d.tituloReceber);
        if (!t) throw recusa('titulo-inexistente', 'O título a receber não existe.');
        if (d.item !== null) {
          const item = [...s.contasFat.values()]
            .filter((c) => c.titulo === t.id)
            .flatMap((c) => c.itens)
            .find((i) => i.id === d.item);
          if (!item)
            throw recusa('item-fora-do-titulo', 'O item glosado não é de uma conta deste título.', {
              campos: ['item'],
            });
          if (item.glosado !== 'T')
            throw recusa(
              'item-sem-retorno',
              'O item ainda não tem retorno da operadora: não há glosa a registrar.',
              { campos: ['item'] },
            );
          if (d.valor > item.valorCobrado - item.valorPago + 0.005)
            throw recusa(
              'glosa-acima-do-item',
              'A glosa passa da diferença entre o cobrado e o pago do item.',
              { campos: ['valor'] },
            );
        }
        const id = ++s.seq;
        s.glosas.push({
          id,
          titulo: t.id,
          item: d.item,
          situacao: d.situacao,
          valor: d.valor,
          motivo: d.motivo,
          em: s.hoje,
          chave: d.chaveEvento ?? null,
        });
        return { id, repetida: false };
      },
      importarExtrato: async (d) => {
        const ja = s.extratos.find((x) => x.conta === d.conta && x.hash === d.hashArquivo);
        if (ja) return { id: ja.id, linhas: ja.linhas, repetido: true };
        const id = ++s.seq;
        s.extratos.push({ id, conta: d.conta, hash: d.hashArquivo, linhas: d.linhas.length });
        for (const l of d.linhas) s.linhas.push({ id: ++s.seq, conta: d.conta, situacao: 'pendente', ...l });
        return { id, linhas: d.linhas.length, repetido: false };
      },
      conciliar: async (d) => {
        const l = s.linhas.find((x) => x.id === d.linha);
        if (!l) throw recusa('linha-inexistente', 'A linha do extrato não existe.');
        if (!d.contasEscopo.includes(l.conta)) throw foraDoEscopo();
        if (l.situacao !== 'pendente')
          throw recusa('linha-conciliada', 'A linha do extrato já foi conciliada.');
        const outraConta = () =>
          recusa(
            'alvo-de-outra-conta',
            'O lançamento escolhido é de outra conta bancária, não da conta do extrato.',
          );
        let pagou: string | null = null;
        if (d.alvo.tipo === 'titulo-pagar') {
          const t = s.titulos.get(d.alvo.id);
          if (!t || !t.dataPagamento) throw recusa('titulo-nao-pago', 'O título a pagar não está pago.');
          if (t.conta !== l.conta) throw outraConta();
        } else if (d.alvo.tipo === 'titulo-receber') {
          const t = s.receber.get(d.alvo.id);
          if (!t || !t.dataRecebimento)
            throw recusa('titulo-nao-recebido', 'O título a receber não está baixado.');
          if (t.conta !== l.conta) throw outraConta();
        } else if (d.alvo.tipo === 'movimento') {
          const m = s.movimentos.find((x) => x.id === (d.alvo as { id: number }).id);
          if (!m) throw recusa('movimento-inexistente', 'O movimento não existe.');
          if (m.contaCredito !== l.conta && m.contaDebito !== l.conta) throw outraConta();
          pagou = m.usuario;
        }
        this.recusar(conferirSegregacao('conciliar', d.usuario, { lancou: null, aprovaram: [], pagou }));
        const id = ++s.seq;
        s.conciliacoes.push({
          id,
          linha: l.id,
          tipo: d.alvo.tipo,
          alvo: 'id' in d.alvo ? d.alvo.id : null,
          regra: d.regra,
          por: d.usuario,
        });
        l.situacao = d.alvo.tipo === 'credito-pendente' ? 'credito-pendente' : 'conciliada';
        if (d.alvo.tipo === 'credito-pendente')
          s.creditos.push({
            id: ++s.seq,
            conta: l.conta,
            data: l.data,
            valor: l.valor,
            situacao: 'pendente',
            tituloReceber: null,
            origem: 'extrato',
          });
        return { id };
      },
      concederAdiantamento: async (d) => {
        this.recusar(
          conferirConcessao({ valor: d.valor, referente: d.referente, data: d.data, prazo: d.prazo }),
        );
        if (!d.contasEscopo.includes(d.conta)) throw foraDoEscopo();
        const id = ++s.seq;
        const numero = `AD-${id}`;
        s.adiantamentos.push({
          id,
          credor: d.credor,
          tipoCredor: d.tipoCredor,
          numero,
          documento: id,
          emissao: d.data,
          prazo: d.prazo,
          referente: d.referente,
          situacao: 'aberto',
          valor: d.valor,
          compensado: 0,
          saldo: 0,
          conta: d.conta,
          aprovacoes: 0,
          exigidas: this.faixaDoAdiantamento(s, d.tipoCredor, d.valor)?.aprovacoes ?? 1,
          pedidoPor: d.usuario,
          aprovadores: [],
        });
        return { id, numero };
      },
      aprovarAdiantamento: async (d) => {
        const i = s.adiantamentos.findIndex((x) => x.id === d.adiantamento);
        const a = s.adiantamentos[i];
        if (!a) throw recusa('adiantamento-inexistente', 'O adiantamento não existe.');
        this.recusar(conferirPedidoEmAberto(a.situacao));
        const faixa = this.faixaDoAdiantamento(s, a.tipoCredor, a.valor);
        this.recusar(
          conferirAprovacao({
            faixa,
            aprovacoes: a.aprovadores,
            aprovador: d.usuario,
            lancador: a.pedidoPor,
            temPermissaoDaFaixa: faixa ? d.temPermissao(faixa.permissao) : false,
            valor: a.valor,
            emAberto: true,
          }),
        );
        if (!faixa) throw recusa('sem-alcada', 'Nenhuma faixa de alçada cobre o adiantamento.');
        const ordem = a.aprovadores.filter((x) => x.faixa === faixa.id).length + 1;
        const aprovadores = [
          ...a.aprovadores,
          { aprovador: d.usuario, ordem: (ordem >= 2 ? 2 : 1) as 1 | 2, faixa: faixa.id, em: s.hoje },
        ];
        const aprovado = ordem >= faixa.aprovacoes;
        s.adiantamentos[i] = {
          ...a,
          aprovadores,
          aprovacoes: ordem,
          situacao: aprovado ? 'aprovado' : 'aberto',
        };
        return { id: ++s.seq, ordem, aprovado, faltam: Math.max(0, faixa.aprovacoes - ordem) };
      },
      pagarAdiantamento: async (d) => {
        const i = s.adiantamentos.findIndex((x) => x.id === d.adiantamento);
        const a = s.adiantamentos[i];
        if (!a) throw recusa('adiantamento-inexistente', 'O adiantamento não existe.');
        this.recusar(conferirSaida(a.situacao));
        if (a.conta === null || !d.contasEscopo.includes(a.conta)) throw foraDoEscopo();
        this.recusar(
          conferirPagamento({
            faixa: this.faixaDoAdiantamento(s, a.tipoCredor, a.valor),
            aprovacoes: a.aprovadores,
            pagador: d.usuario,
            lancador: a.pedidoPor,
          }),
        );
        s.adiantamentos[i] = { ...a, situacao: 'pago', saldo: a.valor };
        return { id: a.id, movimento: ++s.seq };
      },
      compensarAdiantamento: async (d) => {
        const i = s.adiantamentos.findIndex((x) => x.id === d.adiantamento);
        const a = s.adiantamentos[i];
        if (!a) throw recusa('adiantamento-inexistente', 'O adiantamento não existe.');
        const t = s.titulos.get(d.parcela);
        if (!t) throw recusa('titulo-inexistente', 'O título não existe ou não está em aberto.');
        const saldoTitulo = centavos(t.valor - t.pago);
        this.recusar(
          conferirCompensacao(
            { credor: { tipo: a.tipoCredor, id: a.credor }, saldo: a.saldo, situacao: a.situacao },
            {
              credor: {
                tipo:
                  t.tipo === 'M' ? 'profissional' : t.tipo === 'F' || t.tipo === 'E' ? 'fornecedor' : 'outro',
                id: t.credor,
              },
              saldo: saldoTitulo,
            },
            d.valor,
          ),
        );
        // A compensação é uma baixa do título: a mesma alçada e a mesma segregação da baixa normal.
        this.recusar(
          conferirPagamento({
            faixa: this.faixaDo(s, t),
            aprovacoes: this.aprovacoesDo(s, t.id),
            pagador: d.usuario,
            lancador: t.lancadoPor,
          }),
        );
        s.titulos.set(d.parcela, { ...t, pago: centavos(t.pago + d.valor) });
        const novo = aposUso(a.valor, a.saldo, d.valor);
        s.adiantamentos[i] = { ...a, ...novo, compensado: centavos(a.valor - novo.saldo) };
        return { id: ++s.seq, baixa: ++s.seq, saldo: novo.saldo };
      },
      devolverAdiantamento: async (d) => {
        const i = s.adiantamentos.findIndex((x) => x.id === d.adiantamento);
        const a = s.adiantamentos[i];
        if (!a) throw recusa('adiantamento-inexistente', 'O adiantamento não existe.');
        if (!d.contasEscopo.includes(d.conta)) throw foraDoEscopo();
        this.recusar(
          conferirDevolucao(
            { credor: { tipo: a.tipoCredor, id: a.credor }, saldo: a.saldo, situacao: a.situacao },
            d.valor,
            d.motivo,
          ),
        );
        const novo = aposUso(a.valor, a.saldo, d.valor);
        s.adiantamentos[i] = { ...a, ...novo };
        return { id: a.id, movimento: ++s.seq, saldo: novo.saldo };
      },
      atribuirCredito: async (d) => {
        const cr = s.creditos.find((x) => x.id === d.credito);
        if (!cr) throw recusa('credito-inexistente', 'O crédito não existe.');
        if (!d.contasEscopo.includes(cr.conta)) throw foraDoEscopo();
        if (cr.situacao !== 'pendente') throw recusa('credito-atribuido', 'O crédito já foi atribuído.');
        if (!s.receber.has(d.tituloReceber))
          throw recusa('titulo-inexistente', 'O título a receber não existe.');
        const i = s.creditos.indexOf(cr);
        s.creditos[i] = { ...cr, situacao: 'atribuido', tituloReceber: d.tituloReceber };
        return { id: cr.id };
      },
      registrarRemessa: async (d) => {
        const sequencial = s.fiscais.remessa.filter((r) => r['CONTA'] === d.conta).length + 1;
        const id = ++s.seq;
        s.fiscais.remessa.unshift({
          ID: id,
          CONTA: d.conta,
          LEIAUTE: d.leiaute,
          SEQUENCIAL: sequencial,
          TITULOS: d.titulos,
          VALOR_TOTAL: d.valorTotal,
          DESTINO: d.destino,
          SITUACAO: d.situacao,
          OCORRENCIAS: d.ocorrencias,
          GERADO_EM: s.hoje,
        });
        if (d.situacao === 'gerada')
          for (const x of d.parcelas ?? []) this.emRemessaPendente(s).add(x.parcela);
        return { id, sequencial };
      },
      registrarNfse: async (d) => {
        const id = ++s.seq;
        s.fiscais.nfse.unshift({
          ID: id,
          TITULO_RECEBER: d.tituloReceber,
          MOMENTO: d.momento,
          VALOR_SERVICOS: d.valorServicos,
          VALOR_ISS: d.valorIss,
          VALOR_IBS: d.valorIbs,
          VALOR_CBS: d.valorCbs,
          VALOR_LIQUIDO: d.valorLiquido,
          DESTINO: d.destino,
          SITUACAO: d.situacao,
          NUMERO: d.numero,
          EMITIDO_EM: s.hoje,
        });
        return { id };
      },
      registrarDeclaracao: async (d) => {
        const id = ++s.seq;
        s.fiscais.declaracao.unshift({
          ID: id,
          TIPO: d.tipo,
          PERIODO: d.periodo,
          LEIAUTE: d.leiaute,
          REGISTROS: d.registros,
          VALOR_TOTAL: d.valorTotal,
          SITUACAO: 'gerado-nao-enviado',
          GERADO_EM: s.hoje,
        });
        return { id };
      },
      registrarLoteContabil: async (d) => {
        const id = ++s.seq;
        s.fiscais.lote.unshift({
          ID: id,
          PERIODO: d.periodo,
          REGUA: d.regua,
          LANCAMENTOS: d.lancamentos,
          SOMA_DEBITOS: d.somaDebitos,
          SOMA_CREDITOS: d.somaCreditos,
          SEM_DE_PARA: d.semDePara,
          EXPORTADO_EM: s.hoje,
        });
        return { id };
      },
    };
    return fn(g);
  }

  // ── Leituras ─────────────────────────────────────────────────────────────────────────────────────────────────

  async hoje(c: ContextoFinanceiro): Promise<string> {
    return this.e(c).hoje;
  }

  /** D-SALDO-32: o fechamento + os movimentos + os títulos recebidos na conta − os pagos por ela, depois do fechamento. */
  async contas(c: ContextoFinanceiro, usuario: string | null = null): Promise<ContaBancariaResposta[]> {
    const s = this.e(c);
    return contasDoUsuario(usuario).map((x) => {
      const depois = (d: string | null) => d !== null && d > (x.saldoFechadoEm ?? SENTINELA);
      const movimentos = s.movimentos
        .filter((m) => depois(m.data))
        .reduce(
          (t, m) => t + (m.contaCredito === x.id ? m.valor : 0) - (m.contaDebito === x.id ? m.valor : 0),
          0,
        );
      const recebidos = [...s.receber.values()]
        .filter((t) => t.conta === x.id && depois(t.dataRecebimento))
        .reduce((t, r) => t + r.recebido, 0);
      const pagos = [...s.titulos.values()]
        .filter((t) => t.conta === x.id && depois(t.dataPagamento))
        .reduce((t, p) => t + p.pago, 0);
      return { ...x, saldo: centavos((SALDO_FECHADO[x.id] ?? 0) + movimentos + recebidos - pagos) };
    });
  }

  async classificacoes() {
    return CLASSIFICACOES;
  }

  async retencoes() {
    return RETENCOES;
  }

  async formasPagamento() {
    return FORMAS;
  }

  private tituloPagarDe(s: Estado, t: TituloPagarM): TituloPagarResposta {
    const nome = t.tipo === 'M' ? MEDICOS[t.credor]?.nome : FORNECEDORES[t.credor];
    return {
      id: t.id,
      credor: t.credor,
      credorNome: nome ?? 'não encontrado no cadastro',
      credorEncontrado: !!nome,
      documento: t.documento,
      parcela: t.parcela,
      tipo: t.tipo,
      serie: t.serie,
      origem: t.origem,
      emissao: t.emissao,
      vencimento: t.vencimento,
      valor: t.valor,
      valorDocumento: t.valorDocumento,
      pago: t.pago,
      dataPagamento: t.dataPagamento,
      bordero: t.bordero,
      status: t.status,
      situacao: situacaoTituloPagar({ ...t, dataPagamento: t.dataPagamento ?? SENTINELA }, s.hoje),
      lancadoPor: t.lancadoPor,
      referente: t.referente,
      aprovacoes: s.aprovacoes.filter((a) => a.titulo === t.id).length,
      versao: versao(t.versao),
    };
  }

  async titulosPagar(c: ContextoFinanceiro, f: FiltroPagar) {
    const s = this.e(c);
    const todos = [...s.titulos.values()]
      .map((t) => this.tituloPagarDe(s, t))
      .filter(
        (t) =>
          (!f.situacao || t.situacao === f.situacao) &&
          (!f.vencimentoDe || (t.vencimento ?? '') >= f.vencimentoDe) &&
          (!f.vencimentoAte || (t.vencimento ?? '') <= f.vencimentoAte) &&
          (!f.credor || t.credor === f.credor) &&
          (!f.credorDe ||
            (f.credorDe === 'profissional' ? t.tipo === 'M' : t.tipo === 'F' || t.tipo === 'E')) &&
          (!f.tipo || t.tipo === f.tipo),
      )
      .sort((a, b) => (b.vencimento ?? '').localeCompare(a.vencimento ?? '') || b.id - a.id);
    return {
      itens: todos.slice(f.pagina * 200, f.pagina * 200 + 200),
      pagina: f.pagina,
      mais: todos.length > (f.pagina + 1) * 200,
    };
  }

  async tituloPagar(c: ContextoFinanceiro, id: number) {
    const s = this.e(c);
    const t = s.titulos.get(id);
    if (!t) return null;
    const doc = [...s.titulos.values()].filter(
      (x) => x.credor === t.credor && x.documento === t.documento && x.tipo === t.tipo,
    );
    const cl = doc.find((x) => x.classificacao)?.classificacao ?? null;
    return {
      ...this.tituloPagarDe(s, t),
      parcelas: doc
        .sort((a, b) => a.parcela - b.parcela)
        .map((x) => ({
          id: x.id,
          parcela: x.parcela,
          vencimento: x.vencimento,
          valor: x.valor,
          situacao: this.tituloPagarDe(s, x).situacao,
        })),
      classificacao: cl
        ? {
            ...cl,
            nome:
              CLASSIFICACOES.find(
                (x) => x.grupo === cl.grupo && x.subgrupo === cl.subgrupo && x.item === cl.item,
              )?.nome ?? '',
            valor: t.valorDocumento,
          }
        : null,
      retencoes: (doc.find((x) => x.parcela === 1)?.retencoes ?? []).map((r) => ({
        ...r,
        descricao: RETENCOES.find((x) => x.codigo === r.codigo)?.descricao ?? '',
      })),
      profissional: t.profissional,
      rateio: s.rateios
        .filter((r) => r.documento === t.documento && r.credor === t.credor)
        .map((r) => ({ centroCusto: r.centroCusto, percentual: r.percentual, valor: r.valor })),
      aprovacoesFeitas: s.aprovacoes
        .filter((a) => a.titulo === id)
        .map((a) => ({ aprovador: a.aprovador, ordem: a.ordem, em: a.em })),
      documentoCredor: '**.***.***/****-55',
    };
  }

  /** F3.8 (07-FIN linha 63): as parcelas enviadas em remessa ainda sem retorno, por estado (a prorrogação é recusada). */
  private readonly remessaPendenteM = new WeakMap<object, Set<number>>();
  private emRemessaPendente(s: object): Set<number> {
    let x = this.remessaPendenteM.get(s);
    if (!x) this.remessaPendenteM.set(s, (x = new Set<number>()));
    return x;
  }

  /** F3.8 (07-FIN linha 63): o histórico de prorrogações por estado (o vencimento original de cada parcela junto). */
  private readonly prorrogacoesM = new WeakMap<
    Estado,
    { original: Map<number, string>; passos: (ProrrogacaoPorta & { parcela: number })[] }
  >();
  private prorrogacoesDo(s: Estado) {
    let x = this.prorrogacoesM.get(s);
    if (!x) this.prorrogacoesM.set(s, (x = { original: new Map(), passos: [] }));
    return x;
  }
  static readonly MOTIVOS_PRORROGACAO: readonly (MotivoProrrogacaoPorta & { ativo: boolean })[] = [
    { id: 1, descricao: 'Acordo com o credor', exigeJustificativa: false, ativo: true },
    { id: 2, descricao: 'Outro motivo', exigeJustificativa: true, ativo: true },
  ];

  async motivosProrrogacao(): Promise<MotivoProrrogacaoPorta[]> {
    return PortaFinanceiroMemoria.MOTIVOS_PRORROGACAO.map(({ id, descricao, exigeJustificativa }) => ({
      id,
      descricao,
      exigeJustificativa,
    }));
  }

  async prorrogacoes(c: ContextoFinanceiro, parcela: number): Promise<ProrrogacaoPorta[]> {
    return this.prorrogacoesDo(this.e(c))
      .passos.filter((x) => x.parcela === parcela)
      .map((x): ProrrogacaoPorta => ({
        id: x.id,
        vencimentoAnterior: x.vencimentoAnterior,
        vencimentoNovo: x.vencimentoNovo,
        motivo: x.motivo,
        justificativa: x.justificativa,
        usuario: x.usuario,
        em: x.em,
      }))
      .reverse();
  }

  async documentoCredor() {
    return '11222333000155';
  }

  async filaAprovacao(c: ContextoFinanceiro, _hoje: string, ate: string) {
    const s = this.e(c);
    return [...s.titulos.values()]
      .filter((t) => !t.dataPagamento && t.bordero === 0 && t.vencimento <= ate)
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.id - b.id)
      .map((t) => this.tituloPagarDe(s, t));
  }

  async faixas(c: ContextoFinanceiro) {
    return this.e(c).faixas;
  }

  async aprovacoesDosTitulos(c: ContextoFinanceiro, ids: readonly number[]) {
    const s = this.e(c);
    const m = new Map<number, { aprovador: string; faixa: number }[]>();
    for (const a of s.aprovacoes)
      if (ids.includes(a.titulo))
        m.set(a.titulo, [...(m.get(a.titulo) ?? []), { aprovador: a.aprovador, faixa: a.faixa }]);
    return m;
  }

  async borderos(c: ContextoFinanceiro) {
    return [...this.e(c).borderos].reverse();
  }

  async adiantamentos(c: ContextoFinanceiro): Promise<AdiantamentoResposta[]> {
    return [...this.e(c).adiantamentos].reverse().map((a) => {
      const r: Record<string, unknown> = { ...a };
      delete r['pedidoPor'];
      delete r['aprovadores'];
      return r as unknown as AdiantamentoResposta;
    });
  }

  private receberDe(s: Estado, t: TituloReceberM): TituloReceberResposta {
    return {
      ...t,
      contas: [...s.contasFat.values()].filter((c) => c.titulo === t.id).length,
      glosaAceita: centavos(
        s.glosas.filter((g) => g.titulo === t.id && g.situacao === 'aceita').reduce((x, g) => x + g.valor, 0),
      ),
      situacao: t.dataRecebimento
        ? t.recebido + 0.005 >= t.valor
          ? 'recebido'
          : 'recebido-parcial'
        : t.vencimento < s.hoje
          ? 'vencido'
          : 'aberto',
      versao: versao(t.versao),
    };
  }

  async titulosReceber(c: ContextoFinanceiro, f: FiltroReceber) {
    const s = this.e(c);
    const todos = [...s.receber.values()]
      .map((t) => this.receberDe(s, t))
      .filter(
        (t) =>
          (!f.devedor || t.devedor === f.devedor) &&
          (f.convenio === null || t.convenio === f.convenio) &&
          (f.aberto === null || (f.aberto ? !t.dataRecebimento : !!t.dataRecebimento)),
      )
      .sort((a, b) => b.id - a.id);
    return { itens: todos.slice(0, 200), pagina: f.pagina, mais: false };
  }

  async tituloReceber(c: ContextoFinanceiro, id: number) {
    const s = this.e(c);
    const t = s.receber.get(id);
    if (!t) return null;
    const contas = [...s.contasFat.values()].filter((x) => x.titulo === id);
    const itens = contas.flatMap((x) => x.itens);
    const baixados = itens.filter((i) => i.glosado === 'T');
    const cob = baixados.reduce((x, i) => x + i.valorCobrado, 0);
    const gl = baixados.reduce((x, i) => x + Math.max(0, i.valorCobrado - i.valorPago), 0);
    return {
      ...this.receberDe(s, t),
      contasLigadas: contas.map((x) => ({
        id: x.id,
        tipo: x.tipo,
        competencia: x.competencia,
        total: x.total,
      })),
      glosa: {
        itens: itens.length,
        baixados: baixados.length,
        cobradoBaixado: centavos(cob),
        pagoBaixado: centavos(baixados.reduce((x, i) => x + i.valorPago, 0)),
        glosado: centavos(gl),
        pagoAMaior: centavos(baixados.reduce((x, i) => x + Math.max(0, i.valorPago - i.valorCobrado), 0)),
        taxa: cob > 0 ? Math.round((gl / cob) * 10_000) / 100 : 0,
      },
      glosas: s.glosas
        .filter((g) => g.titulo === id)
        .map((g) => ({
          id: g.id,
          item: g.item,
          situacao: g.situacao,
          valor: g.valor,
          motivo: g.motivo,
          em: g.em,
        })),
    };
  }

  async tituloDoItem(c: ContextoFinanceiro, item: number) {
    return [...this.e(c).contasFat.values()].find((x) => x.itens.some((i) => i.id === item))?.titulo ?? null;
  }

  async contasSemTitulo(
    c: ContextoFinanceiro,
    f: { convenio: number | null; ano: number; mes: number | null },
  ): Promise<ContaSemTituloResposta[]> {
    return [...this.e(c).contasFat.values()]
      .filter(
        (x) =>
          !x.titulo &&
          (f.convenio === null || x.convenio === f.convenio) &&
          Number(x.competencia.slice(0, 4)) === f.ano &&
          (f.mes === null || Number(x.competencia.slice(5, 7)) === f.mes),
      )
      .map((x) => ({
        id: x.id,
        convenio: x.convenio,
        tipo: x.tipo,
        competencia: x.competencia,
        fechada: x.fechada,
        total: x.total,
        apresentacao: x.apresentacao,
        versao: versao(x.versao),
      }));
  }

  async contaCorrenteConvenios() {
    return [
      {
        id: 1,
        data: '2026-09-15',
        documento: 1,
        valor: 250,
        devedor: 'C',
        codigo: 91,
        historico: 'CREDITO SINTETICO DE CONVENIO',
        conta: 1,
      },
    ];
  }

  async renegociacoes() {
    return [{ id: 1, em: '2025-11-10T10:00:00', responsavel: 'OUTRO.SISTEMA', titulos: 2 }];
  }

  async movimento(c: ContextoFinanceiro, conta: number, de: string, ate: string) {
    return this.e(c)
      .movimentos.filter(
        (m) => (m.contaCredito === conta || m.contaDebito === conta) && m.data >= de && m.data <= ate,
      )
      .sort((a, b) => b.data.localeCompare(a.data) || b.documento - a.documento);
  }

  async linhasExtrato(
    c: ContextoFinanceiro,
    conta: number,
    situacao: string | null,
  ): Promise<LinhaExtratoResposta[]> {
    return this.e(c)
      .linhas.filter((l) => l.conta === conta && (!situacao || l.situacao === situacao))
      .map((l) => ({
        id: l.id,
        data: l.data,
        valor: l.valor,
        historico: l.historico,
        documento: l.documento,
        situacao: l.situacao,
      }));
  }

  async creditosPendentes(c: ContextoFinanceiro) {
    return this.e(c).creditos;
  }

  async lancamentosFluxo(c: ContextoFinanceiro, de: string, ate: string): Promise<LancamentoFluxoPorta[]> {
    const s = this.e(c);
    const r: LancamentoFluxoPorta[] = [];
    for (const t of s.titulos.values()) {
      const d = t.dataPagamento ?? t.vencimento;
      if (d >= de && d <= ate)
        r.push({
          data: d,
          valor: t.dataPagamento ? t.pago : t.valor,
          sentido: 'saida',
          origem: 'pagar',
          realizado: !!t.dataPagamento,
        });
    }
    for (const t of s.receber.values()) {
      const d = t.dataRecebimento ?? t.vencimento;
      if (d >= de && d <= ate)
        r.push({
          data: d,
          valor: t.dataRecebimento ? t.recebido : t.valor,
          sentido: 'entrada',
          origem: 'receber',
          realizado: !!t.dataRecebimento,
          convenio: t.convenio,
        });
    }
    for (const m of s.movimentos)
      if (m.data >= de && m.data <= ate && m.tipo !== 'T' && m.tipo !== 'F')
        r.push({
          data: m.data,
          valor: m.valor,
          sentido: m.contaCredito ? 'entrada' : 'saida',
          origem: 'movimento',
          realizado: true,
        });
    return r;
  }

  async historicosConvenio() {
    return [
      { convenio: 91, taxaGlosa: 0.075, atrasoMedioDias: 12 },
      { convenio: 92, taxaGlosa: 0.05, atrasoMedioDias: 5 },
    ];
  }

  async apropriacoes(
    c: ContextoFinanceiro,
    f: { de: string; ate: string; grupo: number | null; pagina: number },
  ): Promise<ListaApropriacoes> {
    const s = this.e(c);
    const todas = [...s.titulos.values()]
      .filter(
        (t) =>
          t.parcela === 1 &&
          t.classificacao !== null &&
          t.emissao >= f.de &&
          t.emissao <= f.ate &&
          (f.grupo === null || t.classificacao.grupo === f.grupo),
      )
      .sort((x, y) => (x.emissao === y.emissao ? y.documento - x.documento : x.emissao < y.emissao ? 1 : -1))
      .map((t) => {
        const g = t.classificacao as { grupo: number; subgrupo: number; item: number };
        const nome = CLASSIFICACOES.find(
          (x) => x.grupo === g.grupo && x.subgrupo === g.subgrupo && x.item === g.item,
        )?.nome;
        return {
          titulo: t.id,
          credor: t.credor,
          documento: t.documento,
          tipo: t.tipo,
          serie: t.serie,
          data: t.emissao,
          ...g,
          nome: nome ?? '',
          valor: t.valorDocumento,
          centrosCusto: s.rateios.filter((r) => r.documento === t.documento && r.credor === t.credor).length,
        };
      });
    const ini = Math.max(0, f.pagina) * 50;
    return {
      itens: todas.slice(ini, ini + 50),
      pagina: Math.max(0, f.pagina),
      mais: todas.length > ini + 50,
    };
  }

  async basesDre(c: ContextoFinanceiro, de: number, ate: number): Promise<BasesDrePorta> {
    const s = this.e(c);
    const comp = (d: string) => Number(d.slice(0, 4)) * 100 + Number(d.slice(5, 7));
    const receitas = new Map<number, { valor: number; glosa: number }>();
    for (const x of s.contasFat.values()) {
      const k = comp(`${x.competencia}-01`);
      if (k < de || k > ate) continue;
      const r = receitas.get(k) ?? { valor: 0, glosa: 0 };
      r.valor += x.total;
      receitas.set(k, r);
    }
    for (const g of s.glosas)
      if (g.situacao === 'aceita') {
        const k = comp(g.em);
        const r = receitas.get(k) ?? { valor: 0, glosa: 0 };
        r.glosa += g.valor;
        receitas.set(k, r);
      }
    return {
      receitas: [...receitas.entries()].map(([competencia, r]) => ({
        competencia,
        valor: centavos(r.valor),
        glosaAceita: centavos(r.glosa),
      })),
      despesas: [...s.titulos.values()]
        .filter((t) => t.classificacao && comp(t.emissao) >= de && comp(t.emissao) <= ate)
        .map((t) => ({
          competencia: comp(t.emissao),
          valor: t.valorDocumento,
          grupo: t.classificacao?.grupo ?? 0,
        })),
      caixa: [
        ...[...s.receber.values()]
          .filter((t) => t.dataRecebimento)
          .map((t) => ({
            data: t.dataRecebimento as string,
            valor: t.recebido,
            natureza: 'receita' as const,
            grupo: 100,
          })),
        ...[...s.titulos.values()]
          .filter((t) => t.dataPagamento)
          .map((t) => ({
            data: t.dataPagamento as string,
            valor: t.pago,
            natureza: 'despesa' as const,
            grupo: t.classificacao?.grupo ?? 0,
          })),
      ],
    };
  }

  async basesIndicadores(c: ContextoFinanceiro): Promise<BasesIndicadoresPorta> {
    const s = this.e(c);
    const pagos = [...s.titulos.values()].filter((t) => t.dataPagamento);
    return {
      pagos: pagos.length,
      aprovados: pagos.filter((t) => s.aprovacoes.some((a) => a.titulo === t.id)).length,
      pagosPeloNovo: s.pagosPeloNovo.size,
      contas: s.contasFat.size,
      contasComTitulo: [...s.contasFat.values()].filter((x) => x.titulo).length,
      titulos: s.titulos.size,
      orfaos: [...s.titulos.values()].filter((t) => t.tipo !== 'M' && !FORNECEDORES[t.credor]).length,
    };
  }

  async escrituracao(): Promise<EscrituracaoResposta[]> {
    return [
      {
        nota: 1,
        numero: '000123',
        emissao: '2026-09-02',
        fornecedor: 5001,
        cfop: 1102,
        tipoDocumento: 55,
        chaveNfe: 'SINTETICA',
        itens: 3,
        itensComCfop: 3,
      },
      {
        nota: 2,
        numero: '000124',
        emissao: '2026-09-05',
        fornecedor: 5002,
        cfop: null,
        tipoDocumento: 55,
        chaveNfe: '',
        itens: 2,
        itensComCfop: 1,
      },
    ];
  }

  async deParaContabil(): Promise<DeParaContabilPorta> {
    return { regras: [], centros: new Map(), credores: new Map(), fatos: [] };
  }

  async retencoesDaCompetencia(
    c: ContextoFinanceiro,
    ano: number,
    mes: number,
  ): Promise<RetencaoReinfPorta[]> {
    const s = this.e(c);
    const per = `${ano}-${p2(mes)}`;
    return [...s.titulos.values()]
      .filter((t) => t.emissao.slice(0, 7) === per && t.retencoes.length)
      .map((t) => ({
        cnpjPrestador: '11222333000155',
        documento: t.documento,
        dataEmissao: t.emissao,
        valorBruto: t.valor,
        inss: t.retencoes.filter((r) => r.tipo === 2).reduce((x, r) => x + r.valor, 0),
        ir: t.retencoes.filter((r) => r.tipo === 6).reduce((x, r) => x + r.valor, 0),
        csll: 0,
        pis: 0,
        cofins: t.retencoes.filter((r) => r.tipo === 4).reduce((x, r) => x + r.valor, 0),
      }));
  }

  async registrosFiscais(c: ContextoFinanceiro, tipo: 'nfse' | 'declaracao' | 'lote' | 'remessa') {
    return this.e(c).fiscais[tipo];
  }

  /** Para os testes: a situação da aprovação do título. */
  situacao(c: ContextoFinanceiro, titulo: number) {
    const s = this.e(c);
    const t = s.titulos.get(titulo);
    return t ? situacaoAprovacao(this.faixaDo(s, t), this.aprovacoesDo(s, titulo)) : null;
  }

  /** Para os testes: o mesmo usuário? */
  static mesmo = mesmaPessoa;
}
