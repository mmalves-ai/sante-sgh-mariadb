<script setup lang="ts">
// Interfaces de equipamento (M34; ficha, seção 7): `/sadt/laboratorio/interfaces`. As interfaces de equipamento e dos
// laboratórios de apoio e os modelos (consulta: nenhuma senha, usuário de FTP nem chave) e o de-para de exames por
// interface (CRUD genérico).
import { useI18n } from 'vue-i18n';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';

const { t } = useI18n();
</script>

<template>
  <section class="tela-agenda" aria-labelledby="interfaces-titulo" data-testid="tela-interfaces">
    <h1 id="interfaces-titulo">{{ t('integracoes.interfaces.titulo') }}</h1>
    <p>{{ t('integracoes.interfaces.texto') }}</p>
    <GrupoDominiosTela subitem="interfacesEquipamento" embutida />
  </section>
</template>
