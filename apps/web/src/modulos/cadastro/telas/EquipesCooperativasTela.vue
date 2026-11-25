<script setup lang="ts">
// Equipes médicas e cooperativas do profissional (F8, 02-CAD linha 22): `/cadastros/profissionais/equipes`. Uma tela
// com duas abas: as equipes (código, tipo, setor e vigência, com os membros, o papel de cada um e a vigência) e as
// cooperativas médicas (CNPJ, conta para o repasse e alíquotas de retenção, com os cooperados). Com
// `?profissional=:id` (o link da ficha do profissional), mostra só as equipes e cooperativas dele: a visão por
// profissional. O membro é escolhido pela busca por nome (sem lista longa); a saída é o fim da vigência, nada some.
// Validação na hora pelos mesmos códigos do servidor (regra em @sgh/dominio-cadastro, profissional/equipe), que confere
// de novo e acrescenta o que depende do banco (sobreposição, código repetido, responsável duplicado).
import {
  errosCooperativa,
  errosEquipe,
  PAPEIS_MEMBRO_EQUIPE,
  TIPOS_CONTA_COOPERATIVA,
  TIPOS_EQUIPE,
} from '@sgh/dominio-cadastro';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  buscarProfissionais,
  type CooperativaVisao,
  encerrarCooperado,
  encerrarMembro,
  type EquipeVisao,
  incluirCooperado,
  incluirMembro,
  lerEquipes,
  salvarCooperativa,
  salvarEquipe,
  type VinculoVisao,
} from '../api-equipes.js';

const { t } = useI18n();
const rota = useRoute();
const fila = useQueryClient();
const podeEditar = computed(() => pode('cadastro.profissional.editar'));
const profissional = computed(() => {
  const n = Number(rota.query['profissional']);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
});
const visao = useQuery({
  queryKey: computed(() => ['cadastro', 'equipes', profissional.value]),
  queryFn: () => lerEquipes(profissional.value),
});
const aba = ref<'equipes' | 'cooperativas'>('equipes');
const erro = ref<unknown>(null);
const aviso = ref('');

async function rodar(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
  erro.value = null;
  aviso.value = '';
  try {
    await fn();
    aviso.value = ok;
    await fila.invalidateQueries({ queryKey: ['cadastro', 'equipes'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}
const numero = (v: string): number | null => {
  const x = v.trim().replace(',', '.');
  return x === '' ? null : Number(x);
};

// ---------------------------------------------------------------- equipe
const eq = reactive({
  id: null as number | null,
  versao: null as number | null,
  codigo: '',
  nome: '',
  tipo: 'medica',
  setorId: null as number | null,
  inicio: '',
  fim: '',
  ativo: true,
});
const tentouEq = ref(false);
const problemasEq = computed(() =>
  errosEquipe({
    codigo: eq.codigo,
    nome: eq.nome,
    tipo: eq.tipo,
    vigencia: { inicio: eq.inicio || (visao.data.value?.hoje ?? ''), fim: eq.fim || null },
  }),
);
function limparEquipe(): void {
  Object.assign(eq, {
    id: null,
    versao: null,
    codigo: '',
    nome: '',
    tipo: 'medica',
    setorId: null,
    inicio: '',
    fim: '',
    ativo: true,
  });
  tentouEq.value = false;
}
function editarEquipe(x: EquipeVisao): void {
  Object.assign(eq, {
    id: x.id,
    versao: x.versao,
    codigo: x.codigo,
    nome: x.nome,
    tipo: x.tipo,
    setorId: x.setorId,
    inicio: x.inicio,
    fim: x.fim ?? '',
    ativo: x.ativo,
  });
}
async function gravarEquipe(): Promise<void> {
  tentouEq.value = true;
  if (problemasEq.value.length) return;
  const ok = await rodar(
    () =>
      salvarEquipe({
        id: eq.id,
        versao: eq.versao,
        codigo: eq.codigo,
        nome: eq.nome,
        tipo: eq.tipo,
        setorId: eq.setorId,
        inicio: eq.inicio || visao.data.value!.hoje,
        fim: eq.fim || null,
        ativo: eq.ativo,
      }),
    t('equipesCooperativas.gravado'),
  );
  if (ok) limparEquipe();
}

// ---------------------------------------------------------------- vínculo (membro ou cooperado)
const aberta = ref<{ tipo: 'equipe'; x: EquipeVisao } | { tipo: 'cooperativa'; x: CooperativaVisao } | null>(
  null,
);
const vinc = reactive({
  busca: '',
  profissionalId: null as number | null,
  nome: '',
  papel: 'membro',
  inicio: '',
  fim: '',
});
const achados = ref<{ id: number; nome: string }[]>([]);
const fimDe = reactive<Record<number, string>>({});
let espera: ReturnType<typeof setTimeout> | undefined;
watch(
  () => vinc.busca,
  (b) => {
    clearTimeout(espera);
    if (b.trim().length < 3) {
      achados.value = [];
      return;
    }
    espera = setTimeout(async () => {
      try {
        achados.value = await buscarProfissionais(b.trim());
      } catch (e) {
        erro.value = e;
      }
    }, 250);
  },
);
function abrir(a: NonNullable<typeof aberta.value>): void {
  aberta.value = a;
  Object.assign(vinc, { busca: '', profissionalId: null, nome: '', papel: 'membro', inicio: '', fim: '' });
  achados.value = [];
}
function escolher(p: { id: number; nome: string }): void {
  vinc.profissionalId = p.id;
  vinc.nome = p.nome;
  achados.value = [];
  vinc.busca = '';
}
const vinculosAbertos = computed<VinculoVisao[]>(() => {
  const a = aberta.value;
  if (!a) return [];
  const atual =
    a.tipo === 'equipe'
      ? visao.data.value?.equipes.find((q) => q.id === a.x.id)?.membros
      : visao.data.value?.cooperativas.find((q) => q.id === a.x.id)?.cooperados;
  return atual ?? [];
});
async function incluir(): Promise<void> {
  const a = aberta.value;
  if (!a || vinc.profissionalId === null) return;
  const base = {
    profissionalId: vinc.profissionalId,
    inicio: vinc.inicio || visao.data.value!.hoje,
    fim: vinc.fim || null,
  };
  const ok = await rodar(
    () =>
      a.tipo === 'equipe'
        ? incluirMembro(a.x.id, { ...base, papel: vinc.papel })
        : incluirCooperado(a.x.id, base),
    t('equipesCooperativas.incluido'),
  );
  if (ok) Object.assign(vinc, { profissionalId: null, nome: '', inicio: '', fim: '' });
}
async function encerrar(v: VinculoVisao): Promise<void> {
  const a = aberta.value;
  const fim = fimDe[v.id] || visao.data.value?.hoje || '';
  if (!a || !fim) return;
  await rodar(
    () =>
      a.tipo === 'equipe' ? encerrarMembro(v.id, v.versao, fim) : encerrarCooperado(v.id, v.versao, fim),
    t('equipesCooperativas.encerrado'),
  );
}

// ---------------------------------------------------------------- cooperativa
const coopVazia = () => ({
  id: null as number | null,
  versao: null as number | null,
  cnpj: '',
  razaoSocial: '',
  nome: '',
  percentualRepasse: '',
  bancoId: null as number | null,
  agencia: '',
  agenciaDigito: '',
  conta: '',
  contaDigito: '',
  tipoConta: null as string | null,
  retemIr: true,
  aliquotaIr: '',
  aliquotaIss: '',
  aliquotaPis: '',
  aliquotaCofins: '',
  aliquotaCsll: '',
  optanteSimples: false,
  ativo: true,
});
const co = reactive(coopVazia());
const tentouCo = ref(false);
const problemasCo = computed(() =>
  errosCooperativa({
    cnpj: co.cnpj,
    razaoSocial: co.razaoSocial,
    nome: co.nome,
    percentualRepasse: numero(co.percentualRepasse),
    bancoId: co.bancoId,
    agencia: co.agencia.trim() || null,
    conta: co.conta.trim() || null,
    tipoConta: co.tipoConta,
    retemIr: co.retemIr,
    aliquotas: {
      ir: numero(co.aliquotaIr),
      iss: numero(co.aliquotaIss),
      pis: numero(co.aliquotaPis),
      cofins: numero(co.aliquotaCofins),
      csll: numero(co.aliquotaCsll),
    },
  }),
);
function limparCooperativa(): void {
  Object.assign(co, coopVazia());
  tentouCo.value = false;
}
const txtNum = (n: number | null) => (n === null ? '' : String(n));
function editarCooperativa(x: CooperativaVisao): void {
  Object.assign(co, {
    ...x,
    percentualRepasse: txtNum(x.percentualRepasse),
    agencia: x.agencia ?? '',
    agenciaDigito: x.agenciaDigito ?? '',
    conta: x.conta ?? '',
    contaDigito: x.contaDigito ?? '',
    aliquotaIr: txtNum(x.aliquotaIr),
    aliquotaIss: txtNum(x.aliquotaIss),
    aliquotaPis: txtNum(x.aliquotaPis),
    aliquotaCofins: txtNum(x.aliquotaCofins),
    aliquotaCsll: txtNum(x.aliquotaCsll),
  });
}
async function gravarCooperativa(): Promise<void> {
  tentouCo.value = true;
  if (problemasCo.value.length) return;
  const ok = await rodar(
    () =>
      salvarCooperativa({
        id: co.id,
        versao: co.versao,
        cnpj: co.cnpj,
        razaoSocial: co.razaoSocial,
        nome: co.nome,
        percentualRepasse: numero(co.percentualRepasse),
        bancoId: co.bancoId,
        agencia: co.agencia.trim() || null,
        agenciaDigito: co.agenciaDigito.trim() || null,
        conta: co.conta.trim() || null,
        contaDigito: co.contaDigito.trim() || null,
        tipoConta: co.tipoConta,
        retemIr: co.retemIr,
        aliquotaIr: numero(co.aliquotaIr),
        aliquotaIss: numero(co.aliquotaIss),
        aliquotaPis: numero(co.aliquotaPis),
        aliquotaCofins: numero(co.aliquotaCofins),
        aliquotaCsll: numero(co.aliquotaCsll),
        optanteSimples: co.optanteSimples,
        ativo: co.ativo,
      }),
    t('equipesCooperativas.gravado'),
  );
  if (ok) limparCooperativa();
}

const vigenciaTexto = (v: { inicio: string; fim: string | null }) =>
  v.fim
    ? `${t('equipesCooperativas.desde', { inicio: v.inicio })} ${t('equipesCooperativas.encerradoEm', { fim: v.fim })}`
    : t('equipesCooperativas.desde', { inicio: v.inicio });
const emVigor = (l: VinculoVisao[]) => l.filter((v) => v.vigente).length;
</script>

<template>
  <section class="tela" data-testid="tela-equipes" aria-labelledby="eqc-titulo">
    <h1 id="eqc-titulo">{{ t('equipesCooperativas.titulo') }}</h1>
    <p>{{ t('equipesCooperativas.texto') }}</p>
    <MensagemErro v-if="visao.isError.value" :erro="visao.error.value" />
    <p v-else-if="!visao.data.value">{{ t('equipesCooperativas.carregando') }}</p>
    <template v-else>
      <p v-if="visao.data.value.profissional" class="barra" data-testid="eqc-do-profissional">
        <strong>{{
          t('equipesCooperativas.doProfissional', { nome: visao.data.value.profissional.nome })
        }}</strong>
        <RouterLink to="/cadastros/profissionais/equipes">{{ t('equipesCooperativas.verTodas') }}</RouterLink>
      </p>
      <div class="barra" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="aba === 'equipes'"
          data-testid="eqc-aba-equipes"
          @click="aba = 'equipes'"
        >
          {{ t('equipesCooperativas.abaEquipes') }} ({{ visao.data.value.equipes.length }})
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="aba === 'cooperativas'"
          data-testid="eqc-aba-cooperativas"
          @click="aba = 'cooperativas'"
        >
          {{ t('equipesCooperativas.abaCooperativas') }} ({{ visao.data.value.cooperativas.length }})
        </button>
      </div>
      <p v-if="aviso" class="aviso" role="status" data-testid="eqc-aviso">{{ aviso }}</p>
      <MensagemErro v-if="erro" :erro="erro" />

      <div class="grade">
        <div>
          <template v-if="aba === 'equipes'">
            <p v-if="!visao.data.value.equipes.length">{{ t('equipesCooperativas.nenhumaEquipe') }}</p>
            <ul class="lista" data-testid="eqc-equipes">
              <li v-for="x in visao.data.value.equipes" :key="x.id" :data-testid="`eqc-equipe-${x.id}`">
                <strong>{{ x.codigo }} · {{ x.nome }}</strong>
                <span>
                  · {{ t(`equipesCooperativas.tipos.${x.tipo}`) }}
                  <template v-if="x.setorNome">· {{ x.setorNome }}</template> · {{ vigenciaTexto(x) }} ·
                  {{ t('equipesCooperativas.membros', { n: emVigor(x.membros) }) }}
                  <template v-if="!x.ativo">· {{ t('equipesCooperativas.inativa') }}</template>
                </span>
                <span class="acoes">
                  <button
                    type="button"
                    :data-testid="`eqc-abrir-equipe-${x.id}`"
                    @click="abrir({ tipo: 'equipe', x })"
                  >
                    {{ t('equipesCooperativas.abrir') }}
                  </button>
                  <button
                    v-if="podeEditar"
                    type="button"
                    :data-testid="`eqc-editar-equipe-${x.id}`"
                    @click="editarEquipe(x)"
                  >
                    {{ t('equipesCooperativas.editar') }}
                  </button>
                </span>
              </li>
            </ul>
          </template>
          <template v-else>
            <p v-if="!visao.data.value.cooperativas.length">
              {{ t('equipesCooperativas.nenhumaCooperativa') }}
            </p>
            <ul class="lista" data-testid="eqc-cooperativas">
              <li
                v-for="x in visao.data.value.cooperativas"
                :key="x.id"
                :data-testid="`eqc-cooperativa-${x.id}`"
              >
                <strong>{{ x.nome }}</strong>
                <span>
                  · {{ x.cnpj }} · {{ x.razaoSocial }} ·
                  {{ t('equipesCooperativas.cooperados', { n: emVigor(x.cooperados) }) }}
                  <template v-if="!x.ativo">· {{ t('equipesCooperativas.inativa') }}</template>
                </span>
                <span class="acoes">
                  <button
                    type="button"
                    :data-testid="`eqc-abrir-cooperativa-${x.id}`"
                    @click="abrir({ tipo: 'cooperativa', x })"
                  >
                    {{ t('equipesCooperativas.abrir') }}
                  </button>
                  <button
                    v-if="podeEditar"
                    type="button"
                    :data-testid="`eqc-editar-cooperativa-${x.id}`"
                    @click="editarCooperativa(x)"
                  >
                    {{ t('equipesCooperativas.editar') }}
                  </button>
                </span>
              </li>
            </ul>
          </template>

          <section v-if="aberta" class="detalhe" data-testid="eqc-detalhe" aria-labelledby="eqc-det-titulo">
            <h2 id="eqc-det-titulo">{{ aberta.x.nome }}</h2>
            <ul data-testid="eqc-vinculos">
              <li v-for="v in vinculosAbertos" :key="v.id" :data-testid="`eqc-vinculo-${v.id}`">
                {{ v.profissionalNome }}
                <template v-if="v.papel">· {{ t(`equipesCooperativas.papeis.${v.papel}`) }}</template>
                · {{ vigenciaTexto(v) }}
                <template v-if="v.vigente">· {{ t('equipesCooperativas.vigente') }}</template>
                <span v-if="podeEditar && (v.fim === null || v.fim >= visao.data.value.hoje)" class="linha">
                  <label
                    >{{ t('equipesCooperativas.fimEncerrar') }}
                    <input
                      v-model="fimDe[v.id]"
                      type="date"
                      :min="v.inicio"
                      :placeholder="visao.data.value.hoje"
                      :data-testid="`eqc-fim-${v.id}`"
                  /></label>
                  <button type="button" :data-testid="`eqc-encerrar-${v.id}`" @click="encerrar(v)">
                    {{ t('equipesCooperativas.encerrar') }}
                  </button>
                </span>
              </li>
            </ul>
            <template v-if="podeEditar">
              <h3>
                {{
                  aberta.tipo === 'equipe'
                    ? t('equipesCooperativas.incluirMembro')
                    : t('equipesCooperativas.incluirCooperado')
                }}
              </h3>
              <label
                >{{ t('equipesCooperativas.buscarProfissional') }}
                <input v-model="vinc.busca" autocomplete="off" data-testid="eqc-busca" />
              </label>
              <ul v-if="achados.length" class="achados" data-testid="eqc-achados">
                <li v-for="p in achados" :key="p.id">
                  <button type="button" :data-testid="`eqc-achado-${p.id}`" @click="escolher(p)">
                    {{ p.nome }}
                  </button>
                </li>
              </ul>
              <p v-if="vinc.nome" data-testid="eqc-escolhido">
                {{ t('equipesCooperativas.escolhido', { nome: vinc.nome }) }}
              </p>
              <div class="linha">
                <SanteSelecao
                  v-if="aberta.tipo === 'equipe'"
                  v-model="vinc.papel"
                  :rotulo="t('equipesCooperativas.papel')"
                  :opcoes="
                    PAPEIS_MEMBRO_EQUIPE.map((p) => ({
                      valor: p,
                      rotulo: t(`equipesCooperativas.papeis.${p}`),
                    }))
                  "
                  data-testid="eqc-papel"
                />
                <label
                  >{{ t('equipesCooperativas.inicio') }}
                  <input
                    v-model="vinc.inicio"
                    type="date"
                    :placeholder="visao.data.value.hoje"
                    data-testid="eqc-vinc-inicio"
                /></label>
                <label
                  >{{ t('equipesCooperativas.fim') }}
                  <input v-model="vinc.fim" type="date" :min="vinc.inicio" data-testid="eqc-vinc-fim"
                /></label>
                <button
                  type="button"
                  data-testid="eqc-incluir"
                  :disabled="
                    vinc.profissionalId === null || (!!vinc.fim && !!vinc.inicio && vinc.fim < vinc.inicio)
                  "
                  @click="incluir"
                >
                  {{
                    aberta.tipo === 'equipe'
                      ? t('equipesCooperativas.incluirMembro')
                      : t('equipesCooperativas.incluirCooperado')
                  }}
                </button>
              </div>
            </template>
            <button type="button" @click="aberta = null">{{ t('equipesCooperativas.fechar') }}</button>
          </section>
        </div>

        <form
          v-if="podeEditar && aba === 'equipes'"
          class="ficha"
          data-testid="eqc-ficha-equipe"
          @submit.prevent="gravarEquipe"
        >
          <h2>
            {{
              eq.id ? `${t('equipesCooperativas.editar')} ${eq.codigo}` : t('equipesCooperativas.novaEquipe')
            }}
          </h2>
          <label
            >{{ t('equipesCooperativas.codigo') }}
            <input v-model="eq.codigo" maxlength="30" data-testid="eqc-codigo"
          /></label>
          <label
            >{{ t('equipesCooperativas.nome') }}
            <input v-model="eq.nome" maxlength="150" data-testid="eqc-nome"
          /></label>
          <SanteSelecao
            v-model="eq.tipo"
            :rotulo="t('equipesCooperativas.tipo')"
            :opcoes="TIPOS_EQUIPE.map((v) => ({ valor: v, rotulo: t(`equipesCooperativas.tipos.${v}`) }))"
            data-testid="eqc-tipo"
          />
          <SanteSelecao
            v-model="eq.setorId"
            :rotulo="t('equipesCooperativas.setor')"
            :opcoes="[
              { valor: null, rotulo: t('equipesCooperativas.semSetor') },
              ...visao.data.value.setores.map((s) => ({ valor: s.id, rotulo: s.nome })),
            ]"
            data-testid="eqc-setor"
          />
          <div class="linha">
            <label
              >{{ t('equipesCooperativas.inicio') }}
              <input
                v-model="eq.inicio"
                type="date"
                :placeholder="visao.data.value.hoje"
                data-testid="eqc-inicio"
            /></label>
            <label
              >{{ t('equipesCooperativas.fim') }}
              <input v-model="eq.fim" type="date" :min="eq.inicio" data-testid="eqc-fim"
            /></label>
          </div>
          <label class="marca"
            ><input v-model="eq.ativo" type="checkbox" data-testid="eqc-ativo" />
            {{ t('equipesCooperativas.ativo') }}</label
          >
          <div
            v-if="tentouEq && problemasEq.length"
            class="problemas"
            role="alert"
            data-testid="eqc-problemas"
          >
            {{ t('equipesCooperativas.problemas') }}
            <ul>
              <li v-for="p in problemasEq" :key="p">{{ t(`equipesCooperativas.erros.${p}`) }}</li>
            </ul>
          </div>
          <div class="linha">
            <button type="submit" data-testid="eqc-gravar-equipe">
              {{ t('equipesCooperativas.gravar') }}
            </button>
            <button type="button" @click="limparEquipe">{{ t('equipesCooperativas.limpar') }}</button>
          </div>
        </form>

        <form
          v-if="podeEditar && aba === 'cooperativas'"
          class="ficha"
          data-testid="eqc-ficha-cooperativa"
          @submit.prevent="gravarCooperativa"
        >
          <h2>
            {{
              co.id
                ? `${t('equipesCooperativas.editar')} ${co.nome}`
                : t('equipesCooperativas.novaCooperativa')
            }}
          </h2>
          <label
            >{{ t('equipesCooperativas.cnpj') }}
            <input v-model="co.cnpj" maxlength="18" inputmode="numeric" data-testid="eqc-cnpj"
          /></label>
          <label
            >{{ t('equipesCooperativas.razaoSocial') }}
            <input v-model="co.razaoSocial" maxlength="250" data-testid="eqc-razao"
          /></label>
          <label
            >{{ t('equipesCooperativas.nomeExibicao') }}
            <input v-model="co.nome" maxlength="150" data-testid="eqc-coop-nome"
          /></label>
          <label
            >{{ t('equipesCooperativas.percentualRepasse') }}
            <input v-model="co.percentualRepasse" inputmode="decimal" data-testid="eqc-percentual"
          /></label>
          <SanteSelecao
            v-model="co.bancoId"
            :rotulo="t('equipesCooperativas.banco')"
            :opcoes="[
              { valor: null, rotulo: t('equipesCooperativas.semBanco') },
              ...visao.data.value.bancos.map((b) => ({ valor: b.id, rotulo: b.nome })),
            ]"
            data-testid="eqc-banco"
          />
          <div class="linha">
            <label
              >{{ t('equipesCooperativas.agencia') }}
              <input v-model="co.agencia" maxlength="10" size="6" data-testid="eqc-agencia"
            /></label>
            <label
              >{{ t('equipesCooperativas.digito') }} <input v-model="co.agenciaDigito" maxlength="2" size="2"
            /></label>
            <label
              >{{ t('equipesCooperativas.conta') }}
              <input v-model="co.conta" maxlength="20" size="10" data-testid="eqc-conta"
            /></label>
            <label
              >{{ t('equipesCooperativas.digito') }} <input v-model="co.contaDigito" maxlength="2" size="2"
            /></label>
          </div>
          <SanteSelecao
            v-model="co.tipoConta"
            :rotulo="t('equipesCooperativas.tipoConta')"
            :opcoes="[
              { valor: null, rotulo: '—' },
              ...TIPOS_CONTA_COOPERATIVA.map((v) => ({
                valor: v,
                rotulo: t(`equipesCooperativas.tiposConta.${v}`),
              })),
            ]"
            data-testid="eqc-tipo-conta"
          />
          <label class="marca"
            ><input v-model="co.retemIr" type="checkbox" data-testid="eqc-retem-ir" />
            {{ t('equipesCooperativas.retemIr') }}</label
          >
          <label class="marca"
            ><input v-model="co.optanteSimples" type="checkbox" />
            {{ t('equipesCooperativas.optanteSimples') }}</label
          >
          <fieldset class="linha">
            <legend>{{ t('equipesCooperativas.aliquotas') }}</legend>
            <label
              >{{ t('equipesCooperativas.aliquotaIr') }}
              <input v-model="co.aliquotaIr" inputmode="decimal" size="5" data-testid="eqc-aliq-ir"
            /></label>
            <label
              >{{ t('equipesCooperativas.aliquotaIss') }}
              <input v-model="co.aliquotaIss" inputmode="decimal" size="5"
            /></label>
            <label
              >{{ t('equipesCooperativas.aliquotaPis') }}
              <input v-model="co.aliquotaPis" inputmode="decimal" size="5"
            /></label>
            <label
              >{{ t('equipesCooperativas.aliquotaCofins') }}
              <input v-model="co.aliquotaCofins" inputmode="decimal" size="5"
            /></label>
            <label
              >{{ t('equipesCooperativas.aliquotaCsll') }}
              <input v-model="co.aliquotaCsll" inputmode="decimal" size="5"
            /></label>
          </fieldset>
          <label class="marca"
            ><input v-model="co.ativo" type="checkbox" /> {{ t('equipesCooperativas.ativo') }}</label
          >
          <div
            v-if="tentouCo && problemasCo.length"
            class="problemas"
            role="alert"
            data-testid="eqc-problemas-coop"
          >
            {{ t('equipesCooperativas.problemas') }}
            <ul>
              <li v-for="p in problemasCo" :key="p">{{ t(`equipesCooperativas.erros.${p}`) }}</li>
            </ul>
          </div>
          <div class="linha">
            <button type="submit" data-testid="eqc-gravar-cooperativa">
              {{ t('equipesCooperativas.gravar') }}
            </button>
            <button type="button" @click="limparCooperativa">
              {{ t('equipesCooperativas.limpar') }}
            </button>
          </div>
        </form>
      </div>
    </template>
  </section>
</template>

<style scoped>
.barra,
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.grade {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(16rem, 1fr);
  gap: var(--sgh-espaco-3);
}
.lista,
.achados {
  list-style: none;
  padding: 0;
}
.lista li {
  padding: var(--sgh-espaco-1) 0;
  border-bottom: 1px solid var(--sgh-borda);
}
.acoes {
  float: right;
  display: inline-flex;
  gap: var(--sgh-espaco-1);
}
.detalhe {
  margin-top: var(--sgh-espaco-3);
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
.ficha label {
  display: block;
  margin-bottom: var(--sgh-espaco-1);
}
.ficha .linha label {
  display: inline-block;
}
.problemas {
  color: var(--sgh-alerta);
}
</style>
