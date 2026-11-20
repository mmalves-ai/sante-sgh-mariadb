<script setup lang="ts">
// Erro das telas da rouparia: a recusa de negócio conhecida (código do Problem Details) com o texto da aplicação
// (MENSAGENS_ROUPARIA dos contratos); a lista de avisos da conferência feita na tela; o resto, a mensagem geral.
import { MENSAGENS_ROUPARIA } from '@sgh/contratos';
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../api-rouparia.js';

const props = defineProps<{ erro?: unknown; mensagens?: readonly string[] }>();
const texto = computed(() => {
  const c = props.erro ? codigoDaRecusa(props.erro) : null;
  return c && c in MENSAGENS_ROUPARIA ? MENSAGENS_ROUPARIA[c as keyof typeof MENSAGENS_ROUPARIA] : null;
});
</script>

<template>
  <div v-if="mensagens && mensagens.length" role="alert" data-testid="recusa-rouparia">
    <SanteAlerta variante="alerta" :texto="mensagens[0]!" />
    <ul v-if="mensagens.length > 1" class="lista-simples">
      <li v-for="m in mensagens.slice(1)" :key="m">{{ m }}</li>
    </ul>
  </div>
  <div v-else-if="texto" role="alert" data-testid="recusa-rouparia">
    <SanteAlerta variante="alerta" :texto="texto" />
  </div>
  <MensagemErro v-else-if="erro" :erro="erro" />
</template>
