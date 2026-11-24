// Porta da internação, dos leitos, da higienização e do SAME (M21): o que as telas de trabalho leem e gravam,
// independente de onde (a API não escreve SQL; fronteira Nx):
//   - `banco`: a porta própria (porta-propria.ts) sobre o banco do cliente (leituras somente leitura; gravações pelo Executor,
//     com a trilha na mesma transação; as gravações só do novo — alta médica, bloqueio, precaução e atributos do leito,
//     as etapas da higienização, o protocolo do SAME — por transação com a trilha de auditoria junto);
//   - `memoria`: a sessão sintética de dev/ci (E2E): internações, leitos, solicitações e movimentos SINTÉTICOS em
//     memória, sobre o painel sintético do M16, com as mesmas validações (Zod dos contratos) e as mesmas recusas das
//     receitas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  ApoioInternacaoTela,
  ChaveLeito,
  DestinoAlta,
  DevolucoesAtrasadas,
  EtapaLimpeza,
  EstadoLeitoNovo,
  HistoricoOcupacao,
  InternacaoResumo,
  LeiturasPainel,
  LocalizacaoConta,
  OrigemLimpeza,
  Precaucao,
  PreInternacaoItem,
} from '@sgh/contratos';
import {
  type DetalheInternacao,
  type EstadosDoMapa,
  type ItemIncoerencia,
  type LimpezaGiro,
  type SolicitacaoLimpezaFila,
} from './tipos.js';
import { type PortaGravacaoM18, portaIndisponivel } from '../exames/public-api.js';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { ProfissionalDaSessao } from '../atendimento/porta.js';

export const PORTA_ADT = Symbol('PORTA_ADT');

/** Contexto da porta: o do núcleo (cliente, estabelecimento, usuário e correlação por id) mais a rede e o código do
 * estabelecimento da sessão (a memória separa os dados sintéticos por estabelecimento pelo código). */
export type ContextoAdt = ContextoPorta;

/** Gravações diretas da porta (sem operação nomeada do executor), numa transação com a linha da trilha junto. */
export interface GravadorSghAdt {
  registrarAltaMedica(r: {
    reg: number;
    pront: number;
    vinculo: number;
    motivo: number;
    destino: DestinoAlta;
    sumarioAlta: number | null;
    previsaoSaida: string | null;
    observacao: string | null;
    usuario: string;
  }): Promise<number>;
  cancelarAltaMedica(r: {
    reg: number;
    motivo: string;
    /** Motivo do cadastro (motivo_cancelamento_alta); sem ele, o único ativo; mais de um é recusa. */
    motivoCodigo?: number | null;
    /** Versão da alta médica que a tela leu (trava otimista), quando a tela a envia. */
    versao?: number | null;
    usuario: string;
  }): Promise<number>;
  abrirEstadoLeito(r: {
    leito: ChaveLeito;
    estado: EstadoLeitoNovo;
    motivo?: string | null;
    precaucao?: Precaucao | null;
    previsaoFim?: string | null;
    observacao?: string | null;
    solicitacao?: number | null;
    usuario: string;
  }): Promise<number>;
  encerrarEstadoLeito(r: {
    leito: ChaveLeito;
    estado: EstadoLeitoNovo;
    versao?: number | null;
    usuario: string;
  }): Promise<number>;
  /** W0-07: altera o estado aberto sem encerrar (a versão anterior na trilha de auditoria); devolve o id do estado. */
  alterarEstadoLeito(r: {
    leito: ChaveLeito;
    estado: EstadoLeitoNovo;
    motivo?: string | null;
    precaucao?: Precaucao | null;
    previsaoFim?: string | null;
    observacao?: string | null;
    justificativa: string;
    /** Versão do período que a tela leu (trava otimista), quando a tela a envia. */
    versao?: number | null;
    usuario: string;
  }): Promise<number>;
  /** W0-07: tira os atributos próprios do leito (volta ao padrão), com o valor anterior. */
  limparAtributos(r: {
    escopo: 'leito' | 'tipo';
    chave: string;
    justificativa: string;
    usuario: string;
  }): Promise<number>;
  gravarAtributo(r: {
    escopo: 'leito' | 'tipo';
    chave: string;
    andar?: number | null;
    sexo?: 'M' | 'F' | 'A' | null;
    idadeMinima?: number | null;
    idadeMaxima?: number | null;
    criticidade?: number | null;
    ramal?: number | null;
    intensiva?: boolean | null;
    /** Obrigatório quando o leito já tem atributos próprios e eles mudam (o valor anterior vai à trilha). */
    motivo?: string | null;
    usuario: string;
  }): Promise<void>;
  gravarEtapaLimpeza(r: {
    solicitacao: number;
    leitoEspelho: number | null;
    leito: ChaveLeito;
    etapa: EtapaLimpeza;
    origem?: OrigemLimpeza | null;
    tipoLimpeza?: number | null;
    profissional?: number | null;
    precaucao?: Precaucao | null;
    prazoMinutos?: number | null;
    checklist?: readonly string[] | null;
    foto?: string | null;
    observacao?: string | null;
    aparelho?: string | null;
    usuario: string;
  }): Promise<number>;
  gravarSameExt(r: {
    movimento: number | null;
    conta: number;
    tipo: 'exclusao' | 'remessa' | 'aceite' | 'cobranca' | 'ocorrencia' | 'descarte';
    motivo?: string | null;
    protocolo?: string | null;
    prazoDevolucao?: string | null;
    avalComissao?: string | null;
    usuario: string;
  }): Promise<number>;
}

export interface EtapaDaLimpeza {
  readonly id: number;
  readonly etapa: EtapaLimpeza;
  readonly tipoLimpeza: number | null;
  readonly profissional: number | null;
  readonly precaucao: Precaucao | null;
  readonly prazo: string | null;
  readonly checklist: string[];
  readonly foto: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
  readonly aparelho: string | null;
  readonly origem: OrigemLimpeza | null;
}

export interface AltaMedicaDecidida {
  readonly id: number;
  readonly vinculo: number;
  readonly motivo: number;
  readonly destino: string;
  readonly decididaEm: string;
  readonly decididaPor: string;
}

export interface DadosImpressoInternacao {
  readonly reg: number;
  readonly idPaciente: number;
  readonly prontuario: number;
  readonly nome: string;
  /** Nome social do cadastro (pulseira, W1-04). */
  readonly nomeSocial?: string | null;
  readonly nascimento: string | null;
  readonly convenio: string;
  readonly entrada: string;
  readonly hora: string;
  readonly leito: string;
  readonly medico: string;
  readonly alergia: boolean;
}

/** A lista de internações: os internados agora, as com alta no período (AAAA-MM-DD, inclusive) ou as duas. */
export interface OpcoesListaInternacoes {
  readonly termo?: string;
  readonly bloco?: string;
  readonly intensivas: readonly number[];
  readonly situacao?: 'internados' | 'alta' | 'todas';
  readonly altaDe?: string;
  readonly altaAte?: string;
}

export interface PortaAdt extends PortaGravacaoM18<GravadorSghAdt> {
  relogio(c: ContextoAdt): Promise<{ hoje: string; agora: string }>;
  internacoes(
    c: ContextoAdt,
    o: OpcoesListaInternacoes,
  ): Promise<{ itens: InternacaoResumo[]; cortada: boolean }>;
  detalhe(c: ContextoAdt, reg: number, intensivas: readonly number[]): Promise<DetalheInternacao | null>;
  altaMedica(c: ContextoAdt, reg: number): Promise<AltaMedicaDecidida | null>;
  altasMedicas(c: ContextoAdt, regs: readonly number[]): Promise<Map<number, AltaMedicaDecidida>>;
  preInternacoes(
    c: ContextoAdt,
    o: { situacao?: 'pendente' | 'todas'; problema?: 'saneamento' },
  ): Promise<{
    itens: PreInternacaoItem[];
    cortada: boolean;
    contagens: { pendentes: number; semData: number; impossiveis: number };
  }>;
  preDoPaciente(
    c: ContextoAdt,
    paciente: number,
  ): Promise<{
    /** Nula na fila de espera (sem data). */
    dataPrevista: string | null;
    convenio: number;
    especialidade: number;
    /** Clínica da pré-internação (M, C, N); null quando o agendamento não a tem. */
    clinica: string | null;
    carater: string;
    /** Pendente de modelo (pedido do lote 03-01): null até o agendamento guardar o procedimento. */
    procedimento: number | null;
    vinculoSolicitante: number;
    vinculoAssistente: number;
    matricula: string;
    plano: string;
  } | null>;
  leiturasPainel(c: ContextoAdt): Promise<LeiturasPainel>;
  /** Os estados do leito (períodos de situação) e as limpezas abertas. */
  estadosDoMapa(c: ContextoAdt, o?: { janelaHoras?: number }): Promise<EstadosDoMapa>;
  historico(
    c: ContextoAdt,
    o: { inicio: string; fim: string; bloco?: string; pagina: number; porPagina: number },
  ): Promise<HistoricoOcupacao>;
  solicitacoes(
    c: ContextoAdt,
    o?: { janelaHoras?: number },
  ): Promise<{ itens: SolicitacaoLimpezaFila[]; paradasAntigas: number; cortada: boolean }>;
  etapas(c: ContextoAdt, solicitacao: number): Promise<EtapaDaLimpeza[]>;
  /**
   * W0-07 (M3): as limpezas liberadas no período (datas AAAA-MM-DD) com as etapas gravadas, e o nome das áreas (bloco →
   * nome), para os indicadores de higienização e giro de leito.
   */
  limpezasLiberadas(
    c: ContextoAdt,
    de: string,
    ate: string,
  ): Promise<{ itens: LimpezaGiro[]; areas: Record<string, string> }>;
  /** O leito do espelho e a criticidade da área (para o prazo). */
  leitoDaSolicitacao(
    c: ContextoAdt,
    solicitacao: number,
  ): Promise<{
    leito: ChaveLeito;
    espelho: number;
    criticidade: number | null;
    situacaoCodigo: number;
  } | null>;
  contaDoCodigo(c: ContextoAdt, codigo: number): Promise<number | null>;
  localizacao(
    c: ContextoAdt,
    conta: number,
    o: { setorSame: number; prazoDias: number },
  ): Promise<LocalizacaoConta | null>;
  /** Os volumes fora do SAME além do prazo de devolução (a lista da cobrança; só conta, setor e datas). */
  devolucoesAtrasadas(
    c: ContextoAdt,
    o: { setorSame: number; prazoDias: number },
  ): Promise<{ itens: DevolucoesAtrasadas['itens']; cortada: boolean }>;
  apoio(c: ContextoAdt): Promise<ApoioInternacaoTela>;
  medicos(
    c: ContextoAdt,
    termo: string,
  ): Promise<{ vinculo: number; nome: string; conselho: string; especialidade: string }[]>;
  cid(c: ContextoAdt, termo: string): Promise<{ id: number; codigo: string; nome: string }[]>;
  incoerencias(c: ContextoAdt): Promise<{
    altaAntesDaEntrada: number[];
    listaAltaAntes: ItemIncoerencia[];
    leitosCadastro: number;
    leitosEspelho: number;
    internadosSemTrechoAberto: number;
    listaSemTrecho: ItemIncoerencia[];
  }>;
  impresso(c: ContextoAdt, reg: number): Promise<DadosImpressoInternacao | null>;
  /** Sexo e nascimento do paciente (pelo cadastro ou pela internação), só para a compatibilidade do leito. */
  pacienteParaLeito(
    c: ContextoAdt,
    q: { paciente?: number; reg?: number },
  ): Promise<{ paciente: number; sexo: string | null; nascimento: string | null } | null>;
  /** As fichas a imprimir da internação pela configuração comum (modelo e seleções por convênio e especialidade). */
  fichas(
    c: ContextoAdt,
    reg: number,
  ): Promise<{ modelo: number; grafica: boolean; nome: string; copias: number }[]>;
  profissional(c: ContextoAdt, login: string): Promise<ProfissionalDaSessao | null>;
  /** O profissional da higienização ligado ao login (pelo usuário do sistema); null sem ligação. */
  profissionalLimpeza(c: ContextoAdt, login: string): Promise<number | null>;
}

export const METODOS_PORTA_ADT: ReadonlySet<string> = new Set([
  'executar',
  'gravarSgh',
  'podeGravar',
  'relogio',
  'internacoes',
  'detalhe',
  'altaMedica',
  'altasMedicas',
  'preInternacoes',
  'preDoPaciente',
  'leiturasPainel',
  'estadosDoMapa',
  'historico',
  'solicitacoes',
  'etapas',
  'limpezasLiberadas',
  'leitoDaSolicitacao',
  'contaDoCodigo',
  'localizacao',
  'devolucoesAtrasadas',
  'apoio',
  'medicos',
  'cid',
  'incoerencias',
  'impresso',
  'pacienteParaLeito',
  'fichas',
  'profissional',
  'profissionalLimpeza',
]);

/** Porta indisponível (fora de dev/ci sem o núcleo): 503 em tudo (falha fechada). */
export function portaAdtIndisponivel(): PortaAdt {
  return portaIndisponivel<PortaAdt>(METODOS_PORTA_ADT);
}
