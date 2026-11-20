<script setup lang="ts">
// Índices de gravidade da UTI (ficha do M45, seção 7; regra 5): a UTI com o último APACHE II e SOFA de cada paciente;
// o paciente com o registro do índice pelo pior valor das primeiras 24 horas (as variáveis e os itens de Glasgow da
// configuração do estabelecimento; a prévia com as parcelas e a equação da mortalidade pelo mesmo motor do servidor), a
// validação médica com a senha e a razão de mortalidade padronizada do período com as parcelas. SAPS 3 aguarda a DP-20.
import {
  type IndiceUti,
  ROTULOS_INDICE_UTI,
  ROTULOS_TIPO_ADMISSAO,
  type TipoAdmissaoUti,
  TIPOS_ADMISSAO_UTI,
} from '@sgh/contratos';
import {
  calcularApache2,
  calcularSofa,
  categoriasDoTipo,
  glasgowDoIndice,
  variaveisDoIndice,
} from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  estornarIndiceUti,
  lerIndicesDoPaciente,
  lerPacientesUti,
  lerSmr,
  lerUnidadesUti,
  registrarIndiceUti,
  validarIndiceUti,
} from '../api-escores.js';
import DialogoCorrecao, { type DadosCorrecao } from '../componentes/DialogoCorrecao.vue';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';

const props = withDefaults(defineProps<{ atendimento?: string }>(), { atendimento: '' });
const { t } = useI18n();
const router = useRouter();
const at = computed(() => Number(props.atendimento) || null);

const LEMBRAR = 'sgh.uti.unidade';
const lembrada = () => {
  try {
    return globalThis.localStorage?.getItem(LEMBRAR) ?? '';
  } catch {
    return '';
  }
};
const unidade = ref(lembrada());
const unidades = useQuery({
  queryKey: ['uti', 'unidades'],
  queryFn: () => lerUnidadesUti(),
  staleTime: 300_000,
});
watch(
  () => unidades.data.value,
  (us) => {
    if (us && us.length && !us.some((u) => u.unidade === unidade.value))
      unidade.value = (us.find((u) => /UTI|CTI/i.test(`${u.unidade} ${u.nome}`)) ?? us[0]!).unidade;
  },
  { immediate: true },
);
watch(unidade, (u) => {
  try {
    globalThis.localStorage?.setItem(LEMBRAR, u);
  } catch {
    // sem o armazenamento do navegador, a escolha vale só nesta tela
  }
});
const opcoesUnidade = computed(() =>
  (unidades.data.value ?? []).map((u) => ({ valor: u.unidade, rotulo: `${u.nome} (${u.internados})` })),
);
const pacientes = useQuery({
  queryKey: computed(() => ['uti', 'pacientes', unidade.value]),
  queryFn: () => lerPacientesUti(unidade.value),
  enabled: computed(() => !!unidade.value && !at.value),
});
const detalhe = useQuery({
  queryKey: computed(() => ['uti', 'indices', at.value]),
  queryFn: () => lerIndicesDoPaciente(at.value!),
  enabled: computed(() => !!at.value),
});
const cfg = computed(() => detalhe.data.value?.configuracao ?? null);

// ── O registro do índice ────────────────────────────────────────────────────────────────────────
const indice = ref<IndiceUti>('apache2');
const opcoesIndice = (['apache2', 'sofa'] as IndiceUti[]).map((i) => ({
  valor: i,
  rotulo: ROTULOS_INDICE_UTI[i],
}));
const coletadoEm = ref('');
const valores = reactive<Record<string, string>>({});
const glasgow = reactive<{ ocular: number | null; verbal: number | null; motora: number | null }>({
  ocular: null,
  verbal: null,
  motora: null,
});
const idade = ref<number | null>(null);
const tipoAdmissao = ref<TipoAdmissaoUti>('nao-cirurgico');
const categoria = ref<number | null>(null);
const cronica = ref(false);
const falhaRenal = ref(false);
watch(indice, () => {
  for (const k of Object.keys(valores)) delete valores[k];
  glasgow.ocular = glasgow.verbal = glasgow.motora = null;
});
watch(tipoAdmissao, () => (categoria.value = null));

/** As variáveis da tela por índice (as siglas da configuração; o SOFA respiratório pede PaO2 e FiO2). */
const camposDoIndice = computed(() => {
  const c = cfg.value;
  if (!c) return [] as { sigla: string; nome: string }[];
  if (indice.value === 'apache2') {
    const vs = variaveisDoIndice(c, 'apache2');
    const n = (s: string, padrao: string) => vs.get(s)?.nome ?? padrao;
    return [
      { sigla: 'TEMP', nome: `${n('TEMP', 'Temperatura')} (°C)` },
      { sigla: 'PAS', nome: `${n('PAS', 'PAS')} (mmHg)` },
      { sigla: 'PAD', nome: `${n('PAD', 'PAD')} (mmHg)` },
      { sigla: 'FC', nome: `${n('FC', 'FC')} (bpm)` },
      { sigla: 'FR', nome: `${n('FR', 'FR')} (irpm)` },
      { sigla: 'FIO2', nome: `${n('FIO2', 'FiO2')} (0,21 a 1)` },
      { sigla: 'PAO2', nome: `${n('PAO2', 'PaO2')} (mmHg)` },
      { sigla: 'PACO2', nome: `${n('PACO2', 'PaCO2')} (mmHg)` },
      { sigla: 'PH', nome: n('PH', 'pH arterial') },
      { sigla: 'HCO3', nome: `${n('HCO3', 'HCO3')} (mEq/L)` },
      { sigla: 'NASERICO', nome: `${n('NASERICO', 'Sódio')} (mEq/L)` },
      { sigla: 'KSERICO', nome: `${n('KSERICO', 'Potássio')} (mEq/L)` },
      { sigla: 'CREATININA', nome: 'Creatinina (mg/dL)' },
      { sigla: 'HEMATOCRITO', nome: `${n('HEMATOCRITO', 'Hematócrito')} (%)` },
      { sigla: 'LEUCOCITO', nome: `${n('LEUCOCITO', 'Leucócitos')} (/mm³)` },
    ];
  }
  const vs = variaveisDoIndice(c, 'sofa');
  const n = (s: string, padrao: string) => vs.get(s)?.nome ?? padrao;
  return [
    { sigla: 'PAO2', nome: 'PaO2 (mmHg)' },
    { sigla: 'FIO2', nome: 'FiO2 (0,21 a 1)' },
    { sigla: 'PLAQUETAS', nome: `${n('PLAQUETAS', 'Plaquetas')} (×10³/µL)` },
    { sigla: 'BILIRRUBINA', nome: `${n('BILIRRUBINA', 'Bilirrubina')} (mg/dL)` },
    { sigla: 'PAM', nome: `${n('PAM', 'PAM')} (mmHg)` },
    { sigla: 'DOPAMINA', nome: `${n('DOPAMINA', 'Dopamina')} (µg/kg/min)` },
    { sigla: 'DOBUTAMINA', nome: `${n('DOBUTAMINA', 'Dobutamina')} (µg/kg/min)` },
    { sigla: 'EPI_NORA', nome: `${n('EPI_NORA', 'Adrenalina ou noradrenalina')} (µg/kg/min)` },
    { sigla: 'CREATININA', nome: `${n('CREATININA', 'Creatinina')} (mg/dL)` },
    { sigla: 'DEBURINARIO', nome: `${n('DEBURINARIO', 'Débito urinário')} (mL/dia)` },
  ];
});
const itensGlasgow = computed(() => (cfg.value ? glasgowDoIndice(cfg.value, indice.value) : []));
const chaveGlasgow = (k: number) => (['ocular', 'verbal', 'motora'] as const)[k]!;
const opcoesCategoria = computed(() =>
  cfg.value
    ? categoriasDoTipo(cfg.value, tipoAdmissao.value).map((c) => ({
        valor: c.id as number | null,
        rotulo: `${c.nome} (${c.grupo})`,
      }))
    : [],
);
const opcoesTipo = TIPOS_ADMISSAO_UTI.map((x) => ({ valor: x, rotulo: ROTULOS_TIPO_ADMISSAO[x] }));
const variaveis = computed(() => {
  const r: Record<string, number | null> = {};
  for (const c of camposDoIndice.value) {
    const v = (valores[c.sigla] ?? '').trim().replace(',', '.');
    r[c.sigla] = v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
  }
  return r;
});
const glasgowCompleto = computed(
  () => glasgow.ocular !== null && glasgow.verbal !== null && glasgow.motora !== null,
);
const previa = computed(() => {
  const c = cfg.value;
  if (!c || !glasgowCompleto.value) return null;
  const g = { ocular: glasgow.ocular!, verbal: glasgow.verbal!, motora: glasgow.motora! };
  if (indice.value === 'sofa') return calcularSofa(c, { variaveis: variaveis.value, glasgow: g });
  if (!idade.value || !categoria.value) return null;
  return calcularApache2(c, {
    variaveis: variaveis.value,
    glasgow: g,
    idade: idade.value,
    tipoAdmissao: tipoAdmissao.value,
    categoria: categoria.value,
    insuficienciaCronica: cronica.value,
    falhaRenalAguda: falhaRenal.value,
  });
});

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function registrar(): Promise<void> {
  const d = detalhe.data.value;
  if (!d || !previa.value || !previa.value.ok) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await registrarIndiceUti({
      paciente: d.paciente,
      atendimento: d.atendimento,
      reg: d.reg,
      unidade: d.unidade,
      indice: indice.value,
      coletadoEm: coletadoEm.value,
      variaveis: variaveis.value,
      glasgow: { ocular: glasgow.ocular, verbal: glasgow.verbal, motora: glasgow.motora },
      ...(indice.value === 'apache2'
        ? {
            apache: {
              idade: idade.value,
              tipoAdmissao: tipoAdmissao.value,
              categoria: categoria.value,
              insuficienciaCronica: cronica.value,
              falhaRenalAguda: falhaRenal.value,
            },
          }
        : {}),
    });
    mensagem.value = r.mensagem;
    await detalhe.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Validação médica ────────────────────────────────────────────────────────────────────────────
const validando = ref<number | null>(null);
const senha = ref('');
const abertoValidar = ref(false);
function abrirValidar(id: number): void {
  validando.value = id;
  senha.value = '';
  erro.value = null;
  abertoValidar.value = true;
}
async function validar(): Promise<void> {
  if (!validando.value) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await validarIndiceUti(validando.value, senha.value);
    mensagem.value = r.mensagem;
    abertoValidar.value = false;
    await detalhe.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── W0-03: estornar ou invalidar o índice (inativo e visível; sai da SMR) ────────────────────────
const estornando = ref<number | null>(null);
const dialogoEstorno = ref(false);
function abrirEstorno(id: number): void {
  estornando.value = id;
  dialogoEstorno.value = true;
}
async function estornar(d: DadosCorrecao): Promise<void> {
  const id = estornando.value;
  if (id === null) return;
  const r = await estornarIndiceUti(id, { tipo: d.tipo, motivo: d.motivo });
  mensagem.value = r.mensagem;
  await detalhe.refetch();
}

// ── SMR ─────────────────────────────────────────────────────────────────────────────────────────
const smrDe = ref('');
const smrAte = ref('');
const smr = ref<Awaited<ReturnType<typeof lerSmr>> | null>(null);
async function calcularSmrTela(): Promise<void> {
  erro.value = null;
  try {
    smr.value = await lerSmr(smrDe.value, smrAte.value);
  } catch (x) {
    erro.value = x;
  }
}

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1).replace('.', ',')}%`);
const hora = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');
watch(
  () => detalhe.data.value,
  (d) => {
    if (d && !coletadoEm.value) {
      const n = new Date();
      const p2 = (x: number) => String(x).padStart(2, '0');
      coletadoEm.value = `${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())}T${p2(n.getHours())}:${p2(n.getMinutes())}`;
      const hoje = coletadoEm.value.slice(0, 10);
      smrAte.value = hoje;
      smrDe.value = `${hoje.slice(0, 8)}01`;
    }
  },
);
</script>

<template>
  <section class="tela-enf" aria-labelledby="ui-titulo" data-testid="tela-indices-uti">
    <h1 id="ui-titulo">{{ t('enfermagem.indices.titulo') }}</h1>
    <p>{{ t('enfermagem.indices.texto') }}</p>
    <p v-if="mensagem" role="status" data-testid="ui-mensagem">{{ mensagem }}</p>
    <ErroEnfermagem v-if="erro" :erro="erro" />

    <template v-if="!at">
      <div class="barra">
        <SanteSelecao
          v-model="unidade"
          :rotulo="t('enfermagem.indices.unidade')"
          :opcoes="opcoesUnidade"
          data-testid="ui-unidade"
        />
      </div>
      <ErroEnfermagem v-if="pacientes.isError.value" :erro="pacientes.error.value" />
      <p v-else-if="!pacientes.data.value" role="status">{{ t('enfermagem.comum.carregando') }}</p>
      <div v-else class="rolagem">
        <table class="grade" data-testid="ui-pacientes">
          <thead>
            <tr>
              <th scope="col">{{ t('enfermagem.escores.leito') }}</th>
              <th scope="col">{{ t('enfermagem.escores.paciente') }}</th>
              <th scope="col">{{ ROTULOS_INDICE_UTI.apache2 }}</th>
              <th scope="col">{{ ROTULOS_INDICE_UTI.sofa }}</th>
              <th scope="col">{{ t('enfermagem.comum.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in pacientes.data.value.pacientes"
              :key="p.paciente"
              :data-testid="`ui-linha-${p.paciente}`"
            >
              <td>{{ p.leito }}</td>
              <td>{{ p.nome }}</td>
              <td>
                <template v-if="p.apache2"
                  >{{ p.apache2.pontuacao }} · {{ pct(p.apache2.mortalidade) }} ·
                  {{ p.apache2.situacao }}</template
                >
                <template v-else>{{ t('enfermagem.indices.semIndice') }}</template>
              </td>
              <td>
                <template v-if="p.sofa">{{ p.sofa.pontuacao }} · {{ p.sofa.situacao }}</template>
                <template v-else>{{ t('enfermagem.indices.semIndice') }}</template>
              </td>
              <td>
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('enfermagem.indices.abrir', { nome: p.leito })"
                  :data-testid="`ui-abrir-${p.paciente}`"
                  @acionar="router.push(`/pep/uti/indices/${p.atendimento}`)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <SanteBotao
        variante="texto"
        :rotulo="t('enfermagem.escores.voltar')"
        @acionar="router.push('/pep/uti/indices')"
      />
      <ErroEnfermagem v-if="detalhe.isError.value" :erro="detalhe.error.value" />
      <p v-else-if="!detalhe.data.value" role="status">{{ t('enfermagem.comum.carregando') }}</p>
      <template v-else>
        <h2 data-testid="ui-paciente">{{ detalhe.data.value.leito }} · {{ detalhe.data.value.nome }}</h2>
        <SanteAlerta
          v-if="!detalhe.data.value.gravacao.ligada"
          variante="aviso"
          :texto="detalhe.data.value.gravacao.motivo ?? ''"
        />
        <SanteAlerta variante="info" :texto="detalhe.data.value.saps3.motivo" data-testid="ui-saps3" />
        <p>
          <RouterLink
            to="/consultas/item/pep.indices-de-gravidade-de-uti-apache-ii-sofa-saps-3"
            data-testid="ui-configuracao"
            >{{ t('enfermagem.indices.configuracao') }}</RouterLink
          >
        </p>

        <form class="cartao" data-testid="ui-form" @submit.prevent="registrar">
          <div class="campos">
            <SanteSelecao
              v-model="indice"
              :rotulo="t('enfermagem.indices.indice')"
              :opcoes="opcoesIndice"
              data-testid="ui-indice"
            />
            <span class="campo">
              <label for="ui-coleta">{{ t('enfermagem.indices.coletadoEm') }}</label>
              <input id="ui-coleta" v-model="coletadoEm" type="datetime-local" data-testid="ui-coleta" />
            </span>
          </div>
          <div class="campos">
            <span v-for="c in camposDoIndice" :key="`${indice}-${c.sigla}`" class="campo">
              <label :for="`ui-v-${c.sigla}`">{{ c.nome }}</label>
              <input
                :id="`ui-v-${c.sigla}`"
                v-model="valores[c.sigla]"
                inputmode="decimal"
                :data-testid="`ui-v-${c.sigla}`"
              />
            </span>
          </div>
          <div class="campos">
            <SanteSelecao
              v-for="(g, k) in itensGlasgow"
              :key="`${indice}-g-${g.variavel.id}`"
              :model-value="glasgow[chaveGlasgow(k)]"
              :rotulo="`${t('enfermagem.indices.glasgow')}: ${g.variavel.nome}`"
              :opcoes="[
                { valor: null, rotulo: '—' },
                ...g.itens.map((i) => ({ valor: i.id as number | null, rotulo: i.nome })),
              ]"
              :data-testid="`ui-glasgow-${chaveGlasgow(k)}`"
              @update:model-value="glasgow[chaveGlasgow(k)] = $event as number | null"
            />
          </div>
          <div v-if="indice === 'apache2'" class="campos">
            <span class="campo">
              <label for="ui-idade">{{ t('enfermagem.indices.idade') }}</label>
              <input
                id="ui-idade"
                v-model.number="idade"
                type="number"
                min="16"
                max="120"
                data-testid="ui-idade"
              />
            </span>
            <SanteSelecao
              v-model="tipoAdmissao"
              :rotulo="t('enfermagem.indices.tipoAdmissao')"
              :opcoes="opcoesTipo"
              data-testid="ui-tipo"
            />
            <SanteSelecao
              v-model="categoria"
              :rotulo="t('enfermagem.indices.categoria')"
              :opcoes="[{ valor: null, rotulo: '—' }, ...opcoesCategoria]"
              :busca="true"
              data-testid="ui-categoria"
            />
            <label class="linha"
              ><input v-model="cronica" type="checkbox" data-testid="ui-cronica" />
              {{ t('enfermagem.indices.cronica') }}</label
            >
            <label class="linha"
              ><input v-model="falhaRenal" type="checkbox" data-testid="ui-falha-renal" />
              {{ t('enfermagem.indices.falhaRenal') }}</label
            >
          </div>
          <template v-if="previa && previa.ok">
            <p role="status" data-testid="ui-previa">
              {{ t('enfermagem.indices.previa', { pontuacao: previa.pontuacao }) }}
              <template v-if="previa.mortalidade !== null">
                ·
                {{
                  t('enfermagem.indices.mortalidade', { valor: pct(previa.mortalidade).replace('%', '') })
                }}</template
              >
            </p>
            <p v-if="previa.equacao" class="secundario" data-testid="ui-equacao">{{ previa.equacao }}</p>
            <ul v-if="previa.avisos.length" class="secundario">
              <li v-for="(a, k) in previa.avisos" :key="k">{{ a }}</li>
            </ul>
            <details>
              <summary>{{ t('enfermagem.indices.parcela') }}</summary>
              <table class="grade" data-testid="ui-parcelas">
                <thead>
                  <tr>
                    <th scope="col">{{ t('enfermagem.indices.parcela') }}</th>
                    <th scope="col">{{ t('enfermagem.indices.valor') }}</th>
                    <th scope="col">{{ t('enfermagem.indices.pontos') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(p, k) in previa.parcelas" :key="k">
                    <td>{{ p.grupo }} · {{ p.nome }}</td>
                    <td>{{ p.valor ?? '—' }}</td>
                    <td>{{ p.pontos }}</td>
                  </tr>
                </tbody>
              </table>
            </details>
          </template>
          <p v-else-if="previa && !previa.ok" class="alerta">{{ previa.mensagem }}</p>
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.indices.registrar')"
            :desabilitado="
              !detalhe.data.value.gravacao.registrar || !previa || !previa.ok || !coletadoEm || ocupado
            "
            data-testid="ui-registrar"
          />
        </form>

        <section class="cartao" aria-labelledby="ui-hist">
          <h3 id="ui-hist">{{ t('enfermagem.indices.historico') }}</h3>
          <p v-if="detalhe.data.value.indices.length === 0">{{ t('enfermagem.indices.vazio') }}</p>
          <ul v-else data-testid="ui-indices">
            <li
              v-for="i in detalhe.data.value.indices"
              :key="i.id"
              :class="{ inativo: !!i.estorno }"
              :data-testid="`ui-ind-${i.id}`"
              :data-inativo="i.estorno ? 'sim' : 'nao'"
            >
              <component :is="i.estorno ? 's' : 'span'"
                >{{ hora(i.coletadoEm) }} · {{ ROTULOS_INDICE_UTI[i.indice] }} {{ i.pontuacao }}
                <template v-if="i.mortalidade !== null"> · {{ pct(i.mortalidade) }}</template></component
              >
              <template v-if="i.estorno">
                · <strong>{{ t('enfermagem.correcao.inativo') }}</strong> ·
                {{
                  t('enfermagem.correcao.estornadoPor', {
                    tipo: t(`enfermagem.correcao.tipoCurto.${i.estorno.tipo}`),
                    por: i.estorno.usuario,
                    quando: hora(i.estorno.em),
                    motivo: i.estorno.motivo,
                  })
                }}
              </template>
              ·
              <template v-if="i.situacao === 'validado'">{{
                t('enfermagem.indices.validado', { quem: i.validadoPor })
              }}</template>
              <template v-else>{{ t('enfermagem.indices.registrado') }}</template>
              <span v-if="i.configuracaoMudou" class="alerta">
                · {{ t('enfermagem.indices.configMudou') }}</span
              >
              <SanteBotao
                v-if="!i.estorno"
                variante="secundario"
                :rotulo="t('enfermagem.correcao.indice.estornar')"
                :desabilitado="!detalhe.data.value.gravacao.registrar"
                :data-testid="`ui-estornar-${i.id}`"
                @acionar="abrirEstorno(i.id)"
              />
              <SanteBotao
                v-if="i.situacao === 'registrado' && !i.estorno"
                variante="secundario"
                :rotulo="t('enfermagem.indices.validar')"
                :desabilitado="!detalhe.data.value.gravacao.validar"
                :data-testid="`ui-validar-${i.id}`"
                @acionar="abrirValidar(i.id)"
              />
            </li>
          </ul>
          <p v-if="detalhe.data.value.gravacao.motivoValidar" class="secundario">
            {{ detalhe.data.value.gravacao.motivoValidar }}
          </p>
        </section>

        <section class="cartao" aria-labelledby="ui-smr">
          <h3 id="ui-smr">{{ t('enfermagem.indices.smr') }}</h3>
          <div class="barra">
            <span class="campo">
              <label for="ui-smr-de">{{ t('enfermagem.indices.de') }}</label>
              <input id="ui-smr-de" v-model="smrDe" type="date" />
            </span>
            <span class="campo">
              <label for="ui-smr-ate">{{ t('enfermagem.indices.ate') }}</label>
              <input id="ui-smr-ate" v-model="smrAte" type="date" />
            </span>
            <SanteBotao
              variante="secundario"
              :rotulo="t('enfermagem.indices.calcular')"
              data-testid="ui-smr-calcular"
              @acionar="calcularSmrTela"
            />
          </div>
          <template v-if="smr">
            <p data-testid="ui-smr-conta">{{ smr.conta }}</p>
            <p v-if="smr.semDesfecho" class="secundario">
              {{ t('enfermagem.indices.semDesfecho', { n: smr.semDesfecho }) }}
            </p>
          </template>
        </section>
      </template>
    </template>

    <DialogoCorrecao
      v-model:visivel="dialogoEstorno"
      :titulo="t('enfermagem.correcao.indice.titulo')"
      :texto="t('enfermagem.correcao.indice.texto')"
      com-tipo
      testid="ui-dialogo-estorno"
      :executar="estornar"
    />
    <SanteDialogo v-model:visivel="abertoValidar" :titulo="t('enfermagem.indices.validar')">
      <div class="campo" data-testid="ui-dialogo-validar">
        <label for="ui-senha">{{ t('enfermagem.indices.senha') }}</label>
        <input
          id="ui-senha"
          v-model="senha"
          type="password"
          autocomplete="current-password"
          data-testid="ui-senha"
        />
        <ErroEnfermagem v-if="erro" :erro="erro" />
        <SanteBotao
          :rotulo="t('enfermagem.indices.confirmarValidacao')"
          :desabilitado="!senha || ocupado"
          data-testid="ui-confirmar-validacao"
          @acionar="validar"
        />
      </div>
    </SanteDialogo>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.campos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: var(--sgh-espaco-2);
  margin-bottom: var(--sgh-espaco-2);
}
</style>
