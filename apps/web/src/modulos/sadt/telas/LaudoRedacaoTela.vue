<script setup lang="ts">
// Redação do laudo de imagem e de métodos gráficos e laudo estruturado (F3.5, 05-SADT linhas 16 e 17). Numa tela só:
// o exame e o paciente, as medidas por seção com a faixa e a marca de fora da referência na hora, o modelo sugerido
// (o do médico primeiro) com os campos preenchidos pelas medidas, o texto, e "salvar e assinar" num clique. Depois de
// assinado, o texto só muda por retificação com motivo; o histórico de versões fica ao lado, com o texto inteiro de
// cada versão a um clique. Sem exame escolhido, a tela é a lista de trabalho de quem lauda (os exames realizados que
// esperam laudo, o mais antigo primeiro: um clique abre o laudo) e a busca de casos pelas palavras-chave. O cabeçalho
// traz o nome e o prontuário do paciente e os laudos anteriores do mesmo exame, para comparar (F3.5-09, linha 16).
import {
  type CalculoFormula,
  calcularGrandezas,
  faixaDaGrandezaDoPaciente,
  superficieCorporal,
} from '@sgh/dominio-sadt';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
  abrirLaudo,
  assinarLaudo,
  buscarLaudosPorPalavras,
  type CasoAchado,
  type CorpoLaudo,
  type FilaDeLaudos,
  type LaudoEmRedacao,
  type LaudoGravado,
  lerFilaDeLaudos,
  lerMotivosRetificacao,
  lerPalavrasChave,
  lerVersaoDoLaudo,
  type VersaoDoLaudo,
  previaDoModelo,
  retificarLaudo,
  salvarLaudo,
} from '../api-laudo-redacao.js';
import { novaChave } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';

const M = {
  titulo: 'Laudo do exame',
  item: 'Exame (número do item)',
  abrir: 'Abrir',
  paciente: 'Paciente',
  idade: '{n} anos',
  medidas: 'Medidas',
  semSecao: 'Outras medidas',
  peso: 'Peso (kg)',
  altura: 'Altura (cm)',
  fora: 'fora da referência',
  obrigatoria: 'obrigatória',
  calculada: 'calculada',
  faixa: 'referência',
  modelo: 'Modelo',
  aplicar: 'Aplicar o modelo',
  faltam: 'Campos sem valor no modelo: {c}',
  texto: 'Texto do laudo',
  resultado: 'Resultado',
  resultados: { '': '—', normal: 'Normal', alterado: 'Alterado', inconclusivo: 'Inconclusivo' },
  critico: 'Achado crítico',
  criticoDescricao: 'Descrição do achado crítico',
  salvar: 'Salvar rascunho',
  revisao: 'Enviar para revisão',
  assinar: 'Salvar e assinar',
  motivo: 'Motivo da retificação',
  motivoTexto: 'Ou descreva o motivo',
  retificar: 'Retificar',
  versoes: 'Versões',
  situacao: {
    rascunho: 'Rascunho',
    aguardando_revisao: 'Aguardando revisão',
    assinado: 'Assinado',
    emitido: 'Emitido',
    retificado: 'Retificado',
    cancelado: 'Cancelado',
  } as Record<string, string>,
  gravado: 'Laudo {s} (versão {v}); {f} medida(s) fora da referência.',
  exameLiberado: 'Exame liberado para a emissão.',
  avisoAberto: 'Aviso crítico aberto; {n} pessoa(s) avisada(s).',
  avisoCancelado: 'Aviso crítico ainda não comunicado foi cancelado.',
  emissaoSuperada: 'O laudo já tinha sido emitido: a via anterior não é mais a atual; emita a nova via.',
  fila: 'Exames aguardando laudo',
  filaTexto: 'Os exames realizados sem laudo assinado, o mais antigo primeiro. Um clique abre o laudo.',
  filaVazia: 'Nenhum exame aguardando laudo.',
  setor: 'Setor',
  todos: 'Todos os setores',
  colExame: 'Exame',
  colPaciente: 'Paciente',
  colProntuario: 'Prontuário',
  colRealizado: 'Realizado em',
  colLaudo: 'Laudo',
  semLaudo: 'A escrever',
  laudar: 'Laudar',
  voltar: 'Voltar à lista',
  modelos: 'Modelos de laudo',
  prontuario: 'prontuário {p}',
  palavras: 'Palavras-chave',
  busca: 'Busca de casos por palavra-chave',
  buscar: 'Buscar',
  buscaVazia: 'Nenhum laudo assinado com todas as palavras escolhidas.',
  semPalavras: 'Não há palavra-chave ativa no cadastro.',
  abrirCaso: 'Abrir',
  verTexto: 'Ver o texto',
  versaoDe: 'Versão {n} · {s} · {q}',
  por: 'por {p}',
  fecharVersao: 'Fechar',
  anteriores: 'Laudos anteriores deste exame',
  anterior: '{q} · {r}',
};

const rota = useRoute();
const roteador = useRouter();
const itemTexto = ref(String(rota.query['item'] ?? ''));
const dados = ref<LaudoEmRedacao | null>(null);
// Lista de trabalho e busca de casos (a tela sem exame escolhido).
const fila = ref<FilaDeLaudos | null>(null);
const setorFila = ref('');
const opSetores = computed(() => [
  { valor: '', rotulo: M.todos },
  ...(fila.value?.setores ?? []).map((x) => ({ valor: String(x.id), rotulo: x.nome })),
]);
const palavrasCadastro = ref<{ id: number; descricao: string }[]>([]);
const palavrasBusca = ref<number[]>([]);
const casos = ref<CasoAchado[] | null>(null);
const versaoAberta = ref<VersaoDoLaudo | null>(null);
const quando = (v: string | null) => (v ? new Date(v).toLocaleString('pt-BR') : '—');
async function carregarFila(): Promise<void> {
  erro.value = null;
  try {
    fila.value = await lerFilaDeLaudos(setorFila.value ? Number(setorFila.value) : null);
    if (palavrasCadastro.value.length === 0) palavrasCadastro.value = (await lerPalavrasChave()).itens;
  } catch (x) {
    erro.value = x;
  }
}
async function buscarCasos(): Promise<void> {
  erro.value = null;
  try {
    casos.value = (await buscarLaudosPorPalavras(palavrasBusca.value)).itens;
  } catch (x) {
    erro.value = x;
  }
}
function abrirItem(item: number): void {
  itemTexto.value = String(item);
  void carregar();
}
async function voltar(): Promise<void> {
  dados.value = null;
  versaoAberta.value = null;
  itemTexto.value = '';
  mensagem.value = null;
  const resto = { ...rota.query };
  delete resto['item'];
  await roteador.replace({ query: resto });
  await carregarFila();
}
async function verVersao(numero: number): Promise<void> {
  erro.value = null;
  try {
    versaoAberta.value = await lerVersaoDoLaudo(dados.value!.exame.item, numero);
  } catch (x) {
    erro.value = x;
  }
}
const motivos = ref<{ id: number; descricao: string }[]>([]);
const vazio = { valor: '', rotulo: '—' };
const opModelos = computed(() => [
  vazio,
  ...(dados.value?.modelos ?? []).map((m) => ({ valor: String(m.id), rotulo: m.nome })),
]);
const opResultados = (Object.keys(M.resultados) as (keyof typeof M.resultados)[]).map((valor) => ({
  valor,
  rotulo: M.resultados[valor],
}));
const opMotivos = computed(() => [
  vazio,
  ...motivos.value.map((m) => ({ valor: String(m.id), rotulo: m.descricao })),
]);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const faltam = ref<string[]>([]);
const f = reactive({
  modelo: '' as string,
  titulo: '',
  texto: '',
  resultado: '' as '' | 'normal' | 'alterado' | 'inconclusivo',
  achadoCritico: false,
  achadoCriticoDescricao: '',
  peso: '',
  altura: '',
  medidas: {} as Record<number, string>,
  palavras: [] as number[],
  motivo: '',
  motivoTexto: '',
});

const numero = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
// A medida calculada (05-SADT linha 17): a conta da fórmula vigente na data do exame, refeita a cada medida digitada
// pela mesma regra do domínio que a gravação usa (calcularGrandezas). O campo dela não se digita; sem o que a conta
// precisa, a tela diz o que falta. A medida calculada ainda sem fórmula continua digitada.
const contas = computed(() => {
  const d = dados.value;
  if (!d) return new Map<number, CalculoFormula>();
  const calculadas = new Set(d.grandezas.filter((g) => g.calculada).map((g) => g.id));
  const medidos = new Map<number, number | null>();
  for (const [g, v] of Object.entries(f.medidas)) {
    const x = numero(v ?? '');
    medidos.set(Number(g), x !== null && Number.isFinite(x) ? x : null);
  }
  return calcularGrandezas(
    d.formulas.filter((x) => calculadas.has(x.grandeza)),
    medidos,
    {
      sexo: d.paciente.sexo,
      idadeDias: d.paciente.idadeDias,
      pesoKg: numero(f.peso),
      alturaCm: numero(f.altura),
      dataExame: d.paciente.dataExame,
    },
  );
});
const calculado = (g: number): number | null => {
  const c = contas.value.get(g);
  return c?.ok ? c.valor : null;
};
const motivoDaConta = (g: number): string => {
  const c = contas.value.get(g);
  return c && !c.ok ? c.motivo : '';
};
const valores = (): CorpoLaudo['valores'] =>
  Object.entries(f.medidas)
    .filter(([g, v]) => (v ?? '').trim() !== '' && !contas.value.has(Number(g)))
    .map(([g, v]) => {
      const x = numero(v);
      return Number.isFinite(x)
        ? { grandeza: Number(g), numero: x, texto: null }
        : { grandeza: Number(g), numero: null, texto: v.trim() };
    });
const corpo = (): CorpoLaudo => ({
  modelo: f.modelo ? Number(f.modelo) : null,
  titulo: f.titulo.trim() || null,
  texto: f.texto,
  resultado: f.resultado || null,
  achadoCritico: f.achadoCritico,
  achadoCriticoDescricao: f.achadoCritico ? f.achadoCriticoDescricao.trim() : null,
  pesoKg: numero(f.peso),
  alturaCm: numero(f.altura),
  valores: valores(),
  palavrasChave: [...f.palavras],
});

// A marca de fora da referência na hora: a faixa sai de todas as faixas do exame pela mesma regra do domínio
// (faixaDaGrandezaDoPaciente), com o sexo, a idade e a data do exame e o peso e a altura digitados; vale para a medida nova também.
const superficie = computed(() => superficieCorporal(numero(f.peso), numero(f.altura)));
function faixaDe(g: number) {
  const d = dados.value;
  if (!d) return null;
  const fx = faixaDaGrandezaDoPaciente(d.faixas, g, {
    sexo: d.paciente.sexo,
    idadeDias: d.paciente.idadeDias,
    pesoKg: numero(f.peso),
    alturaCm: numero(f.altura),
    dataExame: d.paciente.dataExame,
  });
  return fx ? { minima: fx.minima, maxima: fx.maxima, indexada: fx.indexadaSuperficie } : null;
}
const faixaTexto = (g: number) => {
  const fx = faixaDe(g);
  return fx ? `${M.faixa} ${fx.minima ?? '…'}–${fx.maxima ?? '…'}${fx.indexada ? ' /m²' : ''}` : '';
};
function fora(g: number): boolean {
  const fx = faixaDe(g);
  const v = contas.value.has(g) ? calculado(g) : numero(f.medidas[g] ?? '');
  if (!fx || v === null || !Number.isFinite(v)) return false;
  const base = fx.indexada ? (superficie.value ? v / superficie.value : null) : v;
  return (
    base !== null && ((fx.minima !== null && base < fx.minima) || (fx.maxima !== null && base > fx.maxima))
  );
}
const grupos = computed(() => {
  const d = dados.value;
  if (!d) return [];
  const secoes = [
    ...d.secoes.map((s) => ({ id: s.id as number | null, nome: s.nome })),
    { id: null, nome: M.semSecao },
  ];
  return secoes
    .map((s) => ({ ...s, grandezas: d.grandezas.filter((g) => g.secao === s.id) }))
    .filter((s) => s.grandezas.length > 0);
});

async function carregar(): Promise<void> {
  erro.value = null;
  const item = Number(itemTexto.value);
  if (!Number.isInteger(item) || item <= 0) return;
  try {
    const d = await abrirLaudo(item);
    dados.value = d;
    f.modelo = d.laudo?.modelo ? String(d.laudo.modelo) : d.modelos[0] ? String(d.modelos[0].id) : '';
    f.titulo = d.laudo?.titulo ?? '';
    f.texto = d.laudo?.texto ?? '';
    f.resultado = (d.laudo?.resultado ?? '') as typeof f.resultado;
    f.achadoCritico = d.laudo?.achadoCritico ?? false;
    f.achadoCriticoDescricao = d.laudo?.achadoCriticoDescricao ?? '';
    f.peso = d.laudo?.pesoKg != null ? String(d.laudo.pesoKg) : '';
    f.altura = d.laudo?.alturaCm != null ? String(d.laudo.alturaCm) : '';
    f.palavras = [...d.palavrasChave];
    versaoAberta.value = null;
    f.medidas = Object.fromEntries(
      d.valores.map((v) => [v.grandeza, v.numero !== null ? String(v.numero) : (v.texto ?? '')]),
    );
    if (d.pode.retificar && motivos.value.length === 0) motivos.value = (await lerMotivosRetificacao()).itens;
    if (String(rota.query['item'] ?? '') !== String(item))
      await roteador.replace({ query: { ...rota.query, item: String(item) } });
  } catch (x) {
    erro.value = x;
  }
}
watch(
  () => rota.query['item'],
  (v) => {
    if (v && String(v) !== itemTexto.value) {
      itemTexto.value = String(v);
      void carregar();
    } else if (!v && dados.value) void voltar();
  },
);
if (itemTexto.value) void carregar();
else void carregarFila();
watch(setorFila, () => void carregarFila());

async function executar(fn: () => Promise<LaudoGravado>) {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await fn();
    mensagem.value = M.gravado
      .replace('{s}', (M.situacao[r.situacao] ?? r.situacao).toLowerCase())
      .replace('{v}', String(r.versaoAtual))
      .replace('{f}', String(r.foraReferencia));
    const extras = [
      r.exameLiberado ? M.exameLiberado : '',
      r.avisoCritico === 'abrir' ? M.avisoAberto.replace('{n}', String(r.avisados ?? 0)) : '',
      r.avisoCritico === 'cancelar' ? M.avisoCancelado : '',
      (r.emissoesSuperadas ?? 0) > 0 ? M.emissaoSuperada : '',
    ].filter(Boolean);
    await carregar();
    mensagem.value = [mensagem.value, ...extras].join(' ');
  } catch (x) {
    erro.value = x;
  }
}
const item = () => dados.value!.exame.item;
const salvar = (revisao: boolean) =>
  executar(() => salvarLaudo(item(), { ...corpo(), revisao }, novaChave('laudo.salvar')));
const assinar = () => executar(() => assinarLaudo(item(), corpo(), novaChave('laudo.assinar')));
const retificar = () =>
  executar(() =>
    retificarLaudo(
      item(),
      { ...corpo(), motivo: f.motivo ? Number(f.motivo) : null, motivoTexto: f.motivoTexto.trim() || null },
      novaChave('laudo.retificar'),
    ),
  );
async function aplicarModelo(): Promise<void> {
  if (!f.modelo || !dados.value) return;
  erro.value = null;
  try {
    const r = await previaDoModelo(
      item(),
      { modelo: Number(f.modelo), pesoKg: numero(f.peso), alturaCm: numero(f.altura), valores: valores() },
      novaChave('laudo.previa'),
    );
    f.texto = r.texto;
    faltam.value = r.faltam;
  } catch (x) {
    erro.value = x;
  }
}
const podeEditar = computed(() => !!dados.value && (dados.value.pode.salvar || dados.value.pode.retificar));
const motivoOk = computed(() => !!f.motivo || f.motivoTexto.trim().length >= 10);
</script>

<template>
  <section class="laudo" data-testid="laudo-redacao">
    <h1>{{ M.titulo }}</h1>
    <div class="linha">
      <SanteBotao v-if="dados" :rotulo="M.voltar" data-testid="laudo-voltar" @acionar="voltar" />
      <RouterLink :to="{ name: 'sadt.laudos.modelos' }" data-testid="laudo-ir-modelos">{{
        M.modelos
      }}</RouterLink>
    </div>
    <ErroSadt v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="laudo-mensagem">{{ mensagem }}</p>
    <template v-if="!dados">
      <h2>{{ M.fila }}</h2>
      <p>{{ M.filaTexto }}</p>
      <div class="linha">
        <SanteSelecao v-model="setorFila" :rotulo="M.setor" :opcoes="opSetores" data-testid="fila-setor" />
        <form class="linha" @submit.prevent="carregar">
          <label for="laudo-item">{{ M.item }}</label>
          <input id="laudo-item" v-model="itemTexto" inputmode="numeric" data-testid="laudo-item" />
          <SanteBotao :rotulo="M.abrir" tipo="submit" data-testid="laudo-abrir" />
        </form>
      </div>
      <p v-if="fila && fila.itens.length === 0" data-testid="fila-vazia">{{ M.filaVazia }}</p>
      <table v-else-if="fila" data-testid="fila-laudos">
        <thead>
          <tr>
            <th scope="col">{{ M.colRealizado }}</th>
            <th scope="col">{{ M.colExame }}</th>
            <th scope="col">{{ M.colPaciente }}</th>
            <th scope="col">{{ M.colProntuario }}</th>
            <th scope="col">{{ M.setor }}</th>
            <th scope="col">{{ M.colLaudo }}</th>
            <th scope="col">
              <span class="so-leitor">{{ M.laudar }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in fila.itens" :key="x.item" :data-testid="`fila-linha-${x.item}`">
            <td>{{ quando(x.realizadoEm) }}</td>
            <td>{{ x.exame }}</td>
            <td>{{ x.paciente }}</td>
            <td>{{ x.prontuario }}</td>
            <td>{{ x.setorNome }}</td>
            <td>{{ x.laudo ? (M.situacao[x.laudo] ?? x.laudo) : M.semLaudo }}</td>
            <td>
              <SanteBotao
                :rotulo="M.laudar"
                :data-testid="`fila-abrir-${x.item}`"
                @acionar="abrirItem(x.item)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <h2>{{ M.busca }}</h2>
      <p v-if="palavrasCadastro.length === 0">{{ M.semPalavras }}</p>
      <form v-else class="linha" data-testid="busca-casos" @submit.prevent="buscarCasos">
        <label v-for="p in palavrasCadastro" :key="p.id">
          <input
            v-model="palavrasBusca"
            type="checkbox"
            :value="p.id"
            :data-testid="`busca-palavra-${p.id}`"
          />
          {{ p.descricao }}
        </label>
        <SanteBotao
          :rotulo="M.buscar"
          tipo="submit"
          :desabilitado="palavrasBusca.length === 0"
          data-testid="busca-buscar"
        />
      </form>
      <p v-if="casos && casos.length === 0" data-testid="busca-vazia">{{ M.buscaVazia }}</p>
      <ul v-else-if="casos" data-testid="busca-resultado">
        <li v-for="x in casos" :key="x.item">
          {{ quando(x.assinadoEm) }} · {{ x.exame }} · {{ x.paciente }} ·
          {{ M.prontuario.replace('{p}', x.prontuario) }}
          <SanteBotao
            :rotulo="M.abrirCaso"
            :data-testid="`busca-abrir-${x.item}`"
            @acionar="abrirItem(x.item)"
          />
        </li>
      </ul>
    </template>
    <template v-if="dados">
      <p data-testid="laudo-cabecalho">
        {{ dados.exame.nome }} · {{ M.paciente }} {{ dados.paciente.nome || dados.paciente.id }}
        <span v-if="dados.paciente.prontuario"
          >· {{ M.prontuario.replace('{p}', dados.paciente.prontuario) }}</span
        >
        <span v-if="dados.paciente.idadeDias !== null"
          >· {{ M.idade.replace('{n}', String(Math.floor(dados.paciente.idadeDias / 365.25))) }}</span
        >
        · {{ M.situacao[dados.laudo?.situacao ?? 'rascunho'] }}
      </p>
      <div class="colunas">
        <div class="principal">
          <fieldset v-if="dados.grandezas.length" class="medidas">
            <legend>{{ M.medidas }}</legend>
            <div class="linha">
              <label
                >{{ M.peso }} <input v-model="f.peso" inputmode="decimal" data-testid="laudo-peso"
              /></label>
              <label
                >{{ M.altura }} <input v-model="f.altura" inputmode="decimal" data-testid="laudo-altura"
              /></label>
            </div>
            <div v-for="s in grupos" :key="String(s.id)">
              <h3>{{ s.nome }}</h3>
              <label v-for="g in s.grandezas" :key="g.id" class="medida" :class="{ fora: fora(g.id) }">
                <span
                  >{{ g.descricao }} ({{ g.sigla }})<em v-if="g.obrigatoria"> · {{ M.obrigatoria }}</em></span
                >
                <output v-if="contas.has(g.id)" class="conta" :data-testid="`laudo-medida-${g.codigo}`"
                  >{{ calculado(g.id) ?? '—' }} <em>{{ M.calculada }}</em></output
                >
                <input
                  v-else
                  v-model="f.medidas[g.id]"
                  :disabled="!podeEditar"
                  :data-testid="`laudo-medida-${g.codigo}`"
                />
                <small v-if="motivoDaConta(g.id)" :data-testid="`laudo-conta-falta-${g.codigo}`">{{
                  motivoDaConta(g.id)
                }}</small>
                <small v-if="faixaDe(g.id)">
                  {{ faixaTexto(g.id) }}
                </small>
                <strong v-if="fora(g.id)" :data-testid="`laudo-fora-${g.codigo}`">{{ M.fora }}</strong>
              </label>
            </div>
          </fieldset>
          <div class="linha">
            <SanteSelecao
              v-model="f.modelo"
              :rotulo="M.modelo"
              :opcoes="opModelos"
              data-testid="laudo-modelo"
            />
            <SanteBotao
              :rotulo="M.aplicar"
              :desabilitado="!f.modelo || !podeEditar"
              data-testid="laudo-aplicar"
              @acionar="aplicarModelo"
            />
          </div>
          <p v-if="faltam.length" role="note">{{ M.faltam.replace('{c}', faltam.join(', ')) }}</p>
          <label
            >{{ M.texto }}
            <textarea v-model="f.texto" rows="14" :disabled="!podeEditar" data-testid="laudo-texto" />
          </label>
          <div class="linha">
            <SanteSelecao
              v-model="f.resultado"
              :rotulo="M.resultado"
              :opcoes="opResultados"
              data-testid="laudo-resultado"
            />
            <label
              ><input v-model="f.achadoCritico" type="checkbox" data-testid="laudo-critico" />
              {{ M.critico }}</label
            >
            <input
              v-if="f.achadoCritico"
              v-model="f.achadoCriticoDescricao"
              :aria-label="M.criticoDescricao"
              maxlength="500"
            />
          </div>
          <fieldset v-if="dados.palavras.length" class="linha" data-testid="laudo-palavras">
            <legend>{{ M.palavras }}</legend>
            <label v-for="p in dados.palavras" :key="p.id">
              <input
                v-model="f.palavras"
                type="checkbox"
                :value="p.id"
                :disabled="!podeEditar"
                :data-testid="`laudo-palavra-${p.id}`"
              />
              {{ p.descricao }}
            </label>
          </fieldset>
          <div v-if="dados.pode.salvar" class="linha">
            <SanteBotao :rotulo="M.salvar" data-testid="laudo-salvar" @acionar="salvar(false)" />
            <SanteBotao :rotulo="M.revisao" data-testid="laudo-revisao" @acionar="salvar(true)" />
            <SanteBotao :rotulo="M.assinar" data-testid="laudo-assinar" @acionar="assinar" />
          </div>
          <div v-if="dados.pode.retificar" class="linha">
            <SanteSelecao
              v-model="f.motivo"
              :rotulo="M.motivo"
              :opcoes="opMotivos"
              data-testid="laudo-motivo"
            />
            <input
              v-model="f.motivoTexto"
              :aria-label="M.motivoTexto"
              :placeholder="M.motivoTexto"
              maxlength="500"
            />
            <SanteBotao
              :rotulo="M.retificar"
              :desabilitado="!motivoOk"
              data-testid="laudo-retificar"
              @acionar="retificar"
            />
          </div>
        </div>
        <aside class="versoes" data-testid="laudo-versoes">
          <h2>{{ M.versoes }}</h2>
          <ol reversed>
            <li v-for="v in dados.versoes" :key="v.numero">
              {{ v.numero }} · {{ M.situacao[v.situacao] ?? v.situacao }} ·
              {{ new Date(v.em).toLocaleString('pt-BR') }}
              <span v-if="v.motivo"> · {{ v.motivo }}</span>
              <SanteBotao
                :rotulo="M.verTexto"
                :data-testid="`laudo-versao-ver-${v.numero}`"
                @acionar="verVersao(v.numero)"
              />
            </li>
          </ol>
          <article v-if="versaoAberta" data-testid="laudo-versao-texto">
            <h3>
              {{
                M.versaoDe
                  .replace('{n}', String(versaoAberta.numero))
                  .replace('{s}', M.situacao[versaoAberta.situacao] ?? versaoAberta.situacao)
                  .replace('{q}', quando(versaoAberta.em))
              }}
            </h3>
            <p v-if="versaoAberta.laudista">{{ M.por.replace('{p}', versaoAberta.laudista) }}</p>
            <p v-if="versaoAberta.motivo">{{ M.motivo }}: {{ versaoAberta.motivo }}</p>
            <p class="texto-versao">{{ versaoAberta.texto }}</p>
            <SanteBotao :rotulo="M.fecharVersao" @acionar="versaoAberta = null" />
          </article>
          <template v-if="dados.anteriores.length">
            <h2>{{ M.anteriores }}</h2>
            <details v-for="a in dados.anteriores" :key="a.item" :data-testid="`laudo-anterior-${a.item}`">
              <summary>
                {{
                  M.anterior
                    .replace('{q}', quando(a.assinadoEm))
                    .replace('{r}', M.resultados[(a.resultado ?? '') as keyof typeof M.resultados] ?? '—')
                }}
                <strong v-if="a.achadoCritico"> · {{ M.critico }}</strong>
              </summary>
              <p class="texto-versao">{{ a.texto }}</p>
            </details>
          </template>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.laudo {
  display: grid;
  gap: 0.75rem;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
.colunas {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 16rem;
  gap: 1rem;
}
.principal {
  display: grid;
  gap: 0.75rem;
}
.medida {
  display: grid;
  grid-template-columns: 1fr 8rem auto auto;
  gap: 0.5rem;
  align-items: center;
}
.medida.fora input {
  border-color: var(--sgh-aviso);
}
textarea {
  width: 100%;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 0.25rem 0.5rem;
}
.texto-versao {
  white-space: pre-wrap;
}
.so-leitor {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
@media (max-width: 800px) {
  .colunas {
    grid-template-columns: 1fr;
  }
}
</style>
