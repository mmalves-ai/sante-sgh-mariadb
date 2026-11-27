<script setup lang="ts">
// Declaração de saúde, doença ou lesão preexistente (DLP) com a cobertura parcial temporária (CPT), portabilidade de
// carências e cartão do beneficiário da operadora (08-SGO L95, C2-113; RN ANS 162/2007 e 438/2018). Visão por
// beneficiário: a matrícula abre de uma vez as carências (com a portabilidade que as aproveitou), as declarações, as
// doenças com a decisão na própria linha, as CPTs com o fim calculado, os pedidos de portabilidade com o prazo de
// resposta de 10 dias e os pedidos de cartão. A falta aparece enquanto se digita, pelas regras do domínio; o servidor
// confere de novo. Nada é apagado: CPT e portabilidade se encerram ou se recusam com motivo.
import {
  PARTICIPANTES_SEM_CPT,
  permanenciaMinimaMeses,
  planoDaCpt,
  problemasDaDecisaoDlp,
  problemasDaDeclaracaoSaude,
  problemasDaPortabilidade,
  problemasDoEncerramentoCpt,
} from '@sgh/dominio-operadora';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import {
  avancarPedidoCartao,
  buscarBeneficiario,
  buscarCids,
  CANAIS_CARTAO,
  type CidAchado,
  DECISOES_DOENCA,
  decidirDoenca,
  decidirPortabilidade,
  DIRECOES,
  encerrarCpt,
  FORMAS_IDENTIFICACAO,
  lerPainelSaude,
  lerQuestionariosDeclaracao,
  MODALIDADES,
  type PainelSaude,
  type QuestionarioDeclaracao,
  registrarDeclaracao,
  registrarPortabilidade,
  SITUACOES_CPT,
  SITUACOES_DECLARACAO,
  SITUACOES_PORTABILIDADE,
  solicitarCartao,
} from '../api-saude-beneficiario.js';

type Aba = 'carencias' | 'declaracao' | 'cpt' | 'portabilidade' | 'cartao';
const { t } = useI18n();
const ABAS = computed<Record<Aba, string>>(() => ({
  carencias: t('saudeBeneficiario.abaCarencias'),
  declaracao: t('saudeBeneficiario.abaDeclaracao'),
  cpt: t('saudeBeneficiario.abaCpt'),
  portabilidade: t('saudeBeneficiario.abaPortabilidade'),
  cartao: t('saudeBeneficiario.abaCartao'),
}));
// Frases montadas com parâmetros (a contagem, a data e a situação vêm do painel).
const x = {
  matricula: (m: string) => t('saudeBeneficiario.xMatricula', { m }),
  situacaoAdesao: (situacao: string, adesao: string) =>
    t('saudeBeneficiario.xSituacaoAdesao', { situacao, adesao }),
  contratacao: (tipo: string, participantes: number) =>
    t('saudeBeneficiario.xContratacao', { tipo, participantes }),
  contagens: (vigentes: number, analise: number) => t('saudeBeneficiario.xContagens', { vigentes, analise }),
  doenca: (inicio: string, forma: string, decisao: string, agravo: number | null) =>
    agravo === null
      ? t('saudeBeneficiario.xDoenca', { inicio, forma, decisao })
      : t('saudeBeneficiario.xDoencaAgravo', { inicio, forma, decisao, agravo }),
  fimCpt: (fim: string) => t('saudeBeneficiario.xFimCpt', { fim }),
  cpt: (cid: string, situacao: string, vigente: boolean) =>
    t(vigente ? 'saudeBeneficiario.xCptVigente' : 'saudeBeneficiario.xCpt', { cid, situacao }),
  periodoCpt: (inicio: string, fim: string, meses: number, encerrada: string | null) =>
    encerrada === null
      ? t('saudeBeneficiario.xPeriodoCpt', { inicio, fim, meses })
      : t('saudeBeneficiario.xPeriodoCptEncerrada', { inicio, fim, meses, encerrada }),
  pedidoPortabilidade: (
    registro: string,
    nome: string,
    pedido: string,
    prazo: string,
    vencida: boolean,
    recusa: string | null,
  ) =>
    [
      t('saudeBeneficiario.xPedidoPortabilidade', { registro, nome: nome || '—', pedido, prazo }),
      vencida ? t('saudeBeneficiario.xPrazoVencido') : '',
      recusa ? t('saudeBeneficiario.xRecusa', { motivo: recusa }) : '',
    ]
      .filter(Boolean)
      .join(' '),
  permanencia: (meses: number) => t('saudeBeneficiario.xPermanencia', { meses }),
};
const aba = ref<Aba>('carencias');
const podeEditar = computed(() => pode('operadora.beneficiario.editar'));
const erro = ref<string | null>(null);
const aviso = ref<string | null>(null);
const hoje = new Date().toISOString().slice(0, 10);
const opcoes = (m: Record<string, string>) => Object.entries(m).map(([valor, rotulo]) => ({ valor, rotulo }));
const SIM_NAO = computed(() => [
  { valor: 'sim', rotulo: t('saudeBeneficiario.sim') },
  { valor: 'nao', rotulo: t('saudeBeneficiario.nao') },
]);
const rotulo = (m: Record<string, string>, v: string) => m[v] ?? v;
const dataBr = (v: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '—');
const numeroBr = (v: string): number | null => {
  const t = v.trim().replace(/\./g, '').replace(',', '.');
  if (!t) return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
};
const textoOuNulo = (v: string) => (v.trim() ? v.trim() : null);
const mensagem = (e: unknown) => (e instanceof Error ? e.message : t('saudeBeneficiario.falhaInesperada'));

async function acao(fn: () => Promise<unknown>, ok: string): Promise<void> {
  erro.value = null;
  aviso.value = null;
  try {
    await fn();
    aviso.value = ok;
    await recarregar();
  } catch (e) {
    erro.value = mensagem(e);
  }
}

// ---- busca e painel ----
const matricula = ref('');
const painel = ref<PainelSaude | null>(null);
const questionarios = ref<QuestionarioDeclaracao[]>([]);
async function abrir(): Promise<void> {
  erro.value = null;
  aviso.value = null;
  painel.value = null;
  try {
    const achados = await buscarBeneficiario(matricula.value.trim());
    if (!achados.length) {
      erro.value = t('saudeBeneficiario.nenhumBeneficiario');
      return;
    }
    painel.value = await lerPainelSaude(achados[0]!.id);
    if (!questionarios.value.length) questionarios.value = await lerQuestionariosDeclaracao();
  } catch (e) {
    erro.value = mensagem(e);
  }
}
async function recarregar(): Promise<void> {
  if (painel.value) painel.value = await lerPainelSaude(painel.value.beneficiario.id);
}
const ben = computed(() => painel.value?.beneficiario ?? null);
const soSemRestricao = computed(
  () =>
    ben.value?.tipoContratacao === 'coletivo_empresarial' &&
    ben.value.participantesNoContrato >= PARTICIPANTES_SEM_CPT,
);
const cptsVigentes = computed(() => painel.value?.cpts.filter((c) => c.vigenteHoje).length ?? 0);
const emAnalise = computed(() => painel.value?.doencas.filter((d) => d.decisao === 'em_analise').length ?? 0);

// ---- declaração ----
const dec = reactive({
  questionario: null as number | null,
  preenchidaEm: hoje as string | null,
  peso: '',
  altura: '',
  entrevista: 'nao',
  medico: '',
  dispensou: 'sim',
});
const respostas = reactive<Record<number, { afirmativa: string; complemento: string }>>({});
const doencas = ref<
  { termo: number; codigo: string; descricao: string; inicio: string | null; forma: string }[]
>([]);
const questionario = computed(() => questionarios.value.find((q) => q.id === dec.questionario) ?? null);
const opcoesQuestionario = computed(() => questionarios.value.map((q) => ({ valor: q.id, rotulo: q.nome })));
watch(questionario, (q) => {
  for (const k of Object.keys(respostas)) delete respostas[Number(k)];
  for (const p of q?.perguntas ?? []) respostas[p.id] = { afirmativa: '', complemento: '' };
});
const respostasSim = computed(() => Object.values(respostas).filter((r) => r.afirmativa === 'sim').length);
const corpoDeclaracao = computed(() => ({
  questionario: dec.questionario ?? 0,
  preenchidaEm: dec.preenchidaEm ?? '',
  pesoKg: numeroBr(dec.peso),
  alturaM: numeroBr(dec.altura),
  entrevistaQualificada: dec.entrevista === 'sim',
  medicoOrientador: dec.entrevista === 'sim' ? numeroBr(dec.medico) : null,
  dispensouOrientacao: dec.entrevista !== 'sim' && dec.dispensou === 'sim',
  respostas: Object.entries(respostas)
    .filter(([, r]) => r.afirmativa !== '')
    .map(([p, r]) => ({
      pergunta: Number(p),
      afirmativa: r.afirmativa === 'sim',
      texto: null,
      complemento: textoOuNulo(r.complemento),
    })),
  doencas: doencas.value.map((d) => ({ termo: d.termo, inicio: d.inicio ?? '', forma: d.forma })),
}));
const faltaDeclaracao = computed(() => {
  const q = questionario.value;
  if (!q) return [t('saudeBeneficiario.escolhaQuestionario')];
  const r = problemasDaDeclaracaoSaude({
    ...corpoDeclaracao.value,
    hoje,
    obrigatorias: q.perguntas.filter((p) => p.obrigatoria).map((p) => p.id),
    perguntas: q.perguntas.map((p) => p.id),
  }).map((x) => x.detalhe);
  for (const [p, x] of Object.entries(respostas))
    if (x.afirmativa === 'sim' && !x.complemento.trim()) {
      const e = q.perguntas.find((y) => y.id === Number(p));
      r.push(t('saudeBeneficiario.detalheResposta', { pergunta: e?.sequencia ?? p }));
    }
  if (respostasSim.value > 0 && !doencas.value.length) r.push(t('saudeBeneficiario.simPedeDoenca'));
  return [...new Set(r)];
});
const buscaCid = ref('');
const cidsAchados = ref<CidAchado[]>([]);
async function procurarCid(): Promise<void> {
  if (buscaCid.value.trim().length < 2) return;
  try {
    cidsAchados.value = await buscarCids(buscaCid.value.trim());
  } catch (e) {
    erro.value = mensagem(e);
  }
}
function incluirDoenca(c: CidAchado): void {
  if (!doencas.value.some((d) => d.termo === c.id))
    doencas.value.push({
      termo: c.id,
      codigo: c.codigo,
      descricao: c.descricao,
      inicio: null,
      forma: 'declarada',
    });
  cidsAchados.value = [];
  buscaCid.value = '';
}
async function salvarDeclaracao(): Promise<void> {
  if (!ben.value || faltaDeclaracao.value.length) return;
  const b = ben.value.id;
  await acao(
    () => registrarDeclaracao(b, corpoDeclaracao.value),
    t('saudeBeneficiario.declaracaoRegistrada'),
  );
  if (!erro.value) {
    doencas.value = [];
    dec.questionario = null;
    aba.value = 'cpt';
  }
}

// ---- decisão da doença e encerramento da CPT ----
const decisoes = reactive<
  Record<number, { decisao: string; prazo: string; percentual: string; observacao: string }>
>({});
const decisaoDe = (id: number) =>
  (decisoes[id] ??= {
    decisao: soSemRestricao.value ? 'sem_restricao' : '',
    prazo: '24',
    percentual: '',
    observacao: '',
  });
const opcoesDecisao = computed(() =>
  opcoes(DECISOES_DOENCA)
    .filter((o) => o.valor !== 'em_analise')
    .map((o) => ({ ...o, desabilitada: soSemRestricao.value && o.valor !== 'sem_restricao' })),
);
function faltaDecisao(id: number, decisaoAtual: string): string[] {
  const x = decisaoDe(id);
  if (!ben.value) return [];
  return problemasDaDecisaoDlp({
    decisaoAtual,
    decisao: x.decisao,
    prazoMeses: x.decisao === 'cobertura_parcial_temporaria' ? numeroBr(x.prazo) : null,
    percentualAgravo: x.decisao === 'agravo' ? numeroBr(x.percentual) : null,
    adesao: ben.value.adesao ?? '',
    hoje,
    tipoContratacao: ben.value.tipoContratacao ?? '',
    participantesNoContrato: ben.value.participantesNoContrato,
  }).map((p) => p.detalhe);
}
function fimDaCpt(id: number): string | null {
  const x = decisaoDe(id);
  const m = numeroBr(x.prazo);
  if (x.decisao !== 'cobertura_parcial_temporaria' || !ben.value?.adesao || !m || m < 1 || m > 24)
    return null;
  return planoDaCpt(ben.value.adesao, m).fimPrevisto;
}
async function salvarDecisao(id: number, versao: number, atual: string): Promise<void> {
  if (faltaDecisao(id, atual).length) return;
  const x = decisaoDe(id);
  await acao(
    () =>
      decidirDoenca(id, {
        versao,
        decisao: x.decisao,
        prazoMeses: x.decisao === 'cobertura_parcial_temporaria' ? numeroBr(x.prazo) : null,
        percentualAgravo: x.decisao === 'agravo' ? numeroBr(x.percentual) : null,
        observacao: textoOuNulo(x.observacao),
      }),
    t('saudeBeneficiario.decisaoRegistrada'),
  );
}
const encerramentos = reactive<Record<number, { situacao: string; data: string | null; motivo: string }>>({});
const encerramentoDe = (id: number) =>
  (encerramentos[id] ??= { situacao: 'encerrada', data: hoje, motivo: '' });
function faltaEncerramento(id: number, situacao: string, inicio: string): string[] {
  const x = encerramentoDe(id);
  return problemasDoEncerramentoCpt({ situacao, inicio, data: x.data ?? '', motivo: x.motivo }).map(
    (p) => p.detalhe,
  );
}
async function salvarEncerramento(
  id: number,
  versao: number,
  situacao: string,
  inicio: string,
): Promise<void> {
  if (faltaEncerramento(id, situacao, inicio).length) return;
  const x = encerramentoDe(id);
  await acao(
    () =>
      encerrarCpt(id, {
        versao,
        situacao: x.situacao === 'cancelada' ? 'cancelada' : 'encerrada',
        data: x.data ?? hoje,
        motivo: x.motivo.trim(),
      }),
    t('saudeBeneficiario.cptEncerrada'),
  );
}

// ---- portabilidade ----
const port = reactive({
  direcao: 'recebida',
  modalidade: 'ordinaria',
  registro: '',
  nome: '',
  produto: '',
  vinculo: null as string | null,
  faixa: 'sim',
  adimplente: 'sim',
  solicitado: hoje as string | null,
  observacao: '',
});
const faltaPortabilidade = computed(() =>
  problemasDaPortabilidade({
    direcao: port.direcao,
    modalidade: port.modalidade,
    registroAnsOrigem: port.registro.trim(),
    vinculoInicio: port.vinculo,
    solicitadoEm: port.solicitado ?? '',
    hoje,
  }).map((p) => p.detalhe),
);
async function salvarPortabilidade(): Promise<void> {
  if (!ben.value || faltaPortabilidade.value.length) return;
  const b = ben.value.id;
  await acao(
    () =>
      registrarPortabilidade(b, {
        direcao: port.direcao,
        modalidade: port.modalidade,
        registroAnsOrigem: port.registro.trim(),
        nomeOperadoraOrigem: textoOuNulo(port.nome),
        registroProdutoOrigem: textoOuNulo(port.produto),
        vinculoInicio: port.vinculo,
        faixaPrecoCompativel: port.faixa === 'sim',
        adimplente: port.adimplente === 'sim',
        solicitadoEm: port.solicitado ?? hoje,
        observacao: textoOuNulo(port.observacao),
      }),
    t('saudeBeneficiario.portabilidadeRegistrada'),
  );
}
const passosPortabilidade = reactive<
  Record<number, { situacao: string; motivo: string; cumpriuCpt: string; jaPortou: string }>
>({});
const passoDe = (id: number) =>
  (passosPortabilidade[id] ??= { situacao: '', motivo: '', cumpriuCpt: 'nao', jaPortou: 'nao' });
const PROXIMAS: Record<string, string[]> = {
  recebida: ['em_analise', 'aprovada', 'recusada', 'cancelada'],
  em_analise: ['aprovada', 'recusada', 'cancelada'],
};
const opcoesPasso = (atual: string) =>
  (PROXIMAS[atual] ?? []).map((v) => ({ valor: v, rotulo: rotulo(SITUACOES_PORTABILIDADE, v) }));
function faltaPasso(id: number): string[] {
  const x = passoDe(id);
  if (!x.situacao) return [t('saudeBeneficiario.escolhaPasso')];
  if (x.situacao === 'recusada' && !x.motivo.trim()) return [t('saudeBeneficiario.recusaPedeMotivo')];
  return [];
}
const permanencia = (id: number) =>
  permanenciaMinimaMeses({
    cumpriuCptNaOrigem: passoDe(id).cumpriuCpt === 'sim',
    jaPortouAntes: passoDe(id).jaPortou === 'sim',
  });
async function salvarPasso(id: number, versao: number): Promise<void> {
  if (faltaPasso(id).length) return;
  const x = passoDe(id);
  await acao(
    () =>
      decidirPortabilidade(id, {
        versao,
        situacao: x.situacao,
        motivoRecusa: x.situacao === 'recusada' ? x.motivo.trim() : null,
        cumpriuCptNaOrigem: x.cumpriuCpt === 'sim',
        jaPortouAntes: x.jaPortou === 'sim',
      }),
    x.situacao === 'aprovada'
      ? t('saudeBeneficiario.portabilidadeAprovada')
      : t('saudeBeneficiario.passoRegistrado'),
  );
}

// ---- cartão ----
const cartao = reactive({ primeiraVia: 'nao', canal: 'balcao', observacao: '' });
async function pedirCartao(): Promise<void> {
  if (!ben.value) return;
  const b = ben.value.id;
  await acao(
    () =>
      solicitarCartao(b, {
        primeiraVia: cartao.primeiraVia === 'sim',
        motivo: null,
        canal: cartao.canal,
        observacao: textoOuNulo(cartao.observacao),
      }),
    t('saudeBeneficiario.cartaoRegistrado'),
  );
}
const numeroPortabilidade = (id: number | null) =>
  id === null ? '—' : (painel.value?.portabilidades.find((p) => p.id === id)?.numero ?? '—');
const PROXIMO_CARTAO: Record<string, 'emitido' | 'entregue'> = { solicitado: 'emitido', emitido: 'entregue' };
</script>

<template>
  <section class="saude" aria-labelledby="saude-titulo" data-testid="tela-saude-beneficiario">
    <h1 id="saude-titulo">{{ t('saudeBeneficiario.declaracaoDeSaudeCpt') }}</h1>
    <p class="saude__ajuda">
      {{ t('saudeBeneficiario.doencaOuLesaoPreexistente') }}
    </p>
    <RouterLink to="/operadora/beneficiarios" data-testid="link-beneficiarios">{{
      t('saudeBeneficiario.voltarAosBeneficiarios')
    }}</RouterLink>
    <SanteAlerta v-if="erro" :texto="erro" variante="alerta" anunciar data-testid="saude-erro" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="saude-aviso" />

    <form class="saude__linha" data-testid="form-busca" @submit.prevent="abrir">
      <SanteCampoTexto
        id="saude-matricula"
        v-model="matricula"
        :max-bytes="40"
        :rotulo="t('saudeBeneficiario.matriculaDoBeneficiario')"
        data-testid="saude-matricula"
      />
      <SanteBotao
        :rotulo="t('saudeBeneficiario.abrir')"
        tipo="submit"
        :desabilitado="!matricula.trim()"
        data-testid="saude-abrir"
      />
    </form>

    <template v-if="painel && ben">
      <div class="saude__cartao" data-testid="saude-resumo">
        <strong>{{ x.matricula(ben.matricula) }}</strong>
        <span>{{ x.situacaoAdesao(ben.situacao, dataBr(ben.adesao)) }}</span>
        <span>{{ x.contratacao(ben.tipoContratacao ?? '—', ben.participantesNoContrato) }}</span>
        <span>{{ x.contagens(cptsVigentes, emAnalise) }}</span>
        <SanteAlerta
          v-if="soSemRestricao"
          variante="info"
          :texto="`Coletivo empresarial com ${PARTICIPANTES_SEM_CPT} ou mais participantes: não cabe CPT nem agravo.`"
          data-testid="saude-so-sem-restricao"
        />
      </div>

      <div class="saude__linha" role="tablist">
        <SanteBotao
          v-for="(r, k) in ABAS"
          :key="k"
          :rotulo="r"
          role="tab"
          :aria-selected="aba === k"
          :variante="aba === k ? 'primario' : 'secundario'"
          :data-testid="`aba-${k}`"
          @click="aba = k"
        />
      </div>

      <div v-if="aba === 'carencias'" class="saude__painel" data-testid="painel-carencias">
        <p v-if="!painel.carencias.length" class="saude__ajuda">
          {{ t('saudeBeneficiario.semCarenciasGeradas') }}
        </p>
        <table v-else class="saude__tabela">
          <thead>
            <tr>
              <th>{{ t('saudeBeneficiario.categoria') }}</th>
              <th>{{ t('saudeBeneficiario.dias') }}</th>
              <th>{{ t('saudeBeneficiario.aproveitados') }}</th>
              <th>{{ t('saudeBeneficiario.cumpridaEm') }}</th>
              <th>{{ t('saudeBeneficiario.portabilidade') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in painel.carencias" :key="c.id" :data-testid="`carencia-${c.id}`">
              <td>{{ c.categoria }}</td>
              <td>{{ c.dias }}</td>
              <td>{{ c.aproveitados }}</td>
              <td>{{ c.cumprida ? t('saudeBeneficiario.cumprida') : dataBr(c.cumpridaEm) }}</td>
              <td>
                {{ numeroPortabilidade(c.portabilidade) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="aba === 'declaracao'" class="saude__painel" data-testid="painel-declaracao">
        <table v-if="painel.declaracoes.length" class="saude__tabela">
          <thead>
            <tr>
              <th>{{ t('saudeBeneficiario.preenchidaEm') }}</th>
              <th>{{ t('saudeBeneficiario.situacao') }}</th>
              <th>{{ t('saudeBeneficiario.entrevistaQualificada') }}</th>
              <th>{{ t('saudeBeneficiario.imc') }}</th>
              <th>{{ t('saudeBeneficiario.respostasSim') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in painel.declaracoes" :key="d.id" :data-testid="`declaracao-${d.id}`">
              <td>{{ dataBr(d.preenchidaEm) }}</td>
              <td>{{ rotulo(SITUACOES_DECLARACAO, d.situacao) }}</td>
              <td>{{ d.entrevistaQualificada ? t('saudeBeneficiario.sim') : t('saudeBeneficiario.nao') }}</td>
              <td>{{ d.imc ?? '—' }}</td>
              <td>{{ d.respostasSim }}</td>
            </tr>
          </tbody>
        </table>
        <form
          v-if="podeEditar"
          class="saude__cartao"
          data-testid="form-declaracao"
          @submit.prevent="salvarDeclaracao"
        >
          <div class="saude__linha">
            <SanteSelecao
              id="dec-questionario"
              v-model="dec.questionario"
              :rotulo="t('saudeBeneficiario.questionario')"
              :opcoes="opcoesQuestionario"
              data-testid="dec-questionario"
            />
            <SanteData
              v-model="dec.preenchidaEm"
              editavel
              :maximo="hoje"
              :rotulo="t('saudeBeneficiario.preenchidaEm')"
              data-testid="dec-data"
            />
            <SanteCampoTexto
              id="dec-peso"
              v-model="dec.peso"
              :max-bytes="6"
              :rotulo="t('saudeBeneficiario.pesoKg')"
              data-testid="dec-peso"
            />
            <SanteCampoTexto
              id="dec-altura"
              v-model="dec.altura"
              :max-bytes="5"
              :rotulo="t('saudeBeneficiario.alturaM')"
              data-testid="dec-altura"
            />
          </div>
          <div class="saude__linha">
            <SanteSelecao
              id="dec-entrevista"
              v-model="dec.entrevista"
              :rotulo="t('saudeBeneficiario.entrevistaQualificada')"
              :opcoes="SIM_NAO"
              data-testid="dec-entrevista"
            />
            <SanteCampoTexto
              v-if="dec.entrevista === 'sim'"
              id="dec-medico"
              v-model="dec.medico"
              :max-bytes="12"
              :rotulo="t('saudeBeneficiario.medicoOrientadorCodigoDo')"
              data-testid="dec-medico"
            />
            <SanteSelecao
              v-else
              id="dec-dispensou"
              v-model="dec.dispensou"
              :rotulo="t('saudeBeneficiario.dispensouOMedicoOrientador')"
              :opcoes="SIM_NAO"
              data-testid="dec-dispensou"
            />
          </div>
          <div
            v-for="p in questionario?.perguntas ?? []"
            :key="p.id"
            class="saude__linha"
            :data-testid="`pergunta-${p.sequencia}`"
          >
            <SanteSelecao
              :id="`dec-resp-${p.id}`"
              v-model="respostas[p.id]!.afirmativa"
              :rotulo="`${p.sequencia}. ${p.enunciado}${p.obrigatoria ? ' *' : ''}`"
              :opcoes="[{ valor: '', rotulo: t('saudeBeneficiario.semResposta') }, ...SIM_NAO]"
              :data-testid="`resp-${p.sequencia}`"
            />
            <SanteCampoTexto
              v-if="respostas[p.id]!.afirmativa === 'sim'"
              :id="`dec-comp-${p.id}`"
              v-model="respostas[p.id]!.complemento"
              :max-bytes="2000"
              :rotulo="t('saudeBeneficiario.detalhe')"
              :data-testid="`resp-${p.sequencia}-detalhe`"
            />
          </div>
          <fieldset v-if="respostasSim > 0 || doencas.length" class="saude__cartao" data-testid="dec-doencas">
            <legend>{{ t('saudeBeneficiario.doencasDeclaradasCid10') }}</legend>
            <div class="saude__linha">
              <SanteCampoTexto
                id="dec-busca-cid"
                v-model="buscaCid"
                :max-bytes="80"
                :rotulo="t('saudeBeneficiario.codigoOuDescricaoDo')"
                data-testid="dec-busca-cid"
              />
              <SanteBotao
                :rotulo="t('saudeBeneficiario.procurar')"
                variante="secundario"
                :desabilitado="buscaCid.trim().length < 2"
                data-testid="dec-procurar-cid"
                @click="procurarCid"
              />
            </div>
            <ul v-if="cidsAchados.length" class="saude__lista" data-testid="dec-cids">
              <li v-for="c in cidsAchados" :key="c.id">
                <button
                  type="button"
                  class="saude__link"
                  :data-testid="`cid-${c.codigo}`"
                  @click="incluirDoenca(c)"
                >
                  {{ c.codigo }} · {{ c.descricao }}
                </button>
              </li>
            </ul>
            <div
              v-for="(d, i) in doencas"
              :key="d.termo"
              class="saude__linha"
              :data-testid="`doenca-nova-${d.codigo}`"
            >
              <strong>{{ d.codigo }} · {{ d.descricao }}</strong>
              <SanteData
                v-model="d.inicio"
                editavel
                :maximo="hoje"
                :rotulo="t('saudeBeneficiario.inicio')"
                :data-testid="`doenca-inicio-${d.codigo}`"
              />
              <SanteSelecao
                :id="`doenca-forma-${d.termo}`"
                v-model="d.forma"
                :rotulo="t('saudeBeneficiario.identificadaPor')"
                :opcoes="opcoes(FORMAS_IDENTIFICACAO)"
                :data-testid="`doenca-forma-${d.codigo}`"
              />
              <SanteBotao
                :rotulo="t('saudeBeneficiario.tirar')"
                variante="secundario"
                @click="doencas.splice(i, 1)"
              />
            </div>
          </fieldset>
          <ul v-if="faltaDeclaracao.length" class="saude__erro" data-testid="dec-falta">
            <li v-for="f in faltaDeclaracao" :key="f">{{ f }}</li>
          </ul>
          <SanteBotao
            :rotulo="t('saudeBeneficiario.registrarDeclaracao')"
            tipo="submit"
            :desabilitado="faltaDeclaracao.length > 0"
            data-testid="dec-salvar"
          />
        </form>
      </div>

      <div v-if="aba === 'cpt'" class="saude__painel" data-testid="painel-cpt">
        <h2>{{ t('saudeBeneficiario.doencasPreexistentes') }}</h2>
        <p v-if="!painel.doencas.length" class="saude__ajuda">
          {{ t('saudeBeneficiario.nenhumaDoencaDeclarada') }}
        </p>
        <div v-for="d in painel.doencas" :key="d.id" class="saude__cartao" :data-testid="`doenca-${d.cid}`">
          <strong>{{ d.cid }} · {{ d.descricao }}</strong>
          <span>
            {{
              x.doenca(
                dataBr(d.inicio),
                rotulo(FORMAS_IDENTIFICACAO, d.forma),
                rotulo(DECISOES_DOENCA, d.decisao),
                d.percentualAgravo,
              )
            }}
          </span>
          <template v-if="d.decisao === 'em_analise' && podeEditar">
            <div class="saude__linha">
              <SanteSelecao
                :id="`decisao-${d.id}`"
                v-model="decisaoDe(d.id).decisao"
                :rotulo="t('saudeBeneficiario.decisao')"
                :opcoes="opcoesDecisao"
                :data-testid="`decisao-${d.cid}`"
              />
              <SanteCampoTexto
                v-if="decisaoDe(d.id).decisao === 'cobertura_parcial_temporaria'"
                :id="`prazo-${d.id}`"
                v-model="decisaoDe(d.id).prazo"
                :max-bytes="2"
                :rotulo="t('saudeBeneficiario.prazoMesesAte24')"
                :data-testid="`prazo-${d.cid}`"
              />
              <SanteCampoTexto
                v-if="decisaoDe(d.id).decisao === 'agravo'"
                :id="`agravo-${d.id}`"
                v-model="decisaoDe(d.id).percentual"
                :max-bytes="6"
                :rotulo="t('saudeBeneficiario.agravo')"
                :data-testid="`agravo-${d.cid}`"
              />
              <SanteCampoTexto
                :id="`obs-${d.id}`"
                v-model="decisaoDe(d.id).observacao"
                :max-bytes="1000"
                :rotulo="t('saudeBeneficiario.observacao')"
              />
            </div>
            <span v-if="fimDaCpt(d.id)" :data-testid="`fim-cpt-${d.cid}`">
              {{ x.fimCpt(dataBr(fimDaCpt(d.id))) }}
            </span>
            <ul
              v-if="faltaDecisao(d.id, d.decisao).length"
              class="saude__erro"
              :data-testid="`decisao-falta-${d.cid}`"
            >
              <li v-for="f in faltaDecisao(d.id, d.decisao)" :key="f">{{ f }}</li>
            </ul>
            <SanteBotao
              :rotulo="t('saudeBeneficiario.registrarDecisao')"
              :desabilitado="faltaDecisao(d.id, d.decisao).length > 0"
              :data-testid="`decisao-salvar-${d.cid}`"
              @click="salvarDecisao(d.id, d.versao, d.decisao)"
            />
          </template>
        </div>
        <h2>{{ t('saudeBeneficiario.coberturasParciaisTemporarias') }}</h2>
        <p v-if="!painel.cpts.length" class="saude__ajuda">{{ t('saudeBeneficiario.nenhumaCpt') }}</p>
        <div v-for="c in painel.cpts" :key="c.id" class="saude__cartao" :data-testid="`cpt-${c.cid}`">
          <strong>{{ x.cpt(c.cid, rotulo(SITUACOES_CPT, c.situacao), c.vigenteHoje) }}</strong>
          <span>
            {{
              x.periodoCpt(
                dataBr(c.inicio),
                dataBr(c.fimPrevisto),
                c.prazoMeses,
                c.encerradaEm ? dataBr(c.encerradaEm) : null,
              )
            }}
          </span>
          <template v-if="c.situacao === 'vigente' && podeEditar">
            <div class="saude__linha">
              <SanteSelecao
                :id="`enc-sit-${c.id}`"
                v-model="encerramentoDe(c.id).situacao"
                :rotulo="t('saudeBeneficiario.encerrarComo')"
                :opcoes="[
                  { valor: 'encerrada', rotulo: t('saudeBeneficiario.encerrada') },
                  { valor: 'cancelada', rotulo: t('saudeBeneficiario.cancelada') },
                ]"
                :data-testid="`enc-sit-${c.cid}`"
              />
              <SanteData
                v-model="encerramentoDe(c.id).data"
                editavel
                :rotulo="t('saudeBeneficiario.data')"
                :data-testid="`enc-data-${c.cid}`"
              />
              <SanteCampoTexto
                :id="`enc-mot-${c.id}`"
                v-model="encerramentoDe(c.id).motivo"
                :max-bytes="500"
                :rotulo="t('saudeBeneficiario.motivo')"
                :data-testid="`enc-motivo-${c.cid}`"
              />
            </div>
            <ul v-if="faltaEncerramento(c.id, c.situacao, c.inicio).length" class="saude__erro">
              <li v-for="f in faltaEncerramento(c.id, c.situacao, c.inicio)" :key="f">{{ f }}</li>
            </ul>
            <SanteBotao
              :rotulo="t('saudeBeneficiario.encerrarCpt')"
              variante="secundario"
              :desabilitado="faltaEncerramento(c.id, c.situacao, c.inicio).length > 0"
              :data-testid="`enc-salvar-${c.cid}`"
              @click="salvarEncerramento(c.id, c.versao, c.situacao, c.inicio)"
            />
          </template>
        </div>
      </div>

      <div v-if="aba === 'portabilidade'" class="saude__painel" data-testid="painel-portabilidade">
        <div
          v-for="p in painel.portabilidades"
          :key="p.id"
          class="saude__cartao"
          :data-testid="`portabilidade-${p.numero}`"
        >
          <strong>
            {{ p.numero }} · {{ rotulo(DIRECOES, p.direcao) }} · {{ rotulo(MODALIDADES, p.modalidade) }} ·
            {{ rotulo(SITUACOES_PORTABILIDADE, p.situacao) }}
          </strong>
          <span>
            {{
              x.pedidoPortabilidade(
                p.registroAnsOrigem,
                p.nomeOperadoraOrigem ?? '',
                dataBr(p.solicitadoEm),
                dataBr(p.prazoResposta),
                p.vencida,
                p.motivoRecusa,
              )
            }}
          </span>
          <template v-if="opcoesPasso(p.situacao).length && podeEditar">
            <div class="saude__linha">
              <SanteSelecao
                :id="`passo-${p.id}`"
                v-model="passoDe(p.id).situacao"
                :rotulo="t('saudeBeneficiario.proximoPasso')"
                :opcoes="opcoesPasso(p.situacao)"
                :data-testid="`passo-${p.numero}`"
              />
              <template v-if="passoDe(p.id).situacao === 'aprovada'">
                <SanteSelecao
                  :id="`passo-cpt-${p.id}`"
                  v-model="passoDe(p.id).cumpriuCpt"
                  :rotulo="t('saudeBeneficiario.cumpriuCptNaOrigem')"
                  :opcoes="SIM_NAO"
                />
                <SanteSelecao
                  :id="`passo-ja-${p.id}`"
                  v-model="passoDe(p.id).jaPortou"
                  :rotulo="t('saudeBeneficiario.jaPortouAntes')"
                  :opcoes="SIM_NAO"
                />
                <span :data-testid="`permanencia-${p.numero}`">
                  {{ x.permanencia(permanencia(p.id)) }}
                </span>
              </template>
              <SanteCampoTexto
                v-if="passoDe(p.id).situacao === 'recusada'"
                :id="`passo-mot-${p.id}`"
                v-model="passoDe(p.id).motivo"
                :max-bytes="500"
                :rotulo="t('saudeBeneficiario.motivoDaRecusa')"
                :data-testid="`passo-motivo-${p.numero}`"
              />
            </div>
            <ul v-if="faltaPasso(p.id).length" class="saude__erro">
              <li v-for="f in faltaPasso(p.id)" :key="f">{{ f }}</li>
            </ul>
            <SanteBotao
              :rotulo="t('saudeBeneficiario.registrarPasso')"
              :desabilitado="faltaPasso(p.id).length > 0"
              :data-testid="`passo-salvar-${p.numero}`"
              @click="salvarPasso(p.id, p.versao)"
            />
          </template>
        </div>
        <form
          v-if="podeEditar"
          class="saude__cartao"
          data-testid="form-portabilidade"
          @submit.prevent="salvarPortabilidade"
        >
          <strong>{{ t('saudeBeneficiario.novoPedidoDePortabilidade') }}</strong>
          <div class="saude__linha">
            <SanteSelecao
              id="port-direcao"
              v-model="port.direcao"
              :rotulo="t('saudeBeneficiario.direcao')"
              :opcoes="opcoes(DIRECOES)"
              data-testid="port-direcao"
            />
            <SanteSelecao
              id="port-modalidade"
              v-model="port.modalidade"
              :rotulo="t('saudeBeneficiario.modalidade')"
              :opcoes="opcoes(MODALIDADES)"
              data-testid="port-modalidade"
            />
            <SanteCampoTexto
              id="port-registro"
              v-model="port.registro"
              :max-bytes="6"
              :rotulo="t('saudeBeneficiario.registroAnsDaOutra')"
              data-testid="port-registro"
            />
            <SanteCampoTexto
              id="port-nome"
              v-model="port.nome"
              :max-bytes="150"
              :rotulo="t('saudeBeneficiario.nomeDaOperadora')"
              data-testid="port-nome"
            />
            <SanteCampoTexto
              id="port-produto"
              v-model="port.produto"
              :max-bytes="20"
              :rotulo="t('saudeBeneficiario.registroDoProduto')"
            />
          </div>
          <div class="saude__linha">
            <SanteData
              v-model="port.vinculo"
              editavel
              :maximo="hoje"
              :rotulo="t('saudeBeneficiario.inicioDoVinculoNa')"
              data-testid="port-vinculo"
            />
            <SanteData
              v-model="port.solicitado"
              editavel
              :maximo="hoje"
              :rotulo="t('saudeBeneficiario.pedidoEm')"
              data-testid="port-solicitado"
            />
            <SanteSelecao
              id="port-faixa"
              v-model="port.faixa"
              :rotulo="t('saudeBeneficiario.faixaDePrecoCompativel')"
              :opcoes="SIM_NAO"
            />
            <SanteSelecao
              id="port-adimplente"
              v-model="port.adimplente"
              :rotulo="t('saudeBeneficiario.adimplente')"
              :opcoes="SIM_NAO"
            />
          </div>
          <SanteCampoTexto
            id="port-obs"
            v-model="port.observacao"
            :max-bytes="4000"
            multilinha
            :rotulo="t('saudeBeneficiario.observacao')"
          />
          <ul v-if="faltaPortabilidade.length" class="saude__erro" data-testid="port-falta">
            <li v-for="f in faltaPortabilidade" :key="f">{{ f }}</li>
          </ul>
          <SanteBotao
            :rotulo="t('saudeBeneficiario.registrarPedido')"
            tipo="submit"
            :desabilitado="faltaPortabilidade.length > 0"
            data-testid="port-salvar"
          />
        </form>
      </div>

      <div v-if="aba === 'cartao'" class="saude__painel" data-testid="painel-cartao">
        <table v-if="painel.cartoes.length" class="saude__tabela">
          <thead>
            <tr>
              <th>{{ t('saudeBeneficiario.numero') }}</th>
              <th>{{ t('saudeBeneficiario.situacao') }}</th>
              <th>{{ t('saudeBeneficiario.pedidoEm') }}</th>
              <th>{{ t('saudeBeneficiario.via') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in painel.cartoes" :key="c.id" :data-testid="`cartao-${c.id}`">
              <td>{{ c.numero }}</td>
              <td>{{ c.situacao }}</td>
              <td>{{ dataBr(c.solicitadoEm) }}</td>
              <td>{{ c.viaEmitida ?? '—' }}</td>
              <td class="saude__linha">
                <SanteBotao
                  v-if="podeEditar && PROXIMO_CARTAO[c.situacao]"
                  :rotulo="
                    PROXIMO_CARTAO[c.situacao] === 'emitido'
                      ? t('saudeBeneficiario.emitir')
                      : t('saudeBeneficiario.entregar')
                  "
                  variante="secundario"
                  :data-testid="`cartao-avancar-${c.id}`"
                  @click="
                    acao(
                      () => avancarPedidoCartao(c.id, PROXIMO_CARTAO[c.situacao]!),
                      t('saudeBeneficiario.cartaoAtualizado'),
                    )
                  "
                />
                <SanteBotao
                  v-if="podeEditar && PROXIMO_CARTAO[c.situacao]"
                  :rotulo="t('saudeBeneficiario.cancelar')"
                  variante="secundario"
                  @click="
                    acao(() => avancarPedidoCartao(c.id, 'cancelado'), t('saudeBeneficiario.cartaoCancelado'))
                  "
                />
              </td>
            </tr>
          </tbody>
        </table>
        <form v-if="podeEditar" class="saude__cartao" data-testid="form-cartao" @submit.prevent="pedirCartao">
          <div class="saude__linha">
            <SanteSelecao
              id="cartao-primeira"
              v-model="cartao.primeiraVia"
              :rotulo="t('saudeBeneficiario.primeiraVia')"
              :opcoes="SIM_NAO"
              data-testid="cartao-primeira"
            />
            <SanteSelecao
              id="cartao-canal"
              v-model="cartao.canal"
              :rotulo="t('saudeBeneficiario.canal')"
              :opcoes="opcoes(CANAIS_CARTAO)"
              data-testid="cartao-canal"
            />
            <SanteCampoTexto
              id="cartao-obs"
              v-model="cartao.observacao"
              :max-bytes="1000"
              :rotulo="t('saudeBeneficiario.observacao')"
            />
          </div>
          <SanteBotao :rotulo="t('saudeBeneficiario.pedirCartao')" tipo="submit" data-testid="cartao-pedir" />
        </form>
      </div>
    </template>
  </section>
</template>

<style scoped>
.saude,
.saude__painel {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.saude__linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.saude__ajuda {
  color: var(--sgh-texto-secundario);
}
.saude__erro {
  color: var(--sgh-alerta);
}
.saude__cartao {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
.saude__tabela {
  width: 100%;
  border-collapse: collapse;
}
.saude__tabela th,
.saude__tabela td {
  padding: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda);
  text-align: left;
}
.saude__lista {
  list-style: none;
  padding: 0;
  margin: 0;
}
.saude__link {
  background: none;
  border: none;
  padding: 0;
  color: var(--sgh-link);
  text-decoration: underline;
  cursor: pointer;
}
</style>
