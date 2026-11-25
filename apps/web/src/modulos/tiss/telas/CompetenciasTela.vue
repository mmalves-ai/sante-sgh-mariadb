<script setup lang="ts">
// Fechamento de competência por convênio (ficha do M31, seção 7): `/faturamento/competencias`. Os totais da competência
// (contas, em lote e valor) e o fechamento como o cadastro de origem grava; a competência fechada não recebe conta nova
// nas telas do novo; reabrir pede a permissão do cargo e o motivo (validado na hora: o botão só liga com 5 letras ou
// mais) e, com conta já em lote, a confirmação do impacto. A reaberta mostra quando, quem e o motivo.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import MinhaCompetenciaTrabalho from '../componentes/MinhaCompetenciaTrabalho.vue';
import {
  fecharCompetencia,
  listarCompetencias,
  novaChave,
  reabrirCompetencia,
  resumoCompetencia,
} from '../api-tiss.js';
import { competenciaAtual, opcoesConvenio, quando, reais, usarTiss } from '../usar-tiss.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivo, motivoFuncionalidade } = usarTiss('lote');
const convenio = ref('');
const competencia = ref('');
// A competência de trabalho do faturista é o padrão do filtro (sem ela, o mês corrente).
const padraoTrabalho = ref('');
function aoEscolherTrabalho(c: string) {
  if (!competencia.value || competencia.value === padraoTrabalho.value) competencia.value = c;
  padraoTrabalho.value = c;
}
const pedido = ref<{ convenio: string; competencia: string } | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
const motivoReabrir = ref('');
const convenios = computed(() => opcoesConvenio(apoio.data.value?.convenios));
const resumo = useQuery({
  queryKey: computed(() => ['tiss', 'competencia', pedido.value]),
  queryFn: () => resumoCompetencia(pedido.value!),
  enabled: computed(() => pedido.value !== null),
});
const confirmarImpacto = ref(false);
const comLote = computed(() => (resumo.data.value?.emLote ?? 0) > 0);
const motivoValido = computed(
  () => motivoReabrir.value.trim().length >= 5 && (!comLote.value || confirmarImpacto.value),
);
const lista = useQuery({ queryKey: ['tiss', 'competencias'], queryFn: () => listarCompetencias({}) });
function consultar() {
  if (!convenio.value) return;
  pedido.value = {
    convenio: convenio.value,
    competencia: competencia.value || padraoTrabalho.value || competenciaAtual(apoio.data.value?.hoje),
  };
}
async function fechar() {
  if (!pedido.value) return;
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const [ano, mes] = pedido.value.competencia.split('-').map(Number);
    const r = await fecharCompetencia(
      { convenio: Number(pedido.value.convenio), ano: ano!, mes: mes! },
      novaChave('competencia'),
    );
    mensagem.value = r.mensagem;
    await qc.invalidateQueries({ queryKey: ['tiss'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
async function reabrir() {
  if (!pedido.value || !motivoValido.value) return;
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const [ano, mes] = pedido.value.competencia.split('-').map(Number);
    const r = await reabrirCompetencia(
      {
        convenio: Number(pedido.value.convenio),
        ano: ano!,
        mes: mes!,
        motivo: motivoReabrir.value.trim(),
        confirmarImpacto: comLote.value && confirmarImpacto.value,
      },
      novaChave('competencia-reabrir'),
    );
    mensagem.value = r.mensagem;
    motivoReabrir.value = '';
    confirmarImpacto.value = false;
    await qc.invalidateQueries({ queryKey: ['tiss'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cp-titulo" data-testid="tela-tiss-competencias">
    <h1 id="cp-titulo">{{ t('tiss.competencias.titulo') }}</h1>
    <p>{{ t('tiss.competencias.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('competencia')" />
    <MinhaCompetenciaTrabalho :hoje="apoio.data.value?.hoje ?? ''" @escolhida="aoEscolherTrabalho" />
    <form class="filtros" @submit.prevent="consultar">
      <span class="campo">
        <SanteSelecao
          v-model="convenio"
          :rotulo="t('tiss.convenio')"
          :opcoes="convenios"
          data-testid="cp-convenio"
        />
      </span>
      <span class="campo">
        <label for="cp-competencia">{{ t('tiss.competencia') }}</label>
        <input id="cp-competencia" v-model="competencia" type="month" data-testid="cp-competencia" />
      </span>
      <button type="submit" :disabled="!convenio" data-testid="cp-consultar">
        {{ t('tiss.consultar') }}
      </button>
    </form>
    <ErroFaturamento v-if="resumo.error.value" :erro="resumo.error.value" />
    <template v-else-if="resumo.data.value">
      <dl class="resumo" data-testid="cp-resumo">
        <dt>{{ t('tiss.convenio') }}</dt>
        <dd>{{ resumo.data.value.convenioNome }}</dd>
        <dt>{{ t('tiss.competencias.contas') }}</dt>
        <dd>
          {{ resumo.data.value.contas }} ({{
            t('tiss.competencias.emLote', { n: resumo.data.value.emLote })
          }})
        </dd>
        <dt>{{ t('tiss.valor') }}</dt>
        <dd>{{ reais(resumo.data.value.valor) }}</dd>
        <dt>{{ t('tiss.situacao') }}</dt>
        <dd data-testid="cp-situacao">
          {{
            resumo.data.value.fechada
              ? t('tiss.competencias.fechadaEm', {
                  em: quando(resumo.data.value.fechadaEm),
                  por: resumo.data.value.fechadaPor,
                })
              : resumo.data.value.reaberta
                ? t('tiss.competencias.reabertaEm', {
                    em: quando(resumo.data.value.reabertaEm),
                    por: resumo.data.value.reabertaPor,
                    motivo: resumo.data.value.motivoReabertura,
                  })
                : t('tiss.competencias.aberta')
          }}
        </dd>
      </dl>
      <p v-if="resumo.data.value.ciclos > 0" class="secundario" data-testid="cp-ciclos">
        {{ t('tiss.competencias.ciclos', { n: resumo.data.value.ciclos }) }}
      </p>
      <p v-if="!pode('faturamento.fecharCompetencia')" class="secundario">
        {{ motivo('faturamento.fecharCompetencia') }}
      </p>
      <button
        v-if="!resumo.data.value.fechada"
        type="button"
        :disabled="gravando || !pode('faturamento.fecharCompetencia')"
        data-testid="cp-fechar"
        @click="fechar"
      >
        {{ t('tiss.competencias.fechar') }}
      </button>
      <form
        v-if="resumo.data.value.fechada && pode('faturamento.reabrirCompetencia')"
        class="filtros"
        data-testid="cp-reabrir-form"
        @submit.prevent="reabrir"
      >
        <span class="campo">
          <label for="cp-motivo">{{ t('tiss.competencias.motivoReabrir') }}</label>
          <input id="cp-motivo" v-model="motivoReabrir" maxlength="250" data-testid="cp-motivo" />
        </span>
        <span v-if="comLote" class="campo">
          <label>
            <input v-model="confirmarImpacto" type="checkbox" data-testid="cp-confirmar-impacto" />
            {{ t('tiss.competencias.confirmarImpacto', { n: resumo.data.value.emLote }) }}
          </label>
        </span>
        <button type="submit" :disabled="gravando || !motivoValido" data-testid="cp-reabrir">
          {{ t('tiss.competencias.reabrir') }}
        </button>
      </form>
    </template>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="cp-mensagem" />
    <h2>{{ t('tiss.competencias.fechadas') }}</h2>
    <ErroFaturamento v-if="lista.error.value" :erro="lista.error.value" />
    <table v-else-if="lista.data.value?.length" class="tabela" data-testid="cp-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('tiss.convenio') }}</th>
          <th scope="col">{{ t('tiss.competencia') }}</th>
          <th scope="col">{{ t('tiss.competencias.fechadaQuando') }}</th>
          <th scope="col">{{ t('tiss.autor') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in lista.data.value" :key="`${x.convenio}-${x.ano}-${x.mes}`">
          <td>{{ x.convenioNome || x.convenio }}</td>
          <td>{{ String(x.mes).padStart(2, '0') }}/{{ x.ano }}</td>
          <td>{{ quando(x.fechadaEm) }}</td>
          <td>{{ x.fechadaPor }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('tiss.nenhum') }}</p>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
