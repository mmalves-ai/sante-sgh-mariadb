// Porta da assinatura ICP-Brasil (M49, etapa 1): o que o serviço lê e grava, independente de onde (a API não escreve
// SQL; fronteira Nx). Todas as gravações são SÓ do novo (SGH_ACESSO_CERTIFICADO, SGH_DOC_POLITICA_ASSIN,
// SGH_DOC_PROVEDOR_PSC, SGH_DOC_PEDIDO_ASSINATURA, SGH_DOC_ASSINATURA, SGH_DOC_VALIDACAO), com a SGH_TRILHA na mesma
// transação; nenhuma tabela do legado é tocada. Leituras do legado: só a identidade do usuário (CPF e conselho) e as
// formas de assinatura (AD-RB/AD-RT), os tipos de certificado e os conselhos profissionais.
//   - `legado`: o núcleo (READ ONLY nas leituras; transação SGH_ nas gravações);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo.
import type {
  AssinadoIcpLido,
  AssinaturaDocumentoLida,
  ConsultaPublicaParaGravar,
  DocumentoVerificadoLido,
  ResumoVerificacoesLido,
  AssinaturaLida,
  AtualizacaoAssinatura,
  AvisoAssinaturaLido,
  AvisoParaGravar,
  DocumentoParaIcpLido,
  DocumentoSghLido,
  PreviaGravada,
  PreviaParaGravar,
  SolicitacaoSncrLida,
  SolicitacaoSncrParaGravar,
  AssinaturaParaGravar,
  CertificadoGravado,
  CertificadoParaGravar,
  FormaAssinaturaIcpLida,
  IdentidadeParaCertificado,
  LinhaTrilha,
  PedidoAssinaturaGravado,
  PedidoAssinaturaParaGravar,
  PoliticaGravada,
  PoliticaParaGravar,
  ProvedorGravado,
  ProvedorParaGravar,
  TipoCertificadoLido,
  ValidacaoParaGravar,
} from '@sgh/legado';

export const PORTA_ASSINATURA_ICP = Symbol('PORTA_ASSINATURA_ICP');

export interface ContextoAssinatura {
  readonly rede: string;
  readonly hospital: string;
}

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
  ): Promise<(PedidoAssinaturaGravado & { vencido: boolean }) | null>;
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
   * Trava o documento do novo na transação e diz se ele já tem OUTRA assinatura ICP "assinada" ou "pendente" (exceto a
   * `exceto`): a conclusão e o reprocessamento não gravam uma segunda assinatura nem um segundo evento "assinado".
   */
  travarDocumentoParaAssinar(
    hospital: string,
    documento: number,
    exceto: number | null,
  ): Promise<'assinada' | 'pendente' | null>;
  /** O evento "assinado" (nível ICP-Brasil) na cadeia do documento do novo (SGH_PEP_DOCUMENTO_EVENTO). */
  gravarEventoAssinadoIcp(
    ctx: { hospital: string; usuarioLegado: string },
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
  gravarSolicitacaoSncr(s: SolicitacaoSncrParaGravar): Promise<{ id: number }>;
  atualizarSolicitacaoSncr(
    s: {
      id: number;
      hospital: string;
      situacao: SolicitacaoSncrLida['situacao'];
      tentativas: number;
      numero: string | null;
      retorno: string | null;
    },
    agora: Date,
  ): Promise<boolean>;
  gravarNumeroSncr(hospital: string, documento: number, numero: string): Promise<boolean>;
  // ── Etapa 3: verificador público ──
  /** `documento.registrarConsultaPublica`: a consulta ao verificador (SGH_DOC_VERIFICACAO; a origem já mascarada). */
  registrarConsultaPublica(c: ConsultaPublicaParaGravar): Promise<{ id: number }>;
}

export type TrilhaDaGravacao<T> = LinhaTrilha | ((r: T) => LinhaTrilha | null) | null;

export interface PortaAssinaturaIcp {
  readonly destino: 'legado' | 'memoria';
  /** Uma transação SGH_ com a trilha junto (a função devolve null quando nada foi gravado: sem linha de trilha). */
  gravar<T>(
    c: ContextoAssinatura,
    fn: (g: GravadorAssinatura) => Promise<T>,
    trilha: TrilhaDaGravacao<T>,
  ): Promise<T>;
  identidade(c: ContextoAssinatura, login: string): Promise<IdentidadeParaCertificado | null>;
  formasIcp(c: ContextoAssinatura): Promise<FormaAssinaturaIcpLida[]>;
  /** TBTIPOCERTIFICADO (Black Box, SafeWeb, Vidaas no pc): o tipo do certificado vinculado, quando há correspondência. */
  tiposCertificado(c: ContextoAssinatura): Promise<TipoCertificadoLido[]>;
  /** TBCONSPROF: as siglas dos conselhos profissionais (as opções da regra por conselho da política). */
  conselhos(c: ContextoAssinatura): Promise<string[]>;
  certificados(c: ContextoAssinatura, login: string): Promise<CertificadoGravado[]>;
  certificado(c: ContextoAssinatura, id: number): Promise<CertificadoGravado | null>;
  politicas(c: ContextoAssinatura): Promise<PoliticaGravada[]>;
  provedores(c: ContextoAssinatura): Promise<ProvedorGravado[]>;
  provedor(c: ContextoAssinatura, codigo: string): Promise<ProvedorGravado | null>;
  assinaturas(c: ContextoAssinatura, login: string, origem: 'teste' | 'documento'): Promise<AssinaturaLida[]>;
  // ── Etapa 2: documentos emitidos ──
  /** O documento do novo (SGH_PEP_DOCUMENTO) por ID; null: não existe (o do outro sistema não tem prova, regra 7). */
  documentoEmitido(c: ContextoAssinatura, id: number): Promise<DocumentoSghLido | null>;
  /**
   * A fila do autor: os documentos dos `tiposIcp` (os que a política manda assinar com ICP) ainda sem assinatura, mais
   * os com assinatura pendente ou em falha; filtro e prioridade (DP-23) aplicados antes do teto.
   */
  filaIcp(
    c: ContextoAssinatura,
    login: string,
    teto: number,
    tiposIcp: readonly string[],
  ): Promise<{ itens: DocumentoParaIcpLido[]; limitado: boolean }>;
  assinaturasDosDocumentos(
    c: ContextoAssinatura,
    documentos: readonly number[],
  ): Promise<Map<number, { id: number; estado: 'pendente' | 'assinada' | 'falha' }>>;
  previaMaisRecente(c: ContextoAssinatura, documento: number, login: string): Promise<PreviaGravada | null>;
  previa(c: ContextoAssinatura, id: number): Promise<PreviaGravada | null>;
  assinaturaDocumento(c: ContextoAssinatura, id: number): Promise<AssinaturaDocumentoLida | null>;
  pendentesVencidas(
    c: ContextoAssinatura,
    agora: Date,
    teto: number,
  ): Promise<{ id: number; usuario: string }[]>;
  assinadosRecentes(c: ContextoAssinatura, login: string): Promise<AssinadoIcpLido[]>;
  contagemPendencias(c: ContextoAssinatura): Promise<{ pendentes: number; falhas: number }>;
  avisos(c: ContextoAssinatura, para: { autor: string } | 'diretor-tecnico'): Promise<AvisoAssinaturaLido[]>;
  /** TBOID com TBCONSPROF: os OIDs de registro em conselho (o conselho do autor pelo certificado). */
  oidsDeConselho(c: ContextoAssinatura): Promise<{ oid: string; conselho: string }[]>;
  solicitacoesSncr(c: ContextoAssinatura, documento: number): Promise<SolicitacaoSncrLida[]>;
  // ── Etapa 3: verificador público (só SGH_; nada clínico nem do paciente) ──
  documentoDoCodigo(c: ContextoAssinatura, codigo: string): Promise<DocumentoVerificadoLido | null>;
  resumoVerificacoes(c: ContextoAssinatura, desde: Date): Promise<ResumoVerificacoesLido[]>;
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
