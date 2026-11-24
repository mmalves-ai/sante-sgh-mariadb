<script setup lang="ts">
// Cadastro do item (F3.6, 05-SUP linha 1): `/suprimentos/itens/cadastro/:id?`. Material e medicamento numa tela só,
// gravados de uma vez: identificação, unidades e fatores (com a conversão à vista), controles, princípios ativos,
// vias, códigos de barras, apresentações com o registro sanitário (o vencido aparece vencido) e estabilidade.
// O domínio confere antes de enviar (todas as recusas de uma vez, no campo); o servidor confere de novo.
import type { ItemEstoqueEntrada } from '@sgh/contratos/regras-suprimentos';
import {
  CONDICOES_ESTABILIDADE,
  conferirItemEstoque,
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
function incluirVia(ev: Event) {
  const alvo = ev.target as HTMLSelectElement;
  const v = Number(alvo.value);
  if (v && !f.value.vias.some((x) => x.via === v))
    f.value.vias = [...f.value.vias, { via: v, padrao: !f.value.vias.length }];
  alvo.value = '';
}
const nomeVia = (v: number) => apoio.data.value?.vias.find((x) => x.id === v)?.nome ?? String(v);
const remover = <T,>(lista: readonly T[], i: number): T[] => lista.filter((_, k) => k !== i);
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
        <label class="campo"
          >{{ t('cadastroEstoque.tipo') }}
          <select v-model="f.tipo" data-testid="item-tipo">
            <option v-for="x in TIPOS_ITEM_ESTOQUE" :key="x" :value="x">
              {{ t(`cadastroEstoque.item.tipos.${x}`) }}
            </option>
          </select></label
        >
        <label class="campo"
          >{{ t('cadastroEstoque.item.grupo') }}
          <select v-model="f.grupo" data-testid="item-grupo" @change="f.subgrupo = null">
            <option :value="0">{{ t('cadastroEstoque.escolha') }}</option>
            <option v-for="o in apoio.data.value?.grupos ?? []" :key="o.id" :value="o.id">
              {{ o.nome }}
            </option>
          </select></label
        >
        <label class="campo"
          >{{ t('cadastroEstoque.item.subgrupo') }}
          <select v-model="f.subgrupo">
            <option :value="null">{{ t('cadastroEstoque.nenhum') }}</option>
            <option v-for="o in subgrupos" :key="o.id" :value="o.id">{{ o.nome }}</option>
          </select></label
        >
      </fieldset>
      <fieldset>
        <legend>{{ t('cadastroEstoque.item.unidades') }}</legend>
        <label class="campo"
          >{{ t('cadastroEstoque.item.unidadeEstoque') }}
          <select v-model="f.unidadeEstoque" data-testid="item-unidadeEstoque">
            <option :value="0">{{ t('cadastroEstoque.escolha') }}</option>
            <option v-for="o in apoio.data.value?.unidades ?? []" :key="o.id" :value="o.id">
              {{ o.codigo }} · {{ o.nome }}
            </option>
          </select></label
        >
        <label v-for="k in UNIDADES" :key="k" class="campo"
          >{{ t(`cadastroEstoque.item.${k}`) }}
          <select v-model="f[k]">
            <option :value="null">{{ t('cadastroEstoque.nenhum') }}</option>
            <option v-for="o in apoio.data.value?.unidades ?? []" :key="o.id" :value="o.id">
              {{ o.codigo }} · {{ o.nome }}
            </option>
          </select></label
        >
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
            {{ nomesPa[p.principio] ?? p.principio }} · {{ p.concentracao ?? '' }} {{ sigla(p.unidade) }}
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
        <select :aria-label="t('cadastroEstoque.item.vias')" @change="incluirVia">
          <option value="">{{ t('cadastroEstoque.escolha') }}</option>
          <option v-for="o in apoio.data.value?.vias ?? []" :key="o.id" :value="String(o.id)">
            {{ o.nome }}
          </option>
        </select>
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
        <small v-for="m in doCampo('codigosBarras')" :key="m" class="erro">{{ m }}</small>
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
        <small v-for="m in doCampo('apresentacoes')" :key="m" class="erro">{{ m }}</small>
      </fieldset>
      <fieldset>
        <legend>{{ t('cadastroEstoque.item.estabilidades') }}</legend>
        <ul>
          <li v-for="(s, i) in f.estabilidades" :key="i">
            {{ s.condicao }} · {{ s.horas }} {{ t('cadastroEstoque.item.horas') }}
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
