<script setup lang="ts">
// Atalho para a tela do vínculo da conta ao estabelecimento (01-ADM L59), já com o login quando vem da ficha.
import { useI18n } from 'vue-i18n';

defineProps<{ login?: string }>();
const { t } = useI18n({
  useScope: 'local',
  messages: { 'pt-BR': { rotulo: 'Acesso de conta existente a este estabelecimento' } },
});
</script>

<template>
  <router-link
    :to="{ name: 'adm.vinculoConta', query: login ? { login } : {} }"
    class="atalho"
    data-testid="atalho-vinculo-conta"
    >{{ t('rotulo') }}</router-link
  >
</template>

<style scoped>
.atalho {
  justify-self: start;
}
</style>
