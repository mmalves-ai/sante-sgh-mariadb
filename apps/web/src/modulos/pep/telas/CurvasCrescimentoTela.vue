<script setup lang="ts">
// Curvas de crescimento do paciente (03-PEP L141), numa tela só por paciente: a referência da idade de hoje (OMS 2006,
// OMS 2007 ou INTERGROWTH-21st no prematuro, com a idade corrigida), o gráfico do indicador escolhido com as linhas de
// escore Z da Caderneta da Criança (-3, -2, 0, +2, +3) e os pontos do paciente coloridos pela classificação, a tabela
// acessível dos mesmos pontos e a medida nova em uma linha (peso, estatura e perímetro cefálico juntos, IMC calculado
// na hora). Validação na hora pela regra do domínio (unidade impossível, data futura, sem medida); a regra final e o
// escore Z são do servidor. Nada é apagado: a medida é uma aferição do prontuário.
import { imcDe, validarMedidaCrescimento } from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  type GraficoCrescimentoTela,
  lerCrescimento,
  type MedidaCrescimentoTela,
  registrarMedidaCrescimento,
} from '../api-curvas-crescimento.js';

const props = defineProps<{ paciente: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const id = computed(() => Number(props.paciente));
const chave = computed(() => ['pep', 'crescimento', id.value]);
const dados = useQuery({ queryKey: chave, queryFn: () => lerCrescimento(id.value), staleTime: 0 });
const d = computed(() => dados.data.value);
const erro = ref<unknown>(null);
const ok = ref('');
const INDICADORES = ['peso', 'estatura', 'perimetro_cefalico', 'imc'] as const;
type Indicador = (typeof INDICADORES)[number];

const indicador = ref<Indicador>('peso');
const escolhida = ref('');
const graficosDoIndicador = computed(() =>
  (d.value?.graficos ?? []).filter((g) => g.indicador === indicador.value),
);
const opcoesCurva = computed(() =>
  graficosDoIndicador.value.map((g) => ({
    valor: g.codigo,
    rotulo: t(`pep.crescimento.publicacoes.${g.publicacao}`),
  })),
);
// A curva da idade de hoje vem primeiro; as demais (fases anteriores) ficam no combo.
watch(
  [graficosDoIndicador, () => d.value?.referenciaAtual],
  ([gs, ref0]) => {
    if (gs.some((g) => g.codigo === escolhida.value)) return;
    escolhida.value = (gs.find((g) => g.publicacao === ref0?.publicacao) ?? gs[0])?.codigo ?? '';
  },
  { immediate: true },
);
const grafico = computed<GraficoCrescimentoTela | null>(
  () => graficosDoIndicador.value.find((g) => g.codigo === escolhida.value) ?? null,
);

// Desenho do gráfico (SVG sem biblioteca): escalas pela faixa das linhas e dos pontos.
const L = 640;
const A = 360;
const M = { e: 48, d: 16, t: 12, b: 36 };
const desenho = computed(() => {
  const g = grafico.value;
  if (!g || g.linhas.length === 0) return null;
  const xs = [...g.linhas.map((p) => p.x), ...g.pontos.map((p) => p.x)];
  const ys = [...g.linhas.flatMap((p) => p.valores), ...g.pontos.map((p) => p.y)];
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const folga = (y1 - y0) * 0.04 || 1;
  const sx = (x: number) => M.e + ((x - x0) / (x1 - x0 || 1)) * (L - M.e - M.d);
  const sy = (y: number) => A - M.b - ((y - (y0 - folga)) / (y1 - y0 + 2 * folga)) * (A - M.t - M.b);
  const linhas = [0, 1, 2, 3, 4].map((i) => ({
    classe: i === 2 ? 'mediana' : i === 1 || i === 3 ? 'dois' : 'tres',
    pontos: g.linhas.map((p) => `${sx(p.x).toFixed(1)},${sy(p.valores[i]!).toFixed(1)}`).join(' '),
  }));
  const passos = 6;
  const marcasX = Array.from({ length: passos + 1 }, (_, i) => x0 + ((x1 - x0) * i) / passos).map((v) => ({
    v: Math.round(v),
    x: sx(v),
  }));
  const marcasY = Array.from({ length: passos + 1 }, (_, i) => y0 + ((y1 - y0) * i) / passos).map((v) => ({
    v: v >= 10 ? Math.round(v) : Math.round(v * 10) / 10,
    y: sy(v),
  }));
  const pontos = g.pontos.map((p) => ({ ...p, cx: sx(p.x), cy: sy(p.y) }));
  return {
    linhas,
    marcasX,
    marcasY,
    pontos,
    trajeto: pontos.map((p) => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' '),
  };
});
const eixoX = computed(() =>
  grafico.value?.eixo === 'idade_gestacional_semanas'
    ? t('pep.crescimento.eixoSemanas')
    : t('pep.crescimento.eixoMeses'),
);

// Medida nova: validação na hora pela regra do domínio.
const podeGravar = computed(() => pode('pep.evolucao.criar'));
const agoraLocal = () => {
  const n = new Date();
  return new Date(n.getTime() - n.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const nova = reactive({ medidoEm: agoraLocal(), peso: '', estatura: '', perimetro: '', observacao: '' });
const numero = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
const falhas = computed(() =>
  validarMedidaCrescimento(
    {
      pesoKg: numero(nova.peso),
      estaturaCm: numero(nova.estatura),
      perimetroCefalicoCm: numero(nova.perimetro),
      medidoEm: new Date(nova.medidoEm),
      nascimento: d.value?.paciente.nascimento ? new Date(d.value.paciente.nascimento) : null,
    },
    new Date(),
  ),
);
// "Sem medida" só bloqueia o botão; as demais falhas aparecem enquanto se digita.
const falhasVisiveis = computed(() => falhas.value.filter((f) => f.codigo !== 'medida-vazia'));
const imcPrevisto = computed(() => imcDe(numero(nova.peso), numero(nova.estatura)));
const enviando = ref(false);
async function registrar() {
  if (falhas.value.length) return;
  erro.value = null;
  ok.value = '';
  enviando.value = true;
  try {
    await registrarMedidaCrescimento({
      paciente: id.value,
      medidoEm: new Date(nova.medidoEm).toISOString(),
      pesoKg: numero(nova.peso),
      estaturaCm: numero(nova.estatura),
      perimetroCefalicoCm: numero(nova.perimetro),
      observacao: nova.observacao.trim() || null,
    });
    Object.assign(nova, { medidoEm: agoraLocal(), peso: '', estatura: '', perimetro: '', observacao: '' });
    ok.value = t('pep.crescimento.gravada');
    await cliente.invalidateQueries({ queryKey: chave.value });
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}

const dataBr = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const idadeTexto = (m: MedidaCrescimentoTela) => {
  const r = m.referencia;
  if (!r) return '';
  if (r.publicacao === 'intergrowth') return t('pep.crescimento.semanas', { n: r.x.toFixed(1) });
  const meses = t('pep.crescimento.meses', { n: r.idadeMeses.toFixed(1) });
  return r.corrigida ? `${meses} (${t('pep.crescimento.corrigida')} ${r.x.toFixed(1)})` : meses;
};
const avaliacao = (m: MedidaCrescimentoTela, ind: Indicador) => m.avaliacoes[ind] ?? null;
const valor = (m: MedidaCrescimentoTela, ind: Indicador) =>
  ({ peso: m.pesoKg, estatura: m.estaturaCm, perimetro_cefalico: m.perimetroCefalicoCm, imc: m.imc })[ind];
</script>

<template>
  <section class="crescimento" data-testid="crescimento-tela">
    <h1>{{ t('pep.crescimento.titulo') }}</h1>
    <MensagemErro v-if="dados.error.value" :erro="dados.error.value" />
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta v-if="ok" variante="info" :texto="ok" anunciar data-testid="crescimento-ok" />
    <p v-if="!d && !dados.error.value">{{ t('pep.carregando') }}</p>
    <template v-else-if="d">
      <SanteAlerta
        v-if="!d.paciente.nascimento"
        variante="aviso"
        :texto="t('pep.crescimento.semNascimento')"
        data-testid="crescimento-sem-nascimento"
      />
      <SanteAlerta v-else-if="!d.referenciaAtual" variante="info" :texto="t('pep.crescimento.foraDaFaixa')" />
      <SanteAlerta v-if="d.semCurvas" variante="aviso" :texto="t('pep.crescimento.semCurvas')" />
      <p v-if="d.referenciaAtual" class="crescimento__referencia" data-testid="crescimento-referencia">
        {{ t('pep.crescimento.referencia') }}:
        <strong>{{ t(`pep.crescimento.publicacoes.${d.referenciaAtual.publicacao}`) }}</strong>
        <span v-if="d.referenciaAtual.corrigida"> ({{ t('pep.crescimento.corrigida') }})</span>
        <span v-if="d.paciente.igSemanas !== null && d.paciente.igSemanas < 37">
          · {{ t('pep.crescimento.prematuro', { s: d.paciente.igSemanas, d: d.paciente.igDias ?? 0 }) }}</span
        >
      </p>

      <form
        v-if="podeGravar && d.paciente.nascimento"
        class="crescimento__nova"
        data-testid="crescimento-nova"
        @submit.prevent="registrar"
      >
        <h2>{{ t('pep.crescimento.nova') }}</h2>
        <label>
          {{ t('pep.crescimento.medidoEm') }}
          <input v-model="nova.medidoEm" type="datetime-local" required data-testid="crescimento-medido-em" />
        </label>
        <label>
          {{ t('pep.crescimento.peso') }}
          <input v-model="nova.peso" inputmode="decimal" data-testid="crescimento-peso" />
        </label>
        <label>
          {{ t('pep.crescimento.estatura') }}
          <input v-model="nova.estatura" inputmode="decimal" data-testid="crescimento-estatura" />
        </label>
        <label>
          {{ t('pep.crescimento.perimetro') }}
          <input v-model="nova.perimetro" inputmode="decimal" data-testid="crescimento-perimetro" />
        </label>
        <label class="crescimento__obs">
          {{ t('pep.crescimento.observacao') }}
          <input v-model="nova.observacao" maxlength="500" data-testid="crescimento-observacao" />
        </label>
        <small v-if="imcPrevisto !== null" data-testid="crescimento-imc">{{
          t('pep.crescimento.imcPrevisto', { v: imcPrevisto.toFixed(1) })
        }}</small>
        <SanteAlerta
          v-for="f in falhasVisiveis"
          :key="f.codigo"
          variante="alerta"
          :texto="f.mensagem"
          :data-testid="`crescimento-falha-${f.codigo}`"
        />
        <SanteBotao
          tipo="submit"
          :desabilitado="falhas.length > 0 || enviando"
          data-testid="crescimento-registrar"
          :rotulo="t('pep.crescimento.registrar')"
        />
      </form>

      <div v-if="d.graficos.length" class="crescimento__escolha">
        <div role="group" :aria-label="t('pep.crescimento.titulo')" class="crescimento__indicadores">
          <button
            v-for="i in INDICADORES"
            :key="i"
            type="button"
            :aria-pressed="indicador === i"
            :data-testid="`crescimento-indicador-${i}`"
            @click="indicador = i"
          >
            {{ t(`pep.crescimento.indicadores.${i}`) }}
          </button>
        </div>
        <SanteSelecao
          v-if="opcoesCurva.length > 1"
          v-model="escolhida"
          :rotulo="t('pep.crescimento.curva')"
          :opcoes="opcoesCurva"
          data-testid="crescimento-curva"
        />
      </div>

      <figure v-if="grafico && desenho" class="crescimento__grafico" data-testid="crescimento-grafico">
        <svg
          :viewBox="`0 0 ${L} ${A}`"
          role="img"
          :aria-label="
            t('pep.crescimento.graficoRotulo', {
              indicador: t(`pep.crescimento.indicadores.${grafico.indicador}`),
              curva: grafico.descricao,
            })
          "
        >
          <g class="eixo">
            <line :x1="M.e" :y1="A - M.b" :x2="L - M.d" :y2="A - M.b" />
            <line :x1="M.e" :y1="M.t" :x2="M.e" :y2="A - M.b" />
            <text
              v-for="m in desenho.marcasX"
              :key="`x${m.x}`"
              :x="m.x"
              :y="A - M.b + 16"
              text-anchor="middle"
            >
              {{ m.v }}
            </text>
            <text v-for="m in desenho.marcasY" :key="`y${m.y}`" :x="M.e - 6" :y="m.y + 4" text-anchor="end">
              {{ m.v }}
            </text>
          </g>
          <polyline
            v-for="(l, i) in desenho.linhas"
            :key="i"
            :class="`linha linha--${l.classe}`"
            :points="l.pontos"
          />
          <polyline v-if="desenho.pontos.length > 1" class="trajeto" :points="desenho.trajeto" />
          <circle
            v-for="p in desenho.pontos"
            :key="p.medidoEm"
            :cx="p.cx"
            :cy="p.cy"
            r="5"
            :class="`ponto ponto--${p.nivel}`"
            data-testid="crescimento-ponto"
          >
            <title>
              {{
                t('pep.crescimento.pontoTitulo', {
                  data: dataBr(p.medidoEm),
                  y: p.y,
                  unidade: grafico.unidade,
                  z: p.z,
                  p: p.percentil,
                })
              }}
            </title>
          </circle>
        </svg>
        <figcaption>
          {{ eixoX }} · {{ grafico.unidade }} · {{ t('pep.crescimento.linhas') }} ·
          {{ grafico.descricao }} ({{ grafico.versaoFonte }})
        </figcaption>
        <p v-if="grafico.pontos.length === 0" data-testid="crescimento-sem-pontos">
          {{ t('pep.crescimento.semPontos') }}
        </p>
      </figure>

      <template v-if="d.medidas.length">
        <h2>{{ t('pep.crescimento.medidas') }}</h2>
        <table class="crescimento__tabela" data-testid="crescimento-medidas">
          <thead>
            <tr>
              <th scope="col">{{ t('pep.crescimento.data') }}</th>
              <th scope="col">{{ t('pep.crescimento.idade') }}</th>
              <th v-for="i in INDICADORES" :key="i" scope="col">
                {{ t(`pep.crescimento.indicadores.${i}`) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in d.medidas"
              :key="`${m.origem}-${m.afericao ?? 0}-${m.medidoEm}`"
              data-testid="crescimento-medida"
            >
              <td>
                {{ dataBr(m.medidoEm) }}
                <small v-if="m.origem === 'nascimento'">{{ t('pep.crescimento.origem.nascimento') }}</small>
              </td>
              <td>{{ idadeTexto(m) }}</td>
              <td v-for="i in INDICADORES" :key="i">
                <template v-if="valor(m, i) !== null">
                  {{ valor(m, i) }}
                  <span
                    v-if="avaliacao(m, i)"
                    :class="`nivel nivel--${avaliacao(m, i)!.plausivel ? avaliacao(m, i)!.classificacao.nivel : 'revisar'}`"
                  >
                    {{
                      t('pep.crescimento.zPercentil', {
                        z: avaliacao(m, i)!.z,
                        p: avaliacao(m, i)!.percentil,
                      })
                    }}
                    ·
                    {{
                      avaliacao(m, i)!.plausivel
                        ? t(`pep.crescimento.classificacoes.${avaliacao(m, i)!.classificacao.codigo}`)
                        : t('pep.crescimento.revisar')
                    }}
                  </span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>
  </section>
</template>

<style scoped>
.crescimento {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.crescimento__nova {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  padding: var(--sgh-espaco-3);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio);
}
.crescimento__nova h2 {
  flex-basis: 100%;
  margin: 0;
}
.crescimento__nova label {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.crescimento__obs {
  flex: 1 1 16rem;
}
.crescimento__escolha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.crescimento__indicadores {
  display: flex;
  gap: var(--sgh-espaco-1);
}
.crescimento__indicadores button {
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.crescimento__indicadores button[aria-pressed='true'] {
  background: var(--sgh-primaria);
  color: var(--sgh-primaria-texto);
}
.crescimento__grafico {
  margin: 0;
  max-width: 48rem;
}
.crescimento__grafico svg {
  width: 100%;
  height: auto;
}
.eixo line {
  stroke: var(--sgh-borda-forte);
}
.eixo text,
figcaption {
  font-size: 0.75rem;
  fill: var(--sgh-texto-secundario);
  color: var(--sgh-texto-secundario);
}
.linha {
  fill: none;
  stroke-width: 1.5;
}
.linha--mediana {
  stroke: var(--sgh-sucesso);
}
.linha--dois {
  stroke: var(--sgh-aviso);
  stroke-dasharray: 6 3;
}
.linha--tres {
  stroke: var(--sgh-alerta);
}
.trajeto {
  fill: none;
  stroke: var(--sgh-primaria);
  stroke-width: 2;
}
.ponto {
  stroke: var(--sgh-fundo);
  stroke-width: 1.5;
  fill: var(--sgh-primaria);
}
.ponto--atencao,
.nivel--atencao {
  fill: var(--sgh-aviso);
  color: var(--sgh-aviso);
}
.ponto--alerta,
.ponto--revisar,
.nivel--alerta,
.nivel--revisar {
  fill: var(--sgh-alerta);
  color: var(--sgh-alerta);
}
.crescimento__tabela {
  border-collapse: collapse;
}
.crescimento__tabela th,
.crescimento__tabela td {
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  text-align: left;
  vertical-align: top;
}
.nivel {
  display: block;
  font-size: 0.8rem;
}
</style>
