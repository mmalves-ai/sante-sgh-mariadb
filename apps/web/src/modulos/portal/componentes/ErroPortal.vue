<script setup lang="ts">
// Erro do portal do paciente e das telas internas da conta e dos vínculos (M50, etapa 1): a recusa conhecida (o código
// do Problem Details) com o texto da aplicação, sempre o mesmo para os casos que não podem revelar nada (convite, entrada,
// pedido de vínculo); o resto, a mensagem geral com o código de correlação (nunca o texto do servidor).
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const BASES = [
  'portal.recusas',
  'portal.copia.recusas',
  'portal.responsaveis.recusas',
  'portal.interno.conta.recusas',
  'portal.interno.vinculos.recusas',
];
const chave = computed(() => {
  if (!(props.erro instanceof ErroApi)) return null;
  const c = (props.erro.problema as { codigo?: unknown } | null)?.codigo;
  if (typeof c !== 'string') return null;
  return BASES.map((b) => `${b}.${c}`).find((k) => te(k)) ?? null;
});
</script>

<template>
  <div v-if="chave" role="alert" data-testid="recusa-portal">
    <SanteAlerta variante="alerta" :texto="t(chave)" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
