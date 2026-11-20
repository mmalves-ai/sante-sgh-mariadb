<script setup lang="ts">
// Tabela dos registros guardados pelo novo (remessas, NFS-e, declarações e lotes contábeis): as colunas que a tela
// escolhe, com o rótulo do i18n e o formato (dinheiro, data e hora ou texto).
import type { RegistroFiscalResposta } from '@sgh/contratos';
import { useI18n } from 'vue-i18n';
import { quando, reais } from '../usar-financeiro.js';

defineProps<{
  registros: readonly RegistroFiscalResposta[];
  colunas: readonly { chave: string; rotulo: string; formato?: 'reais' | 'quando' }[];
  testid: string;
}>();
const { t } = useI18n();
const mostrar = (v: string | number | null | undefined, f?: 'reais' | 'quando') =>
  v === null || v === undefined || v === ''
    ? '—'
    : f === 'reais'
      ? reais(Number(v))
      : f === 'quando'
        ? quando(String(v))
        : String(v);
</script>

<template>
  <table v-if="registros.length" class="tabela" :data-testid="testid">
    <thead>
      <tr>
        <th v-for="c in colunas" :key="c.chave" scope="col">{{ t(c.rotulo) }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(r, i) in registros" :key="String(r['ID'] ?? i)">
        <td v-for="c in colunas" :key="c.chave">{{ mostrar(r[c.chave], c.formato) }}</td>
      </tr>
    </tbody>
  </table>
  <p v-else>{{ t('financeiro.nenhum') }}</p>
</template>
