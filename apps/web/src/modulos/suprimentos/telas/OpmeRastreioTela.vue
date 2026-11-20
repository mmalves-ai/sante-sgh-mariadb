<script setup lang="ts">
// Rastreio reverso do OPME com entrada própria (M46, etapa 3; regra 8): para quem cuida da tecnovigilância, pela
// permissão suprimentos.lote.rastrear, sem depender da conciliação com a conta (que é do faturamento).
import { useI18n } from 'vue-i18n';
import RastreioOpmePainel from '../componentes/RastreioOpmePainel.vue';
import './estilo-opme.css';

const { t } = useI18n();
</script>

<template>
  <section class="tela-opme" aria-labelledby="opmer-titulo" data-testid="tela-opme-rastreio">
    <h1 id="opmer-titulo">{{ t('opme.conciliacao.tituloRastreio') }}</h1>
    <p class="secundario">{{ t('opme.conciliacao.explicaRastreio') }}</p>
    <RastreioOpmePainel />
  </section>
</template>
