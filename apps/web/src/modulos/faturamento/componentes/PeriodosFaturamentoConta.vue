<script setup lang="ts">
// Conta parcial por período no faturamento (F3.7, 06-FAT linha 12), dentro dos complementos da conta. Cada período
// mostra os itens que caem nele pela data, o valor, as guias TISS e a competência; o que ficou fora de todo período
// aparece à parte, e o total sai por competência. Fechar o período é um clique, com o motivo do bloqueio explicado na
// hora pela mesma regra do servidor (ordem das faixas, conta aberta, ao menos um item). Reabrir pede motivo e vai do
// último para o primeiro; nada se apaga.
import { validarFechamentoPeriodo, validarReaberturaPeriodo } from '@sgh/dominio-faturamento';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChave } from '../api-faturamento.js';
import { fecharPeriodo, lerFaturamentoPorPeriodo, reabrirPeriodo } from '../api-periodos-conta.js';
import { quando, reais } from '../usar-faturamento.js';
import ErroFaturamento from './ErroFaturamento.vue';
import MensagemFaturamento from './MensagemFaturamento.vue';

const props = defineProps<{ conta: number }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Faturamento por período',
      competencia: 'Competência',
      faixa: 'Faixa',
      faixaTexto: '{inicio} a {fim}',
      itens: 'Itens',
      valor: 'Valor',
      guias: 'Guias TISS',
      situacao: 'Situação',
      aberto: 'Aberto',
      fechado: 'Fechado em {quando}',
      fechar: 'Fechar período',
      reabrir: 'Reabrir',
      motivo: 'Motivo',
      confirmar: 'Confirmar reabertura',
      semPeriodo: 'Fora de todo período: {itens} item(ns), {valor}. Inclua um período que cubra essas datas.',
      porCompetencia: 'Total por competência',
      fechou: 'Período fechado.',
      reabriu: 'Período reaberto.',
      nenhuma: 'nenhuma',
    },
  },
});
const qc = useQueryClient();
const consulta = useQuery({
  queryKey: ['faturamento', 'faturamento-por-periodo', computed(() => props.conta)],
  queryFn: () => lerFaturamentoPorPeriodo(props.conta),
});
const dados = computed(() => consulta.data.value);
const mes = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

/** Motivo de não fechar, pela regra do domínio (vazio: fecha). */
const bloqueioFechar = (id: number) => {
  const d = dados.value;
  const p = d?.periodos.find((x) => x.id === id);
  if (!d || !p) return [];
  return Object.values(validarFechamentoPeriodo({ situacao: d.situacao }, p, d.periodos, p.itens));
};
const reabrindo = ref<number | null>(null);
const motivo = ref('');
const errosReabrir = computed(() => {
  const d = dados.value;
  const p = d?.periodos.find((x) => x.id === reabrindo.value);
  if (!d || !p) return [];
  // As guias em lote o servidor confere; aqui só o que a tela sabe.
  return Object.values(validarReaberturaPeriodo({ situacao: d.situacao }, p, d.periodos, 0, motivo.value));
});

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('periodo-faturamento');
async function acao(f: () => Promise<unknown>, ok: string) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    await f();
    mensagem.value = ok;
    chave = novaChave('periodo-faturamento');
    reabrindo.value = null;
    motivo.value = '';
    await qc.invalidateQueries({ queryKey: ['faturamento'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
const fechar = (id: number, versao: number) => acao(() => fecharPeriodo(id, versao, chave), t('fechou'));
const reabrir = (id: number, versao: number) =>
  acao(() => reabrirPeriodo(id, versao, motivo.value, chave), t('reabriu'));
</script>

<template>
  <section aria-labelledby="pf-titulo" data-testid="pf-faturamento-periodo">
    <h2 id="pf-titulo">{{ t('titulo') }}</h2>
    <ErroFaturamento v-if="consulta.error.value" :erro="consulta.error.value" />
    <template v-else-if="dados && dados.periodos.length">
      <table class="tabela" data-testid="pf-periodos">
        <thead>
          <tr>
            <th scope="col">{{ t('competencia') }}</th>
            <th scope="col">{{ t('faixa') }}</th>
            <th scope="col">{{ t('itens') }}</th>
            <th scope="col">{{ t('valor') }}</th>
            <th scope="col">{{ t('guias') }}</th>
            <th scope="col">{{ t('situacao') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in dados.periodos" :key="p.id" :data-testid="`pf-periodo-${p.sequencia}`">
            <td>{{ mes(p.competencia) }}</td>
            <td>{{ t('faixaTexto', { inicio: quando(p.inicio), fim: quando(p.fim) }) }}</td>
            <td>{{ p.itens }}</td>
            <td>{{ reais(p.valor) }}</td>
            <td>{{ p.guias.length ? p.guias.join(', ') : t('nenhuma') }}</td>
            <td>{{ p.fechado ? t('fechado', { quando: quando(p.fechadoEm) }) : t('aberto') }}</td>
            <td>
              <template v-if="dados.editavel && !p.fechado">
                <button
                  type="button"
                  :disabled="gravando || bloqueioFechar(p.id).length > 0"
                  :title="bloqueioFechar(p.id).join(' ')"
                  :data-testid="`pf-fechar-${p.sequencia}`"
                  @click="fechar(p.id, p.versao)"
                >
                  {{ t('fechar') }}
                </button>
                <small v-if="bloqueioFechar(p.id).length" class="secundario">{{
                  bloqueioFechar(p.id).join(' ')
                }}</small>
              </template>
              <template v-else-if="dados.editavel && p.fechado">
                <button
                  v-if="reabrindo !== p.id"
                  type="button"
                  :data-testid="`pf-reabrir-${p.sequencia}`"
                  @click="reabrindo = p.id"
                >
                  {{ t('reabrir') }}
                </button>
                <span v-else>
                  <label>
                    {{ t('motivo') }}
                    <input v-model="motivo" data-testid="pf-motivo" maxlength="300" />
                  </label>
                  <button
                    type="button"
                    :disabled="gravando || errosReabrir.length > 0"
                    data-testid="pf-confirmar-reabertura"
                    @click="reabrir(p.id, p.versao)"
                  >
                    {{ t('confirmar') }}
                  </button>
                  <ul v-if="errosReabrir.length" class="erros" role="alert" data-testid="pf-erros-reabertura">
                    <li v-for="e in errosReabrir" :key="e">{{ e }}</li>
                  </ul>
                </span>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="dados.semPeriodo.itens" role="status" data-testid="pf-sem-periodo">
        {{ t('semPeriodo', { itens: dados.semPeriodo.itens, valor: reais(dados.semPeriodo.valor) }) }}
      </p>
      <h3>{{ t('porCompetencia') }}</h3>
      <ul data-testid="pf-competencias">
        <li v-for="c in dados.porCompetencia" :key="c.competencia">
          {{ mes(c.competencia) }}: {{ c.itens }} {{ t('itens').toLowerCase() }}, {{ reais(c.valor) }}
        </li>
      </ul>
    </template>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="pf-mensagem" />
  </section>
</template>
