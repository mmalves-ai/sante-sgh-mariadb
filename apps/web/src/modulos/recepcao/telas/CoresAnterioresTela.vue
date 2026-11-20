<script setup lang="ts">
// Tabela de cores anterior (ficha do M44, seção 7: "Cores legadas (consulta)"): `/administracao/pa/cores-legado`. Só
// consulta: as cores cadastradas antes deste sistema, com a cor convertida e a cor equivalente da classificação (pela
// posição; óbito e "outros" não têm cor de classificação). As cores em uso vivem na versão do protocolo; esta tabela
// nunca é gravada.
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerCoresAnteriores } from '../api-classificacao.js';
import ErroClassificacao from '../componentes/ErroClassificacao.vue';

const { t } = useI18n();
const cores = useQuery({
  queryKey: ['classificacao', 'cores-anteriores'],
  queryFn: () => lerCoresAnteriores(),
});
const colunas = computed(() => [
  { campo: 'codigo', rotulo: t('classificacao.coresAnteriores.codigo') },
  { campo: 'classificacao', rotulo: t('classificacao.coresAnteriores.classificacao') },
  { campo: 'cor', rotulo: t('classificacao.coresAnteriores.cor') },
  { campo: 'equivalente', rotulo: t('classificacao.coresAnteriores.equivalente') },
]);
const linhas = computed(() =>
  (cores.data.value ?? []).map((c) => ({
    id: c.id,
    codigo: c.codigoProtocolo,
    classificacao: c.classificacao,
    cor: c.corHex ?? c.corOriginal,
    equivalente: c.corEquivalente
      ? t(`classificacao.cores.${c.corEquivalente}`)
      : t('classificacao.coresAnteriores.semEquivalente'),
  })),
);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cores-ant-titulo" data-testid="tela-cores-anteriores">
    <h1 id="cores-ant-titulo">{{ t('classificacao.coresAnteriores.titulo') }}</h1>
    <p>{{ t('classificacao.coresAnteriores.texto') }}</p>
    <p class="acoes">
      <RouterLink to="/administracao/pa/protocolos">{{ t('classificacao.protocolo.titulo') }}</RouterLink>
    </p>
    <ErroClassificacao v-if="cores.isError.value" :erro="cores.error.value" />
    <p v-else-if="!cores.data.value" role="status">{{ t('classificacao.carregando') }}</p>
    <table v-else data-testid="cores-anteriores">
      <caption>
        {{
          t('classificacao.coresAnteriores.titulo')
        }}
      </caption>
      <thead>
        <tr>
          <th v-for="c in colunas" :key="c.campo" scope="col">{{ c.rotulo }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in linhas" :key="l.id">
          <td>{{ l.codigo }}</td>
          <td>{{ l.classificacao }}</td>
          <td>{{ l.cor }}</td>
          <td>{{ l.equivalente }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
