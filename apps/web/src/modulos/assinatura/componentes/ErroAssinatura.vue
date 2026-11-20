<script setup lang="ts">
// Erro das telas da assinatura: a recusa de negócio com o texto em português do servidor (abaixo do mínimo legal, CPF
// divergente, provedor sem segredo, cofre indisponível…); o resto, a mensagem geral com o código de correlação.
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { textoDaRecusa } from '../../faturamento/api-faturamento.js';

const props = defineProps<{ erro: unknown }>();
const texto = computed(() => textoDaRecusa(props.erro));
</script>

<template>
  <div v-if="texto" role="alert" data-testid="recusa-assinatura">
    <SanteAlerta variante="alerta" :texto="texto" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
