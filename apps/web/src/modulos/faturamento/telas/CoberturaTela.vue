<script setup lang="ts">
// Restrição de cobertura por fonte pagadora e compatibilidade entre procedimentos (F7, 09-AREA linha 76):
// `/faturamento/cobertura`. Uma tela com quatro abas: as restrições da fonte (com os critérios somados: setor, idade,
// horário, prestador, plano, quantidade no período, tipo de atendimento), os pares de compatibilidade, as justificativas
// de liberação e a visão por atendimento (`?atendimento=`), onde se libera ou revoga a exceção do paciente.
// A validação é a do domínio, na hora; o servidor confere de novo. Revogar nunca apaga: o histórico fica.
import {
  PERIODOS_CRITERIO,
  TIPOS_ATENDIMENTO_COBERTURA,
  TIPOS_RELACAO_PROCEDIMENTO,
  TIPOS_RESTRICAO_COBERTURA,
  type CriterioCobertura,
  type TipoCriterioCobertura,
} from '@sgh/dominio-faturamento';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  gravarJustificativa,
  gravarPar,
  gravarRestricao,
  lerExcecoesAtendimento,
  lerPainelCobertura,
  liberarExcecao,
  revogarExcecao,
  validarExcecaoCobertura,
  validarParCompatibilidade,
  validarRestricaoCobertura,
  type PedidoExcecao,
  type PedidoPar,
  type PedidoRestricao,
  type RestricaoPainel,
} from '../api-cobertura.js';
import BuscaItemCobertura from '../componentes/BuscaItemCobertura.vue';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';

type Aba = 'restricoes' | 'pares' | 'justificativas' | 'atendimento';
const { t, tm } = useI18n();
const rota = useRoute();
const { permissoes } = usarSessao();
const podeEditar = computed(() => permissoes.value.has('faturamento.regra.editar'));
const podeLiberar = computed(() => permissoes.value.has('faturamento.auditoria.ajustar'));
const qc = useQueryClient();
const hoje = () => new Date().toISOString().slice(0, 10);

const fonte = ref<number | null>(null);
const aba = ref<Aba>(rota.query['atendimento'] ? 'atendimento' : 'restricoes');
const q = useQuery({
  queryKey: computed(() => ['faturamento', 'cobertura', fonte.value]),
  queryFn: () => lerPainelCobertura(fonte.value),
});
const opcoes = computed(() => q.data.value?.opcoes);
const erro = ref<unknown>(null);
const aviso = ref('');
const nulo = (v: number | null | undefined) => (v ? v : null);
const numOuNulo = (s: string | number | null) => (s === '' || s === null ? null : Number(s));

const opFontes = computed(() => [
  { valor: null, rotulo: t('cobertura.todas') },
  ...(opcoes.value?.fontes ?? []).map((f) => ({ valor: f.id, rotulo: f.nome })),
]);
const opPlanos = computed(() => [
  { valor: null, rotulo: '—' },
  ...(opcoes.value?.planos ?? []).map((p) => ({ valor: p.id, rotulo: p.descricao })),
]);
const opGrupos = computed(() => [
  { valor: null, rotulo: '—' },
  ...(opcoes.value?.grupos ?? []).map((g) => ({ valor: g.id, rotulo: g.descricao })),
]);
const opTabelas = computed(() => [
  { valor: null, rotulo: '—' },
  ...(opcoes.value?.tabelas ?? []).map((g) => ({ valor: g.id, rotulo: g.descricao })),
]);
const opSetores = computed(() => [
  { valor: null, rotulo: t('cobertura.escolha') },
  ...(opcoes.value?.setores ?? []).map((s) => ({ valor: s.id, rotulo: s.nome })),
]);
const opPrestadores = computed(() => [
  { valor: null, rotulo: t('cobertura.escolha') },
  ...(opcoes.value?.prestadores ?? []).map((s) => ({ valor: s.id, rotulo: s.nome })),
]);
const opJust = computed(() => [
  { valor: null, rotulo: t('cobertura.escolha') },
  ...(opcoes.value?.justificativas ?? []).map((j) => ({
    valor: j.id,
    rotulo: `${j.codigo} · ${j.descricao}`,
  })),
]);
const opTipos = TIPOS_RESTRICAO_COBERTURA.map((v) => ({ valor: v, rotulo: t(`cobertura.tipos.${v}`) }));
const opAcoes = (['bloquear', 'alertar'] as const).map((v) => ({
  valor: v,
  rotulo: t(`cobertura.acoes.${v}`),
}));
const opAtend = computed(() => [
  { valor: null, rotulo: t('cobertura.todas') },
  ...TIPOS_ATENDIMENTO_COBERTURA.map((v) => ({ valor: v, rotulo: t(`cobertura.atendimentos.${v}`) })),
]);
const opRelacoes = TIPOS_RELACAO_PROCEDIMENTO.map((v) => ({
  valor: v,
  rotulo: t(`cobertura.relacoes.${v}`),
}));
const opPeriodos = PERIODOS_CRITERIO.map((v) => ({ valor: v, rotulo: t(`cobertura.periodos.${v}`) }));
/** Critérios que a tela edita por lista (profissional e empresa da carteira entram pela carga e ficam como estão). */
const CRITERIOS_EDITAVEIS: TipoCriterioCobertura[] = [
  'setor',
  'faixa_idade',
  'horario',
  'prestador',
  'plano',
  'quantidade_periodo',
  'tipo_atendimento',
];
const opCriterios = CRITERIOS_EDITAVEIS.map((v) => ({ valor: v, rotulo: t(`cobertura.criteriosNome.${v}`) }));
const opDias = computed(() => [
  { valor: null, rotulo: t('cobertura.todosDias') },
  ...(tm('cobertura.dias') as string[]).map((d, i) => ({ valor: i + 1, rotulo: d })),
]);

async function gravar(fn: () => Promise<unknown>, depois?: () => void) {
  erro.value = null;
  aviso.value = '';
  try {
    await fn();
    aviso.value = t('cobertura.gravado');
    depois?.();
    await qc.invalidateQueries({ queryKey: ['faturamento', 'cobertura'] });
  } catch (e) {
    erro.value = e;
  }
}

// ── Restrição ───────────────────────────────────────────────────────────────────────────────────────
const restr = ref<PedidoRestricao | null>(null);
const restrItemRotulo = ref<string | null>(null);
function novaRestricao() {
  restrItemRotulo.value = null;
  restr.value = {
    id: null,
    versao: null,
    descricao: '',
    fontePagadoraId: fonte.value ?? 0,
    planoId: null,
    itemId: null,
    grupoId: null,
    tabelaId: null,
    tipo: 'nao_coberto',
    acao: 'bloquear',
    tipoAtendimento: null,
    valorLimite: null,
    quantidadeLimite: null,
    mensagem: null,
    vigenciaInicio: hoje(),
    vigenciaFim: null,
    ativo: true,
    criterios: [],
  };
}
function editarRestricao(r: RestricaoPainel) {
  restrItemRotulo.value = r.itemCodigo ? `${r.itemCodigo} ${r.itemDescricao ?? ''}` : null;
  restr.value = {
    id: r.id,
    versao: r.versao ?? null,
    descricao: r.descricao,
    fontePagadoraId: r.fontePagadoraId,
    planoId: r.planoId,
    itemId: r.itemId,
    grupoId: r.grupoId,
    tabelaId: r.tabelaId,
    tipo: r.tipo,
    acao: r.acao,
    tipoAtendimento: r.tipoAtendimento,
    valorLimite: r.valorLimite,
    quantidadeLimite: r.quantidadeLimite,
    mensagem: r.mensagem,
    vigenciaInicio: r.vigenciaInicio,
    vigenciaFim: r.vigenciaFim,
    ativo: r.ativo,
    // O vínculo do prestador com o profissional é calculado pelo servidor: não volta no pedido.
    criterios: r.criterios.map(
      (c) =>
        Object.fromEntries(
          Object.entries(c).filter(([k, v]) => k !== 'prestadorProfissionalId' && v !== undefined),
        ) as unknown as CriterioCobertura,
    ),
  };
}
const errosRestr = computed(() =>
  restr.value
    ? validarRestricaoCobertura({
        ...restr.value,
        fontePagadoraId: nulo(restr.value.fontePagadoraId),
        valorLimite: numOuNulo(restr.value.valorLimite),
        quantidadeLimite: numOuNulo(restr.value.quantidadeLimite),
        vigenciaFim: restr.value.vigenciaFim || null,
      })
    : {},
);
function addCriterio() {
  restr.value?.criterios.push({ tipo: 'setor', setorId: null });
}
function trocarTipoCriterio(i: number, tipo: TipoCriterioCobertura) {
  if (restr.value) restr.value.criterios[i] = { tipo };
}
function campoCrit(i: number, campo: keyof CriterioCobertura, v: unknown) {
  if (restr.value) restr.value.criterios[i] = { ...restr.value.criterios[i]!, [campo]: v };
}
const salvarRestricao = () => {
  const r = restr.value;
  if (!r || Object.keys(errosRestr.value).length) return;
  return gravar(
    () =>
      gravarRestricao(
        {
          ...r,
          valorLimite: numOuNulo(r.valorLimite),
          quantidadeLimite: numOuNulo(r.quantidadeLimite),
          vigenciaFim: r.vigenciaFim || null,
          mensagem: r.mensagem?.trim() || null,
          criterios: r.criterios.map((c) => ({
            ...c,
            ...(c.idadeMinima !== undefined ? { idadeMinima: numOuNulo(c.idadeMinima) } : {}),
            ...(c.idadeMaxima !== undefined ? { idadeMaxima: numOuNulo(c.idadeMaxima) } : {}),
            ...(c.quantidadeMaxima !== undefined ? { quantidadeMaxima: numOuNulo(c.quantidadeMaxima) } : {}),
          })),
        },
        crypto.randomUUID(),
      ),
    () => (restr.value = null),
  );
};

// ── Par de compatibilidade ──────────────────────────────────────────────────────────────────────────
const par = ref<
  | (Omit<PedidoPar, 'itemId' | 'relacionadoId'> & { itemId: number | null; relacionadoId: number | null })
  | null
>(null);
function novoPar() {
  par.value = {
    id: null,
    versao: null,
    fontePagadoraId: fonte.value,
    itemId: null,
    relacionadoId: null,
    tipo: 'incompativel',
    exigeItem: false,
    quantidadeLimite: null,
    validadeDias: null,
    vigenciaInicio: hoje(),
    vigenciaFim: null,
    ativo: true,
  };
}
const errosPar = computed(() =>
  par.value
    ? validarParCompatibilidade({
        ...par.value,
        quantidadeLimite: numOuNulo(par.value.quantidadeLimite),
        validadeDias: numOuNulo(par.value.validadeDias),
        vigenciaFim: par.value.vigenciaFim || null,
      })
    : {},
);
/** O mesmo par (nos dois sentidos) já cadastrado para a mesma fonte: aviso antes de enviar. */
const parRepetido = computed(() => {
  const p = par.value;
  if (!p || !p.itemId || !p.relacionadoId) return false;
  return (q.data.value?.pares ?? []).some(
    (x) =>
      x.id !== p.id &&
      x.ativo &&
      x.fontePagadoraId === p.fontePagadoraId &&
      ((x.itemId === p.itemId && x.relacionadoId === p.relacionadoId) ||
        (x.itemId === p.relacionadoId && x.relacionadoId === p.itemId)),
  );
});
const salvarPar = () => {
  const p = par.value;
  if (!p || !p.itemId || !p.relacionadoId || Object.keys(errosPar.value).length || parRepetido.value) return;
  return gravar(
    () =>
      gravarPar(
        {
          ...p,
          itemId: p.itemId!,
          relacionadoId: p.relacionadoId!,
          quantidadeLimite: numOuNulo(p.quantidadeLimite),
          validadeDias: numOuNulo(p.validadeDias),
          vigenciaFim: p.vigenciaFim || null,
        },
        crypto.randomUUID(),
      ),
    () => (par.value = null),
  );
};

// ── Justificativa ───────────────────────────────────────────────────────────────────────────────────
const just = reactive({ codigo: '', descricao: '', textoPadrao: '' });
const justOk = computed(() => just.codigo.trim() !== '' && just.descricao.trim() !== '');
const salvarJust = () =>
  justOk.value
    ? gravar(
        () =>
          gravarJustificativa(
            {
              codigo: just.codigo.trim(),
              descricao: just.descricao.trim(),
              textoPadrao: just.textoPadrao.trim() || null,
            },
            crypto.randomUUID(),
          ),
        () => Object.assign(just, { codigo: '', descricao: '', textoPadrao: '' }),
      )
    : undefined;

// ── Visão por atendimento ───────────────────────────────────────────────────────────────────────────
const numeroAtendimento = ref(String(rota.query['atendimento'] ?? ''));
const atendimento = ref<number | null>(Number(numeroAtendimento.value) || null);
watch(
  () => rota.query['atendimento'],
  (v) => {
    numeroAtendimento.value = String(v ?? '');
    atendimento.value = Number(v) || null;
  },
);
const qa = useQuery({
  queryKey: computed(() => ['faturamento', 'cobertura', 'atendimento', atendimento.value]),
  queryFn: () => lerExcecoesAtendimento(atendimento.value!),
  enabled: computed(() => atendimento.value !== null),
});
type FormExcecao = Omit<PedidoExcecao, 'justificativaId'> & { justificativaId: number | null };
const exc = ref<FormExcecao>(excecaoVazia());
function excecaoVazia(): FormExcecao {
  return {
    restricaoId: null,
    itemId: null,
    grupoId: null,
    justificativaId: null,
    quantidadeAutorizada: null,
    numeroGuia: null,
    observacao: null,
    tiposAtendimento: [...TIPOS_ATENDIMENTO_COBERTURA],
  };
}
const opRestrAtend = computed(() => [
  { valor: null, rotulo: t('cobertura.avulsa') },
  ...(qa.data.value?.restricoes ?? []).map((r) => ({ valor: r.id, rotulo: r.descricao })),
]);
function escolherRestricaoExc(id: number | null) {
  const r = qa.data.value?.restricoes.find((x) => x.id === id);
  exc.value = { ...exc.value, restricaoId: id, itemId: r?.itemId ?? null, grupoId: r?.grupoId ?? null };
}
const errosExc = computed(() =>
  validarExcecaoCobertura({
    ...exc.value,
    quantidadeAutorizada: numOuNulo(exc.value.quantidadeAutorizada),
  }),
);
const liberar = () => {
  if (!atendimento.value || Object.keys(errosExc.value).length) return;
  const a = atendimento.value;
  const e = exc.value;
  return gravar(
    () =>
      liberarExcecao(
        a,
        {
          ...e,
          justificativaId: e.justificativaId!,
          quantidadeAutorizada: numOuNulo(e.quantidadeAutorizada),
          numeroGuia: e.numeroGuia?.trim() || null,
          observacao: e.observacao?.trim() || null,
        },
        crypto.randomUUID(),
      ),
    () => (exc.value = excecaoVazia()),
  );
};
const revogar = (id: number, versao: number) => gravar(() => revogarExcecao(id, versao, crypto.randomUUID()));
function marcarTipo(tipo: (typeof TIPOS_ATENDIMENTO_COBERTURA)[number], marcado: boolean) {
  const s = new Set(exc.value.tiposAtendimento);
  if (marcado) s.add(tipo);
  else s.delete(tipo);
  exc.value.tiposAtendimento = TIPOS_ATENDIMENTO_COBERTURA.filter((x) => s.has(x));
}
const ABAS: Aba[] = ['restricoes', 'pares', 'justificativas', 'atendimento'];
</script>

<template>
  <section class="tela" data-testid="cobertura">
    <h1>{{ t('cobertura.titulo') }}</h1>
    <p class="secundario">{{ t('cobertura.explicacao') }}</p>
    <ErroFaturamento v-if="q.error.value" :erro="q.error.value" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="cob-aviso">{{ aviso }}</p>

    <div class="filtros">
      <SanteSelecao
        v-model="fonte"
        :rotulo="t('cobertura.fonte')"
        :opcoes="opFontes"
        data-testid="cob-fonte"
      />
    </div>
    <nav :aria-label="t('cobertura.titulo')" class="filtros">
      <button
        v-for="a in ABAS"
        :key="a"
        type="button"
        :aria-pressed="aba === a"
        :data-testid="`cob-aba-${a}`"
        @click="aba = a"
      >
        {{ t(`cobertura.abas.${a}`) }}
      </button>
    </nav>

    <!-- Restrições -->
    <section v-if="aba === 'restricoes' && q.data.value" data-testid="cob-restricoes">
      <SanteBotao
        v-if="podeEditar && !restr"
        :rotulo="t('cobertura.nova')"
        :desabilitado="!fonte"
        data-testid="cob-nova"
        @acionar="novaRestricao"
      />
      <form v-if="restr" class="filtros" data-testid="cob-form-restricao" @submit.prevent="salvarRestricao">
        <label
          >{{ t('cobertura.descricao') }}
          <input v-model="restr.descricao" maxlength="150" data-testid="cob-r-descricao" />
          <small v-if="errosRestr['descricao']" class="erro" data-testid="cob-r-erro-descricao">{{
            errosRestr['descricao']
          }}</small>
        </label>
        <SanteSelecao
          v-model="restr.planoId"
          :rotulo="t('cobertura.plano')"
          :opcoes="opPlanos"
          data-testid="cob-r-plano"
        />
        <BuscaItemCobertura
          v-model="restr.itemId"
          :rotulo="t('cobertura.item')"
          :rotulo-atual="restrItemRotulo"
          testid="cob-r-item"
        />
        <SanteSelecao
          v-model="restr.grupoId"
          :rotulo="t('cobertura.grupo')"
          :opcoes="opGrupos"
          data-testid="cob-r-grupo"
        />
        <SanteSelecao
          v-model="restr.tabelaId"
          :rotulo="t('cobertura.tabela')"
          :opcoes="opTabelas"
          data-testid="cob-r-tabela"
        />
        <small v-if="errosRestr['itemId']" class="erro" data-testid="cob-r-erro-item">{{
          errosRestr['itemId']
        }}</small>
        <SanteSelecao
          v-model="restr.tipo"
          :rotulo="t('cobertura.tipo')"
          :opcoes="opTipos"
          data-testid="cob-r-tipo"
        />
        <SanteSelecao
          v-model="restr.acao"
          :rotulo="t('cobertura.acao')"
          :opcoes="opAcoes"
          data-testid="cob-r-acao"
        />
        <SanteSelecao
          v-model="restr.tipoAtendimento"
          :rotulo="t('cobertura.tipoAtendimento')"
          :opcoes="opAtend"
          data-testid="cob-r-atend"
        />
        <label v-if="restr.tipo === 'limite_valor'"
          >{{ t('cobertura.valorLimite') }}
          <input v-model="restr.valorLimite" inputmode="decimal" data-testid="cob-r-valor" />
          <small v-if="errosRestr['valorLimite']" class="erro">{{ errosRestr['valorLimite'] }}</small>
        </label>
        <label v-if="restr.tipo === 'limite_quantidade'"
          >{{ t('cobertura.quantidadeLimite') }}
          <input v-model="restr.quantidadeLimite" inputmode="numeric" data-testid="cob-r-qtd" />
          <small v-if="errosRestr['quantidadeLimite']" class="erro" data-testid="cob-r-erro-qtd">{{
            errosRestr['quantidadeLimite']
          }}</small>
        </label>
        <label
          >{{ t('cobertura.mensagem') }}
          <input v-model="restr.mensagem" maxlength="500" data-testid="cob-r-mensagem"
        /></label>
        <label
          >{{ t('cobertura.vigenciaInicio') }}
          <input v-model="restr.vigenciaInicio" type="date" data-testid="cob-r-inicio"
        /></label>
        <label
          >{{ t('cobertura.vigenciaFim') }}
          <input v-model="restr.vigenciaFim" type="date" data-testid="cob-r-fim" />
          <small v-if="errosRestr['vigenciaFim']" class="erro" data-testid="cob-r-erro-fim">{{
            errosRestr['vigenciaFim']
          }}</small>
        </label>
        <label
          ><input v-model="restr.ativo" type="checkbox" data-testid="cob-r-ativo" />
          {{ t('cobertura.ativo') }}</label
        >

        <fieldset data-testid="cob-r-criterios">
          <legend>{{ t('cobertura.criterios') }}</legend>
          <p v-if="!restr.criterios.length" class="secundario">{{ t('cobertura.semCriterio') }}</p>
          <div v-for="(c, i) in restr.criterios" :key="i" class="filtros" :data-testid="`cob-crit-${i}`">
            <template v-if="CRITERIOS_EDITAVEIS.includes(c.tipo)">
              <SanteSelecao
                :model-value="c.tipo"
                :rotulo="t('cobertura.tipo')"
                :opcoes="opCriterios"
                :data-testid="`cob-crit-${i}-tipo`"
                @update:model-value="(v) => trocarTipoCriterio(i, v)"
              />
              <SanteSelecao
                v-if="c.tipo === 'setor'"
                :model-value="c.setorId ?? null"
                :rotulo="t('cobertura.setor')"
                :opcoes="opSetores"
                :data-testid="`cob-crit-${i}-setor`"
                @update:model-value="(v) => campoCrit(i, 'setorId', v)"
              />
              <template v-if="c.tipo === 'faixa_idade'">
                <label
                  >{{ t('cobertura.idadeMinima') }}
                  <input
                    :value="c.idadeMinima ?? ''"
                    inputmode="numeric"
                    :data-testid="`cob-crit-${i}-idmin`"
                    @input="
                      campoCrit(i, 'idadeMinima', numOuNulo(($event.target as HTMLInputElement).value))
                    "
                /></label>
                <label
                  >{{ t('cobertura.idadeMaxima') }}
                  <input
                    :value="c.idadeMaxima ?? ''"
                    inputmode="numeric"
                    :data-testid="`cob-crit-${i}-idmax`"
                    @input="
                      campoCrit(i, 'idadeMaxima', numOuNulo(($event.target as HTMLInputElement).value))
                    "
                /></label>
              </template>
              <template v-if="c.tipo === 'horario'">
                <label
                  >{{ t('cobertura.horaInicio') }}
                  <input
                    :value="c.horaInicio ?? ''"
                    type="time"
                    :data-testid="`cob-crit-${i}-hini`"
                    @input="campoCrit(i, 'horaInicio', ($event.target as HTMLInputElement).value || null)"
                /></label>
                <label
                  >{{ t('cobertura.horaFim') }}
                  <input
                    :value="c.horaFim ?? ''"
                    type="time"
                    :data-testid="`cob-crit-${i}-hfim`"
                    @input="campoCrit(i, 'horaFim', ($event.target as HTMLInputElement).value || null)"
                /></label>
                <SanteSelecao
                  :model-value="c.diaSemana ?? null"
                  :rotulo="t('cobertura.diaSemana')"
                  :opcoes="opDias"
                  :data-testid="`cob-crit-${i}-dia`"
                  @update:model-value="(v) => campoCrit(i, 'diaSemana', v)"
                />
              </template>
              <SanteSelecao
                v-if="c.tipo === 'prestador'"
                :model-value="c.prestadorId ?? null"
                :rotulo="t('cobertura.prestador')"
                :opcoes="opPrestadores"
                :data-testid="`cob-crit-${i}-prestador`"
                @update:model-value="(v) => campoCrit(i, 'prestadorId', v)"
              />
              <SanteSelecao
                v-if="c.tipo === 'plano'"
                :model-value="c.planoId ?? null"
                :rotulo="t('cobertura.plano')"
                :opcoes="opPlanos"
                :data-testid="`cob-crit-${i}-plano`"
                @update:model-value="(v) => campoCrit(i, 'planoId', v)"
              />
              <template v-if="c.tipo === 'quantidade_periodo'">
                <label
                  >{{ t('cobertura.quantidadeMaxima') }}
                  <input
                    :value="c.quantidadeMaxima ?? ''"
                    inputmode="numeric"
                    :data-testid="`cob-crit-${i}-qtd`"
                    @input="
                      campoCrit(i, 'quantidadeMaxima', numOuNulo(($event.target as HTMLInputElement).value))
                    "
                /></label>
                <SanteSelecao
                  :model-value="c.periodo ?? 'dia'"
                  :rotulo="t('cobertura.periodo')"
                  :opcoes="opPeriodos"
                  :data-testid="`cob-crit-${i}-periodo`"
                  @update:model-value="(v) => campoCrit(i, 'periodo', v)"
                />
              </template>
              <SanteSelecao
                v-if="c.tipo === 'tipo_atendimento'"
                :model-value="c.tipoAtendimento ?? null"
                :rotulo="t('cobertura.tipoAtendimento')"
                :opcoes="opAtend"
                :data-testid="`cob-crit-${i}-atend`"
                @update:model-value="(v) => campoCrit(i, 'tipoAtendimento', v)"
              />
            </template>
            <p v-else class="secundario">
              {{ t('cobertura.criterioSoLeitura', { tipo: t(`cobertura.criteriosNome.${c.tipo}`) }) }}
            </p>
            <small v-if="errosRestr[`criterios.${i}`]" class="erro" :data-testid="`cob-crit-${i}-erro`">{{
              errosRestr[`criterios.${i}`]
            }}</small>
            <button type="button" :data-testid="`cob-crit-${i}-tirar`" @click="restr.criterios.splice(i, 1)">
              {{ t('cobertura.removerCriterio') }}
            </button>
          </div>
          <button type="button" data-testid="cob-crit-add" @click="addCriterio">
            {{ t('cobertura.addCriterio') }}
          </button>
        </fieldset>
        <button type="submit" :disabled="Object.keys(errosRestr).length > 0" data-testid="cob-r-gravar">
          {{ t('cobertura.gravar') }}
        </button>
        <button type="button" data-testid="cob-r-cancelar" @click="restr = null">
          {{ t('cobertura.cancelar') }}
        </button>
      </form>

      <p v-if="!q.data.value.restricoes.length" class="secundario" data-testid="cob-vazio">
        {{ t('cobertura.vazio') }}
      </p>
      <article v-for="r in q.data.value.restricoes" :key="r.id" :data-testid="`cob-restricao-${r.id}`">
        <h3>
          {{ r.descricao }} · {{ t(`cobertura.tipos.${r.tipo}`) }} · {{ t(`cobertura.acoes.${r.acao}`) }}
          <span v-if="!r.ativo"> · {{ t('cobertura.inativa') }}</span>
        </h3>
        <p class="secundario">
          {{ r.fonteNome }}<span v-if="r.planoDescricao"> · {{ r.planoDescricao }}</span> ·
          {{
            r.itemCodigo
              ? `${r.itemCodigo} ${r.itemDescricao ?? ''}`
              : (r.grupoDescricao ?? r.tabelaDescricao)
          }}
          ·
          {{
            r.vigenciaFim
              ? t('cobertura.vigencia', { de: r.vigenciaInicio, ate: r.vigenciaFim })
              : r.vigenciaInicio
          }}
        </p>
        <ul v-if="r.criterios.length">
          <li v-for="(c, i) in r.criterios" :key="i">{{ t(`cobertura.criteriosNome.${c.tipo}`) }}</li>
        </ul>
        <button
          v-if="podeEditar && !restr"
          type="button"
          :data-testid="`cob-editar-${r.id}`"
          @click="editarRestricao(r)"
        >
          {{ t('cobertura.editar') }}
        </button>
      </article>
    </section>

    <!-- Compatibilidade -->
    <section v-if="aba === 'pares' && q.data.value" data-testid="cob-pares">
      <SanteBotao
        v-if="podeEditar && !par"
        :rotulo="t('cobertura.novoPar')"
        data-testid="cob-novo-par"
        @acionar="novoPar"
      />
      <form v-if="par" class="filtros" data-testid="cob-form-par" @submit.prevent="salvarPar">
        <BuscaItemCobertura v-model="par.itemId" :rotulo="t('cobertura.item')" testid="cob-p-item" />
        <small v-if="errosPar['itemId']" class="erro">{{ errosPar['itemId'] }}</small>
        <BuscaItemCobertura
          v-model="par.relacionadoId"
          :rotulo="t('cobertura.relacionado')"
          testid="cob-p-rel"
        />
        <small v-if="errosPar['relacionadoId']" class="erro" data-testid="cob-p-erro-rel">{{
          errosPar['relacionadoId']
        }}</small>
        <SanteSelecao
          v-model="par.tipo"
          :rotulo="t('cobertura.tipo')"
          :opcoes="opRelacoes"
          data-testid="cob-p-tipo"
        />
        <label
          ><input v-model="par.exigeItem" type="checkbox" data-testid="cob-p-exige" />
          {{ t('cobertura.exigeItem') }}</label
        >
        <label
          >{{ t('cobertura.quantidadeLimite') }}
          <input v-model="par.quantidadeLimite" inputmode="numeric" data-testid="cob-p-qtd"
        /></label>
        <label
          >{{ t('cobertura.validadeDias') }}
          <input v-model="par.validadeDias" inputmode="numeric" data-testid="cob-p-dias" />
          <small v-if="errosPar['validadeDias']" class="erro" data-testid="cob-p-erro-dias">{{
            errosPar['validadeDias']
          }}</small>
        </label>
        <label
          >{{ t('cobertura.vigenciaInicio') }}
          <input v-model="par.vigenciaInicio" type="date" data-testid="cob-p-inicio"
        /></label>
        <p v-if="parRepetido" class="erro" role="alert" data-testid="cob-p-repetido">
          {{ t('cobertura.parRepetido') }}
        </p>
        <button
          type="submit"
          :disabled="Object.keys(errosPar).length > 0 || parRepetido"
          data-testid="cob-p-gravar"
        >
          {{ t('cobertura.gravar') }}
        </button>
        <button type="button" data-testid="cob-p-cancelar" @click="par = null">
          {{ t('cobertura.cancelar') }}
        </button>
      </form>
      <p v-if="!q.data.value.pares.length" class="secundario">{{ t('cobertura.vazio') }}</p>
      <article v-for="p in q.data.value.pares" :key="p.id" :data-testid="`cob-par-${p.id}`">
        <h3>
          {{ p.itemCodigo }} {{ p.itemDescricao }} · {{ t(`cobertura.relacoes.${p.tipo}`) }} ·
          {{ p.relacionadoCodigo }} {{ p.relacionadoDescricao }}
        </h3>
        <p class="secundario">
          {{ p.fonteNome ?? t('cobertura.geral') }}
          <span v-if="p.validadeDias !== null">
            · {{ t('cobertura.validadeDias') }}: {{ p.validadeDias }}</span
          >
          <span v-if="!p.ativo"> · {{ t('cobertura.inativa') }}</span>
        </p>
      </article>
    </section>

    <!-- Justificativas -->
    <section v-if="aba === 'justificativas' && q.data.value" data-testid="cob-justificativas">
      <form v-if="podeEditar" class="filtros" @submit.prevent="salvarJust">
        <label
          >{{ t('cobertura.codigo') }} <input v-model="just.codigo" maxlength="30" data-testid="cob-j-codigo"
        /></label>
        <label
          >{{ t('cobertura.descricao') }}
          <input v-model="just.descricao" maxlength="150" data-testid="cob-j-descricao"
        /></label>
        <label
          >{{ t('cobertura.textoPadrao') }}
          <input v-model="just.textoPadrao" maxlength="500" data-testid="cob-j-texto"
        /></label>
        <button type="submit" :disabled="!justOk" data-testid="cob-j-gravar">
          {{ t('cobertura.novaJustificativa') }}
        </button>
      </form>
      <ul>
        <li v-for="j in q.data.value.opcoes.justificativas" :key="j.id">
          {{ j.codigo }} · {{ j.descricao }}
        </li>
      </ul>
    </section>

    <!-- Por atendimento -->
    <section v-if="aba === 'atendimento'" data-testid="cob-atendimento">
      <form class="filtros" @submit.prevent="atendimento = Number(numeroAtendimento) || null">
        <label
          >{{ t('cobertura.atendimento') }}
          <input v-model="numeroAtendimento" inputmode="numeric" data-testid="cob-a-numero"
        /></label>
        <button type="submit" data-testid="cob-a-abrir">{{ t('cobertura.abrir') }}</button>
      </form>
      <ErroFaturamento v-if="qa.error.value" :erro="qa.error.value" />
      <template v-if="qa.data.value">
        <h2>{{ t('cobertura.excecoes') }}</h2>
        <p v-if="!qa.data.value.excecoes.length" class="secundario" data-testid="cob-a-vazio">
          {{ t('cobertura.semExcecao') }}
        </p>
        <article v-for="x in qa.data.value.excecoes" :key="x.id" :data-testid="`cob-exc-${x.id}`">
          <h3>
            {{ x.restricaoDescricao ?? `${x.itemCodigo ?? ''} ${x.itemDescricao ?? x.grupoDescricao ?? ''}` }}
            ·
            {{ x.justificativa }}
            <span v-if="x.revogada" data-testid="cob-exc-revogada"> · {{ t('cobertura.revogada') }}</span>
          </h3>
          <p class="secundario">
            {{ t('cobertura.por', { autor: x.autor, em: x.autorizadoEm.slice(0, 16).replace('T', ' ') }) }}
            <span v-if="x.quantidadeAutorizada !== null">
              · {{ t('cobertura.quantidadeAutorizada') }}: {{ x.quantidadeAutorizada }}</span
            >
            · {{ t('cobertura.valeEm') }}:
            {{ x.tiposAtendimento.map((a) => t(`cobertura.atendimentos.${a}`)).join(', ') }}
          </p>
          <SanteBotao
            v-if="podeLiberar && !x.revogada"
            variante="destrutivo"
            :rotulo="t('cobertura.revogar')"
            :confirmacao="t('cobertura.confirmarRevogar')"
            :data-testid="`cob-exc-revogar-${x.id}`"
            @acionar="revogar(x.id, x.versao)"
          />
        </article>

        <form v-if="podeLiberar" class="filtros" data-testid="cob-form-excecao" @submit.prevent="liberar">
          <h2>{{ t('cobertura.liberar') }}</h2>
          <SanteSelecao
            :model-value="exc.restricaoId"
            :rotulo="t('cobertura.restricao')"
            :opcoes="opRestrAtend"
            data-testid="cob-x-restricao"
            @update:model-value="escolherRestricaoExc"
          />
          <BuscaItemCobertura
            v-if="exc.restricaoId === null"
            v-model="exc.itemId"
            :rotulo="t('cobertura.item')"
            testid="cob-x-item"
          />
          <small v-if="errosExc['itemId']" class="erro" data-testid="cob-x-erro-item">{{
            errosExc['itemId']
          }}</small>
          <SanteSelecao
            v-model="exc.justificativaId"
            :rotulo="t('cobertura.justificativa')"
            :opcoes="opJust"
            data-testid="cob-x-justificativa"
          />
          <small v-if="errosExc['justificativaId']" class="erro" data-testid="cob-x-erro-just">{{
            errosExc['justificativaId']
          }}</small>
          <label
            >{{ t('cobertura.quantidadeAutorizada') }}
            <input v-model="exc.quantidadeAutorizada" inputmode="numeric" data-testid="cob-x-qtd"
          /></label>
          <label
            >{{ t('cobertura.numeroGuia') }}
            <input v-model="exc.numeroGuia" maxlength="20" data-testid="cob-x-guia"
          /></label>
          <label
            >{{ t('cobertura.observacao') }}
            <input v-model="exc.observacao" maxlength="1000" data-testid="cob-x-obs"
          /></label>
          <fieldset>
            <legend>{{ t('cobertura.valeEm') }}</legend>
            <label v-for="a in TIPOS_ATENDIMENTO_COBERTURA" :key="a">
              <input
                type="checkbox"
                :checked="exc.tiposAtendimento.includes(a)"
                :data-testid="`cob-x-vale-${a}`"
                @change="marcarTipo(a, ($event.target as HTMLInputElement).checked)"
              />
              {{ t(`cobertura.atendimentos.${a}`) }}
            </label>
            <small v-if="errosExc['tiposAtendimento']" class="erro">{{ errosExc['tiposAtendimento'] }}</small>
          </fieldset>
          <button type="submit" :disabled="Object.keys(errosExc).length > 0" data-testid="cob-x-liberar">
            {{ t('cobertura.liberar') }}
          </button>
        </form>
      </template>
    </section>
  </section>
</template>
