// Porta da cobrança e das mensalidades da operadora própria (M56, etapa 3, F2): o que a tela da cobrança lê e grava,
// independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: as leituras de @sgh/legado em transação READ ONLY (o contrato, o produto e os beneficiários da F1 e as
//     cobranças da F2, todos SGH_OPE_*) e as gravações SGH_OPE_COBRANCA, SGH_OPE_COBRANCA_ITEM e SGH_OPE_REAJUSTE numa
//     transação SGH_ com a SGH_TRILHA junto; em dev sobre a cópia compartilhada, as gravações são recusadas
//     (`sghSoLeitura`), como nos outros módulos;
//   - `memoria`: a sessão sintética de dev/ci (E2E), sobre a porta da F1 em memória (os mesmos contratos e
//     beneficiários); nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Nenhuma tabela do sistema anterior é lida nem escrita.
import type {
  BaseMensalidadeLida,
  BeneficiarioBaseLido,
  CobrancaLida,
  CobrancaSgh,
  ContratoCobrancaLido,
  FiltroCobrancasSgh,
  ItemCobrancaLido,
  LinhaTrilha,
  OperadoraOpeLida,
  ReajusteOpeLido,
  ReajusteSgh,
  TotaisCobrancaLidos,
} from '@sgh/legado';

export const PORTA_COBRANCA_OPERADORA = Symbol('PORTA_COBRANCA_OPERADORA');

export interface ContextoCobranca {
  readonly rede: string;
  readonly hospital: string;
}

/** O que a gravação SGH_ da cobrança faz dentro da transação (com a trilha junto). */
export interface GravadorCobranca {
  incluir(c: CobrancaSgh & { readonly por: string }): Promise<{ id: number; versao: number }>;
  baixar(b: {
    id: number;
    versao: number;
    pagoEm: string;
    valorPago: number;
    multa: number;
    juros: number;
    dispensaMotivo: string | null;
    por: string;
  }): Promise<{ id: number; versao: number }>;
  cancelar(x: {
    id: number;
    versao: number;
    motivo: string;
    por: string;
  }): Promise<{ id: number; versao: number }>;
  estornar(x: {
    id: number;
    versao: number;
    motivo: string;
    por: string;
  }): Promise<{ id: number; versao: number }>;
  proximoAcordo(): Promise<number>;
  renegociar(x: { id: number; versao: number; contrato: number; acordo: number; por: string }): Promise<void>;
  notificar(x: {
    contrato: number;
    hoje: string;
    em: string;
    meio: string;
    referencia: string;
    por: string;
  }): Promise<{ cobrancas: number }>;
  registrarReajuste(r: ReajusteSgh & { readonly por: string }): Promise<{ id: number }>;
  cancelarReajuste(x: { id: number; motivo: string; por: string }): Promise<{ id: number }>;
}

export interface FiltroBaseMensalidades {
  readonly operadora: number;
  readonly competencia: string;
  readonly primeiroDia: string;
  readonly ultimoDia: string;
  readonly contrato?: number | null;
  readonly apos?: number | null;
}

export interface PortaCobrancaOperadora {
  readonly destino: 'legado' | 'memoria';
  /** A data de hoje no relógio do banco (AAAA-MM-DD). */
  hoje(c: ContextoCobranca): Promise<string>;
  operadoras(c: ContextoCobranca): Promise<OperadoraOpeLida[]>;
  baseMensalidades(
    c: ContextoCobranca,
    f: FiltroBaseMensalidades,
  ): Promise<{ itens: BaseMensalidadeLida[]; proxima: number | null }>;
  contrato(c: ContextoCobranca, id: number): Promise<ContratoCobrancaLido | null>;
  beneficiario(
    c: ContextoCobranca,
    id: number,
  ): Promise<(BeneficiarioBaseLido & { contrato: number }) | null>;
  titular(
    c: ContextoCobranca,
    contrato: number,
  ): Promise<{ id: number; nome: string; cpf: string | null } | null>;
  cobrancas(
    c: ContextoCobranca,
    f: FiltroCobrancasSgh,
  ): Promise<{ itens: CobrancaLida[]; proxima: number | null }>;
  cobranca(c: ContextoCobranca, id: number): Promise<CobrancaLida | null>;
  itens(c: ContextoCobranca, cobranca: number): Promise<ItemCobrancaLido[]>;
  renegociadas(c: ContextoCobranca, acordo: number): Promise<CobrancaLida[]>;
  /** As cobranças dos contratos com vencimento desde a data ou em aberto. */
  doContrato(c: ContextoCobranca, contratos: readonly number[], desde: string): Promise<CobrancaLida[]>;
  totais(c: ContextoCobranca, operadora: number, hoje: string): Promise<TotaisCobrancaLidos>;
  inadimplentes(
    c: ContextoCobranca,
    f: { operadora: number; hoje: string; apos?: number },
  ): Promise<{
    itens: { contrato: number; vencidas: number; valorVencido: number; maisAntigo: string }[];
    proxima: number | null;
  }>;
  reajustes(
    c: ContextoCobranca,
    f: { operadora: number; contrato?: number; apos?: number },
  ): Promise<{ itens: ReajusteOpeLido[]; proxima: number | null }>;
  reajuste(c: ContextoCobranca, id: number): Promise<ReajusteOpeLido | null>;
  situacaoReajuste(
    c: ContextoCobranca,
    contrato: number,
  ): Promise<{ vigentes: string[]; ultimaMensalidade: string | null; vidas: number }>;
  gravarSgh<T>(
    c: ContextoCobranca,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorCobranca) => Promise<T>,
  ): Promise<T>;
}

export const METODOS_PORTA_COBRANCA: ReadonlySet<string> = new Set([
  'hoje',
  'operadoras',
  'baseMensalidades',
  'contrato',
  'beneficiario',
  'titular',
  'cobrancas',
  'cobranca',
  'itens',
  'renegociadas',
  'doContrato',
  'totais',
  'inadimplentes',
  'reajustes',
  'reajuste',
  'situacaoReajuste',
  'gravarSgh',
]);
