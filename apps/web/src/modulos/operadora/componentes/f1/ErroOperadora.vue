<script setup lang="ts">
// Erro das telas da fatia F1 da operadora (M56.2): a recusa de negócio (409 e 422) mostra a frase do servidor, em
// português e sem nome de tabela; o resto vai para a mensagem padrão (com o código de correlação).
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../../casca/erros/problem-details.js';

const props = defineProps<{ erro: unknown }>();
const recusa = computed(() => {
  const e = props.erro;
  if (!(e instanceof ErroApi) || (e.status !== 409 && e.status !== 422 && e.status !== 404)) return null;
  const d = (e.problema as { detail?: unknown } | null)?.detail;
  return typeof d === 'string' && d ? d : null;
});
</script>

<template>
  <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="recusa-operadora" />
  <MensagemErro v-else :erro="erro" />
</template>
