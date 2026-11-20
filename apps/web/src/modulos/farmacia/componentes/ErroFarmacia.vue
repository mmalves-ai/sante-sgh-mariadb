<script setup lang="ts">
// Erro da farmácia: a recusa de negócio com o texto em português do servidor; o resto, a mensagem geral.
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { textoDaRecusa } from '../../suprimentos/api-suprimentos.js';

const props = defineProps<{ erro: unknown }>();
const texto = computed(() => textoDaRecusa(props.erro));
</script>

<template>
  <div v-if="texto" role="alert" data-testid="recusa-farmacia">
    <SanteAlerta variante="alerta" :texto="texto" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
