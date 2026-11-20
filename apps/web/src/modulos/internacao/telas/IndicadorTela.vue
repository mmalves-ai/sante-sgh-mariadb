<script setup lang="ts">
// Um indicador (M16; ficha, seção 7; regra 11): a ficha técnica inteira, a série mensal com o mesmo mês do ano
// anterior (comparar), os recortes (acomodação, tipo, clínica — só onde o denominador existe), o detalhe de um mês
// aberto pelo recorte e a exportação (numerador e denominador). O mês corrente vem marcado como parcial.
import type { ConsultaIndicador, RecorteIndicador } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { exportarIndicador, lerSerieIndicador } from '../api-internacao.js';
import GraficoSerie from '../componentes/GraficoSerie.vue';
import { baixarTexto, formatarDataHora, formatarMes, formatarNumero, formatarValor } from '../formato.js';

const props = defineProps<{ indicador: string }>();
const { t } = useI18n();
const de = ref('');
const ate = ref('');
const recorte = ref<RecorteIndicador>('todos');
const valor = ref('');
const detalhar = ref('');
const pedido = ref<Partial<ConsultaIndicador>>({});
const serie = useQuery({
  queryKey: computed(() => ['relatorio', 'indicador', props.indicador, pedido.value]),
  queryFn: () => lerSerieIndicador(props.indicador, pedido.value),
});
function aplicar(): void {
  pedido.value = {
    ...(de.value ? { de: de.value } : {}),
    ...(ate.value ? { ate: ate.value } : {}),
    recorte: recorte.value,
    ...(recorte.value !== 'todos' && valor.value ? { valor: valor.value } : {}),
    ...(detalhar.value ? { detalhar: detalhar.value } : {}),
  };
}
function trocarRecorte(): void {
  valor.value = '';
}
// As opções do recorte chegam assim que ele muda (um Aplicar só): da série já carregada quando o recorte é o dela,
// senão de uma consulta própria do mesmo indicador naquele recorte.
const opcoesProprias = useQuery({
  queryKey: computed(() => ['relatorio', 'indicador', props.indicador, 'opcoes', recorte.value]),
  queryFn: () => lerSerieIndicador(props.indicador, { recorte: recorte.value }),
  enabled: computed(() => recorte.value !== 'todos' && recorte.value !== serie.data.value?.recorte),
});
const opcoesRecorte = computed(() =>
  recorte.value === 'todos'
    ? []
    : recorte.value === serie.data.value?.recorte
      ? serie.data.value.opcoesRecorte
      : (opcoesProprias.data.value?.opcoesRecorte ?? []),
);
const recortes = computed<RecorteIndicador[]>(() => ['todos', ...(serie.data.value?.ficha.recortes ?? [])]);
const opcoesRecorteSelecao = computed(() =>
  recortes.value.map((r) => ({ valor: r, rotulo: t(`internacao.indicadores.recortes.${r}`) })),
);
const opcoesValor = computed(() => [
  { valor: '', rotulo: t('internacao.indicadores.todos') },
  ...opcoesRecorte.value.map((o) => ({ valor: o.valor, rotulo: o.rotulo })),
]);
const erroExportar = ref<unknown>(null);
async function exportar(): Promise<void> {
  erroExportar.value = null;
  try {
    baixarTexto(await exportarIndicador(props.indicador, pedido.value), `indicador-${props.indicador}.csv`);
  } catch (e) {
    erroExportar.value = e;
  }
}
const series = computed(() => {
  const s = serie.data.value;
  if (!s) return [];
  return [
    { rotulo: s.ficha.nome, valores: s.valores },
    {
      rotulo: t('internacao.indicadores.anoAnterior'),
      valores: s.valores.map((v, i) => ({ ...(s.anoAnterior[i] ?? v), periodo: v.periodo, parcial: false })),
      secundaria: true,
    },
  ];
});
</script>

<template>
  <section class="tela" aria-labelledby="indicador-titulo">
    <p>
      <RouterLink to="/relatorios/indicadores">{{ t('internacao.indicadores.voltar') }}</RouterLink>
    </p>
    <MensagemErro v-if="serie.isError.value" :erro="serie.error.value" />
    <p v-else-if="serie.isPending.value">{{ t('internacao.comum.carregando') }}</p>
    <template v-else-if="serie.data.value">
      <h1 id="indicador-titulo">{{ serie.data.value.ficha.nome }}</h1>
      <p role="status" data-testid="indicador-dados-ate">
        {{ t('internacao.comum.dadosAte', { quando: formatarDataHora(serie.data.value.dadosAte) }) }}
        <template v-if="serie.data.value.valores.some((v) => v.parcial)">
          · {{ t('internacao.comum.mesParcial') }}</template
        >
      </p>

      <section aria-labelledby="ficha-titulo" class="ficha" data-testid="ficha-tecnica">
        <h2 id="ficha-titulo">{{ t('internacao.indicadores.ficha') }}</h2>
        <dl>
          <dt>{{ t('internacao.indicadores.formula') }}</dt>
          <dd>{{ serie.data.value.ficha.formula }}</dd>
          <dt>{{ t('internacao.indicadores.numerador') }}</dt>
          <dd>{{ serie.data.value.ficha.numerador.descricao }}</dd>
          <dt>{{ t('internacao.indicadores.denominador') }}</dt>
          <dd>
            {{ serie.data.value.ficha.denominador?.descricao ?? t('internacao.indicadores.semDenominador') }}
          </dd>
          <dt>{{ t('internacao.indicadores.fonte') }}</dt>
          <dd>{{ serie.data.value.ficha.fonte }}</dd>
          <dt>{{ t('internacao.indicadores.referencia') }}</dt>
          <dd>{{ serie.data.value.ficha.referencia }}</dd>
          <dt>{{ t('internacao.indicadores.periodicidade') }}</dt>
          <dd>{{ serie.data.value.ficha.periodicidade }}</dd>
          <dt>{{ t('internacao.indicadores.meta') }}</dt>
          <dd>
            {{
              serie.data.value.ficha.meta === null
                ? t('internacao.indicadores.semMeta')
                : formatarValor(serie.data.value.ficha.meta, serie.data.value.ficha.unidade)
            }}
          </dd>
          <dt>{{ t('internacao.indicadores.polaridade') }}</dt>
          <dd>{{ t(`internacao.indicadores.polaridades.${serie.data.value.ficha.polaridade}`) }}</dd>
          <dt>{{ t('internacao.indicadores.responsavel') }}</dt>
          <dd>{{ serie.data.value.ficha.responsavel }}</dd>
          <dt>{{ t('internacao.indicadores.versao') }}</dt>
          <dd>{{ serie.data.value.ficha.versao }}</dd>
          <template v-if="serie.data.value.ficha.limitacoes.length">
            <dt>{{ t('internacao.indicadores.limitacoes') }}</dt>
            <dd>
              <ul>
                <li v-for="l in serie.data.value.ficha.limitacoes" :key="l">{{ l }}</li>
              </ul>
            </dd>
          </template>
        </dl>
      </section>

      <form class="linha" @submit.prevent="aplicar">
        <label for="indicador-de">{{ t('internacao.comum.de') }}</label>
        <input id="indicador-de" v-model="de" type="month" min="2020-01" />
        <label for="indicador-ate">{{ t('internacao.comum.ate') }}</label>
        <input id="indicador-ate" v-model="ate" type="month" min="2020-01" />
        <SanteSelecao
          id="indicador-recorte"
          v-model="recorte"
          :rotulo="t('internacao.indicadores.recorte')"
          :opcoes="opcoesRecorteSelecao"
          data-testid="indicador-recorte"
          @update:model-value="trocarRecorte"
        />
        <template v-if="opcoesRecorte.length > 0">
          <SanteSelecao
            id="indicador-valor"
            v-model="valor"
            :rotulo="t('internacao.indicadores.valorRecorte')"
            :opcoes="opcoesValor"
          />
        </template>
        <label for="indicador-detalhar">{{ t('internacao.indicadores.detalharMes') }}</label>
        <input id="indicador-detalhar" v-model="detalhar" type="month" min="2020-01" />
        <SanteBotao :rotulo="t('internacao.comum.aplicar')" tipo="submit" data-testid="indicador-aplicar" />
        <SanteBotao
          v-if="pode('relatorio.indicadores.exportar')"
          :rotulo="t('internacao.comum.exportar')"
          variante="secundario"
          data-testid="indicador-exportar"
          @acionar="exportar"
        />
      </form>
      <MensagemErro v-if="erroExportar" :erro="erroExportar" />

      <GraficoSerie
        :titulo="t('internacao.indicadores.serie')"
        :unidade="serie.data.value.ficha.unidade"
        :series="series"
        testid="indicador-grafico"
      />
      <table data-testid="indicador-tabela">
        <caption>
          {{
            t('internacao.indicadores.serie')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('internacao.indicadores.periodo') }}</th>
            <th scope="col">{{ t('internacao.indicadores.numerador') }}</th>
            <th scope="col">{{ t('internacao.indicadores.denominador') }}</th>
            <th scope="col">{{ t('internacao.indicadores.valor') }}</th>
            <th scope="col">{{ t('internacao.indicadores.anoAnterior') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(v, i) in serie.data.value.valores"
            :key="v.periodo"
            :data-testid="`indicador-mes-${v.periodo}`"
          >
            <th scope="row">
              {{ formatarMes(v.periodo)
              }}<span v-if="v.parcial" data-testid="marca-parcial">
                ({{ t('internacao.comum.parcial') }})</span
              >
            </th>
            <td>{{ formatarNumero(v.numerador) }}</td>
            <td>{{ formatarNumero(v.denominador) }}</td>
            <td>{{ formatarValor(v.valor, serie.data.value.ficha.unidade) }}</td>
            <td>
              {{
                formatarValor(serie.data.value.anoAnterior[i]?.valor ?? null, serie.data.value.ficha.unidade)
              }}
            </td>
          </tr>
        </tbody>
      </table>

      <section v-if="serie.data.value.detalhe.length" aria-labelledby="detalhe-titulo">
        <h2 id="detalhe-titulo">
          {{
            t('internacao.indicadores.detalhe', { mes: formatarMes(serie.data.value.periodoDetalhe ?? '') })
          }}
        </h2>
        <table data-testid="indicador-detalhe">
          <thead>
            <tr>
              <th scope="col">{{ t('internacao.indicadores.recorte') }}</th>
              <th scope="col">{{ t('internacao.indicadores.numerador') }}</th>
              <th scope="col">{{ t('internacao.indicadores.denominador') }}</th>
              <th scope="col">{{ t('internacao.indicadores.valor') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in serie.data.value.detalhe" :key="d.chave">
              <th scope="row">{{ d.rotulo }}</th>
              <td>{{ formatarNumero(d.numerador) }}</td>
              <td>{{ formatarNumero(d.denominador) }}</td>
              <td>{{ formatarValor(d.valor, serie.data.value.ficha.unidade) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
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
.ficha dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.ficha dt {
  font-weight: 600;
}
.ficha dd {
  margin: 0;
}
table {
  border-collapse: collapse;
  margin: var(--sgh-espaco-2) 0;
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
</style>
