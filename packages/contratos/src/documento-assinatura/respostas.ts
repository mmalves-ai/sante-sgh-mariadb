// Respostas da API da assinatura ICP-Brasil (M49). Nada de chave privada, segredo de provedor, CPF completo nem dado
// do paciente: o certificado aparece pela série e pelo CPF mascarado; o verificador público, pelo tipo, data,
// profissional (conselho) e resultado (regra 9).
import type {
  DestinoDocumento,
  EstadoAssinatura,
  FalhaTransitoriaAssinatura,
  FormatoAssinatura,
  MidiaCertificado,
  ModoAssinaturaIcp,
  MotivoRecusaAssinatura,
  NivelAssinatura,
  PoliticaAssinaturaIcp,
  ResultadoValidacao,
  TipoDocumentoPolitica,
} from './vocabulario.js';

export interface CertificadoVinculadoResumo {
  readonly id: number;
  readonly midia: MidiaCertificado;
  readonly provedor: string | null;
  readonly serie: string;
  /** Tipo ICP-Brasil pela política do certificado (A1, A3...). */
  readonly tipo: string | null;
  readonly validoDe: string;
  readonly validoAte: string;
  /** CPF do certificado mascarado (***.456.789-**); o completo nunca sai do servidor. */
  readonly cpfMascarado: string;
  readonly ativo: boolean;
}

export interface PoliticaAssinaturaResumo {
  readonly id: number;
  readonly tipoDocumento: TipoDocumentoPolitica;
  readonly conselho: string | null;
  readonly destino: DestinoDocumento;
  readonly nivel: NivelAssinatura;
  readonly politicaIcp: PoliticaAssinaturaIcp | null;
  readonly formato: FormatoAssinatura;
  readonly alteradaEm: string;
  readonly alteradaPor: string;
}

/** Exigência resolvida para um documento (o que a tela mostra antes de assinar). */
export interface ExigenciaAssinatura {
  readonly nivel: NivelAssinatura;
  readonly politicaIcp: PoliticaAssinaturaIcp | null;
  readonly formato: FormatoAssinatura;
  readonly carimboDoTempo: boolean;
  /** De onde veio: a política cadastrada (ID) ou o piso legal do código (regra 6). */
  readonly origem: { readonly politica: number } | 'piso-legal';
}

/** Pedido de assinatura em nuvem: o navegador vai ao endereço do provedor e volta com o código. */
export interface AutorizacaoPsc {
  readonly tipo: 'nuvem';
  readonly endereco: string;
  readonly expiraEm: string;
}

/** Pedido de assinatura A1/A3: o desafio que o agente local assina (só os hashes, nunca o documento). */
export interface DesafioAgenteLocal {
  readonly tipo: 'agente-local';
  readonly desafio: string;
  readonly hashes: readonly string[];
  readonly algoritmo: 'sha256';
  readonly expiraEm: string;
}

export type InicioAssinaturaIcp = AutorizacaoPsc | DesafioAgenteLocal;

/** M49 (etapa 3): a entrada com certificado A1/A3 está disponível no estabelecimento? (sem dado de pessoa) */
export interface DisponibilidadeLoginCertificado {
  readonly disponivel: boolean;
  /** O endereço do agente local nas estações (http://127.0.0.1:porta), quando há. */
  readonly agenteLocal: string | null;
}

/** O desafio da entrada com certificado: o que o agente local assina, com o endereço dele. */
export interface DesafioLoginCertificado extends DesafioAgenteLocal {
  readonly agenteLocal: string;
}

export interface SituacaoAssinaturaDocumento {
  readonly documento: number;
  readonly estado: EstadoAssinatura;
  readonly nivel: NivelAssinatura | null;
  readonly politicaIcp: PoliticaAssinaturaIcp | null;
  readonly assinadaEm: string | null;
  readonly carimboEm: string | null;
  readonly tentativas: number;
  readonly falha: FalhaTransitoriaAssinatura | null;
  readonly proximaTentativaEm: string | null;
}

export interface ResultadoAssinaturaIcp {
  readonly assinados: readonly number[];
  /** Pendentes por falha transitória: reprocessados sozinhos (regra 5). */
  readonly pendentes: readonly { documento: number; falha: FalhaTransitoriaAssinatura }[];
  readonly recusados: readonly { documento: number; motivo: MotivoRecusaAssinatura }[];
}

export interface ValidacaoResumo {
  readonly resultado: ResultadoValidacao;
  readonly em: string;
  readonly cadeia: boolean | null;
  readonly vigencia: boolean | null;
  readonly revogacao: boolean | null;
  readonly cpf: boolean | null;
  readonly motivos: readonly string[];
}

/**
 * Situação que o verificador público mostra (M49, etapa 3; regra 9): a validação mais recente da assinatura ICP-Brasil
 * do documento do código, "em processamento" (assinatura pendente: revogação ou carimbo fora do ar, regra 5),
 * "suspenso" (o documento foi suspenso depois de assinado) ou "não encontrado" (código inexistente, ou a prévia que
 * nunca foi assinada).
 */
export const SITUACOES_VERIFICACAO = [
  'valida',
  'invalida',
  'indeterminada',
  'pendente',
  'suspenso',
  'nao-encontrado',
] as const;
export type SituacaoVerificacao = (typeof SITUACOES_VERIFICACAO)[number];

/** O que o verificador público mostra (regra 9): tipo, datas, profissional e resultado; nada clínico, nada do paciente. */
export interface VerificacaoPublica {
  readonly situacao: SituacaoVerificacao;
  /** Rótulo do tipo do documento (ex.: "Atestado"). */
  readonly tipoDocumento: string | null;
  readonly emitidoEm: string | null;
  readonly assinadoEm: string | null;
  /** O nome do profissional como o selo do documento mostra. */
  readonly profissional: string | null;
  /** Conselho e número como o selo mostra (ex.: "CRM-RJ 000000"); null sem registro. */
  readonly registro: string | null;
  readonly politica: PoliticaAssinaturaIcp | null;
  readonly carimboEm: string | null;
  /** SHA-256 do PDF assinado: quem tem o arquivo confere que é o mesmo (a conta é feita no navegador). */
  readonly hashPdf: string | null;
  /** Quando a validação mostrada foi feita no servidor. */
  readonly validadaEm: string | null;
}

/** Painel interno do verificador (permissão `documento.verificador.ler`): contagens agregadas, nada por pessoa. */
export interface PainelVerificador {
  readonly desde: string;
  readonly limitePorMinuto: number;
  readonly endereco: string;
  readonly dias: readonly {
    readonly dia: string;
    readonly porResultado: Readonly<Partial<Record<SituacaoVerificacao | 'barrada', number>>>;
    readonly total: number;
  }[];
}

export interface ProvedorPscResumo {
  readonly codigo: string;
  readonly nome: string;
  readonly uriBase: string;
  readonly clientId: string;
  readonly autoridades: readonly string[];
  readonly ativo: boolean;
  /** O segredo nunca aparece: só se está definido no cofre. */
  readonly segredo: 'definido' | 'nao-definido';
}

/** Linha dos cadastros de apoio (OIDs, tipos de certificado, formas de assinatura por provedor). */
export interface ItemCadastroAssinatura {
  readonly id: number;
  readonly descricao: string;
  readonly detalhe: string | null;
}

/** Uma assinatura de conferência (tela "Meu certificado") com a validação no servidor. */
export interface AssinaturaTesteResumo {
  readonly id: number;
  readonly certificado: number;
  readonly politicaIcp: PoliticaAssinaturaIcp;
  readonly estado: EstadoAssinatura;
  readonly falha: FalhaTransitoriaAssinatura | null;
  readonly carimboEm: string | null;
  readonly criadoEm: string;
  readonly validacao:
    | (ValidacaoResumo & { readonly assinaturaConfere: boolean | null; readonly carimbo: boolean | null })
    | null;
}

export interface MeuCertificadoResposta {
  readonly modo: ModoAssinaturaIcp;
  readonly certificados: readonly CertificadoVinculadoResumo[];
  /** Provedores ativos com o segredo definido (os que podem vincular e assinar). */
  readonly provedores: readonly { readonly codigo: string; readonly nome: string }[];
  readonly testes: readonly AssinaturaTesteResumo[];
  /** Endereço do agente local (A1/A3) neste computador; null: não configurado. */
  readonly agenteLocal: string | null;
}

/** Resultado da volta do provedor ou do agente local, para a tela mostrar. */
export interface ResultadoFluxoAssinatura {
  readonly finalidade: 'vincular' | 'teste' | 'documento' | 'digitalizacao';
  readonly ok: boolean;
  readonly certificado: number | null;
  readonly assinatura: number | null;
  readonly motivo: string | null;
  /** Etapa 2: o resultado do lote de documentos (a tela mostra os contadores). */
  readonly lote?: { readonly assinados: number; readonly pendentes: number; readonly recusados: number };
}

export interface PisoPolitica {
  readonly tipoDocumento: TipoDocumentoPolitica;
  readonly destino: DestinoDocumento;
  readonly exigencia: ExigenciaAssinatura;
}

export interface PoliticasAssinaturaResposta {
  readonly regras: readonly PoliticaAssinaturaResumo[];
  /** O que vale hoje para cada tipo e destino (a regra cadastrada ou o piso legal), sem conselho. */
  readonly vigente: readonly PisoPolitica[];
  /** Siglas do cadastro de conselhos profissionais (CRM, COREN…): as opções da regra por conselho. */
  readonly conselhos: readonly string[];
  readonly podeEditar: boolean;
}

export interface ProvedoresPscResposta {
  readonly modo: ModoAssinaturaIcp;
  readonly cofre: 'disponivel' | 'indisponivel';
  readonly provedores: readonly (ProvedorPscResumo & {
    readonly versao: number;
    readonly simulado: boolean;
  })[];
  /** Regra 1: mídias com menos autoridades que o mínimo (vazio: atende). */
  readonly alertaAutoridades: readonly { readonly midia: MidiaCertificado; readonly autoridades: number }[];
  readonly minimoAutoridades: number;
  readonly podeEditar: boolean;
}

export interface TesteConexaoProvedor {
  readonly ok: boolean;
  readonly em: string;
}

// ── M49, etapa 2: documentos emitidos, lote, pendências, selo ──────────────────────────────────────────────

/** Situação da assinatura ICP de um documento na fila do autor. */
export type SituacaoIcpDocumento = 'a-assinar' | 'pendente' | 'falha';

/** Um documento do autor que a política manda assinar com ICP-Brasil (ou que está pendente/em falha). */
export interface ItemPendenciaIcp {
  readonly documento: number;
  readonly tipo: string;
  readonly titulo: string;
  readonly paciente: number;
  /** Nome como o prontuário mostra (a fila é do próprio autor, como a do M23). */
  readonly nome: string;
  readonly emitidoEm: string;
  readonly exigencia: ExigenciaAssinatura;
  readonly situacao: SituacaoIcpDocumento;
  /** A assinatura pendente ou em falha (null em "a assinar"). */
  readonly assinatura: number | null;
  readonly tentativas: number;
  readonly falha: FalhaTransitoriaAssinatura | null;
  readonly proximaTentativaEm: string | null;
}

/** Um documento já assinado com ICP (o selo "assinado" e o PDF validável fora do sistema). */
export interface AssinadoIcpResumo {
  readonly assinatura: number;
  readonly documento: number;
  readonly titulo: string;
  readonly nome: string;
  readonly politicaIcp: PoliticaAssinaturaIcp;
  readonly assinadoEm: string;
  readonly carimboEm: string | null;
  readonly codigo: string;
  readonly resultado: ResultadoValidacao | null;
  readonly pdf: boolean;
}

export interface AvisoAssinaturaResumo {
  readonly id: number;
  readonly assinatura: number;
  readonly documento: number | null;
  readonly destinatario: 'autor' | 'diretor-tecnico';
  readonly estado: EstadoAssinatura;
  readonly falha: FalhaTransitoriaAssinatura | null;
  /** Autor da assinatura (só no painel da direção técnica). */
  readonly autor: string | null;
  readonly criadoEm: string;
}

export interface PendenciasIcpResposta {
  readonly modo: ModoAssinaturaIcp;
  /** A chave `assinatura.icp` ligada para esta pessoa neste estabelecimento (POL-3; sem ela, papel). */
  readonly liberada: boolean;
  readonly motivoDesligada: string | null;
  readonly certificados: readonly CertificadoVinculadoResumo[];
  readonly agenteLocal: string | null;
  readonly itens: readonly ItemPendenciaIcp[];
  readonly limitado: boolean;
  readonly assinados: readonly AssinadoIcpResumo[];
  readonly avisos: readonly AvisoAssinaturaResumo[];
  /** Direção técnica (`documento.assinatura.reprocessar`): as pendências e falhas do estabelecimento. */
  readonly estabelecimento: {
    readonly pendentes: number;
    readonly falhas: number;
    readonly avisos: readonly AvisoAssinaturaResumo[];
  } | null;
  readonly podeReprocessar: boolean;
}

/** A prévia exata (regra 4): o hash do PDF/A com o selo, que é o que o pedido de assinatura devolve. */
export interface PreviaIcp {
  readonly documento: number;
  readonly titulo: string;
  readonly hash: string;
  readonly codigo: string;
  readonly exigencia: ExigenciaAssinatura;
  readonly geradaEm: string;
}

/** Resposta do pedido de assinatura de documentos: o início no provedor ou no agente e as recusas item a item. */
export interface PedidoAssinaturaIcpResposta {
  readonly inicio: InicioAssinaturaIcp | null;
  readonly recusados: readonly { documento: number; motivo: MotivoRecusaAssinatura }[];
}

export interface LoteIcpPreparado {
  readonly itens: readonly PreviaIcp[];
  readonly recusados: readonly { documento: number; motivo: MotivoRecusaAssinatura }[];
}

/** O resultado do lote para a tela (a volta do provedor redireciona com os contadores). */
export interface ResultadoLoteIcp extends ResultadoAssinaturaIcp {
  readonly finalidade: 'documento';
}

export interface SolicitacaoSncrResumo {
  readonly id: number;
  readonly documento: number;
  readonly situacao: 'pendente' | 'numerada' | 'recusada' | 'erro';
  readonly numero: string | null;
  readonly tentativas: number;
}
