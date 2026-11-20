<script setup lang="ts">
// Consulta de protocolo no portal do prestador credenciado (M56, etapa 8, F7): `/prestador/protocolo`. O prestador
// consulta pelo número (20 dígitos) a situação e o prazo de um protocolo dele, de atendimento ou de pedido de
// autorização (função 7); o servidor só acha os do prestador da conta. W0-10: no de atendimento, as mensagens da
// operadora com as respostas do prestador (texto e um arquivo), e "Responder" enquanto o protocolo aceita resposta; e
// "Abrir protocolo": a demanda do prestador à operadora (natureza, carteirinha, assunto e relato), com confirmação.
import {
  type AbrirProtocoloPortalEntrada,
  NATUREZAS_PROTOCOLO_PORTAL,
  type ProtocoloPortal,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import {
  abrirProtocoloPortalPrestador,
  type AnexoEnviado,
  protocoloPortalPrestador,
  responderInteracaoPortalPrestador,
  urlAnexoProtocoloPortal,
} from '../api-portal-prestador.js';
import PortalPrestadorCasca from '../componentes/PortalPrestadorCasca.vue';
import RespostaComAnexos from '../componentes/RespostaComAnexos.vue';

const { t } = useI18n();
const numero = ref('');
const achado = ref<ProtocoloPortal | null>(null);
const respondendo = ref<number | null>(null);
const mensagem = ref<string | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const data = (d: string) => `${d.slice(0, 10).split('-').reverse().join('/')} ${d.slice(11, 16)}`.trim();

async function consultar(): Promise<void> {
  achado.value = null;
  respondendo.value = null;
  mensagem.value = null;
  recusa.value = null;
  erro.value = null;
  try {
    achado.value = await protocoloPortalPrestador(numero.value.trim());
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404].includes(e.status))
      recusa.value = e.problema.detail;
    else erro.value = e;
  }
}

// W0-10: a resposta vai na versão vista do protocolo; depois, a consulta é refeita (a resposta nova aparece na lista).
function enviarResposta(evento: number) {
  return (texto: string, anexos: AnexoEnviado[]) => {
    const p = achado.value;
    if (!p || p.versao === null) throw new Error('protocolo sem versão');
    return responderInteracaoPortalPrestador(p.id, evento, {
      versao: p.versao,
      texto,
      anexo: anexos[0] ?? null,
    });
  };
}
// W0-10: a abertura do protocolo, com o painel de confirmação (nada é enviado antes do "Confirmar").
const abrindo = ref(false);
const confirmandoAbertura = ref(false);
const ocupado = ref(false);
const novo = reactive<AbrirProtocoloPortalEntrada>({
  natureza: 'informacao',
  carteirinha: '',
  assunto: '',
  relato: '',
});
const opcoesNatureza = computed(() =>
  NATUREZAS_PROTOCOLO_PORTAL.map((n) => ({ valor: n, rotulo: t(`operadoraAtendimento.naturezas.${n}`) })),
);
const aberturaCompleta = computed(
  () =>
    /^\d{16}$/.test(novo.carteirinha.trim()) &&
    novo.assunto.trim().length >= 5 &&
    novo.relato.trim().length >= 10,
);
async function abrirProtocolo(): Promise<void> {
  confirmandoAbertura.value = false;
  ocupado.value = true;
  recusa.value = null;
  erro.value = null;
  try {
    const r = await abrirProtocoloPortalPrestador({
      natureza: novo.natureza,
      carteirinha: novo.carteirinha.trim(),
      assunto: novo.assunto.trim(),
      relato: novo.relato.trim(),
    });
    abrindo.value = false;
    Object.assign(novo, { natureza: 'informacao', carteirinha: '', assunto: '', relato: '' });
    numero.value = r.protocolo;
    await consultar();
    mensagem.value = r.mensagem;
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 403, 409].includes(e.status))
      recusa.value = e.problema.detail;
    else erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

async function respondido(m: string): Promise<void> {
  await consultar();
  mensagem.value = m;
}
</script>

<template>
  <PortalPrestadorCasca :titulo="t('portalPrestador.protocolo.titulo')">
    <section class="conteudo" data-testid="portal-prestador-protocolo">
      <form class="campos" @submit.prevent="consultar">
        <SanteCampoTexto
          id="pp-numero"
          v-model="numero"
          :rotulo="t('portalPrestador.protocolo.numero')"
          :max-bytes="20"
        />
        <SanteBotao
          tipo="submit"
          :rotulo="t('portalPrestador.protocolo.consultar')"
          :desabilitado="!/^\d{20}$/.test(numero.trim())"
          data-testid="pp-consultar"
        />
      </form>
      <div v-if="!abrindo" class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('portalPrestador.protocolo.abrir')"
          data-testid="pp-abrir-protocolo"
          @acionar="abrindo = true"
        />
      </div>
      <form v-else class="abertura" data-testid="pp-abertura" @submit.prevent>
        <h2>{{ t('portalPrestador.protocolo.abrirTitulo') }}</h2>
        <p class="secundario">{{ t('portalPrestador.protocolo.abrirTexto') }}</p>
        <SanteSelecao
          v-model="novo.natureza"
          :rotulo="t('portalPrestador.protocolo.natureza')"
          :opcoes="opcoesNatureza"
          data-testid="pp-abertura-natureza"
        />
        <SanteCampoTexto
          id="pp-abertura-carteirinha"
          v-model="novo.carteirinha"
          :rotulo="t('portalPrestador.protocolo.carteirinha')"
          :max-bytes="16"
          obrigatorio
          data-testid="pp-abertura-carteirinha"
        />
        <SanteCampoTexto
          id="pp-abertura-assunto"
          v-model="novo.assunto"
          :rotulo="t('portalPrestador.protocolo.assunto')"
          :max-bytes="200"
          obrigatorio
          data-testid="pp-abertura-assunto"
        />
        <SanteCampoTexto
          id="pp-abertura-relato"
          v-model="novo.relato"
          :rotulo="t('portalPrestador.protocolo.relato')"
          :max-bytes="2000"
          multilinha
          obrigatorio
          data-testid="pp-abertura-relato"
        />
        <section
          v-if="confirmandoAbertura"
          class="painel"
          role="dialog"
          aria-modal="false"
          data-testid="pp-abertura-confirmacao"
        >
          <p>{{ t('portalPrestador.protocolo.abrirConfirma') }}</p>
          <div class="acoes">
            <SanteBotao
              :rotulo="t('portalPrestador.conta.confirmar')"
              :desabilitado="ocupado"
              data-testid="pp-abertura-confirmar"
              @acionar="abrirProtocolo"
            />
            <SanteBotao
              variante="texto"
              :rotulo="t('portalPrestador.conta.voltar')"
              data-testid="pp-abertura-voltar"
              @acionar="confirmandoAbertura = false"
            />
          </div>
        </section>
        <div v-else class="acoes">
          <SanteBotao
            :rotulo="t('portalPrestador.protocolo.abrirEnviar')"
            :desabilitado="!aberturaCompleta || ocupado"
            data-testid="pp-abertura-enviar"
            @acionar="confirmandoAbertura = true"
          />
          <SanteBotao
            variante="texto"
            :rotulo="t('portalPrestador.conta.voltar')"
            data-testid="pp-abertura-cancelar"
            @acionar="abrindo = false"
          />
        </div>
      </form>
      <div v-if="recusa" role="alert" data-testid="pp-protocolo-recusa">
        <SanteAlerta :texto="recusa" variante="aviso" />
      </div>
      <MensagemErro v-if="erro" :erro="erro" />
      <dl v-if="achado" class="ficha" data-testid="pp-protocolo-resultado">
        <div>
          <dt>{{ t(`portalPrestador.protocolo.${achado.tipo}`) }}</dt>
          <dd>{{ achado.protocolo }}</dd>
        </div>
        <div>
          <dt>{{ t('portalPrestador.pedidos.situacao') }}</dt>
          <dd data-testid="pp-protocolo-situacao">{{ achado.situacaoRotulo }}</dd>
        </div>
        <div>
          <dt>{{ t('portalPrestador.protocolo.aberto') }}</dt>
          <dd>{{ data(achado.abertoEm) }}</dd>
        </div>
        <div>
          <dt>{{ t('portalPrestador.protocolo.prazo') }}</dt>
          <dd>
            {{ data(achado.prazoEm) }}
            <strong v-if="achado.vencido"> · {{ t('portalPrestador.protocolo.vencido') }}</strong>
          </dd>
        </div>
      </dl>
      <p v-if="mensagem" role="status" data-testid="pp-protocolo-mensagem">{{ mensagem }}</p>
      <section
        v-if="achado?.tipo === 'atendimento'"
        class="interacoes"
        aria-labelledby="pp-interacoes-titulo"
        data-testid="pp-interacoes"
      >
        <h2 id="pp-interacoes-titulo">{{ t('portalPrestador.protocolo.interacoes') }}</h2>
        <p v-if="!achado.interacoes.length" class="secundario">
          {{ t('portalPrestador.protocolo.semInteracoes') }}
        </p>
        <p v-else-if="!achado.respondivel" class="secundario" data-testid="pp-nao-respondivel">
          {{ t('portalPrestador.protocolo.naoRespondivel') }}
        </p>
        <article
          v-for="i in achado.interacoes"
          :key="i.evento"
          class="interacao"
          :data-testid="`pp-interacao-${i.evento}`"
        >
          <p class="secundario">{{ data(i.em) }}</p>
          <p>{{ i.texto }}</p>
          <template v-if="i.respostas.length">
            <h3>{{ t('portalPrestador.protocolo.suasRespostas') }}</h3>
            <ul class="respostas">
              <li v-for="r in i.respostas" :key="r.id" :data-testid="`pp-resposta-${r.id}`">
                <span class="secundario">{{ data(r.em) }}</span> · {{ r.texto }}
                <a
                  v-if="r.anexo"
                  :href="urlAnexoProtocoloPortal(achado.id, r.id)"
                  :download="r.anexo.nome"
                  :data-testid="`pp-resposta-anexo-${r.id}`"
                  >{{ t('portalPrestador.resposta.baixar', { nome: r.anexo.nome }) }}</a
                >
              </li>
            </ul>
          </template>
          <RespostaComAnexos
            v-if="respondendo === i.evento"
            prefixo="pp-interacao"
            :max-arquivos="1"
            :enviar="enviarResposta(i.evento)"
            @enviado="respondido"
            @cancelar="respondendo = null"
          />
          <div v-else-if="achado.respondivel && achado.versao !== null" class="acoes">
            <SanteBotao
              variante="secundario"
              :rotulo="t('portalPrestador.protocolo.responder')"
              :data-testid="`pp-responder-${i.evento}`"
              @acionar="respondendo = i.evento"
            />
          </div>
        </article>
      </section>
    </section>
  </PortalPrestadorCasca>
</template>

<style scoped src="../../operadora/estilo-operadora.css"></style>
<style scoped>
.conteudo {
  display: grid;
  gap: 1rem;
}
.ficha {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 0.5rem 1rem;
  margin: 0;
}
.ficha div {
  display: grid;
  gap: 0.125rem;
}
.ficha dt {
  color: var(--p-text-muted-color);
  font-size: 0.9em;
}
.ficha dd {
  margin: 0;
}
.abertura,
.interacoes {
  display: grid;
  gap: 0.75rem;
}
.interacao {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio, 6px);
}
.abertura h2,
.interacao p,
.interacao h3 {
  margin: 0;
}
.painel {
  display: grid;
  gap: var(--sgh-espaco-2);
  padding: var(--sgh-espaco-3);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio, 6px);
}
.respostas {
  margin: 0;
  padding-left: 1.25rem;
}
</style>
