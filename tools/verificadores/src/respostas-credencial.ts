// Regra 8 sobre as RESPOSTAS da API (M12): os corpos JSON que o E2E @M12 e os testes HTTP registram
// (convênios, faturamento e preços) passam por esta conferência. A lista de colunas é a de @sgh/contratos
// (COLUNAS_CREDENCIAL), que o teste mantém igual à da guarda do SQL (colunas-proibidas.ts). Arquivo à parte:
// a guarda do SQL roda no `guardas:legado` sem o carregador de caminhos do monorepo.
import { type AchadoCredencial, COLUNAS_CREDENCIAL, credenciaisNaResposta } from '@sgh/contratos';

export function credenciaisNasRespostas(
  respostas: readonly { readonly url: string; readonly corpo: unknown }[],
): (AchadoCredencial & { readonly url: string })[] {
  return respostas.flatMap((r) => credenciaisNaResposta(r.corpo).map((a) => ({ ...a, url: r.url })));
}

export { COLUNAS_CREDENCIAL };
