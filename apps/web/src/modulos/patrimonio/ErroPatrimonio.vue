<script setup lang="ts">
// Erro de uma ação do patrimônio (M54, etapa 6): a recusa de negócio conhecida (código do Problem Details) com o texto
// da aplicação, para quem cadastra, movimenta, calcula ou conta saber o motivo e o caminho; o resto, a mensagem geral
// com o código de correlação (regra 15: nunca o texto do servidor).
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../exames/api-exames.js';

/** `escopo`: um grupo de recusas próprio (ex.: `ajustes`), consultado antes das recusas gerais. */
const props = defineProps<{ erro: unknown; escopo?: string }>();
const { t, te } = useI18n();
const chave = computed(() => {
  const c = codigoDaRecusa(props.erro);
  if (c && props.escopo && te(`patrimonio.${props.escopo}.recusas.${c}`))
    return `patrimonio.${props.escopo}.recusas.${c}`;
  return c && te(`patrimonio.recusas.${c}`) ? `patrimonio.recusas.${c}` : null;
});
</script>

<template>
  <div v-if="chave" role="alert" data-testid="recusa-patrimonio">
    <SanteAlerta variante="alerta" :texto="t(chave)" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
