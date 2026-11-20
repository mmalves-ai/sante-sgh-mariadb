<script setup lang="ts">
// Extrato de produção e repasse do médico externo (ficha do M50, seção 7; regra 6): `/medico-externo/extrato`, no portal
// (fora da casca interna). O servidor resolve o profissional pelo vínculo da conta e devolve só os lançamentos, os
// recibos e a conta de cada valor dos códigos dele (o mesmo extrato do médico interno, M33). Sem o vínculo, o aviso.
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { contaPortalMedico, extratoPortalMedico } from '../api-portal-medico.js';
import ErroPortalMedico from '../componentes/ErroPortalMedico.vue';
import PortalMedicoCasca from '../componentes/PortalMedicoCasca.vue';

const { t } = useI18n();
const competencia = ref('');
const consultada = ref('');
const pronto = ref(false);
const e = useQuery({
  queryKey: computed(() => ['portal-medico', 'extrato', consultada.value]),
  queryFn: () => extratoPortalMedico(consultada.value || null),
  enabled: pronto,
});
const conta = useQuery({
  queryKey: computed(() => ['portal-medico', 'extrato-conta', consultada.value]),
  queryFn: () => contaPortalMedico(consultada.value),
  enabled: computed(() => pronto.value && consultada.value !== '' && !!e.data.value?.vinculado),
});
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const data = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
</script>

<template>
  <PortalMedicoCasca :titulo="t('portalMedico.extrato.titulo')" @sessao="pronto = true">
    <template #default>
      <form class="filtros" @submit.prevent="consultada = competencia">
        <span class="campo">
          <label for="pm-comp">{{ t('portalMedico.extrato.competencia') }}</label>
          <input id="pm-comp" v-model="competencia" type="month" data-testid="pm-competencia" />
        </span>
        <button type="submit" data-testid="pm-consultar">{{ t('portalMedico.extrato.consultar') }}</button>
        <button v-if="consultada" type="button" data-testid="pm-ultimos" @click="consultada = ''">
          {{ t('portalMedico.extrato.ultimos') }}
        </button>
      </form>
      <ErroPortalMedico v-if="e.error.value" :erro="e.error.value" />
      <p v-else-if="!e.data.value" role="status">{{ t('portalMedico.carregando') }}</p>
      <p v-else-if="!e.data.value.vinculado" role="note" data-testid="pm-sem-vinculo">
        {{ t('portalMedico.semVinculo') }}
      </p>
      <template v-else-if="e.data.value.extrato">
        <p class="secundario" data-testid="pm-profissional">
          {{ t('portalMedico.profissional', { nome: e.data.value.profissional }) }}
        </p>
        <p v-if="e.data.value.retidos" role="note" data-testid="pm-retidos">
          {{ t('portalMedico.extrato.retidos') }}
        </p>
        <p data-testid="pm-total">
          {{ t('portalMedico.extrato.repassado') }}: <strong>{{ reais(e.data.value.extrato.total) }}</strong>
          <span v-if="e.data.value.extrato.adiantamentos">
            · {{ t('portalMedico.extrato.adiantamentos') }}:
            {{ reais(e.data.value.extrato.adiantamentos) }}</span
          >
        </p>
        <h2>{{ t('portalMedico.extrato.lancamentos') }}</h2>
        <table v-if="e.data.value.extrato.lancamentos.length" class="tabela" data-testid="pm-lancamentos">
          <thead>
            <tr>
              <th scope="col">{{ t('portalMedico.extrato.data') }}</th>
              <th scope="col">{{ t('portalMedico.extrato.evento') }}</th>
              <th scope="col">{{ t('portalMedico.extrato.valor') }}</th>
              <th scope="col">{{ t('portalMedico.extrato.rpa') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in e.data.value.extrato.lancamentos" :key="l.id">
              <td>{{ data(l.data) }}</td>
              <td>
                {{ l.eventoRotulo
                }}<span v-if="l.estornaDe" class="secundario">
                  ({{ t('portalMedico.extrato.estornoDe', { id: l.estornaDe }) }})</span
                >
              </td>
              <td>{{ reais(l.valor) }}</td>
              <td>{{ l.emRpa ?? t('portalMedico.extrato.semRpa') }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else>{{ t('portalMedico.nenhum') }}</p>
        <h2>{{ t('portalMedico.extrato.recibos') }}</h2>
        <table v-if="e.data.value.extrato.rpas.length" class="tabela" data-testid="pm-rpas">
          <thead>
            <tr>
              <th scope="col">{{ t('portalMedico.extrato.numero') }}</th>
              <th scope="col">{{ t('portalMedico.extrato.emissao') }}</th>
              <th scope="col">{{ t('portalMedico.extrato.bruto') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in e.data.value.extrato.rpas" :key="r.id">
              <td>{{ r.serie }} {{ r.numero }}</td>
              <td>{{ data(r.emissao) }}</td>
              <td>{{ reais(r.valor) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else>{{ t('portalMedico.nenhum') }}</p>
        <template v-if="consultada">
          <h2>{{ t('portalMedico.extrato.conta') }}</h2>
          <ErroPortalMedico v-if="conta.error.value" :erro="conta.error.value" />
          <template v-else-if="conta.data.value?.demonstrativos.length">
            <section
              v-for="d in conta.data.value.demonstrativos"
              :key="`${d.apuracao}-${d.prestador}`"
              :aria-label="t('portalMedico.extrato.contaDe', { competencia: d.competencia })"
              data-testid="pm-conta"
            >
              <p class="secundario">
                {{ t('portalMedico.extrato.contaDe', { competencia: d.competencia }) }}
              </p>
              <table class="tabela">
                <thead>
                  <tr>
                    <th scope="col">{{ t('portalMedico.extrato.item') }}</th>
                    <th scope="col">{{ t('portalMedico.extrato.regra') }}</th>
                    <th scope="col">{{ t('portalMedico.extrato.memoria') }}</th>
                    <th scope="col">{{ t('portalMedico.extrato.valor') }}</th>
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
                    <td colspan="3">{{ t('portalMedico.extrato.total', { base: reais(d.base) }) }}</td>
                    <td>{{ reais(d.valor) }}</td>
                  </tr>
                </tfoot>
              </table>
            </section>
          </template>
          <p v-else-if="conta.data.value" data-testid="pm-conta-vazia">
            {{ t('portalMedico.extrato.semApuracao') }}
          </p>
        </template>
      </template>
    </template>
  </PortalMedicoCasca>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
