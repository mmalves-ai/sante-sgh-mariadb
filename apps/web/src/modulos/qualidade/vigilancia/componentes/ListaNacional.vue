<script setup lang="ts">
// A lista nacional de notificação compulsória como o estabelecimento a tem (o cadastro de CID com a periodicidade),
// com a busca pelo nome ou pelo CID; a atualização é a carga do catálogo (sem nova versão do Sante; regra 8). Abaixo,
// os exames cujo resultado reagente dispara a sugestão.
import { rotuloPeriodicidadeAgravo } from '@sgh/contratos';
import { SanteCampoTexto } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../../casca/sessao/pode.js';
import { lerCids } from '../api-agravo.js';
import ErroAgravo from './ErroAgravo.vue';
import GatilhosExame from './GatilhosExame.vue';

defineProps<{ podeNotificar: boolean }>();
const { t } = useI18n();
const busca = ref('');
const cids = useQuery({
  queryKey: computed(() => ['agravos', 'cids', busca.value.trim()]),
  queryFn: () => lerCids(busca.value.trim()),
  staleTime: 300_000,
});
const podeCarregar = computed(() => pode('catalogo.carga.ler'));
/** Os tipos de notificação, de surto e de periodicidade (dados de sistema, só consulta; D-DOMSIS-48.4). */
const ITEM = 'qualidade-e-seguranca.vigilancia-epidemiologica.notificacao-compulsoria-sinan-gatilho-por-cid';
</script>

<template>
  <section class="painel-ccih" aria-labelledby="agravo-lista-titulo" data-testid="lista-nacional">
    <h2 id="agravo-lista-titulo">{{ t('agravos.lista.titulo') }}</h2>
    <p class="secundario">{{ t('agravos.lista.explicacao') }}</p>
    <div class="linha-ccih">
      <SanteCampoTexto
        v-model="busca"
        :rotulo="t('agravos.lista.busca')"
        :max-bytes="40"
        data-testid="lista-busca"
      />
      <RouterLink :to="`/consultas/item/${ITEM}`" data-testid="lista-tabelas">{{
        t('agravos.lista.tabelas')
      }}</RouterLink>
      <RouterLink v-if="podeCarregar" to="/cadastros/catalogos" data-testid="lista-carga">{{
        t('agravos.lista.carga')
      }}</RouterLink>
    </div>
    <ErroAgravo v-if="cids.isError.value" :erro="cids.error.value" />
    <p v-else-if="!cids.data.value" role="status">{{ t('agravos.carregando') }}</p>
    <template v-else>
      <p class="secundario" data-testid="lista-total">
        {{
          t('agravos.lista.total', { mostrados: cids.data.value.itens.length, total: cids.data.value.total })
        }}
      </p>
      <table class="tabela" data-testid="tabela-cids">
        <caption>
          {{
            t('agravos.lista.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('agravos.lista.colCid') }}</th>
            <th scope="col">{{ t('agravos.lista.colNome') }}</th>
            <th scope="col">{{ t('agravos.lista.colPeriodicidade') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in cids.data.value.itens" :key="c.cid" :data-testid="`cid-${c.cid}`">
            <td>{{ c.cid }}</td>
            <td>{{ c.nome }}</td>
            <td>
              <span :class="c.periodicidade === 'imediata' ? 'selo selo--atencao' : 'selo selo--neutro'">{{
                rotuloPeriodicidadeAgravo(c.periodicidade)
              }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
  <GatilhosExame :pode-notificar="podeNotificar" />
</template>
