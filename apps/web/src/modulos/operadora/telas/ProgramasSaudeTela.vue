<script setup lang="ts">
// Promoção da saúde e gestão de crônicos da operadora (08-SGO L115, C2-102; RN ANS 264 e 265/2011), atalho da tela de
// beneficiários. Um programa por vez: os elegíveis apurados das contas (diagnóstico, procedimento, internação, urgência,
// custo, idade e escore) com o motivo e a inclusão num clique; os participantes com a classificação de risco e o
// próximo contato; a visão por beneficiário (participações, contatos e avaliações); a agenda de visitas com os
// atrasados primeiro e a baixa no lugar; a avaliação de risco pelo questionário; o custo do crônico antes e depois da
// entrada e a adesão que dá direito à bonificação; os critérios de elegibilidade. A falta aparece enquanto se digita.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import {
  type Agenda,
  aplicarAvaliacao,
  baixarContato,
  type BonificacaoApurada,
  CLASSES_RISCO,
  type Contato,
  type Custo,
  desativarCriterio,
  type Elegivel,
  encerrarParticipante,
  type GrupoRisco,
  incluirCriterio,
  incluirParticipante,
  incluirPrograma,
  lerAgenda,
  lerBonificacao,
  lerCusto,
  lerElegiveis,
  lerGruposRisco,
  lerParticipantes,
  lerProgramas,
  lerQuestionarios,
  lerVisaoBeneficiario,
  MOTIVOS_SAIDA,
  type Participante,
  type Programa,
  type Questionario,
  registrarContato,
  TIPOS_CONTATO,
  TIPOS_CRITERIO,
  TIPOS_PROGRAMA,
  type VisaoBeneficiario,
} from '../api-programa-saude.js';
import { mensagensProgramasSaude } from '../i18n-programas-saude.js';

const { t } = useI18n({ useScope: 'local', messages: { 'pt-BR': mensagensProgramasSaude } });
type Aba = 'elegiveis' | 'participantes' | 'agenda' | 'resultado' | 'criterios';
const aba = ref<Aba>('elegiveis');
const podeConfigurar = computed(() => pode('operadora.promocao.configurar'));
const podeRegistrar = computed(() => pode('operadora.promocao.registrar'));
const erro = ref<string | null>(null);
const aviso = ref<string | null>(null);
const hoje = new Date().toISOString().slice(0, 10);
const opcoes = (m: Record<string, string>) => Object.entries(m).map(([valor, rotulo]) => ({ valor, rotulo }));
const dataBr = (v: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '—');
const instanteBr = (v: string | null) => (v ? `${dataBr(v)} ${v.slice(11, 16)}` : '—');
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR')}%`);
const risco = (v: string | null) =>
  v ? (CLASSES_RISCO[v as keyof typeof CLASSES_RISCO] ?? v) : 'Sem avaliação';
const numeroBr = (v: string): number | null => {
  const t = v.trim().replace(/\./g, '').replace(',', '.');
  return t === '' || Number.isNaN(Number(t)) ? null : Number(t);
};

async function tentar<T>(fn: () => Promise<T>, ok?: string): Promise<T | null> {
  erro.value = null;
  // Só a gravação (com a mensagem de sucesso) troca o aviso: a leitura que vem logo depois (lista, aba) não o apaga.
  if (ok) aviso.value = null;
  try {
    const r = await fn();
    if (ok) aviso.value = ok;
    return r;
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
    return null;
  }
}

// ---------------------------------------------------------------- programas --------------------------------------
const programas = ref<Programa[]>([]);
const programaId = ref<number | null>(null);
const programa = computed(() => programas.value.find((p) => p.id === programaId.value) ?? null);
const opcoesProgramas = computed(() =>
  programas.value.map((p) => ({ valor: p.id, rotulo: `${p.nome} (${p.participantesAtivos} ativos)` })),
);
const grupos = ref<GrupoRisco[]>([]);
const opcoesGrupos = computed(() => [
  { valor: null, rotulo: 'Sem grupo de risco' },
  ...grupos.value.map((g) => ({ valor: g.id, rotulo: g.descricao })),
]);
async function carregarProgramas() {
  programas.value = (await tentar(lerProgramas)) ?? [];
  if (programaId.value === null && programas.value.length) programaId.value = programas.value[0]!.id;
}
void carregarProgramas();
void tentar(lerGruposRisco).then((g) => (grupos.value = g ?? []));

const novo = ref(false);
const prog = ref({
  codigo: '',
  nome: '',
  tipo: 'gestao_cronicos' as string | null,
  grupoRisco: null as number | null,
  publicoAlvo: '',
  inicio: hoje,
  registradoAns: 'nao' as string | null,
  numeroRegistroAns: '',
});
const faltaPrograma = computed(() => {
  const f: string[] = [];
  if (!prog.value.codigo.trim()) f.push('código');
  if (!prog.value.nome.trim()) f.push('nome');
  if (!prog.value.tipo) f.push('tipo');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(prog.value.inicio)) f.push('início da vigência (AAAA-MM-DD)');
  if (prog.value.registradoAns === 'sim' && !prog.value.numeroRegistroAns.trim())
    f.push('número do registro na ANS');
  return f;
});
async function salvarPrograma() {
  const r = await tentar(
    () =>
      incluirPrograma({
        codigo: prog.value.codigo.trim(),
        nome: prog.value.nome.trim(),
        tipo: prog.value.tipo ?? 'outro',
        objetivo: null,
        publicoAlvo: prog.value.publicoAlvo.trim() || null,
        metas: null,
        grupoRisco: prog.value.grupoRisco,
        registradoAns: prog.value.registradoAns === 'sim',
        numeroRegistroAns: prog.value.numeroRegistroAns.trim() || null,
        isentaCoparticipacao: false,
        vigenciaInicio: prog.value.inicio,
        vigenciaFim: null,
        situacao: 'ativo',
      }),
    'Programa cadastrado.',
  );
  if (r) {
    novo.value = false;
    programaId.value = r.id;
    await carregarProgramas();
    aba.value = 'criterios';
  }
}

// ---------------------------------------------------------------- elegíveis e participantes ---------------------
const elegiveis = ref<Elegivel[]>([]);
const participantes = ref<Participante[]>([]);
const agenda = ref<Agenda>({ atrasados: [], hoje: [], proximos: [] });
const custo = ref<Custo | null>(null);
const bonificacao = ref<BonificacaoApurada[]>([]);
async function carregarAba() {
  const p = programaId.value;
  if (p === null) return;
  if (aba.value === 'elegiveis') elegiveis.value = (await tentar(() => lerElegiveis(p))) ?? [];
  if (aba.value === 'participantes') participantes.value = (await tentar(() => lerParticipantes(p))) ?? [];
  if (aba.value === 'agenda') agenda.value = (await tentar(() => lerAgenda(p))) ?? agenda.value;
  if (aba.value === 'resultado') {
    custo.value = await tentar(() => lerCusto(p, 12));
    bonificacao.value = (await tentar(() => lerBonificacao(p))) ?? [];
  }
}
watch([programaId, aba], () => void carregarAba(), { immediate: true });

async function incluir(e: Elegivel) {
  const r = await tentar(
    () =>
      incluirParticipante(programaId.value!, {
        beneficiario: e.beneficiario,
        entrada: hoje,
        grupoRisco: null,
        responsavel: null,
        observacao: `Incluído pela elegibilidade: ${e.motivos.join('; ')}`.slice(0, 2000),
      }),
    `${e.nome} incluído no programa.`,
  );
  if (r) {
    elegiveis.value = elegiveis.value.filter((x) => x.beneficiario !== e.beneficiario);
    await carregarProgramas();
  }
}

// visão por beneficiário
const visao = ref<VisaoBeneficiario | null>(null);
const visaoNome = ref('');
async function abrirVisao(p: Participante) {
  visaoNome.value = p.nome;
  visao.value = await tentar(() => lerVisaoBeneficiario(p.beneficiario));
}

// contato, avaliação e saída do participante escolhido
const escolhido = ref<Participante | null>(null);
const acao = ref<'contato' | 'avaliacao' | 'saida' | null>(null);
function abrir(p: Participante, a: 'contato' | 'avaliacao' | 'saida') {
  escolhido.value = p;
  acao.value = a;
}
const contato = ref({
  tipo: 'telefone' as string | null,
  quando: '',
  feito: 'agendado' as string | null,
  resultado: '',
});
const faltaContato = computed(() => {
  const f: string[] = [];
  if (!contato.value.tipo) f.push('tipo');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(contato.value.quando)) f.push('data e hora (AAAA-MM-DDTHH:MM)');
  else if (contato.value.feito === 'agendado' && contato.value.quando.slice(0, 10) < hoje)
    f.push('agendamento a partir de hoje');
  else if (contato.value.feito === 'realizado' && contato.value.quando.slice(0, 10) > hoje)
    f.push('contato realizado até hoje');
  return f;
});
async function salvarContato() {
  const p = escolhido.value!;
  const realizado = contato.value.feito === 'realizado';
  const r = await tentar(
    () =>
      registrarContato(p.id, {
        tipo: contato.value.tipo ?? 'telefone',
        situacao: realizado ? 'realizado' : 'agendado',
        agendadoPara: realizado ? null : contato.value.quando,
        realizadoEm: realizado ? contato.value.quando : null,
        resultado: contato.value.resultado.trim() || null,
        proximoContato: null,
      }),
    realizado ? 'Contato registrado.' : 'Contato agendado.',
  );
  if (r) {
    acao.value = null;
    contato.value = { ...contato.value, quando: '', resultado: '' };
    await carregarAba();
  }
}

const questionarios = ref<Questionario[]>([]);
const questionarioId = ref<number | null>(null);
const questionario = computed(() => questionarios.value.find((x) => x.id === questionarioId.value) ?? null);
const respostas = ref<Record<number, string | null>>({});
watch(acao, async (a) => {
  if (a === 'avaliacao' && !questionarios.value.length) {
    questionarios.value = (await tentar(lerQuestionarios)) ?? [];
    if (questionarios.value.length === 1) questionarioId.value = questionarios.value[0]!.id;
  }
});
const opcoesPergunta = (p: Questionario['perguntas'][number]) =>
  p.tipoResposta === 'sim_nao'
    ? [
        { valor: 'sim', rotulo: 'Sim' },
        { valor: 'nao', rotulo: 'Não' },
      ]
    : p.opcoes.map((o) => ({ valor: o.codigo, rotulo: o.descricao }));
const faltaAvaliacao = computed(() => {
  const q = questionario.value;
  if (!q) return ['questionário'];
  return q.perguntas
    .filter((p) => (p.obrigatoria || q.exigeTodas) && !(respostas.value[p.id] ?? '').toString().trim())
    .map((p) => `pergunta ${p.sequencia}`);
});
async function salvarAvaliacao() {
  const q = questionario.value!;
  const r = await tentar(() =>
    aplicarAvaliacao(escolhido.value!.id, {
      questionario: q.id,
      canal: 'telefone',
      respostas: q.perguntas
        .filter((p) => (respostas.value[p.id] ?? '').toString().trim())
        .map((p) => {
          const v = String(respostas.value[p.id]);
          if (p.tipoResposta === 'numero') return { pergunta: p.id, numero: numeroBr(v) };
          if (p.tipoResposta === 'data') return { pergunta: p.id, data: v };
          if (p.tipoResposta === 'texto') return { pergunta: p.id, texto: v };
          return { pergunta: p.id, opcao: v };
        }),
      observacao: null,
    }),
  );
  if (r) {
    aviso.value = `Avaliação registrada: escore ${r.escore} de ${r.maximo}, risco ${risco(r.classificacao).toLowerCase()}.`;
    acao.value = null;
    respostas.value = {};
    await carregarAba();
  }
}

const saida = ref({ data: hoje, motivo: 'alta_programa' as string | null });
const faltaSaida = computed(() => {
  const f: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saida.value.data)) f.push('data da saída');
  else if (escolhido.value && saida.value.data < escolhido.value.entrada) f.push('saída a partir da entrada');
  if (!saida.value.motivo) f.push('motivo');
  return f;
});
async function salvarSaida() {
  const p = escolhido.value!;
  const r = await tentar(
    () =>
      encerrarParticipante(p.id, {
        versao: p.versao,
        saida: saida.value.data,
        motivo: saida.value.motivo ?? 'outro',
        observacao: null,
      }),
    'Participação encerrada; os contatos agendados foram cancelados.',
  );
  if (r) {
    acao.value = null;
    await carregarAba();
    await carregarProgramas();
  }
}

// agenda: baixa no lugar
async function baixar(c: Contato, situacao: 'realizado' | 'nao_localizado' | 'cancelado') {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const r = await tentar(
    () =>
      baixarContato(c.id, {
        versao: c.versao,
        situacao,
        realizadoEm: situacao === 'realizado' ? local : null,
        resultado: null,
        proximoContato: null,
      }),
    'Contato atualizado.',
  );
  if (r) await carregarAba();
}

// critérios
const crit = ref({
  tipo: 'cid' as string | null,
  termo: '',
  ocorrencias: '1',
  periodo: '12',
  idadeMin: '',
  idadeMax: '',
  custo: '',
  escore: '',
  forma: 'sugerir' as string | null,
});
const inteiro = (v: string) => (v.trim() === '' ? null : Number.parseInt(v, 10));
const faltaCriterio = computed(() => {
  const f: string[] = [];
  const t = crit.value.tipo;
  if (!t) return ['tipo'];
  if ((t === 'cid' || t === 'procedimento') && !/^\d+$/.test(crit.value.termo.trim()))
    f.push(t === 'cid' ? 'CID-10 (identificador do termo)' : 'procedimento TUSS (identificador do termo)');
  if (t === 'idade' && !crit.value.idadeMin.trim() && !crit.value.idadeMax.trim())
    f.push('idade mínima ou máxima');
  if (t === 'custo' && numeroBr(crit.value.custo) === null) f.push('custo mínimo do período');
  if (t === 'escore' && numeroBr(crit.value.escore) === null) f.push('escore mínimo');
  if (['cid', 'procedimento', 'internacao', 'pronto_socorro', 'custo'].includes(t)) {
    const m = inteiro(crit.value.periodo);
    if (m === null || m < 1 || m > 60) f.push('janela de 1 a 60 meses');
  }
  return f;
});
async function salvarCriterio() {
  const t = crit.value.tipo!;
  const janela = ['cid', 'procedimento', 'internacao', 'pronto_socorro', 'custo'].includes(t);
  const r = await tentar(
    () =>
      incluirCriterio(programaId.value!, {
        tipo: t,
        termo: t === 'cid' || t === 'procedimento' ? Number(crit.value.termo) : null,
        grupoPatologia: null,
        ocorrenciasMinimas: ['cid', 'procedimento', 'internacao', 'pronto_socorro'].includes(t)
          ? inteiro(crit.value.ocorrencias)
          : null,
        periodoMeses: janela ? inteiro(crit.value.periodo) : null,
        idadeMinima: t === 'idade' ? inteiro(crit.value.idadeMin) : null,
        idadeMaxima: t === 'idade' ? inteiro(crit.value.idadeMax) : null,
        custoMensalMinimo: null,
        custoPeriodoMinimo: t === 'custo' ? numeroBr(crit.value.custo) : null,
        escoreMinimo: t === 'escore' ? numeroBr(crit.value.escore) : null,
        formaAlerta: crit.value.forma ?? 'sugerir',
      }),
    'Critério incluído.',
  );
  if (r) await carregarProgramas();
}
async function desativar(id: number, versao: number) {
  if (await tentar(() => desativarCriterio(id, versao), 'Critério desativado.')) await carregarProgramas();
}
const descreverCriterio = (k: Programa['criterios'][number]) => {
  const partes: string[] = [TIPOS_CRITERIO[k.tipo as keyof typeof TIPOS_CRITERIO] ?? k.tipo];
  if (k.termo !== null) partes.push(`termo ${k.termo}`);
  if (k.idadeMinima !== null) partes.push(`a partir de ${k.idadeMinima} anos`);
  if (k.idadeMaxima !== null) partes.push(`até ${k.idadeMaxima} anos`);
  if (k.ocorrenciasMinimas !== null) partes.push(`${k.ocorrenciasMinimas} ou mais`);
  if (k.custoPeriodoMinimo !== null) partes.push(`custo de ${moeda(k.custoPeriodoMinimo)} ou mais`);
  if (k.escoreMinimo !== null) partes.push(`escore ${k.escoreMinimo} ou mais`);
  if (k.periodoMeses !== null) partes.push(`em ${k.periodoMeses} meses`);
  return partes.join(', ');
};
</script>

<template>
  <section class="programas" aria-labelledby="programas-titulo" data-testid="tela-programas-saude">
    <h1 id="programas-titulo">{{ t('titulo') }}</h1>
    <p class="programas__ajuda">{{ t('ajuda') }}</p>
    <RouterLink to="/operadora/beneficiarios" data-testid="link-beneficiarios">{{ t('voltar') }}</RouterLink>
    <SanteAlerta v-if="erro" :texto="erro" variante="alerta" anunciar data-testid="programas-erro" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="programas-aviso" />

    <div class="programas__linha">
      <SanteSelecao
        id="programa-escolhido"
        v-model="programaId"
        :rotulo="t('programa')"
        :opcoes="opcoesProgramas"
        data-testid="programa-escolhido"
      />
      <SanteBotao
        v-if="podeConfigurar"
        :rotulo="t('novoPrograma')"
        variante="secundario"
        data-testid="programa-novo"
        @click="novo = !novo"
      />
    </div>

    <form
      v-if="novo && podeConfigurar"
      class="programas__cartao"
      data-testid="form-programa"
      @submit.prevent="salvarPrograma"
    >
      <div class="programas__linha">
        <SanteCampoTexto
          id="prog-codigo"
          v-model="prog.codigo"
          :max-bytes="30"
          :rotulo="t('codigo')"
          data-testid="prog-codigo"
        />
        <SanteCampoTexto
          id="prog-nome"
          v-model="prog.nome"
          :max-bytes="150"
          :rotulo="t('nome')"
          data-testid="prog-nome"
        />
        <SanteSelecao
          id="prog-tipo"
          v-model="prog.tipo"
          :rotulo="t('tipo')"
          :opcoes="opcoes(TIPOS_PROGRAMA)"
          data-testid="prog-tipo"
        />
      </div>
      <div class="programas__linha">
        <SanteSelecao
          id="prog-grupo"
          v-model="prog.grupoRisco"
          :rotulo="t('grupoRisco')"
          :opcoes="opcoesGrupos"
          data-testid="prog-grupo"
        />
        <SanteCampoTexto
          id="prog-publico"
          v-model="prog.publicoAlvo"
          :max-bytes="500"
          :rotulo="t('publicoAlvo')"
          data-testid="prog-publico"
        />
        <SanteCampoTexto
          id="prog-inicio"
          v-model="prog.inicio"
          :max-bytes="10"
          :rotulo="t('inicio')"
          data-testid="prog-inicio"
        />
      </div>
      <div class="programas__linha">
        <SanteSelecao
          id="prog-registrado"
          v-model="prog.registradoAns"
          :rotulo="t('registradoAns')"
          :opcoes="[
            { valor: 'nao', rotulo: t('nao') },
            { valor: 'sim', rotulo: t('sim') },
          ]"
          data-testid="prog-registrado"
        />
        <SanteCampoTexto
          v-if="prog.registradoAns === 'sim'"
          id="prog-registro"
          v-model="prog.numeroRegistroAns"
          :max-bytes="30"
          :rotulo="t('numeroRegistro')"
          data-testid="prog-registro"
        />
      </div>
      <p v-if="faltaPrograma.length" class="programas__erro" data-testid="prog-falta">
        {{ t('falta', { itens: faltaPrograma.join(', ') }) }}
      </p>
      <SanteBotao
        tipo="submit"
        :rotulo="t('salvarPrograma')"
        :desabilitado="faltaPrograma.length > 0"
        data-testid="prog-salvar"
      />
    </form>

    <template v-if="programa">
      <p class="programas__ajuda" data-testid="programa-resumo">
        {{ TIPOS_PROGRAMA[programa.tipo as keyof typeof TIPOS_PROGRAMA] ?? programa.tipo }} ·
        {{ t('desde', { data: dataBr(programa.vigenciaInicio) }) }} ·
        {{ t('participantesAtivos', { n: programa.participantesAtivos }) }}
        <template v-if="programa.registradoAns">
          · {{ t('registroAns', { numero: programa.numeroRegistroAns }) }}</template
        >
        <template v-if="programa.grupoRiscoDescricao">
          · {{ t('grupoRiscoDe', { grupo: programa.grupoRiscoDescricao }) }}</template
        >
      </p>
      <nav class="programas__linha" :aria-label="t('titulo')">
        <SanteBotao
          v-for="valor in ['elegiveis', 'participantes', 'agenda', 'resultado', 'criterios'] as const"
          :key="valor"
          :rotulo="t(`abas.${valor}`)"
          :variante="aba === valor ? 'primario' : 'secundario'"
          :aria-pressed="aba === valor"
          :data-testid="`aba-${valor}`"
          @click="aba = valor"
        />
      </nav>

      <!-- Elegíveis -->
      <div v-if="aba === 'elegiveis'" class="programas__painel" data-testid="painel-elegiveis">
        <p v-if="!elegiveis.length" data-testid="elegiveis-vazio">
          {{ t('elegiveisVazio') }}
        </p>
        <table v-else class="programas__tabela">
          <caption>
            {{
              t('elegiveisLegenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('col.beneficiario') }}</th>
              <th scope="col">{{ t('col.idade') }}</th>
              <th scope="col">{{ t('col.motivo') }}</th>
              <th scope="col">{{ t('col.acao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in elegiveis" :key="e.beneficiario" :data-testid="`elegivel-${e.beneficiario}`">
              <td>
                {{ e.nome }} <small>{{ e.matricula }}</small>
              </td>
              <td>{{ e.idade ?? '—' }}</td>
              <td>{{ e.motivos.join('; ') }}</td>
              <td>
                <SanteBotao
                  v-if="podeRegistrar"
                  :rotulo="t('incluir')"
                  variante="secundario"
                  :data-testid="`elegivel-incluir-${e.beneficiario}`"
                  @click="incluir(e)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Participantes -->
      <div v-if="aba === 'participantes'" class="programas__painel" data-testid="painel-participantes">
        <table class="programas__tabela">
          <caption>
            {{
              t('participantesLegenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('col.beneficiario') }}</th>
              <th scope="col">{{ t('col.entrada') }}</th>
              <th scope="col">{{ t('col.risco') }}</th>
              <th scope="col">{{ t('col.proximoContato') }}</th>
              <th scope="col">{{ t('col.situacao') }}</th>
              <th scope="col">{{ t('col.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in participantes" :key="p.id" :data-testid="`participante-${p.id}`">
              <td>
                <button
                  type="button"
                  class="programas__link"
                  :data-testid="`participante-visao-${p.id}`"
                  @click="abrirVisao(p)"
                >
                  {{ p.nome }}
                </button>
                <small>{{ p.matricula }}</small>
              </td>
              <td>{{ dataBr(p.entrada) }}</td>
              <td :data-testid="`participante-risco-${p.id}`">{{ risco(p.ultimaClassificacao) }}</td>
              <td>{{ instanteBr(p.proximoContato) }}</td>
              <td>
                {{ p.situacao === 'encerrado' ? t('encerradoEm', { data: dataBr(p.saida) }) : p.situacao }}
              </td>
              <td class="programas__linha">
                <template v-if="podeRegistrar && p.situacao === 'ativo'">
                  <SanteBotao
                    :rotulo="t('contato')"
                    variante="secundario"
                    :data-testid="`participante-contato-${p.id}`"
                    @click="abrir(p, 'contato')"
                  />
                  <SanteBotao
                    :rotulo="t('avaliarRisco')"
                    variante="secundario"
                    :data-testid="`participante-avaliar-${p.id}`"
                    @click="abrir(p, 'avaliacao')"
                  />
                  <SanteBotao
                    :rotulo="t('encerrar')"
                    variante="secundario"
                    :data-testid="`participante-encerrar-${p.id}`"
                    @click="abrir(p, 'saida')"
                  />
                </template>
              </td>
            </tr>
          </tbody>
        </table>

        <form
          v-if="escolhido && acao === 'contato'"
          class="programas__cartao"
          data-testid="form-contato"
          @submit.prevent="salvarContato"
        >
          <h2>{{ t('contatoCom', { nome: escolhido.nome }) }}</h2>
          <div class="programas__linha">
            <SanteSelecao
              id="contato-tipo"
              v-model="contato.tipo"
              :rotulo="t('tipo')"
              :opcoes="opcoes(TIPOS_CONTATO)"
              data-testid="contato-tipo"
            />
            <SanteSelecao
              id="contato-feito"
              v-model="contato.feito"
              :rotulo="t('situacao')"
              :opcoes="[
                { valor: 'agendado', rotulo: t('agendar') },
                { valor: 'realizado', rotulo: t('jaRealizado') },
              ]"
              data-testid="contato-feito"
            />
            <SanteCampoTexto
              id="contato-quando"
              v-model="contato.quando"
              :max-bytes="16"
              :rotulo="t('quando')"
              data-testid="contato-quando"
            />
          </div>
          <SanteCampoTexto
            id="contato-resultado"
            v-model="contato.resultado"
            :max-bytes="4000"
            :rotulo="t('resultadoOrientacao')"
            data-testid="contato-resultado"
          />
          <p v-if="faltaContato.length" class="programas__erro" data-testid="contato-falta">
            {{ t('falta', { itens: faltaContato.join(', ') }) }}
          </p>
          <SanteBotao
            tipo="submit"
            :rotulo="t('salvarContato')"
            :desabilitado="faltaContato.length > 0"
            data-testid="contato-salvar"
          />
        </form>

        <form
          v-if="escolhido && acao === 'avaliacao'"
          class="programas__cartao"
          data-testid="form-avaliacao"
          @submit.prevent="salvarAvaliacao"
        >
          <h2>{{ t('avaliacaoDe', { nome: escolhido.nome }) }}</h2>
          <SanteSelecao
            id="avaliacao-questionario"
            v-model="questionarioId"
            :rotulo="t('questionario')"
            :opcoes="
              questionarios.map((x) => ({
                valor: x.id,
                rotulo: t('questionarioVersao', { nome: x.nome, versao: x.numeroVersao }),
              }))
            "
            data-testid="avaliacao-questionario"
          />
          <template v-if="questionario">
            <div v-for="p in questionario.perguntas" :key="p.id" class="programas__linha">
              <SanteSelecao
                v-if="['sim_nao', 'escolha_unica'].includes(p.tipoResposta)"
                :id="`avaliacao-p${p.id}`"
                :model-value="respostas[p.id] ?? null"
                @update:model-value="(v: string | null) => (respostas[p.id] = v)"
                :rotulo="`${p.sequencia}. ${p.enunciado}`"
                :opcoes="opcoesPergunta(p)"
                :data-testid="`avaliacao-p${p.sequencia}`"
              />
              <SanteCampoTexto
                v-else
                :id="`avaliacao-p${p.id}`"
                :model-value="respostas[p.id] ?? ''"
                :max-bytes="4000"
                :rotulo="`${p.sequencia}. ${p.enunciado}`"
                :data-testid="`avaliacao-p${p.sequencia}`"
                @update:model-value="(v: string) => (respostas[p.id] = v)"
              />
            </div>
          </template>
          <p v-if="faltaAvaliacao.length" class="programas__erro" data-testid="avaliacao-falta">
            {{ t('falta', { itens: faltaAvaliacao.join(', ') }) }}
          </p>
          <SanteBotao
            tipo="submit"
            :rotulo="t('registrarAvaliacao')"
            :desabilitado="faltaAvaliacao.length > 0"
            data-testid="avaliacao-salvar"
          />
        </form>

        <form
          v-if="escolhido && acao === 'saida'"
          class="programas__cartao"
          data-testid="form-saida"
          @submit.prevent="salvarSaida"
        >
          <h2>{{ t('saidaDe', { nome: escolhido.nome }) }}</h2>
          <div class="programas__linha">
            <SanteCampoTexto
              id="saida-data"
              v-model="saida.data"
              :max-bytes="10"
              :rotulo="t('dataSaida')"
              data-testid="saida-data"
            />
            <SanteSelecao
              id="saida-motivo"
              v-model="saida.motivo"
              :rotulo="t('motivo')"
              :opcoes="opcoes(MOTIVOS_SAIDA)"
              data-testid="saida-motivo"
            />
          </div>
          <p v-if="faltaSaida.length" class="programas__erro" data-testid="saida-falta">
            {{ t('falta', { itens: faltaSaida.join(', ') }) }}
          </p>
          <SanteBotao
            tipo="submit"
            :rotulo="t('encerrarParticipacao')"
            :desabilitado="faltaSaida.length > 0"
            data-testid="saida-salvar"
          />
        </form>

        <div v-if="visao" class="programas__cartao" data-testid="visao-beneficiario">
          <h2>{{ t('visaoTitulo', { nome: visaoNome }) }}</h2>
          <ul>
            <li v-for="p in visao.participacoes" :key="p.id">
              {{
                t('visaoParticipacao', {
                  programa: p.programaNome,
                  entrada: dataBr(p.entrada),
                  situacao: p.situacao,
                  risco: risco(p.ultimaClassificacao).toLowerCase(),
                })
              }}
            </li>
          </ul>
          <ul>
            <li v-for="k in visao.contatos" :key="k.id">
              {{ TIPOS_CONTATO[k.tipo as keyof typeof TIPOS_CONTATO] ?? k.tipo }} ·
              {{ instanteBr(k.realizadoEm ?? k.agendadoPara) }} · {{ k.situacao.replace('_', ' ') }}
              <template v-if="k.resultado"> · {{ k.resultado }}</template>
            </li>
          </ul>
          <ul>
            <li v-for="a in visao.avaliacoes" :key="a.id">
              {{
                t('visaoAvaliacao', {
                  questionario: a.questionario,
                  quando: instanteBr(a.aplicadoEm),
                  escore: a.escore,
                  risco: risco(a.classificacao).toLowerCase(),
                })
              }}
            </li>
          </ul>
        </div>
      </div>

      <!-- Agenda -->
      <div v-if="aba === 'agenda'" class="programas__painel" data-testid="painel-agenda">
        <div
          v-for="chave in ['atrasados', 'hoje', 'proximos'] as const"
          :key="chave"
          class="programas__cartao"
          :data-testid="`agenda-${chave}`"
        >
          <h2>{{ t('agendaTitulo', { titulo: t(`agendaGrupos.${chave}`), n: agenda[chave].length }) }}</h2>
          <ul>
            <li
              v-for="k in agenda[chave]"
              :key="k.id"
              class="programas__linha"
              :data-testid="`agenda-item-${k.id}`"
            >
              <span
                >{{ instanteBr(k.agendadoPara) }} · {{ k.nome }} ·
                {{ TIPOS_CONTATO[k.tipo as keyof typeof TIPOS_CONTATO] ?? k.tipo }}</span
              >
              <template v-if="podeRegistrar">
                <SanteBotao
                  :rotulo="t('realizado')"
                  variante="secundario"
                  :data-testid="`agenda-realizado-${k.id}`"
                  @click="baixar(k, 'realizado')"
                />
                <SanteBotao
                  :rotulo="t('naoLocalizado')"
                  variante="secundario"
                  :data-testid="`agenda-nao-localizado-${k.id}`"
                  @click="baixar(k, 'nao_localizado')"
                />
                <SanteBotao
                  :rotulo="t('cancelar')"
                  variante="secundario"
                  :data-testid="`agenda-cancelar-${k.id}`"
                  @click="baixar(k, 'cancelado')"
                />
              </template>
            </li>
          </ul>
        </div>
      </div>

      <!-- Custo e bonificação -->
      <div v-if="aba === 'resultado'" class="programas__painel" data-testid="painel-resultado">
        <p v-if="custo" data-testid="custo-resumo">
          {{
            t('custoResumo', {
              janela: custo.janela,
              antes: moeda(custo.antes),
              depois: moeda(custo.depois),
              variacao: pct(custo.variacaoPercentual),
            })
          }}
        </p>
        <table v-if="custo?.participantes.length" class="programas__tabela">
          <caption>
            {{
              t('custoLegenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('col.participante') }}</th>
              <th scope="col">{{ t('col.entrada') }}</th>
              <th scope="col">{{ t('col.mediaAntes') }}</th>
              <th scope="col">{{ t('col.mediaDepois') }}</th>
              <th scope="col">{{ t('col.variacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in custo.participantes" :key="p.participante">
              <td>{{ p.nome }}</td>
              <td>{{ dataBr(p.entrada) }}</td>
              <td>
                {{
                  t('mediaPeriodo', {
                    media: moeda(p.antes.media),
                    total: moeda(p.antes.total),
                    meses: p.antes.meses,
                  })
                }}
              </td>
              <td>
                {{
                  t('mediaPeriodo', {
                    media: moeda(p.depois.media),
                    total: moeda(p.depois.total),
                    meses: p.depois.meses,
                  })
                }}
              </td>
              <td>{{ pct(p.variacaoPercentual) }}</td>
            </tr>
          </tbody>
        </table>
        <table v-if="bonificacao.length" class="programas__tabela" data-testid="tabela-bonificacao">
          <caption>
            {{
              t('bonificacaoLegenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('col.participante') }}</th>
              <th scope="col">{{ t('col.adesao') }}</th>
              <th scope="col">{{ t('col.bonificacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in bonificacao" :key="b.participante" :data-testid="`bonificacao-${b.participante}`">
              <td>{{ b.nome }}</td>
              <td>
                {{
                  t('adesao', {
                    realizados: b.adesao.realizados,
                    devidos: b.adesao.devidos,
                    percentual: pct(b.adesao.percentual),
                  })
                }}
              </td>
              <td>
                <span v-for="x in b.bonificacoes" :key="x.codigo">
                  {{
                    t(x.direito ? 'comDireito' : 'semDireito', { descricao: x.descricao, motivo: x.motivo })
                  }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Critérios -->
      <div v-if="aba === 'criterios'" class="programas__painel" data-testid="painel-criterios">
        <ul>
          <li
            v-for="k in programa.criterios"
            :key="k.id"
            class="programas__linha"
            :data-testid="`criterio-${k.id}`"
          >
            <span>{{ descreverCriterio(k) }}{{ k.ativo ? '' : t('inativo') }}</span>
            <SanteBotao
              v-if="podeConfigurar && k.ativo"
              :rotulo="t('desativar')"
              variante="secundario"
              :data-testid="`criterio-desativar-${k.id}`"
              @click="desativar(k.id, k.versao)"
            />
          </li>
        </ul>
        <form
          v-if="podeConfigurar"
          class="programas__cartao"
          data-testid="form-criterio"
          @submit.prevent="salvarCriterio"
        >
          <div class="programas__linha">
            <SanteSelecao
              id="crit-tipo"
              v-model="crit.tipo"
              :rotulo="t('criterio')"
              :opcoes="opcoes(TIPOS_CRITERIO)"
              data-testid="crit-tipo"
            />
            <SanteCampoTexto
              v-if="crit.tipo === 'cid' || crit.tipo === 'procedimento'"
              id="crit-termo"
              v-model="crit.termo"
              :max-bytes="20"
              :rotulo="t('termo')"
              data-testid="crit-termo"
            />
            <SanteCampoTexto
              v-if="crit.tipo === 'idade'"
              id="crit-idade-min"
              v-model="crit.idadeMin"
              :max-bytes="3"
              :rotulo="t('idadeMin')"
              data-testid="crit-idade-min"
            />
            <SanteCampoTexto
              v-if="crit.tipo === 'idade'"
              id="crit-idade-max"
              v-model="crit.idadeMax"
              :max-bytes="3"
              :rotulo="t('idadeMax')"
              data-testid="crit-idade-max"
            />
            <SanteCampoTexto
              v-if="crit.tipo === 'custo'"
              id="crit-custo"
              v-model="crit.custo"
              :max-bytes="20"
              :rotulo="t('custoMinimo')"
              data-testid="crit-custo"
            />
            <SanteCampoTexto
              v-if="crit.tipo === 'escore'"
              id="crit-escore"
              v-model="crit.escore"
              :max-bytes="10"
              :rotulo="t('escoreMinimo')"
              data-testid="crit-escore"
            />
            <SanteCampoTexto
              v-if="['cid', 'procedimento', 'internacao', 'pronto_socorro'].includes(crit.tipo ?? '')"
              id="crit-ocorrencias"
              v-model="crit.ocorrencias"
              :max-bytes="3"
              :rotulo="t('ocorrencias')"
              data-testid="crit-ocorrencias"
            />
            <SanteCampoTexto
              v-if="
                ['cid', 'procedimento', 'internacao', 'pronto_socorro', 'custo'].includes(crit.tipo ?? '')
              "
              id="crit-periodo"
              v-model="crit.periodo"
              :max-bytes="2"
              :rotulo="t('janela')"
              data-testid="crit-periodo"
            />
            <SanteSelecao
              id="crit-forma"
              v-model="crit.forma"
              :rotulo="t('aoEncontrar')"
              :opcoes="[
                { valor: 'sugerir', rotulo: t('formas.sugerir') },
                { valor: 'apenas_alertar', rotulo: t('formas.apenas_alertar') },
                { valor: 'incluir_automaticamente', rotulo: t('formas.incluir_automaticamente') },
              ]"
              data-testid="crit-forma"
            />
          </div>
          <p v-if="faltaCriterio.length" class="programas__erro" data-testid="crit-falta">
            {{ t('falta', { itens: faltaCriterio.join(', ') }) }}
          </p>
          <SanteBotao
            tipo="submit"
            :rotulo="t('incluirCriterio')"
            :desabilitado="faltaCriterio.length > 0"
            data-testid="crit-salvar"
          />
        </form>
      </div>
    </template>
  </section>
</template>

<style scoped>
.programas,
.programas__painel {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.programas__linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.programas__ajuda {
  color: var(--sgh-texto-secundario);
}
.programas__erro {
  color: var(--sgh-alerta);
}
.programas__cartao {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
.programas__tabela {
  width: 100%;
  border-collapse: collapse;
}
.programas__tabela th,
.programas__tabela td {
  padding: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda);
  text-align: left;
}
.programas__link {
  background: none;
  border: none;
  padding: 0;
  color: var(--sgh-link);
  text-decoration: underline;
  cursor: pointer;
}
</style>
