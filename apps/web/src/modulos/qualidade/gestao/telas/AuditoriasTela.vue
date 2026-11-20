<script setup lang="ts">
// Qualidade e segurança › Gestão da qualidade › Auditorias internas por checklist (M48, etapa 5; ficha, seção 7;
// manual "Auditorias internas"). A lista das auditorias com a conformidade e as não conformidades abertas a partir
// delas, a auditoria aberta com o checklist e a nova auditoria (o checklist de uma anterior como modelo).
import '../../componentes/estilo-qualidade.css';
import '../../ccih/componentes/estilo-ccih.css';
import '../componentes/estilo-gestao.css';
import { rotuloReferencialAuditoria, rotuloResultadoItemAuditoria } from '@sgh/contratos';
import { numeroBr } from '@sgh/dominio-qualidade';
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerAuditoria, lerAuditorias, lerResumoGestao } from '../api-gestao.js';
import HistoricoVersoes from '../../componentes/HistoricoVersoes.vue';
import CorrecoesGestao from '../componentes/CorrecoesGestao.vue';
import ErroGestao from '../componentes/ErroGestao.vue';
import FormularioAuditoria from '../componentes/FormularioAuditoria.vue';
import NavGestao from '../componentes/NavGestao.vue';
import ResumoGestao from '../componentes/ResumoGestao.vue';
import { dataBr } from '../regras-gestao.js';

const { t } = useI18n();
const cliente = useQueryClient();
const resumo = useQuery({
  queryKey: ['gestaoQualidade', 'resumo'],
  queryFn: lerResumoGestao,
  staleTime: 60_000,
});
const podeRegistrar = computed(() => resumo.data.value?.podeRegistrar ?? false);
const hoje = computed(() => resumo.data.value?.agora.slice(0, 10) ?? '');

const pagina = ref(1);
const lista = useQuery({
  queryKey: computed(() => ['gestaoQualidade', 'auditorias', pagina.value]),
  queryFn: () => lerAuditorias(pagina.value),
});
const paginas = computed(() =>
  lista.data.value ? Math.max(1, Math.ceil(lista.data.value.total / lista.data.value.porPagina)) : 1,
);
const aberta = ref<number | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['gestaoQualidade', 'auditoria', aberta.value]),
  queryFn: () => lerAuditoria(aberta.value as number),
  enabled: computed(() => aberta.value !== null),
});
const nova = ref(false);
const aviso = ref<string | null>(null);
async function gravada(id: number): Promise<void> {
  nova.value = false;
  aviso.value = t('gestaoQualidade.auditorias.form.gravada');
  aberta.value = id;
  await cliente.invalidateQueries({ queryKey: ['gestaoQualidade'] });
}
// W0-04: alterar com versão e cancelar com motivo (a cancelada fica visível como inativa).
const correcoes = ref<InstanceType<typeof CorrecoesGestao> | null>(null);
function alterado(texto: string): void {
  aviso.value = texto;
}
const conformidade = (v: number | null) => (v === null ? '—' : `${numeroBr(v)}%`);
</script>

<template>
  <section class="tela-gestao" aria-labelledby="auditorias-titulo" data-testid="tela-auditorias">
    <NavGestao />
    <h1 id="auditorias-titulo">{{ t('gestaoQualidade.auditorias.titulo') }}</h1>
    <p class="secundario">{{ t('gestaoQualidade.auditorias.explicacao') }}</p>
    <ResumoGestao :partes="['gestao']" />
    <div v-if="aviso" role="status" data-testid="gestao-aviso">{{ aviso }}</div>
    <div class="linha-ccih">
      <SanteBotao
        v-if="podeRegistrar && !nova"
        :rotulo="t('gestaoQualidade.auditorias.nova')"
        data-testid="aud-nova"
        @acionar="
          nova = true;
          aberta = null;
        "
      />
    </div>
    <FormularioAuditoria
      v-if="nova && hoje"
      :hoje="hoje"
      :modelos="lista.data.value?.itens ?? []"
      @gravado="gravada"
      @cancelar="nova = false"
    />

    <section
      v-if="aberta !== null"
      class="painel-ccih"
      aria-labelledby="auditoria-titulo"
      data-testid="auditoria-detalhe"
    >
      <ErroGestao v-if="detalhe.isError.value" :erro="detalhe.error.value" />
      <p v-else-if="!detalhe.data.value" role="status">{{ t('gestaoQualidade.carregando') }}</p>
      <template v-else>
        <h2 id="auditoria-titulo">
          {{ detalhe.data.value.titulo }}
          <span v-if="detalhe.data.value.canceladaEm" class="selo" data-testid="aud-inativa">{{
            t('qualidade.correcao.inativo')
          }}</span>
        </h2>
        <p v-if="detalhe.data.value.canceladaEm" class="secundario" data-testid="aud-cancelada">
          {{
            t('qualidade.correcao.cancelada', {
              em: dataBr(detalhe.data.value.canceladaEm),
              motivo: detalhe.data.value.motivoCancelamento ?? '',
            })
          }}
        </p>
        <p class="secundario">{{ t('qualidade.correcao.versaoAtual', { v: detalhe.data.value.versao }) }}</p>
        <dl class="ficha-gestao">
          <dt>{{ t('gestaoQualidade.area') }}</dt>
          <dd>{{ detalhe.data.value.area }}</dd>
          <dt>{{ t('gestaoQualidade.auditorias.colReferencial') }}</dt>
          <dd>{{ rotuloReferencialAuditoria(detalhe.data.value.referencial) }}</dd>
          <dt>{{ t('gestaoQualidade.auditorias.colData') }}</dt>
          <dd>{{ dataBr(detalhe.data.value.realizadaEm) }}</dd>
          <dt>{{ t('gestaoQualidade.auditorias.detalhe.auditores') }}</dt>
          <dd>{{ detalhe.data.value.auditores }}</dd>
          <dt>{{ t('gestaoQualidade.auditorias.colConformidade') }}</dt>
          <dd data-testid="aud-conformidade">{{ detalhe.data.value.resultado.conta ?? '—' }}</dd>
          <dt>{{ t('gestaoQualidade.auditorias.colNc') }}</dt>
          <dd>{{ detalhe.data.value.naoConformidades }}</dd>
          <dt>{{ t('gestaoQualidade.auditorias.detalhe.conclusao') }}</dt>
          <dd>{{ detalhe.data.value.conclusao }}</dd>
        </dl>
        <table class="tabela" data-testid="aud-checklist">
          <caption>
            {{
              t('gestaoQualidade.auditorias.detalhe.checklist')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('gestaoQualidade.auditorias.detalhe.colSecao') }}</th>
              <th scope="col">{{ t('gestaoQualidade.auditorias.detalhe.colRequisito') }}</th>
              <th scope="col">{{ t('gestaoQualidade.auditorias.detalhe.colResultado') }}</th>
              <th scope="col">{{ t('gestaoQualidade.auditorias.detalhe.colEvidencia') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(i, k) in detalhe.data.value.itens" :key="k">
              <td>{{ i.secao ?? '' }}</td>
              <td>{{ i.requisito }}</td>
              <td>
                <span
                  :class="
                    i.resultado === 'naoConforme'
                      ? 'prazo prazo--vencido'
                      : i.resultado === 'parcial'
                        ? 'prazo prazo--venceEmBreve'
                        : 'selo'
                  "
                  >{{ rotuloResultadoItemAuditoria(i.resultado) }}</span
                >
              </td>
              <td>{{ i.evidencia ?? '' }}</td>
            </tr>
          </tbody>
        </table>
        <div class="linha-ccih">
          <RouterLink
            v-if="podeRegistrar"
            :to="`/qualidade/gestao/riscos?aba=naoConformidades&origem=auditoria&id=${detalhe.data.value.id}`"
            data-testid="aud-abrir-nc"
            >{{ t('gestaoQualidade.auditorias.detalhe.abrirNc') }}</RouterLink
          >
          <template v-if="podeRegistrar && !detalhe.data.value.canceladaEm">
            <SanteBotao
              :rotulo="t('qualidade.correcao.alterar')"
              variante="secundario"
              data-testid="aud-alterar"
              @acionar="correcoes?.alterarAuditoria(detalhe.data.value)"
            />
            <SanteBotao
              :rotulo="t('qualidade.correcao.cancelarRegistro')"
              variante="texto"
              data-testid="aud-cancelar"
              @acionar="correcoes?.cancelarAuditoria(detalhe.data.value)"
            />
          </template>
          <HistoricoVersoes registro="auditoria" :id="detalhe.data.value.id" />
          <SanteBotao :rotulo="t('gestaoQualidade.fechar')" variante="texto" @acionar="aberta = null" />
        </div>
      </template>
    </section>

    <ErroGestao v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('gestaoQualidade.carregando') }}</p>
    <p v-else-if="!lista.data.value.itens.length" data-testid="aud-vazio">
      {{ t('gestaoQualidade.auditorias.nenhuma') }}
    </p>
    <template v-else>
      <table class="tabela" data-testid="tabela-auditorias">
        <caption>
          {{
            t('gestaoQualidade.auditorias.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('gestaoQualidade.auditorias.colData') }}</th>
            <th scope="col">{{ t('gestaoQualidade.auditorias.colTitulo') }}</th>
            <th scope="col">{{ t('gestaoQualidade.auditorias.colReferencial') }}</th>
            <th scope="col">{{ t('gestaoQualidade.auditorias.colConformidade') }}</th>
            <th scope="col">{{ t('gestaoQualidade.auditorias.colNc') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in lista.data.value.itens" :key="a.id" :data-testid="`auditoria-${a.id}`">
            <td>{{ dataBr(a.realizadaEm) }}</td>
            <td>
              <SanteBotao
                variante="texto"
                :rotulo="a.titulo"
                :data-testid="`abrir-auditoria-${a.id}`"
                @acionar="
                  nova = false;
                  aberta = a.id;
                "
              />
              <div class="secundario">
                {{ a.area }}
                <span v-if="a.canceladaEm" class="selo">{{ t('qualidade.correcao.inativo') }}</span>
              </div>
            </td>
            <td>{{ rotuloReferencialAuditoria(a.referencial) }}</td>
            <td :title="a.resultado.conta ?? ''">{{ conformidade(a.resultado.conformidade) }}</td>
            <td>{{ a.naoConformidades }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="paginas > 1" class="linha-ccih">
        <SanteBotao
          variante="secundario"
          :rotulo="t('gestaoQualidade.anterior')"
          :desabilitado="pagina <= 1"
          @acionar="pagina--"
        />
        <span>{{ t('gestaoQualidade.paginaDe', { pagina, total: paginas }) }}</span>
        <SanteBotao
          variante="secundario"
          :rotulo="t('gestaoQualidade.proxima')"
          :desabilitado="pagina >= paginas"
          @acionar="pagina++"
        />
      </div>
    </template>
    <CorrecoesGestao ref="correcoes" @alterado="alterado" />
  </section>
</template>
