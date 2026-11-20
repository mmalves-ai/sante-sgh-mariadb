<script setup lang="ts">
// Processo de enfermagem (M45, etapa 4; ficha, seção 7 e regras 7 e 8): as cinco etapas do paciente internado — a
// avaliação, os diagnósticos com as características e os fatores, o planejamento com o resultado esperado na escala de
// 1 a 5 e a meta, a implementação com os cuidados prescritos (frequência e horários pela grade da unidade) e checados
// no turno, e a evolução que reavalia a meta. O processo, o diagnóstico e a prescrição são do enfermeiro (a tela esconde
// as ações para o técnico e o servidor recusa); o técnico checa. Em `/enfermagem/sae`, sem paciente, a escolha da
// unidade e do paciente.
import type { DiagnosticoSaeLido, HorarioCuidado, SaeDoPaciente } from '@sgh/contratos';
import { proporHorariosCuidado } from '@sgh/dominio-enfermagem';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { pode as podeSessao } from '../../../casca/sessao/pode.js';
import {
  carregarTerminologia,
  checarCuidado,
  estornarCuidado,
  evoluirSae,
  lerPacientesSae,
  lerSae,
  lerTerminologia,
  lerUnidadesSae,
  prescreverCuidados,
  registrarSae,
  suspenderCuidado,
} from '../api-sae.js';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';
import TabelaCuidados from '../componentes/TabelaCuidados.vue';

const props = withDefaults(defineProps<{ reg?: string }>(), { reg: '' });
const { t } = useI18n();
const router = useRouter();
const atendimento = computed(() => Number(props.reg) || null);
// A vacina vale para o internado e para a sala de vacina da consulta: a tela abre daqui e da linha do tempo do turno.
const verVacinas = podeSessao('enfermagem.vacina.ler');
// O cuidado do cadastro de enfermagem vai ao prontuário pela prescrição do período (cenário cuidado-enfermeiro).
const verPrescricao = podeSessao('pep.prescricao.criar');

// ── Escolha do paciente ──
const unidade = ref('');
const escolhido = ref('');
const unidades = useQuery({
  queryKey: ['sae', 'unidades'],
  queryFn: () => lerUnidadesSae(),
  enabled: computed(() => !atendimento.value),
});
const pacientes = useQuery({
  queryKey: computed(() => ['sae', 'pacientes', unidade.value]),
  queryFn: () => lerPacientesSae(unidade.value),
  enabled: computed(() => !atendimento.value && !!unidade.value),
});
const opcoesUnidade = computed(() => [
  { valor: '', rotulo: '—' },
  ...(unidades.data.value ?? []).map((u) => ({ valor: u.unidade, rotulo: `${u.nome} (${u.internados})` })),
]);
const opcoesPaciente = computed(() => [
  { valor: '', rotulo: '—' },
  ...(pacientes.data.value ?? []).map((p) => ({
    valor: String(p.atendimento),
    rotulo: `${p.leito} · ${p.nome} · ${t('enfermagem.comum.atendimento', { numero: p.numero })}`,
  })),
]);
function abrir(): void {
  if (escolhido.value) void router.push({ name: 'enfermagem.sae', params: { reg: escolhido.value } });
}

// ── A terminologia em uso e a carga da escolhida pela DP-19 (perfil de administração do PEP) ──
const terminologia = useQuery({
  queryKey: ['sae', 'terminologia'],
  queryFn: () => lerTerminologia(),
  enabled: computed(() => !atendimento.value),
});
const carga = reactive({
  sistema: 'NNN' as 'NNN' | 'CIPE',
  versao: '',
  licenca: '',
  senha: '',
  termos: null as unknown[] | null,
});
const opcoesSistema = [
  { valor: 'NNN' as const, rotulo: 'NANDA-I/NIC/NOC' },
  { valor: 'CIPE' as const, rotulo: 'CIPE' },
];
const cargaMensagem = ref<string | null>(null);
const cargaErro = ref<unknown>(null);
const cargaInvalida = ref(false);
async function lerArquivo(ev: Event): Promise<void> {
  cargaInvalida.value = false;
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const x = JSON.parse(await f.text()) as unknown;
    carga.termos = Array.isArray(x) ? x : null;
  } catch {
    carga.termos = null;
  }
  cargaInvalida.value = carga.termos === null;
}
async function carregar(): Promise<void> {
  cargaErro.value = null;
  cargaMensagem.value = null;
  try {
    const r = await carregarTerminologia({
      sistema: carga.sistema,
      versao: carga.versao.trim(),
      licenca: carga.licenca.trim(),
      termos: carga.termos ?? [],
      senha: carga.senha,
    });
    cargaMensagem.value = r.mensagem;
    await terminologia.refetch();
  } catch (x) {
    cargaErro.value = x;
  } finally {
    carga.senha = '';
  }
}

// ── O processo ──
const sae = useQuery({
  queryKey: computed(() => ['sae', atendimento.value]),
  queryFn: () => lerSae(atendimento.value!),
  enabled: computed(() => !!atendimento.value),
});
const s = computed<SaeDoPaciente | undefined>(() => sae.data.value);
const pode = (op: string) => s.value?.gravacao.operacoes[op]?.pode === true;
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const hora = (x: string) => x.slice(0, 16).replace('T', ' ');
const rotuloEscala = (c: number | null) => s.value?.dominios.escala.find((p) => p.codigo === c)?.rotulo ?? '';
const rotuloMeta = (c: number | null) => s.value?.dominios.metas.find((p) => p.codigo === c)?.rotulo ?? '';
const frequencia = (n: number) =>
  n === 0
    ? t('enfermagem.sae.frequencias.0')
    : n === 1
      ? t('enfermagem.sae.frequencias.1')
      : t('enfermagem.sae.frequencias.n', { n });

async function executar(fn: () => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    mensagem.value = (await fn()).mensagem;
    await sae.refetch();
    return true;
  } catch (x) {
    erro.value = x;
    await sae.refetch();
    return false;
  } finally {
    ocupado.value = false;
  }
}

// ── Registrar ou revisar o processo ──
interface ResultadoForm {
  codigo: string;
  escalaAtual: string;
  meta: string;
  escalaMeta: string;
}
interface DiagnosticoForm {
  codigo: string;
  caracteristicas: string[];
  fatores: string[];
  resultados: ResultadoForm[];
  intervencoes: string[];
}
const form = reactive<{ avaliacao: string; diagnosticos: DiagnosticoForm[] }>({
  avaliacao: '',
  diagnosticos: [],
});
const novoDiagnostico = ref('');
const editando = ref(false);
const catalogo = computed(() => s.value?.catalogo);
const opcoesDiagnostico = computed(() => [
  { valor: '', rotulo: '—' },
  ...(catalogo.value?.diagnosticos ?? [])
    .filter((d) => !form.diagnosticos.some((x) => x.codigo === d.codigo))
    .map((d) => ({
      valor: d.codigo,
      rotulo: d.risco ? `${d.descricao} (${t('enfermagem.sae.form.risco')})` : d.descricao,
    })),
]);
const opcoesResultado = computed(() => [
  { valor: '', rotulo: '—' },
  ...(catalogo.value?.resultados ?? []).map((r) => ({ valor: r.codigo, rotulo: r.descricao })),
]);
const opcoesEscala = computed(() => [
  { valor: '', rotulo: '—' },
  ...(s.value?.dominios.escala ?? [])
    .filter((p) => p.valor !== null)
    .map((p) => ({ valor: String(p.codigo), rotulo: p.rotulo })),
]);
const opcoesMeta = computed(() => [
  { valor: '', rotulo: '—' },
  ...(s.value?.dominios.metas ?? []).map((m) => ({ valor: String(m.codigo), rotulo: m.rotulo })),
]);
const termoDiagnostico = (c: string) => catalogo.value?.diagnosticos.find((d) => d.codigo === c);
const resultadoVazio = (): ResultadoForm => ({ codigo: '', escalaAtual: '', meta: '', escalaMeta: '' });

function iniciarForm(): void {
  const a = s.value?.atual;
  form.avaliacao = a?.avaliacao ?? '';
  form.diagnosticos = (a?.diagnosticos ?? []).map((d: DiagnosticoSaeLido) => ({
    codigo: d.codigo,
    caracteristicas: d.caracteristicas.map((c) => c.codigo),
    fatores: d.fatores.map((c) => c.codigo),
    resultados: d.resultados.map((r) => ({
      codigo: r.codigo ?? '',
      escalaAtual: String(r.escalaAtual),
      meta: String(r.meta),
      escalaMeta: String(r.escalaMeta),
    })),
    intervencoes: d.intervencoes.map((i) => i.codigo ?? '').filter(Boolean),
  }));
  editando.value = true;
}
function adicionarDiagnostico(): void {
  if (!novoDiagnostico.value) return;
  form.diagnosticos.push({
    codigo: novoDiagnostico.value,
    caracteristicas: [],
    fatores: [],
    resultados: [resultadoVazio()],
    intervencoes: [],
  });
  novoDiagnostico.value = '';
}
function alternar(lista: string[], codigo: string): void {
  const i = lista.indexOf(codigo);
  if (i >= 0) lista.splice(i, 1);
  else lista.push(codigo);
}
const prontoParaRegistrar = computed(
  () =>
    form.avaliacao.trim().length >= 20 &&
    form.diagnosticos.length > 0 &&
    form.diagnosticos.every(
      (d) =>
        d.intervencoes.length > 0 &&
        d.resultados.length > 0 &&
        d.resultados.every((r) => r.codigo && r.escalaAtual && r.meta && r.escalaMeta),
    ),
);
async function registrar(): Promise<void> {
  if (!atendimento.value || !s.value) return;
  const ok = await executar(() =>
    registrarSae(atendimento.value!, {
      avaliacao: form.avaliacao,
      versaoVista: s.value?.atual?.versao ?? 0,
      diagnosticos: form.diagnosticos.map((d) => ({
        codigo: d.codigo,
        caracteristicas: d.caracteristicas,
        fatores: d.fatores,
        resultados: d.resultados.map((r) => ({
          codigo: r.codigo,
          escalaAtual: Number(r.escalaAtual),
          meta: Number(r.meta),
          escalaMeta: Number(r.escalaMeta),
        })),
        intervencoes: d.intervencoes.map((codigo) => ({ codigo })),
      })),
    }),
  );
  if (ok) editando.value = false;
}

// ── Prescrever os cuidados ──
interface AtividadeForm {
  intervencao: string;
  codigo: string;
  descricao: string;
  frequencia: string;
  horarios: string;
}
const atividades = ref<AtividadeForm[]>([]);
const intervencoesVigentes = computed(() =>
  (s.value?.atual?.diagnosticos ?? []).flatMap((d) =>
    d.intervencoes.map((i) => ({ ...i, diagnostico: d.descricao })),
  ),
);
const opcoesIntervencao = computed(() => [
  { valor: '', rotulo: '—' },
  ...intervencoesVigentes.value.map((i) => ({
    valor: String(i.id),
    rotulo: `${i.descricao} · ${i.diagnostico}`,
  })),
]);
const opcoesFrequencia = [0, 1, 2, 3, 4, 6, 8, 12, 24].map((n) => ({
  valor: String(n),
  rotulo: frequencia(n),
}));
function opcoesAtividade(intervencao: string) {
  const iv = intervencoesVigentes.value.find((i) => String(i.id) === intervencao);
  const t0 = catalogo.value?.intervencoes.find((x) => x.codigo === iv?.codigo);
  return [
    { valor: '', rotulo: t('enfermagem.sae.cuidados.outra') },
    ...(t0?.atividades ?? []).map((a) => ({ valor: a.codigo, rotulo: a.descricao })),
  ];
}
function novaAtividade(): void {
  atividades.value.push({ intervencao: '', codigo: '', descricao: '', frequencia: '4', horarios: '' });
  proporHorarios(atividades.value.length - 1);
}
function proporHorarios(i: number): void {
  const a = atividades.value[i];
  if (!a) return;
  a.horarios = proporHorariosCuidado(Number(a.frequencia), s.value?.grade ?? {}).join(', ');
}
function escolherAtividade(i: number): void {
  const a = atividades.value[i];
  if (!a || !a.codigo) return;
  a.descricao = opcoesAtividade(a.intervencao).find((o) => o.valor === a.codigo)?.rotulo ?? a.descricao;
}
const horariosDe = (x: string) =>
  x
    .split(/[,;\s]+/)
    .map((h) => h.trim())
    .filter(Boolean);
const prontoParaPrescrever = computed(
  () =>
    atividades.value.length > 0 &&
    atividades.value.every(
      (a) =>
        a.intervencao &&
        a.descricao.trim().length >= 3 &&
        horariosDe(a.horarios).length === Number(a.frequencia),
    ),
);
async function prescrever(): Promise<void> {
  if (!atendimento.value || !s.value?.atual) return;
  const ok = await executar(() =>
    prescreverCuidados(atendimento.value!, {
      versaoVista: s.value!.atual!.versao,
      atividades: atividades.value.map((a) => ({
        intervencao: Number(a.intervencao),
        codigo: a.codigo || null,
        descricao: a.descricao,
        frequenciaDia: Number(a.frequencia),
        horarios: horariosDe(a.horarios),
      })),
    }),
  );
  if (ok) atividades.value = [];
}

// ── Suspender ──
const suspendendo = ref<{ id: number; descricao: string } | null>(null);
const motivoSuspensao = ref('');
const dialogoSuspensao = ref(false);
function abrirSuspensao(id: number, descricao: string): void {
  suspendendo.value = { id, descricao };
  motivoSuspensao.value = '';
  erro.value = null;
  dialogoSuspensao.value = true;
}
async function suspender(): Promise<void> {
  if (!atendimento.value || !suspendendo.value) return;
  const ok = await executar(() =>
    suspenderCuidado(atendimento.value!, suspendendo.value!.id, motivoSuspensao.value.trim()),
  );
  if (ok) dialogoSuspensao.value = false;
}

// ── Evolução ──
const evolucao = reactive<{ nota: string; escalas: Record<string, string> }>({ nota: '', escalas: {} });
const resultadosVigentes = computed(() =>
  (s.value?.atual?.diagnosticos ?? []).flatMap((d) =>
    d.resultados.map((r) => ({ ...r, diagnostico: d.descricao })),
  ),
);
const prontoParaEvoluir = computed(
  () =>
    evolucao.nota.trim().length >= 10 && resultadosVigentes.value.some((r) => evolucao.escalas[String(r.id)]),
);
async function evoluir(): Promise<void> {
  if (!atendimento.value || !s.value?.atual) return;
  const ok = await executar(() =>
    evoluirSae(atendimento.value!, {
      versaoVista: s.value!.atual!.versao,
      nota: evolucao.nota,
      resultados: resultadosVigentes.value
        .filter((r) => evolucao.escalas[String(r.id)])
        .map((r) => ({ resultado: r.id, escala: Number(evolucao.escalas[String(r.id)]) })),
    }),
  );
  if (ok) {
    evolucao.nota = '';
    evolucao.escalas = {};
  }
}

// ── Checagem do turno (componente) ──
async function checar(h: HorarioCuidado, feita: boolean, motivo: string | null): Promise<void> {
  if (!atendimento.value) return;
  await executar(() =>
    checarCuidado(atendimento.value!, h.atividade, { previsto: h.previsto, feita, motivo }),
  );
}
async function estornar(checagem: number, motivo: string): Promise<void> {
  if (!atendimento.value) return;
  await executar(() => estornarCuidado(atendimento.value!, checagem, motivo));
}
</script>

<template>
  <section class="tela-enf" aria-labelledby="sae-titulo" data-testid="tela-sae">
    <h1 id="sae-titulo">{{ t('enfermagem.sae.titulo') }}</h1>
    <p>{{ t('enfermagem.sae.texto') }}</p>

    <template v-if="!atendimento">
      <p>{{ t('enfermagem.sae.escolha') }}</p>
      <div class="barra">
        <SanteSelecao
          v-model="unidade"
          :rotulo="t('enfermagem.comum.unidade')"
          :opcoes="opcoesUnidade"
          data-testid="sae-unidade"
        />
        <SanteSelecao
          v-model="escolhido"
          :rotulo="t('enfermagem.sae.paciente')"
          :opcoes="opcoesPaciente"
          data-testid="sae-paciente"
        />
        <SanteBotao
          :rotulo="t('enfermagem.sae.abrir')"
          :desabilitado="!escolhido"
          data-testid="sae-abrir"
          @acionar="abrir"
        />
      </div>
      <ErroEnfermagem v-if="unidades.isError.value" :erro="unidades.error.value" />
      <p v-if="verVacinas">
        <RouterLink to="/enfermagem/vacinas" data-testid="sae-vacinas-escolha">{{
          t('enfermagem.sae.vacinasTodas')
        }}</RouterLink>
      </p>
      <section
        v-if="terminologia.data.value"
        class="cartao"
        aria-labelledby="sae-termo-titulo"
        data-testid="sae-terminologia"
      >
        <h2 id="sae-termo-titulo">
          {{
            t('enfermagem.sae.terminologia', {
              sistema: terminologia.data.value.sistema,
              versao: terminologia.data.value.versao,
            })
          }}
        </h2>
        <p class="secundario">{{ terminologia.data.value.licenca }}</p>
        <form v-if="terminologia.data.value.carregar" data-testid="sae-carga" @submit.prevent="carregar">
          <h3>{{ t('enfermagem.sae.terminologiaCarga.titulo') }}</h3>
          <p>{{ t('enfermagem.sae.terminologiaCarga.texto') }}</p>
          <div class="barra">
            <SanteSelecao
              v-model="carga.sistema"
              :rotulo="t('enfermagem.sae.terminologiaCarga.sistema')"
              :opcoes="opcoesSistema"
            />
            <SanteCampoTexto
              id="sae-carga-versao"
              v-model="carga.versao"
              :rotulo="t('enfermagem.sae.terminologiaCarga.versao')"
              :max-bytes="20"
            />
            <SanteCampoTexto
              id="sae-carga-licenca"
              v-model="carga.licenca"
              :rotulo="t('enfermagem.sae.terminologiaCarga.licenca')"
              :max-bytes="200"
            />
          </div>
          <span class="campo">
            <label for="sae-carga-arquivo">{{ t('enfermagem.sae.terminologiaCarga.arquivo') }}</label>
            <input id="sae-carga-arquivo" type="file" accept="application/json" @change="lerArquivo" />
          </span>
          <SanteAlerta
            v-if="cargaInvalida"
            variante="aviso"
            :texto="t('enfermagem.sae.terminologiaCarga.invalido')"
          />
          <span class="campo">
            <label for="sae-carga-senha">{{ t('enfermagem.sae.terminologiaCarga.senha') }}</label>
            <input
              id="sae-carga-senha"
              v-model="carga.senha"
              type="password"
              autocomplete="current-password"
            />
          </span>
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.sae.terminologiaCarga.carregar')"
            :desabilitado="
              !carga.termos || !carga.versao.trim() || carga.licenca.trim().length < 10 || !carga.senha
            "
          />
          <p v-if="cargaMensagem" role="status">{{ cargaMensagem }}</p>
          <ErroEnfermagem v-if="cargaErro" :erro="cargaErro" />
        </form>
      </section>
    </template>

    <template v-else>
      <ErroEnfermagem v-if="sae.isError.value" :erro="sae.error.value" />
      <p v-else-if="!s" role="status">{{ t('enfermagem.comum.carregando') }}</p>
      <template v-else>
        <p class="cabecalho" data-testid="sae-cabecalho">
          <strong>{{ s.nome }}</strong>
          · {{ s.leito || t('enfermagem.comum.semLeito') }} ·
          {{ t('enfermagem.comum.atendimento', { numero: s.numero }) }} ·
          <span class="secundario">{{
            t('enfermagem.sae.terminologia', {
              sistema: s.terminologia.sistema,
              versao: s.terminologia.versao,
            })
          }}</span>
        </p>
        <div class="barra">
          <RouterLink :to="`/enfermagem/vacinas/${s.atendimento}`" data-testid="sae-vacinas">{{
            t('enfermagem.sae.vacinas')
          }}</RouterLink>
          <RouterLink to="/enfermagem/turno">{{ t('enfermagem.sae.turno') }}</RouterLink>
        </div>
        <SanteAlerta
          v-if="s.terminologia.sintetica"
          variante="aviso"
          :texto="t('enfermagem.sae.sintetica', { versao: s.terminologia.versao })"
          data-testid="sae-sintetica"
        />
        <SanteAlerta
          v-if="!s.gravacao.ligada"
          variante="aviso"
          :texto="t('enfermagem.sae.desligado', { motivo: s.gravacao.motivo ?? '' })"
        />
        <SanteAlerta
          v-else-if="!s.gravacao.enfermeiro"
          variante="info"
          :texto="t('enfermagem.sae.soEnfermeiro')"
          data-testid="sae-so-enfermeiro"
        />
        <p v-if="mensagem" role="status" data-testid="sae-mensagem">{{ mensagem }}</p>
        <ErroEnfermagem v-if="erro && !dialogoSuspensao" :erro="erro" />

        <section aria-labelledby="sae-etapas" class="cartao">
          <h2 id="sae-etapas">{{ t('enfermagem.sae.etapas.titulo') }}</h2>
          <ol class="etapas" data-testid="sae-etapas">
            <li v-for="e in s.etapas" :key="e.etapa" :data-etapa="e.etapa" :data-feita="e.feita">
              {{ t(`enfermagem.sae.etapas.${e.etapa}`) }}:
              <strong>{{
                e.feita ? t('enfermagem.sae.etapas.feita') : t('enfermagem.sae.etapas.pendente')
              }}</strong>
            </li>
          </ol>
        </section>

        <section aria-labelledby="sae-atual">
          <h2 id="sae-atual">
            {{
              s.atual
                ? t('enfermagem.sae.atual.titulo', { versao: s.atual.versao })
                : t('enfermagem.sae.form.titulo')
            }}
          </h2>
          <p v-if="!s.atual">{{ t('enfermagem.sae.atual.vazio') }}</p>
          <template v-else>
            <p class="secundario">
              {{
                t('enfermagem.sae.atual.registradoPor', { usuario: s.atual.usuario, em: hora(s.atual.em) })
              }}
              · {{ t('enfermagem.sae.atual.versoes', { n: s.versoes.length }) }}
            </p>
            <h3>{{ t('enfermagem.sae.atual.avaliacao') }}</h3>
            <p data-testid="sae-avaliacao">{{ s.atual.avaliacao }}</p>
            <article
              v-for="d in s.atual.diagnosticos"
              :key="d.id"
              class="cartao"
              :data-testid="`sae-diagnostico-${d.codigo}`"
            >
              <h3>{{ d.descricao }}</h3>
              <p v-if="d.caracteristicas.length">
                {{ t('enfermagem.sae.atual.caracteristicas') }}:
                {{ d.caracteristicas.map((c) => c.descricao).join('; ') }}
              </p>
              <p v-if="d.fatores.length">
                {{ t('enfermagem.sae.atual.fatores') }}: {{ d.fatores.map((c) => c.descricao).join('; ') }}
              </p>
              <ul>
                <li v-for="r in d.resultados" :key="r.id" :data-testid="`sae-resultado-${r.id}`">
                  {{ t('enfermagem.sae.atual.resultado') }}: {{ r.descricao }} ·
                  {{
                    t('enfermagem.sae.atual.escalaDe', {
                      atual: rotuloEscala(r.escalaAtual),
                      meta: rotuloMeta(r.meta),
                      alvo: rotuloEscala(r.escalaMeta),
                    })
                  }}
                  <span v-if="r.evolucoes.length" class="secundario">
                    ·
                    {{
                      t('enfermagem.sae.atual.ultimaEvolucao', {
                        escala: rotuloEscala(r.evolucoes.at(-1)!.escala),
                        situacao: t(`enfermagem.sae.situacoes.${r.evolucoes.at(-1)!.situacao}`),
                      })
                    }}
                  </span>
                </li>
              </ul>
              <ul>
                <li v-for="i in d.intervencoes" :key="i.id">
                  {{ t('enfermagem.sae.atual.intervencao') }}: {{ i.descricao }}
                  <ul>
                    <li v-for="a in i.atividades" :key="a.id" :data-testid="`sae-atividade-${a.id}`">
                      <span :class="{ riscado: !!a.suspensa }">
                        {{
                          t('enfermagem.sae.atual.atividade', {
                            descricao: a.descricao,
                            frequencia: frequencia(a.frequenciaDia),
                          })
                        }}
                        <span v-if="a.horarios.length"> · {{ a.horarios.join(', ') }}</span>
                      </span>
                      <span v-if="a.suspensa" class="secundario">
                        · {{ t('enfermagem.sae.atual.suspensa', { motivo: a.suspensa.motivo }) }}</span
                      >
                      <SanteBotao
                        v-else-if="pode('prescrever')"
                        variante="texto"
                        :rotulo="t('enfermagem.sae.atual.suspender')"
                        :data-testid="`sae-suspender-${a.id}`"
                        @acionar="abrirSuspensao(a.id, a.descricao)"
                      />
                    </li>
                  </ul>
                </li>
              </ul>
            </article>
            <template v-if="s.atual.evolucoes.length">
              <h3>{{ t('enfermagem.sae.evolucao.historico') }}</h3>
              <ul data-testid="sae-evolucoes">
                <li v-for="e in s.atual.evolucoes" :key="e.id">
                  {{ hora(e.em) }} · {{ e.usuario }} · {{ e.nota }}
                </li>
              </ul>
            </template>
          </template>
          <SanteBotao
            v-if="pode('registrar') && !editando"
            variante="secundario"
            :rotulo="s.atual ? t('enfermagem.sae.form.revisar') : t('enfermagem.sae.form.titulo')"
            data-testid="sae-editar"
            @acionar="iniciarForm"
          />
        </section>

        <form
          v-if="editando && pode('registrar')"
          class="cartao"
          aria-labelledby="sae-form-titulo"
          data-testid="sae-form"
          @submit.prevent="registrar"
        >
          <h2 id="sae-form-titulo">
            {{ s.atual ? t('enfermagem.sae.form.revisar') : t('enfermagem.sae.form.titulo') }}
          </h2>
          <SanteCampoTexto
            id="sae-avaliacao-campo"
            v-model="form.avaliacao"
            :rotulo="t('enfermagem.sae.form.avaliacao')"
            :max-bytes="4000"
            multilinha
            obrigatorio
            data-testid="sae-campo-avaliacao"
          />
          <div class="barra">
            <SanteSelecao
              v-model="novoDiagnostico"
              :rotulo="t('enfermagem.sae.form.diagnostico')"
              :opcoes="opcoesDiagnostico"
              data-testid="sae-novo-diagnostico"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('enfermagem.sae.form.adicionarDiagnostico')"
              :desabilitado="!novoDiagnostico"
              data-testid="sae-adicionar-diagnostico"
              @acionar="adicionarDiagnostico"
            />
          </div>
          <p v-if="form.diagnosticos.length === 0">{{ t('enfermagem.sae.form.vazio') }}</p>
          <fieldset
            v-for="(d, k) in form.diagnosticos"
            :key="d.codigo"
            class="cartao"
            :data-testid="`sae-form-diagnostico-${d.codigo}`"
          >
            <legend>{{ termoDiagnostico(d.codigo)?.descricao ?? d.codigo }}</legend>
            <template v-if="termoDiagnostico(d.codigo)?.caracteristicas.length">
              <p>{{ t('enfermagem.sae.form.caracteristicas') }}</p>
              <label v-for="c in termoDiagnostico(d.codigo)!.caracteristicas" :key="c.codigo" class="linha">
                <input
                  type="checkbox"
                  :checked="d.caracteristicas.includes(c.codigo)"
                  :data-testid="`sae-caract-${c.codigo}`"
                  @change="alternar(d.caracteristicas, c.codigo)"
                />
                {{ c.descricao }}
              </label>
            </template>
            <p>{{ t('enfermagem.sae.form.fatores') }}</p>
            <label v-for="c in termoDiagnostico(d.codigo)?.fatores ?? []" :key="c.codigo" class="linha">
              <input
                type="checkbox"
                :checked="d.fatores.includes(c.codigo)"
                :data-testid="`sae-fator-${c.codigo}`"
                @change="alternar(d.fatores, c.codigo)"
              />
              {{ c.descricao }}
            </label>
            <div v-for="(r, j) in d.resultados" :key="j" class="barra">
              <SanteSelecao
                v-model="r.codigo"
                :rotulo="t('enfermagem.sae.form.resultado')"
                :opcoes="opcoesResultado"
                :data-testid="`sae-resultado-${k}-${j}`"
              />
              <SanteSelecao
                v-model="r.escalaAtual"
                :rotulo="t('enfermagem.sae.form.escalaAtual')"
                :opcoes="opcoesEscala"
                :data-testid="`sae-escala-atual-${k}-${j}`"
              />
              <SanteSelecao
                v-model="r.meta"
                :rotulo="t('enfermagem.sae.form.meta')"
                :opcoes="opcoesMeta"
                :data-testid="`sae-meta-${k}-${j}`"
              />
              <SanteSelecao
                v-model="r.escalaMeta"
                :rotulo="t('enfermagem.sae.form.escalaMeta')"
                :opcoes="opcoesEscala"
                :data-testid="`sae-escala-meta-${k}-${j}`"
              />
            </div>
            <p>{{ t('enfermagem.sae.form.intervencoes') }}</p>
            <label v-for="i in catalogo?.intervencoes ?? []" :key="i.codigo" class="linha">
              <input
                type="checkbox"
                :checked="d.intervencoes.includes(i.codigo)"
                :data-testid="`sae-intervencao-${k}-${i.codigo}`"
                @change="alternar(d.intervencoes, i.codigo)"
              />
              {{ i.descricao }}
            </label>
            <SanteBotao
              variante="texto"
              :rotulo="t('enfermagem.sae.form.remover')"
              @acionar="form.diagnosticos.splice(k, 1)"
            />
          </fieldset>
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.sae.form.registrar')"
            :desabilitado="!prontoParaRegistrar || ocupado"
            data-testid="sae-registrar"
          />
        </form>

        <section v-if="s.atual && pode('prescrever')" class="cartao" aria-labelledby="sae-cuidados-titulo">
          <h2 id="sae-cuidados-titulo">{{ t('enfermagem.sae.cuidados.titulo') }}</h2>
          <p>{{ t('enfermagem.sae.cuidados.texto') }}</p>
          <SanteAlerta
            variante="aviso"
            :texto="t('enfermagem.sae.cuidados.prontuario')"
            data-testid="sae-cuidados-prontuario"
          />
          <p v-if="verPrescricao">
            <RouterLink to="/pep/prescricao" data-testid="sae-cuidados-prescricao">{{
              t('enfermagem.sae.cuidados.prescricaoPeriodo')
            }}</RouterLink>
          </p>
          <div v-for="(a, i) in atividades" :key="i" class="barra" :data-testid="`sae-cuidado-${i}`">
            <SanteSelecao
              v-model="a.intervencao"
              :rotulo="t('enfermagem.sae.cuidados.intervencao')"
              :opcoes="opcoesIntervencao"
              :data-testid="`sae-cuidado-intervencao-${i}`"
            />
            <SanteSelecao
              v-model="a.codigo"
              :rotulo="t('enfermagem.sae.cuidados.atividade')"
              :opcoes="opcoesAtividade(a.intervencao)"
              :data-testid="`sae-cuidado-atividade-${i}`"
              @update:model-value="escolherAtividade(i)"
            />
            <SanteCampoTexto
              :id="`sae-cuidado-descricao-${i}`"
              v-model="a.descricao"
              :rotulo="t('enfermagem.sae.cuidados.descricao')"
              :max-bytes="300"
              :data-testid="`sae-cuidado-descricao-${i}`"
            />
            <SanteSelecao
              v-model="a.frequencia"
              :rotulo="t('enfermagem.sae.cuidados.frequencia')"
              :opcoes="opcoesFrequencia"
              :data-testid="`sae-cuidado-frequencia-${i}`"
              @update:model-value="proporHorarios(i)"
            />
            <span class="campo">
              <label :for="`sae-cuidado-horarios-${i}`">{{ t('enfermagem.sae.cuidados.horarios') }}</label>
              <input
                :id="`sae-cuidado-horarios-${i}`"
                v-model="a.horarios"
                :data-testid="`sae-cuidado-horarios-${i}`"
              />
            </span>
          </div>
          <p v-if="atividades.length === 0">{{ t('enfermagem.sae.cuidados.vazio') }}</p>
          <div class="barra">
            <SanteBotao
              variante="secundario"
              :rotulo="t('enfermagem.sae.cuidados.adicionar')"
              data-testid="sae-cuidado-adicionar"
              @acionar="novaAtividade"
            />
            <SanteBotao
              :rotulo="t('enfermagem.sae.cuidados.prescrever')"
              :desabilitado="!prontoParaPrescrever || ocupado"
              data-testid="sae-prescrever"
              @acionar="prescrever"
            />
          </div>
        </section>

        <section aria-labelledby="sae-horarios-titulo">
          <h2 id="sae-horarios-titulo">{{ t('enfermagem.sae.horarios.titulo') }}</h2>
          <p v-if="s.horarios.length === 0">{{ t('enfermagem.sae.horarios.vazio') }}</p>
          <TabelaCuidados
            v-else
            :horarios="s.horarios"
            :pode-checar="pode('checar')"
            :pode-estornar="pode('estornar')"
            :ocupado="ocupado"
            prefixo="sae"
            @checar="checar"
            @estornar="estornar"
          />
        </section>

        <section v-if="s.atual && pode('registrar')" class="cartao" aria-labelledby="sae-evolucao-titulo">
          <h2 id="sae-evolucao-titulo">{{ t('enfermagem.sae.evolucao.titulo') }}</h2>
          <p>{{ t('enfermagem.sae.evolucao.texto') }}</p>
          <div v-for="r in resultadosVigentes" :key="r.id" class="barra">
            <SanteSelecao
              :model-value="evolucao.escalas[String(r.id)] ?? ''"
              @update:model-value="(v: string) => (evolucao.escalas[String(r.id)] = v)"
              :rotulo="`${t('enfermagem.sae.evolucao.escala')}: ${r.descricao}`"
              :opcoes="opcoesEscala"
              :data-testid="`sae-evolucao-escala-${r.id}`"
            />
          </div>
          <SanteCampoTexto
            id="sae-evolucao-nota"
            v-model="evolucao.nota"
            :rotulo="t('enfermagem.sae.evolucao.nota')"
            :max-bytes="1000"
            multilinha
            data-testid="sae-evolucao-nota"
          />
          <SanteBotao
            :rotulo="t('enfermagem.sae.evolucao.registrar')"
            :desabilitado="!prontoParaEvoluir || ocupado"
            data-testid="sae-evoluir"
            @acionar="evoluir"
          />
        </section>
      </template>
    </template>

    <SanteDialogo v-model:visivel="dialogoSuspensao" :titulo="t('enfermagem.sae.suspensao.titulo')">
      <div class="campo">
        <p>{{ suspendendo?.descricao }}</p>
        <label for="sae-motivo-suspensao">{{ t('enfermagem.sae.suspensao.motivo') }}</label>
        <input
          id="sae-motivo-suspensao"
          v-model="motivoSuspensao"
          maxlength="300"
          data-testid="sae-motivo-suspensao"
        />
        <ErroEnfermagem v-if="erro" :erro="erro" />
      </div>
      <template #rodape>
        <SanteBotao
          :rotulo="t('enfermagem.sae.suspensao.confirmar')"
          :desabilitado="motivoSuspensao.trim().length < 10 || ocupado"
          data-testid="sae-suspender-confirmar"
          @acionar="suspender"
        />
      </template>
    </SanteDialogo>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.etapas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2) var(--sgh-espaco-4);
  padding-left: var(--sgh-espaco-4);
}
.riscado {
  text-decoration: line-through;
}
</style>
