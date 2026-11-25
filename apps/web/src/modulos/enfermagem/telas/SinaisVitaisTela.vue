<script setup lang="ts">
// Sinais vitais e controles (ficha do M25, seção 7 e regra 13): a grade e o gráfico dos sinais do paciente, com a
// glicemia e os exames de laboratório na mesma régua do tempo. O registro leva a unidade padronizada; fora da faixa
// de alerta, pede a confirmação; fora do possível, é recusado. A retificação cria uma versão nova com a justificativa
// (a anterior fica guardada). Em `/beira-leito/sinais-vitais`, sem rede, os sinais vão para a fila do aparelho.
import {
  METODOS_SINAL,
  type News2DaAfericao,
  ROTULOS_GATILHO,
  SINAIS_VITAIS,
  type SinalVitalLido,
  type TipoSinalVital,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import {
  lerSinais,
  lerTurno,
  novaChave,
  registrarSinais,
  retificarSinal,
  semRede,
} from '../api-enfermagem.js';
import AfericaoDetalhadaPainel from '../componentes/AfericaoDetalhadaPainel.vue';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';
import SeletorUnidade from '../componentes/SeletorUnidade.vue';
import { usarChecagem } from '../usar-checagem.js';
import { usarEnfermagem } from '../usar-enfermagem.js';

const props = withDefaults(defineProps<{ id?: string; modo?: 'tela' | 'beira' }>(), { id: '', modo: 'tela' });
const { t } = useI18n();
const rota = useRoute();
const { gravacao, unidade, escolherUnidade, opcoesUnidade, dono } = usarEnfermagem();
const prazo = computed(() => gravacao.data.value?.parametros.cacheHoras ?? 12);
const { online, pendentes, guardar, enviarFila, horaReal, ajustarRelogio } = usarChecagem(dono, prazo);
const podeCriar = computed(() => gravacao.data.value?.operacoes['registrarSinal']?.pode === true);
const podeRetificar = computed(() => gravacao.data.value?.operacoes['retificarSinal']?.pode === true);

const escolhaBeira = ref<number | null>(Number(rota.query['paciente'] ?? 0) || null);
const paciente = computed(() => (props.modo === 'tela' ? Number(props.id) || null : escolhaBeira.value));
const turno = useQuery({
  queryKey: computed(() => ['enfermagem', 'turno', unidade.value]),
  queryFn: () => lerTurno(unidade.value),
  // Na tela também: o atendimento do paciente da unidade vai com os sinais (o NEWS2 da aferição precisa da internação).
  enabled: computed(() => !!unidade.value),
});
const opcoesPaciente = computed(() => [
  { valor: '', rotulo: '—' },
  ...(turno.data.value?.pacientes ?? []).map((p) => ({
    valor: String(p.paciente),
    rotulo: `${p.leito ?? ''} ${p.nome}`.trim(),
  })),
]);
const atendimentoDoPaciente = computed(
  () => turno.data.value?.pacientes.find((p) => p.paciente === paciente.value)?.atendimento ?? null,
);
const sinais = useQuery({
  queryKey: computed(() => ['enfermagem', 'sinais', paciente.value]),
  queryFn: () => lerSinais(paciente.value!),
  enabled: computed(() => !!paciente.value),
});

const vista = ref<'grade' | 'grafico'>('grade');
const vigentes = computed(() => (sinais.data.value?.sinais ?? []).filter((s) => s.substituidoPor === null));
const tiposVistos = computed(() => [...new Set(vigentes.value.map((s) => s.tipo))]);
const tipoGrafico = ref<TipoSinalVital>('fc');
const opcoesGrafico = computed(() =>
  (tiposVistos.value.length ? tiposVistos.value : (['fc'] as TipoSinalVital[])).map((k) => ({
    valor: k,
    rotulo: SINAIS_VITAIS[k].rotulo,
  })),
);

// Gráfico simples (SVG): a série escolhida e, para a glicemia, os resultados do laboratório na mesma régua.
const LARG = 640;
const ALT = 220;
const pontos = computed(() => {
  const s = vigentes.value
    .filter((x) => x.tipo === tipoGrafico.value)
    .map((x) => ({ quando: x.horaReal, valor: x.valor, lab: false }));
  const lab =
    tipoGrafico.value === 'glicemia'
      ? (sinais.data.value?.laboratorio ?? [])
          .filter((l) => l.exame === 'GLI')
          .map((l) => ({ quando: l.quando, valor: l.valor, lab: true }))
      : [];
  return [...s, ...lab].sort((a, b) => a.quando.localeCompare(b.quando));
});
const escala = computed(() => {
  const ps = pontos.value;
  if (ps.length === 0) return null;
  const ts = ps.map((p) => Date.parse(`${p.quando.slice(0, 16)}:00Z`));
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts, t0 + 1);
  const def = SINAIS_VITAIS[tipoGrafico.value];
  const v0 = Math.min(...ps.map((p) => p.valor), def.alerta[0]);
  const v1 = Math.max(...ps.map((p) => p.valor), def.alerta[1], v0 + 1);
  const x = (q: string) => 30 + ((Date.parse(`${q.slice(0, 16)}:00Z`) - t0) / (t1 - t0)) * (LARG - 60);
  const y = (v: number) => ALT - 20 - ((v - v0) / (v1 - v0)) * (ALT - 40);
  return { x, y, v0, v1, alerta: def.alerta };
});
const linha = computed(() => {
  const e = escala.value;
  if (!e) return '';
  return pontos.value
    .filter((p) => !p.lab)
    .map((p) => `${e.x(p.quando).toFixed(1)},${e.y(p.valor).toFixed(1)}`)
    .join(' ');
});

// Registro de vários sinais de uma vez.
const entrada = ref<Record<string, string>>({});
const metodo = ref<string>('');
const opcoesMetodo = computed(() => [
  { valor: '', rotulo: '—' },
  ...METODOS_SINAL.map((m) => ({ valor: m as string, rotulo: m })),
]);
const confirmarFora = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
/** M45 (regra 1): o NEWS2 da aferição com os sete parâmetros, com a conduta e os avisos (ou o motivo de não ter saído). */
const news2 = ref<News2DaAfericao | null>(null);
const ocupado = ref(false);
const TIPOS = Object.keys(SINAIS_VITAIS) as TipoSinalVital[];
const foraDaFaixa = (tipo: TipoSinalVital, v: number) =>
  v < SINAIS_VITAIS[tipo].alerta[0] || v > SINAIS_VITAIS[tipo].alerta[1];
const digitados = computed(() =>
  TIPOS.filter((k) => (entrada.value[k] ?? '').trim() !== '').map((k) => ({
    tipo: k,
    valor: Number((entrada.value[k] ?? '').replace(',', '.')),
  })),
);
const algumFora = computed(() =>
  digitados.value.some((d) => Number.isFinite(d.valor) && foraDaFaixa(d.tipo, d.valor)),
);
async function registrar(): Promise<void> {
  if (!paciente.value) return;
  erro.value = null;
  mensagem.value = null;
  news2.value = null;
  ocupado.value = true;
  const corpo = digitados.value.map((d) => ({
    atendimento: atendimentoDoPaciente.value,
    tipo: d.tipo,
    valor: d.valor,
    metodo: metodo.value || null,
    confirmadoForaDaFaixa: confirmarFora.value,
  }));
  try {
    try {
      if (!online.value) throw new TypeError('sem rede');
      const r = await registrarSinais(paciente.value, corpo, novaChave('sinais'));
      mensagem.value = r.mensagem;
      news2.value = r.news2 ?? null;
    } catch (x) {
      if (!semRede(x) || props.modo !== 'beira') throw x;
      for (const c of corpo)
        await guardar({
          tipo: 'sinal',
          chave: novaChave(`sinal-${c.tipo}`),
          paciente: paciente.value,
          sinal: { ...c, horaReal: horaReal(), origemOffline: true },
          rotulo: SINAIS_VITAIS[c.tipo].rotulo,
        });
      mensagem.value = t('enfermagem.sinais.guardadoSemRede');
    }
    entrada.value = {};
    confirmarFora.value = false;
    if (online.value) await sinais.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

const retificando = ref<SinalVitalLido | null>(null);
const aberto = ref(false);
const novoValor = ref('');
const justificativa = ref('');
const confirmarForaRet = ref(false);
function abrirRetificacao(s: SinalVitalLido): void {
  retificando.value = s;
  novoValor.value = String(s.valor);
  justificativa.value = '';
  confirmarForaRet.value = false;
  erro.value = null;
  aberto.value = true;
}
async function retificar(): Promise<void> {
  const s = retificando.value;
  if (!s || !paciente.value) return;
  erro.value = null;
  try {
    const r = await retificarSinal(
      s.id,
      paciente.value,
      {
        valor: Number(novoValor.value.replace(',', '.')),
        confirmadoForaDaFaixa: confirmarForaRet.value,
        justificativa: justificativa.value.trim(),
      },
      novaChave(`retificar-${s.id}`),
    );
    mensagem.value = r.mensagem;
    aberto.value = false;
    await sinais.refetch();
  } catch (x) {
    erro.value = x;
  }
}
async function enviar(): Promise<void> {
  try {
    await enviarFila();
    await sinais.refetch();
  } catch (x) {
    erro.value = x;
  }
}
const hora = (iso: string) => iso.slice(0, 16).replace('T', ' ');
// Sem rede, a hora do sinal é a do aparelho acertada pelo relógio do estabelecimento (lido com o turno).
watch(
  () => turno.data.value?.agora,
  (a) => {
    if (a) ajustarRelogio(a);
  },
);
</script>

<template>
  <section class="tela-enf" aria-labelledby="sv-titulo" data-testid="tela-sinais">
    <h1 id="sv-titulo">{{ t('enfermagem.sinais.titulo') }}</h1>
    <p>{{ t('enfermagem.sinais.texto') }}</p>
    <div v-if="modo === 'beira'" class="barra">
      <SeletorUnidade :model-value="unidade" :opcoes="opcoesUnidade" @update:model-value="escolherUnidade" />
      <SanteSelecao
        :model-value="escolhaBeira ? String(escolhaBeira) : ''"
        :rotulo="t('enfermagem.sinais.pacienteDaUnidade')"
        :opcoes="opcoesPaciente"
        data-testid="sv-paciente"
        @update:model-value="escolhaBeira = Number($event) || null"
      />
    </div>
    <p v-if="!online" class="faixa-rede" role="status">{{ t('enfermagem.comum.semRede') }}</p>
    <p v-if="pendentes > 0" role="status">
      {{ t('enfermagem.comum.pendentesNoAparelho', { n: pendentes }) }}
      <SanteBotao
        variante="secundario"
        :rotulo="t('enfermagem.comum.enviarAgora')"
        :desabilitado="!online"
        @acionar="enviar"
      />
    </p>
    <p v-if="mensagem" role="status" data-testid="sv-mensagem">{{ mensagem }}</p>
    <template v-if="news2">
      <div
        v-if="news2.id !== null"
        :role="news2.gatilho === 'nenhum' ? 'status' : 'alert'"
        class="conduta"
        :class="{ grave: news2.gatilho === 'trr', calma: news2.gatilho === 'nenhum' }"
        data-testid="sv-news2"
      >
        <strong>{{ t('enfermagem.sinais.news2', { total: news2.total, faixa: news2.rotuloFaixa }) }}</strong>
        <span>{{ ROTULOS_GATILHO[news2.gatilho] }}: {{ news2.conduta }}</span>
        <span v-for="(a, k) in news2.avisos" :key="k" class="secundario">{{ a }}</span>
      </div>
      <SanteAlerta
        v-else
        variante="aviso"
        :texto="t('enfermagem.sinais.news2Sem', { motivo: news2.motivo })"
        data-testid="sv-news2"
      />
    </template>
    <ErroEnfermagem v-if="erro" :erro="erro" />
    <template v-if="paciente">
      <form class="cartao registro" data-testid="sv-form" @submit.prevent="registrar">
        <div class="campos">
          <span v-for="k in TIPOS" :key="k" class="campo">
            <label :for="`sv-${k}`">{{ SINAIS_VITAIS[k].rotulo }} ({{ SINAIS_VITAIS[k].unidade }})</label>
            <input :id="`sv-${k}`" v-model="entrada[k]" inputmode="decimal" :data-testid="`sv-${k}`" />
          </span>
        </div>
        <SanteSelecao
          id="sv-metodo"
          v-model="metodo"
          :rotulo="t('enfermagem.sinais.metodo')"
          :opcoes="opcoesMetodo"
        />
        <label v-if="algumFora" class="linha alerta">
          <input v-model="confirmarFora" type="checkbox" data-testid="sv-confirmar-fora" />
          {{ t('enfermagem.sinais.confirmarFora') }}
        </label>
        <SanteBotao
          tipo="submit"
          :rotulo="t('enfermagem.sinais.registrar')"
          :desabilitado="!podeCriar || digitados.length === 0 || ocupado"
          data-testid="sv-registrar"
        />
      </form>
      <AfericaoDetalhadaPainel
        v-if="modo === 'tela' && paciente"
        :paciente="paciente"
        :atendimento="atendimentoDoPaciente"
        :pode-criar="podeCriar"
      />
      <div class="barra" role="group">
        <SanteBotao
          :variante="vista === 'grade' ? 'primario' : 'secundario'"
          :rotulo="t('enfermagem.sinais.grade')"
          @acionar="vista = 'grade'"
        />
        <SanteBotao
          :variante="vista === 'grafico' ? 'primario' : 'secundario'"
          :rotulo="t('enfermagem.sinais.grafico')"
          @acionar="vista = 'grafico'"
        />
      </div>
      <ErroEnfermagem v-if="sinais.isError.value" :erro="sinais.error.value" />
      <p v-else-if="!sinais.data.value" role="status">{{ t('enfermagem.comum.carregando') }}</p>
      <template v-else-if="vista === 'grade'">
        <p v-if="sinais.data.value.sinais.length === 0">{{ t('enfermagem.sinais.vazio') }}</p>
        <div v-else class="rolagem">
          <table class="grade" data-testid="sv-grade">
            <thead>
              <tr>
                <th scope="col">{{ t('enfermagem.sinais.quando') }}</th>
                <th scope="col">{{ t('enfermagem.sinais.tipo') }}</th>
                <th scope="col">{{ t('enfermagem.sinais.valor') }}</th>
                <th scope="col">{{ t('enfermagem.sinais.quem') }}</th>
                <th scope="col">{{ t('enfermagem.comum.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in sinais.data.value.sinais" :key="s.id" :data-testid="`sv-linha-${s.id}`">
                <td>{{ hora(s.horaReal) }}</td>
                <td>{{ SINAIS_VITAIS[s.tipo]?.rotulo ?? s.tipo }}</td>
                <td :class="{ riscado: s.substituidoPor !== null }">
                  {{ s.valor }} {{ s.unidade }}
                  <strong v-if="s.foraDaFaixa" class="alerta"
                    >· {{ t('enfermagem.sinais.foraDaFaixa') }}</strong
                  >
                  <span v-if="s.versao > 1" class="secundario">
                    · {{ t('enfermagem.sinais.versao', { n: s.versao }) }}</span
                  >
                  <span v-if="s.substituidoPor !== null" class="secundario">
                    · {{ t('enfermagem.sinais.retificado') }}</span
                  >
                  <span v-if="s.justificativa" class="secundario"> · {{ s.justificativa }}</span>
                </td>
                <td>{{ s.usuario }}</td>
                <td>
                  <SanteBotao
                    v-if="s.substituidoPor === null"
                    variante="texto"
                    :rotulo="t('enfermagem.sinais.retificar')"
                    :desabilitado="!podeRetificar"
                    :data-testid="`sv-retificar-${s.id}`"
                    @acionar="abrirRetificacao(s)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <template v-if="sinais.data.value.laboratorio.length">
          <h2>{{ t('enfermagem.sinais.laboratorio') }}</h2>
          <ul>
            <li v-for="(l, k) in sinais.data.value.laboratorio" :key="k">
              {{ hora(l.quando) }} · {{ l.nome }} · {{ l.valor }}
            </li>
          </ul>
        </template>
      </template>
      <template v-else>
        <SanteSelecao
          v-model="tipoGrafico"
          :rotulo="t('enfermagem.sinais.escolher')"
          :opcoes="opcoesGrafico"
        />
        <p v-if="!escala">{{ t('enfermagem.sinais.vazio') }}</p>
        <svg
          v-else
          :viewBox="`0 0 ${LARG} ${ALT}`"
          role="img"
          :aria-label="SINAIS_VITAIS[tipoGrafico].rotulo"
          class="grafico"
          data-testid="sv-grafico"
        >
          <rect
            x="30"
            :y="escala.y(escala.alerta[1])"
            :width="LARG - 60"
            :height="Math.max(0, escala.y(escala.alerta[0]) - escala.y(escala.alerta[1]))"
            class="faixa"
          />
          <polyline :points="linha" class="serie" />
          <g v-for="(p, k) in pontos" :key="k">
            <circle
              :cx="escala.x(p.quando)"
              :cy="escala.y(p.valor)"
              :r="p.lab ? 5 : 4"
              :class="p.lab ? 'lab' : 'ponto'"
            >
              <title>{{ hora(p.quando) }} · {{ p.valor }}</title>
            </circle>
          </g>
          <text x="2" :y="escala.y(escala.v1) + 4" class="eixo">{{ escala.v1 }}</text>
          <text x="2" :y="escala.y(escala.v0)" class="eixo">{{ escala.v0 }}</text>
        </svg>
      </template>
    </template>
    <SanteDialogo v-model:visivel="aberto" :titulo="t('enfermagem.sinais.retificar')">
      <div v-if="retificando" class="campo">
        <label for="ret-valor">{{ SINAIS_VITAIS[retificando.tipo]?.rotulo ?? retificando.tipo }}</label>
        <input id="ret-valor" v-model="novoValor" inputmode="decimal" data-testid="ret-valor" />
        <label for="ret-just">{{ t('enfermagem.sinais.justificativa') }}</label>
        <input id="ret-just" v-model="justificativa" maxlength="200" data-testid="ret-justificativa" />
        <label class="linha">
          <input v-model="confirmarForaRet" type="checkbox" />
          {{ t('enfermagem.sinais.confirmarFora') }}
        </label>
        <ErroEnfermagem v-if="erro" :erro="erro" />
        <SanteBotao
          :rotulo="t('enfermagem.comum.salvar')"
          :desabilitado="justificativa.trim().length < 10"
          data-testid="ret-salvar"
          @acionar="retificar"
        />
      </div>
    </SanteDialogo>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.conduta {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-2);
  border: 2px solid var(--sgh-aviso);
  border-radius: 6px;
  margin: var(--sgh-espaco-2) 0;
}
.conduta.grave {
  border-color: var(--sgh-alerta);
  background: var(--sgh-alerta-suave);
}
.conduta.calma {
  border-color: var(--sgh-borda);
}
.campos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.registro {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.riscado {
  text-decoration: line-through;
}
.grafico {
  width: 100%;
  max-width: 48rem;
  background: var(--sgh-fundo);
  border: 1px solid var(--sgh-borda);
}
.grafico .faixa {
  fill: var(--sgh-primaria-suave);
}
.grafico .serie {
  fill: none;
  stroke: var(--sgh-primaria);
  stroke-width: 2;
}
.grafico .ponto {
  fill: var(--sgh-primaria);
}
.grafico .lab {
  fill: var(--sgh-aviso);
}
.grafico .eixo {
  font-size: 11px;
  fill: var(--sgh-texto-secundario);
}
</style>
