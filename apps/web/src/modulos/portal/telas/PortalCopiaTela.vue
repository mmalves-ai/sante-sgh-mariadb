<script setup lang="ts">
// Portal do paciente: cópia do prontuário (W0-10, M2; LGPD art. 18 II e 19 II, CFM 1.821/2007). O titular, ou o
// representante com vínculo vigente e escopo de documentos, pede a cópia (o pedido de acesso, protocolo e prazo de 15
// dias); o portal mostra a etapa (conferência de quem pede, preparo, entrega) e, quando a entrega é pelo portal, o PDF
// com marca d'água para baixar (o download vai à trilha). O pedido protocolado não se altera: o envio pede confirmação
// e o cancelamento com motivo fica na tela de privacidade.
import type { SessaoContaPortal } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPortal from '../componentes/ErroPortal.vue';
import PortalCasca from '../componentes/PortalCasca.vue';
import { copiasPortal, enderecoPdfCopia, pedirCopiaPortal } from '../api-portal-paciente.js';

const { t } = useI18n();
const sessao = ref<SessaoContaPortal | null>(null);
const versao = ref(0);
const pode = computed(() => sessao.value?.ativo.escopos.includes('documentos') ?? false);
const lista = useQuery({
  queryKey: computed(() => ['portal-paciente', 'copias', versao.value, sessao.value?.ativo.vinculo ?? '']),
  queryFn: () => copiasPortal(),
  enabled: pode,
  // O hospital muda o pedido fora desta tela (conferência, entrega, resposta): sempre velha, para ler de novo ao voltar
  // (a chave com `versao` volta a 0 a cada montagem e acharia a lista antiga no cache, ainda dentro do staleTime).
  staleTime: 0,
});
const observacao = ref('');
const conferindo = ref(false);
const feito = ref<{ protocolo: string; prazo: string } | null>(null);
const erro = ref<unknown>(null);
const dia = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');

async function pedir(): Promise<void> {
  erro.value = null;
  feito.value = null;
  try {
    feito.value = await pedirCopiaPortal({ observacao: observacao.value.trim() || null });
    observacao.value = '';
    conferindo.value = false;
    versao.value++;
  } catch (x) {
    erro.value = x;
    conferindo.value = false;
  }
}
function trocou(s: SessaoContaPortal): void {
  sessao.value = s;
  feito.value = null;
  versao.value++;
}
</script>

<template>
  <PortalCasca :titulo="t('portal.copia.titulo')" @sessao="(s) => (sessao = s)" @trocou="trocou">
    <ErroPortal v-if="erro" :erro="erro" />
    <section class="portal-painel" aria-labelledby="pac-copia" data-testid="portal-copia">
      <h2 id="pac-copia">{{ t('portal.copia.minhas') }}</h2>
      <p>{{ t('portal.copia.ajuda') }}</p>
      <p v-if="!pode" data-testid="pac-copia-sem-escopo">{{ t('portal.copia.semEscopo') }}</p>
      <template v-else>
        <ErroPortal v-if="lista.isError.value" :erro="lista.error.value" />
        <p v-else-if="!lista.data.value?.length">{{ t('portal.nenhum') }}</p>
        <table v-else class="portal-tabela" data-testid="pac-copias-tabela">
          <caption>
            {{
              t('portal.copia.minhas')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('portal.copia.protocolo') }}</th>
              <th scope="col">{{ t('portal.copia.abertoEm') }}</th>
              <th scope="col">{{ t('portal.copia.prazo') }}</th>
              <th scope="col">{{ t('portal.copia.etapa') }}</th>
              <th scope="col">{{ t('portal.copia.entrega') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in lista.data.value" :key="c.protocolo" :data-testid="`pac-copia-${c.protocolo}`">
              <td>{{ c.protocolo }}</td>
              <td>{{ dia(c.abertoEm) }}</td>
              <td>
                {{ dia(c.prazo) }}
                <strong v-if="c.atrasado"> · {{ t('portal.copia.atrasado') }}</strong>
              </td>
              <td>
                {{
                  c.situacao === 'cancelado' || c.situacao === 'negado'
                    ? t(`portal.privacidade.situacoes.${c.situacao}`)
                    : t(`portal.copia.etapas.${c.etapa}`)
                }}
              </td>
              <td>
                <template v-if="c.entregueEm">
                  {{ dia(c.entregueEm)
                  }}<template v-if="c.meio"> · {{ t(`portal.copia.meios.${c.meio}`) }}</template>
                </template>
                <a
                  v-if="c.baixavel"
                  :href="enderecoPdfCopia(c.protocolo)"
                  download
                  :data-testid="`pac-copia-baixar-${c.protocolo}`"
                  >{{ t('portal.copia.baixar') }}</a
                >
              </td>
            </tr>
          </tbody>
        </table>
        <form class="portal-painel" data-testid="pac-nova-copia" @submit.prevent>
          <h3>{{ t('portal.copia.nova') }}</h3>
          <SanteCampoTexto
            v-model="observacao"
            :rotulo="t('portal.copia.observacao')"
            :max-bytes="500"
            multilinha
            data-testid="pac-copia-observacao"
          />
          <SanteBotao
            v-if="!conferindo"
            :rotulo="t('portal.copia.revisar')"
            data-testid="pac-copia-revisar"
            @acionar="conferindo = true"
          />
          <div v-else class="portal-painel" role="group" data-testid="pac-copia-confirmacao">
            <p data-testid="pac-copia-pergunta">{{ t('portal.copia.confirma') }}</p>
            <p v-if="observacao.trim()" class="portal-relato">{{ observacao.trim() }}</p>
            <SanteBotao
              :rotulo="t('portal.copia.confirmar')"
              data-testid="pac-copia-pedir"
              @acionar="pedir"
            />
            <SanteBotao variante="texto" :rotulo="t('portal.voltar')" @acionar="conferindo = false" />
          </div>
          <SanteAlerta
            v-if="feito"
            :texto="t('portal.copia.feito', { protocolo: feito.protocolo, prazo: dia(feito.prazo) })"
            variante="info"
            anunciar
            data-testid="pac-copia-feito"
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
