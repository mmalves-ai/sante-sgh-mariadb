<script setup lang="ts">
// Gráfico dos sinais da ficha anestésica (M46, regra 3): o eixo do tempo do início ao fim da anestesia (ou agora), em
// fatias de 5 minutos; uma linha por sinal com marcador próprio (a identidade nunca só pela cor: a legenda e o rótulo no
// fim da linha); as lacunas da grade destacadas (a justificada em tom suave). A tabela dos valores acompanha sempre.
import { INTERVALO_SINAIS_FICHA_MIN, SINAIS_FICHA, type LacunaSinal, type SinalFicha } from '@sgh/contratos';
import { minutosDoInstante } from '@sgh/dominio-cirurgia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  inicio: string | null;
  fim: string;
  pontos: readonly { tipo: string; momento: string; valor: number }[];
  lacunas: readonly LacunaSinal[];
}>();
const { t } = useI18n();

const L = 720;
const A = 240;
const M = { esq: 44, dir: 64, topo: 12, base: 28 };
const SERIES: readonly { tipo: SinalFicha; marcador: string }[] = [
  { tipo: 'pas', marcador: '▼' },
  { tipo: 'pad', marcador: '▲' },
  { tipo: 'fc', marcador: '●' },
  { tipo: 'spo2', marcador: '■' },
];
const t0 = computed(() => (props.inicio ? minutosDoInstante(props.inicio) : null));
const t1 = computed(() =>
  Math.max((t0.value ?? 0) + INTERVALO_SINAIS_FICHA_MIN, minutosDoInstante(props.fim)),
);
const x = (m: number) => M.esq + ((m - (t0.value ?? 0)) / (t1.value - (t0.value ?? 0))) * (L - M.esq - M.dir);
const y = (v: number) => M.topo + (1 - Math.min(Math.max(v, 0), 220) / 220) * (A - M.topo - M.base);
const series = computed(() =>
  SERIES.map((s) => {
    const ps = props.pontos
      .filter((p) => p.tipo === s.tipo)
      .map((p) => ({ m: minutosDoInstante(p.momento), v: p.valor }))
      .sort((a, b) => a.m - b.m);
    return {
      ...s,
      rotulo: SINAIS_FICHA[s.tipo].rotulo,
      ps,
      d: ps.map((p, i) => `${i ? 'L' : 'M'}${x(p.m)},${y(p.v)}`).join(' '),
    };
  }),
);
const marcasTempo = computed(() => {
  if (t0.value === null) return [];
  const r: { m: number; rotulo: string }[] = [];
  const passo = Math.max(INTERVALO_SINAIS_FICHA_MIN, Math.ceil((t1.value - t0.value) / 12 / 5) * 5);
  for (let m = t0.value; m <= t1.value; m += passo) {
    const h = ((m % 1440) + 1440) % 1440;
    r.push({
      m,
      rotulo: `${String(Math.floor(h / 60)).padStart(2, '0')}:${String(h % 60).padStart(2, '0')}`,
    });
  }
  return r;
});
const hora = (v: string) => v.slice(11, 16);
const linhasTabela = computed(() => {
  const porMomento = new Map<string, Record<string, number>>();
  for (const p of props.pontos) {
    const r = porMomento.get(p.momento) ?? {};
    r[p.tipo] = p.valor;
    porMomento.set(p.momento, r);
  }
  return [...porMomento.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
});
</script>

<template>
  <figure class="grafico-sinais" data-testid="grafico-sinais">
    <figcaption>{{ t('anestesia.ficha.grafico') }}</figcaption>
    <p v-if="t0 === null" class="secundario">{{ t('anestesia.ficha.semGrade') }}</p>
    <svg v-else :viewBox="`0 0 ${L} ${A}`" role="img" :aria-label="t('anestesia.ficha.grafico')">
      <rect
        v-for="(l, i) in lacunas"
        :key="`l${i}`"
        :x="x(minutosDoInstante(l.inicio))"
        :y="M.topo"
        :width="Math.max(2, x(minutosDoInstante(l.fim)) - x(minutosDoInstante(l.inicio)))"
        :height="A - M.topo - M.base"
        :class="l.justificada ? 'lacuna justificada' : 'lacuna'"
      />
      <line :x1="M.esq" :x2="L - M.dir" :y1="A - M.base" :y2="A - M.base" class="eixo" />
      <g v-for="mt in marcasTempo" :key="mt.m">
        <text :x="x(mt.m)" :y="A - 8" text-anchor="middle" class="rotulo">{{ mt.rotulo }}</text>
      </g>
      <g v-for="v in [50, 100, 150, 200]" :key="v">
        <line :x1="M.esq" :x2="L - M.dir" :y1="y(v)" :y2="y(v)" class="guia" />
        <text :x="M.esq - 6" :y="y(v) + 4" text-anchor="end" class="rotulo">{{ v }}</text>
      </g>
      <g v-for="s in series" :key="s.tipo" :class="`serie serie-${s.tipo}`">
        <path :d="s.d" fill="none" />
        <text
          v-for="(p, i) in s.ps"
          :key="i"
          :x="x(p.m)"
          :y="y(p.v) + 4"
          text-anchor="middle"
          class="marcador"
        >
          {{ s.marcador }}
        </text>
        <text v-if="s.ps.length" :x="x(s.ps.at(-1)!.m) + 8" :y="y(s.ps.at(-1)!.v) + 4" class="rotulo">
          {{ s.tipo.toUpperCase() }}
        </text>
      </g>
    </svg>
    <ul class="legenda">
      <li v-for="s in series" :key="s.tipo">{{ s.marcador }} {{ s.rotulo }}</li>
    </ul>
    <div class="rolagem">
      <table class="grade" data-testid="tabela-sinais">
        <caption class="secundario">
          {{
            t('anestesia.ficha.tabelaSinais')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('anestesia.horario') }}</th>
            <th v-for="s in series" :key="s.tipo" scope="col">{{ s.tipo.toUpperCase() }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="[m, r] in linhasTabela" :key="m">
            <td>{{ hora(m) }}</td>
            <td v-for="s in series" :key="s.tipo">{{ r[s.tipo] ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </figure>
</template>

<style scoped>
.grafico-sinais svg {
  width: 100%;
  max-width: 48rem;
  height: auto;
}
.eixo,
.guia {
  stroke: var(--sgh-borda);
}
.guia {
  stroke-dasharray: 2 4;
}
.rotulo {
  font-size: 11px;
  fill: var(--sgh-texto-secundario);
}
.lacuna {
  fill: var(--sgh-alerta-suave);
}
.lacuna.justificada {
  fill: var(--sgh-aviso-suave);
}
.serie path {
  stroke: var(--sgh-texto);
  stroke-width: 1.5;
}
.serie-fc path {
  stroke: var(--sgh-primaria);
}
.serie-spo2 path {
  stroke: var(--sgh-sucesso, var(--sgh-texto));
  stroke-dasharray: 4 2;
}
.marcador {
  font-size: 10px;
  fill: var(--sgh-texto);
}
.legenda {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  list-style: none;
  padding: 0;
}
</style>
