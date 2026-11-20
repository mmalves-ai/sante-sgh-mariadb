<script setup lang="ts">
// A glosa do título a receber: a soma dos itens das contas do título (cobrado e pago dos baixados, glosado, pago a
// maior e a taxa, com as parcelas impressas), as glosas registradas no título e o saldo mostrado.
import type { DetalheTituloReceberResposta } from '@sgh/contratos';
import { useI18n } from 'vue-i18n';
import { num, quando, reais } from '../usar-financeiro.js';

defineProps<{ titulo: DetalheTituloReceberResposta }>();
const { t } = useI18n();
</script>

<template>
  <h2>{{ t('financeiro.receber.glosa') }}</h2>
  <dl class="resumo" data-testid="glosa-resumo">
    <dt>{{ t('financeiro.receber.itens') }}</dt>
    <dd>{{ titulo.glosa.itens }} ({{ titulo.glosa.baixados }} {{ t('financeiro.receber.baixados') }})</dd>
    <dt>{{ t('financeiro.receber.cobradoBaixado') }}</dt>
    <dd>{{ reais(titulo.glosa.cobradoBaixado) }}</dd>
    <dt>{{ t('financeiro.receber.pagoBaixado') }}</dt>
    <dd>{{ reais(titulo.glosa.pagoBaixado) }}</dd>
    <dt>{{ t('financeiro.receber.glosado') }}</dt>
    <dd data-testid="glosa-glosado">{{ reais(titulo.glosa.glosado) }}</dd>
    <dt>{{ t('financeiro.receber.pagoAMaior') }}</dt>
    <dd>{{ reais(titulo.glosa.pagoAMaior) }}</dd>
    <dt>{{ t('financeiro.receber.taxa') }}</dt>
    <dd>{{ num(titulo.glosa.taxa) }}%</dd>
    <dt>{{ t('financeiro.receber.saldo') }}</dt>
    <dd data-testid="glosa-saldo">
      {{
        t('financeiro.receber.contaSaldo', {
          saldo: reais(titulo.saldo),
          valor: reais(titulo.valor),
          recebido: reais(titulo.recebido),
          glosa: reais(titulo.glosaAceita),
        })
      }}
    </dd>
    <dt>{{ t('financeiro.receber.recebivelRecurso') }}</dt>
    <dd>{{ reais(titulo.recebivelRecurso) }}</dd>
  </dl>
  <h3>{{ t('financeiro.receber.glosas') }}</h3>
  <table v-if="titulo.glosas.length" class="tabela" data-testid="glosa-lista">
    <thead>
      <tr>
        <th scope="col">{{ t('financeiro.demonstrativos.item') }}</th>
        <th scope="col">{{ t('financeiro.situacao') }}</th>
        <th scope="col">{{ t('financeiro.valor') }}</th>
        <th scope="col">{{ t('financeiro.motivo') }}</th>
        <th scope="col">{{ t('financeiro.data') }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="g in titulo.glosas" :key="g.id">
        <td>{{ g.item ?? '—' }}</td>
        <td>{{ t(`financeiro.demonstrativos.situacoes.${g.situacao}`) }}</td>
        <td>{{ reais(g.valor) }}</td>
        <td>{{ g.motivo }}</td>
        <td>{{ quando(g.em) }}</td>
      </tr>
    </tbody>
  </table>
  <p v-else>{{ t('financeiro.nenhum') }}</p>
</template>
