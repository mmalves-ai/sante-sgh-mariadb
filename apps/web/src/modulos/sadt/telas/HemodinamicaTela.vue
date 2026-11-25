<script setup lang="ts">
// Registro do exame de hemodinâmica (C2-027, 04-CC linha 107), na sala de hemodinâmica ou no centro cirúrgico. À
// esquerda, a fila do setor por paciente (urgentes primeiro), com a situação do registro, os vasos com lesão
// significativa e os alertas; ao abrir, o registro estruturado: acesso, equipe, contraste, indicadores de dose de
// radiação (tempo de fluoroscopia, kerma no ponto de referência e produto dose-área, RDC Anvisa 611/2022), função
// ventricular e os achados por vaso. A regra do domínio roda na hora (a mesma do servidor): o rascunho grava o que
// estiver coerente; "Salvar e concluir" grava e conclui num clique só quando o laudo está completo. Achado corrigido
// fica no histórico; registro concluído não muda mais; o procedimento interrompido é cancelado com o motivo.
import {
  type AchadoHemodinamica,
  alertasHemodinamica,
  conferirRegistroHemodinamica,
  type RegistroHemodinamica,
} from '@sgh/dominio-sadt';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteHora, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  abrirExameHemodinamica,
  type AchadoPedido,
  cancelarRegistroHemodinamica,
  concluirRegistroHemodinamica,
  type ExameHemodinamica,
  iniciarRegistroHemodinamica,
  lerFilaHemodinamica,
  type RegistroPedido,
  salvarRegistroHemodinamica,
} from '../api-hemodinamica.js';
import ErroSadt from '../componentes/ErroSadt.vue';

const M = {
  titulo: 'Registro de hemodinâmica',
  fila: 'Exames do setor',
  de: 'De',
  ate: 'Até',
  nenhum: 'Nenhum exame de hemodinâmica pedido no período.',
  abrir: 'Abrir',
  urgente: 'urgente',
  pront: 'prontuário {p}',
  vasos: '{n} vaso(s) com lesão significativa',
  situacoes: {
    sem_registro: 'Sem registro',
    em_andamento: 'Em andamento',
    concluido: 'Concluído',
    cancelado: 'Cancelado',
  } as Record<string, string>,
  alertas: {
    'dose-substancial':
      'Dose substancial de radiação (kerma ≥ 5 Gy ou produto dose-área ≥ 500 Gy·cm²): oriente o paciente e agende o seguimento da pele.',
    'fluoroscopia-prolongada': 'Fluoroscopia de uma hora ou mais.',
    'contraste-elevado': 'Volume de contraste acima de 300 mL: acompanhe a função renal.',
    'lesao-tronco': 'Lesão significativa no tronco da coronária esquerda.',
  } as Record<string, string>,
  procedimento: 'Procedimento',
  data: 'Data',
  inicio: 'Início',
  fim: 'Fim',
  via: 'Via de acesso',
  introdutor: 'Introdutor (French)',
  anestesia: 'Anestesia',
  op1: 'Primeiro operador',
  op2: 'Segundo operador',
  anestesista: 'Anestesista',
  contraste: 'Contraste',
  volume: 'Volume de contraste (mL)',
  heparina: 'Heparina (UI)',
  dose: 'Dose de radiação (RDC Anvisa 611/2022)',
  fluoro: 'Tempo de fluoroscopia (min:s ou segundos)',
  kerma: 'Kerma no ponto de referência (mGy)',
  pda: 'Produto dose-área (Gy·cm²)',
  funcao: 'Função ventricular',
  dominancia: 'Dominância coronária',
  fe: 'Fração de ejeção (%)',
  pd2: 'Pressão diastólica final do VE (mmHg)',
  achados: 'Achados por vaso',
  vaso: 'Vaso',
  segmento: 'Segmento',
  tipo: 'Achado',
  grau: 'Grau (%)',
  timi: 'Fluxo TIMI',
  calcificacao: 'Calcificação',
  comprimento: 'Extensão (mm)',
  bifurcacao: 'Bifurcação',
  conduta: 'Conduta no vaso',
  stent: 'Stent implantado',
  obs: 'Observação',
  retirar: 'Retirar',
  incluirAchado: 'Incluir achado',
  corrigidos: '{n} achado(s) corrigido(s) no histórico.',
  desfecho: 'Desfecho',
  hemostasia: 'Hemostasia',
  complicacoes: 'Complicações',
  conclusao: 'Conclusão',
  condutaIndicada: 'Conduta indicada',
  iniciar: 'Abrir o registro',
  salvar: 'Salvar rascunho',
  concluir: 'Salvar e concluir',
  motivo: 'Motivo da interrupção',
  cancelar: 'Cancelar o procedimento',
  falta: 'Para concluir:',
  gravado: 'Gravado.',
  concluidoMsg: 'Registro concluído.',
  canceladoMsg: 'Procedimento cancelado.',
  escolha: 'Escolha',
  nenhumOp: 'Nenhum',
  semValor: '—',
  encerrado: 'Registro encerrado: não muda mais.',
};
const ROTULOS: Record<string, string> = {
  radial_direita: 'Radial direita',
  radial_esquerda: 'Radial esquerda',
  femoral_direita: 'Femoral direita',
  femoral_esquerda: 'Femoral esquerda',
  braquial: 'Braquial',
  ulnar: 'Ulnar',
  outra: 'Outra',
  local: 'Local',
  sedacao: 'Sedação',
  geral: 'Geral',
  direita: 'Direita',
  esquerda: 'Esquerda',
  balanceada: 'Balanceada',
  compressao_manual: 'Compressão manual',
  pulseira_compressiva: 'Pulseira compressiva',
  dispositivo_oclusao: 'Dispositivo de oclusão',
  tratamento_clinico: 'Tratamento clínico',
  angioplastia: 'Angioplastia',
  cirurgia: 'Cirurgia de revascularização',
  reavaliacao: 'Reavaliação',
  nenhuma: 'Nenhuma',
  normal: 'Normal',
  estenose: 'Estenose',
  oclusao: 'Oclusão',
  ectasia: 'Ectasia',
  aneurisma: 'Aneurisma',
  ponte_miocardica: 'Ponte miocárdica',
  trombo: 'Trombo',
  dissecacao: 'Dissecção',
  stent_previo: 'Stent prévio pérvio',
  reestenose: 'Reestenose',
  outro: 'Outro',
  ausente: 'Ausente',
  leve: 'Leve',
  moderada: 'Moderada',
  grave: 'Grave',
};

const cliente = useQueryClient();
const { permissoes } = usarSessao();
const podeRegistrar = computed(() => permissoes.value.has('sadt.laudo.criar'));
const podeConcluir = computed(() => permissoes.value.has('sadt.laudo.assinar'));

const hoje = new Date();
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const de = ref<string | null>(iso(new Date(hoje.getTime() - 2 * 86_400_000)));
const ate = ref<string | null>(iso(hoje));
const itemAberto = ref<number | null>(null);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

const fila = useQuery({
  queryKey: computed(() => ['sadt', 'hemodinamica', 'fila', de.value, ate.value]),
  queryFn: () => lerFilaHemodinamica(de.value!, ate.value!),
  enabled: computed(() => !!de.value && !!ate.value && de.value <= ate.value!),
});
const aberto = useQuery({
  queryKey: computed(() => ['sadt', 'hemodinamica', 'item', itemAberto.value]),
  queryFn: async () => {
    const x = await abrirExameHemodinamica(itemAberto.value!);
    preencher(x);
    return x;
  },
  enabled: computed(() => itemAberto.value !== null),
});
const x = computed(() => aberto.data.value);
const reg = computed(() => x.value?.registro ?? null);
const editavel = computed(() => podeRegistrar.value && (!reg.value || reg.value.situacao === 'em_andamento'));

// ── Formulário (texto na tela; número e instante na hora de gravar) ──
interface LinhaAchado {
  chave: number;
  id?: number;
  vaso: string;
  segmento: string;
  tipo: string;
  grau: string;
  timi: string;
  calcificacao: string;
  comprimento: string;
  bifurcacao: boolean;
  conduta: string;
  stent: boolean;
  obs: string;
}
let chaves = 0;
const novaLinha = (): LinhaAchado => ({
  chave: ++chaves,
  vaso: '',
  segmento: '',
  tipo: 'estenose',
  grau: '',
  timi: '',
  calcificacao: '',
  comprimento: '',
  bifurcacao: false,
  conduta: '',
  stent: false,
  obs: '',
});
const f = reactive({
  data: iso(hoje) as string | null,
  inicio: null as string | null,
  fim: null as string | null,
  via: '',
  introdutor: '',
  anestesia: '',
  op1: '',
  op2: '',
  anestesista: '',
  contraste: '',
  volume: '',
  heparina: '',
  fluoro: '',
  kerma: '',
  pda: '',
  dominancia: '',
  fe: '',
  pd2: '',
  hemostasia: '',
  complicacoes: '',
  conclusao: '',
  conduta: '',
  motivo: '',
  achados: [] as LinhaAchado[],
});
const t = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const fluoroTexto = (s: number | null) =>
  s === null ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function preencher(e: ExameHemodinamica): void {
  const r = e.registro;
  const ini = r?.inicioEm ? new Date(r.inicioEm) : null;
  const fim = r?.fimEm ? new Date(r.fimEm) : null;
  Object.assign(f, {
    data: ini ? iso(ini) : iso(new Date()),
    inicio: ini ? hhmm(ini) : null,
    fim: fim ? hhmm(fim) : null,
    via: r?.viaAcesso ?? '',
    introdutor: t(r?.introdutorFrench),
    anestesia: r?.anestesia ?? '',
    op1: t(r?.primeiroOperador),
    op2: t(r?.segundoOperador),
    anestesista: t(r?.anestesista),
    contraste: r?.contrasteNome ?? '',
    volume: t(r?.contrasteVolumeMl),
    heparina: t(r?.heparinaUi),
    fluoro: fluoroTexto(r?.tempoFluoroscopiaSegundos ?? null),
    kerma: t(r?.kermaReferenciaMgy),
    pda: t(r?.produtoDoseAreaGycm2),
    dominancia: r?.dominancia ?? '',
    fe: t(r?.fracaoEjecao),
    pd2: t(r?.pressaoDiastolicaFinalVe),
    hemostasia: r?.hemostasia ?? '',
    complicacoes: r?.complicacoes ?? '',
    conclusao: r?.conclusao ?? '',
    conduta: r?.condutaIndicada ?? '',
    motivo: '',
    achados: e.achados.map((a) => ({
      chave: ++chaves,
      id: a.id,
      vaso: a.vaso,
      segmento: a.segmento ?? '',
      tipo: a.tipo,
      grau: t(a.grauPercentual),
      timi: t(a.fluxoTimi),
      calcificacao: a.calcificacao ?? '',
      comprimento: t(a.comprimentoMm),
      bifurcacao: a.bifurcacao,
      conduta: a.conduta ?? '',
      stent: a.stentImplantado,
      obs: a.observacao ?? '',
    })),
  });
}

const numero = (v: string): number | null => {
  const s = v.trim().replace(',', '.');
  return s === '' ? null : Number(s);
};
const id = (v: string) => (v ? Number(v) : null);
const ou = (v: string) => v.trim() || null;
/** "12:30" (minutos e segundos) ou só os segundos. */
const segundos = (v: string): number | null => {
  const s = v.trim();
  if (!s) return null;
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number(s);
};
/** O instante da data e da hora; o fim antes do início vira o dia seguinte (procedimento que cruza a meia-noite). */
const instante = (hora: string | null, depoisDe?: string | null): string | null => {
  if (!f.data || !hora) return null;
  const d = new Date(`${f.data}T${hora}:00`);
  if (depoisDe && d.getTime() < Date.parse(depoisDe)) d.setDate(d.getDate() + 1);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const achadosPedido = computed<AchadoPedido[]>(() =>
  f.achados.map((a) => ({
    ...(a.id ? { id: a.id } : {}),
    vaso: a.vaso.trim(),
    segmento: ou(a.segmento),
    tipo: a.tipo,
    grauPercentual: numero(a.grau),
    fluxoTimi: numero(a.timi),
    calcificacao: ou(a.calcificacao),
    comprimentoMm: numero(a.comprimento),
    bifurcacao: a.bifurcacao,
    conduta: ou(a.conduta),
    stentImplantado: a.stent,
    observacao: ou(a.obs),
  })),
);
const pedido = computed(() => {
  const inicioEm = instante(f.inicio);
  return {
    inicioEm,
    fimEm: instante(f.fim, inicioEm),
    viaAcesso: f.via,
    introdutorFrench: numero(f.introdutor),
    anestesia: ou(f.anestesia),
    contrasteNome: ou(f.contraste),
    contrasteVolumeMl: numero(f.volume),
    heparinaUi: numero(f.heparina),
    tempoFluoroscopiaSegundos: segundos(f.fluoro),
    kermaReferenciaMgy: numero(f.kerma),
    produtoDoseAreaGycm2: numero(f.pda),
    dominancia: ou(f.dominancia),
    fracaoEjecao: numero(f.fe),
    pressaoDiastolicaFinalVe: numero(f.pd2),
    hemostasia: ou(f.hemostasia),
    complicacoes: ou(f.complicacoes),
    conclusao: ou(f.conclusao),
    condutaIndicada: ou(f.conduta),
    primeiroOperador: id(f.op1),
    segundoOperador: id(f.op2),
    anestesista: id(f.anestesista),
  };
});
const dominio = computed<RegistroHemodinamica>(() => ({
  ...pedido.value,
  viaAcesso: f.via || null,
  achados: achadosPedido.value as AchadoHemodinamica[],
}));
const problemas = computed(() => conferirRegistroHemodinamica(dominio.value, 'rascunho'));
const faltaConcluir = computed(() =>
  conferirRegistroHemodinamica(dominio.value, 'concluir').filter(
    (p) => !problemas.value.some((q) => q.campo === p.campo && q.mensagem === p.mensagem),
  ),
);
const alertas = computed(() => alertasHemodinamica(dominio.value));
const problemasAchado = (i: number) =>
  problemas.value.filter((p) => p.campo.startsWith(`achados.${i}.`)).map((p) => p.mensagem);

// ── Opções ──
const rotulo = (v: string) => ROTULOS[v] ?? v;
const op = (l: { id: string }[] | undefined, vazio: string) => [
  { valor: '', rotulo: vazio },
  ...(l ?? []).map((o) => ({ valor: o.id, rotulo: rotulo(o.id) })),
];
const o = computed(() => x.value?.opcoes);
const opVia = computed(() => op(o.value?.vias, M.escolha));
const opAnestesia = computed(() => op(o.value?.anestesias, M.semValor));
const opDominancia = computed(() => op(o.value?.dominancias, M.semValor));
const opHemostasia = computed(() => op(o.value?.hemostasias, M.semValor));
const opConduta = computed(() => op(o.value?.condutas, M.semValor));
const opTipo = computed(() => op(o.value?.tiposAchado, M.escolha).slice(1));
const opCalcificacao = computed(() => op(o.value?.calcificacoes, M.semValor));
const opCondutaAchado = computed(() => op(o.value?.condutasAchado, M.semValor));
const opTimi = [
  { valor: '', rotulo: M.semValor },
  ...[0, 1, 2, 3].map((n) => ({ valor: String(n), rotulo: `TIMI ${n}` })),
];
const opProf = (vazio: string) =>
  computed(() => [
    { valor: '', rotulo: vazio },
    ...(o.value?.profissionais ?? []).map((p) => ({ valor: String(p.id), rotulo: p.rotulo })),
  ]);
const opOp1 = opProf(M.escolha);
const opOutro = opProf(M.nenhumOp);

// ── Ações ──
async function rodar(fn: () => Promise<unknown>): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    await fn();
    await cliente.invalidateQueries({ queryKey: ['sadt', 'hemodinamica'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const abrir = (item: number) => {
  mensagem.value = null;
  erro.value = null;
  itemAberto.value = item;
};
const corpo = () => pedido.value as RegistroPedido;
const iniciar = () =>
  rodar(async () => {
    await iniciarRegistroHemodinamica(itemAberto.value!, corpo());
    mensagem.value = M.gravado;
  });
const salvar = () =>
  rodar(async () => {
    await salvarRegistroHemodinamica(reg.value!.id, reg.value!.versao, corpo(), achadosPedido.value);
    mensagem.value = M.gravado;
  });
const salvarEConcluir = () =>
  rodar(async () => {
    const s = await salvarRegistroHemodinamica(
      reg.value!.id,
      reg.value!.versao,
      corpo(),
      achadosPedido.value,
    );
    await concluirRegistroHemodinamica(reg.value!.id, Number((s as { versao?: number }).versao));
    mensagem.value = M.concluidoMsg;
  });
const cancelar = () =>
  rodar(async () => {
    await cancelarRegistroHemodinamica(reg.value!.id, reg.value!.versao, f.motivo.trim());
    mensagem.value = M.canceladoMsg;
  });
const incluirAchado = () => f.achados.push(novaLinha());
const retirarAchado = (i: number) => f.achados.splice(i, 1);
const quando = (s: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
</script>

<template>
  <main class="tela" data-testid="hemodinamica">
    <h1>{{ M.titulo }}</h1>
    <ErroSadt v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="hemodinamica-mensagem">{{ mensagem }}</p>
    <div class="colunas">
      <section class="fila" aria-labelledby="hemo-fila">
        <h2 id="hemo-fila">{{ M.fila }}</h2>
        <div class="linha">
          <SanteData v-model="de" :rotulo="M.de" editavel data-testid="hemodinamica-de" />
          <SanteData v-model="ate" :rotulo="M.ate" editavel data-testid="hemodinamica-ate" />
        </div>
        <ErroSadt v-if="fila.isError.value" :erro="fila.error.value" />
        <p v-if="fila.data.value && !fila.data.value.exames.length">{{ M.nenhum }}</p>
        <ul v-else class="lista" data-testid="hemodinamica-fila">
          <li
            v-for="e in fila.data.value?.exames ?? []"
            :key="e.item"
            :data-testid="`hemodinamica-item-${e.item}`"
            :data-situacao="e.situacao"
            :aria-current="e.item === itemAberto ? 'true' : undefined"
          >
            <strong>{{ e.paciente }}</strong>
            <span v-if="e.prontuario"> · {{ M.pront.replace('{p}', e.prontuario) }}</span>
            <span v-if="e.urgente" class="selo"> · {{ M.urgente }}</span>
            <div>{{ e.exame }} · {{ e.numero }} · {{ quando(e.solicitadoEm) }}</div>
            <div>
              <span class="selo">{{ M.situacoes[e.situacao] ?? e.situacao }}</span>
              <span v-if="e.vasosComLesao"> · {{ M.vasos.replace('{n}', String(e.vasosComLesao)) }}</span>
            </div>
            <SanteAlerta
              v-for="a in e.alertas"
              :key="a"
              :texto="M.alertas[a] ?? a"
              variante="aviso"
              :data-testid="`hemodinamica-fila-alerta-${e.item}`"
            />
            <SanteBotao
              variante="texto"
              :rotulo="M.abrir"
              :data-testid="`hemodinamica-abrir-${e.item}`"
              @acionar="abrir(e.item)"
            />
          </li>
        </ul>
      </section>

      <section v-if="x" class="registro" aria-labelledby="hemo-registro" data-testid="hemodinamica-registro">
        <h2 id="hemo-registro">{{ x.exame.paciente }} · {{ x.exame.exame }} · {{ x.exame.numero }}</h2>
        <p data-testid="hemodinamica-situacao" :data-situacao="reg?.situacao ?? 'sem_registro'">
          <span class="selo">{{ M.situacoes[reg?.situacao ?? 'sem_registro'] }}</span>
          <span v-if="x.achadosCorrigidos">
            · {{ M.corrigidos.replace('{n}', String(x.achadosCorrigidos)) }}</span
          >
        </p>
        <SanteAlerta
          v-for="a in alertas"
          :key="a"
          :texto="M.alertas[a] ?? a"
          variante="alerta"
          data-testid="hemodinamica-alerta"
        />
        <p v-if="reg && reg.situacao !== 'em_andamento'" data-testid="hemodinamica-encerrado">
          {{ M.encerrado }}
        </p>
        <fieldset :disabled="!editavel" class="grade">
          <legend>{{ M.procedimento }}</legend>
          <SanteData v-model="f.data" :rotulo="M.data" editavel data-testid="hemo-data" />
          <SanteHora v-model="f.inicio" :rotulo="M.inicio" editavel data-testid="hemo-inicio" />
          <SanteHora v-model="f.fim" :rotulo="M.fim" editavel data-testid="hemo-fim" />
          <SanteSelecao v-model="f.via" :rotulo="M.via" :opcoes="opVia" obrigatorio data-testid="hemo-via" />
          <SanteCampoTexto
            v-model="f.introdutor"
            :rotulo="M.introdutor"
            :max-bytes="2"
            data-testid="hemo-introdutor"
          />
          <SanteSelecao
            v-model="f.anestesia"
            :rotulo="M.anestesia"
            :opcoes="opAnestesia"
            data-testid="hemo-anestesia"
          />
          <SanteSelecao
            v-model="f.op1"
            :rotulo="M.op1"
            :opcoes="opOp1"
            busca
            obrigatorio
            data-testid="hemo-op1"
          />
          <SanteSelecao v-model="f.op2" :rotulo="M.op2" :opcoes="opOutro" busca data-testid="hemo-op2" />
          <SanteSelecao
            v-model="f.anestesista"
            :rotulo="M.anestesista"
            :opcoes="opOutro"
            busca
            data-testid="hemo-anestesista"
          />
          <SanteCampoTexto
            v-model="f.contraste"
            :rotulo="M.contraste"
            :max-bytes="100"
            data-testid="hemo-contraste"
          />
          <SanteCampoTexto v-model="f.volume" :rotulo="M.volume" :max-bytes="8" data-testid="hemo-volume" />
          <SanteCampoTexto
            v-model="f.heparina"
            :rotulo="M.heparina"
            :max-bytes="6"
            data-testid="hemo-heparina"
          />
        </fieldset>
        <template v-if="reg">
          <fieldset :disabled="!editavel" class="grade">
            <legend>{{ M.dose }}</legend>
            <SanteCampoTexto v-model="f.fluoro" :rotulo="M.fluoro" :max-bytes="7" data-testid="hemo-fluoro" />
            <SanteCampoTexto v-model="f.kerma" :rotulo="M.kerma" :max-bytes="10" data-testid="hemo-kerma" />
            <SanteCampoTexto v-model="f.pda" :rotulo="M.pda" :max-bytes="10" data-testid="hemo-pda" />
          </fieldset>
          <fieldset :disabled="!editavel" class="grade">
            <legend>{{ M.funcao }}</legend>
            <SanteSelecao
              v-model="f.dominancia"
              :rotulo="M.dominancia"
              :opcoes="opDominancia"
              data-testid="hemo-dominancia"
            />
            <SanteCampoTexto v-model="f.fe" :rotulo="M.fe" :max-bytes="6" data-testid="hemo-fe" />
            <SanteCampoTexto v-model="f.pd2" :rotulo="M.pd2" :max-bytes="3" data-testid="hemo-pd2" />
          </fieldset>
          <fieldset :disabled="!editavel" data-testid="hemo-achados">
            <legend>{{ M.achados }}</legend>
            <div
              v-for="(a, i) in f.achados"
              :key="a.chave"
              class="achado grade"
              :data-testid="`hemo-achado-${i}`"
            >
              <SanteCampoTexto
                v-model="a.vaso"
                :rotulo="M.vaso"
                :max-bytes="60"
                :data-testid="`hemo-achado-vaso-${i}`"
              />
              <SanteCampoTexto
                v-model="a.segmento"
                :rotulo="M.segmento"
                :max-bytes="60"
                :data-testid="`hemo-achado-segmento-${i}`"
              />
              <SanteSelecao
                v-model="a.tipo"
                :rotulo="M.tipo"
                :opcoes="opTipo"
                :data-testid="`hemo-achado-tipo-${i}`"
              />
              <SanteCampoTexto
                v-model="a.grau"
                :rotulo="M.grau"
                :max-bytes="5"
                :data-testid="`hemo-achado-grau-${i}`"
              />
              <SanteSelecao
                v-model="a.timi"
                :rotulo="M.timi"
                :opcoes="opTimi"
                :data-testid="`hemo-achado-timi-${i}`"
              />
              <SanteSelecao
                v-model="a.calcificacao"
                :rotulo="M.calcificacao"
                :opcoes="opCalcificacao"
                :data-testid="`hemo-achado-calcificacao-${i}`"
              />
              <SanteCampoTexto
                v-model="a.comprimento"
                :rotulo="M.comprimento"
                :max-bytes="6"
                :data-testid="`hemo-achado-comprimento-${i}`"
              />
              <SanteSelecao
                v-model="a.conduta"
                :rotulo="M.conduta"
                :opcoes="opCondutaAchado"
                :data-testid="`hemo-achado-conduta-${i}`"
              />
              <label><input v-model="a.bifurcacao" type="checkbox" /> {{ M.bifurcacao }}</label>
              <label
                ><input v-model="a.stent" type="checkbox" :data-testid="`hemo-achado-stent-${i}`" />
                {{ M.stent }}</label
              >
              <SanteCampoTexto v-model="a.obs" :rotulo="M.obs" :max-bytes="500" />
              <small
                v-for="p in problemasAchado(i)"
                :key="p"
                class="erro-campo"
                data-testid="hemo-problema"
                >{{ p }}</small
              >
              <SanteBotao
                v-if="editavel"
                variante="texto"
                :rotulo="M.retirar"
                :data-testid="`hemo-achado-retirar-${i}`"
                @acionar="retirarAchado(i)"
              />
            </div>
            <SanteBotao
              v-if="editavel"
              variante="texto"
              :rotulo="M.incluirAchado"
              data-testid="hemo-incluir-achado"
              @acionar="incluirAchado"
            />
          </fieldset>
          <fieldset :disabled="!editavel" class="grade">
            <legend>{{ M.desfecho }}</legend>
            <SanteSelecao
              v-model="f.hemostasia"
              :rotulo="M.hemostasia"
              :opcoes="opHemostasia"
              data-testid="hemo-hemostasia"
            />
            <SanteSelecao
              v-model="f.conduta"
              :rotulo="M.condutaIndicada"
              :opcoes="opConduta"
              data-testid="hemo-conduta"
            />
            <SanteCampoTexto
              v-model="f.complicacoes"
              :rotulo="M.complicacoes"
              :max-bytes="4000"
              multilinha
              data-testid="hemo-complicacoes"
            />
            <SanteCampoTexto
              v-model="f.conclusao"
              :rotulo="M.conclusao"
              :max-bytes="8000"
              multilinha
              data-testid="hemo-conclusao"
            />
          </fieldset>
        </template>
        <ul v-if="editavel && problemas.length" class="problemas">
          <li
            v-for="p in problemas.filter((q) => !q.campo.startsWith('achados.'))"
            :key="p.campo + p.mensagem"
            class="erro-campo"
            data-testid="hemo-problema"
          >
            {{ p.mensagem }}
          </li>
        </ul>
        <div v-if="editavel" class="linha">
          <SanteBotao
            v-if="!reg"
            :rotulo="M.iniciar"
            :desabilitado="ocupado || problemas.length > 0"
            data-testid="hemo-iniciar"
            @acionar="iniciar"
          />
          <template v-else>
            <SanteBotao
              variante="texto"
              :rotulo="M.salvar"
              :desabilitado="ocupado || problemas.length > 0"
              data-testid="hemo-salvar"
              @acionar="salvar"
            />
            <SanteBotao
              v-if="podeConcluir"
              :rotulo="M.concluir"
              :desabilitado="ocupado || problemas.length > 0 || faltaConcluir.length > 0"
              data-testid="hemo-concluir"
              @acionar="salvarEConcluir"
            />
          </template>
        </div>
        <div v-if="editavel && reg && faltaConcluir.length" data-testid="hemo-falta-concluir">
          <strong>{{ M.falta }}</strong>
          <ul>
            <li v-for="p in faltaConcluir" :key="p.campo + p.mensagem" class="erro-campo">
              {{ p.mensagem }}
            </li>
          </ul>
        </div>
        <div v-if="editavel && reg" class="linha">
          <SanteCampoTexto v-model="f.motivo" :rotulo="M.motivo" :max-bytes="500" data-testid="hemo-motivo" />
          <SanteBotao
            variante="texto"
            :rotulo="M.cancelar"
            :desabilitado="ocupado || f.motivo.trim().length < 3"
            data-testid="hemo-cancelar"
            @acionar="cancelar"
          />
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.colunas {
  display: grid;
  grid-template-columns: minmax(16rem, 1fr) minmax(0, 3fr);
  gap: var(--sgh-espaco-3);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.achado {
  padding: var(--sgh-espaco-2) 0;
  border-bottom: 1px solid var(--sgh-borda);
}
.lista li {
  padding: var(--sgh-espaco-1) 0;
  border-bottom: 1px solid var(--sgh-borda);
}
.lista li[aria-current='true'] {
  background: var(--sgh-fundo-elevado);
}
.selo {
  font-weight: 600;
}
.erro-campo {
  color: var(--sgh-alerta);
}
@media (max-width: 60rem) {
  .colunas {
    grid-template-columns: 1fr;
  }
}
</style>
