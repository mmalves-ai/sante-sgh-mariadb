// Vigilância diária das gravações da onda 1 (ficha do M39, entregável 2; extensão do M38). As linhas que a onda 1
// grava continuam vivas depois da gravação: a marcação é confirmada, a senha é chamada e atendida, o cadastro é
// alterado nos dois sistemas. Comparar a manhã seguinte com a referência inteira daria divergência em toda linha que
// andou. Por isso a vigilância da onda 1 confere só a ESTRUTURA QUE NÃO MUDA depois da gravação (D-VIGIA-39): a linha
// principal existe; as colunas que toda referência de sucesso preenche pelo banco (generator, carimbo do banco) ou
// por cópia de outra coluna seguem preenchidas; e a cópia da chave da principal confere. Nenhum valor sai do banco
// (o leitor do M38 calcula "preenchida" e "confere" no banco). Regras puras, sem banco nem disco.
import { type Assinatura, type Diferenca, partesClasse } from '@sgh/contratos';
import { type ComparacaoColuna, type EstruturaGravacao } from '../onda0/vigia.js';

/** Classes cujo preenchimento não muda depois da gravação (o banco preencheu ou copiou). */
const CLASSES_IMUTAVEIS = new Set(['generator', 'carimbo-banco', 'copia']);

/** O cenário sintético da referência imutável (o nome que a vigilância usa para todas as gravações da operação). */
export const CENARIO_IMUTAVEL = 'estrutura-imutavel';

/**
 * A referência imutável de uma operação a partir das referências de sucesso (as que gravam a tabela principal): a
 * principal com 1 linha e, como colunas, só as de classe imutável em TODAS as referências (com a classe da primeira).
 * Sem referência de sucesso, null (a operação aparece como "sem localizador").
 */
export function referenciaImutavel(
  refs: readonly Assinatura[],
  principal: { readonly tabela: string; readonly chave: string },
): Assinatura | null {
  const comPrincipal = refs.filter((r) =>
    r.tabelas.some((t) => t.tabela === principal.tabela && t.acao === 'INSERT' && t.linhas > 0),
  );
  const [primeira] = comPrincipal;
  if (!primeira) return null;
  const tabelaDe = (r: Assinatura) =>
    r.tabelas.find((t) => t.tabela === principal.tabela && t.acao === 'INSERT');
  const base = tabelaDe(primeira)!;
  const colunas: Record<string, (typeof base.colunas)[string]> = {};
  for (const [col, c] of Object.entries(base.colunas)) {
    const tipo = partesClasse(c.classe).tipo;
    if (!CLASSES_IMUTAVEIS.has(tipo)) continue;
    const emTodas = comPrincipal.every((r) => {
      const x = tabelaDe(r)?.colunas[col];
      return x !== undefined && CLASSES_IMUTAVEIS.has(partesClasse(x.classe).tipo);
    });
    if (emTodas) colunas[col] = c;
  }
  return {
    ...primeira,
    cenario: CENARIO_IMUTAVEL,
    diferencas_aceitas: [],
    tabelas: [{ ...base, linhas: 1, colunas }],
    ligacoes: [],
    efeitosTrigger: [],
    generators: {},
  };
}

/**
 * Diferenças de UMA gravação contra a referência imutável (o mesmo vocabulário de elemento do comparador do M03):
 * uma coluna imutável vazia; a cópia da chave da principal com outro valor. Colunas fora da referência (as que os
 * dois sistemas mudam depois) não contam. A linha principal que não existe mais NÃO é divergência: a marcação
 * cancelada, o encaixe desfeito e o cadastro unificado depois, nos dois sistemas, removem a linha legitimamente (a
 * gravação errada que a vigilância procura é a da linha que ficou).
 */
export function diferencasImutaveis(ref: Assinatura, g: EstruturaGravacao): Diferenca[] {
  const r: Diferenca[] = [];
  for (const t of ref.tabelas) {
    const k = `${t.tabela}:${t.acao}`;
    const o = g.tabelas.find((x) => x.tabela === t.tabela);
    if (!o || o.linhas.length === 0) continue;
    for (const [col, c] of Object.entries(t.colunas)) {
      const el = `${k}.colunas.${col}`;
      if (o.linhas.some((l) => !(l[col]?.preenchida ?? false)))
        r.push({ tipo: 'colunas', elemento: el, esperado: c.classe, obtido: 'vazia', aceita: false });
      else if (o.linhas.some((l) => l[col]?.confere === false))
        r.push({ tipo: 'classe', elemento: el, esperado: c.classe, obtido: 'outro-valor', aceita: false });
    }
  }
  return r;
}

/**
 * As comparações pedidas ao banco para a referência imutável: só a cópia da chave da principal confere valor (o vínculo
 * com a linha); a cópia da própria chave dentro da mesma tabela (a unificação de cadastro muda) e as demais colunas
 * conferem só o preenchimento.
 */
export function comparacoesImutaveis(
  ref: Assinatura,
  tabela: string,
  principal: { readonly tabela: string; readonly chave: string },
): Readonly<Record<string, ComparacaoColuna>> {
  const t = ref.tabelas.find((x) => x.tabela === tabela);
  const r: Record<string, ComparacaoColuna> = {};
  for (const [col, c] of Object.entries(t?.colunas ?? {})) {
    const { tipo, arg } = partesClasse(c.classe);
    const [ot, oc] = (arg ?? '').split('.');
    r[col] =
      tipo === 'copia' && ot === principal.tabela && oc === principal.chave && tabela !== principal.tabela
        ? { tipo: 'copia', tabela: ot, coluna: oc }
        : { tipo: 'nenhuma' };
  }
  return r;
}

/** As peças da vigilância da onda 1 para o leitor do banco (o worker e `pnpm assinatura:vigiar`). */
export const VIGIA_IMUTAVEL = {
  cenario: CENARIO_IMUTAVEL,
  referencia: referenciaImutavel,
  comparar: diferencasImutaveis,
  comparacoes: comparacoesImutaveis,
} as const;
