<script setup lang="ts">
// Erro das telas da notificação compulsória: a recusa de negócio conhecida (código do Problem Details) com o texto da
// aplicação (os mesmos da API, em @sgh/dominio-qualidade); o resto, a mensagem geral com o código de correlação (nunca
// o texto do servidor).
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../api-agravo.js';
import { RECUSAS_AGRAVO } from '../i18n-agravo.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const texto = computed(() => {
  const c = codigoDaRecusa(props.erro);
  if (!c) return null;
  if (c in RECUSAS_AGRAVO) return RECUSAS_AGRAVO[c as keyof typeof RECUSAS_AGRAVO];
  return te(`agravos.recusasApi.${c}`) ? t(`agravos.recusasApi.${c}`) : null;
});
</script>

<template>
  <div v-if="texto" role="alert" data-testid="recusa-agravo">
    <SanteAlerta variante="alerta" :texto="texto" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
