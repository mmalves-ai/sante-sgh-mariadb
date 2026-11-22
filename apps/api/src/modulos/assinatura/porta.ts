// Porta da assinatura ICP-Brasil (M49): o que o serviço lê e grava, independente de onde (a aplicação não escreve
// SQL). Duas implementações:
//   - `proprio`: o banco do cliente pelo @sgh/nucleo (porta-propria.ts), gravações pelo Executor (trilha, outbox e
//     idempotência na mesma transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo.
import type { ContextoNucleo } from '@sgh/nucleo';
import { portaIndisponivel } from '../exames/public-api.js';
import type {
  AssinaturaDoDocumento,
  AssinaturaParaGravar,
  AssinaturaRealizada,
  AtualizacaoAssinatura,
  AvisoAssinatura,
  AvisoParaGravar,
  CertificadoParaGravar,
  CertificadoVinculado,
  ConsultaPublicaParaGravar,
  DocumentoAssinadoIcp,
  DocumentoEmitidoIcp,
  DocumentoNaFilaIcp,
  DocumentoVerificado,
  FormaAssinaturaIcp,
  IdentidadeParaCertificado,
  PedidoAssinaturaAberto,
  PedidoAssinaturaParaGravar,
  PedidoNumeracao,
  PedidoNumeracaoParaGravar,
  PoliticaParaGravar,
  PoliticaVigente,
  PreviaDoDocumento,
  PreviaParaGravar,
  ProvedorNuvem,
  ProvedorParaGravar,
  ResumoVerificacoes,
  TipoCertificado,
  TrilhaAssinatura,
  ValidacaoParaGravar,
} from './tipos.js';

export const PORTA_ASSINATURA_ICP = Symbol('PORTA_ASSINATURA_ICP');

/**
 * Contexto de uma chamada: a rede e o código do estabelecimento sempre; o contexto do núcleo (cliente, estabelecimento
 * e usuário por id, correlação) quando a chamada vem de uma sessão. Sem ele (agendador, verificador público), a porta
 * própria usa o cliente dela e resolve o estabelecimento pelo código.
 */
export type ContextoAssinatura = {
  readonly rede: string;
  readonly hospital: string;
} & Partial<ContextoNucleo>;

export interface GravadorAssinatura {
  gravarCertificado(c: CertificadoParaGravar): Promise<{ id: number }>;
  inativarCertificado(d: {
    hospital: string;
    usuario: string;
    id: number;
    por: string;
    em: Date;
  }): Promise<boolean>;
  gravarPolitica(p: PoliticaParaGravar): Promise<{ id: number }>;
  gravarProvedor(
    p: ProvedorParaGravar,
    versaoEsperada: number | null,
  ): Promise<{ id: number; versao: number }>;
  gravarPedido(p: PedidoAssinaturaParaGravar): Promise<{ id: number }>;
  /** Só o pedido do estabelecimento e do usuário da sessão (o de outro não é achado nem gasto). */
  consumirPedido(
    stateHash: string,
    dono: { hospital: string; usuario: string },
    agora: Date,
  ): Promise<(PedidoAssinaturaAberto & { vencido: boolean }) | null>;
  gravarAssinatura(a: AssinaturaParaGravar): Promise<{ id: number }>;
  gravarValidacao(v: ValidacaoParaGravar): Promise<{ id: number }>;
  // ── Etapa 2: documentos emitidos ──
  gravarPrevia(p: PreviaParaGravar): Promise<{ id: number }>;
  gravarAssinaturaPdf(a: { assinatura: number; previa: number }): Promise<void>;
  registrarPdfAssinado(
    a: { assinatura: number; chaveS3: string; versaoS3: string; hashPdf: string },
    agora: Date,
  ): Promise<boolean>;
  atualizarAssinatura(a: AtualizacaoAssinatura, agora: Date): Promise<boolean>;
  /**
   * Trava o documento do prontuário na transação e diz se ele já tem OUTRA assinatura ICP "assinada" ou "pendente" (exceto a
   * `exceto`): a conclusão e o reprocessamento não gravam uma segunda assinatura nem um segundo evento "assinado".
   */
  travarDocumentoParaAssinar(
    hospital: string,
    documento: number,
    exceto: number | null,
  ): Promise<'assinada' | 'pendente' | null>;
  /** O evento "assinado" (nível ICP-Brasil) na cadeia do documento do prontuário (documento_prontuario_evento). */
  gravarEventoAssinadoIcp(
    ctx: { hospital: string; usuario: string },
    documento: number,
    comoSuporte: boolean,
  ): Promise<void>;
  gravarAviso(a: AvisoParaGravar): Promise<{ id: number }>;
  marcarAvisosLidos(
    hospital: string,
    avisos: readonly number[],
    por: { login: string; diretorTecnico: boolean },
    agora: Date,
  ): Promise<number>;
  gravarSolicitacaoSncr(s: PedidoNumeracaoParaGravar): Promise<{ id: number }>;
  atualizarSolicitacaoSncr(
    s: {
      id: number;
      hospital: string;
      situacao: PedidoNumeracao['situacao'];
      tentativas: number;
      numero: string | null;
      retorno: string | null;
    },
    agora: Date,
  ): Promise<boolean>;
  gravarNumeroSncr(hospital: string, documento: number, numero: string): Promise<boolean>;
  // ── Etapa 3: verificador público ──
  /** `documento.registrarConsultaPublica`: a consulta ao verificador (consulta_verificacao_documento; a origem já mascarada). */
  registrarConsultaPublica(c: ConsultaPublicaParaGravar): Promise<{ id: number }>;
}

export type TrilhaDaGravacao<T> = TrilhaAssinatura | ((r: T) => TrilhaAssinatura | null) | null;

export interface PortaAssinaturaIcp {
  readonly destino: 'proprio' | 'memoria';
  /** Uma transação com a trilha junto (a função devolve null quando nada foi gravado: sem linha de trilha). */
  gravar<T>(
    c: ContextoAssinatura,
    fn: (g: GravadorAssinatura) => Promise<T>,
    trilha: TrilhaDaGravacao<T>,
  ): Promise<T>;
  identidade(c: ContextoAssinatura, login: string): Promise<IdentidadeParaCertificado | null>;
  formasIcp(c: ContextoAssinatura): Promise<FormaAssinaturaIcp[]>;
  /** Os tipos de certificado aceitos (tipo_certificado): o tipo do certificado vinculado, quando há correspondência. */
  tiposCertificado(c: ContextoAssinatura): Promise<TipoCertificado[]>;
  /** As siglas dos conselhos profissionais (as opções da regra por conselho da política). */
  conselhos(c: ContextoAssinatura): Promise<string[]>;
  certificados(c: ContextoAssinatura, login: string): Promise<CertificadoVinculado[]>;
  certificado(c: ContextoAssinatura, id: number): Promise<CertificadoVinculado | null>;
  politicas(c: ContextoAssinatura): Promise<PoliticaVigente[]>;
  provedores(c: ContextoAssinatura): Promise<ProvedorNuvem[]>;
  provedor(c: ContextoAssinatura, codigo: string): Promise<ProvedorNuvem | null>;
  assinaturas(
    c: ContextoAssinatura,
    login: string,
    origem: 'teste' | 'documento',
  ): Promise<AssinaturaRealizada[]>;
  // ── Etapa 2: documentos emitidos ──
  /** O documento do prontuário (documento_prontuario) por id; null: não existe ou é de outro estabelecimento. */
  documentoEmitido(c: ContextoAssinatura, id: number): Promise<DocumentoEmitidoIcp | null>;
  /**
   * A fila do autor: os documentos dos `tiposIcp` (os que a política manda assinar com ICP) ainda sem assinatura, mais
   * os com assinatura pendente ou em falha; filtro e prioridade (DP-23) aplicados antes do teto.
   */
  filaIcp(
    c: ContextoAssinatura,
    login: string,
    teto: number,
    tiposIcp: readonly string[],
  ): Promise<{ itens: DocumentoNaFilaIcp[]; limitado: boolean }>;
  assinaturasDosDocumentos(
    c: ContextoAssinatura,
    documentos: readonly number[],
  ): Promise<Map<number, { id: number; estado: 'pendente' | 'assinada' | 'falha' }>>;
  previaMaisRecente(
    c: ContextoAssinatura,
    documento: number,
    login: string,
  ): Promise<PreviaDoDocumento | null>;
  previa(c: ContextoAssinatura, id: number): Promise<PreviaDoDocumento | null>;
  assinaturaDocumento(c: ContextoAssinatura, id: number): Promise<AssinaturaDoDocumento | null>;
  pendentesVencidas(
    c: ContextoAssinatura,
    agora: Date,
    teto: number,
  ): Promise<{ id: number; usuario: string }[]>;
  assinadosRecentes(c: ContextoAssinatura, login: string): Promise<DocumentoAssinadoIcp[]>;
  contagemPendencias(c: ContextoAssinatura): Promise<{ pendentes: number; falhas: number }>;
  avisos(c: ContextoAssinatura, para: { autor: string } | 'diretor-tecnico'): Promise<AvisoAssinatura[]>;
  /** Os OIDs (oid_icp com conselho_classe): os OIDs de registro em conselho (o conselho do autor pelo certificado). */
  oidsDeConselho(c: ContextoAssinatura): Promise<{ oid: string; conselho: string }[]>;
  solicitacoesSncr(c: ContextoAssinatura, documento: number): Promise<PedidoNumeracao[]>;
  // ── Etapa 3: verificador público (nada clínico nem do paciente) ──
  documentoDoCodigo(c: ContextoAssinatura, codigo: string): Promise<DocumentoVerificado | null>;
  resumoVerificacoes(c: ContextoAssinatura, desde: Date): Promise<ResumoVerificacoes[]>;
}

export const METODOS_PORTA_ASSINATURA: ReadonlySet<string> = new Set([
  'gravar',
  'identidade',
  'formasIcp',
  'tiposCertificado',
  'conselhos',
  'certificados',
  'certificado',
  'politicas',
  'provedores',
  'provedor',
  'assinaturas',
  'documentoEmitido',
  'filaIcp',
  'assinaturasDosDocumentos',
  'previaMaisRecente',
  'previa',
  'assinaturaDocumento',
  'pendentesVencidas',
  'assinadosRecentes',
  'contagemPendencias',
  'avisos',
  'oidsDeConselho',
  'solicitacoesSncr',
  'documentoDoCodigo',
  'resumoVerificacoes',
]);

export function portaAssinaturaIndisponivel(): PortaAssinaturaIcp {
  return portaIndisponivel<PortaAssinaturaIcp>(METODOS_PORTA_ASSINATURA);
}
