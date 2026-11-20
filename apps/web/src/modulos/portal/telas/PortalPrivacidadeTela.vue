<script setup lang="ts">
// Portal do paciente: privacidade (M50, etapa 1; ficha, regra 5; LGPD art. 18; SBIS-24). Os pedidos do titular
// (confirmação, acesso, correção, anonimização, eliminação, portabilidade, compartilhamento, revogação) com o protocolo e
// o prazo de 15 dias; a resposta da área de privacidade. E o relatório de quem acessou o próprio prontuário: por dia,
// pessoa e o que fez (sem estação, tela, termo de busca ou motivo), no período escolhido.
import {
  MOTIVOS_CANCELAMENTO_PEDIDO_PORTAL,
  type MotivoCancelamentoPedidoPortal,
  type SessaoContaPortal,
  TIPOS_PEDIDO_PORTAL,
  type TipoPedidoPortal,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPortal from '../componentes/ErroPortal.vue';
import {
  acessosPortal,
  cancelarPedidoPortal,
  enderecoPacoteIps,
  pedidosPortal,
  registrarPedidoPortal,
} from '../api-portal-paciente.js';
import PortalCasca from '../componentes/PortalCasca.vue';

const { t } = useI18n();
const sessao = ref<SessaoContaPortal | null>(null);
const versao = ref(0);
const podePedir = computed(() => sessao.value?.ativo.escopos.includes('pedidos') ?? false);
const podeVerAcessos = computed(() => sessao.value?.ativo.escopos.includes('documentos') ?? false);
const pedidos = useQuery({
  queryKey: computed(() => ['portal-paciente', 'pedidos', versao.value, sessao.value?.ativo.vinculo ?? '']),
  queryFn: () => pedidosPortal(),
  enabled: podePedir,
  // O hospital muda o pedido fora desta tela (conferência, entrega, resposta): sempre velha, para ler de novo ao voltar
  // (a chave com `versao` volta a 0 a cada montagem e acharia a lista antiga no cache, ainda dentro do staleTime).
  staleTime: 0,
});
const tipo = ref<TipoPedidoPortal>('acesso');
const descricao = ref('');
const enviado = ref<{ protocolo: string; prazo: string } | null>(null);
const erro = ref<unknown>(null);
const opcoesTipo = computed(() =>
  TIPOS_PEDIDO_PORTAL.map((v) => ({ valor: v, rotulo: t(`portal.privacidade.tipos.${v}`) })),
);
const dia = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');

async function pedir(): Promise<void> {
  erro.value = null;
  enviado.value = null;
  try {
    enviado.value = await registrarPedidoPortal({
      tipo: tipo.value,
      descricao: descricao.value.trim() || null,
    });
    descricao.value = '';
    versao.value++;
  } catch (x) {
    erro.value = x;
  }
}

// W0-10: cancelar com motivo o pedido não respondido (o protocolado não se edita; a confirmação mostra o protocolo).
const cancelando = ref<string | null>(null);
const motivoCancelar = ref<MotivoCancelamentoPedidoPortal | null>(null);
const obsCancelar = ref('');
const cancelado = ref<string | null>(null);
const opcoesMotivoCancelar = computed(() =>
  MOTIVOS_CANCELAMENTO_PEDIDO_PORTAL.map((v) => ({
    valor: v,
    rotulo: t(`portal.privacidade.motivosCancelar.${v}`),
  })),
);
function abrirCancelar(protocolo: string): void {
  cancelando.value = protocolo;
  motivoCancelar.value = null;
  obsCancelar.value = '';
  cancelado.value = null;
}
async function cancelarPedido(): Promise<void> {
  if (!cancelando.value || !motivoCancelar.value) return;
  erro.value = null;
  try {
    await cancelarPedidoPortal(cancelando.value, {
      motivo: motivoCancelar.value,
      observacao: obsCancelar.value.trim() || null,
    });
    cancelado.value = cancelando.value;
    cancelando.value = null;
    versao.value++;
  } catch (x) {
    erro.value = x;
  }
}

// Relatório de acessos (padrão: os últimos 30 dias)
const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const de = ref(new Date(Date.parse(`${hoje}T12:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10));
const ate = ref(hoje);
const consulta = ref<{ de: string; ate: string; n: number } | null>(null);
const acessos = useQuery({
  queryKey: computed(() => ['portal-paciente', 'acessos', consulta.value, sessao.value?.ativo.vinculo ?? '']),
  queryFn: () => acessosPortal(consulta.value!.de, consulta.value!.ate),
  enabled: computed(() => consulta.value !== null && podeVerAcessos.value),
});
function consultar(): void {
  consulta.value = { de: de.value, ate: ate.value, n: (consulta.value?.n ?? 0) + 1 };
}
function trocou(s: SessaoContaPortal): void {
  sessao.value = s;
  consulta.value = null;
  versao.value++;
}
</script>

<template>
  <PortalCasca :titulo="t('portal.privacidade.titulo')" @sessao="(s) => (sessao = s)" @trocou="trocou">
    <ErroPortal v-if="erro" :erro="erro" />
    <section class="portal-painel" aria-labelledby="pac-pedidos" data-testid="portal-pedidos">
      <h2 id="pac-pedidos">{{ t('portal.privacidade.pedidos') }}</h2>
      <p v-if="!podePedir">{{ t('portal.privacidade.semEscopo') }}</p>
      <template v-else>
        <p v-if="!pedidos.data.value?.length">{{ t('portal.nenhum') }}</p>
        <table v-else class="portal-tabela">
          <caption>
            {{
              t('portal.privacidade.pedidos')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('portal.privacidade.protocolo') }}</th>
              <th scope="col">{{ t('portal.privacidade.tipo') }}</th>
              <th scope="col">{{ t('portal.privacidade.situacao') }}</th>
              <th scope="col">{{ t('portal.privacidade.prazo') }}</th>
              <th scope="col">{{ t('portal.privacidade.resposta') }}</th>
              <th scope="col">{{ t('portal.privacidade.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in pedidos.data.value" :key="p.protocolo">
              <td>{{ p.protocolo }}</td>
              <td>{{ t(`portal.privacidade.tipos.${p.tipo}`) }}</td>
              <td>
                {{ t(`portal.privacidade.situacoes.${p.situacao}`) }}
                <strong v-if="p.atrasado"> · {{ t('portal.privacidade.atrasado') }}</strong>
              </td>
              <td>{{ dia(p.prazo) }}</td>
              <td>
                {{
                  p.motivoCancelamento
                    ? t(`portal.privacidade.motivosCancelar.${p.motivoCancelamento}`)
                    : (p.resposta ?? '—')
                }}
              </td>
              <td>
                <SanteBotao
                  v-if="p.cancelavel"
                  variante="texto"
                  :rotulo="t('portal.privacidade.cancelar')"
                  :data-testid="`pac-cancelar-pedido-${p.protocolo}`"
                  @acionar="abrirCancelar(p.protocolo)"
                />
                <a
                  v-if="p.pacoteIps"
                  :href="enderecoPacoteIps(p.protocolo)"
                  download
                  :title="t('portal.privacidade.baixarIpsAjuda')"
                  :data-testid="`pac-baixar-ips-${p.protocolo}`"
                  >{{ t('portal.privacidade.baixarIps') }}</a
                >
              </td>
            </tr>
          </tbody>
        </table>
        <form v-if="cancelando" class="portal-painel" data-testid="pac-cancelar-pedido" @submit.prevent>
          <h3>{{ t('portal.privacidade.cancelarTitulo', { protocolo: cancelando }) }}</h3>
          <p>{{ t('portal.privacidade.cancelarAjuda') }}</p>
          <SanteSelecao
            v-model="motivoCancelar"
            :rotulo="t('portal.privacidade.motivoCancelar')"
            :opcoes="opcoesMotivoCancelar"
            :busca="true"
            data-testid="pac-motivo-cancelar"
          />
          <SanteCampoTexto
            v-model="obsCancelar"
            :rotulo="t('portal.privacidade.obsCancelar')"
            :max-bytes="500"
            multilinha
          />
          <SanteBotao
            variante="destrutivo"
            :rotulo="t('portal.privacidade.cancelar')"
            :confirmacao="t('portal.privacidade.cancelarConfirma', { protocolo: cancelando })"
            :desabilitado="!motivoCancelar"
            data-testid="pac-cancelar-enviar"
            @acionar="cancelarPedido"
          />
          <SanteBotao variante="texto" :rotulo="t('portal.voltar')" @acionar="cancelando = null" />
        </form>
        <SanteAlerta
          v-if="cancelado"
          :texto="t('portal.privacidade.cancelado', { protocolo: cancelado })"
          variante="info"
          anunciar
          data-testid="pac-pedido-cancelado"
        />
        <form class="portal-painel" data-testid="pac-novo-pedido" @submit.prevent="pedir">
          <h3>{{ t('portal.privacidade.novoPedido') }}</h3>
          <SanteSelecao
            v-model="tipo"
            :rotulo="t('portal.privacidade.tipo')"
            :opcoes="opcoesTipo"
            :busca="true"
            data-testid="pac-tipo-pedido"
          />
          <SanteAlerta
            v-if="tipo === 'eliminacao'"
            :texto="t('portal.privacidade.eliminacaoAviso')"
            variante="info"
          />
          <SanteCampoTexto
            v-model="descricao"
            :rotulo="t('portal.privacidade.descricao')"
            :max-bytes="1000"
            multilinha
          />
          <SanteBotao
            tipo="submit"
            :rotulo="t('portal.privacidade.novoPedido')"
            data-testid="pac-pedir-titular"
            @acionar="pedir"
          />
          <SanteAlerta
            v-if="enviado"
            :texto="
              t('portal.privacidade.enviado', { protocolo: enviado.protocolo, prazo: dia(enviado.prazo) })
            "
            variante="info"
            anunciar
            data-testid="pac-pedido-registrado"
          />
        </form>
      </template>
    </section>
    <section class="portal-painel" aria-labelledby="pac-acessos" data-testid="portal-acessos">
      <h2 id="pac-acessos">{{ t('portal.privacidade.acessos') }}</h2>
      <p>{{ t('portal.privacidade.acessosAjuda') }}</p>
      <p v-if="!podeVerAcessos">{{ t('portal.privacidade.semEscopo') }}</p>
      <form v-else class="portal-acessos-filtro" @submit.prevent="consultar">
        <span class="portal-campo">
          <label for="pac-de">{{ t('portal.privacidade.de') }}</label>
          <input id="pac-de" v-model="de" type="date" data-testid="pac-acessos-de" />
        </span>
        <span class="portal-campo">
          <label for="pac-ate">{{ t('portal.privacidade.ate') }}</label>
          <input id="pac-ate" v-model="ate" type="date" data-testid="pac-acessos-ate" />
        </span>
        <SanteBotao
          tipo="submit"
          variante="secundario"
          :rotulo="t('portal.privacidade.consultar')"
          data-testid="pac-acessos-consultar"
          @acionar="consultar"
        />
      </form>
      <ErroPortal v-if="acessos.isError.value" :erro="acessos.error.value" />
      <template v-else-if="acessos.data.value">
        <p v-if="acessos.data.value.itens.length === 0">{{ t('portal.nenhum') }}</p>
        <table v-else class="portal-tabela" data-testid="pac-acessos-tabela">
          <caption>
            {{
              t('portal.privacidade.acessos')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('portal.privacidade.dia') }}</th>
              <th scope="col">{{ t('portal.privacidade.quem') }}</th>
              <th scope="col">{{ t('portal.privacidade.oQue') }}</th>
              <th scope="col">{{ t('portal.privacidade.vezesColuna') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(a, k) in acessos.data.value.itens" :key="k">
              <td>{{ dia(a.dia) }}</td>
              <td>
                {{ a.quem }}<span v-if="a.funcao" class="portal-secundario"> · {{ a.funcao }}</span>
              </td>
              <td>{{ t(`portal.privacidade.naturezas.${a.natureza}`) }}</td>
              <td>{{ t('portal.privacidade.vezes', { n: a.vezes }, a.vezes) }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>
  </PortalCasca>
</template>

<style scoped>
.portal-acessos-filtro {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: flex-end;
}
</style>
