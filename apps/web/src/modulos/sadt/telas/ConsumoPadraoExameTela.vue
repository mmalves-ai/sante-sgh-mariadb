<script setup lang="ts">
// Consumo padrão de insumos por exame (F8, 05-SADT linha 22): `/sadt/consumo-padrao`. Duas abas na mesma tela:
//   - Cadastro: o exame e o setor (vazio: todos) por SanteSelecao, os itens (produto por busca de 3 letras ou código,
//     ou kit), a quantidade e se o executante pode ajustar; a marca de pacote tira o lançamento na conta (o material
//     está no preço do exame, prática TISS). A tela confere na hora (ao menos um item, nada repetido, quantidade > 0);
//     desativar nunca apaga (o consumo já baixado segue ligado ao cadastro).
//   - Realização: os exames dos últimos 14 dias com consumo a baixar, por setor; a sugestão abre o kit em produtos, só o
//     ajustável aceita outra quantidade (zero: não usado) e o executante pode tirar um item da cobrança. O local de
//     estoque fica lembrado no navegador. A baixa e o lançamento na conta vão na mesma transação, pela API.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  type ConsumoPadrao,
  lerApoioConsumo,
  lerSugestaoConsumo,
  listarConsumosPadrao,
  listarPendentesConsumo,
  realizarConsumo,
  salvarConsumoPadrao,
} from '../api-consumo-padrao.js';
import { lerOpcoesCatalogo } from '../api-limites.js';
import { novaChave } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';

const { t } = useI18n();
const cliente = useQueryClient();
// Cada aba só para quem tem a permissão dela: o cadastro com o catálogo, a realização com o lançamento no setor.
const { permissoes } = usarSessao();
const podeCatalogo = computed(() => permissoes.value.has('sadt.catalogo.ler'));
const podeEditarCatalogo = computed(() => permissoes.value.has('sadt.catalogo.editar'));
const podeRealizacao = computed(() => permissoes.value.has('sadt.lancamento.ler'));
const podeLancar = computed(() => permissoes.value.has('sadt.lancamento.lancar'));
const rota = useRoute();
const aba = ref<'cadastro' | 'realizacao'>(rota.path.endsWith('/realizacao') ? 'realizacao' : 'cadastro');
watch(
  [podeCatalogo, podeRealizacao],
  ([cat, real]) => {
    if (aba.value === 'cadastro' && !cat && real) aba.value = 'realizacao';
    if (aba.value === 'realizacao' && !real && cat) aba.value = 'cadastro';
  },
  { immediate: true },
);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

const opcoes = useQuery({
  queryKey: ['sadt', 'catalogo', 'opcoes'],
  queryFn: lerOpcoesCatalogo,
  enabled: podeCatalogo,
});
const de = (xs: readonly { id: number; nome: string }[] | undefined, vazio: string) => [
  { valor: '', rotulo: vazio },
  ...(xs ?? []).map((x) => ({ valor: String(x.id), rotulo: x.nome })),
];
const exames = computed(() => de(opcoes.data.value?.exames, t('sadt.consumoPadrao.escolha')));
// Os setores vêm da leitura de apoio, que abre também a quem só realiza.
const setores = computed(() => de(apoio.data.value?.setores, t('sadt.consumoPadrao.todosSetores')));
const idOuNulo = (v: string) => (v ? Number(v) : null);
const numero = (v: string) => Number(v.trim().replace(',', '.'));

// ── Cadastro ─────────────────────────────────────────────────────────────────────────────────────────────
interface ItemForm {
  insumo: number | null;
  kit: number | null;
  nome: string;
  quantidade: string;
  ajustavel: boolean;
}
const form = ref({
  id: null as number | null,
  versao: null as number | null,
  exame: '',
  setor: '',
  descricao: '',
  baixaAutomatica: true,
  pacote: false,
  ativo: true,
});
const itens = ref<ItemForm[]>([]);
const novoItem = ref({
  tipo: 'produto' as 'produto' | 'kit',
  busca: '',
  produto: '',
  kit: '',
  quantidade: '1',
  ajustavel: false,
});
const tiposItem = computed(() =>
  (['produto', 'kit'] as const).map((v) => ({ valor: v, rotulo: t(`sadt.consumoPadrao.tipos.${v}`) })),
);

// A busca do produto só vai à API com 3 letras ou mais (ou o código); kits e locais vêm na mesma leitura.
const termo = ref('');
let espera: ReturnType<typeof setTimeout> | undefined;
watch(
  () => novoItem.value.busca,
  (b) => {
    clearTimeout(espera);
    espera = setTimeout(() => {
      termo.value = b.trim().length >= 3 ? b.trim() : '';
    }, 300);
  },
);
const apoio = useQuery({
  queryKey: computed(() => ['sadt', 'consumo-padrao', 'apoio', termo.value]),
  queryFn: () => lerApoioConsumo(termo.value || null),
  placeholderData: (anterior) => anterior,
});
const produtos = computed(() =>
  de(
    (termo.value ? (apoio.data.value?.produtos ?? []) : []).map((p) => ({
      id: p.id,
      nome: `${p.codigo} · ${p.nome}`,
    })),
    t('sadt.consumoPadrao.escolha'),
  ),
);
const kits = computed(() => de(apoio.data.value?.kits, t('sadt.consumoPadrao.escolha')));
const locais = computed(() => de(apoio.data.value?.locais, t('sadt.consumoPadrao.escolha')));

const chaveDe = (i: { insumo: number | null; kit: number | null }) =>
  i.insumo !== null ? `p${i.insumo}` : `k${i.kit ?? 0}`;
const novoItemEscolhido = computed(() =>
  novoItem.value.tipo === 'produto'
    ? { insumo: idOuNulo(novoItem.value.produto), kit: null }
    : { insumo: null, kit: idOuNulo(novoItem.value.kit) },
);
const novoItemQuantidadeValida = computed(() => numero(novoItem.value.quantidade) > 0);
const novoItemRepetido = computed(() => {
  const e = novoItemEscolhido.value;
  if (e.insumo === null && e.kit === null) return false;
  return itens.value.some((i) => chaveDe(i) === chaveDe(e));
});
const podeAdicionar = computed(() => {
  const e = novoItemEscolhido.value;
  return (e.insumo !== null || e.kit !== null) && novoItemQuantidadeValida.value && !novoItemRepetido.value;
});
function adicionarItem(): void {
  if (!podeAdicionar.value) return;
  const e = novoItemEscolhido.value;
  const nome =
    e.insumo !== null
      ? (produtos.value.find((p) => p.valor === String(e.insumo))?.rotulo ?? `#${e.insumo}`)
      : (kits.value.find((k) => k.valor === String(e.kit))?.rotulo ?? `#${e.kit}`);
  itens.value.push({
    ...e,
    nome,
    quantidade: novoItem.value.quantidade,
    ajustavel: novoItem.value.ajustavel,
  });
  novoItem.value = { ...novoItem.value, busca: '', produto: '', kit: '', quantidade: '1', ajustavel: false };
}
const itensInvalidos = computed(() => itens.value.some((i) => !(numero(i.quantidade) > 0)));
const cadastroValido = computed(() => !!form.value.exame && itens.value.length > 0 && !itensInvalidos.value);

const exameEscolhido = computed(() => idOuNulo(form.value.exame));
const consumos = useQuery({
  queryKey: computed(() => ['sadt', 'consumo-padrao', 'lista', exameEscolhido.value]),
  queryFn: () => listarConsumosPadrao(exameEscolhido.value),
  enabled: computed(() => podeCatalogo.value && exameEscolhido.value !== null),
});

function limpar(): void {
  form.value = {
    ...form.value,
    id: null,
    versao: null,
    setor: '',
    descricao: '',
    baixaAutomatica: true,
    pacote: false,
    ativo: true,
  };
  itens.value = [];
}
function editar(c: ConsumoPadrao): void {
  form.value = {
    id: c.id,
    versao: c.versao,
    exame: String(c.exame),
    setor: c.setor === null ? '' : String(c.setor),
    descricao: c.descricao ?? '',
    baixaAutomatica: c.baixaAutomatica,
    pacote: !c.lancamentoConta,
    ativo: c.ativo,
  };
  itens.value = c.itens.map((i) => ({
    insumo: i.insumo,
    kit: i.kit,
    nome: i.nome,
    quantidade: String(i.quantidade),
    ajustavel: i.ajustavel,
  }));
}

async function executar(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
  erro.value = null;
  mensagem.value = null;
  try {
    await fn();
    mensagem.value = ok;
    await cliente.invalidateQueries({ queryKey: ['sadt', 'consumo-padrao'] });
    return true;
  } catch (x) {
    erro.value = x;
    return false;
  }
}
const corpoDe = (ativo: boolean) => ({
  ...(form.value.id !== null && form.value.versao !== null
    ? { id: form.value.id, versao: form.value.versao }
    : {}),
  exame: Number(form.value.exame),
  setor: idOuNulo(form.value.setor),
  descricao: form.value.descricao.trim() || null,
  baixaAutomatica: form.value.baixaAutomatica,
  lancamentoConta: !form.value.pacote,
  ativo,
  itens: itens.value.map((i) => ({
    insumo: i.insumo,
    kit: i.kit,
    quantidade: numero(i.quantidade),
    ajustavel: i.ajustavel,
  })),
});
async function gravar(): Promise<void> {
  if (!cadastroValido.value) return;
  if (
    await executar(
      () => salvarConsumoPadrao(corpoDe(form.value.ativo), novaChave('consumo-padrao')),
      t('sadt.consumoPadrao.gravado'),
    )
  )
    limpar();
}
async function alternarAtivo(c: ConsumoPadrao): Promise<void> {
  editar(c);
  if (
    await executar(
      () => salvarConsumoPadrao(corpoDe(!c.ativo), novaChave('consumo-padrao.ativo')),
      t('sadt.consumoPadrao.gravado'),
    )
  )
    limpar();
}

// ── Realização ───────────────────────────────────────────────────────────────────────────────────────────
const CHAVE_LOCAL = 'sadt.consumo-padrao.local';
const lembrado = (() => {
  try {
    return localStorage.getItem(CHAVE_LOCAL) ?? '';
  } catch {
    return '';
  }
})();
const local = ref(lembrado);
watch(local, (v) => {
  try {
    localStorage.setItem(CHAVE_LOCAL, v);
  } catch {
    /* sem armazenamento no navegador: o local só não fica lembrado */
  }
});
const setorRealizacao = ref('');
const pendentes = useQuery({
  queryKey: computed(() => ['sadt', 'consumo-padrao', 'pendentes', setorRealizacao.value]),
  queryFn: () => listarPendentesConsumo(idOuNulo(setorRealizacao.value)),
  enabled: computed(() => podeRealizacao.value && aba.value === 'realizacao'),
});
const itemAberto = ref<number | null>(null);
const sugestao = useQuery({
  queryKey: computed(() => ['sadt', 'consumo-padrao', 'sugestao', itemAberto.value]),
  queryFn: () => lerSugestaoConsumo(itemAberto.value ?? 0),
  enabled: computed(() => itemAberto.value !== null),
});
const ajustes = ref<Record<number, { quantidade: string; cobrar: boolean }>>({});
watch(
  () => sugestao.data.value,
  (s) => {
    ajustes.value = Object.fromEntries(
      (s?.produtos ?? []).map((p) => [
        p.insumo,
        { quantidade: String(p.quantidade), cobrar: p.cobravelNoCadastro },
      ]),
    );
  },
  { immediate: true },
);
const vaiNaConta = computed(
  () => !!sugestao.data.value?.comAtendimento && !!sugestao.data.value.consumo?.lancamentoConta,
);
const ajusteInvalido = (insumo: number) => {
  const q = numero(ajustes.value[insumo]?.quantidade ?? '');
  return !(q >= 0) || Number.isNaN(q);
};
const podeRealizar = computed(() => {
  const s = sugestao.data.value;
  if (!s || !s.consumo || !s.consumo.baixaAutomatica || s.baixados.length > 0 || !local.value) return false;
  if (s.produtos.some((p) => ajusteInvalido(p.insumo))) return false;
  return s.produtos.some((p) => numero(ajustes.value[p.insumo]?.quantidade ?? '0') > 0);
});
async function realizar(): Promise<void> {
  const s = sugestao.data.value;
  if (!s || !podeRealizar.value) return;
  let r = null as { baixados: number; itensConta: number } | null;
  await executar(async () => {
    r = await realizarConsumo(
      s.item,
      {
        local: Number(local.value),
        ajustes: s.produtos.map((p) => ({
          insumo: p.insumo,
          quantidade: p.ajustavel ? numero(ajustes.value[p.insumo]?.quantidade ?? '0') : p.quantidade,
          ...(vaiNaConta.value && p.cobravelNoCadastro
            ? { cobrar: ajustes.value[p.insumo]?.cobrar ?? true }
            : {}),
        })),
      },
      novaChave('consumo-padrao.realizar'),
    );
  }, '');
  if (r) mensagem.value = t('sadt.consumoPadrao.realizado', r);
}
</script>

<template>
  <section class="consumo" data-testid="consumo-padrao">
    <h1>{{ t('sadt.consumoPadrao.titulo') }}</h1>
    <p>{{ t('sadt.consumoPadrao.explicacao') }}</p>
    <div role="tablist" class="abas">
      <button
        v-if="podeCatalogo"
        role="tab"
        type="button"
        :aria-selected="aba === 'cadastro'"
        data-testid="consumo-aba-cadastro"
        @click="aba = 'cadastro'"
      >
        {{ t('sadt.consumoPadrao.abaCadastro') }}
      </button>
      <button
        v-if="podeRealizacao"
        role="tab"
        type="button"
        :aria-selected="aba === 'realizacao'"
        data-testid="consumo-aba-realizacao"
        @click="aba = 'realizacao'"
      >
        {{ t('sadt.consumoPadrao.abaRealizacao') }}
      </button>
    </div>
    <p v-if="mensagem" role="status" data-testid="consumo-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />

    <div v-if="aba === 'cadastro' && podeCatalogo" role="tabpanel" data-testid="consumo-cadastro">
      <p v-if="!podeEditarCatalogo" role="note" data-testid="consumo-so-leitura">
        {{ t('sadt.consumoPadrao.semPermissaoCadastro') }}
      </p>
      <div class="linha">
        <SanteSelecao
          v-model="form.exame"
          :rotulo="t('sadt.consumoPadrao.exame')"
          :opcoes="exames"
          busca
          data-testid="consumo-exame"
        />
        <SanteSelecao
          v-model="form.setor"
          :rotulo="t('sadt.consumoPadrao.setor')"
          :opcoes="setores"
          data-testid="consumo-setor"
        />
        <label
          >{{ t('sadt.consumoPadrao.descricao')
          }}<input v-model="form.descricao" maxlength="150" data-testid="consumo-descricao"
        /></label>
      </div>
      <div class="linha">
        <label
          ><input v-model="form.baixaAutomatica" type="checkbox" data-testid="consumo-baixa-automatica" />
          {{ t('sadt.consumoPadrao.baixaAutomatica') }}</label
        >
        <label
          ><input v-model="form.pacote" type="checkbox" data-testid="consumo-pacote" />
          {{ t('sadt.consumoPadrao.pacote') }}</label
        >
      </div>

      <fieldset data-testid="consumo-novo-item">
        <legend>{{ t('sadt.consumoPadrao.itens') }}</legend>
        <div class="linha">
          <SanteSelecao
            v-model="novoItem.tipo"
            :rotulo="t('sadt.consumoPadrao.tipoItem')"
            :opcoes="tiposItem"
            data-testid="consumo-item-tipo"
          />
          <template v-if="novoItem.tipo === 'produto'">
            <label
              >{{ t('sadt.consumoPadrao.buscarProduto')
              }}<input v-model="novoItem.busca" type="search" data-testid="consumo-item-busca"
            /></label>
            <SanteSelecao
              v-model="novoItem.produto"
              :rotulo="t('sadt.consumoPadrao.produto')"
              :opcoes="produtos"
              :desabilitado="!termo"
              data-testid="consumo-item-produto"
            />
          </template>
          <SanteSelecao
            v-else
            v-model="novoItem.kit"
            :rotulo="t('sadt.consumoPadrao.kit')"
            :opcoes="kits"
            data-testid="consumo-item-kit"
          />
          <label
            >{{ t('sadt.consumoPadrao.quantidade')
            }}<input
              v-model="novoItem.quantidade"
              inputmode="decimal"
              :aria-invalid="!novoItemQuantidadeValida"
              data-testid="consumo-item-quantidade"
          /></label>
          <label
            ><input v-model="novoItem.ajustavel" type="checkbox" data-testid="consumo-item-ajustavel" />
            {{ t('sadt.consumoPadrao.ajustavel') }}</label
          >
          <SanteBotao
            :rotulo="t('sadt.consumoPadrao.adicionarItem')"
            variante="secundario"
            :desabilitado="!podeAdicionar"
            data-testid="consumo-item-adicionar"
            @acionar="adicionarItem"
          />
        </div>
        <p v-if="novoItemRepetido" role="alert" data-testid="consumo-item-repetido">
          {{ t('sadt.consumoPadrao.itemRepetido') }}
        </p>
        <p v-if="!novoItemQuantidadeValida" role="alert">{{ t('sadt.consumoPadrao.quantidadeInvalida') }}</p>
        <p v-if="itens.length === 0">{{ t('sadt.consumoPadrao.semItens') }}</p>
        <ul data-testid="consumo-itens">
          <li v-for="(i, k) in itens" :key="chaveDe(i)" :data-testid="`consumo-item-${chaveDe(i)}`">
            {{ i.nome }}
            <label
              >{{ t('sadt.consumoPadrao.quantidade')
              }}<input
                v-model="i.quantidade"
                inputmode="decimal"
                :aria-invalid="!(numero(i.quantidade) > 0)"
                :data-testid="`consumo-item-quantidade-${chaveDe(i)}`"
            /></label>
            <label
              ><input v-model="i.ajustavel" type="checkbox" />
              {{ t('sadt.consumoPadrao.ajustavelCurto') }}</label
            >
            <SanteBotao
              :rotulo="t('sadt.consumoPadrao.remover')"
              variante="texto"
              @acionar="itens.splice(k, 1)"
            />
          </li>
        </ul>
      </fieldset>
      <p v-if="form.id !== null" data-testid="consumo-editando">
        {{ t('sadt.consumoPadrao.editando', { id: form.id }) }}
      </p>
      <div class="linha">
        <SanteBotao
          v-if="podeEditarCatalogo"
          :rotulo="t('sadt.consumoPadrao.gravar')"
          :desabilitado="!cadastroValido"
          data-testid="consumo-gravar"
          @acionar="gravar"
        />
        <SanteBotao
          v-if="form.id !== null || itens.length"
          :rotulo="t('sadt.consumoPadrao.novo')"
          variante="texto"
          @acionar="limpar"
        />
      </div>

      <section v-if="exameEscolhido !== null" data-testid="consumo-cadastrados">
        <h2>{{ t('sadt.consumoPadrao.cadastrados') }}</h2>
        <ErroSadt v-if="consumos.isError.value" :erro="consumos.error.value" />
        <p v-if="(consumos.data.value?.itens ?? []).length === 0">{{ t('sadt.consumoPadrao.nenhum') }}</p>
        <ul>
          <li
            v-for="c in consumos.data.value?.itens ?? []"
            :key="c.id"
            :class="{ inativa: !c.ativo }"
            :data-testid="`consumo-${c.id}`"
          >
            {{ c.setorNome ?? t('sadt.consumoPadrao.todosSetores') }} ·
            {{
              c.itens
                .map((i) =>
                  t('sadt.consumoPadrao.itemQuantidade', { nome: i.nome, quantidade: i.quantidade }),
                )
                .join(', ')
            }}
            <span v-if="!c.lancamentoConta"> · {{ t('sadt.consumoPadrao.pacoteCurto') }}</span>
            <span v-if="!c.baixaAutomatica"> · {{ t('sadt.consumoPadrao.semBaixa') }}</span>
            <span v-if="!c.ativo"> · {{ t('sadt.consumoPadrao.inativo') }}</span>
            <SanteBotao
              :rotulo="t('sadt.consumoPadrao.editar')"
              variante="texto"
              :data-testid="`consumo-editar-${c.id}`"
              @acionar="editar(c)"
            />
            <SanteBotao
              v-if="podeEditarCatalogo"
              :rotulo="c.ativo ? t('sadt.consumoPadrao.desativar') : t('sadt.consumoPadrao.reativar')"
              variante="texto"
              @acionar="alternarAtivo(c)"
            />
          </li>
        </ul>
      </section>
    </div>

    <div v-else-if="aba === 'realizacao' && podeRealizacao" role="tabpanel" data-testid="consumo-realizacao">
      <div class="linha">
        <SanteSelecao
          v-model="setorRealizacao"
          :rotulo="t('sadt.consumoPadrao.setor')"
          :opcoes="setores"
          data-testid="consumo-realizacao-setor"
        />
        <SanteSelecao
          v-model="local"
          :rotulo="t('sadt.consumoPadrao.local')"
          :opcoes="locais"
          data-testid="consumo-local"
        />
      </div>
      <h2>{{ t('sadt.consumoPadrao.pendentes') }}</h2>
      <ErroSadt v-if="pendentes.isError.value" :erro="pendentes.error.value" />
      <p v-if="(pendentes.data.value?.itens ?? []).length === 0">
        {{ t('sadt.consumoPadrao.nenhumPendente') }}
      </p>
      <ul data-testid="consumo-pendentes">
        <li
          v-for="p in pendentes.data.value?.itens ?? []"
          :key="p.item"
          :class="{ aberto: itemAberto === p.item }"
          :data-testid="`consumo-pendente-${p.item}`"
        >
          {{ p.exame }} · {{ p.requisicao }}
          <template v-if="p.paciente"> · {{ t('sadt.consumoPadrao.paciente') }}: {{ p.paciente }}</template>
          <template v-if="p.setor"> · {{ p.setor }}</template>
          <SanteBotao
            :rotulo="t('sadt.consumoPadrao.conferir')"
            variante="secundario"
            :data-testid="`consumo-conferir-${p.item}`"
            @acionar="itemAberto = p.item"
          />
        </li>
      </ul>

      <section v-if="sugestao.data.value" data-testid="consumo-sugestao">
        <h2>{{ sugestao.data.value.exame }}</h2>
        <ErroSadt v-if="sugestao.isError.value" :erro="sugestao.error.value" />
        <p v-if="!sugestao.data.value.consumo" role="alert">{{ t('sadt.consumoPadrao.semConsumo') }}</p>
        <p v-else-if="!sugestao.data.value.consumo.baixaAutomatica" role="alert">
          {{ t('sadt.consumoPadrao.baixaManual') }}
        </p>
        <p v-if="!sugestao.data.value.comAtendimento">{{ t('sadt.consumoPadrao.semAtendimento') }}</p>
        <template v-if="sugestao.data.value.baixados.length">
          <h3>{{ t('sadt.consumoPadrao.baixados') }}</h3>
          <ul data-testid="consumo-baixados">
            <li v-for="b in sugestao.data.value.baixados" :key="b.insumo">
              {{ t('sadt.consumoPadrao.itemQuantidade', { nome: b.nome, quantidade: b.quantidade }) }} ·
              {{ b.itemConta !== null ? t('sadt.consumoPadrao.naConta') : t('sadt.consumoPadrao.foraConta') }}
            </li>
          </ul>
        </template>
        <table v-else>
          <thead>
            <tr>
              <th scope="col">{{ t('sadt.consumoPadrao.produtoCol') }}</th>
              <th scope="col">{{ t('sadt.consumoPadrao.quantidade') }}</th>
              <th scope="col">{{ t('sadt.consumoPadrao.cobrar') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in sugestao.data.value.produtos"
              :key="p.insumo"
              :data-testid="`consumo-produto-${p.insumo}`"
            >
              <td>{{ p.nome }}</td>
              <td>
                <input
                  v-if="p.ajustavel && ajustes[p.insumo]"
                  v-model="ajustes[p.insumo]!.quantidade"
                  inputmode="decimal"
                  :aria-label="`${t('sadt.consumoPadrao.quantidade')} ${p.nome}`"
                  :aria-invalid="ajusteInvalido(p.insumo)"
                  :data-testid="`consumo-ajuste-${p.insumo}`"
                />
                <span v-else>{{ p.quantidade }}</span>
              </td>
              <td>
                <input
                  v-if="ajustes[p.insumo]"
                  v-model="ajustes[p.insumo]!.cobrar"
                  type="checkbox"
                  :disabled="!vaiNaConta || !p.cobravelNoCadastro"
                  :aria-label="`${t('sadt.consumoPadrao.cobrar')} ${p.nome}`"
                  :data-testid="`consumo-cobrar-${p.insumo}`"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!podeLancar" role="note" data-testid="consumo-sem-lancar">
          {{ t('sadt.consumoPadrao.semPermissaoRealizar') }}
        </p>
        <SanteBotao
          v-if="!sugestao.data.value.baixados.length && podeLancar"
          :rotulo="t('sadt.consumoPadrao.realizar')"
          :desabilitado="!podeRealizar"
          data-testid="consumo-realizar"
          @acionar="realizar"
        />
      </section>
    </div>
  </section>
</template>

<style scoped>
.consumo {
  display: grid;
  gap: 0.75rem;
}
.abas {
  display: flex;
  gap: 0.5rem;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
label {
  display: grid;
  gap: 0.25rem;
}
.inativa {
  opacity: 0.6;
}
/* Alvo de toque mínimo (WCAG 2.5.8). */
input[type='checkbox'] {
  inline-size: 1.5rem;
  block-size: 1.5rem;
}
</style>
