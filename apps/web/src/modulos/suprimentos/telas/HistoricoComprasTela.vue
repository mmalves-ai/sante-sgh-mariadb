<script setup lang="ts">
// Histórico de compras por item (ficha do M28, seção 7): `/suprimentos/historico-compras`. Escolhe o item e lista as
// compras (data, fornecedor, nota, quantidade, unitário, custo, marca), o último custo e o menor unitário; exporta em
// CSV (auditado) com a permissão de exportar.
import type { ItemBusca } from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerHistorico, urlHistoricoCsv } from '../api-suprimentos.js';
import BuscaItem from '../componentes/BuscaItem.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { data, qtd, reais } from '../usar-suprimentos.js';

const { t } = useI18n();
const item = ref<ItemBusca | null>(null);
const codigo = computed(() => item.value?.codigo ?? 0);
const h = useQuery({
  queryKey: computed(() => ['suprimentos', 'historico', codigo.value]),
  queryFn: () => lerHistorico(codigo.value),
  enabled: computed(() => codigo.value > 0),
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="hist-titulo" data-testid="tela-suprimentos-historico">
    <h1 id="hist-titulo">{{ t('suprimentos.historico.titulo') }}</h1>
    <p>{{ t('suprimentos.historico.texto') }}</p>
    <BuscaItem testid="hist-busca" @escolher="(i) => (item = i)" />
    <ErroSuprimentos v-if="h.error.value" :erro="h.error.value" />
    <template v-if="h.data.value">
      <h2>{{ h.data.value.item }} · {{ h.data.value.nome }}</h2>
      <p>
        {{ t('suprimentos.historico.ultimo') }}
        {{ h.data.value.ultimoCusto === null ? '—' : reais(h.data.value.ultimoCusto) }} ·
        {{ t('suprimentos.historico.menor') }}
        {{ h.data.value.menorUnitario === null ? '—' : reais(h.data.value.menorUnitario) }}
      </p>
      <a :href="urlHistoricoCsv(h.data.value.item)" data-testid="hist-csv">{{
        t('suprimentos.exportarCsv')
      }}</a>
      <table class="tabela" data-testid="hist-tabela">
        <caption>
          {{
            t('suprimentos.historico.compras')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.data') }}</th>
            <th scope="col">{{ t('suprimentos.fornecedor') }}</th>
            <th scope="col">{{ t('suprimentos.notas.numero') }}</th>
            <th scope="col">{{ t('suprimentos.quantidade') }}</th>
            <th scope="col">{{ t('suprimentos.cotacao.unitario') }}</th>
            <th scope="col">{{ t('suprimentos.historico.custo') }}</th>
            <th scope="col">{{ t('suprimentos.cotacao.marca') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(c, k) in h.data.value.compras" :key="k">
            <td>{{ data(c.data) }}</td>
            <td>{{ c.fornecedorNome }}</td>
            <td>{{ c.nota }}</td>
            <td>{{ qtd(c.quantidade) }}</td>
            <td>{{ reais(c.unitario) }}</td>
            <td>{{ reais(c.custo) }}</td>
            <td>{{ c.marca }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="h.data.value.compras.length === 0">{{ t('suprimentos.nenhum') }}</p>
      <p v-if="h.data.value.cortada" role="status">{{ t('suprimentos.cortada') }}</p>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
