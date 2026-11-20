<script setup lang="ts">
// W0-04: o diálogo de toda correção, cancelamento, estorno, retificação, assinatura e reabertura da qualidade e da
// CCIH, no padrão da ficha de Usuários e Acessos e da ficha do profissional. Os campos da correção vêm pelo slot; o
// diálogo pede a justificativa (10 a 500 caracteres) e, nas operações críticas, a senha de novo (reautenticação,
// SBIS-07). Fica aberto até a resposta: a senha que não confere, a recusa de negócio (com os avisos: quantos e quais
// dependentes) e a competência fechada (com a oferta "reabrir competência") aparecem DENTRO dele, sem perder o que foi
// escrito. Sucesso fecha e emite `feito`. A senha nunca fica guardada: limpa ao fechar por qualquer caminho.
import { tipoDoProblema } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo } from '@sgh/ui';
import { computed, nextTick, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { codigoDaRecusa } from '../../exames/api-exames.js';
import { avisosDaRecusa, competenciasDaRecusa } from '../api-correcao.js';
import { RECUSAS_CORRECAO } from '../i18n-correcao.js';

export interface PedidoCorrecao {
  titulo: string;
  texto?: string | undefined;
  /** Aviso fixo no topo (ex.: os registros que dependem deste). */
  alerta?: string | undefined;
  /** Sem justificativa (só a assinatura da ata, que é aprovação e não mudança). */
  semJustificativa?: boolean;
  /** Operação crítica: pede a senha de novo. */
  critica: boolean;
  confirmar: string;
  /** Bloqueia o botão de confirmar (ex.: há dependentes ativos). */
  impedido?: boolean;
  gravar: (x: { justificativa: string; senha: string }) => Promise<unknown>;
}

const visivel = defineModel<boolean>('visivel', { required: true });
const props = withDefaults(
  defineProps<{
    pedido: PedidoCorrecao | null;
    /** Quem pode reabrir a competência vê a oferta no 409 da competência fechada. */
    podeReabrir?: boolean;
    /** Os campos do slot estão válidos (a tela confere antes de liberar o botão). */
    valido?: boolean;
  }>(),
  { podeReabrir: false, valido: true },
);
const emit = defineEmits<{ feito: [resultado: unknown]; reabrir: [competencias: string[]] }>();
const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`qualidade.correcao.${k}`, p ?? {});
const id = `correcao-${useId()}`;
const justificativa = ref('');
const senha = ref('');
const erroSenha = ref('');
const erro = ref<unknown>(null);
const ocupado = ref(false);
/**
 * Revisão do W0-04: o servidor pode exigir a senha numa mudança que a tela pediu sem ela (o registro de outro autor,
 * a ata já assinada): o diálogo passa a pedi-la, sem perder o que foi escrito.
 */
const senhaExigida = ref(false);
const critica = computed(() => !!props.pedido?.critica || senhaExigida.value);
const form = ref<HTMLFormElement | null>(null);

watch(visivel, (aberto) => {
  senha.value = '';
  erroSenha.value = '';
  erro.value = null;
  senhaExigida.value = false;
  if (aberto) justificativa.value = '';
});

const codigo = computed(() => codigoDaRecusa(erro.value));
const recusa = computed(() => (codigo.value ? (RECUSAS_CORRECAO[codigo.value] ?? null) : null));
const avisos = computed(() => avisosDaRecusa(erro.value));
const fechadas = computed(() =>
  codigo.value === 'competencia-fechada' ? competenciasDaRecusa(erro.value) : [],
);

function problemaDeSenha(e: unknown): string | null {
  if (!(e instanceof ErroApi)) return null;
  const tipo = e.problema ? tipoDoProblema(e.problema) : null;
  if (tipo === 'reautenticacao-necessaria' || (tipo === null && e.status === 401)) return T('senhaErrada');
  if (tipo === 'muitas-tentativas') return T('muitasTentativas');
  return null;
}

const curta = () => !props.pedido?.semJustificativa && justificativa.value.trim().length < 10;
const bloqueado = computed(
  () =>
    ocupado.value || !!props.pedido?.impedido || !props.valido || (critica.value && !senha.value) || curta(),
);

async function confirmar(): Promise<void> {
  const p = props.pedido;
  if (!p || bloqueado.value) return;
  ocupado.value = true;
  erroSenha.value = '';
  erro.value = null;
  try {
    const r = await p.gravar({ justificativa: justificativa.value.trim(), senha: senha.value });
    visivel.value = false;
    emit('feito', r);
  } catch (e) {
    const msg = problemaDeSenha(e);
    if (msg && !critica.value) {
      // A senha que o servidor exigiu: o campo aparece com o aviso, e o resto do que foi escrito fica.
      senhaExigida.value = true;
      erroSenha.value = T('senhaExigida');
      void nextTick(() => form.value?.querySelector<HTMLInputElement>(`#${id}-senha`)?.focus());
    } else if (msg) {
      const bloqueio = msg === T('muitasTentativas');
      erroSenha.value = msg;
      senha.value = '';
      if (!bloqueio)
        void nextTick(() => form.value?.querySelector<HTMLInputElement>(`#${id}-senha`)?.focus());
    } else {
      erro.value = e;
    }
  } finally {
    ocupado.value = false;
  }
}

function reabrir(): void {
  const cs = fechadas.value;
  visivel.value = false;
  emit('reabrir', cs);
}
</script>

<template>
  <SanteDialogo v-model:visivel="visivel" :titulo="pedido?.titulo ?? ''" largura="40rem">
    <form
      v-if="pedido"
      ref="form"
      class="dialogo-correcao"
      data-testid="dialogo-correcao"
      :aria-busy="ocupado ? 'true' : undefined"
      @submit.prevent="confirmar"
    >
      <p v-if="pedido.texto">{{ pedido.texto }}</p>
      <SanteAlerta
        v-if="pedido.alerta"
        :texto="pedido.alerta"
        variante="aviso"
        data-testid="correcao-alerta"
      />
      <slot />
      <div v-if="!pedido.semJustificativa" class="campo">
        <label :for="`${id}-justificativa`">{{ T('justificativa') }}</label>
        <textarea
          :id="`${id}-justificativa`"
          v-model="justificativa"
          rows="3"
          maxlength="500"
          required
          :aria-describedby="`${id}-justificativa-ajuda`"
          data-testid="correcao-justificativa"
        />
        <small :id="`${id}-justificativa-ajuda`">{{ T('justificativaAjuda') }}</small>
      </div>
      <div v-if="critica" class="campo">
        <label :for="`${id}-senha`">{{ T('senha') }}</label>
        <input
          :id="`${id}-senha`"
          v-model="senha"
          type="password"
          autocomplete="current-password"
          required
          :aria-describedby="`${id}-senha-ajuda`"
          data-testid="correcao-senha"
        />
        <small :id="`${id}-senha-ajuda`">{{ T('senhaAjuda') }}</small>
      </div>
      <SanteAlerta
        v-if="erroSenha"
        :texto="erroSenha"
        variante="aviso"
        anunciar
        data-testid="correcao-senha-erro"
      />
      <div v-if="erro" role="alert" class="recusa" data-testid="correcao-recusa">
        <template v-if="fechadas.length">
          <SanteAlerta variante="alerta" :texto="T('competenciaFechada.texto')" />
          <SanteBotao
            v-if="podeReabrir"
            :rotulo="T('competenciaFechada.reabrir', { c: fechadas.join(', ') })"
            variante="secundario"
            data-testid="correcao-reabrir"
            @acionar="reabrir"
          />
        </template>
        <template v-else-if="recusa">
          <SanteAlerta variante="alerta" :texto="recusa" />
          <ul v-if="avisos.length" data-testid="correcao-avisos">
            <li v-for="a in avisos" :key="a">{{ a }}</li>
          </ul>
        </template>
        <MensagemErro v-else :erro="erro" />
      </div>
      <div class="botoes">
        <SanteBotao :rotulo="T('cancelar')" variante="texto" @acionar="visivel = false" />
        <SanteBotao
          :rotulo="ocupado ? T('gravando') : pedido.confirmar"
          tipo="submit"
          variante="primario"
          :desabilitado="bloqueado"
          data-testid="correcao-confirmar"
        />
      </div>
    </form>
  </SanteDialogo>
</template>

<style scoped>
.dialogo-correcao {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
input,
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
small {
  color: var(--sgh-texto-secundario);
}
.recusa {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.botoes {
  display: flex;
  justify-content: flex-end;
  gap: var(--sgh-espaco-2);
}
</style>
