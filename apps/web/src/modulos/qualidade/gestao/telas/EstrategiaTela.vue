<script setup lang="ts">
// Gestão estratégica (C2-066, 01-ADM L118). Três abas numa tela só:
// - Mapa estratégico (BSC): objetivos por perspectiva com os indicadores ligados e o farol pela última apuração;
// - Iniciativas: ações com progresso, horas apontadas (total com as parcelas por pessoa) e mudança de situação;
// - Reuniões de análise crítica (ONA): participantes e presença, pauta com as análises do período, ata e deliberações.
// Validação na hora pelas mesmas regras do domínio que a API usa; o servidor decide.
import {
  MENSAGEM_ESTRATEGIA,
  type RecusaEstrategia,
  validarAcao,
  validarApontamento,
  validarDeliberacao,
  validarIniciativa,
  validarMapa,
  validarObjetivo,
  type SituacaoAcao,
  type SituacaoIniciativa,
} from '@sgh/dominio-qualidade';
import { PERMISSOES_GESTAO_QUALIDADE as P } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../../casca/erros/problem-details.js';
import { pode } from '../../../../casca/sessao/pode.js';
import {
  apontarHoras,
  gravarAcao,
  gravarDeliberacao,
  gravarIniciativa,
  gravarMapa,
  gravarObjetivo,
  gravarPauta,
  gravarPerspectiva,
  gravarReuniao,
  lerIniciativa,
  lerMapa,
  lerPainelEstrategia,
  lerReuniao,
  mudarSituacaoIniciativa,
  mudarSituacaoReuniao,
  registrarPresenca,
} from '../api-estrategia.js';
import NavGestao from '../componentes/NavGestao.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const hoje = () => new Date().toISOString().slice(0, 10);
const podeRegistrar = computed(() => pode(P.gestaoRegistrar));
const aba = ref<'mapa' | 'iniciativas' | 'reunioes'>('mapa');
const mensagem = ref('');
const erro = ref('');

const painel = useQuery({ queryKey: ['qualidade', 'estrategia'], queryFn: lerPainelEstrategia });
const recusas = (r: readonly RecusaEstrategia[]) => r.map((x) => MENSAGEM_ESTRATEGIA[x]).join(' ');

async function enviarCom(fn: () => Promise<unknown>, chaves: unknown[][]): Promise<boolean> {
  erro.value = '';
  mensagem.value = '';
  try {
    await fn();
    mensagem.value = t('gestaoQualidade.estrategia.gravado');
    for (const k of [['qualidade', 'estrategia'], ...chaves])
      await cliente.invalidateQueries({ queryKey: k });
    return true;
  } catch (e) {
    const cod = e instanceof ErroApi ? String(e.problema?.['codigo'] ?? '') : '';
    erro.value =
      MENSAGEM_ESTRATEGIA[cod as RecusaEstrategia] ??
      (e instanceof ErroApi ? (e.problema?.detail ?? e.message) : (e as Error).message);
    return false;
  }
}
const situacao = (s: string) => t(`gestaoQualidade.estrategia.situacoes.${s}`);
const logins = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

// ── Mapa ───────────────────────────────────────────────────────────────────────────────────────────
const mapaId = ref('');
watch(painel.data, (p) => {
  if (!mapaId.value && p?.mapas[0]) mapaId.value = String(p.mapas[0].id);
});
const opMapas = computed(() =>
  (painel.data.value?.mapas ?? []).map((m) => ({ valor: String(m.id), rotulo: m.nome })),
);
const mapa = useQuery({
  queryKey: computed(() => ['qualidade', 'estrategia', 'mapa', mapaId.value]),
  queryFn: () => lerMapa(Number(mapaId.value)),
  enabled: computed(() => !!mapaId.value),
});
const perspectivas = computed(() => painel.data.value?.perspectivas ?? []);
const opPerspectivas = computed(() =>
  perspectivas.value.map((p) => ({ valor: String(p.id), rotulo: p.descricao })),
);
const opIndicadores = computed(() =>
  (painel.data.value?.indicadores ?? []).map((i) => ({
    valor: String(i.id),
    rotulo: `${i.codigo} ${i.nome}`,
  })),
);
const porPerspectiva = computed(() =>
  perspectivas.value.map((p) => ({
    ...p,
    objetivos: (mapa.data.value?.objetivos ?? []).filter((o) => o.perspectiva === p.id),
  })),
);
const tituloObjetivo = (id: number) =>
  mapa.data.value?.objetivos.find((o) => o.id === id)?.codigo ?? String(id);

const novoMapa = reactive({
  aberto: false,
  nome: '',
  missao: '',
  visao: '',
  valores: '',
  inicio: '',
  fim: '',
});
const recusaMapa = computed(() =>
  novoMapa.inicio && novoMapa.fim
    ? recusas(validarMapa({ vigenciaInicio: novoMapa.inicio, vigenciaFim: novoMapa.fim }))
    : '',
);
async function salvarMapa() {
  const ok = await enviarCom(
    () =>
      gravarMapa({
        nome: novoMapa.nome,
        missao: novoMapa.missao || null,
        visao: novoMapa.visao || null,
        valores: novoMapa.valores || null,
        vigenciaInicio: novoMapa.inicio,
        vigenciaFim: novoMapa.fim,
      }),
    [],
  );
  if (ok) novoMapa.aberto = false;
}
const novaPerspectiva = reactive({ codigo: '', descricao: '' });
async function salvarPerspectiva() {
  if (
    await enviarCom(() => gravarPerspectiva({ ...novaPerspectiva, ordem: perspectivas.value.length + 1 }), [])
  )
    Object.assign(novaPerspectiva, { codigo: '', descricao: '' });
}

const obj = reactive({
  aberto: false,
  id: 0,
  versao: 0,
  codigo: '',
  titulo: '',
  perspectiva: '',
  responsavel: '',
  indicadores: [] as { indicador: string; peso: string }[],
  causas: [] as string[],
});
function abrirObjetivo(o?: NonNullable<typeof mapa.data.value>['objetivos'][number]) {
  Object.assign(obj, {
    aberto: true,
    id: o?.id ?? 0,
    versao: o?.versao ?? 0,
    codigo: o?.codigo ?? '',
    titulo: o?.titulo ?? '',
    perspectiva: o ? String(o.perspectiva) : (opPerspectivas.value[0]?.valor ?? ''),
    responsavel: o?.responsavel ?? '',
    indicadores: (o?.indicadores ?? []).map((i) => ({
      indicador: String(i.indicador),
      peso: i.peso === null ? '' : String(i.peso),
    })),
    causas: (o?.causas ?? []).map(String),
  });
}
const indicadoresObj = computed(() =>
  obj.indicadores
    .filter((i) => i.indicador)
    .map((i) => ({ indicador: Number(i.indicador), peso: i.peso === '' ? null : Number(i.peso) })),
);
const recusaObjetivo = computed(() => recusas(validarObjetivo(indicadoresObj.value)));
const opCausas = computed(() =>
  (mapa.data.value?.objetivos ?? [])
    .filter((o) => o.id !== obj.id)
    .map((o) => ({ valor: String(o.id), rotulo: `${o.codigo} ${o.titulo}` })),
);
async function salvarObjetivo() {
  const ok = await enviarCom(
    () =>
      gravarObjetivo({
        ...(obj.id ? { id: obj.id, versao: obj.versao } : {}),
        mapa: Number(mapaId.value),
        perspectiva: Number(obj.perspectiva),
        codigo: obj.codigo,
        titulo: obj.titulo,
        responsavel: obj.responsavel || null,
        indicadores: indicadoresObj.value,
        causas: obj.causas.map(Number),
      }),
    [['qualidade', 'estrategia', 'mapa', mapaId.value]],
  );
  if (ok) obj.aberto = false;
}

// ── Iniciativas ────────────────────────────────────────────────────────────────────────────────────
const iniId = ref<number | null>(null);
const ini = useQuery({
  queryKey: computed(() => ['qualidade', 'estrategia', 'iniciativa', iniId.value]),
  queryFn: () => lerIniciativa(iniId.value as number),
  enabled: computed(() => iniId.value !== null),
});
const PRIOR = ['baixa', 'media', 'alta', 'critica'];
const opPrioridade = computed(() =>
  PRIOR.map((p) => ({ valor: p, rotulo: t(`gestaoQualidade.estrategia.prioridades.${p}`) })),
);
const novaIni = reactive({
  aberto: false,
  titulo: '',
  responsavel: '',
  inicio: '',
  termino: '',
  prioridade: 'media',
  objetivo: '',
  participantes: '',
});
const recusaIni = computed(() =>
  novaIni.inicio && novaIni.termino
    ? recusas(validarIniciativa({ inicioPrevisto: novaIni.inicio, terminoPrevisto: novaIni.termino }))
    : '',
);
const opObjetivosMapa = computed(() =>
  (mapa.data.value?.objetivos ?? []).map((o) => ({ valor: String(o.id), rotulo: `${o.codigo} ${o.titulo}` })),
);
async function salvarIniciativa() {
  const ok = await enviarCom(
    () =>
      gravarIniciativa({
        titulo: novaIni.titulo,
        responsavel: novaIni.responsavel,
        inicioPrevisto: novaIni.inicio,
        terminoPrevisto: novaIni.termino,
        prioridade: novaIni.prioridade,
        mapa: mapaId.value ? Number(mapaId.value) : null,
        objetivos: novaIni.objetivo ? [Number(novaIni.objetivo)] : [],
        participantes: logins(novaIni.participantes).map((usuario) => ({ usuario, papel: 'equipe' })),
      }),
    [],
  );
  if (ok) novaIni.aberto = false;
}
const proximas: Record<string, string[]> = {
  planejada: ['em_andamento', 'suspensa', 'cancelada'],
  em_andamento: ['suspensa', 'concluida', 'cancelada'],
  suspensa: ['em_andamento', 'cancelada'],
};
const situacaoNova = ref('');
const opSituacaoIni = computed(() =>
  (proximas[ini.data.value?.situacao ?? ''] ?? []).map((s) => ({ valor: s, rotulo: situacao(s) })),
);
async function mudarIni() {
  const i = ini.data.value;
  if (!i || !situacaoNova.value) return;
  if (
    await enviarCom(
      () => mudarSituacaoIniciativa(i.id, { versao: i.versao, situacao: situacaoNova.value }),
      [['qualidade', 'estrategia', 'iniciativa', i.id]],
    )
  )
    situacaoNova.value = '';
}
const novaAcao = reactive({ titulo: '', responsavel: '', inicio: '', termino: '', horas: '' });
const recusaAcao = computed(() => {
  const i = ini.data.value;
  if (!i || !novaAcao.inicio || !novaAcao.termino) return '';
  return recusas(
    validarAcao(
      { inicioPrevisto: novaAcao.inicio, terminoPrevisto: novaAcao.termino },
      {
        inicioPrevisto: i.inicioPrevisto,
        terminoPrevisto: i.terminoPrevisto,
        situacao: i.situacao as SituacaoIniciativa,
      },
    ),
  );
});
async function salvarAcao() {
  const i = ini.data.value;
  if (!i) return;
  if (
    await enviarCom(
      () =>
        gravarAcao({
          iniciativa: i.id,
          titulo: novaAcao.titulo,
          responsavel: novaAcao.responsavel,
          inicioPrevisto: novaAcao.inicio,
          terminoPrevisto: novaAcao.termino,
          duracaoPrevistaMinutos: novaAcao.horas ? Math.round(Number(novaAcao.horas) * 60) : null,
        }),
      [['qualidade', 'estrategia', 'iniciativa', i.id]],
    )
  )
    Object.assign(novaAcao, { titulo: '', inicio: '', termino: '', horas: '' });
}
async function situacaoAcao(a: NonNullable<typeof ini.data.value>['acoes'][number], s: SituacaoAcao) {
  const i = ini.data.value;
  if (!i) return;
  await enviarCom(
    () =>
      gravarAcao({
        id: a.id,
        versao: a.versao,
        iniciativa: i.id,
        titulo: a.titulo,
        responsavel: a.responsavel,
        inicioPrevisto: a.inicioPrevisto,
        terminoPrevisto: a.terminoPrevisto,
        duracaoPrevistaMinutos: a.duracaoPrevistaMinutos,
        situacao: s,
      }),
    [['qualidade', 'estrategia', 'iniciativa', i.id]],
  );
}
const horas = reactive({ acao: '', data: hoje(), minutos: '' });
const opAcoes = computed(() =>
  (ini.data.value?.acoes ?? []).map((a) => ({ valor: String(a.id), rotulo: a.titulo })),
);
const recusaHoras = computed(() => {
  const i = ini.data.value;
  const a = i?.acoes.find((x) => String(x.id) === horas.acao);
  if (!i || !a || !horas.minutos) return '';
  const ja = i.apontamentos.filter((x) => x.dataTrabalho === horas.data).reduce((s, x) => s + x.minutos, 0);
  return recusas(
    validarApontamento({
      dataTrabalho: horas.data,
      minutos: Number(horas.minutos),
      hoje: hoje(),
      minutosJaApontadosNoDia: ja,
      acao: { situacao: a.situacao as SituacaoAcao, inicioPrevisto: a.inicioPrevisto },
      iniciativa: i.situacao as SituacaoIniciativa,
    }),
  );
});
async function salvarHoras() {
  const i = ini.data.value;
  if (!i) return;
  if (
    await enviarCom(
      () =>
        apontarHoras({ acao: Number(horas.acao), dataTrabalho: horas.data, minutos: Number(horas.minutos) }),
      [['qualidade', 'estrategia', 'iniciativa', i.id]],
    )
  )
    horas.minutos = '';
}
const emHoras = (m: number) => (m / 60).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const parcelasHoras = computed(() =>
  (ini.data.value?.horas.porPessoa ?? []).map((p) => `${p.pessoa} ${emHoras(p.minutos)} h`).join(' + '),
);

// ── Reuniões ───────────────────────────────────────────────────────────────────────────────────────
const reuId = ref<number | null>(null);
const reu = useQuery({
  queryKey: computed(() => ['qualidade', 'estrategia', 'reuniao', reuId.value]),
  queryFn: () => lerReuniao(reuId.value as number),
  enabled: computed(() => reuId.value !== null),
});
const chaveReu = () => [['qualidade', 'estrategia', 'reuniao', reuId.value]];
const novaReu = reactive({
  aberto: false,
  titulo: '',
  inicio: '',
  compIni: '',
  compFim: '',
  local: '',
  responsavel: '',
  participantes: '',
  convidados: '',
});
async function salvarReuniao() {
  const ok = await enviarCom(
    () =>
      gravarReuniao({
        titulo: novaReu.titulo,
        inicioPrevisto: novaReu.inicio,
        competenciaInicio: `${novaReu.compIni}-01`,
        competenciaFim: `${novaReu.compFim}-01`,
        local: novaReu.local || null,
        responsavel: novaReu.responsavel,
        mapa: mapaId.value ? Number(mapaId.value) : null,
        participantes: [
          ...logins(novaReu.participantes).map((usuario, n) => ({
            usuario,
            papel: n === 0 ? 'coordenador' : 'participante',
          })),
          ...logins(novaReu.convidados).map((convidado) => ({ convidado, papel: 'convidado' })),
        ],
      }),
    [],
  );
  if (ok) novaReu.aberto = false;
}
const presencas = ref<Record<number, { presenca: string; justificativa: string }>>({});
watch(
  () => reu.data.value,
  (r) => {
    presencas.value = Object.fromEntries(
      (r?.participantes ?? []).map((p) => [
        p.id,
        { presenca: p.presenca, justificativa: p.justificativa ?? '' },
      ]),
    );
    ata.value = r?.ata ?? '';
  },
);
const opPresenca = computed(() =>
  ['convocado', 'presente', 'ausente', 'ausencia_justificada'].map((p) => ({
    valor: p,
    rotulo: t(`gestaoQualidade.estrategia.presencas.${p}`),
  })),
);
const faltaJustificativa = computed(() =>
  Object.values(presencas.value).some(
    (p) => p.presenca === 'ausencia_justificada' && !p.justificativa.trim(),
  ),
);
async function salvarPresencas() {
  const r = reu.data.value;
  if (!r) return;
  await enviarCom(
    () =>
      registrarPresenca(r.id, {
        presencas: Object.entries(presencas.value).map(([id, p]) => ({
          participante: Number(id),
          presenca: p.presenca,
          justificativa: p.justificativa || null,
        })),
      }),
    chaveReu(),
  );
}
const pauta = (analise: number, por: boolean) => {
  const r = reu.data.value;
  if (r)
    void enviarCom(
      () => gravarPauta(r.id, por ? { analises: [analise] } : { analises: [], retirar: [analise] }),
      chaveReu(),
    );
};
const ata = ref('');
const fechada = computed(() => ['encerrada', 'cancelada'].includes(reu.data.value?.situacao ?? ''));
async function situacaoReu(s: string) {
  const r = reu.data.value;
  if (r)
    await enviarCom(
      () => mudarSituacaoReuniao(r.id, { versao: r.versao, situacao: s, ata: ata.value || null }),
      chaveReu(),
    );
}
const delib = reactive({ descricao: '', responsavel: '', prazo: '', indicador: '' });
const recusaDelib = computed(() =>
  reu.data.value
    ? recusas(validarDeliberacao({ prazo: delib.prazo || null }, reu.data.value.inicioPrevisto))
    : '',
);
async function salvarDeliberacao() {
  const r = reu.data.value;
  if (!r) return;
  if (
    await enviarCom(
      () =>
        gravarDeliberacao({
          reuniao: r.id,
          descricao: delib.descricao,
          responsavel: delib.responsavel || null,
          prazo: delib.prazo || null,
          indicador: delib.indicador ? Number(delib.indicador) : null,
        }),
      chaveReu(),
    )
  )
    Object.assign(delib, { descricao: '', prazo: '', indicador: '' });
}
async function concluirDeliberacao(d: NonNullable<typeof reu.data.value>['deliberacoes'][number]) {
  const r = reu.data.value;
  if (r)
    await enviarCom(
      () =>
        gravarDeliberacao({
          id: d.id,
          versao: d.versao,
          reuniao: r.id,
          descricao: d.descricao,
          situacao: 'concluida',
        }),
      chaveReu(),
    );
}
</script>

<template>
  <section class="tela-gestao" aria-labelledby="estrategia-titulo" data-testid="tela-estrategia">
    <NavGestao />
    <h1 id="estrategia-titulo">{{ t('gestaoQualidade.estrategia.titulo') }}</h1>
    <p class="secundario">{{ t('gestaoQualidade.estrategia.subtitulo') }}</p>
    <div class="abas" role="tablist" :aria-label="t('gestaoQualidade.estrategia.titulo')">
      <button
        v-for="a in ['mapa', 'iniciativas', 'reunioes'] as const"
        :key="a"
        type="button"
        role="tab"
        :aria-selected="aba === a"
        :data-testid="`estrategia-aba-${a}`"
        @click="aba = a"
      >
        {{ t(`gestaoQualidade.estrategia.abas.${a}`) }}
      </button>
    </div>
    <p v-if="mensagem" role="status" class="ok" data-testid="estrategia-mensagem">{{ mensagem }}</p>
    <p v-if="erro" role="alert" class="recusa" data-testid="estrategia-erro">{{ erro }}</p>
    <p v-if="painel.isLoading.value">{{ t('gestaoQualidade.estrategia.carregando') }}</p>

    <!-- Mapa estratégico -->
    <div v-if="aba === 'mapa'" class="bloco" data-testid="estrategia-mapa">
      <div class="linha">
        <SanteSelecao
          v-model="mapaId"
          :rotulo="t('gestaoQualidade.estrategia.mapa.escolher')"
          :opcoes="opMapas"
          data-testid="mapa-escolha"
        />
        <SanteBotao
          v-if="podeRegistrar"
          :rotulo="t('gestaoQualidade.estrategia.mapa.novo')"
          variante="secundario"
          data-testid="mapa-novo"
          @click="novoMapa.aberto = !novoMapa.aberto"
        />
      </div>
      <form v-if="novoMapa.aberto" class="formulario" data-testid="mapa-form" @submit.prevent="salvarMapa">
        <label
          >{{ t('gestaoQualidade.estrategia.mapa.nome')
          }}<input v-model="novoMapa.nome" required maxlength="150" data-testid="mapa-nome"
        /></label>
        <label
          >{{ t('gestaoQualidade.estrategia.mapa.missao')
          }}<textarea v-model="novoMapa.missao" maxlength="2000" />
        </label>
        <label
          >{{ t('gestaoQualidade.estrategia.mapa.visao')
          }}<textarea v-model="novoMapa.visao" maxlength="2000" />
        </label>
        <label
          >{{ t('gestaoQualidade.estrategia.mapa.vigenciaInicio')
          }}<input v-model="novoMapa.inicio" type="date" required data-testid="mapa-inicio"
        /></label>
        <label
          >{{ t('gestaoQualidade.estrategia.mapa.vigenciaFim')
          }}<input v-model="novoMapa.fim" type="date" required data-testid="mapa-fim"
        /></label>
        <p v-if="recusaMapa" class="recusa" data-testid="mapa-recusa">{{ recusaMapa }}</p>
        <SanteBotao
          tipo="submit"
          :rotulo="t('gestaoQualidade.estrategia.gravar')"
          :desabilitado="!!recusaMapa"
          data-testid="mapa-gravar"
        />
      </form>

      <p v-if="!perspectivas.length" class="secundario">
        {{ t('gestaoQualidade.estrategia.mapa.semPerspectiva') }}
      </p>
      <form
        v-if="podeRegistrar"
        class="linha"
        data-testid="perspectiva-form"
        @submit.prevent="salvarPerspectiva"
      >
        <label
          >{{ t('gestaoQualidade.estrategia.mapa.perspectivaCodigo')
          }}<input v-model="novaPerspectiva.codigo" required maxlength="30" data-testid="perspectiva-codigo"
        /></label>
        <label
          >{{ t('gestaoQualidade.estrategia.mapa.perspectivaDescricao')
          }}<input
            v-model="novaPerspectiva.descricao"
            required
            maxlength="150"
            data-testid="perspectiva-descricao"
        /></label>
        <SanteBotao
          tipo="submit"
          :rotulo="t('gestaoQualidade.estrategia.mapa.perspectivaNova')"
          variante="secundario"
          data-testid="perspectiva-gravar"
        />
      </form>

      <template v-if="mapa.data.value">
        <dl class="identidade">
          <template v-if="mapa.data.value.missao"
            ><dt>{{ t('gestaoQualidade.estrategia.mapa.missao') }}</dt>
            <dd>{{ mapa.data.value.missao }}</dd></template
          >
          <template v-if="mapa.data.value.visao"
            ><dt>{{ t('gestaoQualidade.estrategia.mapa.visao') }}</dt>
            <dd>{{ mapa.data.value.visao }}</dd></template
          >
        </dl>
        <div
          v-for="p in porPerspectiva"
          :key="p.id"
          class="perspectiva"
          :data-testid="`perspectiva-${p.codigo}`"
        >
          <h2>{{ p.descricao }}</h2>
          <article
            v-for="o in p.objetivos"
            :key="o.id"
            class="objetivo"
            :class="`farol-${o.desempenho.farol}`"
            :data-testid="`objetivo-${o.codigo}`"
          >
            <header class="linha">
              <strong>{{ o.codigo }} {{ o.titulo }}</strong>
              <span class="farol" :data-testid="`farol-${o.codigo}`">{{
                t(`gestaoQualidade.estrategia.mapa.farois.${o.desempenho.farol}`)
              }}</span>
              <SanteBotao
                v-if="podeRegistrar"
                :rotulo="t('gestaoQualidade.estrategia.editar')"
                variante="secundario"
                @click="abrirObjetivo(o)"
              />
            </header>
            <p class="secundario">
              {{
                o.desempenho.percentualNaMeta === null
                  ? t('gestaoQualidade.estrategia.mapa.semDado')
                  : t('gestaoQualidade.estrategia.mapa.naMeta', {
                      na: o.desempenho.naMeta,
                      total: o.desempenho.naMeta + o.desempenho.foraDaMeta,
                      pct: o.desempenho.percentualNaMeta.toLocaleString('pt-BR'),
                    })
              }}
            </p>
            <ul>
              <li v-for="i in o.indicadores" :key="i.indicador">
                {{ i.codigo }} {{ i.nome }}<template v-if="i.peso !== null"> ({{ i.peso }}%)</template>:
                {{ i.situacaoMeta ?? '—'
                }}<template v-if="i.competencia">
                  ·
                  {{
                    t('gestaoQualidade.estrategia.mapa.ultima', { competencia: i.competencia.slice(0, 7) })
                  }}</template
                >
              </li>
            </ul>
            <p v-if="o.causas.length" class="secundario">
              {{ t('gestaoQualidade.estrategia.mapa.causas') }}: {{ o.causas.map(tituloObjetivo).join(', ') }}
            </p>
          </article>
        </div>
        <SanteBotao
          v-if="podeRegistrar && perspectivas.length"
          :rotulo="t('gestaoQualidade.estrategia.mapa.objetivoNovo')"
          data-testid="objetivo-novo"
          @click="abrirObjetivo()"
        />
      </template>

      <form v-if="obj.aberto" class="formulario" data-testid="objetivo-form" @submit.prevent="salvarObjetivo">
        <label
          >{{ t('gestaoQualidade.estrategia.mapa.objetivoCodigo')
          }}<input v-model="obj.codigo" required maxlength="30" data-testid="objetivo-codigo"
        /></label>
        <label
          >{{ t('gestaoQualidade.estrategia.mapa.objetivoTitulo')
          }}<input v-model="obj.titulo" required maxlength="240" data-testid="objetivo-titulo"
        /></label>
        <SanteSelecao
          v-model="obj.perspectiva"
          :rotulo="t('gestaoQualidade.estrategia.mapa.perspectiva')"
          :opcoes="opPerspectivas"
          data-testid="objetivo-perspectiva"
        />
        <label
          >{{ t('gestaoQualidade.estrategia.mapa.responsavel')
          }}<input v-model="obj.responsavel" maxlength="60"
        /></label>
        <fieldset>
          <legend>{{ t('gestaoQualidade.estrategia.mapa.indicadores') }}</legend>
          <div v-for="(i, n) in obj.indicadores" :key="n" class="linha">
            <SanteSelecao
              v-model="i.indicador"
              :rotulo="t('gestaoQualidade.estrategia.mapa.indicador')"
              :opcoes="opIndicadores"
              :data-testid="`objetivo-indicador-${n}`"
            />
            <label
              >{{ t('gestaoQualidade.estrategia.mapa.peso')
              }}<input
                v-model="i.peso"
                type="number"
                min="0"
                max="100"
                step="0.01"
                :data-testid="`objetivo-peso-${n}`"
            /></label>
            <SanteBotao
              :rotulo="t('gestaoQualidade.estrategia.mapa.tirar')"
              variante="secundario"
              @click="obj.indicadores.splice(n, 1)"
            />
          </div>
          <SanteBotao
            :rotulo="t('gestaoQualidade.estrategia.mapa.incluirIndicador')"
            variante="secundario"
            data-testid="objetivo-incluir-indicador"
            @click="obj.indicadores.push({ indicador: '', peso: '' })"
          />
        </fieldset>
        <fieldset v-if="opCausas.length">
          <legend>{{ t('gestaoQualidade.estrategia.mapa.causas') }}</legend>
          <label v-for="c in opCausas" :key="c.valor" class="marca"
            ><input v-model="obj.causas" type="checkbox" :value="c.valor" />{{ c.rotulo }}</label
          >
        </fieldset>
        <p v-if="recusaObjetivo" class="recusa" data-testid="objetivo-recusa">{{ recusaObjetivo }}</p>
        <SanteBotao
          tipo="submit"
          :rotulo="t('gestaoQualidade.estrategia.gravar')"
          :desabilitado="!!recusaObjetivo"
          data-testid="objetivo-gravar"
        />
      </form>
    </div>

    <!-- Iniciativas -->
    <div v-if="aba === 'iniciativas'" class="bloco" data-testid="estrategia-iniciativas">
      <SanteBotao
        v-if="podeRegistrar"
        :rotulo="t('gestaoQualidade.estrategia.iniciativa.nova')"
        data-testid="iniciativa-nova"
        @click="novaIni.aberto = !novaIni.aberto"
      />
      <form
        v-if="novaIni.aberto"
        class="formulario"
        data-testid="iniciativa-form"
        @submit.prevent="salvarIniciativa"
      >
        <label
          >{{ t('gestaoQualidade.estrategia.iniciativa.titulo')
          }}<input v-model="novaIni.titulo" required maxlength="240" data-testid="iniciativa-titulo"
        /></label>
        <label
          >{{ t('gestaoQualidade.estrategia.iniciativa.responsavel')
          }}<input v-model="novaIni.responsavel" required maxlength="60" data-testid="iniciativa-responsavel"
        /></label>
        <label
          >{{ t('gestaoQualidade.estrategia.iniciativa.inicio')
          }}<input v-model="novaIni.inicio" type="date" required data-testid="iniciativa-inicio"
        /></label>
        <label
          >{{ t('gestaoQualidade.estrategia.iniciativa.termino')
          }}<input v-model="novaIni.termino" type="date" required data-testid="iniciativa-termino"
        /></label>
        <SanteSelecao
          v-model="novaIni.prioridade"
          :rotulo="t('gestaoQualidade.estrategia.iniciativa.prioridade')"
          :opcoes="opPrioridade"
          data-testid="iniciativa-prioridade"
        />
        <SanteSelecao
          v-model="novaIni.objetivo"
          :rotulo="t('gestaoQualidade.estrategia.iniciativa.objetivos')"
          :opcoes="opObjetivosMapa"
          data-testid="iniciativa-objetivo"
        />
        <label
          >{{ t('gestaoQualidade.estrategia.iniciativa.participantes')
          }}<input v-model="novaIni.participantes" maxlength="2000" data-testid="iniciativa-participantes"
        /></label>
        <p v-if="recusaIni" class="recusa" data-testid="iniciativa-recusa">{{ recusaIni }}</p>
        <SanteBotao
          tipo="submit"
          :rotulo="t('gestaoQualidade.estrategia.gravar')"
          :desabilitado="!!recusaIni"
          data-testid="iniciativa-gravar"
        />
      </form>
      <table class="tabela" data-testid="iniciativas-lista">
        <thead>
          <tr>
            <th>{{ t('gestaoQualidade.estrategia.iniciativa.titulo') }}</th>
            <th>{{ t('gestaoQualidade.estrategia.iniciativa.situacao') }}</th>
            <th>{{ t('gestaoQualidade.estrategia.iniciativa.progresso') }}</th>
            <th>{{ t('gestaoQualidade.estrategia.iniciativa.termino') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in painel.data.value?.iniciativas ?? []" :key="i.id">
            <td>{{ i.codigo }} {{ i.titulo }}</td>
            <td>{{ situacao(i.situacao) }}</td>
            <td>
              <progress
                :value="i.progresso"
                max="100"
                :aria-label="t('gestaoQualidade.estrategia.iniciativa.progresso')"
              />
              {{ i.progresso.toLocaleString('pt-BR') }}%
            </td>
            <td>{{ i.terminoPrevisto }}</td>
            <td>
              <SanteBotao
                :rotulo="t('gestaoQualidade.estrategia.abrir')"
                variante="secundario"
                :data-testid="`iniciativa-abrir-${i.codigo}`"
                @click="iniId = i.id"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <section v-if="ini.data.value" class="detalhe" data-testid="iniciativa-detalhe">
        <h2>{{ ini.data.value.codigo }} {{ ini.data.value.titulo }}</h2>
        <p>
          {{ situacao(ini.data.value.situacao) }} · {{ ini.data.value.progresso.toLocaleString('pt-BR') }}% ·
          <span data-testid="iniciativa-horas">{{
            t('gestaoQualidade.estrategia.iniciativa.totalHoras', {
              total: emHoras(ini.data.value.horas.total),
              parcelas: parcelasHoras || '0 h',
            })
          }}</span>
        </p>
        <div v-if="podeRegistrar && opSituacaoIni.length" class="linha">
          <SanteSelecao
            v-model="situacaoNova"
            :rotulo="t('gestaoQualidade.estrategia.iniciativa.mudarPara')"
            :opcoes="opSituacaoIni"
            data-testid="iniciativa-situacao"
          />
          <SanteBotao
            :rotulo="t('gestaoQualidade.estrategia.gravar')"
            :desabilitado="!situacaoNova"
            data-testid="iniciativa-situacao-gravar"
            @click="mudarIni"
          />
        </div>
        <h3>{{ t('gestaoQualidade.estrategia.iniciativa.acoes') }}</h3>
        <table class="tabela" data-testid="acoes-lista">
          <tbody>
            <tr v-for="a in ini.data.value.acoes" :key="a.id">
              <td>{{ a.sequencia }}. {{ a.titulo }}</td>
              <td>{{ a.responsavel }}</td>
              <td>
                {{
                  t('gestaoQualidade.estrategia.iniciativa.periodo', {
                    inicio: a.inicioPrevisto,
                    fim: a.terminoPrevisto,
                  })
                }}
              </td>
              <td>{{ situacao(a.situacao) }} ({{ a.progresso.toLocaleString('pt-BR') }}%)</td>
              <td>
                {{
                  t('gestaoQualidade.estrategia.iniciativa.emHoras', { horas: emHoras(a.minutosApontados) })
                }}
              </td>
              <td>
                <SanteBotao
                  v-if="podeRegistrar && ['pendente', 'em_andamento'].includes(a.situacao)"
                  :rotulo="t('gestaoQualidade.estrategia.reuniao.concluir')"
                  variante="secundario"
                  :data-testid="`acao-concluir-${a.sequencia}`"
                  @click="situacaoAcao(a, 'concluida')"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <form v-if="podeRegistrar" class="linha" data-testid="acao-form" @submit.prevent="salvarAcao">
          <label
            >{{ t('gestaoQualidade.estrategia.iniciativa.acaoTitulo')
            }}<input v-model="novaAcao.titulo" required maxlength="240" data-testid="acao-titulo"
          /></label>
          <label
            >{{ t('gestaoQualidade.estrategia.iniciativa.responsavel')
            }}<input v-model="novaAcao.responsavel" required maxlength="60" data-testid="acao-responsavel"
          /></label>
          <label
            >{{ t('gestaoQualidade.estrategia.iniciativa.inicio')
            }}<input v-model="novaAcao.inicio" type="date" required data-testid="acao-inicio"
          /></label>
          <label
            >{{ t('gestaoQualidade.estrategia.iniciativa.termino')
            }}<input v-model="novaAcao.termino" type="date" required data-testid="acao-termino"
          /></label>
          <label
            >{{ t('gestaoQualidade.estrategia.iniciativa.duracao')
            }}<input v-model="novaAcao.horas" type="number" min="0" step="0.5" data-testid="acao-horas"
          /></label>
          <p v-if="recusaAcao" class="recusa" data-testid="acao-recusa">{{ recusaAcao }}</p>
          <SanteBotao
            tipo="submit"
            :rotulo="t('gestaoQualidade.estrategia.iniciativa.acaoNova')"
            :desabilitado="!!recusaAcao"
            data-testid="acao-gravar"
          />
        </form>
        <form v-if="opAcoes.length" class="linha" data-testid="horas-form" @submit.prevent="salvarHoras">
          <SanteSelecao
            v-model="horas.acao"
            :rotulo="t('gestaoQualidade.estrategia.iniciativa.acaoTitulo')"
            :opcoes="opAcoes"
            data-testid="horas-acao"
          />
          <label
            >{{ t('gestaoQualidade.estrategia.iniciativa.data')
            }}<input v-model="horas.data" type="date" required data-testid="horas-data"
          /></label>
          <label
            >{{ t('gestaoQualidade.estrategia.iniciativa.minutos')
            }}<input
              v-model="horas.minutos"
              type="number"
              min="1"
              max="1440"
              required
              data-testid="horas-minutos"
          /></label>
          <p v-if="recusaHoras" class="recusa" data-testid="horas-recusa">{{ recusaHoras }}</p>
          <SanteBotao
            tipo="submit"
            :rotulo="t('gestaoQualidade.estrategia.iniciativa.apontar')"
            :desabilitado="!!recusaHoras || !horas.acao"
            data-testid="horas-gravar"
          />
        </form>
      </section>
    </div>

    <!-- Reuniões de análise crítica -->
    <div v-if="aba === 'reunioes'" class="bloco" data-testid="estrategia-reunioes">
      <SanteBotao
        v-if="podeRegistrar"
        :rotulo="t('gestaoQualidade.estrategia.reuniao.nova')"
        data-testid="reuniao-nova"
        @click="novaReu.aberto = !novaReu.aberto"
      />
      <form
        v-if="novaReu.aberto"
        class="formulario"
        data-testid="reuniao-form"
        @submit.prevent="salvarReuniao"
      >
        <label
          >{{ t('gestaoQualidade.estrategia.reuniao.titulo')
          }}<input v-model="novaReu.titulo" required maxlength="150" data-testid="reuniao-titulo"
        /></label>
        <label
          >{{ t('gestaoQualidade.estrategia.reuniao.inicio')
          }}<input v-model="novaReu.inicio" type="datetime-local" required data-testid="reuniao-inicio"
        /></label>
        <label
          >{{ t('gestaoQualidade.estrategia.reuniao.competenciaInicio')
          }}<input v-model="novaReu.compIni" type="month" required data-testid="reuniao-comp-ini"
        /></label>
        <label
          >{{ t('gestaoQualidade.estrategia.reuniao.competenciaFim')
          }}<input v-model="novaReu.compFim" type="month" required data-testid="reuniao-comp-fim"
        /></label>
        <label
          >{{ t('gestaoQualidade.estrategia.reuniao.local') }}<input v-model="novaReu.local" maxlength="150"
        /></label>
        <label
          >{{ t('gestaoQualidade.estrategia.reuniao.responsavel')
          }}<input v-model="novaReu.responsavel" required maxlength="60" data-testid="reuniao-responsavel"
        /></label>
        <label
          >{{ t('gestaoQualidade.estrategia.reuniao.participantes')
          }}<input v-model="novaReu.participantes" maxlength="2000" data-testid="reuniao-participantes"
        /></label>
        <label
          >{{ t('gestaoQualidade.estrategia.reuniao.convidados')
          }}<input v-model="novaReu.convidados" maxlength="2000" data-testid="reuniao-convidados"
        /></label>
        <SanteBotao
          tipo="submit"
          :rotulo="t('gestaoQualidade.estrategia.gravar')"
          :desabilitado="!!novaReu.compFim && novaReu.compFim < novaReu.compIni"
          data-testid="reuniao-gravar"
        />
      </form>
      <table class="tabela" data-testid="reunioes-lista">
        <tbody>
          <tr v-for="r in painel.data.value?.reunioes ?? []" :key="r.id">
            <td>{{ r.numero }}</td>
            <td>{{ r.titulo }}</td>
            <td>{{ r.inicioPrevisto?.slice(0, 16).replace('T', ' ') }}</td>
            <td>{{ situacao(r.situacao) }}</td>
            <td>
              <SanteBotao
                :rotulo="t('gestaoQualidade.estrategia.abrir')"
                variante="secundario"
                :data-testid="`reuniao-abrir-${r.numero}`"
                @click="reuId = r.id"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <section v-if="reu.data.value" class="detalhe" data-testid="reuniao-detalhe">
        <h2>
          {{ reu.data.value.numero }} {{ reu.data.value.titulo }} · {{ situacao(reu.data.value.situacao) }}
        </h2>
        <h3>{{ t('gestaoQualidade.estrategia.reuniao.presenca') }}</h3>
        <div
          v-for="p in reu.data.value.participantes"
          :key="p.id"
          class="linha"
          :data-testid="`participante-${p.id}`"
        >
          <span>{{ p.usuario ?? p.convidado }} ({{ p.papel }})</span>
          <template v-if="presencas[p.id]">
            <SanteSelecao
              v-model="presencas[p.id]!.presenca"
              :rotulo="t('gestaoQualidade.estrategia.reuniao.presenca')"
              :opcoes="opPresenca"
              :desabilitado="fechada"
              :data-testid="`presenca-${p.id}`"
            />
            <label v-if="presencas[p.id]!.presenca === 'ausencia_justificada'"
              >{{ t('gestaoQualidade.estrategia.reuniao.justificativa')
              }}<input
                v-model="presencas[p.id]!.justificativa"
                maxlength="500"
                :data-testid="`justificativa-${p.id}`"
            /></label>
          </template>
        </div>
        <p v-if="faltaJustificativa" class="recusa">
          {{ MENSAGEM_ESTRATEGIA['reuniao-justificativa-ausencia'] }}
        </p>
        <SanteBotao
          v-if="podeRegistrar && !fechada"
          :rotulo="t('gestaoQualidade.estrategia.reuniao.gravarPresenca')"
          :desabilitado="faltaJustificativa"
          data-testid="presenca-gravar"
          @click="salvarPresencas"
        />

        <h3>{{ t('gestaoQualidade.estrategia.reuniao.analises') }}</h3>
        <ul data-testid="pauta-lista">
          <li v-for="a in reu.data.value.pautaAnalises" :key="a.id">
            {{ a.indicador }} · {{ a.competencia.slice(0, 7) }} · {{ a.resultado }}: {{ a.analise }}
            <SanteBotao
              v-if="podeRegistrar && !fechada"
              :rotulo="t('gestaoQualidade.estrategia.reuniao.tirarPauta')"
              variante="secundario"
              @click="pauta(a.id, false)"
            />
          </li>
        </ul>
        <h3 v-if="reu.data.value.analisesDisponiveis.length">
          {{ t('gestaoQualidade.estrategia.reuniao.disponiveis') }}
        </h3>
        <ul data-testid="pauta-disponiveis">
          <li v-for="a in reu.data.value.analisesDisponiveis" :key="a.id">
            {{ a.indicador }} · {{ a.competencia.slice(0, 7) }} · {{ a.resultado }}
            <SanteBotao
              v-if="podeRegistrar && !fechada"
              :rotulo="t('gestaoQualidade.estrategia.reuniao.incluirPauta')"
              variante="secundario"
              :data-testid="`pauta-incluir-${a.id}`"
              @click="pauta(a.id, true)"
            />
          </li>
        </ul>

        <h3>{{ t('gestaoQualidade.estrategia.reuniao.deliberacoes') }}</h3>
        <ul data-testid="deliberacoes-lista">
          <li v-for="d in reu.data.value.deliberacoes" :key="d.id">
            {{ d.sequencia }}. {{ d.descricao }} · {{ d.responsavel ?? '—' }} · {{ d.prazo ?? '—' }} ·
            {{ situacao(d.situacao) }}
            <SanteBotao
              v-if="podeRegistrar && d.situacao !== 'concluida' && d.situacao !== 'cancelada'"
              :rotulo="t('gestaoQualidade.estrategia.reuniao.concluir')"
              variante="secundario"
              :data-testid="`deliberacao-concluir-${d.sequencia}`"
              @click="concluirDeliberacao(d)"
            />
          </li>
        </ul>
        <form
          v-if="podeRegistrar && !fechada"
          class="linha"
          data-testid="deliberacao-form"
          @submit.prevent="salvarDeliberacao"
        >
          <label
            >{{ t('gestaoQualidade.estrategia.reuniao.deliberacao')
            }}<input v-model="delib.descricao" required maxlength="2000" data-testid="deliberacao-descricao"
          /></label>
          <label
            >{{ t('gestaoQualidade.estrategia.iniciativa.responsavel')
            }}<input v-model="delib.responsavel" maxlength="60" data-testid="deliberacao-responsavel"
          /></label>
          <label
            >{{ t('gestaoQualidade.estrategia.reuniao.prazo')
            }}<input v-model="delib.prazo" type="date" data-testid="deliberacao-prazo"
          /></label>
          <SanteSelecao
            v-model="delib.indicador"
            :rotulo="t('gestaoQualidade.estrategia.mapa.indicador')"
            :opcoes="opIndicadores"
            data-testid="deliberacao-indicador"
          />
          <p v-if="recusaDelib" class="recusa" data-testid="deliberacao-recusa">{{ recusaDelib }}</p>
          <SanteBotao
            tipo="submit"
            :rotulo="t('gestaoQualidade.estrategia.reuniao.incluirDeliberacao')"
            :desabilitado="!!recusaDelib"
            data-testid="deliberacao-gravar"
          />
        </form>

        <template v-if="podeRegistrar && !fechada">
          <label class="ata"
            >{{ t('gestaoQualidade.estrategia.reuniao.ata')
            }}<textarea v-model="ata" rows="5" maxlength="20000" data-testid="reuniao-ata" />
          </label>
          <div class="linha">
            <SanteBotao
              v-if="reu.data.value.situacao === 'agendada'"
              :rotulo="t('gestaoQualidade.estrategia.reuniao.preparar')"
              variante="secundario"
              @click="situacaoReu('em_preparacao')"
            />
            <SanteBotao
              v-if="['agendada', 'em_preparacao'].includes(reu.data.value.situacao)"
              :rotulo="t('gestaoQualidade.estrategia.reuniao.realizar')"
              data-testid="reuniao-realizar"
              @click="situacaoReu('realizada')"
            />
            <SanteBotao
              v-if="reu.data.value.situacao === 'realizada'"
              :rotulo="t('gestaoQualidade.estrategia.reuniao.encerrar')"
              :desabilitado="!ata.trim()"
              data-testid="reuniao-encerrar"
              @click="situacaoReu('encerrada')"
            />
            <SanteBotao
              v-if="['agendada', 'em_preparacao'].includes(reu.data.value.situacao)"
              :rotulo="t('gestaoQualidade.estrategia.reuniao.cancelar')"
              variante="secundario"
              @click="situacaoReu('cancelada')"
            />
          </div>
        </template>
        <p v-else-if="reu.data.value.ata" class="ata-lida" data-testid="reuniao-ata-lida">
          {{ reu.data.value.ata }}
        </p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.bloco,
.formulario,
.detalhe {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.abas {
  display: flex;
  gap: var(--sgh-espaco-2);
}
.perspectiva {
  border-top: 1px solid var(--sgh-borda);
  padding-top: var(--sgh-espaco-2);
}
.objetivo {
  border-left: 4px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  margin-bottom: var(--sgh-espaco-2);
}
.farol-verde {
  border-left-color: var(--sgh-sucesso);
}
.farol-amarelo {
  border-left-color: var(--sgh-aviso);
}
.farol-vermelho {
  border-left-color: var(--sgh-alerta);
}
.secundario {
  color: var(--sgh-texto-secundario);
}
.recusa {
  color: var(--sgh-alerta);
}
.ata textarea {
  width: 100%;
}
.marca {
  display: flex;
  gap: var(--sgh-espaco-1);
}
</style>
