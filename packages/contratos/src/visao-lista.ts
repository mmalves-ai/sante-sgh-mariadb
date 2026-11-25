// Listas que guardam visão por usuário (01-ADM L84): as colunas que cada tela oferece, pelo endereço da tela no
// menu. É a mesma lista para a tela (que desenha e deixa escolher) e para a API (que recusa coluna fora dela e
// recusa tela que não está aqui). Uma tela nova entra com uma linha; a ordem é a de fábrica.

/** Endereço da tela da trilha de auditoria. */
export const ROTA_TRILHA_AUDITORIA = '/administracao/auditoria/trilha';

export const COLUNAS_VISAO_POR_ROTA: Readonly<Record<string, readonly string[]>> = Object.freeze({
  [ROTA_TRILHA_AUDITORIA]: Object.freeze([
    'dataHora',
    'origem',
    'usuario',
    'acao',
    'opcao',
    'alvo',
    'paciente',
    'estacao',
    'ator',
  ]),
});

/** As colunas que a tela daquele endereço oferece; nulo: a tela não guarda visão de lista. */
export function colunasVisaoDaRota(rota: string | null | undefined): readonly string[] | null {
  if (!rota || !Object.hasOwn(COLUNAS_VISAO_POR_ROTA, rota)) return null;
  return COLUNAS_VISAO_POR_ROTA[rota] ?? null;
}
