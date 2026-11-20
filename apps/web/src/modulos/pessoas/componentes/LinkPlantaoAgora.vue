<script setup lang="ts">
// Atalho para "Quem está de plantão agora" (M52.3; ficha do M52, seção 7: a consulta é usada pelo prontuário, pelo NIR
// e pelo pronto atendimento). Aparece só para quem tem `pessoas.plantao.ler` (o servidor confere de novo).
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { pode } from '../../../casca/sessao/pode.js';

const { t } = useI18n();
</script>

<template>
  <p v-if="pode('pessoas.plantao.ler')">
    <RouterLink to="/pessoas/plantao-agora" data-testid="atalho-plantao-agora">{{
      t('pessoas.agora.titulo')
    }}</RouterLink>
  </p>
</template>
