<script setup lang="ts">
// W0-09: a ação do ciclo de vida de um registro da implantação (voltar a pendente, estornar a conclusão, retirar a
// versão da trilha) num diálogo com o motivo obrigatório (5 caracteres ou mais; o servidor confere de novo) e, nas
// críticas, a senha digitada na hora (reautenticação). A recusa por vínculos (409, nenhum dado órfão) mostra quantos e
// quais registros dependem e oferece o caminho que preserva (inativar), com o mesmo motivo.
import { SanteBotao, SanteDialogo } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';

const props = withDefaults(
  defineProps<{
    titulo: string;
    texto: string;
    rotulo: string;
    /** Operação crítica: pede a senha de novo no diálogo. */
    comSenha?: boolean;
    /** Rótulo do caminho que preserva, oferecido quando o servidor recusa por vínculos. */
    oferta?: string;
    /** Confere os campos extras (slot) antes de enviar: devolve o que falta ou ''. */
    validar?: () => string;
    executar: (motivo: string, senha: string, aceitarOferta: boolean) => Promise<unknown>;
  }>(),
  { comSenha: false, oferta: '', validar: () => '' },
);
const emit = defineEmits<{ feito: [aceitouOferta: boolean] }>();
const visivel = defineModel<boolean>('visivel', { required: true });
const { t, te } = useI18n();

const motivo = ref('');
const senha = ref('');
const falta = ref('');
const erro = ref('');
const recusa = ref<ErroApi | null>(null);
const ocupado = ref(false);
const problema = computed(() => recusa.value?.problema ?? null);

watch(visivel, (aberto) => {
  if (!aberto) return;
  motivo.value = '';
  senha.value = '';
  falta.value = '';
  erro.value = '';
  recusa.value = null;
});

function mensagem(e: unknown): string {
  if (e instanceof ErroApi) {
    const codigo = e.problema?.codigo;
    if (codigo && te(`coexistencia.ciclo.recusas.${codigo}`))
      return t(`coexistencia.ciclo.recusas.${codigo}`);
    if (e.status === 401) return t('coexistencia.ciclo.recusas.senha');
    if (e.status === 403) return t('coexistencia.ciclo.recusas.semPermissao');
    if (e.problema?.detail) return e.problema.detail;
  }
  return t('coexistencia.ciclo.erroGenerico');
}

async function enviar(aceitarOferta: boolean): Promise<void> {
  falta.value = '';
  falta.value = props.validar();
  if (falta.value) return;
  if (motivo.value.trim().length < 5) falta.value = t('coexistencia.ciclo.motivoCurto');
  else if (props.comSenha && !senha.value) falta.value = t('coexistencia.ciclo.senhaObrigatoria');
  if (falta.value || ocupado.value) return;
  ocupado.value = true;
  erro.value = '';
  try {
    await props.executar(motivo.value.trim(), senha.value, aceitarOferta);
    recusa.value = null;
    visivel.value = false;
    emit('feito', aceitarOferta);
  } catch (e) {
    if (
      !aceitarOferta &&
      props.oferta &&
      e instanceof ErroApi &&
      e.status === 409 &&
      e.problema?.podeInativar === true
    )
      recusa.value = e;
    else erro.value = mensagem(e);
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}
</script>

<template>
  <SanteDialogo v-model:visivel="visivel" :titulo="props.titulo">
    <form class="dialogo" data-testid="ciclo-dialogo" @submit.prevent="enviar(false)">
      <p>{{ props.texto }}</p>
      <p v-if="erro" role="alert" data-testid="ciclo-erro">{{ erro }}</p>
      <slot />
      <label class="campo">
        <span>{{ t('coexistencia.ciclo.motivo') }}</span>
        <textarea v-model="motivo" maxlength="200" rows="2" required data-testid="ciclo-motivo" />
      </label>
      <label v-if="props.comSenha" class="campo">
        <span>{{ t('coexistencia.ciclo.senha') }}</span>
        <input
          v-model="senha"
          type="password"
          autocomplete="current-password"
          required
          data-testid="ciclo-senha"
        />
      </label>
      <p v-if="falta" role="alert" data-testid="ciclo-falta">{{ falta }}</p>
      <div v-if="problema" class="painel" role="alert" data-testid="ciclo-recusa">
        <p>{{ problema.detail ?? problema.title }}</p>
        <p v-if="problema.total !== undefined">
          {{ t('coexistencia.ciclo.vinculos', { n: problema.total }) }}
        </p>
        <ul v-if="problema.dependentes && problema.dependentes.length > 0">
          <li v-for="d in problema.dependentes" :key="d.rotulo">{{ d.rotulo }}: {{ d.quantidade }}</li>
        </ul>
        <SanteBotao
          variante="secundario"
          :rotulo="props.oferta"
          :desabilitado="ocupado"
          data-testid="ciclo-oferta"
          @acionar="enviar(true)"
        />
      </div>
      <div class="botoes">
        <SanteBotao
          :rotulo="props.rotulo"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="ciclo-confirmar"
        />
        <SanteBotao :rotulo="t('coexistencia.ciclo.desistir')" variante="texto" @acionar="visivel = false" />
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
