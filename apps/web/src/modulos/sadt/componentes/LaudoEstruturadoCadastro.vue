<script setup lang="ts">
// Laudo estruturado na ficha do exame (F3.5, análise 05-SADT linha 17), dentro de `/sadt/catalogo`. Num lugar só, sem
// sair do exame: as seções do laudo, as medidas de cada seção, as faixas de referência de cada medida e a fórmula da
// medida calculada. Melhorias: a regra do domínio confere tudo na hora, antes de enviar (o botão só libera sem
// pendência); a fórmula é escrita com os códigos das medidas e a tela descobre as variáveis sozinha (nada de declarar
// uma a uma); a nova versão da fórmula ou da faixa não apaga a anterior; sair é inativar ou encerrar a vigência.
import {
  type FaixaGrandezaCadastro,
  planejarFormulaGrandeza,
  validarFaixaGrandeza,
  validarGrandezaLaudo,
  validarSecaoLaudo,
  variaveisPelaExpressao,
} from '@sgh/dominio-sadt';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  type FaixaCadastro,
  type GrandezaCadastro,
  gravarFaixaGrandeza,
  gravarFormulaGrandeza,
  gravarGrandezaLaudo,
  gravarSecaoLaudo,
  type LaudoEstruturado,
  lerLaudoEstruturado,
} from '../api-laudo-estruturado.js';
import { novaChave } from '../api-sadt.js';

type ValorCombo = string | number | null;
const props = defineProps<{ exameId: number }>();

const T = {
  titulo: 'Laudo estruturado (medidas do exame)',
  secoes: 'Seções do laudo',
  novaSecao: 'Nova seção',
  codigo: 'Código',
  nome: 'Nome',
  ordem: 'Ordem',
  incluirSecao: 'Incluir seção',
  medidas: 'Medidas',
  semMedida: 'O exame ainda não tem medida.',
  medida: 'Medida',
  codigoMedida: 'Código (entra no modelo do laudo e na fórmula)',
  sigla: 'Sigla',
  secao: 'Seção',
  semSecao: 'Sem seção',
  unidade: 'Unidade',
  semUnidade: 'Sem unidade',
  casas: 'Casas decimais',
  calculada: 'Calculada por fórmula',
  obrigatoria: 'Obrigatória na assinatura',
  gravarMedida: 'Gravar medida',
  novaMedida: 'Nova medida',
  alterar: 'Alterar',
  inativar: 'Inativar',
  detalhar: 'Faixas e fórmula',
  fechar: 'Fechar',
  faixas: 'Faixas de referência',
  semFaixa: 'Sem faixa de referência.',
  sexo: 'Sexo',
  ambos: 'Ambos',
  idadeMin: 'Idade mínima (anos)',
  idadeMax: 'Idade máxima (anos)',
  refMin: 'Referência mínima',
  refMax: 'Referência máxima',
  indexada: 'Referência por m² de superfície corporal',
  inicio: 'Vale a partir de',
  incluirFaixa: 'Incluir faixa',
  encerrar: 'Encerrar hoje',
  formula: 'Fórmula',
  semFormula: 'A medida calculada ainda não tem fórmula: até lá o valor é digitado.',
  expressao: 'Expressão (códigos das medidas; peso, altura, sc, idade)',
  usa: 'Usa',
  gravarFormula: 'Gravar fórmula',
  desconhecidas: 'Nomes que não são medida deste exame nem dado do paciente',
  vigente: 'desde',
  ate: 'até',
  gravado: 'Gravado.',
  dados: {
    peso: 'peso (kg)',
    altura: 'altura (cm)',
    superficie_corporal: 'superfície corporal (m²)',
    idade: 'idade (anos)',
  } as Record<string, string>,
} as const;

const dados = ref<LaudoEstruturado | null>(null);
const erro = ref('');
const aviso = ref('');
const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const vespera = (dia: string) => {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

const s = reactive({ codigo: '', nome: '', ordem: '1' });
const g = reactive({
  id: null as number | null,
  versao: 0,
  codigo: '',
  descricao: '',
  sigla: '',
  secao: '' as ValorCombo,
  unidade: '' as ValorCombo,
  casas: '1',
  ordem: '1',
  calculada: false,
  obrigatoria: false,
});
const aberta = ref<number | null>(null);
const fx = reactive({
  sexo: '' as ValorCombo,
  idadeMin: '',
  idadeMax: '',
  refMin: '',
  refMax: '',
  indexada: false,
  inicio: hoje(),
});
const fo = reactive({ expressao: '', inicio: hoje() });

const opSecoes = computed(() => [
  { valor: '' as ValorCombo, rotulo: T.semSecao },
  ...(dados.value?.secoes ?? [])
    .filter((x) => x.ativo)
    .map((x) => ({ valor: x.id as ValorCombo, rotulo: x.nome })),
]);
const opUnidades = computed(() => [
  { valor: '' as ValorCombo, rotulo: T.semUnidade },
  ...(dados.value?.unidades ?? []).map((x) => ({ valor: x.id as ValorCombo, rotulo: x.simbolo })),
]);
const opSexos = computed(() => [
  { valor: '' as ValorCombo, rotulo: T.ambos },
  ...(dados.value?.sexos ?? []).map((x) => ({ valor: x.id as ValorCombo, rotulo: x.descricao })),
]);
const idOuNulo = (v: ValorCombo) => (v === '' || v === null ? null : Number(v));
const nomeSecao = (id: number | null) => dados.value?.secoes.find((x) => x.id === id)?.nome ?? T.semSecao;
const unidadeDe = (id: number | null) => dados.value?.unidades.find((x) => x.id === id)?.simbolo ?? '';
const sexoDe = (id: number | null) =>
  id === null ? T.ambos : (dados.value?.sexos.find((x) => x.id === id)?.descricao ?? '');
const medidaAberta = computed(() => dados.value?.grandezas.find((x) => x.id === aberta.value) ?? null);

async function carregar() {
  dados.value = await lerLaudoEstruturado(props.exameId);
}
async function tentar(fn: () => Promise<unknown>) {
  erro.value = '';
  aviso.value = '';
  try {
    await fn();
    aviso.value = T.gravado;
    await carregar();
  } catch (e) {
    erro.value = mensagem(e);
  }
}
onMounted(() => carregar().catch((e) => (erro.value = mensagem(e))));
watch(
  () => props.exameId,
  () => {
    aberta.value = null;
    novaMedida();
    carregar().catch((e) => (erro.value = mensagem(e)));
  },
);

// ── Seção ──
const pendSecao = computed(() => [
  ...validarSecaoLaudo({ codigo: s.codigo, nome: s.nome, sigla: null, ordem: Number(s.ordem) }).map(
    (f) => f.mensagem,
  ),
  ...((dados.value?.secoes ?? []).some((x) => x.codigo === s.codigo.trim())
    ? ['Já existe seção com este código neste exame.']
    : []),
]);
const incluirSecao = () =>
  tentar(async () => {
    await gravarSecaoLaudo(
      { exameId: props.exameId, codigo: s.codigo.trim(), nome: s.nome.trim(), ordem: Number(s.ordem) },
      novaChave('laudo.secao'),
    );
    Object.assign(s, { codigo: '', nome: '', ordem: String(Number(s.ordem) + 1) });
  });

// ── Medida ──
function novaMedida() {
  Object.assign(g, {
    id: null,
    versao: 0,
    codigo: '',
    descricao: '',
    sigla: '',
    secao: '',
    unidade: '',
    casas: '1',
    ordem: String((dados.value?.grandezas.length ?? 0) + 1),
    calculada: false,
    obrigatoria: false,
  });
}
function editarMedida(x: GrandezaCadastro) {
  Object.assign(g, {
    id: x.id,
    versao: x.versao,
    codigo: x.codigo,
    descricao: x.descricao,
    sigla: x.sigla ?? '',
    secao: x.secaoLaudoEstruturadoId ?? '',
    unidade: x.unidadeResultadoId ?? '',
    casas: x.casasDecimais === null ? '' : String(x.casasDecimais),
    ordem: String(x.ordem),
    calculada: x.calculada,
    obrigatoria: x.obrigatoria,
  });
}
const usadaEmFormula = (id: number) =>
  (dados.value?.grandezas ?? []).some(
    (x) =>
      x.ativo &&
      x.formulas.some(
        (f) =>
          (f.vigenciaFim === null || f.vigenciaFim >= hoje()) &&
          f.variaveis.some((v) => v.grandezaLaudoId === id),
      ),
  );
const pendMedida = computed(() => [
  ...validarGrandezaLaudo({
    codigo: g.codigo,
    descricao: g.descricao,
    sigla: g.sigla.trim() || null,
    casasDecimais: num(g.casas),
    ordem: Number(g.ordem),
    ativo: true,
    usadaEmFormula: false,
  }).map((f) => f.mensagem),
  ...((dados.value?.grandezas ?? []).some((x) => x.codigo === g.codigo.trim() && x.id !== g.id)
    ? ['Já existe medida com este código neste exame.']
    : []),
]);
const gravarMedida = () =>
  tentar(async () => {
    await gravarGrandezaLaudo(
      {
        ...(g.id ? { id: g.id, versao: g.versao } : {}),
        exameId: props.exameId,
        secaoLaudoEstruturadoId: idOuNulo(g.secao),
        codigo: g.codigo.trim(),
        descricao: g.descricao.trim(),
        sigla: g.sigla.trim() || null,
        unidadeResultadoId: idOuNulo(g.unidade),
        casasDecimais: num(g.casas),
        ordem: Number(g.ordem),
        calculada: g.calculada,
        obrigatoria: g.obrigatoria,
      },
      novaChave('laudo.medida'),
    );
    novaMedida();
  });
const inativarMedida = (x: GrandezaCadastro) =>
  tentar(() =>
    gravarGrandezaLaudo(
      { id: x.id, versao: x.versao, exameId: props.exameId, ativo: false },
      novaChave('laudo.medida'),
    ),
  );
function detalhar(x: GrandezaCadastro) {
  aberta.value = aberta.value === x.id ? null : x.id;
  Object.assign(fx, {
    sexo: '',
    idadeMin: '',
    idadeMax: '',
    refMin: '',
    refMax: '',
    indexada: false,
    inicio: hoje(),
  });
  Object.assign(fo, { expressao: x.formulas[0]?.expressao ?? '', inicio: hoje() });
}

// ── Faixa ──
const anosEmDias = (texto: string) => {
  const a = num(texto);
  return a === null || !Number.isFinite(a) ? null : Math.round(a * 365.25);
};
const comoRegra = (f: FaixaCadastro): FaixaGrandezaCadastro => ({
  id: f.id,
  sexoId: f.sexoId,
  idadeMinimaDias: f.idadeMinimaDias,
  idadeMaximaDias: f.idadeMaximaDias,
  pesoMinimoKg: f.pesoMinimoKg,
  pesoMaximoKg: f.pesoMaximoKg,
  superficieMinima: f.superficieCorporalMinima,
  superficieMaxima: f.superficieCorporalMaxima,
  referenciaMinima: f.referenciaMinima,
  referenciaMaxima: f.referenciaMaxima,
  referenciaTexto: f.referenciaTexto,
  vigenciaInicio: f.vigenciaInicio,
  vigenciaFim: f.vigenciaFim,
  ativo: f.ativo,
});
const faixaNova = () => ({
  sexoId: idOuNulo(fx.sexo),
  idadeMinimaDias: anosEmDias(fx.idadeMin),
  idadeMaximaDias: anosEmDias(fx.idadeMax),
  referenciaMinima: num(fx.refMin),
  referenciaMaxima: num(fx.refMax),
  indexadaSuperficie: fx.indexada,
  vigenciaInicio: fx.inicio,
});
const pendFaixa = computed(() => {
  const m = medidaAberta.value;
  if (!m) return [];
  const n = faixaNova();
  return validarFaixaGrandeza(
    {
      id: null,
      sexoId: n.sexoId,
      idadeMinimaDias: n.idadeMinimaDias,
      idadeMaximaDias: n.idadeMaximaDias,
      pesoMinimoKg: null,
      pesoMaximoKg: null,
      superficieMinima: null,
      superficieMaxima: null,
      referenciaMinima: n.referenciaMinima,
      referenciaMaxima: n.referenciaMaxima,
      referenciaTexto: null,
      vigenciaInicio: n.vigenciaInicio,
      vigenciaFim: null,
      ativo: true,
    },
    m.faixas.map(comoRegra),
  ).map((f) => f.mensagem);
});
const incluirFaixa = () =>
  tentar(async () => {
    await gravarFaixaGrandeza({ grandezaLaudoId: aberta.value, ...faixaNova() }, novaChave('laudo.faixa'));
    Object.assign(fx, { refMin: '', refMax: '' });
  });
/** Encerra a faixa na véspera de hoje (a que ainda nem começou sai por inativação): a nova pode entrar em seguida. */
const encerrarFaixa = (f: FaixaCadastro) =>
  tentar(() =>
    gravarFaixaGrandeza(
      {
        id: f.id,
        versao: f.versao,
        ...(vespera(hoje()) >= f.vigenciaInicio ? { vigenciaFim: vespera(hoje()) } : { ativo: false }),
      },
      novaChave('laudo.faixa'),
    ),
  );
const idadeTexto = (f: FaixaCadastro) =>
  f.idadeMinimaDias === null && f.idadeMaximaDias === null
    ? ''
    : ` · ${f.idadeMinimaDias === null ? '…' : Math.floor(f.idadeMinimaDias / 365.25)}–${
        f.idadeMaximaDias === null ? '…' : Math.floor(f.idadeMaximaDias / 365.25)
      } anos`;
const faixaTexto = (f: FaixaCadastro) =>
  `${sexoDe(f.sexoId)}${idadeTexto(f)} · ${f.referenciaMinima ?? '…'}–${f.referenciaMaxima ?? '…'}${
    f.indexadaSuperficie ? ' /m²' : ''
  } · ${T.vigente} ${f.vigenciaInicio}${f.vigenciaFim ? ` ${T.ate} ${f.vigenciaFim}` : ''}`;

// ── Fórmula ──
const variaveis = computed(() =>
  variaveisPelaExpressao(
    fo.expressao,
    (dados.value?.grandezas ?? []).map((x) => ({ id: x.id, codigo: x.codigo, ativo: x.ativo })),
  ),
);
const usaTexto = computed(() =>
  variaveis.value.variaveis
    .map((v) =>
      v.fonte === 'grandeza'
        ? `${v.identificador} (${dados.value?.grandezas.find((x) => x.id === v.grandeza)?.descricao ?? ''})`
        : `${v.identificador} (${T.dados[v.dadoPaciente ?? ''] ?? ''})`,
    )
    .join(', '),
);
const pendFormula = computed(() => {
  const m = medidaAberta.value;
  const d = dados.value;
  if (!m || !d) return [];
  const outras = d.grandezas.filter((x) => x.id !== m.id && x.ativo);
  const plano = planejarFormulaGrandeza(
    { expressao: fo.expressao, vigenciaInicio: fo.inicio, variaveis: variaveis.value.variaveis },
    {
      hoje: hoje(),
      grandezaAlvo: m.id,
      calculada: m.calculada,
      grandezasDoExame: d.grandezas.filter((x) => x.ativo).map((x) => x.id),
      vigentes: m.formulas
        .filter((f) => f.vigenciaFim === null || f.vigenciaFim >= fo.inicio)
        .map((f) => ({ id: f.id, vigenciaInicio: f.vigenciaInicio, vigenciaFim: f.vigenciaFim })),
      dependencias: outras.flatMap((x) =>
        x.formulas
          .filter((f) => f.vigenciaFim === null || f.vigenciaFim >= fo.inicio)
          .map((f) => ({
            grandeza: x.id,
            usa: f.variaveis.flatMap((v) => (v.grandezaLaudoId === null ? [] : [v.grandezaLaudoId])),
          })),
      ),
    },
  );
  return [
    ...(variaveis.value.desconhecidas.length
      ? [`${T.desconhecidas}: ${variaveis.value.desconhecidas.join(', ')}.`]
      : []),
    ...plano.falhas
      .filter((f) => !(variaveis.value.desconhecidas.length && f.mensagem.startsWith('Variáveis sem')))
      .map((f) => f.mensagem),
  ];
});
const gravarFormula = () =>
  tentar(async () => {
    const m = medidaAberta.value;
    if (!m) return;
    await gravarFormulaGrandeza(
      m.id,
      {
        descricao: `Fórmula de ${m.descricao}`.slice(0, 150),
        expressao: fo.expressao.trim(),
        casasDecimais: m.casasDecimais,
        vigenciaInicio: fo.inicio,
        variaveis: variaveis.value.variaveis.map((v) => ({
          identificador: v.identificador,
          descricao:
            v.fonte === 'grandeza'
              ? (dados.value?.grandezas.find((x) => x.id === v.grandeza)?.descricao ?? v.identificador)
              : (T.dados[v.dadoPaciente ?? ''] ?? v.identificador),
          fonte: v.fonte,
          grandezaLaudoId: v.grandeza,
          dadoPaciente: v.dadoPaciente,
        })),
      },
      novaChave('laudo.formula'),
    );
  });
</script>

<template>
  <section data-testid="laudo-estruturado">
    <h3>{{ T.titulo }}</h3>
    <p v-if="erro" class="erro" role="alert" data-testid="laudo-estruturado-erro">{{ erro }}</p>
    <p v-if="aviso" role="status" data-testid="laudo-estruturado-aviso">{{ aviso }}</p>
    <template v-if="dados">
      <h4>{{ T.secoes }}</h4>
      <ul class="lista" data-testid="le-secoes">
        <li v-for="x in dados.secoes" :key="x.id" :class="{ inativo: !x.ativo }">
          {{ x.ordem }}. {{ x.nome }} ({{ x.codigo }})
        </li>
      </ul>
      <form data-testid="le-form-secao" @submit.prevent="incluirSecao">
        <label
          >{{ T.codigo }} <input v-model="s.codigo" maxlength="30" data-testid="le-secao-codigo"
        /></label>
        <label>{{ T.nome }} <input v-model="s.nome" maxlength="100" data-testid="le-secao-nome" /></label>
        <label
          >{{ T.ordem }} <input v-model="s.ordem" type="number" min="1" data-testid="le-secao-ordem"
        /></label>
        <SanteBotao
          :rotulo="T.incluirSecao"
          tipo="submit"
          :desabilitado="pendSecao.length > 0"
          data-testid="le-secao-incluir"
        />
      </form>
      <p v-if="(s.codigo || s.nome) && pendSecao.length" class="erro" data-testid="le-secao-pendencias">
        {{ pendSecao.join(' ') }}
      </p>

      <h4>{{ T.medidas }}</h4>
      <p v-if="!dados.grandezas.length">{{ T.semMedida }}</p>
      <table v-else data-testid="le-medidas">
        <thead>
          <tr>
            <th scope="col">{{ T.ordem }}</th>
            <th scope="col">{{ T.medida }}</th>
            <th scope="col">{{ T.secao }}</th>
            <th scope="col">{{ T.unidade }}</th>
            <th scope="col">{{ T.formula }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="x in dados.grandezas"
            :key="x.id"
            :class="{ inativo: !x.ativo }"
            :data-testid="`le-medida-${x.codigo}`"
          >
            <td>{{ x.ordem }}</td>
            <td>
              {{ x.descricao }} ({{ x.codigo }})<em v-if="x.obrigatoria"> · {{ T.obrigatoria }}</em>
            </td>
            <td>{{ nomeSecao(x.secaoLaudoEstruturadoId) }}</td>
            <td>{{ unidadeDe(x.unidadeResultadoId) }}</td>
            <td>{{ x.calculada ? (x.formulas[0]?.expressao ?? T.calculada) : '' }}</td>
            <td class="linha">
              <template v-if="x.ativo">
                <SanteBotao
                  :rotulo="T.alterar"
                  :data-testid="`le-alterar-${x.codigo}`"
                  @acionar="editarMedida(x)"
                />
                <SanteBotao
                  :rotulo="aberta === x.id ? T.fechar : T.detalhar"
                  :data-testid="`le-detalhar-${x.codigo}`"
                  @acionar="detalhar(x)"
                />
                <SanteBotao
                  :rotulo="T.inativar"
                  :desabilitado="usadaEmFormula(x.id)"
                  :data-testid="`le-inativar-${x.codigo}`"
                  @acionar="inativarMedida(x)"
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>

      <section v-if="medidaAberta" class="detalhe" data-testid="le-detalhe">
        <h4>{{ medidaAberta.descricao }} · {{ T.faixas }}</h4>
        <p v-if="!medidaAberta.faixas.length">{{ T.semFaixa }}</p>
        <ul v-else data-testid="le-faixas">
          <li v-for="f in medidaAberta.faixas" :key="f.id" :class="{ inativo: !f.ativo }">
            {{ faixaTexto(f) }}
            <SanteBotao
              v-if="f.ativo && !f.vigenciaFim"
              :rotulo="T.encerrar"
              :data-testid="`le-faixa-encerrar-${f.id}`"
              @acionar="encerrarFaixa(f)"
            />
          </li>
        </ul>
        <form data-testid="le-form-faixa" @submit.prevent="incluirFaixa">
          <SanteSelecao v-model="fx.sexo" :rotulo="T.sexo" :opcoes="opSexos" data-testid="le-faixa-sexo" />
          <label
            >{{ T.idadeMin }}
            <input v-model="fx.idadeMin" inputmode="decimal" data-testid="le-faixa-idade-min"
          /></label>
          <label
            >{{ T.idadeMax }}
            <input v-model="fx.idadeMax" inputmode="decimal" data-testid="le-faixa-idade-max"
          /></label>
          <label
            >{{ T.refMin }} <input v-model="fx.refMin" inputmode="decimal" data-testid="le-faixa-min"
          /></label>
          <label
            >{{ T.refMax }} <input v-model="fx.refMax" inputmode="decimal" data-testid="le-faixa-max"
          /></label>
          <label
            ><input v-model="fx.indexada" type="checkbox" data-testid="le-faixa-indexada" />
            {{ T.indexada }}</label
          >
          <label
            >{{ T.inicio }} <input v-model="fx.inicio" type="date" data-testid="le-faixa-inicio"
          /></label>
          <SanteBotao
            :rotulo="T.incluirFaixa"
            tipo="submit"
            :desabilitado="pendFaixa.length > 0"
            data-testid="le-faixa-incluir"
          />
        </form>
        <p v-if="(fx.refMin || fx.refMax) && pendFaixa.length" class="erro" data-testid="le-faixa-pendencias">
          {{ pendFaixa.join(' ') }}
        </p>

        <template v-if="medidaAberta.calculada">
          <h4>{{ T.formula }}</h4>
          <p v-if="!medidaAberta.formulas.length" data-testid="le-sem-formula">{{ T.semFormula }}</p>
          <ul v-else data-testid="le-formulas">
            <li v-for="f in medidaAberta.formulas" :key="f.id">
              <code>{{ f.expressao }}</code> · {{ T.vigente }} {{ f.vigenciaInicio
              }}<template v-if="f.vigenciaFim"> {{ T.ate }} {{ f.vigenciaFim }}</template>
            </li>
          </ul>
          <form data-testid="le-form-formula" @submit.prevent="gravarFormula">
            <label class="largo"
              >{{ T.expressao }}
              <input v-model="fo.expressao" maxlength="2000" data-testid="le-formula-expressao"
            /></label>
            <label
              >{{ T.inicio }} <input v-model="fo.inicio" type="date" data-testid="le-formula-inicio"
            /></label>
            <SanteBotao
              :rotulo="T.gravarFormula"
              tipo="submit"
              :desabilitado="pendFormula.length > 0"
              data-testid="le-formula-gravar"
            />
          </form>
          <p v-if="usaTexto" data-testid="le-formula-usa">{{ T.usa }}: {{ usaTexto }}</p>
          <p v-if="fo.expressao && pendFormula.length" class="erro" data-testid="le-formula-pendencias">
            {{ pendFormula.join(' ') }}
          </p>
        </template>
      </section>

      <h4>{{ g.id ? T.alterar : T.novaMedida }}</h4>
      <form data-testid="le-form-medida" @submit.prevent="gravarMedida">
        <label
          >{{ T.codigoMedida }} <input v-model="g.codigo" maxlength="30" data-testid="le-medida-codigo"
        /></label>
        <label
          >{{ T.medida }} <input v-model="g.descricao" maxlength="150" data-testid="le-medida-descricao"
        /></label>
        <label>{{ T.sigla }} <input v-model="g.sigla" maxlength="10" data-testid="le-medida-sigla" /></label>
        <SanteSelecao v-model="g.secao" :rotulo="T.secao" :opcoes="opSecoes" data-testid="le-medida-secao" />
        <SanteSelecao
          v-model="g.unidade"
          :rotulo="T.unidade"
          :opcoes="opUnidades"
          data-testid="le-medida-unidade"
        />
        <label
          >{{ T.casas }} <input v-model="g.casas" type="number" min="0" max="6" data-testid="le-medida-casas"
        /></label>
        <label
          >{{ T.ordem }} <input v-model="g.ordem" type="number" min="1" data-testid="le-medida-ordem"
        /></label>
        <label
          ><input v-model="g.calculada" type="checkbox" data-testid="le-medida-calculada" />
          {{ T.calculada }}</label
        >
        <label
          ><input v-model="g.obrigatoria" type="checkbox" data-testid="le-medida-obrigatoria" />
          {{ T.obrigatoria }}</label
        >
        <SanteBotao
          :rotulo="T.gravarMedida"
          tipo="submit"
          :desabilitado="pendMedida.length > 0"
          data-testid="le-medida-gravar"
        />
        <SanteBotao v-if="g.id" :rotulo="T.novaMedida" data-testid="le-medida-nova" @acionar="novaMedida" />
      </form>
      <p
        v-if="(g.codigo || g.descricao) && pendMedida.length"
        class="erro"
        data-testid="le-medida-pendencias"
      >
        {{ pendMedida.join(' ') }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.inativo {
  /* Sem opacidade: a cor secundária do tema mantém o contraste (WCAG AA) do texto e dos botões da linha. */
  color: var(--sgh-texto-secundario);
  text-decoration: line-through;
}
.erro {
  color: var(--sgh-alerta);
}
form,
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: end;
  margin: 0.5rem 0;
}
.lista {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  list-style: none;
  padding: 0;
}
.largo,
.largo input,
table {
  width: 100%;
}
</style>
