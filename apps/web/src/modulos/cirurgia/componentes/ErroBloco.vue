<script setup lang="ts">
// Erro das telas da cirurgia segura e do rastreio (M46, etapa 2): a recusa conhecida (código do Problem Details) com o
// texto da aplicação; o resto, a mensagem geral com o código de correlação (nunca o texto do servidor).
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../api-anestesia.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const chave = computed(() => {
  const c = codigoDaRecusa(props.erro);
  return c && te(`blocoSeguro.recusas.${c}`) ? `blocoSeguro.recusas.${c}` : null;
});
</script>

<template>
  <div v-if="chave" role="alert" data-testid="recusa-bloco">
    <SanteAlerta variante="alerta" :texto="t(chave)" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
