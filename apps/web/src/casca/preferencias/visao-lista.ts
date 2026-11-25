// Visão de lista por usuário (01-ADM L84): as colunas que a pessoa escolheu para uma lista, guardadas na conta e
// valendo em qualquer computador. A lista diz o endereço dela (o mesmo do menu); as colunas oferecidas vêm do
// contrato (`colunasVisaoDaRota`), o mesmo que a API usa para recusar coluna fora da lista. Abrir a lista lê a visão
// padrão da conta; mexer nas colunas muda só a tela; "guardar" grava na conta (a próxima abertura já vem assim).
import { colunasVisaoDaRota } from '@sgh/contratos';
import {
  alternarColuna,
  codigoTelaDoMenu,
  colunasDaVisao,
  moverColuna,
  visaoDeFabrica,
} from '@sgh/dominio-acesso/autorizacao';
import { computed, ref } from 'vue';
import { gravarVisaoDaTela, lerPreferenciasDaConta } from './preferencias-servidor.js';

export type SituacaoVisao = 'fabrica' | 'guardada' | 'mudada';

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
  const guardadas = ref<string[] | null>(null);
  const codigo = ref(codigoTelaDoMenu(rota));
  const gravando = ref(false);
  const erro = ref('');

  const situacao = computed<SituacaoVisao>(() => {
    const atual = visiveis.value.join('|');
    if (guardadas.value && guardadas.value.join('|') === atual) return 'guardada';
    return visaoDeFabrica(oferecidas, visiveis.value) && !guardadas.value ? 'fabrica' : 'mudada';
  });

  /** Lê a visão padrão da conta; sem conta, sem visão ou com falha de leitura, a lista fica nas colunas de fábrica. */
  async function carregar(): Promise<void> {
    if (oferecidas.length === 0) return;
    try {
      const p = await lerPreferenciasDaConta(undefined, buscar);
      codigo.value = codigoDaLista(rota, p.telasDoMenu);
      const nome = p.visaoInicialPorTela[codigo.value];
      const v = p.visoes.find((x) => x.tela === codigo.value && x.nome === nome) ?? null;
      if (!v) return;
      visiveis.value = colunasDaVisao(oferecidas, v.colunas);
      guardadas.value = [...visiveis.value];
    } catch {
      // A lista abre do mesmo jeito, nas colunas de fábrica.
    }
  }

  function alternar(coluna: string): void {
    visiveis.value = alternarColuna(oferecidas, visiveis.value, coluna);
  }

  function mover(coluna: string, passo: -1 | 1): void {
    visiveis.value = moverColuna(visiveis.value, coluna, passo);
  }

  async function guardar(colunas: readonly string[] = visiveis.value): Promise<boolean> {
    if (oferecidas.length === 0 || gravando.value) return false;
    gravando.value = true;
    erro.value = '';
    try {
      await gravarVisaoDaTela(
        codigo.value,
        { colunas: [...colunas], ordenacao: [], itensPorPagina: null },
        buscar,
      );
      visiveis.value = [...colunas];
      guardadas.value = [...colunas];
      return true;
    } catch (e) {
      erro.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      gravando.value = false;
    }
  }

  /** Volta às colunas de fábrica e guarda assim (a próxima abertura também vem de fábrica). */
  const voltarAFabrica = () => guardar(oferecidas);

  return {
    oferecidas,
    visiveis,
    codigo,
    situacao,
    gravando,
    erro,
    carregar,
    alternar,
    mover,
    guardar,
    voltarAFabrica,
  };
}
