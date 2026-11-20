<script setup lang="ts">
// A navegação entre as telas da gestão da qualidade e dos envios regulatórios (só as que a sessão pode abrir).
import { PERMISSOES_GESTAO_QUALIDADE as P, PERMISSOES_QUALIDADE as Q } from '@sgh/contratos';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../../casca/sessao/pode.js';

const { t } = useI18n();
const telas = computed(() =>
  [
    { rota: '/qualidade/documentos', rotulo: 'documentos', permissao: P.documentoLer },
    { rota: '/qualidade/indicadores', rotulo: 'indicadores', permissao: P.indicadorLer },
    { rota: '/qualidade/gestao/auditorias', rotulo: 'auditorias', permissao: P.gestaoLer },
    { rota: '/qualidade/gestao/comissoes', rotulo: 'comissoes', permissao: P.gestaoLer },
    { rota: '/qualidade/gestao/riscos', rotulo: 'riscos', permissao: P.gestaoLer },
    { rota: '/qualidade/ouvidoria', rotulo: 'ouvidoria', permissao: P.ouvidoriaLer },
    // W0-04 (M5)
    {
      rota: '/qualidade/gestao/revisao-prontuarios',
      rotulo: 'revisao',
      permissao: Q.revisaoProntuarioLer,
    },
    { rota: '/relatorios/envios-regulatorios', rotulo: 'envios', permissao: P.envioGerar },
  ].filter((x) => pode(x.permissao)),
);
</script>

<template>
  <nav class="nav-gestao" :aria-label="t('gestaoQualidade.nav.rotulo')">
    <RouterLink v-for="x in telas" :key="x.rota" :to="x.rota" :data-testid="`nav-gestao-${x.rotulo}`">{{
      t(`gestaoQualidade.nav.${x.rotulo}`)
    }}</RouterLink>
  </nav>
</template>

<style scoped>
.nav-gestao {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
}
</style>
