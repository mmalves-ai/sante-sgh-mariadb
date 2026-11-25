<script setup lang="ts">
// Portador das parcelas na ficha do título a receber (F8, 07-FIN linha 79): com quem cada parcela está (carteira
// própria, banco ou cessionário) e a operação de desconto ou cessão mais recente em que ela entrou, com o desfecho.
// Só aparece para quem consulta a cessão de recebíveis; o atalho leva à tela das operações.
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { lerPortadorDoTitulo } from '../api-cessao-recebivel.js';
import { data, reais, usarFinanceiro } from '../usar-financeiro.js';

const props = defineProps<{ titulo: number }>();
const { t } = useI18n();
const { tem } = usarFinanceiro();
const pode = computed(() => tem('financeiro.cessaoRecebivel.ler'));
const parcelas = useQuery({
  queryKey: computed(() => ['financeiro', 'cessao', 'titulo', props.titulo]),
  queryFn: () => lerPortadorDoTitulo(props.titulo),
  enabled: pode,
});
</script>

<template>
  <section v-if="pode" data-testid="trd-portador">
    <h2>{{ t('financeiro.cessao.noTitulo') }}</h2>
    <ErroFaturamento v-if="parcelas.error.value" :erro="parcelas.error.value" />
    <ul v-else-if="parcelas.data.value?.length">
      <li v-for="p in parcelas.data.value" :key="p.parcela" :data-testid="`trd-portador-${p.sequencia}`">
        {{ p.sequencia }} · {{ data(p.vencimento) }} · {{ reais(p.saldo) }} ·
        <strong>{{ p.portador ?? t('financeiro.cessao.carteira') }}</strong>
        <template v-if="p.operacao">
          ·
          {{
            t('financeiro.cessao.operacaoDoItem', {
              numero: p.operacao.numero,
              tipo: t(`financeiro.cessao.tiposOperacao.${p.operacao.tipo}`),
              coobrigacao: p.operacao.comCoobrigacao
                ? t('financeiro.cessao.comCoobrigacao')
                : t('financeiro.cessao.semCoobrigacao'),
              situacao: t(`financeiro.cessao.situacoesItem.${p.operacao.situacaoItem}`),
            })
          }}
        </template>
      </li>
    </ul>
    <p v-else-if="parcelas.data.value">{{ t('financeiro.nenhum') }}</p>
    <RouterLink to="/financeiro/receber/cessao" data-testid="trd-ir-cessao">
      {{ t('financeiro.cessao.irParaCessao') }}
    </RouterLink>
  </section>
</template>
