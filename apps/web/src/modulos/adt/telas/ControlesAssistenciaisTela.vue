<script setup lang="ts">
// Controles da internação (F78.04-1; 04-INT linhas 74, 75 e 78), uma tela com três abas, cada uma com rota própria:
//   /internacao/controles/formularios-obito  formulários numerados da declaração de óbito (lote, uso, devolução);
//   /internacao/controles/isolamento         auditoria do isolamento no leito e os avisos que ela gera para a CCIH;
//   /internacao/controles/regulacao          quadro clínico estruturado e evolução da solicitação à central.
// A validação roda na hora pelas mesmas regras do domínio que a API aplica; nada é apagado (cancelar e resolver
// deixam o histórico).
import {
  avaliarAuditoriaIsolamento,
  conferirQuadroClinico,
  decidirAcaoFormularioObito,
  decidirEventoRegulacao,
  numerosDoLote,
  type AcaoFormularioObito,
  type CondicaoGeral,
  type RespostaCriterio,
  type SituacaoRegulacao,
  type TipoEventoRegulacao,
} from '@sgh/dominio-internacao';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import {
  SITUACOES_FORMULARIO,
  acaoFormularioObito,
  conciliarFormulariosObito,
  incluirCriterioIsolamento,
  lerApoioRegulacao,
  lerAvisosIsolamento,
  lerCriteriosIsolamento,
  lerFormulariosObito,
  lerIsolamentosAuditar,
  lerLinhaTempoRegulacao,
  receberLoteObito,
  registrarAuditoriaIsolamento,
  registrarEventoRegulacao,
  registrarQuadroRegulacao,
  resolverAvisoIsolamento,
  type FormularioObito,
  type IsolamentoAuditar,
} from '../api-controles-assistenciais.js';
import { lerRegulacao } from '../api-nir.js';
import ErroAdt from '../componentes/ErroAdt.vue';

const props = defineProps<{ aba: 'obito' | 'isolamento' | 'regulacao' }>();
const { t } = useI18n();
const cliente = useQueryClient();
const K = 'adt.controles';
const hoje = () => new Date().toISOString().slice(0, 10);
const quando = (v: string | null) => (v ? new Date(v).toLocaleString() : '—');
const abas = [
  { aba: 'obito', rota: '/internacao/controles/formularios-obito' },
  { aba: 'isolamento', rota: '/internacao/controles/isolamento' },
  { aba: 'regulacao', rota: '/internacao/controles/regulacao' },
] as const;

const erro = ref<unknown>(null);
const aviso = ref('');
const acao = useMutation({
  mutationFn: (fn: () => Promise<string>) => fn(),
  onSuccess: (msg) => {
    erro.value = null;
    aviso.value = msg;
    void cliente.invalidateQueries({ queryKey: ['adt', 'controles'] });
  },
  onError: (e) => {
    erro.value = e;
  },
});
watch(
  () => props.aba,
  () => {
    erro.value = null;
    aviso.value = '';
  },
);

// ── Formulários de óbito ──
const filtroSituacao = ref<string | null>(null);
const formularios = useQuery({
  queryKey: computed(() => ['adt', 'controles', 'obito', filtroSituacao.value]),
  queryFn: () => lerFormulariosObito(filtroSituacao.value),
  enabled: computed(() => props.aba === 'obito'),
});
const opSituacoes = computed(() => [
  { valor: null, rotulo: t('adt.todos') },
  ...SITUACOES_FORMULARIO.map((s) => ({ valor: s, rotulo: t(`${K}.obito.situacoes.${s}`) })),
]);
const lote = reactive({ inicial: '', final: '', lote: '', recebidoEm: hoje(), orgao: '' });
const loteConferido = computed(() =>
  lote.inicial && lote.final ? numerosDoLote(lote.inicial, lote.final) : null,
);
const receber = () =>
  acao.mutate(async () => {
    const r = await receberLoteObito({
      inicial: lote.inicial,
      final: lote.final,
      lote: lote.lote.trim() || null,
      recebidoEm: lote.recebidoEm,
      orgao: lote.orgao.trim() || null,
    });
    lote.inicial = '';
    lote.final = '';
    return t(`${K}.obito.loteRecebido`, { n: r.quantidade });
  });
const conciliar = () =>
  acao.mutate(async () => {
    const r = await conciliarFormulariosObito();
    return t(`${K}.obito.conciliado`, { l: r.ligados, s: r.semFormulario });
  });
type AcaoLinha = { acao: AcaoFormularioObito | null; motivo: string; declaracao: number | null };
const linhas = reactive<Record<number, AcaoLinha>>({});
const linha = (f: FormularioObito) => (linhas[f.id] ??= { acao: null, motivo: '', declaracao: null });
const opAcoes = computed(() => [
  { valor: null, rotulo: t('adt.escolha') },
  ...(['usar', 'extraviar', 'cancelar', 'devolver'] as const).map((a) => ({
    valor: a,
    rotulo: t(`${K}.obito.acoes.${a}`),
  })),
]);
/** A mesma decisão do domínio; no "usar", a declaração é conferida pela API (número e situação). */
const problemaAcao = (f: FormularioObito): string | null => {
  const l = linha(f);
  if (!l.acao) return null;
  if (l.acao === 'usar') {
    if (f.situacao !== 'disponivel') return t(`${K}.obito.usarSemDisponivel`);
    return l.declaracao ? null : t(`${K}.obito.usarSemDeclaracao`);
  }
  const d = decidirAcaoFormularioObito(f.situacao, l.acao, {
    motivo: l.motivo,
    numeroFormulario: f.numero,
    declaracao: f.declaracao
      ? {
          numero: f.declaracao.numero,
          situacao: f.declaracao.situacao as 'rascunho' | 'emitida' | 'cancelada',
          jaTemFormulario: true,
        }
      : null,
  });
  return d.ok ? null : d.mensagem;
};
const aplicar = (f: FormularioObito) =>
  acao.mutate(async () => {
    const l = linha(f);
    await acaoFormularioObito(f.id, {
      acao: l.acao!,
      declaracao: l.acao === 'usar' ? l.declaracao : null,
      motivo: l.motivo.trim() || null,
      versao: f.versao,
    });
    delete linhas[f.id];
    return t(`${K}.obito.acaoFeita`, { n: f.numero });
  });

// ── Auditoria do isolamento ──
const isolamentos = useQuery({
  queryKey: ['adt', 'controles', 'isolamentos'],
  queryFn: lerIsolamentosAuditar,
  enabled: computed(() => props.aba === 'isolamento'),
});
const avisos = useQuery({
  queryKey: ['adt', 'controles', 'avisos'],
  queryFn: lerAvisosIsolamento,
  enabled: computed(() => props.aba === 'isolamento'),
});
const escolhido = ref<IsolamentoAuditar | null>(null);
const criterios = useQuery({
  queryKey: computed(() => ['adt', 'controles', 'criterios', escolhido.value?.tipoPrecaucao.id]),
  queryFn: () => lerCriteriosIsolamento(escolhido.value!.tipoPrecaucao.id),
  enabled: computed(() => props.aba === 'isolamento' && !!escolhido.value),
});
type Resp = { resposta: RespostaCriterio | null; naoConformidade: string; acaoCorretiva: string };
const respostas = reactive<Record<number, Resp>>({});
const resp = (id: number) => (respostas[id] ??= { resposta: null, naoConformidade: '', acaoCorretiva: '' });
const observacaoAuditoria = ref('');
const auditar = (i: IsolamentoAuditar) => {
  escolhido.value = i;
  for (const k of Object.keys(respostas)) delete respostas[Number(k)];
  observacaoAuditoria.value = '';
};
const opRespostas = computed(() => [
  { valor: null, rotulo: t('adt.escolha') },
  ...(['conforme', 'nao_conforme', 'nao_se_aplica'] as const).map((r) => ({
    valor: r,
    rotulo: t(`${K}.isolamento.respostas.${r}`),
  })),
]);
const respostasDadas = computed(() =>
  (criterios.data.value?.itens ?? [])
    .filter((c) => resp(c.id).resposta)
    .map((c) => ({
      criterio: c.id,
      resposta: resp(c.id).resposta!,
      naoConformidade: resp(c.id).naoConformidade.trim() || null,
      acaoCorretiva: resp(c.id).acaoCorretiva.trim() || null,
    })),
);
const avaliacao = computed(() =>
  escolhido.value && criterios.data.value
    ? avaliarAuditoriaIsolamento(true, criterios.data.value.itens, respostasDadas.value)
    : null,
);
const gravarAuditoria = () =>
  acao.mutate(async () => {
    const r = await registrarAuditoriaIsolamento({
      isolamento: escolhido.value!.isolamento,
      observacao: observacaoAuditoria.value.trim() || null,
      respostas: respostasDadas.value,
    });
    escolhido.value = null;
    return [
      t(`${K}.isolamento.gravada`, {
        geral: t(`${K}.isolamento.geral.${r.geral}`),
        p: r.percentual === null ? '—' : r.percentual.toFixed(1),
      }),
      r.leitosBloqueados.length
        ? t(`${K}.isolamento.quartoBloqueado`, { leitos: r.leitosBloqueados.join(', ') })
        : '',
      r.leitosOcupadosNoQuarto.length
        ? t(`${K}.isolamento.quartoOcupado`, { leitos: r.leitosOcupadosNoQuarto.join(', ') })
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  });
const criterio = reactive({ descricao: '', acao: 'registrar', validadeDias: null as number | null });
const opAcaoCriterio = computed(() =>
  (['registrar', 'alertar', 'bloquear'] as const).map((a) => ({
    valor: a,
    rotulo: t(`${K}.isolamento.acoes.${a}`),
  })),
);
const incluirCriterio = () =>
  acao.mutate(async () => {
    await incluirCriterioIsolamento({
      tipoPrecaucao: escolhido.value!.tipoPrecaucao.id,
      descricao: criterio.descricao.trim(),
      acao: criterio.acao,
      validadeDias: criterio.validadeDias || null,
    });
    criterio.descricao = '';
    return t(`${K}.isolamento.novoCriterio`);
  });
const providencias = reactive<Record<number, string>>({});
const resolver = (id: number, versao: number) =>
  acao.mutate(async () => {
    const r = await resolverAvisoIsolamento(id, (providencias[id] ?? '').trim(), versao);
    delete providencias[id];
    if (r.leitosMantidos) return t(`${K}.isolamento.mantidos`, { n: r.leitosMantidos });
    return r.leitosLiberados
      ? t(`${K}.isolamento.liberados`, { n: r.leitosLiberados })
      : t(`${K}.isolamento.resolvido`);
  });

// ── Regulação ──
const regulacoes = useQuery({
  queryKey: ['adt', 'controles', 'regulacoes'],
  queryFn: lerRegulacao,
  enabled: computed(() => props.aba === 'regulacao'),
});
const apoio = useQuery({
  queryKey: ['adt', 'controles', 'apoio-regulacao'],
  queryFn: lerApoioRegulacao,
  enabled: computed(() => props.aba === 'regulacao'),
});
const solicitacao = ref<number | null>(null);
const opSolicitacoes = computed(() => [
  { valor: null, rotulo: t('adt.escolha') },
  ...(regulacoes.data.value?.solicitacoes ?? [])
    .filter((s) => s.vigente)
    .map((s) => ({
      valor: s.vigente!.id,
      rotulo: `${s.paciente.nome} · ${s.vigente!.numero} · ${s.vigente!.situacao}`,
    })),
]);
const linhaTempo = useQuery({
  queryKey: computed(() => ['adt', 'controles', 'linha-tempo', solicitacao.value]),
  queryFn: () => lerLinhaTempoRegulacao(solicitacao.value!),
  enabled: computed(() => props.aba === 'regulacao' && !!solicitacao.value),
});
const opDe = (lista: readonly { id: number; descricao: string }[] | undefined) => [
  { valor: null, rotulo: t(`${K}.regulacao.nenhum`) },
  ...(lista ?? []).map((o) => ({ valor: o.id, rotulo: o.descricao })),
];
const q = reactive({
  quadroClinico: '',
  condicaoGeral: 'estavel' as CondicaoGeral,
  nivelConsciencia: null as number | null,
  suporteOxigenio: null as number | null,
  fluxoOxigenio: null as number | null,
  fracaoInspirada: null as number | null,
  peep: null as number | null,
  faixaDiurese: null as number | null,
  frequenciaCardiaca: null as number | null,
  frequenciaRespiratoria: null as number | null,
  pressaoSistolica: null as number | null,
  pressaoDiastolica: null as number | null,
  temperatura: null as number | null,
  saturacao: null as number | null,
  usaDrogaVasoativa: false,
  drogasVasoativas: '',
  necessitaIsolamento: false,
  germeMultirresistente: '',
});
const opCondicoes = computed(() =>
  (['estavel', 'instavel', 'grave', 'critico'] as const).map((c) => ({
    valor: c,
    rotulo: t(`${K}.regulacao.condicoes.${c}`),
  })),
);
const numOuNull = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));
const corpoQuadro = computed(() => ({
  quadroClinico: q.quadroClinico,
  condicaoGeral: q.condicaoGeral,
  nivelConsciencia: q.nivelConsciencia,
  suporteOxigenio: q.suporteOxigenio,
  fluxoOxigenio: numOuNull(q.fluxoOxigenio),
  fracaoInspirada: numOuNull(q.fracaoInspirada),
  peep: numOuNull(q.peep),
  faixaDiurese: q.faixaDiurese,
  frequenciaCardiaca: numOuNull(q.frequenciaCardiaca),
  frequenciaRespiratoria: numOuNull(q.frequenciaRespiratoria),
  pressaoSistolica: numOuNull(q.pressaoSistolica),
  pressaoDiastolica: numOuNull(q.pressaoDiastolica),
  temperatura: numOuNull(q.temperatura),
  saturacao: numOuNull(q.saturacao),
  usaDrogaVasoativa: q.usaDrogaVasoativa,
  drogasVasoativas: q.drogasVasoativas.trim() || null,
  necessitaIsolamento: q.necessitaIsolamento,
  germeMultirresistente: q.germeMultirresistente.trim() || null,
}));
const conferenciaQuadro = computed(() => {
  const invasivo = !!apoio.data.value?.suportesOxigenio.find((s) => s.id === q.suporteOxigenio)?.invasivo;
  return conferirQuadroClinico({ ...corpoQuadro.value, suporteInvasivo: invasivo });
});
const gravarQuadro = () =>
  acao.mutate(async () => {
    const r = await registrarQuadroRegulacao(solicitacao.value!, {
      ...corpoQuadro.value,
      versao: linhaTempo.data.value!.solicitacao.versao,
    });
    q.quadroClinico = '';
    return [t(`${K}.regulacao.quadroGravado`, { n: r.sequencia }), r.aviso].filter(Boolean).join(' ');
  });
const ev = reactive({
  tipo: 'contato_central' as TipoEventoRegulacao,
  situacaoNova: null as SituacaoRegulacao | null,
  observacao: '',
});
const opTipos = computed(() =>
  (['resposta', 'mudanca_situacao', 'contato_central', 'cancelamento'] as const).map((x) => ({
    valor: x,
    rotulo: t(`${K}.regulacao.tiposEvento.${x}`),
  })),
);
const opSituacoesReg = computed(() => [
  { valor: null, rotulo: t(`${K}.regulacao.semMudanca`) },
  ...(['solicitada', 'em_analise', 'autorizada', 'negada', 'cancelada', 'concluida'] as const).map((x) => ({
    valor: x,
    rotulo: t(`${K}.regulacao.situacoes.${x}`),
  })),
]);
const conferenciaEvento = computed(() => {
  const s = linhaTempo.data.value?.solicitacao;
  if (!s) return null;
  return decidirEventoRegulacao(
    s.situacao as SituacaoRegulacao,
    ev.tipo,
    ev.situacaoNova,
    ev.observacao.trim() || null,
  );
});
const gravarEvento = () =>
  acao.mutate(async () => {
    const r = await registrarEventoRegulacao(solicitacao.value!, {
      tipo: ev.tipo,
      situacaoNova: ev.situacaoNova,
      observacao: ev.observacao.trim() || null,
      versao: linhaTempo.data.value!.solicitacao.versao,
    });
    ev.observacao = '';
    ev.situacaoNova = null;
    return t(`${K}.regulacao.eventoGravado`, { s: r.situacao });
  });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="controles-titulo" data-testid="tela-controles-internacao">
    <h1 id="controles-titulo">{{ t(`${K}.titulo`) }}</h1>
    <nav class="filtros" :aria-label="t(`${K}.titulo`)">
      <RouterLink
        v-for="a in abas"
        :key="a.aba"
        :to="a.rota"
        :aria-current="a.aba === aba ? 'page' : undefined"
        :data-testid="`controles-aba-${a.aba}`"
        >{{ t(`${K}.abas.${a.aba}`) }}</RouterLink
      >
    </nav>
    <ErroAdt v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="controles-aviso">{{ aviso }}</p>

    <!-- Formulários de óbito -->
    <template v-if="aba === 'obito'">
      <p>{{ t(`${K}.obito.texto`) }}</p>
      <ErroAdt v-if="formularios.isError.value" :erro="formularios.error.value" />
      <template v-if="formularios.data.value">
        <p data-testid="obito-resumo">
          {{
            t(`${K}.obito.resumo`, {
              d: formularios.data.value.resumo.porSituacao['disponivel'] ?? 0,
              u: formularios.data.value.resumo.porSituacao['utilizado'] ?? 0,
              c: formularios.data.value.resumo.porSituacao['cancelado'] ?? 0,
              e: formularios.data.value.resumo.porSituacao['extraviado'] ?? 0,
              v: formularios.data.value.resumo.porSituacao['devolvido'] ?? 0,
            })
          }}
        </p>
        <p v-if="formularios.data.value.resumo.estoqueBaixo" role="alert">
          {{ t(`${K}.obito.estoqueBaixo`) }}
        </p>
        <p v-if="formularios.data.value.resumo.viasADevolver">
          {{ t(`${K}.obito.viasADevolver`, { n: formularios.data.value.resumo.viasADevolver }) }}
        </p>
        <p v-if="formularios.data.value.declaracoesSemFormulario">
          {{ t(`${K}.obito.semFormulario`, { n: formularios.data.value.declaracoesSemFormulario }) }}
          <button type="button" data-testid="obito-conciliar" @click="conciliar">
            {{ t(`${K}.obito.conciliar`) }}
          </button>
        </p>
      </template>

      <form class="filtros" data-testid="obito-lote-form" @submit.prevent="receber">
        <h2>{{ t(`${K}.obito.lote`) }}</h2>
        <label
          >{{ t(`${K}.obito.inicial`) }}
          <input v-model="lote.inicial" inputmode="numeric" required data-testid="obito-inicial"
        /></label>
        <label
          >{{ t(`${K}.obito.final`) }}
          <input v-model="lote.final" inputmode="numeric" required data-testid="obito-final"
        /></label>
        <label
          >{{ t(`${K}.obito.loteNumero`) }}
          <input v-model="lote.lote" maxlength="30" data-testid="obito-lote"
        /></label>
        <label
          >{{ t(`${K}.obito.recebidoEm`) }}
          <input v-model="lote.recebidoEm" type="date" required data-testid="obito-recebido"
        /></label>
        <label
          >{{ t(`${K}.obito.orgao`) }} <input v-model="lote.orgao" maxlength="150" data-testid="obito-orgao"
        /></label>
        <p v-if="loteConferido && !loteConferido.ok" role="alert" data-testid="obito-lote-problema">
          {{ loteConferido.mensagem }}
        </p>
        <p v-else-if="loteConferido" data-testid="obito-lote-quantidade">
          {{ t(`${K}.obito.loteQuantidade`, { n: loteConferido.numeros.length }) }}
        </p>
        <button
          type="submit"
          :disabled="!loteConferido?.ok || acao.isPending.value"
          data-testid="obito-receber"
        >
          {{ t(`${K}.obito.receber`) }}
        </button>
      </form>

      <SanteSelecao v-model="filtroSituacao" :rotulo="t(`${K}.obito.situacao`)" :opcoes="opSituacoes" />
      <table v-if="formularios.data.value" data-testid="obito-tabela">
        <thead>
          <tr>
            <th>{{ t(`${K}.obito.numero`) }}</th>
            <th>{{ t(`${K}.obito.situacao`) }}</th>
            <th>{{ t(`${K}.obito.declaracao`) }}</th>
            <th>{{ t(`${K}.obito.motivo`) }}</th>
            <th>{{ t('adt.acoesColuna') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in formularios.data.value.itens" :key="f.id" :data-testid="`obito-linha-${f.numero}`">
            <td>{{ f.numero }}</td>
            <td>{{ t(`${K}.obito.situacoes.${f.situacao}`) }}</td>
            <td>{{ f.declaracao?.numero ?? '—' }}</td>
            <td>{{ f.motivo ?? '' }}</td>
            <td>
              <template v-if="f.situacao !== 'devolvido' && f.situacao !== 'extraviado'">
                <SanteSelecao
                  v-model="linha(f).acao"
                  :rotulo="t(`${K}.obito.acao`)"
                  ocultar-rotulo
                  :opcoes="opAcoes"
                />
                <label v-if="linha(f).acao === 'usar'"
                  >{{ t(`${K}.obito.declaracaoId`) }}
                  <input v-model.number="linha(f).declaracao" type="number" min="1"
                /></label>
                <label v-else-if="linha(f).acao"
                  >{{ t(`${K}.obito.motivo`) }}
                  <input v-model="linha(f).motivo" maxlength="500" :data-testid="`obito-motivo-${f.numero}`"
                /></label>
                <p v-if="problemaAcao(f)" role="alert">{{ problemaAcao(f) }}</p>
                <button
                  v-if="linha(f).acao"
                  type="button"
                  :disabled="!!problemaAcao(f) || acao.isPending.value"
                  :data-testid="`obito-aplicar-${f.numero}`"
                  @click="aplicar(f)"
                >
                  {{ t(`${K}.obito.aplicar`) }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- Auditoria do isolamento -->
    <template v-else-if="aba === 'isolamento'">
      <p>{{ t(`${K}.isolamento.texto`) }}</p>
      <ErroAdt v-if="isolamentos.isError.value" :erro="isolamentos.error.value" />
      <h2>{{ t(`${K}.isolamento.avisos`) }}</h2>
      <p v-if="avisos.data.value && !avisos.data.value.itens.length">{{ t(`${K}.isolamento.semAvisos`) }}</p>
      <ul v-else-if="avisos.data.value" data-testid="iso-avisos">
        <li v-for="a in avisos.data.value.itens" :key="a.id" :data-testid="`iso-aviso-${a.id}`">
          <strong>{{ t(`${K}.isolamento.prioridades.${a.prioridade}`) }}</strong> · {{ a.titulo }} ·
          {{ t('adt.paciente') }} {{ a.paciente }} · {{ quando(a.geradoEm) }}
          <pre>{{ a.mensagem }}</pre>
          <p v-if="a.leitosBloqueados.length" role="alert" :data-testid="`iso-aviso-bloqueio-${a.id}`">
            {{ t(`${K}.isolamento.leitosBloqueados`, { leitos: a.leitosBloqueados.join(', ') }) }}
          </p>
          <label
            >{{ t(`${K}.isolamento.providencia`) }}
            <input v-model="providencias[a.id]" maxlength="2000" :data-testid="`iso-providencia-${a.id}`"
          /></label>
          <button
            type="button"
            :disabled="(providencias[a.id] ?? '').trim().length < 3 || acao.isPending.value"
            :data-testid="`iso-resolver-${a.id}`"
            @click="resolver(a.id, a.versao)"
          >
            {{ t(`${K}.isolamento.resolver`) }}
          </button>
        </li>
      </ul>

      <h2>{{ t(`${K}.isolamento.pendentes`) }}</h2>
      <table v-if="isolamentos.data.value" data-testid="iso-tabela">
        <thead>
          <tr>
            <th>{{ t('adt.paciente') }}</th>
            <th>{{ t('adt.leito') }}</th>
            <th>{{ t(`${K}.isolamento.tipo`) }}</th>
            <th>{{ t(`${K}.isolamento.ultima`) }}</th>
            <th>{{ t(`${K}.isolamento.proxima`) }}</th>
            <th>{{ t('adt.acoesColuna') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in isolamentos.data.value.itens" :key="i.isolamento">
            <td>{{ i.paciente }}</td>
            <td>{{ i.leito ?? '—' }}</td>
            <td>{{ i.tipoPrecaucao.descricao }}</td>
            <td>{{ quando(i.ultimaAuditoria) }}</td>
            <td>
              {{ i.auditoriaPendente ? t(`${K}.isolamento.pendente`) : quando(i.proximaAuditoria) }}
            </td>
            <td>
              <button type="button" :data-testid="`iso-auditar-${i.isolamento}`" @click="auditar(i)">
                {{ t(`${K}.isolamento.auditar`) }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <form v-if="escolhido" data-testid="iso-auditoria-form" @submit.prevent="gravarAuditoria">
        <h2>{{ t(`${K}.isolamento.criterios`, { tipo: escolhido.tipoPrecaucao.descricao }) }}</h2>
        <ol>
          <li v-for="c in criterios.data.value?.itens ?? []" :key="c.id">
            {{ c.descricao }} ({{ t(`${K}.isolamento.acoes.${c.acao}`) }})
            <SanteSelecao
              v-model="resp(c.id).resposta"
              :rotulo="c.descricao"
              ocultar-rotulo
              :opcoes="opRespostas"
              :data-testid="`iso-resposta-${c.ordem}`"
            />
            <template v-if="resp(c.id).resposta === 'nao_conforme'">
              <label
                >{{ t(`${K}.isolamento.naoConformidade`) }}
                <input v-model="resp(c.id).naoConformidade" maxlength="1000"
              /></label>
              <label
                >{{ t(`${K}.isolamento.acaoCorretiva`) }}
                <input v-model="resp(c.id).acaoCorretiva" maxlength="1000"
              /></label>
            </template>
          </li>
        </ol>
        <label
          >{{ t(`${K}.isolamento.observacao`) }} <input v-model="observacaoAuditoria" maxlength="2000"
        /></label>
        <template v-if="avaliacao">
          <p v-if="!avaliacao.ok" role="alert" data-testid="iso-problema">{{ avaliacao.mensagem }}</p>
          <template v-else>
            <p data-testid="iso-resultado">
              {{
                t(`${K}.isolamento.resultado`, {
                  geral: t(`${K}.isolamento.geral.${avaliacao.geral}`),
                  p: avaliacao.percentual === null ? '—' : avaliacao.percentual.toFixed(1),
                })
              }}
            </p>
            <p v-if="avaliacao.alertas.length" role="alert">
              {{ t(`${K}.isolamento.alertas`, { n: avaliacao.alertas.length }) }}
            </p>
            <p
              v-if="avaliacao.alertas.some((x) => x.acao === 'bloquear')"
              role="alert"
              data-testid="iso-previa-bloqueio"
            >
              {{ t(`${K}.isolamento.previaBloqueio`) }}
            </p>
          </template>
        </template>
        <button type="submit" :disabled="!avaliacao?.ok || acao.isPending.value" data-testid="iso-gravar">
          {{ t(`${K}.isolamento.gravar`) }}
        </button>
      </form>
      <form
        v-if="escolhido"
        class="filtros"
        data-testid="iso-criterio-form"
        @submit.prevent="incluirCriterio"
      >
        <h2>{{ t(`${K}.isolamento.novoCriterio`) }}</h2>
        <label
          >{{ t(`${K}.isolamento.descricao`) }}
          <input v-model="criterio.descricao" minlength="3" maxlength="500" required
        /></label>
        <SanteSelecao
          v-model="criterio.acao"
          :rotulo="t(`${K}.isolamento.acaoNaoConformidade`)"
          :opcoes="opAcaoCriterio"
        />
        <label
          >{{ t(`${K}.isolamento.validadeDias`) }}
          <input v-model.number="criterio.validadeDias" type="number" min="1" max="365"
        /></label>
        <button type="submit" :disabled="criterio.descricao.trim().length < 3 || acao.isPending.value">
          {{ t(`${K}.isolamento.incluir`) }}
        </button>
      </form>
    </template>

    <!-- Regulação -->
    <template v-else>
      <p>{{ t(`${K}.regulacao.texto`) }}</p>
      <ErroAdt v-if="regulacoes.isError.value" :erro="regulacoes.error.value" />
      <SanteSelecao
        v-model="solicitacao"
        :rotulo="t(`${K}.regulacao.solicitacao`)"
        :opcoes="opSolicitacoes"
        data-testid="reg-solicitacao"
      />
      <p v-if="!solicitacao">{{ t(`${K}.regulacao.escolhaSolicitacao`) }}</p>
      <template v-if="linhaTempo.data.value">
        <p data-testid="reg-situacao">
          {{
            t(`${K}.regulacao.situacaoAtual`, {
              s: t(`${K}.regulacao.situacoes.${linhaTempo.data.value.solicitacao.situacao}`),
            })
          }}
          · {{ t(`${K}.regulacao.envioManual`) }}
        </p>

        <form data-testid="reg-quadro-form" @submit.prevent="gravarQuadro">
          <h2>{{ t(`${K}.regulacao.quadro`) }}</h2>
          <label
            >{{ t(`${K}.regulacao.quadroClinico`) }}
            <textarea v-model="q.quadroClinico" maxlength="20000" rows="3" data-testid="reg-quadro-texto" />
          </label>
          <div class="filtros">
            <SanteSelecao
              v-model="q.condicaoGeral"
              :rotulo="t(`${K}.regulacao.condicao`)"
              :opcoes="opCondicoes"
            />
            <SanteSelecao
              v-model="q.nivelConsciencia"
              :rotulo="t(`${K}.regulacao.consciencia`)"
              :opcoes="opDe(apoio.data.value?.niveisConsciencia)"
            />
            <SanteSelecao
              v-model="q.suporteOxigenio"
              :rotulo="t(`${K}.regulacao.suporte`)"
              :opcoes="opDe(apoio.data.value?.suportesOxigenio)"
            />
            <SanteSelecao
              v-model="q.faixaDiurese"
              :rotulo="t(`${K}.regulacao.diurese`)"
              :opcoes="opDe(apoio.data.value?.faixasDiurese)"
            />
          </div>
          <div class="filtros">
            <label
              >{{ t(`${K}.regulacao.fluxo`) }}
              <input v-model.number="q.fluxoOxigenio" type="number" step="0.1"
            /></label>
            <label
              >{{ t(`${K}.regulacao.fio2`) }} <input v-model.number="q.fracaoInspirada" type="number"
            /></label>
            <label>{{ t(`${K}.regulacao.peep`) }} <input v-model.number="q.peep" type="number" /></label>
            <label
              >{{ t(`${K}.regulacao.fc`) }}
              <input v-model.number="q.frequenciaCardiaca" type="number" data-testid="reg-fc"
            /></label>
            <label
              >{{ t(`${K}.regulacao.fr`) }} <input v-model.number="q.frequenciaRespiratoria" type="number"
            /></label>
            <label
              >{{ t(`${K}.regulacao.pas`) }} <input v-model.number="q.pressaoSistolica" type="number"
            /></label>
            <label
              >{{ t(`${K}.regulacao.pad`) }} <input v-model.number="q.pressaoDiastolica" type="number"
            /></label>
            <label
              >{{ t(`${K}.regulacao.temperatura`) }}
              <input v-model.number="q.temperatura" type="number" step="0.1"
            /></label>
            <label
              >{{ t(`${K}.regulacao.saturacao`) }}
              <input v-model.number="q.saturacao" type="number" data-testid="reg-saturacao"
            /></label>
          </div>
          <label><input v-model="q.usaDrogaVasoativa" type="checkbox" /> {{ t(`${K}.regulacao.dva`) }}</label>
          <label v-if="q.usaDrogaVasoativa"
            >{{ t(`${K}.regulacao.drogas`) }} <input v-model="q.drogasVasoativas" maxlength="500"
          /></label>
          <label
            ><input v-model="q.necessitaIsolamento" type="checkbox" />
            {{ t(`${K}.regulacao.isolamento`) }}</label
          >
          <label
            >{{ t(`${K}.regulacao.germe`) }} <input v-model="q.germeMultirresistente" maxlength="200"
          /></label>
          <p v-if="!conferenciaQuadro.ok" role="alert" data-testid="reg-quadro-problema">
            {{ conferenciaQuadro.mensagem }}
          </p>
          <p v-else-if="conferenciaQuadro.aviso" role="alert" data-testid="reg-quadro-aviso">
            {{ conferenciaQuadro.aviso }}
          </p>
          <button
            type="submit"
            :disabled="!conferenciaQuadro.ok || acao.isPending.value"
            data-testid="reg-quadro-gravar"
          >
            {{ t(`${K}.regulacao.gravarQuadro`) }}
          </button>
        </form>

        <form class="filtros" data-testid="reg-evento-form" @submit.prevent="gravarEvento">
          <h2>{{ t(`${K}.regulacao.evento`) }}</h2>
          <SanteSelecao v-model="ev.tipo" :rotulo="t(`${K}.regulacao.tipoEvento`)" :opcoes="opTipos" />
          <SanteSelecao
            v-model="ev.situacaoNova"
            :rotulo="t(`${K}.regulacao.situacaoNova`)"
            :opcoes="opSituacoesReg"
          />
          <label
            >{{ t(`${K}.regulacao.observacao`) }}
            <input v-model="ev.observacao" maxlength="2000" data-testid="reg-evento-obs"
          /></label>
          <p v-if="conferenciaEvento && !conferenciaEvento.ok" role="alert" data-testid="reg-evento-problema">
            {{ conferenciaEvento.mensagem }}
          </p>
          <button
            type="submit"
            :disabled="!conferenciaEvento?.ok || acao.isPending.value"
            data-testid="reg-evento-gravar"
          >
            {{ t(`${K}.regulacao.gravarEvento`) }}
          </button>
        </form>

        <h2>{{ t(`${K}.regulacao.linhaTempo`) }}</h2>
        <h3>{{ t(`${K}.regulacao.quadros`) }}</h3>
        <ol data-testid="reg-quadros">
          <li v-for="x in linhaTempo.data.value.quadros" :key="x.id">
            {{ x.sequencia }} · {{ quando(x.registradoEm) }} ·
            {{ t(`${K}.regulacao.condicoes.${x.condicaoGeral}`) }} · {{ x.quadroClinico }}
          </li>
        </ol>
        <h3>{{ t(`${K}.regulacao.eventos`) }}</h3>
        <ol data-testid="reg-eventos">
          <li v-for="x in linhaTempo.data.value.eventos" :key="x.id">
            {{ quando(x.em) }} · {{ t(`${K}.regulacao.tiposEvento.${x.tipo}`) }} ·
            {{ `${x.de ?? ''} → ${x.para ?? ''}` }}
            <template v-if="x.observacao"> · {{ x.observacao }}</template>
          </li>
        </ol>
      </template>
    </template>
  </section>
</template>
