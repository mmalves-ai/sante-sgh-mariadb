<script setup lang="ts">
// Valor de um campo do formulário (texto, texto formatado ou lista de itens marcados).
import type { ValorCampoRegistro } from '@sgh/contratos';
import { useI18n } from 'vue-i18n';
import TextoFormatado from './TextoFormatado.vue';

defineProps<{ valor: ValorCampoRegistro }>();
const { t } = useI18n();
</script>

<template>
  <span v-if="valor.tipo === 'vazio'" class="vazio">{{ t('pep.campo.vazio') }}</span>
  <span v-else-if="valor.tipo === 'texto'" class="texto">{{ valor.texto }}</span>
  <TextoFormatado v-else-if="valor.tipo === 'formatado'" :texto="valor.texto" />
  <ul v-else class="lista">
    <li v-for="(x, i) in valor.itens" :key="i">{{ x }}</li>
  </ul>
</template>

<style scoped>
.vazio {
  color: var(--sgh-texto-secundario);
}
.texto {
  white-space: pre-wrap;
}
.lista {
  margin: 0;
  padding-left: var(--sgh-espaco-3);
}
</style>
