<script setup lang="ts">
// Guias TISS (ficha do M31, seção 7): `/faturamento/guias`. As guias das contas emitidas (consulta, SP/SADT, resumo de
// internação, honorário individual) com o lote em que estão e a impressão no leiaute da TISS em PDF/A. A emissão e a
// numeração da guia seguem no cadastro de origem até o cenário controlado (a emissão pelo novo é a etapa seguinte).
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import CancelamentoDocumentosGuia from '../componentes/CancelamentoDocumentosGuia.vue';
import { listarGuias, urlImpressaoGuia } from '../api-tiss.js';
import { data, opcoesConvenio, reais, usarTiss } from '../usar-tiss.js';

const { t } = useI18n();
const { apoio } = usarTiss('lote');
const convenio = ref('');
const competencia = ref('');
const filtro = ref({ convenio: '', competencia: '' });
const g = useQuery({
  queryKey: computed(() => ['tiss', 'guias', filtro.value]),
  queryFn: () => listarGuias(filtro.value),
});
/** A conta aberta no painel de cancelamento e documentos anexos (06-FAT linha 28). */
const contaAberta = ref<number | null>(null);
const convenios = computed(() => opcoesConvenio(apoio.data.value?.convenios, t('tiss.todos')));
</script>

<template>
  <section class="tela-agenda" aria-labelledby="gu-titulo" data-testid="tela-tiss-guias">
    <h1 id="gu-titulo">{{ t('tiss.guias.titulo') }}</h1>
    <RouterLink to="/faturamento/guias-convenio" data-testid="gu-guias-convenio">{{
      t('auditoriaTramite.atalhos.guiasConvenio')
    }}</RouterLink>
    <p>{{ t('tiss.guias.texto') }}</p>
    <form class="filtros" @submit.prevent="filtro = { convenio, competencia }">
      <span class="campo">
        <SanteSelecao
          v-model="convenio"
          :rotulo="t('tiss.convenio')"
          :opcoes="convenios"
          data-testid="gu-convenio"
        />
      </span>
      <span class="campo">
        <label for="gu-competencia">{{ t('tiss.competencia') }}</label>
        <input id="gu-competencia" v-model="competencia" type="month" data-testid="gu-competencia" />
      </span>
      <button type="submit" data-testid="gu-buscar">{{ t('tiss.buscar') }}</button>
    </form>
    <ErroFaturamento v-if="g.error.value" :erro="g.error.value" />
    <p v-else-if="!g.data.value" role="status">{{ t('tiss.carregando') }}</p>
    <p v-else-if="g.data.value.length === 0">{{ t('tiss.nenhum') }}</p>
    <table v-else class="tabela" data-testid="gu-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('tiss.conta') }}</th>
          <th scope="col">{{ t('tiss.tipoGuia') }}</th>
          <th scope="col">{{ t('tiss.guias.numero') }}</th>
          <th scope="col">{{ t('tiss.convenio') }}</th>
          <th scope="col">{{ t('tiss.carteira') }}</th>
          <th scope="col">{{ t('tiss.emissao') }}</th>
          <th scope="col">{{ t('tiss.total') }}</th>
          <th scope="col">{{ t('tiss.lote') }}</th>
          <th scope="col">{{ t('tiss.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in g.data.value" :key="x.conta" :data-testid="`gu-${x.conta}`">
          <td>
            {{ x.conta }} <span class="secundario">· {{ x.chave }}</span>
          </td>
          <td>{{ x.tipoGuiaNome }}</td>
          <td>{{ x.numeroGuia }}</td>
          <td>{{ x.convenioNome || x.convenio }}</td>
          <td>{{ x.beneficiario }}</td>
          <td>{{ data(x.dataEmissao) }}</td>
          <td>{{ reais(x.total) }}</td>
          <td>
            <RouterLink v-if="x.lote" :to="`/faturamento/lotes/${x.lote}`">{{ x.lote }}</RouterLink>
            <span v-else>—</span>
          </td>
          <td>
            <a
              :href="urlImpressaoGuia(x.conta)"
              target="_blank"
              rel="noopener"
              :data-testid="`gu-imprimir-${x.conta}`"
            >
              {{ t('tiss.guias.imprimir') }}
            </a>
            ·
            <button type="button" :data-testid="`gu-cancelamento-${x.conta}`" @click="contaAberta = x.conta">
              {{ t('cancelamentoDocumentos.acao') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <CancelamentoDocumentosGuia
      v-if="contaAberta !== null"
      :key="contaAberta"
      :conta="contaAberta"
      @fechar="contaAberta = null"
    />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
