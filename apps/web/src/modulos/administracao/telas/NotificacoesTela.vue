<script setup lang="ts">
// "Servidor de e-mail e notificações" (M10, ficha seção 7; regras 10 e 19): só consulta; a credencial aparece só
// como definida ou não; fora de produção, a saída é a caixa de teste.
import { useQuery } from '@tanstack/vue-query';
import { SanteAlerta } from '@sgh/ui';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarEmail } from '../api.js';

const { t } = useI18n();
const consulta = useQuery({ queryKey: ['adm', 'email'], queryFn: () => buscarEmail() });
const def = (b: boolean) => (b ? t('adm.email.definida') : t('adm.email.naoDefinida'));
</script>

<template>
  <section class="tela" aria-labelledby="email-titulo">
    <h1 id="email-titulo">{{ t('adm.email.titulo') }}</h1>
    <p>{{ t('adm.email.texto') }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('adm.comum.carregando') }}</p>
    <template v-else-if="consulta.data.value">
      <SanteAlerta v-if="consulta.data.value.saidaDeTeste" :texto="t('adm.email.teste')" variante="info" />
      <table data-testid="tabela-email">
        <caption class="oculto">
          {{
            t('adm.email.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('adm.email.servidor') }}</th>
            <th scope="col">{{ t('adm.email.porta') }}</th>
            <th scope="col">{{ t('adm.email.ssl') }}</th>
            <th scope="col">{{ t('adm.email.usuario') }}</th>
            <th scope="col">{{ t('adm.email.senha') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in consulta.data.value.servidores" :key="s.id">
            <th scope="row">{{ s.servidor }}</th>
            <td>{{ s.porta }}</td>
            <td>{{ s.ssl ? t('adm.comum.sim') : t('adm.comum.nao') }}</td>
            <td>{{ def(s.usuarioDefinido) }}</td>
            <td>{{ def(s.senhaDefinida) }}</td>
          </tr>
        </tbody>
      </table>
      <h2>{{ t('adm.email.modulos') }}</h2>
      <ul>
        <li v-for="m in consulta.data.value.modulos" :key="m.id">{{ m.nome }}</li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
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
