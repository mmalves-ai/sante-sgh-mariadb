<script setup lang="ts">
// Turmas e lista de presença (M52.6; regra 20): abrir a turma de um curso (carga não menor que a mínima, instrutor,
// modalidade, o POP trabalhado), inscrever, registrar presença, aproveitamento e conclusão (a validade sai do curso; a
// conclusão da turma do POP registra a ciência da versão), encerrar (a lista não muda mais) ou cancelar com motivo, e
// a lista de presença em PDF para a assinatura.
import {
  APROVEITAMENTOS_TREINAMENTO,
  type AproveitamentoTreinamentoCodigo,
  type ApoioTreinamento,
  CODIGOS_MODALIDADE_TURMA,
  type CorrecaoResposta,
  esquemaAlterarTurma,
  esquemaCorrigirParticipacao,
  esquemaParticipacao,
  esquemaTurma,
  MODALIDADES_TURMA,
  type ModalidadeTurma,
  type ParticipanteResposta,
  PRESENCAS_TREINAMENTO,
  type PresencaTreinamentoCodigo,
  SITUACOES_TURMA,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { dataBr } from '../comum.js';
import {
  abrirTurma,
  alterarTurma,
  buscarColaboradores,
  cancelarTurma,
  type ColaboradorBusca,
  corrigirParticipacao,
  encerrarTurma,
  inscrever,
  lerCursos,
  lerPops,
  lerTurma,
  lerTurmas,
  registrarParticipacao,
  retirarInscricao,
  urlListaPresenca,
} from './api-f6.js';

defineProps<{ apoio: ApoioTreinamento }>();
const { t } = useI18n();
const cliente = useQueryClient();
const filtro = ref<'aberta' | 'encerrada' | 'cancelada' | 'todas'>('aberta');
const opcoesFiltro = computed(() => [
  ...(['aberta', 'encerrada', 'cancelada'] as const).map((s) => ({ valor: s, rotulo: SITUACOES_TURMA[s] })),
  { valor: 'todas' as const, rotulo: t('f6.realizado.todas') },
]);
const turmas = useQuery({
  queryKey: computed(() => ['f6', 'turmas', filtro.value]),
  queryFn: () => lerTurmas(filtro.value),
});
const lista = computed(() => turmas.data.value ?? null);
const cursos = useQuery({ queryKey: ['f6', 'cursos'], queryFn: lerCursos });
const pops = useQuery({ queryKey: ['f6', 'pops'], queryFn: lerPops });
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);

// ── Nova turma ────────────────────────────────────────────────────────────────────────────────────────────────
const nova = ref(false);
const curso = ref<number | null>(null);
const inicio = ref<string | null>(null);
const fim = ref<string | null>(null);
const carga = ref('');
const instrutor = ref('');
const modalidade = ref<ModalidadeTurma>('presencial');
const local = ref('');
const pop = ref<number | null>(null);
const opcoesCurso = computed(() =>
  (cursos.data.value?.itens ?? [])
    .filter((c) => c.ativo)
    .map((c) => ({ valor: c.id, rotulo: `${c.codigo} · ${c.titulo}` })),
);
const opcoesPop = computed(() => [
  { valor: null, rotulo: t('f6.treinamentos.turmas.semPop') },
  ...(pops.data.value?.itens ?? []).map((p) => ({
    valor: p.id as number | null,
    rotulo: `${p.codigo} v${p.versao} · ${p.titulo}`,
  })),
]);
const opcoesModalidade = CODIGOS_MODALIDADE_TURMA.map((m) => ({ valor: m, rotulo: MODALIDADES_TURMA[m] }));
watch(curso, (c) => {
  const k = cursos.data.value?.itens.find((x) => x.id === c);
  if (k && !carga.value) carga.value = String(k.cargaMinimaMin);
});
const entradaTurma = computed(() =>
  esquemaTurma.safeParse({
    curso: curso.value ?? 0,
    inicio: inicio.value ?? '',
    fim: fim.value ?? inicio.value ?? '',
    cargaMin: Number(carga.value),
    instrutor: instrutor.value.trim(),
    modalidade: modalidade.value,
    local: local.value.trim() || null,
    pop: pop.value,
    observacao: null,
  }),
);
async function gravarTurma(): Promise<void> {
  if (!entradaTurma.value.success) return;
  erro.value = null;
  try {
    const r = await abrirTurma(entradaTurma.value.data);
    aviso.value = r.mensagem;
    nova.value = false;
    selecionada.value = r.id;
    filtro.value = 'aberta';
    await cliente.invalidateQueries({ queryKey: ['f6'] });
  } catch (x) {
    erro.value = x;
  }
}

// ── Detalhe ───────────────────────────────────────────────────────────────────────────────────────────────────
const selecionada = ref<number | null>(null);
const turma = useQuery({
  queryKey: computed(() => ['f6', 'turma', selecionada.value]),
  queryFn: () => lerTurma(selecionada.value!),
  enabled: computed(() => selecionada.value !== null),
});
const d = computed(() => turma.data.value ?? null);
const termo = ref('');
const achados = ref<ColaboradorBusca[]>([]);
const escolhidos = ref<number[]>([]);
async function buscar(): Promise<void> {
  if (termo.value.trim().length < 2) return;
  erro.value = null;
  try {
    achados.value = (await buscarColaboradores(termo.value.trim())).itens;
  } catch (x) {
    erro.value = x;
  }
}
async function inscreverEscolhidos(): Promise<void> {
  if (!d.value || escolhidos.value.length === 0) return;
  erro.value = null;
  try {
    const r = await inscrever(d.value.id, escolhidos.value);
    aviso.value = r.mensagem;
    escolhidos.value = [];
    achados.value = [];
    termo.value = '';
    await cliente.invalidateQueries({ queryKey: ['f6'] });
  } catch (x) {
    erro.value = x;
  }
}

const participante = ref<ParticipanteResposta | null>(null);
const presenca = ref<PresencaTreinamentoCodigo>('presente');
const aproveitamento = ref<AproveitamentoTreinamentoCodigo | null>(null);
const conclusao = ref<string | null>(null);
const obs = ref('');
const opcoesPresenca = (Object.keys(PRESENCAS_TREINAMENTO) as PresencaTreinamentoCodigo[]).map((p) => ({
  valor: p,
  rotulo: PRESENCAS_TREINAMENTO[p],
}));
const opcoesAproveitamento = computed(() => [
  { valor: null, rotulo: t('f6.treinamentos.turmas.semAproveitamento') },
  ...(Object.keys(APROVEITAMENTOS_TREINAMENTO) as AproveitamentoTreinamentoCodigo[]).map((a) => ({
    valor: a as AproveitamentoTreinamentoCodigo | null,
    rotulo: APROVEITAMENTOS_TREINAMENTO[a],
  })),
]);
// W0-06: na correção (presença já lançada), o mesmo formulário pede o motivo e grava pela rota da correção.
const corrigindo = ref(false);
const motivoCorrecao = ref('');
function registrar(p: ParticipanteResposta, correcao = false): void {
  corrigindo.value = correcao;
  motivoCorrecao.value = '';
  participante.value = p;
  presenca.value = p.presenca === 'inscrito' ? 'presente' : p.presenca;
  aproveitamento.value = p.aproveitamento ?? 'aprovado';
  conclusao.value = p.conclusao ?? d.value?.fim ?? null;
  obs.value = p.observacao ?? '';
  erro.value = null;
}
const entradaPart = computed(() =>
  esquemaParticipacao.safeParse({
    treinamento: d.value?.id ?? 0,
    vinculo: participante.value?.vinculo ?? 0,
    presenca: presenca.value,
    aproveitamento: aproveitamento.value,
    conclusao:
      aproveitamento.value === 'aprovado' || aproveitamento.value === 'sem-avaliacao'
        ? conclusao.value
        : null,
    observacao: obs.value.trim() || null,
    versao: participante.value?.versao ?? 0,
  }),
);
const entradaCorrecao = computed(() =>
  esquemaCorrigirParticipacao.safeParse({
    ...(entradaPart.value.success ? entradaPart.value.data : {}),
    motivo: motivoCorrecao.value.trim(),
  }),
);
const podeGravarPart = computed(() =>
  corrigindo.value ? entradaCorrecao.value.success : entradaPart.value.success,
);
async function gravarParticipacao(): Promise<void> {
  if (!podeGravarPart.value || !d.value) return;
  erro.value = null;
  try {
    if (corrigindo.value && entradaCorrecao.value.success) {
      aviso.value = (await corrigirParticipacao(d.value.id, entradaCorrecao.value.data)).mensagem;
      participante.value = null;
      corrigindo.value = false;
      await cliente.invalidateQueries({ queryKey: ['f6'] });
      return;
    }
    if (!entradaPart.value.success) return;
    const { vinculo, presenca, aproveitamento, conclusao, observacao, versao } = entradaPart.value.data;
    const resto = { vinculo, presenca, aproveitamento, conclusao, observacao, versao };
    const r = await registrarParticipacao(d.value.id, resto);
    aviso.value = r.mensagem;
    participante.value = null;
    await cliente.invalidateQueries({ queryKey: ['f6'] });
  } catch (x) {
    erro.value = x;
  }
}
const motivoCancelamento = ref('');
const cancelando = ref(false);
async function encerrar(): Promise<void> {
  if (!d.value) return;
  erro.value = null;
  try {
    aviso.value = (await encerrarTurma(d.value.id, d.value.versao)).mensagem;
    await cliente.invalidateQueries({ queryKey: ['f6'] });
  } catch (x) {
    erro.value = x;
  }
}
async function cancelar(): Promise<void> {
  if (!d.value || motivoCancelamento.value.trim().length < 10) return;
  erro.value = null;
  try {
    aviso.value = (await cancelarTurma(d.value.id, d.value.versao, motivoCancelamento.value.trim())).mensagem;
    cancelando.value = false;
    await cliente.invalidateQueries({ queryKey: ['f6'] });
  } catch (x) {
    erro.value = x;
  }
}
// ── W0-06: alterar a turma aberta (com o motivo) ──────────────────────────────────────────────────────────────
const alterando = ref(false);
const alt = ref({
  inicio: null as string | null,
  fim: null as string | null,
  carga: '',
  instrutor: '',
  modalidade: 'presencial' as ModalidadeTurma,
  local: '',
  pop: null as number | null,
  observacao: '',
  motivo: '',
});
function abrirAlteracao(): void {
  const x = d.value;
  if (!x) return;
  alt.value = {
    inicio: x.inicio,
    fim: x.fim,
    carga: String(x.cargaMin),
    instrutor: x.instrutor,
    modalidade: x.modalidade,
    local: x.local ?? '',
    pop: x.pop?.id ?? null,
    observacao: x.observacao ?? '',
    motivo: '',
  };
  erro.value = null;
  alterando.value = true;
}
const entradaAlteracao = computed(() =>
  esquemaAlterarTurma.safeParse({
    treinamento: d.value?.id ?? 0,
    inicio: alt.value.inicio ?? '',
    fim: alt.value.fim ?? alt.value.inicio ?? '',
    cargaMin: Number(alt.value.carga),
    instrutor: alt.value.instrutor.trim(),
    modalidade: alt.value.modalidade,
    local: alt.value.local.trim() || null,
    pop: alt.value.pop,
    observacao: alt.value.observacao.trim() || null,
    motivo: alt.value.motivo.trim(),
    versao: d.value?.versao ?? 0,
  }),
);
async function gravarAlteracao(): Promise<void> {
  if (!entradaAlteracao.value.success || !d.value) return;
  erro.value = null;
  try {
    aviso.value = (await alterarTurma(d.value.id, entradaAlteracao.value.data)).mensagem;
    alterando.value = false;
    await cliente.invalidateQueries({ queryKey: ['f6'] });
  } catch (x) {
    erro.value = x;
  }
}

// ── W0-06: retirar a inscrição feita por engano (o 409 com presença oferece a correção) ───────────────────────
const retirando = ref<ParticipanteResposta | null>(null);
const dialogoRetirada = computed({
  get: () => retirando.value !== null,
  set: (v: boolean) => {
    if (!v) retirando.value = null;
  },
});
async function retirar(motivo: string): Promise<unknown> {
  const p = retirando.value;
  if (!p || !d.value) return null;
  const r = await retirarInscricao(d.value.id, p.vinculo, p.versao, motivo);
  aviso.value = r.mensagem;
  await cliente.invalidateQueries({ queryKey: ['f6'] });
  return r;
}
function irParaCorrecao(): void {
  const p = retirando.value;
  retirando.value = null;
  if (p) registrar(p, true);
}

// ── W0-06: histórico das alterações e correções (o valor anterior e o novo, só das chaves que mudaram) ─────────
function mudancas(c: CorrecaoResposta): Array<{ campo: string; antes: string; depois: string }> {
  const chaves = [...new Set([...Object.keys(c.antes), ...Object.keys(c.depois)])];
  const txt = (k: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    const x = String(v);
    if (k === 'presenca' && x in PRESENCAS_TREINAMENTO)
      return PRESENCAS_TREINAMENTO[x as PresencaTreinamentoCodigo];
    if (k === 'aproveitamento' && x in APROVEITAMENTOS_TREINAMENTO)
      return APROVEITAMENTOS_TREINAMENTO[x as AproveitamentoTreinamentoCodigo];
    if (k === 'modalidade' && x in MODALIDADES_TURMA) return MODALIDADES_TURMA[x as ModalidadeTurma];
    return /^\d{4}-\d{2}-\d{2}$/.test(x) ? dataBr(x) : x;
  };
  return chaves
    .filter((k) => JSON.stringify(c.antes[k]) !== JSON.stringify(c.depois[k]))
    .map((k) => ({
      campo: rotuloOu(`f6.treinamentos.turmas.campos.${k}`, k),
      antes: txt(k, c.antes[k]),
      depois: txt(k, c.depois[k]),
    }));
}
function rotuloOu(chave: string, padrao: string): string {
  const v = t(chave);
  return v === chave ? padrao : v;
}
const nomeOperacao = (op: string) =>
  rotuloOu(`f6.treinamentos.turmas.operacoes.${op.replaceAll('.', '_')}`, op);

const horas = (m: number) => `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
</script>

<template>
  <section class="bloco" aria-labelledby="treino-turmas" data-testid="treino-turmas">
    <h2 id="treino-turmas">{{ t('f6.treinamentos.abas.turmas') }}</h2>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="turmas-aviso" />
    <SanteOpcoes
      v-model="filtro"
      :legenda="t('f6.treinamentos.turmas.filtro')"
      :opcoes="opcoesFiltro"
      data-testid="turmas-filtro"
    />
    <ErroPessoas v-if="turmas.isError.value" :erro="turmas.error.value" />
    <p v-else-if="!lista" role="status">{{ t('f6.carregando') }}</p>
    <p v-else-if="lista.itens.length === 0">{{ t('f6.treinamentos.turmas.semTurmas') }}</p>
    <table v-else class="tabela">
      <thead>
        <tr>
          <th scope="col">{{ t('f6.treinamentos.turmas.curso') }}</th>
          <th scope="col">{{ t('f6.treinamentos.turmas.inicio') }}</th>
          <th scope="col">{{ t('f6.treinamentos.turmas.instrutor') }}</th>
          <th scope="col">{{ t('f6.treinamentos.turmas.participantes') }}</th>
          <th scope="col">{{ t('f6.treinamentos.turmas.concluintes') }}</th>
          <th scope="col"><span class="secundario">—</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in lista.itens" :key="x.id" :data-testid="`turma-${x.id}`">
          <th scope="row">
            {{ x.cursoCodigo }} · {{ x.cursoTitulo }}
            <div class="secundario">
              {{ SITUACOES_TURMA[x.situacao] }} · {{ MODALIDADES_TURMA[x.modalidade] }}
            </div>
          </th>
          <td>
            {{
              x.fim !== x.inicio
                ? t('f6.periodo', { inicio: dataBr(x.inicio), fim: dataBr(x.fim) })
                : dataBr(x.inicio)
            }}
          </td>
          <td>{{ x.instrutor }}</td>
          <td>{{ x.participantes }}</td>
          <td>{{ x.concluintes }}</td>
          <td>
            <SanteBotao
              :rotulo="t('f6.treinamentos.turmas.abrir')"
              variante="texto"
              :data-testid="`abrir-turma-${x.id}`"
              @acionar="selecionada = x.id"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <div class="acoes">
      <SanteBotao
        v-if="apoio.acoes.registrar && !nova"
        :rotulo="t('f6.treinamentos.turmas.nova')"
        data-testid="nova-turma"
        @acionar="nova = true"
      />
    </div>
  </section>

  <form
    v-if="nova"
    class="bloco"
    :aria-label="t('f6.treinamentos.turmas.nova')"
    data-testid="form-turma"
    @submit.prevent="gravarTurma"
  >
    <h2>{{ t('f6.treinamentos.turmas.nova') }}</h2>
    <div class="campos">
      <SanteSelecao
        v-model="curso"
        :rotulo="t('f6.treinamentos.turmas.curso')"
        :opcoes="opcoesCurso"
        data-testid="turma-curso"
      />
      <SanteData
        v-model="inicio"
        :rotulo="t('f6.treinamentos.turmas.inicio')"
        editavel
        data-testid="turma-inicio"
      />
      <SanteData v-model="fim" :rotulo="t('f6.treinamentos.turmas.fim')" editavel data-testid="turma-fim" />
      <SanteCampoTexto
        v-model="carga"
        :rotulo="t('f6.treinamentos.turmas.carga')"
        :max-bytes="5"
        data-testid="turma-carga"
      />
      <SanteCampoTexto
        v-model="instrutor"
        :rotulo="t('f6.treinamentos.turmas.instrutor')"
        :max-bytes="70"
        data-testid="turma-instrutor"
      />
      <SanteSelecao
        v-model="modalidade"
        :rotulo="t('f6.treinamentos.turmas.modalidade')"
        :opcoes="opcoesModalidade"
        data-testid="turma-modalidade"
      />
      <SanteCampoTexto
        v-model="local"
        :rotulo="t('f6.treinamentos.turmas.local')"
        :max-bytes="80"
        data-testid="turma-local"
      />
      <SanteSelecao
        v-model="pop"
        :rotulo="t('f6.treinamentos.turmas.pop')"
        :opcoes="opcoesPop"
        data-testid="turma-pop"
      />
    </div>
    <ErroPessoas v-if="erro" :erro="erro" />
    <div class="acoes">
      <SanteBotao :rotulo="t('f6.cancelar')" variante="texto" @acionar="nova = false" />
      <SanteBotao
        :rotulo="t('f6.gravar')"
        tipo="submit"
        :desabilitado="!entradaTurma.success"
        data-testid="turma-gravar"
      />
    </div>
  </form>

  <section
    v-if="selecionada !== null"
    class="bloco"
    aria-labelledby="turma-detalhe"
    data-testid="turma-detalhe"
  >
    <ErroPessoas v-if="turma.isError.value" :erro="turma.error.value" />
    <p v-else-if="!d" role="status">{{ t('f6.carregando') }}</p>
    <template v-else>
      <h2 id="turma-detalhe">{{ t('f6.treinamentos.turmas.detalhe', { id: d.id }) }}: {{ d.cursoTitulo }}</h2>
      <p>
        {{
          d.fim !== d.inicio
            ? t('f6.periodo', { inicio: dataBr(d.inicio), fim: dataBr(d.fim) })
            : dataBr(d.inicio)
        }}
        · {{ horas(d.cargaMin) }} · {{ MODALIDADES_TURMA[d.modalidade] }} · {{ d.instrutor
        }}<template v-if="d.local"> · {{ d.local }}</template>
      </p>
      <p class="secundario">{{ t('f6.treinamentos.turmas.conteudo') }}: {{ d.cursoConteudo }}</p>
      <SanteAlerta
        v-if="d.pop"
        :texto="t('f6.treinamentos.turmas.popDaTurma', { codigo: d.pop.codigo, versao: d.pop.versao })"
        variante="info"
      />
      <SanteAlerta
        v-if="d.motivoCancelamento"
        :texto="t('f6.treinamentos.turmas.cancelada', { motivo: d.motivoCancelamento })"
        variante="aviso"
      />
      <SanteAlerta v-else-if="d.acoes.motivo" :texto="d.acoes.motivo" variante="info" />
      <h3>{{ t('f6.treinamentos.turmas.lista') }}</h3>
      <p v-if="d.lista.length === 0">{{ t('f6.nenhum') }}</p>
      <table v-else class="tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('f6.treinamentos.situacao.colaborador') }}</th>
            <th scope="col">{{ t('f6.treinamentos.turmas.presenca') }}</th>
            <th scope="col">{{ t('f6.treinamentos.turmas.aproveitamento') }}</th>
            <th scope="col">{{ t('f6.treinamentos.turmas.conclusao') }}</th>
            <th scope="col">{{ t('f6.treinamentos.turmas.validoAte') }}</th>
            <th scope="col"><span class="secundario">—</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in d.lista" :key="p.vinculo" :data-testid="`participante-${p.vinculo}`">
            <th scope="row">
              {{ p.nome }} <span v-if="p.matricula" class="secundario">{{ p.matricula }}</span>
            </th>
            <td>{{ PRESENCAS_TREINAMENTO[p.presenca] }}</td>
            <td>{{ p.aproveitamento ? APROVEITAMENTOS_TREINAMENTO[p.aproveitamento] : '' }}</td>
            <td>{{ dataBr(p.conclusao) }}</td>
            <td>{{ dataBr(p.validoAte) }}</td>
            <td>
              <SanteBotao
                v-if="d.acoes.registrar"
                :rotulo="t('f6.treinamentos.turmas.registrar')"
                variante="texto"
                :data-testid="`registrar-${p.vinculo}`"
                @acionar="registrar(p)"
              />
              <SanteBotao
                v-if="d.acoes.corrigir && p.presenca !== 'inscrito'"
                :rotulo="t('f6.treinamentos.turmas.corrigir')"
                variante="texto"
                :data-testid="`corrigir-${p.vinculo}`"
                @acionar="registrar(p, true)"
              />
              <SanteBotao
                v-if="d.acoes.retirar"
                :rotulo="t('f6.treinamentos.turmas.retirar')"
                variante="texto"
                :data-testid="`retirar-${p.vinculo}`"
                @acionar="retirando = p"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <form
        v-if="participante"
        class="bloco"
        :aria-label="
          t(corrigindo ? 'f6.treinamentos.turmas.corrigirDe' : 'f6.treinamentos.turmas.registrarDe', {
            nome: participante.nome,
          })
        "
        data-testid="form-participacao"
        @submit.prevent="gravarParticipacao"
      >
        <h3>
          {{
            t(corrigindo ? 'f6.treinamentos.turmas.corrigirDe' : 'f6.treinamentos.turmas.registrarDe', {
              nome: participante.nome,
            })
          }}
        </h3>
        <p v-if="corrigindo" class="secundario">{{ t('f6.treinamentos.turmas.corrigirAjuda') }}</p>
        <SanteOpcoes
          v-model="presenca"
          :legenda="t('f6.treinamentos.turmas.presenca')"
          :opcoes="opcoesPresenca"
          data-testid="part-presenca"
        />
        <div class="campos">
          <SanteSelecao
            v-model="aproveitamento"
            :rotulo="t('f6.treinamentos.turmas.aproveitamento')"
            :opcoes="opcoesAproveitamento"
            data-testid="part-aproveitamento"
          />
          <SanteData
            v-model="conclusao"
            :rotulo="t('f6.treinamentos.turmas.conclusao')"
            editavel
            data-testid="part-conclusao"
          />
        </div>
        <SanteCampoTexto v-model="obs" :rotulo="t('f6.observacao')" :max-bytes="400" />
        <template v-if="corrigindo">
          <SanteCampoTexto
            v-model="motivoCorrecao"
            :rotulo="t('f6.motivo')"
            :max-bytes="400"
            multilinha
            data-testid="part-motivo"
          />
          <p class="secundario">{{ t('f6.motivoAjuda') }}</p>
        </template>
        <ErroPessoas v-if="erro" :erro="erro" />
        <div class="acoes">
          <SanteBotao :rotulo="t('f6.cancelar')" variante="texto" @acionar="participante = null" />
          <SanteBotao
            :rotulo="t('f6.gravar')"
            tipo="submit"
            :desabilitado="!podeGravarPart"
            data-testid="part-gravar"
          />
        </div>
      </form>
      <form
        v-if="d.acoes.inscrever"
        class="bloco"
        :aria-label="t('f6.treinamentos.turmas.inscrever')"
        data-testid="form-inscricao"
        @submit.prevent="buscar"
      >
        <h3>{{ t('f6.treinamentos.turmas.inscrever') }}</h3>
        <div class="campos">
          <SanteCampoTexto
            v-model="termo"
            :rotulo="t('f6.treinamentos.turmas.buscarColaborador')"
            :max-bytes="60"
            data-testid="inscricao-termo"
          />
          <SanteBotao
            :rotulo="t('f6.buscar')"
            tipo="submit"
            variante="secundario"
            data-testid="inscricao-buscar"
          />
        </div>
        <fieldset v-if="achados.length > 0">
          <legend>{{ t('f6.treinamentos.turmas.participantes') }}</legend>
          <label v-for="c in achados" :key="c.vinculo" class="opcao">
            <input
              v-model="escolhidos"
              type="checkbox"
              :value="c.vinculo"
              :data-testid="`inscrever-${c.vinculo}`"
            />
            {{ c.nome }}
            <span class="secundario"
              >{{ c.matricula ?? '' }} · {{ c.funcao ?? c.cargo }} · {{ c.unidadeNome ?? '' }}</span
            >
          </label>
        </fieldset>
        <ErroPessoas v-if="erro && !participante" :erro="erro" />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('f6.treinamentos.turmas.inscrever')"
            :desabilitado="escolhidos.length === 0"
            data-testid="inscrever"
            @acionar="inscreverEscolhidos"
          />
        </div>
      </form>
      <div class="acoes">
        <a :href="urlListaPresenca(d.id)" target="_blank" rel="noopener" data-testid="lista-pdf">{{
          t('f6.treinamentos.turmas.listaPdf')
        }}</a>
        <SanteBotao
          v-if="d.acoes.alterar && !alterando"
          :rotulo="t('f6.treinamentos.turmas.alterar')"
          variante="secundario"
          data-testid="alterar-turma"
          @acionar="abrirAlteracao"
        />
        <SanteBotao
          v-if="d.acoes.encerrar"
          :rotulo="t('f6.treinamentos.turmas.encerrar')"
          variante="secundario"
          data-testid="encerrar-turma"
          @acionar="encerrar"
        />
        <SanteBotao
          v-if="d.acoes.cancelar && !cancelando"
          :rotulo="t('f6.treinamentos.turmas.cancelarTurma')"
          variante="texto"
          data-testid="cancelar-turma"
          @acionar="cancelando = true"
        />
        <SanteBotao :rotulo="t('f6.fechar')" variante="texto" @acionar="selecionada = null" />
      </div>
      <form
        v-if="cancelando"
        class="bloco"
        :aria-label="t('f6.treinamentos.turmas.cancelarTurma')"
        @submit.prevent="cancelar"
      >
        <SanteCampoTexto
          v-model="motivoCancelamento"
          :rotulo="t('f6.motivo')"
          :max-bytes="400"
          data-testid="cancelar-motivo"
        />
        <p class="secundario">{{ t('f6.motivoAjuda') }}</p>
        <div class="acoes">
          <SanteBotao :rotulo="t('f6.fechar')" variante="texto" @acionar="cancelando = false" />
          <SanteBotao
            :rotulo="t('f6.treinamentos.turmas.cancelarTurma')"
            tipo="submit"
            :desabilitado="motivoCancelamento.trim().length < 10"
            data-testid="cancelar-confirmar"
          />
        </div>
      </form>
      <form
        v-if="alterando"
        class="bloco"
        :aria-label="t('f6.treinamentos.turmas.alterarTitulo', { id: d.id })"
        data-testid="form-alterar-turma"
        @submit.prevent="gravarAlteracao"
      >
        <h3>{{ t('f6.treinamentos.turmas.alterarTitulo', { id: d.id }) }}</h3>
        <p class="secundario">{{ t('f6.treinamentos.turmas.alterarAjuda') }}</p>
        <div class="campos">
          <SanteData
            v-model="alt.inicio"
            :rotulo="t('f6.treinamentos.turmas.inicio')"
            editavel
            data-testid="alt-inicio"
          />
          <SanteData
            v-model="alt.fim"
            :rotulo="t('f6.treinamentos.turmas.fim')"
            editavel
            data-testid="alt-fim"
          />
          <SanteCampoTexto
            v-model="alt.carga"
            :rotulo="t('f6.treinamentos.turmas.carga')"
            :max-bytes="5"
            data-testid="alt-carga"
          />
          <SanteCampoTexto
            v-model="alt.instrutor"
            :rotulo="t('f6.treinamentos.turmas.instrutor')"
            :max-bytes="70"
            data-testid="alt-instrutor"
          />
          <SanteSelecao
            v-model="alt.modalidade"
            :rotulo="t('f6.treinamentos.turmas.modalidade')"
            :opcoes="opcoesModalidade"
            data-testid="alt-modalidade"
          />
          <SanteCampoTexto
            v-model="alt.local"
            :rotulo="t('f6.treinamentos.turmas.local')"
            :max-bytes="80"
            data-testid="alt-local"
          />
          <SanteSelecao
            v-model="alt.pop"
            :rotulo="t('f6.treinamentos.turmas.pop')"
            :opcoes="opcoesPop"
            data-testid="alt-pop"
          />
        </div>
        <SanteCampoTexto v-model="alt.observacao" :rotulo="t('f6.observacao')" :max-bytes="400" />
        <SanteCampoTexto
          v-model="alt.motivo"
          :rotulo="t('f6.motivo')"
          :max-bytes="400"
          multilinha
          data-testid="alt-motivo"
        />
        <p class="secundario">{{ t('f6.motivoAjuda') }}</p>
        <ErroPessoas v-if="erro" :erro="erro" />
        <div class="acoes">
          <SanteBotao :rotulo="t('f6.cancelar')" variante="texto" @acionar="alterando = false" />
          <SanteBotao
            :rotulo="t('f6.gravar')"
            tipo="submit"
            :desabilitado="!entradaAlteracao.success"
            data-testid="alt-gravar"
          />
        </div>
      </form>
      <h3>{{ t('f6.treinamentos.turmas.historico') }}</h3>
      <p v-if="(d.correcoes ?? []).length === 0" class="secundario">
        {{ t('f6.treinamentos.turmas.semHistorico') }}
      </p>
      <ul v-else data-testid="turma-historico">
        <li v-for="c in d.correcoes" :key="c.id" :data-testid="`correcao-${c.id}`">
          {{
            t('f6.treinamentos.turmas.historicoLinha', {
              em: `${dataBr(c.em)} ${c.em.slice(11, 16)}`,
              por: c.por,
              operacao: nomeOperacao(c.operacao),
            })
          }}
          <div class="secundario">{{ c.motivo }}</div>
          <ul class="secundario">
            <li v-for="m in mudancas(c)" :key="m.campo">
              {{ t('f6.treinamentos.turmas.mudanca', m) }}
            </li>
          </ul>
        </li>
      </ul>
      <DialogoMotivo
        v-model:visivel="dialogoRetirada"
        :titulo="t('f6.treinamentos.turmas.retirarTitulo', { nome: retirando?.nome ?? '' })"
        :texto="t('f6.treinamentos.turmas.retirarTexto')"
        :confirmar="t('f6.treinamentos.turmas.retirar')"
        :acao="retirar"
        testid="dialogo-retirada"
      >
        <template #recusa="{ codigo }">
          <SanteBotao
            v-if="codigo === 'inscricao-com-presenca' && d.acoes.corrigir"
            :rotulo="t('f6.treinamentos.turmas.irCorrecao')"
            variante="secundario"
            data-testid="dialogo-retirada-corrigir"
            @acionar="irParaCorrecao"
          />
        </template>
      </DialogoMotivo>
    </template>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
<style scoped>
.opcao {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  min-height: 24px;
}
</style>
