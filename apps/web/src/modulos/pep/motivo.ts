// Motivo de acesso da sessão para o paciente (M15, regra 11): a tela pergunta ao servidor; sem motivo, abre o
// diálogo antes de ler qualquer registro (o servidor recusa com 422 de qualquer forma).
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, type Ref } from 'vue';
import { lerMotivo } from './api-pep.js';

export function useMotivo(paciente: Ref<number>) {
  const cliente = useQueryClient();
  const consulta = useQuery({
    queryKey: computed(() => ['pep', 'motivo', paciente.value]),
    queryFn: () => lerMotivo(paciente.value),
    enabled: computed(() => paciente.value > 0),
    staleTime: 60_000,
  });
  const pronto = computed(() => Boolean(consulta.data.value?.motivo));
  const pedir = ref(false);
  const restricao = computed(() => consulta.data.value?.restricaoAtendimento === true);
  function aoCarregar(): void {
    if (consulta.data.value && !consulta.data.value.motivo) pedir.value = true;
  }
  async function informado(): Promise<void> {
    await cliente.invalidateQueries({ queryKey: ['pep', 'motivo', paciente.value] });
  }
  return { consulta, pronto, pedir, restricao, aoCarregar, informado };
}
