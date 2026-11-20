<script setup lang="ts">
// Divergência de cadastro de leitos (M16; regra 2): o cadastro de leitos (a fonte do painel) × o registro de
// conferência que o banco mantém a partir dele; cada divergência com a orientação do que fazer no cadastro.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { lerDivergencias } from '../api-internacao.js';
import { formatarDataHora } from '../formato.js';

const { t, te } = useI18n();
const d = useQuery({ queryKey: ['internacao', 'divergencias'], queryFn: () => lerDivergencias() });
const tipo = (x: string) =>
  te(`internacao.divergencias.tipos.${x}`) ? t(`internacao.divergencias.tipos.${x}`) : x;
</script>

<template>
  <section class="tela" aria-labelledby="div-titulo">
    <h1 id="div-titulo">{{ t('internacao.divergencias.titulo') }}</h1>
    <p>{{ t('internacao.divergencias.texto') }}</p>
    <MensagemErro v-if="d.isError.value" :erro="d.error.value" />
    <p v-else-if="d.isPending.value">{{ t('internacao.comum.carregando') }}</p>
    <template v-else-if="d.data.value">
      <p role="status" data-testid="div-contagens">
        {{
          t('internacao.divergencias.contagens', {
            ...d.data.value.contagens,
            retratos: d.data.value.retratos,
          })
        }}
        · {{ t('internacao.comum.dadosAte', { quando: formatarDataHora(d.data.value.lidoEm) }) }}
      </p>
      <p v-if="pode('organizacao.leito.ler')">
        <RouterLink to="/cadastros/estrutura/leitos">{{ t('internacao.divergencias.cadastro') }}</RouterLink>
      </p>
      <p v-if="d.data.value.divergencias.length === 0" data-testid="div-nenhuma">
        {{ t('internacao.divergencias.nenhuma') }}
      </p>
      <table v-else data-testid="div-tabela">
        <caption>
          {{
            t('internacao.divergencias.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('internacao.divergencias.chave') }}</th>
            <th scope="col">{{ t('internacao.divergencias.tipo') }}</th>
            <th scope="col">{{ t('internacao.divergencias.orientacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in d.data.value.divergencias" :key="`${x.tipo}-${x.chave}`">
            <th scope="row">{{ x.chave.replaceAll('|', '/') }}</th>
            <td>{{ tipo(x.tipo) }}</td>
            <td>{{ x.orientacao }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
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
caption {
  text-align: left;
  font-weight: 600;
}
</style>
