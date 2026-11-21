// Porta da gestão de pessoas, fatia F1 (M52.1; ficha, seções 4 a 6): o que as telas de colaboradores leem e gravam,
// independente de onde (a API não escreve SQL; fronteira Nx):
//   - `banco`: o banco do cliente pelo @sgh/nucleo (porta-propria.ts): colaborador, vínculo de trabalho, dependentes,
//     inscrições no conselho, centros de custo e tipos de rescisão, com a trilha na mesma transação; o bloqueio do
//     acesso no desligamento pelo Executor (`acesso.bloquearUsuario`);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com pessoas, profissionais e usuários SINTÉTICOS; o bloqueio vale
//     no login sintético; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';
import type {
  CargoDoVinculo,
  ConferenciaHabilitacao,
  CorrecaoRegistrada,
  CorrecaoVinculo,
  DependenteColaborador,
  DesligamentoVinculo,
  EventoHistorico,
  FiltroVinculos,
  FimDependente,
  HabilitacaoRegistro,
  HistoricoVinculo,
  MudancaVinculo,
  NovoDependente,
  NovoVinculo,
  PessoaPorCpf,
  ProfissionalCadastro,
  RegistroDoColaborador,
  RetratoConselhoDia,
  UnidadeDoRegistro,
  UsuarioDaPessoa,
  VersaoDependente,
  VinculoColaborador,
} from './tipos-pessoas.js';

export type * from './tipos-pessoas.js';

export const PORTA_PESSOAS = Symbol('PORTA_PESSOAS');

export type ContextoPessoas = ContextoPortaM18;

export interface CentroCustoPessoas {
  readonly codigo: number;
  readonly nome: string;
  readonly ativo: boolean;
}

export interface OpcaoCodigo {
  readonly codigo: number;
  readonly nome: string;
}

/** W0-06: o cargo do quadro de cargos e salários que a ficha do colaborador mostra. */
export interface CargoQuadroLido {
  readonly id: number;
  readonly nome: string;
  readonly cbo: string;
  readonly ativo: boolean;
}

export interface RegistroConselhoBase {
  readonly registro: number;
  readonly profissional: number;
  readonly numero: number | null;
  readonly conselho: string | null;
}

/** As gravações da F1 numa transação só, com as releituras dentro dela (o estabelecimento vem do contexto). */
export interface GravadorPessoas {
  /** Releituras na transação (regra 1 e o controle de versão). */
  vinculo(id: number): Promise<VinculoColaborador | null>;
  vinculosPorCpf(cpfHmac: string): Promise<VinculoColaborador[]>;
  vinculosAtivosDoUsuario(usuario: number): Promise<{ id: number; pessoa: number }[]>;
  ultimaVigencia(vinculo: number): Promise<string | null>;
  incluirVinculo(v: NovoVinculo): Promise<{ id: number; pessoa: number }>;
  alterarVinculo(m: MudancaVinculo): Promise<void>;
  desligarVinculo(d: DesligamentoVinculo): Promise<void>;
  incluirHistorico(h: EventoHistorico): Promise<number>;
  incluirDependente(d: NovoDependente): Promise<number>;
  /** Fim do dependente em vigor do vínculo (0 linha: `desatualizado`). */
  encerrarDependente(d: FimDependente): Promise<void>;
  gravarHabilitacao(h: ConferenciaHabilitacao): Promise<{ id: number }>;
  /** W0-06: correção cadastral pela versão lida (nome, matrícula, tipo, admissão). */
  corrigirVinculo(c: CorrecaoVinculo): Promise<void>;
  /** W0-06 (5d-3a): o cargo do quadro relido na transação (ativo e do estabelecimento) e a ligação ao vínculo. */
  cargoQuadro(id: number): Promise<CargoQuadroLido | null>;
  ligarCargo(c: CargoDoVinculo): Promise<void>;
  /** W0-06: a versão em vigor do dependente acaba na véspera de `desde`; devolve o ID da versão nova. */
  versionarDependente(d: VersaoDependente): Promise<number>;
  /** W0-06: o valor anterior e o novo (só inclusão), sempre sob o vínculo. */
  registrarCorrecao(c: {
    vinculo: number;
    operacao: string;
    antes: Record<string, unknown>;
    depois: Record<string, unknown>;
    motivo: string;
    por: string;
  }): Promise<void>;
  /** Evento na saída de integração (outbox), na mesma transação (o M53 consome a admissão e o desligamento). */
  outbox(ev: { tipo: string; chave: string; carga: Record<string, string | number> }): Promise<string>;
}

export interface PortaPessoas extends PortaGravacaoM18<GravadorPessoas> {
  hoje(c: ContextoPessoas): Promise<string>;
  centrosDeCusto(c: ContextoPessoas): Promise<CentroCustoPessoas[]>;
  unidades(c: ContextoPessoas): Promise<OpcaoCodigo[]>;
  tiposRescisao(c: ContextoPessoas): Promise<OpcaoCodigo[]>;
  /** Profissionais e contas pelo CPF (filtro exato; o número só existe aqui e no adaptador). */
  pessoaPorCpf(c: ContextoPessoas, cpf: number): Promise<PessoaPorCpf>;
  usuariosDoProfissional(c: ContextoPessoas, profissional: number): Promise<UsuarioDaPessoa[]>;
  usuarioPorId(c: ContextoPessoas, id: number): Promise<UsuarioDaPessoa | null>;
  profissionais(c: ContextoPessoas, ids: readonly number[]): Promise<ProfissionalCadastro[]>;
  vinculosPorCpf(c: ContextoPessoas, cpfHmac: string): Promise<VinculoColaborador[]>;
  vinculo(c: ContextoPessoas, id: number): Promise<VinculoColaborador | null>;
  vinculosDaPessoa(c: ContextoPessoas, pessoa: number): Promise<VinculoColaborador[]>;
  listarVinculos(
    c: ContextoPessoas,
    f: FiltroVinculos,
  ): Promise<{ itens: VinculoColaborador[]; depois: number | null }>;
  historico(c: ContextoPessoas, vinculo: number): Promise<HistoricoVinculo[]>;
  dependentes(c: ContextoPessoas, vinculo: number): Promise<DependenteColaborador[]>;
  /** W0-06: correções do colaborador e alterações dos dependentes (sob o vínculo). */
  correcoes(c: ContextoPessoas, vinculo: number): Promise<CorrecaoRegistrada[]>;
  habilitacoes(c: ContextoPessoas, registros: readonly number[]): Promise<Map<number, HabilitacaoRegistro>>;
  registrosDosColaboradoresAtivos(c: ContextoPessoas): Promise<RegistroDoColaborador[]>;
  registroConselho(c: ContextoPessoas, registro: number): Promise<RegistroConselhoBase | null>;
  /** Onde o profissional atende, por registro do conselho. */
  unidadesDosRegistros(
    c: ContextoPessoas,
    registros: readonly number[],
  ): Promise<Map<number, UnidadeDoRegistro[]>>;
  ultimoRetrato(c: ContextoPessoas): Promise<RetratoConselhoDia | null>;
  /** W0-06 (5d-3a): o cargo do quadro ligado ao colaborador (outro estabelecimento: null). */
  cargoQuadro(c: ContextoPessoas, id: number): Promise<CargoQuadroLido | null>;
}

export const METODOS_PORTA_PESSOAS: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'hoje',
  'centrosDeCusto',
  'unidades',
  'tiposRescisao',
  'pessoaPorCpf',
  'usuariosDoProfissional',
  'usuarioPorId',
  'profissionais',
  'vinculosPorCpf',
  'vinculo',
  'vinculosDaPessoa',
  'listarVinculos',
  'historico',
  'dependentes',
  'correcoes',
  'habilitacoes',
  'registrosDosColaboradoresAtivos',
  'registroConselho',
  'unidadesDosRegistros',
  'ultimoRetrato',
  'cargoQuadro',
]);
