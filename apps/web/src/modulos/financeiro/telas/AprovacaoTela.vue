<script setup lang="ts">
// Aprovação de pagamentos por alçada (ficha do M32, seção 7): `/financeiro/pagar/aprovacao`. A fila dos títulos que
// vencem no período sem as aprovações da faixa; aprovar exige a permissão da faixa e não vale para quem lançou (o
// servidor recusa; a segregação também vale para quem paga).
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { aprovarTitulo, lerFilaAprovacao, novaChave } from '../api-financeiro.js';
import { data, reais, usarFinanceiro } from '../usar-financeiro.js';

const { t } = useI18n();
const qc = useQueryClient();
const { pode, motivo, motivoFuncionalidade } = usarFinanceiro();
const dias = ref('30');
const pedido = ref(30);
const fila = useQuery({
  queryKey: computed(() => ['financeiro', 'aprovacao', pedido.value]),
  queryFn: () => lerFilaAprovacao(pedido.value),
});
const observacoes = reactive<Record<number, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref<number | null>(null);
async function aprovar(id: number) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = id;
  try {
    const r = await aprovarTitulo(id, observacoes[id] ?? '', novaChave('aprovar'));
    mensagem.value = r.mensagem;
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = null;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ap-titulo" data-testid="tela-fin-aprovacao">
    <h1 id="ap-titulo">{{ t('financeiro.aprovacao.titulo') }}</h1>
    <p>{{ t('financeiro.aprovacao.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('contasPagar')" />
    <form class="filtros" @submit.prevent="pedido = Number(dias) || 0">
      <span class="campo">
        <label for="ap-dias">{{ t('financeiro.aprovacao.dias') }}</label>
        <input id="ap-dias" v-model="dias" type="number" min="0" max="365" data-testid="ap-dias" />
      </span>
      <button type="submit" data-testid="ap-consultar">{{ t('financeiro.consultar') }}</button>
    </form>
    <p v-if="!pode('aprovarTitulo')" class="secundario">{{ motivo('aprovarTitulo') }}</p>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="ap-mensagem" />
    <ErroFaturamento v-if="fila.error.value" :erro="fila.error.value" />
    <p v-else-if="fila.isLoading.value">{{ t('financeiro.carregando') }}</p>
    <table v-else-if="fila.data.value?.length" class="tabela" data-testid="ap-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.credor') }}</th>
          <th scope="col">{{ t('financeiro.documento') }}</th>
          <th scope="col">{{ t('financeiro.vencimento') }}</th>
          <th scope="col">{{ t('financeiro.valor') }}</th>
          <th scope="col">{{ t('financeiro.pagar.lancadoPor') }}</th>
          <th scope="col">{{ t('financeiro.pagar.aprovacoes') }}</th>
          <th scope="col">{{ t('financeiro.aprovacao.permissao') }}</th>
          <th scope="col">{{ t('financeiro.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in fila.data.value" :key="x.id" :data-testid="`ap-linha-${x.id}`">
          <td>
            <RouterLink :to="`/financeiro/pagar/titulos/${x.id}`"
              >{{ x.credor }} — {{ x.credorNome }}</RouterLink
            >
          </td>
          <td>{{ x.documento }}/{{ x.parcela }}</td>
          <td>{{ data(x.vencimento) }}</td>
          <td>{{ reais(x.valor) }}</td>
          <td>{{ x.lancadoPor }}</td>
          <td>{{ x.feitas }} / {{ x.exigidas }}</td>
          <td>{{ x.permissaoDaFaixa ?? '—' }}</td>
          <td>
            <template v-if="x.feitas < x.exigidas">
              <label :for="`ap-obs-${x.id}`" class="visualmente-oculto">{{
                t('financeiro.aprovacao.observacao')
              }}</label>
              <input
                :id="`ap-obs-${x.id}`"
                v-model="observacoes[x.id]"
                maxlength="200"
                :data-testid="`ap-obs-${x.id}`"
              />
              <button
                type="button"
                :disabled="gravando === x.id || !pode('aprovarTitulo', 'financeiro.tituloPagar.aprovar')"
                :data-testid="`ap-aprovar-${x.id}`"
                @click="aprovar(x.id)"
              >
                {{ t('financeiro.aprovacao.aprovar') }}
              </button>
            </template>
            <span v-else>{{ t('financeiro.pagar.aprovado') }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('financeiro.nenhum') }}</p>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
