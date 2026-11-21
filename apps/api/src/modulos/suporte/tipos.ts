// Tipos do suporte da plataforma: contas, atribuições, sessões "como", ações e leituras.

export interface GrupoAlvo {
  readonly grupo: string;
  readonly usuarios: number;
}

export interface UsuarioAlvo {
  readonly login: string;
  readonly nome: string;
}

export type ValorSerial =
  | null
  | string
  | number
  | boolean
  | { readonly $d: string }
  | { readonly $b: string }
  | { readonly $n: string };

export type LinhaSerial = Record<string, ValorSerial>;

export type CodigoRede = string;

export type CodigoEstabelecimento = string;

export interface ContextoBanco {
  readonly rede: CodigoRede;
  readonly hospital: CodigoEstabelecimento;
  readonly usuarioLogin?: string;
  readonly estabelecimento?: number;
  readonly idempotencyKey?: string;
  readonly traceId: string;
  readonly modulo?: string;
}

export type Compensacao = 'excluir' | 'restaurar' | 'reinserir';

export interface DiferencaColuna {
  readonly coluna: string;
  readonly esperado: string | null;
  readonly atual: string | null;
}

export interface ImagemLida {
  readonly id: string;
  readonly sessao: string;
  readonly acao: string | null;
  readonly tabela: string;
  readonly operacao: 'inclusao' | 'alteracao' | 'exclusao';
  readonly chave: LinhaSerial;
  readonly antes: LinhaSerial | null;
  readonly depois: LinhaSerial | null;
  readonly corrigida: boolean;
}

export interface PassoCorrecao {
  readonly imagem: ImagemLida;
  readonly compensacao: Compensacao;
  readonly mudancas: readonly { coluna: string; atual: string | null; corrigido: string | null }[];
  readonly conflito: readonly DiferencaColuna[];
  readonly jaCorrigido: boolean;
  readonly estadoConferido: string;
  readonly bloqueio: string | null;
}

export interface CorrecaoFeita {
  readonly imagem: string;
  readonly correcao: string;
  readonly compensacao: Compensacao;
}

export interface AtorCorrecao {
  readonly atorTipo: 'plataforma' | 'suporte';
  readonly idConta: string;
}

export interface LinhaCruzamento {
  readonly idTrilha: string;
  readonly dataHora: Date | null;
  readonly usuarioLogin: string;
  readonly tipo: number | null;
  readonly estacao: string;
  readonly origem: string | null;
  readonly doSuporte: boolean;
}

export type PapelConta = 'PLATAFORMA' | 'SUPORTE';

export interface ContaLida {
  readonly id: string;
  readonly email: string;
  readonly nome: string | null;
  readonly papel: PapelConta;
  readonly ativo: boolean;
  readonly cifra: string | null;
  readonly totpEnv: string | null;
  readonly totpAtivo: boolean;
  readonly conviteHash: string | null;
  readonly conviteAte: Date | null;
  readonly criadoEm: Date;
}

export interface AtribuicaoLida {
  readonly idConta: string;
  readonly rede: string;
  readonly hospital: string;
}

export const id = (v: unknown): string => String(v ?? '').trim();

export interface ContaNova {
  readonly email: string;
  readonly nome: string | null;
  readonly papel: PapelConta;
  readonly cifra: string | null;
  readonly conviteHash: string | null;
  readonly conviteAte: Date | null;
  readonly criadoPor: string | null;
}

export interface MudancaConta {
  readonly ativo?: boolean;
  readonly cifra?: string | null;
  readonly totpEnv?: string | null;
  readonly totpAtivo?: boolean;
  readonly conviteHash?: string | null;
  readonly conviteAte?: Date | null;
}

export interface EventoConta {
  readonly ator: string | null;
  readonly evento: string;
  readonly contaAlvo: string | null;
  readonly detalhe: string | null;
  readonly estacao: string | null;
}

export interface EventoContaLido extends EventoConta {
  readonly id: string;
  readonly dataHora: Date;
}

export interface SessaoComoNova {
  readonly idConta: string;
  readonly atorTipo: 'plataforma' | 'suporte';
  readonly rede: string;
  readonly hospital: string;
  readonly alvoLogin: string;
  readonly alvoId: number | null;
  readonly motivo: string | null;
  readonly minutos: number;
  readonly estacao: string | null;
  readonly modo?: 'como' | 'acesso-total';
}

export interface SessaoComoLida {
  readonly id: string;
  readonly idConta: string;
  readonly atorTipo: 'plataforma' | 'suporte';
  readonly rede: string;
  readonly hospital: string;
  readonly alvoLogin: string;
  readonly motivo: string | null;
  readonly modo: 'como' | 'acesso-total';
  readonly inicio: Date;
  readonly expiraEm: Date;
  readonly fim: Date | null;
  readonly encerramento: string | null;
  readonly escritas: number;
  readonly atosClinicos: number;
}

export interface AcaoNova {
  readonly sessao: string;
  readonly metodo: string;
  readonly caminho: string;
  readonly status: 'ok' | 'error' | 'blocked' | 'aborted';
  readonly http: number | null;
  readonly clinico: boolean;
  readonly naoReversivel: string | null;
}

export interface AcaoLida extends AcaoNova {
  readonly id: string;
  readonly dataHora: Date;
}

export interface LeituraLida {
  readonly sessao: string;
  readonly caminho: string;
  readonly quantidade: number;
  readonly primeira: Date;
  readonly ultima: Date;
}
