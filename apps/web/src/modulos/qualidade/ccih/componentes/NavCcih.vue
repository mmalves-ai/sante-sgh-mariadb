<script setup lang="ts">
// A navegação entre as telas da CCIH (só as que a sessão pode abrir).
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../../casca/sessao/pode.js';

const { t } = useI18n();
const telas = computed(() =>
  [
    { rota: '/qualidade/ccih/vigilancia', rotulo: 'vigilancia', permissao: 'qualidade.ccih.ler' },
    { rota: '/qualidade/ccih/iras', rotulo: 'iras', permissao: 'qualidade.iras.ler' },
    { rota: '/qualidade/ccih/culturas', rotulo: 'culturas', permissao: 'qualidade.iras.ler' },
    { rota: '/qualidade/ccih/notificacao', rotulo: 'notificacao', permissao: 'qualidade.iras.ler' },
    {
      rota: '/qualidade/ccih/antimicrobianos',
      rotulo: 'antimicrobianos',
      permissao: 'qualidade.antimicrobiano.ler',
    },
    { rota: '/qualidade/ccih/precaucoes', rotulo: 'precaucoes', permissao: 'qualidade.precaucao.ler' },
    { rota: '/qualidade/ccih/maos-surtos', rotulo: 'maosSurtos', permissao: 'qualidade.ccih.registrar' },
  ].filter((x) => pode(x.permissao)),
);
</script>

<template>
  <nav class="nav-ccih" :aria-label="t('ccih.navegacao')">
    <RouterLink v-for="x in telas" :key="x.rota" :to="x.rota" :data-testid="`nav-ccih-${x.rotulo}`">{{
      t(`ccih.telas.${x.rotulo}`)
    }}</RouterLink>
  </nav>
</template>

<style scoped>
.nav-ccih {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
}
</style>
