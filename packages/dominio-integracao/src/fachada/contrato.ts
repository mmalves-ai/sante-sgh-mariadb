// M58-F4 (ficha, regra 8): a verificação do provedor no estilo dos contratos dirigidos pelo consumidor. A expectativa
// do consumidor (os Squads da Hal-AI) é a forma da resposta de exemplo de cada operação na especificação OpenAPI da
// API original (extraída por tools/fachada/extrair-contrato.ts): toda chave esperada existe na resposta da fachada,
// com o mesmo tipo; chave a mais não quebra o consumidor (como no Pact). `null` no exemplo aceita qualquer valor, e o
// valor nulo na resposta é aceito onde o exemplo tem escalar (a API original também devolve nulo nesses campos).
import type { FormaRespostaFachada } from '@sgh/contratos';

/** As quebras de contrato (vazio: a resposta satisfaz a expectativa), cada uma com o caminho da chave. */
export function quebrasDeContrato(esperada: FormaRespostaFachada, valor: unknown, onde = '$'): string[] {
  if (typeof esperada === 'string') {
    if (esperada === 'null' || valor === null) return [];
    return typeof valor === esperada ? [] : [`${onde}: esperado ${esperada}, veio ${tipo(valor)}`];
  }
  if (Array.isArray(esperada)) {
    if (!Array.isArray(valor)) return [`${onde}: esperada lista, veio ${tipo(valor)}`];
    const item = esperada[0];
    if (item === undefined) return [];
    return valor.flatMap((v, i) => quebrasDeContrato(item, v, `${onde}[${i}]`));
  }
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor))
    return [`${onde}: esperado objeto, veio ${tipo(valor)}`];
  const v = valor as Record<string, unknown>;
  return Object.entries(esperada as Record<string, FormaRespostaFachada>).flatMap(([k, f]) =>
    k in v ? quebrasDeContrato(f, v[k], `${onde}.${k}`) : [`${onde}.${k}: ausente`],
  );
}

/** Recorta a forma às chaves pedidas (a confirmação: o exemplo da especificação é de outra ação). */
export function recortarForma(f: FormaRespostaFachada, chaves: readonly string[]): FormaRespostaFachada {
  if (typeof f === 'string' || Array.isArray(f)) return f;
  const o = f as Record<string, FormaRespostaFachada>;
  return Object.fromEntries(chaves.filter((k) => k in o).map((k) => [k, o[k]!]));
}

const tipo = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'lista' : typeof v);
