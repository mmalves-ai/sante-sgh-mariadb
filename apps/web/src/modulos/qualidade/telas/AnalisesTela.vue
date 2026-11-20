<script setup lang="ts">
// Qualidade e segurança › Segurança do paciente (NSP) › Análise (causa raiz) e plano de ação 5W2H (M48, etapa 2;
// ficha, seção 7): as notificações distribuídas, em análise e concluídas, com o prazo da análise (60 dias para óbito e
// never event). O NSP vê todas; o gestor da área, só as distribuídas a ele (o servidor filtra; sem quem notificou).
import { CLASSIFICACOES_OMS, SITUACOES_NOTIFICACAO, TIPOS_INCIDENTE } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { listarAnalises } from '../api-seguranca.js';
import ErroQualidade from '../componentes/ErroQualidade.vue';
import { dataCurta } from '../regras-seguranca.js';
import { dataHora } from '../regras-qualidade.js';

const { t } = useI18n();
const situacao = ref('');
const pagina = ref(1);
watch(situacao, () => (pagina.value = 1));
const lista = useQuery({
  queryKey: computed(() => ['qualidade', 'analises', situacao.value, pagina.value]),
  queryFn: () => listarAnalises({ situacao: situacao.value, pagina: pagina.value }),
  placeholderData: keepPreviousData,
  refetchInterval: 120_000,
});
const opSituacao = [
  { valor: '', rotulo: t('qualidade.analise.todas') },
  ...SITUACOES_NOTIFICACAO.filter((s) => ['distribuida', 'emAnalise', 'concluida'].includes(s.codigo)).map(
    (s) => ({ valor: s.codigo as string, rotulo: s.rotulo }),
  ),
];
const rotulo = {
  tipo: (c: string) => TIPOS_INCIDENTE.find((x) => x.codigo === c)?.rotulo ?? c,
  classificacao: (c: string) => CLASSIFICACOES_OMS.find((x) => x.codigo === c)?.rotulo ?? c,
  situacao: (c: string) => SITUACOES_NOTIFICACAO.find((x) => x.codigo === c)?.rotulo ?? c,
};
const vencida = (prazo: string | null, concluida: string | null, agora: string) =>
  prazo !== null && concluida === null && prazo < agora.slice(0, 10);
const podeVigilancia = computed(() => pode('qualidade.tecnovigilancia.ler'));
const podePainel = computed(() => pode('qualidade.protocolo.ler'));
</script>

<template>
  <section class="tela-agenda" aria-labelledby="analises-titulo" data-testid="tela-analises">
    <h1 id="analises-titulo">{{ t('qualidade.analise.listaTitulo') }}</h1>
    <p>{{ t('qualidade.analise.listaExplicacao') }}</p>
    <p class="acoes">
      <RouterLink to="/qualidade/acoes" data-testid="ir-minhas-acoes">{{
        t('qualidade.minhas.titulo')
      }}</RouterLink>
      <RouterLink v-if="podePainel" to="/qualidade/nsp/protocolos" data-testid="ir-painel">{{
        t('qualidade.painel.titulo')
      }}</RouterLink>
      <RouterLink v-if="podeVigilancia" to="/qualidade/nsp/tecnovigilancia" data-testid="ir-vigilancia">{{
        t('qualidade.vigilancia.titulo')
      }}</RouterLink>
    </p>
    <form class="filtros" :aria-label="t('qualidade.lista.filtros')" @submit.prevent>
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('qualidade.analise.filtroSituacao')"
        :opcoes="opSituacao"
        data-testid="analises-situacao"
      />
    </form>
    <ErroQualidade v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('qualidade.carregando') }}</p>
    <template v-else>
      <p v-if="lista.data.value.itens.length === 0" data-testid="analises-nenhuma">
        {{ t('qualidade.analise.nenhuma') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-analises">
        <caption>
          {{
            t('qualidade.analise.legenda', { pagina: lista.data.value.pagina })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('qualidade.analise.protocolo') }}</th>
            <th scope="col">{{ t('qualidade.analise.tipo') }}</th>
            <th scope="col">{{ t('qualidade.analise.classificacao') }}</th>
            <th scope="col">{{ t('qualidade.analise.unidade') }}</th>
            <th scope="col">{{ t('qualidade.analise.situacao') }}</th>
            <th scope="col">{{ t('qualidade.analise.prazo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="n in lista.data.value.itens" :key="n.id" :data-testid="`analise-linha-${n.protocolo}`">
            <td>
              <RouterLink
                :to="`/qualidade/nsp/analises/${n.id}`"
                :data-testid="`analise-abrir-${n.protocolo}`"
                >{{ n.protocolo }}</RouterLink
              >
              <div class="secundario">{{ dataHora(n.ocorridoEm) }}</div>
            </td>
            <td>{{ rotulo.tipo(n.tipo) }}</td>
            <td>{{ rotulo.classificacao(n.classificacao) }}</td>
            <td>{{ n.unidade ?? '-' }}</td>
            <td>
              {{ rotulo.situacao(n.situacao) }}
              <div v-if="n.analiseConcluidaEm" class="secundario">
                {{ t('qualidade.analise.concluidaEm', { em: dataHora(n.analiseConcluidaEm) }) }}
              </div>
            </td>
            <td>
              {{ n.prazoAnalise ? dataCurta(n.prazoAnalise) : t('qualidade.analise.semPrazo') }}
              <span
                v-if="vencida(n.prazoAnalise, n.analiseConcluidaEm, lista.data.value.agora)"
                class="selo selo--grave"
                :data-testid="`analise-vencida-${n.protocolo}`"
                >{{ t('qualidade.analise.vencida') }}</span
              >
            </td>
          </tr>
        </tbody>
      </table>
      <nav class="acoes" :aria-label="t('qualidade.lista.paginas')">
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
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: center;
}
</style>
