<script setup lang="ts">
// Balanço hídrico (M45, etapa 3; ficha, seção 7 e regra 6): o balanço do paciente internado na janela de 24 horas da
// unidade (hora de corte, padrão 7 h). O ganho dos horários checados como administrados em mL e a diurese dos sinais
// vitais entram sozinhos, uma vez só (lista "entram no fechamento"); as perdas por tipo de eliminação, com a
// intensidade quando o tipo pede; as perdas insensíveis pela fórmula da unidade; o saldo e o débito urinário com as
// contas impressas e o alerta de oligúria; o gráfico do saldo acumulado; o estorno com o motivo; o fechamento parcial e
// o de 24 horas (a tela manda a impressão do que viu: se o balanço mudou, o servidor recusa). Em `/enfermagem/balanco`,
// sem paciente, a escolha da unidade e do paciente.
import {
  type BalancoDoPaciente,
  type LancamentoBalancoLido,
  rotaDoItemConsulta,
  type SentidoBalanco,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  estornarLancamento,
  fecharBalanco,
  lancarBalanco,
  lerBalanco,
  lerPacientesBalanco,
  lerUnidadesBalanco,
} from '../api-balanco.js';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';

const props = withDefaults(defineProps<{ reg?: string }>(), { reg: '' });
const { t } = useI18n();
const router = useRouter();
const atendimento = computed(() => Number(props.reg) || null);
const ITEM_DOMINIOS = 'enfermagem.balanco-hidrico-ganhos-perdas-fechamento-24-h';

// ── Escolha do paciente (sem atendimento na rota) ──
const unidade = ref('');
const unidades = useQuery({
  queryKey: ['balanco', 'unidades'],
  queryFn: () => lerUnidadesBalanco(),
  enabled: computed(() => !atendimento.value),
});
const pacientes = useQuery({
  queryKey: computed(() => ['balanco', 'pacientes', unidade.value]),
  queryFn: () => lerPacientesBalanco(unidade.value),
  enabled: computed(() => !atendimento.value && !!unidade.value),
});
const opcoesUnidade = computed(() => [
  { valor: '', rotulo: '—' },
  ...(unidades.data.value ?? []).map((u) => ({ valor: u.unidade, rotulo: `${u.nome} (${u.internados})` })),
]);
const escolhido = ref('');
const opcoesPaciente = computed(() => [
  { valor: '', rotulo: '—' },
  ...(pacientes.data.value ?? []).map((p) => ({
    valor: String(p.atendimento),
    rotulo: `${p.leito} · ${p.nome} · ${t('enfermagem.comum.atendimento', { numero: p.numero })}`,
  })),
]);
function abrir(): void {
  if (escolhido.value) void router.push({ name: 'enfermagem.balanco', params: { reg: escolhido.value } });
}

// ── O balanço ──
const inicio = ref<string | null>(null);
const peso = ref('');
const pesoUsado = ref<number | null>(null);
const balanco = useQuery({
  queryKey: computed(() => ['balanco', atendimento.value, inicio.value, pesoUsado.value]),
  queryFn: () => lerBalanco(atendimento.value!, { inicio: inicio.value, peso: pesoUsado.value }),
  enabled: computed(() => !!atendimento.value),
});
const b = computed<BalancoDoPaciente | undefined>(() => balanco.data.value);
watch(
  () => b.value?.peso,
  (p) => {
    if (p && peso.value === '') peso.value = String(p.valor).replace('.', ',');
  },
);
const hora = (x: string) => x.slice(0, 16).replace('T', ' ');
const ml = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const opcoesJanela = computed(() =>
  (b.value?.janelas ?? []).map((j) => ({
    valor: j.inicio,
    rotulo: t(
      j.fechada
        ? 'enfermagem.balanco.janelaFechada'
        : j.atual
          ? 'enfermagem.balanco.janelaAtual'
          : 'enfermagem.balanco.janelaAnterior',
      { inicio: hora(j.inicio), fim: hora(j.fim) },
    ),
  })),
);
const janelaEscolhida = computed({
  get: () => inicio.value ?? b.value?.janela.inicio ?? '',
  set: (v: string) => {
    inicio.value = v || null;
  },
});
function usarPeso(): void {
  const n = Number(peso.value.replace(',', '.'));
  pesoUsado.value = Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null;
}
const pode = (op: string) => b.value?.gravacao.operacoes[op]?.pode === true;
const ligada = computed(() => b.value?.gravacao.ligada === true);
const nomeGrupo = (c: number | null) => b.value?.dominios.grupos.find((g) => g.codigo === c)?.nome ?? '';
const nomeTipo = (c: number | null) =>
  b.value?.dominios.tiposEliminacao.find((x) => x.codigo === c)?.nome ?? '';
const nomeIntensidade = (c: number | null) =>
  b.value?.dominios.intensidades.find((x) => x.codigo === c)?.nome ?? '';
const classificacao = (
  l: Pick<LancamentoBalancoLido, 'sentido' | 'grupo' | 'tipoEliminacao' | 'intensidade' | 'via'>,
) =>
  l.sentido === 'ganho'
    ? [nomeGrupo(l.grupo), l.via].filter(Boolean).join(' · ')
    : [nomeTipo(l.tipoEliminacao), l.intensidade ? nomeIntensidade(l.intensidade) : '']
        .filter(Boolean)
        .join(' · ');

// ── Gráfico do saldo acumulado (SVG simples) ──
// O saldo em cada ponto desconta as perdas insensíveis até aquela hora (a fórmula é por hora: distribuídas igualmente
// de início ao fim do cálculo); o último ponto, no fim do cálculo, é o saldo do resumo.
const LARG = 640;
const ALT = 200;
const instante = (h: string) => Date.parse(`${h.slice(0, 16)}:00Z`);
const um = (v: number) => Math.round(v * 10) / 10;
const serie = computed(() => {
  const x = b.value;
  if (!x) return [];
  const c = x.calculo;
  const inclusivo = c.ate < x.janela.fim;
  const conta = (h: string) => {
    const m = h.slice(0, 16);
    return m >= x.janela.inicio && (m < c.ate || (inclusivo && m === c.ate));
  };
  const t0 = instante(x.janela.inicio);
  const t1 = instante(c.ate);
  const fracao = (h: string) => (t1 > t0 ? Math.min(1, Math.max(0, (instante(h) - t0) / (t1 - t0))) : 1);
  const pontos = [
    ...x.lancamentos
      .filter((l) => l.origem !== 'estorno' && l.estornadoPor === null)
      .map((l) => ({ h: l.horaReal, v: l.sentido === 'ganho' ? l.volumeMl : -l.volumeMl })),
    ...x.pendentes.map((p) => ({ h: p.horaReal, v: p.sentido === 'ganho' ? p.volumeMl : -p.volumeMl })),
  ]
    .filter((p) => conta(p.h))
    .sort((a, d) => a.h.localeCompare(d.h));
  if (pontos.length === 0 && c.insensiveisMl === 0) return [];
  let acc = 0;
  const r = pontos.map((p) => ({
    h: p.h,
    s: um((acc += p.v) - c.insensiveisMl * fracao(p.h)),
    final: false,
  }));
  r.push({ h: c.ate, s: c.saldoMl, final: true });
  return r;
});
const escala = computed(() => {
  const x = b.value;
  if (!x || serie.value.length === 0) return null;
  const t0 = Date.parse(`${x.janela.inicio}:00Z`);
  const t1 = Date.parse(`${x.janela.fim}:00Z`);
  const vs = [0, ...serie.value.map((p) => p.s)];
  const v0 = Math.min(...vs);
  const v1 = Math.max(...vs, v0 + 1);
  return {
    x: (h: string) => 30 + ((Date.parse(`${h.slice(0, 16)}:00Z`) - t0) / (t1 - t0)) * (LARG - 60),
    y: (v: number) => ALT - 20 - ((v - v0) / (v1 - v0)) * (ALT - 40),
    v0,
    v1,
  };
});
const linha = computed(() => {
  const e = escala.value;
  const x = b.value;
  if (!e || !x) return '';
  return [
    `${e.x(x.janela.inicio).toFixed(1)},${e.y(0).toFixed(1)}`,
    ...serie.value.map((p) => `${e.x(p.h).toFixed(1)},${e.y(p.s).toFixed(1)}`),
  ].join(' ');
});

// ── Lançar ──
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
const sentido = ref<SentidoBalanco>('perda');
const grupo = ref<number | null>(null);
const via = ref<string | null>(null);
const tipo = ref<number | null>(null);
const intensidade = ref<number | null>(null);
const aspecto = ref('');
const estimado = ref(false);
const volume = ref('');
const horaReal = ref('');
const descricao = ref('');
// A hora real cabe na janela exibida (e não é de antes da internação nem do futuro). Fora da janela em curso, a hora é
// obrigatória: vazia, o servidor usaria agora, e o lançamento iria para a janela em curso, não para a da tela.
const menosUmMinuto = (h: string) => new Date(instante(h) - 60_000).toISOString().slice(0, 16);
const horaMin = computed(() => {
  const x = b.value;
  if (!x) return '';
  return x.internadoDesde && x.internadoDesde.slice(0, 16) > x.janela.inicio
    ? x.internadoDesde.slice(0, 16)
    : x.janela.inicio;
});
const horaMax = computed(() => {
  const x = b.value;
  if (!x) return '';
  const ultimo = menosUmMinuto(x.janela.fim);
  return x.agora < ultimo ? x.agora.slice(0, 16) : ultimo;
});
const horaExigida = computed(() => !!b.value && !b.value.janela.atual);
const horaValida = computed(() => {
  const h = horaReal.value.slice(0, 16);
  if (!h) return !horaExigida.value;
  return h >= horaMin.value && h <= horaMax.value;
});
watch(
  () => b.value?.janela.inicio,
  () => {
    horaReal.value = '';
  },
);
const tipoEscolhido = computed(() => b.value?.dominios.tiposEliminacao.find((x) => x.codigo === tipo.value));
const opcoesSentido = computed(() => [
  { valor: 'ganho' as const, rotulo: t('enfermagem.balanco.sentidos.ganho') },
  { valor: 'perda' as const, rotulo: t('enfermagem.balanco.sentidos.perda') },
]);
const vazio = { valor: null, rotulo: t('enfermagem.balanco.lancar.escolha') };
const opcoesGrupo = computed(() => [
  vazio,
  ...(b.value?.dominios.grupos ?? []).map((g) => ({ valor: g.codigo, rotulo: g.nome })),
]);
const opcoesVia = computed(() => [
  vazio,
  ...(b.value?.dominios.vias ?? []).map((v) => ({ valor: v.codigo, rotulo: v.nome })),
]);
const opcoesTipo = computed(() => [
  vazio,
  ...(b.value?.dominios.tiposEliminacao ?? [])
    .filter((x) => x.ativo)
    .map((x) => ({ valor: x.codigo, rotulo: x.nome })),
]);
const opcoesIntensidade = computed(() => [
  vazio,
  ...(b.value?.dominios.intensidades ?? []).map((x) => ({ valor: x.codigo, rotulo: x.nome })),
]);
const volumeNum = computed(() => Number(volume.value.replace(',', '.')));
const prontoParaLancar = computed(
  () =>
    pode('lancar') &&
    volume.value.trim() !== '' &&
    Number.isFinite(volumeNum.value) &&
    volumeNum.value >= 0 &&
    (sentido.value === 'ganho' ? grupo.value !== null : tipo.value !== null) &&
    (sentido.value === 'ganho' || !tipoEscolhido.value?.pedeIntensidade || intensidade.value !== null) &&
    horaValida.value,
);
async function lancar(): Promise<void> {
  if (!atendimento.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  const ganho = sentido.value === 'ganho';
  try {
    const r = await lancarBalanco(atendimento.value, [
      {
        sentido: sentido.value,
        grupo: ganho ? grupo.value : null,
        via: ganho ? via.value : null,
        tipoEliminacao: ganho ? null : tipo.value,
        intensidade: ganho || !tipoEscolhido.value?.pedeIntensidade ? null : intensidade.value,
        aspecto: ganho || !aspecto.value.trim() ? null : aspecto.value.trim(),
        estimado: ganho ? false : estimado.value,
        volumeMl: Math.round(volumeNum.value * 10) / 10,
        horaReal: horaReal.value ? horaReal.value.slice(0, 16) : null,
        descricao: descricao.value.trim() || null,
      },
    ]);
    mensagem.value = r.mensagem;
    volume.value = '';
    aspecto.value = '';
    descricao.value = '';
    estimado.value = false;
    await balanco.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Estornar ──
const estornando = ref<LancamentoBalancoLido | null>(null);
const dialogoEstorno = ref(false);
const motivo = ref('');
function abrirEstorno(l: LancamentoBalancoLido): void {
  estornando.value = l;
  motivo.value = '';
  erro.value = null;
  dialogoEstorno.value = true;
}
async function estornar(): Promise<void> {
  if (!atendimento.value || !estornando.value) return;
  erro.value = null;
  try {
    const r = await estornarLancamento(atendimento.value, estornando.value.id, motivo.value.trim());
    mensagem.value = r.mensagem;
    dialogoEstorno.value = false;
    await balanco.refetch();
  } catch (x) {
    erro.value = x;
  }
}

// ── Fechar ──
const fechando = ref<'parcial' | 'total' | null>(null);
const dialogoFechar = ref(false);
const podeTotal = computed(() => !!b.value && !b.value.janela.atual && !b.value.janela.fechada);
function abrirFechar(tp: 'parcial' | 'total'): void {
  fechando.value = tp;
  erro.value = null;
  dialogoFechar.value = true;
}
async function fechar(): Promise<void> {
  const x = b.value;
  if (!atendimento.value || !x || !fechando.value) return;
  erro.value = null;
  try {
    const r = await fecharBalanco(atendimento.value, {
      tipo: fechando.value,
      inicio: x.janela.inicio,
      ate: x.calculo.ate,
      pesoKg: x.calculo.pesoKg,
      impressaoVista: x.calculo.impressao,
    });
    mensagem.value = r.mensagem;
    dialogoFechar.value = false;
    await balanco.refetch();
  } catch (x2) {
    erro.value = x2;
    await balanco.refetch();
  }
}
</script>

<template>
  <section class="tela-enf" aria-labelledby="bh-titulo" data-testid="tela-balanco">
    <h1 id="bh-titulo">{{ t('enfermagem.balanco.titulo') }}</h1>
    <p>{{ t('enfermagem.balanco.texto') }}</p>

    <template v-if="!atendimento">
      <p>{{ t('enfermagem.balanco.escolha') }}</p>
      <div class="barra">
        <SanteSelecao
          v-model="unidade"
          :rotulo="t('enfermagem.comum.unidade')"
          :opcoes="opcoesUnidade"
          data-testid="bh-unidade"
        />
        <SanteSelecao
          v-model="escolhido"
          :rotulo="t('enfermagem.balanco.paciente')"
          :opcoes="opcoesPaciente"
          data-testid="bh-paciente"
        />
        <SanteBotao
          :rotulo="t('enfermagem.balanco.abrir')"
          :desabilitado="!escolhido"
          data-testid="bh-abrir"
          @acionar="abrir"
        />
      </div>
      <ErroEnfermagem v-if="unidades.isError.value" :erro="unidades.error.value" />
    </template>

    <template v-else>
      <ErroEnfermagem v-if="balanco.isError.value" :erro="balanco.error.value" />
      <p v-else-if="!b" role="status">{{ t('enfermagem.comum.carregando') }}</p>
      <template v-else>
        <p class="cabecalho" data-testid="bh-paciente-cabecalho">
          <strong>{{ b.nome }}</strong>
          · {{ b.leito || t('enfermagem.comum.semLeito') }} ·
          {{ t('enfermagem.comum.atendimento', { numero: b.numero }) }} ·
          <span class="secundario">{{ t('enfermagem.balanco.horaCorte', { hora: b.horaCorte }) }}</span>
        </p>
        <SanteAlerta
          v-if="!ligada"
          variante="aviso"
          :texto="t('enfermagem.balanco.desligado', { motivo: b.gravacao.motivo ?? '' })"
        />
        <SanteAlerta v-if="b.cortada" variante="aviso" :texto="t('enfermagem.balanco.cortada')" />
        <div class="barra">
          <SanteSelecao
            v-model="janelaEscolhida"
            :rotulo="t('enfermagem.balanco.janela')"
            :opcoes="opcoesJanela"
            data-testid="bh-janela"
          />
          <span class="campo">
            <label for="bh-peso">{{ t('enfermagem.balanco.peso') }}</label>
            <input id="bh-peso" v-model="peso" inputmode="decimal" data-testid="bh-peso" />
          </span>
          <SanteBotao
            variante="secundario"
            :rotulo="t('enfermagem.balanco.usarPeso')"
            data-testid="bh-usar-peso"
            @acionar="usarPeso"
          />
          <RouterLink :to="rotaDoItemConsulta(ITEM_DOMINIOS)">{{
            t('enfermagem.balanco.dominios')
          }}</RouterLink>
        </div>
        <p v-if="b.peso" class="secundario">
          {{ t('enfermagem.balanco.pesoDosSinais', { peso: ml(b.peso.valor), quando: hora(b.peso.quando) }) }}
        </p>
        <SanteAlerta
          v-if="b.calculo.pesoKg === null"
          variante="info"
          :texto="t('enfermagem.balanco.semPeso')"
        />
        <p v-if="mensagem" role="status" data-testid="bh-mensagem">{{ mensagem }}</p>
        <ErroEnfermagem v-if="erro && !dialogoEstorno && !dialogoFechar" :erro="erro" />

        <section class="cartao" aria-labelledby="bh-resumo" data-testid="bh-resumo">
          <h2 id="bh-resumo">{{ t('enfermagem.balanco.resumo.titulo', { ate: hora(b.calculo.ate) }) }}</h2>
          <dl class="resumo">
            <div>
              <dt>{{ t('enfermagem.balanco.resumo.ganhos') }}</dt>
              <dd data-testid="bh-ganhos">
                {{ t('enfermagem.balanco.resumo.ml', { v: ml(b.calculo.ganhosMl) }) }}
              </dd>
            </div>
            <div>
              <dt>{{ t('enfermagem.balanco.resumo.perdas') }}</dt>
              <dd data-testid="bh-perdas">
                {{ t('enfermagem.balanco.resumo.ml', { v: ml(b.calculo.perdasMl) }) }}
              </dd>
            </div>
            <div>
              <dt>{{ t('enfermagem.balanco.resumo.insensiveis') }}</dt>
              <dd>{{ t('enfermagem.balanco.resumo.ml', { v: ml(b.calculo.insensiveisMl) }) }}</dd>
            </div>
            <div>
              <dt>{{ t('enfermagem.balanco.resumo.saldo') }}</dt>
              <dd data-testid="bh-saldo">
                {{ t('enfermagem.balanco.resumo.ml', { v: ml(b.calculo.saldoMl) }) }}
              </dd>
            </div>
            <div>
              <dt>{{ t('enfermagem.balanco.resumo.diurese') }}</dt>
              <dd>{{ t('enfermagem.balanco.resumo.ml', { v: ml(b.calculo.diureseMl) }) }}</dd>
            </div>
            <div>
              <dt>{{ t('enfermagem.balanco.resumo.debito') }}</dt>
              <dd data-testid="bh-debito">
                {{
                  b.calculo.debitoUrinario === null
                    ? t('enfermagem.balanco.resumo.semDebito')
                    : t('enfermagem.balanco.resumo.mlkgh', {
                        v: b.calculo.debitoUrinario.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
                      })
                }}
              </dd>
            </div>
          </dl>
          <SanteAlerta
            v-if="b.calculo.oliguria"
            :texto="t('enfermagem.balanco.resumo.oliguria')"
            anunciar
            data-testid="bh-oliguria"
          />
          <details>
            <summary>{{ t('enfermagem.balanco.resumo.contas') }}</summary>
            <p data-testid="bh-conta-saldo">{{ b.calculo.saldoConta }}</p>
            <p>{{ b.calculo.insensiveisConta }}</p>
            <p v-if="b.calculo.debitoConta">{{ b.calculo.debitoConta }}</p>
          </details>
        </section>

        <section aria-labelledby="bh-graf-titulo">
          <h2 id="bh-graf-titulo">{{ t('enfermagem.balanco.grafico') }}</h2>
          <p v-if="!escala">{{ t('enfermagem.balanco.graficoVazio') }}</p>
          <svg
            v-else
            :viewBox="`0 0 ${LARG} ${ALT}`"
            role="img"
            :aria-label="t('enfermagem.balanco.grafico')"
            class="grafico"
            data-testid="bh-grafico"
          >
            <line x1="30" :x2="LARG - 30" :y1="escala.y(0)" :y2="escala.y(0)" class="zero" />
            <polyline :points="linha" class="serie" />
            <circle
              v-for="(p, k) in serie"
              :key="k"
              :cx="escala.x(p.h)"
              :cy="escala.y(p.s)"
              :r="p.final ? 5 : 3"
              :class="p.final ? 'ponto final' : 'ponto'"
              :data-testid="p.final ? 'bh-grafico-final' : undefined"
              :data-saldo="p.final ? p.s.toFixed(1) : undefined"
            >
              <title>
                {{
                  p.final
                    ? t('enfermagem.balanco.graficoFinal', { ate: hora(p.h), v: ml(p.s) })
                    : `${hora(p.h)} · ${t('enfermagem.balanco.resumo.ml', { v: ml(p.s) })}`
                }}
              </title>
            </circle>
            <text x="2" :y="escala.y(escala.v1) + 4" class="eixo">{{ ml(escala.v1) }}</text>
            <text x="2" :y="escala.y(escala.v0)" class="eixo">{{ ml(escala.v0) }}</text>
          </svg>
        </section>

        <section aria-labelledby="bh-pend-titulo">
          <h2 id="bh-pend-titulo">{{ t('enfermagem.balanco.pendentes.titulo') }}</h2>
          <p class="secundario">{{ t('enfermagem.balanco.pendentes.texto') }}</p>
          <p v-if="b.pendentes.length === 0">{{ t('enfermagem.balanco.pendentes.vazio') }}</p>
          <div v-else class="rolagem">
            <table class="grade" data-testid="bh-pendentes">
              <thead>
                <tr>
                  <th scope="col">{{ t('enfermagem.balanco.lancamentos.hora') }}</th>
                  <th scope="col">{{ t('enfermagem.balanco.lancamentos.origem') }}</th>
                  <th scope="col">{{ t('enfermagem.balanco.lancamentos.classificacao') }}</th>
                  <th scope="col">{{ t('enfermagem.comum.item') }}</th>
                  <th scope="col">{{ t('enfermagem.balanco.lancamentos.volume') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in b.pendentes"
                  :key="`${p.origem}-${p.referencia}`"
                  :data-testid="`bh-pendente-${p.origem}-${p.referencia}`"
                >
                  <td>{{ hora(p.horaReal) }}</td>
                  <td>{{ t(`enfermagem.balanco.origens.${p.origem}`) }}</td>
                  <td>{{ classificacao({ ...p, intensidade: null }) }}</td>
                  <td>{{ p.descricao }}</td>
                  <td>{{ t('enfermagem.balanco.resumo.ml', { v: ml(p.volumeMl) }) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <template v-if="b.semVolume.length">
            <h3>{{ t('enfermagem.balanco.semVolume.titulo') }}</h3>
            <p class="secundario">{{ t('enfermagem.balanco.semVolume.texto') }}</p>
            <ul data-testid="bh-sem-volume">
              <li v-for="s in b.semVolume" :key="s.horario">
                {{ hora(s.horaReal) }} · {{ s.descricao }} · {{ s.motivo }}
              </li>
            </ul>
          </template>
        </section>

        <section aria-labelledby="bh-lanc-titulo">
          <h2 id="bh-lanc-titulo">{{ t('enfermagem.balanco.lancamentos.titulo') }}</h2>
          <p v-if="b.lancamentos.length === 0">{{ t('enfermagem.balanco.lancamentos.vazio') }}</p>
          <div v-else class="rolagem">
            <table class="grade" data-testid="bh-lancamentos">
              <thead>
                <tr>
                  <th scope="col">{{ t('enfermagem.balanco.lancamentos.hora') }}</th>
                  <th scope="col">{{ t('enfermagem.balanco.lancamentos.sentido') }}</th>
                  <th scope="col">{{ t('enfermagem.balanco.lancamentos.origem') }}</th>
                  <th scope="col">{{ t('enfermagem.balanco.lancamentos.classificacao') }}</th>
                  <th scope="col">{{ t('enfermagem.balanco.lancamentos.volume') }}</th>
                  <th scope="col">{{ t('enfermagem.balanco.lancamentos.quem') }}</th>
                  <th scope="col">{{ t('enfermagem.comum.acoes') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="l in b.lancamentos"
                  :key="l.id"
                  :data-testid="`bh-lancamento-${l.id}`"
                  :data-origem="l.origem"
                >
                  <td>{{ hora(l.horaReal) }}</td>
                  <td>{{ t(`enfermagem.balanco.sentidos.${l.sentido}`) }}</td>
                  <td>
                    {{
                      l.origem === 'estorno'
                        ? t('enfermagem.balanco.lancamentos.estorno', { id: l.estornado })
                        : t(`enfermagem.balanco.origens.${l.origem}`)
                    }}
                    <span v-if="l.motivo" class="secundario"> · {{ l.motivo }}</span>
                  </td>
                  <td>
                    {{ classificacao(l) }}<span v-if="l.aspecto" class="secundario"> · {{ l.aspecto }}</span
                    ><span v-if="l.descricao" class="secundario"> · {{ l.descricao }}</span>
                  </td>
                  <td :class="{ riscado: l.estornadoPor !== null || l.origem === 'estorno' }">
                    {{ t('enfermagem.balanco.resumo.ml', { v: ml(l.volumeMl) }) }}
                    <span v-if="l.estimado" class="secundario">
                      ({{ t('enfermagem.balanco.lancamentos.estimado') }})</span
                    >
                    <strong v-if="l.estornadoPor !== null" class="alerta">
                      · {{ t('enfermagem.balanco.lancamentos.estornado') }}</strong
                    >
                  </td>
                  <td>{{ l.usuario }}</td>
                  <td>
                    <SanteBotao
                      v-if="l.origem !== 'estorno' && l.estornadoPor === null && !b.janela.fechada"
                      variante="texto"
                      :rotulo="t('enfermagem.balanco.lancamentos.estornar')"
                      :desabilitado="!pode('estornar')"
                      :data-testid="`bh-estornar-${l.id}`"
                      @acionar="abrirEstorno(l)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <form
          v-if="!b.janela.fechada"
          class="cartao registro"
          aria-labelledby="bh-lancar-titulo"
          data-testid="bh-form"
          @submit.prevent="lancar"
        >
          <h2 id="bh-lancar-titulo">{{ t('enfermagem.balanco.lancar.titulo') }}</h2>
          <SanteOpcoes
            v-model="sentido"
            :legenda="t('enfermagem.balanco.lancar.sentido')"
            :opcoes="opcoesSentido"
            nome="bh-sentido"
          />
          <div class="campos">
            <template v-if="sentido === 'ganho'">
              <SanteSelecao
                v-model="grupo"
                :rotulo="t('enfermagem.balanco.lancar.grupo')"
                :opcoes="opcoesGrupo"
                data-testid="bh-grupo"
              />
              <SanteSelecao
                v-model="via"
                :rotulo="t('enfermagem.balanco.lancar.via')"
                :opcoes="opcoesVia"
                data-testid="bh-via"
              />
            </template>
            <template v-else>
              <SanteSelecao
                v-model="tipo"
                :rotulo="t('enfermagem.balanco.lancar.tipo')"
                :opcoes="opcoesTipo"
                data-testid="bh-tipo"
              />
              <SanteSelecao
                v-if="tipoEscolhido?.pedeIntensidade"
                v-model="intensidade"
                :rotulo="t('enfermagem.balanco.lancar.intensidade')"
                :opcoes="opcoesIntensidade"
                data-testid="bh-intensidade"
              />
              <span v-if="tipoEscolhido?.pedeAspecto" class="campo">
                <label for="bh-aspecto">{{ t('enfermagem.balanco.lancar.aspecto') }}</label>
                <input id="bh-aspecto" v-model="aspecto" maxlength="40" data-testid="bh-aspecto" />
              </span>
              <label v-if="tipoEscolhido?.aceitaEstimado" class="linha">
                <input v-model="estimado" type="checkbox" data-testid="bh-estimado" />
                {{ t('enfermagem.balanco.lancar.estimado') }}
              </label>
            </template>
            <span class="campo">
              <label for="bh-volume">{{ t('enfermagem.balanco.lancar.volume') }}</label>
              <input id="bh-volume" v-model="volume" inputmode="decimal" data-testid="bh-volume" />
            </span>
            <span class="campo">
              <label for="bh-hora">{{
                horaExigida
                  ? t('enfermagem.balanco.lancar.horaDaJanela', { inicio: hora(horaMin), fim: hora(horaMax) })
                  : t('enfermagem.balanco.lancar.hora')
              }}</label>
              <input
                id="bh-hora"
                v-model="horaReal"
                type="datetime-local"
                :min="horaMin"
                :max="horaMax"
                :required="horaExigida"
                :aria-invalid="horaReal !== '' && !horaValida"
                data-testid="bh-hora"
              />
            </span>
            <span class="campo">
              <label for="bh-descricao">{{ t('enfermagem.balanco.lancar.descricao') }}</label>
              <input id="bh-descricao" v-model="descricao" maxlength="120" />
            </span>
          </div>
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.balanco.lancar.registrar')"
            :desabilitado="!prontoParaLancar || ocupado"
            data-testid="bh-registrar"
          />
        </form>

        <section class="cartao" aria-labelledby="bh-fechar-titulo">
          <h2 id="bh-fechar-titulo">{{ t('enfermagem.balanco.fechar.titulo') }}</h2>
          <p v-if="b.janela.fechada">{{ t('enfermagem.balanco.fechar.jaFechado') }}</p>
          <div v-else class="barra">
            <SanteBotao
              variante="secundario"
              :rotulo="t('enfermagem.balanco.fechar.parcial')"
              :desabilitado="!pode('fechar')"
              data-testid="bh-fechar-parcial"
              @acionar="abrirFechar('parcial')"
            />
            <SanteBotao
              :rotulo="t('enfermagem.balanco.fechar.total')"
              :desabilitado="!pode('fechar') || !podeTotal"
              data-testid="bh-fechar-total"
              @acionar="abrirFechar('total')"
            />
            <span v-if="b.janela.atual" class="secundario">{{
              t('enfermagem.balanco.fechar.totalEspera', { fim: hora(b.janela.fim) })
            }}</span>
          </div>
        </section>

        <section aria-labelledby="bh-fech-titulo">
          <h2 id="bh-fech-titulo">{{ t('enfermagem.balanco.fechamentos.titulo') }}</h2>
          <p v-if="b.fechamentos.length === 0">{{ t('enfermagem.balanco.fechamentos.vazio') }}</p>
          <div v-else class="rolagem">
            <table class="grade" data-testid="bh-fechamentos">
              <thead>
                <tr>
                  <th scope="col">{{ t('enfermagem.balanco.fechamentos.tipo') }}</th>
                  <th scope="col">{{ t('enfermagem.balanco.fechamentos.janela') }}</th>
                  <th scope="col">{{ t('enfermagem.balanco.fechamentos.saldo') }}</th>
                  <th scope="col">{{ t('enfermagem.balanco.fechamentos.debito') }}</th>
                  <th scope="col">{{ t('enfermagem.balanco.fechamentos.quem') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="f in b.fechamentos" :key="f.id" :data-testid="`bh-fechamento-${f.tipo}`">
                  <td>{{ t(`enfermagem.balanco.fechamentos.${f.tipo}`) }}</td>
                  <td>{{ t('enfermagem.balanco.periodo', { inicio: hora(f.inicio), fim: hora(f.fim) }) }}</td>
                  <td>
                    {{ t('enfermagem.balanco.resumo.ml', { v: ml(f.saldoMl) }) }}
                    <details>
                      <summary>{{ t('enfermagem.balanco.resumo.contas') }}</summary>
                      <p>{{ f.parcelas }}</p>
                    </details>
                  </td>
                  <td>
                    {{
                      f.debitoUrinario === null
                        ? t('enfermagem.balanco.resumo.semDebito')
                        : t('enfermagem.balanco.resumo.mlkgh', {
                            v: f.debitoUrinario.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
                          })
                    }}
                    <strong v-if="f.oliguria" class="alerta">
                      · {{ t('enfermagem.balanco.fechamentos.oliguria') }}</strong
                    >
                  </td>
                  <td>{{ f.usuario }} · {{ hora(f.gravadoEm) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </template>

    <SanteDialogo v-model:visivel="dialogoEstorno" :titulo="t('enfermagem.balanco.estorno.titulo')">
      <div class="campo">
        <p>{{ t('enfermagem.balanco.estorno.texto') }}</p>
        <label for="bh-motivo">{{ t('enfermagem.balanco.estorno.motivo') }}</label>
        <input id="bh-motivo" v-model="motivo" maxlength="200" data-testid="bh-motivo" />
        <ErroEnfermagem v-if="erro" :erro="erro" />
        <SanteBotao
          :rotulo="t('enfermagem.balanco.estorno.confirmar')"
          :desabilitado="motivo.trim().length < 10"
          data-testid="bh-estorno-confirmar"
          @acionar="estornar"
        />
      </div>
    </SanteDialogo>
    <SanteDialogo v-model:visivel="dialogoFechar" :titulo="t('enfermagem.balanco.fechar.titulo')">
      <div v-if="b" class="campo">
        <p data-testid="bh-fechar-pergunta">
          {{
            fechando === 'total'
              ? t('enfermagem.balanco.fechar.confirmarTotal', {
                  inicio: hora(b.janela.inicio),
                  fim: hora(b.janela.fim),
                })
              : t('enfermagem.balanco.fechar.confirmarParcial', { ate: hora(b.calculo.ate) })
          }}
        </p>
        <p>{{ b.calculo.saldoConta }}</p>
        <p class="secundario">{{ t('enfermagem.balanco.fechar.texto') }}</p>
        <ErroEnfermagem v-if="erro" :erro="erro" />
        <SanteBotao
          :rotulo="t('enfermagem.balanco.fechar.confirmar')"
          data-testid="bh-fechar-confirmar"
          @acionar="fechar"
        />
      </div>
    </SanteDialogo>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.campos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-2);
  align-items: end;
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
.grafico .serie {
  fill: none;
  stroke: var(--sgh-primaria);
  stroke-width: 2;
}
.grafico .zero {
  stroke: var(--sgh-borda-forte);
  stroke-dasharray: 4 4;
}
.grafico .ponto {
  fill: var(--sgh-primaria);
}
.grafico .final {
  stroke: var(--sgh-texto);
  stroke-width: 2;
}
.grafico .eixo {
  font-size: 11px;
  fill: var(--sgh-texto-secundario);
}
</style>
