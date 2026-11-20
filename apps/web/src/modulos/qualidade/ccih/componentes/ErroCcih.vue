<script setup lang="ts">
// Erro das telas da CCIH: a recusa de negócio conhecida (código do Problem Details) com o texto da aplicação (os mesmos
// da API, em @sgh/dominio-qualidade); o resto, a mensagem geral com o código de correlação (nunca o texto do servidor).
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../api-ccih.js';
import { RECUSAS_CCIH } from '../i18n-ccih.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const texto = computed(() => {
  const c = codigoDaRecusa(props.erro);
  if (!c) return null;
  if (c in RECUSAS_CCIH) return RECUSAS_CCIH[c as keyof typeof RECUSAS_CCIH];
  return te(`ccih.recusasApi.${c}`) ? t(`ccih.recusasApi.${c}`) : null;
});
</script>

<template>
  <div v-if="texto" role="alert" data-testid="recusa-ccih">
    <SanteAlerta variante="alerta" :texto="texto" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
