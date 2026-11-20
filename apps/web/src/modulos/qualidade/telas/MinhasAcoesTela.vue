<script setup lang="ts">
// Minhas ações do plano de segurança (M48, etapa 2): as ações 5W2H abertas de que a pessoa é a responsável, pelo prazo,
// com a marca de atrasada. Quem executa a ação nem sempre analisa: o link da análise aparece só para quem a lê.
import { SITUACOES_ACAO } from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { lerMinhasAcoes } from '../api-seguranca.js';
import ErroQualidade from '../componentes/ErroQualidade.vue';
import { dataCurta } from '../regras-seguranca.js';

const { t } = useI18n();
const minhas = useQuery({ queryKey: ['qualidade', 'acoes', 'minhas'], queryFn: lerMinhasAcoes });
const leAnalise = computed(() => pode('qualidade.analise.ler'));
const rotuloSituacao = (c: string) => SITUACOES_ACAO.find((s) => s.codigo === c)?.rotulo ?? c;
const itens = computed(() =>
  [...(minhas.data.value?.itens ?? [])].sort((a, b) => a.quando.localeCompare(b.quando)),
);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="minhas-titulo" data-testid="tela-minhas-acoes">
    <h1 id="minhas-titulo">{{ t('qualidade.minhas.titulo') }}</h1>
    <p>{{ t('qualidade.minhas.explicacao') }}</p>
    <ErroQualidade v-if="minhas.isError.value" :erro="minhas.error.value" />
    <p v-else-if="!minhas.data.value" role="status">{{ t('qualidade.carregando') }}</p>
    <p v-else-if="itens.length === 0" data-testid="minhas-nenhuma">{{ t('qualidade.minhas.nenhuma') }}</p>
    <table v-else class="tabela" data-testid="tabela-minhas">
      <caption>
        {{
          t('qualidade.minhas.legenda')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('qualidade.plano.quando') }}</th>
          <th scope="col">{{ t('qualidade.plano.oQue') }}</th>
          <th scope="col">{{ t('qualidade.plano.onde') }}</th>
          <th scope="col">{{ t('qualidade.plano.como') }}</th>
          <th scope="col">{{ t('qualidade.plano.situacao') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in itens" :key="a.id" :data-testid="`minha-${a.id}`">
          <td>
            {{ dataCurta(a.quando) }}
            <span v-if="a.atrasada" class="selo selo--grave">{{ t('qualidade.plano.atrasada') }}</span>
          </td>
          <td>
            {{ a.oQue }}
            <div v-if="leAnalise" class="secundario">
              <RouterLink :to="`/qualidade/nsp/analises/${a.notificacao}`">{{
                t('qualidade.minhas.abrir')
              }}</RouterLink>
            </div>
          </td>
          <td>{{ a.onde }}</td>
          <td>{{ a.como }}</td>
          <td>{{ rotuloSituacao(a.situacao) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style>
@import '../componentes/estilo-qualidade.css';
</style>
