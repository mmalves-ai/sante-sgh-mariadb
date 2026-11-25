<script setup lang="ts">
// DMED e EFD-REINF (ficha do M32, seção 7): `/financeiro/fiscal/dmed` e `/financeiro/fiscal/reinf`. O arquivo da
// declaração gerado (ano da DMED; competência e série da REINF), guardado com a impressão digital e "não enviado" até a
// definição do fiscal; a lista mostra a contagem de registros e o valor total de cada arquivo.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import ApuracaoRetidoPainel from '../componentes/ApuracaoRetidoPainel.vue';
import ReinfEventosPainel from '../componentes/ReinfEventosPainel.vue';
import RetencoesPainel from '../componentes/RetencoesPainel.vue';
import SaldoCompensarPainel from '../componentes/SaldoCompensarPainel.vue';
import TabelaRegistros from '../componentes/TabelaRegistros.vue';
import { gerarDeclaracao, listarDeclaracoes, novaChave } from '../api-financeiro.js';
import { usarFinanceiro } from '../usar-financeiro.js';

const props = defineProps<{ tipo: 'dmed' | 'reinf' }>();
const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, tem, motivo, motivoFuncionalidade } = usarFinanceiro();
const lista = useQuery({
  queryKey: computed(() => ['financeiro', 'declaracoes', props.tipo]),
  queryFn: () => listarDeclaracoes(props.tipo),
});
const registros = computed(() => lista.data.value ?? []);
const periodo = ref('');
const serie = ref<'reinf-r2000' | 'reinf-r4000'>('reinf-r4000');
watch(
  () => apoio.data.value?.hoje,
  (h) => {
    if (h && !periodo.value)
      periodo.value = props.tipo === 'dmed' ? String(Number(h.slice(0, 4)) - 1) : h.slice(0, 7);
  },
  { immediate: true },
);
const series = [
  { valor: 'reinf-r2000', rotulo: 'R-2000' },
  { valor: 'reinf-r4000', rotulo: 'R-4000' },
];
const acao = computed(() => (props.tipo === 'dmed' ? 'gerarDmed' : 'gerarReinf'));
const colunas = [
  { chave: 'TIPO', rotulo: 'financeiro.tipo' },
  { chave: 'PERIODO', rotulo: 'financeiro.registros.periodo' },
  { chave: 'LEIAUTE', rotulo: 'financeiro.remessas.leiaute' },
  { chave: 'REGISTROS', rotulo: 'financeiro.registros.registros' },
  { chave: 'VALOR_TOTAL', rotulo: 'financeiro.total', formato: 'reais' as const },
  { chave: 'SITUACAO', rotulo: 'financeiro.situacao' },
  { chave: 'GERADO_EM', rotulo: 'financeiro.registros.geradoEm', formato: 'quando' as const },
];
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function gerar() {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = await gerarDeclaracao(
      { tipo: props.tipo === 'dmed' ? 'dmed' : serie.value, periodo: periodo.value },
      novaChave(props.tipo),
    );
    mensagem.value = r.mensagem;
    await qc.invalidateQueries({ queryKey: ['financeiro', 'declaracoes'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="dc-titulo" :data-testid="`tela-fin-${tipo}`">
    <h1 id="dc-titulo">{{ t(`financeiro.declaracoes.${tipo}.titulo`) }}</h1>
    <p>{{ t(`financeiro.declaracoes.${tipo}.texto`) }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('fiscal')" />
    <form class="filtros" @submit.prevent="gerar">
      <span class="campo">
        <label for="dc-periodo">{{ t(`financeiro.declaracoes.${tipo}.periodo`) }}</label>
        <input
          id="dc-periodo"
          v-model="periodo"
          :type="tipo === 'dmed' ? 'text' : 'month'"
          :inputmode="tipo === 'dmed' ? 'numeric' : undefined"
          required
          data-testid="dc-periodo"
        />
      </span>
      <span v-if="tipo === 'reinf'" class="campo">
        <SanteSelecao
          v-model="serie"
          :rotulo="t('financeiro.declaracoes.reinf.serie')"
          :opcoes="series"
          data-testid="dc-serie"
        />
      </span>
      <button type="submit" :disabled="gravando || !periodo || !pode(acao)" data-testid="dc-gerar">
        {{ t('financeiro.declaracoes.gerar') }}
      </button>
    </form>
    <p v-if="!pode(acao)" class="secundario">{{ motivo(acao) }}</p>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="dc-mensagem" />
    <h2>{{ t('financeiro.declaracoes.geradas') }}</h2>
    <ErroFaturamento v-if="lista.error.value" :erro="lista.error.value" />
    <TabelaRegistros v-else :registros="registros" :colunas="colunas" testid="dc-lista" />
    <!-- F3.8, 07-FIN linha 111: eventos da competência por beneficiário, processo, envio e retorno. -->
    <ReinfEventosPainel v-if="tipo === 'reinf'" :competencia="periodo" :pode-gerar="pode('gerarReinf')" />
    <!-- F3.8, 07-FIN linha 109: regras de retenção com vigência e recolhimento do retido da competência. -->
    <RetencoesPainel
      v-if="tipo === 'reinf'"
      :competencia="periodo"
      :pode-editar="tem('financeiro.parametro.editar')"
      :pode-recolher="tem('financeiro.tituloPagar.criar')"
    />
    <!-- F7, 07-FIN linha 110: a apuração do retido por código de receita, o DARF e o batimento com a Reinf. -->
    <ApuracaoRetidoPainel v-if="tipo === 'reinf'" :competencia="periodo" />
    <!-- F3.8, 07-FIN linha 109: o tributo retido pelos tomadores e o saldo a compensar na apuração da competência. -->
    <SaldoCompensarPainel
      v-if="tipo === 'reinf'"
      :competencia="periodo"
      :pode="tem('financeiro.reinf.gerar')"
    />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
