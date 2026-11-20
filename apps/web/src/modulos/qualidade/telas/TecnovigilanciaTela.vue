<script setup lang="ts">
// Tecnovigilância e farmacovigilância (M48, etapa 2; rota /qualidade/nsp/tecnovigilancia): a lista dos registros de
// vigilância de produto (queixa técnica, evento ou reação adversa, inefetividade, alerta sanitário) por área e situação,
// e o novo registro com o produto do cadastro (busca remota) ou descrito, o lote, a série, o fabricante, o registro na
// Anvisa e a conduta. Vindo da análise, o registro nasce ligado à notificação (?notificacao=&protocolo=).
import {
  AREAS_VIGILANCIA_PRODUTO,
  type AreaVigilanciaProduto,
  CONDUTAS_PRODUTO,
  type CondutaProduto,
  SITUACOES_VIGILANCIA_PRODUTO,
  TIPOS_VIGILANCIA_PRODUTO,
  type TipoVigilanciaProduto,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { novaChaveQualidade } from '../api.js';
import { abrirQueixa, buscarProdutos, listarQueixas } from '../api-seguranca.js';
import ErroQualidade from '../componentes/ErroQualidade.vue';
import { RECUSAS_VIGILANCIA } from '../i18n-seguranca.js';
import { dataHora } from '../regras-qualidade.js';
import { formularioQueixaVazio, montarQueixa, tiposDaArea } from '../regras-seguranca.js';

const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();

const filtro = reactive({ area: '', situacao: '' });
const pagina = ref(1);
watch(filtro, () => (pagina.value = 1));
const lista = useQuery({
  queryKey: computed(() => ['qualidade', 'vigilancia', { ...filtro }, pagina.value]),
  queryFn: () => listarQueixas({ ...filtro, pagina: pagina.value }),
  placeholderData: keepPreviousData,
});
const opArea = [
  { valor: '', rotulo: t('qualidade.vigilancia.todas') },
  ...AREAS_VIGILANCIA_PRODUTO.map((a) => ({ valor: a.codigo as string, rotulo: a.rotulo })),
];
const opSituacao = [
  { valor: '', rotulo: t('qualidade.vigilancia.todas') },
  ...SITUACOES_VIGILANCIA_PRODUTO.map((a) => ({ valor: a.codigo as string, rotulo: a.rotulo })),
];
const rotulo = {
  area: (c: string) => AREAS_VIGILANCIA_PRODUTO.find((x) => x.codigo === c)?.rotulo ?? c,
  tipo: (c: string) => TIPOS_VIGILANCIA_PRODUTO.find((x) => x.codigo === c)?.rotulo ?? c,
  situacao: (c: string) => SITUACOES_VIGILANCIA_PRODUTO.find((x) => x.codigo === c)?.rotulo ?? c,
};

// ── Novo registro ──
const ligada = computed(() => {
  const n = Number(rota.query['notificacao']);
  const p = String(rota.query['protocolo'] ?? '');
  return Number.isInteger(n) && n > 0 ? { id: n, protocolo: /^NSP-\d{4}-\d{6}$/.test(p) ? p : '' } : null;
});
const novo = ref(ligada.value !== null);
const form = reactive(formularioQueixaVazio());
const opAreaForm = AREAS_VIGILANCIA_PRODUTO.map((a) => ({
  valor: a.codigo as AreaVigilanciaProduto,
  rotulo: a.rotulo,
}));
const opTipo = computed(() => [
  { valor: '' as TipoVigilanciaProduto | '', rotulo: '-' },
  ...tiposDaArea(form.area).map((x) => ({ valor: x.codigo as TipoVigilanciaProduto | '', rotulo: x.rotulo })),
]);
watch(
  () => form.area,
  () => {
    if (form.tipo && !tiposDaArea(form.area).some((x) => x.codigo === form.tipo)) form.tipo = '';
  },
);
const opConduta = CONDUTAS_PRODUTO.map((c) => ({ valor: c.codigo as CondutaProduto, rotulo: c.rotulo }));
const busca = ref('');
const termo = ref('');
const produtos = useQuery({
  queryKey: computed(() => ['qualidade', 'vigilancia', 'itens', termo.value]),
  queryFn: () => buscarProdutos(termo.value),
  enabled: computed(() => termo.value.length >= 2),
});
const opProduto = computed(() => [
  { valor: null as number | null, rotulo: t('qualidade.vigilancia.semCadastro') },
  ...(produtos.data.value?.itens ?? []).map((i) => ({ valor: i.codigo as number | null, rotulo: i.nome })),
]);

const falta = ref<string | null>(null);
const erro = ref<unknown>(null);
const gravando = ref(false);
let chave = novaChaveQualidade('vigilancia');
watch(form, () => {
  if (!gravando.value) chave = novaChaveQualidade('vigilancia');
});

async function gravar(): Promise<void> {
  falta.value = null;
  erro.value = null;
  const m = montarQueixa(form, ligada.value?.id ?? null);
  if (!m.ok) {
    falta.value = m.mensagem;
    return;
  }
  gravando.value = true;
  try {
    const r = await abrirQueixa(m.entrada, chave);
    await roteador.push(`/qualidade/nsp/tecnovigilancia/${String(r.id)}`);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="vig-titulo" data-testid="tela-vigilancia">
    <h1 id="vig-titulo">{{ t('qualidade.vigilancia.titulo') }}</h1>
    <p>{{ t('qualidade.vigilancia.explicacao') }}</p>
    <SanteBotao
      v-if="lista.data.value?.gravacao.registrar && !novo"
      :rotulo="t('qualidade.vigilancia.novo')"
      variante="primario"
      data-testid="vig-novo"
      @acionar="novo = true"
    />
    <SanteAlerta
      v-if="lista.data.value && !lista.data.value.gravacao.ligada"
      variante="info"
      :texto="lista.data.value.gravacao.motivo ?? t('qualidade.analise.desligada')"
    />

    <form
      v-if="novo && lista.data.value?.gravacao.registrar"
      class="vig__form"
      data-testid="form-vigilancia"
      novalidate
      @submit.prevent="gravar"
    >
      <h2>{{ t('qualidade.vigilancia.abrirTitulo') }}</h2>
      <p v-if="ligada" data-testid="vig-ligada">
        {{ t('qualidade.vigilancia.notificacaoLigada', { protocolo: ligada.protocolo || ligada.id }) }}
      </p>
      <SanteOpcoes
        v-model="form.area"
        :legenda="t('qualidade.vigilancia.area')"
        :opcoes="opAreaForm"
        nome="vig-area"
        data-testid="vig-area"
      />
      <SanteSelecao
        v-model="form.tipo"
        :rotulo="t('qualidade.vigilancia.tipo')"
        :opcoes="opTipo"
        obrigatorio
        data-testid="vig-tipo"
      />
      <div class="vig__linha">
        <SanteCampoTexto
          v-model="busca"
          :rotulo="t('qualidade.vigilancia.buscarProduto')"
          :max-bytes="40"
          data-testid="vig-busca"
        />
        <SanteBotao
          :rotulo="t('qualidade.vigilancia.buscar')"
          variante="secundario"
          data-testid="vig-buscar"
          @acionar="termo = busca.trim().slice(0, 40)"
        />
      </div>
      <p v-if="termo && produtos.data.value?.itens.length === 0" role="status">
        {{ t('qualidade.vigilancia.nenhumProduto') }}
      </p>
      <SanteSelecao
        v-model="form.item"
        :rotulo="t('qualidade.vigilancia.escolhaProduto')"
        :opcoes="opProduto"
        busca
        data-testid="vig-item"
      />
      <SanteCampoTexto
        v-if="form.item === null"
        v-model="form.produto"
        :rotulo="t('qualidade.vigilancia.descricaoProduto')"
        :max-bytes="120"
        data-testid="vig-produto"
      />
      <div class="vig__linha">
        <SanteCampoTexto
          v-model="form.lote"
          :rotulo="t('qualidade.vigilancia.lote')"
          :max-bytes="30"
          data-testid="vig-lote"
        />
        <SanteCampoTexto v-model="form.serie" :rotulo="t('qualidade.vigilancia.serie')" :max-bytes="40" />
        <SanteCampoTexto
          v-model="form.fabricante"
          :rotulo="t('qualidade.vigilancia.fabricante')"
          :max-bytes="80"
        />
        <SanteCampoTexto
          v-model="form.registroAnvisa"
          :rotulo="t('qualidade.vigilancia.registroAnvisa')"
          :max-bytes="20"
          data-testid="vig-anvisa"
        />
      </div>
      <SanteCampoTexto
        v-if="form.tipo === 'alertaSanitario'"
        v-model="form.alerta"
        :rotulo="t('qualidade.vigilancia.alerta')"
        :max-bytes="40"
        obrigatorio
        data-testid="vig-alerta"
      />
      <SanteCampoTexto
        v-model="form.descricao"
        :rotulo="t('qualidade.vigilancia.descricao')"
        :max-bytes="4000"
        multilinha
        obrigatorio
        data-testid="vig-descricao"
      />
      <SanteSelecao
        v-model="form.conduta"
        :rotulo="t('qualidade.vigilancia.conduta')"
        :opcoes="opConduta"
        data-testid="vig-conduta"
      />
      <SanteAlerta v-if="falta" variante="aviso" :texto="falta" anunciar data-testid="vig-falta" />
      <ErroQualidade v-if="erro" :erro="erro" :recusas="RECUSAS_VIGILANCIA" />
      <div class="vig__linha">
        <SanteBotao
          :rotulo="t('qualidade.vigilancia.gravar')"
          variante="primario"
          tipo="submit"
          :desabilitado="gravando"
          data-testid="vig-gravar"
        />
        <SanteBotao :rotulo="t('qualidade.cancelar')" variante="texto" @acionar="novo = false" />
      </div>
    </form>

    <form class="filtros" :aria-label="t('qualidade.lista.filtros')" @submit.prevent>
      <SanteSelecao
        v-model="filtro.area"
        :rotulo="t('qualidade.vigilancia.filtroArea')"
        :opcoes="opArea"
        data-testid="vig-filtro-area"
      />
      <SanteSelecao
        v-model="filtro.situacao"
        :rotulo="t('qualidade.vigilancia.filtroSituacao')"
        :opcoes="opSituacao"
        data-testid="vig-filtro-situacao"
      />
    </form>
    <ErroQualidade v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('qualidade.carregando') }}</p>
    <template v-else>
      <p v-if="lista.data.value.itens.length === 0" data-testid="vig-nenhum">
        {{ t('qualidade.vigilancia.nenhum') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-vigilancia">
        <caption>
          {{
            t('qualidade.vigilancia.legenda', { pagina: lista.data.value.pagina })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('qualidade.vigilancia.numero') }}</th>
            <th scope="col">{{ t('qualidade.vigilancia.registradaEm') }}</th>
            <th scope="col">{{ t('qualidade.vigilancia.area') }}</th>
            <th scope="col">{{ t('qualidade.vigilancia.tipo') }}</th>
            <th scope="col">{{ t('qualidade.vigilancia.produto') }}</th>
            <th scope="col">{{ t('qualidade.vigilancia.lote') }}</th>
            <th scope="col">{{ t('qualidade.vigilancia.situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="q in lista.data.value.itens" :key="q.id" :data-testid="`vig-linha-${q.id}`">
            <td>
              <RouterLink :to="`/qualidade/nsp/tecnovigilancia/${q.id}`" :data-testid="`vig-abrir-${q.id}`">{{
                q.id
              }}</RouterLink>
            </td>
            <td>{{ dataHora(q.registradaEm) }}</td>
            <td>{{ rotulo.area(q.area) }}</td>
            <td>{{ rotulo.tipo(q.tipo) }}</td>
            <td>{{ q.itemNome ?? q.produto ?? '-' }}</td>
            <td>{{ q.lote ?? '-' }}</td>
            <td>{{ rotulo.situacao(q.situacao) }}</td>
          </tr>
        </tbody>
      </table>
      <nav class="vig__linha" :aria-label="t('qualidade.lista.paginas')">
        <SanteBotao
          :rotulo="t('qualidade.lista.anterior')"
          variante="secundario"
          :desabilitado="pagina <= 1"
          @acionar="pagina--"
        />
        <SanteBotao
          :rotulo="t('qualidade.lista.proxima')"
          variante="secundario"
          :desabilitado="!lista.data.value.temMais"
          @acionar="pagina++"
        />
      </nav>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style>
@import '../componentes/estilo-qualidade.css';
</style>
<style scoped>
.vig__form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-3);
  margin-block: var(--sgh-espaco-3);
}
.vig__linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: flex-end;
}
</style>
