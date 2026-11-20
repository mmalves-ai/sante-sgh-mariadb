<script setup lang="ts">
// Qualidade e segurança › Gestão da qualidade › Gestão documental (M48, etapa 5; ficha, seção 7; manual "Gestão
// documental"). A lista dos documentos (quem não publica vê só os vigentes), o documento aberto com a ciência e, para
// quem publica (escritório da qualidade), o novo documento, a nova revisão e a retirada. Com a funcionalidade
// desligada, tudo fica em consulta.
import '../../componentes/estilo-qualidade.css';
import '../../ccih/componentes/estilo-ccih.css';
import '../componentes/estilo-gestao.css';
import {
  PERMISSOES_GESTAO_QUALIDADE as P,
  rotuloSituacaoDocumentoQualidade,
  rotuloTipoDocumentoQualidade,
  SITUACOES_DOCUMENTO_QUALIDADE,
  TIPOS_DOCUMENTO_QUALIDADE,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { pode } from '../../../../casca/sessao/pode.js';
import { type DocumentoCompletoTela, lerDocumentos, lerResumoGestao } from '../api-gestao.js';
import DocumentoDetalhe from '../componentes/DocumentoDetalhe.vue';
import ErroGestao from '../componentes/ErroGestao.vue';
import FormularioDocumento from '../componentes/FormularioDocumento.vue';
import NavGestao from '../componentes/NavGestao.vue';
import ResumoGestao from '../componentes/ResumoGestao.vue';
import { dataBr } from '../regras-gestao.js';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const podePublicar = computed(() => pode(P.documentoPublicar));
const resumo = useQuery({
  queryKey: ['gestaoQualidade', 'resumo'],
  queryFn: lerResumoGestao,
  staleTime: 60_000,
});
const ligada = computed(() => resumo.data.value?.ligada ?? false);
const hoje = computed(() => resumo.data.value?.agora.slice(0, 10) ?? '');

const filtro = reactive({ situacao: podePublicar.value ? '' : 'vigente', tipo: '', busca: '', pagina: 1 });
const busca = ref('');
const opSituacao = [
  { valor: '', rotulo: t('gestaoQualidade.todas') },
  ...SITUACOES_DOCUMENTO_QUALIDADE.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo })),
];
const opTipo = [
  { valor: '', rotulo: t('gestaoQualidade.todos') },
  ...TIPOS_DOCUMENTO_QUALIDADE.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo })),
];
watch(
  () => [filtro.situacao, filtro.tipo, filtro.busca],
  () => {
    filtro.pagina = 1;
  },
);
const lista = useQuery({
  queryKey: computed(() => ['gestaoQualidade', 'documentos', { ...filtro }]),
  queryFn: () =>
    lerDocumentos({
      situacao: filtro.situacao || undefined,
      tipo: filtro.tipo || undefined,
      busca: filtro.busca || undefined,
      pagina: filtro.pagina,
    }),
});
const paginas = computed(() =>
  lista.data.value ? Math.max(1, Math.ceil(lista.data.value.total / lista.data.value.porPagina)) : 1,
);

const docNaRota = Number(rota.query['documento']);
const aberto = ref<number | null>(Number.isInteger(docNaRota) && docNaRota > 0 ? docNaRota : null);
const editando = ref<{ vigente: DocumentoCompletoTela | null } | null>(null);
const aviso = ref<string | null>(null);

async function publicado(r: { revisao: number; id: number }): Promise<void> {
  editando.value = null;
  aviso.value = t('gestaoQualidade.documentos.form.publicado', { revisao: r.revisao });
  aberto.value = r.id;
  await cliente.invalidateQueries({ queryKey: ['gestaoQualidade'] });
}
</script>

<template>
  <section class="tela-gestao" aria-labelledby="documentos-titulo" data-testid="tela-documentos">
    <NavGestao />
    <h1 id="documentos-titulo">{{ t('gestaoQualidade.documentos.titulo') }}</h1>
    <p class="secundario">{{ t('gestaoQualidade.documentos.explicacao') }}</p>
    <ResumoGestao :partes="['documentos']" />
    <div v-if="aviso" role="status" data-testid="gestao-aviso">{{ aviso }}</div>

    <FormularioDocumento
      v-if="editando && hoje"
      :key="editando.vigente?.id ?? 'novo'"
      :vigente="editando.vigente"
      :hoje="hoje"
      @gravado="publicado"
      @cancelar="editando = null"
    />
    <DocumentoDetalhe
      v-else-if="aberto !== null"
      :id="aberto"
      :key="aberto"
      :pode-publicar="podePublicar"
      :ligada="ligada"
      @revisar="(d) => (editando = { vigente: d })"
      @abrir="(id) => (aberto = id)"
      @aviso="(x) => (aviso = x)"
      @fechar="aberto = null"
    />

    <div class="linha-ccih">
      <SanteSelecao
        v-if="podePublicar"
        v-model="filtro.situacao"
        :rotulo="t('gestaoQualidade.situacao')"
        :opcoes="opSituacao"
        data-testid="doc-filtro-situacao"
      />
      <SanteSelecao
        v-model="filtro.tipo"
        :rotulo="t('gestaoQualidade.documentos.tipo')"
        :opcoes="opTipo"
        data-testid="doc-filtro-tipo"
      />
      <form class="linha-ccih" role="search" @submit.prevent="filtro.busca = busca.trim()">
        <SanteCampoTexto
          v-model="busca"
          :rotulo="t('gestaoQualidade.documentos.busca')"
          :max-bytes="60"
          data-testid="doc-busca"
        />
        <SanteBotao tipo="submit" variante="secundario" :rotulo="t('gestaoQualidade.documentos.buscar')" />
      </form>
      <SanteBotao
        v-if="podePublicar && ligada && !editando"
        :rotulo="t('gestaoQualidade.documentos.novo')"
        data-testid="doc-novo"
        @acionar="editando = { vigente: null }"
      />
    </div>

    <ErroGestao v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('gestaoQualidade.carregando') }}</p>
    <p v-else-if="!lista.data.value.itens.length" data-testid="doc-vazio">
      {{ t('gestaoQualidade.documentos.nenhum') }}
    </p>
    <template v-else>
      <table class="tabela" data-testid="tabela-documentos">
        <caption>
          {{
            t('gestaoQualidade.documentos.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('gestaoQualidade.documentos.colCodigo') }}</th>
            <th scope="col">{{ t('gestaoQualidade.documentos.colTitulo') }}</th>
            <th scope="col">{{ t('gestaoQualidade.documentos.colTipo') }}</th>
            <th scope="col">{{ t('gestaoQualidade.documentos.colVigencia') }}</th>
            <th scope="col">{{ t('gestaoQualidade.documentos.colSituacao') }}</th>
            <th scope="col">{{ t('gestaoQualidade.documentos.colCiencia') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in lista.data.value.itens" :key="d.id" :data-testid="`documento-${d.id}`">
            <td>
              <strong>{{ d.codigo }}</strong>
              <div class="secundario">{{ t('gestaoQualidade.documentos.revisao', { n: d.revisao }) }}</div>
            </td>
            <td>
              <SanteBotao
                variante="texto"
                :rotulo="d.titulo"
                :data-testid="`abrir-documento-${d.id}`"
                @acionar="
                  editando = null;
                  aberto = d.id;
                "
              />
              <div class="secundario">{{ d.area }}</div>
            </td>
            <td>{{ rotuloTipoDocumentoQualidade(d.tipo) }}</td>
            <td>
              {{ dataBr(d.vigenciaAte) }}
              <div v-if="d.revisaoVencida" class="prazo prazo--vencido">
                {{ t('gestaoQualidade.documentos.revisaoVencida') }}
              </div>
            </td>
            <td>{{ rotuloSituacaoDocumentoQualidade(d.situacao) }}</td>
            <td>
              <span v-if="!d.exigeCiencia" class="secundario">{{
                t('gestaoQualidade.documentos.semCiencia')
              }}</span>
              <span v-else :class="d.cienteSessao ? 'prazo prazo--cumprido' : 'selo selo--atencao'">{{
                d.cienteSessao
                  ? t('gestaoQualidade.documentos.ciente')
                  : t('gestaoQualidade.documentos.pendente')
              }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="paginas > 1" class="linha-ccih">
        <SanteBotao
          variante="secundario"
          :rotulo="t('gestaoQualidade.anterior')"
          :desabilitado="filtro.pagina <= 1"
          @acionar="filtro.pagina--"
        />
        <span>{{ t('gestaoQualidade.paginaDe', { pagina: filtro.pagina, total: paginas }) }}</span>
        <SanteBotao
          variante="secundario"
          :rotulo="t('gestaoQualidade.proxima')"
          :desabilitado="filtro.pagina >= paginas"
          @acionar="filtro.pagina++"
        />
      </div>
    </template>
  </section>
</template>
