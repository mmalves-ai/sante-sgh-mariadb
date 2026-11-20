<script setup lang="ts">
// Borderôs e pagamento (ficha do M32, seção 7): `/financeiro/pagar/borderos`. Os títulos aprovados na alçada que vencem
// no período, marcados para pagar por borderô (um borderô para os marcados) ou um a um, pela conta do escopo; o
// servidor confere de novo a aprovação, a segregação (quem aprova não paga) e se o título mudou depois da leitura.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { lerFilaAprovacao, listarBorderos, novaChave, pagarTitulos } from '../api-financeiro.js';
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
const totalMarcado = computed(() =>
  aprovados.value.filter((x) => marcados.has(x.id)).reduce((s, x) => s + x.valor, 0),
);
function alternar(id: number) {
  if (marcados.has(id)) marcados.delete(id);
  else marcados.add(id);
}
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function pagar() {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = await pagarTitulos(
      {
        titulos: aprovados.value
          .filter((x) => marcados.has(x.id))
          .map((x) => ({ titulo: x.id, versao: x.versao })),
        conta: Number(form.conta),
        dataPagamento: form.dataPagamento,
        formaPagamento: Number(form.formaPagamento),
        porBordero: form.porBordero,
      },
      novaChave('pagar'),
    );
    mensagem.value = r.mensagem;
    marcados.clear();
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
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in aprovados" :key="x.id">
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
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('financeiro.nenhum') }}</p>

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
        :disabled="gravando || marcados.size === 0 || !form.conta || !pode('financeiro.baixarTitulo')"
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
