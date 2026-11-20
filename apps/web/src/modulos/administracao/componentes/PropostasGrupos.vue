<script setup lang="ts">
// Proposta do perfil por grupo (M10, ficha seção 7; ADR 0022): o perfil proposto pelas permissões que o grupo
// usa, com a contagem por categoria e a revisão recomendada por área (não exigida: até ela, o acesso de hoje
// continua). A decisão do mapa fica em Perfis e permissões.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarPropostas } from '../api.js';

const { t } = useI18n();
const consulta = useQuery({ queryKey: ['adm', 'propostas'], queryFn: () => buscarPropostas() });
const categorias = (c: Record<string, number>) =>
  Object.entries(c)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
</script>

<template>
  <section aria-labelledby="propostas-titulo" data-testid="propostas-grupos">
    <h2 id="propostas-titulo">{{ t('adm.grupos.propostas') }}</h2>
    <p>{{ t('adm.grupos.propostasTexto') }}</p>
    <p>
      <router-link to="/administracao/acesso/perfis">{{ t('adm.grupos.decidir') }}</router-link>
    </p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('adm.comum.carregando') }}</p>
    <table v-else-if="consulta.data.value">
      <caption class="oculto">
        {{
          t('adm.grupos.propostas')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('adm.usuarios.grupo') }}</th>
          <th scope="col">{{ t('adm.permissoes.perfis') }}</th>
          <th scope="col">{{ t('adm.permissoes.opcoes') }}</th>
          <th scope="col">{{ t('adm.comum.situacao') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="g in consulta.data.value.grupos" :key="g.grupo">
          <th scope="row">{{ g.grupo }}</th>
          <td>
            {{ g.perfil ?? '—' }}<small v-if="g.motivo"> ({{ g.motivo }})</small>
          </td>
          <td>
            {{ g.total
            }}<small v-if="Object.keys(g.porCategoria).length"> · {{ categorias(g.porCategoria) }}</small>
          </td>
          <td>{{ t(`adm.grupos.revisao.${g.revisao}`) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
section {
  margin-top: var(--sgh-espaco-4);
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
