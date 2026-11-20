<script setup lang="ts">
// Catálogos da ANS para o hospital (M56, correção do M56.1; D-ANS-HOSPITAL-56): a mesma consulta da tela de Envios à
// ANS, aberta a quem consulta os catálogos oficiais no hospital (`catalogo.ans.ler`), com a operadora desligada ou
// ligada. O atalho fica na consulta de TISS/TUSS e terminologias da ANS.
import { useI18n } from 'vue-i18n';
import CatalogosAns from '../componentes/CatalogosAns.vue';

const { t } = useI18n();
</script>

<template>
  <section class="tela-operadora" data-testid="tela-catalogos-ans">
    <p>
      <RouterLink to="/cadastros/catalogos/tuss" data-testid="link-catalogos-tuss">{{
        t('operadora.telas.ans.voltarTuss')
      }}</RouterLink>
    </p>
    <CatalogosAns nivel="h1" />
  </section>
</template>

<style scoped src="../estilo-operadora.css"></style>
