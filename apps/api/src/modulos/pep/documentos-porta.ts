// Porta do prontuário de uso diário (M23): o que as telas do painel, do cabeçalho, da linha do tempo, das alergias,
// dos problemas, dos exames, dos resultados, dos documentos, da alta, dos anexos, do parecer e das assinaturas leem e
// gravam, independente de onde (a API não escreve SQL; fronteira):
//   - `proprio`: o banco do cliente pelo @sgh/nucleo (leitura pelo Leitor, gravação pelo Executor);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com dados SINTÉTICOS em memória;
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 (falha fechada).
// Melhoria: tipos de negócio próprios (tipos-pep.ts); nenhum código de convivência.
import type { LinhaCausaObito } from '@sgh/dominio-pep';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { ContextoOperacao } from '@sgh/nucleo';
import type { HistoricoAlergia, ManifestacaoAlergica } from '@sgh/contratos';
import type {
  AlergiaDoProntuarioLida,
  AnexoLido,
  AtendimentoPepLido,
  CabecalhoDocumentoLido,
  CienciaLida,
  ContextoGravacaoPep,
  DocumentoHistoricoLido,
  DocumentoResumoLido,
  DocumentoProprioLido,
  EventoLido,
  ExameCatalogoLido,
  FichaImpressao,
  FluxoLido,
  LiberacaoConsultada,
  CompletudePainelLida,
  EpisodioLido,
  LinhaPainelLida,
  RecortePainel,
  SupervisaoLida,
  PacientePepLido,
  PedidoLido,
  ProblemaLido,
  ProblemaNovo,
  ProfissionalDoRegistro,
  ResultadoLido,
  RetratosAtuais,
  SumarioLido,
  TcleLido,
} from './tipos-pep.js';

export const PORTA_DOCUMENTOS = Symbol('PORTA_DOCUMENTOS');

/** Contexto da sessão: cliente, estabelecimento e usuário por id, correlação, rede e código do estabelecimento. */
export type ContextoDocs = ContextoPorta;

/** Profissional da sessão com a ocupação (código CBO 2002 de cada CBO) para a matriz ação × categoria. */
export interface ProfissionalPep extends ProfissionalDoRegistro {
  /** Inscrição no conselho do profissional → código CBO 2002 da ocupação e conselho ativo. */
  readonly ocupacoes: readonly { cbo: number; codigo: string; conselhoAtivo: boolean }[];
}

export interface PortaDocumentos {
  readonly destino: 'proprio' | 'memoria';
  // ── Leituras ───────────────────────────────────────────────────────────────────────────────────────
  agora(c: ContextoDocs): Promise<string>;
  profissional(c: ContextoDocs, login: string): Promise<ProfissionalPep | null>;
  /** Código CBO 2002 da inscrição no conselho do autor de um registro (sigilo da categoria). */
  ocupacaoDoCbo(c: ContextoDocs, cbo: number): Promise<string | null>;
  painel(
    c: ContextoDocs,
    f: { unidade: number | null; busca: string | null } & RecortePainel,
  ): Promise<{ linhas: LinhaPainelLida[]; limitado: boolean }>;
  /** O episódio do atendimento para montar o sumário de alta (motivo, procedimentos, exames; regra 13). */
  episodio(c: ContextoDocs, atendimento: number): Promise<EpisodioLido>;
  /** O que os alertas de completude das linhas do painel precisam, de uma vez (regra 14). */
  completudePainel(
    c: ContextoDocs,
    pacientes: readonly number[],
    atendimentos: readonly number[],
    desde: Date,
  ): Promise<CompletudePainelLida>;
  unidades(c: ContextoDocs): Promise<{ id: number; nome: string }[]>;
  preferenciasPainel(
    c: ContextoDocs,
    login: string,
  ): Promise<{ unidade: number | null; campos: { campo: string; exibir: boolean; ordem: number | null }[] }>;
  paciente(c: ContextoDocs, id: number): Promise<PacientePepLido | null>;
  nomes(c: ContextoDocs, ids: readonly number[]): Promise<Map<number, string>>;
  atendimentos(c: ContextoDocs, paciente: number): Promise<AtendimentoPepLido[]>;
  retratos(c: ContextoDocs, atendimento: number, paciente: number): Promise<RetratosAtuais | null>;
  eventos(
    c: ContextoDocs,
    paciente: number,
    periodo: { de: string; ate: string },
    tipos: ReadonlySet<string>,
    limite: number,
  ): Promise<EventoLido[]>;
  lerReceita(c: ContextoDocs, id: number): Promise<DocumentoHistoricoLido | null>;
  lerAtestado(c: ContextoDocs, id: number): Promise<DocumentoHistoricoLido | null>;
  lerExameExterno(
    c: ContextoDocs,
    id: number,
  ): Promise<(DocumentoHistoricoLido & { elementos: { elemento: string; tipo: string }[] }) | null>;
  documentoDaTrilha(
    c: ContextoDocs,
    tipoAto: number,
    origem: number,
  ): Promise<{ id: number; situacao: number; xml: string } | null>;
  documentos(
    c: ContextoDocs,
    paciente: number,
    familia: 'receita' | 'atestado',
  ): Promise<DocumentoResumoLido[]>;
  fichas(c: ContextoDocs): Promise<FichaImpressao[]>;
  modelosEmUso(c: ContextoDocs, desde: string): Promise<{ nome: string; usos: number }[]>;
  cabecalhoDocumento(
    c: ContextoDocs,
    retratos: { readonly htPaciente: number; readonly htAtendimento: number },
    cbo: number,
    situacao: number,
    tipoAto: number,
  ): Promise<CabecalhoDocumentoLido>;
  alergias(c: ContextoDocs, paciente: number): Promise<AlergiaDoProntuarioLida[]>;
  catalogoAlergias(c: ContextoDocs): Promise<{
    agentes: { id: number; nome: string; tipo: string | null }[];
    principios: { id: number; nome: string }[];
  }>;
  registrosParaAlergia(
    c: ContextoDocs,
    atendimento: number,
    cbos: readonly number[],
  ): Promise<{ registro: number; modelo: string; dataHora: string | null }[]>;
  versaoAlergias(c: ContextoDocs, paciente: number): Promise<string>;
  /** Linha do tempo e manifestações da alergia do paciente (03-PEP L100); 404 se a alergia não é dele. */
  historicoAlergia(c: ContextoDocs, paciente: number, alergia: number): Promise<HistoricoAlergia>;
  /** Catálogo de manifestações ativas, por nome. */
  manifestacoesAlergicas(c: ContextoDocs): Promise<ManifestacaoAlergica[]>;
  catalogoExames(c: ContextoDocs, termo: string | null): Promise<ExameCatalogoLido[]>;
  examesPorId(c: ContextoDocs, ids: readonly number[]): Promise<ExameCatalogoLido[]>;
  kits(c: ContextoDocs): Promise<{ id: number; nome: string; exames: number[] }[]>;
  pedidos(c: ContextoDocs, paciente: number): Promise<PedidoLido[]>;
  resultados(c: ContextoDocs, paciente: number): Promise<ResultadoLido[]>;
  examesExternos(
    c: ContextoDocs,
    paciente: number,
  ): Promise<{ id: number; nome: string; em: string | null; elementos: string[] }[]>;
  anexos(c: ContextoDocs, paciente: number): Promise<AnexoLido[]>;
  arquivoAnexo(c: ContextoDocs, id: number): Promise<{ paciente: number; pdf: Buffer } | null>;
  tiposTermo(c: ContextoDocs): Promise<{ id: number; nome: string }[]>;
  tiposAnexo(c: ContextoDocs): Promise<{ id: number; nome: string }[]>;
  tcleHerdado(c: ContextoDocs, atendimento: number): Promise<string | null>;
  tempos(
    c: ContextoDocs,
    paciente: number,
  ): Promise<
    {
      id: number;
      quando: string | null;
      situacao: string | null;
      profissional: string | null;
      gravadoEm: string | null;
    }[]
  >;
  historicoPareceres(
    c: ContextoDocs,
    paciente: number | null,
  ): Promise<{ pedidos: number; respostas: number; encaminhamentos: number }>;
  especialidades(c: ContextoDocs): Promise<{ id: number; nome: string }[]>;
  especialidadesDoCbo(c: ContextoDocs, cbos: readonly number[]): Promise<number[]>;
  documentosSgh(c: ContextoDocs, paciente: number): Promise<DocumentoProprioLido[]>;
  documentoSgh(c: ContextoDocs, id: number): Promise<DocumentoProprioLido | null>;
  documentoSghDaOrigem(c: ContextoDocs, tabela: string, id: number): Promise<DocumentoProprioLido | null>;
  pendencias(c: ContextoDocs, login: string): Promise<DocumentoProprioLido[]>;
  /** Regra 3: os registros de residentes que aguardam a coassinatura deste preceptor. */
  coassinaturas(c: ContextoDocs, preceptor: string): Promise<SupervisaoLida[]>;
  supervisao(c: ContextoDocs, id: number): Promise<SupervisaoLida | null>;
  /** A coassinatura (ou a recusa) com a trilha. */
  coassinarNoNovo(
    c: ContextoGravacaoPep,
    x: { id: number; decisao: 'coassinado' | 'recusado'; motivo?: string | null },
  ): Promise<{ registro: number; paciente: number }>;
  registrosSemAssinatura(
    c: ContextoDocs,
    login: string,
  ): Promise<{ registro: number; hash: string; em: string; paciente: number; atendimento: number | null }[]>;
  problemas(c: ContextoDocs, paciente: number): Promise<ProblemaLido[]>;
  tcles(c: ContextoDocs, paciente: number): Promise<TcleLido[]>;
  sumarios(c: ContextoDocs, atendimento: number): Promise<SumarioLido[]>;
  transferencias(
    c: ContextoDocs,
    atendimento: number,
  ): Promise<{ id: number; destino: string; em: string; documento: number | null }[]>;
  obito(
    c: ContextoDocs,
    paciente: number,
  ): Promise<{
    id: number;
    em: string;
    numero: string | null;
    documento: number | null;
    atendimento: number;
  } | null>;
  ciencias(c: ContextoDocs, paciente: number): Promise<CienciaLida[]>;
  fila(
    c: ContextoDocs,
    f: { especialidade?: number; categoria?: string; situacao?: string; paciente?: number },
  ): Promise<FluxoLido[]>;
  fluxo(c: ContextoDocs, id: number): Promise<FluxoLido | null>;
  /** O passo 0 do executor (a operação grava agora para este login?), sem gravar. */
  podeGravar(c: ContextoDocs, operacao: string, login: string): Promise<LiberacaoConsultada>;
  // ── Gravações no banco do estabelecimento (executor) ────────────────────────────────────────────────
  executar(
    c: ContextoDocs,
    operacao: string,
    entrada: unknown,
    ctx: ContextoOperacao,
  ): Promise<Record<string, unknown>>;
  // ── Gravações do produto (Executor, com a trilha) ──────────────────────────────────────────────
  gravarProblema(c: ContextoGravacaoPep, p: ProblemaNovo): Promise<number>;
  registrarCiencia(
    c: ContextoGravacaoPep,
    x: {
      paciente: number;
      exame: number;
      chave: string;
      resultado: number | null;
      elemento: string | null;
      conduta: string;
      escalonadoPara: string | null;
    },
  ): Promise<number>;
  aceitarParecer(c: ContextoGravacaoPep, parecer: number): Promise<{ paciente: number }>;
  cancelarParecer(c: ContextoGravacaoPep, parecer: number, motivo: string): Promise<void>;
  emitirTcle(
    c: ContextoGravacaoPep,
    t: {
      paciente: number;
      atendimento: number;
      tipo: number | null;
      procedimento: string;
      cbo: number | null;
      hashConteudo: string;
      comoSuporte?: boolean;
      /** Texto do termo apresentado ao paciente; sem ele, o do modelo (ou o procedimento). */
      texto?: string | null;
    },
  ): Promise<{ id: number; documento: number }>;
  mudarSituacaoTcle(
    c: ContextoGravacaoPep,
    m: { paciente: number; versao: number; situacao: 'assinado' | 'revogado'; motivo: string | null },
  ): Promise<number>;
  salvarRascunhoSumario(
    c: ContextoGravacaoPep,
    s: { paciente: number; atendimento: number; versao: number; conteudo: string; hashConteudo: string },
  ): Promise<number>;
  registrarTransferencia(
    c: ContextoGravacaoPep,
    t: {
      paciente: number;
      atendimento: number;
      destino: string;
      motivo: string;
      conteudo: string;
      cbo: number | null;
      hashConteudo: string;
      comoSuporte?: boolean;
    },
  ): Promise<{ id: number; documento: number }>;
  registrarObito(
    c: ContextoGravacaoPep,
    o: {
      paciente: number;
      atendimento: number;
      dataHora: Date;
      numero: string | null;
      causas: string;
      /** As causas em linhas (parte I, a até d; parte II), gravadas uma a uma. */
      causasLinhas?: readonly LinhaCausaObito[];
      cbo: number | null;
      hashConteudo: string;
      comoSuporte?: boolean;
    },
  ): Promise<{ id: number; documento: number }>;
  /** Cancela a declaração de óbito vigente do paciente, com motivo e evento (03-PEP L126). Nada é apagado. */
  cancelarObito(
    c: ContextoGravacaoPep,
    o: { paciente: number; motivo: string; cbo: number | null },
  ): Promise<{ id: number; documento: number | null }>;
  assinar(
    c: ContextoGravacaoPep,
    itens: readonly { documento: number; hash: string }[],
    comoSuporte?: boolean,
  ): Promise<{ assinados: number[]; recusados: { documento: number; motivo: string }[] }>;
  documentoDoRegistroClinico(
    c: ContextoGravacaoPep,
    r: { registro: number; paciente: number; atendimento: number | null; hash: string },
  ): Promise<number>;
  registrarEventoDocumento(
    c: ContextoGravacaoPep,
    ev: {
      documento: number;
      tipo: 'visualizado' | 'impresso' | 'segunda-via' | 'exportado';
      justificativa?: string | null;
    },
  ): Promise<void>;
  /**
   * A exportação do prontuário completo (01-ADM L82): grava em exportacao_documento quem exportou, quando, a
   * justificativa (texto e tipo padronizado ativo) e o resumo do conteúdo entregue, antes de entregar.
   */
  registrarExportacaoProntuario(
    c: ContextoGravacaoPep,
    e: {
      paciente: number;
      justificativa: string;
      tipoJustificativa?: number | null;
      linhas: number;
      hash: string;
    },
  ): Promise<{ id: number }>;
  /** A leitura incremental do parecer do outro sistema (o ciclo da vigia), com a marca e a trilha. */
  trazerPedidosAnteriores(c: ContextoDocs): Promise<number>;
}
