// Visão de lista por usuário (01-ADM L84): as colunas que a pessoa escolheu para uma lista, guardadas na conta e
// valendo em qualquer computador. A lista diz o endereço dela (o mesmo do menu); as colunas oferecidas vêm do
// contrato (`colunasVisaoDaRota`), o mesmo que a API usa para recusar coluna fora da lista. Abrir a lista lê a visão
// padrão da conta; mexer nas colunas, na ordenação (clique no cabeçalho) ou nos itens por página muda só a tela;
// "guardar" grava na conta a mesma visão que abriu (mesmo nome, marcada como padrão, filtros guardados preservados),
// e a próxima abertura já vem assim.
import { colunasVisaoDaRota } from '@sgh/contratos';
import {
  alternarColuna,
  alternarOrdenacao,
  codigoTelaDoMenu,
  colunasDaVisao,
  itensPorPaginaValido,
  moverColuna,
  type OrdenacaoColuna,
  ordenacaoDasVisiveis,
  visaoDeFabrica,
} from '@sgh/dominio-acesso/autorizacao';
import { computed, ref } from 'vue';
import { gravarVisaoDaTela, lerPreferenciasDaConta } from './preferencias-servidor.js';

export type SituacaoVisao = 'fabrica' | 'guardada' | 'mudada';

/** O que a pessoa escolhe na lista e que vai para a conta. */
export interface EstadoVisao {
  readonly colunas: readonly string[];
  readonly ordenacao: readonly OrdenacaoColuna[];
  readonly itensPorPagina: number | null;
}

const chaveDoEstado = (e: EstadoVisao) =>
  JSON.stringify([e.colunas, e.ordenacao.map((o) => [o.coluna, o.direcao]), e.itensPorPagina]);

/**
 * O código da tela na conta: o que o menu da pessoa traz para aquele endereço (a tela já registrada no banco pode ter
 * outro código); sem ele, o código estável do endereço (o servidor registra a tela do menu no primeiro uso).
 */
export function codigoDaLista(
  rota: string,
  telasDoMenu: readonly { codigo: string; rota: string }[],
): string {
  return telasDoMenu.find((t) => t.rota === rota)?.codigo ?? codigoTelaDoMenu(rota);
}

export function usarVisaoLista(rota: string, buscar: typeof fetch = fetch) {
  const oferecidas = colunasVisaoDaRota(rota) ?? [];
  const visiveis = ref<string[]>([...oferecidas]);
  const ordenacao = ref<OrdenacaoColuna[]>([]);
  const itensPorPagina = ref<number | null>(null);
  /** O estado guardado na conta (o que a próxima abertura mostra), ou nulo sem visão guardada. */
  const guardada = ref<EstadoVisao | null>(null);
  /** Nome e filtros da visão que abriu: guardar regrava a mesma visão, sem perder os filtros que ela tinha. */
  let nomeAberto: string | null = null;
  let filtrosAbertos: Record<string, unknown> | null = null;
  const codigo = ref(codigoTelaDoMenu(rota));
  const gravando = ref(false);
  const erro = ref('');

  const atual = (): EstadoVisao => ({
    colunas: [...visiveis.value],
    ordenacao: ordenacao.value.map((o) => ({ ...o })),
    itensPorPagina: itensPorPagina.value,
  });

  const situacao = computed<SituacaoVisao>(() => {
    const agora = chaveDoEstado(atual());
    if (guardada.value && chaveDoEstado(guardada.value) === agora) return 'guardada';
    const deFabrica =
      visaoDeFabrica(oferecidas, visiveis.value) &&
      ordenacao.value.length === 0 &&
      itensPorPagina.value === null;
    return deFabrica && !guardada.value ? 'fabrica' : 'mudada';
  });

  function aplicar(e: EstadoVisao): void {
    visiveis.value = [...e.colunas];
    ordenacao.value = ordenacaoDasVisiveis(e.colunas, e.ordenacao);
    itensPorPagina.value = itensPorPaginaValido(e.itensPorPagina);
  }

  /** Lê a visão padrão da conta; sem conta, sem visão ou com falha de leitura, a lista fica nas colunas de fábrica. */
  async function carregar(): Promise<void> {
    if (oferecidas.length === 0) return;
    try {
      const p = await lerPreferenciasDaConta(undefined, buscar);
      codigo.value = codigoDaLista(rota, p.telasDoMenu);
      const nome = p.visaoInicialPorTela[codigo.value];
      const v = p.visoes.find((x) => x.tela === codigo.value && x.nome === nome) ?? null;
      if (!v) return;
      nomeAberto = v.nome;
      filtrosAbertos = v.filtros ?? null;
      const colunas = colunasDaVisao(oferecidas, v.colunas);
      aplicar({ colunas, ordenacao: v.ordenacao ?? [], itensPorPagina: v.itensPorPagina ?? null });
      guardada.value = atual();
    } catch {
      // A lista abre do mesmo jeito, nas colunas de fábrica.
    }
  }

  function alternar(coluna: string): void {
    visiveis.value = alternarColuna(oferecidas, visiveis.value, coluna);
    ordenacao.value = ordenacaoDasVisiveis(visiveis.value, ordenacao.value);
  }

  function mover(coluna: string, passo: -1 | 1): void {
    visiveis.value = moverColuna(visiveis.value, coluna, passo);
  }

  /** Clique no cabeçalho: crescente, decrescente, sem ordenação (só coluna visível). */
  function ordenarPor(coluna: string): void {
    ordenacao.value = alternarOrdenacao(visiveis.value, ordenacao.value, coluna);
  }

  function definirItensPorPagina(n: number | null): void {
    itensPorPagina.value = itensPorPaginaValido(n);
  }

  async function guardar(e: EstadoVisao = atual()): Promise<boolean> {
    if (oferecidas.length === 0 || gravando.value) return false;
    gravando.value = true;
    erro.value = '';
    const colunas = [...e.colunas];
    const ord = ordenacaoDasVisiveis(colunas, e.ordenacao);
    const itens = itensPorPaginaValido(e.itensPorPagina);
    try {
      // A mesma visão que abriu (pelo nome) e marcada como padrão: é ela que a próxima abertura lê.
      await gravarVisaoDaTela(
        codigo.value,
        {
          ...(nomeAberto ? { nome: nomeAberto } : {}),
          colunas,
          ordenacao: ord,
          itensPorPagina: itens,
          ...(filtrosAbertos ? { filtros: filtrosAbertos } : {}),
          padrao: true,
        },
        buscar,
      );
      aplicar({ colunas, ordenacao: ord, itensPorPagina: itens });
      guardada.value = atual();
      return true;
    } catch (x) {
      erro.value = x instanceof Error ? x.message : String(x);
      return false;
    } finally {
      gravando.value = false;
    }
  }

  /** Volta às colunas de fábrica, sem ordenação própria nem itens por página, e guarda assim. */
  const voltarAFabrica = () => guardar({ colunas: [...oferecidas], ordenacao: [], itensPorPagina: null });

  return {
    oferecidas,
    visiveis,
    ordenacao,
    itensPorPagina,
    codigo,
    situacao,
    gravando,
    erro,
    carregar,
    alternar,
    mover,
    ordenarPor,
    definirItensPorPagina,
    guardar: () => guardar(),
    voltarAFabrica,
  };
}
