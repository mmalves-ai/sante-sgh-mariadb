<script setup lang="ts">
// Demonstrativo do beneficiário (ficha do M33, seção 7): `/repasse/apuracao/:apuracao/:beneficiario`. A memória de
// cálculo de cada item (a regra aplicada e as dimensões que a fixaram, a base, o percentual ou o valor fixo e a conta
// escrita), as pendências e o total; o PDF/A pelo conversor do servidor.
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { lerDemonstrativo, urlDemonstrativoPdf } from '../api-repasse.js';
import { reais } from '../usar-repasse.js';

const props = defineProps<{ apuracao: string; beneficiario: string }>();
const { t } = useI18n();
const d = useQuery({
  queryKey: computed(() => ['repasse', 'demonstrativo', props.apuracao, props.beneficiario]),
  queryFn: () => lerDemonstrativo(Number(props.apuracao), Number(props.beneficiario)),
});
const pdf = computed(() => urlDemonstrativoPdf(Number(props.apuracao), Number(props.beneficiario)));
</script>

<template>
  <section class="tela-agenda tela-repasse" aria-labelledby="dm-titulo" data-testid="tela-rep-demonstrativo">
    <h1 id="dm-titulo">{{ t('repasse.apuracao.demonstrativo') }}</h1>
    <p>
      <RouterLink to="/repasse/apuracao">{{ t('repasse.apuracao.titulo') }}</RouterLink>
    </p>
    <ErroFaturamento v-if="d.error.value" :erro="d.error.value" />
    <template v-if="d.data.value">
      <p data-testid="dm-cabecalho">
        {{ t('repasse.competencia') }} {{ d.data.value.competencia }} · {{ t('repasse.prestador') }}
        {{ d.data.value.prestador }} · {{ t(`repasse.apuracao.estado.${d.data.value.estado}`) }}
      </p>
      <table class="tabela" data-testid="dm-itens">
        <thead>
          <tr>
            <th scope="col">{{ t('repasse.item') }}</th>
            <th scope="col">{{ t('repasse.simulador.regraAplicada') }}</th>
            <th scope="col">{{ t('repasse.apuracao.memoria') }}</th>
            <th scope="col">{{ t('repasse.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in d.data.value.itens" :key="i.item">
            <td>{{ i.item }}</td>
            <td>
              {{ i.regra ?? '—'
              }}<span v-if="i.dimensoes.length" class="secundario"> ({{ i.dimensoes.join(', ') }})</span>
            </td>
            <td>{{ i.pendencia ? t(`repasse.apuracao.pendencia.${i.pendencia}`) : i.conta }}</td>
            <td>{{ reais(i.valor) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3">
              {{ t('repasse.total') }} ({{ t('repasse.apuracao.baseTotal') }} {{ reais(d.data.value.base) }})
            </td>
            <td data-testid="dm-total">{{ reais(d.data.value.valor) }}</td>
          </tr>
        </tfoot>
      </table>
      <p>
        <a :href="pdf" data-testid="dm-pdf">{{ t('repasse.baixarPdf') }}</a>
      </p>
    </template>
  </section>
</template>

<style src="../estilo-repasse.css"></style>
