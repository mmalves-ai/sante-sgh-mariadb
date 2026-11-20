// Porta da manutenção e engenharia clínica (M55, etapa 1; ficha, seções 4 a 7), independente de onde (a API não
// escreve SQL; fronteira Nx):
//   - `legado`: as leituras READ ONLY (setores, unidades, recursos de agenda, nomes de usuários e fornecedores) e as
//     de SGH_MAN_*, e as gravações só do novo numa transação SGH_ com a SGH_TRILHA junto (a OS e o plano relidos e
//     travados na MESMA transação; o aviso da central na mesma transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E) e os testes da API, com as mesmas regras; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Recurso só do novo: nenhuma operação do executor (as GM* do outro sistema estão vazias e ficam como estão).
import type {
  AlertaEquipamento,
  ConclusaoDeCurso,
  CursoDoModelo,
  EventoCicloVida,
  SituacaoAlertaEquipamento,
  TipoRecursoAgenda,
} from '@sgh/contratos';
import type {
  AcaoDeCampoLida,
  abrirQueixaDaOsSgh,
  desvincularCursoModeloSgh,
  registrarEventoCicloSgh,
  vincularCursoModeloSgh,
  alterarAlertaEquipamentoSgh,
  encerrarAlertaEquipamentoSgh,
  EquipamentoDoParqueLido,
  excluirAlertaEquipamentoSgh,
  gerarAcaoDeCampoSgh,
  incluirAlertaEquipamentoSgh,
  AberturaOsParaGravar,
  AvisoSgh,
  CoberturaLida,
  CoberturaParaGravar,
  AlteracaoCoberturaParaGravar,
  EncerramentoCoberturaParaGravar,
  ExclusaoCoberturaParaGravar,
  EquipamentoLido,
  EquipamentoParaGravar,
  EventoOsLido,
  AlteracaoPlanoParaGravar,
  ExecucaoLida,
  ExecucaoParaGravar,
  FiltroEquipamentosLegado,
  FiltroOsLegado,
  CorrecaoOsParaGravar,
  MudancaOsParaGravar,
  OcorrenciasDoPeriodo,
  OsLida,
  PlanoManutencaoLido,
  PlanoParaGravarMan,
  RecursoAgendaLido,
  SetorLido,
  UnidadeDaManutencaoLida,
  UsuarioDaOs,
  VersaoPlanoLida,
  VersaoCoberturaLida,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_MANUTENCAO = Symbol('PORTA_MANUTENCAO');

type C = ContextoPortaM18;
type Id = { id: number; versao: number };
/** O segundo argumento da gravação do legado (o primeiro é o escritor da transação). */
type Arg<F extends (e: never, x: never) => unknown> = Parameters<F>[1];
type Res<F extends (...a: never[]) => Promise<unknown>> = Awaited<ReturnType<F>>;

/** Filtro do período dos indicadores (datas civis, fim inclusive). */
export interface FiltroPeriodoPorta {
  readonly inicio: string;
  readonly fim: string;
  readonly equipamento?: number | null;
  readonly centroCusto?: number | null;
  readonly criticidade?: EquipamentoLido['criticidade'] | null;
}

/** Leituras e gravações só do novo, numa transação com a SGH_TRILHA junto (as leituras são da mesma transação). */
export interface GravadorManutencao {
  relogio(): Promise<{ hoje: string; agora: string }>;
  setores(): Promise<SetorLido[]>;
  equipamento(id: number): Promise<EquipamentoLido | null>;
  equipamentoPorCodigo(codigo: string): Promise<EquipamentoLido | null>;
  /** A OS relida e travada até o fim da transação. */
  os(id: number): Promise<OsLida | null>;
  osAbertasDoEquipamento(equipamento: number): Promise<number[]>;
  /** O plano relido e travado até o fim da transação. */
  plano(id: number): Promise<PlanoManutencaoLido | null>;
  cobertura(id: number): Promise<CoberturaLida | null>;
  recurso(tipo: TipoRecursoAgenda, id: number): Promise<RecursoAgendaLido | null>;
  fornecedorExiste(codigo: number): Promise<boolean>;
  loginsDoSetor(centroCusto: number): Promise<string[]>;
  equipamentosDoRecurso(recurso: { tipo: TipoRecursoAgenda; id: number }): Promise<number[]>;
  incluirEquipamento(x: EquipamentoParaGravar): Promise<Id>;
  alterarEquipamento(x: EquipamentoParaGravar & { id: number; versaoVista: number }): Promise<Id>;
  abrirOs(x: AberturaOsParaGravar): Promise<Id & { numero: string }>;
  mudarOs(x: MudancaOsParaGravar): Promise<Id>;
  corrigirOs(x: CorrecaoOsParaGravar): Promise<Id>;
  incluirPlano(x: PlanoParaGravarMan): Promise<Id>;
  ativarPlano(x: { id: number; versaoVista: number; ativo: boolean; usuario: string }): Promise<Id>;
  alterarPlano(x: AlteracaoPlanoParaGravar): Promise<Id>;
  registrarExecucao(x: ExecucaoParaGravar): Promise<{ id: number; versaoPlano: number }>;
  incluirCobertura(x: CoberturaParaGravar): Promise<Id>;
  /** W0-08: os planos ativos que acionam o contrato (no todo ou só nos equipamentos dados). */
  planosAtivosDoContrato(cobertura: number, equipamentos?: readonly number[]): Promise<number>;
  alterarCobertura(
    x: AlteracaoCoberturaParaGravar,
  ): Promise<Id & { retirados: number[]; incluidos: number[] }>;
  encerrarCobertura(x: EncerramentoCoberturaParaGravar): Promise<Id>;
  /** Exclusão física só sem vínculo (409 `com-dependentes` com quantos e quais). */
  excluirCobertura(x: ExclusaoCoberturaParaGravar): Promise<Id>;
  // W0-08, parte 8 (M2): alerta de tecnovigilância e recall (as regras puras chegam como callback).
  incluirAlerta(x: Arg<typeof incluirAlertaEquipamentoSgh>): Promise<Id>;
  alterarAlerta(x: Arg<typeof alterarAlertaEquipamentoSgh>): Promise<Res<typeof alterarAlertaEquipamentoSgh>>;
  encerrarAlerta(x: Arg<typeof encerrarAlertaEquipamentoSgh>): Promise<Id>;
  /** Exclusão física só sem vínculo (409 `com-dependentes` com quantos e quais, oferecendo o encerramento). */
  excluirAlerta(x: Arg<typeof excluirAlertaEquipamentoSgh>): Promise<Id>;
  gerarAcaoDeCampo(x: Arg<typeof gerarAcaoDeCampoSgh>): Promise<Res<typeof gerarAcaoDeCampoSgh>>;
  abrirQueixaDaOs(x: Arg<typeof abrirQueixaDaOsSgh>): Promise<Res<typeof abrirQueixaDaOsSgh>>;
  // W0-08, parte 9 (M3): o curso exigido por modelo e os eventos do ciclo de vida (a regra pura chega como callback).
  cursoDoModelo(id: number): Promise<CursoDoModelo | null>;
  vincularCursoModelo(x: Arg<typeof vincularCursoModeloSgh>): Promise<{ id: number }>;
  desvincularCursoModelo(x: Arg<typeof desvincularCursoModeloSgh>): Promise<{ id: number }>;
  eventosCiclo(equipamento: number): Promise<EventoCicloVida[]>;
  registrarEventoCiclo(x: Arg<typeof registrarEventoCicloSgh>): Promise<Res<typeof registrarEventoCicloSgh>>;
  /** O aviso da central (SGH_ADM_AVISO); o mesmo destinatário e objeto não é avisado duas vezes (null). */
  avisar(a: Omit<AvisoSgh, 'rede' | 'hospital'>): Promise<number | null>;
}

export interface PortaManutencao extends PortaGravacaoM18<GravadorManutencao> {
  relogio(c: C): Promise<{ hoje: string; agora: string }>;
  setores(c: C): Promise<SetorLido[]>;
  unidades(c: C): Promise<UnidadeDaManutencaoLida[]>;
  recursos(c: C, tipo: TipoRecursoAgenda): Promise<RecursoAgendaLido[]>;
  recurso(c: C, tipo: TipoRecursoAgenda, id: number): Promise<RecursoAgendaLido | null>;
  nomesDosUsuarios(c: C, logins: readonly string[]): Promise<UsuarioDaOs[]>;
  /** Fornecedores pelo nome ou código (para o combo), sem documento nem dado bancário. */
  fornecedores(c: C, termo: string): Promise<{ codigo: number; nome: string }[]>;
  nomesDosFornecedores(c: C, codigos: readonly number[]): Promise<{ codigo: number; nome: string }[]>;
  equipamentos(
    c: C,
    f: FiltroEquipamentosLegado,
  ): Promise<{ itens: EquipamentoLido[]; proxima: number | null }>;
  equipamento(c: C, id: number): Promise<EquipamentoLido | null>;
  equipamentoPorCodigo(c: C, codigo: string): Promise<EquipamentoLido | null>;
  ordens(c: C, f: FiltroOsLegado): Promise<{ itens: OsLida[]; proxima: number | null }>;
  os(c: C, id: number): Promise<OsLida | null>;
  eventos(c: C, os: number): Promise<EventoOsLido[]>;
  planos(c: C, f?: { equipamento?: number | null; soAtivos?: boolean }): Promise<PlanoManutencaoLido[]>;
  execucoes(c: C, plano: number): Promise<ExecucaoLida[]>;
  versoesPlano(c: C, plano: number): Promise<VersaoPlanoLida[]>;
  planoPorId(c: C, id: number): Promise<PlanoManutencaoLido | null>;
  coberturas(
    c: C,
    f?: { equipamento?: number | null; ids?: readonly number[] | null },
  ): Promise<CoberturaLida[]>;
  versoesCobertura(c: C, cobertura: number): Promise<VersaoCoberturaLida[]>;
  ocorrencias(c: C, f: FiltroPeriodoPorta): Promise<OcorrenciasDoPeriodo>;
  // W0-08, parte 8 (M2): o alerta, as OS de ação de campo geradas, o parque candidato e os vínculos da OS.
  alertas(c: C, f?: { situacao?: SituacaoAlertaEquipamento | null }): Promise<AlertaEquipamento[]>;
  alerta(c: C, id: number): Promise<AlertaEquipamento | null>;
  acoesDoAlerta(c: C, alerta: number): Promise<AcaoDeCampoLida[]>;
  parqueDoAlerta(c: C, alerta: number): Promise<EquipamentoDoParqueLido[]>;
  vinculosTecnovigDaOs(
    c: C,
    os: number,
  ): Promise<{ queixa: number | null; alerta: { id: number; numero: string } | null }>;
  // W0-08, parte 9 (M3): cursos exigidos por modelo (chave já normalizada), o catálogo do treinamento (só leitura),
  // as conclusões válidas, os eventos do ciclo de vida e a base do índice de obsolescência (OS desde `desde`).
  cursosDosModelos(c: C, chave?: { fabricante: string; modelo: string }): Promise<CursoDoModelo[]>;
  catalogoCursos(c: C): Promise<CursoDoCatalogo[]>;
  conclusoesDosCursos(c: C, cursos: readonly number[]): Promise<ConclusaoDeCurso[]>;
  eventosCiclo(c: C, equipamento: number): Promise<EventoCicloVida[]>;
  baseObsolescencia(
    c: C,
    equipamento: number,
    desde: string,
  ): Promise<{ custoCent: number; corretivas: number }>;
}

/** O curso do catálogo do treinamento (pessoas, f6) oferecido no combo do modelo. */
export interface CursoDoCatalogo {
  readonly id: number;
  readonly codigo: string;
  readonly titulo: string;
  readonly validadeMeses: number;
  readonly ativo: boolean;
}

export const METODOS_PORTA_MANUTENCAO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'setores',
  'unidades',
  'recursos',
  'recurso',
  'nomesDosUsuarios',
  'fornecedores',
  'nomesDosFornecedores',
  'equipamentos',
  'equipamento',
  'equipamentoPorCodigo',
  'ordens',
  'os',
  'eventos',
  'planos',
  'execucoes',
  'coberturas',
  'ocorrencias',
  'alertas',
  'alerta',
  'acoesDoAlerta',
  'parqueDoAlerta',
  'vinculosTecnovigDaOs',
  'cursosDosModelos',
  'catalogoCursos',
  'conclusoesDosCursos',
  'eventosCiclo',
  'baseObsolescencia',
]);
