<script setup lang="ts">
// Orçado × realizado de uma versão (M54, etapa 7; regra 14): a visão (centro e item, por centro, por item) e o mês até
// onde acumula; as linhas com o orçado, o realizado, o desvio absoluto e percentual e a avaliação (favorável,
// desfavorável, não orçado); os totais por natureza com a conta das parcelas; o realizado sem rateio por centro e os
// avisos do servidor. Recorte por centro de custo e por item gerencial (com busca, ADR 0027), aplicado no servidor:
// os totais e as parcelas são os do recorte. Só leitura (`financeiro.orcamento.ler`). Páginas de 50 linhas.
import {
  type ApoioOrcamento,
  CENTRO_SEM_CENTRO_ORCAMENTO,
  NATUREZAS_ORCAMENTO,
  ROTULO_SEM_CENTRO,
  ROTULOS_NATUREZA_ORCAMENTO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHoraBr } from '../pep/formato.js';
import { lerComparativoOrcamento } from './api-orcamento.js';
import { chaveLinha, contaComParcelas, NOMES_MESES, percentual, reais } from './comum-orcamento.js';
import ErroOrcamento from './ErroOrcamento.vue';

const props = defineProps<{ id: number; ano: number; hoje: string; apoio: ApoioOrcamento }>();
const { t } = useI18n();
const POR_PAGINA = 50;

type Visao = 'linha' | 'centro' | 'item';
const visao = ref<Visao>('linha');
const anoHoje = Number(props.hoje.slice(0, 4));
const mesHoje = Number(props.hoje.slice(5, 7)) || 12;
// Ano corrente: até o mês de hoje; ano passado: o ano inteiro; ano futuro: dezembro (só o orçado).
const mesAte = ref<number>(props.ano === anoHoje ? mesHoje : 12);
const pagina = ref(0);
const opcoesVisao = (['linha', 'centro', 'item'] as const).map((v) => ({
  valor: v,
  rotulo: t(`orcamentoEmpresarial.comparativo.visoes.${v}`),
}));
const opcoesMes = NOMES_MESES.map((m, i) => ({
  valor: i + 1,
  rotulo: t('orcamentoEmpresarial.comparativo.mesAteRotulo', { mes: m }),
}));

const centro = ref<number | null>(null);
const item = ref<string | null>(null);
const opcoesCentro = computed(() => [
  { valor: null, rotulo: t('orcamentoEmpresarial.comparativo.todos') },
  { valor: CENTRO_SEM_CENTRO_ORCAMENTO, rotulo: ROTULO_SEM_CENTRO },
  ...props.apoio.centros
    .slice()
    .sort((a, b) => a.codigo - b.codigo)
    .map((x) => ({ valor: x.id, rotulo: `${x.codigo} · ${x.nome}` })),
]);
const opcoesItem = computed(() => [
  { valor: null, rotulo: t('orcamentoEmpresarial.comparativo.todos') },
  ...props.apoio.itens.map((i) => {
    const k = `${i.grupo}.${i.subgrupo}.${i.item}`;
    return { valor: k, rotulo: `${k} · ${i.nome} (${i.grupoNome})` };
  }),
]);

const comp = useQuery({
  queryKey: computed(() => [
    'orcamento',
    'comparativo',
    props.id,
    visao.value,
    mesAte.value,
    centro.value,
    item.value,
  ]),
  queryFn: () =>
    lerComparativoOrcamento(props.id, visao.value, mesAte.value, { centro: centro.value, item: item.value }),
});
const c = computed(() => comp.data.value ?? null);
watch([visao, mesAte, centro, item], () => (pagina.value = 0));
const paginas = computed(() => Math.max(1, Math.ceil((c.value?.linhas.length ?? 0) / POR_PAGINA)));
const inicio = computed(() => Math.min(pagina.value, paginas.value - 1) * POR_PAGINA);
const visiveis = computed(() => (c.value?.linhas ?? []).slice(inicio.value, inicio.value + POR_PAGINA));
const totais = computed(() =>
  NATUREZAS_ORCAMENTO.flatMap((n) => c.value?.totais.filter((x) => x.natureza === n) ?? []),
);
const avaliacao = (l: { naoOrcado: boolean; favoravel: boolean }) =>
  l.naoOrcado
    ? t('orcamentoEmpresarial.comparativo.naoOrcado')
    : l.favoravel
      ? t('orcamentoEmpresarial.comparativo.favoravel')
      : t('orcamentoEmpresarial.comparativo.desfavoravel');
const semCentro = computed(() => {
  const s = c.value?.realizadoSemCentroCentavos;
  return s && (s.despesa || s.receita)
    ? t('orcamentoEmpresarial.comparativo.semCentro', {
        despesa: reais(s.despesa),
        receita: reais(s.receita),
      })
    : null;
});
</script>

<template>
  <section class="bloco" aria-labelledby="orc-comp-titulo" data-testid="orc-comparativo">
    <h3 id="orc-comp-titulo">{{ t('orcamentoEmpresarial.comparativo.titulo') }}</h3>
    <p class="secundario">{{ t('orcamentoEmpresarial.comparativo.ajuda') }}</p>
    <div class="campos">
      <SanteSelecao
        v-model="visao"
        :rotulo="t('orcamentoEmpresarial.comparativo.visao')"
        :opcoes="opcoesVisao"
        data-testid="orc-comp-visao"
      />
      <SanteSelecao
        v-model="mesAte"
        :rotulo="t('orcamentoEmpresarial.comparativo.mesAte')"
        :opcoes="opcoesMes"
        data-testid="orc-comp-mes"
      />
      <SanteSelecao
        v-model="centro"
        :rotulo="t('orcamentoEmpresarial.comparativo.centro')"
        :opcoes="opcoesCentro"
        busca
        data-testid="orc-comp-centro"
      />
      <SanteSelecao
        v-model="item"
        :rotulo="t('orcamentoEmpresarial.comparativo.item')"
        :opcoes="opcoesItem"
        busca
        data-testid="orc-comp-item"
      />
    </div>
    <ErroOrcamento v-if="comp.isError.value" :erro="comp.error.value" />
    <p v-else-if="!c" role="status">{{ t('orcamentoEmpresarial.comparativo.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-for="(a, i) in c.avisos"
        :key="i"
        :texto="a"
        variante="info"
        :data-testid="`orc-comp-aviso-${i}`"
      />
      <p v-if="semCentro" class="secundario" data-testid="orc-comp-sem-centro">{{ semCentro }}</p>

      <section
        class="bloco"
        :aria-label="t('orcamentoEmpresarial.comparativo.totais')"
        data-testid="orc-comp-totais"
      >
        <h4>{{ t('orcamentoEmpresarial.comparativo.totais') }}</h4>
        <div v-for="x in totais" :key="x.natureza" :data-testid="`orc-comp-total-${x.natureza}`">
          <p :class="{ favoravel: x.favoravel }">
            {{
              t('orcamentoEmpresarial.comparativo.totalNatureza', {
                natureza: ROTULOS_NATUREZA_ORCAMENTO[x.natureza],
                orcado: reais(x.orcadoCentavos),
                realizado: reais(x.realizadoCentavos),
                desvio: reais(x.desvioCentavos),
                percentual: percentual(x.desvioPercentual),
                avaliacao: avaliacao({ naoOrcado: false, favoravel: x.favoravel }),
              })
            }}
          </p>
          <details>
            <summary>
              {{ t('orcamentoEmpresarial.comparativo.parcelasOrcado', { n: x.parcelasOrcado.length }) }}
            </summary>
            <p class="parcelas" :data-testid="`orc-comp-conta-orcado-${x.natureza}`">
              {{ contaComParcelas(x.parcelasOrcado, x.orcadoCentavos) }}
            </p>
          </details>
          <details>
            <summary>
              {{ t('orcamentoEmpresarial.comparativo.parcelasRealizado', { n: x.parcelasRealizado.length }) }}
            </summary>
            <p class="parcelas" :data-testid="`orc-comp-conta-realizado-${x.natureza}`">
              {{ contaComParcelas(x.parcelasRealizado, x.realizadoCentavos) }}
            </p>
          </details>
        </div>
      </section>

      <p v-if="c.linhas.length === 0" data-testid="orc-comp-nenhuma">
        {{ t('orcamentoEmpresarial.comparativo.nenhuma') }}
      </p>
      <div v-else class="rolagem">
        <table class="tabela" data-testid="orc-comp-tabela">
          <caption class="secundario">
            {{
              t('orcamentoEmpresarial.comparativo.pagina', {
                de: inicio + 1,
                ate: inicio + visiveis.length,
                total: c.linhas.length,
              })
            }}
          </caption>
          <thead>
            <tr>
              <th v-if="c.visao !== 'item'" scope="col">
                {{ t('orcamentoEmpresarial.comparativo.colunas.centro') }}
              </th>
              <th scope="col">{{ t('orcamentoEmpresarial.comparativo.colunas.natureza') }}</th>
              <th v-if="c.visao !== 'centro'" scope="col">
                {{ t('orcamentoEmpresarial.comparativo.colunas.item') }}
              </th>
              <th scope="col" class="numero">{{ t('orcamentoEmpresarial.comparativo.colunas.orcado') }}</th>
              <th scope="col" class="numero">
                {{ t('orcamentoEmpresarial.comparativo.colunas.realizado') }}
              </th>
              <th scope="col" class="numero">{{ t('orcamentoEmpresarial.comparativo.colunas.desvio') }}</th>
              <th scope="col" class="numero">
                {{ t('orcamentoEmpresarial.comparativo.colunas.percentual') }}
              </th>
              <th scope="col">{{ t('orcamentoEmpresarial.comparativo.colunas.avaliacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in visiveis" :key="chaveLinha(l)" :data-testid="`orc-comp-${chaveLinha(l)}`">
              <td v-if="c.visao !== 'item'">{{ l.rotuloCentro }}</td>
              <td>{{ ROTULOS_NATUREZA_ORCAMENTO[l.natureza] }}</td>
              <td v-if="c.visao !== 'centro'">{{ l.rotuloItem }}</td>
              <td class="numero">{{ reais(l.orcadoCentavos) }}</td>
              <td class="numero">{{ reais(l.realizadoCentavos) }}</td>
              <td class="numero">{{ reais(l.desvioCentavos) }}</td>
              <td class="numero">{{ percentual(l.desvioPercentual) }}</td>
              <td :class="{ favoravel: l.favoravel && !l.naoOrcado }">{{ avaliacao(l) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="paginas > 1" class="acoes">
        <SanteBotao
          :rotulo="t('orcamentoEmpresarial.comparativo.anterior')"
          variante="secundario"
          :desabilitado="pagina === 0"
          data-testid="orc-comp-anterior"
          @acionar="pagina = Math.max(0, pagina - 1)"
        />
        <SanteBotao
          :rotulo="t('orcamentoEmpresarial.comparativo.proxima')"
          variante="secundario"
          :desabilitado="pagina >= paginas - 1"
          data-testid="orc-comp-proxima"
          @acionar="pagina = Math.min(paginas - 1, pagina + 1)"
        />
      </div>
      <p class="secundario" data-testid="orc-comp-lido">
        {{ t('orcamentoEmpresarial.comparativo.lidoEm', { quando: dataHoraBr(c.lidoEm) }) }}
      </p>
    </template>
  </section>
</template>

<style scoped src="./estilo-orcamento.css"></style>
