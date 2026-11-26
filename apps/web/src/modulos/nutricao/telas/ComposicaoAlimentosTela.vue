<script setup lang="ts">
// Composição nutricional dos alimentos (F8, 04-HOT linha 142): a nutricionista escolhe o grupo e busca o alimento na
// tabela de composição (TACO 4ª ed., catálogo público carregado pela plataforma), vê os nutrientes por 100 g e na porção
// informada (a conta é a do domínio, composicaoDaPorcao, a mesma do servidor) e, com a permissão de quem mantém as
// preparações, liga o alimento ao gênero do estoque. Combos SanteSelecao com busca remota; textos em i18n.
import { PERMISSOES_NUTRICAO_CODIGOS as P } from '@sgh/contratos';
import { validarPorcao } from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { novaChaveNutricao } from '../api-nutricao.js';
import { buscarGeneros, type GeneroAlimenticio } from '../api-cardapio.js';
import {
  type AlimentoComposicao,
  type AlimentoResumo,
  buscarAlimentos,
  type GrupoAlimento,
  ligarGenero,
  lerAlimento,
  lerGruposAlimento,
} from '../api-composicao.js';
import ErroNutricao from '../componentes/ErroNutricao.vue';

const { t } = useI18n();
const { permissoes } = usarSessao();
const podeLigar = computed(() => permissoes.value.has(P.mapaFechar));

const grupos = ref<GrupoAlimento[]>([]);
const grupo = ref<number | null>(null);
const termoAlimento = ref('');
const achados = ref<AlimentoResumo[]>([]);
const alimentoId = ref<number | null>(null);
const porcaoTexto = ref('100');
const alimento = ref<AlimentoComposicao | null>(null);
const erro = ref<unknown>(null);
const aviso = ref('');

const termoGenero = ref('');
const generos = ref<GeneroAlimenticio[]>([]);
const generoId = ref<number | null>(null);
const gravando = ref(false);

const porcao = computed(() => Number(porcaoTexto.value.replace(',', '.')));
const porcaoErro = computed(() =>
  validarPorcao(porcao.value) ? t('nutricao.composicao.porcaoInvalida') : '',
);

const opcoesGrupo = computed(() => [
  { valor: null, rotulo: t('nutricao.composicao.todosGrupos') },
  ...grupos.value.map((g) => ({ valor: g.id, rotulo: g.descricao })),
]);
const opcoesAlimento = computed(() => {
  const lista = [...achados.value];
  const atual = alimento.value;
  if (atual && !lista.some((a) => a.id === atual.id)) lista.unshift(atual);
  return [
    { valor: null, rotulo: t('nutricao.composicao.escolhaAlimento') },
    ...lista.map((a) => ({ valor: a.id, rotulo: `${a.codigo} - ${a.descricao}` })),
  ];
});
const opcoesGenero = computed(() => {
  const lista = generos.value.map((g) => ({
    valor: g.id as number | null,
    rotulo: `${g.codigo} - ${g.nome}`,
  }));
  const ligado = alimento.value?.genero;
  if (ligado && !lista.some((o) => o.valor === ligado.id))
    lista.unshift({ valor: ligado.id, rotulo: `${ligado.codigo ?? ''} - ${ligado.nome ?? ''}` });
  return [{ valor: null, rotulo: t('nutricao.composicao.nenhumGenero') }, ...lista];
});
const TIPOS = ['energia', 'macronutriente', 'micronutriente', 'outro'] as const;
const porTipo = computed(() =>
  TIPOS.map((tipo) => ({
    tipo,
    itens: (alimento.value?.nutrientes ?? []).filter((n) => n.tipo === tipo),
  })).filter((g) => g.itens.length > 0),
);

async function tentar(fn: () => Promise<void>) {
  erro.value = null;
  try {
    await fn();
  } catch (e) {
    erro.value = e;
  }
}

async function buscar() {
  const termo = termoAlimento.value.trim();
  if (termo.length < 2 && grupo.value === null) {
    achados.value = [];
    return;
  }
  await tentar(async () => {
    achados.value = await buscarAlimentos(termo, grupo.value);
  });
}

async function carregarAlimento() {
  aviso.value = '';
  if (alimentoId.value === null || porcaoErro.value) {
    if (alimentoId.value === null) alimento.value = null;
    return;
  }
  const id = alimentoId.value;
  await tentar(async () => {
    alimento.value = await lerAlimento(id, porcao.value);
    generoId.value = alimento.value.genero?.id ?? null;
  });
}

async function gravarGenero(genero: number | null) {
  const a = alimento.value;
  if (!a) return;
  gravando.value = true;
  await tentar(async () => {
    await ligarGenero(a.id, genero, a.versao, novaChaveNutricao('composicao-genero'));
    await carregarAlimento();
    aviso.value = t('nutricao.composicao.ligado');
  });
  gravando.value = false;
}

watch(termoAlimento, () => void buscar());
watch(grupo, () => void buscar());
watch([alimentoId, porcaoTexto], () => void carregarAlimento());
watch(termoGenero, async (q) => {
  const termo = q.trim();
  if (termo.length < 2) return;
  await tentar(async () => {
    generos.value = await buscarGeneros(termo);
  });
});

onMounted(() =>
  tentar(async () => {
    grupos.value = await lerGruposAlimento();
  }),
);
</script>

<template>
  <main class="composicao" data-testid="tela-composicao">
    <h1>{{ t('nutricao.composicao.titulo') }}</h1>
    <p class="secundario">{{ t('nutricao.composicao.texto') }}</p>

    <ErroNutricao v-if="erro" :erro="erro" />
    <SanteAlerta v-if="aviso" variante="info" anunciar :texto="aviso" data-testid="composicao-aviso" />

    <div class="filtros">
      <SanteSelecao
        v-model="grupo"
        :rotulo="t('nutricao.composicao.grupo')"
        :opcoes="opcoesGrupo"
        data-testid="composicao-grupo"
      />
      <SanteSelecao
        v-model="alimentoId"
        :rotulo="t('nutricao.composicao.alimento')"
        :opcoes="opcoesAlimento"
        :buscar="(q: string) => (termoAlimento = q)"
        data-testid="composicao-alimento"
      />
      <SanteCampoTexto
        v-model="porcaoTexto"
        :rotulo="t('nutricao.composicao.porcao')"
        :max-bytes="7"
        data-testid="composicao-porcao"
      />
    </div>
    <p v-if="porcaoErro" role="alert" class="erro" data-testid="composicao-porcao-erro">{{ porcaoErro }}</p>

    <section v-if="alimento" data-testid="composicao-detalhe" :aria-label="alimento.descricao">
      <h2>{{ alimento.codigo }} - {{ alimento.descricao }}</h2>
      <p class="secundario" data-testid="composicao-fonte">
        {{ t('nutricao.composicao.fonte', { fonte: alimento.fonteNome, edicao: alimento.edicao }) }}
        <template v-if="alimento.fonte === 'taco'"> {{ t('nutricao.composicao.citacaoTaco') }}</template>
      </p>

      <p v-if="!alimento.nutrientes.length">{{ t('nutricao.composicao.semNutriente') }}</p>
      <table v-else class="tabela" data-testid="composicao-nutrientes">
        <thead>
          <tr>
            <th scope="col">{{ t('nutricao.composicao.nutriente') }}</th>
            <th scope="col">{{ t('nutricao.composicao.unidade') }}</th>
            <th scope="col" class="num">{{ t('nutricao.composicao.por100g') }}</th>
            <th scope="col" class="num">{{ t('nutricao.composicao.naPorcao', { g: alimento.porcao }) }}</th>
          </tr>
        </thead>
        <tbody v-for="g in porTipo" :key="g.tipo">
          <tr>
            <th scope="colgroup" colspan="4" class="grupo">{{ t(`nutricao.composicao.tipos.${g.tipo}`) }}</th>
          </tr>
          <tr v-for="n in g.itens" :key="n.codigo" :data-testid="`nutriente-${n.codigo}`">
            <th scope="row">{{ n.descricao }}</th>
            <td>{{ n.unidade }}</td>
            <td class="num">{{ n.quantidade100g.toLocaleString('pt-BR') }}</td>
            <td class="num">{{ n.quantidadePorcao.toLocaleString('pt-BR') }}</td>
          </tr>
        </tbody>
      </table>

      <fieldset class="genero">
        <legend>{{ t('nutricao.composicao.genero') }}</legend>
        <p data-testid="composicao-genero-ligado">
          {{
            alimento.genero
              ? t('nutricao.composicao.generoLigado', {
                  codigo: alimento.genero.codigo ?? '',
                  nome: alimento.genero.nome ?? '',
                })
              : t('nutricao.composicao.semGenero')
          }}
        </p>
        <template v-if="podeLigar">
          <SanteSelecao
            v-model="generoId"
            :rotulo="t('nutricao.composicao.buscarGenero')"
            :opcoes="opcoesGenero"
            :buscar="(q: string) => (termoGenero = q)"
            data-testid="composicao-genero"
          />
          <div class="acoes">
            <SanteBotao
              :rotulo="t('nutricao.composicao.ligar')"
              :desabilitado="gravando || generoId === null || generoId === alimento.genero?.id"
              data-testid="composicao-ligar"
              @acionar="gravarGenero(generoId)"
            />
            <SanteBotao
              v-if="alimento.genero"
              variante="secundario"
              :rotulo="t('nutricao.composicao.desligar')"
              :desabilitado="gravando"
              data-testid="composicao-desligar"
              @acionar="gravarGenero(null)"
            />
          </div>
        </template>
      </fieldset>
    </section>
  </main>
</template>

<style scoped>
.composicao {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.filtros {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.tabela {
  inline-size: 100%;
  border-collapse: collapse;
}
.tabela th,
.tabela td {
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-block-end: 1px solid var(--sgh-borda);
  text-align: start;
}
.tabela .num {
  text-align: end;
}
.tabela .grupo {
  background: var(--sgh-fundo-suave, transparent);
}
.genero {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
}
.erro {
  color: var(--sgh-erro, inherit);
}
</style>
