// Porta do atendimento externo (M20): o que as telas da recepção, do consultório e do pronto atendimento leem e gravam,
// independente de onde (a API não escreve SQL fora das portas próprias):
//   - `banco`: a porta própria sobre o MariaDB do cliente (porta-propria.ts), pelo @sgh/nucleo; gravações pelo Executor,
//     com trilha, outbox e idempotência na mesma transação; as gravações diretas (etapa do PA, observação, impresso,
//     paciente não identificado, escore) também, com a linha da trilha da tela;
//   - `memoria`: a sessão sintética de dev/ci (E2E): fichas, contas, fila, quadro e observação SINTÉTICOS em memória,
//     com as mesmas validações (Zod dos contratos) e as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type { AtendimentoDetalhe, AtendimentoResumo } from '@sgh/contratos';
import type { DimensaoSelecao, ModeloFicha, SelecaoFicha } from '@sgh/dominio-atendimento';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { PortaGravacaoM18 } from '../exames/public-api.js';
import type {
  ApoioAtendimentoDados,
  AtendimentoPa,
  EscorePaRegistrado,
  IndicadoresDados,
  ItemFila,
  LeitoObservacao,
  MarcacaoParaAbertura,
  NovoEscorePa,
  PreviaCancelamentoDados,
  SinaisRecentes,
} from './tipos.js';

export const PORTA_ATENDIMENTO = Symbol('PORTA_ATENDIMENTO');

/** Contexto da porta: o do núcleo mais a rede e o código do estabelecimento da sessão. */
export type ContextoAtendimento = ContextoPorta;

/** A configuração das fichas a imprimir (modelos e seleções por convênio, especialidade, unidade e grupo). */
export interface FichasConfiguradas {
  readonly modelos: readonly ModeloFicha[];
  readonly selecoes: readonly SelecaoFicha[];
}
export type { DimensaoSelecao };

/** Gravações diretas da porta (sem operação de tela), numa transação com a linha da trilha junto. */
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
  /** W0-07 (M1): o escore de deterioração e de sepse calculado pelo servidor (só inclusão). */
  registrarEscorePa(r: NovoEscorePa): Promise<number>;
  /** W0-07 (M1): o estorno do escore errado, com o motivo (um por escore). */
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
  marcacao(c: ContextoAtendimento, id: number): Promise<MarcacaoParaAbertura | null>;
  detalhe(c: ContextoAtendimento, reg: number): Promise<AtendimentoDetalhe | null>;
  fila(
    c: ContextoAtendimento,
    o: { local: number; hoje: string; crm?: number },
  ): Promise<{ itens: ItemFila[]; cortada: boolean }>;
  locais(c: ContextoAtendimento): Promise<{ id: number; descricao: string; recepcao: number }[]>;
  paAbertos(
    c: ContextoAtendimento,
    o: { hoje: string; unidade?: number },
  ): Promise<{ itens: AtendimentoPa[]; cortada: boolean }>;
  observacao(c: ContextoAtendimento): Promise<{ leitos: LeitoObservacao[]; historico: number }>;
  indicadores(
    c: ContextoAtendimento,
    o: { inicio: string; fim: string; unidade?: number },
  ): Promise<IndicadoresDados>;
  apoio(c: ContextoAtendimento): Promise<ApoioAtendimentoDados>;
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
    /** As marcas da herança em vigor para a sessão, pela chave da regra. */
    heranca: Record<string, boolean>;
    anterior: { reg: number; data: string; valores: Record<string, string | number | null> } | null;
    historico: { reg: number; data: string; tipo: string; convenio: string; profissional: string }[];
  }>;
  previaCancelamento(c: ContextoAtendimento, reg: number): Promise<PreviaCancelamentoDados | null>;
  dadosImpresso(c: ContextoAtendimento, reg: number): Promise<DadosImpresso | null>;
  profissional(c: ContextoAtendimento, login: string): Promise<ProfissionalDaSessao | null>;
  /** W0-07 (M1): os escores do PA dos atendimentos (os estornados também, marcados), do mais novo ao mais antigo. */
  escoresPa(c: ContextoAtendimento, cabecalhos: readonly string[]): Promise<EscorePaRegistrado[]>;
  /**
   * W0-07 (M1): os sinais mais recentes de cada atendimento desde a chegada (os da classificação e das outras telas
   * dos sinais vitais), um por tipo; ausente do mapa: nenhum sinal.
   */
  sinaisPa(
    c: ContextoAtendimento,
    itens: readonly { cabecalho: string; desde: string }[],
  ): Promise<Map<string, SinaisRecentes>>;
  /** A configuração das fichas a imprimir do estabelecimento (null: sem configuração, vale a ficha padrão). */
  fichasConfiguradas(c: ContextoAtendimento): Promise<FichasConfiguradas | null>;
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
  'fichasConfiguradas',
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
    itens: readonly Pick<AtendimentoPa, 'cabecalho' | 'reg' | 'marcas'>[],
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

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaAtendimentoIndisponivel(): PortaAtendimento {
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
    podeGravar: async () => ({
      pode: false,
      codigo: 'indisponivel',
      motivo: 'O banco do estabelecimento não está configurado: nada é gravado.',
    }),
  };
  const metodos = [...METODOS_PORTA_ATENDIMENTO].filter((m) => m !== 'podeGravar');
  return Object.assign(
    base,
    Object.fromEntries(metodos.map((m) => [m, recusa])),
  ) as unknown as PortaAtendimento;
}
