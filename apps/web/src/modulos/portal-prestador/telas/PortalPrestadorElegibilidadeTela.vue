<script setup lang="ts">
// Portal do prestador credenciado, W0-10 (M7): a elegibilidade do beneficiário pela carteirinha antes do atendimento:
// situação e vigência, validade da carteirinha, carências e cobertura pela segmentação do plano. Cada consulta é
// registrada pelo servidor (o número aparece no resultado) e as últimas ficam na lista abaixo. O servidor confere a
// sessão, o CSRF e a função liberada; o beneficiário de outra operadora aparece como não encontrado.
import {
  ABRANGENCIAS_PRODUTO,
  ACOMODACOES_PLANO_OPERADORA,
  type ConsultaElegibilidadePortal,
  type ElegibilidadePortal,
  ROTULOS_ATENDIMENTO_COBERTURA,
  SEGMENTACOES_PRODUTO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  consultarElegibilidadePortalPrestador,
  consultasElegibilidadePortalPrestador,
} from '../api-portal-prestador.js';
import PortalPrestadorCasca from '../componentes/PortalPrestadorCasca.vue';

const { t } = useI18n();
const carteirinha = ref('');
const data = ref('');
const r = ref<ElegibilidadePortal | null>(null);
const ultimas = ref<ConsultaElegibilidadePortal[]>([]);
const erro = ref<unknown>(null);
const ocupado = ref(false);

const podeConsultar = computed(() => carteirinha.value.replace(/\D/g, '').length > 0 && !ocupado.value);
const dataBr = (d: string) =>
  /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d;
const quando = (d: string) => `${dataBr(d)} ${d.slice(11, 16)}`;
const segmentacao = (s: string | null) =>
  s ? ((SEGMENTACOES_PRODUTO as Record<string, string>)[s] ?? s) : '';
const abrangencia = (s: string | null) =>
  s ? ((ABRANGENCIAS_PRODUTO as Record<string, string>)[s] ?? s) : '';
const acomodacao = (a: number | null) =>
  a ? ((ACOMODACOES_PLANO_OPERADORA as Record<number, string>)[a] ?? '') : '';

async function carregarUltimas(): Promise<void> {
  ultimas.value = (await consultasElegibilidadePortalPrestador().catch(() => ({ itens: [] }))).itens;
}

async function consultar(): Promise<void> {
  if (!podeConsultar.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    r.value = await consultarElegibilidadePortalPrestador({
      carteirinha: carteirinha.value,
      ...(data.value ? { data: data.value } : {}),
    });
    await carregarUltimas();
  } catch (x) {
    erro.value = x;
    r.value = null;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <PortalPrestadorCasca :titulo="t('portalPrestador.elegibilidade.titulo')" @sessao="carregarUltimas">
    <div class="elegibilidade" data-testid="pp-elegibilidade">
      <p class="secundario">{{ t('portalPrestador.elegibilidade.texto') }}</p>
      <form class="painel" data-testid="pp-eleg-form" @submit.prevent="consultar">
        <label class="campo">
          <span>{{ t('portalPrestador.elegibilidade.carteirinha') }}</span>
          <input
            v-model="carteirinha"
            inputmode="numeric"
            maxlength="30"
            autocomplete="off"
            data-testid="pp-eleg-carteirinha"
          />
        </label>
        <label class="campo">
          <span>{{ t('portalPrestador.elegibilidade.data') }}</span>
          <input v-model="data" type="date" data-testid="pp-eleg-data" />
        </label>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('portalPrestador.elegibilidade.consultar')"
            :desabilitado="!podeConsultar"
            data-testid="pp-eleg-consultar"
            @acionar="consultar"
          />
        </div>
      </form>
      <MensagemErro v-if="erro" :erro="erro" />

      <section
        v-if="r"
        class="painel"
        data-testid="pp-eleg-resultado"
        :data-elegivel="r.elegivel"
        aria-live="polite"
      >
        <SanteAlerta
          :texto="
            r.elegivel
              ? t('portalPrestador.elegibilidade.elegivel', { data: dataBr(r.data) })
              : t('portalPrestador.elegibilidade.inelegivel', { data: dataBr(r.data) })
          "
          :variante="r.elegivel ? 'info' : 'alerta'"
          anunciar
        />
        <ul v-if="r.motivos.length" data-testid="pp-eleg-motivos">
          <li v-for="m in r.motivos" :key="m">{{ t(`operadora.f1.motivos.${m}`) }}</li>
        </ul>
        <p v-if="r.beneficiario">
          <strong>{{ t('portalPrestador.elegibilidade.beneficiario') }}:</strong> {{ r.beneficiario.nome }}
        </p>
        <p v-if="r.plano" data-testid="pp-eleg-plano">
          <strong>{{ t('portalPrestador.elegibilidade.plano') }}:</strong> {{ r.plano.nome
          }}<template v-if="r.plano.registroAns"> · {{ r.plano.registroAns }}</template>
          <template v-if="r.plano.segmentacao"> · {{ segmentacao(r.plano.segmentacao) }}</template>
          <template v-if="r.plano.abrangencia"> · {{ abrangencia(r.plano.abrangencia) }}</template>
          <template v-if="r.plano.acomodacao"> · {{ acomodacao(r.plano.acomodacao) }}</template>
        </p>
        <p v-if="r.beneficiario" data-testid="pp-eleg-validade">
          {{
            r.validadeCarteirinha === null
              ? t('portalPrestador.elegibilidade.semVia')
              : r.carteirinhaVencida
                ? t('portalPrestador.elegibilidade.vencida', { data: dataBr(r.validadeCarteirinha) })
                : t('portalPrestador.elegibilidade.validade', { data: dataBr(r.validadeCarteirinha) })
          }}
        </p>
        <template v-if="r.plano">
          <h2 class="subtitulo">{{ t('portalPrestador.elegibilidade.carencias') }}</h2>
          <ul v-if="r.carencias.length" data-testid="pp-eleg-carencias">
            <li v-for="c in r.carencias" :key="c.tipo" :data-cumprida="c.cumprida">
              {{ t(`operadora.f1.carencias.${c.tipo}`) }}:
              {{
                c.cumprida
                  ? t('portalPrestador.elegibilidade.cumprida', { data: dataBr(c.cumpridaEm) })
                  : t('portalPrestador.elegibilidade.emCurso', { data: dataBr(c.cumpridaEm) })
              }}
            </li>
          </ul>
          <p v-else>{{ t('portalPrestador.elegibilidade.semCarencia') }}</p>
        </template>
        <template v-if="r.cobertura.length">
          <h2 class="subtitulo">{{ t('portalPrestador.elegibilidade.cobertura') }}</h2>
          <ul data-testid="pp-eleg-cobertura">
            <li v-for="c in r.cobertura" :key="c.atendimento" :data-cobertura="c.cobertura">
              {{ ROTULOS_ATENDIMENTO_COBERTURA[c.atendimento] }}:
              {{ t(`portalPrestador.elegibilidade.coberturas.${c.cobertura}`) }}
            </li>
          </ul>
        </template>
        <p v-if="r.registro !== null" class="secundario" data-testid="pp-eleg-registro">
          {{ t('portalPrestador.elegibilidade.registro', { n: r.registro }) }}
        </p>
      </section>

      <section class="painel" aria-labelledby="pp-eleg-ultimas" data-testid="pp-eleg-ultimas">
        <h2 id="pp-eleg-ultimas" class="subtitulo">{{ t('portalPrestador.elegibilidade.ultimas') }}</h2>
        <p v-if="!ultimas.length" class="secundario">{{ t('portalPrestador.elegibilidade.nenhuma') }}</p>
        <table v-else>
          <thead>
            <tr>
              <th scope="col">{{ t('portalPrestador.elegibilidade.colunas.em') }}</th>
              <th scope="col">{{ t('portalPrestador.elegibilidade.colunas.carteirinha') }}</th>
              <th scope="col">{{ t('portalPrestador.elegibilidade.colunas.data') }}</th>
              <th scope="col">{{ t('portalPrestador.elegibilidade.colunas.resultado') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in ultimas" :key="u.id" :data-testid="`pp-eleg-linha-${u.id}`">
              <td>{{ quando(u.em) }}</td>
              <td>{{ u.carteirinha }}</td>
              <td>{{ dataBr(u.data) }}</td>
              <td>
                {{
                  u.elegivel ? t('portalPrestador.elegibilidade.sim') : t('portalPrestador.elegibilidade.nao')
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </PortalPrestadorCasca>
</template>

<style scoped>
.elegibilidade {
  display: grid;
  gap: var(--sgh-espaco-3);
  max-width: 48rem;
}
.painel {
  display: grid;
  gap: var(--sgh-espaco-2);
  padding: var(--sgh-espaco-3);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio, 6px);
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.campo input {
  min-height: 2.25rem;
  padding: 0.25rem 0.5rem;
  font: inherit;
}
.subtitulo {
  font-size: 1rem;
  margin: 0;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid var(--sgh-borda);
}
.secundario {
  color: var(--p-text-muted-color);
  font-size: 0.9em;
  overflow-wrap: anywhere;
}
</style>
