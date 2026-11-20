// Porta da gestão da qualidade e dos envios regulatórios (M48, etapa 5; ADR 0031): as leituras SGH_ (documentos e
// ciências, análises dos indicadores, auditorias, comissões e reuniões, riscos, não conformidades, manifestações,
// envios; a pesquisa do portal do M50 e os incidentes do M48.1), as do outro sistema que a etapa usa (relógio,
// feriados, o nome do paciente da manifestação identificada) e as gravações só do novo (SGH_QUA_* do 0485 e do 0486)
// numa transação SGH_ com a SGH_TRILHA junto. Duas implementações: sobre o núcleo do legado (a cópia) e em memória
// (dev/ci e os testes; dados sintéticos).
import type {
  DependentesQua,
  TabelaCorrigivelQua,
  VersaoQuaLida,
  AnaliseIndicadorSgh,
  AnaliseIndicadorSghLida,
  AuditoriaSghLida,
  ComissaoSghLida,
  DocumentoQualidadeSgh,
  DocumentoQualidadeSghLido,
  EnvioRegulatorioSghLido,
  FiltroDocumentosSgh,
  ManifestacaoSgh,
  ManifestacaoSghLida,
  NaoConformidadeSgh,
  NaoConformidadeSghLida,
  PaginaGestaoSgh,
  PesquisaSatisfacaoLida,
  ProtocoloPacienteLido,
  ReuniaoComissaoSghLida,
  RiscoSgh,
  RiscoSghLido,
  VersaoGerenciadoLida,
  AltaParaRevisao,
  ChecklistRevisaoSghLido,
  PendenciaRevisaoSghLida,
  ProntuarioRevisaoSghLido,
  PublicacaoChecklistSgh,
  RevisaoSgh,
  SorteioRevisaoSghLido,
  SorteioSgh,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

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
  publicarDocumento(d: SemHospital<DocumentoQualidadeSgh>): Promise<{ id: number }>;
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
    a: SemHospital<AnaliseIndicadorSgh>,
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
    readonly convidados: string | null;
    readonly deliberacoes: string | null;
    readonly agora: string;
    readonly usuario: string;
  }): Promise<{ id: number }>;
  registrarRisco(r: SemHospital<RiscoSgh>): Promise<{ id: number; versao: number; criado: boolean }>;
  registrarNaoConformidade(
    n: SemHospital<NaoConformidadeSgh>,
  ): Promise<{ id: number; versao: number; criada: boolean }>;
  registrarManifestacao(m: SemHospital<ManifestacaoSgh>): Promise<{ id: number; protocolo: string }>;
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
  // W0-04: correção por versão e cancelamento com motivo (a versão anterior vai à SGH_QUA_VERSAO).
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
  publicarChecklistRevisao(p: SemHospital<PublicacaoChecklistSgh>): Promise<{ id: number; revisao: number }>;
  inativarChecklistRevisao(p: MudancaRevisao): Promise<{ versao: number }>;
  sortearRevisao(s: SemHospital<SorteioSgh>): Promise<{ id: number }>;
  cancelarSorteioRevisao(p: MudancaRevisao): Promise<{ versao: number }>;
  revisarProntuario(r: SemHospital<RevisaoSgh>): Promise<{ versao: number }>;
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
  /** O relógio do banco do estabelecimento (instante local `AAAA-MM-DDTHH:mm:ss`). */
  relogio(c: C): Promise<string>;
  /** Os feriados do calendário do estabelecimento no período (AAAA-MM-DD; o ano 9999 vale todo ano). */
  feriados(c: C, de: string, ate: string): Promise<{ readonly data: string }[]>;
  /** O nome do paciente do cadastro (a manifestação identificada; nunca na trilha). */
  nomesPacientes(c: C, ids: readonly number[]): Promise<Map<number, string>>;
  documentos(c: C, f: FiltroDocumentosSgh): Promise<PaginaGestaoSgh<DocumentoQualidadeSghLido>>;
  documento(c: C, id: number): Promise<DocumentoQualidadeSghLido | null>;
  documentosDoCodigo(c: C, codigo: string): Promise<DocumentoQualidadeSghLido[]>;
  ciencias(
    c: C,
    documentos: readonly number[],
    usuario: string,
  ): Promise<Map<number, { total: number; sessao: boolean }>>;
  cientes(c: C, documento: number): Promise<{ usuario: string; cienteEm: string }[]>;
  analises(c: C, competencia: string): Promise<AnaliseIndicadorSghLida[]>;
  historicoAnalises(c: C, indicador: string): Promise<AnaliseIndicadorSghLida[]>;
  auditorias(c: C, f: Pg): Promise<PaginaGestaoSgh<AuditoriaSghLida>>;
  auditoria(c: C, id: number): Promise<AuditoriaSghLida | null>;
  naoConformidadesPorOrigem(c: C, origem: string, ids: readonly number[]): Promise<Map<number, number>>;
  comissoes(c: C): Promise<ComissaoSghLida[]>;
  comissao(c: C, id: number): Promise<ComissaoSghLida | null>;
  reunioes(c: C, comissao: number): Promise<ReuniaoComissaoSghLida[]>;
  riscos(c: C, f: Pg & { readonly situacao?: string | undefined }): Promise<PaginaGestaoSgh<RiscoSghLido>>;
  risco(c: C, id: number): Promise<RiscoSghLido | null>;
  naoConformidades(
    c: C,
    f: Pg & {
      readonly situacao?: string | undefined;
      readonly origem?: string | undefined;
      readonly idOrigem?: number | undefined;
    },
  ): Promise<PaginaGestaoSgh<NaoConformidadeSghLida>>;
  naoConformidade(c: C, id: number): Promise<NaoConformidadeSghLida | null>;
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
  ): Promise<PaginaGestaoSgh<ManifestacaoSghLida>>;
  manifestacao(c: C, id: number): Promise<ManifestacaoSghLida | null>;
  pesquisas(c: C, de: string, ate: string): Promise<{ itens: PesquisaSatisfacaoLida[]; cortada: boolean }>;
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
  envios(c: C, desdeCompetencia: string): Promise<EnvioRegulatorioSghLido[]>;
  envio(c: C, id: number): Promise<EnvioRegulatorioSghLido | null>;
  /** Os incidentes da competência para o Notivisa (`de` inclusivo, `ate` exclusivo; AAAA-MM-DD). */
  incidentesNotivisa(
    c: C,
    de: string,
    ate: string,
  ): Promise<{ itens: IncidenteParaNotivisaLido[]; cortada: boolean }>;
  /** A notificação de incidente do NSP existe no hospital (a origem da não conformidade; nada dela é lido). */
  notificacaoExiste(c: C, id: number): Promise<boolean>;
  // W0-04
  reuniao(c: C, id: number): Promise<ReuniaoComissaoSghLida | null>;
  versoes(c: C, tabela: TabelaCorrigivelQua, id: number): Promise<VersaoQuaLida[]>;
  dependentes(c: C, tabela: string, id: number): Promise<DependentesQua[]>;
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
  ): Promise<{ versoes: VersaoGerenciadoLida[]; protocolos: ProtocoloPacienteLido[] }>;
  // W0-04 (M5): a comissão de revisão de prontuários.
  checklistsRevisao(c: C, comissao: number): Promise<ChecklistRevisaoSghLido[]>;
  checklistRevisao(c: C, id: number): Promise<ChecklistRevisaoSghLido | null>;
  /** As altas do período (`ate` exclusivo) com a clínica e o médico assistente (só leitura do outro sistema). */
  altasParaRevisao(c: C, de: string, ate: string): Promise<{ itens: AltaParaRevisao[]; cortada: boolean }>;
  /** O login de cada médico assistente (o papel Operador ativo; '' sem login). */
  loginsDosMedicos(c: C, registros: readonly number[]): Promise<Map<number, string>>;
  sorteiosRevisao(c: C, comissao: number): Promise<SorteioRevisaoSghLido[]>;
  sorteioRevisao(c: C, id: number): Promise<SorteioRevisaoSghLido | null>;
  prontuariosDoSorteio(c: C, sorteio: number): Promise<ProntuarioRevisaoSghLido[]>;
  prontuarioRevisao(c: C, id: number): Promise<ProntuarioRevisaoSghLido | null>;
  pendenciasDosProntuarios(c: C, ids: readonly number[]): Promise<PendenciaRevisaoSghLida[]>;
  pendenciaRevisao(c: C, id: number): Promise<PendenciaRevisaoSghLida | null>;
  pendenciasDoLogin(c: C, login: string): Promise<PendenciaRevisaoSghLida[]>;
  revisoesDaCompetencia(c: C, comissao: number, competencia: string): Promise<ProntuarioRevisaoSghLido[]>;
  revisoesDaInternacao(c: C, reg: number): Promise<ProntuarioRevisaoSghLido[]>;
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
