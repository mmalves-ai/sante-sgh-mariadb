<script setup lang="ts">
// Recepções e setores de senha (M19; ficha, seção 7): o cadastro da estrutura da recepção com gravação (02-REC linha
// 33: recepção, guichês e serviços de senha, em EstruturaRecepcaoBloco) e, de cada recepção, os locais de atendimento
// e os encaminhamentos permitidos entre locais, também com gravação (C2-005, em LocaisAtendimentoBloco).
import { useI18n } from 'vue-i18n';
import EstruturaRecepcaoBloco from '../componentes/EstruturaRecepcaoBloco.vue';
import LocaisAtendimentoBloco from '../componentes/LocaisAtendimentoBloco.vue';

const { t } = useI18n();
</script>

<template>
  <section class="tela-recepcao" aria-labelledby="recepcoes-titulo" data-testid="tela-recepcoes">
    <h1 id="recepcoes-titulo">{{ t('recepcao.recepcoes.titulo') }}</h1>
    <p>{{ t('recepcao.recepcoes.texto') }}</p>
    <EstruturaRecepcaoBloco foco="tudo" />
    <LocaisAtendimentoBloco />
  </section>
</template>

<style src="../estilo-recepcao.css"></style>
