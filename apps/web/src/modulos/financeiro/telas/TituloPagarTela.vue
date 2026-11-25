<script setup lang="ts">
// Título a pagar (ficha do M32, seção 7): `/financeiro/pagar/titulos/:id`. As parcelas do documento, a classificação
// gerencial (do documento inteiro), as retenções, o rateio, as aprovações e a alçada que vale; o documento do credor
// mascarado, com o "mostrar" auditado (finalidade escrita); a exclusão só do título em aberto.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  excluirTituloPagar,
  lerMotivosProrrogacao,
  lerProrrogacoes,
  lerTituloPagar,
  mostrarDocumento,
  novaChave,
  prorrogarParcela,
} from '../api-financeiro.js';
import { data, quando, reais, usarFinanceiro } from '../usar-financeiro.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const qc = useQueryClient();
const { pode, tem } = usarFinanceiro();
const n = computed(() => Number(props.id));
const titulo = useQuery({
  queryKey: computed(() => ['financeiro', 'pagar', 'titulo', n.value]),
  queryFn: () => lerTituloPagar(n.value),
});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const finalidade = ref('');
const documento = ref<string | null>(null);
async function mostrar() {
  erro.value = null;
  try {
    documento.value = (await mostrarDocumento(n.value, finalidade.value, novaChave('mostrar'))).valor;
  } catch (e) {
    erro.value = e;
  }
}
// Prorrogação (F3.8, 07-FIN linha 63): na própria ficha do título, parcela por parcela, com o histórico ao lado.
// A data e a justificativa são conferidas na hora (o servidor confere de novo: regra no domínio).
const abertas = computed(() =>
  // A parcela paga em parte ainda tem saldo em aberto: também pode ser prorrogada.
  (titulo.data.value?.parcelas ?? []).filter((p) =>
    ['aberto', 'vencido', 'pago-parcial'].includes(p.situacao),
  ),
);
const parcelaEscolhida = ref('');
watch(
  abertas,
  (ps) => {
    if (!ps.some((p) => String(p.id) === parcelaEscolhida.value))
      parcelaEscolhida.value = ps[0] ? String(ps[0].id) : '';
  },
  { immediate: true },
);
const opcoesParcelas = computed(() =>
  abertas.value.map((p) => ({ valor: String(p.id), rotulo: `${p.parcela} — ${data(p.vencimento)}` })),
);
const motivos = useQuery({
  queryKey: ['financeiro', 'pagar', 'motivos-prorrogacao'],
  queryFn: lerMotivosProrrogacao,
  enabled: computed(() => tem('financeiro.tituloPagar.prorrogar')),
});
const opcoesMotivos = computed(() => [
  { valor: '', rotulo: '—' },
  ...(motivos.data.value ?? []).map((m) => ({ valor: String(m.id), rotulo: m.descricao })),
]);
const historico = useQuery({
  queryKey: computed(() => ['financeiro', 'pagar', 'prorrogacoes', parcelaEscolhida.value]),
  queryFn: () => lerProrrogacoes(Number(parcelaEscolhida.value)),
  enabled: computed(() => !!parcelaEscolhida.value),
});
const prorrogacao = ref({ vencimento: '', motivo: '', justificativa: '' });
const vencimentoAtual = computed(
  () => abertas.value.find((p) => String(p.id) === parcelaEscolhida.value)?.vencimento ?? null,
);
const exigeJustificativa = computed(
  () =>
    motivos.data.value?.find((m) => String(m.id) === prorrogacao.value.motivo)?.exigeJustificativa ?? false,
);
const dataParaTras = computed(
  () =>
    !!prorrogacao.value.vencimento &&
    !!vencimentoAtual.value &&
    prorrogacao.value.vencimento <= vencimentoAtual.value.slice(0, 10),
);
const faltaJustificativa = computed(
  () => exigeJustificativa.value && prorrogacao.value.justificativa.trim().length === 0,
);
const podeProrrogar = computed(
  () =>
    !!parcelaEscolhida.value &&
    !!prorrogacao.value.vencimento &&
    !!prorrogacao.value.motivo &&
    !dataParaTras.value &&
    !faltaJustificativa.value &&
    pode('prorrogarVencimento', 'financeiro.tituloPagar.prorrogar'),
);
async function prorrogar() {
  erro.value = null;
  try {
    const r = await prorrogarParcela(
      Number(parcelaEscolhida.value),
      {
        vencimento: prorrogacao.value.vencimento,
        motivo: Number(prorrogacao.value.motivo),
        justificativa: prorrogacao.value.justificativa,
      },
      novaChave('prorrogar'),
    );
    mensagem.value = r.mensagem;
    prorrogacao.value = { vencimento: '', motivo: '', justificativa: '' };
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  }
}
async function excluir() {
  erro.value = null;
  try {
    const r = await excluirTituloPagar(n.value, titulo.data.value?.versao ?? null, novaChave('excluir'));
    mensagem.value = r.mensagem;
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="tpd-titulo" data-testid="tela-fin-titulo-pagar">
    <h1 id="tpd-titulo">{{ t('financeiro.pagar.detalhe') }} {{ id }}</h1>
    <RouterLink to="/financeiro/pagar/titulos">{{ t('financeiro.voltar') }}</RouterLink>
    <RouterLink
      :to="`/financeiro/gerencial/reclassificar?alvo=titulo_pagar&id=${id}`"
      data-testid="tpd-reclassificar"
      >{{ t('financeiro.gestao.reclassificar.titulo') }}</RouterLink
    >
    <ErroFaturamento v-if="titulo.error.value" :erro="titulo.error.value" />
    <p v-else-if="titulo.isLoading.value">{{ t('financeiro.carregando') }}</p>
    <template v-else-if="titulo.data.value">
      <dl class="resumo" data-testid="tpd-resumo">
        <dt>{{ t('financeiro.credor') }}</dt>
        <dd>
          {{ titulo.data.value.credor }} — {{ titulo.data.value.credorNome }}
          <span v-if="!titulo.data.value.credorEncontrado"
            >({{ t('financeiro.pagar.credorNaoEncontrado') }})</span
          >
        </dd>
        <dt>{{ t('financeiro.mascarado') }}</dt>
        <dd data-testid="tpd-documento-credor">{{ documento ?? titulo.data.value.documentoCredor }}</dd>
        <dt>{{ t('financeiro.documento') }}</dt>
        <dd>
          {{ titulo.data.value.documento }}{{ titulo.data.value.serie ? `/${titulo.data.value.serie}` : '' }}
        </dd>
        <dt>{{ t('financeiro.emissao') }}</dt>
        <dd>{{ data(titulo.data.value.emissao) }}</dd>
        <dt>{{ t('financeiro.pagar.valorDocumento') }}</dt>
        <dd>{{ reais(titulo.data.value.valorDocumento) }}</dd>
        <dt>{{ t('financeiro.situacao') }}</dt>
        <dd data-testid="tpd-situacao">{{ t(`financeiro.situacoesPagar.${titulo.data.value.situacao}`) }}</dd>
        <dt>{{ t('financeiro.pagar.legendaStatus') }}</dt>
        <dd>{{ titulo.data.value.legendaStatus }} ({{ t('financeiro.aConfirmar') }})</dd>
        <dt>{{ t('financeiro.classificacao') }}</dt>
        <dd>
          <template v-if="titulo.data.value.classificacao">
            {{ titulo.data.value.classificacao.grupo }}.{{ titulo.data.value.classificacao.subgrupo }}.{{
              titulo.data.value.classificacao.item
            }}
            — {{ titulo.data.value.classificacao.nome }}
          </template>
          <template v-else>—</template>
        </dd>
        <dt>{{ t('financeiro.pagar.alcada') }}</dt>
        <dd data-testid="tpd-alcada">
          <template v-if="titulo.data.value.alcada && titulo.data.value.alcada.faixa !== null">
            {{
              t('financeiro.pagar.faixa', {
                faixa: titulo.data.value.alcada.faixa,
                feitas: titulo.data.value.alcada.feitas,
                exigidas: titulo.data.value.alcada.exigidas,
              })
            }}
            <strong v-if="titulo.data.value.alcada.aprovado">{{ t('financeiro.pagar.aprovado') }}</strong>
          </template>
          <template v-else>{{ t('financeiro.pagar.semFaixa') }}</template>
        </dd>
      </dl>

      <form v-if="tem('financeiro.dado.mostrar')" class="filtros" @submit.prevent="mostrar">
        <span class="campo">
          <label for="tpd-finalidade">{{ t('financeiro.finalidade') }}</label>
          <input
            id="tpd-finalidade"
            v-model="finalidade"
            minlength="5"
            maxlength="120"
            required
            data-testid="tpd-finalidade"
          />
        </span>
        <button type="submit" data-testid="tpd-mostrar">{{ t('financeiro.mostrar') }}</button>
      </form>

      <h2>{{ t('financeiro.parcelas') }}</h2>
      <table class="tabela" data-testid="tpd-parcelas">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.parcela') }}</th>
            <th scope="col">{{ t('financeiro.vencimento') }}</th>
            <th scope="col">{{ t('financeiro.valor') }}</th>
            <th scope="col">{{ t('financeiro.baixa.saldo') }}</th>
            <th scope="col">{{ t('financeiro.situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in titulo.data.value.parcelas" :key="p.id">
            <td>{{ p.parcela }}</td>
            <td>{{ data(p.vencimento) }}</td>
            <td>{{ reais(p.valor) }}</td>
            <td>{{ p.saldo === undefined ? '—' : reais(p.saldo) }}</td>
            <td>{{ t(`financeiro.situacoesPagar.${p.situacao}`) }}</td>
          </tr>
        </tbody>
      </table>
      <template v-if="titulo.data.value.retencoes.length">
        <h2>{{ t('financeiro.pagar.retencoes') }}</h2>
        <ul>
          <li v-for="r in titulo.data.value.retencoes" :key="r.codigo">
            {{ r.descricao }}: {{ reais(r.valor) }}
          </li>
        </ul>
      </template>
      <template v-if="titulo.data.value.rateio.length">
        <h2>{{ t('financeiro.pagar.rateio') }}</h2>
        <ul>
          <li v-for="r in titulo.data.value.rateio" :key="r.centroCusto">
            {{ r.centroCusto }}: {{ r.percentual }}% ({{ reais(r.valor) }})
          </li>
        </ul>
      </template>
      <h2>{{ t('financeiro.pagar.aprovacoesFeitas') }}</h2>
      <ul data-testid="tpd-aprovacoes">
        <li v-for="a in titulo.data.value.aprovacoesFeitas" :key="a.ordem">
          {{
            t('financeiro.pagar.ordemAprovacao', { ordem: a.ordem, aprovador: a.aprovador, em: quando(a.em) })
          }}
        </li>
        <li v-if="!titulo.data.value.aprovacoesFeitas.length">{{ t('financeiro.nenhum') }}</li>
      </ul>
      <template v-if="abertas.length && tem('financeiro.tituloPagar.prorrogar')">
        <h2>{{ t('financeiro.pagar.prorrogar.titulo') }}</h2>
        <p class="secundario">{{ t('financeiro.pagar.prorrogar.texto') }}</p>
        <form class="filtros" data-testid="tpd-prorrogar" @submit.prevent="prorrogar">
          <span class="campo">
            <SanteSelecao
              v-model="parcelaEscolhida"
              :rotulo="t('financeiro.pagar.prorrogar.parcela')"
              :opcoes="opcoesParcelas"
              data-testid="tpd-prorrogar-parcela"
            />
          </span>
          <span class="campo">
            <label for="tpd-prorrogar-vencimento">{{ t('financeiro.pagar.prorrogar.novoVencimento') }}</label>
            <input
              id="tpd-prorrogar-vencimento"
              v-model="prorrogacao.vencimento"
              type="date"
              required
              :aria-invalid="dataParaTras"
              data-testid="tpd-prorrogar-vencimento"
            />
          </span>
          <span class="campo">
            <SanteSelecao
              v-model="prorrogacao.motivo"
              :rotulo="t('financeiro.pagar.prorrogar.motivo')"
              :opcoes="opcoesMotivos"
              data-testid="tpd-prorrogar-motivo"
            />
          </span>
          <span class="campo">
            <label for="tpd-prorrogar-justificativa">{{
              t('financeiro.pagar.prorrogar.justificativa')
            }}</label>
            <input
              id="tpd-prorrogar-justificativa"
              v-model="prorrogacao.justificativa"
              maxlength="2000"
              :required="exigeJustificativa"
              :aria-invalid="faltaJustificativa"
              data-testid="tpd-prorrogar-justificativa"
            />
          </span>
          <button type="submit" :disabled="!podeProrrogar" data-testid="tpd-prorrogar-botao">
            {{ t('financeiro.pagar.prorrogar.botao') }}
          </button>
        </form>
        <p v-if="dataParaTras" role="alert" data-testid="tpd-prorrogar-aviso">
          {{ t('financeiro.pagar.prorrogar.dataParaTras', { atual: data(vencimentoAtual) }) }}
        </p>
        <p v-else-if="faltaJustificativa" role="alert" data-testid="tpd-prorrogar-aviso">
          {{ t('financeiro.pagar.prorrogar.justificativaObrigatoria') }}
        </p>
        <h3>{{ t('financeiro.pagar.prorrogar.historico') }}</h3>
        <ul data-testid="tpd-prorrogacoes">
          <li v-for="h in historico.data.value ?? []" :key="h.id">
            {{
              t('financeiro.pagar.prorrogar.passo', {
                de: data(h.vencimentoAnterior),
                para: data(h.vencimentoNovo),
                motivo: h.justificativa ? `${h.motivo} (${h.justificativa})` : h.motivo,
                usuario: h.usuario,
                em: quando(h.em),
              })
            }}
          </li>
          <li v-if="!(historico.data.value ?? []).length">{{ t('financeiro.pagar.prorrogar.nenhuma') }}</li>
        </ul>
      </template>
      <template v-if="titulo.data.value.situacao === 'aberto' || titulo.data.value.situacao === 'vencido'">
        <p class="secundario">{{ t('financeiro.pagar.excluirTexto') }}</p>
        <button
          type="button"
          :disabled="!pode('financeiro.criarTituloPagar', 'financeiro.tituloPagar.criar')"
          data-testid="tpd-excluir"
          @click="excluir"
        >
          {{ t('financeiro.pagar.excluir') }}
        </button>
      </template>
    </template>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="tpd-mensagem" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
