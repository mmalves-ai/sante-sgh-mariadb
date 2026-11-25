<script setup lang="ts">
// Cadastro da central de material esterilizado (CME; F7, 04-CME linha 115): `/cirurgia/cme/cadastro`. Uma tela com
// duas abas: os produtos reprocessáveis (com o alerta do limite do fabricante e a situação, nunca apagados) e as
// caixas, kits e pacotes avulsos com a composição em ordem de montagem (subir, descer, tirar, peça mestre, peça
// suspensa), as fases marcadas num clique e ordenadas pelo fluxo da CME e a foto de conferência. A validação roda na
// hora pelas mesmas regras do domínio que o servidor confere de novo.
import {
  conferirCadastroCaixa,
  conferirFases,
  conferirFotoCme,
  conferirProdutoReprocessavel,
  NATUREZAS_CAIXA,
  ordenarFases,
  type ProdutoDaComposicao,
  SITUACOES_PRODUTO_REPROCESSAVEL,
  TIPOS_PRODUTO_REPROCESSAVEL,
} from '@sgh/dominio-cirurgia';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  enviarFotoCme,
  gravarCaixaCadastro,
  gravarProdutoReprocessavel,
  lerCaixaCadastro,
  lerFotoCme,
  lerPainelCadastroCme,
  type ProdutoReprocessavel,
  situacaoCaixaCadastro,
  situacaoProdutoReprocessavel,
} from '../api-cme-cadastro.js';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const CHAVE = ['cirurgia', 'cme', 'cadastro'];
const painel = useQuery({ queryKey: CHAVE, queryFn: lerPainelCadastroCme });
const aba = ref<'produtos' | 'caixas'>('produtos');
const aviso = ref('');
const erro = ref<unknown>(null);

const acao = useMutation({
  mutationFn: (fn: () => Promise<unknown>) => fn(),
  onSuccess: () => {
    erro.value = null;
    aviso.value = t('cirurgia.cmeCadastro.salvo');
    void cliente.invalidateQueries({ queryKey: CHAVE });
  },
  onError: (e) => {
    erro.value = e;
    aviso.value = '';
  },
});

const vazioOpc = computed(() => ({ valor: null, rotulo: t('cirurgia.cmeCadastro.nenhum_') }));
const opc = (l: readonly { id: number; descricao?: string; nome?: string }[] | undefined) => [
  vazioOpc.value,
  ...(l ?? []).map((x) => ({ valor: x.id, rotulo: x.descricao ?? x.nome ?? String(x.id) })),
];
const opcMetodos = computed(() => opc(painel.data.value?.metodos));
const opcEmbalagens = computed(() => opc(painel.data.value?.embalagens));
const opcSetores = computed(() => opc(painel.data.value?.setores));
const opcInsumos = computed(() => opc(painel.data.value?.insumos));
const opcProdutos = computed(() =>
  opc(
    (painel.data.value?.produtos ?? [])
      .filter((p) => p.situacao === 'ativo')
      .map((p) => ({ id: p.id, descricao: `${p.descricao}${p.codigoBarras ? ` · ${p.codigoBarras}` : ''}` })),
  ),
);
const opcTipos = computed(() =>
  TIPOS_PRODUTO_REPROCESSAVEL.map((v) => ({ valor: v, rotulo: t(`cirurgia.cmeCadastro.tipos.${v}`) })),
);
const opcNaturezas = computed(() =>
  NATUREZAS_CAIXA.map((v) => ({ valor: v, rotulo: t(`cirurgia.cmeCadastro.naturezas.${v}`) })),
);
const opcSituacoes = computed(() =>
  SITUACOES_PRODUTO_REPROCESSAVEL.map((v) => ({
    valor: v,
    rotulo: t(`cirurgia.cmeCadastro.situacoes.${v}`),
  })),
);
const opcOrigens = computed(() =>
  (['produto', 'insumo'] as const).map((v) => ({ valor: v, rotulo: t(`cirurgia.cmeCadastro.origens.${v}`) })),
);
const catalogo = computed(() => painel.data.value?.fases ?? []);
const numOuNull = (v: unknown): number | null =>
  v === '' || v === null || v === undefined ? null : Number(v);

// ── Fases (marcadas num clique; a ordem é a do fluxo) ──────────────────────────────────────────────────────────
type Fases = Record<number, { marcada: boolean; obrigatoria: boolean }>;
const fasesDe = (lidas: readonly { fase: number; obrigatoria: boolean }[]): Fases =>
  Object.fromEntries(lidas.map((f) => [f.fase, { marcada: true, obrigatoria: f.obrigatoria }]));
const escolhidas = (f: Fases) =>
  ordenarFases(
    Object.entries(f)
      .filter(([, v]) => v.marcada)
      .map(([k, v]) => ({ fase: Number(k), obrigatoria: v.obrigatoria })),
    catalogo.value,
  );
const marcar = (f: Fases, id: number, marcada: boolean) => {
  f[id] = { marcada, obrigatoria: f[id]?.obrigatoria ?? true };
};

// ── Produto reprocessável ──────────────────────────────────────────────────────────────────────────────────────
const produtoVazio = () => ({
  id: null as number | null,
  versao: 0,
  contador: 0,
  descricao: '',
  tipo: 'instrumental' as string | null,
  codigoBarras: '',
  metodo: null as number | null,
  embalagem: null as number | null,
  guarda: null as number | null,
  limite: '' as string | number,
  validadeDias: '' as string | number,
  tempoMinutos: '' as string | number,
  temperatura: '' as string | number,
  tecnicaPreparo: '',
  conservacao: '',
  fases: {} as Fases,
});
const p = reactive(produtoVazio());
const problemasProduto = computed(() =>
  [
    ...conferirProdutoReprocessavel({
      descricao: p.descricao,
      tipo: p.tipo ?? '',
      codigoBarras: p.codigoBarras.trim() || null,
      limiteReprocessamentos: numOuNull(p.limite),
      contadorReprocessamentos: p.contador,
      validadeDias: numOuNull(p.validadeDias),
      tempoMinutos: numOuNull(p.tempoMinutos),
      temperaturaCelsius: numOuNull(p.temperatura),
    }),
    ...conferirFases(escolhidas(p.fases), catalogo.value),
  ].map((x) => x.mensagem),
);
const editarProduto = (x: ProdutoReprocessavel) =>
  Object.assign(p, {
    id: x.id,
    versao: x.versao,
    contador: x.contadorReprocessamentos,
    descricao: x.descricao,
    tipo: x.tipo,
    codigoBarras: x.codigoBarras ?? '',
    metodo: x.metodo,
    embalagem: x.embalagem,
    guarda: x.guarda,
    limite: x.limiteReprocessamentos ?? '',
    validadeDias: x.validadeDias ?? '',
    tempoMinutos: x.tempoMinutos ?? '',
    temperatura: x.temperaturaCelsius ?? '',
    tecnicaPreparo: x.tecnicaPreparo ?? '',
    conservacao: x.conservacao ?? '',
    fases: fasesDe(x.fases),
  });
const salvarProduto = () =>
  acao.mutate(async () => {
    await gravarProdutoReprocessavel(p.id, {
      ...(p.id ? { versao: p.versao } : {}),
      descricao: p.descricao.trim(),
      tipo: p.tipo ?? '',
      codigoBarras: p.codigoBarras.trim() || null,
      metodo: p.metodo,
      embalagem: p.embalagem,
      guarda: p.guarda,
      limiteReprocessamentos: numOuNull(p.limite),
      validadeDias: numOuNull(p.validadeDias),
      tempoMinutos: numOuNull(p.tempoMinutos),
      temperaturaCelsius: numOuNull(p.temperatura),
      tecnicaPreparo: p.tecnicaPreparo.trim() || null,
      conservacao: p.conservacao.trim() || null,
      fases: escolhidas(p.fases),
    });
    Object.assign(p, produtoVazio());
  });
const novaSituacao = reactive<Record<number, string | null>>({});
const mudarSituacao = (x: ProdutoReprocessavel) => {
  const s = novaSituacao[x.id];
  if (s) acao.mutate(() => situacaoProdutoReprocessavel(x.id, x.versao, s));
};

// ── Caixa, kit e pacote avulso ─────────────────────────────────────────────────────────────────────────────────
interface PecaTela {
  id?: number;
  origem: 'produto' | 'insumo' | null;
  produto: number | null;
  insumo: number | null;
  bem: number | null;
  descricao: string;
  quantidade: number | string;
  pecaMestre: boolean;
  codigoBarras: string;
  suspenso: boolean;
  temFoto: boolean;
  versao: number;
}
const pecaVazia = (): PecaTela => ({
  origem: 'produto',
  produto: null,
  insumo: null,
  bem: null,
  descricao: '',
  quantidade: 1,
  pecaMestre: false,
  codigoBarras: '',
  suspenso: false,
  temFoto: false,
  versao: 0,
});
const caixaVazia = () => ({
  id: null as number | null,
  versao: 0,
  reprocessamentos: 0,
  codigo: '',
  descricao: '',
  natureza: 'caixa' as string | null,
  metodo: null as number | null,
  embalagem: null as number | null,
  setor: null as number | null,
  validadeDias: '' as string | number,
  controla: false,
  limite: '' as string | number,
  temFoto: false,
  pecas: [pecaVazia()] as PecaTela[],
  fases: {} as Fases,
});
const cx = reactive(caixaVazia());
const produtosDaComposicao = computed(
  () =>
    new Map<number, ProdutoDaComposicao>(
      (painel.data.value?.produtos ?? []).map((x) => [
        x.id,
        { descricao: x.descricao, situacao: x.situacao },
      ]),
    ),
);
const pecasEnvio = () =>
  cx.pecas.map((x) => ({
    ...(x.id ? { id: x.id } : {}),
    produto: x.origem === 'produto' ? x.produto : null,
    insumo: x.origem === 'insumo' ? x.insumo : null,
    bem: x.origem === null ? x.bem : null,
    quantidade: Number(x.quantidade),
    pecaMestre: x.pecaMestre,
    codigoBarras: x.codigoBarras.trim() || null,
    suspenso: x.suspenso,
  }));
const problemasCaixa = computed(() =>
  [
    ...conferirCadastroCaixa(
      {
        codigo: cx.codigo,
        descricao: cx.descricao,
        natureza: cx.natureza ?? '',
        validadeDias: numOuNull(cx.validadeDias),
        controlaReprocessamentos: cx.controla,
        limiteReprocessamentos: numOuNull(cx.limite),
        reprocessamentos: cx.reprocessamentos,
        pecas: pecasEnvio(),
      },
      produtosDaComposicao.value,
    ),
    ...conferirFases(escolhidas(cx.fases), catalogo.value),
  ].map((x) => x.mensagem),
);
const editarCaixa = (id: number) =>
  acao.mutate(async () => {
    const c = await lerCaixaCadastro(id);
    Object.assign(cx, {
      id: c.id,
      versao: c.versao,
      reprocessamentos: c.reprocessamentos,
      codigo: c.codigo,
      descricao: c.descricao,
      natureza: c.natureza,
      metodo: c.metodo,
      embalagem: c.embalagem,
      setor: c.setor,
      validadeDias: c.validadeDias ?? '',
      controla: c.controlaReprocessamentos,
      limite: c.limiteReprocessamentos ?? '',
      temFoto: c.temFoto,
      pecas: c.pecas.map((x) => ({
        ...x,
        origem: x.produto !== null ? 'produto' : x.insumo !== null ? 'insumo' : null,
        codigoBarras: x.codigoBarras ?? '',
      })),
      fases: fasesDe(c.fases),
    });
    aviso.value = '';
  });
const mover = (i: number, d: -1 | 1) => {
  const j = i + d;
  if (j < 0 || j >= cx.pecas.length) return;
  const [x] = cx.pecas.splice(i, 1);
  cx.pecas.splice(j, 0, x!);
};
const salvarCaixa = () =>
  acao.mutate(async () => {
    await gravarCaixaCadastro(cx.id, {
      ...(cx.id ? { versao: cx.versao } : {}),
      codigo: cx.codigo.trim(),
      descricao: cx.descricao.trim(),
      natureza: cx.natureza ?? '',
      metodo: cx.metodo,
      embalagem: cx.embalagem,
      setor: cx.setor,
      especialidade: null,
      validadeDias: numOuNull(cx.validadeDias),
      controlaReprocessamentos: cx.controla,
      limiteReprocessamentos: cx.controla ? numOuNull(cx.limite) : null,
      pecas: pecasEnvio(),
      fases: escolhidas(cx.fases),
    });
    Object.assign(cx, caixaVazia());
  });
const alternarCaixa = (id: number, versao: number, ativo: boolean) =>
  acao.mutate(() => situacaoCaixaCadastro(id, versao, !ativo));

// ── Foto de conferência ────────────────────────────────────────────────────────────────────────────────────────
const fotoAberta = ref<{ titulo: string; src: string } | null>(null);
const fotoErro = ref('');
const base64 = (b: Uint8Array) => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};
const enviarFoto = async (alvo: 'caixas' | 'pecas', id: number, versao: number, ev: Event) => {
  const arq = (ev.target as HTMLInputElement).files?.[0];
  if (!arq) return;
  const b = new Uint8Array(await arq.arrayBuffer());
  const p = conferirFotoCme(b);
  fotoErro.value = p.map((x) => x.mensagem).join(' ');
  if (p.length) return;
  acao.mutate(async () => {
    await enviarFotoCme(alvo, id, { versao, conteudo: base64(b), nomeOriginal: arq.name });
    if (cx.id) editarCaixa(cx.id);
  });
};
const verFoto = (alvo: 'caixas' | 'pecas', id: number, nome: string) =>
  acao.mutate(async () => {
    const f = await lerFotoCme(alvo, id);
    fotoAberta.value = {
      titulo: t('cirurgia.cmeCadastro.fotoDa', { nome }),
      src: `data:${f.tipo};base64,${f.conteudo}`,
    };
  });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cme-cadastro-titulo" data-testid="tela-cme-cadastro">
    <h1 id="cme-cadastro-titulo">{{ t('cirurgia.cmeCadastro.titulo') }}</h1>
    <p>{{ t('cirurgia.cmeCadastro.texto') }}</p>
    <ErroCirurgia v-if="painel.isError.value" :erro="painel.error.value" />
    <ErroCirurgia v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="cme-cad-aviso">{{ aviso }}</p>

    <div role="tablist" class="filtros">
      <button
        type="button"
        role="tab"
        :aria-selected="aba === 'produtos'"
        data-testid="cme-aba-produtos"
        @click="aba = 'produtos'"
      >
        {{ t('cirurgia.cmeCadastro.abaProdutos') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="aba === 'caixas'"
        data-testid="cme-aba-caixas"
        @click="aba = 'caixas'"
      >
        {{ t('cirurgia.cmeCadastro.abaCaixas') }}
      </button>
    </div>

    <p v-if="!painel.data.value" role="status">{{ t('cirurgia.carregando') }}</p>

    <!-- ── Produtos reprocessáveis ── -->
    <template v-else-if="aba === 'produtos'">
      <form class="filtros" data-testid="cme-produto-form" @submit.prevent="salvarProduto">
        <label
          >{{ t('cirurgia.cmeCadastro.descricao') }}
          <input v-model="p.descricao" maxlength="150" data-testid="cme-produto-descricao"
        /></label>
        <SanteSelecao
          v-model="p.tipo"
          :rotulo="t('cirurgia.cmeCadastro.tipo')"
          :opcoes="opcTipos"
          data-testid="cme-produto-tipo"
        />
        <label
          >{{ t('cirurgia.cmeCadastro.codigoBarras') }}
          <input v-model="p.codigoBarras" maxlength="100" data-testid="cme-produto-codigo-barras"
        /></label>
        <SanteSelecao
          v-model="p.metodo"
          :rotulo="t('cirurgia.cmeCadastro.metodo')"
          :opcoes="opcMetodos"
          data-testid="cme-produto-metodo"
        />
        <SanteSelecao
          v-model="p.embalagem"
          :rotulo="t('cirurgia.cmeCadastro.embalagem')"
          :opcoes="opcEmbalagens"
          data-testid="cme-produto-embalagem"
        />
        <SanteSelecao
          v-model="p.guarda"
          :rotulo="t('cirurgia.cmeCadastro.guarda')"
          :opcoes="opcSetores"
          data-testid="cme-produto-guarda"
        />
        <label
          >{{ t('cirurgia.cmeCadastro.limite') }}
          <input v-model="p.limite" type="number" min="1" data-testid="cme-produto-limite"
        /></label>
        <p v-if="p.id">{{ t('cirurgia.cmeCadastro.contador') }}: {{ p.contador }}</p>
        <label
          >{{ t('cirurgia.cmeCadastro.validadeDias') }}
          <input v-model="p.validadeDias" type="number" min="1" data-testid="cme-produto-validade"
        /></label>
        <label
          >{{ t('cirurgia.cmeCadastro.tempoMinutos') }}
          <input v-model="p.tempoMinutos" type="number" min="1" data-testid="cme-produto-tempo"
        /></label>
        <label
          >{{ t('cirurgia.cmeCadastro.temperatura') }}
          <input v-model="p.temperatura" type="number" step="0.1" data-testid="cme-produto-temperatura"
        /></label>
        <label
          >{{ t('cirurgia.cmeCadastro.tecnicaPreparo') }}
          <textarea v-model="p.tecnicaPreparo" rows="2" data-testid="cme-produto-tecnica"></textarea>
        </label>
        <label
          >{{ t('cirurgia.cmeCadastro.conservacao') }}
          <textarea v-model="p.conservacao" rows="2"></textarea>
        </label>
        <fieldset data-testid="cme-produto-fases">
          <legend>{{ t('cirurgia.cmeCadastro.fases') }}</legend>
          <p>{{ t('cirurgia.cmeCadastro.fasesTexto') }}</p>
          <span v-for="f in catalogo.filter((x) => x.ativo)" :key="f.id">
            <label
              ><input
                type="checkbox"
                :checked="!!p.fases[f.id]?.marcada"
                :data-testid="`cme-produto-fase-${f.id}`"
                @change="marcar(p.fases, f.id, ($event.target as HTMLInputElement).checked)"
              />
              {{ f.descricao
              }}<small v-if="f.exigeCiclo"> ({{ t('cirurgia.cmeCadastro.exigeCiclo') }})</small></label
            >
            <label v-if="p.fases[f.id]?.marcada"
              ><input v-model="p.fases[f.id]!.obrigatoria" type="checkbox" />
              {{ t('cirurgia.cmeCadastro.obrigatoria') }}</label
            >
          </span>
        </fieldset>
        <ul v-if="problemasProduto.length" class="problemas" data-testid="cme-produto-problemas">
          <li v-for="x in problemasProduto" :key="x">{{ x }}</li>
        </ul>
        <button
          type="submit"
          :disabled="problemasProduto.length > 0 || acao.isPending.value"
          data-testid="cme-produto-salvar"
        >
          {{ t('cirurgia.cmeCadastro.salvar') }}
        </button>
        <button v-if="p.id" type="button" @click="Object.assign(p, produtoVazio())">
          {{ t('cirurgia.cmeCadastro.novo') }}
        </button>
      </form>

      <p v-if="painel.data.value.produtos.length === 0" data-testid="cme-produtos-nenhum">
        {{ t('cirurgia.cmeCadastro.nenhum') }}
      </p>
      <table v-else class="tabela" data-testid="cme-tabela-produtos">
        <thead>
          <tr>
            <th scope="col">{{ t('cirurgia.cmeCadastro.descricao') }}</th>
            <th scope="col">{{ t('cirurgia.cmeCadastro.tipo') }}</th>
            <th scope="col">{{ t('cirurgia.cmeCadastro.contador') }}</th>
            <th scope="col">{{ t('cirurgia.cmeCadastro.fases') }}</th>
            <th scope="col">{{ t('cirurgia.cmeCadastro.situacao') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in painel.data.value.produtos" :key="x.id" :data-testid="`cme-produto-${x.id}`">
            <td>
              {{ x.descricao }}<br /><small>{{ x.codigoBarras }}</small>
            </td>
            <td>{{ t(`cirurgia.cmeCadastro.tipos.${x.tipo}`) }}</td>
            <td :data-testid="`cme-produto-alerta-${x.id}`">
              {{ x.contadorReprocessamentos
              }}{{ x.limiteReprocessamentos ? ` / ${x.limiteReprocessamentos}` : '' }} ·
              {{ t(`cirurgia.cmeCadastro.alertas.${x.alertaLimite}`) }}
            </td>
            <td>{{ x.fases.map((f) => f.descricao).join(' → ') }}</td>
            <td>{{ t(`cirurgia.cmeCadastro.situacoes.${x.situacao}`) }}</td>
            <td>
              <button
                v-if="x.situacao !== 'descartado'"
                type="button"
                :data-testid="`cme-produto-editar-${x.id}`"
                @click="editarProduto(x)"
              >
                {{ t('cirurgia.cmeCadastro.editar') }}
              </button>
              <template v-if="x.situacao !== 'descartado'">
                <SanteSelecao
                  :model-value="novaSituacao[x.id] ?? null"
                  @update:model-value="(v: unknown) => (novaSituacao[x.id] = v === null ? null : String(v))"
                  :rotulo="t('cirurgia.cmeCadastro.mudarSituacao')"
                  :opcoes="opcSituacoes.filter((o) => o.valor !== x.situacao)"
                  :data-testid="`cme-produto-situacao-${x.id}`"
                />
                <button
                  type="button"
                  :disabled="!novaSituacao[x.id] || acao.isPending.value"
                  :data-testid="`cme-produto-situacao-aplicar-${x.id}`"
                  @click="mudarSituacao(x)"
                >
                  {{ t('cirurgia.cmeCadastro.salvar') }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- ── Caixas, kits e pacotes avulsos ── -->
    <template v-else>
      <form class="filtros" data-testid="cme-caixa-form" @submit.prevent="salvarCaixa">
        <label
          >{{ t('cirurgia.cmeCadastro.codigo') }}
          <input v-model="cx.codigo" maxlength="30" data-testid="cme-caixa-codigo"
        /></label>
        <label
          >{{ t('cirurgia.cmeCadastro.descricao') }}
          <input v-model="cx.descricao" maxlength="150" data-testid="cme-caixa-descricao"
        /></label>
        <SanteSelecao
          v-model="cx.natureza"
          :rotulo="t('cirurgia.cmeCadastro.natureza')"
          :opcoes="opcNaturezas"
          data-testid="cme-caixa-natureza"
        />
        <SanteSelecao
          v-model="cx.metodo"
          :rotulo="t('cirurgia.cmeCadastro.metodo')"
          :opcoes="opcMetodos"
          data-testid="cme-caixa-metodo"
        />
        <SanteSelecao
          v-model="cx.embalagem"
          :rotulo="t('cirurgia.cmeCadastro.embalagem')"
          :opcoes="opcEmbalagens"
          data-testid="cme-caixa-embalagem"
        />
        <SanteSelecao
          v-model="cx.setor"
          :rotulo="t('cirurgia.cmeCadastro.setor')"
          :opcoes="opcSetores"
          data-testid="cme-caixa-setor"
        />
        <label
          >{{ t('cirurgia.cmeCadastro.validadeDias') }}
          <input v-model="cx.validadeDias" type="number" min="1" data-testid="cme-caixa-validade"
        /></label>
        <label
          ><input v-model="cx.controla" type="checkbox" data-testid="cme-caixa-controla" />
          {{ t('cirurgia.cmeCadastro.controla') }}</label
        >
        <label v-if="cx.controla"
          >{{ t('cirurgia.cmeCadastro.limite') }}
          <input v-model="cx.limite" type="number" min="1" data-testid="cme-caixa-limite"
        /></label>

        <fieldset data-testid="cme-caixa-pecas">
          <legend>{{ t('cirurgia.cmeCadastro.composicao') }}</legend>
          <div v-for="(x, i) in cx.pecas" :key="x.id ?? `nova-${i}`" :data-testid="`cme-peca-${i}`">
            <strong>{{ t('cirurgia.cmeCadastro.peca', { n: i + 1 }) }}</strong>
            <SanteSelecao
              v-model="x.origem"
              :rotulo="t('cirurgia.cmeCadastro.origem')"
              :opcoes="opcOrigens"
              :data-testid="`cme-peca-${i}-origem`"
            />
            <SanteSelecao
              v-if="x.origem === 'produto'"
              v-model="x.produto"
              :rotulo="t('cirurgia.cmeCadastro.item')"
              :opcoes="opcProdutos"
              :data-testid="`cme-peca-${i}-produto`"
            />
            <SanteSelecao
              v-else-if="x.origem === 'insumo'"
              v-model="x.insumo"
              :rotulo="t('cirurgia.cmeCadastro.item')"
              :opcoes="opcInsumos"
              :data-testid="`cme-peca-${i}-insumo`"
            />
            <span v-else>{{ x.descricao }}</span>
            <label
              >{{ t('cirurgia.cmeCadastro.quantidade') }}
              <input
                v-model="x.quantidade"
                type="number"
                min="0"
                step="any"
                :data-testid="`cme-peca-${i}-quantidade`"
            /></label>
            <label
              >{{ t('cirurgia.cmeCadastro.codigoBarras') }} <input v-model="x.codigoBarras" maxlength="40"
            /></label>
            <label
              ><input v-model="x.pecaMestre" type="checkbox" :data-testid="`cme-peca-${i}-mestre`" />
              {{ t('cirurgia.cmeCadastro.pecaMestre') }}</label
            >
            <label
              ><input v-model="x.suspenso" type="checkbox" :data-testid="`cme-peca-${i}-suspensa`" />
              {{ t('cirurgia.cmeCadastro.suspenso') }}</label
            >
            <button
              type="button"
              :disabled="i === 0"
              :data-testid="`cme-peca-${i}-subir`"
              @click="mover(i, -1)"
            >
              {{ t('cirurgia.cmeCadastro.subir') }}
            </button>
            <button
              type="button"
              :disabled="i === cx.pecas.length - 1"
              :data-testid="`cme-peca-${i}-descer`"
              @click="mover(i, 1)"
            >
              {{ t('cirurgia.cmeCadastro.descer') }}
            </button>
            <button type="button" :data-testid="`cme-peca-${i}-tirar`" @click="cx.pecas.splice(i, 1)">
              {{ t('cirurgia.cmeCadastro.tirar') }}
            </button>
            <template v-if="x.id">
              <label
                >{{ t('cirurgia.cmeCadastro.enviarFoto') }}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  :data-testid="`cme-peca-${i}-foto`"
                  @change="enviarFoto('pecas', x.id, x.versao, $event)"
              /></label>
              <button v-if="x.temFoto" type="button" @click="verFoto('pecas', x.id, x.descricao)">
                {{ t('cirurgia.cmeCadastro.verFoto') }}
              </button>
            </template>
          </div>
          <button type="button" data-testid="cme-nova-peca" @click="cx.pecas.push(pecaVazia())">
            {{ t('cirurgia.cmeCadastro.novaPeca') }}
          </button>
        </fieldset>

        <fieldset data-testid="cme-caixa-fases">
          <legend>{{ t('cirurgia.cmeCadastro.fases') }}</legend>
          <span v-for="f in catalogo.filter((x) => x.ativo)" :key="f.id">
            <label
              ><input
                type="checkbox"
                :checked="!!cx.fases[f.id]?.marcada"
                :data-testid="`cme-caixa-fase-${f.id}`"
                @change="marcar(cx.fases, f.id, ($event.target as HTMLInputElement).checked)"
              />
              {{ f.descricao }}</label
            >
            <label v-if="cx.fases[f.id]?.marcada"
              ><input v-model="cx.fases[f.id]!.obrigatoria" type="checkbox" />
              {{ t('cirurgia.cmeCadastro.obrigatoria') }}</label
            >
          </span>
        </fieldset>

        <template v-if="cx.id">
          <label
            >{{ t('cirurgia.cmeCadastro.enviarFoto') }}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              data-testid="cme-caixa-foto"
              @change="enviarFoto('caixas', cx.id, cx.versao, $event)"
          /></label>
          <button
            v-if="cx.temFoto"
            type="button"
            data-testid="cme-caixa-ver-foto"
            @click="verFoto('caixas', cx.id, cx.descricao)"
          >
            {{ t('cirurgia.cmeCadastro.verFoto') }}
          </button>
        </template>
        <p v-if="fotoErro" role="alert" data-testid="cme-foto-erro">{{ fotoErro }}</p>

        <ul v-if="problemasCaixa.length" class="problemas" data-testid="cme-caixa-problemas">
          <li v-for="x in problemasCaixa" :key="x">{{ x }}</li>
        </ul>
        <button
          type="submit"
          :disabled="problemasCaixa.length > 0 || acao.isPending.value"
          data-testid="cme-caixa-salvar"
        >
          {{ t('cirurgia.cmeCadastro.salvar') }}
        </button>
        <button v-if="cx.id" type="button" @click="Object.assign(cx, caixaVazia())">
          {{ t('cirurgia.cmeCadastro.novo') }}
        </button>
      </form>

      <figure v-if="fotoAberta" data-testid="cme-foto-aberta">
        <img :src="fotoAberta.src" :alt="fotoAberta.titulo" />
        <figcaption>{{ fotoAberta.titulo }}</figcaption>
      </figure>

      <p v-if="painel.data.value.caixas.length === 0" data-testid="cme-caixas-nenhuma">
        {{ t('cirurgia.cmeCadastro.nenhum') }}
      </p>
      <table v-else class="tabela" data-testid="cme-tabela-caixas">
        <thead>
          <tr>
            <th scope="col">{{ t('cirurgia.cmeCadastro.codigo') }}</th>
            <th scope="col">{{ t('cirurgia.cmeCadastro.descricao') }}</th>
            <th scope="col">{{ t('cirurgia.cmeCadastro.natureza') }}</th>
            <th scope="col">{{ t('cirurgia.cmeCadastro.pecas') }}</th>
            <th scope="col">{{ t('cirurgia.cmeCadastro.situacao') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in painel.data.value.caixas" :key="x.id" :data-testid="`cme-caixa-${x.id}`">
            <td>{{ x.codigo }}</td>
            <td>
              {{ x.descricao }}<small v-if="x.temFoto"> · {{ t('cirurgia.cmeCadastro.comFoto') }}</small>
            </td>
            <td>{{ t(`cirurgia.cmeCadastro.naturezas.${x.natureza}`) }}</td>
            <td>{{ x.pecas }}</td>
            <td>
              {{ x.ativo ? t('cirurgia.cmeCadastro.ativa') : t('cirurgia.cmeCadastro.inativa') }} ·
              {{ t(`cirurgia.cmeCadastro.alertas.${x.alertaLimite}`) }}
            </td>
            <td>
              <button type="button" :data-testid="`cme-caixa-editar-${x.id}`" @click="editarCaixa(x.id)">
                {{ t('cirurgia.cmeCadastro.editar') }}
              </button>
              <button
                type="button"
                :disabled="acao.isPending.value"
                :data-testid="`cme-caixa-situacao-${x.id}`"
                @click="alternarCaixa(x.id, x.versao, x.ativo)"
              >
                {{ x.ativo ? t('cirurgia.cmeCadastro.inativar') : t('cirurgia.cmeCadastro.ativar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
