<script setup lang="ts">
// Trocar a senha (M05; W1-01): a própria senha, por vontade ou por troca obrigatória (expirada ou sem cifra). A
// senha atual confere de novo (vale como reautenticação); a nova passa pela política do estabelecimento e pelo
// histórico; recusada, a tela lista as regras que faltam (só códigos vêm do servidor). Sem a troca liberada no
// estabelecimento (a combinação do resumo ainda não confirmada), a tela explica e não mostra o formulário.
import type { Sessao } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRouter } from 'vue-router';
import { trocarSenha } from '../../../api.js';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { CHAVE_SESSAO, usarSessao } from '../../../casca/sessao/sessao.js';
import { destinoDepoisDoLogin } from '../identidade-tela.js';

const { t } = useI18n();
const roteador = useRouter();
const cliente = useQueryClient();
const { sessao } = usarSessao();
const disponivel = computed(() => sessao.value?.trocaSenhaPeloNovo === true);
const motivo = computed(() => sessao.value?.trocaSenha ?? null);

const atual = ref('');
const nova = ref('');
const confirmacao = ref('');
const ocupado = ref(false);
const erro = ref<unknown>(null);
const aviso = ref('');
const falhas = ref<string[]>([]);
const trocada = ref<Sessao | null>(null);
const naoConfere = computed(() => confirmacao.value !== '' && confirmacao.value !== nova.value);

async function trocar(): Promise<void> {
  if (ocupado.value || naoConfere.value) return;
  erro.value = null;
  aviso.value = '';
  falhas.value = [];
  ocupado.value = true;
  try {
    const s = await trocarSenha({
      senhaAtual: atual.value,
      senhaNova: nova.value,
      confirmacao: confirmacao.value,
    });
    cliente.setQueryData(CHAVE_SESSAO, s);
    trocada.value = s;
  } catch (x) {
    const p = x instanceof ErroApi ? x.problema : null;
    if (p?.falhas?.length) falhas.value = p.falhas;
    else if (x instanceof ErroApi && x.status === 401) aviso.value = t('senha.atualInvalida');
    else erro.value = x;
  } finally {
    // A senha digitada nunca fica na tela depois do pedido.
    atual.value = '';
    nova.value = '';
    confirmacao.value = '';
    ocupado.value = false;
  }
}

async function continuar(): Promise<void> {
  await roteador.replace(trocada.value ? destinoDepoisDoLogin(trocada.value) : '/inicio');
}
</script>

<template>
  <section class="tela" aria-labelledby="senha-titulo">
    <h1 id="senha-titulo">{{ t('senha.titulo') }}</h1>
    <SanteAlerta
      v-if="motivo && !trocada"
      variante="aviso"
      :texto="t(`senha.motivo.${motivo}`)"
      data-testid="senha-motivo"
    />
    <template v-if="sessao && !disponivel && !trocada">
      <SanteAlerta variante="aviso" :texto="t('senha.indisponivel')" data-testid="senha-indisponivel" />
      <p>
        <RouterLink to="/entrar">{{ t('senha.voltar') }}</RouterLink>
      </p>
    </template>
    <template v-else-if="trocada">
      <SanteAlerta variante="info" :texto="t('senha.trocada')" anunciar data-testid="senha-trocada" />
      <SanteBotao :rotulo="t('senha.continuar')" data-testid="senha-continuar" @acionar="continuar" />
    </template>
    <form v-else-if="disponivel" class="formulario" data-testid="form-senha" @submit.prevent="trocar">
      <p>{{ t('senha.regras') }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
      <SanteAlerta v-if="aviso" variante="alerta" :texto="aviso" anunciar data-testid="senha-aviso" />
      <div v-if="falhas.length" class="falhas" role="alert" data-testid="senha-falhas">
        <p>{{ t('senha.recusada') }}</p>
        <ul>
          <li v-for="f in falhas" :key="f">{{ t(`senha.falha.${f}`) }}</li>
        </ul>
      </div>
      <label class="campo" for="senha-atual">
        <span>{{ t('senha.atual') }}</span>
        <input
          id="senha-atual"
          v-model="atual"
          type="password"
          autocomplete="current-password"
          required
          data-testid="senha-atual"
        />
      </label>
      <label class="campo" for="senha-nova">
        <span>{{ t('senha.nova') }}</span>
        <input
          id="senha-nova"
          v-model="nova"
          type="password"
          autocomplete="new-password"
          required
          data-testid="senha-nova"
        />
      </label>
      <label class="campo" for="senha-confirmacao">
        <span>{{ t('senha.confirmacao') }}</span>
        <input
          id="senha-confirmacao"
          v-model="confirmacao"
          type="password"
          autocomplete="new-password"
          required
          :aria-invalid="naoConfere"
          data-testid="senha-confirmacao"
        />
      </label>
      <p v-if="naoConfere" class="nao-confere" data-testid="senha-nao-confere">{{ t('senha.naoConfere') }}</p>
      <SanteBotao
        :rotulo="t('senha.trocar')"
        tipo="submit"
        :desabilitado="ocupado || naoConfere"
        data-testid="senha-trocar"
      />
    </form>
  </section>
</template>

<style scoped>
.formulario,
.campo {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 28rem;
}
.falhas ul {
  margin: 0;
}
.nao-confere {
  font-weight: 600;
  margin: 0;
}
</style>
