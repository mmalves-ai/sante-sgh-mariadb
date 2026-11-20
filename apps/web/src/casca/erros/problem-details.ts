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

/** Nunca usa `detail` nem `title` do servidor no texto: só os textos pt-BR da aplicação. */
export function mensagemDoErro(erro: unknown): MensagemErro {
  if (erro instanceof ErroApi) {
    const tipo =
      (erro.problema && tipoDoProblema(erro.problema)) ?? POR_STATUS[erro.status] ?? 'erro-interno';
    return {
      tipo,
      titulo: `erros.${tipo}.titulo`,
      texto: `erros.${tipo}.texto`,
      correlacao: erro.problema?.correlacao ?? null,
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
