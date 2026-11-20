// Porta do atendimento externo (M20): o que as telas da recepção, do consultório e do pronto atendimento leem e gravam,
// independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: o núcleo do legado (leituras READ ONLY dos repositórios de @sgh/legado; gravações pelo EXECUTOR do M04,
//     com a trilha na mesma transação; as gravações só do novo — etapa do PA, observação, impresso, paciente não
//     identificado, fila sem senha — por transação SGH_ com a SGH_TRILHA junto);
//   - `memoria`: a sessão sintética de dev/ci (E2E): fichas, contas, fila, quadro e observação SINTÉTICOS em memória,
//     com as mesmas validações (Zod dos contratos) e as mesmas recusas das receitas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type { AtendimentoDetalhe, AtendimentoResumo } from '@sgh/contratos';
import type {
  ApoioAtendimentoLegado,
  AtendimentoPaLegado,
  EscorePaLido,
  EscorePaSgh,
  SinaisSgh,
  IndicadoresLegado,
  ItemFilaLegado,
  LeitoObservacaoLegado,
  MarcacaoAberturaLegado,
  PreviaCancelamentoLegado,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_ATENDIMENTO = Symbol('PORTA_ATENDIMENTO');

export type ContextoAtendimento = ContextoPortaM18;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto. */
export interface GravadorSghAtendimento {
  registrarEtapa(r: {
    cabecalho: string;
    reg: number;
    senha: number | null;
    etapa: string;
    usuario: string;
  }): Promise<number>;
  alocarObservacao(r: {
    cabecalho: string;
    reg: number;
    leito: number;
    usuario: string;
    /** W0-07: a alocação anterior (transferência de leito: a entrada continua a dela) e o motivo. */
    anterior?: number | null;
    motivoTransferencia?: string | null;
  }): Promise<number>;
  liberarObservacao(r: {
    cabecalho: string;
    usuario: string;
    justificativa: string | null;
    limiteHoras: number;
    /** W0-07: a saída é a primeira metade de uma transferência (sem a justificativa das 24 horas). */
    transferencia?: boolean;
  }): Promise<{ horas: number; id: number }>;
  registrarImpresso(r: {
    reg: number;
    impresso: string;
    formato: string;
    copias: number;
    resumo: string;
    usuario: string;
  }): Promise<number>;
  marcarNaoIdentificado(r: {
    paciente: number;
    prontuario: number;
    caracteristicas: string;
    usuario: string;
  }): Promise<void>;
  /** Encerra a marca do não identificado com o cadastro de destino (a unificação segue pelo cadastro único). */
  identificarPaciente(r: { paciente: number; destino: number; usuario: string }): Promise<void>;
  /** W0-07 (M1): o escore de deterioração e de sepse calculado pelo servidor (SGH_PA_ESCORE; só inclusão). */
  registrarEscorePa(r: Omit<EscorePaSgh, 'hospital'>): Promise<number>;
  /** W0-07 (M1): o estorno do escore errado, com o motivo (SGH_PA_ESCORE_ESTORNO; um por escore). */
  estornarEscorePa(r: { cabecalho: string; id: number; motivo: string; usuario: string }): Promise<number>;
}

/** O profissional da sessão (o vínculo do próprio usuário), para o ato médico. */
export interface ProfissionalDaSessao {
  readonly vinculo: number;
  readonly crm: number;
  readonly nome: string;
  readonly codigoCbo: string;
  readonly conselhoAtivo: boolean;
}

export interface DadosImpresso {
  readonly reg: number;
  readonly idPaciente: number;
  readonly prontuario: number;
  readonly nome: string;
  /** Nome social do cadastro (pulseira, W1-04). */
  readonly nomeSocial?: string | null;
  readonly nascimento: string | null;
  readonly convenio: string;
  readonly data: string;
  readonly hora: string;
  readonly profissional: string;
  readonly especialidade: string;
  readonly tipo: string;
  readonly leito: string | null;
  readonly alergia: boolean;
  readonly codigoConvenio: number;
  readonly codigoEspecialidade: number;
  readonly unidade: number;
  readonly clinica: string;
  readonly retorno: boolean;
  /** Pronto atendimento (a liberação própria). */
  readonly pa: boolean;
}

export interface PortaAtendimento extends PortaGravacaoM18<GravadorSghAtendimento> {
  relogio(c: ContextoAtendimento): Promise<{ hoje: string; agora: string }>;
  atendimentosDoDia(
    c: ContextoAtendimento,
    f: { data: string; unidade?: number; requisicoes?: boolean; local?: number; termo?: string },
  ): Promise<{ itens: AtendimentoResumo[]; cortada: boolean; requisicoes: number }>;
  /** O agendamento que a abertura preenche (null: não existe). */
  marcacao(c: ContextoAtendimento, id: number): Promise<MarcacaoAberturaLegado | null>;
  detalhe(c: ContextoAtendimento, reg: number): Promise<AtendimentoDetalhe | null>;
  fila(
    c: ContextoAtendimento,
    o: { local: number; hoje: string; crm?: number },
  ): Promise<{ itens: ItemFilaLegado[]; cortada: boolean }>;
  locais(c: ContextoAtendimento): Promise<{ id: number; descricao: string; recepcao: number }[]>;
  paAbertos(
    c: ContextoAtendimento,
    o: { hoje: string; unidade?: number },
  ): Promise<{ itens: AtendimentoPaLegado[]; cortada: boolean }>;
  observacao(c: ContextoAtendimento): Promise<{ leitos: LeitoObservacaoLegado[]; historico: number }>;
  indicadores(
    c: ContextoAtendimento,
    o: { inicio: string; fim: string; unidade?: number },
  ): Promise<IndicadoresLegado>;
  apoio(c: ContextoAtendimento): Promise<ApoioAtendimentoLegado>;
  cid(c: ContextoAtendimento, termo: string): Promise<{ id: number; codigo: string; nome: string }[]>;
  solicitantes(
    c: ContextoAtendimento,
    termo: string,
  ): Promise<{ id: number; nome: string; registro: string }[]>;
  procedimentos(
    c: ContextoAtendimento,
    convenio: number,
    termo: string,
  ): Promise<{ codigo: number; nome: string }[]>;
  historico(
    c: ContextoAtendimento,
    paciente: number,
  ): Promise<{
    anterior: { reg: number; data: string; valores: Record<string, string | number | null> } | null;
    historico: { reg: number; data: string; tipo: string; convenio: string; profissional: string }[];
  }>;
  previaCancelamento(c: ContextoAtendimento, reg: number): Promise<PreviaCancelamentoLegado | null>;
  dadosImpresso(c: ContextoAtendimento, reg: number): Promise<DadosImpresso | null>;
  profissional(c: ContextoAtendimento, login: string): Promise<ProfissionalDaSessao | null>;
  /** W0-07 (M1): os escores do PA dos atendimentos (os estornados também, marcados), do mais novo ao mais antigo. */
  escoresPa(c: ContextoAtendimento, cabecalhos: readonly string[]): Promise<EscorePaLido[]>;
  /**
   * W0-07 (M1): os sinais mais recentes de cada atendimento desde a chegada (os da classificação e das outras telas
   * dos sinais vitais), um por tipo; ausente do mapa: nenhum sinal.
   */
  sinaisPa(
    c: ContextoAtendimento,
    itens: readonly { cabecalho: string; desde: string }[],
  ): Promise<Map<string, SinaisSgh>>;
  naoIdentificados(c: ContextoAtendimento): Promise<
    {
      paciente: number;
      prontuario: number;
      caracteristicas: string;
      marcadoEm: string;
      identificadoEm: string | null;
    }[]
  >;
}

export const METODOS_PORTA_ATENDIMENTO: ReadonlySet<string> = new Set([
  'executar',
  'gravarSgh',
  'relogio',
  'atendimentosDoDia',
  'marcacao',
  'detalhe',
  'fila',
  'locais',
  'paAbertos',
  'observacao',
  'indicadores',
  'apoio',
  'cid',
  'solicitantes',
  'procedimentos',
  'historico',
  'previaCancelamento',
  'dadosImpresso',
  'profissional',
  'naoIdentificados',
  'escoresPa',
  'sinaisPa',
]);

/**
 * M44: a cor da classificação de risco no quadro do PA (a evolução do quadro sem mudar de dono). O módulo da
 * classificação (recepcao) fornece; sem ele (ou com ele indisponível), o quadro segue sem cor, como no M20.
 */
export const FONTE_RISCO_PA = Symbol('FONTE_RISCO_PA');

export interface FonteRiscoPa {
  /**
   * `opcoes.protocolos` (revisão do M44.3): só com a permissão `recepcao.protocoloPaciente.ler` na sessão a fonte lê
   * os protocolos gerenciados (dado clínico sensível) para o chip do cartão; sem ela, nem consulta.
   */
  riscos(
    c: ContextoAtendimento,
    itens: readonly Pick<AtendimentoPaLegado, 'cabecalho' | 'reg' | 'marcas'>[],
    opcoes?: { readonly protocolos: boolean },
  ): Promise<{
    porReg: Map<number, import('@sgh/contratos').RiscoNoQuadro | null>;
    porCor: {
      cor: import('@sgh/contratos').CorRisco | 'semClassificacao';
      total: number;
      estourados: number;
    }[];
    /** M44 (etapa 3): os protocolos gerenciados abertos de cada atendimento (o relógio no cartão). */
    protocolos?: Map<number, import('@sgh/contratos').ProtocoloNoQuadro[]>;
  }>;
}
