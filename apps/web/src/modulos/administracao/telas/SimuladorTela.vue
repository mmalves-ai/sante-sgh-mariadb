<script setup lang="ts">
// "Simulador de permissões" (M10, ficha seção 7): o que o usuário X pode fazer e por quê, calculado na hora pelas
// mesmas regras do servidor (grupo, papéis, flags, perfis, segregação). Só consulta.
import { SanteBotao } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import type { ResultadoSimulacao } from '@sgh/contratos';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { simular } from '../api.js';

const { t } = useI18n();
const rota = useRoute();
const login = ref(typeof rota.query['login'] === 'string' ? rota.query['login'] : '');
const recurso = ref('');
const resultado = ref<ResultadoSimulacao | null>(null);
const erro = ref<unknown>(null);
const carregando = ref(false);
async function executar(): Promise<void> {
  erro.value = null;
  carregando.value = true;
  try {
    resultado.value = await simular(login.value, recurso.value);
  } catch (e) {
    erro.value = e;
    resultado.value = null;
  } finally {
    carregando.value = false;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="sim-titulo">
    <h1 id="sim-titulo">{{ t('adm.simulador.titulo') }}</h1>
    <p>{{ t('adm.simulador.texto') }}</p>
    <p>
      <router-link to="/administracao/acesso/perfis">{{ t('adm.simulador.gerir') }}</router-link>
    </p>
    <form class="filtros" @submit.prevent="executar">
      <div class="campo">
        <label for="sim-login">{{ t('adm.simulador.login') }}</label>
        <input id="sim-login" v-model="login" required maxlength="31" data-testid="sim-login" />
      </div>
      <div class="campo">
        <label for="sim-recurso">{{ t('adm.simulador.recurso') }}</label>
        <input id="sim-recurso" v-model="recurso" required maxlength="120" data-testid="sim-recurso" />
      </div>
      <SanteBotao
        :rotulo="t('adm.simulador.simular')"
        tipo="submit"
        :desabilitado="carregando"
        data-testid="sim-executar"
      />
    </form>
    <MensagemErro v-if="erro" :erro="erro" />
    <template v-if="resultado">
      <p role="status">
        {{ t('adm.simulador.perfis', { lista: resultado.perfis.join(', ') || '—' }) }} ·
        {{ t('adm.simulador.calculada', { em: resultado.calculadaEm.slice(0, 19).replace('T', ' ') }) }}
      </p>
      <p v-if="resultado.avaliadas.length === 0">{{ t('adm.comum.nenhum') }}</p>
      <ul class="resultado" data-testid="sim-resultado">
        <li v-for="a in resultado.avaliadas" :key="a.permissao" :data-testid="`sim-${a.permissao}`">
          <strong>{{ a.pode ? t('adm.simulador.pode') : t('adm.simulador.naoPode') }}</strong
          >: {{ a.descricao }} <code>{{ a.permissao }}</code>
          <ul>
            <li v-for="(m, i) in a.motivos" :key="i">{{ m }}</li>
          </ul>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.filtros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.resultado > li {
  margin-bottom: var(--sgh-espaco-2);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
