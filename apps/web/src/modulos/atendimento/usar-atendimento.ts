// Dados comuns das telas do atendimento: o estado da gravação (as três liberações e cada ação), o apoio da abertura
// (convênios, unidades, especialidades, profissionais, motivos, herança) e o rótulo dos códigos.
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { lerApoioAtendimento, lerGravacaoAtendimento } from './api-atendimento.js';

export function usarAtendimento() {
  const gravacao = useQuery({
    queryKey: ['atendimento', 'gravacao'],
    queryFn: () => lerGravacaoAtendimento(),
    staleTime: 30_000,
  });
  const apoio = useQuery({
    queryKey: ['atendimento', 'apoio'],
    queryFn: () => lerApoioAtendimento(),
    staleTime: 60_000,
  });
  /** A operação grava agora (permissão, liberação e passo 0 do executor)? `pa:` para a do pronto atendimento. */
  const pode = (op: string) => computed(() => gravacao.data.value?.operacoes[op]?.pode ?? false);
  const motivo = (op: string) => computed(() => gravacao.data.value?.operacoes[op]?.motivo ?? null);
  const motivoAmbulatorio = computed(() => {
    const g = gravacao.data.value;
    return g && !g.ambulatorio.ligada ? g.ambulatorio.motivo : null;
  });
  const motivoPa = computed(() => {
    const g = gravacao.data.value;
    return g && !g.pa.ligada ? g.pa.motivo : null;
  });
  const nomeConvenio = (cod: number) =>
    apoio.data.value?.convenios.find((c) => c.codigo === cod)?.nome ?? String(cod);
  return { gravacao, apoio, pode, motivo, motivoAmbulatorio, motivoPa, nomeConvenio };
}
