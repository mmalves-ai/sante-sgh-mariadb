<script setup lang="ts">
// W1-01 (parte 11b3a): "PIN da troca rápida" em Preferências > Segurança. Mostra a situação do próprio PIN (nunca o
// PIN nem o hash), define ou troca com a senha (reautenticação em diálogo) e retira com a senha. O PIN só serve para
// trocar de usuário numa estação em que a pessoa já entrou com a senha hoje. Com a troca rápida desligada no
// estabelecimento (parâmetro acesso.trocaRapida.ligada), a seção diz isso e não oferece gravação. Os campos se
// apagam ao fechar o diálogo; nada fica guardado no navegador.
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { SanteAlerta, SanteBotao, SanteDialogo } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarMeuPin, definirMeuPin, retirarMeuPin } from '../api-identidade.js';
import { dataBr } from '../identidade-tela.js';

const MAXIMO = 8;
const { t } = useI18n();
const cliente = useQueryClient();
const CHAVE = ['sessao', 'meu-pin'] as const;
const consulta = useQuery({ queryKey: CHAVE, queryFn: () => buscarMeuPin() });
const situacao = computed(() => consulta.data.value ?? null);
const minimo = computed(() => Math.min(Math.max(situacao.value?.digitosPin ?? 6, 4), MAXIMO));

const aviso = ref('');
const ocupado = ref(false);

// Definir ou trocar.
const dialogoDefinir = ref(false);
const pin = ref('');
const pinConfirmacao = ref('');
const senhaDefinir = ref('');
const erroDefinir = ref<unknown>(null);
const recusaLocal = ref('');

// Retirar.
const dialogoRetirar = ref(false);
const senhaRetirar = ref('');
const erroRetirar = ref<unknown>(null);

// Recusa de negócio (PIN fora da regra, senha que não confere): o texto do servidor, no próprio diálogo. Falha de
// rede ou do servidor cai na mensagem padrão.
function recusaDoServidor(e: unknown): string {
  if (!(e instanceof ErroApi) || e.status >= 500) return '';
  return e.problema?.detail?.trim() || '';
}
const recusaDefinir = computed(() => recusaDoServidor(erroDefinir.value));
const recusaRetirar = computed(() => recusaDoServidor(erroRetirar.value));

function limpar(): void {
  pin.value = '';
  pinConfirmacao.value = '';
  senhaDefinir.value = '';
  senhaRetirar.value = '';
  erroDefinir.value = null;
  erroRetirar.value = null;
  recusaLocal.value = '';
}
watch(dialogoDefinir, (v) => {
  if (!v) limpar();
});
watch(dialogoRetirar, (v) => {
  if (!v) limpar();
});

function abrirDefinir(): void {
  limpar();
  aviso.value = '';
  dialogoDefinir.value = true;
}
function abrirRetirar(): void {
  limpar();
  aviso.value = '';
  dialogoRetirar.value = true;
}

async function gravar(): Promise<void> {
  if (ocupado.value) return;
  recusaLocal.value = '';
  erroDefinir.value = null;
  const n = pin.value.length;
  if (!/^\d+$/.test(pin.value) || n < minimo.value || n > MAXIMO) {
    recusaLocal.value = t('identidade.pin.formato', { min: minimo.value, max: MAXIMO });
    return;
  }
  if (pin.value !== pinConfirmacao.value) {
    recusaLocal.value = t('identidade.pin.confirmacaoDiferente');
    return;
  }
  const trocou = situacao.value?.definido === true;
  ocupado.value = true;
  try {
    const nova = await definirMeuPin(pin.value, senhaDefinir.value);
    cliente.setQueryData(CHAVE, nova);
    dialogoDefinir.value = false;
    aviso.value = trocou ? t('identidade.pin.trocado') : t('identidade.pin.definido');
  } catch (e) {
    erroDefinir.value = e;
    senhaDefinir.value = '';
  } finally {
    ocupado.value = false;
  }
}

async function retirar(): Promise<void> {
  if (ocupado.value) return;
  erroRetirar.value = null;
  ocupado.value = true;
  try {
    const nova = await retirarMeuPin(senhaRetirar.value);
    cliente.setQueryData(CHAVE, nova);
    dialogoRetirar.value = false;
    aviso.value = t('identidade.pin.retirado');
  } catch (e) {
    erroRetirar.value = e;
    senhaRetirar.value = '';
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="pin" aria-labelledby="pin-titulo" data-testid="meu-pin">
    <h2 id="pin-titulo">{{ t('identidade.pin.titulo') }}</h2>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('identidade.comum.carregando') }}</p>
    <template v-else-if="situacao">
      <p v-if="!situacao.ligada" data-testid="pin-desligado">{{ t('identidade.pin.desligado') }}</p>
      <template v-else>
        <p>{{ t('identidade.pin.texto', { min: minimo }) }}</p>
        <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="pin-aviso" />
        <SanteAlerta
          v-if="situacao.bloqueado"
          :texto="t('identidade.pin.bloqueado')"
          variante="aviso"
          data-testid="pin-bloqueado"
        />
        <p data-testid="pin-situacao">
          <strong>{{ t('identidade.pin.situacao') }}:</strong>
          {{
            situacao.definido
              ? situacao.criadoEm
                ? t('identidade.pin.definidoDesde', { data: dataBr(situacao.criadoEm) })
                : t('identidade.pin.definidoSemData')
              : t('identidade.pin.naoDefinido')
          }}
        </p>
        <div class="botoes">
          <SanteBotao
            :rotulo="situacao.definido ? t('identidade.pin.trocar') : t('identidade.pin.definir')"
            :desabilitado="ocupado"
            data-testid="pin-definir"
            @acionar="abrirDefinir"
          />
          <SanteBotao
            v-if="situacao.definido"
            :rotulo="t('identidade.pin.retirar')"
            variante="secundario"
            :desabilitado="ocupado"
            data-testid="pin-retirar"
            @acionar="abrirRetirar"
          />
        </div>
      </template>
    </template>

    <SanteDialogo
      v-model:visivel="dialogoDefinir"
      :titulo="situacao?.definido ? t('identidade.pin.trocar') : t('identidade.pin.definir')"
    >
      <form class="formulario" data-testid="form-pin-definir" @submit.prevent="gravar">
        <p>{{ t('identidade.pin.regras', { min: minimo, max: MAXIMO }) }}</p>
        <SanteAlerta
          v-if="recusaLocal"
          :texto="recusaLocal"
          variante="aviso"
          anunciar
          data-testid="pin-recusa-local"
        />
        <SanteAlerta
          v-if="recusaDefinir"
          :texto="recusaDefinir"
          variante="aviso"
          anunciar
          data-testid="pin-recusa-definir"
        />
        <MensagemErro v-else-if="erroDefinir" :erro="erroDefinir" />
        <label class="campo" for="pin-novo">
          <span>{{ t('identidade.pin.novo') }}</span>
          <input
            id="pin-novo"
            v-model="pin"
            type="password"
            inputmode="numeric"
            autocomplete="off"
            :maxlength="MAXIMO"
            required
            data-testid="pin-novo"
          />
        </label>
        <label class="campo" for="pin-confirmacao">
          <span>{{ t('identidade.pin.confirmar') }}</span>
          <input
            id="pin-confirmacao"
            v-model="pinConfirmacao"
            type="password"
            inputmode="numeric"
            autocomplete="off"
            :maxlength="MAXIMO"
            required
            data-testid="pin-confirmacao"
          />
        </label>
        <label class="campo" for="pin-senha-definir">
          <span>{{ t('identidade.comum.senha') }}</span>
          <input
            id="pin-senha-definir"
            v-model="senhaDefinir"
            type="password"
            autocomplete="current-password"
            required
            data-testid="pin-senha-definir"
          />
        </label>
        <div class="botoes">
          <SanteBotao
            :rotulo="t('identidade.comum.confirmar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="pin-gravar"
          />
          <SanteBotao
            :rotulo="t('identidade.comum.cancelar')"
            variante="texto"
            @acionar="dialogoDefinir = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo v-model:visivel="dialogoRetirar" :titulo="t('identidade.pin.retirar')">
      <form class="formulario" data-testid="form-pin-retirar" @submit.prevent="retirar">
        <p>{{ t('identidade.pin.retirarTexto') }}</p>
        <SanteAlerta
          v-if="recusaRetirar"
          :texto="recusaRetirar"
          variante="aviso"
          anunciar
          data-testid="pin-recusa-retirar"
        />
        <MensagemErro v-else-if="erroRetirar" :erro="erroRetirar" />
        <label class="campo" for="pin-senha-retirar">
          <span>{{ t('identidade.comum.senha') }}</span>
          <input
            id="pin-senha-retirar"
            v-model="senhaRetirar"
            type="password"
            autocomplete="current-password"
            required
            data-testid="pin-senha-retirar"
          />
        </label>
        <div class="botoes">
          <SanteBotao
            :rotulo="t('identidade.pin.retirar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="pin-confirmar-retirar"
          />
          <SanteBotao
            :rotulo="t('identidade.comum.cancelar')"
            variante="texto"
            @acionar="dialogoRetirar = false"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.pin {
  margin-top: var(--sgh-espaco-4, 2rem);
}
.botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  margin-top: var(--sgh-espaco-2);
}
.formulario {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
</style>
