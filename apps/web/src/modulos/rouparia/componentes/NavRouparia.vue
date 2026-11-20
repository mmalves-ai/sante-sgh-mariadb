<script setup lang="ts">
// As partes da rouparia (o painel do dia, os movimentos, o enxoval, as cotas, a estatística e a versão para celular).
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const itens = [
  { para: '/hotelaria/rouparia', chave: 'painel' },
  { para: '/hotelaria/rouparia/movimentos', chave: 'movimentos' },
  { para: '/hotelaria/rouparia/enxoval', chave: 'enxoval' },
  { para: '/hotelaria/rouparia/cotas', chave: 'cotas' },
  { para: '/hotelaria/rouparia/indicadores', chave: 'indicadores' },
  { para: '/m/rouparia', chave: 'celular' },
] as const;
</script>

<template>
  <nav class="nav-rouparia" :aria-label="t('rouparia.nav.rotulo')" data-testid="nav-rouparia">
    <RouterLink v-for="i in itens" :key="i.para" :to="i.para" exact-active-class="ativo">
      {{ t(`rouparia.nav.${i.chave}`) }}
    </RouterLink>
  </nav>
</template>

<style scoped>
.nav-rouparia {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.nav-rouparia a {
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  color: var(--sgh-texto);
  text-decoration: none;
}
.nav-rouparia a.ativo {
  font-weight: 600;
  border-color: var(--sgh-primaria);
}
</style>
