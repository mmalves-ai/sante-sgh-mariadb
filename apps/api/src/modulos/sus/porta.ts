// Porta do faturamento SUS próprio (M51, etapas 1 a 3): leituras READ ONLY do outro sistema (as contas não SUS da
// competência, os itens com o vínculo SIGTAP, a SIGTAP por competência, CID e CNES) e as gravações só SGH_ (competência,
// crítica, arquivo, registros da CIHA e equivalência), com a SGH_TRILHA na mesma transação.
//   - `legado`: @sgh/legado (lerSomente e gravarSgh, o escritor só SGH_);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com massa sintética (nenhum dado de pessoa);
//   - indisponível: fora de dev/ci sem o núcleo: 503 (falha fechada).
import type {
  ApacSghLinha,
  AtendimentoLaudoApacLido,
  DominiosApacLidos,
  FiltroApacsSgh,
  LinhaApacParaGravar,
  LinhaApacSgh,
  MudancaApacSgh,
  NovaApacSgh,
  SolicitanteApacLido,
  ArquivoSusLinha,
  CompatibilidadeSigtapLida,
  ContaBpaLida,
  FiltroLinhasBpaSgh,
  ItemBpaLido,
  LinhaBpaParaGravar,
  LinhaBpaSgh,
  MedicoSolicitanteLido,
  ParametrosSusLegado,
  CompetenciaSusLinha,
  ContaCihaLida,
  CriticaSusLinha,
  EquivalenciaSusLinha,
  EquivalenciaSusNomeada,
  FiltroCriticasSusSgh,
  FiltroEquivalenciasSusSgh,
  HistoricoSigtapLido,
  InstrumentoSusSgh,
  ItemSigtapLido,
  LinhaTrilha,
  NovaCriticaSus,
  NovoArquivoSus,
  ProcedimentoHospitalLido,
  ProcedimentoSigtapLido,
  RegistroCihaParaGravar,
  RegistroSigtapLido,
  ResultadoGravacaoCriticas,
} from '@sgh/legado';
import type { GravacaoSusAih, LeituraSusAih } from './porta-aih.js';

export const PORTA_SUS = Symbol('PORTA_SUS');

export interface ContextoSus {
  readonly rede: string;
  readonly hospital: string;
}

/** Um atendimento da competência como o outro sistema guarda (as contas parciais juntas) e os itens dele. */
export interface AtendimentoLido {
  readonly conta: ContaCihaLida;
  readonly contas: readonly number[];
  readonly itens: readonly ItemSigtapLido[];
}

/** O que a montagem da CIHA lê do outro sistema numa competência (nada disso é gravado no Sante). */
export interface DadosCihaLidos {
  readonly atendimentos: readonly AtendimentoLido[];
  readonly procedimentos: readonly ProcedimentoSigtapLido[];
  readonly historico: readonly HistoricoSigtapLido[];
  readonly registros: readonly RegistroSigtapLido[];
  readonly cids: ReadonlySet<string>;
  readonly cnesCadastrados: readonly number[];
}

/** Um atendimento ambulatorial do SUS da competência (as contas parciais juntas) e os itens com o executante. */
export interface AtendimentoBpaLido {
  readonly conta: ContaBpaLida;
  readonly contas: readonly number[];
  readonly itens: readonly ItemBpaLido[];
}

/** O que a montagem do BPA lê do outro sistema numa competência (etapa 2; nada disso é gravado no Sante). */
export interface DadosBpaLidos {
  readonly atendimentos: readonly AtendimentoBpaLido[];
  readonly procedimentos: readonly ProcedimentoSigtapLido[];
  readonly historico: readonly HistoricoSigtapLido[];
  readonly registros: readonly RegistroSigtapLido[];
  readonly compatibilidades: {
    readonly cids: readonly CompatibilidadeSigtapLida[];
    readonly cbos: readonly CompatibilidadeSigtapLida[];
    readonly habilitacoes: readonly CompatibilidadeSigtapLida[];
    readonly leitos: readonly CompatibilidadeSigtapLida[];
  };
  readonly cids: ReadonlySet<string>;
  readonly cnesCadastrados: readonly number[];
}

/** Etapa 4: a AIH, os leitos de UTI e o retorno do gestor entram pela LeituraSusAih e pela GravacaoSusAih. */
export interface LeituraSus extends LeituraSusAih {
  competencias(instrumento: InstrumentoSusSgh | null): Promise<CompetenciaSusLinha[]>;
  competencia(
    instrumento: InstrumentoSusSgh,
    competencia: string,
    travar?: boolean,
  ): Promise<CompetenciaSusLinha | null>;
  criticas(
    competencia: number,
    f: FiltroCriticasSusSgh,
  ): Promise<{ itens: CriticaSusLinha[]; total: number; porRegra: Record<string, number> }>;
  critica(id: number): Promise<(CriticaSusLinha & { competencia: number; convenio: number | null }) | null>;
  arquivos(instrumento: InstrumentoSusSgh, competencia: string | null): Promise<ArquivoSusLinha[]>;
  arquivo(id: number): Promise<ArquivoSusLinha | null>;
  /** As equivalências ativas (a montagem da CIHA). */
  equivalencias(): Promise<EquivalenciaSusLinha[]>;
  /** A página da tela, com os nomes dos dois procedimentos. */
  paginaEquivalencias(
    f: FiltroEquivalenciasSusSgh,
  ): Promise<{ itens: EquivalenciaSusNomeada[]; total: number }>;
  sigtapPorCodigo(codigo: string): Promise<{ id: number; codigo: string; nome: string } | null>;
  buscarSigtap(
    termo: string,
    competencia: number | null,
  ): Promise<{ id: number; codigo: string; nome: string; vigente: boolean }[]>;
  buscarProcedimentosHospital(termo: string): Promise<ProcedimentoHospitalLido[]>;
  procedimentosHospital(ids: readonly number[]): Promise<ProcedimentoHospitalLido[]>;
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
  linhasBpa(f: FiltroLinhasBpaSgh): Promise<{
    itens: LinhaBpaSgh[];
    total: number;
    porTipo: Record<string, { linhas: number; quantidade: number }>;
  }>;
  buscarSolicitantes(termo: string): Promise<MedicoSolicitanteLido[]>;
  parametrosLegado(): Promise<ParametrosSusLegado>;
  // Etapa 3: a APAC (o laudo, a autorização e a produção da competência).
  apac(id: number): Promise<ApacSghLinha | null>;
  paginaApacs(
    f: FiltroApacsSgh,
  ): Promise<{ itens: ApacSghLinha[]; total: number; porSituacao: Record<string, number> }>;
  apacsDaCompetencia(competencia: string): Promise<ApacSghLinha[]>;
  /** A conta SUS (dos convênios SUS do estabelecimento) vem primeiro quando a ficha tem várias. */
  atendimentoLaudoApac(
    registro: number,
    conveniosSus: readonly number[],
  ): Promise<AtendimentoLaudoApacLido | null>;
  dominiosApac(): Promise<DominiosApacLidos>;
  buscarSolicitantesApac(termo: string): Promise<SolicitanteApacLido[]>;
  solicitantesApacPorChave(chaves: readonly string[]): Promise<SolicitanteApacLido[]>;
  nomesSigtap(ids: readonly number[]): Promise<Map<number, string>>;
  linhasApac(f: {
    arquivo: number;
    pagina: number;
    porPagina: number;
  }): Promise<{ itens: LinhaApacSgh[]; total: number; apacs: number; quantidade: number }>;
}

export interface GravacaoSus extends LeituraSus, GravacaoSusAih {
  abrir(p: {
    instrumento: InstrumentoSusSgh;
    competencia: string;
    por: string;
  }): Promise<CompetenciaSusLinha>;
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
  incluirApac(a: NovaApacSgh): Promise<ApacSghLinha>;
  mudarApac(p: {
    id: number;
    versao: number;
    por: string;
    mudanca: MudancaApacSgh;
  }): Promise<{ antes: ApacSghLinha; depois: ApacSghLinha }>;
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
  }): Promise<{ antes: EquivalenciaSusLinha | null; depois: EquivalenciaSusLinha; mudou: boolean }>;
  desativarEquivalencia(p: {
    procedimento: number;
    versao: number;
    por: string;
  }): Promise<{ antes: EquivalenciaSusLinha; depois: EquivalenciaSusLinha }>;
  /** A linha da trilha na mesma transação (na memória, o registrador da API). */
  trilha(linha: LinhaTrilha): Promise<void>;
}

export interface PortaSus {
  readonly destino: 'legado' | 'memoria' | 'indisponivel';
  ler<T>(c: ContextoSus, fn: (l: LeituraSus) => Promise<T>): Promise<T>;
  /** Uma transação SGH_ confirmada no fim (desfeita se `fn` falhar). */
  gravar<T>(c: ContextoSus, fn: (g: GravacaoSus) => Promise<T>): Promise<T>;
}
