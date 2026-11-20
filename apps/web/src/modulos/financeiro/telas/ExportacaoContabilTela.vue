<script setup lang="ts">
// Exportação contábil (ficha do M32, seção 7): `/financeiro/contabil/exportacao`. O lote do período pela régua
// escolhida, com a contagem e a soma de débitos e créditos para a conferência do contador, e o de-para de convênio e
// tipo de lançamento para a conta contábil (editado no cadastro genérico; o lançamento sem conta fica contado).
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import TabelaRegistros from '../componentes/TabelaRegistros.vue';
import { exportarLote, lerDePara, listarLotes, novaChave } from '../api-financeiro.js';
import { usarFinanceiro } from '../usar-financeiro.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivo, motivoFuncionalidade } = usarFinanceiro();
const lotes = useQuery({ queryKey: ['financeiro', 'lotes'], queryFn: () => listarLotes() });
const dePara = useQuery({ queryKey: ['financeiro', 'de-para'], queryFn: () => lerDePara() });
const periodo = ref('');
const regua = ref<'competencia' | 'caixa'>('competencia');
watch(
  () => apoio.data.value?.hoje,
  (h) => {
    if (h && !periodo.value) periodo.value = h.slice(0, 7);
  },
  { immediate: true },
);
const reguas = computed(() =>
  (['competencia', 'caixa'] as const).map((r) => ({
    valor: r,
    rotulo: t(`financeiro.gerencial.reguas.${r}`),
  })),
);
const colunas = [
  { chave: 'PERIODO', rotulo: 'financeiro.registros.periodo' },
  { chave: 'REGUA', rotulo: 'financeiro.gerencial.regua' },
  { chave: 'LANCAMENTOS', rotulo: 'financeiro.registros.lancamentos' },
  { chave: 'SOMA_DEBITOS', rotulo: 'financeiro.registros.debitos', formato: 'reais' as const },
  { chave: 'SOMA_CREDITOS', rotulo: 'financeiro.registros.creditos', formato: 'reais' as const },
  { chave: 'SEM_DE_PARA', rotulo: 'financeiro.registros.semDePara' },
  { chave: 'EXPORTADO_EM', rotulo: 'financeiro.registros.geradoEm', formato: 'quando' as const },
];
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const avisos = ref<readonly string[]>([]);
const gravando = ref(false);
async function exportar() {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = await exportarLote({ periodo: periodo.value, regua: regua.value }, novaChave('lote'));
    mensagem.value = r.mensagem;
    avisos.value = r.avisos;
    await qc.invalidateQueries({ queryKey: ['financeiro', 'lotes'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ec-titulo" data-testid="tela-fin-contabil">
    <h1 id="ec-titulo">{{ t('financeiro.contabil.titulo') }}</h1>
    <p>{{ t('financeiro.contabil.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('fiscal')" />
    <form class="filtros" @submit.prevent="exportar">
      <span class="campo">
        <label for="ec-periodo">{{ t('financeiro.competencia') }}</label>
        <input id="ec-periodo" v-model="periodo" type="month" required data-testid="ec-periodo" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="regua"
          :rotulo="t('financeiro.gerencial.regua')"
          :opcoes="reguas"
          data-testid="ec-regua"
        />
      </span>
      <button
        type="submit"
        :disabled="gravando || !periodo || !pode('exportarContabil')"
        data-testid="ec-exportar"
      >
        {{ t('financeiro.contabil.exportar') }}
      </button>
    </form>
    <p v-if="!pode('exportarContabil')" class="secundario">{{ motivo('exportarContabil') }}</p>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" :avisos="avisos" testid="ec-mensagem" />
    <h2>{{ t('financeiro.contabil.lotes') }}</h2>
    <ErroFaturamento v-if="lotes.error.value" :erro="lotes.error.value" />
    <TabelaRegistros v-else :registros="lotes.data.value ?? []" :colunas="colunas" testid="ec-lotes" />
    <h2>{{ t('financeiro.contabil.dePara') }}</h2>
    <RouterLink to="/cadastros/dominios/grupo/financeiroContabil">{{
      t('financeiro.parametros.editar')
    }}</RouterLink>
    <ErroFaturamento v-if="dePara.error.value" :erro="dePara.error.value" />
    <table v-else-if="dePara.data.value?.length" class="tabela" data-testid="ec-de-para">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.convenio') }}</th>
          <th scope="col">{{ t('financeiro.contabil.tipoConta') }}</th>
          <th scope="col">{{ t('financeiro.contabil.tipoLancamento') }}</th>
          <th scope="col">{{ t('financeiro.classificacao') }}</th>
          <th scope="col">{{ t('financeiro.contabil.contaContabil') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(d, i) in dePara.data.value" :key="i">
          <td>{{ d.convenio }}</td>
          <td>{{ d.tipoConta }}</td>
          <td>{{ d.tipoLancamento }}</td>
          <td>{{ d.grupo }}.{{ d.subgrupo }}.{{ d.item }}</td>
          <td>{{ d.conta ?? t('financeiro.contabil.semConta') }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('financeiro.nenhum') }}</p>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
