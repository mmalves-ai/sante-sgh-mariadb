// Contexto e linha da trilha dos testes de unidade e HTTP do SESMT, das rubricas e da gestão de pessoas (F2.2, lote
// 03-10): o ContextoNucleo do estabelecimento sintético (o mesmo que a sessão monta em sessaoDe), com a rede e o código
// do estabelecimento que as portas em memória usam para separar os registros. Nada de dado real.
import type { ContextoNucleo } from '@sgh/nucleo';
import { contextoDoEstabelecimento } from '../../cadastro/contexto-nucleo.js';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';

export type ContextoTeste = ContextoNucleo & { readonly rede: string; readonly hospital: string };

/** O contexto da porta para o estabelecimento sintético `hospital` (como o da sessão). */
export function ctxTeste(hospital: string, rede = 'sante', usuario: number | null = null): ContextoTeste {
  return { ...contextoDoEstabelecimento(hospital), usuario, correlacao: 'teste-l0310', rede, hospital };
}

/** A linha da trilha de uma gravação direta do teste, com a tabela e o registro alvo. */
export function trilhaTeste(entidade: string, entidadeId: number | null = null): TrilhaDaGravacao {
  return {
    estabelecimento: null,
    usuario: null,
    acao: 'operacao',
    entidade,
    entidadeId,
    dadosDepois: { evento: 'teste' },
    correlacao: 'teste-l0310',
  };
}
