<script setup lang="ts">
// A série consolidada de um indicador da Rede (M57, etapa 3; regra 8): mês a mês, o valor da Rede, a parte de cada
// estabelecimento (numerador e denominador) e a conta à vista; a planilha com as mesmas colunas.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { formatarMes, formatarNumero, formatarValor } from '../../internacao/formato.js';
import { enderecoPlanilhaBiRede, lerSerieBiRede, type PeriodoBi } from '../api-bi-rede.js';

const props = defineProps<{ codigo: string; periodo: PeriodoBi }>();
const emit = defineEmits<{ fechar: [] }>();
const { t } = useI18n();
const serie = useQuery({
  queryKey: computed(() => ['biRede', 'serie', props.codigo, props.periodo]),
  queryFn: () => lerSerieBiRede(props.codigo, props.periodo),
});
const s = computed(() => serie.data.value);
const incluidos = computed(() => (s.value?.estabelecimentos ?? []).filter((e) => e.situacao === 'incluido'));
const parcela = (v: { parcelas: readonly { estabelecimento: string }[] }, cod: string) =>
  v.parcelas.find((p) => p.estabelecimento === cod) as
    { numerador: number; denominador: number | null; valor: number | null } | undefined;
</script>

<template>
  <section class="serie" aria-labelledby="bi-rede-serie-titulo" data-testid="bi-rede-serie">
    <MensagemErro v-if="serie.isError.value" :erro="serie.error.value" />
    <p v-else-if="!s">{{ t('biRede.carregando') }}</p>
    <template v-else>
      <h2 id="bi-rede-serie-titulo">{{ t('biRede.serie.titulo', { nome: s.ficha.nome }) }}</h2>
      <p class="secundario">
        {{ t('biRede.indicadores.formula', { formula: s.ficha.formula }) }} ·
        {{ t('biRede.indicadores.versao', { versao: s.ficha.versao }) }}
      </p>
      <SanteAlerta
        v-if="s.recusa"
        :texto="`${t(`biRede.recusas.${s.recusa.motivo}`)} ${s.recusa.mensagem}`"
        variante="aviso"
        data-testid="bi-rede-serie-recusa"
      />
      <table v-else data-testid="bi-rede-serie-tabela">
        <caption>
          {{
            t('biRede.serie.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('biRede.serie.mes') }}</th>
            <th scope="col">{{ t('biRede.indicadores.rede') }}</th>
            <th v-for="e in incluidos" :key="e.codigo" scope="col">{{ e.nome }}</th>
            <th scope="col">{{ t('biRede.indicadores.conta') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in s.valores" :key="v.periodo">
            <th scope="row">
              {{ formatarMes(v.periodo) }}
              <span v-if="v.parcial" class="secundario">({{ t('biRede.indicadores.parcial') }})</span>
            </th>
            <td>{{ formatarValor(v.valor, s.ficha.unidade) }}</td>
            <td v-for="e in incluidos" :key="e.codigo">
              <template v-if="parcela(v, e.codigo)">
                {{ formatarValor(parcela(v, e.codigo)!.valor, s.ficha.unidade) }}
                <span class="secundario"
                  >({{ formatarNumero(parcela(v, e.codigo)!.numerador)
                  }}<template v-if="s.ficha.denominador">
                    / {{ formatarNumero(parcela(v, e.codigo)!.denominador) }}</template
                  >)</span
                >
              </template>
              <template v-else>—</template>
            </td>
            <td class="conta">{{ v.conta }}</td>
          </tr>
        </tbody>
      </table>
      <p class="acoes">
        <a :href="enderecoPlanilhaBiRede(codigo, periodo)" data-testid="bi-rede-exportar">{{
          t('biRede.serie.exportar')
        }}</a>
        <SanteBotao :rotulo="t('biRede.serie.fechar')" variante="texto" @acionar="emit('fechar')" />
      </p>
    </template>
  </section>
</template>

<style scoped>
.serie {
  margin-top: var(--sgh-espaco-4);
  border-top: 1px solid var(--sgh-borda);
  padding-top: var(--sgh-espaco-2);
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
.conta {
  font-variant-numeric: tabular-nums;
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
</style>
