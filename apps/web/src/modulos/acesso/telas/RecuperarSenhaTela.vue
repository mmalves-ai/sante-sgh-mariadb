<script setup lang="ts">
// "Esqueci a senha" (W1-01, parte 7). Sem token: o pedido pelo usuário no estabelecimento escolhido na entrada; a
// resposta é sempre a mesma mensagem genérica (ninguém descobre se a conta existe). Com o token do link do e-mail (uso
// único, prazo curto): gera a senha provisória, mostrada só aqui e uma vez; no próximo acesso o sistema exige a troca.
// O token sai do endereço assim que é lido (não fica no histórico nem vai a outro site).
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { pedirRecuperacao, usarRecuperacao } from '../../../api.js';
import { ErroApi } from '../../../casca/erros/problem-details.js';

const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();

const texto = (v: unknown) => (typeof v === 'string' ? v : '');
const estabelecimento = texto(rota.query['estabelecimento']);
const login = ref(texto(rota.query['login']));
const token = ref(texto(rota.query['token']));
const ocupado = ref(false);
const erro = ref('');
const mensagem = ref('');
const provisoria = ref<{ senha: string; trocaObrigatoria: boolean } | null>(null);

onMounted(() => {
  if (token.value)
    void roteador.replace({ name: 'recuperar-senha', query: { token: undefined } }).catch(() => {});
});

function textoDoErro(e: unknown, padrao: string): string {
  if (e instanceof ErroApi) {
    if (e.status === 429) return t('recuperarSenha.muitosPedidos');
    if (e.status === 409) return t('recuperarSenha.indisponivel');
    if (e.status === 400) return padrao;
  }
  return t('entrar.indisponivelServico');
}

async function pedir(): Promise<void> {
  if (ocupado.value) return;
  erro.value = '';
  if (!login.value.trim()) {
    erro.value = t('recuperarSenha.informeLogin');
    return;
  }
  ocupado.value = true;
  try {
    mensagem.value = await pedirRecuperacao({ estabelecimento, login: login.value.trim() });
  } catch (e) {
    erro.value = textoDoErro(e, t('recuperarSenha.informeLogin'));
  } finally {
    ocupado.value = false;
  }
}

async function gerar(): Promise<void> {
  if (ocupado.value) return;
  erro.value = '';
  ocupado.value = true;
  try {
    const r = await usarRecuperacao(token.value);
    provisoria.value = { senha: r.senhaProvisoria, trocaObrigatoria: r.trocaObrigatoria };
  } catch (e) {
    erro.value = textoDoErro(e, t('recuperarSenha.linkInvalido'));
  } finally {
    token.value = '';
    ocupado.value = false;
  }
}
</script>

<template>
  <main class="recuperar">
    <div class="recuperar__caixa">
      <template v-if="provisoria">
        <h1 id="recuperar-titulo">{{ t('recuperarSenha.usarTitulo') }}</h1>
        <p>{{ t('recuperarSenha.provisoria') }}:</p>
        <p class="recuperar__senha" data-testid="recuperar-provisoria">{{ provisoria.senha }}</p>
        <SanteAlerta
          v-if="provisoria.trocaObrigatoria"
          variante="info"
          :texto="t('recuperarSenha.trocaObrigatoria')"
          anunciar
          data-testid="recuperar-troca-obrigatoria"
        />
      </template>
      <template v-else-if="token">
        <h1 id="recuperar-titulo">{{ t('recuperarSenha.usarTitulo') }}</h1>
        <p>{{ t('recuperarSenha.usarExplicacao') }}</p>
        <p v-if="erro" role="alert" class="recuperar__erro" data-testid="recuperar-erro">{{ erro }}</p>
        <SanteBotao
          :rotulo="ocupado ? t('recuperarSenha.gerando') : t('recuperarSenha.gerar')"
          :desabilitado="ocupado"
          data-testid="recuperar-gerar"
          @acionar="gerar"
        />
      </template>
      <template v-else>
        <h1 id="recuperar-titulo">{{ t('recuperarSenha.titulo') }}</h1>
        <p v-if="erro && !estabelecimento" role="alert" class="recuperar__erro">{{ erro }}</p>
        <SanteAlerta
          v-if="!estabelecimento"
          variante="aviso"
          :texto="t('recuperarSenha.semEstabelecimento')"
          data-testid="recuperar-sem-estabelecimento"
        />
        <SanteAlerta
          v-else-if="mensagem"
          variante="info"
          :texto="mensagem"
          anunciar
          data-testid="recuperar-mensagem"
        />
        <form v-else class="recuperar__form" data-testid="form-recuperar" @submit.prevent="pedir">
          <p>{{ t('recuperarSenha.explicacao') }}</p>
          <p v-if="erro" role="alert" class="recuperar__erro" data-testid="recuperar-erro">{{ erro }}</p>
          <label class="recuperar__campo" for="recuperar-login">
            <span>{{ t('recuperarSenha.login') }}</span>
            <input
              id="recuperar-login"
              v-model="login"
              autocomplete="username"
              maxlength="31"
              required
              data-testid="recuperar-login"
            />
          </label>
          <SanteBotao
            :rotulo="ocupado ? t('recuperarSenha.enviando') : t('recuperarSenha.enviar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="recuperar-enviar"
          />
        </form>
      </template>
      <p>
        <RouterLink to="/entrar" data-testid="recuperar-voltar">{{ t('recuperarSenha.voltar') }}</RouterLink>
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
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.recuperar__campo input {
  min-height: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-2);
  font: inherit;
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 4px;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.recuperar__senha {
  font-family: var(--sgh-fonte-mono, monospace);
  font-size: 1.25rem;
  letter-spacing: 0.05em;
}
.recuperar__erro {
  color: var(--sgh-alerta);
}
.recuperar :focus-visible {
  outline: 2px solid var(--sgh-foco);
  outline-offset: 2px;
}
</style>
