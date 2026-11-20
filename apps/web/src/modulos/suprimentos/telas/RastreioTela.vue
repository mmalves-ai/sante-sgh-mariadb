<script setup lang="ts">
// Rastreio de lote (ficha do M28, seção 7): `/suprimentos/lotes/rastreio`. Permissão sensível e leitura auditada (lista
// pacientes): do lote aos documentos (entrada, saídas, devoluções, transferências, balanço) até o setor ou o paciente;
// e do atendimento aos lotes que o paciente recebeu.
import { SanteBotao } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import type { LotesDoPaciente, RastreioLote } from '@sgh/contratos';
import { lotesDoPaciente, rastrearLote } from '../api-suprimentos.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { chaveDoc, data, qtd, usarSuprimentos } from '../usar-suprimentos.js';

const { t } = useI18n();
const rota = useRoute();
const { nomeLocal } = usarSuprimentos();
const item = ref(String(rota.query['item'] ?? ''));
const lote = ref(String(rota.query['lote'] ?? ''));
const atendimento = ref('');
const rastreio = ref<RastreioLote | null>(null);
const doPaciente = ref<LotesDoPaciente | null>(null);
const erro = ref<unknown>(null);
async function rastrear(): Promise<void> {
  erro.value = null;
  rastreio.value = null;
  try {
    rastreio.value = await rastrearLote(Number(item.value), lote.value.trim());
  } catch (x) {
    erro.value = x;
  }
}
async function porPaciente(): Promise<void> {
  erro.value = null;
  doPaciente.value = null;
  try {
    doPaciente.value = await lotesDoPaciente(Number(atendimento.value));
  } catch (x) {
    erro.value = x;
  }
}
if (item.value && lote.value) void rastrear();
const TIPO: Record<string, string> = {
  entrada: 'Entrada (nota)',
  saida: 'Saída',
  devolucao: 'Devolução',
  transferencia: 'Transferência',
  balanco: 'Balanço',
  inicial: 'Estoque inicial',
};
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ras-titulo" data-testid="tela-suprimentos-rastreio">
    <h1 id="ras-titulo">{{ t('suprimentos.rastreio.titulo') }}</h1>
    <p>{{ t('suprimentos.rastreio.texto') }}</p>
    <p>
      <RouterLink :to="{ name: 'suprimentos.opme.rastreio' }" data-testid="ras-opme">{{
        t('suprimentos.rastreio.opme')
      }}</RouterLink>
    </p>
    <form class="filtros" @submit.prevent="rastrear">
      <span class="campo">
        <label for="ras-item">{{ t('suprimentos.rastreio.codigoItem') }}</label>
        <input id="ras-item" v-model="item" inputmode="numeric" data-testid="ras-item" />
      </span>
      <span class="campo">
        <label for="ras-lote">{{ t('suprimentos.lote') }}</label>
        <input id="ras-lote" v-model="lote" data-testid="ras-lote" />
      </span>
      <SanteBotao
        tipo="submit"
        :rotulo="t('suprimentos.rastreio.rastrear')"
        :desabilitado="!item || !lote"
        data-testid="ras-rastrear"
      />
    </form>
    <form class="filtros" @submit.prevent="porPaciente">
      <span class="campo">
        <label for="ras-at">{{ t('suprimentos.atendimento') }}</label>
        <input id="ras-at" v-model="atendimento" inputmode="numeric" data-testid="ras-atendimento" />
      </span>
      <SanteBotao
        tipo="submit"
        variante="secundario"
        :rotulo="t('suprimentos.rastreio.doPaciente')"
        :desabilitado="!atendimento"
      />
    </form>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <div v-if="rastreio" class="painel" data-testid="ras-resultado">
      <h2>
        {{ rastreio.item }} · {{ rastreio.nome }} · {{ t('suprimentos.lote') }} {{ rastreio.lote }} ·
        {{ data(rastreio.validade) }}
      </h2>
      <p>
        {{ t('suprimentos.rastreio.saldos') }}
        {{ rastreio.saldos.map((s) => `${s.localNome}: ${qtd(s.quantidade)}`).join('; ') || '—' }}
      </p>
      <p class="secundario">{{ t('suprimentos.rastreio.pacientes', { n: rastreio.pacientes }) }}</p>
      <table class="tabela">
        <caption>
          {{
            t('suprimentos.rastreio.movimentos')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.data') }}</th>
            <th scope="col">{{ t('suprimentos.rastreio.tipo') }}</th>
            <th scope="col">{{ t('suprimentos.documento') }}</th>
            <th scope="col">{{ t('suprimentos.quantidade') }}</th>
            <th scope="col">{{ t('suprimentos.local') }}</th>
            <th scope="col">{{ t('suprimentos.destino') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(m, k) in rastreio.movimentos" :key="k">
            <td>{{ data(m.data) }}</td>
            <td>{{ TIPO[m.tipo] ?? m.tipo }}</td>
            <td>{{ chaveDoc(m.chave) }}</td>
            <td>{{ qtd(m.quantidade) }}</td>
            <td>{{ nomeLocal(m.local) }}</td>
            <td>
              <template v-if="m.paciente">{{ m.paciente.nome }} ({{ m.paciente.atendimento }})</template>
              <template v-else-if="m.fornecedor">{{ m.fornecedor }}</template>
              <template v-else-if="m.centroCusto"
                >{{ t('suprimentos.centroCusto') }} {{ m.centroCusto }}</template
              >
              <template v-else-if="m.destino">{{ nomeLocal(m.destino) }}</template>
              <template v-else>—</template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="rastreio.cortada" role="status">{{ t('suprimentos.cortada') }}</p>
    </div>
    <div v-if="doPaciente" class="painel" data-testid="ras-paciente">
      <h2>{{ t('suprimentos.rastreio.lotesDoAtendimento', { n: doPaciente.atendimento }) }}</h2>
      <ul>
        <li v-for="(x, k) in doPaciente.itens" :key="k">
          {{ data(x.data) }} · {{ x.item }} · {{ x.nome }} · {{ t('suprimentos.lote') }} {{ x.lote }} ({{
            data(x.validade)
          }}) · {{ qtd(x.quantidade) }} · {{ chaveDoc(x.chave) }}
        </li>
      </ul>
      <p v-if="doPaciente.itens.length === 0">{{ t('suprimentos.nenhum') }}</p>
    </div>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
