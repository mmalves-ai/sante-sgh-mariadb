<script setup lang="ts">
// Prescrição digital externa (M34; ficha, seção 7; DP-30): `/pep/prescricao-digital`. O registro da integração com a
// plataforma de prescrição digital externa, em consulta (sem o conteúdo da prescrição).
import { useI18n } from 'vue-i18n';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';

const { t } = useI18n();
</script>

<template>
  <section
    class="tela-agenda"
    aria-labelledby="prescricao-digital-titulo"
    data-testid="tela-prescricao-digital"
  >
    <h1 id="prescricao-digital-titulo">{{ t('integracoes.prescricao.titulo') }}</h1>
    <p>{{ t('integracoes.prescricao.texto') }}</p>
    <GrupoDominiosTela subitem="prescricaoDigital" embutida />
  </section>
</template>
