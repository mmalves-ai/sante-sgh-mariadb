<script setup lang="ts">
// "Esqueci a senha" da conta da plataforma (família acesso-ligacao). Sem token: o pedido pelo e-mail da conta; a resposta
// é sempre a mesma (ninguém descobre se a conta existe). Com o token do link (uso único, 15 minutos): gera a senha
// provisória, mostrada só aqui e uma vez; na entrada, o sistema exige a troca. O token sai do endereço assim que é lido.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pedirRecuperacaoPlataforma, usarRecuperacaoPlataforma } from '../api-acesso-email.js';

const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();

const token = ref(typeof rota.query['token'] === 'string' ? rota.query['token'] : '');
const email = ref('');
const ocupado = ref(false);
const erro = ref('');
const mensagem = ref('');
const provisoria = ref<{ senha: string; login: string } | null>(null);

onMounted(() => {
  if (token.value)
    void roteador
      .replace({ name: 'plataforma.recuperar-senha', query: { token: undefined } })
      .catch(() => {});
});

function textoDoErro(e: unknown, padrao: string): string {
  if (e instanceof ErroApi) {
    if (e.status === 429) return t('acessoEmail.recuperar.muitosPedidos');
    if (e.status === 503 || e.status === 501) return t('acessoEmail.recuperar.indisponivel');
    if (e.status === 400 || e.status === 409) return padrao;
  }
  return t('entrar.indisponivelServico');
}

async function pedir(): Promise<void> {
  if (ocupado.value) return;
  erro.value = '';
  if (!email.value.trim()) {
    erro.value = t('acessoEmail.recuperar.informeEmail');
    return;
  }
  ocupado.value = true;
  try {
    mensagem.value = await pedirRecuperacaoPlataforma(email.value.trim());
  } catch (e) {
    erro.value = textoDoErro(e, t('acessoEmail.recuperar.informeEmail'));
  } finally {
    ocupado.value = false;
  }
}

async function gerar(): Promise<void> {
  if (ocupado.value) return;
  erro.value = '';
  ocupado.value = true;
  try {
    const r = await usarRecuperacaoPlataforma(token.value);
    provisoria.value = { senha: r.senhaProvisoria, login: r.login };
  } catch (e) {
    erro.value = textoDoErro(e, t('acessoEmail.recuperar.linkInvalido'));
  } finally {
    token.value = '';
    ocupado.value = false;
  }
}
</script>

<template>
  <main class="recuperar">
    <div class="recuperar__caixa">
      <h1>{{ t('acessoEmail.recuperar.titulo') }}</h1>
      <template v-if="provisoria">
        <p>{{ t('acessoEmail.recuperar.provisoria', { login: provisoria.login }) }}</p>
        <p class="recuperar__senha" data-testid="plataforma-provisoria">{{ provisoria.senha }}</p>
        <SanteAlerta variante="info" :texto="t('acessoEmail.recuperar.aviso')" anunciar />
      </template>
      <template v-else-if="token">
        <p>{{ t('acessoEmail.recuperar.linkRecebido') }}</p>
        <p v-if="erro" role="alert" class="recuperar__erro" data-testid="plataforma-recuperar-erro">
          {{ erro }}
        </p>
        <SanteBotao
          :rotulo="t('acessoEmail.recuperar.gerar')"
          :desabilitado="ocupado"
          data-testid="plataforma-recuperar-gerar"
          @acionar="gerar"
        />
      </template>
      <SanteAlerta
        v-else-if="mensagem"
        variante="info"
        :texto="mensagem"
        anunciar
        data-testid="plataforma-recuperar-mensagem"
      />
      <form v-else class="recuperar__form" data-testid="form-plataforma-recuperar" @submit.prevent="pedir">
        <p v-if="erro" role="alert" class="recuperar__erro" data-testid="plataforma-recuperar-erro">
          {{ erro }}
        </p>
        <label class="recuperar__campo" for="plataforma-recuperar-email">
          <span>{{ t('acessoEmail.recuperar.email') }}</span>
          <input
            id="plataforma-recuperar-email"
            v-model="email"
            type="email"
            autocomplete="email"
            maxlength="254"
            required
            data-testid="plataforma-recuperar-email"
          />
        </label>
        <SanteBotao
          :rotulo="t('acessoEmail.recuperar.pedir')"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="plataforma-recuperar-enviar"
        />
      </form>
      <p>
        <RouterLink to="/entrar">{{ t('acessoEmail.recuperar.voltar') }}</RouterLink>
      </p>
    </div>
  </main>
</template>

<style scoped>
.recuperar {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: var(--sgh-espaco-4);
  background: var(--sgh-fundo);
}
.recuperar__caixa {
  width: 100%;
  max-width: 24rem;
  padding: var(--sgh-espaco-4);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 8px;
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
}
.recuperar__form,
.recuperar__campo {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.recuperar__senha {
  font-family: monospace;
  font-size: 1.25rem;
  user-select: all;
}
.recuperar__erro {
  color: var(--sgh-alerta);
}
</style>
