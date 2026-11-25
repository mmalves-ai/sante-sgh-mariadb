<script setup lang="ts">
// NFS-e (ficha do M32, seção 7): `/financeiro/fiscal/nfse`. A nota de serviço por fatura (título a receber) ou por
// conta do particular, na apresentação ou no recebimento, com ISS, IBS e CBS calculados no servidor; fora de produção
// (e até a definição do fiscal) a emissão vai ao simulador.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import NotasServicoCiclo from '../componentes/NotasServicoCiclo.vue';
import TabelaRegistros from '../componentes/TabelaRegistros.vue';
import { emitirNfse, listarNfse, novaChave } from '../api-financeiro.js';
import { usarFinanceiro } from '../usar-financeiro.js';

const { t } = useI18n();
const qc = useQueryClient();
const { gravacao, pode, motivo, motivoFuncionalidade } = usarFinanceiro();
const notas = useQuery({ queryKey: ['financeiro', 'nfse'], queryFn: () => listarNfse() });
const form = reactive({
  tituloReceber: '',
  conta: '',
  momento: 'apresentacao' as 'apresentacao' | 'recebimento',
  classificacao: '',
  itemServico: '',
  valorServicos: '',
  aliquotaIss: '2',
  issRetido: false,
});
const momentos = computed(() =>
  (['apresentacao', 'recebimento'] as const).map((m) => ({
    valor: m,
    rotulo: t(`financeiro.nfse.momentos.${m}`),
  })),
);
const colunas = [
  { chave: 'NUMERO', rotulo: 'financeiro.registros.numero' },
  { chave: 'ID_MFCTAREC', rotulo: 'financeiro.nfse.tituloReceber' },
  { chave: 'MOMENTO', rotulo: 'financeiro.nfse.momento' },
  { chave: 'VALOR_SERVICOS', rotulo: 'financeiro.nfse.valorServicos', formato: 'reais' as const },
  { chave: 'VALOR_ISS', rotulo: 'financeiro.registros.iss', formato: 'reais' as const },
  { chave: 'VALOR_IBS', rotulo: 'financeiro.registros.ibs', formato: 'reais' as const },
  { chave: 'VALOR_CBS', rotulo: 'financeiro.registros.cbs', formato: 'reais' as const },
  { chave: 'VALOR_LIQUIDO', rotulo: 'financeiro.registros.liquido', formato: 'reais' as const },
  { chave: 'DESTINO', rotulo: 'financeiro.registros.destino' },
  { chave: 'SITUACAO', rotulo: 'financeiro.situacao' },
  { chave: 'EMITIDO_EM', rotulo: 'financeiro.registros.geradoEm', formato: 'quando' as const },
];
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function emitir() {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = await emitirNfse(
      {
        tituloReceber: form.tituloReceber ? Number(form.tituloReceber) : null,
        conta: form.conta ? Number(form.conta) : null,
        momento: form.momento,
        classificacao: form.classificacao,
        itemServico: form.itemServico,
        valorServicos: Number(String(form.valorServicos).replace(',', '.')),
        aliquotaIss: Number(String(form.aliquotaIss).replace(',', '.')),
        issRetido: form.issRetido,
      },
      novaChave('nfse'),
    );
    mensagem.value = r.mensagem;
    await qc.invalidateQueries({ queryKey: ['financeiro', 'nfse'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="nf-titulo" data-testid="tela-fin-nfse">
    <h1 id="nf-titulo">{{ t('financeiro.nfse.titulo') }}</h1>
    <p>{{ t('financeiro.nfse.texto') }}</p>
    <p>
      <RouterLink to="/cadastros/dominios/grupo/financeiroNfse" data-testid="nfse-cadastros">
        {{ t('financeiro.tabelasDoItem') }}
      </RouterLink>
    </p>
    <p v-if="gravacao.data.value?.destinoExterno === 'simulador'" class="secundario">
      {{ t('financeiro.simulador') }}
    </p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('fiscal')" />
    <!-- F3.8, 07-FIN linha 113: lote por faturas, cancelamento, substituição e histórico, no banco do cliente. -->
    <NotasServicoCiclo :pode="pode('emitirNfse')" />
    <h2>{{ t('financeiro.nfse.emitir') }}</h2>
    <form class="formulario" data-testid="nf-formulario" @submit.prevent="emitir">
      <span class="campo">
        <label for="nf-titulo-receber">{{ t('financeiro.nfse.tituloReceber') }}</label>
        <input
          id="nf-titulo-receber"
          v-model="form.tituloReceber"
          inputmode="numeric"
          data-testid="nf-titulo-receber"
        />
      </span>
      <span class="campo">
        <label for="nf-conta">{{ t('financeiro.nfse.contaPaciente') }}</label>
        <input id="nf-conta" v-model="form.conta" inputmode="numeric" data-testid="nf-conta" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="form.momento"
          :rotulo="t('financeiro.nfse.momento')"
          :opcoes="momentos"
          data-testid="nf-momento"
        />
      </span>
      <span class="campo">
        <label for="nf-classificacao">{{ t('financeiro.nfse.classificacaoTributaria') }}</label>
        <input
          id="nf-classificacao"
          v-model="form.classificacao"
          maxlength="20"
          data-testid="nf-classificacao"
        />
      </span>
      <span class="campo">
        <label for="nf-item">{{ t('financeiro.nfse.itemServico') }}</label>
        <input id="nf-item" v-model="form.itemServico" maxlength="20" data-testid="nf-item" />
      </span>
      <span class="campo">
        <label for="nf-valor">{{ t('financeiro.nfse.valorServicos') }}</label>
        <input
          id="nf-valor"
          v-model="form.valorServicos"
          inputmode="decimal"
          required
          data-testid="nf-valor"
        />
      </span>
      <span class="campo">
        <label for="nf-aliquota">{{ t('financeiro.nfse.aliquota') }}</label>
        <input
          id="nf-aliquota"
          v-model="form.aliquotaIss"
          inputmode="decimal"
          required
          data-testid="nf-aliquota"
        />
      </span>
      <span class="campo">
        <label for="nf-retido">
          <input id="nf-retido" v-model="form.issRetido" type="checkbox" data-testid="nf-retido" />
          {{ t('financeiro.nfse.issRetido') }}
        </label>
      </span>
      <button
        type="submit"
        :disabled="gravando || (!form.tituloReceber && !form.conta) || !pode('emitirNfse')"
        data-testid="nf-emitir"
      >
        {{ t('financeiro.nfse.emitir') }}
      </button>
      <p v-if="!pode('emitirNfse')" class="secundario">{{ motivo('emitirNfse') }}</p>
    </form>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="nf-mensagem" />
    <h2>{{ t('financeiro.nfse.emitidas') }}</h2>
    <ErroFaturamento v-if="notas.error.value" :erro="notas.error.value" />
    <TabelaRegistros v-else :registros="notas.data.value ?? []" :colunas="colunas" testid="nf-lista" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
