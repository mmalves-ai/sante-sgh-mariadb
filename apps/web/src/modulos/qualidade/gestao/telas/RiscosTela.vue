<script setup lang="ts">
// Qualidade e segurança › Gestão da qualidade › Matriz de riscos e não conformidades (M48, etapa 5; ficha, seção 7;
// manual "Matriz de riscos e não conformidades"). Três partes: os riscos pela pontuação GUT (prioridade e reavaliação
// vencida em destaque), as não conformidades com o ciclo (aberta, em tratamento, em verificação, encerrada; vencida
// em destaque) e a escala GUT da qualidade, com o atalho ao cadastro da escala de priorização de pagamentos (CRUD
// genérico). A não conformidade pode abrir já com a origem (auditoria, risco, manifestação) pelo endereço.
import '../../componentes/estilo-qualidade.css';
import '../../ccih/componentes/estilo-ccih.css';
import '../componentes/estilo-gestao.css';
import {
  ESCALA_GUT,
  type EixoGut,
  PRIORIDADES_RISCO,
  rotuloCategoriaRisco,
  rotuloClassificacaoNaoConformidade,
  rotuloOrigemNaoConformidade,
  rotuloPrioridadeRisco,
  rotuloSituacaoNaoConformidade,
  rotuloSituacaoRisco,
  SITUACOES_NAO_CONFORMIDADE,
  SITUACOES_RISCO,
} from '@sgh/contratos';
import { contaGut } from '@sgh/dominio-qualidade';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import {
  lerNaoConformidades,
  lerResumoGestao,
  lerRiscos,
  type NaoConformidadeTela,
  type RiscoTela,
} from '../api-gestao.js';
import ErroGestao from '../componentes/ErroGestao.vue';
import FormularioNaoConformidade from '../componentes/FormularioNaoConformidade.vue';
import HistoricoVersoes from '../../componentes/HistoricoVersoes.vue';
import CorrecoesGestao from '../componentes/CorrecoesGestao.vue';
import FormularioRisco from '../componentes/FormularioRisco.vue';
import NavGestao from '../componentes/NavGestao.vue';
import ResumoGestao from '../componentes/ResumoGestao.vue';
import { classeDaPrioridade, dataBr } from '../regras-gestao.js';

type Aba = 'riscos' | 'naoConformidades' | 'escala';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const resumo = useQuery({
  queryKey: ['gestaoQualidade', 'resumo'],
  queryFn: lerResumoGestao,
  staleTime: 60_000,
});
const podeRegistrar = computed(() => resumo.data.value?.podeRegistrar ?? false);

const q = rota.query;
const abaNaRota = String(q['aba'] ?? '');
const aba = ref<Aba>(abaNaRota === 'naoConformidades' || abaNaRota === 'escala' ? abaNaRota : 'riscos');
const idOrigem = Number(q['id']);
const origemNaRota =
  typeof q['origem'] === 'string' && q['origem']
    ? { origem: q['origem'], id: Number.isInteger(idOrigem) && idOrigem > 0 ? idOrigem : null }
    : undefined;
const aviso = ref<string | null>(null);

// ── Riscos ──
const filtroRiscos = reactive({ situacao: '', pagina: 1 });
const opSituacaoRisco = [
  { valor: '', rotulo: t('gestaoQualidade.todas') },
  ...SITUACOES_RISCO.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo })),
];
watch(
  () => filtroRiscos.situacao,
  () => {
    filtroRiscos.pagina = 1;
  },
);
const riscos = useQuery({
  queryKey: computed(() => ['gestaoQualidade', 'riscos', { ...filtroRiscos }]),
  queryFn: () => lerRiscos({ situacao: filtroRiscos.situacao || undefined, pagina: filtroRiscos.pagina }),
  enabled: computed(() => aba.value === 'riscos'),
});
const paginasRiscos = computed(() =>
  riscos.data.value ? Math.max(1, Math.ceil(riscos.data.value.total / riscos.data.value.porPagina)) : 1,
);
const editandoRisco = ref<{ risco: RiscoTela | null } | null>(null);
async function riscoGravado(): Promise<void> {
  editandoRisco.value = null;
  aviso.value = t('gestaoQualidade.riscos.form.gravado');
  await cliente.invalidateQueries({ queryKey: ['gestaoQualidade'] });
}

// ── Não conformidades ──
const filtroNc = reactive({ situacao: '', pagina: 1 });
const opSituacaoNc = [
  { valor: '', rotulo: t('gestaoQualidade.todas') },
  ...SITUACOES_NAO_CONFORMIDADE.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo })),
];
watch(
  () => filtroNc.situacao,
  () => {
    filtroNc.pagina = 1;
  },
);
const ncs = useQuery({
  queryKey: computed(() => ['gestaoQualidade', 'ncs', { ...filtroNc }]),
  queryFn: () => lerNaoConformidades({ situacao: filtroNc.situacao || undefined, pagina: filtroNc.pagina }),
  enabled: computed(() => aba.value === 'naoConformidades'),
});
const paginasNc = computed(() =>
  ncs.data.value ? Math.max(1, Math.ceil(ncs.data.value.total / ncs.data.value.porPagina)) : 1,
);
const editandoNc = ref<{
  nc: NaoConformidadeTela | null;
  origem?: { origem: string; id: number | null } | undefined;
} | null>(origemNaRota ? { nc: null, origem: origemNaRota } : null);
function abrirNcDoRisco(r: RiscoTela): void {
  aba.value = 'naoConformidades';
  editandoNc.value = { nc: null, origem: { origem: 'risco', id: r.id } };
}
async function ncGravada(): Promise<void> {
  editandoNc.value = null;
  aviso.value = t('gestaoQualidade.nc.form.gravada');
  await cliente.invalidateQueries({ queryKey: ['gestaoQualidade'] });
}

// W0-04: cancelar a não conformidade duplicada (apontando a original) ou aberta por engano.
const correcoes = ref<InstanceType<typeof CorrecoesGestao> | null>(null);
function alterado(texto: string): void {
  aviso.value = texto;
}

const eixos: EixoGut[] = ['gravidade', 'urgencia', 'tendencia'];
</script>

<template>
  <section class="tela-gestao" aria-labelledby="riscos-titulo" data-testid="tela-riscos">
    <NavGestao />
    <h1 id="riscos-titulo">{{ t('gestaoQualidade.riscos.titulo') }}</h1>
    <p class="secundario">{{ t('gestaoQualidade.riscos.explicacao') }}</p>
    <ResumoGestao :partes="['gestao']" />
    <div class="abas abas-ccih" role="tablist" :aria-label="t('gestaoQualidade.riscos.abas.rotulo')">
      <SanteBotao
        v-for="a in ['riscos', 'naoConformidades', 'escala'] as const"
        :key="a"
        role="tab"
        :aria-selected="aba === a"
        variante="secundario"
        :rotulo="t(`gestaoQualidade.riscos.abas.${a}`)"
        :data-testid="`aba-${a}`"
        @acionar="aba = a"
      />
    </div>
    <div v-if="aviso" role="status" data-testid="gestao-aviso">{{ aviso }}</div>

    <!-- Riscos -->
    <template v-if="aba === 'riscos'">
      <div class="linha-ccih">
        <SanteSelecao
          v-model="filtroRiscos.situacao"
          :rotulo="t('gestaoQualidade.situacao')"
          :opcoes="opSituacaoRisco"
          data-testid="risco-filtro"
        />
        <SanteBotao
          v-if="podeRegistrar && !editandoRisco"
          :rotulo="t('gestaoQualidade.riscos.novo')"
          data-testid="risco-novo"
          @acionar="editandoRisco = { risco: null }"
        />
      </div>
      <FormularioRisco
        v-if="editandoRisco"
        :key="editandoRisco.risco?.id ?? 'novo'"
        :risco="editandoRisco.risco"
        @gravado="riscoGravado"
        @cancelar="editandoRisco = null"
      />
      <ErroGestao v-if="riscos.isError.value" :erro="riscos.error.value" />
      <p v-else-if="!riscos.data.value" role="status">{{ t('gestaoQualidade.carregando') }}</p>
      <p v-else-if="!riscos.data.value.itens.length" data-testid="risco-vazio">
        {{ t('gestaoQualidade.riscos.nenhum') }}
      </p>
      <template v-else>
        <table class="tabela" data-testid="tabela-riscos">
          <caption>
            {{
              t('gestaoQualidade.riscos.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('gestaoQualidade.riscos.colTitulo') }}</th>
              <th scope="col">{{ t('gestaoQualidade.riscos.colCategoria') }}</th>
              <th scope="col">{{ t('gestaoQualidade.riscos.colGut') }}</th>
              <th scope="col">{{ t('gestaoQualidade.riscos.colPrioridade') }}</th>
              <th scope="col">{{ t('gestaoQualidade.situacao') }}</th>
              <th scope="col">{{ t('gestaoQualidade.riscos.colReavaliar') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in riscos.data.value.itens" :key="r.id" :data-testid="`risco-${r.id}`">
              <td>
                <strong>{{ r.titulo }}</strong>
                <div class="secundario">
                  {{
                    t('gestaoQualidade.riscos.areaResponsavel', { area: r.area, responsavel: r.responsavel })
                  }}
                </div>
                <div v-if="podeRegistrar" class="linha-ccih">
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('gestaoQualidade.riscos.reavaliar')"
                    :data-testid="`reavaliar-${r.id}`"
                    @acionar="editandoRisco = { risco: r }"
                  />
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('gestaoQualidade.riscos.abrirNc')"
                    :data-testid="`nc-do-risco-${r.id}`"
                    @acionar="abrirNcDoRisco(r)"
                  />
                </div>
              </td>
              <td>{{ rotuloCategoriaRisco(r.categoria) }}</td>
              <td>{{ contaGut(r.gravidade, r.urgencia, r.tendencia) }}</td>
              <td>
                <span :class="classeDaPrioridade(r.prioridade)">{{
                  rotuloPrioridadeRisco(r.prioridade)
                }}</span>
              </td>
              <td>{{ rotuloSituacaoRisco(r.situacao) }}</td>
              <td>
                {{ dataBr(r.reavaliarEm) }}
                <div v-if="r.reavaliacaoVencida" class="prazo prazo--vencido">
                  {{ t('gestaoQualidade.riscos.reavaliacaoVencida') }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="paginasRiscos > 1" class="linha-ccih">
          <SanteBotao
            variante="secundario"
            :rotulo="t('gestaoQualidade.anterior')"
            :desabilitado="filtroRiscos.pagina <= 1"
            @acionar="filtroRiscos.pagina--"
          />
          <span>{{
            t('gestaoQualidade.paginaDe', { pagina: filtroRiscos.pagina, total: paginasRiscos })
          }}</span>
          <SanteBotao
            variante="secundario"
            :rotulo="t('gestaoQualidade.proxima')"
            :desabilitado="filtroRiscos.pagina >= paginasRiscos"
            @acionar="filtroRiscos.pagina++"
          />
        </div>
      </template>
    </template>

    <!-- Não conformidades -->
    <template v-if="aba === 'naoConformidades'">
      <div class="linha-ccih">
        <SanteSelecao
          v-model="filtroNc.situacao"
          :rotulo="t('gestaoQualidade.situacao')"
          :opcoes="opSituacaoNc"
          data-testid="nc-filtro"
        />
        <SanteBotao
          v-if="podeRegistrar && !editandoNc"
          :rotulo="t('gestaoQualidade.nc.nova')"
          data-testid="nc-nova"
          @acionar="editandoNc = { nc: null }"
        />
      </div>
      <FormularioNaoConformidade
        v-if="editandoNc && podeRegistrar"
        :key="editandoNc.nc?.id ?? `nova-${editandoNc.origem?.origem ?? ''}-${editandoNc.origem?.id ?? ''}`"
        :nao-conformidade="editandoNc.nc"
        :origem="editandoNc.origem"
        @gravado="ncGravada"
        @cancelar="editandoNc = null"
      />
      <ErroGestao v-if="ncs.isError.value" :erro="ncs.error.value" />
      <p v-else-if="!ncs.data.value" role="status">{{ t('gestaoQualidade.carregando') }}</p>
      <p v-else-if="!ncs.data.value.itens.length" data-testid="nc-vazio">
        {{ t('gestaoQualidade.nc.nenhuma') }}
      </p>
      <template v-else>
        <table class="tabela" data-testid="tabela-nc">
          <caption>
            {{
              t('gestaoQualidade.nc.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('gestaoQualidade.nc.colDescricao') }}</th>
              <th scope="col">{{ t('gestaoQualidade.nc.colOrigem') }}</th>
              <th scope="col">{{ t('gestaoQualidade.nc.colClassificacao') }}</th>
              <th scope="col">{{ t('gestaoQualidade.situacao') }}</th>
              <th scope="col">{{ t('gestaoQualidade.prazo') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="n in ncs.data.value.itens" :key="n.id" :data-testid="`nc-${n.id}`">
              <td>
                <strong>{{ n.id }}</strong> {{ n.descricao }}
                <div class="secundario">{{ n.area }}{{ n.responsavel ? `; ${n.responsavel}` : '' }}</div>
                <template v-if="n.canceladaEm">
                  <span class="selo" :data-testid="`nc-inativa-${n.id}`">{{
                    t('qualidade.correcao.inativo')
                  }}</span>
                  <span v-if="n.duplicadaDe" class="secundario">
                    {{ t('qualidade.correcao.naoConformidade.duplicadaDe', { id: n.duplicadaDe }) }}
                  </span>
                  <div class="secundario">
                    {{
                      t('qualidade.correcao.cancelada', {
                        em: dataBr(n.canceladaEm),
                        motivo: n.motivoCancelamento ?? '',
                      })
                    }}
                  </div>
                </template>
                <template v-else>
                  <SanteBotao
                    v-if="podeRegistrar && n.situacao !== 'encerrada'"
                    variante="texto"
                    :rotulo="t('gestaoQualidade.nc.andamento')"
                    :data-testid="`andamento-nc-${n.id}`"
                    @acionar="editandoNc = { nc: n }"
                  />
                  <SanteBotao
                    v-if="podeRegistrar && n.situacao === 'aberta'"
                    variante="texto"
                    :rotulo="t('qualidade.correcao.cancelarRegistro')"
                    :data-testid="`cancelar-nc-${n.id}`"
                    @acionar="correcoes?.cancelarNaoConformidade(n, ncs.data.value?.itens ?? [])"
                  />
                </template>
                <HistoricoVersoes registro="nao-conformidade" :id="n.id" />
              </td>
              <td>
                {{ rotuloOrigemNaoConformidade(n.origem) }}{{ n.idOrigem !== null ? ` ${n.idOrigem}` : '' }}
              </td>
              <td>{{ rotuloClassificacaoNaoConformidade(n.classificacao) }}</td>
              <td>{{ rotuloSituacaoNaoConformidade(n.situacao) }}</td>
              <td>
                {{ dataBr(n.prazo) || '—' }}
                <div v-if="n.vencida" class="prazo prazo--vencido" :data-testid="`nc-vencida-${n.id}`">
                  {{ t('gestaoQualidade.nc.vencida') }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="paginasNc > 1" class="linha-ccih">
          <SanteBotao
            variante="secundario"
            :rotulo="t('gestaoQualidade.anterior')"
            :desabilitado="filtroNc.pagina <= 1"
            @acionar="filtroNc.pagina--"
          />
          <span>{{ t('gestaoQualidade.paginaDe', { pagina: filtroNc.pagina, total: paginasNc }) }}</span>
          <SanteBotao
            variante="secundario"
            :rotulo="t('gestaoQualidade.proxima')"
            :desabilitado="filtroNc.pagina >= paginasNc"
            @acionar="filtroNc.pagina++"
          />
        </div>
      </template>
    </template>

    <!-- Escala GUT -->
    <template v-if="aba === 'escala'">
      <table class="tabela" data-testid="tabela-escala">
        <caption>
          {{
            t('gestaoQualidade.riscos.escala.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('gestaoQualidade.riscos.escala.ponto') }}</th>
            <th v-for="e in eixos" :key="e" scope="col">{{ t(`gestaoQualidade.riscos.form.${e}`) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="k in [0, 1, 2, 3, 4]" :key="k">
            <th scope="row">{{ k + 1 }}</th>
            <td v-for="e in eixos" :key="e">{{ ESCALA_GUT[e][k] }}</td>
          </tr>
        </tbody>
      </table>
      <h2>{{ t('gestaoQualidade.riscos.escala.prioridades') }}</h2>
      <ul class="lista-ccih" data-testid="escala-prioridades">
        <li v-for="p in PRIORIDADES_RISCO" :key="p.codigo">
          <span :class="classeDaPrioridade(p.codigo)">{{ p.rotulo }}</span>
          {{ t('gestaoQualidade.riscos.escala.aPartirDe', { n: p.minimo }) }}
        </li>
      </ul>
      <section class="painel-ccih" aria-labelledby="escala-cadastro-titulo">
        <h2 id="escala-cadastro-titulo">{{ t('gestaoQualidade.riscos.escala.cadastro') }}</h2>
        <p class="secundario">{{ t('gestaoQualidade.riscos.escala.cadastroExplicacao') }}</p>
        <div class="linha-ccih">
          <RouterLink to="/cadastros/dominios/qualidade/gutTipo" data-testid="escala-cadastro-tipos">{{
            t('gestaoQualidade.riscos.escala.tipos')
          }}</RouterLink>
          <RouterLink to="/cadastros/dominios/qualidade/gutGrau" data-testid="escala-cadastro-graus">{{
            t('gestaoQualidade.riscos.escala.graus')
          }}</RouterLink>
        </div>
      </section>
    </template>
    <CorrecoesGestao ref="correcoes" @alterado="alterado" />
  </section>
</template>
