<script setup lang="ts">
// Recibos e caixa (ficha do M30, seção 7): `/faturamento/particular/caixa`. O caixa do operador (abrir, receber, fechar
// com o contado), o recebimento por dinheiro, Pix, cartão ou transferência (Pix e cartão pelo conector simulado fora de
// produção) e o recibo numerado; os recibos antigos (2020 a 2021) em consulta.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  abrirCaixa,
  emitirRecibo,
  fecharCaixa,
  listarCaixas,
  listarOrcamentos,
  listarPagamentos,
  listarRecibos,
  novaChave,
  receber,
} from '../api-faturamento.js';
import AvisoFaturamento from '../componentes/AvisoFaturamento.vue';
import CartaoRecebimento, { type CartaoEscolhido } from '../componentes/CartaoRecebimento.vue';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';
import { numero, quando, reais, usarFaturamento } from '../usar-faturamento.js';

const { t } = useI18n();
const qc = useQueryClient();
const { pode, motivoFuncionalidade } = usarFaturamento(true);
const caixas = useQuery({ queryKey: ['faturamento', 'caixas'], queryFn: () => listarCaixas() });
const aberto = computed(() => caixas.data.value?.find((c) => c.fechadoEm === null) ?? null);
const orcamentos = useQuery({ queryKey: ['faturamento', 'orcamentos'], queryFn: () => listarOrcamentos() });
const pagamentos = useQuery({
  queryKey: computed(() => ['faturamento', 'pagamentos', aberto.value?.id ?? 0]),
  queryFn: () => listarPagamentos(aberto.value?.id ?? null),
  enabled: computed(() => !!aberto.value),
});
const antigos = ref(false);
const recibos = useQuery({
  queryKey: computed(() => ['faturamento', 'recibos', antigos.value]),
  queryFn: () => listarRecibos(antigos.value),
});
const saldoInicial = ref('0');
const contado = ref('');
const rec = ref({ orcamento: '', forma: 'pix', valor: '', comprovante: '' });
// F3.8 (07-FIN linha 89): a administradora, a bandeira e as parcelas do cartão (nulo fora do cartão).
const cartao = ref<CartaoEscolhido | null>(null);
const emCartao = computed(() => rec.value.forma.startsWith('cartao'));
const pagamentoDaTela = () => {
  const c = emCartao.value ? cartao.value : null;
  return {
    forma: rec.value.forma,
    valor: numero(rec.value.valor),
    comprovante: rec.value.comprovante || null,
    ...(c
      ? { parcelas: c.parcelas, cartao: { administradora: c.administradora, bandeira: c.bandeira } }
      : {}),
  };
};
const recibo = ref({ pagamento: 0, pagador: '', referente: '' });
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const avisos = ref<string[]>([]);
async function agir(
  fn: () => Promise<{ mensagem: string; avisos: string[]; ids: Record<string, number | string> }>,
) {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await fn();
    mensagem.value = r.mensagem;
    avisos.value = r.avisos;
    if (typeof r.ids['pagamento'] === 'number') recibo.value.pagamento = r.ids['pagamento'];
    await qc.invalidateQueries({ queryKey: ['faturamento'] });
  } catch (e) {
    erro.value = e;
  }
}
const FORMAS = ['dinheiro', 'pix', 'cartao-credito', 'cartao-debito', 'transferencia'] as const;
const opcoesForma = computed(() =>
  FORMAS.map((f) => ({ valor: f as string, rotulo: t(`faturamento.caixa.formas.${f}`) })),
);
const opcoesOrcamento = computed(() => [
  { valor: '', rotulo: '—' },
  ...(orcamentos.data.value ?? [])
    .filter((x) => x.situacao === 'aberto')
    .map((o) => ({ valor: String(o.id), rotulo: `${o.id} · ${o.nome} · ${reais(o.total - o.pago)}` })),
]);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cx-titulo" data-testid="tela-faturamento-caixa">
    <h1 id="cx-titulo">{{ t('faturamento.caixa.titulo') }}</h1>
    <p>{{ t('faturamento.caixa.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('particular')" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" :avisos="avisos" testid="cx-mensagem" />
    <ErroFaturamento v-if="caixas.error.value" :erro="caixas.error.value" />
    <template v-else-if="caixas.data.value">
      <form
        v-if="!aberto && pode('caixa')"
        class="filtros"
        @submit.prevent="agir(() => abrirCaixa(numero(saldoInicial), novaChave('caixa')))"
      >
        <p>{{ t('faturamento.caixa.semCaixa') }}</p>
        <span class="campo"
          ><label for="cx-saldo">{{ t('faturamento.caixa.saldoInicial') }}</label
          ><input id="cx-saldo" v-model="saldoInicial" inputmode="decimal" size="8" data-testid="cx-saldo"
        /></span>
        <button type="submit" data-testid="cx-abrir">{{ t('faturamento.caixa.abrir') }}</button>
      </form>
      <template v-if="aberto">
        <p data-testid="cx-aberto">
          {{ t('faturamento.caixa.aberto') }} {{ aberto.id }} · {{ quando(aberto.abertoEm) }} ·
          {{ t('faturamento.caixa.recebido') }} {{ reais(aberto.recebido) }}
        </p>
        <form
          v-if="pode('receber')"
          class="filtros"
          @submit.prevent="
            agir(() =>
              receber(
                {
                  caixa: aberto!.id,
                  orcamento: rec.orcamento ? Number(rec.orcamento) : null,
                  pagamentos: [pagamentoDaTela()],
                },
                novaChave('receber'),
              ),
            )
          "
        >
          <span class="campo">
            <SanteSelecao
              v-model="rec.orcamento"
              :rotulo="t('faturamento.caixa.orcamento')"
              :opcoes="opcoesOrcamento"
              data-testid="cx-orc"
            />
          </span>
          <span class="campo">
            <SanteSelecao
              v-model="rec.forma"
              :rotulo="t('faturamento.caixa.forma')"
              :opcoes="opcoesForma"
              data-testid="cx-forma"
            />
          </span>
          <span class="campo"
            ><label for="cx-valor">{{ t('faturamento.valor') }}</label
            ><input id="cx-valor" v-model="rec.valor" inputmode="decimal" size="8" data-testid="cx-valor"
          /></span>
          <CartaoRecebimento v-if="emCartao" v-model="cartao" :forma="rec.forma" :valor="numero(rec.valor)" />
          <span class="campo"
            ><label for="cx-comp">{{ t('faturamento.caixa.comprovante') }}</label
            ><input id="cx-comp" v-model="rec.comprovante" maxlength="40"
          /></span>
          <button type="submit" data-testid="cx-receber">{{ t('faturamento.caixa.receber') }}</button>
        </form>
        <form
          v-if="pode('emitirRecibo') && recibo.pagamento"
          class="filtros"
          @submit.prevent="agir(() => emitirRecibo({ ...recibo }, novaChave('recibo')))"
        >
          <span class="campo"
            ><label for="cx-pagador">{{ t('faturamento.caixa.pagador') }}</label
            ><input id="cx-pagador" v-model="recibo.pagador" maxlength="80" data-testid="cx-pagador"
          /></span>
          <span class="campo"
            ><label for="cx-ref">{{ t('faturamento.caixa.referente') }}</label
            ><input id="cx-ref" v-model="recibo.referente" maxlength="250" data-testid="cx-ref"
          /></span>
          <button type="submit" data-testid="cx-recibo">{{ t('faturamento.caixa.recibo') }}</button>
        </form>
        <table v-if="pagamentos.data.value?.length" class="tabela" data-testid="cx-pagamentos">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{{ t('faturamento.caixa.forma') }}</th>
              <th scope="col">{{ t('faturamento.valor') }}</th>
              <th scope="col">{{ t('faturamento.situacao') }}</th>
              <th scope="col">{{ t('faturamento.caixa.numero') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in pagamentos.data.value" :key="p.id">
              <td>{{ p.id }}</td>
              <td>{{ t(`faturamento.caixa.formas.${p.forma}`) }}</td>
              <td>{{ reais(p.valor) }}</td>
              <td>{{ p.situacao }}</td>
              <td>{{ p.recibo ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
        <form
          v-if="pode('caixa')"
          class="filtros"
          @submit.prevent="
            agir(() => fecharCaixa(aberto!.id, numero(contado || '0'), novaChave('fechar-caixa')))
          "
        >
          <span class="campo"
            ><label for="cx-contado">{{ t('faturamento.caixa.contado') }}</label
            ><input id="cx-contado" v-model="contado" inputmode="decimal" size="8" data-testid="cx-contado"
          /></span>
          <button type="submit" data-testid="cx-fechar">{{ t('faturamento.caixa.fechar') }}</button>
        </form>
      </template>
    </template>
    <h2>{{ t('faturamento.caixa.recibos') }}</h2>
    <label
      ><input v-model="antigos" type="checkbox" data-testid="cx-antigos" />
      {{ t('faturamento.caixa.antigos') }}</label
    >
    <table v-if="recibos.data.value" class="tabela" data-testid="cx-recibos">
      <thead>
        <tr>
          <th scope="col">{{ t('faturamento.caixa.numero') }}</th>
          <th scope="col">{{ t('faturamento.caixa.pagador') }}</th>
          <th scope="col">{{ t('faturamento.caixa.referente') }}</th>
          <th scope="col">{{ t('faturamento.valor') }}</th>
          <th scope="col">{{ t('faturamento.data') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="recibos.data.value.length === 0">
          <td colspan="5">{{ t('faturamento.nenhum') }}</td>
        </tr>
        <tr v-for="r in recibos.data.value" :key="`${r.origem}-${r.id}`">
          <td>{{ r.numero }}</td>
          <td>{{ r.pagador }}</td>
          <td>{{ r.referente }}</td>
          <td>{{ reais(r.valor) }}</td>
          <td>{{ quando(r.em) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
