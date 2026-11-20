<script setup lang="ts">
// Classificação de risco externa (transição) (M34; ficha, seção 7 e regra 12): `/pa/classificacao-externa`. Os perfis
// de prioridade da ferramenta externa (CRUD genérico de sistema: consulta) e o caminho da integração (o envio em uso OU
// o motor de integração, nunca os dois; DP-16).
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import { lerHl7 } from '../api-integracoes.js';

const { t } = useI18n();
const hl7 = useQuery({ queryKey: ['integracoes', 'hl7'], queryFn: () => lerHl7() });
</script>

<template>
  <section
    class="tela-agenda"
    aria-labelledby="classificacao-titulo"
    data-testid="tela-classificacao-externa"
  >
    <h1 id="classificacao-titulo">{{ t('integracoes.classificacao.titulo') }}</h1>
    <p>{{ t('integracoes.classificacao.texto') }}</p>
    <section v-if="hl7.data.value" class="painel">
      <p>{{ t(`integracoes.hl7.caminhos.${hl7.data.value.classificacaoExterna.caminho}`) }}</p>
      <p class="secundario">{{ hl7.data.value.classificacaoExterna.decisao }}</p>
    </section>
    <GrupoDominiosTela subitem="classificacaoExterna" embutida />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
