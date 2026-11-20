// A fila da higienização com o relógio do estabelecimento: a leitura do servidor (o prazo é na hora do
// estabelecimento) mais o tempo passado desde ela, para o "faltam / passou" seguir andando entre as releituras.
import { useQuery } from '@tanstack/vue-query';
import { computed, onBeforeUnmount, type Ref, ref } from 'vue';
import { CANAL_HIGIENIZACAO, lerFilaHigienizacao } from './api-adt.js';
import { usarAvisos } from './vigia.js';

export function usarFilaHigienizacao(profissional: Ref<number | null>) {
  const avisos = usarAvisos(CANAL_HIGIENIZACAO, () => void fila.refetch());
  const fila = useQuery({
    queryKey: computed(() => ['adt', 'hig', 'fila', profissional.value]),
    queryFn: () => lerFilaHigienizacao(profissional.value),
    refetchInterval: computed(() => avisos.intervalo()),
  });
  const agora = ref(Date.now());
  const relogio = setInterval(() => (agora.value = Date.now()), 30_000);
  onBeforeUnmount(() => clearInterval(relogio));
  const agoraEstabelecimento = computed(() => {
    const l = fila.data.value?.lidoEm;
    if (!l) return agora.value;
    return (
      Date.parse(l.length <= 19 ? `${l}Z` : l) + (agora.value - (fila.dataUpdatedAt.value || agora.value))
    );
  });
  return { fila, agoraEstabelecimento, conectado: avisos.conectado };
}
