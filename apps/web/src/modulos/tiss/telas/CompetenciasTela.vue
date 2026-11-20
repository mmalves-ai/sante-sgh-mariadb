<script setup lang="ts">
// Fechamento de competência por convênio (ficha do M31, seção 7): `/faturamento/competencias`. Os totais da competência
// (contas, em lote e valor) e o fechamento como o cadastro de origem grava; a competência fechada não recebe conta nova
// nas telas do novo; reabrir é do supervisor, com motivo (a etapa seguinte do roteiro).
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { fecharCompetencia, listarCompetencias, novaChave, resumoCompetencia } from '../api-tiss.js';
import { competenciaAtual, opcoesConvenio, quando, reais, usarTiss } from '../usar-tiss.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivo, motivoFuncionalidade } = usarTiss('lote');
const convenio = ref('');
const competencia = ref('');
const pedido = ref<{ convenio: string; competencia: string } | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
const convenios = computed(() => opcoesConvenio(apoio.data.value?.convenios));
const resumo = useQuery({
  queryKey: computed(() => ['tiss', 'competencia', pedido.value]),
  queryFn: () => resumoCompetencia(pedido.value!),
  enabled: computed(() => pedido.value !== null),
});
const lista = useQuery({ queryKey: ['tiss', 'competencias'], queryFn: () => listarCompetencias({}) });
function consultar() {
  if (!convenio.value) return;
  pedido.value = {
    convenio: convenio.value,
    competencia: competencia.value || competenciaAtual(apoio.data.value?.hoje),
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
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cp-titulo" data-testid="tela-tiss-competencias">
    <h1 id="cp-titulo">{{ t('tiss.competencias.titulo') }}</h1>
    <p>{{ t('tiss.competencias.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('competencia')" />
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
              : t('tiss.competencias.aberta')
          }}
        </dd>
      </dl>
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
