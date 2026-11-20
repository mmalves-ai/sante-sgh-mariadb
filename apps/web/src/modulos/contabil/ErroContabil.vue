<script setup lang="ts">
// Erro de uma ação da contabilidade (etapa 2): a recusa de negócio conhecida (código do Problem Details) com o texto
// da aplicação, para quem lança, estorna, concilia ou encerra saber o motivo e o caminho; o resto, a mensagem geral
// com o código de correlação (regra 15: nunca o texto do servidor).
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../exames/api-exames.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const chave = computed(() => {
  const c = codigoDaRecusa(props.erro);
  return c && te(`contabil.recusas.${c}`) ? `contabil.recusas.${c}` : null;
});
</script>

<template>
  <div v-if="chave" role="alert" data-testid="recusa-contabil">
    <SanteAlerta variante="alerta" :texto="t(chave)" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
