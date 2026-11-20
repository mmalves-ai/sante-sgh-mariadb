// Porta da classificação de risco no PA (M44, etapa 1; ficha, seções 4 a 7): o que a fila, a tela de classificar, o
// editor de protocolos, o quadro com cor, o painel de TV e o `worker` de estouro leem e gravam, independente de onde
// (a API não escreve SQL; fronteira Nx):
//   - `legado`: leituras READ ONLY (SGH_PA_*, PRMANCHESTER, o formulário de classificação do prontuário) e as
//     gravações só do novo numa transação SGH_ com a SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E): protocolo, classificações e sinais SINTÉTICOS em memória, com as
//     mesmas recusas (sucessão única, versão seguinte do mesmo tipo, aviso único por chave);
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Os atendimentos do PA (abertos, marcas de SGH_PA_ETAPA) vêm da porta do atendimento (M20), pela public-api dele.
import type {
  EventoProtocoloSgh,
  InclusaoProtocoloSgh,
  ProtocoloPacienteLido,
  PublicacaoGerenciadoSgh,
  VersaoGerenciadoLida,
  ClassificacaoLida,
  ClassificacaoSgh,
  CorLegadoLida,
  LinhaTrilha,
  OpcaoPrioridadeVista,
  PublicacaoProtocoloSgh,
  SinaisSgh,
  VersaoProtocoloLida,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_CLASSIFICACAO = Symbol('PORTA_CLASSIFICACAO');

export type ContextoClassificacao = ContextoPortaM18;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto. */
export interface GravadorClassificacao {
  publicarProtocolo(p: Omit<PublicacaoProtocoloSgh, 'hospital'>): Promise<{
    id: number;
    protocolo: number;
    versao: number;
  }>;
  /** A classificação (inicial ou reclassificação) e, na inicial ou na mudança de quadro, os sinais ao M25. */
  classificar(c: Omit<ClassificacaoSgh, 'hospital'>): Promise<{ id: number; sinais: number }>;
  /** Os sinais do técnico (sem concluir a classificação). */
  registrarSinais(r: {
    cabecalho: string;
    paciente: number;
    sinais: SinaisSgh;
    horaSinais: string;
    autor: string;
  }): Promise<number>;
  /** O aviso de estouro, uma vez por chave (false: outro consumidor avisou). */
  avisarEstouro(a: { chave: string; classificacao: number; reg: number; prazoEm: string }): Promise<boolean>;
  /**
   * Evento próprio a mais na SGH_TRILHA, na MESMA transação da gravação (regra 3: a cor sobreposta). A falha desfaz a
   * gravação inteira (sem trilha, sem dado).
   */
  registrarEvento(linha: LinhaTrilha): Promise<void>;
  /** M44 (etapa 3): a versão da definição do protocolo gerenciado (imutável). */
  publicarGerenciado(p: Omit<PublicacaoGerenciadoSgh, 'hospital'>): Promise<{ id: number; versao: number }>;
  /** A inclusão do paciente no protocolo (uma por tipo e atendimento). */
  incluirProtocolo(p: Omit<InclusaoProtocoloSgh, 'hospital'>): Promise<number>;
  /** A meta, o item do checklist ou o encerramento (uma vez cada; nada depois do encerramento). */
  registrarEventoProtocolo(p: Omit<EventoProtocoloSgh, 'hospital'>): Promise<number>;
}

/** O profissional da sessão (o vínculo do próprio usuário), para a regra 1. */
export interface VinculoDaSessao {
  readonly vinculo: number;
  readonly codigoCbo: string;
  readonly conselhoAtivo: boolean;
}

export interface PortaClassificacao extends PortaGravacaoM18<GravadorClassificacao> {
  /** Hora do banco (local do estabelecimento) e o mesmo instante em ISO UTC. */
  relogio(c: ContextoClassificacao): Promise<{ agora: string; hoje: string }>;
  vinculo(c: ContextoClassificacao, login: string): Promise<VinculoDaSessao | null>;
  versoes(c: ContextoClassificacao): Promise<VersaoProtocoloLida[]>;
  versao(c: ContextoClassificacao, id: number): Promise<(VersaoProtocoloLida & { conteudo: unknown }) | null>;
  classificacoes(c: ContextoClassificacao, cabecalhos: readonly string[]): Promise<ClassificacaoLida[]>;
  classificacoesDoPaciente(c: ContextoClassificacao, paciente: number): Promise<ClassificacaoLida[]>;
  classificacoesDoPeriodo(
    c: ContextoClassificacao,
    inicio: string,
    fim: string,
  ): Promise<ClassificacaoLida[]>;
  sinaisRecentes(c: ContextoClassificacao, cabecalho: string, desde: string): Promise<SinaisSgh | null>;
  /** Os sinais recentes de vários atendimentos numa leitura por lote (a fila); ausente do mapa: sem sinal. */
  sinaisRecentesDosAtendimentos(
    c: ContextoClassificacao,
    itens: readonly { cabecalho: string; desde: string }[],
  ): Promise<Map<string, SinaisSgh>>;
  /** O histórico do formulário de classificação do prontuário (data e a opção de prioridade gravada). */
  historicoProntuario(
    c: ContextoClassificacao,
    paciente: number,
  ): Promise<{ registro: number; dataHora: string; opcao: string | null }[]>;
  /** As opções de "Prioridade clínica" já vistas (regra 7; só contagens). */
  opcoesPrioridadeVistas(c: ContextoClassificacao): Promise<OpcaoPrioridadeVista[]>;
  coresLegado(c: ContextoClassificacao): Promise<CorLegadoLida[]>;
  avisosGravados(c: ContextoClassificacao, chaves: readonly string[]): Promise<Set<string>>;
  /** M44 (etapa 3): as versões publicadas das definições dos protocolos gerenciados (com o conteúdo). */
  versoesGerenciadas(c: ContextoClassificacao): Promise<VersaoGerenciadoLida[]>;
  protocolosDosAtendimentos(
    c: ContextoClassificacao,
    cabecalhos: readonly string[],
  ): Promise<ProtocoloPacienteLido[]>;
  protocolosDoPeriodo(
    c: ContextoClassificacao,
    inicio: string,
    fim: string,
  ): Promise<ProtocoloPacienteLido[]>;
  protocoloDoPaciente(c: ContextoClassificacao, id: number): Promise<ProtocoloPacienteLido | null>;
}

export const METODOS_PORTA_CLASSIFICACAO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'vinculo',
  'versoes',
  'versao',
  'classificacoes',
  'classificacoesDoPaciente',
  'classificacoesDoPeriodo',
  'sinaisRecentes',
  'sinaisRecentesDosAtendimentos',
  'historicoProntuario',
  'opcoesPrioridadeVistas',
  'coresLegado',
  'avisosGravados',
  'versoesGerenciadas',
  'protocolosDosAtendimentos',
  'protocolosDoPeriodo',
  'protocoloDoPaciente',
]);
