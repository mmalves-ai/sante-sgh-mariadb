<script setup lang="ts">
// Erro das telas da nutrição e do serviço social: a recusa de negócio conhecida (código do Problem Details) com o texto
// da aplicação; o resto, a mensagem geral com o código de correlação (nunca o texto do servidor).
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../api-nutricao.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const chave = computed(() => {
  const c = codigoDaRecusa(props.erro);
  return c && te(`nutricao.recusas.${c}`) ? `nutricao.recusas.${c}` : null;
});
</script>

<template>
  <div v-if="chave" role="alert" data-testid="recusa-nutricao">
    <SanteAlerta variante="alerta" :texto="t(chave)" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
