<script setup lang="ts">
// Fornecedores e terceiros (ficha do M28, seção 7): `/suprimentos/fornecedores`. Consulta pelo nome, fantasia ou
// código; o CNPJ/CPF aparece conferido (dígitos verificadores) e o da pessoa física mascarado; dados bancários só
// mascarados. O cadastro (incluir, alterar, inativar) é P2 e segue desligado (POL-3): a tela mostra o motivo.
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { listarFornecedores, listarPrestadores, listarTerceiros } from '../api-suprimentos.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { usarSuprimentos } from '../usar-suprimentos.js';

const { t } = useI18n();
const { motivoFuncionalidade } = usarSuprimentos();
const termo = ref('');
const busca = ref('');
const lista = useQuery({
  queryKey: ['suprimentos', 'fornecedores', busca],
  queryFn: () => listarFornecedores(busca.value),
});
// Terceiros (GECADTER) e colaboradores e prestadores (GETABFUN): só consulta, pela mesma busca (D-FORN-28).
const terceiros = useQuery({
  queryKey: ['suprimentos', 'terceiros', busca],
  queryFn: () => listarTerceiros(busca.value),
});
const prestadores = useQuery({
  queryKey: ['suprimentos', 'prestadores', busca],
  queryFn: () => listarPrestadores(busca.value),
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="forn-titulo" data-testid="tela-suprimentos-fornecedores">
    <h1 id="forn-titulo">{{ t('suprimentos.fornecedores.titulo') }}</h1>
    <p>{{ t('suprimentos.fornecedores.texto') }}</p>
    <AvisoSuprimentos
      :motivo="motivoFuncionalidade('suprimentos.cadastros') ?? t('suprimentos.fornecedores.edicaoDesligada')"
    />
    <form class="filtros" @submit.prevent="busca = termo.trim()">
      <span class="campo">
        <label for="forn-termo">{{ t('suprimentos.fornecedores.busca') }}</label>
        <input id="forn-termo" v-model="termo" data-testid="forn-termo" />
      </span>
      <SanteBotao
        tipo="submit"
        variante="secundario"
        :rotulo="t('suprimentos.buscar')"
        data-testid="forn-buscar"
      />
    </form>
    <ErroSuprimentos v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="forn-tabela">
        <caption>
          {{
            t('suprimentos.fornecedores.lista')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.codigo') }}</th>
            <th scope="col">{{ t('suprimentos.nome') }}</th>
            <th scope="col">{{ t('suprimentos.fornecedores.documento') }}</th>
            <th scope="col">{{ t('suprimentos.fornecedores.cidade') }}</th>
            <th scope="col">{{ t('suprimentos.fornecedores.banco') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in lista.data.value.itens" :key="f.codigo">
            <td>{{ f.codigo }}</td>
            <td>
              {{ f.nome }}
              <span v-if="f.fantasia" class="secundario"> · {{ f.fantasia }}</span>
            </td>
            <td>
              {{ f.documento || '—' }}
              <span v-if="f.documento && !f.documentoValido" class="secundario">
                · {{ t('suprimentos.fornecedores.documentoInvalido') }}</span
              >
            </td>
            <td>
              {{ f.cidade }}<template v-if="f.uf"> / {{ f.uf }}</template>
            </td>
            <td>{{ f.banco ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="lista.data.value.itens.length === 0">{{ t('suprimentos.nenhum') }}</p>
      <p v-if="lista.data.value.cortada" role="status">{{ t('suprimentos.cortada') }}</p>
    </template>
    <AvisoSuprimentos :motivo="t('suprimentos.fornecedores.edicaoTerceiros')" />
    <h2>{{ t('suprimentos.fornecedores.terceiros') }}</h2>
    <ErroSuprimentos v-if="terceiros.error.value" :erro="terceiros.error.value" />
    <p v-else-if="!terceiros.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="forn-terceiros">
        <caption>
          {{
            t('suprimentos.fornecedores.terceiros')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.codigo') }}</th>
            <th scope="col">{{ t('suprimentos.nome') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in terceiros.data.value.itens" :key="x.codigo">
            <td>{{ x.codigo }}</td>
            <td>{{ x.nome }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="terceiros.data.value.itens.length === 0">{{ t('suprimentos.nenhum') }}</p>
      <p v-if="terceiros.data.value.cortada" role="status">{{ t('suprimentos.cortada') }}</p>
    </template>
    <h2>{{ t('suprimentos.fornecedores.prestadores') }}</h2>
    <ErroSuprimentos v-if="prestadores.error.value" :erro="prestadores.error.value" />
    <p v-else-if="!prestadores.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="forn-prestadores">
        <caption>
          {{
            t('suprimentos.fornecedores.prestadores')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.codigo') }}</th>
            <th scope="col">{{ t('suprimentos.nome') }}</th>
            <th scope="col">{{ t('suprimentos.fornecedores.empresa') }}</th>
            <th scope="col">{{ t('suprimentos.fornecedores.cpf') }}</th>
            <th scope="col">{{ t('suprimentos.fornecedores.situacao') }}</th>
            <th scope="col">{{ t('suprimentos.fornecedores.banco') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in prestadores.data.value.itens" :key="`${x.empresa}-${x.codigo}`">
            <td>{{ x.codigo }}</td>
            <td>{{ x.nome }}</td>
            <td>{{ x.empresa }}</td>
            <td>
              {{ x.documento || '—' }}
              <span v-if="x.documento && !x.documentoValido" class="secundario">
                · {{ t('suprimentos.fornecedores.documentoInvalido') }}</span
              >
            </td>
            <td>{{ x.situacao || '—' }}</td>
            <td>{{ x.banco ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="prestadores.data.value.itens.length === 0">{{ t('suprimentos.nenhum') }}</p>
      <p v-if="prestadores.data.value.cortada" role="status">{{ t('suprimentos.cortada') }}</p>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
