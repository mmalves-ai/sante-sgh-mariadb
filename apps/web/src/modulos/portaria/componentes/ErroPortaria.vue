<script setup lang="ts">
// Erro das telas da portaria (M50, etapa 5): a recusa de negócio do servidor (Problem Details com código, 4xx) com o
// texto em português que o servidor já redige (a mensagem do porteiro é genérica no bloqueio); o resto, a mensagem
// geral com o código de correlação.
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';

const props = defineProps<{ erro: unknown }>();
const recusa = computed(() => {
  const e = props.erro;
  if (!(e instanceof ErroApi) || e.status >= 500 || e.status === 401) return null;
  const p = e.problema as { codigo?: unknown; detail?: unknown } | null;
  return typeof p?.detail === 'string' && p.detail.trim() ? p.detail : null;
});
</script>

<template>
  <div v-if="recusa" role="alert" data-testid="pt-recusa">
    <SanteAlerta variante="alerta" :texto="recusa" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
