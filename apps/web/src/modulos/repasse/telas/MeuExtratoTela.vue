<script setup lang="ts">
// Extrato do médico (ficha do M33, seção 7; regra 12): `/repasse/meu-extrato`. Só o próprio: o servidor resolve o
// vínculo do usuário com o cadastro de profissional e devolve só os lançamentos e os RPAs desses códigos; sem vínculo,
// a lista vem vazia com o aviso. Os adiantamentos ao médico aparecem só em consulta (regra 11). A competência filtra o
// extrato, e "A conta de cada valor" mostra a regra e a conta de cada item da apuração da competência, só dos itens do
// próprio médico (o objetivo da ficha: o médico vê a regra e a conta de cada valor).
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { lerContaDoMedico, lerExtrato } from '../api-repasse.js';
import { data, reais, usarRepasse } from '../usar-repasse.js';

const { t } = useI18n();
const { apoio } = usarRepasse();
const competencia = ref('');
const consultada = ref('');
watch(
  () => apoio.data.value?.hoje,
  (h) => {
    if (h && !competencia.value) competencia.value = h.slice(0, 7);
  },
  { immediate: true },
);
const e = useQuery({
  queryKey: computed(() => ['repasse', 'extrato', consultada.value]),
  queryFn: () => lerExtrato(consultada.value || undefined),
});
const conta = useQuery({
  queryKey: computed(() => ['repasse', 'extrato-conta', consultada.value || competencia.value]),
  queryFn: () => lerContaDoMedico(consultada.value || competencia.value),
  enabled: computed(
    () => (consultada.value || competencia.value) !== '' && !!e.data.value?.prestadores.length,
  ),
});
</script>

<template>
  <section class="tela-agenda tela-repasse" aria-labelledby="ex-titulo" data-testid="tela-rep-extrato">
    <h1 id="ex-titulo">{{ t('repasse.extrato.titulo') }}</h1>
    <form class="filtros" @submit.prevent="consultada = competencia">
      <span class="campo">
        <label for="ex-comp">{{ t('repasse.competencia') }}</label>
        <input id="ex-comp" v-model="competencia" type="month" data-testid="ex-competencia" />
      </span>
      <button type="submit" data-testid="ex-consultar">{{ t('repasse.consultar') }}</button>
      <button v-if="consultada" type="button" data-testid="ex-ultimos" @click="consultada = ''">
        {{ t('repasse.extrato.ultimos') }}
      </button>
    </form>
    <ErroFaturamento v-if="e.error.value" :erro="e.error.value" />
    <template v-if="e.data.value">
      <p v-if="!e.data.value.prestadores.length" role="note" data-testid="ex-sem-vinculo">
        {{ t('repasse.extrato.semVinculo') }}
      </p>
      <template v-else>
        <p data-testid="ex-total">
          {{ t('repasse.extrato.repassado') }}: <strong>{{ reais(e.data.value.total) }}</strong>
          <span v-if="e.data.value.adiantamentos">
            · {{ t('repasse.extrato.adiantamentos') }}: {{ reais(e.data.value.adiantamentos) }}</span
          >
        </p>
        <table class="tabela" data-testid="ex-lancamentos">
          <thead>
            <tr>
              <th scope="col">{{ t('repasse.data') }}</th>
              <th scope="col">{{ t('repasse.evento') }}</th>
              <th scope="col">{{ t('repasse.valor') }}</th>
              <th scope="col">{{ t('repasse.lancamentos.emRpa') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in e.data.value.lancamentos" :key="l.id">
              <td>{{ data(l.data) }}</td>
              <td>
                {{ l.eventoRotulo
                }}<span v-if="l.estornaDe" class="secundario">
                  ({{ t('repasse.lancamentos.estornoDe', { id: l.estornaDe }) }})</span
                >
              </td>
              <td>{{ reais(l.valor) }}</td>
              <td>{{ l.emRpa ?? t('repasse.lancamentos.semRpa') }}</td>
            </tr>
          </tbody>
        </table>
        <h2>{{ t('repasse.rpa.titulo') }}</h2>
        <table v-if="e.data.value.rpas.length" class="tabela" data-testid="ex-rpas">
          <thead>
            <tr>
              <th scope="col">{{ t('repasse.rpa.numero') }}</th>
              <th scope="col">{{ t('repasse.rpa.emissao') }}</th>
              <th scope="col">{{ t('repasse.rpa.bruto') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in e.data.value.rpas" :key="r.id">
              <td>{{ r.serie }} {{ r.numero }}</td>
              <td>{{ data(r.emissao) }}</td>
              <td>{{ reais(r.valor) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else>{{ t('repasse.nenhum') }}</p>

        <h2>{{ t('repasse.extrato.conta') }}</h2>
        <ErroFaturamento v-if="conta.error.value" :erro="conta.error.value" />
        <template v-else-if="conta.data.value?.demonstrativos.length">
          <section
            v-for="d in conta.data.value.demonstrativos"
            :key="`${d.apuracao}-${d.prestador}`"
            :aria-label="t('repasse.extrato.contaDe', { competencia: d.competencia })"
            data-testid="ex-conta"
          >
            <p class="secundario">
              {{ t('repasse.extrato.contaDe', { competencia: d.competencia }) }} ·
              {{ t(`repasse.apuracao.estado.${d.estado}`) }}
            </p>
            <table class="tabela">
              <thead>
                <tr>
                  <th scope="col">{{ t('repasse.item') }}</th>
                  <th scope="col">{{ t('repasse.simulador.regraAplicada') }}</th>
                  <th scope="col">{{ t('repasse.apuracao.memoria') }}</th>
                  <th scope="col">{{ t('repasse.valor') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="i in d.itens" :key="i.item">
                  <td>{{ i.item }}</td>
                  <td>{{ i.regra ?? '—' }}</td>
                  <td>{{ i.conta }}</td>
                  <td>{{ reais(i.valor) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="3">{{ t('repasse.extrato.totalDaConta', { base: reais(d.base) }) }}</td>
                  <td>{{ reais(d.valor) }}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        </template>
        <p v-else-if="conta.data.value" data-testid="ex-conta-vazia">
          {{ t('repasse.extrato.semApuracao') }}
        </p>
      </template>
    </template>
  </section>
</template>

<style src="../estilo-repasse.css"></style>
