<script setup lang="ts">
// Catálogos da ANS em leitura (M56, etapa F0; correção do M56.1): grupos do SIP (lista com código e nome), procedimentos
// por grupo do SIP com o nome da terminologia TUSS e a vigência (paginados por chave, 200 por página) e a
// classificação de procedimentos da ANS, com busca pelo código ou por trecho do nome. Serve a tela de Envios à ANS da
// operadora e a consulta dos catálogos da ANS do hospital (`catalogo.ans.ler`, D-ANS-HOSPITAL-56); vale também com a
// operadora desligada.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerClassificacoesAns, lerGruposSip, lerProcedimentosSip } from '../api-operadora.js';

const props = withDefaults(defineProps<{ nivel?: 'h2' | 'h1' }>(), { nivel: 'h2' });
const { t } = useI18n();
const subtitulo = computed(() => (props.nivel === 'h1' ? 'h2' : 'h3'));

// ── Grupos do SIP ─────────────────────────────────────────────────────────────────────────────────────
const grupos = useQuery({ queryKey: ['operadora', 'ans', 'grupos'], queryFn: () => lerGruposSip() });
const nomeGrupo = (id: number) => grupos.data.value?.itens.find((g) => g.id === id)?.nome ?? String(id);
const opcoesGrupo = computed(() => [
  { valor: '', rotulo: t('operadora.telas.ans.todosGrupos') },
  ...(grupos.data.value?.itens ?? []).map((g) => ({ valor: String(g.id), rotulo: `${g.id} · ${g.nome}` })),
]);

// ── Procedimentos do SIP (filtro aplicado + pilha de cursores para voltar) ─────────────────────────────
const grupo = ref('');
const vigentesEm = ref<string | null>(null);
const codigo = ref('');
const codigoInvalido = ref(false);
const aplicado = ref<{ grupo: string; vigentesEm: string | null; codigo: string }>({
  grupo: '',
  vigentesEm: null,
  codigo: '',
});
const cursores = ref<(string | null)[]>([null]);
const cursor = computed(() => cursores.value[cursores.value.length - 1] ?? null);
const procedimentos = useQuery({
  queryKey: computed(() => ['operadora', 'ans', 'procedimentos', aplicado.value, cursor.value]),
  queryFn: () =>
    lerProcedimentosSip({
      grupo: aplicado.value.grupo === '' ? null : Number(aplicado.value.grupo),
      vigentesEm: aplicado.value.vigentesEm,
      procedimento: aplicado.value.codigo || null,
      apos: cursor.value,
    }),
});
function filtrar() {
  const c = codigo.value.trim();
  codigoInvalido.value = c !== '' && !/^\d{1,10}$/.test(c);
  if (codigoInvalido.value) return;
  aplicado.value = { grupo: grupo.value, vigentesEm: vigentesEm.value, codigo: c };
  cursores.value = [null];
}
function proxima() {
  const p = procedimentos.data.value?.proxima;
  if (p) cursores.value = [...cursores.value, p];
}
function anterior() {
  if (cursores.value.length > 1) cursores.value = cursores.value.slice(0, -1);
}
const pagina = computed(() => cursores.value.length);

// ── Classificação de procedimentos da ANS (busca aplicada + pilha de cursores) ─────────────────────────
const buscaClass = ref('');
const buscaClassAplicada = ref('');
const cursoresClass = ref<(number | null)[]>([null]);
const cursorClass = computed(() => cursoresClass.value[cursoresClass.value.length - 1] ?? null);
const classificacoes = useQuery({
  queryKey: computed(() => [
    'operadora',
    'ans',
    'classificacoes',
    buscaClassAplicada.value,
    cursorClass.value,
  ]),
  queryFn: () => lerClassificacoesAns(cursorClass.value, buscaClassAplicada.value || null),
});
function buscarClass() {
  buscaClassAplicada.value = buscaClass.value.trim();
  cursoresClass.value = [null];
}
function proximaClass() {
  const p = classificacoes.data.value?.proxima;
  if (p !== null && p !== undefined) cursoresClass.value = [...cursoresClass.value, p];
}
function anteriorClass() {
  if (cursoresClass.value.length > 1) cursoresClass.value = cursoresClass.value.slice(0, -1);
}
const vigencia = (d: string | null) =>
  d === null ? t('operadora.telas.ans.semFim') : d.split('-').reverse().join('/');
</script>

<template>
  <section class="bloco" aria-labelledby="ope-catalogos-titulo" data-testid="operadora-catalogos">
    <component :is="props.nivel" id="ope-catalogos-titulo">{{
      t('operadora.telas.ans.catalogos')
    }}</component>
    <p class="secundario">{{ t('operadora.telas.ans.catalogosTexto') }}</p>

    <component :is="subtitulo">{{ t('operadora.telas.ans.gruposSip') }}</component>
    <MensagemErro v-if="grupos.isError.value" :erro="grupos.error.value" />
    <p v-else-if="!grupos.data.value" role="status">{{ t('operadora.carregando') }}</p>
    <details v-else data-testid="operadora-grupos">
      <summary data-testid="operadora-grupos-total">
        {{ t('operadora.telas.ans.gruposTotal', { n: grupos.data.value.itens.length }) }}
      </summary>
      <table class="tabela" data-testid="operadora-grupos-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('operadora.telas.ans.codigo') }}</th>
            <th scope="col">{{ t('operadora.telas.ans.nome') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in grupos.data.value.itens" :key="g.id">
            <td>{{ g.id }}</td>
            <td>{{ g.nome }}</td>
          </tr>
        </tbody>
      </table>
    </details>

    <component :is="subtitulo">{{ t('operadora.telas.ans.procedimentosSip') }}</component>
    <form class="campos" data-testid="operadora-filtro-sip" @submit.prevent="filtrar">
      <SanteSelecao
        id="ope-sip-grupo"
        v-model="grupo"
        :rotulo="t('operadora.telas.ans.grupo')"
        :opcoes="opcoesGrupo"
        :busca="true"
        data-testid="operadora-sip-grupo"
      />
      <SanteData
        v-model="vigentesEm"
        :rotulo="t('operadora.telas.ans.vigentesEm')"
        editavel
        data-testid="operadora-sip-vigentes"
      />
      <SanteCampoTexto
        id="ope-sip-codigo"
        v-model="codigo"
        :rotulo="t('operadora.telas.ans.codigoProcedimento')"
        :max-bytes="10"
        data-testid="operadora-sip-codigo"
      />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('operadora.telas.ans.filtrar')"
          tipo="submit"
          data-testid="operadora-sip-filtrar"
        />
      </div>
    </form>
    <SanteAlerta
      v-if="codigoInvalido"
      :texto="t('operadora.telas.ans.codigoInvalido')"
      variante="aviso"
      anunciar
    />
    <MensagemErro v-if="procedimentos.isError.value" :erro="procedimentos.error.value" />
    <p v-else-if="!procedimentos.data.value" role="status">{{ t('operadora.carregando') }}</p>
    <template v-else>
      <p v-if="procedimentos.data.value.itens.length === 0">{{ t('operadora.nenhum') }}</p>
      <table v-else class="tabela" data-testid="operadora-procedimentos">
        <caption class="secundario">
          {{
            t('operadora.telas.ans.procedimentosSip')
          }}
          ·
          {{
            pagina
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('operadora.telas.ans.codigo') }}</th>
            <th scope="col">{{ t('operadora.telas.ans.procedimento') }}</th>
            <th scope="col">{{ t('operadora.telas.ans.grupo') }}</th>
            <th scope="col">{{ t('operadora.telas.ans.vigenciaInicial') }}</th>
            <th scope="col">{{ t('operadora.telas.ans.vigenciaFinal') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in procedimentos.data.value.itens"
            :key="`${p.procedimento}.${p.grupo}.${p.vigenciaInicial}`"
          >
            <td>{{ p.procedimento }}</td>
            <td :class="{ secundario: p.nome === null }">{{ p.nome ?? t('operadora.telas.ans.semNome') }}</td>
            <td>{{ nomeGrupo(p.grupo) }}</td>
            <td>{{ vigencia(p.vigenciaInicial) }}</td>
            <td>{{ vigencia(p.vigenciaFinal) }}</td>
          </tr>
        </tbody>
      </table>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('operadora.anterior')"
          variante="secundario"
          :desabilitado="pagina === 1"
          data-testid="operadora-sip-anterior"
          @acionar="anterior"
        />
        <SanteBotao
          :rotulo="t('operadora.proxima')"
          variante="secundario"
          :desabilitado="!procedimentos.data.value.proxima"
          data-testid="operadora-sip-proxima"
          @acionar="proxima"
        />
        <span class="secundario" data-testid="operadora-sip-fim">{{
          procedimentos.data.value.proxima
            ? t('operadora.telas.ans.maisPaginas')
            : t('operadora.telas.ans.ultimaPagina')
        }}</span>
      </div>
    </template>

    <component :is="subtitulo">{{ t('operadora.telas.ans.classificacao') }}</component>
    <form class="campos" data-testid="operadora-filtro-class" @submit.prevent="buscarClass">
      <SanteCampoTexto
        id="ope-class-busca"
        v-model="buscaClass"
        :rotulo="t('operadora.telas.ans.buscaClassificacao')"
        :max-bytes="60"
        data-testid="operadora-class-busca"
      />
      <div class="acoes">
        <SanteBotao :rotulo="t('operadora.buscar')" tipo="submit" data-testid="operadora-class-buscar" />
      </div>
    </form>
    <MensagemErro v-if="classificacoes.isError.value" :erro="classificacoes.error.value" />
    <p v-else-if="!classificacoes.data.value" role="status">{{ t('operadora.carregando') }}</p>
    <template v-else>
      <p v-if="classificacoes.data.value.itens.length === 0" data-testid="operadora-class-nenhuma">
        {{ t('operadora.nenhum') }}
      </p>
      <table v-else class="tabela" data-testid="operadora-classificacoes">
        <thead>
          <tr>
            <th scope="col">{{ t('operadora.telas.ans.codigo') }}</th>
            <th scope="col">{{ t('operadora.telas.ans.nome') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in classificacoes.data.value.itens" :key="c.codigo">
            <td>{{ c.codigo }}</td>
            <td>{{ c.nome }}</td>
          </tr>
        </tbody>
      </table>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('operadora.anterior')"
          variante="secundario"
          :desabilitado="cursoresClass.length === 1"
          data-testid="operadora-class-anterior"
          @acionar="anteriorClass"
        />
        <SanteBotao
          :rotulo="t('operadora.proxima')"
          variante="secundario"
          :desabilitado="classificacoes.data.value.proxima === null"
          data-testid="operadora-class-proxima"
          @acionar="proximaClass"
        />
      </div>
    </template>
  </section>
</template>

<style scoped src="../estilo-operadora.css"></style>
