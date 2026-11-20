// A lista de documentos do estoque por tipo, local e período, 200 por página (ficha do M28, seção 4): os filtros e a
// página ficam na tela; a API devolve a fatia e diz se há a seguinte.
import type { TipoDocumentoEstoque } from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { listarDocumentos } from '../api-suprimentos.js';

export interface FiltroLista {
  local: string;
  inicio: string;
  fim: string;
}

export function usarListaDocumentos(tipo: TipoDocumentoEstoque) {
  const filtro = ref<FiltroLista>({ local: '', inicio: '', fim: '' });
  const pagina = ref(1);
  watch(filtro, () => (pagina.value = 1), { deep: true });
  const lista = useQuery({
    queryKey: computed(() => ['suprimentos', 'documentos', tipo, { ...filtro.value }, pagina.value]),
    queryFn: () =>
      listarDocumentos(tipo, {
        ...(filtro.value.local ? { local: Number(filtro.value.local) } : {}),
        ...(filtro.value.inicio ? { inicio: filtro.value.inicio } : {}),
        ...(filtro.value.fim ? { fim: filtro.value.fim } : {}),
        pagina: pagina.value,
      }),
  });
  const haSeguinte = computed(() => lista.data.value?.cortada ?? false);
  return { filtro, pagina, lista, haSeguinte };
}
