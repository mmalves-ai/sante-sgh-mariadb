<script setup lang="ts">
// Consulta dos catálogos oficiais (M13, ficha seção 7): uma tela por item do menu, com as tabelas do catálogo
// (paginação, filtro e ordem no servidor: catálogos grandes nunca abrem inteiros), o responsável pela carga e a
// edição que o banco tem (do painel) e, onde o item tem mapeamentos locais, o atalho para o cadastro deles.
import { GRUPOS_CONSULTA_CATALOGO, type GrupoConsultaCatalogo, rotaDoDominio } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarPainel, consultarCatalogo } from '../api-catalogos.js';

const props = defineProps<{ grupo: string }>();
const { t } = useI18n();

// As tabelas de cada tela vêm do contrato (as mesmas que a API consulta), em seções.
type Grupo = GrupoConsultaCatalogo;
const grupo = computed<Grupo>(
  () =>
    (Object.hasOwn(GRUPOS_CONSULTA_CATALOGO, props.grupo) ? GRUPOS_CONSULTA_CATALOGO[props.grupo] : null) ?? {
      catalogo: null,
      entidades: [],
    },
);
const entidade = ref(grupo.value.entidades[0]?.codigo ?? '');
watch(grupo, (g) => (entidade.value = g.entidades[0]?.codigo ?? ''));
const secoes = computed(() => {
  const r = new Map<string, Grupo['entidades'][number][]>();
  for (const e of grupo.value.entidades) (r.get(e.secao) ?? r.set(e.secao, []).get(e.secao))?.push(e);
  return [...r].map(([nome, entidades]) => ({ nome, entidades }));
});
// As seções viram prefixo do rótulo (o combo com busca não tem grupos): com uma só seção, só o título.
const opcoesEntidade = computed(() =>
  secoes.value.flatMap((s) =>
    s.entidades.map((e) => ({
      valor: e.codigo,
      rotulo:
        secoes.value.length > 1
          ? t('catalogos.consulta.opcaoSecao', { secao: s.nome, tabela: e.titulo })
          : e.titulo,
    })),
  ),
);
const comCompetencia = computed(
  () => grupo.value.entidades.find((e) => e.codigo === entidade.value)?.competencia === true,
);
const busca = ref('');
const termo = ref('');
const competenciaDigitada = ref('');
const competencia = ref('');
const pagina = ref(0);
watch([entidade, termo, competencia], () => (pagina.value = 0));
const consulta = useQuery({
  queryKey: computed(() => [
    'catalogos',
    'consulta',
    entidade.value,
    termo.value,
    comCompetencia.value ? competencia.value : '',
    pagina.value,
  ]),
  queryFn: () =>
    consultarCatalogo(entidade.value, termo.value, pagina.value, {
      competencia: comCompetencia.value ? competencia.value : '',
    }),
  enabled: computed(() => entidade.value !== ''),
});
const painel = useQuery({
  queryKey: ['catalogos', 'painel'],
  queryFn: buscarPainel,
  enabled: computed(() => grupo.value.catalogo !== null),
});
const doCatalogo = computed(
  () => painel.data.value?.catalogos.find((c) => c.codigo === grupo.value.catalogo) ?? null,
);
const totalPaginas = computed(() =>
  Math.max(1, Math.ceil((consulta.data.value?.total ?? 0) / (consulta.data.value?.porPagina ?? 50))),
);
function buscar(): void {
  termo.value = busca.value.trim();
  competencia.value = /^\d{6}$/.test(competenciaDigitada.value.trim())
    ? competenciaDigitada.value.trim()
    : '';
}
</script>

<template>
  <section class="tela" aria-labelledby="consulta-titulo">
    <h1 id="consulta-titulo">{{ t(`catalogos.consulta.grupos.${props.grupo}`) }}</h1>
    <p>
      <RouterLink :to="{ name: 'catalogos.painel' }" data-testid="link-painel">{{
        t('catalogos.comum.painel')
      }}</RouterLink>
    </p>
    <p v-if="props.grupo === 'tuss' && pode('catalogo.ans.ler')">
      <RouterLink :to="{ name: 'catalogos.ans' }" data-testid="link-catalogos-ans">{{
        t('catalogos.comum.catalogosAns')
      }}</RouterLink>
    </p>
    <p v-if="doCatalogo" data-testid="carga-do-catalogo">
      {{
        t('catalogos.consulta.carga', {
          responsavel: t(`catalogos.painel.responsaveis.${doCatalogo.responsavel}`),
          edicao: `${doCatalogo.edicaoNoBanco.descricao} ${doCatalogo.edicaoNoBanco.valor ?? ''}`.trim(),
        })
      }}
    </p>
    <nav v-if="grupo.dominios?.length" :aria-label="t('catalogos.comum.mapeamentos')">
      <h2>{{ t('catalogos.comum.mapeamentos') }}</h2>
      <ul>
        <li v-for="r in grupo.dominios" :key="r">
          <RouterLink :to="rotaDoDominio('catalogo', r)" :data-testid="`dominio-${r}`">{{
            t(`catalogos.consulta.dominios.${r}`)
          }}</RouterLink>
        </li>
      </ul>
    </nav>
    <form class="filtros" data-testid="form-consulta" @submit.prevent="buscar">
      <div class="campo">
        <SanteSelecao
          id="consulta-tabela"
          v-model="entidade"
          :rotulo="t('catalogos.consulta.escolher')"
          :opcoes="opcoesEntidade"
          data-testid="consulta-tabela"
        />
      </div>
      <div class="campo">
        <label for="consulta-busca">{{ t('catalogos.comum.busca') }}</label>
        <input id="consulta-busca" v-model="busca" maxlength="60" data-testid="consulta-busca" />
      </div>
      <div v-if="comCompetencia" class="campo">
        <label for="consulta-competencia">{{ t('catalogos.consulta.competencia') }}</label>
        <input
          id="consulta-competencia"
          v-model="competenciaDigitada"
          inputmode="numeric"
          maxlength="6"
          pattern="\d{6}"
          data-testid="consulta-competencia"
        />
      </div>
      <SanteBotao :rotulo="t('catalogos.comum.buscar')" tipo="submit" data-testid="consulta-buscar" />
    </form>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isLoading.value">{{ t('catalogos.comum.carregando') }}</p>
    <template v-else-if="consulta.data.value">
      <p v-if="consulta.data.value.itens.length === 0">{{ t('catalogos.comum.nenhum') }}</p>
      <div v-else class="rolagem" tabindex="0" role="region" :aria-label="t('catalogos.comum.tabela')">
        <table data-testid="tabela-consulta">
          <caption>
            {{
              consulta.data.value.titulo
            }}
          </caption>
          <thead>
            <tr>
              <th v-for="c in consulta.data.value.colunas" :key="c.campo" scope="col">{{ c.rotulo }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in consulta.data.value.itens" :key="i">
              <td v-for="c in consulta.data.value.colunas" :key="c.campo">{{ item[c.campo] ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        {{
          t('catalogos.comum.pagina', {
            pagina: pagina + 1,
            total: totalPaginas,
            n: consulta.data.value.total,
          })
        }}
      </p>
      <div class="botoes">
        <SanteBotao
          :rotulo="t('catalogos.comum.anterior')"
          variante="texto"
          :desabilitado="pagina === 0"
          @acionar="pagina--"
        />
        <SanteBotao
          :rotulo="t('catalogos.comum.proxima')"
          variante="texto"
          :desabilitado="pagina + 1 >= totalPaginas"
          @acionar="pagina++"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
nav li {
  margin: var(--sgh-espaco-1) 0;
}
nav a {
  display: inline-block;
  min-height: 24px;
  padding: 2px 0;
}
.filtros,
.botoes {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: end;
  flex-wrap: wrap;
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
caption {
  text-align: left;
  font-weight: 600;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
input,
select {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
