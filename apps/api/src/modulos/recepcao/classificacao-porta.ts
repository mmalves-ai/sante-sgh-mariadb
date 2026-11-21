// Porta da classificação de risco no PA (M44, etapa 1; ficha, seções 4 a 7): o que a fila, a tela de classificar, o
// editor de protocolos, o quadro com cor, o painel de TV e o `worker` de estouro leem e gravam, independente de onde:
//   - `propria`: o banco do cliente pelo @sgh/nucleo (classificacao-porta-propria.ts): leituras somente leitura e as
//     gravações numa transação com a trilha junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E): protocolo, classificações e sinais SINTÉTICOS em memória, com as
//     mesmas recusas (sucessão única, versão seguinte do mesmo tipo, aviso único por chave);
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Os atendimentos do PA vêm da porta do atendimento (M20), pela public-api dele.
import type {
  ClassificacaoRegistrada,
  ContextoGravacao,
  ContextoComGravacao,
  CorAnterior,
  GravacaoFeita,
  LiberacaoConsultada,
  NovaClassificacao,
  NovaInclusaoProtocolo,
  NovoEventoProtocolo,
  OpcaoPrioridadeVista,
  ProtocoloPaciente,
  PublicacaoGerenciado,
  PublicacaoProtocolo,
  SinaisVitais,
  TrilhaGravacao,
  VersaoGerenciado,
  VersaoProtocolo,
} from './tipos.js';

export const PORTA_CLASSIFICACAO = Symbol('PORTA_CLASSIFICACAO');

export type ContextoClassificacao = ContextoComGravacao;

/** Gravações da classificação, numa transação com a trilha junto. */
export interface GravadorClassificacao {
  publicarProtocolo(p: PublicacaoProtocolo): Promise<{
    id: number;
    protocolo: number;
    versao: number;
  }>;
  /** A classificação (inicial ou reclassificação) e, na inicial ou na mudança de quadro, os sinais ao M25. */
  classificar(c: NovaClassificacao): Promise<{ id: number; sinais: number }>;
  /** Os sinais do técnico (sem concluir a classificação). */
  registrarSinais(r: {
    cabecalho: string;
    paciente: number;
    sinais: SinaisVitais;
    horaSinais: string;
    autor: string;
  }): Promise<number>;
  /** O aviso de estouro, uma vez por chave (false: outro consumidor avisou). */
  avisarEstouro(a: { chave: string; classificacao: number; reg: number; prazoEm: string }): Promise<boolean>;
  /**
   * Evento próprio a mais na trilha, na MESMA transação da gravação (regra 3: a cor sobreposta). A falha desfaz a
   * gravação inteira (sem trilha, sem dado).
   */
  registrarEvento(linha: TrilhaGravacao): Promise<void>;
  /** M44 (etapa 3): a versão da definição do protocolo gerenciado (imutável). */
  publicarGerenciado(p: PublicacaoGerenciado): Promise<{ id: number; versao: number }>;
  /** A inclusão do paciente no protocolo (uma por tipo e atendimento). */
  incluirProtocolo(p: NovaInclusaoProtocolo): Promise<number>;
  /** A meta, o item do checklist ou o encerramento (uma vez cada; nada depois do encerramento). */
  registrarEventoProtocolo(p: NovoEventoProtocolo): Promise<number>;
}

/** O profissional da sessão (o vínculo do próprio usuário), para a regra 1. */
export interface VinculoDaSessao {
  readonly vinculo: number;
  readonly codigoCbo: string;
  readonly conselhoAtivo: boolean;
}

export interface PortaClassificacao {
  readonly destino: 'propria' | 'memoria' | 'indisponivel';
  /** Passo 0 sem gravar (a classificação não usa operações do Executor: sempre pode, salvo indisponível). */
  podeGravar(c: ContextoClassificacao, operacao: string, login: string): Promise<LiberacaoConsultada>;
  executar(
    c: ContextoClassificacao,
    operacao: string,
    entrada: unknown,
    ctx: ContextoGravacao,
  ): Promise<GravacaoFeita>;
  /** As gravações da classificação, numa transação com a trilha. */
  gravar<T>(
    c: ContextoClassificacao,
    trilha: TrilhaGravacao | ((r: T) => TrilhaGravacao),
    fn: (g: GravadorClassificacao) => Promise<T>,
  ): Promise<T>;
  /** Hora do banco (local do estabelecimento) e o mesmo instante em ISO UTC. */
  relogio(c: ContextoClassificacao): Promise<{ agora: string; hoje: string }>;
  vinculo(c: ContextoClassificacao, login: string): Promise<VinculoDaSessao | null>;
  versoes(c: ContextoClassificacao): Promise<VersaoProtocolo[]>;
  versao(c: ContextoClassificacao, id: number): Promise<(VersaoProtocolo & { conteudo: unknown }) | null>;
  classificacoes(c: ContextoClassificacao, cabecalhos: readonly string[]): Promise<ClassificacaoRegistrada[]>;
  classificacoesDoPaciente(c: ContextoClassificacao, paciente: number): Promise<ClassificacaoRegistrada[]>;
  classificacoesDoPeriodo(
    c: ContextoClassificacao,
    inicio: string,
    fim: string,
  ): Promise<ClassificacaoRegistrada[]>;
  sinaisRecentes(c: ContextoClassificacao, cabecalho: string, desde: string): Promise<SinaisVitais | null>;
  /** Os sinais recentes de vários atendimentos numa leitura por lote (a fila); ausente do mapa: sem sinal. */
  sinaisRecentesDosAtendimentos(
    c: ContextoClassificacao,
    itens: readonly { cabecalho: string; desde: string }[],
  ): Promise<Map<string, SinaisVitais>>;
  /** O histórico do formulário de classificação do prontuário (data e a opção de prioridade gravada). */
  historicoProntuario(
    c: ContextoClassificacao,
    paciente: number,
  ): Promise<{ registro: number; dataHora: string; opcao: string | null }[]>;
  /** As opções de "Prioridade clínica" já vistas (regra 7; só contagens). */
  opcoesPrioridadeVistas(c: ContextoClassificacao): Promise<OpcaoPrioridadeVista[]>;
  /** As cores usadas nos registros anteriores (os níveis de prioridade do cadastro). */
  coresAnteriores(c: ContextoClassificacao): Promise<CorAnterior[]>;
  avisosGravados(c: ContextoClassificacao, chaves: readonly string[]): Promise<Set<string>>;
  /** M44 (etapa 3): as versões publicadas das definições dos protocolos gerenciados (com o conteúdo). */
  versoesGerenciadas(c: ContextoClassificacao): Promise<VersaoGerenciado[]>;
  protocolosDosAtendimentos(
    c: ContextoClassificacao,
    cabecalhos: readonly string[],
  ): Promise<ProtocoloPaciente[]>;
  protocolosDoPeriodo(c: ContextoClassificacao, inicio: string, fim: string): Promise<ProtocoloPaciente[]>;
  protocoloDoPaciente(c: ContextoClassificacao, id: number): Promise<ProtocoloPaciente | null>;
}

export const METODOS_PORTA_CLASSIFICACAO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravar',
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
  'coresAnteriores',
  'avisosGravados',
  'versoesGerenciadas',
  'protocolosDosAtendimentos',
  'protocolosDoPeriodo',
  'protocoloDoPaciente',
]);
