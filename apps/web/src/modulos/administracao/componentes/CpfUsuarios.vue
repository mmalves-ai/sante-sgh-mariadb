<script setup lang="ts">
// "Usuários" > "Identidade única" (W1-01, parte 3c; NGS1.03.09 c,e): as contas pessoais ativas sem CPF e os logins
// que repartem o mesmo CPF (agrupados por pessoa, sem o número do CPF). Corrigir é pela ficha: informar o CPF com
// justificativa ou bloquear o login a mais. As contas de aparelho (grupo dos painéis) só aparecem na contagem.
import { useQuery } from '@tanstack/vue-query';
import type { ContaCpf } from '@sgh/contratos';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarPainelCpf } from '../api.js';
import RedeCpf from './RedeCpf.vue';
import { CAMINHO_LISTA_USUARIOS } from '../usuarios-tela.js';

const P = 'adm.usuarios.cpf';
const { t } = useI18n();
// W1-01 (11c): ?rede=LOGIN abre "A pessoa na rede" já com o login (vindo da ficha).
const rota = useRoute();
const loginRede = computed(() => (typeof rota.query['rede'] === 'string' ? rota.query['rede'] : undefined));
const consulta = useQuery({ queryKey: ['usuarios-cpf'], queryFn: buscarPainelCpf });
const dados = computed(() => consulta.data.value);
const caminhoFicha = (login: string) => `${CAMINHO_LISTA_USUARIOS}/${encodeURIComponent(login)}`;
const situacao = (c: ContaCpf) =>
  c.bloqueado ? t(`${P}.bloqueado`) : c.ativo ? t(`${P}.ativo`) : t(`${P}.inativo`);
</script>

<template>
  <div class="cpf-usuarios" data-testid="usuarios-cpf">
    <h2>{{ t(`${P}.titulo`) }}</h2>
    <p>{{ t(`${P}.texto`) }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('adm.comum.carregando') }}</p>
    <template v-else-if="dados">
      <section aria-labelledby="cpf-sem-titulo" data-testid="usuarios-sem-cpf">
        <h3 id="cpf-sem-titulo">{{ t(`${P}.semCpf`) }} ({{ dados.semCpf.length }})</h3>
        <p v-if="dados.semCpf.length === 0">{{ t(`${P}.semCpfNenhuma`) }}</p>
        <table v-else class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t(`${P}.login`) }}</th>
              <th scope="col">{{ t(`${P}.nome`) }}</th>
              <th scope="col">{{ t(`${P}.grupo`) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in dados.semCpf" :key="c.login" :data-testid="`sem-cpf-${c.login}`">
              <td>
                <RouterLink :to="caminhoFicha(c.login)">{{ c.login }}</RouterLink>
              </td>
              <td>{{ c.nome ?? '' }}</td>
              <td>{{ c.grupo ?? '' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="dados.dispensadasSemCpf > 0" class="nota" data-testid="usuarios-cpf-dispensadas">
          {{ t(`${P}.dispensadas`, { n: dados.dispensadasSemCpf }) }}
        </p>
      </section>

      <section aria-labelledby="cpf-rep-titulo" data-testid="usuarios-cpf-repetido">
        <h3 id="cpf-rep-titulo">{{ t(`${P}.repetido`) }} ({{ dados.duplicados.length }})</h3>
        <p v-if="dados.duplicados.length === 0">{{ t(`${P}.repetidoNenhum`) }}</p>
        <div
          v-for="g in dados.duplicados"
          :key="g.chave"
          class="grupo-cpf"
          :data-testid="`cpf-repetido-${g.chave}`"
        >
          <h4>{{ t(`${P}.grupoRepetido`, { n: g.chave }) }}</h4>
          <ul>
            <li v-for="c in g.contas" :key="c.login">
              <RouterLink :to="caminhoFicha(c.login)">{{ c.login }}</RouterLink>
              <span v-if="c.nome"> · {{ c.nome }}</span>
              <span class="pilula"> {{ situacao(c) }}</span>
            </li>
          </ul>
        </div>
      </section>
    </template>
    <RedeCpf :login-inicial="loginRede" />
  </div>
</template>

<style scoped>
.cpf-usuarios {
  display: grid;
  gap: var(--sgh-espaco-4);
}
.tabela {
  width: 100%;
  border-collapse: collapse;
}
.tabela th,
.tabela td {
  text-align: left;
  padding: var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.grupo-cpf {
  padding: var(--sgh-espaco-3);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio);
  margin-bottom: var(--sgh-espaco-2);
}
.grupo-cpf h4 {
  margin: 0 0 var(--sgh-espaco-2);
}
.grupo-cpf ul {
  margin: 0;
  padding-left: 1.2rem;
}
.pilula {
  font-size: 0.85em;
  color: var(--sgh-texto-secundario);
}
.nota {
  color: var(--sgh-texto-secundario);
}
</style>
