// Porta do cadastro (M11): o que as telas de pacientes, profissionais, solicitantes, pessoas e especialidades
// leem e gravam, independente de onde (a API não escreve SQL fora das portas próprias):
//   - `banco`: a porta própria sobre o MariaDB do cliente (porta-propria.ts), pelo @sgh/nucleo: leituras somente
//     leitura; gravações pelo Executor, com trilha, outbox e idempotência na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E): pacientes, profissionais e domínios SINTÉTICOS em memória,
//     com as mesmas validações (Zod dos contratos) e as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AlterarPacienteEntrada,
  CadastrarPacienteEntrada,
  CadastrarSolicitanteEntrada,
  CampoBusca,
  EnderecoCep,
  EntidadeBusca,
  EstadoOperacao,
  UnificarPacienteEntrada,
  DesfazerUnificacaoEntrada,
} from '@sgh/contratos';
import type { ContextoNucleo } from '@sgh/nucleo';
import { ErroProblema } from '../../problema.filter.js';
import type { OperacaoProfissionalTela } from './profissionais-memoria.js';
import type {
  ConsentimentoPaciente,
  ContextoGravacao,
  CriterioBuscaDireta,
  DadosProfissional,
  DestinoPorta,
  EventoVinculoProfissional,
  ExtrasFicha,
  FichaProfissionalCadastro,
  IdsEncontrados,
  LiberacaoOperacao,
  LoginCandidato,
  OpcaoDominio,
  OpcoesEdicaoProfissional,
  PacienteFicha,
  ParCandidato,
  ParFila,
  PessoaEncontrada,
  ProfissionalCadastro,
  RegistroTrilhaTela,
  SolicitanteCadastro,
  VersaoCadastro,
} from './tipos.js';

export const PORTA_CADASTRO = Symbol('PORTA_CADASTRO');

/**
 * Contexto da porta: o do núcleo (cliente, estabelecimento e usuário por id, correlação) mais a rede e o código do
 * estabelecimento da sessão (a memória separa os dados sintéticos por estabelecimento pelo código).
 */
export interface ContextoPorta extends ContextoNucleo {
  readonly rede: string;
  readonly hospital: string;
}

/** O estado de cada operação no catálogo do estabelecimento (memória de dev/ci). */
export interface EstadoCatalogo {
  estado(operacao: string, hospital: string): EstadoOperacao | null;
}

export interface GravacaoFeita<T> {
  readonly resultado: T;
  /** Id da linha da trilha (null na memória). */
  readonly trilha: number | null;
}

export interface PortaCadastro {
  readonly destino: DestinoPorta;
  /** Estado da operação no catálogo neste estabelecimento. */
  estado(operacao: string, hospital: string): EstadoOperacao | null;
  /**
   * A operação grava agora para este login? O passo 0 do executor sem gravar (ambiente, estado, chave de
   * liberação da operação por estabelecimento, setor, grupo e pessoa; a sessão de dev sobre a cópia só lê).
   */
  podeGravar(c: ContextoPorta, operacao: string, login?: string): Promise<LiberacaoOperacao>;
  /** A versão opaca que vai à tela (sem verDocumento, sem documento dentro dela). */
  versaoParaTela(versao: string, verDocumento: boolean): string;

  // Pacientes: leituras.
  buscarDireto(
    c: ContextoPorta,
    criterio: CriterioBuscaDireta,
    inativos: boolean,
  ): Promise<{ pacientes: PacienteFicha[]; truncado: boolean }>;
  idsPorPalavra(
    c: ContextoPorta,
    entidade: EntidadeBusca,
    campos: readonly CampoBusca[],
    palavra: string,
  ): Promise<IdsEncontrados>;
  idsPorFonetica(
    c: ContextoPorta,
    entidade: EntidadeBusca,
    campos: readonly CampoBusca[],
    fonetica: string,
    teto?: number,
  ): Promise<IdsEncontrados>;
  /** IDs com TODAS as palavras (consulta única no índice; até `teto`, acima disso `truncado`). */
  idsPorPalavras(
    c: ContextoPorta,
    entidade: EntidadeBusca,
    campos: readonly CampoBusca[],
    palavras: readonly string[],
    teto: number,
  ): Promise<{ ids: number[]; truncado: boolean }>;
  indiceTemLinhas(c: ContextoPorta, entidade: EntidadeBusca): Promise<boolean>;
  lerPacientes(c: ContextoPorta, ids: readonly number[]): Promise<PacienteFicha[]>;
  extrasDaFicha(c: ContextoPorta, p: PacienteFicha): Promise<ExtrasFicha>;
  historico(
    c: ContextoPorta,
    id: number,
    pagina: number,
    porPagina: number,
  ): Promise<{ versoes: VersaoCadastro[]; total: number; anterior: VersaoCadastro | null }>;
  unificacoes(
    c: ContextoPorta,
    id: number,
  ): Promise<{ absorvido: number; sobrevivente: number; em: string | null }[]>;
  homonimos(c: ContextoPorta, ids: readonly number[]): Promise<Set<number>>;
  candidatosPorCpf(c: ContextoPorta, cpf: number): Promise<PacienteFicha[]>;
  cepExiste(c: ContextoPorta, cep: string): Promise<boolean>;
  /** Endereço do CEP (cadastro de CEPs do estabelecimento), ou null. */
  lerCep(c: ContextoPorta, cep: string): Promise<EnderecoCep | null>;

  // Pacientes: gravações pelo executor (memória: as mesmas regras).
  cadastrar(
    c: ContextoPorta,
    entrada: CadastrarPacienteEntrada,
    ctx: ContextoGravacao,
  ): Promise<GravacaoFeita<{ idPaciente: number; prontuario: number }>>;
  alterar(
    c: ContextoPorta,
    entrada: AlterarPacienteEntrada,
    ctx: ContextoGravacao,
  ): Promise<GravacaoFeita<{ idPaciente: number }>>;
  /**
   * M57.2: unificação de prontuários duplicados do mesmo estabelecimento (executor: cadastro.unificarPaciente; a fila de
   * duplicidades registra junto, na mesma transação).
   */
  unificar(
    c: ContextoPorta,
    entrada: UnificarPacienteEntrada,
    ctx: ContextoGravacao,
  ): Promise<GravacaoFeita<{ idAbsorvido: number; idSobrevivente: number }>>;
  /** F3.1: desfaz uma unificação registrada (os registros voltam ao absorvido, que é reativado), com motivo. */
  desfazerUnificacao(
    c: ContextoPorta,
    entrada: DesfazerUnificacaoEntrada,
    ctx: ContextoGravacao,
  ): Promise<GravacaoFeita<{ idAbsorvido: number; idSobrevivente: number }>>;

  // Fila de duplicidades.
  gruposCandidatos(c: ContextoPorta): Promise<{ cpf: number[][]; fonetica: number[][] }>;
  lerFila(
    c: ContextoPorta,
    situacao: ParFila['situacao'],
    pagina: number,
    porPagina: number,
  ): Promise<{ itens: ParFila[]; total: number }>;
  lerPar(c: ContextoPorta, id: number): Promise<ParFila | null>;
  /** As gravações diretas levam a linha da trilha (no banco, na MESMA transação; na memória, ignorada). */
  gravarPares(
    c: ContextoPorta,
    pares: readonly ParCandidato[],
    inativos: readonly number[],
    trilha: RegistroTrilhaTela,
  ): Promise<number>;
  decidirOutraPessoa(
    c: ContextoPorta,
    id: number,
    usuario: string,
    justificativa: string,
    trilha: RegistroTrilhaTela,
  ): Promise<{ a: number; b: number }>;

  // Consentimentos.
  opcoesConsentimento(
    c: ContextoPorta,
  ): Promise<{ situacoes: OpcaoDominio[]; signatarios: OpcaoDominio[]; revogacoes: OpcaoDominio[] }>;
  consentimentos(c: ContextoPorta, id: number): Promise<ConsentimentoPaciente[]>;
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
    trilha: RegistroTrilhaTela,
  ): Promise<number>;
  revogarConsentimento(
    c: ContextoPorta,
    r: { idPaciente: number; id: number; motivo: number; usuario: string },
    trilha: RegistroTrilhaTela,
  ): Promise<void>;

  // Profissionais, solicitantes, pessoas, especialidades.
  listarProfissionais(c: ContextoPorta, ids?: readonly number[]): Promise<ProfissionalCadastro[]>;
  fichaProfissional(c: ContextoPorta, id: number): Promise<FichaProfissionalCadastro | null>;
  historicoProfissional(
    c: ContextoPorta,
    id: number,
    pagina: number,
    porPagina: number,
  ): Promise<{
    versoes: VersaoCadastro[];
    total: number;
    anterior: VersaoCadastro | null;
    nome: string | null;
  }>;
  listarSolicitantes(
    c: ContextoPorta,
    ids?: readonly number[],
  ): Promise<{ itens: SolicitanteCadastro[]; truncado: boolean }>;
  /** Solicitantes pelo registro: número do conselho e, quando informados, a sigla do conselho e a UF. */
  solicitantesPorRegistro(
    c: ContextoPorta,
    r: { numero: number; conselho?: string | null; uf?: string | null },
  ): Promise<{ itens: SolicitanteCadastro[]; truncado: boolean }>;
  chavesRepetidasSolicitante(c: ContextoPorta): Promise<Set<string>>;
  buscarPessoas(c: ContextoPorta, documento: string): Promise<PessoaEncontrada[]>;
  siglasDosConselhos(c: ContextoPorta): Promise<{ conselho: number; sigla: string; nome: string | null }[]>;
  /** Revisão do M39: o conselho (ID do cadastro de conselhos) pela sigla, ou null. */
  conselhoPorSigla(c: ContextoPorta, sigla: string): Promise<number | null>;
  /** Revisão do M39: a inclusão do médico solicitante externo pelo executor (`cadastro.cadastrarSolicitante`). */
  cadastrarSolicitante(
    c: ContextoPorta,
    entrada: CadastrarSolicitanteEntrada,
    ctx: ContextoGravacao,
  ): Promise<GravacaoFeita<{ solicitante: number }>>;
  /** D-PROF-39: os dados editáveis do profissional e a versão (sem documento nem dado bancário). */
  dadosProfissional(c: ContextoPorta, id: number): Promise<DadosProfissional | null>;
  /** D-PROF-39: as listas dos combos da edição do profissional. */
  opcoesProfissional(c: ContextoPorta): Promise<OpcoesEdicaoProfissional>;
  /** D-PROF-39: uma das sete gravações do profissional pelo executor (na memória, as mesmas regras). */
  gravarProfissional(
    c: ContextoPorta,
    operacao: OperacaoProfissionalTela,
    entrada: unknown,
    ctx: ContextoGravacao,
  ): Promise<GravacaoFeita<Record<string, number>>>;
  /** D-PROF-39: os logins ativos com o papel Operador de sistema e o profissional a que cada um está ligado. */
  loginsProfissional(c: ContextoPorta): Promise<readonly LoginCandidato[]>;
  /** D-PROF-39: o login ligado a cada registro do profissional. */
  loginsDosRegistros(c: ContextoPorta, id: number): Promise<readonly { registro: number; login: string }[]>;
  /** D-PROF-39: o histórico do vínculo com o login e da situação. */
  eventosProfissional(c: ContextoPorta, id: number): Promise<readonly EventoVinculoProfissional[]>;
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

/** Os métodos da porta (a indisponível recusa todos). */
const METODOS_PORTA_CADASTRO = [
  'buscarDireto',
  'idsPorPalavra',
  'idsPorFonetica',
  'idsPorPalavras',
  'indiceTemLinhas',
  'lerPacientes',
  'extrasDaFicha',
  'historico',
  'unificacoes',
  'homonimos',
  'candidatosPorCpf',
  'cepExiste',
  'lerCep',
  'cadastrar',
  'alterar',
  'unificar',
  'desfazerUnificacao',
  'gruposCandidatos',
  'lerFila',
  'lerPar',
  'gravarPares',
  'decidirOutraPessoa',
  'opcoesConsentimento',
  'consentimentos',
  'registrarConsentimento',
  'revogarConsentimento',
  'listarProfissionais',
  'fichaProfissional',
  'historicoProfissional',
  'listarSolicitantes',
  'solicitantesPorRegistro',
  'chavesRepetidasSolicitante',
  'buscarPessoas',
  'siglasDosConselhos',
  'conselhoPorSigla',
  'cadastrarSolicitante',
  'dadosProfissional',
  'opcoesProfissional',
  'gravarProfissional',
  'loginsProfissional',
  'loginsDosRegistros',
  'eventosProfissional',
  'vinculosProfissional',
  'procedimentosDaEspecialidade',
] as const;

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaCadastroIndisponivel(): PortaCadastro {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
      ),
    );
  const base = {
    destino: 'banco' as const,
    estado: (): EstadoOperacao | null => null,
    versaoParaTela: (v: string) => v,
    podeGravar: async (): Promise<LiberacaoOperacao> => ({
      pode: false,
      codigo: 'indisponivel',
      motivo: 'O banco do estabelecimento não está configurado: nada é gravado.',
    }),
  };
  return Object.assign(
    base,
    Object.fromEntries(METODOS_PORTA_CADASTRO.map((m) => [m, recusa])),
  ) as unknown as PortaCadastro;
}
