<script setup lang="ts">
// Terapia nutricional enteral e parenteral (EMTN) (ficha do M45, seção 7): `/nutricao/terapia/:reg`. As dietas enterais e
// parenterais prescritas (a nutricionista prescreve pela prescrição eletrônica), o tempo até iniciar, as fichas
// nutricionais do prontuário, a meta (peso, kcal/kg, proteína/kg e a fórmula: o volume-alvo calculado) e o acompanhamento
// do dia com o volume da checagem (sem redigitar) ou informado, o percentual atingido e o motivo abaixo do adequado.
// Sem a internação na rota: os internados da fila para escolher.
// W0-05 (revisão): no padrão da ficha do profissional: o cartão do paciente e as abas (Metas e versões; Progresso e
// balanço; Acompanhamento), que a impressão (Imprimir) junta numa página só, com as versões inativas. As metas vigentes
// (uma por via: a enteral e a NPT complementar convivem e somam no dia) e o histórico do acompanhamento ficam visíveis
// mesmo sem meta vigente; retificar e estornar o dia só para o próprio autor (o servidor também recusa os demais).
import {
  ACESSOS_NPT,
  CODIGOS_MOTIVO_META,
  CODIGOS_PARECER_NPT,
  type AcessoNpt,
  type CorrecaoLida,
  type MetaTerapiaLida,
  type MotivoMetaNaoAtingida,
  type ParecerNpt,
  type ViaTerapiaNutricional,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  lerFilaNutricao,
  lerGravacaoNutricao,
  lerTerapia,
  novaChaveNutricao,
  registrarAcompanhamento,
  registrarMeta,
  alterarMeta,
  avaliarNpt,
  encerrarMeta,
  estornarAcompanhamento,
  retificarAcompanhamento,
} from '../api-nutricao.js';
import AbasFicha from '../componentes/AbasFicha.vue';
import AvisoNutricao from '../componentes/AvisoNutricao.vue';
import CartaoPerfil from '../componentes/CartaoPerfil.vue';
import DialogoCorrecao from '../componentes/DialogoCorrecao.vue';
import ErroNutricao from '../componentes/ErroNutricao.vue';
import { combinaBusca, dataLonga, instanteCurto, leitoTexto, percentual } from '../regras-nutricao.js';

const { t } = useI18n();
const rota = useRoute();
const reg = computed(() => {
  const v = Number(rota.params['reg']);
  return Number.isInteger(v) && v > 0 ? v : null;
});
const gravacao = useQuery({
  queryKey: ['nutricao', 'gravacao'],
  queryFn: lerGravacaoNutricao,
  staleTime: 30_000,
});
const pode = computed(() => gravacao.data.value?.operacoes['terapia']?.pode ?? false);
const motivoPode = computed(() => gravacao.data.value?.operacoes['terapia']?.motivo ?? null);
const aviso = computed(() =>
  gravacao.data.value && !gravacao.data.value.ligada ? gravacao.data.value.motivo : null,
);
const fila = useQuery({
  queryKey: ['nutricao', 'fila', ''],
  queryFn: () => lerFilaNutricao(null),
  enabled: computed(() => reg.value === null),
});
// A lista para escolher: a busca e o filtro dos que estão em terapia (com a meta da EMTN registrada).
const busca = ref('');
const soEmTerapia = ref<'todos' | 'terapia'>('todos');
const mostrar = computed(() => [
  { valor: 'todos', rotulo: t('nutricao.todosInternados') },
  { valor: 'terapia', rotulo: t('nutricao.soEmTerapia') },
]);
const escolher = computed(() =>
  (fila.data.value?.itens ?? []).filter(
    (i) =>
      (soEmTerapia.value === 'todos' || i.emTerapia) &&
      combinaBusca(busca.value, [i.nome, String(i.internacao), String(i.paciente), leitoTexto(i.leito)]),
  ),
);
const terapia = useQuery({
  queryKey: computed(() => ['nutricao', 'terapia', reg.value]),
  queryFn: () => lerTerapia(reg.value as number),
  enabled: computed(() => reg.value !== null),
});
// W0-05: as metas vigentes (uma por via); as substituídas e as encerradas ficam na lista de versões, sempre visível
// quando há alguma inativa. O acompanhamento do dia é registrado na meta escolhida (a primeira vigente por padrão).
const vigentes = computed(() => (terapia.data.value?.metas ?? []).filter((m) => m.situacao === 'vigente'));
const temInativa = computed(() => (terapia.data.value?.metas ?? []).some((m) => m.situacao !== 'vigente'));
const metaDia = ref<number | null>(null);
const meta = computed(() => vigentes.value.find((m) => m.id === metaDia.value) ?? vigentes.value[0] ?? null);
const opcoesMetaDia = computed(() =>
  vigentes.value.map((m) => ({
    valor: m.id,
    rotulo: t('nutricao.terapia.metaDaVia', {
      via: t(`nutricao.terapia.vias.${m.via}`),
      kcal: String(m.metaKcal).replace('.', ','),
    }),
  })),
);
watch(meta, (m) => {
  if (m && metaDia.value !== m.id) metaDia.value = m.id;
});
// Quem registrou corrige ou estorna o próprio dia (D-W005-ACOES-DO-AUTOR).
const { sessao } = usarSessao();
const login = computed(() => (sessao.value?.usuario.login ?? sessao.value?.usuario.id ?? '').toUpperCase());
const doAutor = (x: { por: string }) => x.por.toUpperCase() === login.value;
// As abas da ficha (a impressão junta todas).
const aba = ref('meta');
const abas = computed(() => [
  { id: 'meta', rotulo: t('nutricao.terapia.abas.meta'), n: terapia.data.value?.metas.length ?? 0 },
  {
    id: 'progresso',
    rotulo: t('nutricao.terapia.abas.progresso'),
    n: terapia.data.value?.progresso.length ?? 0,
  },
  {
    id: 'acompanhamento',
    rotulo: t('nutricao.terapia.abas.acompanhamento'),
    n: terapia.data.value?.acompanhamentos.length ?? 0,
  },
]);
const imprimir = () => window.print();
const podeNpt = computed(() => gravacao.data.value?.operacoes['avaliarNpt']?.pode ?? false);

// ── Meta ──
const via = ref<ViaTerapiaNutricional>('enteral');
const itemDieta = ref<number | null>(null);
const peso = ref<number | null>(null);
const kcalKg = ref<number | null>(25);
const ptnKg = ref<number | null>(1.5);
const densidade = ref<number | null>(1.5);
const ptnL = ref<number | null>(60);
const obsMeta = ref('');
watch(
  () => terapia.data.value,
  (x) => {
    const d = x?.dietas.find((y) => !y.suspensa);
    itemDieta.value = d?.itemDieta ?? null;
    via.value = d?.via ?? 'enteral';
  },
  { immediate: true },
);
// Só as vias sem meta vigente (a nova versão de uma vigente é pelo "Alterar a meta").
const vias = computed(() =>
  (['enteral', 'parenteral', 'oral'] as const)
    .filter((v) => !vigentes.value.some((m) => m.via === v))
    .map((v) => ({
      valor: v,
      rotulo: t(`nutricao.terapia.vias.${v}`),
    })),
);
watch(vias, (vs) => {
  if (vs.length && !vs.some((v) => v.valor === via.value)) via.value = vs[0]!.valor;
});
const dietas = computed(() => [
  { valor: null, rotulo: t('nutricao.terapia.semItem') },
  ...(terapia.data.value?.dietas ?? [])
    .filter((d) => !d.suspensa)
    .map((d) => ({ valor: d.itemDieta, rotulo: `${d.dieta} · ${t(`nutricao.terapia.vias.${d.via}`)}` })),
]);

// ── Acompanhamento ──
const dia = ref<string | null>(null);
const volume = ref<number | null>(null);
const motivo = ref<MotivoMetaNaoAtingida | ''>('');
const obsDia = ref('');
const motivos = computed(() => [
  { valor: '' as const, rotulo: t('nutricao.terapia.semMotivo') },
  ...CODIGOS_MOTIVO_META.map((m) => ({ valor: m, rotulo: t(`nutricao.terapia.motivos.${m}`) })),
]);
watch(
  () => terapia.data.value?.lidoEm,
  (l) => {
    if (l && dia.value === null) dia.value = l.slice(0, 10);
  },
  { immediate: true },
);

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function fazer(fn: () => Promise<{ mensagem: string }>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    mensagem.value = (await fn()).mensagem;
    await terapia.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const gravarMeta = () =>
  fazer(() =>
    registrarMeta(
      {
        internacao: reg.value,
        via: via.value,
        itemDieta: itemDieta.value,
        pesoKg: Number(peso.value),
        kcalPorKg: Number(kcalKg.value),
        proteinaGPorKg: Number(ptnKg.value),
        densidadeKcalMl: Number(densidade.value),
        proteinaGL: Number(ptnL.value ?? 0),
        ...(obsMeta.value.trim() ? { observacao: obsMeta.value.trim() } : {}),
      },
      novaChaveNutricao('meta'),
    ),
  );
const gravarDia = () =>
  fazer(() =>
    registrarAcompanhamento(
      {
        internacao: reg.value,
        meta: meta.value?.id,
        data: dia.value,
        volumeInformadoMl: volume.value === null || Number.isNaN(volume.value) ? null : Number(volume.value),
        motivo: motivo.value === '' ? null : motivo.value,
        ...(obsDia.value.trim() ? { observacao: obsDia.value.trim() } : {}),
      },
      novaChaveNutricao('acompanhamento'),
    ),
  );
const num = (v: number) => String(v).replace('.', ',');

// ── W0-05: correções (diálogo único com o motivo) ──
type Acao =
  | { tipo: 'alterar-meta'; meta: MetaTerapiaLida }
  | { tipo: 'encerrar-meta'; meta: MetaTerapiaLida }
  | { tipo: 'retificar'; id: number }
  | { tipo: 'estornar'; id: number }
  | { tipo: 'npt'; meta: MetaTerapiaLida };
const acao = ref<Acao | null>(null);
const dialogo = ref(false);
const nVolume = ref<number | null>(null);
const nMotivoMeta = ref<MotivoMetaNaoAtingida | ''>('');
const parecer = ref<ParecerNpt>('adequada');
const acesso = ref<AcessoNpt>('central');
const osm = ref<number | null>(null);
const estab = ref(true);
const compat = ref(true);
const obsNpt = ref('');
const pareceres = computed(() =>
  CODIGOS_PARECER_NPT.map((p) => ({ valor: p, rotulo: t(`nutricao.terapia.pareceres.${p}`) })),
);
const acessos = computed(() =>
  ACESSOS_NPT.map((a) => ({ valor: a, rotulo: t(`nutricao.terapia.acessos.${a}`) })),
);
function abrir(a: Acao): void {
  acao.value = a;
  if (a.tipo === 'alterar-meta') {
    peso.value = a.meta.pesoKg;
    kcalKg.value = a.meta.kcalPorKg;
    ptnKg.value = a.meta.proteinaGPorKg;
    densidade.value = a.meta.densidadeKcalMl;
    ptnL.value = a.meta.proteinaGL;
    itemDieta.value = a.meta.itemDieta;
  }
  nVolume.value = null;
  nMotivoMeta.value = '';
  osm.value = null;
  obsNpt.value = '';
  dialogo.value = true;
}
const tituloAcao = computed(() => {
  const a = acao.value;
  if (!a) return '';
  return {
    'alterar-meta': t('nutricao.terapia.alterarMeta'),
    'encerrar-meta': t('nutricao.terapia.encerrarMeta'),
    retificar: t('nutricao.terapia.retificar'),
    estornar: t('nutricao.terapia.estornar'),
    npt: t('nutricao.terapia.npt'),
  }[a.tipo];
});
const textoAcao = computed(() => {
  const a = acao.value;
  if (!a) return '';
  return {
    'alterar-meta': t('nutricao.terapia.alterarMetaTexto'),
    'encerrar-meta': t('nutricao.terapia.encerrarMetaTexto'),
    retificar: t('nutricao.terapia.retificarTexto'),
    estornar: t('nutricao.terapia.estornarTexto'),
    npt: t('nutricao.terapia.nptTexto'),
  }[a.tipo];
});
const incompleto = computed(() => {
  const a = acao.value;
  if (a?.tipo === 'retificar') return nVolume.value === null || Number.isNaN(nVolume.value);
  if (a?.tipo === 'alterar-meta') return !peso.value || !kcalKg.value || !ptnKg.value || !densidade.value;
  if (a?.tipo === 'npt') return !osm.value || (parecer.value !== 'adequada' && !obsNpt.value.trim());
  return false;
});
async function gravarAcao({ motivo: m }: { motivo: string }): Promise<{ mensagem: string }> {
  const a = acao.value;
  if (!a) throw new Error('sem ação');
  if (a.tipo === 'alterar-meta')
    return alterarMeta(
      a.meta.id,
      {
        itemDieta: itemDieta.value,
        pesoKg: Number(peso.value),
        kcalPorKg: Number(kcalKg.value),
        proteinaGPorKg: Number(ptnKg.value),
        densidadeKcalMl: Number(densidade.value),
        proteinaGL: Number(ptnL.value ?? 0),
        motivo: m,
      },
      novaChaveNutricao('alterar-meta'),
    );
  if (a.tipo === 'encerrar-meta') return encerrarMeta(a.meta.id, m, novaChaveNutricao('encerrar-meta'));
  if (a.tipo === 'retificar')
    return retificarAcompanhamento(
      a.id,
      {
        volumeInformadoMl: Number(nVolume.value),
        motivoMeta: nMotivoMeta.value === '' ? null : nMotivoMeta.value,
        motivo: m,
      },
      novaChaveNutricao('retificar-dia'),
    );
  if (a.tipo === 'estornar') return estornarAcompanhamento(a.id, m, novaChaveNutricao('estornar-dia'));
  return avaliarNpt(
    a.meta.id,
    {
      parecer: parecer.value,
      acesso: acesso.value,
      osmolaridade: Number(osm.value),
      estabilidade: estab.value,
      compatibilidade: compat.value,
      // A observação da avaliação (obrigatória quando não é adequada) e a justificativa (o motivo do diálogo).
      observacao: [obsNpt.value.trim(), t('nutricao.terapia.nptJustificativaTexto', { j: m })]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 1000),
    },
    novaChaveNutricao('avaliar-npt'),
  );
}
async function feitoAcao(r: unknown): Promise<void> {
  erro.value = null;
  mensagem.value = (r as { mensagem?: string }).mensagem ?? null;
  await terapia.refetch();
}
const correcaoTexto = (c: CorrecaoLida, chave: string) =>
  t(`nutricao.correcao.${chave}`, { em: instanteCurto(c.em), por: c.por, motivo: c.motivo });
</script>

<template>
  <section
    class="tela-agenda tela-correcoes"
    aria-labelledby="terapia-titulo"
    data-testid="tela-terapia-nutricional"
  >
    <template v-if="reg === null">
      <h1 id="terapia-titulo">{{ t('nutricao.terapia.titulo') }}</h1>
      <p>{{ t('nutricao.terapia.texto') }}</p>
    </template>
    <p class="acoes nao-imprimir">
      <RouterLink to="/nutricao/triagem">{{ t('nutricao.atalhos.triagem') }}</RouterLink>
      <RouterLink to="/nutricao/mapa">{{ t('nutricao.atalhos.mapa') }}</RouterLink>
      <RouterLink v-if="reg !== null" to="/nutricao/terapia">{{
        t('nutricao.terapia.outroPaciente')
      }}</RouterLink>
    </p>
    <AvisoNutricao :motivo="aviso" />
    <template v-if="reg === null">
      <ErroNutricao v-if="fila.isError.value" :erro="fila.error.value" />
      <p v-else-if="!fila.data.value" role="status">{{ t('nutricao.carregando') }}</p>
      <template v-else>
        <div class="filtros">
          <SanteCampoTexto
            v-model="busca"
            :rotulo="t('nutricao.buscar')"
            :max-bytes="60"
            data-testid="terapia-busca"
          />
          <SanteSelecao
            v-model="soEmTerapia"
            :rotulo="t('nutricao.mostrar')"
            :opcoes="mostrar"
            data-testid="terapia-mostrar"
          />
        </div>
        <p v-if="escolher.length === 0" role="status">{{ t('nutricao.nenhumNaBusca') }}</p>
      </template>
      <ul v-if="fila.data.value && escolher.length" class="lista-simples" data-testid="terapia-escolher">
        <li v-for="i in escolher" :key="i.internacao">
          <RouterLink :to="`/nutricao/terapia/${i.internacao}`">{{ i.nome }}</RouterLink>
          <span class="secundario"> · {{ leitoTexto(i.leito) }}</span>
          <span v-if="i.emTerapia" class="secundario"> · {{ t('nutricao.fila.emTerapia') }}</span>
        </li>
      </ul>
    </template>
    <template v-else>
      <ErroNutricao v-if="terapia.isError.value" :erro="terapia.error.value" />
      <p v-else-if="!terapia.data.value" role="status">{{ t('nutricao.carregando') }}</p>
      <template v-else>
        <CartaoPerfil
          id-titulo="terapia-titulo"
          :titulo="terapia.data.value.nome"
          :linhas="[
            `${t('nutricao.terapia.titulo')} · ${leitoTexto(terapia.data.value.leito)}`,
            t('nutricao.terapia.perfilLinha', {
              reg: terapia.data.value.internacao,
              admissao: instanteCurto(terapia.data.value.admissao),
            }),
          ]"
          data-testid="terapia-perfil"
        >
          <template #pilulas>
            <span
              v-for="m in vigentes"
              :key="m.id"
              class="pilula pilula--ok"
              :data-testid="`terapia-pilula-${m.via}`"
              >{{ t('nutricao.terapia.emTerapiaVia', { via: t(`nutricao.terapia.vias.${m.via}`) }) }}</span
            >
            <span v-if="vigentes.length === 0" class="pilula pilula--neutra">{{
              t('nutricao.terapia.semMeta')
            }}</span>
            <span v-if="terapia.data.value.alerta" class="pilula pilula--aviso">{{
              t('nutricao.terapia.pilulaAlerta', { n: terapia.data.value.alerta.dias })
            }}</span>
          </template>
          <template #acoes>
            <SanteBotao
              variante="secundario"
              :rotulo="t('nutricao.correcao.imprimir')"
              :title="t('nutricao.correcao.imprimirAjuda')"
              data-testid="terapia-imprimir"
              @acionar="imprimir"
            />
          </template>
        </CartaoPerfil>
        <SanteAlerta
          v-if="mensagem"
          variante="info"
          :texto="mensagem"
          anunciar
          data-testid="terapia-mensagem"
        />
        <ErroNutricao v-if="erro" :erro="erro" />
        <SanteAlerta
          v-if="terapia.data.value.alerta"
          variante="aviso"
          :texto="terapia.data.value.alerta.mensagem"
          data-testid="terapia-alerta"
        />
        <AbasFicha v-model="aba" :abas="abas" prefixo="terapia" :rotulo="t('nutricao.terapia.abasRotulo')" />

        <!-- Metas e versões -->
        <div
          v-show="aba === 'meta'"
          id="terapia-painel-meta"
          class="painel-aba"
          role="tabpanel"
          aria-labelledby="terapia-aba-meta"
        >
          <section class="painel" aria-labelledby="terapia-dietas">
            <h2 id="terapia-dietas">{{ t('nutricao.terapia.dietas') }}</h2>
            <p v-if="terapia.data.value.dietas.length === 0">{{ t('nutricao.terapia.semDieta') }}</p>
            <ul v-else class="lista-simples" data-testid="terapia-dietas">
              <li v-for="d in terapia.data.value.dietas" :key="d.itemDieta">
                <strong>{{ d.dieta }}</strong> · {{ t(`nutricao.terapia.vias.${d.via}`) }}
                <span v-if="d.quantidadeMl">
                  · {{ t('nutricao.terapia.volume', { n: d.quantidadeMl }) }}</span
                >
                <span class="secundario">
                  ·
                  {{
                    t('nutricao.terapia.prescritor', {
                      quem: t(`nutricao.terapia.prescritores.${d.prescritor}`),
                    })
                  }}
                  ·
                  {{
                    t('nutricao.terapia.vigencia', {
                      de: instanteCurto(d.vigenciaInicio),
                      ate: instanteCurto(d.vigenciaFim),
                    })
                  }}</span
                >
                <strong v-if="d.suspensa"> · {{ t('nutricao.terapia.suspensa') }}</strong>
              </li>
            </ul>
            <p class="secundario">
              {{
                terapia.data.value.horasAteIniciar === null
                  ? t('nutricao.terapia.naoIniciada')
                  : t('nutricao.terapia.iniciar', { h: terapia.data.value.horasAteIniciar })
              }}
            </p>
            <p class="secundario">
              {{
                terapia.data.value.fichas.quantidade === 0
                  ? t('nutricao.terapia.semFichas')
                  : t('nutricao.terapia.fichas', {
                      n: terapia.data.value.fichas.quantidade,
                      em: instanteCurto(terapia.data.value.fichas.ultima),
                    })
              }}
            </p>
          </section>
          <section class="painel" aria-labelledby="terapia-meta">
            <h2 id="terapia-meta">{{ t('nutricao.terapia.metas') }}</h2>
            <p v-if="vigentes.length === 0" data-testid="terapia-sem-meta">
              {{ t('nutricao.terapia.semMeta') }}
            </p>
            <article
              v-for="m in vigentes"
              :key="m.id"
              class="cartao-registro"
              :data-testid="vigentes.length === 1 ? 'terapia-meta-vigente' : `terapia-meta-vigente-${m.via}`"
            >
              <p class="cabeca-registro">
                <span class="pilula pilula--ok">{{ t('nutricao.terapia.situacoesMeta.vigente') }}</span>
                <strong>{{ t(`nutricao.terapia.vias.${m.via}`) }}</strong>
                <span class="secundario">{{ t(`nutricao.terapia.origemTerapia.${m.origemTerapia}`) }}</span>
              </p>
              <p>
                {{
                  t('nutricao.terapia.meta', {
                    kcal: num(m.metaKcal),
                    kcalKg: num(m.kcalPorKg),
                    ptn: num(m.metaProteinaG),
                    ptnKg: num(m.proteinaGPorKg),
                    peso: num(m.pesoKg),
                    vol: m.metaVolumeMl,
                    dens: num(m.densidadeKcalMl),
                  })
                }}
              </p>
              <p class="nota-correcao">
                {{ t('nutricao.terapia.registradaPor', { por: m.por, em: instanteCurto(m.em) }) }}
              </p>
              <template v-if="m.via === 'parenteral'">
                <h3>{{ t('nutricao.terapia.npt') }}</h3>
                <p v-if="m.avaliacaoNpt" data-testid="terapia-npt">
                  {{
                    t('nutricao.terapia.nptLinha', {
                      parecer: t(`nutricao.terapia.pareceres.${m.avaliacaoNpt.parecer}`),
                      acesso: t(`nutricao.terapia.acessos.${m.avaliacaoNpt.acesso}`),
                      osm: num(m.avaliacaoNpt.osmolaridade),
                      por: m.avaliacaoNpt.por,
                      em: instanteCurto(m.avaliacaoNpt.em),
                    })
                  }}
                  <span v-if="m.avaliacaoNpt.observacao" class="secundario">
                    · {{ m.avaliacaoNpt.observacao }}</span
                  >
                </p>
                <p v-else-if="!podeNpt" class="secundario">{{ t('nutricao.terapia.nptPendente') }}</p>
              </template>
              <p
                v-if="pode || (m.via === 'parenteral' && !m.avaliacaoNpt && podeNpt)"
                class="acoes-registro nao-imprimir"
              >
                <SanteBotao
                  v-if="pode"
                  :rotulo="t('nutricao.terapia.alterarMeta')"
                  variante="secundario"
                  data-testid="meta-alterar"
                  @acionar="abrir({ tipo: 'alterar-meta', meta: m })"
                />
                <SanteBotao
                  v-if="pode"
                  :rotulo="t('nutricao.terapia.encerrarMeta')"
                  variante="texto"
                  data-testid="meta-encerrar"
                  @acionar="abrir({ tipo: 'encerrar-meta', meta: m })"
                />
                <SanteBotao
                  v-if="m.via === 'parenteral' && !m.avaliacaoNpt && podeNpt"
                  :rotulo="t('nutricao.terapia.nptAvaliar')"
                  variante="secundario"
                  data-testid="npt-avaliar"
                  @acionar="abrir({ tipo: 'npt', meta: m })"
                />
              </p>
            </article>
            <form
              v-if="pode && vias.length"
              class="grade nao-imprimir"
              data-testid="form-meta"
              @submit.prevent="gravarMeta"
            >
              <h3 class="grade__titulo">
                {{ vigentes.length ? t('nutricao.terapia.outraVia') : t('nutricao.terapia.novaMeta') }}
              </h3>
              <SanteSelecao v-model="via" :rotulo="t('nutricao.terapia.via')" :opcoes="vias" />
              <SanteSelecao v-model="itemDieta" :rotulo="t('nutricao.terapia.dieta')" :opcoes="dietas" />
              <div class="campo">
                <label for="meta-peso">{{ t('nutricao.terapia.peso') }}</label>
                <input
                  id="meta-peso"
                  v-model.number="peso"
                  type="number"
                  min="1"
                  max="400"
                  step="0.1"
                  required
                />
              </div>
              <div class="campo">
                <label for="meta-kcal">{{ t('nutricao.terapia.kcalKg') }}</label>
                <input
                  id="meta-kcal"
                  v-model.number="kcalKg"
                  type="number"
                  min="10"
                  max="50"
                  step="0.5"
                  required
                />
              </div>
              <div class="campo">
                <label for="meta-ptn">{{ t('nutricao.terapia.ptnKg') }}</label>
                <input
                  id="meta-ptn"
                  v-model.number="ptnKg"
                  type="number"
                  min="0.5"
                  max="3"
                  step="0.1"
                  required
                />
              </div>
              <div class="campo">
                <label for="meta-dens">{{ t('nutricao.terapia.densidade') }}</label>
                <input
                  id="meta-dens"
                  v-model.number="densidade"
                  type="number"
                  min="0.5"
                  max="3"
                  step="0.05"
                  required
                />
              </div>
              <div class="campo">
                <label for="meta-ptnl">{{ t('nutricao.terapia.ptnL') }}</label>
                <input id="meta-ptnl" v-model.number="ptnL" type="number" min="0" max="150" step="0.5" />
              </div>
              <SanteCampoTexto v-model="obsMeta" :rotulo="t('nutricao.observacao')" :max-bytes="500" />
              <SanteBotao
                tipo="submit"
                :rotulo="
                  vigentes.length ? t('nutricao.terapia.registrarOutraVia') : t('nutricao.terapia.novaMeta')
                "
                :desabilitado="ocupado"
                data-testid="meta-gravar"
              />
            </form>
            <p v-else-if="motivoPode && !pode" class="secundario">{{ motivoPode }}</p>
            <template v-if="temInativa">
              <h3 id="terapia-versoes-titulo">{{ t('nutricao.terapia.versoes') }}</h3>
              <ul
                class="lista-simples"
                aria-labelledby="terapia-versoes-titulo"
                data-testid="terapia-versoes"
              >
                <li
                  v-for="m in terapia.data.value.metas"
                  :key="m.id"
                  :class="{ inativo: m.situacao !== 'vigente' }"
                  :data-situacao="m.situacao"
                >
                  <strong>{{ t(`nutricao.terapia.situacoesMeta.${m.situacao}`) }}</strong> ·
                  {{ t(`nutricao.terapia.vias.${m.via}`) }} ·
                  {{
                    t('nutricao.terapia.versaoLinha', {
                      kcal: num(m.metaKcal),
                      ptn: num(m.metaProteinaG),
                      em: instanteCurto(m.em),
                      por: m.por,
                    })
                  }}
                  <span v-if="m.correcao" class="secundario">
                    ·
                    {{
                      correcaoTexto(m.correcao, m.situacao === 'encerrada' ? 'encerrada' : 'substituida')
                    }}</span
                  >
                </li>
              </ul>
            </template>
          </section>
        </div>

        <!-- Progresso e balanço -->
        <div
          v-show="aba === 'progresso'"
          id="terapia-painel-progresso"
          class="painel-aba"
          role="tabpanel"
          aria-labelledby="terapia-aba-progresso"
        >
          <section class="painel" aria-labelledby="terapia-progresso">
            <h2 id="terapia-progresso">{{ t('nutricao.terapia.progresso') }}</h2>
            <p v-if="terapia.data.value.progresso.length === 0">{{ t('nutricao.terapia.semProgresso') }}</p>
            <table v-else class="tabela-progresso" data-testid="terapia-progresso">
              <caption>
                {{
                  t('nutricao.terapia.progressoLegenda')
                }}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{{ t('nutricao.terapia.colDia') }}</th>
                  <th scope="col">{{ t('nutricao.terapia.colKcal') }}</th>
                  <th scope="col">{{ t('nutricao.terapia.colPtn') }}</th>
                  <th scope="col">{{ t('nutricao.terapia.colAcumulado') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in terapia.data.value.progresso"
                  :key="p.data"
                  :class="{ abaixo: p.abaixoDoAdequado }"
                >
                  <th scope="row">{{ dataLonga(p.data) }}</th>
                  <td>
                    {{
                      t('nutricao.terapia.parcela', {
                        a: num(p.kcalAtingida),
                        m: num(p.kcalMeta),
                        p: num(p.pctKcal),
                      })
                    }}
                    <span
                      v-if="p.vias.length > 1"
                      class="parcelas-vias"
                      :data-testid="`progresso-vias-${p.data}`"
                    >
                      {{
                        p.vias
                          .map((v) =>
                            t('nutricao.terapia.parcelaVia', {
                              via: t(`nutricao.terapia.vias.${v.via}`),
                              a: num(v.kcalAtingida),
                              m: num(v.kcalMeta),
                            }),
                          )
                          .join(' + ')
                      }}
                    </span>
                  </td>
                  <td>
                    {{
                      t('nutricao.terapia.parcela', {
                        a: num(p.ptnAtingidaG),
                        m: num(p.ptnMetaG),
                        p: num(p.pctProteina),
                      })
                    }}
                    <span v-if="p.vias.length > 1" class="parcelas-vias">
                      {{
                        p.vias
                          .map((v) =>
                            t('nutricao.terapia.parcelaVia', {
                              via: t(`nutricao.terapia.vias.${v.via}`),
                              a: num(v.ptnAtingidaG),
                              m: num(v.ptnMetaG),
                            }),
                          )
                          .join(' + ')
                      }}
                    </span>
                  </td>
                  <td>
                    {{
                      t('nutricao.terapia.parcela', {
                        a: num(p.acumuladoKcalAtingida),
                        m: num(p.acumuladoKcalMeta),
                        p: num(p.acumuladoPctKcal),
                      })
                    }}
                    ·
                    {{
                      t('nutricao.terapia.parcela', {
                        a: num(p.acumuladoPtnAtingidaG),
                        m: num(p.acumuladoPtnMetaG),
                        p: num(p.acumuladoPctProteina),
                      })
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
          <section class="painel" aria-labelledby="terapia-balanco-titulo">
            <h2 id="terapia-balanco-titulo">{{ t('nutricao.terapia.balanco') }}</h2>
            <p v-if="terapia.data.value.balanco.length === 0" class="secundario">
              {{ t('nutricao.terapia.semBalanco') }}
            </p>
            <ul v-else class="lista-simples" data-testid="terapia-balanco">
              <li v-for="b in terapia.data.value.balanco" :key="b.data">
                {{
                  t('nutricao.terapia.balancoLinha', {
                    data: dataLonga(b.data),
                    vol: num(b.volumeMl),
                    n: b.lancamentos,
                  })
                }}
              </li>
            </ul>
          </section>
          <section class="painel" aria-labelledby="terapia-checagens">
            <h2 id="terapia-checagens">{{ t('nutricao.terapia.checagens') }}</h2>
            <ul class="lista-simples" data-testid="terapia-checagens">
              <li v-for="c in terapia.data.value.checagens" :key="c.data">
                {{
                  t('nutricao.terapia.checagem', {
                    data: dataLonga(c.data),
                    adm: c.horariosAdministrados,
                    prev: c.horariosPrevistos,
                    vol:
                      c.volumeMl === null
                        ? t('nutricao.terapia.semVolume')
                        : t('nutricao.terapia.volume', { n: c.volumeMl }),
                  })
                }}
              </li>
            </ul>
          </section>
        </div>

        <!-- Acompanhamento -->
        <div
          v-show="aba === 'acompanhamento'"
          id="terapia-painel-acompanhamento"
          class="painel-aba"
          role="tabpanel"
          aria-labelledby="terapia-aba-acompanhamento"
        >
          <section class="painel" aria-labelledby="terapia-dia">
            <h2 id="terapia-dia">{{ t('nutricao.terapia.acompanhamento') }}</h2>
            <p class="secundario">
              {{ t('nutricao.terapia.adequada', { pct: terapia.data.value.metaAdequadaPct }) }}
            </p>
            <p v-if="!meta" class="secundario" data-testid="terapia-dia-sem-meta">
              {{ t('nutricao.terapia.diaSemMeta') }}
            </p>
            <form
              v-else-if="pode"
              class="grade nao-imprimir"
              data-testid="form-acompanhamento"
              @submit.prevent="gravarDia"
            >
              <SanteSelecao
                v-if="vigentes.length > 1"
                v-model="metaDia"
                :rotulo="t('nutricao.terapia.metaDoDia')"
                :opcoes="opcoesMetaDia"
                data-testid="acompanhamento-meta"
              />
              <SanteData v-model="dia" :rotulo="t('nutricao.terapia.data')" editavel />
              <div class="campo">
                <label for="dia-volume">{{ t('nutricao.terapia.volumeInformado') }}</label>
                <input id="dia-volume" v-model.number="volume" type="number" min="0" max="10000" />
              </div>
              <SanteSelecao v-model="motivo" :rotulo="t('nutricao.terapia.motivo')" :opcoes="motivos" />
              <SanteCampoTexto v-model="obsDia" :rotulo="t('nutricao.observacao')" :max-bytes="500" />
              <SanteBotao
                tipo="submit"
                :rotulo="t('nutricao.terapia.registrar')"
                :desabilitado="ocupado || !dia"
                data-testid="acompanhamento-gravar"
              />
            </form>
          </section>
          <section class="painel" aria-labelledby="terapia-historico-titulo">
            <h2 id="terapia-historico-titulo">{{ t('nutricao.terapia.historico') }}</h2>
            <p class="nota-correcao nao-imprimir">{{ t('nutricao.correcao.soAutor') }}</p>
            <p v-if="terapia.data.value.acompanhamentos.length === 0" class="secundario">
              {{ t('nutricao.terapia.semAcompanhamentos') }}
            </p>
            <ul v-else class="lista-simples" data-testid="terapia-acompanhamentos">
              <li
                v-for="a in terapia.data.value.acompanhamentos"
                :key="a.id"
                :class="{ inativo: a.situacao !== 'ativo' }"
                :data-situacao="a.situacao"
                :data-testid="`acompanhamento-${a.id}`"
              >
                <strong v-if="a.situacao !== 'ativo'"
                  >{{ t(`nutricao.terapia.situacoes.${a.situacao}`) }} ·
                </strong>
                {{
                  t('nutricao.terapia.linha', {
                    data: dataLonga(a.data),
                    vol: a.volumeInfundidoMl,
                    origem: t(`nutricao.terapia.origens.${a.origemVolume}`),
                    kcal: percentual(a.pctKcal).replace('%', ''),
                    ptn: percentual(a.pctProteina).replace('%', ''),
                  })
                }}
                <span class="secundario"> · {{ a.por }}</span>
                <span v-if="a.motivo" class="secundario">
                  · {{ t(`nutricao.terapia.motivos.${a.motivo}`) }}</span
                >
                <span v-if="a.correcao" class="secundario">
                  ·
                  {{
                    correcaoTexto(a.correcao, a.situacao === 'estornado' ? 'estornado' : 'retificado')
                  }}</span
                >
                <span v-if="pode && a.situacao === 'ativo' && doAutor(a)" class="acoes-linha nao-imprimir">
                  <SanteBotao
                    v-if="a.origemVolume === 'informado'"
                    :rotulo="t('nutricao.terapia.retificar')"
                    variante="texto"
                    data-testid="acompanhamento-retificar"
                    @acionar="abrir({ tipo: 'retificar', id: a.id })"
                  />
                  <SanteBotao
                    :rotulo="t('nutricao.terapia.estornar')"
                    variante="texto"
                    data-testid="acompanhamento-estornar"
                    @acionar="abrir({ tipo: 'estornar', id: a.id })"
                  />
                </span>
              </li>
            </ul>
          </section>
        </div>
        <DialogoCorrecao
          v-model:visivel="dialogo"
          :titulo="tituloAcao"
          :texto="textoAcao"
          :confirmar="tituloAcao"
          :rotulo-motivo="acao?.tipo === 'npt' ? t('nutricao.terapia.nptJustificativa') : undefined"
          :incompleto="incompleto"
          :gravar="gravarAcao"
          @feito="feitoAcao"
        >
          <div v-if="acao?.tipo === 'alterar-meta'" class="grade">
            <SanteSelecao v-model="itemDieta" :rotulo="t('nutricao.terapia.dieta')" :opcoes="dietas" />
            <div class="campo">
              <label for="alt-peso">{{ t('nutricao.terapia.peso') }}</label>
              <input
                id="alt-peso"
                v-model.number="peso"
                type="number"
                min="1"
                max="400"
                step="0.1"
                required
              />
            </div>
            <div class="campo">
              <label for="alt-kcal">{{ t('nutricao.terapia.kcalKg') }}</label>
              <input
                id="alt-kcal"
                v-model.number="kcalKg"
                type="number"
                min="10"
                max="50"
                step="0.5"
                required
              />
            </div>
            <div class="campo">
              <label for="alt-ptn">{{ t('nutricao.terapia.ptnKg') }}</label>
              <input
                id="alt-ptn"
                v-model.number="ptnKg"
                type="number"
                min="0.5"
                max="3"
                step="0.1"
                required
              />
            </div>
            <div class="campo">
              <label for="alt-dens">{{ t('nutricao.terapia.densidade') }}</label>
              <input
                id="alt-dens"
                v-model.number="densidade"
                type="number"
                min="0.5"
                max="3"
                step="0.05"
                required
              />
            </div>
            <div class="campo">
              <label for="alt-ptnl">{{ t('nutricao.terapia.ptnL') }}</label>
              <input id="alt-ptnl" v-model.number="ptnL" type="number" min="0" max="150" step="0.5" />
            </div>
          </div>
          <div v-if="acao?.tipo === 'retificar'" class="grade">
            <div class="campo">
              <label for="ret-volume">{{ t('nutricao.terapia.volumeInformado') }}</label>
              <input
                id="ret-volume"
                v-model.number="nVolume"
                type="number"
                min="0"
                max="10000"
                required
                data-testid="retificar-volume"
              />
            </div>
            <SanteSelecao v-model="nMotivoMeta" :rotulo="t('nutricao.terapia.motivo')" :opcoes="motivos" />
          </div>
          <div v-if="acao?.tipo === 'npt'" class="grade">
            <SanteSelecao
              v-model="parecer"
              :rotulo="t('nutricao.terapia.nptParecer')"
              :opcoes="pareceres"
              data-testid="npt-parecer"
            />
            <SanteSelecao
              v-model="acesso"
              :rotulo="t('nutricao.terapia.nptAcesso')"
              :opcoes="acessos"
              data-testid="npt-acesso"
            />
            <div class="campo">
              <label for="npt-osm">{{ t('nutricao.terapia.nptOsm') }}</label>
              <input
                id="npt-osm"
                v-model.number="osm"
                type="number"
                min="1"
                max="5000"
                required
                data-testid="npt-osm"
              />
            </div>
            <label class="marca"
              ><input v-model="estab" type="checkbox" /> {{ t('nutricao.terapia.nptEstabilidade') }}</label
            >
            <label class="marca"
              ><input v-model="compat" type="checkbox" />
              {{ t('nutricao.terapia.nptCompatibilidade') }}</label
            >
            <SanteCampoTexto
              v-model="obsNpt"
              :rotulo="t('nutricao.terapia.nptObservacao')"
              :max-bytes="500"
              :obrigatorio="parecer !== 'adequada'"
              data-testid="npt-observacao"
            />
          </div>
        </DialogoCorrecao>
      </template>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-correcao.css"></style>
<style scoped>
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.campo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.campo label {
  font-weight: 600;
}
.campo input {
  font: inherit;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 6px;
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
}
.lista-simples {
  margin: 0;
  padding-inline-start: var(--sgh-espaco-3);
}
.inativo {
  color: var(--sgh-texto-secundario);
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}
.inativo strong,
.inativo .secundario {
  text-decoration: none;
}
.acoes-linha {
  display: inline-flex;
  gap: var(--sgh-espaco-1);
  margin-inline-start: var(--sgh-espaco-2);
}
.tabela-progresso {
  border-collapse: collapse;
  width: 100%;
}
.tabela-progresso th,
.tabela-progresso td {
  text-align: start;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.tabela-progresso tr.abaixo td {
  color: var(--sgh-aviso-texto, var(--sgh-texto));
  font-weight: 600;
}
.marca {
  display: flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
.grade__titulo {
  grid-column: 1 / -1;
  margin: 0;
}
.parcelas-vias {
  display: block;
  font-size: var(--sgh-fonte-pequena);
  color: var(--sgh-texto-secundario);
}
</style>
