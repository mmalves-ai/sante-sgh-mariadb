<script setup lang="ts">
// Indicadores hospitalares (M16; ficha, seção 7; regras 11 e 14): cada indicador com a ficha, o último mês fechado
// (numerador e denominador), a meta (parâmetro) e a situação pela polaridade. Abrir leva à série e ao detalhe.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerIndice } from '../api-internacao.js';
import {
  formatarData,
  formatarDataHora,
  formatarMes,
  formatarNumero,
  formatarValor,
  hojeNoEstabelecimento,
  semMovimentoRecente,
} from '../formato.js';

const { t } = useI18n();
const de = ref('');
const ate = ref('');
const pedido = ref<{ de?: string; ate?: string }>({});
const indice = useQuery({
  queryKey: computed(() => ['relatorio', 'indicadores', pedido.value]),
  queryFn: () => lerIndice(pedido.value.de, pedido.value.ate),
});
const aplicar = () =>
  (pedido.value = { ...(de.value ? { de: de.value } : {}), ...(ate.value ? { ate: ate.value } : {}) });
const hoje = hojeNoEstabelecimento();
</script>

<template>
  <section class="tela" aria-labelledby="ind-titulo">
    <h1 id="ind-titulo">{{ t('internacao.indicadores.titulo') }}</h1>
    <p>{{ t('internacao.indicadores.texto') }}</p>
    <form class="linha" @submit.prevent="aplicar">
      <label for="ind-de">{{ t('internacao.comum.de') }}</label>
      <input id="ind-de" v-model="de" type="month" min="2020-01" />
      <label for="ind-ate">{{ t('internacao.comum.ate') }}</label>
      <input id="ind-ate" v-model="ate" type="month" min="2020-01" />
      <SanteBotao :rotulo="t('internacao.comum.aplicar')" tipo="submit" />
    </form>
    <MensagemErro v-if="indice.isError.value" :erro="indice.error.value" />
    <p v-else-if="indice.isPending.value">{{ t('internacao.comum.carregando') }}</p>
    <template v-else-if="indice.data.value">
      <p role="status" data-testid="ind-dados-ate">
        {{
          t('internacao.comum.periodo', {
            de: formatarMes(indice.data.value.periodo.de),
            ate: formatarMes(indice.data.value.periodo.ate),
          })
        }}
        ·
        {{ t('internacao.comum.dadosAte', { quando: formatarDataHora(indice.data.value.dadosAte) }) }}
      </p>
      <SanteAlerta
        v-if="semMovimentoRecente(indice.data.value.ultimoMovimento, hoje)"
        :texto="t('internacao.comum.semMovimento', { data: formatarData(indice.data.value.ultimoMovimento) })"
        variante="aviso"
      />
      <table data-testid="ind-tabela">
        <caption>
          {{
            t('internacao.indicadores.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('internacao.indicadores.indicador') }}</th>
            <th scope="col">{{ t('internacao.indicadores.ultimoFechado') }}</th>
            <th scope="col">
              {{ t('internacao.indicadores.numerador') }} / {{ t('internacao.indicadores.denominador') }}
            </th>
            <th scope="col">{{ t('internacao.indicadores.meta') }}</th>
            <th scope="col">{{ t('internacao.indicadores.situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="i in indice.data.value.indicadores"
            :key="i.ficha.codigo"
            :data-testid="`ind-${i.ficha.codigo}`"
          >
            <th scope="row">
              <RouterLink
                :to="`/relatorios/indicadores/${i.ficha.codigo}`"
                :aria-label="t('internacao.indicadores.abrir', { nome: i.ficha.nome })"
              >
                {{ i.ficha.nome }}
              </RouterLink>
            </th>
            <td>
              {{ formatarValor(i.ultimo?.valor ?? null, i.ficha.unidade) }}
              <span v-if="i.ultimo" class="secundario"
                >({{ formatarMes(i.ultimo.periodo)
                }}<template v-if="i.ultimo.parcial">, {{ t('internacao.comum.parcial') }}</template
                >)</span
              >
            </td>
            <td>
              {{ formatarNumero(i.ultimo?.numerador) }} /
              {{ i.ficha.denominador ? formatarNumero(i.ultimo?.denominador) : '—' }}
            </td>
            <td>
              {{
                i.ficha.meta === null
                  ? t('internacao.indicadores.semMeta')
                  : formatarValor(i.ficha.meta, i.ficha.unidade)
              }}
            </td>
            <td>{{ t(`internacao.indicadores.situacoes.${i.situacao}`) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="secundario">{{ t('internacao.indicadores.metaParametro') }}</p>
    </template>
  </section>
</template>

<style scoped>
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
  margin: var(--sgh-espaco-2) 0;
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
caption {
  text-align: left;
  font-weight: 600;
}
.secundario {
  color: var(--sgh-texto-secundario);
}
</style>
