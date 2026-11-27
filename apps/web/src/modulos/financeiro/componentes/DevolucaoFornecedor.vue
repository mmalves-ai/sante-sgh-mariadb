<script setup lang="ts">
// F3.8, 07-FIN linha 63 (C1-008): devolução ao fornecedor na ficha do título a pagar. Escolhe a parcela em aberto, quem
// emite a nota (fornecedor: crédito recebida; hospital: débito emitida) e o motivo da natureza certa; grava pela emissão
// da nota de crédito ou débito já aplicada à parcela (financeiro.nota_credito_debito_emitir, que abate o saldo). O
// servidor confere de novo (efeito, saldo, portador).
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import { emitirNota, lerApoiosNota } from '../api-nota-credito-debito.js';
import { ORIGEM_DEVOLUCAO, type OrigemDevolucao, motivosDaOrigem } from '../api-titulo-pagar-alteracao.js';
import { data, reais } from '../usar-financeiro.js';

const props = defineProps<{
  parcelas: readonly {
    id: number;
    parcela: number;
    vencimento: string | null;
    valor: number;
    saldo?: number;
  }[];
  podeGravar: boolean;
}>();
const emit = defineEmits<{ gravado: [mensagem: string] }>();
const { t } = useI18n();

const apoios = useQuery({ queryKey: ['financeiro', 'nota-cessao', 'apoios'], queryFn: lerApoiosNota });
const saldoDe = (p: (typeof props.parcelas)[number]) => p.saldo ?? p.valor;
const parcela = ref('');
watch(
  () => props.parcelas,
  (ps) => {
    if (!ps.some((p) => String(p.id) === parcela.value)) parcela.value = ps[0] ? String(ps[0].id) : '';
  },
  { immediate: true },
);
const opcoesParcelas = computed(() =>
  props.parcelas.map((p) => ({
    valor: String(p.id),
    rotulo: `${p.parcela} — ${data(p.vencimento)} — ${reais(saldoDe(p))}`,
  })),
);
const origem = ref<OrigemDevolucao>('fornecedor');
const opcoesOrigem = computed(() =>
  (['fornecedor', 'hospital'] as const).map((o) => ({
    valor: o,
    rotulo: t(`financeiro.devolucaoFornecedor.origens.${o}`),
  })),
);
const motivo = ref('');
const opcoesMotivo = computed(() => [
  { valor: '', rotulo: '—' },
  ...motivosDaOrigem(apoios.data.value?.motivos ?? [], origem.value).map((m) => ({
    valor: String(m.id),
    rotulo: m.rotulo,
  })),
]);
watch(origem, () => {
  if (!opcoesMotivo.value.some((o) => o.valor === motivo.value)) motivo.value = '';
});
const hoje = () => new Date().toISOString().slice(0, 10);
const form = ref({ dataEmissao: hoje(), numeroDocumento: '', valor: 0, observacao: '' });
const saldo = computed(() => {
  const p = props.parcelas.find((x) => String(x.id) === parcela.value);
  return p ? saldoDe(p) : 0;
});
const acimaSaldo = computed(() => Number(form.value.valor) > saldo.value);
const gravando = ref(false);
const erro = ref<unknown>(null);
const podeEnviar = computed(
  () =>
    props.podeGravar &&
    !gravando.value &&
    !!parcela.value &&
    !!motivo.value &&
    Number(form.value.valor) > 0 &&
    !acimaSaldo.value &&
    !!form.value.dataEmissao,
);

async function gravar() {
  erro.value = null;
  gravando.value = true;
  try {
    const o = ORIGEM_DEVOLUCAO[origem.value];
    const r = await emitirNota(
      'pagar',
      {
        parcela: Number(parcela.value),
        direcao: o.direcao,
        natureza: o.natureza,
        motivo: Number(motivo.value),
        dataEmissao: form.value.dataEmissao,
        ...(form.value.numeroDocumento.trim() ? { numeroDocumento: form.value.numeroDocumento.trim() } : {}),
        valorItens: Number(form.value.valor),
        valorDesconto: 0,
        valorOutros: 0,
        tributos: [],
        ...(form.value.observacao.trim() ? { observacao: form.value.observacao.trim() } : {}),
        aplicar: true,
      },
      novaChave('devolucao-fornecedor'),
    );
    form.value = { dataEmissao: hoje(), numeroDocumento: '', valor: 0, observacao: '' };
    emit('gravado', r.mensagem);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section aria-labelledby="tdv-titulo" data-testid="tdv-devolucao">
    <h2 id="tdv-titulo">{{ t('financeiro.devolucaoFornecedor.titulo') }}</h2>
    <p class="secundario">{{ t('financeiro.devolucaoFornecedor.texto') }}</p>
    <p v-if="!parcelas.length" data-testid="tdv-sem-parcela">
      {{ t('financeiro.devolucaoFornecedor.semParcela') }}
    </p>
    <form v-else class="filtros" @submit.prevent="gravar">
      <span class="campo">
        <SanteSelecao
          v-model="parcela"
          :rotulo="t('financeiro.devolucaoFornecedor.parcela')"
          :opcoes="opcoesParcelas"
          data-testid="tdv-parcela"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="origem"
          :rotulo="t('financeiro.devolucaoFornecedor.origem')"
          :opcoes="opcoesOrigem"
          data-testid="tdv-origem"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="motivo"
          :rotulo="t('financeiro.devolucaoFornecedor.motivo')"
          :opcoes="opcoesMotivo"
          data-testid="tdv-motivo"
        />
      </span>
      <span class="campo">
        <label for="tdv-data">{{ t('financeiro.devolucaoFornecedor.dataEmissao') }}</label>
        <input id="tdv-data" v-model="form.dataEmissao" type="date" required data-testid="tdv-data" />
      </span>
      <span class="campo">
        <label for="tdv-numero">{{ t('financeiro.devolucaoFornecedor.numeroDocumento') }}</label>
        <input id="tdv-numero" v-model="form.numeroDocumento" maxlength="20" data-testid="tdv-numero" />
      </span>
      <span class="campo">
        <label for="tdv-valor">{{ t('financeiro.devolucaoFornecedor.valor') }}</label>
        <input
          id="tdv-valor"
          v-model.number="form.valor"
          type="number"
          min="0.01"
          step="0.01"
          required
          :aria-invalid="acimaSaldo"
          data-testid="tdv-valor"
        />
      </span>
      <span class="campo">
        <label for="tdv-observacao">{{ t('financeiro.devolucaoFornecedor.observacao') }}</label>
        <input id="tdv-observacao" v-model="form.observacao" maxlength="200" data-testid="tdv-observacao" />
      </span>
      <button type="submit" :disabled="!podeEnviar" data-testid="tdv-gravar">
        {{ t('financeiro.devolucaoFornecedor.gravar') }}
      </button>
    </form>
    <p v-if="acimaSaldo" role="alert" data-testid="tdv-aviso">
      {{ t('financeiro.devolucaoFornecedor.acimaSaldo', { saldo: reais(saldo) }) }}
    </p>
    <ErroFaturamento v-if="erro" :erro="erro" />
  </section>
</template>
