<script setup lang="ts">
import { SanteSelecao } from '@sgh/ui';
// F3.8, 07-FIN linha 100: o de-para contábil mantido aqui, por evento. Uma grade evento × lado (débito e crédito) com a
// conta do escritório contábil, gravada ao sair do campo (validação na hora); a exceção por natureza entra na mesma
// linha; o que falta mapear no período aparece em cima, para corrigir antes de exportar. O centro de custo ganha o
// código externo na lista ao lado. Desligar uma regra mantém a linha (histórico na trilha).
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import { gravarDePara, type Lado, lerDeParaCompleto, lerSemDePara } from '../api-contabil-fiscal.js';

const props = defineProps<{ periodo: string; regua: string; podeEditar: boolean }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'De-para contábil por evento',
      texto:
        'A conta do escritório contábil de cada lado do lançamento. A exceção por natureza vence a regra geral do evento.',
      evento: 'Evento',
      natureza: 'Natureza (opcional)',
      todas: 'Todas as naturezas',
      debito: 'Conta de débito',
      credito: 'Conta de crédito',
      adicionar: 'Adicionar exceção por natureza',
      contaExcecao: 'Conta da exceção',
      ladoExcecao: 'Lado da exceção',
      herda: 'herda {conta} da regra geral',
      semGeral: 'sem conta: o lançamento fica fora do lote',
      desligar: 'Desligar',
      faltam: 'Falta conta no período: {n} lançamento(s) ficariam fora do lote',
      nadaFalta: 'Todos os lançamentos do período têm conta nos dois lados.',
      centros: 'Código do centro de custo no escritório contábil',
      gravado: 'Gravado',
      lados: { debito: 'débito', credito: 'crédito', ambos: 'ambos' },
    },
  },
});
const qc = useQueryClient();
const dados = useQuery({ queryKey: ['financeiro', 'de-para-completo'], queryFn: () => lerDeParaCompleto() });
const faltas = useQuery({
  queryKey: computed(() => ['financeiro', 'sem-de-para', props.periodo, props.regua]),
  queryFn: () => lerSemDePara(props.periodo, props.regua),
  enabled: computed(() => /^\d{4}-\d{2}$/.test(props.periodo)),
});
const erro = ref<unknown>(null);
const ok = ref('');
const novaNatureza = ref<Record<string, number | null>>({});
const novaConta = ref<Record<string, string>>({});
const novoLado = ref<Record<string, 'debito' | 'credito'>>({});
const CONTA = /^[0-9A-Za-z][0-9A-Za-z.-]{0,49}$/;
/** A exceção só grava com natureza e conta válida digitadas na linha (sem conta de reserva). */
const excecaoPronta = (evento: string) =>
  !!novaNatureza.value[evento] && CONTA.test((novaConta.value[evento] ?? '').trim());

/** As linhas da grade: a regra geral de cada evento e as exceções por natureza já gravadas. */
const linhas = computed(() => {
  const d = dados.data.value;
  if (!d) return [];
  const chaves = new Map<string, { evento: string; natureza: number | null }>();
  for (const e of d.eventos) chaves.set(`${e.codigo}|`, { evento: e.codigo, natureza: null });
  for (const r of d.regras)
    if (r.ativo) chaves.set(`${r.evento}|${r.natureza ?? ''}`, { evento: r.evento, natureza: r.natureza });
  return [...chaves.values()].map((k) => ({
    ...k,
    rotulo: d.eventos.find((e) => e.codigo === k.evento)?.descricao ?? k.evento,
    natureza: k.natureza,
    nomeNatureza: d.naturezas.find((n) => n.id === k.natureza)?.descricao ?? t('todas'),
    debito: d.regras.find(
      (r) => r.ativo && r.evento === k.evento && r.natureza === k.natureza && r.lado !== 'credito',
    ),
    credito: d.regras.find(
      (r) => r.ativo && r.evento === k.evento && r.natureza === k.natureza && r.lado !== 'debito',
    ),
    /** Na exceção, a conta que o lado vazio herda da regra geral do evento (texto de apoio). */
    herdada: {
      debito: d.regras.find(
        (r) => r.ativo && r.evento === k.evento && r.natureza === null && r.lado !== 'credito',
      )?.conta,
      credito: d.regras.find(
        (r) => r.ativo && r.evento === k.evento && r.natureza === null && r.lado !== 'debito',
      )?.conta,
    },
  }));
});
const totalFaltas = computed(() => (faltas.data.value ?? []).reduce((s, f) => s + f.fatos, 0));

async function salvar(corpo: Record<string, unknown>) {
  erro.value = null;
  ok.value = '';
  try {
    const r = await gravarDePara(corpo, novaChave('de-para'));
    ok.value = r.mensagem;
    await qc.invalidateQueries({ queryKey: ['financeiro', 'de-para-completo'] });
    await qc.invalidateQueries({ queryKey: ['financeiro', 'sem-de-para'] });
  } catch (e) {
    erro.value = e;
  }
}
function contaAlterada(l: (typeof linhas.value)[number], lado: 'debito' | 'credito', valor: string) {
  const atual = l[lado];
  const conta = valor.trim();
  if (atual && atual.conta === conta) return;
  if (atual && atual.lado === lado)
    return salvar({
      tipo: 'conta',
      id: atual.id,
      versao: atual.versao,
      evento: l.evento,
      lado,
      natureza: l.natureza,
      conta: conta || atual.conta,
      ativo: conta !== '',
    });
  if (!conta) return;
  return salvar({
    tipo: 'conta',
    id: null,
    evento: l.evento,
    lado: lado as Lado,
    natureza: l.natureza,
    conta,
    ativo: true,
  });
}
async function adicionarExcecao(evento: string) {
  if (!excecaoPronta(evento)) return;
  await salvar({
    tipo: 'conta',
    id: null,
    evento,
    lado: novoLado.value[evento] ?? 'debito',
    natureza: novaNatureza.value[evento],
    conta: (novaConta.value[evento] ?? '').trim(),
    ativo: true,
  });
  if (!erro.value) {
    novaNatureza.value[evento] = null;
    novaConta.value[evento] = '';
  }
}
/** O código externo do centro: vazio desliga a regra atual (mandando o código que ela tem), nunca um marcador. */
function centroAlterado(c: { id: number; externo: string | null }, valor: string) {
  const v = valor.trim();
  if (v === (c.externo ?? '')) return;
  if (v) return salvar({ tipo: 'centro', centro: c.id, codigo: v, ativo: true });
  return c.externo ? salvar({ tipo: 'centro', centro: c.id, codigo: c.externo, ativo: false }) : undefined;
}
</script>

<template>
  <section aria-labelledby="dp-titulo" data-testid="dp-painel">
    <h2 id="dp-titulo">{{ t('titulo') }}</h2>
    <p>{{ t('texto') }}</p>
    <p v-if="faltas.data.value?.length" class="aviso" role="status" data-testid="dp-faltam">
      {{ t('faltam', { n: totalFaltas }) }}:
      <span v-for="f in faltas.data.value" :key="`${f.evento}${f.natureza}${f.lado}`">
        {{
          `${dados.data.value?.eventos.find((e) => e.codigo === f.evento)?.descricao ?? f.evento} (${t(`lados.${f.lado}`)}: ${f.fatos});`
        }}
      </span>
    </p>
    <p v-else-if="faltas.data.value" class="secundario" data-testid="dp-completo">{{ t('nadaFalta') }}</p>
    <ErroFaturamento v-if="erro || dados.error.value" :erro="erro ?? dados.error.value" />
    <p v-if="ok" role="status" class="secundario" data-testid="dp-ok">{{ ok }}</p>
    <table class="tabela" data-testid="dp-grade">
      <thead>
        <tr>
          <th scope="col">{{ t('evento') }}</th>
          <th scope="col">{{ t('natureza') }}</th>
          <th scope="col">{{ t('debito') }}</th>
          <th scope="col">{{ t('credito') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="l in linhas"
          :key="`${l.evento}|${l.natureza}`"
          :data-testid="`dp-linha-${l.evento}-${l.natureza ?? 'geral'}`"
        >
          <th scope="row">{{ l.rotulo }}</th>
          <td>
            {{ l.nomeNatureza }}
            <span v-if="l.natureza === null && podeEditar">
              <SanteSelecao
                :model-value="novaNatureza[l.evento] ?? null"
                @update:model-value="(v) => (novaNatureza[l.evento] = v)"
                :rotulo="t('adicionar')"
                ocultar-rotulo
                :opcoes="[
                  { valor: null, rotulo: t('todas') },
                  ...(dados.data.value?.naturezas ?? []).map((n) => ({
                    valor: n.id,
                    rotulo: `${n.codigo} ${n.descricao}`,
                  })),
                ]"
                :data-testid="`dp-nat-${l.evento}`"
              />
              <SanteSelecao
                :model-value="novoLado[l.evento] ?? 'debito'"
                @update:model-value="(v) => (novoLado[l.evento] = v)"
                :rotulo="t('ladoExcecao')"
                ocultar-rotulo
                :opcoes="[
                  { valor: 'debito' as const, rotulo: t('lados.debito') },
                  { valor: 'credito' as const, rotulo: t('lados.credito') },
                ]"
                :data-testid="`dp-nat-lado-${l.evento}`"
              />
              <input
                v-model="novaConta[l.evento]"
                maxlength="50"
                required
                pattern="[0-9A-Za-z][0-9A-Za-z.\-]*"
                :aria-label="t('contaExcecao')"
                :data-testid="`dp-nat-conta-${l.evento}`"
              />
              <button
                type="button"
                :disabled="!excecaoPronta(l.evento)"
                :data-testid="`dp-nat-adicionar-${l.evento}`"
                @click="adicionarExcecao(l.evento)"
              >
                {{ t('adicionar') }}
              </button>
            </span>
          </td>
          <td v-for="lado in ['debito', 'credito'] as const" :key="lado">
            <input
              :value="l[lado]?.conta ?? ''"
              :disabled="!podeEditar"
              maxlength="50"
              pattern="[0-9A-Za-z][0-9A-Za-z.\-]*"
              :aria-label="`${l.rotulo} ${t(lado)}`"
              :data-testid="`dp-${lado}-${l.evento}-${l.natureza ?? 'geral'}`"
              @change="contaAlterada(l, lado, ($event.target as HTMLInputElement).value)"
            />
            <small
              v-if="l.natureza !== null && !l[lado]"
              class="secundario"
              :data-testid="`dp-herda-${lado}-${l.evento}-${l.natureza}`"
            >
              {{ l.herdada[lado] ? t('herda', { conta: l.herdada[lado] }) : t('semGeral') }}
            </small>
          </td>
        </tr>
      </tbody>
    </table>
    <h3>{{ t('centros') }}</h3>
    <ul class="lista-simples" data-testid="dp-centros">
      <li v-for="c in dados.data.value?.centros" :key="c.id">
        <label :for="`dp-cc-${c.id}`">{{ c.codigo }} {{ c.nome }}</label>
        <input
          :id="`dp-cc-${c.id}`"
          :value="c.externo ?? ''"
          :disabled="!podeEditar"
          maxlength="40"
          :data-testid="`dp-cc-${c.id}`"
          @change="centroAlterado(c, ($event.target as HTMLInputElement).value)"
        />
      </li>
    </ul>
  </section>
</template>
