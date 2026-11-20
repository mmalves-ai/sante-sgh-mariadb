<script setup lang="ts">
// Erro da tela da estrutura de custos (M54, etapa 4): o código da recusa (centro inativo, classificação desatualizada)
// vira o texto da tela; o resto segue o erro padrão.
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../exames/api-exames.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const texto = computed(() => {
  const c = codigoDaRecusa(props.erro);
  return c && te(`custos.recusa.${c}`) ? t(`custos.recusa.${c}`) : null;
});
</script>

<template>
  <SanteAlerta v-if="texto" :texto="texto" variante="aviso" anunciar data-testid="recusa-custos" />
  <MensagemErro v-else :erro="erro" />
</template>
