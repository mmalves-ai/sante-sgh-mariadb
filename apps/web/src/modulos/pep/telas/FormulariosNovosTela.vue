<script setup lang="ts">
// Construtor de formulários novos (ficha do M45, seção 7; etapa 1; cap-11 §11.1): a lista das versões com os casos que
// passam; o editor da definição (código, título, tipo de registro, especialidades com busca), a árvore de perguntas
// (incluir, subir, descer, remover; seções com itens), as propriedades da pergunta (tipo, opções com pontos, faixa,
// regras de exibição e de cálculo em JSON Logic, reuso do banco de perguntas), a prévia ao vivo (o total sempre
// calculado, as perguntas que aparecem) com o registro-resumo, os casos de teste executados na hora; e o ciclo
// (salvar, enviar à revisão, aprovar ou devolver com parecer, publicar com a senha e o hash, aposentar com motivo, nova
// versão). A versão publicada não muda. Sem dado de paciente.
import {
  type CasoFormularioNovo,
  type DefinicaoFormularioNovo,
  type PerguntaFormularioNovo,
  TIPOS_COM_OPCOES,
  TIPOS_PERGUNTA_FORMULARIO_NOVO,
  TIPOS_REGISTRO_FORMULARIO_NOVO,
  type TipoPerguntaFormularioNovo,
  type ValorCasoFormularioNovo,
  type VersaoFormularioNovoDetalhe,
} from '@sgh/contratos';
import {
  avaliarFormularioNovo,
  conferirDefinicao,
  executarCasos,
  FORMULARIO_NOVO_SINTETICO,
  CASOS_FORMULARIO_NOVO_SINTETICO,
  textoDoResumo,
} from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  aposentarFormularioNovo,
  buscarBancoDePerguntas,
  chaveFormularioNovo,
  codigoDaRecusa,
  decidirFormularioNovo,
  enviarRevisaoFormularioNovo,
  lerEspecialidadesFormularioNovo,
  lerFormularioNovo,
  lerFormulariosNovos,
  publicarFormularioNovo,
  salvarFormularioNovo,
} from '../api-formulario-novo.js';

type Ed<T> = T extends readonly (infer U)[]
  ? Ed<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Ed<T[K]> }
    : T;
type PerguntaEd = Ed<PerguntaFormularioNovo>;
type DefinicaoEd = Ed<DefinicaoFormularioNovo>;
type CasoEd = Ed<CasoFormularioNovo>;

const { t } = useI18n();
const cliente = useQueryClient();
const lista = useQuery({ queryKey: ['pep', 'formularios-novos'], queryFn: () => lerFormulariosNovos() });
const especialidades = useQuery({
  queryKey: ['pep', 'formularios-novos', 'especialidades'],
  queryFn: () => lerEspecialidadesFormularioNovo(),
});
const podeEditar = computed(() => pode('pep.formularioNovo.editar') && lista.data.value?.ligada === true);
const podeAprovar = computed(() => pode('pep.formularioNovo.aprovar') && lista.data.value?.ligada === true);
const podePublicar = computed(() => pode('pep.formularioNovo.publicar') && lista.data.value?.ligada === true);
const podeAposentar = computed(
  () => pode('pep.formularioNovo.aposentar') && lista.data.value?.ligada === true,
);

const busca = ref('');
const versoes = computed(() => {
  const q = busca.value.trim().toUpperCase();
  return (lista.data.value?.versoes ?? []).filter(
    (v) => !q || v.codigo.includes(q) || v.titulo.toUpperCase().includes(q),
  );
});

// ── Editor ──
const aberto = ref<VersaoFormularioNovoDetalhe | null>(null);
const def = ref<DefinicaoEd | null>(null);
const casos = ref<CasoEd[]>([]);
const novo = ref<{ baseadoEm: number | null } | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
const copia = <T,>(x: T): Ed<T> => JSON.parse(JSON.stringify(x)) as Ed<T>;
const editavel = computed(
  () => podeEditar.value && (novo.value !== null || aberto.value?.estado === 'rascunho'),
);

async function abrir(id: number): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  const d = await lerFormularioNovo(id);
  aberto.value = d;
  novo.value = null;
  def.value = copia(d.definicao);
  casos.value = copia(d.casosTeste);
  selecionada.value = null;
  respostasPrevia.value = {};
}
function criar(): void {
  aberto.value = null;
  novo.value = { baseadoEm: null };
  def.value = copia(FORMULARIO_NOVO_SINTETICO);
  def.value.codigo = '';
  casos.value = copia(CASOS_FORMULARIO_NOVO_SINTETICO);
  selecionada.value = null;
  respostasPrevia.value = {};
  mensagem.value = null;
  erro.value = null;
}
function novaVersao(): void {
  if (!aberto.value) return;
  novo.value = { baseadoEm: aberto.value.id };
  const base = aberto.value;
  aberto.value = null;
  def.value = copia(base.definicao);
  casos.value = copia(base.casosTeste);
}
function fechar(): void {
  aberto.value = null;
  novo.value = null;
  def.value = null;
}

const opcoesTipoRegistro = computed(() =>
  TIPOS_REGISTRO_FORMULARIO_NOVO.map((x) => ({
    valor: x,
    rotulo: t(`pep.formNovo.definicao.tiposRegistro.${x}`),
  })),
);
const opcoesTipo = computed(() =>
  TIPOS_PERGUNTA_FORMULARIO_NOVO.map((x) => ({ valor: x, rotulo: t(`pep.formNovo.perguntas.tipos.${x}`) })),
);
const especialidadeEscolhida = ref<number | null>(null);
const opcoesEspecialidade = computed(() => [
  { valor: null, rotulo: t('pep.formNovo.definicao.especialidadesBusca') },
  ...(especialidades.data.value ?? [])
    .filter((e) => !def.value?.especialidades.includes(e.codigo))
    .map((e) => ({ valor: e.codigo, rotulo: e.nome })),
]);
const nomeEspecialidade = (c: number) =>
  especialidades.data.value?.find((e) => e.codigo === c)?.nome ?? String(c);
watch(especialidadeEscolhida, (v) => {
  if (v !== null && def.value && !def.value.especialidades.includes(v)) def.value.especialidades.push(v);
  especialidadeEscolhida.value = null;
});

// ── Árvore (lista achatada com o caminho de cada pergunta) ──
interface Linha {
  readonly p: PerguntaEd;
  readonly caminho: number[];
  readonly nivel: number;
  readonly irmaos: PerguntaEd[];
}
const linhas = computed<Linha[]>(() => {
  const r: Linha[] = [];
  const visitar = (ps: PerguntaEd[], caminho: number[], nivel: number) =>
    ps.forEach((p, i) => {
      r.push({ p, caminho: [...caminho, i], nivel, irmaos: ps });
      visitar(p.itens, [...caminho, i], nivel + 1);
    });
  if (def.value) visitar(def.value.perguntas, [], 1);
  return r;
});
const selecionada = ref<PerguntaEd | null>(null);
let seqLink = 0;
const novaPergunta = (tipo: TipoPerguntaFormularioNovo): PerguntaEd => ({
  linkId: `p${Date.now().toString(36)}${(seqLink++).toString(36)}`.slice(0, 40),
  tipo,
  titulo: tipo === 'secao' ? t('pep.formNovo.perguntas.incluirSecao') : t('pep.formNovo.perguntas.incluir'),
  obrigatorio: false,
  unidade: null,
  minimo: null,
  maximo: null,
  opcoes: [],
  habilitar: null,
  calcular: null,
  reuso: null,
  itens: [],
});
function incluir(tipo: TipoPerguntaFormularioNovo, em: PerguntaEd[] | null = null): void {
  if (!def.value) return;
  const p = novaPergunta(tipo);
  (em ?? def.value.perguntas).push(p);
  selecionada.value = p;
}
function mover(l: Linha, d: -1 | 1): void {
  const i = l.caminho[l.caminho.length - 1]!;
  const j = i + d;
  if (j < 0 || j >= l.irmaos.length) return;
  [l.irmaos[i], l.irmaos[j]] = [l.irmaos[j]!, l.irmaos[i]!];
}
function remover(l: Linha): void {
  l.irmaos.splice(l.caminho[l.caminho.length - 1]!, 1);
  if (selecionada.value === l.p) selecionada.value = null;
}
const temOpcoes = (p: PerguntaEd) => TIPOS_COM_OPCOES.has(p.tipo);
function incluirOpcao(p: PerguntaEd): void {
  p.opcoes.push({
    codigo: `o${p.opcoes.length + 1}`,
    texto: `${t('pep.formNovo.perguntas.textoOpcao')} ${p.opcoes.length + 1}`,
    pontos: null,
  });
}

// Regras em JSON (avançado): o texto é conferido ao vivo; inválido não entra na definição.
const regraTexto = ref({ habilitar: '', calcular: '' });
const regraInvalida = ref({ habilitar: false, calcular: false });
watch(selecionada, (p) => {
  regraTexto.value = {
    habilitar: p?.habilitar ? JSON.stringify(p.habilitar) : '',
    calcular: p?.calcular ? JSON.stringify(p.calcular) : '',
  };
  regraInvalida.value = { habilitar: false, calcular: false };
  termoBanco.value = p?.titulo ?? '';
  achadas.value = [];
  somaMarcadas.value = somaDaRegra(p?.calcular ?? null);
  condicao.value = { pergunta: null, operador: '>=', valor: '' };
});
// Uma soma simples já gravada volta marcada no guiado.
function somaDaRegra(r: unknown): string[] {
  if (!r || typeof r !== 'object' || !('+' in r)) return [];
  const termos = (r as { '+': unknown })['+'];
  if (!Array.isArray(termos)) return [];
  const vars = termos.map((x) =>
    x && typeof x === 'object' && 'var' in x && typeof (x as { var: unknown }).var === 'string'
      ? (x as { var: string }).var
      : null,
  );
  return vars.every((v) => v !== null) ? (vars as string[]) : [];
}
function trocarRegra(campo: 'habilitar' | 'calcular', texto: string): void {
  regraTexto.value[campo] = texto;
  if (!selecionada.value) return;
  if (texto.trim() === '') {
    selecionada.value[campo] = null;
    regraInvalida.value[campo] = false;
    return;
  }
  try {
    selecionada.value[campo] = JSON.parse(texto) as unknown;
    regraInvalida.value[campo] = false;
  } catch {
    regraInvalida.value[campo] = true;
  }
}
// Construtor guiado (sem escrever JSON): soma dos pontos e condição "mostrar só quando". Gera JSON Logic que o
// domínio confere (`conferirDefinicao`); o campo avançado continua para o que o guiado não cobre.
const somaMarcadas = ref<string[]>([]);
const somaCandidatas = computed(() =>
  linhas.value
    .map((l) => l.p)
    .filter(
      (p) =>
        p !== selecionada.value &&
        p.tipo !== 'secao' &&
        (TIPOS_COM_OPCOES.has(p.tipo) || p.tipo === 'inteiro' || p.tipo === 'decimal'),
    ),
);
function marcarSoma(linkId: string, marcado: boolean): void {
  somaMarcadas.value = marcado
    ? [...somaMarcadas.value, linkId]
    : somaMarcadas.value.filter((x) => x !== linkId);
}
function usarSoma(): void {
  if (!selecionada.value || somaMarcadas.value.length === 0) return;
  const regra = { '+': somaMarcadas.value.map((v) => ({ var: v })) };
  selecionada.value.calcular = regra;
  regraTexto.value.calcular = JSON.stringify(regra);
  regraInvalida.value.calcular = false;
}
const OPERADORES_GUIADOS = ['<=', '>=', '=='] as const;
type OperadorGuiado = (typeof OPERADORES_GUIADOS)[number];
const condicao = ref<{ pergunta: string | null; operador: OperadorGuiado; valor: string }>({
  pergunta: null,
  operador: '>=',
  valor: '',
});
const opcoesCondicaoPergunta = computed(() => [
  { valor: null, rotulo: t('pep.formNovo.tela.guiado.escolher') },
  ...linhas.value
    .map((l) => l.p)
    .filter((p) => p !== selecionada.value && p.tipo !== 'secao')
    .map((p) => ({ valor: p.linkId, rotulo: p.titulo })),
]);
const opcoesOperador = computed(() =>
  OPERADORES_GUIADOS.map((o) => ({ valor: o, rotulo: t(`pep.formNovo.tela.guiado.operadores.${o}`) })),
);
function usarCondicao(): void {
  const c = condicao.value;
  if (!selecionada.value || !c.pergunta || c.valor.trim() === '') return;
  const n = Number(c.valor);
  const regra = { [c.operador]: [{ var: c.pergunta }, Number.isNaN(n) ? c.valor.trim() : n] };
  selecionada.value.habilitar = regra;
  regraTexto.value.habilitar = JSON.stringify(regra);
  regraInvalida.value.habilitar = false;
}
function limparCondicao(): void {
  if (!selecionada.value) return;
  selecionada.value.habilitar = null;
  regraTexto.value.habilitar = '';
  regraInvalida.value.habilitar = false;
}
const numeroOuNulo = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v));

// Banco de perguntas (reuso): busca no servidor; reaproveitar só a pergunta igual (título, tipo, unidade, opções).
const termoBanco = ref('');
const achadas = ref<Awaited<ReturnType<typeof buscarBancoDePerguntas>>>([]);
async function procurarBanco(): Promise<void> {
  if (!selecionada.value || termoBanco.value.trim().length < 2) return;
  achadas.value = await buscarBancoDePerguntas(
    termoBanco.value.trim(),
    selecionada.value.tipo === 'secao' ? null : selecionada.value.tipo,
  );
}
function reaproveitar(b: (typeof achadas.value)[number]): void {
  const p = selecionada.value;
  if (!p || !b.tipo) return;
  p.reuso = b.id;
  p.titulo = b.titulo;
  p.tipo = b.tipo;
  p.unidade = b.unidade;
  p.opcoes = b.opcoes.map((texto, i) => ({
    codigo: p.opcoes[i]?.codigo ?? `o${i + 1}`,
    texto,
    pontos: p.opcoes[i]?.pontos ?? null,
  }));
}

// ── Conferência, prévia e casos (o domínio puro, ao vivo) ──
const problemas = computed(() => (def.value ? conferirDefinicao(def.value as DefinicaoFormularioNovo) : []));
const hoje = new Date().toISOString().slice(0, 10);
const respostasPrevia = ref<Record<string, ValorCasoFormularioNovo>>({});
const avaliado = computed(() => {
  if (!def.value || problemas.value.length) return null;
  try {
    return avaliarFormularioNovo(def.value as DefinicaoFormularioNovo, respostasPrevia.value, hoje);
  } catch {
    return null;
  }
});
const resumo = computed(() => {
  if (!def.value || !avaliado.value) return '';
  try {
    return textoDoResumo(
      def.value as DefinicaoFormularioNovo,
      aberto.value?.versao ?? 1,
      respostasPrevia.value,
      hoje,
    );
  } catch {
    return '';
  }
});
const resultados = computed(() =>
  def.value && !problemas.value.length
    ? executarCasos(def.value as DefinicaoFormularioNovo, casos.value as CasoFormularioNovo[], hoje)
    : [],
);
const calculadas = computed(() => linhas.value.filter((l) => l.p.calcular !== null).map((l) => l.p));
function casoDaPrevia(): void {
  if (!avaliado.value) return;
  const esperado: Record<string, ValorCasoFormularioNovo> = {};
  for (const p of calculadas.value)
    esperado[p.linkId] = (avaliado.value.valores[p.linkId] as ValorCasoFormularioNovo) ?? null;
  casos.value.push({
    nome: t('pep.formNovo.tela.casoNome', { n: casos.value.length + 1 }),
    respostas: JSON.parse(JSON.stringify(respostasPrevia.value)) as Record<string, ValorCasoFormularioNovo>,
    esperado,
    habilitadasEsperadas: [...avaliado.value.habilitadas],
  });
}
function marcarMultipla(linkId: string, codigo: string, marcado: boolean): void {
  const atual = Array.isArray(respostasPrevia.value[linkId])
    ? (respostasPrevia.value[linkId] as string[])
    : [];
  respostasPrevia.value = {
    ...respostasPrevia.value,
    [linkId]: marcado ? [...atual, codigo] : atual.filter((c) => c !== codigo),
  };
}
function responder(linkId: string, v: ValorCasoFormularioNovo): void {
  respostasPrevia.value = { ...respostasPrevia.value, [linkId]: v === '' ? null : v };
}
const opcoesDaPrevia = (p: PerguntaEd) => [
  { valor: null, rotulo: t('pep.formNovo.tela.semValor') },
  ...p.opcoes.map((o) => ({ valor: o.codigo, rotulo: o.texto })),
];
const valorTexto = (v: unknown) => (v === null || v === undefined ? '' : String(v));

// ── Ciclo ──
const textoErro = (e: unknown): string | null => {
  const c = codigoDaRecusa(e);
  const mapa: Record<string, string> = {
    'versao-concorrente': 'pep.formNovo.acoes.concorrente',
    imutavel: 'pep.formNovo.acoes.imutavel',
    'aprovador-e-autor': 'pep.formNovo.acoes.proprioAutor',
    'publicador-e-autor': 'pep.formNovo.acoes.proprioAutorPublica',
    'hash-divergente': 'pep.formNovo.acoes.hashMudou',
    'sem-casos': 'pep.formNovo.casos.nenhum',
  };
  return c && mapa[c] ? t(mapa[c]) : null;
};
async function acao(f: () => Promise<{ id: number; mensagem: string }>): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await f();
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['pep', 'formularios-novos'] });
    await abrir(r.id);
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const salvar = () =>
  acao(() =>
    salvarFormularioNovo(
      {
        id: aberto.value?.id ?? null,
        baseadoEm: novo.value?.baseadoEm ?? null,
        definicao: def.value as DefinicaoFormularioNovo,
        casos: casos.value as CasoFormularioNovo[],
        versaoEsperada: aberto.value?.versaoLinha ?? null,
      },
      chaveFormularioNovo('salvar'),
    ),
  );
const enviarRevisao = () =>
  acao(() =>
    enviarRevisaoFormularioNovo(aberto.value!.id, aberto.value!.versaoLinha, chaveFormularioNovo('revisao')),
  );
const parecer = ref('');
const decidir = (decisao: 'aprovar' | 'devolver') =>
  acao(() =>
    decidirFormularioNovo(
      aberto.value!.id,
      { versaoEsperada: aberto.value!.versaoLinha, decisao, parecer: parecer.value },
      chaveFormularioNovo('decisao'),
    ),
  );
const dialogo = ref<'publicar' | 'aposentar' | null>(null);
const senha = ref('');
const motivo = ref('');
const visivel = computed({
  get: () => dialogo.value !== null,
  set: (v: boolean) => {
    if (!v) dialogo.value = null;
  },
});
async function confirmarDialogo(): Promise<void> {
  const v = aberto.value!;
  const s = senha.value;
  const tipo = dialogo.value;
  dialogo.value = null;
  senha.value = '';
  if (tipo === 'publicar')
    await acao(() =>
      publicarFormularioNovo(
        v.id,
        { versaoEsperada: v.versaoLinha, contentHashEsperado: v.contentHashAtual, senha: s },
        chaveFormularioNovo('publicar'),
      ),
    );
  else
    await acao(() =>
      aposentarFormularioNovo(v.id, { motivo: motivo.value, senha: s }, chaveFormularioNovo('aposentar')),
    );
  motivo.value = '';
}
</script>

<template>
  <section class="tela" aria-labelledby="fn-titulo" data-testid="tela-formularios-novos">
    <h1 id="fn-titulo">{{ t('pep.formNovo.titulo') }}</h1>
    <p>{{ t('pep.formNovo.texto') }}</p>
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('pep.formNovo.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!lista.data.value.ligada"
        variante="alerta"
        data-testid="fn-consulta"
        :texto="
          t('pep.formNovo.tela.consulta', { motivo: lista.data.value.motivo ?? t('pep.formNovo.desligado') })
        "
      />
      <SanteAlerta
        variante="info"
        data-testid="fn-ponte"
        :texto="
          lista.data.value.ponte.ligada
            ? t('pep.formNovo.tela.ponteLigada')
            : t('pep.formNovo.tela.ponte', { motivo: lista.data.value.ponte.motivo ?? '' })
        "
      />
      <div class="barra">
        <SanteCampoTexto v-model="busca" :rotulo="t('pep.formNovo.lista.busca')" :max-bytes="60" />
        <SanteBotao
          v-if="podeEditar"
          :rotulo="t('pep.formNovo.lista.novo')"
          data-testid="fn-novo"
          @acionar="criar"
        />
      </div>
      <div class="rolagem">
        <table class="tabela" data-testid="fn-tabela">
          <caption>
            {{
              t('pep.formNovo.lista.legenda', { n: versoes.length })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('pep.formNovo.lista.codigo') }}</th>
              <th scope="col">{{ t('pep.formNovo.lista.tituloColuna') }}</th>
              <th scope="col">{{ t('pep.formNovo.lista.versao') }}</th>
              <th scope="col">{{ t('pep.formNovo.lista.estado') }}</th>
              <th scope="col">{{ t('pep.formNovo.lista.casos') }}</th>
              <th scope="col">{{ t('pep.formNovo.lista.atualizado') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="versoes.length === 0">
              <td colspan="6">{{ t('pep.formNovo.lista.vazio') }}</td>
            </tr>
            <tr v-for="v in versoes" :key="v.id" :data-testid="`fn-linha-${v.codigo}-${v.versao}`">
              <td>
                <button
                  type="button"
                  class="link"
                  :aria-label="t('pep.formNovo.lista.abrir', { codigo: v.codigo, versao: v.versao })"
                  @click="abrir(v.id)"
                >
                  {{ v.codigo }}
                </button>
              </td>
              <td>{{ v.titulo }}</td>
              <td>{{ v.versao }}</td>
              <td>{{ t(`pep.formNovo.estados.${v.estado}`) }}</td>
              <td>
                {{ t('pep.formNovo.lista.casosResumo', { verdes: v.casosVerdes ?? 0, total: v.casos }) }}
              </td>
              <td>{{ v.atualizadoEm.replace('T', ' ').slice(0, 16) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <section v-if="def" class="editor" aria-labelledby="fn-editor" data-testid="fn-editor">
        <h2 id="fn-editor">
          {{
            aberto
              ? t('pep.formNovo.tela.editando', {
                  codigo: aberto.codigo,
                  versao: aberto.versao,
                  estado: t(`pep.formNovo.estados.${aberto.estado}`),
                })
              : t('pep.formNovo.tela.novoTitulo')
          }}
        </h2>
        <p v-if="aberto">
          {{ t('pep.formNovo.tela.autor', { autor: aberto.autor }) }}
          <span data-testid="fn-hash">{{
            t('pep.formNovo.tela.hashAtual', { hash: aberto.contentHashAtual })
          }}</span>
        </p>
        <SanteAlerta
          v-if="aberto?.integro === true"
          variante="info"
          data-testid="fn-integro"
          :texto="t('pep.formNovo.integridade.integro')"
        />
        <SanteAlerta
          v-if="aberto?.integro === false"
          variante="alerta"
          :texto="t('pep.formNovo.integridade.alterado')"
        />
        <p v-if="aberto?.codigoModelo">
          {{ t('pep.formNovo.tela.modeloCriado', { codigo: aberto.codigoModelo }) }}
        </p>

        <fieldset :disabled="!editavel">
          <legend>{{ t('pep.formNovo.definicao.tituloCampo') }}</legend>
          <SanteCampoTexto
            v-model="def.codigo"
            data-testid="fn-codigo"
            :rotulo="t('pep.formNovo.definicao.codigo')"
            :max-bytes="10"
            obrigatorio
          />
          <p class="ajuda">{{ t('pep.formNovo.definicao.codigoAjuda') }}</p>
          <SanteCampoTexto
            v-model="def.titulo"
            data-testid="fn-titulo-campo"
            :rotulo="t('pep.formNovo.definicao.tituloCampo')"
            :max-bytes="100"
            obrigatorio
          />
          <SanteSelecao
            v-model="def.tipoRegistro"
            :rotulo="t('pep.formNovo.definicao.tipoRegistro')"
            :opcoes="opcoesTipoRegistro"
          />
          <SanteSelecao
            v-model="especialidadeEscolhida"
            data-testid="fn-especialidade"
            busca
            :rotulo="t('pep.formNovo.definicao.especialidades')"
            :opcoes="opcoesEspecialidade"
          />
          <p class="ajuda">{{ t('pep.formNovo.definicao.especialidadesAjuda') }}</p>
          <ul class="chips">
            <li v-if="def.especialidades.length === 0">{{ t('pep.formNovo.tela.nenhumaEspecialidade') }}</li>
            <li v-for="(c, i) in def.especialidades" :key="c">
              {{ nomeEspecialidade(c) }}
              <SanteBotao
                variante="texto"
                :rotulo="t('pep.formNovo.tela.especialidadeRemover', { nome: nomeEspecialidade(c) })"
                @acionar="def.especialidades.splice(i, 1)"
              />
            </li>
          </ul>
        </fieldset>

        <div class="paineis">
          <fieldset class="painel" :disabled="!editavel">
            <legend>{{ t('pep.formNovo.perguntas.legenda') }}</legend>
            <ul
              role="tree"
              :aria-label="t('pep.formNovo.perguntas.legenda')"
              class="arvore"
              data-testid="fn-arvore"
            >
              <li
                v-for="(l, n) in linhas"
                :key="l.p.linkId"
                role="treeitem"
                :aria-level="l.nivel"
                :aria-selected="selecionada === l.p"
                :style="{ paddingInlineStart: `${(l.nivel - 1) * 1.5}rem` }"
              >
                <button
                  type="button"
                  class="link"
                  :data-testid="`fn-pergunta-${l.p.linkId}`"
                  @click="selecionada = l.p"
                >
                  {{ t('pep.formNovo.tela.pergunta', { n: n + 1, titulo: l.p.titulo }) }}
                </button>
                <SanteBotao
                  variante="texto"
                  :rotulo="t('pep.formNovo.perguntas.subir', { titulo: l.p.titulo })"
                  @acionar="mover(l, -1)"
                />
                <SanteBotao
                  variante="texto"
                  :rotulo="t('pep.formNovo.perguntas.descer', { titulo: l.p.titulo })"
                  @acionar="mover(l, 1)"
                />
                <SanteBotao
                  variante="texto"
                  :rotulo="t('pep.formNovo.perguntas.remover', { titulo: l.p.titulo })"
                  @acionar="remover(l)"
                />
                <SanteBotao
                  v-if="l.p.tipo === 'secao'"
                  variante="texto"
                  :rotulo="t('pep.formNovo.tela.incluirItem', { titulo: l.p.titulo })"
                  @acionar="incluir('texto', l.p.itens)"
                />
              </li>
            </ul>
            <p class="acoes">
              <SanteBotao
                variante="secundario"
                :rotulo="t('pep.formNovo.perguntas.incluir')"
                data-testid="fn-incluir"
                @acionar="incluir('texto')"
              />
              <SanteBotao
                variante="secundario"
                :rotulo="t('pep.formNovo.perguntas.incluirSecao')"
                @acionar="incluir('secao')"
              />
            </p>
          </fieldset>

          <fieldset v-if="selecionada" class="painel" :disabled="!editavel" data-testid="fn-propriedades">
            <legend>{{ selecionada.titulo }}</legend>
            <SanteCampoTexto
              v-model="selecionada.titulo"
              data-testid="fn-p-titulo"
              :rotulo="t('pep.formNovo.perguntas.tituloCampo')"
              :max-bytes="100"
            />
            <SanteSelecao
              v-model="selecionada.tipo"
              data-testid="fn-p-tipo"
              :rotulo="t('pep.formNovo.perguntas.tipo')"
              :opcoes="opcoesTipo"
            />
            <label v-if="selecionada.tipo !== 'secao'">
              <input v-model="selecionada.obrigatorio" type="checkbox" />
              {{ t('pep.formNovo.perguntas.obrigatorio') }}
            </label>
            <template v-if="selecionada.tipo === 'decimal' || selecionada.tipo === 'inteiro'">
              <label
                >{{ t('pep.formNovo.perguntas.minimo') }}
                <input
                  type="number"
                  :value="selecionada.minimo ?? ''"
                  @input="selecionada.minimo = numeroOuNulo(($event.target as HTMLInputElement).value)"
              /></label>
              <label
                >{{ t('pep.formNovo.perguntas.maximo') }}
                <input
                  type="number"
                  :value="selecionada.maximo ?? ''"
                  @input="selecionada.maximo = numeroOuNulo(($event.target as HTMLInputElement).value)"
              /></label>
            </template>
            <label v-if="selecionada.tipo !== 'secao'"
              >{{ t('pep.formNovo.perguntas.unidade') }}
              <input
                :value="selecionada.unidade ?? ''"
                maxlength="10"
                @input="selecionada.unidade = ($event.target as HTMLInputElement).value || null"
            /></label>
            <fieldset v-if="temOpcoes(selecionada)">
              <legend>{{ t('pep.formNovo.perguntas.opcoes') }}</legend>
              <p class="ajuda">{{ t('pep.formNovo.perguntas.pontosAjuda') }}</p>
              <div v-for="(o, i) in selecionada.opcoes" :key="i" class="linha-opcao">
                <SanteCampoTexto
                  v-model="o.texto"
                  :rotulo="t('pep.formNovo.tela.opcao', { n: i + 1 })"
                  :max-bytes="255"
                />
                <label
                  >{{ t('pep.formNovo.perguntas.pontos') }}
                  <input
                    type="number"
                    :value="o.pontos ?? ''"
                    :data-testid="`fn-pontos-${i}`"
                    @input="o.pontos = numeroOuNulo(($event.target as HTMLInputElement).value)"
                /></label>
                <SanteBotao
                  variante="texto"
                  :rotulo="t('pep.formNovo.tela.removerOpcao', { n: i + 1 })"
                  @acionar="selecionada.opcoes.splice(i, 1)"
                />
              </div>
              <SanteBotao
                variante="texto"
                :rotulo="t('pep.formNovo.perguntas.incluirOpcao')"
                @acionar="incluirOpcao(selecionada)"
              />
            </fieldset>
            <fieldset v-if="selecionada.tipo !== 'secao'" data-testid="fn-guiado">
              <legend>{{ t('pep.formNovo.tela.guiado.legenda') }}</legend>
              <fieldset v-if="selecionada.tipo === 'inteiro' || selecionada.tipo === 'decimal'">
                <legend>{{ t('pep.formNovo.tela.guiado.somaTitulo') }}</legend>
                <label v-for="c in somaCandidatas" :key="c.linkId">
                  <input
                    type="checkbox"
                    :data-testid="`fn-soma-${c.linkId}`"
                    :checked="somaMarcadas.includes(c.linkId)"
                    @change="marcarSoma(c.linkId, ($event.target as HTMLInputElement).checked)"
                  />
                  {{ c.titulo }}
                </label>
                <p v-if="somaMarcadas.length === 0" class="ajuda">
                  {{ t('pep.formNovo.tela.guiado.somaNenhuma') }}
                </p>
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('pep.formNovo.tela.guiado.somaUsar')"
                  :desabilitado="somaMarcadas.length === 0"
                  data-testid="fn-soma-usar"
                  @acionar="usarSoma"
                />
              </fieldset>
              <fieldset>
                <legend>{{ t('pep.formNovo.tela.guiado.condicaoTitulo') }}</legend>
                <SanteSelecao
                  v-model="condicao.pergunta"
                  busca
                  data-testid="fn-condicao-pergunta"
                  :rotulo="t('pep.formNovo.tela.guiado.condicaoPergunta')"
                  :opcoes="opcoesCondicaoPergunta"
                />
                <SanteSelecao
                  v-model="condicao.operador"
                  data-testid="fn-condicao-operador"
                  :rotulo="t('pep.formNovo.tela.guiado.condicaoOperador')"
                  :opcoes="opcoesOperador"
                />
                <SanteCampoTexto
                  v-model="condicao.valor"
                  data-testid="fn-condicao-valor"
                  :rotulo="t('pep.formNovo.tela.guiado.condicaoValor')"
                  :max-bytes="40"
                />
                <p class="acoes">
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t('pep.formNovo.tela.guiado.condicaoUsar')"
                    :desabilitado="!condicao.pergunta || condicao.valor.trim() === ''"
                    data-testid="fn-condicao-usar"
                    @acionar="usarCondicao"
                  />
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('pep.formNovo.tela.guiado.condicaoLimpar')"
                    @acionar="limparCondicao"
                  />
                </p>
              </fieldset>
            </fieldset>
            <details>
              <summary>{{ t('pep.formNovo.tela.avancado') }}</summary>
              <p class="ajuda">{{ t('pep.formNovo.perguntas.regraAjuda') }}</p>
              <label
                >{{ t('pep.formNovo.perguntas.habilitar') }}
                <textarea
                  :value="regraTexto.habilitar"
                  rows="2"
                  @input="trocarRegra('habilitar', ($event.target as HTMLTextAreaElement).value)"
                />
              </label>
              <p v-if="regraInvalida.habilitar" role="alert">{{ t('pep.formNovo.tela.regraInvalida') }}</p>
              <label
                >{{ t('pep.formNovo.perguntas.calcular') }}
                <textarea
                  :value="regraTexto.calcular"
                  rows="2"
                  @input="trocarRegra('calcular', ($event.target as HTMLTextAreaElement).value)"
                />
              </label>
              <p v-if="regraInvalida.calcular" role="alert">{{ t('pep.formNovo.tela.regraInvalida') }}</p>
            </details>
            <fieldset v-if="selecionada.tipo !== 'secao'">
              <legend>{{ t('pep.formNovo.perguntas.reusoBusca') }}</legend>
              <p v-if="selecionada.reuso" data-testid="fn-reuso">
                {{ t('pep.formNovo.tela.reusoUsando', { id: selecionada.reuso }) }}
                <SanteBotao
                  variante="texto"
                  :rotulo="t('pep.formNovo.tela.reusoDesfazer')"
                  @acionar="selecionada.reuso = null"
                />
              </p>
              <SanteCampoTexto
                v-model="termoBanco"
                :rotulo="t('pep.formNovo.perguntas.reusoBusca')"
                :max-bytes="60"
              />
              <SanteBotao
                variante="secundario"
                :rotulo="t('pep.formNovo.tela.reusoBuscar')"
                data-testid="fn-banco-buscar"
                @acionar="procurarBanco"
              />
              <ul data-testid="fn-banco">
                <li v-for="b in achadas" :key="b.id">
                  {{ b.titulo }}
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('pep.formNovo.perguntas.reusoUsar', { uso: b.usoEmModelos })"
                    :desabilitado="!b.tipo"
                    @acionar="reaproveitar(b)"
                  />
                </li>
              </ul>
            </fieldset>
          </fieldset>

          <section class="painel" aria-labelledby="fn-previa" data-testid="fn-previa">
            <h3 id="fn-previa">{{ t('pep.formNovo.previa.titulo') }}</h3>
            <div v-if="problemas.length" role="alert" data-testid="fn-problemas">
              <p>{{ t('pep.formNovo.problemas.titulo') }}</p>
              <ul>
                <li v-for="(p, i) in problemas" :key="i">{{ t(`pep.formNovo.problemas.${p.codigo}`) }}</li>
              </ul>
            </div>
            <template v-else-if="avaliado">
              <template v-for="l in linhas" :key="l.p.linkId">
                <h4 v-if="l.p.tipo === 'secao' && avaliado.habilitadas.has(l.p.linkId)">{{ l.p.titulo }}</h4>
                <div v-else-if="avaliado.habilitadas.has(l.p.linkId)" class="previa-campo">
                  <p v-if="l.p.calcular !== null" :data-testid="`fn-calc-${l.p.linkId}`">
                    {{ l.p.titulo }}
                    {{
                      t('pep.formNovo.tela.previaCalculado', {
                        valor: valorTexto(avaliado.valores[l.p.linkId]),
                      })
                    }}
                  </p>
                  <SanteSelecao
                    v-else-if="l.p.tipo === 'escolha' || l.p.tipo === 'escolha-com-texto'"
                    :model-value="(respostasPrevia[l.p.linkId] as string | null) ?? null"
                    :data-testid="`fn-previa-${l.p.linkId}`"
                    :rotulo="l.p.titulo"
                    :opcoes="opcoesDaPrevia(l.p)"
                    @update:model-value="responder(l.p.linkId, $event)"
                  />
                  <fieldset v-else-if="l.p.tipo === 'multipla'">
                    <legend>{{ l.p.titulo }}</legend>
                    <label v-for="o in l.p.opcoes" :key="o.codigo">
                      <input
                        type="checkbox"
                        :data-testid="`fn-previa-${l.p.linkId}-${o.codigo}`"
                        :checked="
                          Array.isArray(respostasPrevia[l.p.linkId]) &&
                          (respostasPrevia[l.p.linkId] as string[]).includes(o.codigo)
                        "
                        @change="
                          marcarMultipla(l.p.linkId, o.codigo, ($event.target as HTMLInputElement).checked)
                        "
                      />
                      {{ o.texto }}
                    </label>
                  </fieldset>
                  <label v-else
                    >{{ l.p.titulo }}
                    <input
                      :type="
                        l.p.tipo === 'data'
                          ? 'date'
                          : l.p.tipo === 'hora'
                            ? 'time'
                            : l.p.tipo === 'decimal' || l.p.tipo === 'inteiro'
                              ? 'number'
                              : 'text'
                      "
                      :value="valorTexto(respostasPrevia[l.p.linkId])"
                      @input="
                        responder(
                          l.p.linkId,
                          l.p.tipo === 'decimal' || l.p.tipo === 'inteiro'
                            ? numeroOuNulo(($event.target as HTMLInputElement).value)
                            : ($event.target as HTMLInputElement).value,
                        )
                      "
                  /></label>
                </div>
              </template>
              <p v-if="avaliado.pendentes.length">
                {{ t('pep.formNovo.tela.previaPendentes', { n: avaliado.pendentes.length }) }}
              </p>
              <h4>{{ t('pep.formNovo.previa.resumo') }}</h4>
              <p class="ajuda">{{ t('pep.formNovo.previa.resumoAjuda') }}</p>
              <pre class="resumo" data-testid="fn-resumo">{{ resumo }}</pre>
              <SanteBotao
                v-if="editavel"
                variante="secundario"
                :rotulo="t('pep.formNovo.tela.casoDaPrevia')"
                data-testid="fn-caso-previa"
                @acionar="casoDaPrevia"
              />
            </template>
          </section>
        </div>

        <fieldset class="painel" :disabled="!editavel" data-testid="fn-casos">
          <legend>{{ t('pep.formNovo.casos.legenda') }}</legend>
          <p class="ajuda">{{ t('pep.formNovo.casos.ajuda') }}</p>
          <p v-if="casos.length === 0">{{ t('pep.formNovo.casos.nenhum') }}</p>
          <div v-for="(c, i) in casos" :key="i" class="caso" :data-testid="`fn-caso-${i}`">
            <SanteCampoTexto v-model="c.nome" :rotulo="t('pep.formNovo.casos.nome')" :max-bytes="80" />
            <label v-for="p in calculadas" :key="p.linkId"
              >{{ t('pep.formNovo.tela.esperadoDe', { pergunta: p.titulo }) }}
              <input
                type="number"
                :value="valorTexto(c.esperado[p.linkId])"
                :data-testid="`fn-esperado-${i}-${p.linkId}`"
                @input="c.esperado[p.linkId] = numeroOuNulo(($event.target as HTMLInputElement).value)"
            /></label>
            <p :data-testid="`fn-resultado-${i}`">
              {{ resultados[i]?.passou ? t('pep.formNovo.casos.passou') : t('pep.formNovo.casos.falhou') }}
            </p>
            <ul v-if="resultados[i] && !resultados[i]!.passou">
              <li v-for="(d, k) in resultados[i]!.diferencas" :key="k">
                {{
                  d.motivo === 'valor'
                    ? t('pep.formNovo.casos.diferenca', {
                        pergunta: d.linkId,
                        esperado: valorTexto(d.esperado),
                        obtido: valorTexto(d.obtido),
                      })
                    : d.motivo === 'habilitacao'
                      ? t('pep.formNovo.casos.habilitacao', { pergunta: d.linkId })
                      : d.motivo === 'resposta-invalida'
                        ? t('pep.formNovo.casos.invalida', { pergunta: d.linkId })
                        : t('pep.formNovo.casos.erro')
                }}
              </li>
            </ul>
            <SanteBotao
              variante="texto"
              :rotulo="t('pep.formNovo.tela.casoRemover', { nome: c.nome })"
              @acionar="casos.splice(i, 1)"
            />
          </div>
        </fieldset>

        <section v-if="aberto" class="painel" aria-labelledby="fn-historia">
          <h3 id="fn-historia">{{ t('pep.formNovo.tela.historico') }}</h3>
          <ul data-testid="fn-historia-lista">
            <li v-for="(e, i) in aberto.eventos" :key="i">
              {{
                t('pep.formNovo.tela.evento', {
                  em: e.em.replace('T', ' ').slice(0, 16),
                  tipo: t(`pep.formNovo.tela.eventos.${e.tipo}`),
                  por: e.por,
                })
              }}
              <span v-if="e.texto">{{ e.texto }}</span>
            </li>
          </ul>
        </section>

        <p class="acoes">
          <SanteBotao
            v-if="editavel"
            :rotulo="t('pep.formNovo.acoes.salvar')"
            :desabilitado="ocupado"
            data-testid="fn-salvar"
            @acionar="salvar"
          />
          <SanteBotao
            v-if="aberto?.estado === 'rascunho' && podeEditar"
            variante="secundario"
            :rotulo="t('pep.formNovo.acoes.enviar')"
            :desabilitado="ocupado || problemas.length > 0 || casos.length === 0"
            data-testid="fn-enviar"
            @acionar="enviarRevisao"
          />
          <SanteBotao
            v-if="(aberto?.estado === 'publicado' || aberto?.estado === 'aposentado') && podeEditar"
            variante="secundario"
            :rotulo="t('pep.formNovo.lista.novaVersao', { codigo: aberto.codigo, versao: aberto.versao })"
            data-testid="fn-nova-versao"
            @acionar="novaVersao"
          />
          <SanteBotao
            v-if="aberto?.estado === 'publicado' && podeAposentar"
            variante="secundario"
            :rotulo="t('pep.formNovo.acoes.aposentar')"
            data-testid="fn-aposentar"
            @acionar="dialogo = 'aposentar'"
          />
          <SanteBotao variante="texto" :rotulo="t('pep.formNovo.tela.fechar')" @acionar="fechar" />
        </p>
        <template v-if="aberto?.estado === 'revisao' && (podeAprovar || podePublicar)">
          <template v-if="!aberto.aprovacao">
            <SanteCampoTexto
              v-model="parecer"
              data-testid="fn-parecer"
              :rotulo="t('pep.formNovo.acoes.parecer')"
              :max-bytes="500"
              multilinha
            />
            <p class="ajuda">{{ t('pep.formNovo.acoes.parecerAjuda') }}</p>
            <p class="acoes">
              <SanteBotao
                v-if="podeAprovar"
                :rotulo="t('pep.formNovo.acoes.aprovar')"
                :desabilitado="ocupado || parecer.trim().length < 10"
                data-testid="fn-aprovar"
                @acionar="decidir('aprovar')"
              />
              <SanteBotao
                v-if="podeAprovar"
                variante="secundario"
                :rotulo="t('pep.formNovo.acoes.devolver')"
                :desabilitado="ocupado || parecer.trim().length < 10"
                data-testid="fn-devolver"
                @acionar="decidir('devolver')"
              />
            </p>
          </template>
          <p v-else class="acoes">
            <SanteBotao
              v-if="podePublicar"
              :rotulo="t('pep.formNovo.acoes.publicar')"
              :desabilitado="ocupado"
              data-testid="fn-publicar"
              @acionar="dialogo = 'publicar'"
            />
          </p>
        </template>
        <SanteAlerta
          v-if="textoErro(erro)"
          variante="alerta"
          data-testid="fn-erro"
          :texto="textoErro(erro)!"
        />
        <MensagemErro v-else-if="erro" :erro="erro" />
        <p v-if="mensagem" role="status" data-testid="fn-mensagem">{{ mensagem }}</p>
      </section>
    </template>

    <SanteDialogo
      v-model:visivel="visivel"
      :titulo="dialogo === 'publicar' ? t('pep.formNovo.acoes.publicar') : t('pep.formNovo.acoes.aposentar')"
    >
      <form data-testid="fn-dialogo" @submit.prevent="confirmarDialogo">
        <p v-if="dialogo === 'publicar' && aberto">
          {{ t('pep.formNovo.acoes.publicarConfirmar', { versao: aberto.versao, codigo: aberto.codigo }) }}
        </p>
        <p v-if="dialogo === 'publicar' && aberto">
          {{ t('pep.formNovo.integridade.hash') }}: <code>{{ aberto.contentHashAtual }}</code>
        </p>
        <SanteCampoTexto
          v-if="dialogo === 'aposentar'"
          v-model="motivo"
          data-testid="fn-motivo"
          :rotulo="t('pep.formNovo.acoes.aposentarMotivo')"
          :max-bytes="500"
          multilinha
        />
        <label
          >{{ t('pep.formNovo.acoes.senha') }}
          <input v-model="senha" type="password" autocomplete="current-password" data-testid="fn-senha"
        /></label>
        <p class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('pep.formNovo.tela.confirmar')"
            :desabilitado="!senha || (dialogo === 'aposentar' && motivo.trim().length < 10)"
            data-testid="fn-confirmar"
          />
          <SanteBotao variante="texto" :rotulo="t('pep.formNovo.tela.cancelar')" @acionar="dialogo = null" />
        </p>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.barra,
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2, 0.5rem);
  align-items: flex-end;
}
.paineis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: var(--sgh-espaco-3, 1rem);
}
.painel {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2, 0.5rem);
  border-radius: 4px;
}
.arvore {
  list-style: none;
  padding: 0;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  list-style: none;
  padding: 0;
}
.ajuda {
  font-size: 0.875rem;
}
.resumo {
  white-space: pre-wrap;
}
.linha-opcao,
.caso {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: flex-end;
}
</style>
