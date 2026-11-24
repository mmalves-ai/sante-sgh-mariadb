<script setup lang="ts">
// "Cobrança por fonte pagadora" (F3.7, 06-FAT linhas 6, 8 e 9). Uma tela por fonte pagadora, com a conferência na
// frente: escolhida a fonte, o faturista vê na hora como o item sai na guia (código, quantidade, unidade, percentual,
// quem pode cobrar e por quê) e, na mesma tela, grava o de-para, o credenciamento, a exceção e a equivalência do
// mat/med com a operadora e a TUSS. Validação na hora (antes de gravar); nada se apaga: gravar encerra o anterior na
// véspera, e "Encerrar" só põe fim de hoje em diante (o servidor confere de novo). Formulários só com a permissão de
// editar; as listas, com a de ler.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  type AlvoEncerramento,
  type Conferencia,
  conferirCobranca,
  encerrarRegistro,
  gravarCredenciamento,
  gravarDePara,
  gravarEquivalenciaMatmed,
  gravarExcecao,
  type ListaCobranca,
  listarCredenciamentos,
  listarDePara,
  listarEquivalenciasMatmed,
  listarExcecoes,
} from '../api-cobranca.js';
import { listarConvenios } from '../api-precos.js';

const { t } = useI18n();
const hoje = new Date().toISOString().slice(0, 10);
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const num = (s: string): number | null => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
const podeContrato = computed(() => pode('convenio.contrato.editar'));
const podeCredenciar = computed(() => pode('convenio.credenciamento.editar'));

const convenios = useQuery({
  queryKey: ['convenios', '', 'todos'],
  queryFn: () => listarConvenios('', 'todos'),
});
const opcoesConvenio = computed(() =>
  (convenios.data.value?.itens ?? []).map((c) => ({
    valor: String(c.codigo),
    rotulo: `${c.codigo} — ${c.nome}`,
  })),
);
const convenio = ref('');
const fonte = computed(() => num(convenio.value));

type Aba = 'conferir' | 'dePara' | 'credenciamento' | 'excecoes' | 'matmed';
const ABAS: readonly Aba[] = ['conferir', 'dePara', 'credenciamento', 'excecoes', 'matmed'];
const aba = ref<Aba>('conferir');
const opcoesAtendimento = computed(() =>
  ['todos', 'ambulatorial', 'internacao', 'urgencia', 'externo'].map((x) => ({
    valor: x,
    rotulo: t(`cobrancaFonte.atendimentos.${x}`),
  })),
);

const erro = ref<unknown>(null);
const aviso = ref('');
const lista = ref<ListaCobranca | null>(null);
async function recarregar(): Promise<void> {
  lista.value = null;
  const f = fonte.value;
  try {
    if (aba.value === 'matmed') {
      const i = num(mm.item);
      lista.value = i === null ? null : await listarEquivalenciasMatmed(i);
      return;
    }
    if (f === null) return;
    if (aba.value === 'dePara') lista.value = await listarDePara(f);
    else if (aba.value === 'credenciamento') lista.value = await listarCredenciamentos(f);
    else if (aba.value === 'excecoes') lista.value = await listarExcecoes(f);
  } catch (e) {
    erro.value = e;
  }
}
watch([fonte, aba], () => {
  erro.value = null;
  aviso.value = '';
  encerrando.value = null;
  void recarregar();
});

async function enviar(fn: () => Promise<{ id: number }>): Promise<void> {
  erro.value = null;
  aviso.value = '';
  try {
    const r = await fn();
    aviso.value = t('cobrancaFonte.gravado', { id: r.id });
    await recarregar();
  } catch (e) {
    erro.value = e;
  }
}

// ── Conferência ─────────────────────────────────────────────────────────────────────────────────────
const cf = reactive({
  item: '',
  plano: '',
  profissional: '',
  atendimento: 'todos',
  quantidade: '1',
  data: hoje,
});
const conferencia = ref<Conferencia | null>(null);
async function conferir(): Promise<void> {
  erro.value = null;
  conferencia.value = null;
  if (fonte.value === null || num(cf.item) === null) return;
  try {
    conferencia.value = await conferirCobranca({
      convenio: fonte.value,
      item: num(cf.item),
      plano: num(cf.plano),
      profissional: num(cf.profissional),
      atendimento: cf.atendimento === 'todos' ? null : cf.atendimento,
      quantidade: num(cf.quantidade) ?? 1,
      data: cf.data,
    });
  } catch (e) {
    erro.value = e;
  }
}

// ── De-para ─────────────────────────────────────────────────────────────────────────────────────────
const dp = reactive({
  item: '',
  grupo: '',
  plano: '',
  atendimento: 'todos',
  codigo: '',
  descricao: '',
  unidade: '',
  mult: '1',
  div: '1',
  percentual: '',
  inicio: hoje,
});
const errosDePara = computed(() => {
  const e: string[] = [];
  if ((num(dp.item) === null) === (num(dp.grupo) === null)) e.push(t('cobrancaFonte.erros.itemOuGrupo'));
  if (!dp.codigo.trim()) e.push(t('cobrancaFonte.erros.codigo'));
  if (!DATA.test(dp.inicio)) e.push(t('cobrancaFonte.erros.inicio'));
  if ((num(dp.mult) ?? 0) <= 0 || (num(dp.div) ?? 0) <= 0) e.push(t('cobrancaFonte.erros.fatores'));
  return e;
});
const gravarDeParaForm = () =>
  enviar(() =>
    gravarDePara({
      fontePagadoraId: fonte.value,
      itemId: num(dp.item),
      grupoId: num(dp.grupo),
      planoId: num(dp.plano),
      tipoAtendimento: dp.atendimento,
      codigo: dp.codigo.trim(),
      descricao: dp.descricao.trim() || null,
      unidade: dp.unidade.trim() || null,
      fatorMultiplicacao: num(dp.mult) ?? 1,
      fatorDivisao: num(dp.div) ?? 1,
      percentual: num(dp.percentual),
      vigenciaInicio: dp.inicio,
    }),
  );

// ── Credenciamento ──────────────────────────────────────────────────────────────────────────────────
const cr = reactive({
  profissional: '',
  prestador: '',
  plano: '',
  grupoAto: '',
  codigo: '',
  direto: false,
  inicio: hoje,
});
const errosCredenciamento = computed(() => {
  const e: string[] = [];
  if ((num(cr.profissional) === null) === (num(cr.prestador) === null)) e.push(t('cobrancaFonte.erros.quem'));
  if (!DATA.test(cr.inicio)) e.push(t('cobrancaFonte.erros.inicio'));
  return e;
});
const gravarCredenciamentoForm = () =>
  enviar(() =>
    gravarCredenciamento({
      fontePagadoraId: fonte.value,
      planoId: num(cr.plano),
      profissionalId: num(cr.profissional),
      prestadorId: num(cr.prestador),
      grupoAtoId: num(cr.grupoAto),
      codigoNaFonte: cr.codigo.trim() || null,
      recebeDiretoDaFonte: cr.direto,
      vigenciaInicio: cr.inicio,
    }),
  );

// ── Exceção ─────────────────────────────────────────────────────────────────────────────────────────
const ex = reactive({
  sujeito: 'profissional',
  sujeitoId: '',
  item: '',
  grupo: '',
  plano: '',
  atendimento: 'todos',
  efeito: 'proibe',
  motivo: '',
  inicio: hoje,
});
const opcoesSujeito = computed(() =>
  ['profissional', 'prestador', 'equipe', 'credenciamento'].map((x) => ({
    valor: x,
    rotulo: t(`cobrancaFonte.sujeitos.${x}`),
  })),
);
const opcoesEfeito = computed(() =>
  ['proibe', 'permite'].map((x) => ({ valor: x, rotulo: t(`cobrancaFonte.efeitos.${x}`) })),
);
const errosExcecao = computed(() => {
  const e: string[] = [];
  if (num(ex.sujeitoId) === null) e.push(t('cobrancaFonte.erros.sujeito'));
  if (num(ex.item) !== null && num(ex.grupo) !== null) e.push(t('cobrancaFonte.erros.itemOuGrupo'));
  if (ex.efeito === 'proibe' && !ex.motivo.trim()) e.push(t('cobrancaFonte.erros.motivo'));
  if (!DATA.test(ex.inicio)) e.push(t('cobrancaFonte.erros.inicio'));
  return e;
});
const gravarExcecaoForm = () => {
  const s = num(ex.sujeitoId);
  return enviar(() =>
    gravarExcecao({
      credenciamentoId: ex.sujeito === 'credenciamento' ? s : null,
      profissionalId: ex.sujeito === 'profissional' ? s : null,
      prestadorId: ex.sujeito === 'prestador' ? s : null,
      equipeId: ex.sujeito === 'equipe' ? s : null,
      fontePagadoraId: fonte.value,
      planoId: num(ex.plano),
      tipoAtendimento: ex.atendimento,
      grupoId: num(ex.grupo),
      itemId: num(ex.item),
      efeito: ex.efeito,
      motivo: ex.motivo.trim() || null,
      vigenciaInicio: ex.inicio,
    }),
  );
};

// ── Mat/med da referência de mercado ────────────────────────────────────────────────────────────────
const mm = reactive({
  item: '',
  codigo: '',
  descricao: '',
  unidade: '',
  fator: '1',
  termo: '',
  tipoTuss: '',
  inicio: hoje,
});
const opcoesTuss = computed(() =>
  ['', 'exata', 'aproximada', 'generica'].map((x) => ({
    valor: x,
    rotulo: t(`cobrancaFonte.tiposTuss.${x}`),
  })),
);
const errosMatmed = computed(() => {
  const e: string[] = [];
  if (num(mm.item) === null) e.push(t('cobrancaFonte.campos.itemReferencia'));
  const operadora = fonte.value !== null && mm.codigo.trim() !== '';
  if (!operadora && num(mm.termo) === null) e.push(t('cobrancaFonte.erros.destino'));
  if ((num(mm.fator) ?? 0) <= 0) e.push(t('cobrancaFonte.erros.fatores'));
  if (!DATA.test(mm.inicio)) e.push(t('cobrancaFonte.erros.inicio'));
  return e;
});
const gravarMatmedForm = () => {
  const operadora = fonte.value !== null && mm.codigo.trim() !== '';
  const termo = num(mm.termo);
  return enviar(() =>
    gravarEquivalenciaMatmed(num(mm.item) ?? 0, {
      fontePagadoraId: operadora ? fonte.value : null,
      codigoNaFonte: operadora ? mm.codigo.trim() : null,
      descricaoNaFonte: operadora ? mm.descricao.trim() || null : null,
      unidade: mm.unidade.trim() || null,
      fatorConversao: num(mm.fator) ?? 1,
      termoTussId: termo,
      tipoEquivalenciaTuss: termo === null ? null : mm.tipoTuss || 'exata',
      vigenciaInicio: mm.inicio,
    }),
  );
};

// ── Encerramento (sem apagar) ───────────────────────────────────────────────────────────────────────
const ALVO: Partial<Record<Aba, AlvoEncerramento>> = {
  dePara: 'de-para',
  credenciamento: 'credenciamento',
  excecoes: 'excecao',
};
const podeEncerrar = computed(() =>
  aba.value === 'dePara' ? podeContrato.value : aba.value === 'matmed' ? false : podeCredenciar.value,
);
const encerrando = ref<{ id: number; versao: number } | null>(null);
const fimEnc = reactive({ fim: hoje, motivo: '' });
const aberto = (l: Record<string, unknown>) => l['fim'] === null || String(l['fim'] ?? '') >= hoje;
function abrirEncerramento(l: Record<string, unknown>): void {
  encerrando.value = { id: Number(l['id']), versao: Number(l['versao']) };
  fimEnc.fim = hoje;
  fimEnc.motivo = '';
}
const erroFim = computed(() =>
  fimEnc.fim < hoje || !DATA.test(fimEnc.fim) ? t('cobrancaFonte.erros.fim') : '',
);
async function confirmarEncerramento(): Promise<void> {
  const alvo = ALVO[aba.value];
  if (!alvo || !encerrando.value || erroFim.value) return;
  const { id, versao } = encerrando.value;
  erro.value = null;
  try {
    await encerrarRegistro(alvo, id, {
      versao,
      vigenciaFim: fimEnc.fim,
      motivo: fimEnc.motivo.trim() || null,
    });
    aviso.value = t('cobrancaFonte.encerrado', { id });
    encerrando.value = null;
    await recarregar();
  } catch (e) {
    erro.value = e;
  }
}
const fmt = (v: unknown) =>
  v === null || v === undefined ? '' : typeof v === 'number' ? v.toLocaleString('pt-BR') : String(v);
</script>

<template>
  <section class="tela" aria-labelledby="cobranca-titulo">
    <h1 id="cobranca-titulo">{{ t('cobrancaFonte.titulo') }}</h1>
    <p>{{ t('cobrancaFonte.texto') }}</p>
    <div class="campo largo">
      <SanteSelecao
        id="cobranca-convenio"
        v-model="convenio"
        :rotulo="t('cobrancaFonte.convenio')"
        :opcoes="opcoesConvenio"
        data-testid="cobranca-convenio"
      />
    </div>
    <p v-if="fonte === null && aba !== 'matmed'" data-testid="cobranca-escolha">
      {{ t('cobrancaFonte.escolhaConvenio') }}
    </p>
    <nav class="abas" :aria-label="t('cobrancaFonte.titulo')">
      <button
        v-for="a in ABAS"
        :key="a"
        type="button"
        :aria-pressed="aba === a"
        :data-testid="`cobranca-aba-${a}`"
        @click="aba = a"
      >
        {{ t(`cobrancaFonte.abas.${a}`) }}
      </button>
    </nav>
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="cobranca-aviso">{{ aviso }}</p>

    <!-- Conferência: o que sai na guia, na hora. -->
    <form v-if="aba === 'conferir'" class="grade" data-testid="form-conferir" @submit.prevent="conferir">
      <div class="campo">
        <label for="cf-item">{{ t('cobrancaFonte.campos.item') }}</label>
        <input id="cf-item" v-model="cf.item" inputmode="numeric" required data-testid="cf-item" />
      </div>
      <div class="campo">
        <label for="cf-plano">{{ t('cobrancaFonte.campos.plano') }}</label>
        <input id="cf-plano" v-model="cf.plano" inputmode="numeric" />
      </div>
      <div class="campo">
        <label for="cf-prof">{{ t('cobrancaFonte.campos.profissional') }}</label>
        <input id="cf-prof" v-model="cf.profissional" inputmode="numeric" data-testid="cf-profissional" />
      </div>
      <div class="campo">
        <SanteSelecao
          id="cf-atendimento"
          v-model="cf.atendimento"
          :rotulo="t('cobrancaFonte.campos.atendimento')"
          :opcoes="opcoesAtendimento"
        />
      </div>
      <div class="campo">
        <label for="cf-qtd">{{ t('cobrancaFonte.campos.quantidade') }}</label>
        <input id="cf-qtd" v-model="cf.quantidade" inputmode="decimal" data-testid="cf-quantidade" />
      </div>
      <div class="campo">
        <label for="cf-data">{{ t('cobrancaFonte.campos.data') }}</label>
        <input id="cf-data" v-model="cf.data" pattern="\d{4}-\d{2}-\d{2}" />
      </div>
      <SanteBotao
        :rotulo="t('cobrancaFonte.conferir')"
        tipo="submit"
        :desabilitado="fonte === null"
        data-testid="cf-conferir"
      />
    </form>
    <section v-if="aba === 'conferir' && conferencia" class="resultado" data-testid="cf-resultado">
      <h2>{{ t('cobrancaFonte.resultado.titulo') }}</h2>
      <p data-testid="cf-codigo">
        {{
          t('cobrancaFonte.resultado.codigo', {
            codigo: conferencia.codigo,
            quantidade: fmt(conferencia.quantidade),
          })
        }}
        <span v-if="conferencia.descricao"> — {{ conferencia.descricao }}</span>
      </p>
      <p v-if="conferencia.equivalenciaId === null">{{ t('cobrancaFonte.resultado.semDePara') }}</p>
      <p v-if="conferencia.unidade">
        {{ t('cobrancaFonte.resultado.unidade', { unidade: conferencia.unidade }) }}
      </p>
      <p v-if="conferencia.percentualCobranca !== null">
        {{ t('cobrancaFonte.resultado.percentual', { percentual: fmt(conferencia.percentualCobranca) }) }}
      </p>
      <p v-if="conferencia.codigoPrestadorNaFonte">
        {{ t('cobrancaFonte.resultado.prestador', { codigo: conferencia.codigoPrestadorNaFonte }) }}
      </p>
      <p :class="conferencia.credenciamento.permitido ? 'ok' : 'bloqueio'" data-testid="cf-credenciamento">
        {{
          t(
            conferencia.credenciamento.permitido
              ? 'cobrancaFonte.resultado.permitido'
              : 'cobrancaFonte.resultado.proibido',
            { origem: conferencia.credenciamento.origem },
          )
        }}
      </p>
      <ul>
        <li v-for="a in conferencia.avisos" :key="a">{{ a }}</li>
      </ul>
    </section>

    <!-- De-para do item para o código da fonte. -->
    <form
      v-if="aba === 'dePara' && podeContrato && fonte !== null"
      class="grade"
      data-testid="form-de-para"
      @submit.prevent="errosDePara.length === 0 && gravarDeParaForm()"
    >
      <div class="campo">
        <label for="dp-item">{{ t('cobrancaFonte.campos.item') }}</label>
        <input id="dp-item" v-model="dp.item" inputmode="numeric" data-testid="dp-item" />
      </div>
      <div class="campo">
        <label for="dp-grupo">{{ t('cobrancaFonte.campos.grupo') }}</label>
        <input id="dp-grupo" v-model="dp.grupo" inputmode="numeric" data-testid="dp-grupo" />
      </div>
      <div class="campo">
        <label for="dp-plano">{{ t('cobrancaFonte.campos.plano') }}</label>
        <input id="dp-plano" v-model="dp.plano" inputmode="numeric" />
      </div>
      <div class="campo">
        <SanteSelecao
          id="dp-atendimento"
          v-model="dp.atendimento"
          :rotulo="t('cobrancaFonte.campos.atendimento')"
          :opcoes="opcoesAtendimento"
        />
      </div>
      <div class="campo">
        <label for="dp-codigo">{{ t('cobrancaFonte.campos.codigo') }}</label>
        <input id="dp-codigo" v-model="dp.codigo" maxlength="40" data-testid="dp-codigo" />
      </div>
      <div class="campo">
        <label for="dp-descricao">{{ t('cobrancaFonte.campos.descricao') }}</label>
        <input id="dp-descricao" v-model="dp.descricao" maxlength="300" />
      </div>
      <div class="campo">
        <label for="dp-unidade">{{ t('cobrancaFonte.campos.unidade') }}</label>
        <input id="dp-unidade" v-model="dp.unidade" maxlength="15" />
      </div>
      <div class="campo">
        <label for="dp-mult">{{ t('cobrancaFonte.campos.fatorMultiplicacao') }}</label>
        <input id="dp-mult" v-model="dp.mult" inputmode="decimal" />
      </div>
      <div class="campo">
        <label for="dp-div">{{ t('cobrancaFonte.campos.fatorDivisao') }}</label>
        <input id="dp-div" v-model="dp.div" inputmode="decimal" data-testid="dp-divisao" />
      </div>
      <div class="campo">
        <label for="dp-perc">{{ t('cobrancaFonte.campos.percentual') }}</label>
        <input id="dp-perc" v-model="dp.percentual" inputmode="decimal" />
      </div>
      <div class="campo">
        <label for="dp-inicio">{{ t('cobrancaFonte.campos.inicio') }}</label>
        <input id="dp-inicio" v-model="dp.inicio" pattern="\d{4}-\d{2}-\d{2}" />
      </div>
      <ul v-if="errosDePara.length" class="erros" data-testid="dp-erros">
        <li v-for="e in errosDePara" :key="e">{{ e }}</li>
      </ul>
      <SanteBotao
        :rotulo="t('cobrancaFonte.gravar')"
        tipo="submit"
        :desabilitado="errosDePara.length > 0"
        data-testid="dp-gravar"
      />
    </form>

    <!-- Credenciamento de cobrança. -->
    <form
      v-if="aba === 'credenciamento' && podeCredenciar && fonte !== null"
      class="grade"
      data-testid="form-credenciamento"
      @submit.prevent="errosCredenciamento.length === 0 && gravarCredenciamentoForm()"
    >
      <div class="campo">
        <label for="cr-prof">{{ t('cobrancaFonte.campos.profissional') }}</label>
        <input id="cr-prof" v-model="cr.profissional" inputmode="numeric" data-testid="cr-profissional" />
      </div>
      <div class="campo">
        <label for="cr-prest">{{ t('cobrancaFonte.campos.prestador') }}</label>
        <input id="cr-prest" v-model="cr.prestador" inputmode="numeric" data-testid="cr-prestador" />
      </div>
      <div class="campo">
        <label for="cr-plano">{{ t('cobrancaFonte.campos.plano') }}</label>
        <input id="cr-plano" v-model="cr.plano" inputmode="numeric" />
      </div>
      <div class="campo">
        <label for="cr-grupo">{{ t('cobrancaFonte.campos.grupoAto') }}</label>
        <input id="cr-grupo" v-model="cr.grupoAto" inputmode="numeric" />
      </div>
      <div class="campo">
        <label for="cr-codigo">{{ t('cobrancaFonte.campos.codigo') }}</label>
        <input id="cr-codigo" v-model="cr.codigo" maxlength="40" data-testid="cr-codigo" />
      </div>
      <div class="campo">
        <label for="cr-inicio">{{ t('cobrancaFonte.campos.inicio') }}</label>
        <input id="cr-inicio" v-model="cr.inicio" pattern="\d{4}-\d{2}-\d{2}" />
      </div>
      <label class="marcar"
        ><input v-model="cr.direto" type="checkbox" /> {{ t('cobrancaFonte.campos.recebeDireto') }}</label
      >
      <ul v-if="errosCredenciamento.length" class="erros" data-testid="cr-erros">
        <li v-for="e in errosCredenciamento" :key="e">{{ e }}</li>
      </ul>
      <SanteBotao
        :rotulo="t('cobrancaFonte.gravar')"
        tipo="submit"
        :desabilitado="errosCredenciamento.length > 0"
        data-testid="cr-gravar"
      />
    </form>

    <!-- Exceção ao credenciamento. -->
    <form
      v-if="aba === 'excecoes' && podeCredenciar && fonte !== null"
      class="grade"
      data-testid="form-excecao"
      @submit.prevent="errosExcecao.length === 0 && gravarExcecaoForm()"
    >
      <div class="campo">
        <SanteSelecao
          id="ex-sujeito"
          v-model="ex.sujeito"
          :rotulo="t('cobrancaFonte.campos.sujeito')"
          :opcoes="opcoesSujeito"
        />
      </div>
      <div class="campo">
        <label for="ex-sujeito-id">{{ t('cobrancaFonte.campos.sujeitoId') }}</label>
        <input id="ex-sujeito-id" v-model="ex.sujeitoId" inputmode="numeric" data-testid="ex-sujeito-id" />
      </div>
      <div class="campo">
        <label for="ex-item">{{ t('cobrancaFonte.campos.item') }}</label>
        <input id="ex-item" v-model="ex.item" inputmode="numeric" data-testid="ex-item" />
      </div>
      <div class="campo">
        <label for="ex-grupo">{{ t('cobrancaFonte.campos.grupo') }}</label>
        <input id="ex-grupo" v-model="ex.grupo" inputmode="numeric" />
      </div>
      <div class="campo">
        <label for="ex-plano">{{ t('cobrancaFonte.campos.plano') }}</label>
        <input id="ex-plano" v-model="ex.plano" inputmode="numeric" />
      </div>
      <div class="campo">
        <SanteSelecao
          id="ex-atendimento"
          v-model="ex.atendimento"
          :rotulo="t('cobrancaFonte.campos.atendimento')"
          :opcoes="opcoesAtendimento"
        />
      </div>
      <div class="campo">
        <SanteSelecao
          id="ex-efeito"
          v-model="ex.efeito"
          :rotulo="t('cobrancaFonte.campos.efeito')"
          :opcoes="opcoesEfeito"
          data-testid="ex-efeito"
        />
      </div>
      <div class="campo largo">
        <label for="ex-motivo">{{ t('cobrancaFonte.campos.motivo') }}</label>
        <input id="ex-motivo" v-model="ex.motivo" maxlength="500" data-testid="ex-motivo" />
      </div>
      <div class="campo">
        <label for="ex-inicio">{{ t('cobrancaFonte.campos.inicio') }}</label>
        <input id="ex-inicio" v-model="ex.inicio" pattern="\d{4}-\d{2}-\d{2}" />
      </div>
      <ul v-if="errosExcecao.length" class="erros" data-testid="ex-erros">
        <li v-for="e in errosExcecao" :key="e">{{ e }}</li>
      </ul>
      <SanteBotao
        :rotulo="t('cobrancaFonte.gravar')"
        tipo="submit"
        :desabilitado="errosExcecao.length > 0"
        data-testid="ex-gravar"
      />
    </form>

    <!-- Mat/med da referência de mercado: equivalência com a operadora e com a TUSS. -->
    <form
      v-if="aba === 'matmed'"
      class="grade"
      data-testid="form-matmed"
      @submit.prevent="podeContrato && errosMatmed.length === 0 && gravarMatmedForm()"
    >
      <div class="campo">
        <label for="mm-item">{{ t('cobrancaFonte.campos.itemReferencia') }}</label>
        <input
          id="mm-item"
          v-model="mm.item"
          inputmode="numeric"
          data-testid="mm-item"
          @change="recarregar"
        />
      </div>
      <SanteBotao
        :rotulo="t('cobrancaFonte.carregarEquivalencias')"
        variante="secundario"
        data-testid="mm-ver"
        @click="recarregar"
      />
      <template v-if="podeContrato">
        <div class="campo">
          <label for="mm-codigo">{{ t('cobrancaFonte.campos.codigo') }}</label>
          <input id="mm-codigo" v-model="mm.codigo" maxlength="40" data-testid="mm-codigo" />
        </div>
        <div class="campo">
          <label for="mm-descricao">{{ t('cobrancaFonte.campos.descricao') }}</label>
          <input id="mm-descricao" v-model="mm.descricao" maxlength="150" />
        </div>
        <div class="campo">
          <label for="mm-unidade">{{ t('cobrancaFonte.campos.unidade') }}</label>
          <input id="mm-unidade" v-model="mm.unidade" maxlength="15" />
        </div>
        <div class="campo">
          <label for="mm-fator">{{ t('cobrancaFonte.campos.fatorConversao') }}</label>
          <input id="mm-fator" v-model="mm.fator" inputmode="decimal" />
        </div>
        <div class="campo">
          <label for="mm-termo">{{ t('cobrancaFonte.campos.termoTuss') }}</label>
          <input id="mm-termo" v-model="mm.termo" inputmode="numeric" data-testid="mm-termo" />
        </div>
        <div class="campo">
          <SanteSelecao
            id="mm-tipo-tuss"
            v-model="mm.tipoTuss"
            :rotulo="t('cobrancaFonte.campos.tipoTuss')"
            :opcoes="opcoesTuss"
          />
        </div>
        <div class="campo">
          <label for="mm-inicio">{{ t('cobrancaFonte.campos.inicio') }}</label>
          <input id="mm-inicio" v-model="mm.inicio" pattern="\d{4}-\d{2}-\d{2}" />
        </div>
        <ul v-if="errosMatmed.length" class="erros" data-testid="mm-erros">
          <li v-for="e in errosMatmed" :key="e">{{ e }}</li>
        </ul>
        <SanteBotao
          :rotulo="t('cobrancaFonte.gravar')"
          tipo="submit"
          :desabilitado="errosMatmed.length > 0"
          data-testid="mm-gravar"
        />
      </template>
    </form>

    <!-- Lista da aba, com o encerramento por linha (nada se apaga). -->
    <div v-if="aba !== 'conferir' && lista" class="rolagem">
      <p v-if="lista.itens.length === 0">{{ t('cobrancaFonte.nenhum') }}</p>
      <table v-else data-testid="cobranca-lista">
        <caption>
          {{
            t(`cobrancaFonte.abas.${aba}`)
          }}
        </caption>
        <thead>
          <tr>
            <th v-for="c in lista.colunas" :key="c.campo" scope="col">{{ c.rotulo }}</th>
            <th v-if="podeEncerrar" scope="col">{{ t('cobrancaFonte.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(l, i) in lista.itens" :key="i">
            <td v-for="c in lista.colunas" :key="c.campo">{{ fmt(l[c.campo]) }}</td>
            <td v-if="podeEncerrar">
              <SanteBotao
                v-if="aberto(l)"
                :rotulo="t('cobrancaFonte.encerrar')"
                variante="secundario"
                :data-testid="`encerrar-${l['id']}`"
                @click="abrirEncerramento(l)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <form v-if="encerrando" class="grade" data-testid="form-encerrar" @submit.prevent="confirmarEncerramento">
      <h2 class="largo">{{ t('cobrancaFonte.confirmarEncerramento', { id: encerrando.id }) }}</h2>
      <div class="campo">
        <label for="enc-fim">{{ t('cobrancaFonte.campos.fim') }}</label>
        <input id="enc-fim" v-model="fimEnc.fim" pattern="\d{4}-\d{2}-\d{2}" data-testid="enc-fim" />
      </div>
      <div class="campo largo">
        <label for="enc-motivo">{{ t('cobrancaFonte.campos.motivo') }}</label>
        <input id="enc-motivo" v-model="fimEnc.motivo" maxlength="500" data-testid="enc-motivo" />
      </div>
      <p v-if="erroFim" class="erros" data-testid="enc-erro">{{ erroFim }}</p>
      <SanteBotao
        :rotulo="t('cobrancaFonte.encerrar')"
        tipo="submit"
        :desabilitado="!!erroFim"
        data-testid="enc-confirmar"
      />
    </form>
  </section>
</template>

<style scoped>
.abas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
  margin: var(--sgh-espaco-2) 0;
}
.abas button {
  font: inherit;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  cursor: pointer;
}
.abas button[aria-pressed='true'] {
  font-weight: 700;
  border-bottom-width: 3px;
}
.grade {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.largo {
  flex-basis: 100%;
}
.erros {
  flex-basis: 100%;
  color: var(--sgh-alerta);
}
.bloqueio {
  color: var(--sgh-alerta);
  font-weight: 700;
}
.ok {
  font-weight: 700;
}
.rolagem {
  overflow-x: auto;
}
input:not([type='checkbox']) {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
