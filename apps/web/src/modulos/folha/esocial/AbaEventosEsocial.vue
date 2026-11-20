<script setup lang="ts">
// Aba "Eventos" (M53.6; consulta com `pessoas.esocial.ler`; gerar, descartar, excluir e retificar com
// `pessoas.esocial.gerar`; montar o lote com `pessoas.esocial.transmitir`; regras 1 e 9): os eventos do empregador com
// filtros (evento, situação, período); gerar os de tabela (S-1000, S-1005, S-1010 com as rubricas, S-1020; inclusão,
// alteração ou exclusão, com o início da validade) e os do trabalhador (S-2200 a S-2399, com o registro de origem:
// afastamento, rescisão ou data da alteração), sempre pela prévia conferida no leiaute oficial (pendências, erros e o XML)
// antes de gravar; o detalhe com o XML (só para quem gera; leitura auditada); descartar com motivo; excluir o aceito pelo
// S-3000; retificar o aceito do trabalhador; escolher os validados e montar o lote (mesmo grupo, até 50).
import {
  type ApoioEsocial,
  type DetalheEventoEsocial,
  esquemaDescartarEventoEsocial,
  esquemaExcluirEventoEsocial,
  esquemaGerarEventosTabela,
  esquemaGerarEventoTrabalhador,
  EVENTOS_ESOCIAL,
  EVENTOS_TABELA_ESOCIAL,
  EVENTOS_TRABALHADOR_ESOCIAL,
  type EventoEsocial,
  type EventoEsocialResumo,
  type EventoTabelaEsocial,
  type EventoTrabalhadorEsocial,
  type ExcluirEventoEsocialEntrada,
  type GerarEventosTabelaEntrada,
  type GerarEventoTrabalhadorEntrada,
  OPERACOES_TABELA_ESOCIAL,
  type OperacaoTabelaEsocial,
  type ResultadoGeracaoEsocial,
  SITUACOES_EVENTO_ESOCIAL,
  type SituacaoEventoEsocial,
  TETO_EVENTOS_LOTE_ESOCIAL,
} from '@sgh/contratos';
import {
  SanteAlerta,
  SanteBotao,
  SanteCampoTexto,
  SanteData,
  SanteDialogo,
  SanteMarcadores,
  SanteSelecao,
} from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { dataBr } from '../../pessoas/comum.js';
import { lerAfastamentos } from '../api-folha.js';
import { competenciasAte, instanteBr, rotuloCompetencia } from '../comum-folha.js';
import { lerRescisoes } from '../rescisao/api-rescisao.js';
import ErroFolha from '../telas/ErroFolha.vue';
import {
  descartarEventoEsocial,
  excluirEventoEsocial,
  gerarEventosTabela,
  gerarEventoTrabalhador,
  lerEventoEsocial,
  lerEventosEsocial,
  montarLoteEsocial,
} from './api-esocial.js';
import BuscaColaboradorEsocial from './BuscaColaboradorEsocial.vue';
import {
  acoesDoEvento,
  type ColaboradorEscolhido,
  conferirEscolha,
  origemDoEvento,
  rotuloEvento,
} from './comum-esocial.js';

const props = defineProps<{ apoio: ApoioEsocial; empresa: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const { permissoes } = usarSessao();
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
async function atualizar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['folha', 'esocial'] });
}
const quem = (e: EventoEsocialResumo) =>
  e.vinculo === null
    ? '—'
    : [
        e.matricula ? t('folha.esocial.matricula', { m: e.matricula }) : null,
        t('folha.esocial.vinculo', { v: e.vinculo }),
      ]
        .filter(Boolean)
        .join(' · ');
const referencia = (d: string) => (/^\d{4}-\d{2}$/.test(d) ? rotuloCompetencia(d) : dataBr(d));

// ── Lista ─────────────────────────────────────────────────────────────────────────────────────────────────────
const filtroEvento = ref<EventoEsocial | null>(null);
const filtroSituacao = ref<SituacaoEventoEsocial | null>(null);
const de = ref<string | null>(null);
const ate = ref<string | null>(null);
const opcoesFiltroEvento = computed(() => [
  { valor: null, rotulo: t('folha.esocial.eventos.todos') },
  ...EVENTOS_ESOCIAL.map((e) => ({ valor: e, rotulo: rotuloEvento(e) })),
]);
const opcoesFiltroSituacao = computed(() => [
  { valor: null, rotulo: t('folha.esocial.eventos.todas') },
  ...SITUACOES_EVENTO_ESOCIAL.map((s) => ({ valor: s, rotulo: t(`folha.esocial.situacoesEvento.${s}`) })),
]);
const q = useQuery({
  queryKey: computed(() => [
    'folha',
    'esocial',
    'eventos',
    props.empresa,
    filtroEvento.value,
    filtroSituacao.value,
    de.value,
    ate.value,
  ]),
  queryFn: () =>
    lerEventosEsocial({
      empresa: props.empresa,
      evento: filtroEvento.value ?? undefined,
      situacao: filtroSituacao.value ?? undefined,
      de: de.value ?? undefined,
      ate: ate.value ?? undefined,
    }),
});
const itens = computed(() => q.data.value?.itens ?? []);
const acoes = (e: EventoEsocialResumo) => acoesDoEvento(e, props.apoio);

// ── Escolha para o lote ───────────────────────────────────────────────────────────────────────────────────────
const escolhidos = ref<number[]>([]);
const validados = computed(() => itens.value.filter((e) => acoes(e).lote));
const opcoesEscolha = computed(() =>
  validados.value.map((e) => ({
    valor: e.id,
    rotulo: `${e.id} · ${rotuloEvento(e.evento)} · ${quem(e)} · ${referencia(e.dataReferencia)}`,
  })),
);
watch(validados, (vs) => {
  const ids = new Set(vs.map((v) => v.id));
  escolhidos.value = escolhidos.value.filter((x) => ids.has(x));
});
const escolha = computed(() =>
  conferirEscolha(validados.value.filter((e) => escolhidos.value.includes(e.id))),
);
const textoEscolha = computed(() => {
  const c = escolha.value;
  if (c.ok) return t('folha.esocial.eventos.escolhidos', { n: escolhidos.value.length });
  if (c.motivo === 'misto') return t('folha.esocial.eventos.escolhaMista');
  if (c.motivo === 'teto') return t('folha.esocial.eventos.escolhaTeto', { n: TETO_EVENTOS_LOTE_ESOCIAL });
  return t('folha.esocial.eventos.escolhaVazia');
});
async function montarLote(): Promise<void> {
  if (!escolha.value.ok) return;
  erro.value = null;
  aviso.value = null;
  ocupado.value = true;
  try {
    const r = await montarLoteEsocial({ empresa: props.empresa, eventos: [...escolhidos.value] });
    escolhidos.value = [];
    aviso.value = t('folha.esocial.eventos.loteMontado', { id: r.lote.id, n: r.lote.quantidade });
    await atualizar();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Detalhe ───────────────────────────────────────────────────────────────────────────────────────────────────
const detalheVisivel = ref(false);
const detalhe = ref<DetalheEventoEsocial | null>(null);
const erroDetalhe = ref<unknown>(null);
async function ver(id: number): Promise<void> {
  detalhe.value = null;
  erroDetalhe.value = null;
  detalheVisivel.value = true;
  try {
    detalhe.value = await lerEventoEsocial(id);
  } catch (x) {
    erroDetalhe.value = x;
  }
}

// ── Prévia e gravação (tabela, trabalhador, exclusão) ─────────────────────────────────────────────────────────
type Pedido =
  | { readonly tipo: 'tabela'; readonly entrada: GerarEventosTabelaEntrada }
  | { readonly tipo: 'trabalhador'; readonly entrada: GerarEventoTrabalhadorEntrada }
  | { readonly tipo: 'exclusao'; readonly id: number; readonly entrada: ExcluirEventoEsocialEntrada };
const resultadoVisivel = ref(false);
const resultado = ref<ResultadoGeracaoEsocial | null>(null);
const pedido = ref<Pedido | null>(null);
const erroResultado = ref<unknown>(null);
async function executar(p: Pedido): Promise<ResultadoGeracaoEsocial> {
  if (p.tipo === 'tabela') return gerarEventosTabela(p.entrada);
  if (p.tipo === 'trabalhador') return gerarEventoTrabalhador(p.entrada);
  return excluirEventoEsocial(p.id, p.entrada);
}
const comGravar = (p: Pedido, gravar: boolean): Pedido =>
  p.tipo === 'exclusao'
    ? { ...p, entrada: { ...p.entrada, gravar } }
    : p.tipo === 'tabela'
      ? { ...p, entrada: { ...p.entrada, gravar } }
      : { ...p, entrada: { ...p.entrada, gravar } };
/** A prévia: devolve o erro para o formulário que a pediu. */
async function previa(p: Pedido): Promise<unknown> {
  ocupado.value = true;
  try {
    const r = await executar(comGravar(p, false));
    pedido.value = p;
    resultado.value = r;
    erroResultado.value = null;
    resultadoVisivel.value = true;
    return null;
  } catch (x) {
    return x;
  } finally {
    ocupado.value = false;
  }
}
const podeGravarResultado = computed(
  () =>
    !!pedido.value &&
    !!resultado.value &&
    !resultado.value.gravado &&
    resultado.value.eventos.some((e) => e.valido && e.pendencias.length === 0),
);
async function gravarResultado(): Promise<void> {
  if (!pedido.value) return;
  erroResultado.value = null;
  ocupado.value = true;
  try {
    const r = await executar(comGravar(pedido.value, true));
    resultado.value = r;
    const n = r.eventos.filter((e) => e.id !== null).length;
    aviso.value = n ? t('folha.esocial.previa.gravados', { n }) : t('folha.esocial.previa.nadaGravado');
    await atualizar();
  } catch (x) {
    erroResultado.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Gerar os de tabela ────────────────────────────────────────────────────────────────────────────────────────
const tabelaVisivel = ref(false);
const tabEventos = ref<EventoTabelaEsocial[]>([]);
const tabOperacao = ref<OperacaoTabelaEsocial>('inclusao');
const competencias = competenciasAte(`${Number(props.apoio.hoje.slice(0, 4)) + 1}-12-01`, 48);
const opcoesInicio = competencias.map((c) => ({ valor: c, rotulo: rotuloCompetencia(c) }));
const tabInicio = ref<string | null>(props.apoio.hoje.slice(0, 7));
const tabRubricas = ref('');
const erroTabela = ref<unknown>(null);
const opcoesEventosTabela = EVENTOS_TABELA_ESOCIAL.map((e) => ({ valor: e, rotulo: rotuloEvento(e) }));
const opcoesOperacao = computed(() =>
  OPERACOES_TABELA_ESOCIAL.map((o) => ({ valor: o, rotulo: t(`folha.esocial.operacoes.${o}`) })),
);
const rubricasLidas = computed<number[] | null>(() => {
  const s = tabRubricas.value.trim();
  if (!s) return [];
  const xs = s.split(/[,;\s]+/).filter(Boolean);
  return xs.every((x) => /^\d{1,9}$/.test(x) && Number(x) > 0) ? xs.map(Number) : null;
});
const entradaTabela = computed(() =>
  esquemaGerarEventosTabela.safeParse({
    empresa: props.empresa,
    eventos: tabEventos.value,
    operacao: tabOperacao.value,
    inicio: tabInicio.value ?? '',
    rubricas: tabEventos.value.includes('S-1010') ? (rubricasLidas.value ?? []) : [],
    gravar: false,
  }),
);
function abrirTabela(): void {
  tabEventos.value = [];
  tabOperacao.value = 'inclusao';
  tabInicio.value = props.apoio.hoje.slice(0, 7);
  tabRubricas.value = '';
  erroTabela.value = null;
  aviso.value = null;
  tabelaVisivel.value = true;
}
async function previaTabela(): Promise<void> {
  if (!entradaTabela.value.success || rubricasLidas.value === null) return;
  erroTabela.value = null;
  const x = await previa({ tipo: 'tabela', entrada: entradaTabela.value.data });
  if (x) erroTabela.value = x;
  else tabelaVisivel.value = false;
}

// ── Gerar os do trabalhador (e retificar) ─────────────────────────────────────────────────────────────────────
const trabVisivel = ref(false);
const trabEvento = ref<EventoTrabalhadorEsocial | null>(null);
const trabColaborador = ref<ColaboradorEscolhido | null>(null);
const trabData = ref<string | null>(null);
const trabReferencia = ref<number | null>(null);
const trabRetificar = ref<EventoEsocialResumo | null>(null);
const erroTrab = ref<unknown>(null);
const opcoesEventoTrab = EVENTOS_TRABALHADOR_ESOCIAL.map((e) => ({ valor: e, rotulo: rotuloEvento(e) }));
const origem = computed(() => (trabEvento.value ? origemDoEvento(trabEvento.value) : 'nenhuma'));
const veAfastamentos = computed(() => permissoes.value.has('pessoas.folha.ler'));
const veRescisoes = computed(() => permissoes.value.has('pessoas.rescisao.ler'));
const afastamentos = useQuery({
  queryKey: computed(() => [
    'folha',
    'esocial',
    'origem',
    'afastamentos',
    trabColaborador.value?.vinculo ?? null,
  ]),
  queryFn: () => lerAfastamentos({ vinculo: trabColaborador.value!.vinculo }),
  enabled: computed(
    () =>
      trabVisivel.value && origem.value === 'afastamento' && veAfastamentos.value && !!trabColaborador.value,
  ),
});
const rescisoes = useQuery({
  queryKey: computed(() => [
    'folha',
    'esocial',
    'origem',
    'rescisoes',
    trabColaborador.value?.vinculo ?? null,
  ]),
  queryFn: () => lerRescisoes({ vinculo: trabColaborador.value!.vinculo, situacao: 'calculada' }),
  enabled: computed(
    () => trabVisivel.value && origem.value === 'rescisao' && veRescisoes.value && !!trabColaborador.value,
  ),
});
const opcoesAfastamento = computed(() =>
  (afastamentos.data.value?.itens ?? [])
    .filter((a) => a.situacao === 'ativo')
    .map((a) => ({
      valor: a.id,
      rotulo: `${a.motivoRotulo} · ${dataBr(a.inicio)}${a.fim ? ` – ${dataBr(a.fim)}` : ''}`,
    })),
);
const opcoesRescisao = computed(() =>
  (rescisoes.data.value?.itens ?? []).map((r) => ({
    valor: r.id,
    rotulo: `${dataBr(r.desligamento)} · ${t(`folha.rescisao.modalidades.${r.modalidade}`)}`,
  })),
);
const semPermissaoOrigem = computed(
  () =>
    (origem.value === 'afastamento' && !veAfastamentos.value) ||
    (origem.value === 'rescisao' && !veRescisoes.value),
);
watch([trabEvento, trabColaborador], () => {
  if (!trabRetificar.value) trabReferencia.value = null;
});
const entradaTrab = computed(() =>
  esquemaGerarEventoTrabalhador.safeParse({
    evento: trabEvento.value ?? '',
    empresa: props.empresa,
    vinculo: trabColaborador.value?.vinculo ?? 0,
    referencia: origem.value === 'afastamento' || origem.value === 'rescisao' ? trabReferencia.value : null,
    data: origem.value === 'data' ? trabData.value : null,
    retificar: trabRetificar.value?.id ?? null,
    gravar: false,
  }),
);
const trabOk = computed(
  () =>
    entradaTrab.value.success &&
    !((origem.value === 'afastamento' || origem.value === 'rescisao') && trabReferencia.value === null) &&
    !(origem.value === 'data' && !trabData.value && !trabRetificar.value),
);
function abrirTrabalhador(): void {
  trabEvento.value = null;
  trabColaborador.value = null;
  trabData.value = null;
  trabReferencia.value = null;
  trabRetificar.value = null;
  erroTrab.value = null;
  aviso.value = null;
  trabVisivel.value = true;
}
function abrirRetificacao(e: EventoEsocialResumo): void {
  abrirTrabalhador();
  trabRetificar.value = e;
  trabEvento.value = e.evento as EventoTrabalhadorEsocial;
  trabColaborador.value = {
    vinculo: e.vinculo!,
    rotulo: quem(e),
    tipo: null,
  };
  trabReferencia.value = e.referencia;
  if (/^\d{4}-\d{2}-\d{2}$/.test(e.dataReferencia)) trabData.value = e.dataReferencia;
}
async function previaTrabalhador(): Promise<void> {
  if (!trabOk.value || !entradaTrab.value.success) return;
  erroTrab.value = null;
  const x = await previa({ tipo: 'trabalhador', entrada: entradaTrab.value.data });
  if (x) erroTrab.value = x;
  else trabVisivel.value = false;
}

// ── Descartar ─────────────────────────────────────────────────────────────────────────────────────────────────
const descarteVisivel = ref(false);
const alvoDescarte = ref<EventoEsocialResumo | null>(null);
const motivoDescarte = ref('');
const erroDescarte = ref<unknown>(null);
const entradaDescarte = computed(() =>
  esquemaDescartarEventoEsocial.safeParse({
    motivo: motivoDescarte.value.trim(),
    versao: alvoDescarte.value?.versao ?? 0,
  }),
);
function abrirDescarte(e: EventoEsocialResumo): void {
  alvoDescarte.value = e;
  motivoDescarte.value = '';
  erroDescarte.value = null;
  aviso.value = null;
  descarteVisivel.value = true;
}
async function descartar(): Promise<void> {
  if (!alvoDescarte.value || !entradaDescarte.value.success) return;
  erroDescarte.value = null;
  ocupado.value = true;
  try {
    await descartarEventoEsocial(alvoDescarte.value.id, entradaDescarte.value.data);
    descarteVisivel.value = false;
    aviso.value = t('folha.esocial.eventos.descartado');
    await atualizar();
  } catch (x) {
    erroDescarte.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Excluir (S-3000) ──────────────────────────────────────────────────────────────────────────────────────────
const exclusaoVisivel = ref(false);
const alvoExclusao = ref<EventoEsocialResumo | null>(null);
const motivoExclusao = ref('');
const erroExclusao = ref<unknown>(null);
const entradaExclusao = computed(() =>
  esquemaExcluirEventoEsocial.safeParse({
    motivo: motivoExclusao.value.trim(),
    versao: alvoExclusao.value?.versao ?? 0,
    gravar: false,
  }),
);
function abrirExclusao(e: EventoEsocialResumo): void {
  alvoExclusao.value = e;
  motivoExclusao.value = '';
  erroExclusao.value = null;
  aviso.value = null;
  exclusaoVisivel.value = true;
}
async function previaExclusao(): Promise<void> {
  if (!alvoExclusao.value || !entradaExclusao.value.success) return;
  erroExclusao.value = null;
  const x = await previa({
    tipo: 'exclusao',
    id: alvoExclusao.value.id,
    entrada: entradaExclusao.value.data,
  });
  if (x) erroExclusao.value = x;
  else exclusaoVisivel.value = false;
}
</script>

<template>
  <section class="bloco" :aria-label="t('folha.esocial.eventos.titulo')" data-testid="esocial-eventos">
    <h2>{{ t('folha.esocial.eventos.titulo') }}</h2>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="esocial-eventos-aviso" />
    <ErroFolha v-if="erro" :erro="erro" />
    <div v-if="apoio.acoes.gerar" class="acoes">
      <SanteBotao
        :rotulo="t('folha.esocial.eventos.gerarTabela')"
        variante="secundario"
        data-testid="esocial-gerar-tabela"
        @acionar="abrirTabela"
      />
      <SanteBotao
        :rotulo="t('folha.esocial.eventos.gerarTrabalhador')"
        variante="secundario"
        data-testid="esocial-gerar-trabalhador"
        @acionar="abrirTrabalhador"
      />
    </div>
    <div class="campos" data-testid="esocial-eventos-filtros">
      <SanteSelecao
        v-model="filtroEvento"
        :rotulo="t('folha.esocial.eventos.filtroEvento')"
        :opcoes="opcoesFiltroEvento"
        busca
        data-testid="esocial-filtro-evento"
      />
      <SanteSelecao
        v-model="filtroSituacao"
        :rotulo="t('folha.esocial.eventos.filtroSituacao')"
        :opcoes="opcoesFiltroSituacao"
        busca
        data-testid="esocial-filtro-situacao"
      />
      <SanteData
        v-model="de"
        :rotulo="t('folha.esocial.eventos.de')"
        editavel
        data-testid="esocial-filtro-de"
      />
      <SanteData
        v-model="ate"
        :rotulo="t('folha.esocial.eventos.ate')"
        editavel
        data-testid="esocial-filtro-ate"
      />
    </div>
    <ErroFolha v-if="q.isError.value" :erro="q.error.value" />
    <p v-else-if="!q.data.value" role="status">{{ t('folha.esocial.carregando') }}</p>
    <p v-else-if="itens.length === 0" data-testid="esocial-eventos-vazio">
      {{ t('folha.esocial.eventos.nenhum') }}
    </p>
    <div v-else class="rolagem" tabindex="0" role="region" :aria-label="t('folha.esocial.eventos.titulo')">
      <table class="tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('folha.esocial.eventos.evento') }}</th>
            <th scope="col">{{ t('folha.esocial.eventos.operacao') }}</th>
            <th scope="col">{{ t('folha.esocial.eventos.colaborador') }}</th>
            <th scope="col">{{ t('folha.esocial.eventos.referencia') }}</th>
            <th scope="col">{{ t('folha.esocial.situacao') }}</th>
            <th scope="col">{{ t('folha.esocial.eventos.lote') }}</th>
            <th scope="col">{{ t('folha.esocial.eventos.recibo') }}</th>
            <th scope="col">{{ t('folha.esocial.registro') }}</th>
            <th scope="col">{{ t('folha.esocial.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in itens" :key="e.id" :data-testid="`esocial-evento-${e.id}`">
            <th scope="row">{{ e.id }} · {{ rotuloEvento(e.evento) }}</th>
            <td>{{ e.operacao ? t(`folha.esocial.operacoes.${e.operacao}`) : '—' }}</td>
            <td>{{ quem(e) }}</td>
            <td>{{ referencia(e.dataReferencia) }}</td>
            <td>
              {{ t(`folha.esocial.situacoesEvento.${e.situacao}`) }}
              <span v-if="e.retorno" class="secundario">
                · {{ e.retorno.codigo }} {{ e.retorno.descricao }}</span
              >
              <span v-if="e.motivo" class="secundario"> · {{ e.motivo }}</span>
            </td>
            <td>{{ e.lote ?? '—' }}</td>
            <td>{{ e.recibo ?? '—' }}</td>
            <td class="secundario">{{ e.criadoPor }} · {{ instanteBr(e.criadoEm) }}</td>
            <td class="acoes-linha">
              <SanteBotao
                :rotulo="t('folha.esocial.eventos.ver')"
                variante="texto"
                :data-testid="`esocial-evento-ver-${e.id}`"
                @acionar="ver(e.id)"
              />
              <SanteBotao
                v-if="acoes(e).descartar"
                :rotulo="t('folha.esocial.eventos.descartar')"
                variante="texto"
                :data-testid="`esocial-evento-descartar-${e.id}`"
                @acionar="abrirDescarte(e)"
              />
              <SanteBotao
                v-if="acoes(e).retificar"
                :rotulo="t('folha.esocial.eventos.retificar')"
                variante="texto"
                :data-testid="`esocial-evento-retificar-${e.id}`"
                @acionar="abrirRetificacao(e)"
              />
              <SanteBotao
                v-if="acoes(e).excluir"
                :rotulo="t('folha.esocial.eventos.excluir')"
                variante="texto"
                :data-testid="`esocial-evento-excluir-${e.id}`"
                @acionar="abrirExclusao(e)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="q.data.value?.truncado" class="secundario">{{ t('folha.esocial.limitado') }}</p>

    <section
      v-if="apoio.acoes.transmitir && validados.length"
      class="bloco"
      :aria-label="t('folha.esocial.eventos.montarLote')"
      data-testid="esocial-escolha-lote"
    >
      <h3>{{ t('folha.esocial.eventos.montarLote') }}</h3>
      <SanteMarcadores
        v-model="escolhidos"
        :legenda="t('folha.esocial.eventos.escolher')"
        :opcoes="opcoesEscolha"
        data-testid="esocial-escolha-eventos"
      />
      <p class="secundario" data-testid="esocial-escolha-texto">{{ textoEscolha }}</p>
      <SanteBotao
        :rotulo="t('folha.esocial.eventos.montarLote')"
        :desabilitado="ocupado || !escolha.ok"
        data-testid="esocial-montar-lote"
        @acionar="montarLote"
      />
    </section>

    <!-- Detalhe -->
    <SanteDialogo
      v-model:visivel="detalheVisivel"
      :titulo="
        t('folha.esocial.detalhe.titulo', { evento: detalhe ? rotuloEvento(detalhe.evento.evento) : '' })
      "
      largura="56rem"
    >
      <div data-testid="esocial-evento-detalhe">
        <ErroFolha v-if="erroDetalhe" :erro="erroDetalhe" />
        <p v-else-if="!detalhe" role="status">{{ t('folha.esocial.carregando') }}</p>
        <template v-else>
          <dl class="ficha">
            <dt>{{ t('folha.esocial.detalhe.identificador') }}</dt>
            <dd>{{ detalhe.evento.idEsocial }}</dd>
            <dt>{{ t('folha.esocial.situacao') }}</dt>
            <dd>{{ t(`folha.esocial.situacoesEvento.${detalhe.evento.situacao}`) }}</dd>
            <dt>{{ t('folha.esocial.detalhe.leiaute') }}</dt>
            <dd>{{ detalhe.evento.leiaute }}</dd>
            <dt>{{ t('folha.esocial.detalhe.dataReferencia') }}</dt>
            <dd>{{ referencia(detalhe.evento.dataReferencia) }}</dd>
            <template v-if="detalhe.evento.eventoAnterior">
              <dt>{{ t('folha.esocial.detalhe.anterior') }}</dt>
              <dd>{{ detalhe.evento.eventoAnterior }}</dd>
            </template>
            <dt>{{ t('folha.esocial.eventos.recibo') }}</dt>
            <dd>{{ detalhe.evento.recibo ?? '—' }}</dd>
            <dt>{{ t('folha.esocial.detalhe.hash') }}</dt>
            <dd class="secundario">{{ detalhe.evento.hashXml }}</dd>
          </dl>
          <p class="secundario">
            {{
              t('folha.esocial.detalhe.criado', {
                por: detalhe.evento.criadoPor,
                em: instanteBr(detalhe.evento.criadoEm),
              })
            }}
          </p>
          <template v-if="detalhe.evento.errosXsd.length">
            <h3>{{ t('folha.esocial.eventos.errosXsd') }}</h3>
            <ul class="lista" data-testid="esocial-evento-erros">
              <li v-for="(x, i) in detalhe.evento.errosXsd" :key="i">{{ x }}</li>
            </ul>
          </template>
          <template v-if="detalhe.xml">
            <h3>{{ t('folha.esocial.previa.xml') }}</h3>
            <pre class="rolagem" tabindex="0" data-testid="esocial-evento-xml">{{ detalhe.xml }}</pre>
          </template>
          <p v-else class="secundario">{{ t('folha.esocial.detalhe.semXml') }}</p>
        </template>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('folha.esocial.fechar')"
            variante="secundario"
            @acionar="detalheVisivel = false"
          />
        </div>
      </div>
    </SanteDialogo>

    <!-- Gerar os de tabela -->
    <SanteDialogo v-model:visivel="tabelaVisivel" :titulo="t('folha.esocial.tabela.titulo')" largura="44rem">
      <form data-testid="esocial-tabela-form" @submit.prevent="previaTabela">
        <ErroFolha v-if="erroTabela" :erro="erroTabela" />
        <SanteMarcadores
          v-model="tabEventos"
          :legenda="t('folha.esocial.tabela.eventos')"
          :opcoes="opcoesEventosTabela"
          data-testid="esocial-tabela-eventos"
        />
        <div class="campos">
          <SanteSelecao
            v-model="tabOperacao"
            :rotulo="t('folha.esocial.tabela.operacao')"
            :opcoes="opcoesOperacao"
            data-testid="esocial-tabela-operacao"
          />
          <SanteSelecao
            v-model="tabInicio"
            :rotulo="t('folha.esocial.tabela.inicio')"
            :opcoes="opcoesInicio"
            busca
            data-testid="esocial-tabela-inicio"
          />
        </div>
        <template v-if="tabEventos.includes('S-1010')">
          <SanteCampoTexto
            v-model="tabRubricas"
            :rotulo="t('folha.esocial.tabela.rubricas')"
            :max-bytes="4000"
            data-testid="esocial-tabela-rubricas"
          />
          <p class="secundario">{{ t('folha.esocial.tabela.rubricasAjuda') }}</p>
          <p v-if="rubricasLidas === null" role="alert">{{ t('folha.esocial.tabela.rubricasInvalidas') }}</p>
        </template>
        <p v-if="!entradaTabela.success" class="secundario">{{ t('folha.esocial.tabela.incompleto') }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('folha.esocial.previa.ver')"
            tipo="submit"
            :desabilitado="ocupado || !entradaTabela.success || rubricasLidas === null"
            data-testid="esocial-tabela-previa"
          />
          <SanteBotao
            :rotulo="t('folha.esocial.fechar')"
            variante="secundario"
            @acionar="tabelaVisivel = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <!-- Gerar os do trabalhador / retificar -->
    <SanteDialogo
      v-model:visivel="trabVisivel"
      :titulo="
        trabRetificar
          ? t('folha.esocial.trabalhador.tituloRetificar', { evento: rotuloEvento(trabRetificar.evento) })
          : t('folha.esocial.trabalhador.titulo')
      "
      largura="44rem"
    >
      <div data-testid="esocial-trabalhador-form">
        <ErroFolha v-if="erroTrab" :erro="erroTrab" />
        <p v-if="trabRetificar" class="secundario">{{ t('folha.esocial.trabalhador.retificando') }}</p>
        <SanteSelecao
          v-model="trabEvento"
          :rotulo="t('folha.esocial.trabalhador.evento')"
          :opcoes="opcoesEventoTrab"
          :desabilitado="!!trabRetificar"
          data-testid="esocial-trabalhador-evento"
        />
        <template v-if="!trabRetificar">
          <BuscaColaboradorEsocial v-model="trabColaborador" prefixo="esocial-trabalhador" />
        </template>
        <p v-else>
          <strong>{{ trabColaborador?.rotulo }}</strong>
        </p>
        <SanteData
          v-if="origem === 'data'"
          v-model="trabData"
          :rotulo="t('folha.esocial.trabalhador.data')"
          editavel
          data-testid="esocial-trabalhador-data"
        />
        <p v-if="semPermissaoOrigem" class="secundario" data-testid="esocial-trabalhador-sem-origem">
          {{ t('folha.esocial.trabalhador.semPermissaoOrigem') }}
        </p>
        <template v-else-if="origem === 'afastamento' && trabColaborador && !trabRetificar">
          <ErroFolha v-if="afastamentos.isError.value" :erro="afastamentos.error.value" />
          <p v-else-if="afastamentos.data.value && opcoesAfastamento.length === 0">
            {{ t('folha.esocial.trabalhador.semAfastamento') }}
          </p>
          <SanteSelecao
            v-else
            v-model="trabReferencia"
            :rotulo="t('folha.esocial.trabalhador.afastamento')"
            :opcoes="opcoesAfastamento"
            busca
            data-testid="esocial-trabalhador-afastamento"
          />
        </template>
        <template v-else-if="origem === 'rescisao' && trabColaborador && !trabRetificar">
          <ErroFolha v-if="rescisoes.isError.value" :erro="rescisoes.error.value" />
          <p v-else-if="rescisoes.data.value && opcoesRescisao.length === 0">
            {{ t('folha.esocial.trabalhador.semRescisao') }}
          </p>
          <SanteSelecao
            v-else
            v-model="trabReferencia"
            :rotulo="t('folha.esocial.trabalhador.rescisao')"
            :opcoes="opcoesRescisao"
            busca
            data-testid="esocial-trabalhador-rescisao"
          />
        </template>
        <p v-if="!trabOk" class="secundario">{{ t('folha.esocial.trabalhador.incompleto') }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('folha.esocial.previa.ver')"
            :desabilitado="ocupado || !trabOk"
            data-testid="esocial-trabalhador-previa"
            @acionar="previaTrabalhador"
          />
          <SanteBotao
            :rotulo="t('folha.esocial.fechar')"
            variante="secundario"
            @acionar="trabVisivel = false"
          />
        </div>
      </div>
    </SanteDialogo>

    <!-- Resultado (prévia ou gravado) -->
    <SanteDialogo
      v-model:visivel="resultadoVisivel"
      :titulo="
        resultado?.gravado ? t('folha.esocial.previa.tituloGravado') : t('folha.esocial.previa.titulo')
      "
      largura="60rem"
    >
      <div v-if="resultado" data-testid="esocial-resultado">
        <ErroFolha v-if="erroResultado" :erro="erroResultado" />
        <article
          v-for="(g, i) in resultado.eventos"
          :key="i"
          class="bloco"
          :data-testid="`esocial-resultado-${g.evento}-${i}`"
        >
          <h3>
            {{ rotuloEvento(g.evento) }}
            <span v-if="g.operacao"> · {{ t(`folha.esocial.operacoes.${g.operacao}`) }}</span>
            · {{ referencia(g.dataReferencia) }}
            <span v-if="g.id"> · {{ g.id }}</span>
          </h3>
          <template v-if="g.pendencias.length">
            <p role="alert">{{ t('folha.esocial.previa.pendencias') }}</p>
            <ul class="lista" :data-testid="`esocial-resultado-pendencias-${i}`">
              <li v-for="p in g.pendencias" :key="p.codigo">{{ p.mensagem }}</li>
            </ul>
          </template>
          <p v-else-if="g.valido" class="secundario" :data-testid="`esocial-resultado-valido-${i}`">
            {{ t('folha.esocial.previa.valido') }}
          </p>
          <template v-else>
            <p role="alert">{{ t('folha.esocial.previa.invalido') }}</p>
            <ul class="lista" :data-testid="`esocial-resultado-erros-${i}`">
              <li v-for="(x, j) in g.errosXsd" :key="j">{{ x }}</li>
            </ul>
          </template>
          <details v-if="g.xml">
            <summary>{{ t('folha.esocial.previa.xml') }}</summary>
            <pre class="rolagem" tabindex="0">{{ g.xml }}</pre>
          </details>
          <p v-else class="secundario">{{ t('folha.esocial.previa.semXml') }}</p>
        </article>
        <div class="acoes">
          <SanteBotao
            v-if="podeGravarResultado"
            :rotulo="t('folha.esocial.previa.gravar')"
            :desabilitado="ocupado"
            data-testid="esocial-resultado-gravar"
            @acionar="gravarResultado"
          />
          <SanteBotao
            :rotulo="t('folha.esocial.fechar')"
            variante="secundario"
            data-testid="esocial-resultado-fechar"
            @acionar="resultadoVisivel = false"
          />
        </div>
      </div>
    </SanteDialogo>

    <!-- Descartar -->
    <SanteDialogo v-model:visivel="descarteVisivel" :titulo="t('folha.esocial.descarte.titulo')">
      <form data-testid="esocial-descarte-form" @submit.prevent="descartar">
        <p class="secundario">{{ t('folha.esocial.descarte.ajuda') }}</p>
        <ErroFolha v-if="erroDescarte" :erro="erroDescarte" />
        <SanteCampoTexto
          v-model="motivoDescarte"
          :rotulo="t('folha.esocial.descarte.motivo')"
          :max-bytes="200"
          multilinha
          data-testid="esocial-descarte-motivo"
        />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('folha.esocial.confirmar')"
            tipo="submit"
            :desabilitado="ocupado || !entradaDescarte.success"
            data-testid="esocial-descarte-confirmar"
          />
          <SanteBotao
            :rotulo="t('folha.esocial.fechar')"
            variante="secundario"
            @acionar="descarteVisivel = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <!-- Excluir -->
    <SanteDialogo v-model:visivel="exclusaoVisivel" :titulo="t('folha.esocial.exclusao.titulo')">
      <form data-testid="esocial-exclusao-form" @submit.prevent="previaExclusao">
        <p class="secundario">{{ t('folha.esocial.exclusao.ajuda') }}</p>
        <ErroFolha v-if="erroExclusao" :erro="erroExclusao" />
        <SanteCampoTexto
          v-model="motivoExclusao"
          :rotulo="t('folha.esocial.exclusao.motivo')"
          :max-bytes="200"
          multilinha
          data-testid="esocial-exclusao-motivo"
        />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('folha.esocial.exclusao.previa')"
            tipo="submit"
            :desabilitado="ocupado || !entradaExclusao.success"
            data-testid="esocial-exclusao-previa"
          />
          <SanteBotao
            :rotulo="t('folha.esocial.fechar')"
            variante="secundario"
            @acionar="exclusaoVisivel = false"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
