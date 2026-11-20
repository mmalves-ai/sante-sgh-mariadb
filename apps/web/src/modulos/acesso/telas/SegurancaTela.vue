<script setup lang="ts">
// "Segurança da conta" (M59-F2; ficha do M59, seção 7: /preferencias/seguranca): o próprio segundo fator (TOTP).
// Cadastro em dois passos (QR ou chave no aplicativo autenticador; o primeiro código certo ativa), a situação e o
// que a política exige do perfil (opcional, adesão com prazo, obrigatório) e a remoção com a senha, só quando a
// política não exige. O segredo aparece uma vez, só nesta tela, e não fica guardado no navegador.
// W1-01 (parte 8b): abaixo, "Minhas sessões" (encerrar uma ou as outras); parte 11b3a: antes delas, o PIN da
// troca rápida de usuário (definir/trocar e retirar com a senha).
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { SanteAlerta, SanteBotao, SanteDialogo } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import { type SegundoFatorInicio, tipoDoProblema } from '@sgh/contratos';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import MeuPin from '../componentes/MeuPin.vue';
import MinhasSessoes from '../componentes/MinhasSessoes.vue';
import { CHAVE_SESSAO } from '../../../casca/sessao/sessao.js';
import { desenharQr } from '../../suporte/qr.js';
import {
  buscarMeuSegundoFator,
  codigoDoErro,
  confirmarSegundoFator,
  iniciarSegundoFator,
  removerSegundoFator,
} from '../api-identidade.js';
import { chaveDoUri, codigoLimpo, codigoValido, dataBr } from '../identidade-tela.js';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const CHAVE = ['identidade', 'meu-segundo-fator'] as const;
const meu = useQuery({ queryKey: CHAVE, queryFn: () => buscarMeuSegundoFator() });
const veioDaAdesao = computed(() => rota.query['adesao'] === '1');

const inicio = ref<SegundoFatorInicio | null>(null);
const codigo = ref('');
const erro = ref<unknown>(null);
const recusa = ref('');
const aviso = ref('');
const ocupado = ref(false);
const qr = computed(() => (inicio.value ? desenharQr(inicio.value.uri) : null));
const chave = computed(() => (inicio.value ? chaveDoUri(inicio.value.uri) : ''));
const ativo = computed(() => meu.data.value?.situacao === 'ativo');
const podeRemover = computed(() => ativo.value && meu.data.value?.exigencia === 'opcional');

const hora = (iso: string): string => {
  const x = new Date(iso);
  return Number.isNaN(x.getTime())
    ? iso
    : x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

async function atualizar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: CHAVE });
  await cliente.invalidateQueries({ queryKey: CHAVE_SESSAO });
}

// Iniciar é crítico (SBIS-07): fora da janela recente de reautenticação, a tela pede a senha e tenta de novo.
const dialogoSenhaCadastro = ref(false);
const senhaCadastro = ref('');
const erroSenhaCadastro = ref<unknown>(null);
async function comecar(): Promise<void> {
  if (ocupado.value) return;
  ocupado.value = true;
  erro.value = null;
  recusa.value = '';
  aviso.value = '';
  codigo.value = '';
  try {
    inicio.value = await iniciarSegundoFator();
  } catch (e) {
    if (e instanceof ErroApi && e.problema && tipoDoProblema(e.problema) === 'reautenticacao-necessaria') {
      senhaCadastro.value = '';
      erroSenhaCadastro.value = null;
      dialogoSenhaCadastro.value = true;
    } else erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
async function comecarComSenha(): Promise<void> {
  if (ocupado.value || !senhaCadastro.value) return;
  ocupado.value = true;
  erroSenhaCadastro.value = null;
  try {
    inicio.value = await iniciarSegundoFator(senhaCadastro.value);
    dialogoSenhaCadastro.value = false;
  } catch (e) {
    erroSenhaCadastro.value = e;
  } finally {
    senhaCadastro.value = '';
    ocupado.value = false;
  }
}

async function confirmar(): Promise<void> {
  if (ocupado.value) return;
  recusa.value = '';
  if (!codigoValido(codigo.value)) {
    recusa.value = t('identidade.seguranca.codigoInvalido');
    return;
  }
  ocupado.value = true;
  erro.value = null;
  try {
    await confirmarSegundoFator(codigoLimpo(codigo.value));
    inicio.value = null;
    codigo.value = '';
    aviso.value = t('identidade.seguranca.confirmado');
    await atualizar();
  } catch (e) {
    const c = codigoDoErro(e);
    if (c === 'sem-cadastro') {
      recusa.value = t('identidade.seguranca.expirado');
      inicio.value = null;
    } else if (c) recusa.value = t('identidade.seguranca.recusado');
    else erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

const dialogoRemover = ref(false);
const senha = ref('');
const erroRemover = ref<unknown>(null);
function abrirRemover(): void {
  senha.value = '';
  erroRemover.value = null;
  dialogoRemover.value = true;
}
async function remover(): Promise<void> {
  if (ocupado.value || !senha.value) return;
  ocupado.value = true;
  erroRemover.value = null;
  try {
    await removerSegundoFator(senha.value);
    dialogoRemover.value = false;
    aviso.value = t('identidade.seguranca.removido');
    await atualizar();
  } catch (e) {
    erroRemover.value = e;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="seguranca-titulo">
    <h1 id="seguranca-titulo">{{ t('identidade.seguranca.titulo') }}</h1>
    <p>{{ t('identidade.seguranca.texto') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="seguranca-aviso" />
    <MensagemErro v-if="meu.isError.value" :erro="meu.error.value" />
    <p v-else-if="meu.isPending.value">{{ t('identidade.comum.carregando') }}</p>
    <template v-else-if="meu.data.value">
      <SanteAlerta
        v-if="!meu.data.value.disponivel"
        variante="info"
        :texto="t('identidade.comum.indisponivel')"
        data-testid="segundo-fator-indisponivel"
      />
      <template v-else>
        <dl class="situacao" data-testid="seguranca-situacao">
          <div>
            <dt>{{ t('identidade.seguranca.situacao') }}</dt>
            <dd data-testid="seguranca-situacao-fator">
              {{ t(`identidade.situacaoFator.${meu.data.value.situacao}`) }}
              <template v-if="ativo && meu.data.value.confirmadoEm">
                ({{ t('identidade.seguranca.confirmadoEm', { data: dataBr(meu.data.value.confirmadoEm) }) }})
              </template>
            </dd>
          </div>
          <div>
            <dt>{{ t('identidade.seguranca.exigencia') }}</dt>
            <dd data-testid="seguranca-exigencia">
              {{ t(`identidade.exigencia.${meu.data.value.exigencia}`) }}
            </dd>
          </div>
        </dl>
        <SanteAlerta
          v-if="!ativo && meu.data.value.exigencia === 'adesao'"
          variante="aviso"
          :anunciar="veioDaAdesao"
          :texto="t('identidade.seguranca.adesao', { data: dataBr(meu.data.value.prazoAdesaoAte) })"
          data-testid="seguranca-adesao"
        />
        <SanteAlerta
          v-else-if="!ativo && meu.data.value.exigencia === 'obrigatorio'"
          variante="alerta"
          :texto="t('identidade.seguranca.obrigatorioSem')"
          data-testid="seguranca-obrigatorio"
        />
        <MensagemErro v-if="erro" :erro="erro" />

        <div v-if="!ativo && !inicio" class="botoes">
          <SanteBotao
            :rotulo="t('identidade.seguranca.cadastrar')"
            :desabilitado="ocupado"
            data-testid="seguranca-cadastrar"
            @acionar="comecar"
          />
        </div>

        <form v-if="inicio" class="cadastro" data-testid="seguranca-cadastro" @submit.prevent="confirmar">
          <p>{{ t('identidade.seguranca.passo1') }}</p>
          <svg
            v-if="qr"
            class="qr"
            :width="qr.lado"
            :height="qr.lado"
            :viewBox="`0 0 ${qr.lado} ${qr.lado}`"
            role="img"
            :aria-label="t('identidade.seguranca.qr')"
            data-testid="seguranca-qr"
          >
            <rect class="qr__fundo" :width="qr.lado" :height="qr.lado" />
            <path class="qr__modulos" :d="qr.caminho" />
          </svg>
          <p>
            {{ t('identidade.seguranca.chave') }}
            <code class="chave" data-testid="seguranca-chave">{{ chave }}</code>
          </p>
          <p class="ajuda">{{ t('identidade.seguranca.expira', { hora: hora(inicio.expiraEm) }) }}</p>
          <label for="seguranca-codigo">{{ t('identidade.seguranca.passo2') }}</label>
          <input
            id="seguranca-codigo"
            v-model="codigo"
            class="codigo"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="7"
            :aria-invalid="recusa ? 'true' : 'false'"
            aria-describedby="seguranca-recusa"
            data-testid="seguranca-codigo"
          />
          <p id="seguranca-recusa" role="alert" class="recusa" data-testid="seguranca-recusa">{{ recusa }}</p>
          <div class="botoes">
            <SanteBotao
              :rotulo="t('identidade.seguranca.confirmarCodigo')"
              tipo="submit"
              :desabilitado="ocupado"
              data-testid="seguranca-confirmar"
            />
            <SanteBotao
              :rotulo="t('identidade.seguranca.recadastrar')"
              variante="texto"
              :desabilitado="ocupado"
              @acionar="comecar"
            />
          </div>
        </form>
        <p v-else-if="recusa" role="alert" class="recusa">{{ recusa }}</p>

        <div v-if="ativo" class="botoes">
          <SanteBotao
            v-if="podeRemover"
            :rotulo="t('identidade.seguranca.remover')"
            variante="secundario"
            data-testid="seguranca-remover"
            @acionar="abrirRemover"
          />
          <p v-else data-testid="seguranca-nao-remove">{{ t('identidade.seguranca.naoRemove') }}</p>
        </div>
        <p v-if="veioDaAdesao && ativo">
          <RouterLink to="/inicio" data-testid="seguranca-ir-inicio">{{
            t('identidade.seguranca.voltarInicio')
          }}</RouterLink>
        </p>
      </template>
    </template>

    <MeuPin />

    <MinhasSessoes />

    <SanteDialogo v-model:visivel="dialogoSenhaCadastro" :titulo="t('identidade.seguranca.cadastrar')">
      <form class="cadastro" data-testid="form-senha-cadastro" @submit.prevent="comecarComSenha">
        <p>{{ t('identidade.seguranca.confirmarSenhaCadastro') }}</p>
        <MensagemErro v-if="erroSenhaCadastro" :erro="erroSenhaCadastro" />
        <label class="campo" for="seguranca-senha-cadastro">
          <span>{{ t('identidade.comum.senha') }}</span>
          <input
            id="seguranca-senha-cadastro"
            v-model="senhaCadastro"
            type="password"
            autocomplete="current-password"
            required
            data-testid="seguranca-senha-cadastro"
          />
        </label>
        <div class="botoes">
          <SanteBotao
            :rotulo="t('identidade.comum.confirmar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="seguranca-confirmar-senha-cadastro"
          />
          <SanteBotao
            :rotulo="t('identidade.comum.cancelar')"
            variante="texto"
            @acionar="dialogoSenhaCadastro = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo v-model:visivel="dialogoRemover" :titulo="t('identidade.seguranca.remover')">
      <form class="cadastro" data-testid="form-remover-fator" @submit.prevent="remover">
        <p>{{ t('identidade.seguranca.removerTexto') }}</p>
        <MensagemErro v-if="erroRemover" :erro="erroRemover" />
        <label class="campo" for="seguranca-senha-remover">
          <span>{{ t('identidade.comum.senha') }}</span>
          <input
            id="seguranca-senha-remover"
            v-model="senha"
            type="password"
            autocomplete="current-password"
            required
            data-testid="seguranca-senha-remover"
          />
        </label>
        <div class="botoes">
          <SanteBotao
            :rotulo="t('identidade.comum.confirmar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="seguranca-confirmar-remocao"
          />
          <SanteBotao
            :rotulo="t('identidade.comum.cancelar')"
            variante="texto"
            @acionar="dialogoRemover = false"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.situacao {
  display: grid;
  gap: var(--sgh-espaco-1);
  margin: var(--sgh-espaco-2) 0;
}
.situacao div {
  display: flex;
  gap: var(--sgh-espaco-2);
}
.situacao dt {
  font-weight: 600;
  min-width: 12rem;
}
.situacao dd {
  margin: 0;
}
.cadastro,
.campo {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 28rem;
}
.botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
  margin: var(--sgh-espaco-2) 0;
}
/* O QR sai sempre escuro sobre claro (leitores de autenticador não leem o invertido): no tema escuro os dois
   tokens se trocam. */
.qr__fundo {
  fill: var(--sgh-fundo);
}
.qr__modulos {
  fill: var(--sgh-texto);
}
:global(.modo-escuro) .qr__fundo {
  fill: var(--sgh-texto);
}
:global(.modo-escuro) .qr__modulos {
  fill: var(--sgh-fundo);
}
.chave {
  font-family: monospace;
  letter-spacing: 0.05em;
  overflow-wrap: anywhere;
}
.ajuda {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.recusa {
  color: var(--sgh-alerta);
  min-height: 1em;
  margin: 0;
}
input {
  font: inherit;
  min-height: var(--sgh-alvo-minimo);
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.codigo {
  max-width: 10rem;
  letter-spacing: 0.2em;
}
input:focus-visible {
  outline: 2px solid var(--sgh-foco);
  outline-offset: 2px;
}
</style>
