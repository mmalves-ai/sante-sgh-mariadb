<script setup lang="ts">
// Portal do paciente: ouvidoria (W0-10, M1). A manifestação (elogio, reclamação, sugestão, solicitação ou pedido de
// informação) vai à ouvidoria interna do hospital com o canal "portal" e o paciente da sessão; o portal mostra o
// protocolo, o prazo da resposta (dias úteis do calendário do estabelecimento), a situação e a resposta da ouvidoria.
// A manifestação protocolada não se altera: o envio pede confirmação.
import { type SessaoContaPortal, TIPOS_MANIFESTACAO_PORTAL } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPortal from '../componentes/ErroPortal.vue';
import PortalCasca from '../componentes/PortalCasca.vue';
import { manifestacoesPortal, registrarManifestacaoPortal } from '../api-portal-paciente.js';

type TipoManifestacaoPortal = (typeof TIPOS_MANIFESTACAO_PORTAL)[number];

const { t } = useI18n();
const sessao = ref<SessaoContaPortal | null>(null);
const versao = ref(0);
const pode = computed(() => sessao.value?.ativo.escopos.includes('pedidos') ?? false);
const lista = useQuery({
  queryKey: computed(() => ['portal-paciente', 'ouvidoria', versao.value, sessao.value?.ativo.vinculo ?? '']),
  queryFn: () => manifestacoesPortal(),
  enabled: pode,
  // O hospital muda o pedido fora desta tela (conferência, entrega, resposta): sempre velha, para ler de novo ao voltar
  // (a chave com `versao` volta a 0 a cada montagem e acharia a lista antiga no cache, ainda dentro do staleTime).
  staleTime: 0,
});
const tipo = ref<TipoManifestacaoPortal | null>(null);
const area = ref('');
const relato = ref('');
const enviada = ref<{ protocolo: string; prazoEm: string } | null>(null);
const erro = ref<unknown>(null);
const opcoesTipo = computed(() =>
  TIPOS_MANIFESTACAO_PORTAL.map((v) => ({ valor: v, rotulo: t(`portal.ouvidoria.tipos.${v}`) })),
);
const conferindo = ref(false);
const pronta = computed(() => tipo.value !== null && relato.value.trim().length >= 10);
const dia = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');

async function enviar(): Promise<void> {
  if (!pronta.value || !tipo.value) return;
  erro.value = null;
  enviada.value = null;
  try {
    enviada.value = await registrarManifestacaoPortal({
      tipo: tipo.value,
      area: area.value.trim() || null,
      relato: relato.value.trim(),
    });
    tipo.value = null;
    area.value = '';
    relato.value = '';
    conferindo.value = false;
    versao.value++;
  } catch (x) {
    erro.value = x;
  }
}
function trocou(s: SessaoContaPortal): void {
  sessao.value = s;
  enviada.value = null;
  versao.value++;
}
</script>

<template>
  <PortalCasca :titulo="t('portal.ouvidoria.titulo')" @sessao="(s) => (sessao = s)" @trocou="trocou">
    <ErroPortal v-if="erro" :erro="erro" />
    <section class="portal-painel" aria-labelledby="pac-ouvidoria" data-testid="portal-ouvidoria">
      <h2 id="pac-ouvidoria">{{ t('portal.ouvidoria.minhas') }}</h2>
      <p>{{ t('portal.ouvidoria.ajuda') }}</p>
      <p v-if="!pode">{{ t('portal.ouvidoria.semEscopo') }}</p>
      <template v-else>
        <ErroPortal v-if="lista.isError.value" :erro="lista.error.value" />
        <p v-else-if="!lista.data.value?.length">{{ t('portal.nenhum') }}</p>
        <table v-else class="portal-tabela" data-testid="pac-ouvidoria-tabela">
          <caption>
            {{
              t('portal.ouvidoria.minhas')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('portal.ouvidoria.protocolo') }}</th>
              <th scope="col">{{ t('portal.ouvidoria.tipo') }}</th>
              <th scope="col">{{ t('portal.ouvidoria.recebidaEm') }}</th>
              <th scope="col">{{ t('portal.ouvidoria.prazo') }}</th>
              <th scope="col">{{ t('portal.ouvidoria.situacao') }}</th>
              <th scope="col">{{ t('portal.ouvidoria.resposta') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in lista.data.value"
              :key="m.protocolo"
              :data-testid="`pac-manifestacao-${m.protocolo}`"
            >
              <td>{{ m.protocolo }}</td>
              <td>{{ t(`portal.ouvidoria.tipos.${m.tipo}`) }}</td>
              <td>{{ dia(m.recebidaEm) }}</td>
              <td>{{ dia(m.prazoEm) }}</td>
              <td>{{ t(`portal.ouvidoria.situacoes.${m.situacao}`) }}</td>
              <td>{{ m.resposta ?? t('portal.ouvidoria.semResposta') }}</td>
            </tr>
          </tbody>
        </table>
        <form class="portal-painel" data-testid="pac-nova-manifestacao" @submit.prevent>
          <h3>{{ t('portal.ouvidoria.nova') }}</h3>
          <SanteSelecao
            v-model="tipo"
            :rotulo="t('portal.ouvidoria.tipo')"
            :opcoes="opcoesTipo"
            :busca="true"
            data-testid="pac-tipo-manifestacao"
          />
          <SanteCampoTexto v-model="area" :rotulo="t('portal.ouvidoria.area')" :max-bytes="80" />
          <SanteCampoTexto
            v-model="relato"
            :rotulo="t('portal.ouvidoria.relato')"
            :max-bytes="4000"
            multilinha
            data-testid="pac-relato-manifestacao"
          />
          <SanteBotao
            v-if="!conferindo"
            :rotulo="t('portal.ouvidoria.revisar')"
            :desabilitado="!pronta"
            data-testid="pac-revisar-manifestacao"
            @acionar="conferindo = true"
          />
          <div v-else class="portal-painel" role="group" data-testid="pac-confirmar-manifestacao">
            <p data-testid="pac-pergunta-manifestacao">{{ t('portal.ouvidoria.confirma') }}</p>
            <p>
              <strong>{{ tipo ? t(`portal.ouvidoria.tipos.${tipo}`) : '' }}</strong>
              <span v-if="area.trim()"> · {{ area.trim() }}</span>
            </p>
            <p class="portal-relato">{{ relato.trim() }}</p>
            <SanteBotao
              :rotulo="t('portal.ouvidoria.enviar')"
              data-testid="pac-enviar-manifestacao"
              @acionar="enviar"
            />
            <SanteBotao variante="texto" :rotulo="t('portal.voltar')" @acionar="conferindo = false" />
          </div>
          <SanteAlerta
            v-if="enviada"
            :texto="
              t('portal.ouvidoria.enviada', { protocolo: enviada.protocolo, prazo: dia(enviada.prazoEm) })
            "
            variante="info"
            anunciar
            data-testid="pac-manifestacao-enviada"
          />
        </form>
      </template>
    </section>
  </PortalCasca>
</template>

<style scoped>
.portal-relato {
  white-space: pre-wrap;
}
</style>
