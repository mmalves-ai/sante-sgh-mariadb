// Problem Details (RFC 9457) → mensagem em português claro, sem detalhe técnico, com o identificador de
// correlação para o suporte (regra 15).
import { esquemaProblema, type Problema, type TipoProblema, tipoDoProblema } from '@sgh/contratos';

export class ErroApi extends Error {
  override readonly name = 'ErroApi';
  constructor(
    readonly problema: Problema | null,
    readonly status: number,
  ) {
    super(problema?.title ?? `HTTP ${status}`);
  }
}

export interface MensagemErro {
  /** Chaves i18n (erros.<tipo>.titulo / .texto). */
  readonly titulo: string;
  readonly texto: string;
  readonly correlacao: string | null;
  readonly tipo: TipoProblema | 'rede';
  /**
   * Só na recusa de negócio: o motivo que a regra do domínio escreveu em português para o usuário (`detail`).
   * Os demais tipos nunca mostram o texto do servidor.
   */
  readonly motivo?: string | null;
}

const POR_STATUS: Partial<Record<number, TipoProblema>> = {
  400: 'entrada-invalida',
  401: 'nao-autenticado',
  403: 'sem-permissao',
  404: 'nao-encontrado',
  409: 'conflito-de-versao',
  429: 'muitas-tentativas',
  422: 'entrada-invalida',
  423: 'registro-em-edicao',
  503: 'indisponivel',
};

/** O 409 com `codigo` e sem as alterações do conflito de versão é recusa de negócio, não conflito de versão. */
function recusaPeloCodigo(erro: ErroApi): boolean {
  const p = erro.problema;
  return erro.status === 409 && !!p?.codigo && !p.alteracoes;
}

/**
 * Título e texto são sempre os textos pt-BR da aplicação. O `detail` do servidor só aparece como motivo da
 * recusa de negócio, porque ali ele é a frase da regra para o usuário ("Confira o motivo abaixo").
 */
export function mensagemDoErro(erro: unknown): MensagemErro {
  if (erro instanceof ErroApi) {
    const tipo =
      (erro.problema && tipoDoProblema(erro.problema)) ??
      (recusaPeloCodigo(erro) ? 'recusa-de-negocio' : undefined) ??
      POR_STATUS[erro.status] ??
      'erro-interno';
    const motivo = tipo === 'recusa-de-negocio' ? erro.problema?.detail?.trim() || null : null;
    return {
      tipo,
      titulo: `erros.${tipo}.titulo`,
      texto: `erros.${tipo}.texto`,
      correlacao: erro.problema?.correlacao ?? null,
      motivo,
    };
  }
  if (erro instanceof TypeError) {
    return { tipo: 'rede', titulo: 'erros.rede.titulo', texto: 'erros.rede.texto', correlacao: null };
  }
  return {
    tipo: 'erro-interno',
    titulo: 'erros.erro-interno.titulo',
    texto: 'erros.erro-interno.texto',
    correlacao: null,
  };
}

/** Lê a resposta de erro: Problem Details quando houver; senão, só o status. */
export async function erroDaResposta(r: Response): Promise<ErroApi> {
  let problema: Problema | null = null;
  try {
    const corpo: unknown = await r.json();
    const p = esquemaProblema.safeParse(corpo);
    if (p.success)
      problema = { ...p.data, correlacao: p.data.correlacao ?? r.headers.get('x-correlacao') ?? undefined };
  } catch {
    problema = null;
  }
  return new ErroApi(problema, r.status);
}
