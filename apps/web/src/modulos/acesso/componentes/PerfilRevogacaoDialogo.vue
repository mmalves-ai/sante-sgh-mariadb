<script setup lang="ts">
// W0-09: Revogar a concessão de perfil num diálogo com o motivo (obrigatório, fica na concessão revogada) e a senha
// digitada na hora (reautenticação). A concessão não se apaga; o servidor invalida o cache do usuário e a permissão
// efetiva muda na requisição seguinte.
import type { PerfilConcedidoTela } from '@sgh/contratos';
import { SanteBotao, SanteDialogo } from '@sgh/ui';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { revogarPerfil } from '../api-gestao.js';

const props = defineProps<{ concessao: PerfilConcedidoTela | null }>();
const emit = defineEmits<{ revogado: [] }>();
const visivel = defineModel<boolean>('visivel', { required: true });
const { t, te } = useI18n();

const motivo = ref('');
const senha = ref('');
const erro = ref('');
const falta = ref('');
const ocupado = ref(false);

function mensagem(e: unknown): string {
  if (e instanceof ErroApi) {
    const p = e.problema as { codigo?: string; detail?: string } | null;
    if (p?.codigo && te(`acesso.perfis.recusas.${p.codigo}`)) return t(`acesso.perfis.recusas.${p.codigo}`);
    if (e.status === 401) return t('acesso.perfis.recusas.senha');
    if (e.status === 403) return t('acesso.perfis.recusas.semPermissao');
    if (p?.detail) return p.detail;
  }
  return t('acesso.perfis.erroGenerico');
}

watch(
  () => [visivel.value, props.concessao] as const,
  ([aberto]) => {
    if (!aberto) return;
    motivo.value = '';
    senha.value = '';
    erro.value = '';
    falta.value = '';
  },
  { immediate: true },
);

async function confirmar(): Promise<void> {
  const c = props.concessao;
  falta.value = '';
  if (motivo.value.trim().length < 5) falta.value = t('acesso.perfis.motivoCurto');
  else if (!senha.value) falta.value = t('acesso.perfis.senhaObrigatoria');
  if (falta.value || ocupado.value || !c) return;
  ocupado.value = true;
  erro.value = '';
  try {
    await revogarPerfil(c.id, motivo.value.trim(), senha.value);
    visivel.value = false;
    emit('revogado');
  } catch (e) {
    erro.value = mensagem(e);
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}
</script>

<template>
  <SanteDialogo
    v-model:visivel="visivel"
    :titulo="concessao ? t('acesso.perfis.revogacao.titulo', { perfil: concessao.perfil }) : ''"
  >
    <form class="dialogo" data-testid="perfil-revogacao" @submit.prevent="confirmar">
      <p>{{ t('acesso.perfis.revogacao.texto') }}</p>
      <p v-if="erro" role="alert" data-testid="perfil-revogacao-erro">{{ erro }}</p>
      <label class="campo">
        <span>{{ t('acesso.perfis.revogacao.motivo') }}</span>
        <textarea v-model="motivo" maxlength="400" rows="2" required data-testid="perfil-revogacao-motivo" />
      </label>
      <label class="campo">
        <span>{{ t('acesso.perfis.senhaDialogo') }}</span>
        <input
          v-model="senha"
          type="password"
          autocomplete="current-password"
          required
          data-testid="perfil-revogacao-senha"
        />
      </label>
      <p v-if="falta" role="alert" data-testid="perfil-revogacao-falta">{{ falta }}</p>
      <div class="botoes">
        <SanteBotao
          :rotulo="t('acesso.perfis.revogacao.confirmar')"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="perfil-revogacao-confirmar"
        />
        <SanteBotao
          :rotulo="t('acesso.perfis.cancelarDialogo')"
          variante="texto"
          @acionar="visivel = false"
        />
      </div>
    </form>
  </SanteDialogo>
</template>

<style scoped>
.dialogo,
.campo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
</style>
