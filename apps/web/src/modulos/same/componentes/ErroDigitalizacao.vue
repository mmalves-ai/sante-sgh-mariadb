<script setup lang="ts">
// Erro da digitalização certificada: a recusa de negócio conhecida (o código do Problem Details, ou o da prévia) com o texto da
// aplicação; o resto, a mensagem geral com o código de correlação (nunca o texto do servidor).
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../api-digitalizacao.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const chave = computed(() => {
  const daPrevia = (props.erro as { codigo?: unknown } | null)?.codigo;
  const c = codigoDaRecusa(props.erro) ?? (typeof daPrevia === 'string' ? daPrevia : null);
  return c && te(`digitalizacao.recusas.${c}`) ? `digitalizacao.recusas.${c}` : null;
});
</script>

<template>
  <div v-if="chave" role="alert" data-testid="recusa-digitalizacao">
    <SanteAlerta variante="alerta" :texto="t(chave)" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
