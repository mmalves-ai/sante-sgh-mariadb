<script setup lang="ts">
// Qualidade e segurança › Gestão da qualidade › Ouvidoria, SAC e pesquisa de satisfação (M48, etapa 5; ficha, seção
// 7; manual "Ouvidoria"). Três partes: as manifestações com o protocolo e o prazo de 10 dias úteis (vencida em
// destaque; encaminhar e responder), as respostas da pesquisa de satisfação do portal a tratar (nota até 6 ou com
// comentário; viram manifestação uma vez) e o NPS das seis últimas competências com as parcelas.
import '../../componentes/estilo-qualidade.css';
import '../../ccih/componentes/estilo-ccih.css';
import '../componentes/estilo-gestao.css';
import {
  PERMISSOES_GESTAO_QUALIDADE as P,
  rotuloCanalManifestacao,
  rotuloSituacaoManifestacao,
  rotuloTipoManifestacao,
  SITUACOES_MANIFESTACAO,
  TIPOS_MANIFESTACAO,
} from '@sgh/contratos';
import { numeroBr } from '@sgh/dominio-qualidade';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../../casca/sessao/pode.js';
import { dataHora } from '../../regras-qualidade.js';
import { lerManifestacoes, lerNps, lerPesquisas, lerResumoGestao, type PesquisaTela } from '../api-gestao.js';
import ErroGestao from '../componentes/ErroGestao.vue';
import FormularioManifestacao from '../componentes/FormularioManifestacao.vue';
import IndicadoresOuvidoria from '../componentes/IndicadoresOuvidoria.vue';
import ManifestacaoDetalhe from '../componentes/ManifestacaoDetalhe.vue';
import NavGestao from '../componentes/NavGestao.vue';
import ResumoGestao from '../componentes/ResumoGestao.vue';
import { classeDoPrazoManifestacao, competenciaBr, competenciasRecentes, dataBr } from '../regras-gestao.js';

type Aba = 'manifestacoes' | 'pesquisas' | 'nps' | 'indicadores';

const { t } = useI18n();
const cliente = useQueryClient();
const resumo = useQuery({
  queryKey: ['gestaoQualidade', 'resumo'],
  queryFn: lerResumoGestao,
  staleTime: 60_000,
});
const podeRegistrarNc = computed(() => resumo.data.value?.podeRegistrar ?? false);
const podeVerNc = computed(() => pode(P.gestaoRegistrar));
const aba = ref<Aba>('manifestacoes');
const aviso = ref<string | null>(null);

// ── Manifestações ──
const filtro = reactive({ situacao: '', tipo: '', busca: '', pagina: 1 });
/** O protocolo dado ao manifestante (OUV-AAAA-NNNNNN), a área ou um trecho do relato. */
const busca = ref('');
const opSituacao = [
  { valor: '', rotulo: t('gestaoQualidade.todas') },
  ...SITUACOES_MANIFESTACAO.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo })),
];
const opTipo = [
  { valor: '', rotulo: t('gestaoQualidade.todos') },
  ...TIPOS_MANIFESTACAO.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo })),
];
watch(
  () => [filtro.situacao, filtro.tipo, filtro.busca],
  () => {
    filtro.pagina = 1;
  },
);
const lista = useQuery({
  queryKey: computed(() => ['gestaoQualidade', 'manifestacoes', { ...filtro }]),
  queryFn: () =>
    lerManifestacoes({
      situacao: filtro.situacao || undefined,
      tipo: filtro.tipo || undefined,
      busca: filtro.busca || undefined,
      pagina: filtro.pagina,
    }),
  enabled: computed(() => aba.value === 'manifestacoes'),
});
const podeResponder = computed(() => (resumo.data.value?.ligada ?? false) && pode(P.ouvidoriaResponder));
const agora = computed(() => lista.data.value?.agora ?? resumo.data.value?.agora ?? '');
const paginas = computed(() =>
  lista.data.value ? Math.max(1, Math.ceil(lista.data.value.total / lista.data.value.porPagina)) : 1,
);
const abertaId = ref<number | null>(null);
const aberta = computed(() => lista.data.value?.itens.find((m) => m.id === abertaId.value) ?? null);
const nova = ref<{ pesquisa: PesquisaTela | null } | null>(null);
async function registrada(r: { id: number; protocolo: string }): Promise<void> {
  nova.value = null;
  aviso.value = t('gestaoQualidade.ouvidoria.form.gravada', { protocolo: r.protocolo });
  aba.value = 'manifestacoes';
  // A manifestação registrada aparece na lista: sem filtro nem busca que a esconda.
  filtro.situacao = '';
  filtro.tipo = '';
  filtro.busca = '';
  busca.value = '';
  abertaId.value = r.id;
  await cliente.invalidateQueries({ queryKey: ['gestaoQualidade'] });
}

// ── Pesquisas e NPS ──
const competencia = ref('');
const opCompetencias = computed(() =>
  agora.value
    ? competenciasRecentes(agora.value.slice(0, 7)).map((c) => ({ valor: c, rotulo: competenciaBr(c) }))
    : [],
);
watch(
  opCompetencias,
  (op) => {
    if (!competencia.value && op.length) competencia.value = op[0]?.valor ?? '';
  },
  { immediate: true },
);
const pesquisas = useQuery({
  queryKey: computed(() => ['gestaoQualidade', 'pesquisas', competencia.value]),
  queryFn: () => lerPesquisas(competencia.value),
  enabled: computed(() => aba.value === 'pesquisas' && competencia.value !== ''),
});
const nps = useQuery({
  queryKey: computed(() => ['gestaoQualidade', 'nps', competencia.value]),
  queryFn: () => lerNps(competencia.value),
  enabled: computed(() => aba.value === 'nps' && competencia.value !== ''),
});
function registrarDaPesquisa(p: PesquisaTela): void {
  nova.value = { pesquisa: p };
}
</script>

<template>
  <section class="tela-gestao" aria-labelledby="ouvidoria-titulo" data-testid="tela-ouvidoria">
    <NavGestao />
    <h1 id="ouvidoria-titulo">{{ t('gestaoQualidade.ouvidoria.titulo') }}</h1>
    <p class="secundario">{{ t('gestaoQualidade.ouvidoria.explicacao') }}</p>
    <ResumoGestao :partes="['ouvidoria']" />
    <div class="abas abas-ccih" role="tablist" :aria-label="t('gestaoQualidade.ouvidoria.abas.rotulo')">
      <SanteBotao
        v-for="a in ['manifestacoes', 'pesquisas', 'nps', 'indicadores'] as const"
        :key="a"
        role="tab"
        :aria-selected="aba === a"
        variante="secundario"
        :rotulo="t(`gestaoQualidade.ouvidoria.abas.${a}`)"
        :data-testid="`aba-${a}`"
        @acionar="aba = a"
      />
    </div>
    <div v-if="aviso" role="status" data-testid="gestao-aviso">{{ aviso }}</div>
    <FormularioManifestacao
      v-if="nova && agora"
      :key="nova.pesquisa?.id ?? 'nova'"
      :agora="agora"
      :pesquisa="nova.pesquisa"
      :canal-halai="lista.data.value?.canalHalai ?? false"
      @gravado="registrada"
      @cancelar="nova = null"
    />

    <!-- Manifestações -->
    <template v-if="aba === 'manifestacoes'">
      <div class="linha-ccih">
        <SanteSelecao
          v-model="filtro.situacao"
          :rotulo="t('gestaoQualidade.situacao')"
          :opcoes="opSituacao"
          data-testid="man-filtro-situacao"
        />
        <SanteSelecao
          v-model="filtro.tipo"
          :rotulo="t('gestaoQualidade.ouvidoria.tipo')"
          :opcoes="opTipo"
          data-testid="man-filtro-tipo"
        />
        <form class="linha-ccih" role="search" @submit.prevent="filtro.busca = busca.trim()">
          <SanteCampoTexto
            v-model="busca"
            :rotulo="t('gestaoQualidade.ouvidoria.busca')"
            :max-bytes="60"
            data-testid="man-busca"
          />
          <SanteBotao
            tipo="submit"
            variante="secundario"
            :rotulo="t('gestaoQualidade.ouvidoria.buscar')"
            data-testid="man-buscar"
          />
        </form>
        <SanteBotao
          v-if="podeResponder && !nova"
          :rotulo="t('gestaoQualidade.ouvidoria.nova')"
          data-testid="man-nova"
          @acionar="nova = { pesquisa: null }"
        />
      </div>
      <ManifestacaoDetalhe
        v-if="aberta"
        :key="`${aberta.id}-${aberta.versao}`"
        :manifestacao="aberta"
        :pode-responder="podeResponder"
        :pode-registrar-nc="podeRegistrarNc && podeVerNc"
        @aviso="(x) => (aviso = x)"
        @fechar="abertaId = null"
      />
      <ErroGestao v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="!lista.data.value" role="status">{{ t('gestaoQualidade.carregando') }}</p>
      <p v-else-if="!lista.data.value.itens.length" data-testid="man-vazio">
        {{ t('gestaoQualidade.ouvidoria.nenhuma') }}
      </p>
      <template v-else>
        <table class="tabela" data-testid="tabela-manifestacoes">
          <caption>
            {{
              t('gestaoQualidade.ouvidoria.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('gestaoQualidade.ouvidoria.colProtocolo') }}</th>
              <th scope="col">{{ t('gestaoQualidade.ouvidoria.colTipo') }}</th>
              <th scope="col">{{ t('gestaoQualidade.ouvidoria.colManifestante') }}</th>
              <th scope="col">{{ t('gestaoQualidade.area') }}</th>
              <th scope="col">{{ t('gestaoQualidade.ouvidoria.colRecebida') }}</th>
              <th scope="col">{{ t('gestaoQualidade.ouvidoria.colPrazo') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in lista.data.value.itens" :key="m.id" :data-testid="`manifestacao-${m.id}`">
              <td>
                <SanteBotao
                  variante="texto"
                  :rotulo="m.protocolo"
                  :data-testid="`abrir-manifestacao-${m.id}`"
                  @acionar="abertaId = m.id"
                />
                <div class="secundario">{{ rotuloSituacaoManifestacao(m.situacao) }}</div>
              </td>
              <td>
                {{ rotuloTipoManifestacao(m.tipo) }}
                <div class="secundario">{{ rotuloCanalManifestacao(m.canal) }}</div>
              </td>
              <td>
                {{
                  m.identificada
                    ? (m.paciente?.nome ?? m.manifestante ?? '')
                    : t('gestaoQualidade.ouvidoria.anonima')
                }}
              </td>
              <td>{{ m.area }}</td>
              <td>{{ dataHora(m.recebidaEm) }}</td>
              <td>
                <span :class="classeDoPrazoManifestacao(m.estadoPrazo)" :data-estado="m.estadoPrazo">{{
                  t(`gestaoQualidade.ouvidoria.prazoEstado.${m.estadoPrazo}`, { data: dataBr(m.prazoEm) })
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
    </template>

    <div v-if="aba !== 'manifestacoes'" class="linha-ccih">
      <SanteSelecao
        v-model="competencia"
        :rotulo="t('gestaoQualidade.competencia')"
        :opcoes="opCompetencias"
        data-testid="ouv-competencia"
      />
    </div>

    <!-- Pesquisa de satisfação -->
    <template v-if="aba === 'pesquisas'">
      <p class="secundario">{{ t('gestaoQualidade.ouvidoria.pesquisas.explicacao') }}</p>
      <ErroGestao v-if="pesquisas.isError.value" :erro="pesquisas.error.value" />
      <p v-else-if="!pesquisas.data.value" role="status">{{ t('gestaoQualidade.carregando') }}</p>
      <p v-else-if="!pesquisas.data.value.itens.length" data-testid="pesq-vazio">
        {{ t('gestaoQualidade.ouvidoria.pesquisas.nenhuma') }}
      </p>
      <template v-else>
        <p v-if="pesquisas.data.value.cortada" class="secundario">{{ t('gestaoQualidade.cortada') }}</p>
        <table class="tabela" data-testid="tabela-pesquisas">
          <caption>
            {{
              t('gestaoQualidade.ouvidoria.pesquisas.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('gestaoQualidade.ouvidoria.pesquisas.colData') }}</th>
              <th scope="col">{{ t('gestaoQualidade.ouvidoria.pesquisas.colTipo') }}</th>
              <th scope="col">{{ t('gestaoQualidade.ouvidoria.pesquisas.colNota') }}</th>
              <th scope="col">{{ t('gestaoQualidade.ouvidoria.pesquisas.colComentario') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in pesquisas.data.value.itens" :key="p.id" :data-testid="`pesquisa-${p.id}`">
              <td>{{ dataBr(p.dataAtendimento) }}</td>
              <td>
                {{ p.tipo }}
                <div v-if="p.agenda" class="secundario">{{ p.agenda }}</div>
              </td>
              <td>
                <span :class="p.nota <= 6 ? 'prazo prazo--vencido' : 'selo'">{{ p.nota }}</span>
              </td>
              <td>
                {{ p.comentario ?? t('gestaoQualidade.ouvidoria.pesquisas.semComentario') }}
                <div>
                  <span v-if="p.manifestacao !== null" class="secundario">{{
                    t('gestaoQualidade.ouvidoria.pesquisas.registrada', { id: p.manifestacao })
                  }}</span>
                  <SanteBotao
                    v-else-if="podeResponder"
                    variante="texto"
                    :rotulo="t('gestaoQualidade.ouvidoria.pesquisas.registrar')"
                    :data-testid="`pesquisa-registrar-${p.id}`"
                    @acionar="registrarDaPesquisa(p)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>

    <!-- NPS -->
    <template v-if="aba === 'nps'">
      <p class="secundario">{{ t('gestaoQualidade.ouvidoria.nps.explicacao') }}</p>
      <ErroGestao v-if="nps.isError.value" :erro="nps.error.value" />
      <p v-else-if="!nps.data.value" role="status">{{ t('gestaoQualidade.carregando') }}</p>
      <template v-else>
        <p v-if="nps.data.value.cortada" class="secundario">{{ t('gestaoQualidade.cortada') }}</p>
        <table class="tabela" data-testid="tabela-nps">
          <caption>
            {{
              t('gestaoQualidade.ouvidoria.nps.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('gestaoQualidade.competencia') }}</th>
              <th scope="col">{{ t('gestaoQualidade.ouvidoria.nps.colRespostas') }}</th>
              <th scope="col">{{ t('gestaoQualidade.ouvidoria.nps.colPromotores') }}</th>
              <th scope="col">{{ t('gestaoQualidade.ouvidoria.nps.colNeutros') }}</th>
              <th scope="col">{{ t('gestaoQualidade.ouvidoria.nps.colDetratores') }}</th>
              <th scope="col">{{ t('gestaoQualidade.ouvidoria.nps.colNps') }}</th>
              <th scope="col">{{ t('gestaoQualidade.ouvidoria.nps.colConta') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in nps.data.value.itens" :key="x.competencia" :data-testid="`nps-${x.competencia}`">
              <th scope="row">{{ competenciaBr(x.competencia) }}</th>
              <td>{{ x.respostas }}</td>
              <td>{{ x.promotores }}</td>
              <td>{{ x.neutros }}</td>
              <td>{{ x.detratores }}</td>
              <td>{{ x.nps === null ? '—' : numeroBr(x.nps) }}</td>
              <td>{{ x.conta ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>

    <!-- W0-04 (M4): indicadores da ouvidoria -->
    <template v-if="aba === 'indicadores'">
      <SanteSelecao
        v-model="competencia"
        :rotulo="t('gestaoQualidade.competencia')"
        :opcoes="opCompetencias"
        data-testid="ouv-ind-competencia"
      />
      <IndicadoresOuvidoria v-if="competencia" :competencia="competencia" />
    </template>
  </section>
</template>
