// M58-F4, regra 9: o contrato de erro da API de integração da Hal-AI, preservado pela fachada. Toda resposta de erro
// tem a forma { status: "error", codigo, message } em português; o 5xx sai com a mensagem genérica e o erro real
// fica só no log; a mensagem do banco nunca atravessa (utils/http.js, utils/erros-fastify.js da versão 0.23.0).
import {
  CODIGOS_ERRO_FACHADA as E,
  type CodigoErroFachada,
  type ErroFachada,
  MENSAGEM_ERRO_INTERNO_FACHADA,
} from '@sgh/contratos';

/** Erro com status HTTP, código estável e campos extras (o `httpError` da API original). */
export class ErroHttpFachada extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly codigo?: CodigoErroFachada,
    readonly extra: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'ErroHttpFachada';
  }
}

export const erroFachada = (
  status: number,
  message: string,
  codigo?: CodigoErroFachada,
  extra?: Readonly<Record<string, unknown>>,
) => new ErroHttpFachada(status, message, codigo, extra);

/** 400 com o código padrão de parâmetro inválido (o `badRequest`). */
export const requisicaoInvalida = (message: string, codigo: CodigoErroFachada = E.parametroInvalido) =>
  new ErroHttpFachada(400, message, codigo);

/** A resposta de qualquer erro: o de negócio com o texto dele; qualquer outro vira o 500 genérico. */
export function respostaDeErro(e: unknown): { status: number; corpo: ErroFachada; interno: boolean } {
  if (e instanceof ErroHttpFachada && e.status < 500)
    return {
      status: e.status,
      corpo: { status: 'error', ...(e.codigo ? { codigo: e.codigo } : {}), message: e.message, ...e.extra },
      interno: false,
    };
  const status = e instanceof ErroHttpFachada ? e.status : 500;
  return {
    status,
    corpo:
      e instanceof ErroHttpFachada && e.codigo && e.codigo !== E.erroInterno
        ? // 5xx da própria fachada (destino do repasse fora, 503): o código é dela, nunca do banco.
          { status: 'error', codigo: e.codigo, message: e.message }
        : { status: 'error', codigo: E.erroInterno, message: MENSAGEM_ERRO_INTERNO_FACHADA },
    interno: true,
  };
}

/** Rota que não existe: o caminho da documentação nunca entra na mensagem (erros-fastify.js). */
export const rotaNaoEncontrada = (metodo: string, caminho: string) =>
  new ErroHttpFachada(
    404,
    `A rota ${metodo} ${caminho.split('?')[0]} não existe nesta API. ` +
      'Confira o nome da operação no catálogo que você importou — isto é erro de chamada, ' +
      'não ausência de dado.',
    E.rotaNaoEncontrada,
  );

export const naoAutorizado = () =>
  new ErroHttpFachada(
    401,
    'Não autorizado: token ausente ou inválido. Verifique o header Authorization.',
    E.naoAutorizado,
  );

export const acoesDesabilitadas = () =>
  new ErroHttpFachada(
    403,
    'A superfície de ações está desligada neste ambiente. NÃO tente de novo: isto é configuração, ' +
      'não falha temporária. Ela ALTERA dados, então exige a escrita ligada explicitamente.',
    E.acoesDesabilitadas,
  );

// ── Validação (as mensagens do AJV traduzidas: mensagemValidacao) ───────────────────────────────────

export type OndeViolacao = 'querystring' | 'params' | 'body';
export type Violacao =
  | { readonly tipo: 'required'; readonly campo: string }
  | { readonly tipo: 'type'; readonly campo: string; readonly esperado: string }
  | { readonly tipo: 'enum'; readonly campo: string; readonly valores: readonly string[] }
  | { readonly tipo: 'minimum' | 'maximum'; readonly campo: string; readonly limite: number }
  | { readonly tipo: 'maxLength' | 'minLength'; readonly campo: string; readonly limite: number }
  | { readonly tipo: 'pattern'; readonly campo: string };

const ONDE: Readonly<Record<OndeViolacao, string>> = {
  querystring: 'parâmetro',
  params: 'parâmetro de caminho',
  body: 'campo do corpo',
};

function explicar(v: Violacao, onde: string): string {
  const c = v.campo;
  switch (v.tipo) {
    case 'required':
      return `falta o ${onde} obrigatório "${c}"`;
    case 'type':
      return `o ${onde} "${c}" deve ser do tipo ${v.esperado}`;
    case 'enum':
      return `o ${onde} "${c}" aceita apenas: ${v.valores.join(', ')}`;
    case 'minimum':
      return `o ${onde} "${c}" deve ser no mínimo ${v.limite}`;
    case 'maximum':
      return `o ${onde} "${c}" deve ser no máximo ${v.limite}`;
    case 'minLength':
      return `o ${onde} "${c}" deve ter ao menos ${v.limite} caractere(s)`;
    case 'maxLength':
      return `o ${onde} "${c}" deve ter no máximo ${v.limite} caractere(s)`;
    case 'pattern':
      return `o ${onde} "${c}" está em formato inválido`;
  }
}

/** "Requisição inválida: …." com as violações sem repetição (a mesma frase da API original). */
export function mensagemValidacao(onde: OndeViolacao, violacoes: readonly Violacao[]): string {
  const unicas = [...new Set(violacoes.map((v) => explicar(v, ONDE[onde])))];
  if (!unicas.length) return 'Requisição inválida.';
  const texto = unicas.join('; ');
  return `Requisição inválida: ${texto[0]!.toUpperCase()}${texto.slice(1)}.`;
}

export const erroValidacao = (onde: OndeViolacao, violacoes: readonly Violacao[]) =>
  new ErroHttpFachada(400, mensagemValidacao(onde, violacoes), E.parametroInvalido);

/** Inteiro na faixa ou 400 `valor_fora_da_faixa` (o overflow do banco vazava a mensagem dele). */
export function inteiroNaFaixa(valor: unknown, campo: string, min: number, max: number): number {
  const n = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : (valor as number);
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max)
    throw requisicaoInvalida(
      `Campo "${campo}" deve ser um inteiro entre ${min} e ${max}`,
      E.valorForaDaFaixa,
    );
  return n;
}

export const smallint = (valor: unknown, campo: string) => inteiroNaFaixa(valor, campo, -32768, 32767);

/** Recusa de conteúdo do banco (validação, CHECK, exceção de gatilho): vira 409 em português, nunca o texto dele. */
const GDS_RECUSA = new Set([335544347, 335544558, 335544517]);
export function ehRecusaDeConteudo(e: unknown): boolean {
  const g = Number((e as { gdscode?: unknown } | null)?.gdscode);
  if (GDS_RECUSA.has(g)) return true;
  const codigo = (e as { codigo?: unknown } | null)?.codigo;
  return codigo === 'recusa-do-banco';
}
