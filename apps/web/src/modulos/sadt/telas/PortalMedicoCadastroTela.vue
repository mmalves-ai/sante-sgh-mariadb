<script setup lang="ts">
// Autocadastro do médico solicitante no portal (ficha do M26, seção 7): `/medico/cadastro`. Fora da casca: nome,
// conselho, UF, número, e-mail e a senha da conta própria; o pedido fica pendente até a aprovação do hospital, e o
// código do segundo fator aparece uma vez para o aplicativo autenticador. A validação pública do laudo fica em
// `/resultados/validar/:codigo` (sem conteúdo clínico), com o carregando e o erro; o cadastro também tem o campo para
// validar um laudo pelo código impresso.
import type { ValidacaoLaudo } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { autocadastro, estabelecimentoPadrao, validarLaudo } from '../api-portal.js';
import ErroSadt from '../componentes/ErroSadt.vue';
import { quando } from '../usar-sadt.js';

const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const hospital = ref(typeof rota.query['estabelecimento'] === 'string' ? rota.query['estabelecimento'] : '');
const validacao = computed(() => (typeof rota.params['codigo'] === 'string' ? rota.params['codigo'] : null));
const nome = ref('');
const uf = ref('');
const numero = ref('');
const email = ref('');
const senha = ref('');
const aceite = ref(false);
const otpauth = ref<string | null>(null);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const valido = ref<ValidacaoLaudo | null>(null);
const validando = ref(false);
const erroValidacao = ref<unknown>(null);
async function validar(codigo: string): Promise<void> {
  valido.value = null;
  erroValidacao.value = null;
  validando.value = true;
  try {
    valido.value = await validarLaudo(hospital.value, codigo);
  } catch (x) {
    erroValidacao.value = x;
  } finally {
    validando.value = false;
  }
}
onMounted(async () => {
  if (!hospital.value)
    hospital.value =
      (await estabelecimentoPadrao().catch(() => ({ estabelecimento: null }))).estabelecimento ?? '';
  if (validacao.value) await validar(validacao.value);
});
watch(validacao, (c) => {
  if (c) void validar(c);
});
// Validar um laudo pelo código impresso (leva à página pública da validação).
const codigoDigitado = ref('');
function irValidar(): void {
  const c = codigoDigitado.value.trim();
  if (!c) return;
  void roteador.push({
    path: `/resultados/validar/${encodeURIComponent(c)}`,
    ...(hospital.value ? { query: { estabelecimento: hospital.value } } : {}),
  });
}
async function enviar(): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await autocadastro(hospital.value, {
      nome: nome.value,
      conselho: 'CRM',
      uf: uf.value.toUpperCase(),
      numero: numero.value,
      email: email.value,
      senha: senha.value,
      aceiteTermo: aceite.value,
    });
    otpauth.value = r.otpauth;
    mensagem.value = r.mensagem;
    senha.value = '';
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <main class="tela-agenda portal" aria-labelledby="medico-titulo" data-testid="tela-portal-medico">
    <template v-if="validacao">
      <h1 id="medico-titulo">{{ t('sadt.portal.validar') }}</h1>
      <p v-if="validando" role="status">{{ t('sadt.carregando') }}</p>
      <ErroSadt v-else-if="erroValidacao" :erro="erroValidacao" />
      <p v-else-if="valido?.valido" data-testid="validacao-resultado">
        {{ t('sadt.portal.valido', { em: quando(valido.emitidoEm), n: valido.exames }) }}
      </p>
      <p v-else-if="valido" data-testid="validacao-resultado">{{ t('sadt.portal.invalido') }}</p>
    </template>
    <template v-else>
      <h1 id="medico-titulo">{{ t('sadt.portal.cadastroTitulo') }}</h1>
      <p>{{ t('sadt.portal.cadastroTexto') }}</p>
      <form v-if="!otpauth" class="painel" @submit.prevent="enviar">
        <span class="campo">
          <label for="medico-nome">{{ t('sadt.portal.nome') }}</label>
          <input
            id="medico-nome"
            v-model="nome"
            maxlength="70"
            autocomplete="name"
            data-testid="medico-nome"
          />
        </span>
        <span class="campo">
          <label for="medico-uf">{{ t('sadt.portal.uf') }}</label>
          <input id="medico-uf" v-model="uf" maxlength="2" data-testid="medico-uf" />
        </span>
        <span class="campo">
          <label for="medico-numero">{{ t('sadt.portal.numero') }}</label>
          <input id="medico-numero" v-model="numero" inputmode="numeric" data-testid="medico-numero" />
        </span>
        <span class="campo">
          <label for="medico-email">{{ t('sadt.portal.email') }}</label>
          <input
            id="medico-email"
            v-model="email"
            type="email"
            autocomplete="email"
            data-testid="medico-email"
          />
        </span>
        <span class="campo">
          <label for="medico-senha">{{ t('sadt.portal.senha') }}</label>
          <input
            id="medico-senha"
            v-model="senha"
            type="password"
            autocomplete="new-password"
            data-testid="medico-senha"
          />
        </span>
        <label
          ><input v-model="aceite" type="checkbox" data-testid="medico-aceite" />
          {{ t('sadt.portal.aceite') }}</label
        >
        <SanteBotao
          tipo="submit"
          :rotulo="t('sadt.portal.enviar')"
          :desabilitado="ocupado || !aceite"
          data-testid="medico-enviar"
          @acionar="enviar"
        />
      </form>
      <section v-else class="painel" data-testid="medico-otpauth">
        <p>{{ mensagem }}</p>
        <p>{{ t('sadt.portal.otpauth') }}</p>
        <code>{{ otpauth }}</code>
      </section>
      <form class="painel" data-testid="portal-validar-codigo" @submit.prevent="irValidar">
        <h2>{{ t('sadt.portal.validar') }}</h2>
        <span class="campo">
          <label for="portal-codigo">{{ t('sadt.laudos.codigo') }}</label>
          <input id="portal-codigo" v-model="codigoDigitado" maxlength="40" data-testid="portal-codigo" />
        </span>
        <SanteBotao
          tipo="submit"
          variante="secundario"
          :rotulo="t('sadt.portal.validar')"
          :desabilitado="codigoDigitado.trim().length < 8"
          data-testid="portal-validar"
        />
      </form>
    </template>
    <ErroSadt v-if="erro" :erro="erro" />
  </main>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.portal {
  margin: var(--sgh-espaco-4) auto;
  padding: var(--sgh-espaco-3);
  max-width: 48rem;
}
code {
  word-break: break-all;
}
</style>
