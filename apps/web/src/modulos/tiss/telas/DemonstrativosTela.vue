<script setup lang="ts">
// Demonstrativos e conciliação item a item (ficha do M31, seção 7): `/faturamento/demonstrativos`. O demonstrativo de
// análise de conta da operadora: o XML da TISS (quando a operadora fornece) ou a digitação assistida sobre os itens do
// lote (DP-33.8); a importação é idempotente (o mesmo número ou o mesmo arquivo não entra duas vezes) e cada item casa
// com o item da conta pelo sequencial da guia. Conciliar baixa os itens casados (valor e quantidade pagos e o motivo da
// glosa: sem motivo não fecha a conciliação).
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import type { ItemGlosaLido } from '@sgh/contratos';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  baixar,
  importarDemonstrativo,
  itensGlosa,
  lerDemonstrativo,
  lerLote,
  lerMotivos,
  listarDemonstrativos,
  novaChave,
} from '../api-tiss.js';
import { data, numero, quando, reais, usarTiss } from '../usar-tiss.js';

const { t } = useI18n();
const rota = useRoute();
const qc = useQueryClient();
const { apoio, pode, motivoFuncionalidade } = usarTiss('glosa');
const lote = ref(String(rota.query['lote'] ?? ''));
const loteAberto = ref<number | null>(lote.value ? Number(lote.value) : null);
const modo = ref<'digitacao' | 'xml'>('digitacao');
const tipo = ref<'analise' | 'pagamento'>('analise');
const numeroDem = ref('');
const dataEmissao = ref('');
const xml = ref('');
const digitado = ref<Record<number, { pago: string; motivo: string }>>({});
const aberto = ref<number | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const avisos = ref<readonly string[]>([]);
const gravando = ref(false);

const motivos = useQuery({ queryKey: ['tiss', 'motivos'], queryFn: () => lerMotivos(), staleTime: 300_000 });
const opcoesMotivo = computed(() =>
  (motivos.data.value ?? [])
    .filter((m) => m.codigo !== 3095)
    .map((m) => ({ valor: String(m.codigo), rotulo: `${m.codigo} — ${m.nome}` })),
);
const loteLido = useQuery({
  queryKey: computed(() => ['tiss', 'lote', loteAberto.value]),
  queryFn: () => lerLote(loteAberto.value!),
  enabled: computed(() => loteAberto.value !== null),
});
const itensDoLote = useQuery({
  queryKey: computed(() => [
    'tiss',
    'itens-lote',
    loteAberto.value,
    loteLido.data.value?.contasDoLote.length,
  ]),
  queryFn: async () => {
    const r: ItemGlosaLido[] = [];
    for (const c of loteLido.data.value?.contasDoLote ?? []) r.push(...(await itensGlosa(c.conta)));
    return r.filter((i) => !i.conciliado);
  },
  enabled: computed(() => Boolean(loteLido.data.value)),
});
const lista = useQuery({
  queryKey: computed(() => ['tiss', 'demonstrativos', loteAberto.value]),
  queryFn: () => listarDemonstrativos({ lote: loteAberto.value ? String(loteAberto.value) : '' }),
});
const detalhe = useQuery({
  queryKey: computed(() => ['tiss', 'demonstrativo', aberto.value]),
  queryFn: () => lerDemonstrativo(aberto.value!),
  enabled: computed(() => aberto.value !== null),
});
function abrirLote() {
  loteAberto.value = lote.value ? Number(lote.value) : null;
  digitado.value = {};
}
function campo(item: number) {
  digitado.value[item] ??= { pago: '', motivo: '0' };
  return digitado.value[item]!;
}
async function lerArquivo(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (f) xml.value = await f.text();
}
async function importar() {
  if (!loteAberto.value) return;
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const itens =
      modo.value === 'xml'
        ? []
        : (itensDoLote.data.value ?? [])
            .filter((i) => digitado.value[i.item]?.pago !== undefined && digitado.value[i.item]!.pago !== '')
            .map((i) => ({
              numeroGuia: String(i.conta),
              sequencial: i.sequencial ?? 0,
              codigoProcedimento: i.codigo,
              valorInformado: i.valorCobrado,
              valorPago: numero(digitado.value[i.item]!.pago),
              quantidadePaga: i.quantidade,
              motivo: Number(digitado.value[i.item]!.motivo || 0),
            }));
    const r = await importarDemonstrativo(
      {
        lote: loteAberto.value,
        tipo: tipo.value,
        numero: numeroDem.value || 'XML',
        dataEmissao: dataEmissao.value || (apoio.data.value?.hoje ?? ''),
        xml: modo.value === 'xml' ? xml.value : null,
        itens,
      },
      novaChave('demonstrativo'),
    );
    mensagem.value = r.mensagem;
    avisos.value = r.avisos;
    if (typeof r.ids['demonstrativo'] === 'number') aberto.value = r.ids['demonstrativo'];
    await qc.invalidateQueries({ queryKey: ['tiss'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
async function conciliar() {
  const d = detalhe.data.value;
  if (!d || aberto.value === null) return;
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const dem = (lista.data.value ?? []).find((x) => x.id === aberto.value);
    const casados = d.itens.filter((i) => i.situacao === 'casado' && i.item !== null && i.versaoItem);
    const r = await baixar(
      {
        itens: casados.map((i) => ({
          item: i.item!,
          versao: i.versaoItem!,
          valorPago: i.valorPago,
          quantidadePaga: i.quantidadePaga,
          motivo: i.motivo,
        })),
        dataPagamento: dem?.dataEmissao ?? apoio.data.value?.hoje ?? '',
        demonstrativo: aberto.value,
      },
      novaChave('baixa'),
    );
    mensagem.value = r.mensagem;
    avisos.value = r.avisos;
    await qc.invalidateQueries({ queryKey: ['tiss'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="dm-titulo" data-testid="tela-tiss-demonstrativos">
    <h1 id="dm-titulo">{{ t('tiss.demonstrativos.titulo') }}</h1>
    <p>{{ t('tiss.demonstrativos.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('conciliacao')" />
    <form class="filtros" @submit.prevent="abrirLote">
      <span class="campo">
        <label for="dm-lote">{{ t('tiss.lote') }}</label>
        <input id="dm-lote" v-model="lote" inputmode="numeric" data-testid="dm-lote" />
      </span>
      <button type="submit" data-testid="dm-abrir-lote">{{ t('tiss.abrir') }}</button>
    </form>
    <ErroFaturamento v-if="loteLido.error.value" :erro="loteLido.error.value" />
    <template v-if="loteLido.data.value">
      <h2>
        {{
          t('tiss.demonstrativos.importar', {
            lote: loteLido.data.value.id,
            numero: loteLido.data.value.numero,
          })
        }}
      </h2>
      <form class="formulario" @submit.prevent="importar">
        <span class="campo">
          <SanteSelecao
            v-model="modo"
            :rotulo="t('tiss.demonstrativos.origem')"
            :opcoes="[
              { valor: 'digitacao', rotulo: t('tiss.demonstrativos.digitacao') },
              { valor: 'xml', rotulo: t('tiss.demonstrativos.xml') },
            ]"
            data-testid="dm-modo"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="tipo"
            :rotulo="t('tiss.demonstrativos.tipo')"
            :opcoes="[
              { valor: 'analise', rotulo: t('tiss.demonstrativos.analise') },
              { valor: 'pagamento', rotulo: t('tiss.demonstrativos.pagamento') },
            ]"
            data-testid="dm-tipo"
          />
        </span>
        <template v-if="modo === 'digitacao'">
          <span class="campo">
            <label for="dm-numero">{{ t('tiss.demonstrativos.numero') }}</label>
            <input id="dm-numero" v-model="numeroDem" maxlength="20" required data-testid="dm-numero" />
          </span>
          <span class="campo">
            <label for="dm-data">{{ t('tiss.demonstrativos.dataEmissao') }}</label>
            <input id="dm-data" v-model="dataEmissao" type="date" data-testid="dm-data" />
          </span>
          <p v-if="!itensDoLote.data.value?.length">{{ t('tiss.demonstrativos.semItens') }}</p>
          <table v-else class="tabela" data-testid="dm-itens-lote">
            <thead>
              <tr>
                <th scope="col">{{ t('tiss.sequencial') }}</th>
                <th scope="col">{{ t('tiss.conta') }}</th>
                <th scope="col">{{ t('tiss.item') }}</th>
                <th scope="col">{{ t('tiss.cobrado') }}</th>
                <th scope="col">{{ t('tiss.pago') }}</th>
                <th scope="col">{{ t('tiss.motivo') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in itensDoLote.data.value" :key="i.item" :data-testid="`dm-item-${i.item}`">
                <td>{{ i.sequencial ?? '—' }}</td>
                <td>{{ i.conta }}</td>
                <td>{{ i.codigo }} · {{ i.descricao }}</td>
                <td>{{ reais(i.valorCobrado) }}</td>
                <td>
                  <input
                    v-model="campo(i.item).pago"
                    inputmode="decimal"
                    :aria-label="t('tiss.demonstrativos.pagoDoItem', { item: i.item })"
                    :data-testid="`dm-pago-${i.item}`"
                  />
                </td>
                <td>
                  <SanteSelecao
                    v-model="campo(i.item).motivo"
                    :rotulo="t('tiss.motivo')"
                    :opcoes="opcoesMotivo"
                    :data-testid="`dm-motivo-${i.item}`"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </template>
        <template v-else>
          <span class="campo">
            <label for="dm-arquivo">{{ t('tiss.demonstrativos.arquivo') }}</label>
            <input
              id="dm-arquivo"
              type="file"
              accept=".xml,text/xml"
              data-testid="dm-arquivo"
              @change="lerArquivo"
            />
          </span>
          <span class="campo">
            <label for="dm-xml">{{ t('tiss.demonstrativos.colarXml') }}</label>
            <textarea id="dm-xml" v-model="xml" rows="4" data-testid="dm-xml"></textarea>
          </span>
        </template>
        <button
          type="submit"
          :disabled="gravando || !pode('importarDemonstrativo')"
          data-testid="dm-importar"
        >
          {{ t('tiss.demonstrativos.importarBotao') }}
        </button>
      </form>
    </template>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" :avisos="avisos" testid="dm-mensagem" />

    <h2>{{ t('tiss.demonstrativos.lista') }}</h2>
    <ErroFaturamento v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value?.length">{{ t('tiss.nenhum') }}</p>
    <table v-else class="tabela" data-testid="dm-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('tiss.demonstrativos.numero') }}</th>
          <th scope="col">{{ t('tiss.lote') }}</th>
          <th scope="col">{{ t('tiss.demonstrativos.origem') }}</th>
          <th scope="col">{{ t('tiss.itens') }}</th>
          <th scope="col">{{ t('tiss.demonstrativos.casados') }}</th>
          <th scope="col">{{ t('tiss.demonstrativos.baixados') }}</th>
          <th scope="col">{{ t('tiss.pago') }}</th>
          <th scope="col">{{ t('tiss.demonstrativos.importado') }}</th>
          <th scope="col">{{ t('tiss.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in lista.data.value" :key="d.id" :data-testid="`dm-${d.id}`">
          <td>
            {{ d.numero }} <span class="secundario">· {{ data(d.dataEmissao) }}</span>
          </td>
          <td>{{ d.lote }}</td>
          <td>
            {{ d.origem === 'xml' ? t('tiss.demonstrativos.xml') : t('tiss.demonstrativos.digitacao') }}
          </td>
          <td>{{ d.itens }}</td>
          <td>{{ d.casados }} · {{ t('tiss.demonstrativos.semCasamento', { n: d.semCasamento }) }}</td>
          <td>{{ d.baixados }}</td>
          <td>{{ reais(d.valorPago) }}</td>
          <td>{{ d.importadoPor }} · {{ quando(d.importadoEm) }}</td>
          <td>
            <button type="button" :data-testid="`dm-ver-${d.id}`" @click="aberto = d.id">
              {{ t('tiss.abrir') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <template v-if="detalhe.data.value">
      <h2>{{ t('tiss.demonstrativos.conciliacao') }}</h2>
      <table class="tabela" data-testid="dm-detalhe">
        <thead>
          <tr>
            <th scope="col">{{ t('tiss.sequencial') }}</th>
            <th scope="col">{{ t('tiss.item') }}</th>
            <th scope="col">{{ t('tiss.cobrado') }}</th>
            <th scope="col">{{ t('tiss.demonstrativos.informado') }}</th>
            <th scope="col">{{ t('tiss.pago') }}</th>
            <th scope="col">{{ t('tiss.motivo') }}</th>
            <th scope="col">{{ t('tiss.situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in detalhe.data.value.itens" :key="i.id">
            <td>{{ i.sequencial }}</td>
            <td>{{ i.item ?? '—' }} · {{ i.codigoProcedimento }}</td>
            <td>{{ i.valorCobrado === null ? '—' : reais(i.valorCobrado) }}</td>
            <td>{{ reais(i.valorInformado) }}</td>
            <td>{{ reais(i.valorPago) }}</td>
            <td>{{ i.motivo }} {{ i.motivoNome }}</td>
            <td :data-testid="`dm-situacao-${i.id}`">
              {{ t(`tiss.demonstrativos.situacoes.${i.situacao}`) }}
            </td>
          </tr>
        </tbody>
      </table>
      <button
        type="button"
        :disabled="
          gravando ||
          !pode('faturamento.registrarGlosa') ||
          !detalhe.data.value.itens.some((i) => i.situacao === 'casado')
        "
        data-testid="dm-conciliar"
        @click="conciliar"
      >
        {{ t('tiss.demonstrativos.conciliar') }}
      </button>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
