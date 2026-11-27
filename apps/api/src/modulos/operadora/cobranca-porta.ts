// Porta da cobrança e das mensalidades da operadora própria (M56, etapa 3, F2): o que a tela da cobrança lê e grava,
// independente de onde:
//   - `banco`: a porta própria sobre o banco do cliente (fatura_plano, fatura_plano_item, reajuste_contrato_plano,
//     contrato_plano, beneficiario_plano), pelo @sgh/nucleo e o Executor;
//   - `memoria`: a sessão sintética de dev/ci (E2E), sobre a porta da F1 em memória;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Melhoria: o contexto é o do @sgh/nucleo (cliente, estabelecimento e usuário por id) e o estabelecimento de cada
// gravação vem da sessão, nunca da entrada.
import type { EventoCoparticipacao, RegraFranquia } from '@sgh/dominio-operadora';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  type DadosBaseMensalidade,
  type DadosBeneficiarioBase,
  type DadosCobranca,
  type DadosContratoCobranca,
  type DadosItemCobranca,
  type DadosOperadora,
  type DadosReajuste,
  type EntradaCobranca,
  type EntradaReajuste,
  type FiltroCobrancasPorta,
  type TotaisCobranca,
} from './dados-portas.js';

export const PORTA_COBRANCA_OPERADORA = Symbol('PORTA_COBRANCA_OPERADORA');

/** O contexto da sessão: o do núcleo (ids) mais a rede e o código do estabelecimento (exibição). */
export type ContextoCobranca = ContextoPorta;

/** O que a gravação da cobrança faz dentro da transação (com a trilha junto). */
export interface GravadorCobranca {
  incluir(c: EntradaCobranca & { readonly por: string }): Promise<{ id: number; versao: number }>;
  /**
   * A regra de coparticipação vigente na competência do evento e o que já foi lançado ao beneficiário no mês e no ano,
   * lidos dentro da transação com o beneficiário travado: dois lançamentos simultâneos não passam juntos do teto, e o
   * evento de competência passada usa a regra que valia nela, não a de hoje (08-SGO L98).
   */
  coparticipacaoTravada(x: {
    contrato: number;
    beneficiario: number;
    competencia: string;
    /** O escopo do evento (procedimento, grupo, tipo de guia, regime) para a regra mais específica (C2-116). */
    evento?: EventoCoparticipacao;
  }): Promise<{
    regra: DadosContratoCobranca['coparticipacao'];
    acumulado: { mes: number; ano: number };
  }>;
  /**
   * A regra de franquia vigente na data do evento (a do contrato prevalece sobre a do plano), o tipo de lançamento dos
   * itens dela e o que o beneficiário já acumulou na janela, lidos com o beneficiário travado (C2-116). Nulo: sem regra.
   */
  franquiaTravada(x: { contrato: number; beneficiario: number; dataEvento: string }): Promise<{
    regra: RegraFranquia & { readonly id: number; readonly codigo: string };
    lancamento: number;
    acumulado: number;
  } | null>;
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
  /**
   * O acordo de regularização num passo só: o acordo (contrato, data, valores e parcelas) e as cobranças renegociadas
   * (pela versão vista na tela, com os encargos de cada uma). Devolve o número do acordo; as parcelas entram depois pelo
   * `incluir`, com `acordoOrigem` igual a esse número.
   */
  registrarAcordo(x: AcordoParaGravar): Promise<{ acordo: number }>;
  notificar(x: {
    contrato: number;
    hoje: string;
    em: string;
    meio: string;
    referencia: string;
    por: string;
  }): Promise<{ cobrancas: number }>;
  registrarReajuste(r: EntradaReajuste & { readonly por: string }): Promise<{ id: number }>;
  cancelarReajuste(x: { id: number; versao?: number; motivo: string; por: string }): Promise<{ id: number }>;
}

/** O acordo calculado pelo domínio, com a versão vista de cada cobrança renegociada. */
export interface AcordoParaGravar {
  readonly contrato: number;
  /** A data do acordo (AAAA-MM-DD, a de hoje no banco). */
  readonly data: string;
  readonly principal: number;
  readonly encargos: number;
  readonly total: number;
  readonly cobrancas: readonly {
    readonly id: number;
    readonly versao: number;
    readonly valor: number;
    readonly multa: number;
    readonly juros: number;
  }[];
  readonly parcelas: readonly {
    readonly numero: number;
    readonly vencimento: string;
    readonly valor: number;
  }[];
  /** O motivo da dispensa dos encargos (nulo quando eles foram cobrados). */
  readonly dispensaMotivo: string | null;
  readonly por: string;
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
  readonly destino: 'banco' | 'memoria';
  /** A data de hoje no relógio do banco (AAAA-MM-DD). */
  hoje(c: ContextoCobranca): Promise<string>;
  operadoras(c: ContextoCobranca): Promise<DadosOperadora[]>;
  baseMensalidades(
    c: ContextoCobranca,
    f: FiltroBaseMensalidades,
  ): Promise<{ itens: DadosBaseMensalidade[]; proxima: number | null }>;
  contrato(c: ContextoCobranca, id: number): Promise<DadosContratoCobranca | null>;
  /**
   * A coparticipação já lançada ao beneficiário (cobranças não canceladas) na competência e no ano dela, para os tetos
   * mensal e anual da regra (08-SGO L98).
   */
  coparticipacaoAcumulada(
    c: ContextoCobranca,
    beneficiario: number,
    competencia: string,
  ): Promise<{ mes: number; ano: number }>;
  beneficiario(
    c: ContextoCobranca,
    id: number,
  ): Promise<(DadosBeneficiarioBase & { contrato: number }) | null>;
  titular(
    c: ContextoCobranca,
    contrato: number,
  ): Promise<{ id: number; nome: string; cpf: string | null } | null>;
  cobrancas(
    c: ContextoCobranca,
    f: FiltroCobrancasPorta,
  ): Promise<{ itens: DadosCobranca[]; proxima: number | null }>;
  cobranca(c: ContextoCobranca, id: number): Promise<DadosCobranca | null>;
  itens(c: ContextoCobranca, cobranca: number): Promise<DadosItemCobranca[]>;
  renegociadas(c: ContextoCobranca, acordo: number): Promise<DadosCobranca[]>;
  /** As cobranças dos contratos com vencimento desde a data ou em aberto. */
  doContrato(c: ContextoCobranca, contratos: readonly number[], desde: string): Promise<DadosCobranca[]>;
  totais(c: ContextoCobranca, operadora: number, hoje: string): Promise<TotaisCobranca>;
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
  ): Promise<{ itens: DadosReajuste[]; proxima: number | null }>;
  reajuste(c: ContextoCobranca, id: number): Promise<DadosReajuste | null>;
  situacaoReajuste(
    c: ContextoCobranca,
    contrato: number,
    competencia?: string,
  ): Promise<{
    vigentes: string[];
    ultimaMensalidade: string | null;
    vidas: number;
    /** C1-086: o teto da ANS cadastrado e vigente no primeiro dia da competência (só na porta do banco). */
    teto?: { id: number; percentual: number; protocolo: string | null } | null;
  }>;
  gravar<T>(
    c: ContextoCobranca,
    trilha: RegistroTrilhaTela | ((r: T) => RegistroTrilhaTela),
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
  'gravar',
]);
