<script setup lang="ts">
// Quadros de um envio à ANS (M56, etapa 7, F6): cada conta agregada com as parcelas impressas e o total (a soma nunca
// aparece sem as parcelas). Usado na prévia e na ficha.
import type { QuadroAns } from '@sgh/contratos';
import { useI18n } from 'vue-i18n';
import { reais } from '../f2/comum.js';

defineProps<{ quadros: readonly QuadroAns[]; prefixo: string }>();
const { t } = useI18n();
const qtd = (v: number | undefined) => (v === undefined ? '' : v.toLocaleString('pt-BR'));
/** Quadro só de contagens (beneficiários expostos, por exemplo): sem a coluna de valor. */
const soQuantidade = (q: QuadroAns) =>
  [...q.parcelas, q.total].every((p) => p.valor === 0 && p.quantidade !== undefined);
</script>

<template>
  <div class="quadros">
    <table v-for="(q, i) in quadros" :key="i" class="tabela" :data-testid="`${prefixo}-quadro-${i}`">
      <caption>
        {{
          q.titulo
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('operadoraAns.quadro.parcela') }}</th>
          <th scope="col" class="num">{{ t('operadoraAns.quadro.quantidade') }}</th>
          <th v-if="!soQuantidade(q)" scope="col" class="num">{{ t('operadoraAns.quadro.valor') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(p, j) in q.parcelas" :key="j">
          <td>{{ p.rotulo }}</td>
          <td class="num">{{ qtd(p.quantidade) }}</td>
          <td v-if="!soQuantidade(q)" class="num">{{ reais(p.valor) }}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">{{ q.total.rotulo || t('operadoraAns.quadro.total') }}</th>
          <td class="num">
            <strong>{{ qtd(q.total.quantidade) }}</strong>
          </td>
          <td v-if="!soQuantidade(q)" class="num">
            <strong>{{ reais(q.total.valor) }}</strong>
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<style scoped src="../../estilo-operadora.css"></style>
<style scoped>
.quadros {
  display: grid;
  gap: 1rem;
}
caption {
  text-align: left;
  font-weight: 600;
  padding-bottom: 0.25rem;
}
.num {
  text-align: right;
}
</style>
