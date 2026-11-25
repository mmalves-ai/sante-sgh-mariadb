// Controles (barreiras) do risco institucional na matriz GUT: o hospital liga cada risco aos controles do seu
// catálogo, com tipo (preventivo, detectivo, corretivo, mitigatório) e eficácia avaliada. Regras puras: a lista sem
// controle repetido, o risco "mitigado" com ao menos um controle que funciona, a eficácia do conjunto (base da
// leitura do risco residual) e a chave estável do controle no catálogo.
import type {
  ControleRiscoEntrada,
  EficaciaControleRisco,
  EficaciaControlesRisco,
  SituacaoRisco,
} from '@sgh/contratos';

export type RecusaControlesRisco = 'controle-repetido' | 'controle-eficaz-obrigatorio';

/** O nome do controle comparável: sem acento, sem espaço sobrando, em maiúsculas. */
export function nomeControleNormalizado(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Confere a lista de controles do risco. Nulo/ausente: não confere (os vínculos gravados ficam). O risco "mitigado"
 * com controles estruturados exige ao menos um eficaz ou parcialmente eficaz: mitigação sem barreira que funcione
 * não se sustenta numa visita de acreditação.
 */
export function recusaControlesRisco(
  lista: readonly ControleRiscoEntrada[] | undefined,
  situacao: SituacaoRisco,
): RecusaControlesRisco | null {
  if (!lista) return null;
  const nomes = lista.map((c) => nomeControleNormalizado(c.nome));
  if (new Set(nomes).size !== nomes.length) return 'controle-repetido';
  if (
    situacao === 'mitigado' &&
    lista.length > 0 &&
    !lista.some((c) => c.eficacia === 'eficaz' || c.eficacia === 'parcialmenteEficaz')
  )
    return 'controle-eficaz-obrigatorio';
  return null;
}

const PESO_EFICACIA: Readonly<Record<Exclude<EficaciaControleRisco, 'naoAvaliado'>, number>> = {
  eficaz: 1,
  parcialmenteEficaz: 0.5,
  ineficaz: 0,
};

/**
 * A eficácia do conjunto: média dos controles avaliados (eficaz 1; parcial 0,5; ineficaz 0). Média ≥ 0,75 é eficaz,
 * ≥ 0,4 parcialmente eficaz e abaixo disso ineficaz. Sem controle avaliado: "naoAvaliado"; sem controle: "semControle".
 */
export function eficaciaDosControles(
  lista: readonly { readonly eficacia: EficaciaControleRisco }[],
): EficaciaControlesRisco {
  if (lista.length === 0) return 'semControle';
  const pesos = lista
    .map((c) => (c.eficacia === 'naoAvaliado' ? null : PESO_EFICACIA[c.eficacia]))
    .filter((p): p is number => p !== null);
  if (pesos.length === 0) return 'naoAvaliado';
  const media = pesos.reduce((a, b) => a + b, 0) / pesos.length;
  if (media >= 0.75) return 'eficaz';
  if (media >= 0.4) return 'parcialmenteEficaz';
  return 'ineficaz';
}
