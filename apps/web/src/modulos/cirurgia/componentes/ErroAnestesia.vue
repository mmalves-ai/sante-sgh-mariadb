<script setup lang="ts">
// Erro das telas da anestesia (M46): a recusa conhecida (código do Problem Details) com o texto da aplicação; o resto, a
// mensagem geral com o código de correlação (nunca o texto do servidor). A recusa da trava da incisão (M46.2) usa os textos
// do checklist.
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../api-anestesia.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const chave = computed(() => {
  const c = codigoDaRecusa(props.erro);
  if (!c) return null;
  if (te(`anestesia.recusas.${c}`)) return `anestesia.recusas.${c}`;
  // M46 (etapa 2): a trava da incisão no marco "início da cirurgia" da ficha fala a língua do checklist.
  return te(`blocoSeguro.recusas.${c}`) ? `blocoSeguro.recusas.${c}` : null;
});
</script>

<template>
  <div v-if="chave" role="alert" data-testid="recusa-anestesia">
    <SanteAlerta variante="alerta" :texto="t(chave)" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
