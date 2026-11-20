// Regra 9 e DP-4 do M08: chave de liberação por estabelecimento ('*'), setor, grupo ou pessoa; vale sem
// nova implantação; a liberação em LOTE aplica a mesma chave a uma lista numa ação só e é reversível (cada
// linha guarda o estado de antes do lote). Recolher é desligar a chave do estabelecimento. A regra de
// quem a chave libera é a mesma do executor (packages/legado, nucleo/sgh/tecnicas.ts, liberacaoPermite):
// chave do estabelecimento desligada recusa sempre; fora isso, a mais específica vence (pessoa, grupo,
// setor, estabelecimento). Linha com `ligada` nula HERDA (não decide neste nível): é o que a reversão grava numa
// linha que o lote criou, porque o papel da aplicação não exclui (script 0016).
import type { EscopoLiberacao } from '@sgh/contratos';

export interface ChaveAtual {
  readonly escopo: EscopoLiberacao;
  readonly valor: string;
  /** null: herda (a linha existe, mas não decide neste nível). */
  readonly ligada: boolean | null;
}

export interface MudancaLote {
  readonly escopo: EscopoLiberacao;
  readonly valor: string;
  /** null: herda (só na reversão de linha que o lote criou). */
  readonly ligada: boolean | null;
  /** Estado antes do lote (null: a linha não existia ou herdava). */
  readonly antes: boolean | null;
}

export class ErroLote extends Error {
  override readonly name = 'ErroLote';
}

/** Mudanças do lote: uma por valor da lista (sem repetição), só onde o estado muda. */
export function planejarLote(
  atuais: readonly ChaveAtual[],
  escopo: EscopoLiberacao,
  valores: readonly string[],
  ligar: boolean,
): MudancaLote[] {
  const unicos = [...new Set(valores.map((v) => v.trim()).filter(Boolean))];
  if (unicos.length === 0) throw new ErroLote('Informe ao menos um valor.');
  if (escopo === 'hospital' && (unicos.length !== 1 || unicos[0] !== '*'))
    throw new ErroLote("No estabelecimento inteiro, o valor é '*'.");
  if (escopo !== 'hospital' && unicos.includes('*'))
    throw new ErroLote("'*' só vale para o estabelecimento.");
  const r: MudancaLote[] = [];
  for (const valor of unicos) {
    const a = atuais.find((c) => c.escopo === escopo && c.valor === valor);
    if (a && a.ligada === ligar) continue;
    r.push({ escopo, valor, ligada: ligar, antes: a ? a.ligada : null });
  }
  return r;
}

/**
 * Reversão de um lote: cada linha volta ao estado de antes. Linha que o lote criou (antes nulo) volta a
 * HERDAR (`ligada` nula), não desligada: desligada, a chave mais específica bloquearia quem a chave mais ampla
 * libera, o que não era assim antes do lote.
 */
export function reverterLote(mudancas: readonly MudancaLote[]): MudancaLote[] {
  return mudancas.map((m) => ({
    escopo: m.escopo,
    valor: m.valor,
    ligada: m.antes,
    antes: m.ligada,
  }));
}

/** A reversão volta a LIGAR alguma linha? (ligar exige o pré-requisito e, em produção, a autorização) */
export function reversaoLiga(mudancas: readonly MudancaLote[]): boolean {
  return reverterLote(mudancas).some((m) => m.ligada === true);
}

/** Quem a chave libera (a mesma regra do executor). */
export function chaveLibera(
  chaves: readonly ChaveAtual[],
  pessoa: string,
  grupo: string | undefined,
  setor: string | undefined,
): boolean {
  const da = (escopo: EscopoLiberacao, valor: string | undefined) =>
    valor === undefined
      ? undefined
      : chaves.find((c) => c.escopo === escopo && c.valor === valor && c.ligada !== null);
  const doEstabelecimento = da('hospital', '*');
  if (doEstabelecimento && !doEstabelecimento.ligada) return false;
  for (const c of [da('pessoa', pessoa), da('grupo', grupo), da('setor', setor), doEstabelecimento]) {
    if (c) return c.ligada === true;
  }
  return false;
}
