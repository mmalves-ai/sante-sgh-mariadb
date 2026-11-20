<script setup lang="ts">
// Análise livre no BI (M16; ficha, seção 7; regra 17): o endereço da ferramenta (data mart pseudonimizado, da
// cópia diária) quando a chave `relatorio.bi` está ligada; senão, o motivo e o que falta.
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerBi } from '../api-internacao.js';

const { t } = useI18n();
const bi = useQuery({ queryKey: ['relatorio', 'bi'], queryFn: () => lerBi() });
</script>

<template>
  <section class="tela" aria-labelledby="bi-titulo">
    <h1 id="bi-titulo">{{ t('internacao.bi.titulo') }}</h1>
    <p>{{ t('internacao.bi.texto') }}</p>
    <MensagemErro v-if="bi.isError.value" :erro="bi.error.value" />
    <p v-else-if="bi.isPending.value">{{ t('internacao.comum.carregando') }}</p>
    <template v-else-if="bi.data.value">
      <p v-if="bi.data.value.ligado && bi.data.value.endereco">
        <a :href="bi.data.value.endereco" target="_blank" rel="noopener noreferrer" data-testid="bi-abrir">{{
          t('internacao.bi.abrir')
        }}</a>
      </p>
      <template v-else>
        <SanteAlerta :texto="t('internacao.bi.desligado')" variante="info" data-testid="bi-desligado" />
        <p v-if="bi.data.value.motivo">{{ bi.data.value.motivo }}</p>
        <h2>{{ t('internacao.bi.pendencias') }}</h2>
        <ul>
          <li v-for="p in bi.data.value.pendencias" :key="p">{{ p }}</li>
        </ul>
      </template>
    </template>
  </section>
</template>
