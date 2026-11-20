<script setup lang="ts">
// A consulta das tabelas de apoio da contratualização (os 11 domínios lidos onde estão, inteiros, sem teto: ficha §6).
// Elas recusam gravação no banco (D-DOM-555), por isso a tela só mostra; os rótulos são os do produto e o nome de cada
// tabela vem do texto da tela (nunca o nome técnico).
import { useI18n } from 'vue-i18n';
import type { ItemDominioSusTela } from '../api-contratualizacao.js';

defineProps<{ dominios: Readonly<Record<string, readonly ItemDominioSusTela[]>> }>();
const { t, te } = useI18n();
const k = (s: string) => t(`contratualizacaoSus.dominios.${s}`);
const nome = (tabela: string) =>
  te(`contratualizacaoSus.dominios.nomes.${tabela}`) ? k(`nomes.${tabela}`) : k('outra');
</script>

<template>
  <section class="dominios-sus" aria-labelledby="ds-titulo" data-testid="ds-dominios">
    <h2 id="ds-titulo">{{ k('titulo') }}</h2>
    <p class="secundario">{{ k('explica') }}</p>
    <section
      v-for="(itens, tabela) in dominios"
      :key="tabela"
      :aria-labelledby="`ds-${tabela}`"
      :data-testid="`ds-${tabela}`"
    >
      <h3 :id="`ds-${tabela}`">{{ nome(String(tabela)) }}</h3>
      <p v-if="!itens.length">{{ k('vazio') }}</p>
      <table v-else class="grade">
        <thead>
          <tr>
            <th scope="col">{{ k('colCodigo') }}</th>
            <th scope="col">{{ k('colRotulo') }}</th>
            <th scope="col">{{ k('colSigla') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in itens" :key="x.codigo">
            <td>{{ x.codigo }}</td>
            <td>{{ x.rotulo }}</td>
            <td>{{ x.sigla ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>
