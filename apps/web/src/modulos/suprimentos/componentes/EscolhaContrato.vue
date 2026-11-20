<script setup lang="ts">
// A escolha do contrato com o fornecedor no novo pedido de compra e no novo título a pagar (M55, etapa 3; regras 6 e 7):
// os contratos ativos do fornecedor com o saldo e a vigência; fora da vigência, a exceção aprovada pela alçada ainda não
// usada. O campo só aparece com a funcionalidade ligada e as permissões de ler e de ligar ao contrato (sem elas, o
// pedido e o título seguem sem contrato). No título, o pedido ligado ao mesmo contrato que o título paga (regra 6: não abate o saldo de
// novo). O vínculo vai na mesma transação da gravação; o servidor confere tudo de novo.
import type { ContratoDoVinculo } from '@sgh/contratos';
import { SanteAlerta, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerContratoTela, listarContratosTela } from '../api-contrato.js';
import { reais } from '../usar-suprimentos.js';
import { excecoesDisponiveis, foraDaVigencia, podeOperacao, rotuloFaixa } from './contrato-tela.js';

const props = defineProps<{
  /** O fornecedor do pedido (um só) ou o credor do título; nulo sem fornecedor definido. */
  fornecedor: number | null;
  testid: string;
  /** No título, a escolha do pedido de origem entre os pedidos ligados ao contrato. */
  tipo?: 'pedido' | 'titulo';
}>();
const valor = defineModel<ContratoDoVinculo | null>({ required: true });
const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`contratoFornecedor.escolha.${s}`, p ?? {});

const lista = useQuery({
  queryKey: computed(() => ['contratos', 'escolha', props.fornecedor]),
  queryFn: () => listarContratosTela({ situacao: 'ativo', fornecedor: props.fornecedor }),
  enabled: computed(() => props.fornecedor !== null),
  retry: false,
});
/**
 * Sem a permissão de ler contratos (403), sem a de ligar pedidos e títulos (`editar`, a mesma da tela de contratos; o
 * servidor também confere) ou com a funcionalidade desligada, o campo some.
 */
const disponivel = computed(
  () =>
    !lista.isError.value &&
    lista.data.value?.gravacao?.ligada === true &&
    podeOperacao(lista.data.value.gravacao, 'editar'),
);
const contratos = computed(() => (disponivel.value ? (lista.data.value?.itens ?? []) : []));
const contrato = ref<number | null>(valor.value?.contrato ?? null);
const excecao = ref<number | null>(valor.value?.excecao ?? null);
const origem = ref<number | null>(valor.value?.pedidoDeOrigem ?? null);
watch(
  () => props.fornecedor,
  () => {
    contrato.value = null;
    excecao.value = null;
  },
);
watch(contrato, () => {
  origem.value = null;
});
const ehTitulo = computed(() => props.tipo === 'titulo');
const escolhido = computed(() => contratos.value.find((c) => c.id === contrato.value) ?? null);
const precisaExcecao = computed(() => !!escolhido.value && foraDaVigencia(escolhido.value.faixa));
const detalhe = useQuery({
  queryKey: computed(() => ['contratos', 'detalhe', contrato.value]),
  queryFn: () => lerContratoTela(contrato.value!),
  enabled: computed(() => precisaExcecao.value || (ehTitulo.value && contrato.value !== null)),
});
/** Os pedidos ligados ao contrato (ativos) que o título pode estar pagando. */
const pedidosLigados = computed(() =>
  ehTitulo.value && detalhe.data.value
    ? detalhe.data.value.vinculos.filter((v) => v.tipo === 'pedido' && v.ativo)
    : [],
);
const opcoesOrigem = computed(() => [
  { valor: null as number | null, rotulo: k('semOrigem') },
  ...pedidosLigados.value.map((v) => ({
    valor: v.id as number | null,
    rotulo: k('opcaoOrigem', { pedido: v.chaveNatural, valor: reais(v.valor) }),
  })),
]);
const excecoes = computed(() =>
  detalhe.data.value && lista.data.value
    ? excecoesDisponiveis(detalhe.data.value.eventos, lista.data.value.hoje)
    : [],
);
const opcoes = computed(() => [
  { valor: null as number | null, rotulo: k('nenhum') },
  ...contratos.value.map((c) => ({
    valor: c.id as number | null,
    rotulo: k('opcao', { numero: c.numero, saldo: reais(c.saldo), faixa: rotuloFaixa(c.faixa) }),
  })),
]);
const opcoesExcecao = computed(() => [
  { valor: null as number | null, rotulo: k('semExcecao') },
  ...excecoes.value.map((e) => ({
    valor: e.id as number | null,
    rotulo: `${e.criadoEm.slice(0, 10).split('-').reverse().join('/')} · ${e.usuario} · ${(e.descricao ?? '').slice(0, 60)}`,
  })),
]);
watch(
  [contrato, excecao, precisaExcecao, origem],
  () => {
    valor.value =
      contrato.value === null
        ? null
        : {
            contrato: contrato.value,
            excecao: precisaExcecao.value ? excecao.value : null,
            pedidoDeOrigem: ehTitulo.value ? origem.value : null,
          };
  },
  { immediate: true },
);
</script>

<template>
  <template v-if="fornecedor !== null && disponivel">
    <p v-if="contratos.length === 0" class="secundario" :data-testid="`${testid}-vazio`">
      {{ k('semContratos') }}
    </p>
    <SanteSelecao v-else v-model="contrato" :rotulo="k('rotulo')" :opcoes="opcoes" :data-testid="testid" />
    <template v-if="precisaExcecao">
      <SanteAlerta variante="aviso" :texto="k('precisaExcecao')" :data-testid="`${testid}-precisa-excecao`" />
      <SanteSelecao
        v-model="excecao"
        :rotulo="k('excecao')"
        :opcoes="opcoesExcecao"
        :data-testid="`${testid}-excecao`"
      />
    </template>
    <template v-if="pedidosLigados.length > 0">
      <SanteSelecao
        v-model="origem"
        :rotulo="k('origem')"
        :opcoes="opcoesOrigem"
        :data-testid="`${testid}-origem`"
      />
      <p class="secundario" :data-testid="`${testid}-origem-explica`">{{ k('explicaOrigem') }}</p>
    </template>
  </template>
</template>
