<script setup lang="ts">
import { SanteSelecao } from '@sgh/ui';
// Cadastro do item (F3.6, 05-SUP linha 1): `/suprimentos/itens/cadastro/:id?`. Material e medicamento numa tela só,
// gravados de uma vez: identificação, unidades e fatores (com a conversão à vista), controles, princípios ativos,
// vias, códigos de barras, apresentações com o registro sanitário (o vencido aparece vencido) e estabilidade.
// O domínio confere antes de enviar (todas as recusas de uma vez, no campo); o servidor confere de novo.
import type { ItemEstoqueEntrada } from '@sgh/contratos/regras-suprimentos';
import {
  CONDICOES_ESTABILIDADE,
  conferirItemEstoque,
  gtinValido,
  PADROES_CODIGO_BARRAS,
  TIPOS_ITEM_ESTOQUE,
} from '@sgh/contratos/regras-suprimentos';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import {
  alterarItem,
  apoioCadastroEstoque,
  buscarCadastro,
  fichaItemEdicao,
  incluirItem,
  type Opcao,
  situacaoItem,
} from '../api-cadastro-estoque.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import VinculoReferenciaPreco from '../componentes/VinculoReferenciaPreco.vue';

const { t } = useI18n();
const rota = useRoute();
const router = useRouter();
const apoio = useQuery({ queryKey: ['suprimentos', 'cadastro', 'apoio'], queryFn: apoioCadastroEstoque });
const vazio = (): ItemEstoqueEntrada => ({
  codigo: '',
  nome: '',
  nomeResumido: null,
  tipo: 'material',
  grupo: 0,
  subgrupo: null,
  unidadeEstoque: 0,
  unidadeCompra: null,
  fatorCompraEstoque: 1,
  unidadeConsumo: null,
  fatorEstoqueConsumo: 1,
  unidadePrescricao: null,
  fatorConsumoPrescricao: 1,
  fabricante: null,
  gtin: null,
  ncm: null,
  cest: null,
  classeRisco: null,
  controlaLote: false,
  controlaValidade: false,
  controlado: false,
  antimicrobiano: false,
  altaVigilancia: false,
  fracionavel: false,
  prescritivel: false,
  estoqueMinimo: null,
  estoqueMaximo: null,
  principiosAtivos: [],
  vias: [],
  codigosBarras: [],
  apresentacoes: [],
  estabilidades: [],
});
type Editavel = { -readonly [K in keyof ItemEstoqueEntrada]: ItemEstoqueEntrada[K] };
const f = ref<Editavel>(vazio());
const id = ref<number | null>(null);
const versao = ref(0);
const situacao = ref<'ativo' | 'inativo' | 'em_analise'>('ativo');
const saldoTotal = ref(0);
const registrosNaData = ref<readonly (string | null)[]>([]);
const nomesPa = ref<Record<number, string>>({});
const nomesFab = ref<Record<number, string>>({});
const erro = ref<unknown>(null);
const ok = ref(false);
const motivo = ref('');
const termoPa = ref('');
const achadosPa = ref<Opcao[]>([]);
const termoFab = ref('');
const achadosFab = ref<Opcao[]>([]);
const abrirId = ref('');
const enviado = ref(false);
const recusas = computed(() => (enviado.value ? conferirItemEstoque(f.value) : []));
const doCampo = (...cs: string[]) =>
  recusas.value.filter((x) => x.campos?.some((c) => cs.includes(c))).map((x) => x.mensagem);
/** Listas editadas na hora (códigos de barras e apresentações): a recusa aparece ao incluir, sem esperar o salvar. */
const vivas = computed(() => conferirItemEstoque(f.value));
const doCampoVivo = (c: string) => vivas.value.filter((x) => x.campos?.includes(c)).map((x) => x.mensagem);
const subgrupos = computed(() =>
  (apoio.data.value?.subgrupos ?? []).filter((s) => s.grupo === f.value.grupo),
);
const sigla = (u: number | null | undefined) =>
  apoio.data.value?.unidades.find((x) => x.id === u)?.codigo ?? '';
const CONTROLES = [
  'controlaLote',
  'controlaValidade',
  'controlado',
  'antimicrobiano',
  'altaVigilancia',
  'fracionavel',
  'prescritivel',
] as const;
const UNIDADES = ['unidadeCompra', 'unidadeConsumo', 'unidadePrescricao'] as const;

// Quem controla lote controla a validade: marca junto (menos um clique e nenhuma recusa à toa).
watch(
  () => f.value.controlaLote,
  (v) => {
    if (v) f.value.controlaValidade = true;
  },
);

async function carregar(x: number) {
  erro.value = null;
  ok.value = false;
  const ficha = await fichaItemEdicao(x);
  const {
    id: i,
    versao: v,
    situacao: s,
    saldoTotal: q,
    registrosNaData: r,
    nomesPrincipios,
    nomesFabricantes,
    ...resto
  } = ficha;
  f.value = resto;
  id.value = i;
  versao.value = v;
  situacao.value = s;
  saldoTotal.value = q;
  registrosNaData.value = r;
  nomesPa.value = { ...nomesPrincipios };
  nomesFab.value = { ...nomesFabricantes };
}
watch(
  () => Number(rota.params['id'] ?? 0),
  (x) => {
    if (x > 0) carregar(x).catch((e: unknown) => (erro.value = e));
    else {
      f.value = vazio();
      id.value = null;
    }
  },
  { immediate: true },
);

async function salvar() {
  enviado.value = true;
  erro.value = null;
  ok.value = false;
  if (recusas.value.length) return;
  try {
    const r = id.value ? await alterarItem(id.value, versao.value, f.value) : await incluirItem(f.value);
    await router.replace(`/suprimentos/itens/cadastro/${r.id}`);
    await carregar(r.id);
    ok.value = true;
  } catch (e) {
    erro.value = e;
  }
}
async function trocarSituacao() {
  if (!id.value) return;
  erro.value = null;
  try {
    await situacaoItem(id.value, versao.value, situacao.value !== 'ativo', motivo.value);
    motivo.value = '';
    await carregar(id.value);
  } catch (e) {
    erro.value = e;
  }
}
async function buscarPa() {
  achadosPa.value =
    termoPa.value.trim().length >= 2 ? await buscarCadastro('principios', termoPa.value.trim()) : [];
}
function incluirPa(o: Opcao) {
  if (!f.value.principiosAtivos.some((p) => p.principio === o.id))
    f.value.principiosAtivos = [
      ...f.value.principiosAtivos,
      { principio: o.id, concentracao: null, unidade: null, principal: !f.value.principiosAtivos.length },
    ];
  nomesPa.value[o.id] = o.nome;
  achadosPa.value = [];
  termoPa.value = '';
}
async function buscarFab() {
  achadosFab.value =
    termoFab.value.trim().length >= 2 ? await buscarCadastro('fabricantes', termoFab.value.trim()) : [];
}
function escolherFab(o: Opcao) {
  f.value.fabricante = o.id;
  nomesFab.value[o.id] = o.nome;
  achadosFab.value = [];
  termoFab.value = '';
}
/** A via escolhida no combo entra na lista e o combo volta ao "Escolha". */
const novaVia = ref('');
function incluirVia() {
  const v = Number(novaVia.value);
  if (v && !f.value.vias.some((x) => x.via === v))
    f.value.vias = [...f.value.vias, { via: v, padrao: !f.value.vias.length }];
  novaVia.value = '';
}
const nomeVia = (v: number) => apoio.data.value?.vias.find((x) => x.id === v)?.nome ?? String(v);
const remover = <T,>(lista: readonly T[], i: number): T[] => lista.filter((_, k) => k !== i);
/** Troca um campo de uma estabilidade (horas, guarda ou diluente): a chave é a condição, a guarda e o diluente. */
function mudarEstabilidade(i: number, campo: 'horas' | 'condicaoArmazenamento' | 'diluente', valor: string) {
  const v = valor.trim() === '' ? (campo === 'horas' ? 0 : null) : Number(valor);
  f.value.estabilidades = f.value.estabilidades.map((s, k) => (k === i ? { ...s, [campo]: v } : s));
}
/** Concentração e unidade do princípio ativo editadas na própria linha. */
function mudarPrincipio(i: number, campo: 'concentracao' | 'unidade', valor: number | string | null) {
  const v = valor === null || String(valor).trim() === '' ? null : Number(valor);
  f.value.principiosAtivos = f.value.principiosAtivos.map((p, k) => (k === i ? { ...p, [campo]: v } : p));
}
const opcoesUnidade = computed(() => [
  { valor: null, rotulo: t('cadastroEstoque.nenhum') },
  ...(apoio.data.value?.unidades ?? []).map((o) => ({ valor: o.id, rotulo: `${o.codigo} · ${o.nome}` })),
]);
/** Novo código de barras: GTIN conferido na hora; a unidade padrão é a de estoque. */
const novoBarras = ref({
  codigo: '',
  padrao: 'gtin' as (typeof PADROES_CODIGO_BARRAS)[number],
  quantidade: 1,
  unidade: null as number | null,
});
const barrasInvalido = computed(
  () =>
    novoBarras.value.padrao === 'gtin' &&
    novoBarras.value.codigo.trim() !== '' &&
    !gtinValido(novoBarras.value.codigo.trim()),
);
function incluirBarras() {
  const b = novoBarras.value;
  const unidade = b.unidade ?? f.value.unidadeEstoque;
  if (!b.codigo.trim() || barrasInvalido.value || !unidade) return;
  f.value.codigosBarras = [
    ...f.value.codigosBarras,
    {
      codigo: b.codigo.trim(),
      padrao: b.padrao,
      quantidade: Number(b.quantidade),
      unidade,
      principal: !f.value.codigosBarras.length,
    },
  ];
  novoBarras.value = { codigo: '', padrao: b.padrao, quantidade: 1, unidade: null };
}
/** Nova apresentação comercial, com o registro sanitário opcional (fabricante: o do item). */
const novaApr = ref({
  nomeComercial: '',
  apresentacao: '',
  quantidadeEmbalagem: 1,
  registro: '',
  validade: '',
});
function incluirApresentacao() {
  const a = novaApr.value;
  if (!a.nomeComercial.trim()) return;
  f.value.apresentacoes = [
    ...f.value.apresentacoes,
    {
      nomeComercial: a.nomeComercial.trim(),
      apresentacao: a.apresentacao.trim() || null,
      fabricante: f.value.fabricante ?? null,
      quantidadeEmbalagem: Number(a.quantidadeEmbalagem),
      registro: a.registro.trim() ? { numero: a.registro.trim(), validade: a.validade || null } : null,
    },
  ];
  novaApr.value = { nomeComercial: '', apresentacao: '', quantidadeEmbalagem: 1, registro: '', validade: '' };
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="item-cad-titulo" data-testid="tela-suprimentos-item-cadastro">
    <h1 id="item-cad-titulo">{{ t('cadastroEstoque.item.titulo') }}</h1>
    <p>{{ t('cadastroEstoque.item.texto') }}</p>
    <form class="filtros" @submit.prevent="router.push(`/suprimentos/itens/cadastro/${abrirId}`)">
      <label class="campo"
        >{{ t('cadastroEstoque.item.abrir') }}
        <input v-model="abrirId" inputmode="numeric" data-testid="item-abrir"
      /></label>
      <RouterLink class="botao" to="/suprimentos/itens/cadastro">{{ t('cadastroEstoque.novo') }}</RouterLink>
    </form>
    <form class="painel" novalidate data-testid="item-form" @submit.prevent="salvar">
      <p v-if="id" data-testid="item-situacao">
        {{ t('cadastroEstoque.item.situacao') }}:
        {{ situacao === 'ativo' ? t('cadastroEstoque.ativo') : t('cadastroEstoque.inativo') }} ·
        {{ t('cadastroEstoque.item.saldoTotal', { q: saldoTotal }) }}
      </p>
      <fieldset>
        <label class="campo"
          >{{ t('cadastroEstoque.codigo') }}
          <input v-model="f.codigo" maxlength="30" data-testid="item-codigo"
        /></label>
        <label class="campo"
          >{{ t('cadastroEstoque.nome') }} <input v-model="f.nome" maxlength="150" data-testid="item-nome"
        /></label>
        <small v-for="m in doCampo('codigo', 'nome')" :key="m" class="erro">{{ m }}</small>
        <label class="campo"
          >{{ t('cadastroEstoque.item.nomeResumido') }} <input v-model="f.nomeResumido" maxlength="60"
        /></label>
        <SanteSelecao
          v-model="f.tipo"
          :rotulo="t('cadastroEstoque.tipo')"
          :opcoes="[
            ...TIPOS_ITEM_ESTOQUE.map((x) => ({ valor: x, rotulo: t(`cadastroEstoque.item.tipos.${x}`) })),
          ]"
          class="campo"
          data-testid="item-tipo"
        />
        <SanteSelecao
          v-model="f.grupo"
          :rotulo="t('cadastroEstoque.item.grupo')"
          :opcoes="[
            { valor: 0, rotulo: t('cadastroEstoque.escolha') },
            ...(apoio.data.value?.grupos ?? []).map((o) => ({ valor: o.id, rotulo: o.nome })),
          ]"
          class="campo"
          data-testid="item-grupo"
          @update:model-value="f.subgrupo = null"
        />
        <SanteSelecao
          :model-value="f.subgrupo ?? null"
          @update:model-value="(v) => (f.subgrupo = v)"
          :rotulo="t('cadastroEstoque.item.subgrupo')"
          :opcoes="[
            { valor: null, rotulo: t('cadastroEstoque.nenhum') },
            ...subgrupos.map((o) => ({ valor: o.id, rotulo: o.nome })),
          ]"
          class="campo"
        />
      </fieldset>
      <fieldset>
        <legend>{{ t('cadastroEstoque.item.unidades') }}</legend>
        <SanteSelecao
          v-model="f.unidadeEstoque"
          :rotulo="t('cadastroEstoque.item.unidadeEstoque')"
          :opcoes="[
            { valor: 0, rotulo: t('cadastroEstoque.escolha') },
            ...(apoio.data.value?.unidades ?? []).map((o) => ({
              valor: o.id,
              rotulo: `${o.codigo} · ${o.nome}`,
            })),
          ]"
          class="campo"
          data-testid="item-unidadeEstoque"
        />
        <SanteSelecao
          v-for="k in UNIDADES"
          :key="k"
          :model-value="f[k] ?? null"
          @update:model-value="(v) => (f[k] = v)"
          :rotulo="t(`cadastroEstoque.item.${k}`)"
          :opcoes="[
            { valor: null, rotulo: t('cadastroEstoque.nenhum') },
            ...(apoio.data.value?.unidades ?? []).map((o) => ({
              valor: o.id,
              rotulo: `${o.codigo} · ${o.nome}`,
            })),
          ]"
          class="campo"
        />
        <label class="campo"
          >{{ t('cadastroEstoque.item.fatorCompra') }}
          <input v-model.number="f.fatorCompraEstoque" type="number" min="0" step="any"
        /></label>
        <small v-if="f.unidadeCompra">{{
          `1 ${sigla(f.unidadeCompra)} = ${f.fatorCompraEstoque} ${sigla(f.unidadeEstoque)}`
        }}</small>
        <label class="campo"
          >{{ t('cadastroEstoque.item.fatorConsumo') }}
          <input v-model.number="f.fatorEstoqueConsumo" type="number" min="0" step="any"
        /></label>
        <label class="campo"
          >{{ t('cadastroEstoque.item.fatorPrescricao') }}
          <input v-model.number="f.fatorConsumoPrescricao" type="number" min="0" step="any"
        /></label>
        <small
          v-for="m in doCampo('fatorCompraEstoque', 'fatorEstoqueConsumo', 'fatorConsumoPrescricao')"
          :key="m"
          class="erro"
          >{{ m }}</small
        >
        <label class="campo"
          >{{ t('cadastroEstoque.item.estoqueMinimo') }}
          <input v-model.number="f.estoqueMinimo" type="number" min="0"
        /></label>
        <label class="campo"
          >{{ t('cadastroEstoque.item.estoqueMaximo') }}
          <input v-model.number="f.estoqueMaximo" type="number" min="0"
        /></label>
        <small v-for="m in doCampo('estoqueMaximo')" :key="m" class="erro">{{ m }}</small>
      </fieldset>
      <fieldset>
        <legend>{{ t('cadastroEstoque.item.fiscal') }}</legend>
        <label class="campo"
          >{{ t('cadastroEstoque.item.gtin') }} <input v-model="f.gtin" maxlength="14" inputmode="numeric"
        /></label>
        <label class="campo"
          >{{ t('cadastroEstoque.item.ncm') }} <input v-model="f.ncm" maxlength="8" inputmode="numeric"
        /></label>
        <label class="campo"
          >{{ t('cadastroEstoque.item.cest') }} <input v-model="f.cest" maxlength="7" inputmode="numeric"
        /></label>
        <small v-for="m in doCampo('gtin', 'ncm', 'cest')" :key="m" class="erro">{{ m }}</small>
        <label class="campo"
          >{{ t('cadastroEstoque.item.fabricante') }}:
          {{ f.fabricante ? (nomesFab[f.fabricante] ?? f.fabricante) : '' }}
          <input
            v-model="termoFab"
            :placeholder="t('cadastroEstoque.item.buscarFabricante')"
            @input="buscarFab"
        /></label>
        <ul v-if="achadosFab.length">
          <li v-for="o in achadosFab" :key="o.id">
            <button type="button" class="link" @click="escolherFab(o)">{{ o.nome }}</button>
          </li>
        </ul>
      </fieldset>
      <fieldset>
        <legend>{{ t('cadastroEstoque.item.marcas') }}</legend>
        <label v-for="k in CONTROLES" :key="k"
          ><input v-model="f[k]" type="checkbox" :data-testid="`item-${k}`" />
          {{ t(`cadastroEstoque.item.${k}`) }}</label
        >
        <small
          v-for="m in doCampo('controlaValidade', 'controlado', 'antimicrobiano')"
          :key="m"
          class="erro"
          >{{ m }}</small
        >
      </fieldset>
      <fieldset>
        <legend>{{ t('cadastroEstoque.item.principios') }}</legend>
        <ul>
          <li v-for="(p, i) in f.principiosAtivos" :key="p.principio">
            {{ nomesPa[p.principio] ?? p.principio }}
            <label
              >{{ t('cadastroEstoque.item.concentracao') }}
              <input
                type="number"
                min="0"
                step="any"
                :value="p.concentracao ?? ''"
                :data-testid="`principio-concentracao-${i}`"
                @change="mudarPrincipio(i, 'concentracao', ($event.target as HTMLInputElement).value)"
            /></label>
            <SanteSelecao
              :model-value="p.unidade ?? null"
              :rotulo="t('cadastroEstoque.item.unidadeConcentracao')"
              :opcoes="opcoesUnidade"
              :data-testid="`principio-unidade-${i}`"
              @update:model-value="(v) => mudarPrincipio(i, 'unidade', v)"
            />
            <span v-if="p.principal"> · {{ t('cadastroEstoque.item.principal') }}</span>
            <button type="button" class="link" @click="f.principiosAtivos = remover(f.principiosAtivos, i)">
              {{ t('cadastroEstoque.remover') }}
            </button>
          </li>
        </ul>
        <input
          v-model="termoPa"
          :placeholder="t('cadastroEstoque.item.buscarPrincipio')"
          :aria-label="t('cadastroEstoque.item.buscarPrincipio')"
          data-testid="item-busca-principio"
          @input="buscarPa"
        />
        <ul v-if="achadosPa.length">
          <li v-for="o in achadosPa" :key="o.id">
            <button type="button" class="link" :data-testid="`item-principio-${o.id}`" @click="incluirPa(o)">
              {{ o.nome }}
            </button>
          </li>
        </ul>
        <small
          v-for="m in doCampo('principiosAtivos')"
          :key="m"
          class="erro"
          data-testid="item-erro-principio"
          >{{ m }}</small
        >
      </fieldset>
      <fieldset>
        <legend>{{ t('cadastroEstoque.item.vias') }}</legend>
        <ul>
          <li v-for="(v, i) in f.vias" :key="v.via">
            {{ nomeVia(v.via) }}<span v-if="v.padrao"> · {{ t('cadastroEstoque.item.padrao') }}</span>
            <button type="button" class="link" @click="f.vias = remover(f.vias, i)">
              {{ t('cadastroEstoque.remover') }}
            </button>
          </li>
        </ul>
        <SanteSelecao
          v-model="novaVia"
          :rotulo="t('cadastroEstoque.item.vias')"
          ocultar-rotulo
          :opcoes="[
            { valor: '', rotulo: t('cadastroEstoque.escolha') },
            ...(apoio.data.value?.vias ?? []).map((o) => ({ valor: String(o.id), rotulo: o.nome })),
          ]"
          @update:model-value="incluirVia"
        />
        <small v-for="m in doCampo('vias')" :key="m" class="erro">{{ m }}</small>
      </fieldset>
      <fieldset>
        <legend>{{ t('cadastroEstoque.item.barras') }}</legend>
        <ul>
          <li v-for="(c, i) in f.codigosBarras" :key="i">
            {{ c.codigo }} · {{ c.padrao }} · {{ c.quantidade }} {{ sigla(c.unidade) }}
            <button type="button" class="link" @click="f.codigosBarras = remover(f.codigosBarras, i)">
              {{ t('cadastroEstoque.remover') }}
            </button>
          </li>
        </ul>
        <div class="filtros">
          <label class="campo"
            >{{ t('cadastroEstoque.codigo') }}
            <input v-model="novoBarras.codigo" inputmode="numeric" maxlength="60" data-testid="barras-codigo"
          /></label>
          <SanteSelecao
            v-model="novoBarras.padrao"
            :rotulo="t('cadastroEstoque.item.padraoBarras')"
            :opcoes="
              PADROES_CODIGO_BARRAS.map((x) => ({
                valor: x,
                rotulo: t(`cadastroEstoque.item.padroesBarras.${x}`),
              }))
            "
            class="campo"
          />
          <label class="campo"
            >{{ t('cadastroEstoque.item.quantidade') }}
            <input
              v-model.number="novoBarras.quantidade"
              type="number"
              min="0"
              step="any"
              data-testid="barras-quantidade"
          /></label>
          <SanteSelecao
            v-model="novoBarras.unidade"
            :rotulo="t('cadastroEstoque.item.unidadeEstoque')"
            :opcoes="opcoesUnidade"
            class="campo"
          />
          <button
            type="button"
            class="botao"
            data-testid="barras-incluir"
            :disabled="barrasInvalido"
            @click="incluirBarras"
          >
            {{ t('cadastroEstoque.incluir') }}
          </button>
        </div>
        <small v-if="barrasInvalido" class="erro" data-testid="barras-invalido">{{
          t('cadastroEstoque.item.gtinInvalido')
        }}</small>
        <small v-for="m in doCampoVivo('codigosBarras')" :key="m" class="erro">{{ m }}</small>
      </fieldset>
      <fieldset>
        <legend>{{ t('cadastroEstoque.item.apresentacoes') }}</legend>
        <ul>
          <li v-for="(a, i) in f.apresentacoes" :key="i">
            {{ a.nomeComercial }} {{ a.apresentacao ?? '' }} · {{ a.quantidadeEmbalagem }}
            <template v-if="a.registro">
              · {{ t('cadastroEstoque.item.registro') }} {{ a.registro.numero }}
              {{ a.registro.validade ?? '' }}
              <strong v-if="registrosNaData[i]">{{ registrosNaData[i] }}</strong>
            </template>
            <button type="button" class="link" @click="f.apresentacoes = remover(f.apresentacoes, i)">
              {{ t('cadastroEstoque.remover') }}
            </button>
          </li>
        </ul>
        <div class="filtros">
          <label class="campo"
            >{{ t('cadastroEstoque.item.nomeComercial') }}
            <input v-model="novaApr.nomeComercial" maxlength="150" data-testid="apr-nome"
          /></label>
          <label class="campo"
            >{{ t('cadastroEstoque.item.apresentacao') }}
            <input v-model="novaApr.apresentacao" maxlength="150" data-testid="apr-apresentacao"
          /></label>
          <label class="campo"
            >{{ t('cadastroEstoque.item.embalagem') }}
            <input
              v-model.number="novaApr.quantidadeEmbalagem"
              type="number"
              min="0"
              step="any"
              data-testid="apr-quantidade"
          /></label>
          <label class="campo"
            >{{ t('cadastroEstoque.item.registro') }}
            <input v-model="novaApr.registro" inputmode="numeric" maxlength="13" data-testid="apr-registro"
          /></label>
          <label class="campo"
            >{{ t('cadastroEstoque.item.validadeRegistro') }}
            <input v-model="novaApr.validade" type="date" data-testid="apr-validade"
          /></label>
          <button type="button" class="botao" data-testid="apr-incluir" @click="incluirApresentacao">
            {{ t('cadastroEstoque.incluir') }}
          </button>
        </div>
        <small v-for="m in doCampoVivo('apresentacoes')" :key="m" class="erro">{{ m }}</small>
      </fieldset>
      <fieldset>
        <legend>{{ t('cadastroEstoque.item.estabilidades') }}</legend>
        <ul>
          <li v-for="(s, i) in f.estabilidades" :key="i">
            {{ s.condicao }}
            <label
              >{{ t('cadastroEstoque.item.horas') }}
              <input
                type="number"
                min="0"
                step="any"
                :value="s.horas"
                :data-testid="`estabilidade-horas-${i}`"
                @change="mudarEstabilidade(i, 'horas', ($event.target as HTMLInputElement).value)"
            /></label>
            <SanteSelecao
              :model-value="s.condicaoArmazenamento ?? null"
              :rotulo="t('cadastroEstoque.item.guarda')"
              :opcoes="[
                { valor: null, rotulo: t('cadastroEstoque.item.qualquerGuarda') },
                ...(apoio.data.value?.guardas ?? []).map((o) => ({ valor: o.id, rotulo: o.nome })),
              ]"
              :data-testid="`estabilidade-guarda-${i}`"
              @update:model-value="
                (v) => mudarEstabilidade(i, 'condicaoArmazenamento', v === null ? '' : String(v))
              "
            />
            <SanteSelecao
              v-if="s.condicao === 'diluido'"
              :model-value="s.diluente ?? null"
              :rotulo="t('cadastroEstoque.item.diluente')"
              :opcoes="[
                { valor: null, rotulo: t('cadastroEstoque.nenhum') },
                ...(apoio.data.value?.diluentes ?? []).map((o) => ({
                  valor: o.id,
                  rotulo: `${o.codigo} · ${o.nome}`,
                })),
              ]"
              :data-testid="`estabilidade-diluente-${i}`"
              @update:model-value="(v) => mudarEstabilidade(i, 'diluente', v === null ? '' : String(v))"
            />
            <button type="button" class="link" @click="f.estabilidades = remover(f.estabilidades, i)">
              {{ t('cadastroEstoque.remover') }}
            </button>
          </li>
        </ul>
        <button
          v-for="x in CONDICOES_ESTABILIDADE"
          :key="x"
          type="button"
          class="link"
          @click="f.estabilidades = [...f.estabilidades, { condicao: x, horas: 24 }]"
        >
          {{ `+ ${x}` }}
        </button>
        <small v-for="m in doCampo('estabilidades')" :key="m" class="erro">{{ m }}</small>
      </fieldset>
      <ErroSuprimentos v-if="erro" :erro="erro" />
      <p v-if="ok" role="status" data-testid="item-ok">{{ t('cadastroEstoque.salvo') }}</p>
      <button type="submit" class="botao primario" data-testid="item-salvar">
        {{ t('cadastroEstoque.salvar') }}
      </button>
      <template v-if="id">
        <label class="campo"
          >{{ t('cadastroEstoque.motivo') }}
          <input v-model="motivo" maxlength="500" data-testid="item-motivo"
        /></label>
        <button type="button" class="botao" data-testid="item-situacao-trocar" @click="trocarSituacao">
          {{ situacao === 'ativo' ? t('cadastroEstoque.inativar') : t('cadastroEstoque.reativar') }}
        </button>
      </template>
    </form>
    <!-- F3.6 (05-SUP linha 28): o vínculo com a referência de preço, na ficha do item já gravado. -->
    <VinculoReferenciaPreco v-if="id" :item="id" />
  </section>
</template>
