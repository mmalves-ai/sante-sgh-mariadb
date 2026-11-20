<script setup lang="ts">
// Painéis de chamada (M19; ficha, seção 7): os painéis cadastrados por recepção e local e os tipos de painel (CRUD
// genérico) e os aparelhos de TV que mostram as chamadas ao vivo, com voz (perfil Painel/Totem).
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import DominiosIndiceTela from '../../config/telas/DominiosIndiceTela.vue';
import DispositivosBloco from '../componentes/DispositivosBloco.vue';

const { t } = useI18n();
const podeDispositivos = computed(() => pode('recepcao.dispositivo.ler'));
</script>

<template>
  <section class="tela-recepcao" aria-labelledby="paineis-titulo" data-testid="tela-paineis-chamada">
    <h1 id="paineis-titulo">{{ t('recepcao.paineis.titulo') }}</h1>
    <p>{{ t('recepcao.paineis.texto') }}</p>
    <DominiosIndiceTela subitem="recepcaoPaineis" embutido />
    <DispositivosBloco v-if="podeDispositivos" tipo="painel" :titulo="t('recepcao.dispositivos.paineis')" />
  </section>
</template>

<style src="../estilo-recepcao.css"></style>
