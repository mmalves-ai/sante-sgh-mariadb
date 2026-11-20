<script setup lang="ts">
// Selo de estado clínico (risco ou leito): sempre cor + ícone + texto (cor nunca é a única informação).
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import SanteIcone from '../icones/SanteIcone.vue';
import { entradaClinica } from '../tokens/clinica.js';

const props = defineProps<{ estado: string }>();
const { t } = useI18n();
const entrada = computed(() => entradaClinica(props.estado));
const estilo = computed(() => ({
  background: `var(--sgh-clinica-${entrada.value.id}-fundo)`,
  color: `var(--sgh-clinica-${entrada.value.id}-texto)`,
}));
</script>

<template>
  <span class="sgh-estado" :style="estilo" :data-estado="entrada.id">
    <SanteIcone :nome="entrada.icone" />
    <span>{{ t(entrada.rotulo) }}</span>
  </span>
</template>

<style scoped>
.sgh-estado {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  padding: 0 var(--sgh-espaco-2);
  border-radius: 999px;
  font-size: var(--sgh-fonte-pequena);
  font-weight: 600;
  line-height: 1.8;
  outline: 1px solid var(--sgh-borda);
}
</style>
