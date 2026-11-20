<script setup lang="ts">
// Erro do estoque: a recusa de negócio com o texto em português do servidor (saldo, lote, escopo, mês fechado…); o
// resto, a mensagem geral com o código de correlação.
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { textoDaRecusa } from '../api-suprimentos.js';

const props = defineProps<{ erro: unknown }>();
const texto = computed(() => textoDaRecusa(props.erro));
</script>

<template>
  <div v-if="texto" role="alert" data-testid="recusa-suprimentos">
    <SanteAlerta variante="alerta" :texto="texto" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
