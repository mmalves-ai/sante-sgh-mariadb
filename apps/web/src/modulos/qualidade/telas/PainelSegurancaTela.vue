<script setup lang="ts">
// Qualidade e segurança › Segurança do paciente (NSP) › Auditoria de adesão a protocolos gerenciados (M48, etapa 2;
// ficha, seção 7; rota /qualidade/nsp/protocolos): o painel do plano de segurança do paciente no período (padrão: os
// últimos 30 dias; no máximo 12 meses). Notificações por tipo e classificação, análises no prazo, plano de ação com a
// eficácia, adesão às metas (pulseira na checagem, checklist com pausa, Morse e Braden no prazo) e às metas dos
// protocolos gerenciados: todo indicador com as parcelas impressas. Só agregados (nenhum paciente).
import { SanteBotao, SanteData } from '@sgh/ui';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerPainelSeguranca } from '../api-seguranca.js';
import ErroQualidade from '../componentes/ErroQualidade.vue';
import TabelaIndicadores from '../componentes/TabelaIndicadores.vue';
import { dataCurta } from '../regras-seguranca.js';

const { t } = useI18n();
const campos = reactive({ de: null as string | null, ate: null as string | null });
const periodo = ref<{ de: string | null; ate: string | null }>({ de: null, ate: null });
const painel = useQuery({
  queryKey: computed(() => ['qualidade', 'painel', periodo.value.de, periodo.value.ate]),
  queryFn: () => lerPainelSeguranca(periodo.value),
  placeholderData: keepPreviousData,
});
const p = computed(() => painel.data.value?.painel);
function aplicar(): void {
  periodo.value = { de: campos.de, ate: campos.ate };
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="painel-titulo" data-testid="tela-painel-seguranca">
    <h1 id="painel-titulo">{{ t('qualidade.painel.titulo') }}</h1>
    <p>{{ t('qualidade.painel.explicacao') }}</p>
    <form class="filtros" :aria-label="t('qualidade.lista.filtros')" @submit.prevent="aplicar">
      <SanteData v-model="campos.de" :rotulo="t('qualidade.painel.de')" editavel />
      <SanteData v-model="campos.ate" :rotulo="t('qualidade.painel.ate')" editavel />
      <SanteBotao :rotulo="t('qualidade.painel.aplicar')" tipo="submit" data-testid="painel-aplicar" />
    </form>
    <ErroQualidade v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!p" role="status">{{ t('qualidade.carregando') }}</p>
    <template v-else>
      <p data-testid="painel-periodo">
        {{ t('qualidade.painel.periodo', { de: dataCurta(p.periodo.de), ate: dataCurta(p.periodo.ate) }) }}
      </p>

      <section aria-labelledby="painel-notificacoes" class="painel__bloco">
        <h2 id="painel-notificacoes">{{ t('qualidade.painel.notificacoes') }}</h2>
        <dl class="painel__numeros" data-testid="painel-notificacoes">
          <div>
            <dt>{{ t('qualidade.painel.total') }}</dt>
            <dd>{{ p.notificacoes.total }}</dd>
          </div>
          <div>
            <dt>{{ t('qualidade.painel.anonimas') }}</dt>
            <dd>{{ p.notificacoes.anonimas }}</dd>
          </div>
          <div>
            <dt>{{ t('qualidade.painel.obitos') }}</dt>
            <dd>{{ p.notificacoes.obitos }}</dd>
          </div>
          <div>
            <dt>{{ t('qualidade.painel.neverEvents') }}</dt>
            <dd>{{ p.notificacoes.neverEvents }}</dd>
          </div>
          <div>
            <dt>{{ t('qualidade.painel.descartadas') }}</dt>
            <dd>{{ p.notificacoes.descartadas }}</dd>
          </div>
        </dl>
        <div class="painel__duas">
          <table class="tabela" data-testid="painel-por-tipo">
            <caption>
              {{
                t('qualidade.painel.porTipo')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('qualidade.painel.categoria') }}</th>
                <th scope="col">{{ t('qualidade.painel.quantidade') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in p.notificacoes.porTipo" :key="c.codigo">
                <th scope="row">{{ c.rotulo }}</th>
                <td>{{ c.quantidade }}</td>
              </tr>
            </tbody>
          </table>
          <table class="tabela" data-testid="painel-por-classificacao">
            <caption>
              {{
                t('qualidade.painel.porClassificacao')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('qualidade.painel.categoria') }}</th>
                <th scope="col">{{ t('qualidade.painel.quantidade') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in p.notificacoes.porClassificacao" :key="c.codigo">
                <th scope="row">{{ c.rotulo }}</th>
                <td>{{ c.quantidade }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="painel-analises" class="painel__bloco">
        <h2 id="painel-analises">{{ t('qualidade.painel.analises') }}</h2>
        <dl class="painel__numeros" data-testid="painel-analises">
          <div>
            <dt>{{ t('qualidade.painel.comPrazo') }}</dt>
            <dd>{{ p.analises.comPrazo }}</dd>
          </div>
          <div>
            <dt>{{ t('qualidade.painel.concluidas') }}</dt>
            <dd>{{ p.analises.concluidas }}</dd>
          </div>
          <div>
            <dt>{{ t('qualidade.painel.vencidas') }}</dt>
            <dd>{{ p.analises.vencidas }}</dd>
          </div>
        </dl>
        <h2>{{ t('qualidade.painel.acoes') }}</h2>
        <dl class="painel__numeros" data-testid="painel-acoes">
          <div>
            <dt>{{ t('qualidade.painel.abertas') }}</dt>
            <dd>{{ p.acoes.abertas }}</dd>
          </div>
          <div>
            <dt>{{ t('qualidade.painel.atrasadas') }}</dt>
            <dd>{{ p.acoes.atrasadas }}</dd>
          </div>
          <div>
            <dt>{{ t('qualidade.painel.acoesConcluidas') }}</dt>
            <dd>{{ p.acoes.concluidas }}</dd>
          </div>
          <div>
            <dt>{{ t('qualidade.painel.canceladas') }}</dt>
            <dd>{{ p.acoes.canceladas }}</dd>
          </div>
        </dl>
        <TabelaIndicadores
          :titulo="t('qualidade.painel.analises')"
          :indicadores="[p.analises.noPrazo, p.acoes.eficacia]"
          testid="painel-indicadores-nsp"
        />
      </section>

      <section aria-labelledby="painel-adesao" class="painel__bloco">
        <h2 id="painel-adesao">{{ t('qualidade.painel.adesao') }}</h2>
        <TabelaIndicadores
          :titulo="t('qualidade.painel.adesao')"
          :indicadores="p.adesao"
          testid="painel-adesao"
        />
        <h2>{{ t('qualidade.painel.protocolos') }}</h2>
        <p v-if="p.protocolosCortados" role="status" data-testid="painel-protocolos-cortados">
          {{ t('qualidade.painel.protocolosCortados') }}
        </p>
        <p v-if="p.protocolosGerenciados.length === 0" data-testid="painel-sem-protocolos">
          {{ t('qualidade.painel.nenhumProtocolo') }}
        </p>
        <TabelaIndicadores
          v-else
          :titulo="t('qualidade.painel.protocolos')"
          :indicadores="p.protocolosGerenciados"
          testid="painel-protocolos"
        />
      </section>

      <section aria-labelledby="painel-historico" class="painel__bloco">
        <h2 id="painel-historico">{{ t('qualidade.painel.historico') }}</h2>
        <p v-if="p.historicoRiscos.length === 0">{{ t('qualidade.painel.nenhumHistorico') }}</p>
        <table v-else class="tabela" data-testid="painel-historico">
          <caption>
            {{
              t('qualidade.painel.historico')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('qualidade.painel.ano') }}</th>
              <th scope="col">{{ t('qualidade.painel.registros') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in p.historicoRiscos" :key="h.ano">
              <th scope="row">{{ h.ano }}</th>
              <td>{{ h.registros }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style>
@import '../componentes/estilo-qualidade.css';
</style>
<style scoped>
.painel__bloco {
  margin-block: var(--sgh-espaco-4, 1.5rem);
}
.painel__numeros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  margin: 0 0 var(--sgh-espaco-3);
}
.painel__numeros div {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  min-width: 9rem;
}
.painel__numeros dt {
  font-size: var(--sgh-fonte-pequena);
  color: var(--sgh-texto-secundario);
}
.painel__numeros dd {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
}
.painel__duas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-4, 1.5rem);
}
</style>
