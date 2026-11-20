// Porta do cadastro (M11): o que as telas de pacientes, profissionais, solicitantes, pessoas e especialidades
// leem e gravam, independente de onde (a API não escreve SQL; fronteira):
//   - `legado`: o núcleo do legado (leituras READ ONLY dos repositórios de @sgh/legado; cadastro e alteração
//     pelo EXECUTOR do M04, com a trilha dupla na mesma transação; fila e consentimento por transação SGH_);
//   - `memoria`: a sessão sintética de dev/ci (E2E): pacientes, profissionais e domínios SINTÉTICOS em memória,
//     com as mesmas validações (Zod dos contratos) e as mesmas recusas; nada vai à cópia;
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AlterarPacienteEntrada,
  CadastrarPacienteEntrada,
  CadastrarSolicitanteEntrada,
  CampoBusca,
  EnderecoCep,
  EntidadeBusca,
  EstadoOperacao,
  UnificarPacienteEntrada,
} from '@sgh/contratos';
import type {
  ConsentimentoLido,
  ContextoOperacao,
  CriterioDireto,
  DadosProfissionalLidos,
  EventoProfissionalLido,
  LoginCandidatoLido,
  ExtrasFicha,
  FichaProfissionalLida,
  LinhaTrilha,
  IdsLidos,
  LiberacaoConsultada,
  OpcaoLida,
  OpcoesProfissionalLidas,
  PacienteLido,
  ParLido,
  ParNovo,
  PessoaLida,
  ProfissionalLido,
  SolicitanteLido,
  VersaoCadastroLida,
} from '@sgh/legado';

import type { OperacaoProfissionalTela } from './profissionais-memoria.js';

export const PORTA_CADASTRO = Symbol('PORTA_CADASTRO');

export interface ContextoPorta {
  readonly rede: string;
  readonly hospital: string;
}

export interface GravacaoFeita<T> {
  readonly resultado: T;
  readonly trilha: string | null;
}

export interface PortaCadastro {
  readonly destino: 'legado' | 'memoria';
  /** Estado da operação no catálogo neste estabelecimento. */
  estado(operacao: string, hospital: string): EstadoOperacao | null;
  /**
   * A operação grava agora para este login? O passo 0 do executor sem gravar (ambiente, estado, chave de
   * liberação da operação por estabelecimento, setor, grupo e pessoa; a sessão de dev sobre a cópia só lê).
   */
  podeGravar(c: ContextoPorta, operacao: string, usuarioLegado: string): Promise<LiberacaoConsultada>;

  // Pacientes: leituras.
  buscarDireto(
    c: ContextoPorta,
    criterio: CriterioDireto,
    inativos: boolean,
  ): Promise<{ pacientes: PacienteLido[]; truncado: boolean }>;
  idsPorPalavra(
    c: ContextoPorta,
    entidade: EntidadeBusca,
    campos: readonly CampoBusca[],
    palavra: string,
  ): Promise<IdsLidos>;
  idsPorFonetica(
    c: ContextoPorta,
    entidade: EntidadeBusca,
    campos: readonly CampoBusca[],
    fonetica: string,
    teto?: number,
  ): Promise<IdsLidos>;
  /** IDs com TODAS as palavras (consulta única no índice; até `teto`, acima disso `truncado`). */
  idsPorPalavras(
    c: ContextoPorta,
    entidade: EntidadeBusca,
    campos: readonly CampoBusca[],
    palavras: readonly string[],
    teto: number,
  ): Promise<{ ids: number[]; truncado: boolean }>;
  indiceTemLinhas(c: ContextoPorta, entidade: EntidadeBusca): Promise<boolean>;
  lerPacientes(c: ContextoPorta, ids: readonly number[]): Promise<PacienteLido[]>;
  extrasDaFicha(c: ContextoPorta, p: PacienteLido): Promise<ExtrasFicha>;
  historico(
    c: ContextoPorta,
    id: number,
    pagina: number,
    porPagina: number,
  ): Promise<{ versoes: VersaoCadastroLida[]; total: number; anterior: VersaoCadastroLida | null }>;
  unificacoes(
    c: ContextoPorta,
    id: number,
  ): Promise<{ absorvido: number; sobrevivente: number; em: string | null }[]>;
  homonimos(c: ContextoPorta, ids: readonly number[]): Promise<Set<number>>;
  candidatosPorCpf(c: ContextoPorta, cpf: number): Promise<PacienteLido[]>;
  cepExiste(c: ContextoPorta, cep: string): Promise<boolean>;
  /** Endereço do CEP (cadastro de CEPs do estabelecimento), ou null. */
  lerCep(c: ContextoPorta, cep: string): Promise<EnderecoCep | null>;

  // Pacientes: gravações pelo executor (memória: as mesmas regras).
  cadastrar(
    c: ContextoPorta,
    entrada: CadastrarPacienteEntrada,
    ctx: ContextoOperacao,
  ): Promise<GravacaoFeita<{ idPaciente: number; prontuario: number }>>;
  alterar(
    c: ContextoPorta,
    entrada: AlterarPacienteEntrada,
    ctx: ContextoOperacao,
  ): Promise<GravacaoFeita<{ idPaciente: number }>>;
  /**
   * M57.2: unificação de prontuários duplicados do mesmo estabelecimento (executor: cadastro.unificarPaciente; a fila de
   * duplicidades registra junto, na mesma transação).
   */
  unificar(
    c: ContextoPorta,
    entrada: UnificarPacienteEntrada,
    ctx: ContextoOperacao,
  ): Promise<GravacaoFeita<{ idAbsorvido: number; idSobrevivente: number }>>;

  // Fila de duplicidades (SGH_CAD_DUPLICIDADE).
  gruposCandidatos(c: ContextoPorta): Promise<{ cpf: number[][]; fonetica: number[][] }>;
  lerFila(
    c: ContextoPorta,
    situacao: ParLido['situacao'],
    pagina: number,
    porPagina: number,
  ): Promise<{ itens: ParLido[]; total: number }>;
  lerPar(c: ContextoPorta, id: number): Promise<ParLido | null>;
  /** As gravações SGH_ levam a linha da SGH_TRILHA (no núcleo, na MESMA transação; na memória, ignorada). */
  gravarPares(
    c: ContextoPorta,
    pares: readonly ParNovo[],
    inativos: readonly number[],
    trilha: LinhaTrilha,
  ): Promise<number>;
  decidirOutraPessoa(
    c: ContextoPorta,
    id: number,
    usuario: string,
    justificativa: string,
    trilha: LinhaTrilha,
  ): Promise<{ a: number; b: number }>;

  // Consentimentos (SGH_CAD_CONSENTIMENTO e domínios do legado).
  opcoesConsentimento(
    c: ContextoPorta,
  ): Promise<{ situacoes: OpcaoLida[]; signatarios: OpcaoLida[]; revogacoes: OpcaoLida[] }>;
  consentimentos(c: ContextoPorta, id: number): Promise<ConsentimentoLido[]>;
  registrarConsentimento(
    c: ContextoPorta,
    r: {
      idPaciente: number;
      pront: number;
      finalidade: string;
      versao: string;
      situacao: number;
      signatario: number;
      usuario: string;
    },
    trilha: LinhaTrilha,
  ): Promise<number>;
  revogarConsentimento(
    c: ContextoPorta,
    r: { idPaciente: number; id: number; motivo: number; usuario: string },
    trilha: LinhaTrilha,
  ): Promise<void>;

  // Profissionais, solicitantes, pessoas, especialidades.
  listarProfissionais(c: ContextoPorta, ids?: readonly number[]): Promise<ProfissionalLido[]>;
  fichaProfissional(c: ContextoPorta, id: number): Promise<FichaProfissionalLida | null>;
  historicoProfissional(
    c: ContextoPorta,
    id: number,
    pagina: number,
    porPagina: number,
  ): Promise<{
    versoes: VersaoCadastroLida[];
    total: number;
    anterior: VersaoCadastroLida | null;
    nome: string | null;
  }>;
  listarSolicitantes(
    c: ContextoPorta,
    ids?: readonly number[],
  ): Promise<{ itens: SolicitanteLido[]; truncado: boolean }>;
  /** Solicitantes pelo registro: número do conselho e, quando informados, a sigla do conselho e a UF. */
  solicitantesPorRegistro(
    c: ContextoPorta,
    r: { numero: number; conselho?: string | null; uf?: string | null },
  ): Promise<{ itens: SolicitanteLido[]; truncado: boolean }>;
  chavesRepetidasSolicitante(c: ContextoPorta): Promise<Set<string>>;
  buscarPessoas(c: ContextoPorta, documento: string): Promise<PessoaLida[]>;
  siglasDosConselhos(c: ContextoPorta): Promise<{ conselho: number; sigla: string; nome: string | null }[]>;
  /** Revisão do M39: o conselho (ID do cadastro de conselhos) pela sigla, ou null. */
  conselhoPorSigla(c: ContextoPorta, sigla: string): Promise<number | null>;
  /** Revisão do M39: a inclusão do médico solicitante externo pelo executor (`cadastro.cadastrarSolicitante`). */
  cadastrarSolicitante(
    c: ContextoPorta,
    entrada: CadastrarSolicitanteEntrada,
    ctx: ContextoOperacao,
  ): Promise<GravacaoFeita<{ solicitante: number }>>;
  /** D-PROF-39: os dados editáveis do profissional e a versão (sem documento nem dado bancário). */
  dadosProfissional(c: ContextoPorta, id: number): Promise<DadosProfissionalLidos | null>;
  /** D-PROF-39: as listas dos combos da edição do profissional. */
  opcoesProfissional(c: ContextoPorta): Promise<OpcoesProfissionalLidas>;
  /** D-PROF-39: uma das sete gravações do profissional pelo executor (na memória, as mesmas regras). */
  gravarProfissional(
    c: ContextoPorta,
    operacao: OperacaoProfissionalTela,
    entrada: unknown,
    ctx: ContextoOperacao,
  ): Promise<GravacaoFeita<Record<string, number>>>;
  /** D-PROF-39: os logins ativos com o papel Operador de sistema e o profissional a que cada um está ligado. */
  loginsProfissional(c: ContextoPorta): Promise<readonly LoginCandidatoLido[]>;
  /** D-PROF-39: o login ligado a cada registro do profissional. */
  loginsDosRegistros(c: ContextoPorta, id: number): Promise<readonly { registro: number; login: string }[]>;
  /** D-PROF-39: o histórico do vínculo com o login e da situação. */
  eventosProfissional(c: ContextoPorta, id: number): Promise<readonly EventoProfissionalLido[]>;
  /** D-PROF-39: os vínculos (grupo de produto e quantidade) que impedem a exclusão do profissional ou do registro. */
  vinculosProfissional(
    c: ContextoPorta,
    id: number,
    registro?: number,
  ): Promise<readonly { grupo: string; quantidade: number }[]>;
  procedimentosDaEspecialidade(
    c: ContextoPorta,
    especialidade: number,
    pagina: number,
    porPagina: number,
  ): Promise<{ itens: { procedimento: number; descricao: string | null }[]; total: number }>;
}
