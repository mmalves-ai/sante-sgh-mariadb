<script setup lang="ts">
// Endpoints, webservices e integrador (M34; ficha, seção 7): `/admin/integracoes/endpoints`. As consultas dos
// endpoints, dos serviços internos, das identificações e das tabelas do integrador (nenhuma credencial é lida) e o CRUD
// genérico dos tipos de operação e dos padrões de webservice.
import { useI18n } from 'vue-i18n';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';

const { t } = useI18n();
</script>

<template>
  <section class="tela-agenda" aria-labelledby="endpoints-titulo" data-testid="tela-endpoints">
    <h1 id="endpoints-titulo">{{ t('integracoes.endpoints.titulo') }}</h1>
    <p>{{ t('integracoes.endpoints.texto') }}</p>
    <GrupoDominiosTela subitem="integracaoWebservices" embutida />
  </section>
</template>
