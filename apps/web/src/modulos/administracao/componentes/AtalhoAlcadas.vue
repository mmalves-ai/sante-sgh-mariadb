<script setup lang="ts">
// Atalho para a tela das alçadas de aprovação (01-ADM L59), na lista de usuários.
import { useI18n } from 'vue-i18n';

const { t } = useI18n({ useScope: 'local', messages: { 'pt-BR': { rotulo: 'Alçadas de aprovação' } } });
</script>

<template>
  <router-link :to="{ name: 'adm.alcadas' }" class="atalho" data-testid="atalho-alcadas">{{
    t('rotulo')
  }}</router-link>
</template>

<style scoped>
.atalho {
  justify-self: start;
}
</style>
