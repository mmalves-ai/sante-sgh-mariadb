<script setup lang="ts">
// Erro das telas da gestão de pessoas (M52.1): a recusa de negócio (404, 409 e 422) e a funcionalidade em consulta
// (403 com o motivo) mostram a frase do servidor, em português e sem nome de tabela; o resto vai para a mensagem
// padrão (com o código de correlação).
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';

const props = defineProps<{ erro: unknown }>();
const recusa = computed(() => {
  const e = props.erro;
  if (!(e instanceof ErroApi) || ![403, 404, 409, 422].includes(e.status)) return null;
  const d = (e.problema as { detail?: unknown } | null)?.detail;
  return typeof d === 'string' && d ? d : null;
});
</script>

<template>
  <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="recusa-pessoas" />
  <MensagemErro v-else :erro="erro" />
</template>
