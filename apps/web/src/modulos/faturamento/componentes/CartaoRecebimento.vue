<script setup lang="ts">
// F3.8, 07-FIN linha 89: o bloco do cartão no recebimento do caixa. Quem recebe escolhe só a administradora, a
// bandeira e as parcelas; a taxa vigente é achada pelo servidor e a tela mostra na hora quanto a administradora vai
// creditar e quando (ou por que a venda não pode ser registrada assim, por exemplo sem taxa vigente). Uma só
// administradora ou bandeira possível já vem escolhida. Sem administradora cadastrada o bloco não aparece e o
// recebimento segue como antes.
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerOpcoesCartao, lerPreviaCartao } from '../../financeiro/api-cartao.js';
import { data, reais } from '../usar-faturamento.js';
import ErroFaturamento from './ErroFaturamento.vue';

export interface CartaoEscolhido {
  administradora: number;
  bandeira: number;
  parcelas: number;
}

const props = defineProps<{ forma: string; valor: number }>();
const emit = defineEmits<{ 'update:modelValue': [CartaoEscolhido | null] }>();
const { t } = useI18n();
const credito = computed(() => props.forma === 'cartao-credito');
const opcoes = useQuery({
  queryKey: ['financeiro', 'cartao', 'opcoes'],
  queryFn: () => lerOpcoesCartao(),
  staleTime: 60_000,
  retry: false,
});
const administradoras = computed(() => opcoes.data.value?.administradoras ?? []);
const bandeiras = computed(() =>
  (opcoes.data.value?.bandeiras ?? []).filter((b) =>
    [credito.value ? 'credito' : 'debito', 'credito_debito'].includes(b.modalidade),
  ),
);
const administradora = ref('');
const bandeira = ref('');
const parcelas = ref('1');
watch(
  [administradoras, bandeiras],
  () => {
    if (!administradora.value && administradoras.value.length === 1)
      administradora.value = String(administradoras.value[0]?.id);
    if (!bandeiras.value.some((b) => String(b.id) === bandeira.value))
      bandeira.value = bandeiras.value.length === 1 ? String(bandeiras.value[0]?.id) : '';
  },
  { immediate: true },
);
watch(credito, (c) => {
  if (!c) parcelas.value = '1';
});
const parcelaAdministradora = computed(
  () =>
    administradoras.value.find((a) => String(a.id) === administradora.value)?.permiteParcelamento ?? false,
);
const vazio = computed(() => [{ valor: '', rotulo: t('financeiro.cartao.caixa.escolha') }]);
const opcoesAdministradora = computed(() => [
  ...vazio.value,
  ...administradoras.value.map((a) => ({ valor: String(a.id), rotulo: a.nome })),
]);
const opcoesBandeira = computed(() => [
  ...vazio.value,
  ...bandeiras.value.map((b) => ({ valor: String(b.id), rotulo: b.nome })),
]);
const opcoesParcelas = computed(() =>
  Array.from({ length: credito.value && parcelaAdministradora.value ? 24 : 1 }, (_, i) => ({
    valor: String(i + 1),
    rotulo: `${i + 1}x`,
  })),
);
const escolhido = computed<CartaoEscolhido | null>(() =>
  Number(administradora.value) > 0 && Number(bandeira.value) > 0
    ? {
        administradora: Number(administradora.value),
        bandeira: Number(bandeira.value),
        parcelas: Number(parcelas.value) || 1,
      }
    : null,
);
watch(escolhido, (e) => emit('update:modelValue', e), { immediate: true });
const pedido = computed(() =>
  escolhido.value && props.valor > 0
    ? {
        ...escolhido.value,
        modalidade: credito.value ? ('credito' as const) : ('debito' as const),
        valor: props.valor,
      }
    : null,
);
const previa = useQuery({
  queryKey: computed(() => ['financeiro', 'cartao', 'previa', pedido.value]),
  queryFn: () => lerPreviaCartao(pedido.value!),
  enabled: computed(() => pedido.value !== null),
  retry: false,
});
</script>

<template>
  <template v-if="administradoras.length">
    <span class="campo">
      <SanteSelecao
        v-model="administradora"
        :rotulo="t('financeiro.cartao.caixa.administradora')"
        :opcoes="opcoesAdministradora"
        obrigatorio
        data-testid="cx-cartao-administradora"
      />
    </span>
    <span class="campo">
      <SanteSelecao
        v-model="bandeira"
        :rotulo="t('financeiro.cartao.caixa.bandeira')"
        :opcoes="opcoesBandeira"
        obrigatorio
        data-testid="cx-cartao-bandeira"
      />
    </span>
    <span v-if="credito" class="campo">
      <SanteSelecao
        v-model="parcelas"
        :rotulo="t('financeiro.cartao.caixa.parcelas')"
        :opcoes="opcoesParcelas"
        data-testid="cx-cartao-parcelas"
      />
    </span>
    <ErroFaturamento v-if="pedido && previa.error.value" :erro="previa.error.value" />
    <p v-else-if="pedido && previa.data.value" data-testid="cx-cartao-previa">
      {{
        t('financeiro.cartao.caixa.previa', {
          liquido: reais(previa.data.value.liquido),
          bruto: reais(previa.data.value.bruto),
          taxa: reais(previa.data.value.taxaTotal),
          parcelas: previa.data.value.parcelas.length,
          data: data(previa.data.value.parcelas[0]?.dataPrevista ?? ''),
        })
      }}
    </p>
  </template>
</template>
