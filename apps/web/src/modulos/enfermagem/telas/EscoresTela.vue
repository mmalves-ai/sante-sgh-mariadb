<script setup lang="ts">
// Escores de risco e reavaliações (ficha do M45, seção 7; regras 1 a 4): a unidade no turno com os últimos escores de
// cada paciente, as reavaliações vencidas e as condutas abertas; o paciente com a aferição do NEWS2 (os sete parâmetros
// e a conduta na hora), as escalas de risco com o total sempre calculado e os cuidados preventivos aceitos ou recusados
// com o motivo, as reavaliações (programar e dispensar), o histórico e as escalas do formulário do prontuário; as faixas
// vigentes e a publicação de uma nova versão (gerência de enfermagem, com a senha). O servidor confere tudo de novo; a
// prévia da tela usa o mesmo motor (@sgh/dominio-enfermagem). Para o tablet: botões grandes, sem tabela larga.
import {
  ESCALA_ACVPU,
  ESCALAS_DA_TELA,
  type EscalaEscore,
  type FaixaEscore,
  itensDaEscala,
  type ModoDor,
  ROTULOS_ESCALA,
  ROTULOS_GATILHO,
  ROTULOS_MOTIVO_REAVALIACAO,
  type ResultadoEscore,
  type RegraEscore,
  type PendenciaProfilaxia,
  type PerfilTev,
  PERFIS_TEV,
} from '@sgh/contratos';
import { calcularEscala, calcularNews2, cuidadosSugeridos, type EscalaDaTela } from '@sgh/dominio-enfermagem';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import {
  decidirProfilaxia,
  retificarProfilaxia,
  dispensarReavaliacao,
  estornarEscore,
  exportarEscores,
  lerEscoresDaUnidade,
  lerEscoresDoPaciente,
  lerRegrasEscore,
  programarReavaliacao,
  publicarRegraEscore,
  registrarAfericao,
  registrarEscore,
} from '../api-escores.js';
import DialogoCorrecao, { type DadosCorrecao } from '../componentes/DialogoCorrecao.vue';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';
import SeletorUnidade from '../componentes/SeletorUnidade.vue';
import { usarEnfermagem } from '../usar-enfermagem.js';
import { usarSessao } from '../../../casca/sessao/sessao.js';

const { t } = useI18n();
const rota = useRoute();
const router = useRouter();
const { unidade, escolherUnidade, opcoesUnidade, login } = usarEnfermagem();
/** O registro é do usuário da sessão (só o autor corrige ou inativa; o servidor confere de novo). */
const ehMeu = (u: string | null | undefined) =>
  !!login.value && (u ?? '').toUpperCase() === login.value.toUpperCase();

const atendimento = computed(() => Number(rota.query['atendimento'] ?? 0) || null);
const daUnidade = useQuery({
  queryKey: computed(() => ['escores', 'unidade', unidade.value]),
  queryFn: () => lerEscoresDaUnidade(unidade.value),
  enabled: computed(() => !!unidade.value),
});
const doPaciente = useQuery({
  queryKey: computed(() => ['escores', 'paciente', atendimento.value]),
  queryFn: () => lerEscoresDoPaciente(atendimento.value!),
  enabled: computed(() => !!atendimento.value),
});
const regras = useQuery({ queryKey: ['escores', 'regras'], queryFn: () => lerRegrasEscore() });
const gravacao = computed(() => doPaciente.data.value?.gravacao ?? daUnidade.data.value?.gravacao ?? null);
const podeRegistrar = computed(() => gravacao.value?.registrar === true);
/** Aceitar ou recusar os cuidados preventivos é do enfermeiro (D-CUIDADO-45): os outros registram só o escore. */
const decideCuidados = computed(() => gravacao.value?.decidirCuidados === true);
const pacienteAtual = computed(() => doPaciente.data.value ?? null);
const internado = computed(() =>
  daUnidade.data.value?.pacientes.find((p) => p.atendimento === atendimento.value),
);

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const resultado = ref<ResultadoEscore | null>(null);
const ocupado = ref(false);
const hora = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');

function abrir(at: number): void {
  resultado.value = null;
  mensagem.value = null;
  erro.value = null;
  void router.replace({ query: { ...rota.query, atendimento: String(at) } });
}
function voltar(): void {
  void router.replace({ query: {} });
}
async function recarregar(): Promise<void> {
  await Promise.all([daUnidade.refetch(), atendimento.value ? doPaciente.refetch() : Promise.resolve()]);
}
async function gravar<T>(fn: () => Promise<T>, depois?: (r: T) => void): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await fn();
    depois?.(r);
    await recarregar();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const corpoPaciente = () => ({
  paciente: pacienteAtual.value!.paciente,
  atendimento: atendimento.value,
  reg: pacienteAtual.value!.reg,
  unidade: unidade.value || null,
});

// ── Aferição com NEWS2 ──────────────────────────────────────────────────────────────────────────
const PARAMETROS = ['fr', 'spo2', 'o2', 'pas', 'fc', 'temperatura'] as const;
const afericao = reactive<Record<string, string>>({
  fr: '',
  spo2: '',
  o2: '0',
  pas: '',
  fc: '',
  temperatura: '',
});
const acvpu = ref(0);
const escala2 = ref(false);
const infeccao = ref(false);
const confirmarFora = ref(false);
const opcoesAcvpu = ESCALA_ACVPU.map((r, i) => ({ valor: i, rotulo: r }));
const numero = (v: string) => Number(v.replace(',', '.'));
const sinaisDigitados = computed(() => {
  if (
    PARAMETROS.some((k) => (afericao[k] ?? '').trim() === '' || !Number.isFinite(numero(afericao[k] ?? '')))
  )
    return null;
  return {
    fr: numero(afericao['fr']!),
    spo2: numero(afericao['spo2']!),
    o2: numero(afericao['o2']!),
    pas: numero(afericao['pas']!),
    fc: numero(afericao['fc']!),
    acvpu: acvpu.value,
    temperatura: numero(afericao['temperatura']!),
  };
});
const previaNews2 = computed(() =>
  sinaisDigitados.value
    ? calcularNews2(sinaisDigitados.value, {
        escalaSpo2: escala2.value ? 2 : 1,
        suspeitaInfeccao: infeccao.value,
        ...(regraDe('news2') ? { regra: regraDe('news2')! } : {}),
      })
    : null,
);
function registrarNews2(): void {
  if (!sinaisDigitados.value || !pacienteAtual.value) return;
  void gravar(
    () =>
      registrarAfericao({
        ...corpoPaciente(),
        sinais: sinaisDigitados.value,
        escalaSpo2: escala2.value ? 2 : 1,
        suspeitaInfeccao: infeccao.value,
        confirmadoForaDaFaixa: confirmarFora.value,
      }),
    (r) => {
      resultado.value = r;
      mensagem.value = r.mensagem;
      for (const k of PARAMETROS) afericao[k] = k === 'o2' ? '0' : '';
      confirmarFora.value = false;
    },
  );
}

// ── Escalas da tela ─────────────────────────────────────────────────────────────────────────────
const escala = ref<EscalaDaTela>('braden');
const modoDor = ref<ModoDor>('numerica');
const respostas = reactive<Record<string, number | null>>({});
const opcoesEscala = ESCALAS_DA_TELA.map((e) => ({ valor: e as EscalaDaTela, rotulo: ROTULOS_ESCALA[e] }));
const opcoesModoDor = computed(() => [
  { valor: 'numerica' as ModoDor, rotulo: t('enfermagem.escores.escala.numerica') },
  { valor: 'comportamental' as ModoDor, rotulo: t('enfermagem.escores.escala.comportamental') },
]);
const itens = computed(() => itensDaEscala(escala.value, modoDor.value));
// W0-03, M1: a escala de TEV pede o perfil (o servidor confere com o parâmetro do estabelecimento).
const ehTev = computed(() => escala.value === 'caprini' || escala.value === 'padua');
const perfilTev = ref<PerfilTev>('clinico');
const opcoesPerfilTev = computed(() =>
  PERFIS_TEV.map((p) => ({ valor: p, rotulo: t(`enfermagem.mercado.tev.perfis.${p}`) })),
);
watch(escala, (e) => {
  if (e === 'caprini') perfilTev.value = 'cirurgico';
  if (e === 'padua') perfilTev.value = 'clinico';
});
watch([escala, modoDor], () => {
  for (const k of Object.keys(respostas)) delete respostas[k];
  for (const k of Object.keys(decisoes)) delete decisoes[k];
});
function regraDe(e: EscalaEscore): RegraEscore | undefined {
  return regras.data.value?.vigentes.find((r) => r.escala === e);
}
const respondidas = computed(() => {
  const r: Record<string, number> = {};
  for (const i of itens.value)
    if (respostas[i.codigo] !== undefined && respostas[i.codigo] !== null) r[i.codigo] = respostas[i.codigo]!;
  return r;
});
const rassAtual = computed(() => {
  const u = pacienteAtual.value?.ultimos.find((x) => x.escala === 'rass');
  return u ? u.total : null;
});
const previaEscala = computed(() => {
  if (Object.keys(respondidas.value).length < itens.value.length) return null;
  const regra = regraDe(escala.value);
  return calcularEscala(escala.value, respondidas.value, {
    ...(regra ? { regra } : {}),
    modoDor: modoDor.value,
    rassAtual: rassAtual.value,
  });
});
const sugeridos = computed(() =>
  previaEscala.value && previaEscala.value.ok
    ? cuidadosSugeridos(escala.value, previaEscala.value.faixa)
    : [],
);
const decisoes = reactive<Record<string, { decisao: 'aceito' | 'recusado'; motivo: string }>>({});
const cuidadosCompletos = computed(
  () =>
    !decideCuidados.value ||
    sugeridos.value.every(
      (c) =>
        decisoes[c.codigo] &&
        (decisoes[c.codigo]!.decisao === 'aceito' || decisoes[c.codigo]!.motivo.trim().length >= 5),
    ),
);
function decidir(codigo: string, decisao: 'aceito' | 'recusado'): void {
  decisoes[codigo] = { decisao, motivo: decisoes[codigo]?.motivo ?? '' };
}
function registrarEscala(): void {
  if (!pacienteAtual.value) return;
  void gravar(
    () =>
      registrarEscore({
        ...corpoPaciente(),
        escala: escala.value,
        ...(escala.value === 'dor' ? { modoDor: modoDor.value } : {}),
        ...(ehTev.value ? { perfilTev: perfilTev.value } : {}),
        itens: respondidas.value,
        cuidados: (decideCuidados.value ? sugeridos.value : []).map((c) => ({
          codigo: c.codigo,
          decisao: decisoes[c.codigo]?.decisao ?? 'aceito',
          ...(decisoes[c.codigo]?.decisao === 'recusado'
            ? { motivo: decisoes[c.codigo]!.motivo.trim() }
            : {}),
        })),
      }),
    (r) => {
      resultado.value = r;
      mensagem.value = r.mensagem;
      for (const k of Object.keys(respostas)) delete respostas[k];
      for (const k of Object.keys(decisoes)) delete decisoes[k];
    },
  );
}

// ── Reavaliações ────────────────────────────────────────────────────────────────────────────────
const reavEscala = ref<'braden' | 'morse'>('braden');
const reavMotivo = ref<'admissao' | 'mudanca-quadro'>('mudanca-quadro');
const opcoesReavEscala = [
  { valor: 'braden' as const, rotulo: ROTULOS_ESCALA.braden },
  { valor: 'morse' as const, rotulo: ROTULOS_ESCALA.morse },
];
const opcoesReavMotivo = computed(() => [
  { valor: 'mudanca-quadro' as const, rotulo: t('enfermagem.escores.reavaliacoes.quadro') },
  { valor: 'admissao' as const, rotulo: t('enfermagem.escores.reavaliacoes.admissao') },
]);
function programar(): void {
  if (!pacienteAtual.value) return;
  void gravar(
    () => programarReavaliacao({ ...corpoPaciente(), escala: reavEscala.value, motivo: reavMotivo.value }),
    (r) => (mensagem.value = r.mensagem),
  );
}
const dispensando = ref<number | null>(null);
const motivoDispensa = ref('');
const abertoDispensa = ref(false);
function abrirDispensa(id: number): void {
  dispensando.value = id;
  motivoDispensa.value = '';
  abertoDispensa.value = true;
}
function confirmarDispensa(): void {
  const id = dispensando.value;
  if (!id) return;
  void gravar(
    () => dispensarReavaliacao(id, motivoDispensa.value.trim()),
    (r) => {
      mensagem.value = r.mensagem;
      abertoDispensa.value = false;
    },
  );
}

// ── Faixas versionadas ──────────────────────────────────────────────────────────────────────────
const abertoRegra = ref(false);
const regraEscala = ref<EscalaEscore>('morse');
const faixasEdicao = ref<FaixaEscore[]>([]);
const notas = ref('');
const senhaRegra = ref('');
const opcoesTodasEscalas = (['news2', ...ESCALAS_DA_TELA] as EscalaEscore[]).map((e) => ({
  valor: e,
  rotulo: ROTULOS_ESCALA[e],
}));
function abrirRegra(): void {
  faixasEdicao.value = (regraDe(regraEscala.value)?.faixas ?? []).map((f) => ({ ...f }));
  notas.value = '';
  senhaRegra.value = '';
  abertoRegra.value = true;
}
watch(regraEscala, () => {
  faixasEdicao.value = (regraDe(regraEscala.value)?.faixas ?? []).map((f) => ({ ...f }));
});
function publicarRegra(): void {
  void gravar(
    () =>
      publicarRegraEscore({
        escala: regraEscala.value,
        faixas: faixasEdicao.value.map((f) => ({ ...f, minimo: Number(f.minimo), maximo: Number(f.maximo) })),
        notas: notas.value.trim(),
        senha: senhaRegra.value,
      }),
    async (r) => {
      mensagem.value = r.mensagem;
      abertoRegra.value = false;
      await regras.refetch();
    },
  );
}

// W0-03: estornar ou invalidar o escore (inativo, tachado e visível; o alerta NEWS2 é reavaliado) e exportar o
// histórico com os inativos.
const estornando = ref<number | null>(null);
const dialogoEstorno = ref(false);
function abrirEstorno(id: number): void {
  estornando.value = id;
  dialogoEstorno.value = true;
}
async function estornar(d: DadosCorrecao): Promise<void> {
  const id = estornando.value;
  if (id === null) return;
  const r = await estornarEscore(id, { tipo: d.tipo, motivo: d.motivo });
  mensagem.value = r.mensagem;
  await Promise.all([doPaciente.refetch(), daUnidade.refetch()]);
}
async function exportar(): Promise<void> {
  if (!atendimento.value) return;
  erro.value = null;
  try {
    const x = await exportarEscores(atendimento.value);
    const url = URL.createObjectURL(new Blob([`\uFEFF${x.csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = x.arquivo;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    erro.value = e;
  }
}

// W0-03, M1: a profilaxia de TEV sugerida, pendente ao prescritor (decidida uma vez: prescrita ou não, com o motivo).
const podeDecidirProfilaxia = computed(() => gravacao.value?.decidirProfilaxia === true);
// Revisão W0-03: os atalhos só aparecem para quem abre a tela de destino (as permissões das rotas). A contenção abre
// com a linha do turno ou com a de prescrever; os protocolos do internado, com a linha do turno.
const { permissoes } = usarSessao();
const abreContencao = computed(
  () => permissoes.value.has('enfermagem.horario.ler') || permissoes.value.has('pep.prescricao.criar'),
);
const abreProtocolos = computed(() => permissoes.value.has('enfermagem.horario.ler'));
const pendentesTev = computed(() => daUnidade.data.value?.profilaxiasPendentes ?? []);
const profilaxiaDoPaciente = computed(() => pacienteAtual.value?.profilaxia ?? null);
const decidindoTev = ref<PendenciaProfilaxia | null>(null);
const dialogoTev = ref(false);
const decisaoTev = ref<'prescrita' | 'nao-prescrita'>('prescrita');
const motivoTev = ref('');
const opcoesDecisaoTev = computed(() =>
  (['prescrita', 'nao-prescrita'] as const).map((d) => ({
    valor: d,
    rotulo: t(`enfermagem.mercado.tev.decisoes.${d}`),
  })),
);
const nomeEscalaTev = (e: string) => ROTULOS_ESCALA[e as EscalaEscore].split(' (')[0];
function abrirTev(p: PendenciaProfilaxia): void {
  decidindoTev.value = p;
  decisaoTev.value = 'prescrita';
  motivoTev.value = '';
  erro.value = null;
  dialogoTev.value = true;
}
function confirmarTev(): void {
  const p = decidindoTev.value;
  if (!p) return;
  void gravar(
    () =>
      decidirProfilaxia(p.escore, {
        decisao: decisaoTev.value,
        ...(decisaoTev.value === 'nao-prescrita' ? { motivo: motivoTev.value.trim() } : {}),
      }),
    (r) => {
      mensagem.value = r.mensagem;
      dialogoTev.value = false;
    },
  );
}

// Revisão W0-03: a correção da decisão pelo próprio autor (fato novo com a justificativa; a anulação reabre a pendência).
const dialogoCorrigirTev = ref(false);
const decisaoCorrecaoTev = ref<'prescrita' | 'nao-prescrita' | 'anulada'>('anulada');
const justificativaTev = ref('');
const opcoesCorrecaoTev = computed(() =>
  (['prescrita', 'nao-prescrita', 'anulada'] as const).map((d) => ({
    valor: d,
    rotulo: t(`enfermagem.mercado.tev.decisoesCorrecao.${d}`),
  })),
);
function abrirCorrigirTev(p: PendenciaProfilaxia): void {
  decidindoTev.value = p;
  decisaoCorrecaoTev.value = 'anulada';
  motivoTev.value = '';
  justificativaTev.value = '';
  erro.value = null;
  dialogoCorrigirTev.value = true;
}
function confirmarCorrecaoTev(): void {
  const p = decidindoTev.value;
  if (!p) return;
  void gravar(
    () =>
      retificarProfilaxia(p.escore, {
        decisao: decisaoCorrecaoTev.value,
        ...(decisaoCorrecaoTev.value === 'nao-prescrita' ? { motivo: motivoTev.value.trim() } : {}),
        justificativa: justificativaTev.value.trim(),
      }),
    (r) => {
      mensagem.value = r.mensagem;
      dialogoCorrigirTev.value = false;
    },
  );
}
const rotuloHistoricoTev = (d: string) =>
  d === 'anulada' ? t('enfermagem.mercado.tev.anulada') : t(`enfermagem.mercado.tev.decisoes.${d}`);

const ultimoDe = (
  p: { ultimos: Partial<Record<EscalaEscore, { total: number; rotuloFaixa: string; risco: boolean }>> },
  e: EscalaEscore,
) => p.ultimos[e];
</script>

<template>
  <section class="tela-enf" aria-labelledby="es-titulo" data-testid="tela-escores">
    <h1 id="es-titulo">{{ t('enfermagem.escores.titulo') }}</h1>
    <p>{{ t('enfermagem.escores.texto') }}</p>
    <div class="barra">
      <SeletorUnidade :model-value="unidade" :opcoes="opcoesUnidade" @update:model-value="escolherUnidade" />
      <SanteBotao variante="secundario" :rotulo="t('enfermagem.comum.atualizar')" @acionar="recarregar" />
      <!-- Revisão W0-03: os atalhos às telas do Time de Resposta Rápida e da contenção (a entrada de menu é do W4-01). -->
      <RouterLink :to="{ path: '/enfermagem/trr' }" class="atalho" data-testid="es-atalho-trr">{{
        t('enfermagem.mercado.atalhos.trr')
      }}</RouterLink>
      <RouterLink
        :to="{
          path: '/enfermagem/contencao',
          query: atendimento ? { atendimento: String(atendimento) } : {},
        }"
        v-if="abreContencao"
        class="atalho"
        data-testid="es-atalho-contencao"
        >{{ t('enfermagem.mercado.atalhos.contencao') }}</RouterLink
      >
      <!-- W0-03, M3: o relógio dos protocolos gerenciados no internado (sepse pelo alerta do NEWS2, AVC, TEV). -->
      <RouterLink
        v-if="abreProtocolos"
        :to="{ path: '/enfermagem/protocolos' }"
        class="atalho"
        data-testid="es-atalho-protocolos"
        >{{ t('enfermagem.mercado.atalhos.protocolos') }}</RouterLink
      >
      <!-- W0-03, M4: feridas e lesão por pressão (ficha, curativo, foto e a incidência de LPP). -->
      <RouterLink :to="{ path: '/enfermagem/feridas' }" class="atalho" data-testid="es-atalho-feridas">{{
        t('enfermagem.mercado.atalhos.feridas')
      }}</RouterLink>
      <!-- Revisão W0-03: a lista das profilaxias de TEV pendentes na tela própria de quem prescreve. -->
      <RouterLink
        v-if="podeDecidirProfilaxia"
        :to="{ path: '/enfermagem/escores/profilaxia' }"
        class="atalho"
        data-testid="es-atalho-profilaxia"
        >{{ t('enfermagem.mercado.atalhos.profilaxia') }}</RouterLink
      >
    </div>
    <SanteAlerta
      v-if="gravacao && !gravacao.ligada"
      variante="aviso"
      :texto="t('enfermagem.escores.consulta', { motivo: gravacao.motivo ?? '' })"
      data-testid="es-consulta"
    />
    <p v-if="mensagem" role="status" data-testid="es-mensagem">{{ mensagem }}</p>
    <div
      v-if="resultado && resultado.gatilho !== 'nenhum'"
      role="alert"
      class="conduta"
      :class="{ grave: resultado.gatilho === 'trr' }"
      data-testid="es-conduta"
    >
      <strong>{{ ROTULOS_GATILHO[resultado.gatilho] }}</strong>
      <span>{{ resultado.conduta }}</span>
      <span v-for="(a, k) in resultado.avisos" :key="k" class="secundario">{{ a }}</span>
      <RouterLink
        v-if="resultado.gatilho === 'trr'"
        :to="{ path: '/enfermagem/trr' }"
        data-testid="es-acionar-trr"
        >{{ t('enfermagem.mercado.atalhos.trrAlerta') }}</RouterLink
      >
    </div>
    <ErroEnfermagem v-if="erro" :erro="erro" />

    <!-- A unidade no turno -->
    <template v-if="!atendimento">
      <ErroEnfermagem v-if="daUnidade.isError.value" :erro="daUnidade.error.value" />
      <p v-else-if="!daUnidade.data.value" role="status">{{ t('enfermagem.comum.carregando') }}</p>
      <template v-else>
        <p>
          {{
            t('enfermagem.escores.turno', {
              nome: t(`enfermagem.turno.${daUnidade.data.value.turno.nome}`),
              inicio: hora(daUnidade.data.value.turno.inicio),
              fim: hora(daUnidade.data.value.turno.fim),
            })
          }}
        </p>
        <ul class="resumo" data-testid="es-resumo">
          <li>
            {{ t('enfermagem.escores.vencidas') }}:
            <strong>{{ daUnidade.data.value.resumo.vencidas }}</strong>
          </li>
          <li>
            {{ t('enfermagem.escores.emRisco') }}: <strong>{{ daUnidade.data.value.resumo.emRisco }}</strong>
          </li>
          <li>
            {{ t('enfermagem.escores.news2Alto') }}:
            <strong>{{ daUnidade.data.value.resumo.news2Alto }}</strong>
          </li>
        </ul>
        <section class="cartao" data-testid="es-tev-pendentes" aria-labelledby="es-tev-titulo">
          <h2 id="es-tev-titulo">{{ t('enfermagem.mercado.tev.titulo') }}</h2>
          <p class="secundario">{{ t('enfermagem.mercado.tev.texto') }}</p>
          <p v-if="pendentesTev.length === 0">{{ t('enfermagem.mercado.tev.vazio') }}</p>
          <ul v-else>
            <li v-for="p in pendentesTev" :key="p.escore" class="cuidado" :data-testid="`es-tev-${p.escore}`">
              <span>
                <strong>{{ p.leito }} · {{ p.nome }}</strong> ·
                {{
                  t('enfermagem.mercado.tev.escore', {
                    escala: nomeEscalaTev(p.escala),
                    total: p.total,
                    faixa: p.rotuloFaixa,
                    quando: hora(p.aferidoEm),
                    por: p.usuario,
                  })
                }}
                · {{ p.sugestao }}
              </span>
              <SanteBotao
                v-if="podeDecidirProfilaxia"
                variante="secundario"
                :rotulo="t('enfermagem.mercado.tev.decidir')"
                :data-testid="`es-tev-decidir-${p.escore}`"
                @acionar="abrirTev(p)"
              />
              <span v-else class="secundario">{{ t('enfermagem.mercado.tev.soPrescritor') }}</span>
            </li>
          </ul>
        </section>
        <p v-if="daUnidade.data.value.pacientes.length === 0">{{ t('enfermagem.comum.nenhum') }}</p>
        <div v-else class="rolagem">
          <table class="grade" data-testid="es-unidade">
            <caption class="sr-only">
              {{
                t('enfermagem.escores.titulo')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('enfermagem.escores.leito') }}</th>
                <th scope="col">{{ t('enfermagem.escores.paciente') }}</th>
                <th
                  v-for="e in ['news2', 'braden', 'morse', 'glasgow', 'rass', 'camicu', 'dor']"
                  :key="e"
                  scope="col"
                >
                  {{ ROTULOS_ESCALA[e as EscalaEscore].split(' (')[0] }}
                </th>
                <th scope="col">{{ t('enfermagem.escores.reavaliacoes.titulo') }}</th>
                <th scope="col">{{ t('enfermagem.comum.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in daUnidade.data.value.pacientes"
                :key="p.paciente"
                :data-testid="`es-linha-${p.paciente}`"
              >
                <td>{{ p.leito }}</td>
                <td>
                  {{ p.nome }}
                  <strong v-if="p.gatilhoAberto" class="alerta">
                    ·
                    {{
                      t('enfermagem.escores.gatilho', { gatilho: ROTULOS_GATILHO[p.gatilhoAberto] })
                    }}</strong
                  >
                </td>
                <td v-for="e in ['news2', 'braden', 'morse', 'glasgow', 'rass', 'camicu', 'dor']" :key="e">
                  <template v-if="ultimoDe(p, e as EscalaEscore)">
                    <span :class="{ alerta: ultimoDe(p, e as EscalaEscore)!.risco }">
                      {{ ultimoDe(p, e as EscalaEscore)!.total }} ·
                      {{ ultimoDe(p, e as EscalaEscore)!.rotuloFaixa }}
                    </span>
                  </template>
                  <template v-else>{{ t('enfermagem.escores.semRegistro') }}</template>
                </td>
                <td>
                  <span
                    v-for="r in p.reavaliacoes"
                    :key="`${r.escala}-${r.motivo}-${r.id}`"
                    class="bloco"
                    :class="{ alerta: r.vencida }"
                  >
                    {{ ROTULOS_ESCALA[r.escala].split(' (')[0] }} ({{
                      ROTULOS_MOTIVO_REAVALIACAO[r.motivo]
                    }}):
                    {{
                      r.vencida
                        ? t('enfermagem.escores.vencida')
                        : t('enfermagem.escores.devida', { prazo: hora(r.prazoEm) })
                    }}
                  </span>
                </td>
                <td>
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t('enfermagem.escores.abrir', { nome: p.leito })"
                    :data-testid="`es-abrir-${p.paciente}`"
                    @acionar="abrir(p.atendimento)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <details class="cartao" data-testid="es-regras">
          <summary>{{ t('enfermagem.escores.regras.titulo') }}</summary>
          <ul>
            <li v-for="r in regras.data.value?.vigentes ?? []" :key="r.escala">
              <strong>{{ ROTULOS_ESCALA[r.escala] }}</strong> ·
              {{ t('enfermagem.escores.regras.versao', { versao: r.versao }) }}:
              <span v-for="f in r.faixas" :key="f.codigo">
                {{
                  t('enfermagem.escores.regras.intervalo', {
                    minimo: f.minimo,
                    maximo: f.maximo,
                    rotulo: f.rotulo,
                  })
                }}</span
              >
            </li>
            <li v-for="r in regras.data.value?.historicas ?? []" :key="`h-${r.escala}`" class="secundario">
              {{ t('enfermagem.escores.regras.historica') }}:
              <span v-for="f in r.faixas" :key="f.codigo">
                {{
                  t('enfermagem.escores.regras.intervalo', {
                    minimo: f.minimo,
                    maximo: f.maximo,
                    rotulo: f.rotulo,
                  })
                }}</span
              >
            </li>
          </ul>
          <SanteBotao
            v-if="gravacao?.publicar"
            variante="secundario"
            :rotulo="t('enfermagem.escores.regras.publicar')"
            data-testid="es-regra-abrir"
            @acionar="abrirRegra"
          />
        </details>
      </template>
    </template>

    <!-- O paciente -->
    <template v-else>
      <SanteBotao
        variante="texto"
        :rotulo="t('enfermagem.escores.voltar')"
        data-testid="es-voltar"
        @acionar="voltar"
      />
      <ErroEnfermagem v-if="doPaciente.isError.value" :erro="doPaciente.error.value" />
      <p v-else-if="!pacienteAtual" role="status">{{ t('enfermagem.comum.carregando') }}</p>
      <template v-else>
        <h2 data-testid="es-paciente">{{ pacienteAtual.leito }} · {{ pacienteAtual.nome }}</h2>
        <p v-if="internado?.gatilhoAberto" class="alerta">
          {{ t('enfermagem.escores.gatilho', { gatilho: ROTULOS_GATILHO[internado.gatilhoAberto] }) }}
          <RouterLink
            v-if="internado.gatilhoAberto === 'trr'"
            :to="{ path: '/enfermagem/trr' }"
            data-testid="es-acionar-trr-paciente"
            >{{ t('enfermagem.mercado.atalhos.trrAlerta') }}</RouterLink
          >
        </p>

        <section
          v-if="profilaxiaDoPaciente"
          class="cartao"
          data-testid="es-tev-paciente"
          aria-labelledby="es-tev-pac-titulo"
        >
          <h3 id="es-tev-pac-titulo">{{ t('enfermagem.mercado.tev.paciente') }}</h3>
          <p>
            {{
              t('enfermagem.mercado.tev.escore', {
                escala: nomeEscalaTev(profilaxiaDoPaciente.escala),
                total: profilaxiaDoPaciente.total,
                faixa: profilaxiaDoPaciente.rotuloFaixa,
                quando: hora(profilaxiaDoPaciente.aferidoEm),
                por: profilaxiaDoPaciente.usuario,
              })
            }}
            · {{ profilaxiaDoPaciente.sugestao }}
          </p>
          <p v-if="profilaxiaDoPaciente.decisao" data-testid="es-tev-decisao">
            <strong>{{
              t('enfermagem.mercado.tev.decidida', {
                decisao: t(`enfermagem.mercado.tev.decisoes.${profilaxiaDoPaciente.decisao.decisao}`),
                por: profilaxiaDoPaciente.decisao.usuario,
                quando: hora(profilaxiaDoPaciente.decisao.em),
              })
            }}</strong>
            <template v-if="profilaxiaDoPaciente.decisao.motivo">
              · {{ profilaxiaDoPaciente.decisao.motivo }}</template
            >
            <SanteBotao
              v-if="podeDecidirProfilaxia && ehMeu(profilaxiaDoPaciente.decisao.usuario)"
              variante="secundario"
              :rotulo="t('enfermagem.mercado.tev.corrigir')"
              data-testid="es-tev-corrigir"
              @acionar="abrirCorrigirTev(profilaxiaDoPaciente)"
            />
          </p>
          <div v-else class="barra">
            <strong class="alerta" data-testid="es-tev-pendente">{{
              t('enfermagem.mercado.tev.pendente')
            }}</strong>
            <SanteBotao
              v-if="podeDecidirProfilaxia"
              variante="secundario"
              :rotulo="t('enfermagem.mercado.tev.decidir')"
              data-testid="es-tev-decidir-paciente"
              @acionar="abrirTev(profilaxiaDoPaciente)"
            />
          </div>
          <div
            v-if="(profilaxiaDoPaciente.historico?.length ?? 0) > 1"
            class="secundario"
            data-testid="es-tev-historico"
          >
            {{ t('enfermagem.mercado.tev.historico') }}:
            <ul>
              <li v-for="(h, i) in profilaxiaDoPaciente.historico!.slice(0, -1)" :key="i" class="tachado">
                {{
                  t('enfermagem.mercado.tev.historicoItem', {
                    decisao: rotuloHistoricoTev(h.decisao),
                    por: h.usuario,
                    quando: hora(h.em),
                  })
                }}
                <template v-if="h.justificativa"> · {{ h.justificativa }}</template>
              </li>
            </ul>
          </div>
        </section>

        <form class="cartao" data-testid="es-afericao" @submit.prevent="registrarNews2">
          <h3>{{ t('enfermagem.escores.afericao.titulo') }}</h3>
          <p class="secundario">{{ t('enfermagem.escores.afericao.texto') }}</p>
          <div class="campos">
            <span v-for="k in PARAMETROS" :key="k" class="campo">
              <label :for="`es-af-${k}`">{{ t(`enfermagem.escores.afericao.${k}`) }}</label>
              <input
                :id="`es-af-${k}`"
                v-model="afericao[k]"
                inputmode="decimal"
                :data-testid="`es-af-${k}`"
              />
            </span>
            <SanteSelecao
              v-model="acvpu"
              :rotulo="t('enfermagem.escores.afericao.acvpu')"
              :opcoes="opcoesAcvpu"
              data-testid="es-af-acvpu"
            />
          </div>
          <label class="linha"
            ><input v-model="escala2" type="checkbox" data-testid="es-af-escala2" />
            {{ t('enfermagem.escores.afericao.escala2') }}</label
          >
          <label class="linha"
            ><input v-model="infeccao" type="checkbox" data-testid="es-af-infeccao" />
            {{ t('enfermagem.escores.afericao.suspeitaInfeccao') }}</label
          >
          <label class="linha"
            ><input v-model="confirmarFora" type="checkbox" data-testid="es-af-confirmar" />
            {{ t('enfermagem.escores.afericao.confirmarFora') }}</label
          >
          <p v-if="previaNews2" role="status" data-testid="es-af-previa">
            {{
              t('enfermagem.escores.afericao.previa', {
                total: previaNews2.total,
                faixa: previaNews2.faixa.rotulo,
              })
            }}
            —
            {{ previaNews2.conduta }}
          </p>
          <p v-else class="secundario">{{ t('enfermagem.escores.afericao.incompleta') }}</p>
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.escores.afericao.registrar')"
            :desabilitado="!podeRegistrar || !sinaisDigitados || ocupado"
            data-testid="es-af-registrar"
          />
        </form>

        <form class="cartao" data-testid="es-escala" @submit.prevent="registrarEscala">
          <h3>{{ t('enfermagem.escores.escala.titulo') }}</h3>
          <div class="campos">
            <SanteSelecao
              v-model="escala"
              :rotulo="t('enfermagem.escores.escala.escolher')"
              :opcoes="opcoesEscala"
              data-testid="es-escala-escolher"
            />
            <SanteSelecao
              v-if="escala === 'dor'"
              v-model="modoDor"
              :rotulo="t('enfermagem.escores.escala.modoDor')"
              :opcoes="opcoesModoDor"
              data-testid="es-escala-modo"
            />
            <SanteSelecao
              v-if="ehTev"
              v-model="perfilTev"
              :rotulo="t('enfermagem.mercado.tev.perfil')"
              :opcoes="opcoesPerfilTev"
              data-testid="es-escala-perfil-tev"
            />
          </div>
          <p v-if="ehTev" class="secundario">{{ t('enfermagem.mercado.tev.perfilAjuda') }}</p>
          <div class="campos">
            <SanteSelecao
              v-for="i in itens"
              :key="`${escala}-${i.codigo}`"
              :model-value="respostas[i.codigo] ?? null"
              :rotulo="i.rotulo"
              :opcoes="[
                { valor: null, rotulo: '—' },
                ...i.opcoes.map((o) => ({ valor: o.valor, rotulo: `${o.rotulo} (${o.valor})` })),
              ]"
              :data-testid="`es-item-${i.codigo}`"
              @update:model-value="respostas[i.codigo] = $event as number | null"
            />
          </div>
          <p v-if="previaEscala && previaEscala.ok" role="status" data-testid="es-esc-previa">
            {{
              t('enfermagem.escores.escala.previa', {
                total: previaEscala.total,
                faixa: previaEscala.faixa.rotulo,
              })
            }}
            —
            {{ previaEscala.conduta }}
          </p>
          <p v-else-if="previaEscala && !previaEscala.ok" class="alerta">{{ previaEscala.mensagem }}</p>
          <p v-else class="secundario">{{ t('enfermagem.escores.escala.faltam') }}</p>
          <fieldset v-if="sugeridos.length" class="cuidados" data-testid="es-cuidados">
            <legend>{{ t('enfermagem.escores.escala.cuidados') }}</legend>
            <p class="secundario">
              {{
                decideCuidados
                  ? t('enfermagem.escores.escala.cuidadosTexto')
                  : t('enfermagem.escores.escala.cuidadosDoEnfermeiro')
              }}
            </p>
            <ul v-if="!decideCuidados" data-testid="es-cuidados-sugeridos">
              <li v-for="c in sugeridos" :key="c.codigo">{{ c.rotulo }}</li>
            </ul>
            <div
              v-for="c in decideCuidados ? sugeridos : []"
              :key="c.codigo"
              class="cuidado"
              :data-testid="`es-cuidado-${c.codigo}`"
            >
              <span>{{ c.rotulo }}</span>
              <label class="linha">
                <input
                  type="radio"
                  :name="`cuidado-${c.codigo}`"
                  :checked="decisoes[c.codigo]?.decisao === 'aceito'"
                  :data-testid="`es-cuidado-aceitar-${c.codigo}`"
                  @change="decidir(c.codigo, 'aceito')"
                />
                {{ t('enfermagem.escores.escala.aceitar') }}
              </label>
              <label class="linha">
                <input
                  type="radio"
                  :name="`cuidado-${c.codigo}`"
                  :checked="decisoes[c.codigo]?.decisao === 'recusado'"
                  :data-testid="`es-cuidado-recusar-${c.codigo}`"
                  @change="decidir(c.codigo, 'recusado')"
                />
                {{ t('enfermagem.escores.escala.recusar') }}
              </label>
              <span v-if="decisoes[c.codigo]?.decisao === 'recusado'" class="campo">
                <label :for="`es-motivo-${c.codigo}`">{{ t('enfermagem.escores.escala.motivo') }}</label>
                <input
                  :id="`es-motivo-${c.codigo}`"
                  v-model="decisoes[c.codigo]!.motivo"
                  maxlength="300"
                  :data-testid="`es-cuidado-motivo-${c.codigo}`"
                />
              </span>
            </div>
          </fieldset>
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.escores.escala.registrar')"
            :desabilitado="
              !podeRegistrar || !previaEscala || !previaEscala.ok || !cuidadosCompletos || ocupado
            "
            data-testid="es-esc-registrar"
          />
        </form>

        <section class="cartao" data-testid="es-reavaliacoes" aria-labelledby="es-reav-titulo">
          <h3 id="es-reav-titulo">{{ t('enfermagem.escores.reavaliacoes.titulo') }}</h3>
          <p v-if="pacienteAtual.reavaliacoes.filter((r) => r.situacao === 'pendente').length === 0">
            {{ t('enfermagem.escores.reavaliacoes.vazio') }}
          </p>
          <ul v-else>
            <li
              v-for="r in pacienteAtual.reavaliacoes.filter((x) => x.situacao === 'pendente')"
              :key="`${r.escala}-${r.motivo}-${r.id}`"
              :class="{ alerta: r.vencida }"
              :data-testid="`es-reav-${r.escala}-${r.motivo}`"
            >
              {{ ROTULOS_ESCALA[r.escala] }} · {{ ROTULOS_MOTIVO_REAVALIACAO[r.motivo] }} ·
              {{ t('enfermagem.escores.reavaliacoes.prazo') }} {{ hora(r.prazoEm) }}
              <strong v-if="r.vencida"> · {{ t('enfermagem.escores.vencida') }}</strong>
              <span v-if="r.calculada" class="secundario">
                · {{ t('enfermagem.escores.reavaliacoes.calculada') }}</span
              >
              <SanteBotao
                v-if="r.id !== null && podeRegistrar"
                variante="texto"
                :rotulo="t('enfermagem.escores.reavaliacoes.dispensar')"
                :data-testid="`es-reav-dispensar-${r.id}`"
                @acionar="abrirDispensa(r.id)"
              />
            </li>
          </ul>
          <div class="barra">
            <SanteSelecao
              v-model="reavEscala"
              :rotulo="t('enfermagem.escores.escala.escolher')"
              :opcoes="opcoesReavEscala"
              data-testid="es-reav-escala"
            />
            <SanteSelecao
              v-model="reavMotivo"
              :rotulo="t('enfermagem.escores.reavaliacoes.motivo')"
              :opcoes="opcoesReavMotivo"
              data-testid="es-reav-motivo"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('enfermagem.escores.reavaliacoes.programar')"
              :desabilitado="!podeRegistrar || ocupado"
              data-testid="es-reav-programar"
              @acionar="programar"
            />
          </div>
        </section>

        <section class="cartao" aria-labelledby="es-hist-titulo">
          <div class="barra">
            <h3 id="es-hist-titulo">{{ t('enfermagem.escores.historico.titulo') }}</h3>
            <SanteBotao
              variante="secundario"
              :rotulo="t('enfermagem.correcao.escore.exportar')"
              data-testid="es-exportar"
              @acionar="exportar"
            />
          </div>
          <p v-if="pacienteAtual.historico.length === 0">{{ t('enfermagem.escores.historico.vazio') }}</p>
          <div v-else class="rolagem">
            <table class="grade" data-testid="es-historico">
              <thead>
                <tr>
                  <th scope="col">{{ t('enfermagem.escores.historico.quando') }}</th>
                  <th scope="col">{{ t('enfermagem.escores.historico.escala') }}</th>
                  <th scope="col">{{ t('enfermagem.escores.historico.total') }}</th>
                  <th scope="col">{{ t('enfermagem.escores.historico.faixa') }}</th>
                  <th scope="col">{{ t('enfermagem.escores.historico.origem') }}</th>
                  <th scope="col">{{ t('enfermagem.escores.historico.quem') }}</th>
                  <th scope="col">{{ t('enfermagem.comum.situacao') }}</th>
                  <th scope="col">{{ t('enfermagem.comum.acoes') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="h in pacienteAtual.historico"
                  :key="h.id"
                  :class="{ inativo: !!h.estorno }"
                  :data-testid="`es-hist-${h.id}`"
                  :data-inativo="h.estorno ? 'sim' : 'nao'"
                >
                  <td>{{ hora(h.aferidoEm) }}</td>
                  <td>{{ ROTULOS_ESCALA[h.escala] }}</td>
                  <td>
                    <s v-if="h.estorno">{{ h.total }}</s
                    ><template v-else>{{ h.total }}</template>
                  </td>
                  <td :class="{ alerta: h.risco && !h.estorno }">
                    <s v-if="h.estorno">{{ h.rotuloFaixa }}</s
                    ><template v-else>{{ h.rotuloFaixa }}</template>
                  </td>
                  <td>{{ t(`enfermagem.escores.historico.${h.origem}`) }}</td>
                  <td>{{ h.usuario }}</td>
                  <td>
                    <span v-if="h.estorno" :data-testid="`es-hist-estorno-${h.id}`">
                      <strong>{{ t('enfermagem.correcao.inativo') }}</strong> ·
                      {{
                        t('enfermagem.correcao.estornadoPor', {
                          tipo: t(`enfermagem.correcao.tipoCurto.${h.estorno.tipo}`),
                          por: h.estorno.usuario,
                          quando: hora(h.estorno.em),
                          motivo: h.estorno.motivo,
                        })
                      }}
                      <template v-if="h.estorno.alerta && h.estorno.alerta !== 'sem-alerta'">
                        · {{ t(`enfermagem.correcao.alerta.${h.estorno.alerta}`) }}
                      </template>
                    </span>
                  </td>
                  <td>
                    <SanteBotao
                      v-if="!h.estorno"
                      variante="secundario"
                      :rotulo="t('enfermagem.correcao.escore.estornar')"
                      :desabilitado="!podeRegistrar"
                      :data-testid="`es-estornar-${h.id}`"
                      @acionar="abrirEstorno(h.id)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <h3>{{ t('enfermagem.escores.formularios.titulo') }}</h3>
          <p v-if="pacienteAtual.formularios.length === 0">{{ t('enfermagem.escores.formularios.vazio') }}</p>
          <ul v-else data-testid="es-formularios">
            <li v-for="f in pacienteAtual.formularios" :key="f.registro">
              {{ hora(f.quando) }} · {{ f.modelo }} ·
              {{
                f.total === null
                  ? t('enfermagem.escores.formularios.semTotal')
                  : `${t('enfermagem.escores.formularios.total')}: ${f.total}`
              }}
              <template v-if="f.faixaFormulario">
                · {{ t('enfermagem.escores.formularios.faixa') }}: {{ f.faixaFormulario }}
              </template>
            </li>
          </ul>
        </section>
      </template>
    </template>

    <DialogoCorrecao
      v-model:visivel="dialogoEstorno"
      :titulo="t('enfermagem.correcao.escore.titulo')"
      :texto="t('enfermagem.correcao.escore.texto')"
      com-tipo
      testid="es-dialogo-estorno"
      :executar="estornar"
    />
    <SanteDialogo v-model:visivel="dialogoTev" :titulo="t('enfermagem.mercado.tev.dialogo')">
      <div class="campos-coluna" data-testid="es-tev-dialogo">
        <p v-if="decidindoTev">
          {{ decidindoTev.leito }} · {{ decidindoTev.nome }} · {{ nomeEscalaTev(decidindoTev.escala) }}
          {{ decidindoTev.total }} ({{ decidindoTev.rotuloFaixa }}) · {{ decidindoTev.sugestao }}
        </p>
        <SanteSelecao
          v-model="decisaoTev"
          :rotulo="t('enfermagem.mercado.tev.decisao')"
          :opcoes="opcoesDecisaoTev"
          data-testid="es-tev-decisao-escolher"
        />
        <span v-if="decisaoTev === 'nao-prescrita'" class="campo">
          <label for="es-tev-motivo">{{ t('enfermagem.mercado.tev.motivo') }}</label>
          <input id="es-tev-motivo" v-model="motivoTev" maxlength="300" data-testid="es-tev-motivo" />
          <small class="secundario">{{ t('enfermagem.mercado.tev.motivoAjuda') }}</small>
        </span>
        <ErroEnfermagem v-if="erro" :erro="erro" />
        <SanteBotao
          :rotulo="t('enfermagem.mercado.tev.confirmar')"
          :desabilitado="(decisaoTev === 'nao-prescrita' && motivoTev.trim().length < 10) || ocupado"
          data-testid="es-tev-confirmar"
          @acionar="confirmarTev"
        />
      </div>
    </SanteDialogo>
    <SanteDialogo v-model:visivel="dialogoCorrigirTev" :titulo="t('enfermagem.mercado.tev.dialogoCorrigir')">
      <div class="campos-coluna" data-testid="es-tev-dialogo-corrigir">
        <p class="secundario">{{ t('enfermagem.mercado.tev.textoCorrigir') }}</p>
        <SanteSelecao
          v-model="decisaoCorrecaoTev"
          :rotulo="t('enfermagem.mercado.tev.decisao')"
          :opcoes="opcoesCorrecaoTev"
          data-testid="es-tev-correcao-escolher"
        />
        <span v-if="decisaoCorrecaoTev === 'nao-prescrita'" class="campo">
          <label for="es-tev-motivo-corr">{{ t('enfermagem.mercado.tev.motivo') }}</label>
          <input
            id="es-tev-motivo-corr"
            v-model="motivoTev"
            maxlength="300"
            data-testid="es-tev-motivo-corr"
          />
        </span>
        <span class="campo">
          <label for="es-tev-justificativa">{{ t('enfermagem.mercado.tev.justificativa') }}</label>
          <input
            id="es-tev-justificativa"
            v-model="justificativaTev"
            maxlength="300"
            aria-describedby="es-tev-justificativa-ajuda"
            data-testid="es-tev-justificativa"
          />
          <small id="es-tev-justificativa-ajuda" class="secundario">{{
            t('enfermagem.mercado.tev.justificativaAjuda')
          }}</small>
        </span>
        <ErroEnfermagem v-if="erro" :erro="erro" />
        <SanteBotao
          :rotulo="t('enfermagem.mercado.tev.confirmarCorrecao')"
          :desabilitado="
            justificativaTev.trim().length < 10 ||
            (decisaoCorrecaoTev === 'nao-prescrita' && motivoTev.trim().length < 10) ||
            ocupado
          "
          data-testid="es-tev-correcao-confirmar"
          @acionar="confirmarCorrecaoTev"
        />
      </div>
    </SanteDialogo>
    <SanteDialogo v-model:visivel="abertoDispensa" :titulo="t('enfermagem.escores.reavaliacoes.dispensar')">
      <div class="campo">
        <label for="es-dispensa-motivo">{{ t('enfermagem.escores.reavaliacoes.motivoDispensa') }}</label>
        <input
          id="es-dispensa-motivo"
          v-model="motivoDispensa"
          maxlength="300"
          data-testid="es-dispensa-motivo"
        />
        <ErroEnfermagem v-if="erro" :erro="erro" />
        <SanteBotao
          :rotulo="t('enfermagem.comum.confirmar')"
          :desabilitado="motivoDispensa.trim().length < 10 || ocupado"
          data-testid="es-dispensa-confirmar"
          @acionar="confirmarDispensa"
        />
      </div>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="abertoRegra"
      :titulo="t('enfermagem.escores.regras.publicar')"
      largura="48rem"
    >
      <div class="campos-coluna" data-testid="es-regra-dialogo">
        <SanteSelecao
          v-model="regraEscala"
          :rotulo="t('enfermagem.escores.escala.escolher')"
          :opcoes="opcoesTodasEscalas"
        />
        <table class="grade">
          <thead>
            <tr>
              <th scope="col">{{ t('enfermagem.escores.regras.rotulo') }}</th>
              <th scope="col">{{ t('enfermagem.escores.regras.minimo') }}</th>
              <th scope="col">{{ t('enfermagem.escores.regras.maximo') }}</th>
              <th scope="col">{{ t('enfermagem.escores.regras.risco') }}</th>
              <th scope="col">{{ t('enfermagem.comum.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(f, k) in faixasEdicao" :key="k">
              <td>
                <input
                  v-model="f.rotulo"
                  :aria-label="t('enfermagem.escores.regras.rotulo')"
                  maxlength="60"
                />
              </td>
              <td>
                <input
                  v-model.number="f.minimo"
                  type="number"
                  :aria-label="t('enfermagem.escores.regras.minimo')"
                />
              </td>
              <td>
                <input
                  v-model.number="f.maximo"
                  type="number"
                  :aria-label="t('enfermagem.escores.regras.maximo')"
                />
              </td>
              <td>
                <input v-model="f.risco" type="checkbox" :aria-label="t('enfermagem.escores.regras.risco')" />
              </td>
              <td>
                <SanteBotao
                  variante="texto"
                  :rotulo="t('enfermagem.escores.regras.remover')"
                  @acionar="faixasEdicao.splice(k, 1)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <SanteBotao
          variante="secundario"
          :rotulo="t('enfermagem.escores.regras.incluir')"
          @acionar="
            faixasEdicao.push({
              codigo: `faixa${faixasEdicao.length + 1}`,
              rotulo: '',
              minimo: 0,
              maximo: 0,
              risco: false,
            })
          "
        />
        <span class="campo">
          <label for="es-regra-notas">{{ t('enfermagem.escores.regras.notas') }}</label>
          <input id="es-regra-notas" v-model="notas" maxlength="1000" />
        </span>
        <span class="campo">
          <label for="es-regra-senha">{{ t('enfermagem.escores.regras.senha') }}</label>
          <input id="es-regra-senha" v-model="senhaRegra" type="password" autocomplete="current-password" />
        </span>
        <ErroEnfermagem v-if="erro" :erro="erro" />
        <SanteBotao
          :rotulo="t('enfermagem.escores.regras.confirmar')"
          :desabilitado="notas.trim().length < 10 || !senhaRegra || ocupado"
          @acionar="publicarRegra"
        />
      </div>
    </SanteDialogo>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.tachado {
  text-decoration: line-through;
}
.atalho {
  align-self: center;
}
.campos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.campos-coluna {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.resumo {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  list-style: none;
  padding: 0;
}
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
.cuidados {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
}
.cuidado {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
  margin-bottom: var(--sgh-espaco-1);
}
.bloco {
  display: block;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
