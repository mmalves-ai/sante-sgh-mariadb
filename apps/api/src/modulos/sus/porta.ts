// Porta do faturamento SUS próprio (M51, etapas 1 a 4): as leituras da produção (contas da competência, itens com o
// vínculo SIGTAP, a SIGTAP por competência, CID e CNES) e as gravações do faturamento SUS (competência, crítica,
// arquivo, registros da CIHA, linhas do BPA e da APAC, AIH e equivalência), com a trilha na mesma transação.
//   - `banco`: a porta própria sobre o banco do cliente, pelo @sgh/nucleo (porta-propria.ts);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com massa sintética (nenhum dado de pessoa);
//   - indisponível: fora de dev/ci sem o núcleo: 503 (falha fechada).
import { type ApacRegistro, type ArquivoSus, type AtendimentoLaudoApacDados, type CompatibilidadeSigtap, type CompetenciaSusRegistro, type ContaBpa, type ContaCiha, type CriticaSus, type DominiosApacDados, type EquivalenciaSus, type EquivalenciaSusNomeada, type FiltroApacsPorta, type FiltroCriticasPorta, type FiltroEquivalenciasPorta, type FiltroLinhasBpaPorta, type HistoricoSigtap, type InstrumentoSusPorta, type ItemBpa, type ItemContaSigtap, type LinhaApac, type LinhaApacParaGravar, type LinhaBpa, type LinhaBpaParaGravar, type LinhaTrilhaSus, type MedicoSolicitante, type MudancaApac, type NovaApac, type NovaCriticaSus, type NovoArquivoSus, type ParametrosSusCadastro, type ProcedimentoHospital, type ProcedimentoSigtapRegra, type RegistroCihaParaGravar, type RegistroSigtap, type ResultadoGravacaoCriticas, type SolicitanteApacCadastro } from './tipos.js';
import { ErroProblema } from '../../problema.filter.js';
import type { GravacaoSusAih, LeituraSusAih } from './porta-aih.js';

export const PORTA_SUS = Symbol('PORTA_SUS');

export interface ContextoSus {
  readonly rede: string;
  readonly hospital: string;
  /** O estabelecimento da sessão no banco do cliente (sem ele, a porta própria resolve pelo código do hospital). */
  readonly estabelecimento?: number | null;
  /** O usuário da sessão (id numérico; null: conta sem id, como o administrador da plataforma). */
  readonly usuario?: number | null;
  readonly correlacao?: string;
}

/** Um atendimento da competência como a produção guarda (as contas parciais juntas) e os itens dele. */
export interface AtendimentoLido {
  readonly conta: ContaCiha;
  readonly contas: readonly number[];
  readonly itens: readonly ItemContaSigtap[];
}

/** O que a montagem da CIHA lê da produção numa competência. */
export interface DadosCihaLidos {
  readonly atendimentos: readonly AtendimentoLido[];
  readonly procedimentos: readonly ProcedimentoSigtapRegra[];
  readonly historico: readonly HistoricoSigtap[];
  readonly registros: readonly RegistroSigtap[];
  readonly cids: ReadonlySet<string>;
  readonly cnesCadastrados: readonly number[];
}

/** Um atendimento ambulatorial do SUS da competência (as contas parciais juntas) e os itens com o executante. */
export interface AtendimentoBpaLido {
  readonly conta: ContaBpa;
  readonly contas: readonly number[];
  readonly itens: readonly ItemBpa[];
}

/** O que a montagem do BPA lê da produção numa competência (etapa 2). */
export interface DadosBpaLidos {
  readonly atendimentos: readonly AtendimentoBpaLido[];
  readonly procedimentos: readonly ProcedimentoSigtapRegra[];
  readonly historico: readonly HistoricoSigtap[];
  readonly registros: readonly RegistroSigtap[];
  readonly compatibilidades: {
    readonly cids: readonly CompatibilidadeSigtap[];
    readonly cbos: readonly CompatibilidadeSigtap[];
    readonly habilitacoes: readonly CompatibilidadeSigtap[];
    readonly leitos: readonly CompatibilidadeSigtap[];
  };
  readonly cids: ReadonlySet<string>;
  readonly cnesCadastrados: readonly number[];
}

/** Etapa 4: a AIH, os leitos de UTI e o retorno do gestor entram pela LeituraSusAih e pela GravacaoSusAih. */
export interface LeituraSus extends LeituraSusAih {
  competencias(instrumento: InstrumentoSusPorta | null): Promise<CompetenciaSusRegistro[]>;
  competencia(
    instrumento: InstrumentoSusPorta,
    competencia: string,
    travar?: boolean,
  ): Promise<CompetenciaSusRegistro | null>;
  criticas(
    competencia: number,
    f: FiltroCriticasPorta,
  ): Promise<{ itens: CriticaSus[]; total: number; porRegra: Record<string, number> }>;
  critica(id: number): Promise<(CriticaSus & { competencia: number; convenio: number | null }) | null>;
  arquivos(instrumento: InstrumentoSusPorta, competencia: string | null): Promise<ArquivoSus[]>;
  arquivo(id: number): Promise<ArquivoSus | null>;
  /** As equivalências ativas (a montagem da CIHA). */
  equivalencias(): Promise<EquivalenciaSus[]>;
  /** A página da tela, com os nomes dos dois procedimentos. */
  paginaEquivalencias(
    f: FiltroEquivalenciasPorta,
  ): Promise<{ itens: EquivalenciaSusNomeada[]; total: number }>;
  sigtapPorCodigo(codigo: string): Promise<{ id: number; codigo: string; nome: string } | null>;
  buscarSigtap(
    termo: string,
    competencia: number | null,
  ): Promise<{ id: number; codigo: string; nome: string; vigente: boolean }[]>;
  buscarProcedimentosHospital(termo: string): Promise<ProcedimentoHospital[]>;
  procedimentosHospital(ids: readonly number[]): Promise<ProcedimentoHospital[]>;
  /** As contas não SUS com atendimento no intervalo, os itens, a SIGTAP dos vínculos e das equivalências, CID e CNES. */
  dadosCiha(
    intervalo: { readonly inicio: string; readonly fim: string },
    conveniosSus: readonly number[],
    sigtapExtra: readonly number[],
  ): Promise<DadosCihaLidos>;
  /** Etapa 2: as fichas ambulatoriais do SUS do intervalo, os itens com o executante, a SIGTAP e as compatibilidades. */
  dadosBpa(
    intervalo: { readonly inicio: string; readonly fim: string },
    conveniosSus: readonly number[],
    sigtapExtra: readonly number[],
  ): Promise<DadosBpaLidos>;
  linhasBpa(f: FiltroLinhasBpaPorta): Promise<{
    itens: LinhaBpa[];
    total: number;
    porTipo: Record<string, { linhas: number; quantidade: number }>;
  }>;
  buscarSolicitantes(termo: string): Promise<MedicoSolicitante[]>;
  parametrosCadastro(): Promise<ParametrosSusCadastro>;
  // Etapa 3: a APAC (o laudo, a autorização e a produção da competência).
  apac(id: number): Promise<ApacRegistro | null>;
  paginaApacs(
    f: FiltroApacsPorta,
  ): Promise<{ itens: ApacRegistro[]; total: number; porSituacao: Record<string, number> }>;
  apacsDaCompetencia(competencia: string): Promise<ApacRegistro[]>;
  /** A conta SUS (dos convênios SUS do estabelecimento) vem primeiro quando a ficha tem várias. */
  atendimentoLaudoApac(
    registro: number,
    conveniosSus: readonly number[],
  ): Promise<AtendimentoLaudoApacDados | null>;
  dominiosApac(): Promise<DominiosApacDados>;
  buscarSolicitantesApac(termo: string): Promise<SolicitanteApacCadastro[]>;
  solicitantesApacPorChave(chaves: readonly string[]): Promise<SolicitanteApacCadastro[]>;
  nomesSigtap(ids: readonly number[]): Promise<Map<number, string>>;
  linhasApac(f: {
    arquivo: number;
    pagina: number;
    porPagina: number;
  }): Promise<{ itens: LinhaApac[]; total: number; apacs: number; quantidade: number }>;
}

export interface GravacaoSus extends LeituraSus, GravacaoSusAih {
  abrir(p: {
    instrumento: InstrumentoSusPorta;
    competencia: string;
    por: string;
  }): Promise<CompetenciaSusRegistro>;
  fechar(c: { id: number; versao: number }, por: string): Promise<void>;
  reabrir(c: { id: number; versao: number }, por: string, justificativa: string): Promise<void>;
  gravarCriticas(
    c: { id: number; versao: number },
    criticas: readonly NovaCriticaSus[],
    contagens: { registros: number; cnes: string | null },
  ): Promise<ResultadoGravacaoCriticas>;
  justificar(c: { id: number; versao: number }, justificativa: string, por: string): Promise<void>;
  proximoArquivo(): Promise<number>;
  gravarArquivo(
    a: NovoArquivoSus,
    registros: readonly RegistroCihaParaGravar[],
  ): Promise<{ substituidos: number }>;
  gravarArquivoBpa(
    a: NovoArquivoSus,
    linhas: readonly LinhaBpaParaGravar[],
  ): Promise<{ substituidos: number }>;
  incluirApac(a: NovaApac): Promise<ApacRegistro>;
  mudarApac(p: {
    id: number;
    versao: number;
    por: string;
    mudanca: MudancaApac;
  }): Promise<{ antes: ApacRegistro; depois: ApacRegistro }>;
  gravarArquivoApac(
    a: NovoArquivoSus,
    linhas: readonly LinhaApacParaGravar[],
  ): Promise<{ substituidos: number }>;
  registrarEquivalencia(p: {
    procedimento: number;
    codigoProcedimento: number;
    sigtap: number;
    codigo: string;
    por: string;
    versao?: number | undefined;
  }): Promise<{ antes: EquivalenciaSus | null; depois: EquivalenciaSus; mudou: boolean }>;
  desativarEquivalencia(p: {
    procedimento: number;
    versao: number;
    por: string;
  }): Promise<{ antes: EquivalenciaSus; depois: EquivalenciaSus }>;
  /** A linha da trilha na mesma transação (na memória, o registrador da API). */
  trilha(linha: LinhaTrilhaSus): Promise<void>;
}

export interface PortaSus {
  readonly destino: 'banco' | 'memoria' | 'indisponivel';
  ler<T>(c: ContextoSus, fn: (l: LeituraSus) => Promise<T>): Promise<T>;
  /** Uma transação confirmada no fim (desfeita se `fn` falhar), com a trilha e o outbox nela. */
  gravar<T>(c: ContextoSus, fn: (g: GravacaoSus) => Promise<T>): Promise<T>;
}

/** Fora de dev/ci sem o núcleo: nada é lido nem gravado (503, falha fechada). */
export function portaSusIndisponivel(): PortaSus {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do cliente não está configurado: nada foi lido nem gravado.',
      ),
    );
  return { destino: 'indisponivel', ler: recusa, gravar: recusa };
}
