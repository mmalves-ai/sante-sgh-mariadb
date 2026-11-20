<script setup lang="ts">
// Erro das telas da telemedicina (M50, etapa 4): a recusa conhecida (o código do Problem Details) com o texto da
// aplicação; o resto, a mensagem geral com o código de correlação (nunca o texto do servidor).
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const chave = computed(() => {
  if (!(props.erro instanceof ErroApi)) return null;
  const c = (props.erro.problema as { codigo?: unknown } | null)?.codigo;
  return typeof c === 'string' && te(`telemedicina.recusas.${c}`) ? `telemedicina.recusas.${c}` : null;
});
</script>

<template>
  <div v-if="chave" role="alert" data-testid="recusa-telemedicina">
    <SanteAlerta variante="alerta" :texto="t(chave)" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
