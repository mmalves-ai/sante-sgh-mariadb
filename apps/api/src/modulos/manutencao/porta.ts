// Porta da manutenção e engenharia clínica (M55; ficha, seções 4 a 7), independente de onde (a API não escreve SQL):
//   - `banco`: a porta própria sobre o banco do cliente (porta-propria.ts), pelo @sgh/nucleo: leituras somente leitura
//     e as gravações diretas numa operação do Executor (trilha, outbox e idempotência na mesma transação; a OS e o plano
//     relidos e travados na MESMA transação; o aviso da central na mesma transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E) e os testes da API, com as mesmas regras;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AlertaEquipamento,
  ConclusaoDeCurso,
  CursoDoModelo,
  EventoCicloVida,
  SituacaoAlertaEquipamento,
  TipoRecursoAgenda,
} from '@sgh/contratos';
import type {
  AberturaOsParaGravar,
  AcaoDeCampo,
  AcaoDeCampoGerada,
  AlertaAlterado,
  AlertaParaAlterar,
  AlertaParaEncerrar,
  AlertaParaIncluir,
  AlteracaoCoberturaParaGravar,
  AlteracaoPlanoParaGravar,
  AvisoDaCentral,
  CoberturaManutencao,
  CoberturaParaGravar,
  CorrecaoOsParaGravar,
  DesvinculoCursoParaGravar,
  EncerramentoCoberturaParaGravar,
  EquipamentoDoParque,
  EquipamentoManutencao,
  EquipamentoParaGravar,
  EventoCicloParaGravar,
  EventoCicloRegistrado,
  EventoOrdem,
  ExclusaoCoberturaParaGravar,
  ExecucaoDoPlano,
  ExecucaoParaGravar,
  FiltroEquipamentos,
  FiltroOrdens,
  GeracaoAcaoDeCampoParaGravar,
  MudancaOsParaGravar,
  OcorrenciasDoPeriodo,
  OrdemServico,
  PlanoManutencao,
  PlanoParaGravar,
  QueixaDaOsAberta,
  QueixaDaOsParaGravar,
  RecursoDeAgenda,
  SetorManutencao,
  UnidadeManutencao,
  UsuarioDaOs,
  VersaoDaCobertura,
  VersaoDoPlano,
  VinculoCursoParaGravar,
} from './tipos.js';
import { type ContextoPortaM18, type PortaGravacaoM18, portaIndisponivel } from '../exames/public-api.js';

export const PORTA_MANUTENCAO = Symbol('PORTA_MANUTENCAO');

type C = ContextoPortaM18;
type Id = { id: number; versao: number };

/** Filtro do período dos indicadores (datas civis, fim inclusive). */
export interface FiltroPeriodoPorta {
  readonly inicio: string;
  readonly fim: string;
  readonly equipamento?: number | null;
  readonly centroCusto?: number | null;
  readonly criticidade?: EquipamentoManutencao['criticidade'] | null;
}

/** Leituras e gravações numa transação com a trilha de auditoria junto (as leituras são da mesma transação). */
export interface GravadorManutencao {
  relogio(): Promise<{ hoje: string; agora: string }>;
  setores(): Promise<SetorManutencao[]>;
  equipamento(id: number): Promise<EquipamentoManutencao | null>;
  equipamentoPorCodigo(codigo: string): Promise<EquipamentoManutencao | null>;
  /** A OS relida e travada até o fim da transação. */
  os(id: number): Promise<OrdemServico | null>;
  osAbertasDoEquipamento(equipamento: number): Promise<number[]>;
  /** O plano relido e travado até o fim da transação. */
  plano(id: number): Promise<PlanoManutencao | null>;
  cobertura(id: number): Promise<CoberturaManutencao | null>;
  recurso(tipo: TipoRecursoAgenda, id: number): Promise<RecursoDeAgenda | null>;
  fornecedorExiste(codigo: number): Promise<boolean>;
  loginsDoSetor(centroCusto: number): Promise<string[]>;
  equipamentosDoRecurso(recurso: { tipo: TipoRecursoAgenda; id: number }): Promise<number[]>;
  incluirEquipamento(x: EquipamentoParaGravar): Promise<Id>;
  alterarEquipamento(x: EquipamentoParaGravar & { id: number; versaoVista: number }): Promise<Id>;
  abrirOs(x: AberturaOsParaGravar): Promise<Id & { numero: string }>;
  mudarOs(x: MudancaOsParaGravar): Promise<Id>;
  corrigirOs(x: CorrecaoOsParaGravar): Promise<Id>;
  incluirPlano(x: PlanoParaGravar): Promise<Id>;
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
  incluirAlerta(x: AlertaParaIncluir): Promise<Id>;
  alterarAlerta(x: AlertaParaAlterar): Promise<AlertaAlterado>;
  encerrarAlerta(x: AlertaParaEncerrar): Promise<Id>;
  /** Exclusão física só sem vínculo (409 `com-dependentes` com quantos e quais, oferecendo o encerramento). */
  excluirAlerta(x: AlertaParaEncerrar): Promise<Id>;
  gerarAcaoDeCampo(x: GeracaoAcaoDeCampoParaGravar): Promise<AcaoDeCampoGerada>;
  abrirQueixaDaOs(x: QueixaDaOsParaGravar): Promise<QueixaDaOsAberta>;
  // W0-08, parte 9 (M3): o curso exigido por modelo e os eventos do ciclo de vida (a regra pura chega como callback).
  cursoDoModelo(id: number): Promise<CursoDoModelo | null>;
  vincularCursoModelo(x: VinculoCursoParaGravar): Promise<{ id: number }>;
  desvincularCursoModelo(x: DesvinculoCursoParaGravar): Promise<{ id: number }>;
  eventosCiclo(equipamento: number): Promise<EventoCicloVida[]>;
  registrarEventoCiclo(x: EventoCicloParaGravar): Promise<EventoCicloRegistrado>;
  /** O aviso da central (notificacao_usuario); o mesmo destinatário e objeto não é avisado duas vezes (null). */
  avisar(a: AvisoDaCentral): Promise<number | null>;
}

export interface PortaManutencao extends PortaGravacaoM18<GravadorManutencao> {
  relogio(c: C): Promise<{ hoje: string; agora: string }>;
  setores(c: C): Promise<SetorManutencao[]>;
  unidades(c: C): Promise<UnidadeManutencao[]>;
  recursos(c: C, tipo: TipoRecursoAgenda): Promise<RecursoDeAgenda[]>;
  recurso(c: C, tipo: TipoRecursoAgenda, id: number): Promise<RecursoDeAgenda | null>;
  nomesDosUsuarios(c: C, logins: readonly string[]): Promise<UsuarioDaOs[]>;
  /** Fornecedores pelo nome ou código (para o combo), sem documento nem dado bancário. */
  fornecedores(c: C, termo: string): Promise<{ codigo: number; nome: string }[]>;
  nomesDosFornecedores(c: C, codigos: readonly number[]): Promise<{ codigo: number; nome: string }[]>;
  equipamentos(
    c: C,
    f: FiltroEquipamentos,
  ): Promise<{ itens: EquipamentoManutencao[]; proxima: number | null }>;
  equipamento(c: C, id: number): Promise<EquipamentoManutencao | null>;
  equipamentoPorCodigo(c: C, codigo: string): Promise<EquipamentoManutencao | null>;
  ordens(c: C, f: FiltroOrdens): Promise<{ itens: OrdemServico[]; proxima: number | null }>;
  os(c: C, id: number): Promise<OrdemServico | null>;
  eventos(c: C, os: number): Promise<EventoOrdem[]>;
  planos(c: C, f?: { equipamento?: number | null; soAtivos?: boolean }): Promise<PlanoManutencao[]>;
  execucoes(c: C, plano: number): Promise<ExecucaoDoPlano[]>;
  versoesPlano(c: C, plano: number): Promise<VersaoDoPlano[]>;
  planoPorId(c: C, id: number): Promise<PlanoManutencao | null>;
  coberturas(
    c: C,
    f?: { equipamento?: number | null; ids?: readonly number[] | null },
  ): Promise<CoberturaManutencao[]>;
  versoesCobertura(c: C, cobertura: number): Promise<VersaoDaCobertura[]>;
  ocorrencias(c: C, f: FiltroPeriodoPorta): Promise<OcorrenciasDoPeriodo>;
  // W0-08, parte 8 (M2): o alerta, as OS de ação de campo geradas, o parque candidato e os vínculos da OS.
  alertas(c: C, f?: { situacao?: SituacaoAlertaEquipamento | null }): Promise<AlertaEquipamento[]>;
  alerta(c: C, id: number): Promise<AlertaEquipamento | null>;
  acoesDoAlerta(c: C, alerta: number): Promise<AcaoDeCampo[]>;
  parqueDoAlerta(c: C, alerta: number): Promise<EquipamentoDoParque[]>;
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

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaManutencaoIndisponivel(): PortaManutencao {
  return portaIndisponivel<PortaManutencao>(METODOS_PORTA_MANUTENCAO);
}
