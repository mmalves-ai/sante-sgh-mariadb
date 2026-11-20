<script setup lang="ts">
// Auditoria de contas (ficha do M30, seção 7): `/faturamento/contas/:id/auditoria`. O retrato da auditoria anterior (no
// formato do outro sistema), as diferenças por item, os pareceres registrados (versão da conta no momento do parecer) e
// as irregularidades desta conta (abertas e resolvidas, com o tipo); iniciar e concluir a auditoria e registrar o parecer do enfermeiro ou do médico auditor.
// Os ajustes de item (glosa interna, inclusão, troca de código) são P2 (especificados; Fase 4).
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { lerAuditoria, novaChave, registrarEtapa, registrarVersaoAuditoria } from '../api-faturamento.js';
import AvisoFaturamento from '../componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';
import { quando, reais, usarFaturamento } from '../usar-faturamento.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const qc = useQueryClient();
const { pode, motivoFuncionalidade } = usarFaturamento();
const id = computed(() => Number(props.id));
const a = useQuery({
  queryKey: computed(() => ['faturamento', 'auditoria', id.value]),
  queryFn: () => lerAuditoria(id.value),
});
const papel = ref<'enfermeiro' | 'medico'>('enfermeiro');
const opcoesPapel = computed(() =>
  (['enfermeiro', 'medico'] as const).map((x) => ({ valor: x, rotulo: t(`faturamento.auditoria.${x}`) })),
);
const parecer = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function agir(fn: () => Promise<{ mensagem: string }>) {
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = (await fn()).mensagem;
    await qc.invalidateQueries({ queryKey: ['faturamento'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="aud-titulo" data-testid="tela-faturamento-auditoria">
    <h1 id="aud-titulo">{{ t('faturamento.auditoria.titulo', { id }) }}</h1>
    <p>{{ t('faturamento.auditoria.texto') }}</p>
    <p>
      <RouterLink :to="`/faturamento/contas/${id}`">{{ t('faturamento.conta.titulo', { id }) }}</RouterLink>
    </p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('auditoria')" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="aud-mensagem" />
    <ErroFaturamento v-if="a.error.value" :erro="a.error.value" />
    <p v-else-if="!a.data.value" role="status">{{ t('faturamento.carregando') }}</p>
    <template v-else>
      <h2>{{ t('faturamento.auditoria.retrato') }}</h2>
      <p v-if="!a.data.value.retratoLegado">{{ t('faturamento.auditoria.semRetrato') }}</p>
      <p v-else>{{ reais(a.data.value.retratoLegado.total) }} · {{ a.data.value.retratoLegado.itens }}</p>
      <table v-if="a.data.value.diferencas.length" class="tabela" data-testid="aud-diferencas">
        <caption>
          {{
            t('faturamento.auditoria.diferencas')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('faturamento.codigo') }}</th>
            <th scope="col">{{ t('faturamento.nome') }}</th>
            <th scope="col">{{ t('faturamento.auditoria.antes') }}</th>
            <th scope="col">{{ t('faturamento.auditoria.depois') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in a.data.value.diferencas" :key="d.codigo">
            <td>{{ d.codigo }}</td>
            <td>{{ d.nome }}</td>
            <td>{{ reais(d.antes) }} ({{ d.quantidadeAntes }})</td>
            <td>{{ reais(d.depois) }} ({{ d.quantidadeDepois }})</td>
          </tr>
        </tbody>
      </table>
      <p class="secundario">{{ t('faturamento.auditoria.ajustes') }}</p>
      <div v-if="pode('etapaAuditoria')" class="filtros">
        <button
          type="button"
          data-testid="aud-iniciar"
          @click="
            agir(() => registrarEtapa(id, { etapa: 'auditoria', acao: 'iniciar' }, novaChave('aud-ini')))
          "
        >
          {{ t('faturamento.auditoria.iniciar') }}
        </button>
        <button
          type="button"
          data-testid="aud-concluir"
          @click="
            agir(() => registrarEtapa(id, { etapa: 'auditoria', acao: 'concluir' }, novaChave('aud-fim')))
          "
        >
          {{ t('faturamento.auditoria.concluir') }}
        </button>
      </div>
      <form
        v-if="pode('registrarVersao')"
        class="filtros"
        @submit.prevent="agir(() => registrarVersaoAuditoria(id, { papel, parecer }, novaChave('versao')))"
      >
        <span class="campo">
          <SanteSelecao
            v-model="papel"
            :rotulo="t('faturamento.auditoria.papel')"
            :opcoes="opcoesPapel"
            data-testid="aud-papel"
          />
        </span>
        <span class="campo">
          <label for="aud-parecer">{{ t('faturamento.auditoria.parecer') }}</label>
          <textarea
            id="aud-parecer"
            v-model="parecer"
            maxlength="1000"
            rows="3"
            data-testid="aud-parecer"
          ></textarea>
        </span>
        <button type="submit" data-testid="aud-registrar">{{ t('faturamento.auditoria.registrar') }}</button>
      </form>
      <h2>{{ t('faturamento.auditoria.versoes') }}</h2>
      <p v-if="a.data.value.versoes.length === 0">{{ t('faturamento.nenhum') }}</p>
      <ul v-else data-testid="aud-versoes">
        <li v-for="v in a.data.value.versoes" :key="v.id">
          {{ quando(v.em) }} · {{ v.papel }} · {{ v.usuario }} · {{ reais(v.total) }} ({{ v.itens }}):
          {{ v.parecer }}
        </li>
      </ul>
      <h2>{{ t('faturamento.auditoria.irregularidades') }}</h2>
      <p v-if="a.data.value.irregularidades.length === 0">
        {{ t('faturamento.auditoria.semIrregularidade') }}
      </p>
      <ul v-else data-testid="aud-irregularidades">
        <li v-for="x in a.data.value.irregularidades" :key="x.id">
          {{ quando(x.registradaEm) }} · {{ x.nome }}
          <template v-if="x.descricao"> · {{ x.descricao }}</template>
          · {{ x.aberta ? t('faturamento.auditoria.aberta') : t('faturamento.auditoria.resolvida') }}
        </li>
      </ul>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
