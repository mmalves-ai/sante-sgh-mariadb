<script setup lang="ts">
// Atalho para as anotações administrativas do caso (03-PEP L147) nas telas do paciente (serviço social) e do NIR:
// leva à visão do paciente com o contador do que aguarda a leitura de quem está na tela. Com a reserva de leito, a
// anotação nova já sai ligada a ela. Só aparece para quem lê as anotações.
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { lerAnotacoesPendentes } from '../api-anotacoes-administrativas.js';

const props = defineProps<{ paciente?: number | null; reserva?: number | null }>();
const { t } = useI18n();
const visivel = computed(
  () => pode('pep.prontuario.ler') || pode('pep.social.ler') || pode('internacao.solicitacaoLeito.ler'),
);
const fila = useQuery({
  queryKey: ['pep', 'anotacoes-administrativas', 'pendentes'],
  queryFn: () => lerAnotacoesPendentes(),
  enabled: computed(() => visivel.value && !!props.paciente),
  staleTime: 30_000,
});
const pendentes = computed(() => (fila.data.value ?? []).filter((p) => p.paciente === props.paciente).length);
const destino = computed(() =>
  props.paciente
    ? {
        path: `/pep/paciente/${props.paciente}/anotacoes-administrativas`,
        query: props.reserva ? { reserva: String(props.reserva) } : {},
      }
    : { path: '/pep/anotacoes-administrativas', query: { reserva: String(props.reserva ?? '') } },
);
const rotulo = computed(() =>
  !props.paciente && props.reserva
    ? t('pep.anotAdm.atalhoReserva', { reserva: props.reserva })
    : pendentes.value > 0
      ? t('pep.anotAdm.atalhoPendentes', { n: pendentes.value })
      : t('pep.anotAdm.atalho'),
);
</script>

<template>
  <RouterLink
    v-if="visivel && (paciente || reserva)"
    :to="destino"
    :data-testid="reserva && !paciente ? `atalho-anotacoes-adm-reserva-${reserva}` : 'atalho-anotacoes-adm'"
    >{{ rotulo }}</RouterLink
  >
</template>
