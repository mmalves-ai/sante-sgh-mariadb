<script setup lang="ts">
// Erro do diagnóstico: a recusa de negócio conhecida (código do Problem Details) com o texto da aplicação; o resto, a
// mensagem geral com o código de correlação (nunca o texto do servidor). A função que precisa do banco do cliente
// recusa com o código próprio "sem-banco-cliente" (sadt/sem-banco-cliente.ts no servidor), que vira o aviso próprio
// como as outras recusas; o 503 de outra causa (gerador de PDF fora do ar, 503 cru) segue na mensagem geral.
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../api-sadt.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const chave = computed(() => {
  const c = codigoDaRecusa(props.erro);
  return c && te(`sadt.recusas.${c}`) ? `sadt.recusas.${c}` : null;
});
</script>

<template>
  <div v-if="chave" role="alert" data-testid="recusa-sadt">
    <SanteAlerta variante="alerta" :texto="t(chave)" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
