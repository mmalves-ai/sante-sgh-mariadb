<script setup lang="ts">
// Fluxo de caixa realizado e projetado (ficha do M32, seção 7): `/financeiro/tesouraria/fluxo-caixa`. A tabela por dia,
// semana ou mês (realizado e projetado, entradas e saídas, saldo acumulado a partir do saldo inicial), o gráfico do
// saldo e as premissas do projetado (glosa histórica e atraso médio por convênio). Exportar (CSV) exige a permissão.
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { lerFluxoCaixa } from '../api-financeiro.js';
import { data, num, paraCsv, reais, usarFinanceiro } from '../usar-financeiro.js';

const { t } = useI18n();
const { tem } = usarFinanceiro();
const filtro = reactive({ de: '', ate: '', agrupamento: 'semana' });
const pedido = ref({ ...filtro });
const fluxo = useQuery({
  queryKey: computed(() => ['financeiro', 'fluxo', pedido.value]),
  queryFn: () => lerFluxoCaixa(pedido.value),
});
const agrupamentos = computed(() =>
  (['dia', 'semana', 'mes'] as const).map((a) => ({
    valor: a,
    rotulo: t(`financeiro.fluxo.agrupamentos.${a}`),
  })),
);
const maior = computed(() => Math.max(1, ...(fluxo.data.value?.linhas ?? []).map((l) => Math.abs(l.saldo))));
function exportar() {
  const f = fluxo.data.value;
  if (!f) return;
  const csv = paraCsv(
    [
      t('financeiro.fluxo.periodo'),
      t('financeiro.fluxo.entradasRealizadas'),
      t('financeiro.fluxo.saidasRealizadas'),
      t('financeiro.fluxo.entradasProjetadas'),
      t('financeiro.fluxo.saidasProjetadas'),
      t('financeiro.fluxo.saldo'),
    ],
    f.linhas.map((l) => [
      l.periodo,
      l.entradasRealizadas,
      l.saidasRealizadas,
      l.entradasProjetadas,
      l.saidasProjetadas,
      l.saldo,
    ]),
  );
  const url = URL.createObjectURL(
    new Blob([String.fromCharCode(0xfeff) + csv], { type: 'text/csv;charset=utf-8' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `fluxo-caixa-${f.de}-${f.ate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="fc-titulo" data-testid="tela-fin-fluxo-caixa">
    <h1 id="fc-titulo">{{ t('financeiro.fluxo.titulo') }}</h1>
    <p>{{ t('financeiro.fluxo.texto') }}</p>
    <p v-if="tem('financeiro.movimento.ler')">
      <RouterLink to="/financeiro/receber/cartao" data-testid="fc-cartao">
        {{ t('financeiro.cartao.atalho') }}
      </RouterLink>
    </p>
    <form class="filtros" @submit.prevent="pedido = { ...filtro }">
      <span class="campo">
        <label for="fc-de">{{ t('financeiro.de') }}</label>
        <input id="fc-de" v-model="filtro.de" type="date" data-testid="fc-de" />
      </span>
      <span class="campo">
        <label for="fc-ate">{{ t('financeiro.ate') }}</label>
        <input id="fc-ate" v-model="filtro.ate" type="date" data-testid="fc-ate" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="filtro.agrupamento"
          :rotulo="t('financeiro.fluxo.agrupamento')"
          :opcoes="agrupamentos"
          data-testid="fc-agrupamento"
        />
      </span>
      <button type="submit" data-testid="fc-consultar">{{ t('financeiro.consultar') }}</button>
      <button
        type="button"
        :disabled="!fluxo.data.value || !tem('financeiro.fluxoCaixa.exportar')"
        data-testid="fc-exportar"
        @click="exportar"
      >
        {{ t('financeiro.fluxo.exportar') }}
      </button>
    </form>
    <ErroFaturamento v-if="fluxo.error.value" :erro="fluxo.error.value" />
    <p v-else-if="fluxo.isLoading.value">{{ t('financeiro.carregando') }}</p>
    <template v-else-if="fluxo.data.value">
      <p data-testid="fc-saldo-inicial">
        {{ t('financeiro.fluxo.saldoInicial') }} ({{ data(fluxo.data.value.de) }}):
        {{ reais(fluxo.data.value.saldoInicial) }}
      </p>
      <figure>
        <figcaption>{{ t('financeiro.fluxo.grafico') }}</figcaption>
        <div class="fluxo-barras" role="img" :aria-label="t('financeiro.fluxo.grafico')">
          <div
            v-for="l in fluxo.data.value.linhas"
            :key="l.periodo"
            class="fluxo-barra"
            :class="{ 'fluxo-barra--negativa': l.saldo < 0 }"
            :style="{ height: `${Math.max(2, (Math.abs(l.saldo) / maior) * 100)}%` }"
            :title="`${l.periodo}: ${reais(l.saldo)}`"
          ></div>
        </div>
      </figure>
      <table class="tabela" data-testid="fc-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.fluxo.periodo') }}</th>
            <th scope="col">{{ t('financeiro.fluxo.entradasRealizadas') }}</th>
            <th scope="col">{{ t('financeiro.fluxo.saidasRealizadas') }}</th>
            <th scope="col">{{ t('financeiro.fluxo.entradasProjetadas') }}</th>
            <th scope="col">{{ t('financeiro.fluxo.saidasProjetadas') }}</th>
            <th scope="col">{{ t('financeiro.fluxo.saldo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in fluxo.data.value.linhas" :key="l.periodo">
            <td>{{ l.periodo }}</td>
            <td>{{ reais(l.entradasRealizadas) }}</td>
            <td>{{ reais(l.saidasRealizadas) }}</td>
            <td>{{ reais(l.entradasProjetadas) }}</td>
            <td>{{ reais(l.saidasProjetadas) }}</td>
            <td>{{ reais(l.saldo) }}</td>
          </tr>
        </tbody>
      </table>
      <h2>{{ t('financeiro.fluxo.premissas') }}</h2>
      <table v-if="fluxo.data.value.premissas.length" class="tabela" data-testid="fc-premissas">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.convenio') }}</th>
            <th scope="col">{{ t('financeiro.fluxo.taxaGlosa') }}</th>
            <th scope="col">{{ t('financeiro.fluxo.atraso') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in fluxo.data.value.premissas" :key="p.convenio">
            <td>{{ p.convenio }}</td>
            <td>{{ num(p.taxaGlosa * 100) }}%</td>
            <td>{{ num(p.atrasoMedioDias) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('financeiro.nenhum') }}</p>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
