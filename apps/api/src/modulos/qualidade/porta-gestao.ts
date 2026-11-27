// Porta da gestão da qualidade (M48, etapa 5) e da revisão de prontuários (W0-04): documentos, indicadores, auditorias,
// comissões, riscos, não conformidades, ouvidoria, envios regulatórios e a comissão de revisão, com as gravações numa
// transação com a trilha junto. Três implementações: a própria sobre o MariaDB do cliente (porta-gestao-propria.ts), em
// memória (dev/ci e os testes; dados sintéticos) e a indisponível (503).
import type {
  DependentesRegistro,
  TabelaCorrigivel,
  VersaoRegistro,
  AnaliseIndicadorNova,
  AnaliseIndicadorRegistrada,
  AuditoriaRegistrada,
  ComissaoRegistrada,
  DocumentoQualidadeNovo,
  DocumentoQualidadeRegistrado,
  EnvioRegulatorioRegistrado,
  FiltroDocumentos,
  ManifestacaoNova,
  ManifestacaoRegistrada,
  NaoConformidadeNova,
  NaoConformidadeRegistrada,
  PaginaGestao,
  PesquisaSatisfacaoRespondida,
  ProtocoloDoPaciente,
  ReuniaoComissaoRegistrada,
  RiscoNovo,
  RiscoRegistrado,
  VersaoProtocoloGerenciado,
  AltaParaRevisao,
  ChecklistRevisaoRegistrado,
  PendenciaRevisaoRegistrada,
  ProntuarioRevisaoRegistrado,
  PublicacaoChecklist,
  RevisaoNova,
  SorteioRevisaoRegistrado,
  SorteioNovo,
} from './tipos.js';
import { type ContextoPortaM18, type PortaGravacaoM18, portaIndisponivel } from '../exames/public-api.js';

export const PORTA_GESTAO = Symbol('PORTA_GESTAO');

export type ContextoGestao = ContextoPortaM18;
type SemHospital<T> = Omit<T, 'hospital'>;
type C = ContextoGestao;
type Pg = { readonly pagina: number; readonly porPagina: number };

export interface IncidenteParaNotivisaLido {
  readonly numero: string;
  readonly ocorridoEm: string;
  readonly tipo: string;
  readonly classificacao: string;
  readonly dano: string;
  readonly neverEvent: boolean;
  readonly transcritaEm: string | null;
  readonly numeroNotivisa: string | null;
}

/** Gravações só do novo (as regras puras conferidas antes, na API). */
export interface GravadorGestao {
  publicarDocumento(d: SemHospital<DocumentoQualidadeNovo>): Promise<{ id: number }>;
  retirarDocumento(r: {
    readonly id: number;
    readonly versao: number;
    readonly motivo: string;
    readonly agora: string;
    readonly usuario: string;
  }): Promise<{ versao: number }>;
  registrarCiencia(c: {
    readonly documento: number;
    readonly agora: string;
    readonly usuario: string;
  }): Promise<{ id: number }>;
  registrarAnaliseIndicador(
    a: SemHospital<AnaliseIndicadorNova>,
  ): Promise<{ id: number; versao: number; criada: boolean }>;
  registrarAuditoria(a: {
    readonly titulo: string;
    readonly area: string;
    readonly referencial: string;
    readonly realizadaEm: string;
    readonly auditores: string;
    readonly itens: string;
    readonly conformes: number;
    readonly parciais: number;
    readonly naoConformes: number;
    readonly naoAplicaveis: number;
    /** A conformidade do checklist que a API calculou no domínio (resultadoChecklist), gravada como a tela mostra. */
    readonly conformidade: number | null;
    readonly conclusao: string;
    readonly agora: string;
    readonly usuario: string;
  }): Promise<{ id: number }>;
  registrarComissao(c: {
    readonly id: number | null;
    readonly versao: number | null;
    readonly tipo: string;
    readonly nome: string;
    readonly periodicidade: string;
    readonly membros: string;
    readonly ativa: boolean;
    readonly agora: string;
    readonly usuario: string;
    /** Revisão do W0-04: a justificativa da alteração e a conferência dos dependentes na transação. */
    readonly justificativa?: string | null;
    readonly conferirDependentes?: boolean;
  }): Promise<{ id: number; versao: number; criada: boolean }>;
  registrarReuniaoComissao(r: {
    readonly comissao: number;
    readonly versaoComissao: number;
    readonly tipo: string;
    readonly realizadaEm: string;
    readonly pauta: string;
    readonly ata: string;
    readonly presentes: string;
    readonly membrosTotal: number;
    readonly presentesTotal: number;
    /** As posições dos presentes na composição que a tela leu (a presença é do membro, nunca do nome). */
    readonly presentesPosicoes?: readonly number[];
    readonly convidados: string | null;
    readonly deliberacoes: string | null;
    readonly agora: string;
    readonly usuario: string;
  }): Promise<{ id: number }>;
  registrarRisco(r: SemHospital<RiscoNovo>): Promise<{ id: number; versao: number; criado: boolean }>;
  registrarNaoConformidade(
    n: SemHospital<NaoConformidadeNova>,
  ): Promise<{ id: number; versao: number; criada: boolean }>;
  registrarManifestacao(m: SemHospital<ManifestacaoNova>): Promise<{ id: number; protocolo: string }>;
  encaminharManifestacao(r: {
    readonly id: number;
    readonly versao: number;
    readonly encaminhadaA: string;
    readonly observacao: string | null;
  }): Promise<{ versao: number }>;
  responderManifestacao(r: {
    readonly id: number;
    readonly versao: number;
    readonly resposta: string;
    readonly procedente: boolean | null;
    readonly agora: string;
    readonly usuario: string;
  }): Promise<{ versao: number }>;
  gerarEnvioRegulatorio(g: {
    readonly tipo: string;
    readonly competencia: string;
    readonly arquivoDe: (revisao: number) => string;
    readonly hash: string;
    readonly linhas: number;
    readonly resumo: string;
    /** O conteúdo do arquivo gerado (a porta própria guarda os bytes, imutáveis, pela porta de armazenamento). */
    readonly conteudo: string;
    readonly agora: string;
    readonly usuario: string;
  }): Promise<{ id: number; revisao: number; arquivo: string }>;
  registrarTransmissaoEnvio(t: {
    readonly id: number;
    readonly versao: number;
    readonly hash: string;
    readonly transmitidoEm: string;
    readonly protocolo: string;
    readonly usuario: string;
  }): Promise<{ versao: number }>;
  // W0-04: correção por versão e cancelamento com motivo (a versão anterior vai à trilha_auditoria).
  alterarAuditoria(
    a: MudancaGestao & {
      readonly titulo: string;
      readonly area: string;
      readonly realizadaEm: string;
      readonly auditores: string;
      readonly itens: string;
      readonly contagens: {
        readonly conformes: number;
        readonly parciais: number;
        readonly naoConformes: number;
        readonly naoAplicaveis: number;
        readonly conformidade: number | null;
      };
      readonly conclusao: string;
    },
  ): Promise<{ versao: number }>;
  cancelarAuditoria(a: MudancaGestao): Promise<{ versao: number }>;
  retificarAta(
    r: MudancaGestao & {
      readonly pauta: string;
      readonly ata: string;
      readonly presentes: string;
      readonly presentesTotal: number;
      readonly convidados: string | null;
      readonly deliberacoes: string | null;
      /** Revisão do W0-04: a assinatura da versão lida (a retificação dela limpa a assinatura). */
      readonly assinaturaAtual: { readonly em: string; readonly por: string } | null;
    },
  ): Promise<{ versao: number }>;
  assinarAta(r: Omit<MudancaGestao, 'justificativa'>): Promise<{ versao: number }>;
  cancelarReuniao(r: MudancaGestao): Promise<{ versao: number }>;
  cancelarNaoConformidade(
    n: MudancaGestao & { readonly duplicadaDe: number | null },
  ): Promise<{ versao: number }>;
  corrigirManifestacao(
    m: MudancaGestao & { readonly tipo: string; readonly area: string; readonly relato: string },
  ): Promise<{ versao: number }>;
  cancelarManifestacao(m: MudancaGestao): Promise<{ versao: number }>;
  // W0-04 (M5): a comissão de revisão de prontuários (script 1025).
  publicarChecklistRevisao(p: SemHospital<PublicacaoChecklist>): Promise<{ id: number; revisao: number }>;
  inativarChecklistRevisao(p: MudancaRevisao): Promise<{ versao: number }>;
  sortearRevisao(s: SemHospital<SorteioNovo>): Promise<{ id: number }>;
  cancelarSorteioRevisao(p: MudancaRevisao): Promise<{ versao: number }>;
  revisarProntuario(r: SemHospital<RevisaoNova>): Promise<{ versao: number }>;
  avalRevisao(a: { id: number; versao: number; agora: string; usuario: string }): Promise<{ versao: number }>;
  responderPendenciaRevisao(p: {
    id: number;
    versao: number;
    resposta: string;
    agora: string;
    usuario: string;
  }): Promise<{ versao: number }>;
  cancelarPendenciaRevisao(p: MudancaRevisao): Promise<{ versao: number }>;
}

/** W0-04 (M5): a mudança da revisão de prontuários (o motivo em `motivo`, como nas gravações do legado). */
export interface MudancaRevisao {
  readonly id: number;
  readonly versao: number;
  readonly motivo: string;
  readonly agora: string;
  readonly usuario: string;
}

/** A mudança versionada: o ID, a versão lida, o motivo, o relógio do banco e quem. */
export interface MudancaGestao {
  readonly id: number;
  readonly versao: number;
  readonly justificativa: string;
  readonly agora: string;
  readonly usuario: string;
}

export interface PortaGestao extends PortaGravacaoM18<GravadorGestao> {
  /**
   * O arquivo do envio pelos bytes guardados na geração (só a porta própria com armazenamento). Sem o método, a rota
   * do arquivo gera de novo dos mesmos dados e confere pelo resumo.
   */
  arquivoEnvio?(
    c: C,
    id: number,
  ): Promise<{ readonly arquivo: string; readonly conteudo: string; readonly hash: string } | null>;
  /** O relógio do banco do estabelecimento (instante local `AAAA-MM-DDTHH:mm:ss`). */
  relogio(c: C): Promise<string>;
  /** Os feriados do calendário do estabelecimento no período (AAAA-MM-DD; o ano 9999 vale todo ano). */
  feriados(c: C, de: string, ate: string): Promise<{ readonly data: string }[]>;
  /** O nome do paciente do cadastro (a manifestação identificada; nunca na trilha). */
  nomesPacientes(c: C, ids: readonly number[]): Promise<Map<number, string>>;
  documentos(c: C, f: FiltroDocumentos): Promise<PaginaGestao<DocumentoQualidadeRegistrado>>;
  /** Os setores ativos do estabelecimento, para escolher a área do documento pelo id (código e nome). */
  setoresDaArea(
    c: C,
  ): Promise<{ readonly id: number; readonly codigo: string | null; readonly nome: string }[]>;
  documento(c: C, id: number): Promise<DocumentoQualidadeRegistrado | null>;
  documentosDoCodigo(c: C, codigo: string): Promise<DocumentoQualidadeRegistrado[]>;
  ciencias(
    c: C,
    documentos: readonly number[],
    usuario: string,
  ): Promise<Map<number, { total: number; sessao: boolean }>>;
  cientes(c: C, documento: number): Promise<{ usuario: string; cienteEm: string }[]>;
  /** Quem a distribuição obriga a ler a revisão vigente e ainda não registrou a ciência (login e nome). */
  pendentesCiencia(c: C, documento: number): Promise<{ usuario: string; nome: string }[]>;
  analises(c: C, competencia: string): Promise<AnaliseIndicadorRegistrada[]>;
  historicoAnalises(c: C, indicador: string): Promise<AnaliseIndicadorRegistrada[]>;
  auditorias(c: C, f: Pg): Promise<PaginaGestao<AuditoriaRegistrada>>;
  auditoria(c: C, id: number): Promise<AuditoriaRegistrada | null>;
  naoConformidadesPorOrigem(c: C, origem: string, ids: readonly number[]): Promise<Map<number, number>>;
  comissoes(c: C): Promise<ComissaoRegistrada[]>;
  comissao(c: C, id: number): Promise<ComissaoRegistrada | null>;
  reunioes(c: C, comissao: number): Promise<ReuniaoComissaoRegistrada[]>;
  riscos(c: C, f: Pg & { readonly situacao?: string | undefined }): Promise<PaginaGestao<RiscoRegistrado>>;
  risco(c: C, id: number): Promise<RiscoRegistrado | null>;
  naoConformidades(
    c: C,
    f: Pg & {
      readonly situacao?: string | undefined;
      readonly origem?: string | undefined;
      readonly idOrigem?: number | undefined;
    },
  ): Promise<PaginaGestao<NaoConformidadeRegistrada>>;
  naoConformidade(c: C, id: number): Promise<NaoConformidadeRegistrada | null>;
  manifestacoes(
    c: C,
    f: Pg & {
      readonly situacao?: string | undefined;
      readonly tipo?: string | undefined;
      readonly busca?: string | undefined;
      /** W0-04 (M4): o mês do recebimento (indicadores), `AAAA-MM-DD` com o fim exclusivo. */
      readonly recebidaDe?: string | undefined;
      readonly recebidaAntes?: string | undefined;
    },
  ): Promise<PaginaGestao<ManifestacaoRegistrada>>;
  manifestacao(c: C, id: number): Promise<ManifestacaoRegistrada | null>;
  pesquisas(
    c: C,
    de: string,
    ate: string,
  ): Promise<{ itens: PesquisaSatisfacaoRespondida[]; cortada: boolean }>;
  pesquisa(
    c: C,
    id: number,
  ): Promise<{
    id: number;
    paciente: number;
    nota: number;
    comentario: string | null;
    respondidaEm: string;
  } | null>;
  contagem(
    c: C,
    agora: string,
    usuario: string,
  ): Promise<{
    documentosVigentes: number;
    documentosRevisaoVencida: number;
    cienciasPendentesSessao: number;
    riscosCriticos: number;
    naoConformidadesAbertas: number;
    naoConformidadesVencidas: number;
    manifestacoesAbertas: number;
    manifestacoesVencidas: number;
  }>;
  envios(c: C, desdeCompetencia: string): Promise<EnvioRegulatorioRegistrado[]>;
  envio(c: C, id: number): Promise<EnvioRegulatorioRegistrado | null>;
  /** Os incidentes da competência para o Notivisa (`de` inclusivo, `ate` exclusivo; AAAA-MM-DD). */
  incidentesNotivisa(
    c: C,
    de: string,
    ate: string,
  ): Promise<{ itens: IncidenteParaNotivisaLido[]; cortada: boolean }>;
  /** A notificação de incidente do NSP existe no hospital (a origem da não conformidade; nada dela é lido). */
  notificacaoExiste(c: C, id: number): Promise<boolean>;
  // W0-04
  reuniao(c: C, id: number): Promise<ReuniaoComissaoRegistrada | null>;
  versoes(c: C, tabela: TabelaCorrigivel, id: number): Promise<VersaoRegistro[]>;
  dependentes(c: C, tabela: string, id: number): Promise<DependentesRegistro[]>;
  /** W0-04 (M2): as notificações do período por tipo e classificação, sem as descartadas (`ate` exclusivo). */
  notificacoesPorTipo(
    c: C,
    de: string,
    ate: string,
  ): Promise<{ tipo: string; classificacao: string; total: number }[]>;
  /** W0-04 (M3): as versões publicadas dos protocolos gerenciados e as inclusões do período (`fim` exclusivo). */
  protocolosGerenciados(
    c: C,
    inicio: string,
    fim: string,
  ): Promise<{ versoes: VersaoProtocoloGerenciado[]; protocolos: ProtocoloDoPaciente[] }>;
  // W0-04 (M5): a comissão de revisão de prontuários.
  checklistsRevisao(c: C, comissao: number): Promise<ChecklistRevisaoRegistrado[]>;
  checklistRevisao(c: C, id: number): Promise<ChecklistRevisaoRegistrado | null>;
  /** As altas do período (`ate` exclusivo) com a clínica e o médico assistente (só leitura do outro sistema). */
  altasParaRevisao(c: C, de: string, ate: string): Promise<{ itens: AltaParaRevisao[]; cortada: boolean }>;
  /** O login de cada médico assistente (o papel Operador ativo; '' sem login). */
  loginsDosMedicos(c: C, registros: readonly number[]): Promise<Map<number, string>>;
  sorteiosRevisao(c: C, comissao: number): Promise<SorteioRevisaoRegistrado[]>;
  sorteioRevisao(c: C, id: number): Promise<SorteioRevisaoRegistrado | null>;
  prontuariosDoSorteio(c: C, sorteio: number): Promise<ProntuarioRevisaoRegistrado[]>;
  prontuarioRevisao(c: C, id: number): Promise<ProntuarioRevisaoRegistrado | null>;
  pendenciasDosProntuarios(c: C, ids: readonly number[]): Promise<PendenciaRevisaoRegistrada[]>;
  pendenciaRevisao(c: C, id: number): Promise<PendenciaRevisaoRegistrada | null>;
  pendenciasDoLogin(c: C, login: string): Promise<PendenciaRevisaoRegistrada[]>;
  revisoesDaCompetencia(c: C, comissao: number, competencia: string): Promise<ProntuarioRevisaoRegistrado[]>;
  revisoesDaInternacao(c: C, reg: number): Promise<ProntuarioRevisaoRegistrado[]>;
}

/** Os métodos da porta (a porta indisponível recusa todos). */
export const METODOS_PORTA_GESTAO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'feriados',
  'nomesPacientes',
  'documentos',
  'documento',
  'documentosDoCodigo',
  'ciencias',
  'cientes',
  'pendentesCiencia',
  'analises',
  'historicoAnalises',
  'auditorias',
  'auditoria',
  'naoConformidadesPorOrigem',
  'comissoes',
  'comissao',
  'reunioes',
  'riscos',
  'risco',
  'naoConformidades',
  'naoConformidade',
  'manifestacoes',
  'manifestacao',
  'pesquisas',
  'pesquisa',
  'contagem',
  'envios',
  'envio',
  'incidentesNotivisa',
  'notificacaoExiste',
  'reuniao',
  'versoes',
  'dependentes',
  'notificacoesPorTipo',
  'protocolosGerenciados',
  'checklistsRevisao',
  'checklistRevisao',
  'altasParaRevisao',
  'loginsDosMedicos',
  'sorteiosRevisao',
  'sorteioRevisao',
  'prontuariosDoSorteio',
  'prontuarioRevisao',
  'pendenciasDosProntuarios',
  'pendenciaRevisao',
  'pendenciasDoLogin',
  'revisoesDaCompetencia',
  'revisoesDaInternacao',
]);

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaGestaoIndisponivel(): PortaGestao {
  return portaIndisponivel<PortaGestao>(METODOS_PORTA_GESTAO);
}
