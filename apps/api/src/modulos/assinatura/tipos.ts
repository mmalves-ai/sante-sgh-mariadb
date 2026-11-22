// Tipos de negócio da assinatura ICP-Brasil (F2.2, lote 02-01): o que a porta lê e grava, no vocabulário do produto,
// sem forma de tabela de nenhum sistema de origem. Datas lidas em ISO; datas a gravar como Date; ids numéricos;
// `hospital` é o código do estabelecimento e `usuario` o login (a porta própria resolve os dois para os ids).
// Melhoria: a parte pública do certificado (DER) e a impressão digital SHA-256 identificam o certificado (no lugar da
// série com o resumo do emissor); o CPF do titular nunca sai da porta, só a máscara.
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';

export type MidiaCertificado = 'nuvem' | 'a1' | 'a3';
export type PoliticaIcp = 'AD-RB' | 'AD-RT';
export type FormatoAssinatura = 'pades' | 'cades' | 'xades';
export type NivelAssinatura = 'eletronica-simples' | 'eletronica-avancada' | 'icp-brasil';
export type EstadoAssinatura = 'pendente' | 'assinada' | 'falha';
export type ResultadoValidacao = 'valida' | 'invalida' | 'indeterminada';

/** Os tipos de documento que a fila ICP do autor conhece (a mesma lista do domínio: TIPOS_ASSINAVEIS_ICP). */
export const TIPOS_DOCUMENTO_ICP = [
  'receita-controlada',
  'receita-antimicrobiano',
  'atestado',
  'receita',
  'declaracao',
  'requerimento',
  'sumario-alta',
  'rel-transferencia',
  'declaracao-obito',
  'tcle',
  'registro-clinico',
] as const;

export const RESULTADOS_VERIFICACAO = [
  'valida',
  'invalida',
  'indeterminada',
  'pendente',
  'nao-encontrado',
  'barrada',
] as const;
export type ResultadoVerificacao = (typeof RESULTADOS_VERIFICACAO)[number];

export type CodigoErroAssinatura =
  | 'certificado-ja-vinculado'
  | 'versao-desatualizada'
  | 'provedor-repetido'
  | 'nao-encontrado'
  | 'pedido-repetido';

/** Recusa de negócio da gravação da assinatura (a aplicação traduz em Problem Details). */
export class ErroAssinatura extends Error {
  override readonly name = 'ErroAssinatura';
  readonly codigo: CodigoErroAssinatura;
  constructor(codigo: CodigoErroAssinatura, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

/** Linha da trilha de uma gravação da assinatura: a da tela, com o resultado (falha também é registrada). */
export type TrilhaAssinatura = RegistroTrilhaTela & { readonly resultado?: 'sucesso' | 'falha' };

// ── Identidade e catálogos ──

export interface RegistroConselho {
  /** Código CBO da ocupação da inscrição, quando informado. */
  readonly cbo: string | null;
  /** Sigla do conselho (CRM, COREN...). */
  readonly sigla: string | null;
  readonly uf: string | null;
  readonly numero: string | null;
}

export interface IdentidadeParaCertificado {
  /** CPF da conta (só dígitos); null se ausente. */
  readonly cpf: string | null;
  /** CPF do cadastro do profissional ligado à conta, para a conferência cruzada; null se não houver. */
  readonly cpfProfissional: string | null;
  readonly registros: readonly RegistroConselho[];
}

export interface FormaAssinaturaIcp {
  readonly id: number;
  readonly descricao: string;
  readonly politica: PoliticaIcp | null;
}

export interface TipoCertificado {
  readonly id: number;
  readonly nome: string;
  readonly ativo: boolean;
}

// ── Certificado ──

export interface CertificadoParaGravar {
  readonly hospital: string;
  readonly usuario: string;
  readonly midia: MidiaCertificado;
  readonly provedor: string | null;
  readonly idTipoCertificado: number | null;
  readonly serie: string;
  readonly emissorHash: string;
  readonly tipoIcp: string | null;
  readonly validoDe: Date;
  readonly validoAte: Date;
  readonly cpfMascarado: string;
  /** DER em base64 (só a parte pública). */
  readonly certificadoDer: string;
}

export interface CertificadoVinculado extends Omit<
  CertificadoParaGravar,
  'validoDe' | 'validoAte' | 'certificadoDer'
> {
  readonly id: number;
  readonly validoDe: string;
  readonly validoAte: string;
  readonly ativo: boolean;
  readonly criadoEm: string;
  /** Só na leitura por id (a lista não traz a parte pública). */
  readonly certificadoDer: string | null;
}

// ── Política ──

export interface PoliticaParaGravar {
  readonly hospital: string;
  readonly tipoDocumento: string;
  readonly conselho: string | null;
  readonly destino: 'interno' | 'externo';
  readonly nivel: NivelAssinatura;
  readonly politicaIcp: PoliticaIcp | null;
  readonly idFormaIcp: number | null;
  readonly formato: FormatoAssinatura;
  readonly ativa: boolean;
  readonly justificativa: string;
  readonly usuario: string;
}

export interface PoliticaVigente extends Omit<PoliticaParaGravar, 'hospital' | 'justificativa'> {
  readonly id: number;
  readonly criadoEm: string;
}

// ── Provedor em nuvem ──

export interface ProvedorParaGravar {
  readonly hospital: string;
  readonly codigo: string;
  readonly nome: string;
  readonly uriBase: string;
  readonly clientId: string;
  readonly autoridades: readonly string[];
  readonly ativo: boolean;
  readonly segredoRef: string;
  readonly por: string;
  readonly em: Date;
}

export interface ProvedorNuvem extends Omit<ProvedorParaGravar, 'hospital' | 'por' | 'em'> {
  readonly id: number;
  readonly versao: number;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
}

// ── Pedido de assinatura (autorização do titular) ──

export interface PedidoAssinaturaParaGravar {
  readonly hospital: string;
  readonly usuario: string;
  readonly finalidade: 'vincular' | 'teste' | 'documento' | 'digitalizacao';
  readonly midia: MidiaCertificado;
  readonly provedor: string | null;
  readonly certificado: number | null;
  readonly stateHash: string;
  readonly pkceCifrado: string | null;
  readonly hashes: readonly string[];
  readonly documentos: readonly number[];
  readonly expiraEm: Date;
}

export interface PedidoAssinaturaAberto extends Omit<PedidoAssinaturaParaGravar, 'expiraEm'> {
  readonly id: number;
  readonly expiraEm: string;
}

// ── Assinatura e validação ──

export interface AssinaturaParaGravar {
  readonly hospital: string;
  readonly origem: 'teste' | 'documento' | 'digitalizacao';
  readonly documento: number | null;
  readonly hash: string;
  readonly formato: FormatoAssinatura;
  readonly politicaIcp: PoliticaIcp;
  readonly midia: MidiaCertificado;
  readonly provedor: string | null;
  readonly certificado: number;
  readonly usuario: string;
  readonly estado: EstadoAssinatura;
  readonly tentativas: number;
  readonly falha: string | null;
  readonly proximaEm: Date | null;
  /** Base64. */
  readonly assinatura: string | null;
  readonly carimboToken: string | null;
  readonly carimboEm: Date | null;
  readonly carimboSerie: string | null;
}

export interface ValidacaoParaGravar {
  readonly assinatura: number;
  readonly momento: 'incluir' | 'assinar' | 'imprimir' | 'importar' | 'exportar';
  readonly resultado: ResultadoValidacao;
  readonly cadeia: boolean | null;
  readonly vigencia: boolean | null;
  readonly revogacao: boolean | null;
  readonly cpf: boolean | null;
  readonly assinaturaConfere: boolean | null;
  readonly carimbo: boolean | null;
  readonly motivos: readonly string[];
  readonly usuario: string;
  readonly em: Date;
}

export interface AssinaturaRealizada {
  readonly id: number;
  readonly origem: 'teste' | 'documento' | 'digitalizacao';
  readonly documento: number | null;
  readonly hash: string;
  readonly politicaIcp: PoliticaIcp;
  readonly midia: MidiaCertificado;
  readonly provedor: string | null;
  readonly certificado: number;
  readonly estado: EstadoAssinatura;
  readonly tentativas: number;
  readonly falha: string | null;
  readonly carimboEm: string | null;
  readonly criadoEm: string;
  readonly validacao: {
    readonly resultado: ResultadoValidacao;
    readonly em: string;
    readonly cadeia: boolean | null;
    readonly vigencia: boolean | null;
    readonly revogacao: boolean | null;
    readonly cpf: boolean | null;
    readonly assinaturaConfere: boolean | null;
    readonly carimbo: boolean | null;
    readonly motivos: readonly string[];
  } | null;
}

// ── Documentos emitidos (etapa 2) ──

/** O documento do prontuário a assinar. */
export interface DocumentoEmitidoIcp {
  readonly id: number;
  readonly tipo: string;
  readonly origemTabela: string;
  readonly origemId: number;
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly usuario: string;
  readonly hash: string;
  readonly nivel: string;
  readonly criadoEm: string | null;
  readonly assinadoEm: string | null;
  readonly suspenso: boolean;
  readonly comoSuporte: boolean;
}

export interface PreviaParaGravar {
  readonly hospital: string;
  readonly documento: number;
  readonly usuario: string;
  readonly certificado: number;
  readonly politicaIcp: PoliticaIcp;
  readonly hashPdf: string;
  readonly chaveS3: string;
  readonly versaoS3: string;
  readonly codigo: string;
  /** Instante ISO da assinatura (o /M do PDF). */
  readonly assinarEm: string;
  /** O profissional e o registro exatamente como o selo mostra (o verificador público lê daqui). */
  readonly profissional?: string | null;
  readonly registro?: string | null;
}

export interface PreviaDoDocumento extends PreviaParaGravar {
  readonly id: number;
  readonly criadoEm: string;
}

export interface AssinaturaDoDocumento {
  readonly id: number;
  readonly hospital: string;
  readonly documento: number;
  readonly hash: string;
  readonly politicaIcp: PoliticaIcp;
  readonly midia: MidiaCertificado;
  readonly provedor: string | null;
  readonly certificado: number;
  readonly usuario: string;
  readonly estado: EstadoAssinatura;
  readonly tentativas: number;
  readonly falha: string | null;
  readonly proximaEm: string | null;
  readonly assinatura: string | null;
  readonly carimboToken: string | null;
  readonly carimboEm: string | null;
  readonly criadoEm: string;
  readonly previa: number | null;
  readonly pdf: { readonly chaveS3: string; readonly versaoS3: string; readonly hashPdf: string } | null;
}

export interface AtualizacaoAssinatura {
  readonly id: number;
  readonly hospital: string;
  /** Controle otimista: só atualiza se o estado e as tentativas forem os lidos (duas instâncias não repetem). */
  readonly estadoLido: 'pendente' | 'falha';
  readonly tentativasLidas: number;
  readonly estado: EstadoAssinatura;
  readonly tentativas: number;
  readonly falha: string | null;
  readonly proximaEm: Date | null;
  readonly carimboToken: string | null;
  readonly carimboEm: Date | null;
  readonly carimboSerie: string | null;
}

export interface DocumentoNaFilaIcp {
  readonly documento: number;
  readonly tipo: string;
  readonly paciente: number;
  readonly criadoEm: string;
  readonly assinatura: number | null;
  readonly estado: 'pendente' | 'falha' | null;
  readonly tentativas: number;
  readonly falha: string | null;
  readonly proximaEm: string | null;
}

export interface DocumentoAssinadoIcp {
  readonly assinatura: number;
  readonly documento: number;
  readonly tipo: string;
  readonly paciente: number;
  readonly politicaIcp: PoliticaIcp;
  readonly assinadoEm: string;
  readonly carimboEm: string | null;
  readonly codigo: string | null;
  readonly temPdf: boolean;
  readonly resultado: ResultadoValidacao | null;
}

export interface AvisoParaGravar {
  readonly hospital: string;
  readonly assinatura: number;
  readonly destinatario: 'autor' | 'diretor-tecnico';
  /** O autor (destinatário "autor"); null para a direção técnica. */
  readonly usuario: string | null;
  readonly estado: 'pendente' | 'falha';
  readonly falha: string | null;
}

export interface AvisoAssinatura {
  readonly id: number;
  readonly assinatura: number;
  readonly documento: number | null;
  readonly destinatario: 'autor' | 'diretor-tecnico';
  readonly estado: 'pendente' | 'falha';
  readonly falha: string | null;
  readonly autor: string;
  readonly criadoEm: string;
}

export interface PedidoNumeracaoParaGravar {
  readonly hospital: string;
  readonly documento: number;
  readonly origemId: number;
  readonly tipo: 'controle-especial' | 'antimicrobiano';
  readonly medicamentos: number;
  readonly usuario: string;
}

export interface PedidoNumeracao {
  readonly id: number;
  readonly documento: number;
  readonly situacao: 'pendente' | 'numerada' | 'recusada' | 'erro';
  readonly tentativas: number;
  readonly numero: string | null;
  readonly retorno: string | null;
}

// ── Verificador público (etapa 3) ──

export interface DocumentoVerificado {
  readonly previa: number;
  readonly documento: number;
  readonly tipo: string;
  readonly emitidoEm: string | null;
  readonly suspenso: boolean;
  readonly politicaIcp: PoliticaIcp;
  readonly assinarEm: string;
  readonly profissional: string | null;
  readonly registro: string | null;
  readonly assinatura: {
    readonly id: number;
    readonly estado: EstadoAssinatura;
    readonly carimboEm: string | null;
    readonly hashPdf: string | null;
  } | null;
  readonly validacao: {
    readonly resultado: ResultadoValidacao;
    readonly momento: string;
    readonly em: string | null;
  } | null;
}

export interface ConsultaPublicaParaGravar {
  readonly hospital: string;
  /** O código informado na consulta (até 64 caracteres; não é dado de pessoa). */
  readonly codigo: string;
  readonly documento: number | null;
  readonly previa: number | null;
  readonly resultado: ResultadoVerificacao;
  /** A origem já mascarada (IPv4 /24, IPv6 /48): o endereço completo nunca chega aqui. */
  readonly origemMascarada: string;
}

export interface ResumoVerificacoes {
  readonly dia: string;
  readonly resultado: ResultadoVerificacao;
  readonly consultas: number;
}
