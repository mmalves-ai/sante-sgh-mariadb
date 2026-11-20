<script setup lang="ts">
// Fila de trabalho do faturamento e da auditoria (ficha do M30, seção 7): `/inicio/faturamento`. As contas por situação
// e por prazo desde a alta (agregadas no banco, no escopo de convênios da sessão), as contas com pendência, em auditoria
// e os lançamentos após o fechamento sem decisão.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { lerWorklist } from '../api-faturamento.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import { reais } from '../usar-faturamento.js';

const { t } = useI18n();
const q = useQuery({ queryKey: ['faturamento', 'worklist'], queryFn: () => lerWorklist() });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="wl-titulo" data-testid="tela-faturamento-worklist">
    <h1 id="wl-titulo">{{ t('faturamento.worklist.titulo') }}</h1>
    <ErroFaturamento v-if="q.error.value" :erro="q.error.value" />
    <p v-else-if="!q.data.value" role="status">{{ t('faturamento.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="wl-situacao">
        <caption>
          {{
            t('faturamento.worklist.porSituacao')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('faturamento.situacao') }}</th>
            <th scope="col">{{ t('faturamento.contas.titulo') }}</th>
            <th scope="col">{{ t('faturamento.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in q.data.value.porSituacao" :key="s.situacao">
            <td>
              <RouterLink :to="`/faturamento/contas?situacao=${s.situacao}`">{{ s.rotulo }}</RouterLink>
            </td>
            <td>{{ s.contas }}</td>
            <td>{{ reais(s.valor) }}</td>
          </tr>
        </tbody>
      </table>
      <table class="tabela" data-testid="wl-prazo">
        <caption>
          {{
            t('faturamento.worklist.porPrazo')
          }}
        </caption>
        <tbody>
          <tr v-for="p in q.data.value.porPrazo" :key="p.faixa">
            <td>{{ p.faixa }}</td>
            <td>{{ p.contas }}</td>
          </tr>
        </tbody>
      </table>
      <ul>
        <li>{{ t('faturamento.worklist.comPendencia') }}: {{ q.data.value.comPendencia }}</li>
        <li>{{ t('faturamento.worklist.emAuditoria') }}: {{ q.data.value.emAuditoria }}</li>
        <li>
          <RouterLink to="/faturamento/lancamento-automatico">{{
            t('faturamento.worklist.tardios')
          }}</RouterLink
          >: {{ q.data.value.tardiosPendentes }}
        </li>
      </ul>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
