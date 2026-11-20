<script setup lang="ts">
// Remessa e lotes TISS (ficha do M31, seção 7): `/faturamento/lotes`. A montagem por operadora e tipo de guia, sempre na
// TISS 04.03.00 (DP-47.7): as contas emitidas, fechadas e fora de lote do convênio; o servidor numera pelo contador,
// valida o XML no XSD oficial (o erro vem explicado) e guarda o arquivo com hash. A lista dos lotes pelo ID (o número se
// repete entre convênios), com a situação (inferida nos lotes anteriores ao novo) e o protocolo.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { contasProntas, gerarLote, listarLotes, novaChave } from '../api-tiss.js';
import { data, opcoesConvenio, quando, reais, usarTiss } from '../usar-tiss.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivo, motivoFuncionalidade } = usarTiss('lote');
const convenio = ref('');
const tipoGuia = ref('2');
const competencia = ref('');
const pedido = ref<{ convenio: string; tipoGuia: string; competencia: string } | null>(null);
const marcadas = ref<number[]>([]);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const avisos = ref<readonly string[]>([]);
const gravando = ref(false);
const filtroLotes = ref({ convenio: '', semProtocolo: '' });
const pagina = ref(0);

const convenios = computed(() => opcoesConvenio(apoio.data.value?.convenios));
const tipos = computed(() =>
  (apoio.data.value?.tiposGuia ?? []).map((x) => ({ valor: String(x.id), rotulo: x.nome })),
);
const prontas = useQuery({
  queryKey: computed(() => ['tiss', 'prontas', pedido.value]),
  queryFn: () => contasProntas(pedido.value!),
  enabled: computed(() => pedido.value !== null),
});
const lotes = useQuery({
  queryKey: computed(() => ['tiss', 'lotes', filtroLotes.value, pagina.value]),
  queryFn: () => listarLotes({ ...filtroLotes.value, pagina: pagina.value }),
});
function buscarContas() {
  if (!convenio.value) return;
  marcadas.value = [];
  pedido.value = { convenio: convenio.value, tipoGuia: tipoGuia.value, competencia: competencia.value };
}
function alternar(id: number) {
  marcadas.value = marcadas.value.includes(id)
    ? marcadas.value.filter((x) => x !== id)
    : [...marcadas.value, id];
}
function todas() {
  const ids = (prontas.data.value ?? []).slice(0, 100).map((c) => c.conta);
  marcadas.value = marcadas.value.length === ids.length ? [] : ids;
}
async function montar() {
  if (!pedido.value || marcadas.value.length === 0) return;
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const contas = (prontas.data.value ?? [])
      .filter((c) => marcadas.value.includes(c.conta))
      .map((c) => ({ id: c.conta, versao: c.versao }));
    const r = await gerarLote(
      { convenio: Number(pedido.value.convenio), tipoGuia: Number(pedido.value.tipoGuia), contas },
      novaChave('lote'),
    );
    mensagem.value = r.mensagem;
    avisos.value = r.avisos;
    marcadas.value = [];
    await qc.invalidateQueries({ queryKey: ['tiss'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="lot-titulo" data-testid="tela-tiss-lotes">
    <h1 id="lot-titulo">{{ t('tiss.lotes.titulo') }}</h1>
    <p>{{ t('tiss.lotes.texto', { versao: apoio.data.value?.versao ?? '04.03.00' }) }}</p>
    <p>
      <RouterLink to="/faturamento/prazos" data-testid="lot-prazos">{{
        t('tiss.lotes.verPrazos')
      }}</RouterLink>
    </p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('lote')" />

    <h2>{{ t('tiss.lotes.montar') }}</h2>
    <form class="filtros" @submit.prevent="buscarContas">
      <span class="campo">
        <SanteSelecao
          v-model="convenio"
          :rotulo="t('tiss.convenio')"
          :opcoes="convenios"
          data-testid="lot-convenio"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="tipoGuia"
          :rotulo="t('tiss.tipoGuia')"
          :opcoes="tipos"
          data-testid="lot-tipo-guia"
        />
      </span>
      <span class="campo">
        <label for="lot-competencia">{{ t('tiss.competencia') }}</label>
        <input id="lot-competencia" v-model="competencia" type="month" data-testid="lot-competencia" />
      </span>
      <button type="submit" :disabled="!convenio" data-testid="lot-buscar">
        {{ t('tiss.lotes.buscarContas') }}
      </button>
    </form>
    <ErroFaturamento v-if="prontas.error.value" :erro="prontas.error.value" />
    <template v-else-if="prontas.data.value">
      <p v-if="prontas.data.value.length === 0" data-testid="lot-sem-contas">
        {{ t('tiss.lotes.semContas') }}
      </p>
      <table v-else class="tabela" data-testid="lot-prontas">
        <caption class="secundario">
          {{
            t('tiss.lotes.prontas', { n: prontas.data.value.length })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <input
                type="checkbox"
                :aria-label="t('tiss.marcarTodas')"
                :checked="marcadas.length > 0 && marcadas.length === Math.min(100, prontas.data.value.length)"
                data-testid="lot-marcar-todas"
                @change="todas"
              />
            </th>
            <th scope="col">{{ t('tiss.conta') }}</th>
            <th scope="col">{{ t('tiss.competencia') }}</th>
            <th scope="col">{{ t('tiss.carteira') }}</th>
            <th scope="col">{{ t('tiss.itens') }}</th>
            <th scope="col">{{ t('tiss.emissao') }}</th>
            <th scope="col">{{ t('tiss.total') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in prontas.data.value" :key="c.conta" :data-testid="`lot-conta-${c.conta}`">
            <td>
              <input
                type="checkbox"
                :aria-label="t('tiss.lotes.incluirConta', { conta: c.conta })"
                :checked="marcadas.includes(c.conta)"
                :data-testid="`lot-marcar-${c.conta}`"
                @change="alternar(c.conta)"
              />
            </td>
            <td>
              {{ c.conta }} <span class="secundario">· {{ c.chave }}</span>
            </td>
            <td>{{ c.competencia }}</td>
            <td>{{ c.beneficiario }}</td>
            <td>{{ c.itens }}</td>
            <td>{{ data(c.dataEmissao) }}</td>
            <td>{{ reais(c.total) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!pode('faturamento.gerarLote')" class="secundario">{{ motivo('faturamento.gerarLote') }}</p>
      <button
        v-if="prontas.data.value.length"
        type="button"
        :disabled="gravando || marcadas.length === 0 || !pode('faturamento.gerarLote')"
        data-testid="lot-montar"
        @click="montar"
      >
        {{ t('tiss.lotes.montarLote', { n: marcadas.length }) }}
      </button>
    </template>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" :avisos="avisos" testid="lot-mensagem" />

    <h2>{{ t('tiss.lotes.lista') }}</h2>
    <form class="filtros" @submit.prevent="pagina = 0">
      <span class="campo">
        <SanteSelecao
          v-model="filtroLotes.convenio"
          :rotulo="t('tiss.convenio')"
          :opcoes="[{ valor: '', rotulo: t('tiss.todos') }, ...convenios]"
          data-testid="lot-filtro-convenio"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="filtroLotes.semProtocolo"
          :rotulo="t('tiss.protocolo')"
          :opcoes="[
            { valor: '', rotulo: t('tiss.todos') },
            { valor: 'sim', rotulo: t('tiss.lotes.semProtocolo') },
          ]"
          data-testid="lot-filtro-protocolo"
        />
      </span>
    </form>
    <ErroFaturamento v-if="lotes.error.value" :erro="lotes.error.value" />
    <p v-else-if="!lotes.data.value" role="status">{{ t('tiss.carregando') }}</p>
    <table v-else class="tabela" data-testid="lot-lista">
      <caption class="secundario">
        {{
          lotes.data.value.total
        }}
        ·
        {{
          t('tiss.pagina')
        }}
        {{
          lotes.data.value.pagina + 1
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('tiss.lote') }}</th>
          <th scope="col">{{ t('tiss.numero') }}</th>
          <th scope="col">{{ t('tiss.convenio') }}</th>
          <th scope="col">{{ t('tiss.tipoGuia') }}</th>
          <th scope="col">{{ t('tiss.dataHora') }}</th>
          <th scope="col">{{ t('tiss.contas') }}</th>
          <th scope="col">{{ t('tiss.valor') }}</th>
          <th scope="col">{{ t('tiss.protocolo') }}</th>
          <th scope="col">{{ t('tiss.situacao') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in lotes.data.value.itens" :key="l.id" :data-testid="`lot-${l.id}`">
          <td>
            <RouterLink :to="`/faturamento/lotes/${l.id}`" :data-testid="`lot-abrir-${l.id}`">{{
              l.id
            }}</RouterLink>
          </td>
          <td>{{ l.numero }}</td>
          <td>{{ l.convenioNome || l.convenio }}</td>
          <td>{{ l.tipoGuiaNome }}</td>
          <td>{{ quando(l.dataHora) }}</td>
          <td>{{ l.contas }}</td>
          <td>{{ reais(l.valor) }}</td>
          <td>
            {{ l.protocolo || '—' }}
            <span v-if="l.diasSemProtocolo !== null" class="secundario">
              ({{ t('tiss.lotes.diasSem', { n: l.diasSemProtocolo }) }})</span
            >
          </td>
          <td :data-testid="`lot-situacao-${l.id}`">
            {{ l.situacaoRotulo
            }}<span v-if="l.inferida" class="secundario" :title="l.aviso ?? ''">
              · {{ t('tiss.inferida') }}</span
            >
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="lotes.data.value" class="filtros">
      <button type="button" :disabled="pagina === 0" @click="pagina -= 1">{{ t('tiss.anterior') }}</button>
      <button
        type="button"
        :disabled="(pagina + 1) * lotes.data.value.porPagina >= lotes.data.value.total"
        @click="pagina += 1"
      >
        {{ t('tiss.proxima') }}
      </button>
    </div>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
