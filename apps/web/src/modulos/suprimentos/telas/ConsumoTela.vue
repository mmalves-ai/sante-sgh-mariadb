<script setup lang="ts">
// Consumo por local e por centro de custo (ficha do M28, seção 7): `/suprimentos/consumo`. O relatório da competência
// (da cópia diária quando houver; do banco, agregado, quando não): por centro de custo (o técnico, 9901 a 9999, não
// gera consumo) e por local (saídas e devoluções); o total com as parcelas impressas; exporta em CSV (auditado).
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerConsumo, urlConsumoCsv } from '../api-suprimentos.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { qtd, reais } from '../usar-suprimentos.js';

const { t } = useI18n();
const hoje = new Date();
const ano = ref(String(hoje.getFullYear()));
const mes = ref(String(hoje.getMonth() + 1));
const c = useQuery({
  queryKey: computed(() => ['suprimentos', 'consumo', ano.value, mes.value]),
  queryFn: () => lerConsumo(Number(ano.value), Number(mes.value)),
  enabled: computed(() => Number(ano.value) > 2000 && Number(mes.value) >= 1 && Number(mes.value) <= 12),
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="con-titulo" data-testid="tela-suprimentos-consumo">
    <h1 id="con-titulo">{{ t('suprimentos.consumo.titulo') }}</h1>
    <p>{{ t('suprimentos.consumo.texto') }}</p>
    <div class="filtros">
      <span class="campo">
        <label for="con-ano">{{ t('suprimentos.ano') }}</label>
        <input id="con-ano" v-model="ano" inputmode="numeric" size="5" data-testid="con-ano" />
      </span>
      <span class="campo">
        <label for="con-mes">{{ t('suprimentos.mes') }}</label>
        <input id="con-mes" v-model="mes" inputmode="numeric" size="3" data-testid="con-mes" />
      </span>
      <a :href="urlConsumoCsv(Number(ano), Number(mes))" data-testid="con-csv">{{
        t('suprimentos.exportarCsv')
      }}</a>
    </div>
    <ErroSuprimentos v-if="c.error.value" :erro="c.error.value" />
    <p v-else-if="!c.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <template v-else>
      <p class="secundario">
        {{
          c.data.value.fonte === 'copia-diaria'
            ? t('suprimentos.consumo.fonteCopia')
            : t('suprimentos.consumo.fonteBanco')
        }}
      </p>
      <p data-testid="con-total">
        {{ t('suprimentos.consumo.total') }} {{ reais(c.data.value.total.valor) }}
        <template v-if="c.data.value.total.parcelas.length > 1"
          >({{ c.data.value.total.parcelas.map(reais).join(' + ') }})</template
        >
      </p>
      <table class="tabela" data-testid="con-centros">
        <caption>
          {{
            t('suprimentos.consumo.porCentro')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.centroCusto') }}</th>
            <th scope="col">{{ t('suprimentos.quantidade') }}</th>
            <th scope="col">{{ t('suprimentos.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in c.data.value.porCentroCusto" :key="x.centroCusto">
            <td>
              {{ x.centroCusto }} · {{ x.nome
              }}<span v-if="x.tecnico" class="secundario"> · {{ t('suprimentos.saidas.tecnico') }}</span>
            </td>
            <td>{{ qtd(x.quantidade) }}</td>
            <td>{{ reais(x.valor) }}</td>
          </tr>
        </tbody>
      </table>
      <table class="tabela" data-testid="con-locais">
        <caption>
          {{
            t('suprimentos.consumo.porLocal')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.local') }}</th>
            <th scope="col">{{ t('suprimentos.consumo.saidas') }}</th>
            <th scope="col">{{ t('suprimentos.consumo.devolucoes') }}</th>
            <th scope="col">{{ t('suprimentos.consumo.valorSaidas') }}</th>
            <th scope="col">{{ t('suprimentos.consumo.valorDevolucoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in c.data.value.porLocal" :key="x.local">
            <td>{{ x.localNome }}</td>
            <td>{{ qtd(x.saida) }}</td>
            <td>{{ qtd(x.devolucao) }}</td>
            <td>{{ reais(x.valorSaida) }}</td>
            <td>{{ reais(x.valorDevolucao) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
