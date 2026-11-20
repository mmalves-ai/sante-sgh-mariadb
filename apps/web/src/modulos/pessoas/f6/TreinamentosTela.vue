<script setup lang="ts">
// Treinamentos e capacitações (M52.6; item `Gestão de pessoas > Treinamentos e capacitações`;
// `pessoas.treinamento.ler` / `.registrar`; regra 20; RDC63-05, NR32-04): a situação dos colaboradores ativos nos
// cursos obrigatórios (e a ficha de cada um), o catálogo de cursos com o público obrigatório, as turmas com a lista de
// presença e os POPs versionados com a ciência.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import AbaCursos from './AbaCursos.vue';
import AbaPops from './AbaPops.vue';
import AbaSituacao from './AbaSituacao.vue';
import AbaTurmas from './AbaTurmas.vue';
import { lerApoioTreinamento } from './api-f6.js';

const { t } = useI18n();
const apoio = useQuery({ queryKey: ['f6', 'treinamento', 'apoio'], queryFn: lerApoioTreinamento });
const a = computed(() => apoio.data.value ?? null);
type Aba = 'situacao' | 'cursos' | 'turmas' | 'pops';
const aba = ref<Aba>('situacao');
const abas: Aba[] = ['situacao', 'cursos', 'turmas', 'pops'];
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="treino-titulo" data-testid="tela-treinamentos">
    <h1 id="treino-titulo">{{ t('f6.treinamentos.titulo') }}</h1>
    <p>{{ t('f6.treinamentos.subtitulo') }}</p>
    <ErroPessoas v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('f6.carregando') }}</p>
    <template v-else>
      <SanteAlerta v-if="!a.gravacao.ligada" :texto="a.gravacao.motivo ?? ''" variante="info" />
      <SanteAlerta v-else-if="!a.acoes.registrar" :texto="t('f6.soConsulta')" variante="info" />
      <div class="acoes" role="tablist">
        <SanteBotao
          v-for="x in abas"
          :key="x"
          role="tab"
          :aria-selected="aba === x"
          :variante="aba === x ? 'primario' : 'secundario'"
          :rotulo="t(`f6.treinamentos.abas.${x}`)"
          :data-testid="`treino-aba-${x}`"
          @acionar="aba = x"
        />
      </div>
      <AbaSituacao v-if="aba === 'situacao'" :apoio="a" />
      <AbaCursos v-else-if="aba === 'cursos'" :apoio="a" />
      <AbaTurmas v-else-if="aba === 'turmas'" :apoio="a" />
      <AbaPops v-else :apoio="a" />
    </template>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
