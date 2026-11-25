<script setup lang="ts">
// Laudos estruturados de mamografia e de anatomia patológica (C2-071, 05-SADT linha 18). Quatro abas:
//   - Mamografia: a fila do setor de imagem (modalidade MG) por paciente; o laudo com a composição e a categoria final
//     de cada mama, os achados por mama e quadrante e a recomendação, que a tela sugere pela categoria mais grave
//     (tabela padronizada do laudo mamário, a mesma do resultado de mamografia do SISCAN). Os laudos anteriores da
//     paciente aparecem ao lado (visão por paciente);
//   - Anatomia patológica: o laudo com as amostras, a macroscopia e a microscopia, a adequabilidade da amostra, o
//     resultado, o grau histológico e os achados estruturados (margens, linfonodos, receptores, HER2, Ki-67);
//   - Peças da cirurgia: as peças enviadas pela descrição cirúrgica ainda sem laudo, recebidas num clique no pedido
//     de anatomia patológica da paciente (o único pedido já vem escolhido);
//   - SISCAN: as fichas do resultado de mamografia dos laudos liberados no período, para baixar em CSV.
// A regra do domínio roda na hora (a mesma do servidor): o rascunho grava o que estiver coerente; "Salvar e liberar"
// grava e libera num clique quando o laudo está completo. Achado corrigido fica no histórico; laudo liberado não muda.
import {
  type AchadoMama,
  alertasLaudoAnatomopatologico,
  alertasLaudoMama,
  categoriaMaisGrave,
  condutaDaCategoria,
  conferirLaudoAnatomopatologico,
  conferirLaudoMama,
  type LaudoAnatomopatologico,
  MOTIVO_RETIFICACAO_MINIMO,
  type LaudoMama,
} from '@sgh/dominio-sadt';
import { SanteBotao, SanteCampoTexto, SanteData, SanteHora, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  abrirExameAnatomopatologico,
  abrirExameMama,
  type ExameAnatomopatologico,
  type ExameMama,
  lerFichasSiscan,
  lerFilaLaudoEspecializado,
  lerPecasEnviadas,
  liberarLaudoAnatomopatologico,
  liberarLaudoMama,
  receberPeca,
  retificarLaudoAnatomopatologico,
  retificarLaudoMama,
  salvarLaudoAnatomopatologico,
  salvarLaudoMama,
  type TipoLaudoEspecializado,
} from '../api-laudo-mama-patologia.js';
import ErroSadt from '../componentes/ErroSadt.vue';

const M = {
  titulo: 'Laudos de mamografia e de anatomia patológica',
  rotuloAbas: 'Abas',
  siglaDireita: 'D',
  siglaEsquerda: 'E',
  abas: {
    mama: 'Mamografia',
    anatomopatologico: 'Anatomia patológica',
    pecas: 'Peças da cirurgia',
    siscan: 'SISCAN',
  } as Record<string, string>,
  de: 'De',
  ate: 'Até',
  nenhum: 'Nenhum exame pedido no período.',
  abrir: 'Abrir',
  urgente: 'urgente',
  pront: 'prontuário {p}',
  situacoes: {
    sem_laudo: 'Sem laudo',
    rascunho: 'Rascunho',
    em_revisao: 'Em revisão',
    liberado: 'Liberado',
    retificado: 'Retificado',
    cancelado: 'Cancelado',
  } as Record<string, string>,
  anteriores: 'Laudos anteriores do paciente',
  semAnteriores: 'Nenhum laudo anterior liberado.',
  foraExecucao: 'O exame pedido foi cancelado ou recusado: o laudo fica só para leitura.',
  liberadoEm: 'Laudo liberado em {d}: não muda mais.',
  corrigidos: '{n} achado(s) corrigido(s) no histórico',
  escolha: 'Escolha',
  semValor: 'Não informado',
  tipoMamografia: 'Tipo de mamografia',
  palpavel: 'Nódulo palpável',
  historico: 'Histórico familiar de câncer de mama',
  anterior: 'Mamografia anterior',
  anoAnterior: 'Ano da mamografia anterior',
  direita: 'Mama direita',
  esquerda: 'Mama esquerda',
  composicao: 'Composição',
  categoria: 'Categoria final',
  achados: 'Achados',
  incluirAchado: 'Incluir achado',
  retirar: 'Retirar',
  lado: 'Mama',
  quadrante: 'Quadrante',
  tipoAchado: 'Tipo',
  catAchado: 'Categoria do achado',
  tamanho: 'Tamanho (mm)',
  horas: 'Posição (horas)',
  forma: 'Forma',
  contorno: 'Contorno',
  densidade: 'Densidade',
  morfologia: 'Morfologia da calcificação',
  distribuicao: 'Distribuição',
  ultrassom: 'Correlação no ultrassom',
  recomendacao: 'Recomendação',
  sugestao: 'Sugerida pela categoria {c}: {r}',
  usarSugestao: 'Usar a sugestão',
  intervalo: 'Controle em (meses)',
  conclusao: 'Conclusão',
  laudista: 'Médico que assina',
  patologista: 'Patologista',
  tipoExame: 'Tipo de exame',
  coleta: 'Coleta',
  recebido: 'Recebido no laboratório',
  hora: 'Hora',
  dadosClinicos: 'Dados clínicos',
  macroscopia: 'Macroscopia',
  microscopia: 'Microscopia',
  diagnostico: 'Diagnóstico',
  nota: 'Nota',
  adequabilidade: 'Adequabilidade da amostra',
  resultado: 'Resultado',
  grau: 'Grau histológico',
  estruturados: 'Achados estruturados',
  margens: 'Margens',
  tumor: 'Tamanho do tumor (mm)',
  linfEx: 'Linfonodos examinados',
  linfComp: 'Linfonodos comprometidos',
  re: 'Receptor de estrogênio (%)',
  rp: 'Receptor de progesterona (%)',
  her2: 'HER2',
  ki67: 'Ki-67 (%)',
  angio: 'Invasão angiolinfática',
  peri: 'Invasão perineural',
  amostras: 'Amostras',
  incluirAmostra: 'Incluir amostra',
  identificacao: 'Identificação',
  tipoAmostra: 'Tipo',
  descricao: 'Descrição',
  fragmentos: 'Fragmentos',
  dimensoes: 'Dimensões',
  salvar: 'Salvar rascunho',
  liberar: 'Salvar e liberar',
  falta: 'Para liberar falta:',
  gravado: 'Laudo gravado.',
  liberadoMsg: 'Laudo liberado.',
  retificar: 'Retificar o laudo',
  motivoRetificacao: 'Motivo da retificação',
  motivoCurto: 'Diga o motivo (ao menos {n} caracteres).',
  retificadoMsg: 'Laudo retificado: o rascunho novo está aberto para correção.',
  retificados: 'Retificações deste exame',
  retificadoItem: 'Liberado em {l}, retificado em {r}: {m}',
  assinaSessao: 'Quem libera assina: o médico desta sessão, com inscrição ativa no conselho.',
  pecasNenhuma: 'Nenhuma peça enviada pela cirurgia aguardando recebimento no período.',
  cirurgia: 'Cirurgia {n} · {c}',
  pedido: 'Pedido de anatomia patológica',
  semPedido:
    'A paciente não tem pedido de anatomia patológica aberto: faça o pedido antes de receber a peça.',
  receber: 'Receber a peça',
  recebidoMsg: 'Peça recebida: laudo {n} aberto.',
  siscanNenhum: 'Nenhum laudo de mamografia liberado no período.',
  baixar: 'Baixar CSV',
  numeroLaudo: 'Laudo {n}',
  sim: 'Sim',
  nao: 'Não',
};

const ROTULOS: Record<string, string> = {
  rastreamento: 'Rastreamento',
  diagnostica: 'Diagnóstica',
  adiposa: 'Adiposa',
  fibroglandular_esparsa: 'Densidades fibroglandulares esparsas',
  heterogeneamente_densa: 'Heterogeneamente densa',
  extremamente_densa: 'Extremamente densa',
  rotina: 'Rotina',
  controle_radiologico: 'Controle radiológico',
  complementacao: 'Avaliação complementar',
  biopsia: 'Biópsia',
  tratamento: 'Tratamento',
  direita: 'Direita',
  esquerda: 'Esquerda',
  superior_lateral: 'Superior lateral',
  superior_medial: 'Superior medial',
  inferior_lateral: 'Inferior lateral',
  inferior_medial: 'Inferior medial',
  central: 'Central',
  retroareolar: 'Retroareolar',
  prolongamento_axilar: 'Prolongamento axilar',
  axila: 'Axila',
  nodulo: 'Nódulo',
  calcificacao: 'Calcificação',
  assimetria: 'Assimetria',
  assimetria_focal: 'Assimetria focal',
  assimetria_global: 'Assimetria global',
  distorcao_arquitetural: 'Distorção arquitetural',
  linfonodo: 'Linfonodo',
  implante: 'Implante',
  dilatacao_ductal: 'Dilatação ductal',
  achado_benigno: 'Achado benigno',
  outro: 'Outro',
  oval: 'Oval',
  redonda: 'Redonda',
  irregular: 'Irregular',
  circunscrito: 'Circunscrito',
  microlobulado: 'Microlobulado',
  obscurecido: 'Obscurecido',
  indistinto: 'Indistinto',
  espiculado: 'Espiculado',
  alta: 'Alta',
  igual: 'Igual',
  baixa: 'Baixa',
  contendo_gordura: 'Contendo gordura',
  difusa: 'Difusa',
  regional: 'Regional',
  agrupada: 'Agrupada',
  linear: 'Linear',
  segmentar: 'Segmentar',
  citopatologia: 'Citopatologia',
  histopatologia: 'Histopatologia',
  imuno_histoquimica: 'Imuno-histoquímica',
  congelacao: 'Congelação',
  revisao_lamina: 'Revisão de lâmina',
  satisfatoria: 'Satisfatória',
  insatisfatoria: 'Insatisfatória',
  limitada: 'Limitada',
  negativo: 'Negativo',
  benigno: 'Benigno',
  atipico: 'Atípico',
  suspeito: 'Suspeito',
  maligno: 'Maligno',
  indeterminado: 'Indeterminado',
  peca: 'Peça',
  fragmento: 'Fragmento',
  bloco: 'Bloco',
  lamina: 'Lâmina',
  esfregaco: 'Esfregaço',
  liquido: 'Líquido',
  livres: 'Livres',
  exiguas: 'Exíguas',
  comprometidas: 'Comprometidas',
  nao_avaliaveis: 'Não avaliáveis',
};
const rotulo = (v: string) => ROTULOS[v] ?? v;

const cliente = useQueryClient();
const { permissoes } = usarSessao();
const podeRedigir = computed(() => permissoes.value.has('sadt.laudo.criar'));
const podeLiberar = computed(() => permissoes.value.has('sadt.laudo.assinar'));

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hoje = new Date();
const aba = ref<TipoLaudoEspecializado | 'pecas' | 'siscan'>('mama');
const de = ref<string | null>(iso(new Date(hoje.getTime() - 7 * 86_400_000)));
const ate = ref<string | null>(iso(hoje));
const itemAberto = ref<number | null>(null);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const periodo = computed(() => !!de.value && !!ate.value && de.value <= ate.value);

const fila = useQuery({
  queryKey: computed(() => ['sadt', 'laudos-especializados', 'fila', aba.value, de.value, ate.value]),
  queryFn: () => lerFilaLaudoEspecializado(aba.value as TipoLaudoEspecializado, de.value!, ate.value!),
  enabled: computed(() => periodo.value && (aba.value === 'mama' || aba.value === 'anatomopatologico')),
});
const pecas = useQuery({
  queryKey: computed(() => ['sadt', 'laudos-especializados', 'pecas', de.value, ate.value]),
  queryFn: () => lerPecasEnviadas(de.value!, ate.value!),
  enabled: computed(() => periodo.value && aba.value === 'pecas'),
});
const siscan = useQuery({
  queryKey: computed(() => ['sadt', 'laudos-especializados', 'siscan', de.value, ate.value]),
  queryFn: () => lerFichasSiscan(de.value!, ate.value!),
  enabled: computed(() => periodo.value && aba.value === 'siscan'),
});
const mama = useQuery({
  queryKey: computed(() => ['sadt', 'laudos-especializados', 'mama', itemAberto.value]),
  queryFn: async () => {
    const x = await abrirExameMama(itemAberto.value!);
    preencherMama(x);
    return x;
  },
  enabled: computed(() => aba.value === 'mama' && itemAberto.value !== null),
});
const ap = useQuery({
  queryKey: computed(() => ['sadt', 'laudos-especializados', 'ap', itemAberto.value]),
  queryFn: async () => {
    const x = await abrirExameAnatomopatologico(itemAberto.value!);
    preencherAp(x);
    return x;
  },
  enabled: computed(() => aba.value === 'anatomopatologico' && itemAberto.value !== null),
});
const xm = computed(() => (aba.value === 'mama' ? mama.data.value : undefined));
const xa = computed(() => (aba.value === 'anatomopatologico' ? ap.data.value : undefined));
const aberto = computed(() => xm.value ?? xa.value);
const laudoAtual = computed(() => xm.value?.laudo ?? xa.value?.laudo ?? null);
const editavel = computed(
  () =>
    podeRedigir.value &&
    (aberto.value?.emExecucao ?? false) &&
    (!laudoAtual.value || ['rascunho', 'em_revisao'].includes(laudoAtual.value.situacao)),
);

// ── Utilidades de forma ──
const t = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const numero = (v: string): number | null => {
  const s = v.trim().replace(',', '.');
  return s === '' ? null : Number(s);
};
const ou = (v: string) => v.trim() || null;
const idOu = (v: string) => (v ? Number(v) : null);
const op = (l: { id: string }[] | undefined, vazio: string | null) => [
  ...(vazio === null ? [] : [{ valor: '', rotulo: vazio }]),
  ...(l ?? []).map((o) => ({ valor: o.id, rotulo: rotulo(o.id) })),
];
const opProf = (l: { id: number; rotulo: string }[] | undefined) => [
  { valor: '', rotulo: M.escolha },
  ...(l ?? []).map((p) => ({ valor: String(p.id), rotulo: p.rotulo })),
];
const opSimNao = [
  { valor: '', rotulo: M.semValor },
  { valor: 'sim', rotulo: M.sim },
  { valor: 'nao', rotulo: M.nao },
];
const simNao = (v: string) => (v === '' ? null : v === 'sim');
const simNaoTexto = (v: unknown) => (v === true ? 'sim' : v === false ? 'nao' : '');
const instante = (d: string | null, h: string | null) => {
  if (!d) return null;
  const x = new Date(`${d}T${h || '00:00'}:00`);
  return Number.isNaN(x.getTime()) ? null : x.toISOString();
};
const hhmm = (s: string | null) => {
  if (!s) return null;
  const d = new Date(s);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const dia = (s: string | null) => (s ? iso(new Date(s)) : null);
const quando = (s: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
const tr = (s: string, v: Record<string, string | number>) =>
  Object.entries(v).reduce((a, [k, x]) => a.replace(`{${k}}`, String(x)), s);

// ── Mamografia ──
interface LinhaAchado {
  chave: number;
  id?: number;
  lateralidade: string;
  quadrante: string;
  tipo: string;
  categoria: string;
  tamanho: string;
  horas: string;
  forma: string;
  contorno: string;
  densidade: string;
  morfologia: string;
  distribuicao: string;
  ultrassom: boolean;
  descricao: string;
}
let chaves = 0;
const fm = reactive({
  tipo: 'rastreamento',
  palpavel: false,
  historico: false,
  anterior: false,
  anoAnterior: '',
  compD: '',
  compE: '',
  catD: '',
  catE: '',
  recomendacao: '',
  intervalo: '',
  conclusao: '',
  laudista: '',
  achados: [] as LinhaAchado[],
});
function preencherMama(x: ExameMama): void {
  const l = x.laudo;
  Object.assign(fm, {
    tipo: l?.tipoMamografia ?? 'rastreamento',
    palpavel: l?.noduloPalpavel ?? false,
    historico: l?.historicoFamiliar ?? false,
    anterior: l?.mamografiaAnterior ?? false,
    anoAnterior: t(l?.mamografiaAnteriorAno),
    compD: l?.composicaoDireita ?? '',
    compE: l?.composicaoEsquerda ?? '',
    catD: l?.categoriaDireita ?? '',
    catE: l?.categoriaEsquerda ?? '',
    recomendacao: l?.recomendacao ?? '',
    intervalo: t(l?.intervaloControleMeses),
    conclusao: l?.conclusao ?? '',
    laudista: t(l?.laudista ?? x.opcoes.assinante),
    achados: x.achados.map((a) => ({
      chave: ++chaves,
      id: a.id,
      lateralidade: a.lateralidade,
      quadrante: a.quadrante ?? '',
      tipo: a.tipo,
      categoria: a.categoria ?? '',
      tamanho: t(a.tamanhoMm),
      horas: t(a.posicaoHoraria),
      forma: a.forma ?? '',
      contorno: a.contorno ?? '',
      densidade: a.densidade ?? '',
      morfologia: a.morfologiaCalcificacao ?? '',
      distribuicao: a.distribuicaoCalcificacao ?? '',
      ultrassom: a.correlacaoUltrassom,
      descricao: a.descricao ?? '',
    })),
  });
}
const achadosPedido = computed(() =>
  fm.achados.map((a) => ({
    ...(a.id ? { id: a.id } : {}),
    lateralidade: a.lateralidade,
    quadrante: ou(a.quadrante),
    tipo: a.tipo,
    categoria: ou(a.categoria),
    tamanhoMm: numero(a.tamanho),
    posicaoHoraria: numero(a.horas),
    distanciaMamiloMm: null,
    forma: a.tipo === 'nodulo' ? ou(a.forma) : null,
    contorno: a.tipo === 'nodulo' ? ou(a.contorno) : null,
    densidade: a.tipo === 'nodulo' ? ou(a.densidade) : null,
    morfologiaCalcificacao: a.tipo === 'calcificacao' ? ou(a.morfologia) : null,
    distribuicaoCalcificacao: a.tipo === 'calcificacao' ? ou(a.distribuicao) : null,
    correlacaoUltrassom: a.ultrassom,
    descricao: ou(a.descricao),
  })),
);
const pedidoMama = computed(() => ({
  tipoMamografia: fm.tipo,
  noduloPalpavel: fm.palpavel,
  historicoFamiliar: fm.historico,
  mamografiaAnterior: fm.anterior,
  mamografiaAnteriorAno: numero(fm.anoAnterior),
  composicaoDireita: ou(fm.compD),
  composicaoEsquerda: ou(fm.compE),
  categoriaDireita: ou(fm.catD),
  categoriaEsquerda: ou(fm.catE),
  recomendacao: ou(fm.recomendacao),
  intervaloControleMeses: numero(fm.intervalo),
  conclusao: ou(fm.conclusao),
  laudista: idOu(fm.laudista),
}));
const dominioMama = computed<LaudoMama>(() => ({
  ...pedidoMama.value,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- descarta o id
  achados: achadosPedido.value.map(({ id: _i, ...a }) => a as AchadoMama),
}));
const anoAtual = hoje.getFullYear();
const problemasMama = computed(() => conferirLaudoMama(dominioMama.value, 'rascunho', anoAtual));
const faltaMama = computed(() =>
  conferirLaudoMama(dominioMama.value, 'liberar', anoAtual).filter(
    (p) => !problemasMama.value.some((q) => q.campo === p.campo && q.mensagem === p.mensagem),
  ),
);
const alertasMama = computed(() => alertasLaudoMama(dominioMama.value));
const piorCategoria = computed(() => categoriaMaisGrave([ou(fm.catD), ou(fm.catE)]));
const sugestao = computed(() => condutaDaCategoria(piorCategoria.value));
function usarSugestao(): void {
  if (!sugestao.value) return;
  fm.recomendacao = sugestao.value.recomendacao;
  fm.intervalo = t(sugestao.value.intervaloMeses);
}
const opCategoria = computed(() => [
  { valor: '', rotulo: M.semValor },
  ...(xm.value?.opcoes.categorias ?? []).map((c) => ({
    valor: c.categoria,
    rotulo: `${c.categoria} · ${c.rotulo}`,
  })),
]);
const novaLinhaAchado = (): LinhaAchado => ({
  chave: ++chaves,
  lateralidade: 'direita',
  quadrante: '',
  tipo: 'nodulo',
  categoria: '',
  tamanho: '',
  horas: '',
  forma: '',
  contorno: '',
  densidade: '',
  morfologia: '',
  distribuicao: '',
  ultrassom: false,
  descricao: '',
});
const opLado = [
  { valor: 'direita', rotulo: M.direita },
  { valor: 'esquerda', rotulo: M.esquerda },
];
const problemasDe = (prefixo: string, i: number, lista: { campo: string; mensagem: string }[]) =>
  lista.filter((p) => p.campo.startsWith(`${prefixo}.${i}.`)).map((p) => p.mensagem);

// ── Anatomia patológica ──
interface LinhaAmostra {
  chave: number;
  id?: number;
  tipo: string;
  identificacao: string;
  descricao: string;
  fragmentos: string;
  dimensoes: string;
  fixador: string;
  coloracao: string;
}
const fa = reactive({
  tipo: 'histopatologia',
  coletaDia: null as string | null,
  coletaHora: null as string | null,
  recebidoDia: null as string | null,
  recebidoHora: null as string | null,
  dadosClinicos: '',
  macroscopia: '',
  microscopia: '',
  diagnostico: '',
  conclusao: '',
  nota: '',
  grau: '',
  adequabilidade: '',
  resultado: '',
  patologista: '',
  margens: '',
  tumor: '',
  linfEx: '',
  linfComp: '',
  re: '',
  rp: '',
  her2: '',
  ki67: '',
  angio: '',
  peri: '',
  amostras: [] as LinhaAmostra[],
});
function preencherAp(x: ExameAnatomopatologico): void {
  const l = x.laudo;
  const d = (l?.dados ?? {}) as Record<string, unknown>;
  const tx = (k: string) => (d[k] === null || d[k] === undefined ? '' : String(d[k]));
  Object.assign(fa, {
    tipo: l?.tipoExame ?? 'histopatologia',
    coletaDia: dia(l?.coletaEm ?? null),
    coletaHora: hhmm(l?.coletaEm ?? null),
    recebidoDia: dia(l?.recebidoEm ?? null) ?? iso(new Date()),
    recebidoHora: hhmm(l?.recebidoEm ?? null),
    dadosClinicos: l?.dadosClinicos ?? '',
    macroscopia: l?.macroscopia ?? '',
    microscopia: l?.microscopia ?? '',
    diagnostico: l?.diagnostico ?? '',
    conclusao: l?.conclusao ?? '',
    nota: l?.nota ?? '',
    grau: t(l?.grauHistologico),
    adequabilidade: l?.adequabilidade ?? '',
    resultado: l?.resultado ?? '',
    patologista: t(l?.patologista ?? x.opcoes.assinante),
    margens: tx('margens'),
    tumor: tx('tamanhoTumorMm'),
    linfEx: tx('linfonodosExaminados'),
    linfComp: tx('linfonodosComprometidos'),
    re: tx('receptorEstrogenioPercentual'),
    rp: tx('receptorProgesteronaPercentual'),
    her2: tx('her2'),
    ki67: tx('ki67Percentual'),
    angio: simNaoTexto(d['invasaoAngiolinfatica']),
    peri: simNaoTexto(d['invasaoPerineural']),
    amostras: x.amostras.map((a) => ({
      chave: ++chaves,
      id: a.id,
      tipo: a.tipo,
      identificacao: a.identificacao,
      descricao: a.descricao ?? '',
      fragmentos: t(a.quantidadeFragmentos),
      dimensoes: a.dimensoes ?? '',
      fixador: a.fixador ?? '',
      coloracao: a.coloracao ?? '',
    })),
  });
}
const amostrasPedido = computed(() =>
  fa.amostras.map((a) => ({
    ...(a.id ? { id: a.id } : {}),
    tipo: a.tipo,
    identificacao: a.identificacao.trim().toUpperCase(),
    descricao: ou(a.descricao),
    quantidadeFragmentos: numero(a.fragmentos),
    dimensoes: ou(a.dimensoes),
    fixador: ou(a.fixador),
    coloracao: ou(a.coloracao),
  })),
);
const pedidoAp = computed(() => ({
  tipoExame: fa.tipo,
  coletaEm: instante(fa.coletaDia, fa.coletaHora),
  recebidoEm: instante(fa.recebidoDia, fa.recebidoHora),
  dadosClinicos: ou(fa.dadosClinicos),
  macroscopia: ou(fa.macroscopia),
  microscopia: ou(fa.microscopia),
  diagnostico: ou(fa.diagnostico),
  conclusao: ou(fa.conclusao),
  nota: ou(fa.nota),
  grauHistologico: idOu(fa.grau),
  adequabilidade: ou(fa.adequabilidade),
  resultado: ou(fa.resultado),
  patologista: idOu(fa.patologista),
  dados: {
    margens: ou(fa.margens),
    tamanhoTumorMm: numero(fa.tumor),
    invasaoAngiolinfatica: simNao(fa.angio),
    invasaoPerineural: simNao(fa.peri),
    linfonodosExaminados: numero(fa.linfEx),
    linfonodosComprometidos: numero(fa.linfComp),
    receptorEstrogenioPercentual: numero(fa.re),
    receptorProgesteronaPercentual: numero(fa.rp),
    her2: ou(fa.her2),
    ki67Percentual: numero(fa.ki67),
  },
}));
const dominioAp = computed<LaudoAnatomopatologico>(() => ({
  ...pedidoAp.value,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- descarta o id
  amostras: amostrasPedido.value.map(({ id: _i, ...a }) => a),
}));
const problemasAp = computed(() => conferirLaudoAnatomopatologico(dominioAp.value, 'rascunho'));
const faltaAp = computed(() =>
  conferirLaudoAnatomopatologico(dominioAp.value, 'liberar').filter(
    (p) => !problemasAp.value.some((q) => q.campo === p.campo && q.mensagem === p.mensagem),
  ),
);
const alertasAp = computed(() => alertasLaudoAnatomopatologico(dominioAp.value));
const novaLinhaAmostra = (): LinhaAmostra => ({
  chave: ++chaves,
  tipo: 'fragmento',
  identificacao: String.fromCharCode(65 + (fa.amostras.length % 26)),
  descricao: '',
  fragmentos: '',
  dimensoes: '',
  fixador: '',
  coloracao: '',
});
const opGrau = computed(() => [
  { valor: '', rotulo: M.semValor },
  ...(xa.value?.opcoes.graus ?? []).map((g) => ({ valor: String(g.id), rotulo: g.rotulo })),
]);

const problemas = computed(() => (aba.value === 'mama' ? problemasMama.value : problemasAp.value));
const falta = computed(() => (aba.value === 'mama' ? faltaMama.value : faltaAp.value));
const alertas = computed(() => (aba.value === 'mama' ? alertasMama.value : alertasAp.value));
const problemasGerais = computed(() =>
  problemas.value.filter((p) => !p.campo.startsWith('achados.') && !p.campo.startsWith('amostras.')),
);

// ── Peças da cirurgia ──
const escolhaPedido = reactive<Record<number, string>>({});
const pedidoDe = (descricao: number, pedidos: { item: number }[]) =>
  escolhaPedido[descricao] ?? (pedidos.length === 1 ? String(pedidos[0]!.item) : '');

// ── Ações ──
async function rodar(fn: () => Promise<unknown>): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    await fn();
    await cliente.invalidateQueries({ queryKey: ['sadt', 'laudos-especializados'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const trocarAba = (a: typeof aba.value) => {
  aba.value = a;
  itemAberto.value = null;
  mensagem.value = null;
  erro.value = null;
};
const abrir = (item: number) => {
  mensagem.value = null;
  erro.value = null;
  itemAberto.value = item;
};
const gravar = () => {
  const versao = laudoAtual.value ? { versao: laudoAtual.value.versao } : {};
  return aba.value === 'mama'
    ? salvarLaudoMama(itemAberto.value!, { ...pedidoMama.value, ...versao, achados: achadosPedido.value })
    : salvarLaudoAnatomopatologico(itemAberto.value!, {
        ...pedidoAp.value,
        ...versao,
        amostras: amostrasPedido.value,
      });
};
const salvar = () =>
  rodar(async () => {
    await gravar();
    mensagem.value = M.gravado;
  });
const salvarELiberar = () =>
  rodar(async () => {
    const s = await gravar();
    await (aba.value === 'mama'
      ? liberarLaudoMama(s.id, s.versao)
      : liberarLaudoAnatomopatologico(s.id, s.versao));
    mensagem.value = M.liberadoMsg;
  });
// ── Retificação (só o liberado; com motivo; o novo rascunho abre no lugar) ──
const motivo = ref('');
const podeRetificar = computed(
  () => podeLiberar.value && laudoAtual.value?.situacao === 'liberado' && (aberto.value?.emExecucao ?? false),
);
const motivoCurto = computed(() => motivo.value.trim().length < MOTIVO_RETIFICACAO_MINIMO);
const retificar = () =>
  rodar(async () => {
    const l = laudoAtual.value!;
    await (aba.value === 'mama'
      ? retificarLaudoMama(l.id, l.versao, motivo.value.trim())
      : retificarLaudoAnatomopatologico(l.id, l.versao, motivo.value.trim()));
    motivo.value = '';
    mensagem.value = M.retificadoMsg;
  });
const receber = (descricao: number, pedidos: { item: number }[]) =>
  rodar(async () => {
    const r = await receberPeca(descricao, Number(pedidoDe(descricao, pedidos)));
    mensagem.value = tr(M.recebidoMsg, { n: r.numero });
  });

function baixarCsv(): void {
  const fichas = siscan.data.value?.fichas ?? [];
  const cab = [
    'laudo',
    'paciente',
    'prontuario',
    'indicacao',
    'nodulo_palpavel',
    'risco_elevado',
    'mamografia_anterior_ano',
    'composicao_direita',
    'categoria_direita',
    'nodulos_direita',
    'microcalcificacoes_direita',
    'composicao_esquerda',
    'categoria_esquerda',
    'nodulos_esquerda',
    'microcalcificacoes_esquerda',
    'recomendacao',
    'intervalo_meses',
    'liberado_em',
  ];
  const linhas = fichas.map((f) =>
    [
      f.laudo,
      f.paciente,
      f.prontuario ?? '',
      f.indicacao,
      f.noduloPalpavel ? 'S' : 'N',
      f.riscoElevadoHistoricoFamiliar ? 'S' : 'N',
      f.mamografiaAnteriorAno ?? '',
      f.direita.composicao ?? '',
      f.direita.categoria ?? '',
      f.direita.nodulos,
      f.direita.microcalcificacoes,
      f.esquerda.composicao ?? '',
      f.esquerda.categoria ?? '',
      f.esquerda.nodulos,
      f.esquerda.microcalcificacoes,
      f.recomendacao ?? '',
      f.intervaloControleMeses ?? '',
      f.liberadoEm ?? '',
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(';'),
  );
  const blob = new Blob([[cab.join(';'), ...linhas].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `siscan-mamografia-${de.value}-${ate.value}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
</script>

<template>
  <main class="tela" data-testid="laudo-mama-patologia">
    <h1>{{ M.titulo }}</h1>
    <nav class="linha" :aria-label="M.rotuloAbas">
      <SanteBotao
        v-for="a in ['mama', 'anatomopatologico', 'pecas', 'siscan'] as const"
        :key="a"
        :variante="aba === a ? 'primario' : 'texto'"
        :rotulo="M.abas[a]!"
        :data-testid="`lmp-aba-${a}`"
        @acionar="trocarAba(a)"
      />
    </nav>
    <ErroSadt v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="lmp-mensagem">{{ mensagem }}</p>
    <div class="linha">
      <SanteData v-model="de" :rotulo="M.de" editavel data-testid="lmp-de" />
      <SanteData v-model="ate" :rotulo="M.ate" editavel data-testid="lmp-ate" />
    </div>

    <!-- Peças enviadas pela cirurgia -->
    <section v-if="aba === 'pecas'" data-testid="lmp-pecas">
      <ErroSadt v-if="pecas.isError.value" :erro="pecas.error.value" />
      <p v-if="pecas.data.value && !pecas.data.value.pecas.length">{{ M.pecasNenhuma }}</p>
      <ul class="lista">
        <li
          v-for="p in pecas.data.value?.pecas ?? []"
          :key="p.descricao"
          :data-testid="`lmp-peca-${p.descricao}`"
        >
          <strong>{{ p.paciente }}</strong>
          <span v-if="p.prontuario"> · {{ tr(M.pront, { p: p.prontuario }) }}</span>
          <div>{{ tr(M.cirurgia, { n: p.cirurgia, c: p.cirurgiao }) }} · {{ quando(p.realizadaEm) }}</div>
          <div>{{ p.pecas }}</div>
          <p v-if="!p.pedidos.length" class="erro-campo">{{ M.semPedido }}</p>
          <div v-else class="linha">
            <SanteSelecao
              :model-value="pedidoDe(p.descricao, p.pedidos)"
              :rotulo="M.pedido"
              :opcoes="[
                { valor: '', rotulo: M.escolha },
                ...p.pedidos.map((x) => ({ valor: String(x.item), rotulo: `${x.numero} · ${x.exame}` })),
              ]"
              :data-testid="`lmp-peca-pedido-${p.descricao}`"
              @update:model-value="(v: string) => (escolhaPedido[p.descricao] = v)"
            />
            <SanteBotao
              v-if="podeRedigir"
              :rotulo="M.receber"
              :desabilitado="ocupado || !pedidoDe(p.descricao, p.pedidos)"
              :data-testid="`lmp-peca-receber-${p.descricao}`"
              @acionar="receber(p.descricao, p.pedidos)"
            />
          </div>
        </li>
      </ul>
    </section>

    <!-- Fichas do SISCAN -->
    <section v-else-if="aba === 'siscan'" data-testid="lmp-siscan">
      <ErroSadt v-if="siscan.isError.value" :erro="siscan.error.value" />
      <p v-if="siscan.data.value && !siscan.data.value.fichas.length">{{ M.siscanNenhum }}</p>
      <template v-else-if="siscan.data.value">
        <SanteBotao :rotulo="M.baixar" data-testid="lmp-siscan-baixar" @acionar="baixarCsv" />
        <table>
          <thead>
            <tr>
              <th>{{ M.abas['mama'] }}</th>
              <th>{{ M.direita }}</th>
              <th>{{ M.esquerda }}</th>
              <th>{{ M.recomendacao }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in siscan.data.value.fichas" :key="f.laudo" :data-testid="`lmp-siscan-${f.laudo}`">
              <td>{{ f.paciente }} · {{ quando(f.liberadoEm) }}</td>
              <td>{{ f.direita.categoria ?? '—' }}</td>
              <td>{{ f.esquerda.categoria ?? '—' }}</td>
              <td>{{ f.recomendacao ? rotulo(f.recomendacao) : '' }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>

    <!-- Mamografia e anatomia patológica -->
    <div v-else class="colunas">
      <section class="fila" aria-labelledby="lmp-fila">
        <h2 id="lmp-fila">{{ M.abas[aba] }}</h2>
        <ErroSadt v-if="fila.isError.value" :erro="fila.error.value" />
        <p v-if="fila.data.value && !fila.data.value.exames.length">{{ M.nenhum }}</p>
        <ul class="lista" data-testid="lmp-fila">
          <li
            v-for="e in fila.data.value?.exames ?? []"
            :key="e.item"
            :aria-current="e.item === itemAberto"
            :data-testid="`lmp-item-${e.item}`"
          >
            <strong>{{ e.paciente }}</strong>
            <span v-if="e.urgente" class="selo"> · {{ M.urgente }}</span>
            <div>{{ e.exame }} · {{ quando(e.solicitadoEm) }}</div>
            <div :data-testid="`lmp-situacao-${e.item}`" :data-situacao="e.situacao">
              {{ M.situacoes[e.situacao] ?? e.situacao }}
              <span v-if="e.categoria"> · {{ M.categoria }} {{ e.categoria }}</span>
              <span v-if="e.resultado"> · {{ rotulo(e.resultado) }}</span>
            </div>
            <SanteBotao
              variante="texto"
              :rotulo="M.abrir"
              :data-testid="`lmp-abrir-${e.item}`"
              @acionar="abrir(e.item)"
            />
          </li>
        </ul>
      </section>

      <section v-if="aberto" class="laudo" data-testid="lmp-laudo">
        <h2>
          {{ aberto.exame.paciente }}
          <small v-if="aberto.exame.prontuario">{{ tr(M.pront, { p: aberto.exame.prontuario }) }}</small>
        </h2>
        <p>
          {{ aberto.exame.exame }} · {{ aberto.exame.numero }}
          <span v-if="xa?.laudo"> · {{ tr(M.numeroLaudo, { n: xa.laudo.numero }) }}</span>
        </p>
        <p data-testid="lmp-laudo-situacao" :data-situacao="laudoAtual?.situacao ?? 'sem_laudo'">
          {{ M.situacoes[laudoAtual?.situacao ?? 'sem_laudo'] }}
          <span v-if="xm?.achadosCorrigidos"> · {{ tr(M.corrigidos, { n: xm.achadosCorrigidos }) }}</span>
        </p>
        <p v-if="!aberto.emExecucao">{{ M.foraExecucao }}</p>
        <p v-if="laudoAtual?.situacao === 'liberado'" data-testid="lmp-liberado">
          {{ tr(M.liberadoEm, { d: quando(laudoAtual.liberadoEm) }) }}
        </p>
        <div v-if="podeRetificar" data-testid="lmp-retificacao">
          <SanteCampoTexto
            v-model="motivo"
            :rotulo="M.motivoRetificacao"
            :max-bytes="500"
            multilinha
            data-testid="lmp-motivo-retificacao"
          />
          <p v-if="motivo && motivoCurto" class="erro-campo" data-testid="lmp-motivo-curto">
            {{ tr(M.motivoCurto, { n: MOTIVO_RETIFICACAO_MINIMO }) }}
          </p>
          <SanteBotao
            variante="texto"
            :rotulo="M.retificar"
            :desabilitado="ocupado || motivoCurto"
            data-testid="lmp-retificar"
            @acionar="retificar"
          />
        </div>
        <details v-if="aberto.retificados.length" data-testid="lmp-retificados">
          <summary>{{ M.retificados }} ({{ aberto.retificados.length }})</summary>
          <ul>
            <li v-for="r in aberto.retificados" :key="r.id">
              {{
                tr(M.retificadoItem, {
                  l: quando(r.liberadoEm),
                  r: quando(r.retificadoEm),
                  m: r.motivo ?? '',
                })
              }}
            </li>
          </ul>
        </details>
        <ul v-if="alertas.length" class="alertas">
          <li v-for="a in alertas" :key="a" class="erro-campo" data-testid="lmp-alerta">{{ a }}</li>
        </ul>
        <details data-testid="lmp-anteriores">
          <summary>{{ M.anteriores }} ({{ aberto.anteriores.length }})</summary>
          <p v-if="!aberto.anteriores.length">{{ M.semAnteriores }}</p>
          <ul>
            <template v-if="xm">
              <li v-for="a in xm.anteriores" :key="a.id">
                {{ quando(a.liberadoEm) }} · {{ M.siglaDireita }} {{ a.categoriaDireita ?? '—' }} ·
                {{ M.siglaEsquerda }}
                {{ a.categoriaEsquerda ?? '—' }} · {{ a.recomendacao ? rotulo(a.recomendacao) : '' }}
              </li>
            </template>
            <template v-if="xa">
              <li v-for="a in xa.anteriores" :key="a.id">
                {{ a.numero }} · {{ rotulo(a.tipoExame) }} · {{ a.resultado ? rotulo(a.resultado) : '' }} ·
                {{ quando(a.liberadoEm) }}
              </li>
            </template>
          </ul>
        </details>

        <!-- Formulário da mamografia -->
        <template v-if="xm">
          <fieldset :disabled="!editavel" class="grade">
            <SanteSelecao
              v-model="fm.tipo"
              :rotulo="M.tipoMamografia"
              :opcoes="op(xm.opcoes.tipos, null)"
              data-testid="lmp-mama-tipo"
            />
            <label
              ><input v-model="fm.palpavel" type="checkbox" data-testid="lmp-mama-palpavel" />
              {{ M.palpavel }}</label
            >
            <label
              ><input v-model="fm.historico" type="checkbox" data-testid="lmp-mama-historico" />
              {{ M.historico }}</label
            >
            <label
              ><input v-model="fm.anterior" type="checkbox" data-testid="lmp-mama-anterior" />
              {{ M.anterior }}</label
            >
            <SanteCampoTexto
              v-if="fm.anterior"
              v-model="fm.anoAnterior"
              :rotulo="M.anoAnterior"
              :max-bytes="4"
              data-testid="lmp-mama-ano"
            />
          </fieldset>
          <fieldset :disabled="!editavel" class="grade">
            <legend>{{ M.direita }} / {{ M.esquerda }}</legend>
            <SanteSelecao
              v-model="fm.compD"
              :rotulo="`${M.composicao} (${M.direita})`"
              :opcoes="op(xm.opcoes.composicoes, M.semValor)"
              data-testid="lmp-mama-comp-d"
            />
            <SanteSelecao
              v-model="fm.catD"
              :rotulo="`${M.categoria} (${M.direita})`"
              :opcoes="opCategoria"
              data-testid="lmp-mama-cat-d"
            />
            <SanteSelecao
              v-model="fm.compE"
              :rotulo="`${M.composicao} (${M.esquerda})`"
              :opcoes="op(xm.opcoes.composicoes, M.semValor)"
              data-testid="lmp-mama-comp-e"
            />
            <SanteSelecao
              v-model="fm.catE"
              :rotulo="`${M.categoria} (${M.esquerda})`"
              :opcoes="opCategoria"
              data-testid="lmp-mama-cat-e"
            />
          </fieldset>
          <fieldset :disabled="!editavel" data-testid="lmp-mama-achados">
            <legend>{{ M.achados }}</legend>
            <div v-for="(a, i) in fm.achados" :key="a.chave" class="item" :data-testid="`lmp-achado-${i}`">
              <div class="grade">
                <SanteSelecao
                  v-model="a.lateralidade"
                  :rotulo="M.lado"
                  :opcoes="opLado"
                  :data-testid="`lmp-achado-lado-${i}`"
                />
                <SanteSelecao
                  v-model="a.tipo"
                  :rotulo="M.tipoAchado"
                  :opcoes="op(xm.opcoes.tiposAchado, null)"
                  :data-testid="`lmp-achado-tipo-${i}`"
                />
                <SanteSelecao
                  v-model="a.quadrante"
                  :rotulo="M.quadrante"
                  :opcoes="op(xm.opcoes.quadrantes, M.semValor)"
                  :data-testid="`lmp-achado-quadrante-${i}`"
                />
                <SanteSelecao
                  v-model="a.categoria"
                  :rotulo="M.catAchado"
                  :opcoes="opCategoria"
                  :data-testid="`lmp-achado-categoria-${i}`"
                />
                <SanteCampoTexto
                  v-model="a.tamanho"
                  :rotulo="M.tamanho"
                  :max-bytes="7"
                  :data-testid="`lmp-achado-tamanho-${i}`"
                />
                <SanteCampoTexto
                  v-model="a.horas"
                  :rotulo="M.horas"
                  :max-bytes="2"
                  :data-testid="`lmp-achado-horas-${i}`"
                />
                <template v-if="a.tipo === 'nodulo'">
                  <SanteSelecao
                    v-model="a.forma"
                    :rotulo="M.forma"
                    :opcoes="op(xm.opcoes.formas, M.semValor)"
                    :data-testid="`lmp-achado-forma-${i}`"
                  />
                  <SanteSelecao
                    v-model="a.contorno"
                    :rotulo="M.contorno"
                    :opcoes="op(xm.opcoes.contornos, M.semValor)"
                    :data-testid="`lmp-achado-contorno-${i}`"
                  />
                  <SanteSelecao
                    v-model="a.densidade"
                    :rotulo="M.densidade"
                    :opcoes="op(xm.opcoes.densidades, M.semValor)"
                    :data-testid="`lmp-achado-densidade-${i}`"
                  />
                </template>
                <template v-if="a.tipo === 'calcificacao'">
                  <SanteCampoTexto
                    v-model="a.morfologia"
                    :rotulo="M.morfologia"
                    :max-bytes="60"
                    :data-testid="`lmp-achado-morfologia-${i}`"
                  />
                  <SanteSelecao
                    v-model="a.distribuicao"
                    :rotulo="M.distribuicao"
                    :opcoes="op(xm.opcoes.distribuicoes, M.semValor)"
                    :data-testid="`lmp-achado-distribuicao-${i}`"
                  />
                </template>
                <label
                  ><input v-model="a.ultrassom" type="checkbox" :data-testid="`lmp-achado-us-${i}`" />
                  {{ M.ultrassom }}</label
                >
              </div>
              <ul>
                <li
                  v-for="p in problemasDe('achados', i, editavel ? problemasMama : [])"
                  :key="p"
                  class="erro-campo"
                >
                  {{ p }}
                </li>
              </ul>
              <SanteBotao
                v-if="editavel"
                variante="texto"
                :rotulo="M.retirar"
                :data-testid="`lmp-achado-retirar-${i}`"
                @acionar="fm.achados.splice(i, 1)"
              />
            </div>
            <SanteBotao
              v-if="editavel"
              variante="texto"
              :rotulo="M.incluirAchado"
              data-testid="lmp-incluir-achado"
              @acionar="fm.achados.push(novaLinhaAchado())"
            />
          </fieldset>
          <fieldset :disabled="!editavel" class="grade">
            <SanteSelecao
              v-model="fm.recomendacao"
              :rotulo="M.recomendacao"
              :opcoes="op(xm.opcoes.recomendacoes, M.semValor)"
              data-testid="lmp-mama-recomendacao"
            />
            <SanteCampoTexto
              v-model="fm.intervalo"
              :rotulo="M.intervalo"
              :max-bytes="2"
              data-testid="lmp-mama-intervalo"
            />
            <p v-if="sugestao && piorCategoria" data-testid="lmp-mama-sugestao">
              {{ tr(M.sugestao, { c: piorCategoria, r: rotulo(sugestao.recomendacao) }) }}
              <SanteBotao
                v-if="editavel && fm.recomendacao !== sugestao.recomendacao"
                variante="texto"
                :rotulo="M.usarSugestao"
                data-testid="lmp-mama-usar-sugestao"
                @acionar="usarSugestao"
              />
            </p>
            <SanteSelecao
              v-model="fm.laudista"
              :rotulo="M.laudista"
              :opcoes="opProf(xm.opcoes.profissionais)"
              busca
              data-testid="lmp-mama-laudista"
            />
            <SanteCampoTexto
              v-model="fm.conclusao"
              :rotulo="M.conclusao"
              :max-bytes="8000"
              multilinha
              data-testid="lmp-mama-conclusao"
            />
          </fieldset>
        </template>

        <!-- Formulário da anatomia patológica -->
        <template v-if="xa">
          <fieldset :disabled="!editavel" class="grade">
            <SanteSelecao
              v-model="fa.tipo"
              :rotulo="M.tipoExame"
              :opcoes="op(xa.opcoes.tiposExame, null)"
              data-testid="lmp-ap-tipo"
            />
            <SanteData v-model="fa.coletaDia" :rotulo="M.coleta" editavel data-testid="lmp-ap-coleta" />
            <SanteHora v-model="fa.coletaHora" :rotulo="M.hora" editavel data-testid="lmp-ap-coleta-hora" />
            <SanteData v-model="fa.recebidoDia" :rotulo="M.recebido" editavel data-testid="lmp-ap-recebido" />
            <SanteHora
              v-model="fa.recebidoHora"
              :rotulo="M.hora"
              editavel
              data-testid="lmp-ap-recebido-hora"
            />
            <SanteSelecao
              v-model="fa.patologista"
              :rotulo="M.patologista"
              :opcoes="opProf(xa.opcoes.profissionais)"
              busca
              data-testid="lmp-ap-patologista"
            />
          </fieldset>
          <fieldset :disabled="!editavel" data-testid="lmp-ap-amostras">
            <legend>{{ M.amostras }}</legend>
            <div
              v-for="(a, i) in fa.amostras"
              :key="a.chave"
              class="item grade"
              :data-testid="`lmp-amostra-${i}`"
            >
              <SanteCampoTexto
                v-model="a.identificacao"
                :rotulo="M.identificacao"
                :max-bytes="30"
                :data-testid="`lmp-amostra-id-${i}`"
              />
              <SanteSelecao
                v-model="a.tipo"
                :rotulo="M.tipoAmostra"
                :opcoes="op(xa.opcoes.tiposAmostra, null)"
                :data-testid="`lmp-amostra-tipo-${i}`"
              />
              <SanteCampoTexto
                v-model="a.descricao"
                :rotulo="M.descricao"
                :max-bytes="1000"
                :data-testid="`lmp-amostra-descricao-${i}`"
              />
              <SanteCampoTexto
                v-model="a.fragmentos"
                :rotulo="M.fragmentos"
                :max-bytes="3"
                :data-testid="`lmp-amostra-fragmentos-${i}`"
              />
              <SanteCampoTexto
                v-model="a.dimensoes"
                :rotulo="M.dimensoes"
                :max-bytes="60"
                :data-testid="`lmp-amostra-dimensoes-${i}`"
              />
              <ul>
                <li
                  v-for="p in problemasDe('amostras', i, editavel ? problemasAp : [])"
                  :key="p"
                  class="erro-campo"
                >
                  {{ p }}
                </li>
              </ul>
              <SanteBotao
                v-if="editavel"
                variante="texto"
                :rotulo="M.retirar"
                :data-testid="`lmp-amostra-retirar-${i}`"
                @acionar="fa.amostras.splice(i, 1)"
              />
            </div>
            <SanteBotao
              v-if="editavel"
              variante="texto"
              :rotulo="M.incluirAmostra"
              data-testid="lmp-incluir-amostra"
              @acionar="fa.amostras.push(novaLinhaAmostra())"
            />
          </fieldset>
          <fieldset :disabled="!editavel" class="grade">
            <SanteCampoTexto
              v-model="fa.dadosClinicos"
              :rotulo="M.dadosClinicos"
              :max-bytes="4000"
              multilinha
              data-testid="lmp-ap-dados-clinicos"
            />
            <SanteCampoTexto
              v-model="fa.macroscopia"
              :rotulo="M.macroscopia"
              :max-bytes="20000"
              multilinha
              data-testid="lmp-ap-macroscopia"
            />
            <SanteCampoTexto
              v-model="fa.microscopia"
              :rotulo="M.microscopia"
              :max-bytes="20000"
              multilinha
              data-testid="lmp-ap-microscopia"
            />
            <SanteSelecao
              v-model="fa.adequabilidade"
              :rotulo="M.adequabilidade"
              :opcoes="op(xa.opcoes.adequabilidades, M.semValor)"
              data-testid="lmp-ap-adequabilidade"
            />
            <SanteSelecao
              v-model="fa.resultado"
              :rotulo="M.resultado"
              :opcoes="op(xa.opcoes.resultados, M.semValor)"
              data-testid="lmp-ap-resultado"
            />
            <SanteSelecao v-model="fa.grau" :rotulo="M.grau" :opcoes="opGrau" data-testid="lmp-ap-grau" />
            <SanteCampoTexto
              v-model="fa.diagnostico"
              :rotulo="M.diagnostico"
              :max-bytes="8000"
              multilinha
              data-testid="lmp-ap-diagnostico"
            />
            <SanteCampoTexto
              v-model="fa.conclusao"
              :rotulo="M.conclusao"
              :max-bytes="8000"
              multilinha
              data-testid="lmp-ap-conclusao"
            />
          </fieldset>
          <fieldset :disabled="!editavel" class="grade">
            <legend>{{ M.estruturados }}</legend>
            <SanteSelecao
              v-model="fa.margens"
              :rotulo="M.margens"
              :opcoes="op(xa.opcoes.margens, M.semValor)"
              data-testid="lmp-ap-margens"
            />
            <SanteCampoTexto v-model="fa.tumor" :rotulo="M.tumor" :max-bytes="7" data-testid="lmp-ap-tumor" />
            <SanteCampoTexto
              v-model="fa.linfEx"
              :rotulo="M.linfEx"
              :max-bytes="3"
              data-testid="lmp-ap-linf-ex"
            />
            <SanteCampoTexto
              v-model="fa.linfComp"
              :rotulo="M.linfComp"
              :max-bytes="3"
              data-testid="lmp-ap-linf-comp"
            />
            <SanteSelecao
              v-model="fa.angio"
              :rotulo="M.angio"
              :opcoes="opSimNao"
              data-testid="lmp-ap-angio"
            />
            <SanteSelecao v-model="fa.peri" :rotulo="M.peri" :opcoes="opSimNao" data-testid="lmp-ap-peri" />
            <SanteCampoTexto v-model="fa.re" :rotulo="M.re" :max-bytes="5" data-testid="lmp-ap-re" />
            <SanteCampoTexto v-model="fa.rp" :rotulo="M.rp" :max-bytes="5" data-testid="lmp-ap-rp" />
            <SanteSelecao
              v-model="fa.her2"
              :rotulo="M.her2"
              :opcoes="op(xa.opcoes.her2, M.semValor)"
              data-testid="lmp-ap-her2"
            />
            <SanteCampoTexto v-model="fa.ki67" :rotulo="M.ki67" :max-bytes="5" data-testid="lmp-ap-ki67" />
          </fieldset>
        </template>

        <ul v-if="editavel && problemasGerais.length" class="problemas">
          <li
            v-for="p in problemasGerais"
            :key="p.campo + p.mensagem"
            class="erro-campo"
            data-testid="lmp-problema"
          >
            {{ p.mensagem }}
          </li>
        </ul>
        <div v-if="editavel" class="linha">
          <SanteBotao
            variante="texto"
            :rotulo="M.salvar"
            :desabilitado="ocupado || problemas.length > 0"
            data-testid="lmp-salvar"
            @acionar="salvar"
          />
          <SanteBotao
            v-if="podeLiberar"
            :rotulo="M.liberar"
            :desabilitado="ocupado || problemas.length > 0 || falta.length > 0"
            data-testid="lmp-liberar"
            @acionar="salvarELiberar"
          />
        </div>
        <p v-if="editavel && podeLiberar" data-testid="lmp-assina-sessao">{{ M.assinaSessao }}</p>
        <div v-if="editavel && falta.length" data-testid="lmp-falta">
          <strong>{{ M.falta }}</strong>
          <ul>
            <li v-for="p in falta" :key="p.campo + p.mensagem" class="erro-campo">{{ p.mensagem }}</li>
          </ul>
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
.item {
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
