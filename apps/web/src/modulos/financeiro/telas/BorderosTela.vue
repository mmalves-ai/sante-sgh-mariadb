<script setup lang="ts">
// Borderôs e pagamento (ficha do M32, seção 7): `/financeiro/pagar/borderos`. Os títulos aprovados na alçada que vencem
// no período, marcados para pagar por borderô (um borderô para os marcados) ou um a um, pela conta do escopo; o
// servidor confere de novo a aprovação, a segregação (quem aprova não paga) e se o título mudou depois da leitura.
// F3.8 (07-FIN linha 63): o título marcado abre os valores da baixa na própria linha (valor pago, desconto, juros,
// multa, acréscimo); em branco paga o saldo, e a prévia mostra na hora quanto liquida e quanto fica em aberto.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { lerFilaAprovacao, listarBorderos, novaChave, pagarTitulos } from '../api-financeiro.js';
import { type CamposBaixa, camposBaixaVazios, previaBaixa } from '../regras-baixa.js';
import { data, opcoesContas, reais, usarFinanceiro } from '../usar-financeiro.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivo, motivoFuncionalidade } = usarFinanceiro();
const fila = useQuery({ queryKey: ['financeiro', 'aprovacao', 60], queryFn: () => lerFilaAprovacao(60) });
const aprovados = computed(() =>
  (fila.data.value ?? []).filter((x) => x.feitas >= x.exigidas && x.exigidas > 0),
);
const borderos = useQuery({ queryKey: ['financeiro', 'borderos'], queryFn: () => listarBorderos({}) });
const marcados = reactive(new Set<number>());
const form = reactive({ conta: '', dataPagamento: '', formaPagamento: '0', porBordero: true });
watch(
  () => apoio.data.value?.hoje,
  (h) => {
    if (h && !form.dataPagamento) form.dataPagamento = h;
  },
  { immediate: true },
);
const contas = computed(() => opcoesContas(apoio.data.value?.contas, t('financeiro.escolha')));
const formas = computed(() =>
  (apoio.data.value?.formasPagamento ?? []).map((f) => ({
    valor: String(f.codigo),
    rotulo: `${f.codigo} — ${f.nome}`,
  })),
);
const ajustes = reactive<Record<number, CamposBaixa>>({});
const saldoDe = (x: { valor: number; saldo?: number }) => x.saldo ?? x.valor;
const previas = computed(
  () =>
    new Map(
      aprovados.value
        .filter((x) => marcados.has(x.id))
        .map((x) => [x.id, previaBaixa(saldoDe(x), ajustes[x.id] ?? camposBaixaVazios())] as const),
    ),
);
const totalMarcado = computed(() =>
  [...previas.value.values()].reduce((s, p) => Math.round((s + p.desembolso) * 100) / 100, 0),
);
const temAviso = computed(() => [...previas.value.values()].some((p) => p.aviso !== null));
const CAMPOS_BAIXA = ['valorPago', 'desconto', 'juros', 'multa', 'acrescimo'] as const;
function alternar(id: number) {
  if (marcados.has(id)) marcados.delete(id);
  else {
    ajustes[id] ??= camposBaixaVazios();
    marcados.add(id);
  }
}
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function pagar() {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  // Só os valores preenchidos vão ao servidor; sem eles a baixa quita o saldo.
  const titulos: { titulo: number; versao: string | null }[] = aprovados.value
    .filter((x) => marcados.has(x.id))
    .map((x) => ({ titulo: x.id, versao: x.versao, ...previas.value.get(x.id)?.corpo }));
  try {
    const r = await pagarTitulos(
      {
        titulos,
        conta: Number(form.conta),
        dataPagamento: form.dataPagamento,
        formaPagamento: Number(form.formaPagamento),
        porBordero: form.porBordero,
      },
      novaChave('pagar'),
    );
    mensagem.value = r.mensagem;
    marcados.clear();
    for (const k of Object.keys(ajustes)) delete ajustes[Number(k)];
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="bd-titulo" data-testid="tela-fin-borderos">
    <h1 id="bd-titulo">{{ t('financeiro.borderos.titulo') }}</h1>
    <p>{{ t('financeiro.borderos.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('contasPagar')" />
    <h2>{{ t('financeiro.borderos.aPagar') }}</h2>
    <ErroFaturamento v-if="fila.error.value" :erro="fila.error.value" />
    <table v-else-if="aprovados.length" class="tabela" data-testid="bd-aprovados">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.marcar') }}</th>
          <th scope="col">{{ t('financeiro.credor') }}</th>
          <th scope="col">{{ t('financeiro.documento') }}</th>
          <th scope="col">{{ t('financeiro.vencimento') }}</th>
          <th scope="col">{{ t('financeiro.valor') }}</th>
          <th scope="col">{{ t('financeiro.baixa.saldo') }}</th>
        </tr>
      </thead>
      <tbody v-for="x in aprovados" :key="x.id">
        <tr>
          <td>
            <input
              :id="`bd-marcar-${x.id}`"
              type="checkbox"
              :checked="marcados.has(x.id)"
              :aria-label="`${t('financeiro.marcar')} ${x.documento}/${x.parcela}`"
              :data-testid="`bd-marcar-${x.id}`"
              @change="alternar(x.id)"
            />
          </td>
          <td>{{ x.credor }} — {{ x.credorNome }}</td>
          <td>{{ x.documento }}/{{ x.parcela }}</td>
          <td>{{ data(x.vencimento) }}</td>
          <td>{{ reais(x.valor) }}</td>
          <td :data-testid="`bd-saldo-${x.id}`">{{ reais(saldoDe(x)) }}</td>
        </tr>
        <tr v-if="marcados.has(x.id) && ajustes[x.id]" :data-testid="`bd-ajuste-${x.id}`">
          <td colspan="6">
            <fieldset class="filtros">
              <legend>{{ t('financeiro.baixa.camposDe', { titulo: `${x.documento}/${x.parcela}` }) }}</legend>
              <span v-for="k in CAMPOS_BAIXA" :key="k" class="campo">
                <label :for="`bd-${k}-${x.id}`">{{ t(`financeiro.baixa.${k}`) }}</label>
                <input
                  :id="`bd-${k}-${x.id}`"
                  v-model="ajustes[x.id]![k]"
                  type="number"
                  min="0"
                  step="0.01"
                  inputmode="decimal"
                  :data-testid="`bd-${k}-${x.id}`"
                />
              </span>
            </fieldset>
            <p v-if="previas.get(x.id)?.aviso" role="alert" :data-testid="`bd-aviso-${x.id}`">
              {{ t(`financeiro.baixa.avisos.${previas.get(x.id)?.aviso}`) }}
            </p>
            <p v-else class="secundario" :data-testid="`bd-previa-${x.id}`">
              {{
                (previas.get(x.id)?.resta ?? 0) > 0
                  ? t('financeiro.baixa.previaParcial', {
                      desembolso: reais(previas.get(x.id)?.desembolso ?? 0),
                      liquida: reais(previas.get(x.id)?.liquida ?? 0),
                      resta: reais(previas.get(x.id)?.resta ?? 0),
                    })
                  : t('financeiro.baixa.previaQuita', {
                      desembolso: reais(previas.get(x.id)?.desembolso ?? 0),
                    })
              }}
            </p>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('financeiro.nenhum') }}</p>
    <p v-if="aprovados.length" class="secundario">{{ t('financeiro.baixa.ajuste') }}</p>

    <form class="filtros" data-testid="bd-formulario" @submit.prevent="pagar">
      <span class="campo">
        <SanteSelecao
          v-model="form.conta"
          :rotulo="t('financeiro.conta')"
          :opcoes="contas"
          obrigatorio
          data-testid="bd-conta"
        />
      </span>
      <span class="campo">
        <label for="bd-data">{{ t('financeiro.borderos.dataPagamento') }}</label>
        <input id="bd-data" v-model="form.dataPagamento" type="date" required data-testid="bd-data" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="form.formaPagamento"
          :rotulo="t('financeiro.borderos.formaPagamento')"
          :opcoes="formas"
          data-testid="bd-forma"
        />
      </span>
      <span class="campo">
        <label for="bd-por-bordero">
          <input id="bd-por-bordero" v-model="form.porBordero" type="checkbox" data-testid="bd-por-bordero" />
          {{ t('financeiro.borderos.porBordero') }}
        </label>
      </span>
      <span>{{ t('financeiro.total') }}: {{ reais(totalMarcado) }}</span>
      <button
        type="submit"
        :disabled="
          gravando || marcados.size === 0 || temAviso || !form.conta || !pode('financeiro.baixarTitulo')
        "
        data-testid="bd-pagar"
      >
        {{ t('financeiro.borderos.pagar') }}
      </button>
    </form>
    <p v-if="!pode('financeiro.baixarTitulo')" class="secundario">{{ motivo('financeiro.baixarTitulo') }}</p>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="bd-mensagem" />

    <h2>{{ t('financeiro.borderos.gerados') }}</h2>
    <ErroFaturamento v-if="borderos.error.value" :erro="borderos.error.value" />
    <table v-else-if="borderos.data.value?.length" class="tabela" data-testid="bd-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.borderos.numero') }}</th>
          <th scope="col">{{ t('financeiro.data') }}</th>
          <th scope="col">{{ t('financeiro.conta') }}</th>
          <th scope="col">{{ t('financeiro.borderos.titulos') }}</th>
          <th scope="col">{{ t('financeiro.valor') }}</th>
          <th scope="col">{{ t('financeiro.usuario') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="b in borderos.data.value" :key="b.id">
          <td>{{ b.numero }}</td>
          <td>{{ data(b.data) }}</td>
          <td>{{ b.conta }}</td>
          <td>{{ b.titulos }}</td>
          <td>{{ reais(b.valor) }}</td>
          <td>{{ b.usuario }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('financeiro.nenhum') }}</p>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
