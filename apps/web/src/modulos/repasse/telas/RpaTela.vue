<script setup lang="ts">
// RPA e eventos (ficha do M33, seção 7): `/repasse/rpa`. Os lançamentos do médico ainda sem RPA na competência, a prévia
// com as retenções e a conta escrita (líquido = bruto − INSS − IRRF − ISS; as tabelas vêm das configurações, nunca da
// tela), a emissão (operação crítica: pede a senha de novo; o título a pagar nasce no financeiro, na mesma transação), os
// RPAs da competência e o PDF/A de cada RPA emitido (relido do banco). O médico é escolhido pela busca (nome e
// conselho). Empresa médica e cooperativa recebem demonstrativo, não RPA. Os eventos de RPA e a natureza eSocial são o
// CRUD genérico.
import type { PreviaRpaResposta } from '@sgh/contratos';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import MinhaCompetenciaTrabalho from '../../tiss/componentes/MinhaCompetenciaTrabalho.vue';
import BuscaPrestador from '../componentes/BuscaPrestador.vue';
import { emitirRpa, lerLancamentos, lerRpas, novaChave, previaRpa, urlRpaPdf } from '../api-repasse.js';
import { data, reais, usarRepasse } from '../usar-repasse.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivo } = usarRepasse();
const hoje = computed(() => apoio.data.value?.hoje ?? '');
const form = reactive({ competencia: '', prestador: '', profissional: '', vencimento: '' });
watch(
  hoje,
  (h) => {
    if (!h) return;
    if (!form.competencia) form.competencia = h.slice(0, 7);
    if (!form.vencimento) form.vencimento = h;
  },
  { immediate: true },
);
// A competência de trabalho do faturista no módulo RPA é o padrão do filtro (sem ela, o mês corrente); o mês que o
// usuário trocou à mão não é sobrescrito.
const padraoTrabalho = ref('');
function aoEscolherTrabalho(c: string) {
  if (!form.competencia || form.competencia === (padraoTrabalho.value || hoje.value.slice(0, 7)))
    form.competencia = c;
  padraoTrabalho.value = c;
}
const consulta = reactive({ competencia: '', prestador: 0 });
const lancamentos = useQuery({
  queryKey: computed(() => ['repasse', 'rpa-lancamentos', consulta.competencia, consulta.prestador]),
  queryFn: () => lerLancamentos(consulta.competencia, consulta.prestador),
  enabled: computed(() => consulta.prestador > 0),
});
const rpas = useQuery({
  queryKey: computed(() => ['repasse', 'rpas', form.competencia]),
  queryFn: () => lerRpas(form.competencia),
  enabled: computed(() => form.competencia !== ''),
});
const escolhidos = ref<number[]>([]);
const livres = computed(() => (lancamentos.data.value ?? []).filter((l) => l.emRpa === null && l.valor > 0));
function consultar() {
  consulta.competencia = form.competencia;
  consulta.prestador = Number(form.prestador) || 0;
  escolhidos.value = [];
  previa.value = null;
}
const pedido = () => ({
  empresa: 1,
  competencia: form.competencia,
  tipo: 'M',
  prestador: Number(form.prestador),
  profissional: Number(form.profissional) || null,
  lancamentos: escolhidos.value,
  emissao: hoje.value,
  vencimento: form.vencimento,
});
const previa = ref<PreviaRpaResposta | null>(null);
const senha = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function calcular() {
  erro.value = null;
  try {
    previa.value = await previaRpa(pedido(), novaChave('previa'));
  } catch (e) {
    erro.value = e;
  }
}
async function emitir() {
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = (await emitirRpa({ ...pedido(), senha: senha.value }, novaChave('emitir'))).mensagem;
    senha.value = '';
    previa.value = null;
    escolhidos.value = [];
    await qc.invalidateQueries({ queryKey: ['repasse'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda tela-repasse" aria-labelledby="rp-titulo" data-testid="tela-rep-rpa">
    <h1 id="rp-titulo">{{ t('repasse.rpa.titulo') }}</h1>
    <p>
      <RouterLink to="/cadastros/dominios/grupo/repasseRpa" data-testid="rp-eventos">{{
        t('repasse.rpa.eventos')
      }}</RouterLink>
    </p>
    <p v-if="apoio.data.value && !apoio.data.value.rpaConfigurado" role="note" data-testid="rp-sem-tabela">
      {{ t('repasse.rpa.tabelaAusente', { imposto: 'INSS, IRRF ou ISS' }) }}
    </p>
    <p class="secundario">{{ t('repasse.rpa.empresaRecebeDemonstrativo') }}</p>
    <MinhaCompetenciaTrabalho modulo="rpa" :hoje="hoje" @escolhida="aoEscolherTrabalho" />
    <div class="filtros acoes">
      <span class="campo">
        <label for="rp-comp">{{ t('repasse.competencia') }}</label>
        <input id="rp-comp" v-model="form.competencia" type="month" data-testid="rp-competencia" />
      </span>
      <BuscaPrestador
        v-model="form.prestador"
        v-model:registro="form.profissional"
        :rotulo="t('repasse.prestador')"
        testid="rp-prestador"
      />
      <span class="campo">
        <label for="rp-venc">{{ t('repasse.rpa.vencimento') }}</label>
        <input id="rp-venc" v-model="form.vencimento" type="date" required data-testid="rp-vencimento" />
      </span>
      <button type="button" :disabled="!form.prestador" data-testid="rp-consultar" @click="consultar">
        {{ t('repasse.consultar') }}
      </button>
    </div>
    <ErroFaturamento v-if="lancamentos.error.value" :erro="lancamentos.error.value" />
    <fieldset v-if="consulta.prestador" data-testid="rp-livres">
      <legend>{{ t('repasse.lancamentos.semRpa') }}</legend>
      <p v-if="!livres.length">{{ t('repasse.nenhum') }}</p>
      <label v-for="l in livres" :key="l.id" class="opcao">
        <input v-model="escolhidos" type="checkbox" :value="l.id" :data-testid="`rp-lanc-${l.id}`" />
        {{ l.id }} · {{ data(l.data) }} · {{ l.eventoRotulo }} · {{ reais(l.valor) }}
      </label>
    </fieldset>
    <div class="acoes">
      <button type="button" :disabled="!escolhidos.length" data-testid="rp-calcular" @click="calcular">
        {{ t('repasse.rpa.calcular') }}
      </button>
    </div>
    <dl v-if="previa" class="totais" data-testid="rp-previa">
      <div>
        <dt>{{ t('repasse.rpa.bruto') }}</dt>
        <dd>{{ reais(previa.retencoes.bruto) }}</dd>
      </div>
      <div>
        <dt>{{ t('repasse.rpa.inss') }}</dt>
        <dd>{{ reais(previa.retencoes.inss) }}</dd>
      </div>
      <div>
        <dt>{{ t('repasse.rpa.irrf') }}</dt>
        <dd>{{ reais(previa.retencoes.irrf) }}</dd>
      </div>
      <div>
        <dt>{{ t('repasse.rpa.iss') }}</dt>
        <dd>{{ reais(previa.retencoes.iss) }}</dd>
      </div>
      <div>
        <dt>{{ t('repasse.rpa.liquido') }}</dt>
        <dd>{{ reais(previa.retencoes.liquido) }}</dd>
      </div>
    </dl>
    <p v-if="previa" data-testid="rp-conta">{{ previa.retencoes.conta }}</p>
    <p v-if="previa?.origemFiscal" data-testid="rp-origem-fiscal">
      {{
        previa.origemFiscal === 'dado-fiscal'
          ? t('repasse.rpa.origemDadoFiscal')
          : t('repasse.rpa.origemRegraGeral')
      }}
    </p>
    <p
      v-if="previa && previa.documento === 'rpa' && previa.destinoPagamento !== undefined"
      data-testid="rp-destino"
    >
      {{
        previa.destinoPagamento
          ? t('repasse.rpa.destinoPagamento', { destino: previa.destinoPagamento })
          : t('repasse.rpa.semContaPrincipal')
      }}
    </p>
    <span v-if="previa" class="campo">
      <label for="rp-senha">{{ t('repasse.rpa.senha') }}</label>
      <input
        id="rp-senha"
        v-model="senha"
        type="password"
        autocomplete="current-password"
        data-testid="rp-senha"
      />
      <small>{{ t('repasse.rpa.senhaAjuda') }}</small>
    </span>
    <button
      v-if="previa"
      type="button"
      :disabled="!pode('repasse.emitirRpa', 'repasse.rpa.emitir') || !senha"
      :title="motivo('repasse.emitirRpa') ?? undefined"
      data-testid="rp-emitir"
      @click="emitir"
    >
      {{ t('repasse.rpa.emitir') }}
    </button>
    <p
      v-if="previa && !pode('repasse.emitirRpa', 'repasse.rpa.emitir') && motivo('repasse.emitirRpa')"
      role="note"
    >
      {{ motivo('repasse.emitirRpa') }}
    </p>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="rp-mensagem" />

    <h2>{{ t('repasse.rpa.emitidos') }}</h2>
    <table v-if="rpas.data.value?.length" class="tabela" data-testid="rp-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('repasse.rpa.numero') }}</th>
          <th scope="col">{{ t('repasse.prestador') }}</th>
          <th scope="col">{{ t('repasse.rpa.emissao') }}</th>
          <th scope="col">{{ t('repasse.lancamentos.titulo') }}</th>
          <th scope="col">{{ t('repasse.rpa.documento') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rpas.data.value" :key="r.id">
          <td>{{ r.serie }} {{ r.numero }}</td>
          <td>{{ r.prestador }}</td>
          <td>{{ data(r.emissao) }}</td>
          <td>{{ r.lancamentos }}</td>
          <td>
            <a :href="urlRpaPdf(r.id)" :data-testid="`rp-pdf-${r.id}`" download>{{
              t('repasse.rpa.baixarPdf')
            }}</a>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('repasse.nenhum') }}</p>
  </section>
</template>

<style src="../estilo-repasse.css"></style>
