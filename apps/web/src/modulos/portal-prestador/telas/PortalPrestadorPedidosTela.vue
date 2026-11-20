<script setup lang="ts">
// Pedidos de autorização no portal do prestador credenciado (M56, etapa 8, F7): `/prestador/pedidos`. Só os pedidos do
// prestador da conta (o servidor tira o prestador da sessão): a lista (protocolo ou carteirinha; páginas), o beneficiário
// só pelas iniciais, a ficha com os itens pedidos e autorizados e a senha, o pedido novo (o formulário da operadora sem o
// prestador e a origem, que saem da conta e do portal) e o cancelamento do pedido ainda não decidido. Cada ação aparece
// só com a função liberada pelo credenciamento; o servidor confere de novo. W0-10: o complemento pedido pelo auditor e as
// respostas dadas (texto e arquivos, com download); "Responder ao complemento" enquanto o pedido o aguarda.
import {
  ANEXOS_COMPLEMENTO_PORTAL_MAX,
  type ApoioPortalPrestador,
  FUNCAO_PORTAL,
  type ResultadoAutorizacao,
  type SessaoPortalPrestador,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import FormAutorizacao from '../../operadora/componentes/FormAutorizacao.vue';
import {
  type AnexoEnviado,
  apoioPortalPrestador,
  cancelarPedidoPortalPrestador,
  pedidoPortalPrestador,
  pedidosPortalPrestador,
  procedimentosPortalPrestador,
  responderComplementoPortalPrestador,
  solicitarPortalPrestador,
  urlAnexoComplementoPortal,
} from '../api-portal-prestador.js';
import PortalPrestadorCasca from '../componentes/PortalPrestadorCasca.vue';
import RespostaComAnexos from '../componentes/RespostaComAnexos.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const sessao = ref<SessaoPortalPrestador | null>(null);
const tem = (f: number) => sessao.value?.funcoes.includes(f) === true;
const consulta = computed(() => tem(FUNCAO_PORTAL.consultar));
const solicita = computed(() => tem(FUNCAO_PORTAL.solicitar));
const cancela = computed(() => tem(FUNCAO_PORTAL.cancelar));

const data = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const quando = (d: string) => `${data(d)} ${d.slice(11, 16)}`.trim();

// ── Lista ──
const busca = ref('');
const aplicada = ref('');
const cursores = ref<(number | null)[]>([null]);
const cursor = computed(() => cursores.value[cursores.value.length - 1] ?? null);
const lista = useQuery({
  queryKey: computed(() => ['portal-prestador', 'pedidos', aplicada.value, cursor.value]),
  queryFn: () => pedidosPortalPrestador({ busca: aplicada.value || null, apos: cursor.value }),
  enabled: consulta,
});
function buscar(): void {
  aplicada.value = busca.value.trim();
  cursores.value = [null];
}

// ── Ficha ──
const aberto = ref<number | null>(null);
const ficha = useQuery({
  queryKey: computed(() => ['portal-prestador', 'pedido', aberto.value]),
  queryFn: () => pedidoPortalPrestador(aberto.value as number),
  enabled: computed(() => aberto.value !== null && consulta.value),
});
const mensagem = ref<string | null>(null);
const avisos = ref<string[]>([]);

// ── Pedido novo ──
const apoio = useQuery({
  queryKey: ['portal-prestador', 'apoio'],
  queryFn: () => apoioPortalPrestador(),
  enabled: solicita,
});
const pedindo = ref(false);
async function gravado(r: ResultadoAutorizacao): Promise<void> {
  pedindo.value = false;
  cancelando.value = false;
  mensagem.value = r.mensagem;
  avisos.value = r.avisos;
  if (consulta.value) aberto.value = r.id;
  await cliente.invalidateQueries({ queryKey: ['portal-prestador'] });
}
const apoioPortal = computed<ApoioPortalPrestador | null>(() => apoio.data.value ?? null);

// ── Cancelamento ──
const cancelando = ref(false);
const motivo = ref('');
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
function abrirCancelamento(): void {
  motivo.value = '';
  recusa.value = null;
  erro.value = null;
  cancelando.value = true;
}
async function cancelar(): Promise<void> {
  const p = ficha.data.value;
  if (!p || motivo.value.trim().length < 10) return;
  recusa.value = null;
  erro.value = null;
  try {
    await gravado(await cancelarPedidoPortalPrestador(p.id, { versao: p.versao, motivo: motivo.value }));
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409].includes(e.status))
      recusa.value = e.problema.detail;
    else erro.value = e;
  }
}
// ── W0-10: resposta ao complemento (na versão vista do pedido) ──
const complementando = ref(false);
const complemento = computed(() => ficha.data.value?.complemento ?? null);
watch(aberto, () => (complementando.value = false));
async function enviarComplemento(resposta: string, anexos: AnexoEnviado[]) {
  const p = ficha.data.value;
  if (!p) throw new Error('pedido não carregado');
  return responderComplementoPortalPrestador(p.id, { versao: p.versao, resposta, anexos });
}
async function complementado(m: string): Promise<void> {
  complementando.value = false;
  mensagem.value = m;
  avisos.value = [];
  await cliente.invalidateQueries({ queryKey: ['portal-prestador'] });
}

const cancelavel = computed(
  () => cancela.value && ['em-analise', 'pendente'].includes(ficha.data.value?.situacao ?? ''),
);
</script>

<template>
  <PortalPrestadorCasca :titulo="t('portalPrestador.pedidos.titulo')" @sessao="(s) => (sessao = s)">
    <section class="conteudo" data-testid="portal-prestador-pedidos">
      <p v-if="mensagem" role="status" data-testid="pp-mensagem">{{ mensagem }}</p>
      <ul v-if="avisos.length" class="secundario" data-testid="pp-avisos">
        <li v-for="a in avisos" :key="a">{{ a }}</li>
      </ul>
      <div class="acoes">
        <SanteBotao
          v-if="solicita"
          :rotulo="t('portalPrestador.pedidos.novo')"
          :desabilitado="!apoioPortal"
          data-testid="pp-novo"
          @acionar="pedindo = true"
        />
      </div>
      <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />

      <p v-if="!consulta" class="secundario" data-testid="pp-sem-consulta">
        {{ t('portalPrestador.pedidos.semConsulta') }}
      </p>
      <template v-else>
        <form class="campos" @submit.prevent="buscar">
          <SanteCampoTexto
            id="pp-busca"
            v-model="busca"
            :rotulo="t('portalPrestador.pedidos.busca')"
            :max-bytes="60"
          />
          <SanteBotao tipo="submit" :rotulo="t('portalPrestador.pedidos.buscar')" data-testid="pp-buscar" />
        </form>
        <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
        <p v-else-if="!lista.data.value" role="status">{{ t('portalPrestador.carregando') }}</p>
        <p v-else-if="!lista.data.value.itens.length" data-testid="pp-nenhum">
          {{ t('portalPrestador.pedidos.nenhum') }}
        </p>
        <table v-else class="tabela" data-testid="pp-lista">
          <caption class="visualmente-oculto">
            {{
              t('portalPrestador.pedidos.titulo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('portalPrestador.pedidos.protocolo') }}</th>
              <th scope="col">{{ t('portalPrestador.pedidos.beneficiario') }}</th>
              <th scope="col">{{ t('portalPrestador.pedidos.situacao') }}</th>
              <th scope="col">{{ t('portalPrestador.pedidos.solicitada') }}</th>
              <th scope="col">{{ t('portalPrestador.pedidos.prazo') }}</th>
              <th scope="col">{{ t('portalPrestador.pedidos.senha') }}</th>
              <th scope="col">
                <span class="visualmente-oculto">{{ t('portalPrestador.pedidos.abrir') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in lista.data.value.itens" :key="p.id" :data-testid="`pp-linha-${p.id}`">
              <td>{{ p.protocolo }}</td>
              <td>
                {{ p.beneficiarioIniciais }}<br /><span class="secundario">{{ p.carteirinha }}</span>
              </td>
              <td>{{ p.situacaoRotulo }}</td>
              <td>{{ quando(p.solicitadaEm) }}</td>
              <td>{{ quando(p.prazoEm) }}</td>
              <td>{{ p.senha ?? '—' }}</td>
              <td>
                <SanteBotao
                  variante="texto"
                  :rotulo="t('portalPrestador.pedidos.abrir')"
                  :data-testid="`pp-abrir-${p.id}`"
                  @acionar="aberto = p.id"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="lista.data.value" class="acoes">
          <SanteBotao
            variante="secundario"
            :rotulo="t('portalPrestador.pedidos.anterior')"
            :desabilitado="cursores.length <= 1"
            @acionar="cursores = cursores.slice(0, -1)"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('portalPrestador.pedidos.proxima')"
            :desabilitado="!lista.data.value.proxima"
            @acionar="lista.data.value.proxima && (cursores = [...cursores, lista.data.value.proxima])"
          />
        </div>

        <section
          v-if="aberto !== null"
          class="bloco"
          data-testid="pp-ficha"
          aria-labelledby="pp-ficha-titulo"
        >
          <MensagemErro v-if="ficha.isError.value" :erro="ficha.error.value" />
          <p v-else-if="!ficha.data.value" role="status">{{ t('portalPrestador.carregando') }}</p>
          <template v-else>
            <div class="acoes">
              <h2 id="pp-ficha-titulo">{{ ficha.data.value.protocolo }}</h2>
              <span data-testid="pp-ficha-situacao">· {{ ficha.data.value.situacaoRotulo }}</span>
              <SanteBotao
                variante="texto"
                :rotulo="t('portalPrestador.pedidos.fechar')"
                @acionar="aberto = null"
              />
            </div>
            <p>
              {{ ficha.data.value.beneficiarioIniciais }} · {{ ficha.data.value.carteirinha }} ·
              {{ t('portalPrestador.pedidos.prazo') }} {{ quando(ficha.data.value.prazoEm) }}
              <template v-if="ficha.data.value.senha">
                · {{ t('portalPrestador.pedidos.senha') }} {{ ficha.data.value.senha }}
              </template>
            </p>
            <table class="tabela" data-testid="pp-ficha-itens">
              <caption class="visualmente-oculto">
                {{
                  t('portalPrestador.pedidos.itens')
                }}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{{ t('portalPrestador.pedidos.codigo') }}</th>
                  <th scope="col">{{ t('portalPrestador.pedidos.descricao') }}</th>
                  <th scope="col">{{ t('portalPrestador.pedidos.solicitadaQtd') }}</th>
                  <th scope="col">{{ t('portalPrestador.pedidos.autorizadaQtd') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(i, n) in ficha.data.value.itens" :key="n">
                  <td>{{ i.codigo }}</td>
                  <td>{{ i.descricao }}</td>
                  <td>{{ i.solicitada }}</td>
                  <td>{{ i.autorizada ?? '—' }}</td>
                </tr>
              </tbody>
            </table>
            <section
              v-if="
                complemento && (complemento.aguardando || complemento.pedido || complemento.respostas.length)
              "
              class="complemento"
              aria-labelledby="pp-complemento-titulo"
              data-testid="pp-complemento"
            >
              <h3 id="pp-complemento-titulo">{{ t('portalPrestador.complemento.titulo') }}</h3>
              <p v-if="complemento.pedido" data-testid="pp-complemento-pedido">
                <strong>{{ t('portalPrestador.complemento.pedido') }}:</strong>
                {{ complemento.pedido }}
              </p>
              <h4>{{ t('portalPrestador.complemento.respostas') }}</h4>
              <p v-if="!complemento.respostas.length" class="secundario">
                {{ t('portalPrestador.complemento.nenhuma') }}
              </p>
              <ul v-else class="respostas">
                <li
                  v-for="r in complemento.respostas"
                  :key="r.evento"
                  :data-testid="`pp-complemento-resposta-${r.evento}`"
                >
                  <span class="secundario">{{ quando(r.em) }}</span> · {{ r.texto }}
                  <ul v-if="r.anexos.length">
                    <li v-for="x in r.anexos" :key="x.id">
                      <a
                        :href="urlAnexoComplementoPortal(ficha.data.value.id, x.id)"
                        :download="x.nome"
                        :data-testid="`pp-complemento-anexo-${x.id}`"
                        >{{ t('portalPrestador.resposta.baixar', { nome: x.nome }) }}</a
                      >
                    </li>
                  </ul>
                </li>
              </ul>
              <RespostaComAnexos
                v-if="complementando"
                prefixo="pp-complemento"
                :max-arquivos="ANEXOS_COMPLEMENTO_PORTAL_MAX"
                :enviar="enviarComplemento"
                @enviado="complementado"
                @cancelar="complementando = false"
              />
              <div v-else-if="complemento.aguardando" class="acoes">
                <SanteBotao
                  :rotulo="t('portalPrestador.complemento.responder')"
                  data-testid="pp-complemento-responder"
                  @acionar="complementando = true"
                />
              </div>
            </section>
            <div v-if="cancelavel" class="acoes">
              <SanteBotao
                variante="secundario"
                :rotulo="t('portalPrestador.pedidos.cancelar')"
                data-testid="pp-cancelar"
                @acionar="abrirCancelamento"
              />
            </div>
          </template>
        </section>
      </template>
    </section>

    <SanteDialogo v-model:visivel="pedindo" :titulo="t('portalPrestador.pedidos.novo')" largura="60rem">
      <FormAutorizacao
        v-if="pedindo && apoioPortal"
        :apoio="null"
        :principal="null"
        :portal="apoioPortal"
        :registrar="solicitarPortalPrestador"
        :buscar-tuss="procedimentosPortalPrestador"
        @gravado="gravado"
        @cancelar="pedindo = false"
      />
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="cancelando"
      :titulo="t('portalPrestador.pedidos.cancelar')"
      largura="36rem"
    >
      <form class="formulario" data-testid="pp-dialogo-cancelar" @submit.prevent="cancelar">
        <SanteCampoTexto
          id="pp-motivo"
          v-model="motivo"
          :rotulo="t('portalPrestador.pedidos.motivo')"
          :max-bytes="200"
          multilinha
          obrigatorio
        />
        <div v-if="recusa" role="alert"><SanteAlerta :texto="recusa" variante="alerta" /></div>
        <MensagemErro v-if="erro" :erro="erro" />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('portalPrestador.pedidos.confirmar')"
            :desabilitado="motivo.trim().length < 10"
            data-testid="pp-confirmar-cancelar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('portalPrestador.pedidos.voltar')"
            @acionar="cancelando = false"
          />
        </div>
      </form>
    </SanteDialogo>
  </PortalPrestadorCasca>
</template>

<style scoped src="../../operadora/estilo-operadora.css"></style>
<style scoped>
.conteudo {
  display: grid;
  gap: 1rem;
}
.formulario {
  display: grid;
  gap: 0.75rem;
}
.complemento {
  display: grid;
  gap: 0.5rem;
}
.complemento h3,
.complemento h4,
.complemento p {
  margin: 0;
}
.respostas {
  margin: 0;
  padding-left: 1.25rem;
}
</style>
