<script setup lang="ts">
// Simulação de cenários de receita sobre a produção real (F8, 01-ADM L120): `/faturamento/simulacao-receita`. Numa tela
// só: o cenário (por convênio, a tabela de preço nova ou o convênio simulado, o reajuste e o de-para de procedimentos
// pelo código, com fatores), conferido enquanto se digita pela mesma regra do servidor; "Salvar e simular" grava o
// cenário e já recalcula a produção do período pelo motor de preços da conta (um clique); o resultado mostra os totais
// com as parcelas, a diferença por convênio, por grupo de faturamento e por tipo de atendimento, os procedimentos de
// maior impacto e o que não se conseguiu precificar. Nada muda nas contas: cada execução é uma fotografia, e as
// anteriores ficam no histórico do cenário.
import {
  type CenarioReceitaEntrada,
  type DataReferenciaSimulacao,
  type TipoAtendimentoFiltro,
  validarCenarioReceita,
} from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChave } from '../api-faturamento.js';
import {
  criarCenarioReceita,
  executarSimulacaoReceita,
  lerPainelSimulacaoReceita,
  lerSimulacaoReceita,
} from '../api-simulacao-receita.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';
import { quando } from '../usar-faturamento.js';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Simulação de receita',
      explicacao:
        'Recalcula a produção real de um período com outra tabela de preço, outro convênio, um reajuste ou a troca de procedimentos. As contas não mudam.',
      novo: 'Novo cenário',
      nome: 'Nome do cenário',
      inicio: 'Produção de',
      fim: 'até',
      recorte: 'Recortar a produção pela',
      competencia: 'competência da conta',
      atendimento: 'data do atendimento',
      tipoAtendimento: 'Tipo de atendimento',
      todos: 'Todos',
      ambulatorial: 'Ambulatorial',
      urgencia: 'Urgência',
      internacao: 'Internação',
      externo: 'Externo',
      domiciliar: 'Domiciliar',
      semTipo: 'Sem tipo',
      convenio: 'Convênio da produção',
      plano: 'Plano',
      todosPlanos: 'Todos os planos',
      tabelaNova: 'Tabela de preço simulada',
      mesmaTabela: 'A mesma de hoje',
      convenioSimulado: 'Convênio simulado',
      mesmoConvenio: 'O mesmo',
      reajuste: 'Reajuste (%)',
      conversoes: 'Troca de procedimentos',
      codigoAtual: 'Código cobrado hoje',
      codigoDestino: 'Código simulado',
      fatorAtual: 'Fator atual',
      fatorDestino: 'Fator simulado',
      acrescimo: 'Acréscimo (R$)',
      mantemValor: 'Conserva o valor',
      novaConversao: 'Adicionar troca de procedimento',
      novoConvenio: 'Adicionar convênio',
      remover: 'Remover',
      salvarSimular: 'Salvar e simular',
      simulando: 'Simulando…',
      cenarios: 'Cenários',
      semCenarios: 'Nenhum cenário ainda.',
      periodo: 'Período',
      situacao: 'Situação',
      base: 'Receita atual',
      simulada: 'Receita simulada',
      diferenca: 'Diferença',
      simularDeNovo: 'Simular de novo',
      verResultado: 'Ver resultado',
      rascunho: 'Rascunho',
      processando: 'Processando',
      concluido: 'Concluído',
      falhou: 'Falhou',
      arquivado: 'Arquivado',
      resultado: 'Resultado de {cenario}',
      execucao: 'Executada em {quando}, pela {recorte}',
      valorAtual: 'Valor atual',
      valorSimulado: 'Valor simulado',
      percentual: 'Variação',
      itens: '{n} itens da produção',
      porConvenio: 'Por convênio',
      porGrupo: 'Por grupo de faturamento',
      porTipo: 'Por tipo de atendimento',
      procedimentos: 'Procedimentos de maior impacto',
      grupo: 'Grupo',
      quantidade: 'Quantidade',
      codigo: 'Código',
      descricao: 'Procedimento',
      inconsistencias: 'Itens sem preço simulado ({n})',
      semInconsistencias: 'Todos os itens foram precificados.',
      motivo: 'Motivo',
      data: 'Primeira data',
      sem_preco_destino: 'Sem preço na tabela simulada',
      fator_invalido: 'Fator de conversão inválido',
      outro: 'Recusado pelo motor de preços',
      gravado: 'Cenário gravado e simulado.',
      reexecutado: 'Simulação refeita.',
    },
  },
});

interface ConversaoForm {
  itemAtualCodigo: string;
  itemDestinoCodigo: string;
  fatorAtual: number;
  fatorDestino: number;
  acrescimoValor: number | null;
  mantemValorOriginal: boolean;
}
interface RegraForm {
  fontePagadoraId: number;
  planoId: number;
  tabelaDestinoId: number;
  fonteDestinoId: number;
  percentualAjuste: number | null;
  conversoes: ConversaoForm[];
}
const novaRegra = (): RegraForm => ({
  fontePagadoraId: 0,
  planoId: 0,
  tabelaDestinoId: 0,
  fonteDestinoId: 0,
  percentualAjuste: null,
  conversoes: [],
});
const novaConversao = (): ConversaoForm => ({
  itemAtualCodigo: '',
  itemDestinoCodigo: '',
  fatorAtual: 1,
  fatorDestino: 1,
  acrescimoValor: null,
  mantemValorOriginal: false,
});

const qc = useQueryClient();
const painel = useQuery({
  queryKey: ['faturamento', 'simulacao-receita'],
  queryFn: lerPainelSimulacaoReceita,
});
const op = computed(() => painel.data.value?.opcoes);
const selecionada = ref<number | null>(null);
const detalhe = useQuery({
  queryKey: ['faturamento', 'simulacao-receita', 'execucao', selecionada],
  queryFn: () => lerSimulacaoReceita(selecionada.value!),
  enabled: computed(() => selecionada.value !== null),
});

const hoje = new Date();
const p2 = (x: number) => String(x).padStart(2, '0');
const mesPassado = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
const fimMesPassado = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const form = reactive({
  nome: '',
  producaoInicio: iso(mesPassado),
  producaoFim: iso(fimMesPassado),
  dataReferencia: 'competencia' as DataReferenciaSimulacao,
  tipoAtendimento: '' as TipoAtendimentoFiltro | '',
  regras: [novaRegra()] as RegraForm[],
});
const tocado = ref(false);
const idOuNulo = (v: number) => (v > 0 ? v : null);
const entrada = computed<CenarioReceitaEntrada>(() => ({
  nome: form.nome,
  producaoInicio: form.producaoInicio,
  producaoFim: form.producaoFim,
  dataReferencia: form.dataReferencia,
  tipoAtendimento: form.tipoAtendimento || null,
  regras: form.regras.map((r) => ({
    fontePagadoraId: r.fontePagadoraId,
    planoId: idOuNulo(r.planoId),
    tabelaDestinoId: idOuNulo(r.tabelaDestinoId),
    fonteDestinoId: idOuNulo(r.fonteDestinoId),
    planoDestinoId: null,
    percentualAjuste:
      r.percentualAjuste === null || (r.percentualAjuste as unknown) === ''
        ? null
        : Number(r.percentualAjuste),
    conversoes: r.conversoes.map((c) => ({
      itemAtualCodigo: c.itemAtualCodigo.trim(),
      itemDestinoCodigo: c.itemDestinoCodigo.trim(),
      fatorAtual: Number(c.fatorAtual),
      fatorDestino: Number(c.fatorDestino),
      acrescimoValor:
        c.acrescimoValor === null || (c.acrescimoValor as unknown) === '' ? null : Number(c.acrescimoValor),
      mantemValorOriginal: c.mantemValorOriginal,
    })),
  })),
}));
const erros = computed(() => validarCenarioReceita(entrada.value));
const temErro = computed(() => Object.keys(erros.value).length > 0);
const erroDe = (campo: string) => (tocado.value ? (erros.value[campo] ?? null) : null);

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('simulacao-receita');

const opcoesDe = (lista: readonly { id: number; descricao: string }[] | undefined, vazio: string) => [
  { valor: 0, rotulo: vazio },
  ...(lista ?? []).map((o) => ({ valor: o.id, rotulo: o.descricao })),
];
const planosDe = (fonte: number) => (op.value?.planos ?? []).filter((p) => p.fonteId === fonte);
const tabelasPara = (r: RegraForm) => {
  const alvo = r.fonteDestinoId || r.fontePagadoraId;
  return (op.value?.tabelas ?? []).filter((x) => x.fonteId === null || x.fonteId === alvo);
};
const TIPOS = ['ambulatorial', 'urgencia', 'internacao', 'externo'] as const;
const reais = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: number | null) =>
  v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const ultimaDe = (cenario: number) =>
  painel.data.value?.execucoes.find((x) => x.cenarioId === cenario) ?? null;

async function acao(f: () => Promise<number>, texto: string) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    selecionada.value = await f();
    mensagem.value = texto;
    chave = novaChave('simulacao-receita');
    await qc.invalidateQueries({ queryKey: ['faturamento', 'simulacao-receita'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
function salvarESimular() {
  tocado.value = true;
  if (temErro.value) return;
  const corpo = entrada.value;
  return acao(async () => {
    const c = await criarCenarioReceita(corpo, chave);
    const x = await executarSimulacaoReceita(c.id, corpo.dataReferencia, `${chave}.x`);
    form.nome = '';
    form.regras = [novaRegra()];
    tocado.value = false;
    return x.id;
  }, t('gravado'));
}
const simularDeNovo = (cenario: number) =>
  acao(
    async () => (await executarSimulacaoReceita(cenario, form.dataReferencia, chave)).id,
    t('reexecutado'),
  );
</script>

<template>
  <section class="tela" data-testid="tela-simulacao-receita">
    <h1>{{ t('titulo') }}</h1>
    <p>{{ t('explicacao') }}</p>
    <ErroFaturamento v-if="painel.error.value" :erro="painel.error.value" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento v-if="mensagem" :texto="mensagem" />

    <form data-testid="sr-cenario" @submit.prevent="salvarESimular">
      <h2>{{ t('novo') }}</h2>
      <label>
        {{ t('nome') }}
        <input v-model="form.nome" type="text" maxlength="150" data-testid="sr-nome" @blur="tocado = true" />
      </label>
      <small v-if="erroDe('nome')" class="erro">{{ erroDe('nome') }}</small>
      <label>
        {{ t('inicio') }}
        <input v-model="form.producaoInicio" type="date" data-testid="sr-inicio" />
      </label>
      <label>
        {{ t('fim') }}
        <input v-model="form.producaoFim" type="date" data-testid="sr-fim" />
      </label>
      <small
        v-if="erros['producaoInicio'] || erros['producaoFim']"
        class="erro"
        data-testid="sr-erro-periodo"
      >
        {{ erros['producaoInicio'] ?? erros['producaoFim'] }}
      </small>
      <SanteSelecao
        v-model="form.dataReferencia"
        :rotulo="t('recorte')"
        :opcoes="[
          { valor: 'competencia' as const, rotulo: t('competencia') },
          { valor: 'atendimento' as const, rotulo: t('atendimento') },
        ]"
        data-testid="sr-recorte"
      />
      <SanteSelecao
        v-model="form.tipoAtendimento"
        :rotulo="t('tipoAtendimento')"
        :opcoes="[
          { valor: '' as const, rotulo: t('todos') },
          ...TIPOS.map((x) => ({ valor: x, rotulo: t(x) })),
        ]"
        data-testid="sr-tipo"
      />

      <fieldset v-for="(r, i) in form.regras" :key="i" :data-testid="`sr-regra-${i}`">
        <legend>{{ t('convenio') }} {{ i + 1 }}</legend>
        <SanteSelecao
          v-model="r.fontePagadoraId"
          :rotulo="t('convenio')"
          :opcoes="opcoesDe(op?.fontes, '')"
          :data-testid="`sr-regra-${i}-convenio`"
          @update:model-value="r.planoId = 0"
        />
        <small v-if="erroDe(`regras.${i}.fontePagadoraId`)" class="erro">
          {{ erroDe(`regras.${i}.fontePagadoraId`) }}
        </small>
        <SanteSelecao
          v-model="r.planoId"
          :rotulo="t('plano')"
          :opcoes="opcoesDe(planosDe(r.fontePagadoraId), t('todosPlanos'))"
          :data-testid="`sr-regra-${i}-plano`"
        />
        <small v-if="erros[`regras.${i}.planoId`]" class="erro">{{ erros[`regras.${i}.planoId`] }}</small>
        <SanteSelecao
          v-model="r.tabelaDestinoId"
          :rotulo="t('tabelaNova')"
          :opcoes="opcoesDe(tabelasPara(r), t('mesmaTabela'))"
          :data-testid="`sr-regra-${i}-tabela`"
        />
        <SanteSelecao
          v-model="r.fonteDestinoId"
          :rotulo="t('convenioSimulado')"
          :opcoes="opcoesDe(op?.fontes, t('mesmoConvenio'))"
          :data-testid="`sr-regra-${i}-destino`"
        />
        <small v-if="erros[`regras.${i}.fonteDestinoId`]" class="erro">
          {{ erros[`regras.${i}.fonteDestinoId`] }}
        </small>
        <label>
          {{ t('reajuste') }}
          <input
            v-model.number="r.percentualAjuste"
            type="number"
            step="0.01"
            :data-testid="`sr-regra-${i}-reajuste`"
          />
        </label>
        <small v-if="erros[`regras.${i}.percentualAjuste`]" class="erro">
          {{ erros[`regras.${i}.percentualAjuste`] }}
        </small>
        <small v-if="erroDe(`regras.${i}.destino`)" class="erro" :data-testid="`sr-regra-${i}-erro-destino`">
          {{ erroDe(`regras.${i}.destino`) }}
        </small>

        <table v-if="r.conversoes.length" class="tabela" :data-testid="`sr-regra-${i}-conversoes`">
          <caption>
            {{
              t('conversoes')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('codigoAtual') }}</th>
              <th scope="col">{{ t('codigoDestino') }}</th>
              <th scope="col">{{ t('fatorAtual') }}</th>
              <th scope="col">{{ t('fatorDestino') }}</th>
              <th scope="col">{{ t('acrescimo') }}</th>
              <th scope="col">{{ t('mantemValor') }}</th>
              <th scope="col">
                <span class="sr-only">{{ t('remover') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(c, j) in r.conversoes" :key="j">
              <td>
                <input
                  v-model="c.itemAtualCodigo"
                  type="text"
                  maxlength="20"
                  :aria-label="t('codigoAtual')"
                  :data-testid="`sr-conv-${i}-${j}-atual`"
                />
                <small v-if="erroDe(`regras.${i}.conversoes.${j}.itemAtualCodigo`)" class="erro">
                  {{ erroDe(`regras.${i}.conversoes.${j}.itemAtualCodigo`) }}
                </small>
              </td>
              <td>
                <input
                  v-model="c.itemDestinoCodigo"
                  type="text"
                  maxlength="20"
                  :aria-label="t('codigoDestino')"
                  :data-testid="`sr-conv-${i}-${j}-destino`"
                />
                <small
                  v-if="erroDe(`regras.${i}.conversoes.${j}.itemDestinoCodigo`)"
                  class="erro"
                  :data-testid="`sr-conv-${i}-${j}-erro-destino`"
                >
                  {{ erroDe(`regras.${i}.conversoes.${j}.itemDestinoCodigo`) }}
                </small>
              </td>
              <td>
                <input
                  v-model.number="c.fatorAtual"
                  type="number"
                  step="0.0001"
                  min="0"
                  :aria-label="t('fatorAtual')"
                  :data-testid="`sr-conv-${i}-${j}-fator-atual`"
                />
                <small v-if="erros[`regras.${i}.conversoes.${j}.fatorAtual`]" class="erro">
                  {{ erros[`regras.${i}.conversoes.${j}.fatorAtual`] }}
                </small>
              </td>
              <td>
                <input
                  v-model.number="c.fatorDestino"
                  type="number"
                  step="0.0001"
                  min="0"
                  :aria-label="t('fatorDestino')"
                  :data-testid="`sr-conv-${i}-${j}-fator-destino`"
                />
                <small v-if="erros[`regras.${i}.conversoes.${j}.fatorDestino`]" class="erro">
                  {{ erros[`regras.${i}.conversoes.${j}.fatorDestino`] }}
                </small>
              </td>
              <td>
                <input
                  v-model.number="c.acrescimoValor"
                  type="number"
                  step="0.01"
                  :aria-label="t('acrescimo')"
                  :data-testid="`sr-conv-${i}-${j}-acrescimo`"
                />
              </td>
              <td>
                <input
                  v-model="c.mantemValorOriginal"
                  type="checkbox"
                  :aria-label="t('mantemValor')"
                  :data-testid="`sr-conv-${i}-${j}-mantem`"
                />
              </td>
              <td>
                <button
                  type="button"
                  :data-testid="`sr-conv-${i}-${j}-remover`"
                  @click="r.conversoes.splice(j, 1)"
                >
                  {{ t('remover') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <button
          type="button"
          :data-testid="`sr-regra-${i}-nova-conversao`"
          @click="r.conversoes.push(novaConversao())"
        >
          {{ t('novaConversao') }}
        </button>
        <button
          v-if="form.regras.length > 1"
          type="button"
          :data-testid="`sr-regra-${i}-remover`"
          @click="form.regras.splice(i, 1)"
        >
          {{ t('remover') }}
        </button>
      </fieldset>
      <button type="button" data-testid="sr-novo-convenio" @click="form.regras.push(novaRegra())">
        {{ t('novoConvenio') }}
      </button>
      <button type="submit" :disabled="gravando || (tocado && temErro)" data-testid="sr-salvar">
        {{ gravando ? t('simulando') : t('salvarSimular') }}
      </button>
    </form>

    <h2>{{ t('cenarios') }}</h2>
    <table v-if="painel.data.value?.cenarios.length" class="tabela" data-testid="sr-cenarios">
      <thead>
        <tr>
          <th scope="col">{{ t('nome') }}</th>
          <th scope="col">{{ t('periodo') }}</th>
          <th scope="col">{{ t('situacao') }}</th>
          <th scope="col">{{ t('base') }}</th>
          <th scope="col">{{ t('simulada') }}</th>
          <th scope="col">{{ t('diferenca') }}</th>
          <th scope="col">
            <span class="sr-only">{{ t('verResultado') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in painel.data.value.cenarios" :key="c.id" :data-testid="`sr-cenario-${c.id}`">
          <td>{{ c.nome }}</td>
          <td>{{ c.producaoInicio }} — {{ c.producaoFim }}</td>
          <td>{{ t(c.situacao) }}</td>
          <td>{{ c.receitaBase === null ? '—' : reais(c.receitaBase) }}</td>
          <td>{{ c.receitaSimulada === null ? '—' : reais(c.receitaSimulada) }}</td>
          <td>
            {{
              c.receitaBase === null || c.receitaSimulada === null
                ? '—'
                : reais(c.receitaSimulada - c.receitaBase)
            }}
          </td>
          <td>
            <button
              v-if="ultimaDe(c.id)"
              type="button"
              :data-testid="`sr-ver-${c.id}`"
              @click="selecionada = ultimaDe(c.id)!.id"
            >
              {{ t('verResultado') }}
            </button>
            <button
              type="button"
              :disabled="gravando"
              :data-testid="`sr-refazer-${c.id}`"
              @click="simularDeNovo(c.id)"
            >
              {{ t('simularDeNovo') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="painel.data.value" data-testid="sr-sem-cenarios">{{ t('semCenarios') }}</p>

    <ErroFaturamento v-if="detalhe.error.value" :erro="detalhe.error.value" />
    <section v-if="selecionada !== null && detalhe.data.value" data-testid="sr-resultado">
      <h2>{{ t('resultado', { cenario: detalhe.data.value.simulacao.cenario }) }}</h2>
      <p>
        {{
          t('execucao', {
            quando: detalhe.data.value.simulacao.solicitadoEm
              ? quando(detalhe.data.value.simulacao.solicitadoEm)
              : '—',
            recorte: t(detalhe.data.value.simulacao.dataReferencia),
          })
        }}
        · {{ t('itens', { n: detalhe.data.value.simulacao.quantidadeItens }) }}
      </p>
      <dl class="resumo" data-testid="sr-totais">
        <dt>{{ t('valorAtual') }}</dt>
        <dd data-testid="sr-total-atual">{{ reais(detalhe.data.value.simulacao.valorAtual) }}</dd>
        <dt>{{ t('valorSimulado') }}</dt>
        <dd data-testid="sr-total-simulado">{{ reais(detalhe.data.value.simulacao.valorSimulado) }}</dd>
        <dt>{{ t('diferenca') }}</dt>
        <dd data-testid="sr-total-diferenca">{{ reais(detalhe.data.value.simulacao.diferenca) }}</dd>
        <dt>{{ t('percentual') }}</dt>
        <dd data-testid="sr-total-percentual">{{ pct(detalhe.data.value.simulacao.percentual) }}</dd>
      </dl>

      <h3>{{ t('porConvenio') }}</h3>
      <table class="tabela" data-testid="sr-por-convenio">
        <thead>
          <tr>
            <th scope="col">{{ t('convenio') }}</th>
            <th scope="col">{{ t('convenioSimulado') }}</th>
            <th scope="col">{{ t('valorAtual') }}</th>
            <th scope="col">{{ t('valorSimulado') }}</th>
            <th scope="col">{{ t('diferenca') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in detalhe.data.value.porConvenio" :key="`${x.fonteId}-${x.fonteDestino}`">
            <td>{{ x.fonte }}</td>
            <td>{{ x.fonteDestino ?? t('mesmoConvenio') }}</td>
            <td>{{ reais(x.valorAtual) }}</td>
            <td>{{ reais(x.valorSimulado) }}</td>
            <td>{{ reais(x.diferenca) }}</td>
          </tr>
        </tbody>
      </table>

      <h3>{{ t('porGrupo') }}</h3>
      <table class="tabela" data-testid="sr-por-grupo">
        <thead>
          <tr>
            <th scope="col">{{ t('grupo') }}</th>
            <th scope="col">{{ t('quantidade') }}</th>
            <th scope="col">{{ t('valorAtual') }}</th>
            <th scope="col">{{ t('valorSimulado') }}</th>
            <th scope="col">{{ t('diferenca') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in detalhe.data.value.porGrupo" :key="x.grupoId ?? 0">
            <td>{{ x.grupo }}</td>
            <td>{{ x.quantidade }}</td>
            <td>{{ reais(x.valorAtual) }}</td>
            <td>{{ reais(x.valorSimulado) }}</td>
            <td>{{ reais(x.diferenca) }}</td>
          </tr>
        </tbody>
      </table>

      <h3>{{ t('porTipo') }}</h3>
      <table class="tabela" data-testid="sr-por-tipo">
        <thead>
          <tr>
            <th scope="col">{{ t('tipoAtendimento') }}</th>
            <th scope="col">{{ t('valorAtual') }}</th>
            <th scope="col">{{ t('valorSimulado') }}</th>
            <th scope="col">{{ t('diferenca') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in detalhe.data.value.porTipoAtendimento" :key="x.tipo ?? ''">
            <td>{{ x.tipo ? t(x.tipo) : t('semTipo') }}</td>
            <td>{{ reais(x.valorAtual) }}</td>
            <td>{{ reais(x.valorSimulado) }}</td>
            <td>{{ reais(x.diferenca) }}</td>
          </tr>
        </tbody>
      </table>

      <h3>{{ t('procedimentos') }}</h3>
      <table class="tabela" data-testid="sr-procedimentos">
        <thead>
          <tr>
            <th scope="col">{{ t('codigo') }}</th>
            <th scope="col">{{ t('descricao') }}</th>
            <th scope="col">{{ t('convenio') }}</th>
            <th scope="col">{{ t('tipoAtendimento') }}</th>
            <th scope="col">{{ t('quantidade') }}</th>
            <th scope="col">{{ t('valorAtual') }}</th>
            <th scope="col">{{ t('valorSimulado') }}</th>
            <th scope="col">{{ t('diferenca') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in detalhe.data.value.itens" :key="x.sequencia">
            <td>{{ x.codigo }}</td>
            <td>{{ x.descricao }}</td>
            <td>{{ x.fonte }}</td>
            <td>{{ x.tipo ? t(x.tipo) : t('semTipo') }}</td>
            <td>{{ x.quantidade }}</td>
            <td>{{ reais(x.valorAtual) }}</td>
            <td>{{ reais(x.valorSimulado) }}</td>
            <td>{{ reais(x.diferenca) }}</td>
          </tr>
        </tbody>
      </table>

      <h3>{{ t('inconsistencias', { n: detalhe.data.value.simulacao.quantidadeInconsistencias }) }}</h3>
      <table v-if="detalhe.data.value.inconsistencias.length" class="tabela" data-testid="sr-inconsistencias">
        <thead>
          <tr>
            <th scope="col">{{ t('codigoAtual') }}</th>
            <th scope="col">{{ t('codigoDestino') }}</th>
            <th scope="col">{{ t('motivo') }}</th>
            <th scope="col">{{ t('data') }}</th>
            <th scope="col">{{ t('descricao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in detalhe.data.value.inconsistencias" :key="x.sequencia">
            <td>{{ x.codigoAtual ?? '—' }} {{ x.descricaoAtual ?? '' }}</td>
            <td>{{ x.codigoDestino ?? '—' }}</td>
            <td>{{ t(x.motivo) }}</td>
            <td>{{ x.data ?? '—' }}</td>
            <td>{{ x.detalhe ?? '' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else data-testid="sr-sem-inconsistencias">{{ t('semInconsistencias') }}</p>
    </section>
  </section>
</template>
