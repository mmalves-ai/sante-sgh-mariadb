<script setup lang="ts">
// Qualidade e segurança › Gestão da qualidade › Revisão de prontuários (W0-04, M5; CFM 1.638/2002). A comissão do tipo
// "Revisão de prontuários" em três abas no cartão: os sorteios (o universo das altas da competência, a amostra
// sugerida, o sorteio com a semente registrada, a conferência que refaz o sorteio, o cancelamento crítico), o
// checklist de completude versionado (publicar, alterar com motivo, inativar) e a conformidade por clínica com as
// parcelas. O sorteio aberto lista os prontuários: revisar pelo checklist (o não conforme vira pendência ao médico
// assistente), corrigir a revisão antes do aval (justificativa), dar o aval (senha), cancelar a pendência e o
// histórico de versões. Toda alteração passa pelo diálogo único da qualidade (motivo, senha nas críticas).
import '../../componentes/estilo-qualidade.css';
import '../../ccih/componentes/estilo-ccih.css';
import '../componentes/estilo-gestao.css';
import {
  type ItemChecklistRevisao,
  RESULTADOS_REVISAO_PRONTUARIO,
  type ResultadoRevisaoProntuario,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChaveCorrecao } from '../../api-correcao.js';
import DialogoCorrecao, { type PedidoCorrecao } from '../../componentes/DialogoCorrecao.vue';
import HistoricoVersoes from '../../componentes/HistoricoVersoes.vue';
import { dataHora } from '../../regras-qualidade.js';
import { lerResumoGestao } from '../api-gestao.js';
import {
  avalRevisao,
  cancelarPendencia,
  cancelarSorteioRevisao,
  type ChecklistRevisaoTela,
  conferirSorteioRevisao,
  inativarChecklistRevisao,
  lerAltasRevisao,
  lerChecklistsRevisao,
  lerComissoesRevisao,
  lerIndicadorRevisao,
  lerSorteioRevisao,
  lerSorteiosRevisao,
  type PendenciaRevisaoTela,
  type ProntuarioRevisaoTela,
  publicarChecklistRevisao,
  revisarProntuario,
  sortearRevisao,
  type SorteioRevisaoTela,
} from '../api-revisao.js';
import ErroGestao from '../componentes/ErroGestao.vue';
import NavGestao from '../componentes/NavGestao.vue';
import { competenciaBr, competenciasRecentes, dataBr } from '../regras-gestao.js';

const { t } = useI18n();
const R = (k: string, p?: Record<string, unknown>) => t(`gestaoQualidade.revisao.${k}`, p ?? {});
const cliente = useQueryClient();
const aviso = ref<string | null>(null);
const invalidar = () => cliente.invalidateQueries({ queryKey: ['revisaoProntuario'] });

const resumo = useQuery({
  queryKey: ['gestaoQualidade', 'resumo'],
  queryFn: lerResumoGestao,
  staleTime: 60_000,
});
const comissoes = useQuery({ queryKey: ['revisaoProntuario', 'comissoes'], queryFn: lerComissoesRevisao });
const podeRegistrar = computed(() => comissoes.data.value?.podeRegistrar ?? false);
const comissao = ref('');
const opComissoes = computed(() =>
  (comissoes.data.value?.itens ?? [])
    .filter((c) => c.ativa)
    .map((c) => ({ valor: String(c.id), rotulo: c.nome })),
);
watch(
  opComissoes,
  (op) => {
    if (!comissao.value && op[0]) comissao.value = op[0].valor;
  },
  { immediate: true },
);
const idComissao = computed(() => Number(comissao.value) || 0);

const opCompetencias = computed(() =>
  resumo.data.value
    ? competenciasRecentes(resumo.data.value.agora.slice(0, 7))
        .slice(1)
        .map((c) => ({ valor: c, rotulo: competenciaBr(c) }))
    : [],
);
const competencia = ref('');
watch(
  opCompetencias,
  (op) => {
    if (!competencia.value && op[0]) competencia.value = op[0].valor;
  },
  { immediate: true },
);

// ── Abas ──
const ABAS = ['sorteios', 'checklist', 'indicador'] as const;
type Aba = (typeof ABAS)[number];
const aba = ref<Aba>('sorteios');
const botoesAba = ref<HTMLButtonElement[]>([]);
function teclaAba(ev: KeyboardEvent, i: number): void {
  const d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
  if (!d) return;
  ev.preventDefault();
  const j = (i + d + ABAS.length) % ABAS.length;
  aba.value = ABAS[j]!;
  void nextTick(() => botoesAba.value[j]?.focus());
}

// ── Checklist ──
const checklists = useQuery({
  queryKey: computed(() => ['revisaoProntuario', 'checklists', idComissao.value]),
  queryFn: () => lerChecklistsRevisao(idComissao.value),
  enabled: computed(() => idComissao.value > 0),
});
const vigente = computed<ChecklistRevisaoTela | null>(
  () => checklists.data.value?.itens.find((c) => c.situacao === 'vigente') ?? null,
);
const anteriores = computed(() => checklists.data.value?.itens.filter((c) => c.situacao !== 'vigente') ?? []);
const editandoChecklist = ref(false);
const itensEdicao = ref<ItemChecklistRevisao[]>([]);
const motivoChecklist = ref('');
const erroChecklist = ref<unknown>(null);
function editarChecklist(): void {
  itensEdicao.value = vigente.value
    ? vigente.value.itens.map((i) => ({ ...i }))
    : (comissoes.data.value?.sugerido ?? []).map((i) => ({ ...i }));
  motivoChecklist.value = '';
  erroChecklist.value = null;
  editandoChecklist.value = true;
}
const checklistValido = computed(
  () =>
    itensEdicao.value.length > 0 &&
    itensEdicao.value.every((i) => /^[a-z][a-z0-9-]{1,39}$/.test(i.codigo) && i.titulo.trim().length >= 3) &&
    new Set(itensEdicao.value.map((i) => i.codigo)).size === itensEdicao.value.length &&
    (!vigente.value || motivoChecklist.value.trim().length >= 10),
);
let chaveChecklist = novaChaveCorrecao('checklist');
async function publicarChecklist(): Promise<void> {
  if (!checklistValido.value) return;
  erroChecklist.value = null;
  try {
    const r = await publicarChecklistRevisao(
      {
        comissao: idComissao.value,
        itens: itensEdicao.value.map((i) => ({ codigo: i.codigo.trim(), titulo: i.titulo.trim() })),
        motivo: vigente.value ? motivoChecklist.value.trim() : null,
        vigente: vigente.value ? { id: vigente.value.id, versao: vigente.value.versao } : null,
      },
      chaveChecklist,
    );
    chaveChecklist = novaChaveCorrecao('checklist');
    editandoChecklist.value = false;
    aviso.value = R('checklist.publicado', { r: r.revisao });
    await invalidar();
  } catch (e) {
    erroChecklist.value = e;
  }
}

// ── Diálogo único (cancelar sorteio, inativar checklist, aval, cancelar pendência, revisar) ──
const visivel = ref(false);
const pedido = ref<PedidoCorrecao | null>(null);
const textoFeito = ref('');
const emRevisao = ref<ProntuarioRevisaoTela | null>(null);
const respostas = reactive<
  Record<string, { resultado: ResultadoRevisaoProntuario | ''; observacao: string }>
>({});
const observacaoGeral = ref('');
function abrir(p: PedidoCorrecao, feito: string): void {
  pedido.value = p;
  textoFeito.value = feito;
  visivel.value = true;
}
async function feito(r?: unknown): Promise<void> {
  // Revisão do W0-04: a revisão devolve se o médico foi avisado e se a pendência ficou sem destinatário.
  const x = (r ?? {}) as { semDestinatario?: boolean; avisado?: boolean };
  aviso.value = x.semDestinatario
    ? R('revisadoSemDestinatario')
    : x.avisado
      ? R('revisadoAvisado')
      : textoFeito.value;
  emRevisao.value = null;
  await invalidar();
}
function inativar(c: ChecklistRevisaoTela): void {
  const chave = novaChaveCorrecao('inativar-checklist');
  emRevisao.value = null;
  abrir(
    {
      titulo: R('checklist.inativar'),
      texto: R('checklist.inativarTexto'),
      critica: false,
      confirmar: R('checklist.inativar'),
      gravar: (m) => inativarChecklistRevisao(c.id, c.versao, m.justificativa, chave),
    },
    R('checklist.inativado'),
  );
}

// ── Sorteios ──
const altas = useQuery({
  queryKey: computed(() => ['revisaoProntuario', 'altas', competencia.value]),
  queryFn: () => lerAltasRevisao(competencia.value),
  enabled: computed(() => competencia.value !== ''),
});
const quantidade = ref('');
watch(
  () => altas.data.value?.sugerida,
  (v) => {
    if (v !== undefined) quantidade.value = String(v);
  },
);
const semente = ref('');
const erroSorteio = ref<unknown>(null);
const sorteando = ref(false);
let chaveSorteio = novaChaveCorrecao('sorteio');
const quantidadeValida = computed(() => {
  const q = Number(quantidade.value);
  return Number.isInteger(q) && q >= 1 && q <= (altas.data.value?.universo ?? 0);
});
async function sortear(): Promise<void> {
  if (!quantidadeValida.value || !vigente.value) return;
  erroSorteio.value = null;
  sorteando.value = true;
  try {
    const r = await sortearRevisao(
      {
        comissao: idComissao.value,
        competencia: competencia.value,
        quantidade: Number(quantidade.value),
        semente: semente.value.trim() || null,
      },
      chaveSorteio,
    );
    chaveSorteio = novaChaveCorrecao('sorteio');
    semente.value = '';
    aviso.value = R('sorteado', { semente: r.semente, n: r.quantidade, u: r.universo });
    abertoId.value = r.id;
    await invalidar();
  } catch (e) {
    erroSorteio.value = e;
  } finally {
    sorteando.value = false;
  }
}
const sorteios = useQuery({
  queryKey: computed(() => ['revisaoProntuario', 'sorteios', idComissao.value]),
  queryFn: () => lerSorteiosRevisao(idComissao.value),
  enabled: computed(() => idComissao.value > 0),
});
async function conferir(s: SorteioRevisaoTela): Promise<void> {
  const c = await conferirSorteioRevisao(s.id);
  aviso.value = c.cortada
    ? R('conferidoCortado')
    : R('conferido', {
        semente: c.semente,
        amostra: c.amostraIgual ? R('igual') : R('diferente'),
        universo: c.universoIgual ? R('igual') : R('diferente'),
      });
}
function cancelar(s: SorteioRevisaoTela): void {
  const chave = novaChaveCorrecao('cancelar-sorteio');
  emRevisao.value = null;
  abrir(
    {
      titulo: R('cancelarSorteio'),
      texto: R('cancelarSorteioTexto'),
      critica: true,
      confirmar: R('cancelarSorteio'),
      gravar: (m) => cancelarSorteioRevisao(s.id, s.versao, m, chave),
    },
    R('sorteioCancelado'),
  );
}

// ── Sorteio aberto ──
const abertoId = ref<number | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['revisaoProntuario', 'sorteio', abertoId.value]),
  queryFn: () => lerSorteioRevisao(abertoId.value as number),
  enabled: computed(() => abertoId.value !== null),
});
const itensDoSorteio = computed(() => detalhe.data.value?.checklist?.itens ?? []);
const opResultado = RESULTADOS_REVISAO_PRONTUARIO.map((r) => ({
  valor: r.codigo,
  rotulo: R(`resultado.${r.codigo}`),
}));
function revisar(p: ProntuarioRevisaoTela): void {
  for (const k of Object.keys(respostas)) Reflect.deleteProperty(respostas, k);
  for (const i of itensDoSorteio.value) {
    const r = p.respostas.find((x) => x.item === i.codigo);
    respostas[i.codigo] = { resultado: r?.resultado ?? '', observacao: r?.observacao ?? '' };
  }
  observacaoGeral.value = p.observacao ?? '';
  emRevisao.value = p;
  const corrigindo = p.situacao !== 'aRevisar';
  const chave = novaChaveCorrecao('revisao');
  abrir(
    {
      titulo: R('revisarTitulo', { reg: p.reg }),
      texto: corrigindo ? R('corrigirTexto') : R('revisarTexto'),
      semJustificativa: !corrigindo,
      critica: false,
      confirmar: R('gravarRevisao'),
      gravar: (m) =>
        revisarProntuario(
          p.id,
          {
            versao: p.versao,
            respostas: itensDoSorteio.value.map((i) => ({
              item: i.codigo,
              resultado: respostas[i.codigo]!.resultado as ResultadoRevisaoProntuario,
              observacao: respostas[i.codigo]!.observacao.trim() || null,
            })),
            observacao: observacaoGeral.value.trim() || null,
            justificativa: corrigindo ? m.justificativa : null,
          },
          chave,
        ),
    },
    R('revisado'),
  );
}
const revisaoValida = computed(
  () => !emRevisao.value || itensDoSorteio.value.every((i) => respostas[i.codigo]?.resultado),
);
function aval(p: ProntuarioRevisaoTela): void {
  const chave = novaChaveCorrecao('aval');
  emRevisao.value = null;
  abrir(
    {
      titulo: R('avalTitulo', { reg: p.reg }),
      texto: R('avalTexto'),
      semJustificativa: true,
      critica: true,
      confirmar: R('aval'),
      gravar: (m) => avalRevisao(p.id, p.versao, m.senha, chave),
    },
    R('avalDado'),
  );
}
function cancelarPend(x: PendenciaRevisaoTela): void {
  const chave = novaChaveCorrecao('cancelar-pendencia');
  emRevisao.value = null;
  abrir(
    {
      titulo: R('cancelarPendencia'),
      texto: R('cancelarPendenciaTexto'),
      critica: false,
      confirmar: R('cancelarPendencia'),
      gravar: (m) => cancelarPendencia(x.id, x.versao, m.justificativa, chave),
    },
    R('pendenciaCancelada'),
  );
}
const classeSituacao = (s: string) =>
  s === 'conforme'
    ? 'prazo prazo--cumprido'
    : s === 'naoConforme'
      ? 'prazo prazo--vencido'
      : 'selo selo--neutro';

// ── Indicador ──
const indicador = useQuery({
  queryKey: computed(() => ['revisaoProntuario', 'indicador', idComissao.value, competencia.value]),
  queryFn: () => lerIndicadorRevisao(idComissao.value, competencia.value),
  enabled: computed(() => idComissao.value > 0 && competencia.value !== '' && aba.value === 'indicador'),
});
</script>

<template>
  <section class="tela-gestao" aria-labelledby="revisao-titulo" data-testid="tela-revisao-prontuarios">
    <NavGestao />
    <h1 id="revisao-titulo">{{ R('titulo') }}</h1>
    <p class="secundario">{{ R('explicacao') }}</p>
    <ErroGestao v-if="comissoes.isError.value" :erro="comissoes.error.value" />
    <SanteAlerta
      v-if="comissoes.data.value && !comissoes.data.value.ligada"
      variante="info"
      :texto="comissoes.data.value.motivo ?? t('gestaoQualidade.desligado')"
    />
    <p v-if="comissoes.data.value && !opComissoes.length" data-testid="revisao-sem-comissao">
      {{ R('semComissao') }}
    </p>
    <div v-if="opComissoes.length" class="linha-ccih">
      <SanteSelecao
        v-model="comissao"
        :rotulo="R('comissao')"
        :opcoes="opComissoes"
        data-testid="revisao-comissao"
      />
      <SanteSelecao
        v-model="competencia"
        :rotulo="R('competencia')"
        :opcoes="opCompetencias"
        data-testid="revisao-competencia"
      />
    </div>
    <div v-if="aviso" role="status" data-testid="revisao-aviso">{{ aviso }}</div>

    <template v-if="idComissao > 0">
      <div class="abas" role="tablist" :aria-label="R('abasRotulo')">
        <button
          v-for="(a, i) in ABAS"
          :id="`revisao-aba-${a}`"
          :key="a"
          ref="botoesAba"
          type="button"
          role="tab"
          class="aba"
          :aria-selected="aba === a ? 'true' : 'false'"
          :aria-controls="`revisao-painel-${a}`"
          :tabindex="aba === a ? 0 : -1"
          :data-testid="`revisao-aba-${a}`"
          @click="aba = a"
          @keydown="teclaAba($event, i)"
        >
          {{ R(`abas.${a}`) }}
        </button>
      </div>

      <!-- Sorteios -->
      <div
        v-if="aba === 'sorteios'"
        id="revisao-painel-sorteios"
        class="painel"
        role="tabpanel"
        aria-labelledby="revisao-aba-sorteios"
      >
        <section class="cartao" aria-labelledby="revisao-novo">
          <h2 id="revisao-novo" class="cartao__titulo">{{ R('sortear') }}</h2>
          <ErroGestao v-if="altas.isError.value" :erro="altas.error.value" />
          <template v-else-if="altas.data.value">
            <p data-testid="revisao-universo">
              {{ R('universo', { n: altas.data.value.universo }) }} ·
              {{ R('sugerida', { n: altas.data.value.sugerida }) }}
            </p>
            <SanteAlerta v-if="altas.data.value.cortada" variante="aviso" :texto="R('cortada')" />
          </template>
          <SanteAlerta v-if="checklists.data.value && !vigente" variante="aviso" :texto="R('semChecklist')" />
          <form v-if="podeRegistrar" class="linha-ccih" data-testid="form-sorteio" @submit.prevent="sortear">
            <SanteCampoTexto
              v-model="quantidade"
              :rotulo="R('quantidade')"
              :max-bytes="3"
              data-testid="revisao-quantidade"
            />
            <SanteCampoTexto
              v-model="semente"
              :rotulo="R('semente')"
              :max-bytes="40"
              data-testid="revisao-semente"
            />
            <SanteBotao
              tipo="submit"
              :rotulo="R('sortear')"
              :desabilitado="sorteando || !quantidadeValida || !vigente"
              data-testid="revisao-sortear"
            />
          </form>
          <p v-if="podeRegistrar" class="secundario">{{ R('sementeAjuda') }}</p>
          <ErroGestao v-if="erroSorteio" :erro="erroSorteio" />
        </section>

        <section class="cartao" aria-labelledby="revisao-lista">
          <h2 id="revisao-lista" class="cartao__titulo">{{ R('abas.sorteios') }}</h2>
          <ErroGestao v-if="sorteios.isError.value" :erro="sorteios.error.value" />
          <table v-else-if="sorteios.data.value" class="tabela" data-testid="tabela-sorteios">
            <thead>
              <tr>
                <th scope="col">{{ R('colCompetencia') }}</th>
                <th scope="col">{{ R('colSemente') }}</th>
                <th scope="col">{{ R('colAmostra') }}</th>
                <th scope="col">{{ R('colRevisados') }}</th>
                <th scope="col">{{ R('colChecklist') }}</th>
                <th scope="col">{{ R('colSituacao') }}</th>
                <th scope="col">{{ R('colAcoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="s in sorteios.data.value.itens"
                :key="s.id"
                :class="{ inativo: s.canceladoEm }"
                :data-testid="`sorteio-${s.id}`"
              >
                <td>{{ competenciaBr(s.competencia) }}</td>
                <td>
                  <code>{{ s.semente }}</code>
                </td>
                <td>{{ s.quantidade }} / {{ s.universo }}</td>
                <td>{{ s.revisados }}</td>
                <td>{{ s.checklistRevisao }}</td>
                <td>
                  <span v-if="s.canceladoEm" class="selo selo--neutro"
                    >{{ R('cancelado') }}: {{ s.motivoCancelamento }}</span
                  >
                  <span v-else class="prazo prazo--cumprido">{{ R('ativo') }}</span>
                </td>
                <td class="acoes">
                  <SanteBotao
                    variante="texto"
                    :rotulo="R('abrir')"
                    :data-testid="`abrir-sorteio-${s.id}`"
                    @acionar="abertoId = s.id"
                  />
                  <SanteBotao
                    variante="texto"
                    :rotulo="R('conferir')"
                    :data-testid="`conferir-sorteio-${s.id}`"
                    @acionar="conferir(s)"
                  />
                  <SanteBotao
                    v-if="podeRegistrar && !s.canceladoEm && s.revisados === 0"
                    variante="texto"
                    :rotulo="R('cancelarSorteio')"
                    :data-testid="`cancelar-sorteio-${s.id}`"
                    @acionar="cancelar(s)"
                  />
                  <HistoricoVersoes registro="sorteio-revisao" :id="s.id" />
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section v-if="detalhe.data.value" class="cartao" aria-labelledby="revisao-detalhe">
          <h2 id="revisao-detalhe" class="cartao__titulo">
            {{
              R('detalhe', {
                competencia: competenciaBr(detalhe.data.value.sorteio.competencia),
                semente: detalhe.data.value.sorteio.semente,
              })
            }}
          </h2>
          <table class="tabela" data-testid="tabela-prontuarios">
            <thead>
              <tr>
                <th scope="col">{{ R('colOrdem') }}</th>
                <th scope="col">{{ R('colInternacao') }}</th>
                <th scope="col">{{ R('colAlta') }}</th>
                <th scope="col">{{ R('colClinica') }}</th>
                <th scope="col">{{ R('colMedico') }}</th>
                <th scope="col">{{ R('colSituacao') }}</th>
                <th scope="col">{{ R('colPendencias') }}</th>
                <th scope="col">{{ R('colAcoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in detalhe.data.value.prontuarios"
                :key="p.id"
                :data-testid="`prontuario-${p.reg}`"
              >
                <td>{{ p.ordem }}</td>
                <td>{{ p.reg }}</td>
                <td>{{ dataBr(p.alta) }}</td>
                <td>{{ p.clinica }}</td>
                <td>{{ p.medico ?? '—' }}</td>
                <td>
                  <span :class="classeSituacao(p.situacao)">{{ R(`situacao.${p.situacao}`) }}</span>
                  <div v-if="p.avalEm" class="secundario" :data-testid="`aval-${p.reg}`">
                    {{ R('comAval', { em: dataHora(p.avalEm), por: p.avalPor }) }}
                  </div>
                </td>
                <td>
                  <ul v-if="p.pendencias.length" class="lista-ccih">
                    <li v-for="x in p.pendencias" :key="x.id" :data-testid="`pendencia-${x.id}`">
                      {{ x.descricao }}
                      <span class="selo selo--neutro">{{ R(`situacaoPendencia.${x.situacao}`) }}</span>
                      <span v-if="x.vencida" class="prazo prazo--vencido">{{ R('vencida') }}</span>
                      <span
                        v-if="x.situacao === 'aberta' && !x.profissionalLogin"
                        class="prazo prazo--vencido"
                        :data-testid="`pendencia-sem-destinatario-${x.id}`"
                        >{{ R('semDestinatario') }}</span
                      >
                      <div v-if="x.resposta" class="secundario">{{ x.resposta }}</div>
                      <div v-if="x.motivoCancelamento" class="secundario">{{ x.motivoCancelamento }}</div>
                      <SanteBotao
                        v-if="detalhe.data.value.podeRegistrar && x.situacao === 'aberta'"
                        variante="texto"
                        :rotulo="R('cancelarPendencia')"
                        :data-testid="`cancelar-pendencia-${x.id}`"
                        @acionar="cancelarPend(x)"
                      />
                    </li>
                  </ul>
                  <span v-else>—</span>
                </td>
                <td class="acoes">
                  <SanteBotao
                    v-if="
                      detalhe.data.value.podeRegistrar && !p.avalEm && !detalhe.data.value.sorteio.canceladoEm
                    "
                    variante="texto"
                    :rotulo="p.situacao === 'aRevisar' ? R('revisar') : R('corrigirRevisao')"
                    :data-testid="`revisar-${p.reg}`"
                    @acionar="revisar(p)"
                  />
                  <SanteBotao
                    v-if="detalhe.data.value.podeRegistrar && p.podeAval"
                    variante="texto"
                    :rotulo="R('aval')"
                    :data-testid="`dar-aval-${p.reg}`"
                    @acionar="aval(p)"
                  />
                  <HistoricoVersoes registro="revisao-prontuario" :id="p.id" />
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <!-- Checklist -->
      <div
        v-if="aba === 'checklist'"
        id="revisao-painel-checklist"
        class="painel"
        role="tabpanel"
        aria-labelledby="revisao-aba-checklist"
      >
        <section class="cartao" aria-labelledby="revisao-checklist">
          <h2 id="revisao-checklist" class="cartao__titulo">
            {{ vigente ? R('checklist.vigente', { r: vigente.revisao }) : R('checklist.nenhum') }}
          </h2>
          <ErroGestao v-if="checklists.isError.value" :erro="checklists.error.value" />
          <template v-if="vigente && !editandoChecklist">
            <ol data-testid="checklist-vigente">
              <li v-for="i in vigente.itens" :key="i.codigo">{{ i.titulo }}</li>
            </ol>
            <p class="secundario">
              {{
                R('checklist.publicadoPor', { em: dataHora(vigente.publicadoEm), por: vigente.publicadoPor })
              }}
            </p>
          </template>
          <div v-if="podeRegistrar && !editandoChecklist" class="linha-ccih">
            <SanteBotao
              :rotulo="vigente ? R('checklist.editar') : R('checklist.novo')"
              data-testid="checklist-editar"
              @acionar="editarChecklist"
            />
            <SanteBotao
              v-if="vigente"
              variante="texto"
              :rotulo="R('checklist.inativar')"
              data-testid="checklist-inativar"
              @acionar="inativar(vigente)"
            />
          </div>
          <form
            v-if="editandoChecklist"
            class="painel"
            data-testid="form-checklist"
            @submit.prevent="publicarChecklist"
          >
            <div
              v-for="(i, n) in itensEdicao"
              :key="n"
              class="linha-ccih"
              :data-testid="`checklist-item-${n}`"
            >
              <SanteCampoTexto
                v-model="i.codigo"
                :rotulo="R('checklist.codigo')"
                :max-bytes="40"
                :data-testid="`checklist-codigo-${n}`"
              />
              <SanteCampoTexto
                v-model="i.titulo"
                :rotulo="R('checklist.tituloItem')"
                :max-bytes="160"
                :data-testid="`checklist-titulo-${n}`"
              />
              <SanteBotao
                variante="texto"
                :rotulo="R('checklist.removerItem', { n: n + 1 })"
                @acionar="itensEdicao.splice(n, 1)"
              />
            </div>
            <SanteBotao
              variante="texto"
              :rotulo="R('checklist.incluirItem')"
              data-testid="checklist-incluir"
              @acionar="itensEdicao.push({ codigo: '', titulo: '' })"
            />
            <SanteCampoTexto
              v-if="vigente"
              v-model="motivoChecklist"
              :rotulo="R('checklist.motivo')"
              :max-bytes="500"
              multilinha
              obrigatorio
              data-testid="checklist-motivo"
            />
            <p v-if="vigente" class="secundario">{{ R('checklist.motivoAjuda') }}</p>
            <ErroGestao v-if="erroChecklist" :erro="erroChecklist" />
            <div class="linha-ccih">
              <SanteBotao
                tipo="submit"
                :rotulo="R('checklist.publicar')"
                :desabilitado="!checklistValido"
                data-testid="checklist-publicar"
              />
              <SanteBotao
                variante="texto"
                :rotulo="t('gestaoQualidade.fechar')"
                @acionar="editandoChecklist = false"
              />
            </div>
          </form>
        </section>
        <section v-if="anteriores.length" class="cartao" aria-labelledby="revisao-anteriores">
          <h2 id="revisao-anteriores" class="cartao__titulo">{{ R('checklist.anteriores') }}</h2>
          <ul class="lista-ccih" data-testid="checklist-anteriores">
            <li v-for="c in anteriores" :key="c.id" class="inativo">
              <strong>{{ c.revisao }}</strong> · {{ R(`checklist.situacao.${c.situacao}`) }} ·
              {{ c.itens.map((i) => i.titulo).join('; ') }}
              <div v-if="c.motivo" class="secundario">{{ c.motivo }}</div>
              <div v-if="c.motivoInativacao" class="secundario" :data-testid="`checklist-inativacao-${c.id}`">
                {{ R('motivoInativacao', { motivo: c.motivoInativacao }) }}
              </div>
              <HistoricoVersoes registro="checklist-revisao" :id="c.id" />
            </li>
          </ul>
        </section>
      </div>

      <!-- Indicador -->
      <div
        v-if="aba === 'indicador'"
        id="revisao-painel-indicador"
        class="painel"
        role="tabpanel"
        aria-labelledby="revisao-aba-indicador"
      >
        <section class="cartao" aria-labelledby="revisao-ind">
          <h2 id="revisao-ind" class="cartao__titulo">
            {{ R('indicador.legenda', { competencia: competenciaBr(competencia) }) }}
          </h2>
          <ErroGestao v-if="indicador.isError.value" :erro="indicador.error.value" />
          <template v-else-if="indicador.data.value">
            <p v-if="!indicador.data.value.total.revisados">{{ R('indicador.vazio') }}</p>
            <table v-else class="tabela" data-testid="tabela-conformidade">
              <thead>
                <tr>
                  <th scope="col">{{ R('indicador.colClinica') }}</th>
                  <th scope="col">{{ R('indicador.colRevisados') }}</th>
                  <th scope="col">{{ R('indicador.colConformes') }}</th>
                  <th scope="col">{{ R('indicador.colConta') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in indicador.data.value.porClinica" :key="c.clinica">
                  <th scope="row">{{ c.clinica }}</th>
                  <td>{{ c.revisados }}</td>
                  <td>{{ c.conformes }}</td>
                  <td>{{ c.conta ?? '—' }}</td>
                </tr>
                <tr data-testid="conformidade-total">
                  <th scope="row">{{ indicador.data.value.total.clinica }}</th>
                  <td>{{ indicador.data.value.total.revisados }}</td>
                  <td>{{ indicador.data.value.total.conformes }}</td>
                  <td>{{ indicador.data.value.total.conta ?? '—' }}</td>
                </tr>
              </tbody>
            </table>
            <p>
              {{
                R('indicador.pendencias', {
                  a: indicador.data.value.pendenciasAbertas,
                  v: indicador.data.value.pendenciasVencidas,
                })
              }}
            </p>
          </template>
        </section>
      </div>
    </template>

    <DialogoCorrecao v-model:visivel="visivel" :pedido="pedido" :valido="revisaoValida" @feito="feito">
      <template v-if="emRevisao">
        <fieldset
          v-for="i in itensDoSorteio"
          :key="i.codigo"
          class="item-revisao"
          :data-testid="`item-${i.codigo}`"
        >
          <legend>{{ i.titulo }}</legend>
          <div class="linha-ccih">
            <label v-for="o in opResultado" :key="o.valor">
              <input
                v-model="respostas[i.codigo]!.resultado"
                type="radio"
                :name="`resultado-${i.codigo}`"
                :value="o.valor"
                :data-testid="`resultado-${i.codigo}-${o.valor}`"
              />
              {{ o.rotulo }}
            </label>
          </div>
          <SanteCampoTexto
            v-if="respostas[i.codigo]?.resultado === 'naoConforme'"
            v-model="respostas[i.codigo]!.observacao"
            :rotulo="R('observacaoItem', { item: i.titulo })"
            :max-bytes="300"
            :data-testid="`observacao-${i.codigo}`"
          />
        </fieldset>
        <SanteCampoTexto
          v-model="observacaoGeral"
          :rotulo="R('observacao')"
          :max-bytes="500"
          multilinha
          data-testid="revisao-observacao"
        />
      </template>
    </DialogoCorrecao>
  </section>
</template>

<style scoped>
.abas {
  display: flex;
  gap: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda);
  overflow-x: auto;
  scrollbar-width: none;
}
.aba {
  font: inherit;
  display: inline-flex;
  align-items: center;
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  min-height: var(--sgh-alvo-minimo);
  border: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
  color: var(--sgh-texto-secundario);
  cursor: pointer;
  white-space: nowrap;
  margin-bottom: -1px;
}
.aba:hover {
  color: var(--sgh-texto);
}
.aba[aria-selected='true'] {
  color: var(--sgh-texto);
  border-bottom-color: var(--sgh-primaria);
  font-weight: 600;
}
.aba:focus-visible {
  outline: 3px solid var(--sgh-foco);
  outline-offset: -3px;
}
.painel {
  display: grid;
  gap: var(--sgh-espaco-3);
  min-width: 0;
}
.cartao {
  display: grid;
  gap: var(--sgh-espaco-3);
  align-content: start;
  padding: var(--sgh-espaco-3) var(--sgh-espaco-4);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--p-button-border-radius, 6px);
  background: var(--sgh-fundo-elevado);
  min-width: 0;
  overflow-x: auto;
}
.cartao__titulo {
  margin: 0;
  font-size: 1.05rem;
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
.inativo {
  color: var(--sgh-texto-secundario);
}
.item-revisao {
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
}
</style>
