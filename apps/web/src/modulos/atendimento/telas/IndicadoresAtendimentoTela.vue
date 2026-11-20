<script setup lang="ts">
// Indicadores do ambulatório e do pronto atendimento (ficha do M20, seção 4, "Indicadores ambulatório e PA"):
// `/recepcao/atendimento/indicadores`. O período (até 366 dias) e a unidade; os atendimentos com consulta (o
// denominador: as requisições de laboratório à parte, regra 3), por tipo e por caráter; no pronto atendimento, a
// chegada ao médico, à decisão e a permanência (medianas, só dos atendimentos com marcas de tempo deste sistema), a
// evasão (regra 8) e a observação acima de 24 horas (regra 7); os desfechos. Toda conta agregada com as parcelas.
import type { IndicadoresAtendimento } from '@sgh/contratos';
import { csvIndicadoresPa, linhasIndicadoresPa } from '@sgh/dominio-atendimento';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../agenda/formato.js';
import { baixarTexto } from '../../internacao/formato.js';
import { lerIndicadoresAtendimento } from '../api-atendimento.js';
import ErroAtendimento from '../componentes/ErroAtendimento.vue';
import { usarAtendimento } from '../usar-atendimento.js';

const { t } = useI18n();
const { apoio } = usarAtendimento();
const iso = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const hoje = iso(new Date());
const inicio = ref(iso(new Date(Date.now() - 29 * 86_400_000)));
const fim = ref(hoje);
const unidade = ref('');
const pedido = ref({ inicio: inicio.value, fim: fim.value, unidade: '' });
const indicadores = useQuery({
  queryKey: computed(() => ['atendimento', 'indicadores', pedido.value]),
  queryFn: (): Promise<IndicadoresAtendimento> =>
    lerIndicadoresAtendimento(
      pedido.value.inicio,
      pedido.value.fim,
      pedido.value.unidade ? Number(pedido.value.unidade) : null,
    ),
});
const unidades = computed(() => [
  { valor: '', rotulo: t('atendimento.todasUnidades') },
  ...(apoio.data.value?.unidades ?? []).map((u) => ({ valor: String(u.codigo), rotulo: u.nome })),
]);
const minutos = (n: number | null) =>
  n === null ? t('atendimento.painelIndicadores.semMarcasAinda') : t('atendimento.minutos', { n });
const somaTipos = computed(() => (indicadores.data.value?.porTipo ?? []).reduce((s, x) => s + x.total, 0));
const somaCarater = computed(() =>
  (indicadores.data.value?.porCarater ?? []).reduce((s, x) => s + x.total, 0),
);
const linhasPa = computed(() => (indicadores.data.value ? linhasIndicadoresPa(indicadores.data.value) : []));
const exportarPa = () => {
  const d = indicadores.data.value;
  if (d) baixarTexto(csvIndicadoresPa(d), `indicadores-pa-${d.inicio}-${d.fim}.csv`);
};
const somaDesfechos = computed(() =>
  (indicadores.data.value?.desfechos ?? []).reduce((s, x) => s + x.total, 0),
);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ind-atd-titulo" data-testid="tela-indicadores-atendimento">
    <h1 id="ind-atd-titulo">{{ t('atendimento.painelIndicadores.titulo') }}</h1>
    <p>{{ t('atendimento.painelIndicadores.texto') }}</p>
    <form class="filtros" @submit.prevent="pedido = { inicio, fim, unidade }" data-testid="form-indicadores">
      <div class="campo">
        <label for="ind-atd-inicio">{{ t('atendimento.painelIndicadores.inicio') }}</label>
        <input id="ind-atd-inicio" v-model="inicio" type="date" data-testid="ind-atd-inicio" />
      </div>
      <div class="campo">
        <label for="ind-atd-fim">{{ t('atendimento.painelIndicadores.fim') }}</label>
        <input id="ind-atd-fim" v-model="fim" type="date" data-testid="ind-atd-fim" />
      </div>
      <SanteSelecao v-model="unidade" :rotulo="t('atendimento.unidade')" :opcoes="unidades" />
      <SanteBotao tipo="submit" :rotulo="t('atendimento.painelIndicadores.calcular')" />
    </form>
    <ErroAtendimento v-if="indicadores.isError.value" :erro="indicadores.error.value" />
    <p v-else-if="!indicadores.data.value" role="status">{{ t('atendimento.carregando') }}</p>
    <template v-else>
      <p role="status" data-testid="ind-atd-periodo">
        {{
          t('atendimento.painelIndicadores.periodo', {
            inicio: dataBr(indicadores.data.value.inicio),
            fim: dataBr(indicadores.data.value.fim),
          })
        }}
      </p>
      <section class="painel" aria-labelledby="ind-atd-volume">
        <h2 id="ind-atd-volume">{{ t('atendimento.painelIndicadores.volume') }}</h2>
        <ul class="cartoes" data-testid="ind-atd-volume">
          <li>{{ t('atendimento.indicadores.atendimentos', { n: indicadores.data.value.atendimentos }) }}</li>
          <li>
            {{
              t('atendimento.indicadores.requisicoes', { n: indicadores.data.value.requisicoesLaboratorio })
            }}
          </li>
        </ul>
        <table class="tabela">
          <caption>
            {{
              t('atendimento.painelIndicadores.porTipo', { n: somaTipos })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('atendimento.tipo') }}</th>
              <th scope="col">{{ t('atendimento.painelIndicadores.total') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in indicadores.data.value.porTipo" :key="x.tipo">
              <td>{{ x.rotulo }}</td>
              <td>{{ x.total }}</td>
            </tr>
          </tbody>
        </table>
        <table class="tabela">
          <caption>
            {{
              t('atendimento.painelIndicadores.porCarater', { n: somaCarater })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('atendimento.carater') }}</th>
              <th scope="col">{{ t('atendimento.painelIndicadores.total') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in indicadores.data.value.porCarater" :key="x.carater">
              <td>{{ x.carater }}</td>
              <td>{{ x.total }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section class="painel" aria-labelledby="ind-atd-pa">
        <h2 id="ind-atd-pa">{{ t('atendimento.painelIndicadores.pa') }}</h2>
        <ul class="cartoes" data-testid="ind-atd-pa">
          <li>
            {{
              t('atendimento.painelIndicadores.paParcelas', {
                n: indicadores.data.value.pa.atendimentos,
                com: indicadores.data.value.pa.comMarcas,
                sem: indicadores.data.value.semMarcas,
              })
            }}
          </li>
          <li>
            {{ t('atendimento.painelIndicadores.portaMedico') }}:
            {{ minutos(indicadores.data.value.pa.portaMedicoMedianaMin) }}
          </li>
          <li>
            {{ t('atendimento.painelIndicadores.portaDecisao') }}:
            {{ minutos(indicadores.data.value.pa.portaDecisaoMedianaMin) }}
          </li>
          <li>
            {{ t('atendimento.painelIndicadores.permanencia') }}:
            {{ minutos(indicadores.data.value.pa.permanenciaMedianaMin) }}
          </li>
          <li data-testid="ind-atd-evasao">
            {{
              indicadores.data.value.pa.taxaEvasao === null
                ? t('atendimento.painelIndicadores.evasaoSem')
                : t('atendimento.painelIndicadores.evasao', {
                    taxa: String(indicadores.data.value.pa.taxaEvasao).replace('.', ','),
                    n: indicadores.data.value.pa.evasoes,
                    de: indicadores.data.value.pa.comDesfecho,
                  })
            }}
          </li>
          <li>
            {{
              t('atendimento.painelIndicadores.observacao', {
                n: indicadores.data.value.pa.observacoes,
                acima: indicadores.data.value.pa.observacoesAcima24h,
              })
            }}
          </li>
        </ul>
        <p class="secundario">{{ t('atendimento.painelIndicadores.medianasTexto') }}</p>
      </section>
      <section class="painel" aria-labelledby="ind-atd-qualidade-pa">
        <h2 id="ind-atd-qualidade-pa">{{ t('atendimento.painelIndicadores.qualidadePa') }}</h2>
        <p class="secundario">{{ t('atendimento.painelIndicadores.qualidadePaTexto') }}</p>
        <table class="tabela" data-testid="ind-atd-qualidade-pa">
          <thead>
            <tr>
              <th scope="col">{{ t('atendimento.painelIndicadores.indicador') }}</th>
              <th scope="col">{{ t('atendimento.painelIndicadores.numerador') }}</th>
              <th scope="col">{{ t('atendimento.painelIndicadores.denominador') }}</th>
              <th scope="col">{{ t('atendimento.painelIndicadores.taxa') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in linhasPa" :key="l.indicador">
              <td>{{ l.indicador }}</td>
              <td>{{ l.numerador }}</td>
              <td>{{ l.denominador }}</td>
              <td>
                {{
                  l.taxa === null
                    ? t('atendimento.painelIndicadores.semDenominador')
                    : String(l.taxa).replace('.', ',')
                }}
              </td>
            </tr>
          </tbody>
        </table>
        <SanteBotao
          :rotulo="t('atendimento.painelIndicadores.exportar')"
          data-testid="ind-atd-exportar-pa"
          @acionar="exportarPa"
        />
      </section>
      <section class="painel" aria-labelledby="ind-atd-desfechos">
        <h2 id="ind-atd-desfechos">{{ t('atendimento.painelIndicadores.desfechos') }}</h2>
        <table class="tabela" data-testid="ind-atd-desfechos">
          <caption>
            {{
              t('atendimento.painelIndicadores.desfechosLegenda', { n: somaDesfechos })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('atendimento.encerrar.desfecho') }}</th>
              <th scope="col">{{ t('atendimento.painelIndicadores.total') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in indicadores.data.value.desfechos" :key="x.desfecho">
              <td>{{ x.rotulo }}</td>
              <td>{{ x.total }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
