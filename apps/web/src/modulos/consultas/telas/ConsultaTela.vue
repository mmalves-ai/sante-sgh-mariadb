<script setup lang="ts">
// Consulta somente leitura de uma tabela (M14; ficha, seção 7): montada da descrição que a API devolve (colunas,
// filtros por coluna indexada, máscara). Paginação por chave no servidor (próxima página pelo cursor), contagem
// com teto ("mais de 10.000"), tabela grande só com filtro; abrir o registro mostra o dado de pessoa sem máscara
// (a API registra na trilha); exportar (CSV, auditado; justificativa quando há dado de pessoa ou clínico).
import type { PaginaConsulta, RegistroConsulta, ValorCampo } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  buscarConsulta,
  buscarJustificativas,
  buscarPagina,
  buscarRegistro,
  exportarConsulta,
} from '../api-consultas.js';

// Correção do M14: `filtrosFixos` (`f.<campo>` → valor) abre a consulta já filtrada pelo registro do mestre (tela
// mestre-detalhe: o histórico do exame ou do kit escolhido); os campos fixos não aparecem para edição.
const props = defineProps<{
  modulo: string;
  recurso: string;
  secundaria?: boolean;
  filtrosFixos?: Readonly<Record<string, string>> | null;
}>();
const { t } = useI18n();

const descricao = useQuery({
  queryKey: computed(() => ['consultas', props.modulo, props.recurso]),
  queryFn: () => buscarConsulta(props.modulo, props.recurso),
});
const d = computed(() => descricao.data.value);
const fixos = computed(() => props.filtrosFixos ?? {});
const comFiltro = computed(() =>
  (d.value?.colunas ?? []).filter((c) => c.filtro && fixos.value[`f.${c.campo}`] === undefined),
);
const visiveis = computed(() => (d.value?.colunas ?? []).slice(0, 12));
const temChave = computed(() => (d.value?.colunas ?? []).some((c) => c.chave));

const digitados = reactive<Record<string, string>>({});
const aplicados = ref<Record<string, string>>({ ...(props.filtrosFixos ?? {}) });
const cursores = ref<(string | null)[]>([null]);
const pagina = ref<PaginaConsulta | null>(null);
const carregando = ref(false);
const erro = ref<unknown>(null);
const consultou = ref(false);

const filtroPreenchido = computed(() => Object.values(aplicados.value).some((v) => v.trim() !== ''));
watch(
  () => props.filtrosFixos,
  () => {
    aplicados.value = { ...digitados, ...(props.filtrosFixos ?? {}) };
    cursores.value = [null];
    if (d.value) void carregar();
  },
);

async function carregar(): Promise<void> {
  if (!d.value) return;
  if (d.value.exigeFiltro && !filtroPreenchido.value) {
    pagina.value = null;
    return;
  }
  carregando.value = true;
  erro.value = null;
  try {
    pagina.value = await buscarPagina(
      props.modulo,
      props.recurso,
      aplicados.value,
      cursores.value[cursores.value.length - 1] ?? null,
    );
  } catch (e) {
    erro.value = e;
    pagina.value = null;
  } finally {
    carregando.value = false;
    consultou.value = true;
  }
}

// `immediate`: a descrição pode já estar no cache (a mesma consulta aberta antes, filtrada pelo mestre).
watch(
  d,
  (x) => {
    if (x && (!x.exigeFiltro || filtroPreenchido.value)) void carregar();
  },
  { immediate: true },
);

function consultar(): void {
  aplicados.value = { ...digitados, ...fixos.value };
  cursores.value = [null];
  void carregar();
}
function limpar(): void {
  for (const k of Object.keys(digitados)) digitados[k] = '';
  consultar();
}
function proxima(): void {
  if (!pagina.value?.proxima) return;
  cursores.value = [...cursores.value, pagina.value.proxima];
  void carregar();
}
function primeira(): void {
  cursores.value = [null];
  void carregar();
}
/** Correção do M14: volta uma página (tira o último cursor da pilha). */
function anterior(): void {
  if (cursores.value.length <= 1) return;
  cursores.value = cursores.value.slice(0, -1);
  void carregar();
}

function exibir(v: ValorCampo | undefined): string {
  return v === null || v === undefined ? '' : String(v);
}

// ── registro ──
const registro = ref<RegistroConsulta | null>(null);
const aberto = ref(false);
function codigoDaLinha(l: Readonly<Record<string, ValorCampo>>): string {
  return (d.value?.colunas ?? [])
    .filter((c) => c.chave)
    .map((c) =>
      String(l[c.campo] ?? '')
        .replace(/%/g, '%25')
        .replace(/\|/g, '%7C'),
    )
    .join('|');
}
async function abrir(l: Readonly<Record<string, ValorCampo>>): Promise<void> {
  erro.value = null;
  try {
    registro.value = await buscarRegistro(props.modulo, props.recurso, codigoDaLinha(l));
    aberto.value = true;
  } catch (e) {
    erro.value = e;
  }
}

// ── exportar ──
const justificativa = ref<number | null>(null);
// Correção do M14: as justificativas vêm da rota das consultas (quem exporta não precisa ler o domínio de auditoria).
const justificativas = useQuery({
  queryKey: ['consultas', 'justificativas'],
  queryFn: () => buscarJustificativas(),
  enabled: computed(
    () => d.value?.exportarExigeJustificativa === true && d.value.permitidas.includes('exportar'),
  ),
});
const opcoesJustificativa = computed(() => [
  { valor: null as number | null, rotulo: t('consultas.consulta.escolha') },
  ...(justificativas.data.value?.justificativas ?? []).map((j) => ({ valor: j.codigo, rotulo: j.descricao })),
]);
const linkExportacao = ref<string | null>(null);
const mensagem = ref<string | null>(null);
async function exportar(): Promise<void> {
  erro.value = null;
  try {
    const csv = await exportarConsulta(
      props.modulo,
      props.recurso,
      aplicados.value,
      justificativa.value ?? undefined,
    );
    if (linkExportacao.value) URL.revokeObjectURL(linkExportacao.value);
    linkExportacao.value = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    mensagem.value = t('consultas.consulta.exportado');
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section
    :class="{ tela: !props.secundaria }"
    :aria-labelledby="`consulta-titulo-${props.recurso}`"
    :data-testid="`tela-consulta-${props.modulo}.${props.recurso}`"
  >
    <MensagemErro v-if="descricao.isError.value" :erro="descricao.error.value" />
    <p v-else-if="!d">{{ t('consultas.consulta.carregando') }}</p>
    <template v-else>
      <component :is="props.secundaria ? 'h2' : 'h1'" :id="`consulta-titulo-${props.recurso}`">{{
        d.rotulo
      }}</component>
      <p>{{ t('consultas.consulta.somenteLeitura') }}</p>
      <SanteAlerta v-if="d.classe === 'pessoal'" :texto="t('consultas.consulta.mascarado')" variante="info" />
      <SanteAlerta
        v-if="d.classe === 'clinica'"
        :texto="t('consultas.consulta.clinica')"
        variante="aviso"
        data-testid="aviso-clinica"
      />
      <p v-if="Object.keys(fixos).length" data-testid="consulta-filtrada">
        {{ t('consultas.consulta.filtradoPor') }}
      </p>
      <SanteAlerta
        v-if="d.exigeFiltro"
        :texto="t('consultas.consulta.exigeFiltro')"
        variante="info"
        data-testid="aviso-exige-filtro"
      />
      <form v-if="comFiltro.length" class="filtros" data-testid="form-filtros" @submit.prevent="consultar">
        <fieldset>
          <legend>{{ t('consultas.consulta.filtros') }}</legend>
          <template v-for="c in comFiltro" :key="c.campo">
            <div v-if="c.filtro === 'igual'" class="campo">
              <label :for="`f-${props.recurso}-${c.campo}`">{{
                t('consultas.consulta.igual', { rotulo: c.rotulo })
              }}</label>
              <input
                :id="`f-${props.recurso}-${c.campo}`"
                v-model="digitados[`f.${c.campo}`]"
                maxlength="40"
                :inputmode="c.tipo === 'inteiro' ? 'numeric' : 'text'"
                :data-testid="`filtro-${c.campo}`"
              />
            </div>
            <template v-else>
              <div class="campo">
                <label :for="`de-${props.recurso}-${c.campo}`">{{
                  t('consultas.consulta.de', { rotulo: c.rotulo })
                }}</label>
                <input
                  :id="`de-${props.recurso}-${c.campo}`"
                  v-model="digitados[`de.${c.campo}`]"
                  type="date"
                  :data-testid="`de-${c.campo}`"
                />
              </div>
              <div class="campo">
                <label :for="`ate-${props.recurso}-${c.campo}`">{{
                  t('consultas.consulta.ate', { rotulo: c.rotulo })
                }}</label>
                <input
                  :id="`ate-${props.recurso}-${c.campo}`"
                  v-model="digitados[`ate.${c.campo}`]"
                  type="date"
                  :data-testid="`ate-${c.campo}`"
                />
              </div>
            </template>
          </template>
        </fieldset>
        <div class="botoes">
          <SanteBotao
            :rotulo="t('consultas.consulta.consultar')"
            tipo="submit"
            variante="primario"
            data-testid="consultar"
          />
          <SanteBotao :rotulo="t('consultas.consulta.limpar')" variante="texto" @acionar="limpar" />
        </div>
      </form>
      <div v-if="d.permitidas.includes('exportar')" class="botoes">
        <div v-if="d.exportarExigeJustificativa" class="campo">
          <SanteSelecao
            :id="`justificativa-${props.recurso}`"
            v-model="justificativa"
            :rotulo="t('consultas.consulta.justificativa')"
            :opcoes="opcoesJustificativa"
            data-testid="justificativa"
          />
          <SanteAlerta
            v-if="justificativas.isError.value"
            :texto="t('consultas.consulta.semJustificativas')"
            variante="aviso"
            data-testid="sem-justificativas"
          />
        </div>
        <SanteBotao
          :rotulo="t('consultas.consulta.exportar')"
          variante="secundario"
          data-testid="exportar"
          @acionar="exportar"
        />
        <a v-if="linkExportacao" :href="linkExportacao" :download="`${d.recurso}.csv`">{{
          t('consultas.consulta.exportar')
        }}</a>
      </div>
      <p v-if="mensagem" role="status">{{ mensagem }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
      <p v-if="carregando">{{ t('consultas.consulta.carregando') }}</p>
      <template v-else-if="pagina">
        <p data-testid="contagem">
          {{
            pagina.contagem.maisDe
              ? t('consultas.consulta.contagemMais', { n: pagina.contagem.valor.toLocaleString('pt-BR') })
              : t('consultas.consulta.contagem', { n: pagina.contagem.valor.toLocaleString('pt-BR') })
          }}
        </p>
        <p v-if="pagina.itens.length === 0">{{ t('consultas.consulta.nenhum') }}</p>
        <div v-else class="rolagem" tabindex="0" role="region" :aria-label="t('consultas.consulta.tabela')">
          <table data-testid="tabela-consulta">
            <caption>
              {{
                d.rotulo
              }}
            </caption>
            <thead>
              <tr>
                <th v-for="c in visiveis" :key="c.campo" scope="col">{{ c.rotulo }}</th>
                <th v-if="temChave" scope="col">
                  <span class="oculto">{{ t('consultas.consulta.abrir') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in pagina.itens" :key="i" :data-testid="`linha-${i}`">
                <td v-for="c in visiveis" :key="c.campo">{{ exibir(l[c.campo]) }}</td>
                <td v-if="temChave">
                  <SanteBotao
                    :rotulo="t('consultas.consulta.abrir')"
                    variante="texto"
                    :data-testid="`abrir-${i}`"
                    @acionar="abrir(l)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="botoes">
          <SanteBotao
            :rotulo="t('consultas.consulta.primeira')"
            variante="texto"
            :desabilitado="cursores.length <= 1"
            @acionar="primeira"
          />
          <SanteBotao
            :rotulo="t('consultas.consulta.anterior')"
            variante="texto"
            :desabilitado="cursores.length <= 1"
            data-testid="anterior"
            @acionar="anterior"
          />
          <SanteBotao
            :rotulo="t('consultas.consulta.proxima')"
            variante="texto"
            :desabilitado="!pagina.proxima"
            data-testid="proxima"
            @acionar="proxima"
          />
        </div>
      </template>
      <SanteDialogo
        v-model:visivel="aberto"
        :titulo="t('consultas.consulta.registro', { codigo: registro?.chave.replace(/\|/g, ' / ') ?? '' })"
      >
        <dl v-if="registro" class="registro" data-testid="registro">
          <template v-for="c in d.colunas" :key="c.campo">
            <dt>{{ c.rotulo }}</dt>
            <dd>{{ exibir(registro.valores[c.campo]) }}</dd>
          </template>
        </dl>
        <SanteBotao :rotulo="t('consultas.consulta.fechar')" variante="texto" @acionar="aberto = false" />
      </SanteDialogo>
    </template>
  </section>
</template>

<style scoped>
.filtros fieldset {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
}
.botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
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
  white-space: nowrap;
}
.registro {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.registro dt {
  font-weight: 600;
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
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
