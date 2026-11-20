// Porta da gestão de pessoas, fatia F1 (M52.1; ficha, seções 4 a 6): o que as telas de colaboradores leem e gravam,
// independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: as leituras de @sgh/legado em transação READ ONLY no banco do estabelecimento (TBPROFIS e TBUSERS pelo
//     CPF como filtro exato, os registros do conselho, os centros de custo, as unidades e os tipos de rescisão; e
//     SGH_PES_*); as gravações SGH_ numa transação só SGH_ com a SGH_TRILHA junto; o bloqueio do acesso pelo EXECUTOR
//     (`acesso.bloquearUsuario`, cenário `desligamento`);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com pessoas, profissionais e usuários SINTÉTICOS; o bloqueio vale
//     no login sintético; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type {
  CargoDoVinculoSgh,
  ConselhoDiaSgh,
  CorrecaoPesLida,
  CorrecaoVinculoSgh,
  DependentePesLido,
  DesligamentoSgh,
  EventoHistoricoSgh,
  FiltroVinculosSgh,
  FimDependenteSgh,
  HabilitacaoPesLida,
  HabilitacaoSgh,
  HistoricoPesLido,
  MudancaVinculoSgh,
  NovoDependenteSgh,
  NovoVinculoSgh,
  PessoaLidaPorCpf,
  ProfissionalLido,
  RegistroDoColaboradorLido,
  UnidadeDoRegistroLida,
  UsuarioLidoPessoa,
  VersaoDependenteSgh,
  VinculoPesLido,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

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

/** W0-06: o cargo do quadro de cargos e salários (SGH_PES_CARGO) que a ficha do colaborador mostra. */
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

/** As gravações SGH_ da F1 numa transação só SGH_, com as releituras dentro dela (o estabelecimento vem do contexto). */
export interface GravadorPessoas {
  /** Releituras na transação (regra 1 e o controle de versão). */
  vinculo(id: number): Promise<VinculoPesLido | null>;
  vinculosPorCpf(cpfHmac: string): Promise<VinculoPesLido[]>;
  vinculosAtivosDoUsuario(usuario: number): Promise<{ id: number; pessoa: number }[]>;
  ultimaVigencia(vinculo: number): Promise<string | null>;
  incluirVinculo(v: Omit<NovoVinculoSgh, 'hospital'>): Promise<{ id: number; pessoa: number }>;
  alterarVinculo(m: Omit<MudancaVinculoSgh, 'hospital'>): Promise<void>;
  desligarVinculo(d: Omit<DesligamentoSgh, 'hospital'>): Promise<void>;
  incluirHistorico(h: Omit<EventoHistoricoSgh, 'hospital'>): Promise<number>;
  incluirDependente(d: Omit<NovoDependenteSgh, 'hospital'>): Promise<number>;
  /** Fim do dependente em vigor do vínculo (0 linha: `desatualizado`). */
  encerrarDependente(d: Omit<FimDependenteSgh, 'hospital'>): Promise<void>;
  gravarHabilitacao(h: Omit<HabilitacaoSgh, 'hospital'>): Promise<{ id: number }>;
  /** W0-06: correção cadastral pela versão lida (nome, matrícula, tipo, admissão). */
  corrigirVinculo(c: Omit<CorrecaoVinculoSgh, 'hospital'>): Promise<void>;
  /** W0-06 (5d-3a): o cargo do quadro relido na transação (ativo e do estabelecimento) e a ligação ao vínculo. */
  cargoQuadro(id: number): Promise<CargoQuadroLido | null>;
  ligarCargo(c: Omit<CargoDoVinculoSgh, 'hospital'>): Promise<void>;
  /** W0-06: a versão em vigor do dependente acaba na véspera de `desde`; devolve o ID da versão nova. */
  versionarDependente(d: Omit<VersaoDependenteSgh, 'hospital'>): Promise<number>;
  /** W0-06: o valor anterior e o novo (SGH_PES_CORRECAO, só inclusão), sempre sob o vínculo. */
  registrarCorrecao(c: {
    vinculo: number;
    operacao: string;
    antes: Record<string, unknown>;
    depois: Record<string, unknown>;
    motivo: string;
    por: string;
  }): Promise<void>;
  /** Evento na SGH_OUTBOX, na mesma transação (o M53 consome a admissão e o desligamento). */
  outbox(ev: { tipo: string; chave: string; carga: Record<string, string | number> }): Promise<string>;
}

export interface PortaPessoas extends PortaGravacaoM18<GravadorPessoas> {
  hoje(c: ContextoPessoas): Promise<string>;
  centrosDeCusto(c: ContextoPessoas): Promise<CentroCustoPessoas[]>;
  unidades(c: ContextoPessoas): Promise<OpcaoCodigo[]>;
  tiposRescisao(c: ContextoPessoas): Promise<OpcaoCodigo[]>;
  /** TBPROFIS e TBUSERS pelo CPF (filtro exato; o número só existe aqui e no adaptador). */
  pessoaPorCpf(c: ContextoPessoas, cpf: number): Promise<PessoaLidaPorCpf>;
  usuariosDoProfissional(c: ContextoPessoas, profissional: number): Promise<UsuarioLidoPessoa[]>;
  usuarioPorId(c: ContextoPessoas, id: number): Promise<UsuarioLidoPessoa | null>;
  profissionais(c: ContextoPessoas, ids: readonly number[]): Promise<ProfissionalLido[]>;
  vinculosPorCpf(c: ContextoPessoas, cpfHmac: string): Promise<VinculoPesLido[]>;
  vinculo(c: ContextoPessoas, id: number): Promise<VinculoPesLido | null>;
  vinculosDaPessoa(c: ContextoPessoas, pessoa: number): Promise<VinculoPesLido[]>;
  listarVinculos(
    c: ContextoPessoas,
    f: FiltroVinculosSgh,
  ): Promise<{ itens: VinculoPesLido[]; depois: number | null }>;
  historico(c: ContextoPessoas, vinculo: number): Promise<HistoricoPesLido[]>;
  dependentes(c: ContextoPessoas, vinculo: number): Promise<DependentePesLido[]>;
  /** W0-06: correções do colaborador e alterações dos dependentes (SGH_PES_CORRECAO sob o vínculo). */
  correcoes(c: ContextoPessoas, vinculo: number): Promise<CorrecaoPesLida[]>;
  habilitacoes(c: ContextoPessoas, registros: readonly number[]): Promise<Map<number, HabilitacaoPesLida>>;
  registrosDosColaboradoresAtivos(c: ContextoPessoas): Promise<RegistroDoColaboradorLido[]>;
  registroConselho(c: ContextoPessoas, registro: number): Promise<RegistroConselhoBase | null>;
  /** Onde o profissional atende, por registro do conselho (TBCBOPRO_TBUNIDAD). */
  unidadesDosRegistros(
    c: ContextoPessoas,
    registros: readonly number[],
  ): Promise<Map<number, UnidadeDoRegistroLida[]>>;
  ultimoRetrato(c: ContextoPessoas): Promise<ConselhoDiaSgh | null>;
  /** W0-06 (5d-3a): o cargo do quadro ligado ao colaborador (SGH_PES_CARGO; outro estabelecimento: null). */
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
