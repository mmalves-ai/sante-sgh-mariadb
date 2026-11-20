<script setup lang="ts">
// Simulador de preço (ficha do M30, seção 7): `/faturamento/simulador`. O preço de tabela de um item para um convênio e
// uma data, pela mesma cascata do explicador (somente leitura; nada é gravado). O impacto de um reajuste é o simulador
// do reajuste do contrato (M12).
import { SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { simular } from '../api-faturamento.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import { data, num, reais, usarFaturamento } from '../usar-faturamento.js';

const { t } = useI18n();
const { apoio } = usarFaturamento();
const f = ref({ convenio: '', tipoConta: 'E', tipo: '3', codigo: '', quantidade: '1', data: '' });
const opcoesTipoConta = computed(() => [
  { valor: 'E', rotulo: t('faturamento.externa') },
  { valor: 'I', rotulo: t('faturamento.internacao') },
]);
const opcoesGrupo = computed(() =>
  ['1', '2', '3', '4'].map((g) => ({ valor: g, rotulo: t(`faturamento.grupos.${g}`) })),
);
const r = ref<Awaited<ReturnType<typeof simular>> | null>(null);
const erro = ref<unknown>(null);
async function rodar() {
  erro.value = null;
  r.value = null;
  try {
    r.value = await simular({ ...f.value, data: f.value.data || apoio.data.value?.hoje || '' });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="sim-titulo" data-testid="tela-faturamento-simulador">
    <h1 id="sim-titulo">{{ t('faturamento.simulador.titulo') }}</h1>
    <p>{{ t('faturamento.simulador.texto') }}</p>
    <form class="filtros" @submit.prevent="rodar">
      <span class="campo"
        ><label for="sim-conv">{{ t('faturamento.convenio') }}</label
        ><input id="sim-conv" v-model="f.convenio" inputmode="numeric" size="5" data-testid="sim-conv"
      /></span>
      <span class="campo">
        <SanteSelecao v-model="f.tipoConta" :rotulo="t('faturamento.tipoConta')" :opcoes="opcoesTipoConta" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="f.tipo"
          :rotulo="t('faturamento.grupo')"
          :opcoes="opcoesGrupo"
          data-testid="sim-tipo"
        />
      </span>
      <span class="campo"
        ><label for="sim-cod">{{ t('faturamento.codigo') }}</label
        ><input id="sim-cod" v-model="f.codigo" inputmode="numeric" data-testid="sim-cod"
      /></span>
      <span class="campo"
        ><label for="sim-qtd">{{ t('faturamento.quantidade') }}</label
        ><input id="sim-qtd" v-model="f.quantidade" inputmode="decimal" size="6"
      /></span>
      <span class="campo"
        ><label for="sim-data">{{ t('faturamento.data') }}</label
        ><input id="sim-data" v-model="f.data" type="date"
      /></span>
      <button type="submit" data-testid="sim-rodar">{{ t('faturamento.simulador.simular') }}</button>
    </form>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <div v-if="r" data-testid="sim-resultado">
      <p v-if="!r.encontrado">{{ t('faturamento.simulador.naoEncontrado') }}</p>
      <p v-else-if="!r.preco">{{ r.nome }} · {{ t('faturamento.simulador.semPreco') }}</p>
      <dl v-else>
        <dt>{{ t('faturamento.nome') }}</dt>
        <dd>{{ r.nome }}</dd>
        <dt>{{ t('faturamento.simulador.modelo') }}</dt>
        <dd>{{ r.preco.modelo }}</dd>
        <dt>{{ t('faturamento.simulador.vigencia') }}</dt>
        <dd>{{ data(r.vigencia) }}</dd>
        <dt>{{ t('faturamento.unitario') }}</dt>
        <dd data-testid="sim-unitario">{{ num(r.preco.unitario) }}</dd>
        <dt>{{ t('faturamento.valor') }}</dt>
        <dd data-testid="sim-valor">{{ reais(r.preco.valor) }}</dd>
      </dl>
    </div>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
