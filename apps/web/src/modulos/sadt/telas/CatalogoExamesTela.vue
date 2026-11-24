<script setup lang="ts">
// Catálogo de exames do diagnóstico (F3.5, análise 05-SADT linhas 1 a 3): `/sadt/catalogo`. Uma ficha por exame numa
// tela só, sem abrir janela por vínculo: à esquerda a busca; à direita o exame (inclui e altera com a versão vista), onde
// é feito, o material, o preparo, a lateralidade, os exames ligados e os analitos com a faixa de referência (todas as
// versões, a vigente em destaque) e a fórmula.
// Melhorias: tudo por seletor com busca (setor, material, recipiente, preparo, analito, exame, sexo, modalidade,
// método), nunca por id digitado; as regras do domínio (@sgh/dominio-sadt) conferem cada campo na hora, antes de
// enviar; a faixa traz o estrato completo (sexo, idade, material, método, condição, alerta, crítico e absurdo) e pode
// ir com outras faixas na mesma gravação (para cobrir a idade que sobra); a alteração manda só o que a tela mostra (o
// servidor preserva o resto) e "inativar" manda só id, versão e ativo. Nada se apaga.
import {
  CONDICOES_FAIXA,
  TIPOS_SERVICO_EXAME,
  validarExame,
  validarFormula,
  validarLimitesFaixa,
  type FalhaCatalogo,
} from '@sgh/dominio-sadt';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, reactive, ref } from 'vue';
import { z } from 'zod';
import { enviar, ler } from '../../exames/api-exames.js';
import { novaChave } from '../api-sadt.js';

type Linha = Record<string, unknown>;
type Opcao = { id: number; nome: string };
const B = '/api/sadt/catalogo';
const qualquer = z.any();

/** Os textos da tela (a extração para o i18n do módulo fica com o integrador). */
const T = {
  titulo: 'Catálogo de exames',
  busca: 'Nome, código ou sigla',
  buscarExame: 'Buscar exame',
  tipoServico: 'Tipo de serviço',
  todos: 'Todos',
  buscar: 'Buscar',
  novoExame: 'Novo exame',
  codigo: 'Código',
  sigla: 'Sigla',
  nome: 'Nome',
  nomePopular: 'Nome popular',
  tipo: 'Tipo',
  modalidade: 'Modalidade',
  idadeMin: 'Idade mínima (dias)',
  idadeMax: 'Idade máxima (dias)',
  prazo: 'Prazo (h)',
  limite: 'Limite de pedidos',
  periodo: 'No período (dias)',
  custo: 'Custo unitário',
  exigeLaudo: 'Exige laudo',
  ativo: 'Ativo',
  gravarExame: 'Gravar exame',
  padrao: '(padrão)',
  inativar: 'Inativar',
  faixasFormula: 'Faixas e fórmula',
  inicio: 'Início',
  fim: 'Fim',
  emVigor: 'em vigor',
  sexo: 'Sexo',
  idade: 'Idade (dias)',
  referencia: 'Referência',
  critico: 'Crítico',
  material: 'Material',
  metodo: 'Método',
  condicao: 'Condição',
  refMin: 'Ref. mín.',
  refMax: 'Ref. máx.',
  alertaMin: 'Alerta mín.',
  alertaMax: 'Alerta máx.',
  criticoMin: 'Crítico mín.',
  criticoMax: 'Crítico máx.',
  absurdoMin: 'Absurdo mín.',
  absurdoMax: 'Absurdo máx.',
  texto: 'Texto',
  outraFaixa: 'Mais uma faixa na mesma gravação',
  tirarFaixa: 'Tirar esta faixa',
  novaFaixa: 'Gravar nova versão da faixa',
  descricao: 'Descrição',
  expressao: 'Expressão',
  exprExemplo: 'CT - HDL',
  variavel: 'Variável',
  fonte: 'Fonte',
  analito: 'Analito',
  dadoPaciente: 'Dado do paciente',
  maisVariavel: 'Mais uma variável',
  novaFormula: 'Gravar nova versão da fórmula',
  incluir: 'Incluir',
  qualquer: 'qualquer',
  escolha: 'Escolha',
  semLimite: 'sem limite',
  ate: 'até',
} as const;

const termo = ref('');
const tipo = ref('');
const lista = ref<Linha[]>([]);
const ficha = ref<Linha | null>(null);
const erro = ref('');
const aviso = ref('');
const opcoes = ref<Record<string, Opcao[]>>({});
// Combos (SanteSelecao): o valor vazio é '' (como o formulário sempre mandou); a ficha guarda o valor como veio.
type ValorCombo = string | number | null;
const valorDe = (l: Linha, k: string): ValorCombo => {
  const v = l[k];
  return typeof v === 'string' || typeof v === 'number' ? v : '';
};
const comVazio = (vazio: string | undefined) =>
  vazio === undefined ? [] : [{ valor: '' as ValorCombo, rotulo: vazio }];
const opFixas = (xs: readonly string[], vazio?: string) => [
  ...comVazio(vazio),
  ...xs.map((x) => ({ valor: x as ValorCombo, rotulo: x })),
];
const opLista = (xs: readonly Opcao[] | undefined, vazio?: string) => [
  ...comVazio(vazio),
  ...(xs ?? []).map((o) => ({ valor: o.id as ValorCombo, rotulo: o.nome })),
];
const DADOS_PACIENTE = ['peso', 'altura', 'idade', 'sexo', 'superficie_corporal', 'raca_cor'] as const;
const exame = reactive<Linha>({});

/** A data de hoje no fuso de quem usa a tela (não em UTC: depois das 21h em Brasília seria o dia seguinte). */
function hojeLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const novo = reactive<Record<string, Linha>>({
  setor: { setorDiagnosticoId: '', padrao: true, prazoEntregaHoras: '', atendeFeriado: false },
  material: { materialBiologicoId: '', recipienteColetaId: '', padrao: true, conservacao: 'ambiente' },
  preparo: { orientacaoPreparoId: '', publico: 'todos' },
  lateralidade: { lado: 'direito', multiplicadorCobranca: 1 },
  ligado: { secundarioExameId: '', tipoRelacao: 'secundario', lancaAutomaticamente: true },
  analito: { analitoId: '', ordem: 1, obrigatorio: true, calculado: false },
});
const faixaVazia = (): Linha => ({
  sexoId: '',
  idadeMinimaDias: '',
  idadeMaximaDias: '',
  materialBiologicoId: '',
  metodoAnaliticoId: '',
  condicao: 'nenhuma',
  referenciaTexto: '',
  vigenciaInicio: hojeLocal(),
});
const faixas = ref<Linha[]>([faixaVazia()]);
const variavelVazia = (): Linha => ({ identificador: '', fonte: 'analito', analitoId: '', dadoPaciente: '' });
const formula = reactive<Linha>({
  descricao: '',
  expressao: '',
  casasDecimais: '',
  vigenciaInicio: hojeLocal(),
  variaveis: [variavelVazia()],
});
const analitoAberto = ref<number | null>(null);

const numOuNulo = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));
const nomeDe = (qual: string, id: unknown) =>
  opcoes.value[qual]?.find((o) => o.id === Number(id))?.nome ??
  (id === null || id === undefined ? '' : String(id));
const porCampo = (falhas: readonly FalhaCatalogo[]) => {
  const r: Record<string, string> = {};
  for (const f of falhas) r[f.campo] = r[f.campo] ? `${r[f.campo]} ${f.mensagem}` : f.mensagem;
  return r;
};

async function tentar(fn: () => Promise<unknown>, ok: string) {
  erro.value = '';
  aviso.value = '';
  try {
    await fn();
    aviso.value = ok;
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  }
}

async function buscar() {
  const q = new URLSearchParams({ termo: termo.value, ...(tipo.value ? { tipo: tipo.value } : {}) });
  lista.value = (await ler(`${B}/exames?${q}`, qualquer)) as Linha[];
}

async function abrir(id: number) {
  ficha.value = (await ler(`${B}/exames/${id}`, qualquer)) as Linha;
  for (const k of Object.keys(exame)) delete exame[k];
  Object.assign(exame, ficha.value['exame'] as Linha);
}

function novoExame() {
  ficha.value = null;
  for (const k of Object.keys(exame)) delete exame[k];
  Object.assign(exame, { codigo: '', sigla: '', nome: '', tipoServico: 'laboratorio', ativo: true });
}

onMounted(async () => {
  try {
    opcoes.value = (await ler(`${B}/opcoes`, qualquer)) as Record<string, Opcao[]>;
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  }
});

const corpoExame = computed(() => ({
  ...(exame['id'] ? { versao: Number(exame['versao']) } : {}),
  codigo: String(exame['codigo'] ?? '').trim(),
  sigla: String(exame['sigla'] ?? '').trim(),
  nome: String(exame['nome'] ?? '').trim(),
  nomePopular: (exame['nomePopular'] as string) || null,
  tipoServico: String(exame['tipoServico'] ?? ''),
  modalidadeImagemId: numOuNulo(exame['modalidadeImagemId']),
  idadeMinimaDias: numOuNulo(exame['idadeMinimaDias']),
  idadeMaximaDias: numOuNulo(exame['idadeMaximaDias']),
  prazoEntregaHoras: numOuNulo(exame['prazoEntregaHoras']),
  limiteSolicitacoes: numOuNulo(exame['limiteSolicitacoes']),
  periodoLimiteDias: numOuNulo(exame['periodoLimiteDias']),
  custoUnitario: numOuNulo(exame['custoUnitario']),
  exigeLaudo: Boolean(exame['exigeLaudo']),
  ativo: Boolean(exame['ativo']),
}));
/** As regras do exame conferidas na hora, campo a campo. */
const falhasExame = computed(() => porCampo(validarExame(corpoExame.value)));

const salvarExame = () =>
  tentar(async () => {
    const id = exame['id'] ? Number(exame['id']) : null;
    const r = (await enviar(
      id ? `${B}/exames/${id}` : `${B}/exames`,
      corpoExame.value,
      qualquer,
      novaChave('catalogo.exame'),
    )) as Linha;
    await abrir(Number(r['id']));
    await buscar();
  }, 'Exame gravado.');

/** O corpo do vínculo novo: os ids e números como número, o vazio como nulo (o servidor põe o default). */
function corpoVinculo(v: Linha): Linha {
  const r: Linha = {};
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === 'boolean') r[k] = x;
    else if (/Id$|ordem|multiplicador|Horas$|Ml$/.test(k)) {
      const n = numOuNulo(x);
      if (n !== null) r[k] = n;
    } else if (x !== '' && x !== null) r[k] = x;
  }
  return r;
}

const salvarVinculo = (t: string, corpo: Linha, ok = 'Vínculo gravado.') =>
  tentar(async () => {
    await enviar(`${B}/exames/${Number(exame['id'])}/${t}`, corpo, qualquer, novaChave(`catalogo.${t}`));
    await abrir(Number(exame['id']));
  }, ok);

/** Inativar manda só id, versão e ativo: o resto do vínculo continua como está. */
const inativar = (t: string, v: Linha) =>
  salvarVinculo(t, { id: Number(v['id']), versao: Number(v['versao']), ativo: false }, 'Vínculo inativado.');

const corpoFaixa = (f: Linha): Linha => {
  const c: Linha = {};
  for (const [k, x] of Object.entries(f))
    c[k] = ['condicao', 'vigenciaInicio', 'referenciaTexto'].includes(k) ? x || null : numOuNulo(x);
  c['condicao'] = f['condicao'] || 'nenhuma';
  return c;
};
/** Os limites de cada faixa conferidos na hora. */
const falhasFaixas = computed(() =>
  faixas.value.map((f) => {
    const c = corpoFaixa(f) as never as Parameters<typeof validarLimitesFaixa>[0];
    const r = porCampo(validarLimitesFaixa(c));
    const min = numOuNulo(f['idadeMinimaDias']);
    const max = numOuNulo(f['idadeMaximaDias']);
    if (min !== null && max !== null && min > max)
      r['idadeMaximaDias'] = 'A idade máxima é menor que a mínima.';
    if (String(f['vigenciaInicio'] ?? '') < hojeLocal()) r['vigenciaInicio'] = 'Começa hoje ou depois.';
    return r;
  }),
);
const faixasComFalha = computed(() => falhasFaixas.value.some((r) => Object.keys(r).length > 0));

const novaFaixa = (eaId: number) =>
  tentar(async () => {
    await enviar(
      `${B}/analitos-exame/${eaId}/faixas`,
      { faixas: faixas.value.map(corpoFaixa) },
      qualquer,
      novaChave('catalogo.faixa'),
    );
    faixas.value = [faixaVazia()];
    await abrir(Number(exame['id']));
  }, 'Nova versão da faixa gravada; a anterior se encerra na véspera.');

const corpoVariaveis = computed(() =>
  (formula['variaveis'] as Linha[])
    .filter((v) => String(v['identificador'] ?? '').trim())
    .map((v) => ({
      identificador: String(v['identificador']).trim(),
      descricao: String(v['identificador']).trim(),
      fonte: String(v['fonte']),
      analitoId: v['fonte'] === 'analito' ? numOuNulo(v['analitoId']) : null,
      dadoPaciente: v['fonte'] === 'dado_paciente' ? (v['dadoPaciente'] as string) || null : null,
    })),
);
/** A expressão e as variáveis conferidas na hora. */
const falhasFormula = computed(() =>
  String(formula['expressao'] ?? '').trim()
    ? porCampo(
        validarFormula(
          String(formula['expressao']),
          corpoVariaveis.value.map((v) => v.identificador),
        ),
      )
    : {},
);
/** Os analitos do exame aberto (a variável da fórmula só aponta para eles, nunca para o próprio calculado). */
const analitosDoExame = (eaId: number) =>
  ((ficha.value?.['analitos'] as Linha[] | undefined) ?? [])
    .filter((a) => a['ativo'] && Number(a['id']) !== eaId)
    .map((a) => ({ id: Number(a['analitoId']), nome: String(a['nomeAnalito'] ?? a['analitoId']) }));

const novaFormula = (eaId: number) =>
  tentar(async () => {
    await enviar(
      `${B}/analitos-exame/${eaId}/formulas`,
      {
        descricao: formula['descricao'],
        expressao: formula['expressao'],
        vigenciaInicio: formula['vigenciaInicio'],
        casasDecimais: numOuNulo(formula['casasDecimais']),
        variaveis: corpoVariaveis.value,
      },
      qualquer,
      novaChave('catalogo.formula'),
    );
    await abrir(Number(exame['id']));
  }, 'Nova versão da fórmula gravada.');

/** Os campos de cada vínculo novo: seletor com a lista do catálogo, opções fixas, número ou marcação. */
type Campo = {
  k: string;
  r: string;
  lista?: string;
  fixas?: readonly string[];
  tipo?: 'number' | 'checkbox';
};
const SECOES: { t: string; titulo: string; chave: string; campos: Campo[] }[] = [
  {
    t: 'setor',
    titulo: 'Onde é feito (setor executante)',
    chave: 'setores',
    campos: [
      { k: 'setorDiagnosticoId', r: 'Setor', lista: 'setores' },
      { k: 'prazoEntregaHoras', r: 'Prazo (h)', tipo: 'number' },
      { k: 'atendeFeriado', r: 'Atende feriado', tipo: 'checkbox' },
      { k: 'padrao', r: 'Padrão', tipo: 'checkbox' },
    ],
  },
  {
    t: 'material',
    titulo: 'Material e recipiente',
    chave: 'materiais',
    campos: [
      { k: 'materialBiologicoId', r: 'Material', lista: 'materiais' },
      { k: 'recipienteColetaId', r: 'Recipiente', lista: 'recipientes' },
      {
        k: 'conservacao',
        r: 'Conservação',
        fixas: ['ambiente', 'refrigerado', 'congelado', 'protegido_luz', 'gelo'],
      },
      { k: 'volumeMinimoMl', r: 'Volume mínimo (mL)', tipo: 'number' },
      { k: 'padrao', r: 'Padrão', tipo: 'checkbox' },
    ],
  },
  {
    t: 'preparo',
    titulo: 'Preparo do paciente',
    chave: 'preparos',
    campos: [
      { k: 'orientacaoPreparoId', r: 'Orientação', lista: 'preparos' },
      { k: 'publico', r: 'Público', fixas: ['todos', 'adulto', 'crianca', 'gestante', 'idoso'] },
    ],
  },
  {
    t: 'lateralidade',
    titulo: 'Lateralidade',
    chave: 'lateralidades',
    campos: [
      { k: 'lado', r: 'Lado', fixas: ['direito', 'esquerdo', 'bilateral'] },
      { k: 'multiplicadorCobranca', r: 'Multiplicador', tipo: 'number' },
    ],
  },
  {
    t: 'ligado',
    titulo: 'Exames ligados',
    chave: 'ligados',
    campos: [
      { k: 'secundarioExameId', r: 'Exame', lista: 'exames' },
      { k: 'tipoRelacao', r: 'Relação', fixas: ['secundario', 'correlacionado', 'incluido'] },
      { k: 'lancaAutomaticamente', r: 'Lança junto', tipo: 'checkbox' },
    ],
  },
  {
    t: 'analito',
    titulo: 'Analitos do exame',
    chave: 'analitos',
    campos: [
      { k: 'analitoId', r: 'Analito', lista: 'analitos' },
      { k: 'ordem', r: 'Ordem', tipo: 'number' },
      { k: 'obrigatorio', r: 'Obrigatório', tipo: 'checkbox' },
      { k: 'calculado', r: 'Calculado', tipo: 'checkbox' },
    ],
  },
];
const rotulo = (v: Linha) =>
  String(
    v['nomeSetor'] ??
      v['nomeMaterial'] ??
      v['descricaoPreparo'] ??
      v['nomeLigado'] ??
      v['nomeAnalito'] ??
      v['lado'] ??
      v['id'],
  );
/** Filtro do seletor com busca: digita parte do nome e a lista encolhe. */
const filtros = reactive<Record<string, string>>({});
const filtrada = (qual: string, chave: string) => {
  const f = (filtros[chave] ?? '').toLowerCase();
  const l = opcoes.value[qual] ?? [];
  return f ? l.filter((o) => o.nome.toLowerCase().includes(f)).slice(0, 200) : l.slice(0, 200);
};
</script>

<template>
  <section class="catalogo" data-testid="catalogo-exames">
    <h1>{{ T.titulo }}</h1>
    <div class="grade">
      <aside>
        <form @submit.prevent="buscar">
          <input v-model="termo" :placeholder="T.busca" :aria-label="T.buscarExame" />
          <SanteSelecao
            v-model="tipo"
            :rotulo="T.tipoServico"
            ocultar-rotulo
            :opcoes="opFixas(TIPOS_SERVICO_EXAME, T.todos)"
          />
          <SanteBotao :rotulo="T.buscar" tipo="submit" />
          <SanteBotao :rotulo="T.novoExame" @acionar="novoExame" />
        </form>
        <ul>
          <li v-for="e in lista" :key="String(e['id'])">
            <button type="button" :class="{ inativo: !e['ativo'] }" @click="abrir(Number(e['id']))">
              {{ e['sigla'] }} · {{ e['nome'] }}
            </button>
          </li>
        </ul>
      </aside>
      <main v-if="exame['codigo'] !== undefined">
        <p v-if="erro" role="alert" class="erro">{{ erro }}</p>
        <p v-if="aviso" role="status">{{ aviso }}</p>
        <form class="exame" data-testid="form-exame" @submit.prevent="salvarExame">
          <label
            >{{ T.codigo }} <input v-model="exame['codigo']" required maxlength="30" name="codigo" />
            <small v-if="falhasExame['codigo']" class="erro">{{ falhasExame['codigo'] }}</small></label
          >
          <label
            >{{ T.sigla }} <input v-model="exame['sigla']" required maxlength="10" name="sigla" />
            <small v-if="falhasExame['sigla']" class="erro">{{ falhasExame['sigla'] }}</small></label
          >
          <label
            >{{ T.nome }} <input v-model="exame['nome']" required maxlength="150" name="nome" />
            <small v-if="falhasExame['nome']" class="erro">{{ falhasExame['nome'] }}</small></label
          >
          <label>{{ T.nomePopular }} <input v-model="exame['nomePopular']" maxlength="150" /></label>
          <div class="campo-selecao">
            <SanteSelecao
              :model-value="valorDe(exame, 'tipoServico')"
              :rotulo="T.tipo"
              :opcoes="opFixas(TIPOS_SERVICO_EXAME)"
              @update:model-value="(v) => (exame['tipoServico'] = v)"
            />
          </div>
          <div v-if="exame['tipoServico'] === 'imagem'" class="campo-selecao">
            <SanteSelecao
              :model-value="valorDe(exame, 'modalidadeImagemId')"
              :rotulo="T.modalidade"
              :opcoes="opLista(opcoes['modalidades'], T.escolha)"
              @update:model-value="(v) => (exame['modalidadeImagemId'] = v)"
            />
            <small v-if="falhasExame['modalidadeImagemId']" class="erro">{{
              falhasExame['modalidadeImagemId']
            }}</small>
          </div>
          <label>{{ T.idadeMin }} <input v-model="exame['idadeMinimaDias']" type="number" min="0" /></label>
          <label
            >{{ T.idadeMax }} <input v-model="exame['idadeMaximaDias']" type="number" min="0" />
            <small v-if="falhasExame['idadeMaximaDias']" class="erro">{{
              falhasExame['idadeMaximaDias']
            }}</small></label
          >
          <label>{{ T.prazo }} <input v-model="exame['prazoEntregaHoras']" type="number" min="0" /></label>
          <label>{{ T.limite }} <input v-model="exame['limiteSolicitacoes']" type="number" min="0" /></label>
          <label
            >{{ T.periodo }} <input v-model="exame['periodoLimiteDias']" type="number" min="0" />
            <small v-if="falhasExame['periodoLimiteDias']" class="erro">{{
              falhasExame['periodoLimiteDias']
            }}</small></label
          >
          <label
            >{{ T.custo }} <input v-model="exame['custoUnitario']" type="number" min="0" step="0.01" />
            <small v-if="falhasExame['custoUnitario']" class="erro">{{
              falhasExame['custoUnitario']
            }}</small></label
          >
          <label><input v-model="exame['exigeLaudo']" type="checkbox" /> {{ T.exigeLaudo }}</label>
          <label><input v-model="exame['ativo']" type="checkbox" /> {{ T.ativo }}</label>
          <SanteBotao
            :rotulo="T.gravarExame"
            tipo="submit"
            data-testid="salvar-exame"
            :desabilitado="Object.keys(falhasExame).length > 0"
          />
        </form>
        <template v-if="ficha">
          <section v-for="s in SECOES" :key="s.t" :data-testid="`secao-${s.t}`">
            <h2>{{ s.titulo }}</h2>
            <ul>
              <li
                v-for="v in ficha[s.chave] as Linha[]"
                :key="String(v['id'])"
                :class="{ inativo: !v['ativo'] }"
              >
                {{ rotulo(v) }}<span v-if="v['padrao']"> {{ T.padrao }}</span>
                <SanteBotao
                  v-if="v['ativo']"
                  :rotulo="T.inativar"
                  :data-testid="`inativar-${s.t}-${v['id']}`"
                  @acionar="inativar(s.t, v)"
                />
                <template v-if="s.t === 'analito'">
                  <SanteBotao
                    :rotulo="T.faixasFormula"
                    @acionar="analitoAberto = analitoAberto === Number(v['id']) ? null : Number(v['id'])"
                  />
                  <div v-if="analitoAberto === Number(v['id'])" class="analito">
                    <table>
                      <thead>
                        <tr>
                          <th>{{ T.inicio }}</th>
                          <th>{{ T.fim }}</th>
                          <th>{{ T.sexo }}</th>
                          <th>{{ T.idade }}</th>
                          <th>{{ T.material }}</th>
                          <th>{{ T.condicao }}</th>
                          <th>{{ T.referencia }}</th>
                          <th>{{ T.critico }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="f in v['faixas'] as Linha[]"
                          :key="String(f['id'])"
                          :class="{ vigente: !f['vigenciaFim'] }"
                        >
                          <td>{{ f['vigenciaInicio'] }}</td>
                          <td>{{ f['vigenciaFim'] ?? T.emVigor }}</td>
                          <td>{{ f['sexoId'] ? nomeDe('sexos', f['sexoId']) : T.todos }}</td>
                          <td>
                            {{ f['idadeMinimaDias'] ?? 0 }} {{ T.ate }}
                            {{ f['idadeMaximaDias'] ?? T.semLimite }}
                          </td>
                          <td>
                            {{
                              f['materialBiologicoId']
                                ? nomeDe('materiais', f['materialBiologicoId'])
                                : T.qualquer
                            }}
                          </td>
                          <td>{{ f['condicao'] }}</td>
                          <td>
                            {{
                              f['referenciaTexto'] ??
                              `${f['referenciaMinima'] ?? ''} a ${f['referenciaMaxima'] ?? ''}`
                            }}
                          </td>
                          <td>{{ f['criticoMinimo'] ?? '' }} / {{ f['criticoMaximo'] ?? '' }}</td>
                        </tr>
                      </tbody>
                    </table>
                    <form data-testid="form-faixa" @submit.prevent="novaFaixa(Number(v['id']))">
                      <fieldset v-for="(fx, i) in faixas" :key="i">
                        <label
                          >{{ T.inicio }} <input v-model="fx['vigenciaInicio']" type="date" required />
                          <small v-if="falhasFaixas[i]?.['vigenciaInicio']" class="erro">{{
                            falhasFaixas[i]?.['vigenciaInicio']
                          }}</small></label
                        >
                        <div class="campo-selecao">
                          <SanteSelecao
                            :model-value="valorDe(fx, 'sexoId')"
                            :rotulo="T.sexo"
                            :opcoes="opLista(opcoes['sexos'], T.todos)"
                            @update:model-value="(v) => (fx['sexoId'] = v)"
                          />
                        </div>
                        <label
                          >{{ T.idadeMin }} <input v-model="fx['idadeMinimaDias']" type="number" min="0"
                        /></label>
                        <label
                          >{{ T.idadeMax }} <input v-model="fx['idadeMaximaDias']" type="number" min="0" />
                          <small v-if="falhasFaixas[i]?.['idadeMaximaDias']" class="erro">{{
                            falhasFaixas[i]?.['idadeMaximaDias']
                          }}</small></label
                        >
                        <div class="campo-selecao">
                          <SanteSelecao
                            :model-value="valorDe(fx, 'materialBiologicoId')"
                            :rotulo="T.material"
                            :opcoes="opLista(opcoes['materiais'], T.qualquer)"
                            @update:model-value="(v) => (fx['materialBiologicoId'] = v)"
                          />
                        </div>
                        <div class="campo-selecao">
                          <SanteSelecao
                            :model-value="valorDe(fx, 'metodoAnaliticoId')"
                            :rotulo="T.metodo"
                            :opcoes="opLista(opcoes['metodos'], T.qualquer)"
                            @update:model-value="(v) => (fx['metodoAnaliticoId'] = v)"
                          />
                        </div>
                        <div class="campo-selecao">
                          <SanteSelecao
                            :model-value="valorDe(fx, 'condicao')"
                            :rotulo="T.condicao"
                            :opcoes="opFixas(CONDICOES_FAIXA)"
                            @update:model-value="(v) => (fx['condicao'] = v)"
                          />
                        </div>
                        <label
                          v-for="[k, r] in [
                            ['referenciaMinima', T.refMin],
                            ['referenciaMaxima', T.refMax],
                            ['alertaMinimo', T.alertaMin],
                            ['alertaMaximo', T.alertaMax],
                            ['criticoMinimo', T.criticoMin],
                            ['criticoMaximo', T.criticoMax],
                            ['absurdoMinimo', T.absurdoMin],
                            ['absurdoMaximo', T.absurdoMax],
                          ] as [string, string][]"
                          :key="k"
                          >{{ r }} <input v-model="fx[k]" type="number" step="any" />
                          <small v-if="falhasFaixas[i]?.[k]" class="erro">{{
                            falhasFaixas[i]?.[k]
                          }}</small></label
                        >
                        <label
                          >{{ T.texto }} <input v-model="fx['referenciaTexto']" maxlength="300" />
                          <small v-if="falhasFaixas[i]?.['referenciaTexto']" class="erro">{{
                            falhasFaixas[i]?.['referenciaTexto']
                          }}</small></label
                        >
                        <SanteBotao
                          v-if="faixas.length > 1"
                          :rotulo="T.tirarFaixa"
                          @acionar="faixas.splice(i, 1)"
                        />
                      </fieldset>
                      <SanteBotao :rotulo="T.outraFaixa" @acionar="faixas.push(faixaVazia())" />
                      <SanteBotao :rotulo="T.novaFaixa" tipo="submit" :desabilitado="faixasComFalha" />
                    </form>
                    <p v-for="fo in v['formulas'] as Linha[]" :key="String(fo['id'])">
                      {{ fo['vigenciaInicio'] }}: {{ fo['expressao'] }}
                      {{ fo['vigenciaFim'] ? `(${T.ate} ${fo['vigenciaFim']})` : `(${T.emVigor})` }}
                    </p>
                    <form
                      v-if="v['calculado']"
                      data-testid="form-formula"
                      @submit.prevent="novaFormula(Number(v['id']))"
                    >
                      <label>{{ T.descricao }} <input v-model="formula['descricao']" required /></label>
                      <label
                        >{{ T.expressao }}
                        <input v-model="formula['expressao']" required :placeholder="T.exprExemplo" />
                        <small v-if="falhasFormula['expressao']" class="erro">{{
                          falhasFormula['expressao']
                        }}</small>
                      </label>
                      <fieldset v-for="(vr, j) in formula['variaveis'] as Linha[]" :key="j">
                        <label>{{ T.variavel }} <input v-model="vr['identificador']" maxlength="10" /></label>
                        <div class="campo-selecao">
                          <SanteSelecao
                            :model-value="valorDe(vr, 'fonte')"
                            :rotulo="T.fonte"
                            :opcoes="opFixas(['analito', 'dado_paciente', 'digitado'])"
                            @update:model-value="(v) => (vr['fonte'] = v)"
                          />
                        </div>
                        <div v-if="vr['fonte'] === 'analito'" class="campo-selecao">
                          <SanteSelecao
                            :model-value="valorDe(vr, 'analitoId')"
                            :rotulo="T.analito"
                            :opcoes="opLista(analitosDoExame(Number(v['id'])), T.escolha)"
                            obrigatorio
                            @update:model-value="(v) => (vr['analitoId'] = v)"
                          />
                        </div>
                        <div v-if="vr['fonte'] === 'dado_paciente'" class="campo-selecao">
                          <SanteSelecao
                            :model-value="valorDe(vr, 'dadoPaciente')"
                            :rotulo="T.dadoPaciente"
                            :opcoes="opFixas(DADOS_PACIENTE)"
                            obrigatorio
                            @update:model-value="(v) => (vr['dadoPaciente'] = v)"
                          />
                        </div>
                      </fieldset>
                      <SanteBotao
                        :rotulo="T.maisVariavel"
                        @acionar="(formula['variaveis'] as Linha[]).push(variavelVazia())"
                      />
                      <small v-if="falhasFormula['variaveis']" class="erro">{{
                        falhasFormula['variaveis']
                      }}</small>
                      <label
                        >{{ T.inicio }} <input v-model="formula['vigenciaInicio']" type="date" required
                      /></label>
                      <SanteBotao
                        :rotulo="T.novaFormula"
                        tipo="submit"
                        :desabilitado="Object.keys(falhasFormula).length > 0"
                      />
                    </form>
                  </div>
                </template>
              </li>
            </ul>
            <form
              class="novo"
              :data-testid="`novo-${s.t}`"
              @submit.prevent="salvarVinculo(s.t, corpoVinculo(novo[s.t] as Linha))"
            >
              <label v-for="c in s.campos" :key="c.k"
                >{{ c.r }}
                <template v-if="c.lista">
                  <input
                    v-model="filtros[`${s.t}.${c.k}`]"
                    :placeholder="T.buscar"
                    :aria-label="`${c.r} (${T.buscar})`"
                  />
                  <SanteSelecao
                    :model-value="valorDe(novo[s.t] as Linha, c.k)"
                    :rotulo="c.r"
                    ocultar-rotulo
                    :opcoes="opLista(filtrada(c.lista, `${s.t}.${c.k}`), T.escolha)"
                    :data-testid="`novo-${s.t}-${c.k}`"
                    @update:model-value="(v) => ((novo[s.t] as Linha)[c.k] = v)"
                  />
                </template>
                <SanteSelecao
                  v-else-if="c.fixas"
                  :model-value="valorDe(novo[s.t] as Linha, c.k)"
                  :rotulo="c.r"
                  ocultar-rotulo
                  :opcoes="opFixas(c.fixas)"
                  :data-testid="`novo-${s.t}-${c.k}`"
                  @update:model-value="(v) => ((novo[s.t] as Linha)[c.k] = v)" />
                <input
                  v-else-if="c.tipo === 'checkbox'"
                  v-model="(novo[s.t] as Linha)[c.k]"
                  type="checkbox"
                  :name="c.k" />
                <input
                  v-else
                  v-model="(novo[s.t] as Linha)[c.k]"
                  type="number"
                  min="0"
                  step="any"
                  :name="c.k"
              /></label>
              <SanteBotao :rotulo="T.incluir" tipo="submit" />
            </form>
          </section>
        </template>
      </main>
    </div>
  </section>
</template>

<style scoped>
.grade {
  display: grid;
  grid-template-columns: minmax(16rem, 1fr) 3fr;
  gap: 1rem;
}
.inativo {
  opacity: 0.55;
  text-decoration: line-through;
}
.vigente {
  font-weight: 600;
}
.erro {
  color: var(--sgh-perigo);
}
form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: end;
  margin: 0.5rem 0;
}
fieldset {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  border: 1px solid var(--sgh-borda);
}
</style>
