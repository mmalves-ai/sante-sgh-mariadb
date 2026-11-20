// Regra 3 do M08 (cap-14 §14.4.2): código e descrição únicos ENTRE ATIVOS depois de normalizar (sem
// acento, maiúsculas, espaços colapsados). A conferência roda no servidor sobre a tabela inteira (os
// domínios têm de 3 a 18 linhas; teto da lista), antes da gravação; o banco tem a palavra final (PK).
import type { ValorCampo } from './tipos.js';

/** Sem acento, maiúsculas, espaços colapsados (o banco, em charset NONE, não ignora acento). */
export function normalizarDescricao(v: ValorCampo | undefined): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ItemComparavel {
  readonly codigo: string;
  readonly ativo: boolean;
  readonly valores: Readonly<Record<string, ValorCampo>>;
}

export interface Duplicidade {
  /** Campos do conjunto único que colidiram. */
  readonly campos: readonly string[];
  /** Código do item existente que já tem esses valores (a resposta 409 aponta para ele). */
  readonly existente: string;
}

/**
 * Primeira colisão do item novo (ou alterado: `ignorar` = o próprio código) com um item ATIVO, em algum
 * dos conjuntos únicos; null quando não há.
 */
export function procurarDuplicidade(
  itens: readonly ItemComparavel[],
  novo: Readonly<Record<string, ValorCampo>>,
  unicos: readonly (readonly string[])[],
  ignorar: string | null = null,
): Duplicidade | null {
  for (const conjunto of unicos) {
    if (conjunto.length === 0) continue;
    // Conjunto com campo vazio no item novo não colide (o legado aceita a descrição vazia como está).
    if (conjunto.some((c) => normalizarDescricao(novo[c]) === '')) continue;
    const chave = conjunto.map((c) => normalizarDescricao(novo[c])).join('\u0001');
    const achado = itens.find(
      (i) =>
        i.ativo &&
        i.codigo !== ignorar &&
        conjunto.map((c) => normalizarDescricao(i.valores[c])).join('\u0001') === chave,
    );
    if (achado) return { campos: conjunto, existente: achado.codigo };
  }
  return null;
}

/** Mensagem do 409 em português, apontando o item existente. */
export function mensagemDuplicidade(d: Duplicidade, rotulos: Readonly<Record<string, string>>): string {
  const nomes = d.campos.map((c) => (rotulos[c] ?? c).toLowerCase()).join(' e ');
  return `Já existe item ativo com ${nomes} iguais (código ${d.existente}). Confira o item existente antes de incluir outro.`;
}
