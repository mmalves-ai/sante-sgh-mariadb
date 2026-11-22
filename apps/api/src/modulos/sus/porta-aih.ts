// Porta do faturamento SUS próprio, etapa 4 (M51: AIH, leitos de UTI, espelho, retorno e glosa): as leituras
// da produção (a internação, a conta, a trajetória, os leitos de UTI habilitados, os lotes da saída de estoque, a
// SIGTAP e os valores) e as do faturamento SUS (faixa, AIH, linhas e retorno), e as gravações. As interfaces entram na
// LeituraSus e na GravacaoSus (a mesma transação da competência, da crítica, do arquivo e da trilha).
import {
  type AihRegistro,
  type CompatibilidadeSigtap,
  type FaixaAih,
  type FiltroAihsPorta,
  type FiltroRetornosPorta,
  type HistoricoSigtap,
  type InternacaoAih,
  type ItemAih,
  type ItemAihParaGravar,
  type ItemContaAih,
  type LoteSaida,
  type NovoArquivoSus,
  type PassagemLeito,
  type ProcedimentoSigtapRegra,
  type RegistroSigtap,
  type RetornoSus,
  type RetornoSusParaGravar,
  type ValorSigtap,
} from './tipos.js';

/** O médico solicitante SUS do laudo (pela chave do cadastro): nome, CNS e CRM (o documento só vai ao arquivo). */
export interface SolicitanteAihLido {
  readonly cpf: string;
  readonly nome: string;
  readonly cns: string | null;
}

/** O que a montagem da AIH lê da produção do estabelecimento. */
export interface DadosAihLidos {
  readonly internacoes: readonly InternacaoAih[];
  readonly itens: readonly ItemContaAih[];
  readonly passagens: readonly PassagemLeito[];
  readonly procedimentos: readonly ProcedimentoSigtapRegra[];
  readonly historico: readonly HistoricoSigtap[];
  readonly registros: readonly RegistroSigtap[];
  readonly compatibilidades: {
    readonly cids: readonly CompatibilidadeSigtap[];
    readonly cbos: readonly CompatibilidadeSigtap[];
    readonly habilitacoes: readonly CompatibilidadeSigtap[];
    readonly leitos: readonly CompatibilidadeSigtap[];
  };
  /** Os códigos SIGTAP pedidos (principal e diárias de UTI) com o ID e o nome. */
  readonly porCodigo: readonly { readonly id: number; readonly codigo: string; readonly nome: string }[];
  readonly cids: ReadonlySet<string>;
  readonly leitosUti: readonly { readonly tipo: number; readonly nome: string; readonly leitos: number }[];
  readonly cnesCadastrados: readonly number[];
}

export interface LeituraSusAih {
  /** A internação pelo registro, com a conta SUS escolhida pelos convênios SUS do estabelecimento. */
  internacaoAih(registro: number, conveniosSus: readonly number[]): Promise<InternacaoAih | null>;
  internacoesSus(
    intervalo: { readonly inicio: string; readonly fim: string },
    conveniosSus: readonly number[],
  ): Promise<{ registro: number; conta: number }[]>;
  /** A montagem das AIHs das internações: a conta, a trajetória, a SIGTAP dos itens e dos códigos, CID e leitos. */
  dadosAih(
    registros: readonly number[],
    codigos: readonly string[],
    sigtapExtra: readonly number[],
    conveniosSus: readonly number[],
  ): Promise<DadosAihLidos>;
  leitosUti(): Promise<{ tipo: number; nome: string; leitos: number }[]>;
  lotesSaida(registro: number): Promise<LoteSaida[]>;
  valoresSigtap(ids: readonly number[]): Promise<ValorSigtap[]>;
  solicitanteAih(cpf: string): Promise<SolicitanteAihLido | null>;
  faixasAih(): Promise<FaixaAih[]>;
  faixaAih(id: number, travar?: boolean): Promise<FaixaAih | null>;
  maiorNumeroDaFaixa(id: number): Promise<string | null>;
  numeroAihEmUso(numero: string): Promise<boolean>;
  aih(id: number, travar?: boolean): Promise<AihRegistro | null>;
  aihPorNumero(numero: string): Promise<AihRegistro | null>;
  aihsDasInternacoes(registros: readonly number[]): Promise<AihRegistro[]>;
  aihsParaApresentar(competencia: string): Promise<AihRegistro[]>;
  paginaAihs(
    f: FiltroAihsPorta,
  ): Promise<{ itens: AihRegistro[]; total: number; porSituacao: Record<string, number> }>;
  itensAih(id: number, fechamento: number): Promise<ItemAih[]>;
  linhaBpaDaCompetencia(
    competencia: string,
    p: { tipo: 'c' | 'i'; folha: number; sequencia: number },
  ): Promise<{ linha: number; arquivo: number; procedimento: string } | null>;
  paginaRetornos(f: FiltroRetornosPorta): Promise<{
    itens: RetornoSus[];
    total: number;
    porSituacao: Record<string, number>;
    valorGlosado: number;
  }>;
  retornoSus(id: number, travar?: boolean): Promise<RetornoSus | null>;
  ultimoRetornoDaAih(id: number): Promise<RetornoSus | null>;
}

export interface GravacaoSusAih {
  inserirFaixaAih(p: {
    inicio: bigint;
    fim: bigint;
    orgaoEmissor: string;
    dataLiberacao: string;
    por: string;
  }): Promise<number>;
  mudarFaixaAih(p: {
    id: number;
    versao: number;
    situacao: 'esgotada' | 'cancelada';
    justificativa: string | null;
    por: string;
  }): Promise<void>;
  inserirAih(p: {
    registro: number;
    prontuario: number | null;
    conta: number | null;
    atendimento: number | null;
    procedimentoSolicitado: string;
    cidPrincipal: string;
    cidSecundario: string | null;
    carater: string;
    solicitante: string;
    dataLaudo: string;
    justificativa: string;
    por: string;
  }): Promise<number>;
  autorizarAih(
    a: { id: number; versao: number },
    p: { faixa: number; numero: string; autorizador: string; dataAutorizacao: string; por: string },
  ): Promise<void>;
  negarAih(a: { id: number; versao: number }, justificativa: string, por: string): Promise<void>;
  reabrirAih(a: { id: number; versao: number }, justificativa: string, por: string): Promise<void>;
  cancelarAih(a: { id: number; versao: number }, justificativa: string, por: string): Promise<void>;
  fecharAih(
    a: { id: number; versao: number; fechamento: number },
    p: {
      procedimentoRealizado: string;
      permanencia: number;
      diariasUti: number;
      diariasUtiAnterior: number;
      itens: readonly ItemAihParaGravar[];
      por: string;
    },
  ): Promise<void>;
  gravarArquivoSisaih(
    a: NovoArquivoSus,
    aihs: readonly { id: number; versao: number }[],
  ): Promise<{ substituidos: number }>;
  inserirRetornoSus(r: RetornoSusParaGravar): Promise<number | null>;
  aplicarRetornoNaAih(aih: number, situacao: 'aprovada' | 'rejeitada', por: string): Promise<boolean>;
  tratarRetornoSus(
    r: { id: number; versao: number },
    p: { decisao: 'reapresentar' | 'aceita'; justificativa: string; por: string; aih: number | null },
  ): Promise<void>;
}
