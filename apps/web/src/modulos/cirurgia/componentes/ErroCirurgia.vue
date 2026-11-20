<script setup lang="ts">
// Erro do centro cirúrgico: a recusa de negócio conhecida (código do Problem Details) com o texto da aplicação; o
// resto, a mensagem geral com o código de correlação (regra 15: nunca o texto do servidor).
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../api-cirurgia.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const chave = computed(() => {
  const c = codigoDaRecusa(props.erro);
  return c && te(`cirurgia.recusas.${c}`) ? `cirurgia.recusas.${c}` : null;
});
</script>

<template>
  <div v-if="chave" role="alert" data-testid="recusa-cirurgia">
    <SanteAlerta variante="alerta" :texto="t(chave)" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
