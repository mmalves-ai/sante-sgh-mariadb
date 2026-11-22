<script setup lang="ts">
// ADR 0009, decisão 25, na marcação: confere se o profissional da agenda é credenciado no convênio escolhido, na data
// da vaga. Sem credenciamento, alerta (padrão) ou bloqueio (opção do convênio): a tela de marcar desabilita o botão
// com o bloqueio. A recusa definitiva é do servidor; sem a conferência (erro ou sem permissão), a tela só avisa.
import type { VerificacaoCredenciamento } from '@sgh/contratos';
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerAgendaEstruturada, verificarCredenciamento } from '../api-estruturada.js';

const props = defineProps<{ agendaId: number; convenio: number | null; data: string }>();
const emit = defineEmits<{ efeito: [efeito: VerificacaoCredenciamento['efeito'] | null] }>();
const { t } = useI18n();
const agenda = useQuery({
  queryKey: computed(() => ['agenda', 'estruturada', props.agendaId]),
  queryFn: () => lerAgendaEstruturada(props.agendaId),
});
const profissionalId = computed(() => agenda.data.value?.profissionalId ?? null);
const verificacao = useQuery({
  queryKey: computed(() => [
    'credenciamento',
    'verificacao',
    profissionalId.value,
    props.convenio,
    props.data,
  ]),
  queryFn: () =>
    verificarCredenciamento({
      profissionalId: Number(profissionalId.value),
      fontePagadoraId: Number(props.convenio),
      data: props.data,
    }),
  enabled: computed(() => profissionalId.value !== null && props.convenio !== null),
});
const efeito = computed(() =>
  props.convenio === null || profissionalId.value === null ? null : (verificacao.data.value?.efeito ?? null),
);
watch(efeito, (e) => emit('efeito', e), { immediate: true });
const indisponivel = computed(
  () => props.convenio !== null && (agenda.isError.value || verificacao.isError.value),
);
</script>

<template>
  <div v-if="efeito === 'bloqueio'" role="alert" data-testid="marcacao-credenciamento-bloqueio">
    <SanteAlerta variante="alerta" :texto="t('estruturada.lancamento.bloqueado')" />
  </div>
  <div v-else-if="efeito === 'alerta'" role="alert" data-testid="marcacao-credenciamento-alerta">
    <SanteAlerta variante="aviso" :texto="t('estruturada.marcacao.naoCredenciado')" />
  </div>
  <p v-else-if="indisponivel" class="secundario" data-testid="marcacao-credenciamento-indisponivel">
    {{ t('estruturada.marcacao.indisponivel') }}
  </p>
</template>
