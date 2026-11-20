<script setup lang="ts">
// Erro da conta do paciente: a recusa de negócio com o texto em português do servidor (pendência, situação, escopo,
// grupo não liberado…); o resto, a mensagem geral com o código de correlação.
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { textoDaRecusa } from '../api-faturamento.js';

const props = defineProps<{ erro: unknown }>();
const texto = computed(() => textoDaRecusa(props.erro));
</script>

<template>
  <div v-if="texto" role="alert" data-testid="recusa-faturamento">
    <SanteAlerta variante="alerta" :texto="texto" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
