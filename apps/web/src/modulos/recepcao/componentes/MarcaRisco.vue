<script setup lang="ts">
// A cor de risco com o nome escrito (a cor nunca é a única informação: acessibilidade e painel de TV).
import './estilo-classificacao.css';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ cor: string | null; nome?: string | null }>();
const { t } = useI18n();
const rotulo = computed(() =>
  props.cor
    ? `${t(`classificacao.cores.${props.cor}`)}${props.nome ? ` — ${props.nome}` : ''}`
    : t('classificacao.quadro.semClassificacao'),
);
</script>

<template>
  <span class="risco-marca" :class="cor ? `risco-${cor}` : 'risco-sem'" :data-cor="cor ?? 'sem'">{{
    rotulo
  }}</span>
</template>
