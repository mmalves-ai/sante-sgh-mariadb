// Regra 2 do M37 (cap-15 §15.3.4; cap-10 §10.11): a parcela das operações do setor feitas no novo e no outro sistema,
// por operação do catálogo: as linhas do dia na tabela principal (no outro sistema) contra as da SGH_TRILHA (no novo).
// A conta é feita no banco, só com COUNT; aqui só a divisão e o texto com as parcelas ("novo 61 de 100 = 61%").
import type { Parcela } from '@sgh/contratos';

/**
 * `linhasDoDia` são TODAS as linhas da tabela principal no dia (as do novo também passam por ela) e `doNovo`, as que a
 * SGH_TRILHA atribui ao novo. O que sobra é do outro sistema. Se a trilha disser mais do que a tabela (a linha do novo
 * foi apagada depois pelo outro sistema), o total é o do novo e o outro fica em zero.
 */
export function calcularParcela(linhasDoDia: number, doNovo: number): Parcela {
  const novo = Math.max(0, Math.trunc(doNovo));
  const total = Math.max(novo, Math.max(0, Math.trunc(linhasDoDia)));
  const legado = total - novo;
  return { novo, legado, total, percentual: total === 0 ? null : Math.round((novo * 100) / total) };
}

/** A soma de várias parcelas (o setor inteiro no dia): soma das partes, percentual refeito. */
export function somarParcelas(ps: readonly Parcela[]): Parcela {
  const novo = ps.reduce((t, p) => t + p.novo, 0);
  const total = ps.reduce((t, p) => t + p.total, 0);
  return {
    novo,
    legado: total - novo,
    total,
    percentual: total === 0 ? null : Math.round((novo * 100) / total),
  };
}

/** O texto com as parcelas impressas. */
export function textoParcela(p: Parcela): string {
  if (p.total === 0) return 'sem operações no dia';
  return `novo ${p.novo} de ${p.total} = ${p.percentual}%`;
}
