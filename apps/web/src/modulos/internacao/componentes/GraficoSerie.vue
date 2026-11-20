<script setup lang="ts">
// Gráfico de linha de uma série mensal (M16): um eixo só, linha fina, marcadores com a dica ao passar (valor,
// numerador e denominador), o mês parcial com marcador vazado; a segunda série (o ano anterior) tracejada e na cor
// secundária, com legenda e rótulo direto (a identidade nunca só pela cor). A tabela dos valores acompanha sempre.
import type { UnidadeIndicador } from '@sgh/contratos';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatarMes, formatarNumero, formatarValor } from '../formato.js';

interface Ponto {
  readonly periodo: string;
  readonly valor: number | null;
  readonly numerador?: number | null;
  readonly denominador?: number | null;
  readonly parcial: boolean;
}

const props = defineProps<{
  titulo: string;
  unidade: UnidadeIndicador | 'reais';
  series: readonly { rotulo: string; valores: readonly Ponto[]; secundaria?: boolean }[];
  testid?: string;
}>();
const { t } = useI18n();

const L = 640;
const A = 220;
const M = { esq: 56, dir: 16, topo: 12, base: 32 };
const meses = computed(() => props.series[0]?.valores.map((v) => v.periodo) ?? []);
const maximo = computed(() => {
  const m = Math.max(0, ...props.series.flatMap((s) => s.valores.map((v) => v.valor ?? 0)));
  return m > 0 ? m * 1.1 : 1;
});
const x = (i: number) =>
  M.esq + (meses.value.length <= 1 ? 0 : (i * (L - M.esq - M.dir)) / (meses.value.length - 1));
const y = (v: number) => A - M.base - (v / maximo.value) * (A - M.topo - M.base);
const caminho = (valores: readonly Ponto[]) => {
  let d = '';
  let caneta = false;
  valores.forEach((p, i) => {
    if (p.valor === null) {
      caneta = false;
      return;
    }
    d += `${caneta ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.valor).toFixed(1)} `;
    caneta = true;
  });
  return d.trim();
};
const marcas = computed(() => [0, 0.5, 1].map((f) => ({ v: maximo.value * f, y: y(maximo.value * f) })));
const passo = computed(() => Math.max(1, Math.ceil(meses.value.length / 8)));
const dica = (s: string, p: Ponto) =>
  [
    `${s} · ${formatarMes(p.periodo)}: ${formatarValor(p.valor, props.unidade)}`,
    p.numerador !== undefined && p.numerador !== null
      ? `${t('internacao.indicadores.numerador')} ${formatarNumero(p.numerador)}`
      : '',
    p.denominador !== undefined && p.denominador !== null
      ? `${t('internacao.indicadores.denominador')} ${formatarNumero(p.denominador)}`
      : '',
    p.parcial ? t('internacao.comum.parcial') : '',
  ]
    .filter(Boolean)
    .join(' · ');
const foco = ref<string | null>(null);
</script>

<template>
  <figure class="grafico" :data-testid="testid">
    <figcaption>{{ titulo }}</figcaption>
    <ul v-if="series.length > 1" class="legenda">
      <li v-for="s in series" :key="s.rotulo">
        <svg width="24" height="8" aria-hidden="true">
          <line x1="0" y1="4" x2="24" y2="4" :class="s.secundaria ? 'linha secundaria' : 'linha'" />
        </svg>
        {{ s.rotulo }}
      </li>
    </ul>
    <svg :viewBox="`0 0 ${L} ${A}`" role="img" :aria-label="titulo" class="area">
      <g class="grade">
        <line v-for="m in marcas" :key="m.v" :x1="M.esq" :x2="L - M.dir" :y1="m.y" :y2="m.y" />
        <text v-for="m in marcas" :key="`r${m.v}`" :x="M.esq - 6" :y="m.y + 4" text-anchor="end">
          {{ formatarValor(Math.round(m.v * 10) / 10, unidade) }}
        </text>
      </g>
      <g class="eixo-x">
        <text
          v-for="(mes, i) in meses"
          v-show="i % passo === 0 || i === meses.length - 1"
          :key="mes"
          :x="x(i)"
          :y="A - 10"
          text-anchor="middle"
        >
          {{ formatarMes(mes) }}
        </text>
      </g>
      <g v-for="s in series" :key="s.rotulo">
        <path :d="caminho(s.valores)" :class="s.secundaria ? 'linha secundaria' : 'linha'" fill="none" />
        <template v-for="(p, i) in s.valores" :key="p.periodo">
          <g v-if="p.valor !== null">
            <circle
              :cx="x(i)"
              :cy="y(p.valor)"
              r="12"
              class="alvo"
              tabindex="0"
              :aria-label="dica(s.rotulo, p)"
              @focus="foco = dica(s.rotulo, p)"
              @blur="foco = null"
              @mouseenter="foco = dica(s.rotulo, p)"
              @mouseleave="foco = null"
            >
              <title>{{ dica(s.rotulo, p) }}</title>
            </circle>
            <circle
              :cx="x(i)"
              :cy="y(p.valor)"
              r="4"
              :class="['marcador', { secundaria: s.secundaria, parcial: p.parcial }]"
              pointer-events="none"
            />
          </g>
        </template>
      </g>
    </svg>
    <p class="dica" aria-live="polite">{{ foco ?? '' }}</p>
    <details>
      <summary>{{ t('internacao.comum.tabela') }}</summary>
      <table>
        <thead>
          <tr>
            <th scope="col">{{ t('internacao.indicadores.periodo') }}</th>
            <th v-for="s in series" :key="s.rotulo" scope="col">{{ s.rotulo }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(mes, i) in meses" :key="mes">
            <th scope="row">
              {{ formatarMes(mes)
              }}<span v-if="series[0]?.valores[i]?.parcial"> ({{ t('internacao.comum.parcial') }})</span>
            </th>
            <td v-for="s in series" :key="s.rotulo">
              {{ formatarValor(s.valores[i]?.valor ?? null, unidade) }}
            </td>
          </tr>
        </tbody>
      </table>
    </details>
  </figure>
</template>

<style scoped>
.grafico {
  margin: var(--sgh-espaco-2) 0;
  max-width: 48rem;
}
figcaption {
  font-weight: 600;
}
.area {
  width: 100%;
  height: auto;
}
.grade line {
  stroke: var(--sgh-borda);
  stroke-width: 1;
}
text {
  fill: var(--sgh-texto-secundario);
  font-size: 11px;
}
.linha {
  stroke: var(--sgh-primaria);
  stroke-width: 2;
}
.linha.secundaria {
  stroke: var(--sgh-texto-secundario);
  stroke-dasharray: 6 4;
}
.marcador {
  fill: var(--sgh-primaria);
  stroke: var(--sgh-fundo);
  stroke-width: 2;
}
.marcador.secundaria {
  fill: var(--sgh-texto-secundario);
}
.marcador.parcial {
  fill: var(--sgh-fundo);
  stroke: var(--sgh-primaria);
}
.alvo {
  fill: transparent;
  cursor: pointer;
}
.alvo:focus-visible {
  outline: none;
  stroke: var(--sgh-foco);
  stroke-width: 2;
}
.legenda {
  display: flex;
  gap: var(--sgh-espaco-3);
  list-style: none;
  padding: 0;
  margin: var(--sgh-espaco-1) 0;
  color: var(--sgh-texto);
}
.dica {
  min-height: 1.5em;
  margin: 0;
  color: var(--sgh-texto);
  font-size: var(--sgh-fonte-pequena);
}
table {
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 2px var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
</style>
