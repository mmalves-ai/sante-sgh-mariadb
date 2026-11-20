<script setup lang="ts">
// Aba "Interface com a folha externa" (M53.1; regras 3 a 6 da ficha do M53): os lotes da empresa e competência (sentido,
// situação, contagem, soma e o código de conferência SHA-256), a geração do lote com a confirmação (o lote leva CPF) ou
// as pendências que a barram, o download do arquivo (recriado e conferido pelo servidor) e a importação do retorno com a
// conferência nos dois sentidos: as divergências (campo, informado, calculado e vínculo) e a conta dos títulos.
import type {
  ApoioFolhaInterface,
  DivergenciaLoteFolha,
  ResultadoExportacaoFolha,
  ResultadoImportacaoFolha,
  ResumoLoteFolha,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { baixarLoteFolha, gerarLoteFolha, importarRetornoFolha, lerLotesFolha } from '../api-folha.js';
import { instanteBr, lerRetorno, rotuloCompetencia, somaDoLote } from '../comum-folha.js';
import ErroFolha from './ErroFolha.vue';

const props = defineProps<{
  apoio: ApoioFolhaInterface;
  empresa: number | null;
  competencia: string | null;
}>();
const { t, te } = useI18n();
const cliente = useQueryClient();
const pronto = computed(() => props.empresa !== null && props.competencia !== null);
const lotes = useQuery({
  queryKey: computed(() => ['folha', 'lotes', props.empresa, props.competencia]),
  queryFn: () => lerLotesFolha({ empresa: props.empresa, competencia: props.competencia }),
  enabled: pronto,
});
const lista = computed(() => lotes.data.value ?? null);

const confirmando = ref(false);
const gerando = ref(false);
const geracao = ref<ResultadoExportacaoFolha | null>(null);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const alvo = ref<ResumoLoteFolha | null>(null);
const importando = ref(false);
const importacao = ref<ResultadoImportacaoFolha | null>(null);
const conferencia = ref<{ id: number; divergencias: readonly DivergenciaLoteFolha[] } | null>(null);
const arquivo = ref<HTMLInputElement | null>(null);

watch(
  () => [props.empresa, props.competencia],
  () => {
    geracao.value = null;
    importacao.value = null;
    conferencia.value = null;
    alvo.value = null;
    erro.value = null;
    aviso.value = null;
  },
);

async function gerar(): Promise<void> {
  if (props.empresa === null || props.competencia === null) return;
  confirmando.value = false;
  gerando.value = true;
  erro.value = null;
  aviso.value = null;
  importacao.value = null;
  try {
    geracao.value = await gerarLoteFolha({ empresa: props.empresa, competencia: props.competencia });
    await cliente.invalidateQueries({ queryKey: ['folha', 'lotes'] });
  } catch (x) {
    erro.value = x;
  } finally {
    gerando.value = false;
  }
}

async function baixar(l: ResumoLoteFolha): Promise<void> {
  erro.value = null;
  aviso.value = null;
  try {
    const a = await baixarLoteFolha(l.id);
    const url = URL.createObjectURL(a.conteudo);
    const link = document.createElement('a');
    link.href = url;
    link.download = a.nome;
    link.click();
    URL.revokeObjectURL(url);
    aviso.value = t('folha.interface.baixado', { nome: a.nome, resumo: l.resumo });
  } catch (x) {
    erro.value = x;
  }
}

function escolherAlvo(l: ResumoLoteFolha): void {
  alvo.value = l;
  importacao.value = null;
  erro.value = null;
  aviso.value = null;
}

async function importar(): Promise<void> {
  const f = arquivo.value?.files?.[0];
  if (!alvo.value || !f) return;
  erro.value = null;
  const conteudo = lerRetorno(await f.text());
  if (conteudo === null) {
    erro.value = 'arquivo-ilegivel';
    return;
  }
  importando.value = true;
  try {
    importacao.value = await importarRetornoFolha(alvo.value.id, conteudo);
    alvo.value = null;
    await cliente.invalidateQueries({ queryKey: ['folha', 'lotes'] });
  } catch (x) {
    erro.value = x;
  } finally {
    importando.value = false;
  }
}

const podeBaixar = (l: ResumoLoteFolha) =>
  props.apoio.acoes.exportar && l.sentido === 'exportado' && l.situacao !== 'substituido';
const podeImportar = (l: ResumoLoteFolha) =>
  props.apoio.acoes.importar &&
  l.sentido === 'exportado' &&
  ['gerado', 'conferido', 'divergente'].includes(l.situacao);
const textoDivergencia = (c: string) =>
  te(`folha.interface.divergencia.${c}`) ? t(`folha.interface.divergencia.${c}`) : c;
const textoPendencia = (codigo: string, valor: number) => t(`folha.interface.pendencia.${codigo}`, { valor });
const vista = computed(() =>
  importacao.value
    ? { id: importacao.value.lote.id, divergencias: importacao.value.divergencias }
    : conferencia.value,
);
const erroLocal = computed(() =>
  erro.value === 'arquivo-ilegivel' ? t('folha.erro.arquivo-ilegivel') : null,
);
</script>

<template>
  <section class="bloco" :aria-label="t('folha.interface.titulo')" data-testid="folha-interface">
    <h2>{{ t('folha.interface.titulo') }}</h2>
    <p>{{ t('folha.interface.descricao') }}</p>
    <p class="secundario">{{ t('folha.interface.donos') }}</p>
    <p v-if="!pronto" role="status">{{ t('folha.escolhaEmpresa') }}</p>
    <template v-else>
      <div class="acoes">
        <SanteBotao
          v-if="apoio.acoes.exportar"
          :rotulo="t('folha.interface.exportar')"
          :desabilitado="gerando"
          data-testid="folha-gerar"
          @acionar="confirmando = true"
        />
      </div>
      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="folha-aviso" />
      <SanteAlerta v-if="erroLocal" :texto="erroLocal" variante="aviso" anunciar data-testid="recusa-folha" />
      <ErroFolha v-else-if="erro" :erro="erro" />

      <section v-if="geracao" class="bloco" aria-live="polite" data-testid="folha-geracao">
        <template v-if="geracao.gerado && geracao.lote">
          <SanteAlerta
            :texto="t('folha.interface.gerado', { id: geracao.lote.id, conta: geracao.conta })"
            variante="info"
            data-testid="folha-gerado"
          />
          <p v-if="geracao.substituido !== null" class="secundario">
            {{ t('folha.interface.substituiu', { id: geracao.substituido }) }}
          </p>
        </template>
        <template v-else>
          <h3>{{ t('folha.interface.pendencia.titulo') }}</h3>
          <ul data-testid="folha-pendencias">
            <li v-for="p in geracao.pendencias" :key="p.codigo" :data-testid="`folha-pendencia-${p.codigo}`">
              {{ textoPendencia(p.codigo, p.valor) }}
              <span v-if="p.vinculos.length > 0" class="secundario">
                ·
                {{
                  t('folha.interface.pendencia.colaboradores', {
                    n: p.vinculos.length,
                    vinculos: p.vinculos.slice(0, 20).join(', ') + (p.vinculos.length > 20 ? '…' : ''),
                  })
                }}
              </span>
            </li>
          </ul>
        </template>
      </section>

      <section class="bloco" aria-labelledby="folha-lotes-titulo" data-testid="folha-lotes">
        <h3 id="folha-lotes-titulo">
          {{ t('folha.interface.lotes') }} · {{ competencia ? rotuloCompetencia(competencia) : '' }}
        </h3>
        <ErroFolha v-if="lotes.isError.value" :erro="lotes.error.value" />
        <p v-else-if="!lista" role="status">{{ t('folha.carregando') }}</p>
        <p v-else-if="lista.itens.length === 0">{{ t('folha.interface.nenhumLote') }}</p>
        <template v-else>
          <p class="secundario">{{ t('folha.interface.somaAjuda') }}</p>
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">{{ t('folha.interface.colunas.lote') }}</th>
                <th scope="col">{{ t('folha.interface.colunas.geradoEm') }}</th>
                <th scope="col">{{ t('folha.situacao') }}</th>
                <th scope="col">{{ t('folha.interface.colunas.colaboradores') }}</th>
                <th scope="col">{{ t('folha.interface.soma') }}</th>
                <th scope="col">{{ t('folha.interface.colunas.resumo') }}</th>
                <th scope="col">{{ t('folha.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in lista.itens" :key="l.id" :data-testid="`folha-lote-${l.id}`">
                <th scope="row">
                  {{ l.id }}
                  <span class="secundario">{{ t(`folha.interface.sentido.${l.sentido}`) }}</span>
                </th>
                <td>
                  {{ instanteBr(l.geradoEm) }}
                  <span class="secundario"
                    >{{ t('folha.interface.colunas.geradoPor') }} {{ l.geradoPor }}</span
                  >
                </td>
                <td :data-testid="`folha-lote-situacao-${l.id}`">
                  {{ t(`folha.interface.situacoes.${l.situacao}`) }}
                </td>
                <td :data-testid="`folha-lote-colaboradores-${l.id}`">{{ l.colaboradores }}</td>
                <td :data-testid="`folha-lote-soma-${l.id}`">{{ somaDoLote(l.sentido, l.soma) }}</td>
                <td>
                  <code class="resumo" :title="l.resumo">{{ l.resumo.slice(0, 16) }}</code>
                </td>
                <td>
                  <SanteBotao
                    v-if="podeBaixar(l)"
                    :rotulo="t('folha.interface.baixar')"
                    variante="texto"
                    :data-testid="`folha-baixar-${l.id}`"
                    @acionar="baixar(l)"
                  />
                  <SanteBotao
                    v-if="podeImportar(l)"
                    :rotulo="t('folha.interface.importar')"
                    variante="texto"
                    :data-testid="`folha-importar-${l.id}`"
                    @acionar="escolherAlvo(l)"
                  />
                  <SanteBotao
                    v-if="l.sentido === 'recebido'"
                    :rotulo="t('folha.interface.verConferencia')"
                    variante="texto"
                    :data-testid="`folha-conferencia-${l.id}`"
                    @acionar="conferencia = { id: l.id, divergencias: l.divergencias }"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="lista.limitado" class="secundario">{{ t('folha.interface.limitado') }}</p>
        </template>
      </section>

      <form
        v-if="alvo"
        class="bloco"
        :aria-label="t('folha.interface.importarDoLote', { id: alvo.id })"
        data-testid="folha-form-retorno"
        @submit.prevent="importar"
      >
        <h3>{{ t('folha.interface.importarDoLote', { id: alvo.id }) }}</h3>
        <label for="folha-arquivo-retorno">{{ t('folha.interface.escolherArquivo') }}</label>
        <input
          id="folha-arquivo-retorno"
          ref="arquivo"
          type="file"
          accept=".json,application/json"
          required
          data-testid="folha-arquivo-retorno"
        />
        <div class="acoes">
          <SanteBotao :rotulo="t('folha.cancelar')" variante="texto" @acionar="alvo = null" />
          <SanteBotao
            :rotulo="importando ? t('folha.interface.importando') : t('folha.interface.importar')"
            tipo="submit"
            :desabilitado="importando"
            data-testid="folha-enviar-retorno"
          />
        </div>
      </form>

      <section
        v-if="importacao"
        class="bloco"
        aria-labelledby="folha-conf-titulo"
        aria-live="polite"
        data-testid="folha-importacao"
      >
        <h3 id="folha-conf-titulo">{{ t('folha.interface.conferencia.titulo') }}</h3>
        <p>
          {{
            t('folha.interface.resultadoImportacao', {
              id: importacao.lote.id,
              situacao: t(`folha.interface.situacoes.${importacao.situacao}`),
            })
          }}
        </p>
        <SanteAlerta
          :texto="
            importacao.podeLancar
              ? t('folha.interface.conferencia.ok')
              : t('folha.interface.conferencia.barrado')
          "
          :variante="importacao.podeLancar ? 'info' : 'aviso'"
          data-testid="folha-conferencia-resultado"
        />
        <p v-if="importacao.contaTitulos" data-testid="folha-conta-titulos">
          <strong>{{ t('folha.interface.conferencia.contaTitulos') }}:</strong> {{ importacao.contaTitulos }}
        </p>
        <p v-if="importacao.linhasResumo > 0" class="secundario">
          {{ t('folha.interface.linhasResumo', { n: importacao.linhasResumo }) }}
        </p>
      </section>

      <section
        v-if="vista && vista.divergencias.length > 0"
        class="bloco"
        :aria-label="t('folha.interface.conferenciaDoLote', { id: vista.id })"
        data-testid="folha-divergencias"
      >
        <h3>{{ t('folha.interface.conferenciaDoLote', { id: vista.id }) }}</h3>
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('folha.interface.conferencia.divergencia') }}</th>
              <th scope="col">{{ t('folha.interface.conferencia.campo') }}</th>
              <th scope="col">{{ t('folha.interface.conferencia.declarado') }}</th>
              <th scope="col">{{ t('folha.interface.conferencia.calculado') }}</th>
              <th scope="col">{{ t('folha.interface.conferencia.vinculo') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(d, i) in vista.divergencias" :key="i" :data-testid="`folha-divergencia-${d.codigo}`">
              <td>{{ textoDivergencia(d.codigo) }}</td>
              <td>{{ d.campo }}</td>
              <td>{{ d.declarado }}</td>
              <td>{{ d.calculado }}</td>
              <td>{{ d.vinculo ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <p
        v-if="conferencia && !importacao && conferencia.divergencias.length === 0"
        data-testid="folha-sem-divergencia"
      >
        {{ t('folha.interface.conferencia.ok') }}
      </p>
    </template>

    <SanteDialogo v-model:visivel="confirmando" :titulo="t('folha.interface.exportar')">
      <p>{{ t('folha.interface.confirmarExportacao') }}</p>
      <template #rodape>
        <SanteBotao :rotulo="t('folha.cancelar')" variante="texto" @acionar="confirmando = false" />
        <SanteBotao :rotulo="t('folha.confirmar')" data-testid="folha-confirmar-gerar" @acionar="gerar" />
      </template>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
<style scoped>
.resumo {
  font-size: 0.85em;
  word-break: break-all;
}
</style>
