<script setup lang="ts">
// A chave do dispositivo como segundo fator (WebAuthn com biometria local; 01-ADM L62): cadastrar este aparelho,
// testar a biometria e remover. A digital ou o rosto são conferidos só pelo aparelho; o servidor recebe a chave
// pública e a assinatura do desafio. Cadastrar e remover pedem a senha confirmada há pouco (reautenticação) e o CSRF.
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import {
  cadastrarDispositivo,
  dispositivoSuportado,
  listarDispositivos,
  revogarDispositivo,
  validarDispositivo,
  type DispositivoTela,
} from '../api-acesso-email.js';

const { t, locale } = useI18n();
const suportado = dispositivoSuportado();
const lista = ref<DispositivoTela[] | null>(null);
const nome = ref(t('acessoEmail.dispositivo.nomePadrao'));
const aviso = ref('');
const erro = ref('');
const ocupado = ref(false);

onMounted(async () => {
  lista.value = await listarDispositivos().catch(() => null);
});

function mensagemDe(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotAllowedError')
    return t('acessoEmail.dispositivo.cancelado');
  if (e instanceof ErroApi && e.status === 401) return t('acessoEmail.dispositivo.confirmeSenha');
  return (e instanceof ErroApi ? e.problema?.detail : null) || t('acessoEmail.dispositivo.erro');
}

async function agir(f: () => Promise<void>, ok: string): Promise<void> {
  if (ocupado.value) return;
  ocupado.value = true;
  aviso.value = '';
  erro.value = '';
  try {
    await f();
    aviso.value = ok;
  } catch (e) {
    erro.value = mensagemDe(e);
  } finally {
    ocupado.value = false;
  }
}

const cadastrar = () =>
  agir(async () => {
    await cadastrarDispositivo(nome.value.trim());
    lista.value = await listarDispositivos();
  }, t('acessoEmail.dispositivo.cadastrado'));

const testar = () =>
  agir(async () => {
    await validarDispositivo();
    lista.value = await listarDispositivos();
  }, t('acessoEmail.dispositivo.conferido'));

const remover = (id: number) =>
  agir(async () => {
    lista.value = await revogarDispositivo(id);
  }, t('acessoEmail.dispositivo.removido'));

const data = (iso: string) =>
  new Date(iso).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short' });
</script>

<template>
  <section
    v-if="lista"
    class="dispositivos"
    aria-labelledby="dispositivos-titulo"
    data-testid="dispositivos-segundo-fator"
  >
    <h2 id="dispositivos-titulo">{{ t('acessoEmail.dispositivo.titulo') }}</h2>
    <p>{{ t('acessoEmail.dispositivo.ajuda') }}</p>
    <SanteAlerta v-if="!suportado" variante="aviso" :texto="t('acessoEmail.dispositivo.semSuporte')" />
    <p v-if="lista.length === 0" data-testid="dispositivos-nenhum">
      {{ t('acessoEmail.dispositivo.nenhum') }}
    </p>
    <ul v-else class="lista" data-testid="dispositivos-lista">
      <li v-for="x in lista" :key="x.id" data-testid="dispositivo-item">
        <span class="nome">{{ x.nome }}</span>
        <small>{{ t('acessoEmail.dispositivo.cadastradoEm', { data: data(x.criadoEm) }) }}</small>
        <small>{{
          x.ultimoUsoEm
            ? t('acessoEmail.dispositivo.usadoEm', { data: data(x.ultimoUsoEm) })
            : t('acessoEmail.dispositivo.nuncaUsado')
        }}</small>
        <SanteBotao
          :rotulo="t('acessoEmail.dispositivo.remover')"
          :aria-label="t('acessoEmail.dispositivo.removerRotulo', { nome: x.nome })"
          variante="secundario"
          :desabilitado="ocupado"
          data-testid="dispositivo-remover"
          @acionar="remover(x.id)"
        />
      </li>
    </ul>
    <div v-if="suportado" class="acoes">
      <SanteCampoTexto
        v-model="nome"
        :rotulo="t('acessoEmail.dispositivo.nome')"
        :max-bytes="60"
        data-testid="dispositivo-nome"
      />
      <div class="botoes">
        <SanteBotao
          :rotulo="t('acessoEmail.dispositivo.cadastrar')"
          :desabilitado="ocupado || !nome.trim()"
          data-testid="dispositivo-cadastrar"
          @acionar="cadastrar"
        />
        <SanteBotao
          v-if="lista.length > 0"
          :rotulo="t('acessoEmail.dispositivo.testar')"
          variante="secundario"
          :desabilitado="ocupado"
          data-testid="dispositivo-testar"
          @acionar="testar"
        />
      </div>
    </div>
    <SanteAlerta v-if="aviso" variante="info" :texto="aviso" anunciar />
    <p v-if="erro" role="alert" data-testid="dispositivo-erro">{{ erro }}</p>
  </section>
</template>

<style scoped>
.dispositivos .lista {
  display: grid;
  gap: var(--sgh-espaco-2);
  padding: 0;
  list-style: none;
}
.dispositivos li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
}
.dispositivos .nome {
  font-weight: 600;
}
.dispositivos .acoes,
.dispositivos .botoes {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.dispositivos .botoes {
  grid-auto-flow: column;
  justify-content: start;
}
</style>
