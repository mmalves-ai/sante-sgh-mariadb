<script setup lang="ts">
// Gases medicinais a partir da internação (C1-074, 04-INT linha 82): `/internacao/:reg/gases`. A lista dos internados
// conhece a internação; o uso do gás é do atendimento: a tela resolve o atendimento da internação e mostra a mesma
// visão por paciente (GasesTela), sem o usuário procurar o número do atendimento.
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerAtendimentoDaInternacao } from '../api-gases.js';
import ErroAdt from '../componentes/ErroAdt.vue';
import GasesTela from './GasesTela.vue';

const props = defineProps<{ reg: string }>();
const { t } = useI18n();
const reg = computed(() => Number(props.reg));
const atd = useQuery({
  queryKey: computed(() => ['adt', 'gases', 'internacao', reg.value]),
  queryFn: () => lerAtendimentoDaInternacao(reg.value),
});
</script>

<template>
  <GasesTela v-if="atd.data.value" :atd="atd.data.value.atendimento" />
  <section v-else class="tela-agenda" data-testid="tela-gases-internacao">
    <ErroAdt v-if="atd.isError.value" :erro="atd.error.value" />
    <p v-else role="status">{{ t('adt.gases.buscandoAtendimento') }}</p>
  </section>
</template>
