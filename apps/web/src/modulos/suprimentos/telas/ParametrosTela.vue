<script setup lang="ts">
// Parâmetros e numeração de documentos (ficha do M28, seção 7): `/suprimentos/parametros`. Consulta: os parâmetros
// do estoque do usuário (lidos como a tela de origem lê), a numeração por tipo e competência e as sequências. Nada
// aqui grava: mudar parâmetro do estoque é decisão da área, testada antes na cópia.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { lerParametros } from '../api-suprimentos.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';

const { t } = useI18n();
const p = useQuery({ queryKey: ['suprimentos', 'parametros'], queryFn: () => lerParametros() });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="par-titulo" data-testid="tela-suprimentos-parametros">
    <h1 id="par-titulo">{{ t('suprimentos.parametros.titulo') }}</h1>
    <p>{{ t('suprimentos.parametros.texto') }}</p>
    <ErroSuprimentos v-if="p.error.value" :erro="p.error.value" />
    <p v-else-if="!p.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="par-parametros">
        <caption>
          {{
            t('suprimentos.parametros.doUsuario', { u: p.data.value.usuario })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.parametros.parametro') }}</th>
            <th scope="col">{{ t('suprimentos.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in p.data.value.parametros" :key="x.chave">
            <td>{{ x.rotulo }}</td>
            <td>{{ x.valor }}</td>
          </tr>
        </tbody>
      </table>
      <table class="tabela" data-testid="par-numeracao">
        <caption>
          {{
            t('suprimentos.parametros.numeracao')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.parametros.tipo') }}</th>
            <th scope="col">{{ t('suprimentos.competencia') }}</th>
            <th scope="col">{{ t('suprimentos.parametros.ultimo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in p.data.value.numeracao" :key="`${x.tipo}-${x.competencia}`">
            <td>{{ x.tipo }}</td>
            <td>{{ x.competencia }}</td>
            <td>{{ x.ultimo }}</td>
          </tr>
        </tbody>
      </table>
      <table class="tabela" data-testid="par-sequencias">
        <caption>
          {{
            t('suprimentos.parametros.sequencias')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.codigo') }}</th>
            <th scope="col">{{ t('suprimentos.nome') }}</th>
            <th scope="col">{{ t('suprimentos.ano') }}</th>
            <th scope="col">{{ t('suprimentos.parametros.proximo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in p.data.value.sequencias" :key="`${x.codigo}-${x.ano}`">
            <td>{{ x.codigo }}</td>
            <td>{{ x.nome }}</td>
            <td>{{ x.ano }}</td>
            <td>{{ x.proximo }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
