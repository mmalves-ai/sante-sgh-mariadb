<script setup lang="ts">
// Erro das telas da gestão da qualidade: a recusa de negócio conhecida (código do Problem Details) com o texto da
// aplicação (os mesmos da API, em @sgh/dominio-qualidade); o resto, a mensagem geral com o código de correlação (nunca
// o texto do servidor).
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { avisosDaRecusa } from '../../api-correcao.js';
import { RECUSAS_CORRECAO } from '../../i18n-correcao.js';
import { codigoDaRecusa } from '../api-gestao.js';
import { RECUSAS_GESTAO } from '../i18n-gestao.js';

const props = defineProps<{ erro: unknown }>();
const texto = computed(() => {
  const c = codigoDaRecusa(props.erro);
  if (!c) return null;
  if (c in RECUSAS_GESTAO) return RECUSAS_GESTAO[c as keyof typeof RECUSAS_GESTAO];
  // Revisão do W0-04: as recusas da correção (a comissão com dependentes, a origem cancelada) com quantos e quais.
  return RECUSAS_CORRECAO[c] ?? null;
});
const avisos = computed(() => avisosDaRecusa(props.erro));
</script>

<template>
  <div v-if="texto" role="alert" data-testid="recusa-gestao">
    <SanteAlerta variante="alerta" :texto="texto" />
    <ul v-if="avisos.length" data-testid="recusa-gestao-avisos">
      <li v-for="a in avisos" :key="a">{{ a }}</li>
    </ul>
  </div>
  <MensagemErro v-else :erro="erro" />
</template>
