<script setup lang="ts">
// Ficha editável do fornecedor (05-SUP linha 23): dados fiscais e endereço, contatos por finalidade, categorias com a
// principal, autorizações sanitárias com a situação no dia, contas de pagamento (as mesmas do financeiro: inclui e
// inativa, nunca altera), avaliação periódica pela regra do contrato (prévia da conta antes de gravar) e ocorrências
// com o andamento. Tudo numa tela só, sem abas: a validação é na hora, pelas mesmas regras que a gravação confere
// (conferirFornecedor, conferirContaBancaria, conferirAvaliacaoPeriodica, conferirOcorrencia, conferirAndamentoOcorrencia).
import { CRITERIOS_AVALIACAO_FORNECEDOR } from '@sgh/contratos';
import {
  type AutorizacaoFornecedorEntrada,
  type ContatoFornecedorEntrada,
  DISPONIBILIDADES_FORNECEDOR,
  FINALIDADES_CONTATO_FORNECEDOR,
  type FornecedorEntrada,
  GRAVIDADES_OCORRENCIA,
  type GravidadeOcorrencia,
  SITUACOES_AUTORIZACAO_FORNECEDOR,
  SITUACOES_FORNECEDOR,
  type SituacaoOcorrenciaFornecedor,
  TIPOS_AUTORIZACAO_FORNECEDOR,
  TIPOS_CHAVE_PIX,
  TIPOS_CONTA_CREDOR,
  TIPOS_OCORRENCIA_FORNECEDOR,
  TRANSICOES_OCORRENCIA,
  type TipoChavePix,
  type TipoOcorrenciaFornecedor,
  avaliarFornecedor,
  conferirAndamentoOcorrencia,
  conferirAvaliacaoPeriodica,
  conferirContaBancaria,
  conferirFornecedor,
  conferirOcorrencia,
  ocorrenciaEmAberto,
} from '@sgh/dominio-suprimentos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import {
  type FornecedorFichaTela,
  type OcorrenciaFornecedorTela,
  type PainelCadastroFornecedorTela,
  alterarFornecedor,
  andamentoOcorrenciaFornecedor,
  avaliarFornecedorPeriodo,
  inativarContaFornecedor,
  incluirContaFornecedor,
  incluirFornecedor,
  lerFichaFornecedor,
  registrarOcorrenciaFornecedor,
} from '../api-cadastro-fornecedor.js';
import { mensagensCadastroFornecedor as M } from '../i18n-cadastro-fornecedor.js';
import ErroSuprimentos from './ErroSuprimentos.vue';

const props = defineProps<{ fornecedorId: number | null; painel: PainelCadastroFornecedorTela }>();
const emit = defineEmits<{ fechar: []; gravado: [id: number] }>();

type Mutavel<T> = { -readonly [K in keyof T]: T[K] };
type Contato = Mutavel<ContatoFornecedorEntrada>;
type Autorizacao = Mutavel<AutorizacaoFornecedorEntrada>;
type Form = Omit<Mutavel<FornecedorEntrada>, 'categorias' | 'contatos' | 'autorizacoes'> & {
  categorias: number[];
  contatos: Contato[];
  autorizacoes: Autorizacao[];
};

const fmt = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));
const hoje = computed(() => props.painel.hoje);
const pode = computed(() => props.painel.pode);
const id = ref<number | null>(props.fornecedorId);
const mensagem = ref('');
const erro = ref<unknown>(null);
const enviando = ref(false);
const qc = useQueryClient();

const ficha = useQuery({
  queryKey: ['suprimentos', 'cadastro-fornecedor', 'ficha', id],
  queryFn: () => lerFichaFornecedor(id.value!),
  enabled: computed(() => id.value !== null),
});

function vazio(): Form {
  return {
    tipoPessoa: 'juridica',
    documento: '',
    razaoSocial: '',
    nomeFantasia: null,
    inscricaoEstadual: null,
    inscricaoMunicipal: null,
    optanteSimples: false,
    contribuinteIcms: false,
    cep: null,
    logradouro: null,
    numeroEndereco: null,
    complemento: null,
    bairro: null,
    email: null,
    site: null,
    numeroCnes: null,
    prazoEntregaDias: null,
    diasValidadeAvaliacao: null,
    forneceOpme: false,
    transportadora: false,
    prestadorServico: false,
    disponibilidade: 'comercial',
    situacao: 'ativo',
    motivoSituacao: null,
    observacao: null,
    categorias: [],
    categoriaPrincipal: null,
    contatos: [],
    autorizacoes: [],
  };
}

const form = reactive<Form>(vazio());
function preencher(f: FornecedorFichaTela): void {
  Object.assign(form, vazio(), f.dados, {
    categorias: [...f.categorias],
    categoriaPrincipal: f.categoriaPrincipal,
    contatos: f.contatos.map((c) => ({ ...c })),
    autorizacoes: f.autorizacoes.map((a) => ({
      id: a.id,
      tipo: a.tipo,
      numero: a.numero,
      orgaoEmissor: a.orgaoEmissor,
      emitidoEm: a.emitidoEm,
      validoAte: a.validoAte,
      diasAviso: a.diasAviso,
      bloqueiaCompraVencido: a.bloqueiaCompraVencido,
      situacao: a.situacao,
    })),
  });
}
watch(
  () => ficha.data.value,
  (f) => {
    if (f) preencher(f);
  },
  { immediate: true },
);

/** Texto vazio vira nulo (o contrato da rota aceita nulo, não texto em branco). */
const n = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);
function entrada(): FornecedorEntrada {
  return {
    ...form,
    documento: form.documento.trim(),
    razaoSocial: form.razaoSocial.trim(),
    nomeFantasia: n(form.nomeFantasia),
    inscricaoEstadual: n(form.inscricaoEstadual),
    inscricaoMunicipal: n(form.inscricaoMunicipal),
    cep: n(form.cep),
    logradouro: n(form.logradouro),
    numeroEndereco: n(form.numeroEndereco),
    complemento: n(form.complemento),
    bairro: n(form.bairro),
    email: n(form.email),
    site: n(form.site),
    numeroCnes: n(form.numeroCnes),
    motivoSituacao: n(form.motivoSituacao),
    observacao: n(form.observacao),
    contatos: form.contatos.map((c) => ({
      ...c,
      id: c.id ?? null,
      nome: n(c.nome),
      cargo: n(c.cargo),
      telefone: n(c.telefone),
      ramal: n(c.ramal),
      email: n(c.email),
    })),
    autorizacoes: form.autorizacoes.map((a) => ({
      ...a,
      id: a.id ?? null,
      orgaoEmissor: n(a.orgaoEmissor),
      emitidoEm: n(a.emitidoEm),
      validoAte: n(a.validoAte),
    })),
  };
}
const recusasFornecedor = computed(() => conferirFornecedor(entrada()));

const op = <T extends string>(lista: readonly T[], rotulos: Record<string, string>) =>
  lista.map((v) => ({ valor: v, rotulo: rotulos[v] ?? v }));
const opcoesPessoa = op(['juridica', 'fisica'] as const, M.pessoa);
const opcoesSituacao = op(SITUACOES_FORNECEDOR, M.situacoes);
const opcoesDisponibilidade = op(DISPONIBILIDADES_FORNECEDOR, M.disponibilidades);
const opcoesFinalidade = op(FINALIDADES_CONTATO_FORNECEDOR, M.contatos.finalidades);
const opcoesTipoAutorizacao = op(TIPOS_AUTORIZACAO_FORNECEDOR, M.autorizacoes.tipos);
const opcoesSituacaoAutorizacao = op(SITUACOES_AUTORIZACAO_FORNECEDOR, M.autorizacoes.situacoes);
const opcoesTipoConta = op(TIPOS_CONTA_CREDOR, M.contas.tipos);
const opcoesPix = [{ valor: null, rotulo: M.nenhuma }, ...op(TIPOS_CHAVE_PIX, M.contas.pix)];
const opcoesTipoOcorrencia = op(TIPOS_OCORRENCIA_FORNECEDOR, M.ocorrencias.tipos);
const opcoesGravidade = op(GRAVIDADES_OCORRENCIA, M.ocorrencias.gravidades);
const opcoesBanco = computed(() => [
  { valor: null as number | null, rotulo: M.escolha },
  ...props.painel.bancos.map((b) => ({ valor: b.id as number | null, rotulo: b.descricao })),
]);
const opcoesPrincipal = computed(() => [
  { valor: null as number | null, rotulo: M.nenhuma },
  ...props.painel.categorias
    .filter((c) => form.categorias.includes(c.id))
    .map((c) => ({ valor: c.id as number | null, rotulo: c.descricao })),
]);
const nota = (n: number) => ({ valor: n, rotulo: String(n) });
const opcoesNota = [1, 2, 3, 4, 5].map(nota);

function alternarCategoria(c: number, marcado: boolean): void {
  form.categorias = marcado ? [...form.categorias, c] : form.categorias.filter((x) => x !== c);
  if (!form.categorias.includes(form.categoriaPrincipal ?? -1)) form.categoriaPrincipal = null;
}
function incluirContato(): void {
  form.contatos.push({
    id: null,
    finalidade: 'comercial',
    nome: null,
    cargo: null,
    telefone: null,
    ramal: null,
    email: null,
    principal: form.contatos.length === 0,
  });
}
function incluirAutorizacao(): void {
  form.autorizacoes.push({
    id: null,
    tipo: 'afe',
    numero: '',
    orgaoEmissor: null,
    emitidoEm: null,
    validoAte: null,
    diasAviso: 30,
    bloqueiaCompraVencido: true,
    situacao: 'valido',
  });
}

async function gravar<T extends { mensagem: string }>(acao: () => Promise<T>): Promise<T | null> {
  enviando.value = true;
  erro.value = null;
  mensagem.value = '';
  try {
    const r = await acao();
    mensagem.value = r.mensagem;
    await qc.invalidateQueries({ queryKey: ['suprimentos', 'cadastro-fornecedor'] });
    return r;
  } catch (e) {
    erro.value = e;
    return null;
  } finally {
    enviando.value = false;
  }
}

async function gravarFornecedor(): Promise<void> {
  if (recusasFornecedor.value.length) return;
  const atual = id.value;
  const r = await gravar(() =>
    atual === null
      ? incluirFornecedor(entrada())
      : alterarFornecedor(atual, ficha.data.value!.versao, entrada()),
  );
  if (r && atual === null && r.id) id.value = r.id;
  if (r && id.value !== null) emit('gravado', id.value);
}

// ── Contas ──
const conta = reactive({
  banco: null as number | null,
  tipoConta: 'corrente' as (typeof TIPOS_CONTA_CREDOR)[number],
  agencia: '',
  digitoAgencia: '',
  conta: '',
  digitoConta: '',
  tipoChavePix: null as TipoChavePix | null,
  chavePix: '',
  titularNome: '',
  titularDocumento: '',
  preferencial: false,
});
const entradaConta = () => ({
  ...conta,
  agencia: n(conta.agencia),
  digitoAgencia: n(conta.digitoAgencia),
  conta: n(conta.conta),
  digitoConta: n(conta.digitoConta),
  chavePix: n(conta.chavePix),
  titularNome: conta.titularNome.trim(),
  titularDocumento: conta.titularDocumento.trim(),
});
const recusasConta = computed(() => conferirContaBancaria(entradaConta()));
async function gravarConta(): Promise<void> {
  if (id.value === null || recusasConta.value.length) return;
  const alvo = id.value;
  const r = await gravar(() => incluirContaFornecedor(alvo, entradaConta()));
  if (r) Object.assign(conta, { agencia: '', digitoAgencia: '', conta: '', digitoConta: '', chavePix: '' });
}
async function inativarConta(c: { id: number; versao: number }): Promise<void> {
  if (id.value === null) return;
  const alvo = id.value;
  await gravar(() => inativarContaFornecedor(alvo, c.id, c.versao));
}

// ── Avaliação ──
const avaliacao = reactive({
  avaliadoEm: props.painel.hoje,
  periodoInicio: '',
  periodoFim: '',
  notas: { qualidade: 3, prazo: 3, atendimento: 3, documentacao: 3 },
  parecer: '',
});
const entradaAvaliacao = () => ({
  avaliadoEm: avaliacao.avaliadoEm,
  periodoInicio: n(avaliacao.periodoInicio),
  periodoFim: n(avaliacao.periodoFim),
  notas: { ...avaliacao.notas },
  parecer: n(avaliacao.parecer),
});
const recusasAvaliacao = computed(() => conferirAvaliacaoPeriodica(entradaAvaliacao(), hoje.value));
const previaAvaliacao = computed(() => avaliarFornecedor(avaliacao.notas));
async function gravarAvaliacao(): Promise<void> {
  if (id.value === null || recusasAvaliacao.value.length) return;
  const alvo = id.value;
  const r = await gravar(() => avaliarFornecedorPeriodo(alvo, entradaAvaliacao()));
  if (r) avaliacao.parecer = '';
}

// ── Ocorrências ──
const ocorrencia = reactive({
  tipo: 'atraso_entrega' as TipoOcorrenciaFornecedor,
  gravidade: 'media' as GravidadeOcorrencia,
  ocorridoEm: `${props.painel.hoje}T08:00`,
  quantidadeAfetada: null as number | null,
  valorAfetado: null as number | null,
  descricao: '',
});
const entradaOcorrencia = () => ({ ...ocorrencia, descricao: ocorrencia.descricao.trim() });
const recusasOcorrencia = computed(() => conferirOcorrencia(entradaOcorrencia(), hoje.value));
async function gravarOcorrencia(): Promise<void> {
  if (id.value === null || recusasOcorrencia.value.length) return;
  const alvo = id.value;
  const r = await gravar(() => registrarOcorrenciaFornecedor(alvo, entradaOcorrencia()));
  if (r) Object.assign(ocorrencia, { descricao: '', quantidadeAfetada: null, valorAfetado: null });
}
const andamentos = reactive<
  Record<number, { situacao: SituacaoOcorrenciaFornecedor | null; tratativa: string; email: string }>
>({});
function andamentoDe(o: OcorrenciaFornecedorTela) {
  andamentos[o.id] ??= { situacao: null, tratativa: '', email: '' };
  return andamentos[o.id]!;
}
const opcoesAndamento = (o: OcorrenciaFornecedorTela) => [
  { valor: null as SituacaoOcorrenciaFornecedor | null, rotulo: M.escolha },
  ...TRANSICOES_OCORRENCIA[o.situacao].map((s) => ({
    valor: s as SituacaoOcorrenciaFornecedor | null,
    rotulo: M.ocorrencias.situacoes[s],
  })),
];
function recusasAndamento(o: OcorrenciaFornecedorTela) {
  const a = andamentoDe(o);
  if (!a.situacao) return [];
  return conferirAndamentoOcorrencia({
    de: o.situacao,
    para: a.situacao,
    tratativa: n(a.tratativa),
    email: n(a.email),
  });
}
async function gravarAndamento(o: OcorrenciaFornecedorTela): Promise<void> {
  const a = andamentoDe(o);
  if (!a.situacao || recusasAndamento(o).length) return;
  const para = a.situacao;
  const r = await gravar(() =>
    andamentoOcorrenciaFornecedor(o.id, {
      situacao: para,
      tratativa: n(a.tratativa),
      email: n(a.email),
      versao: o.versao,
    }),
  );
  if (r) delete andamentos[o.id];
}

const rotulo = (mapa: object, v: string): string => (mapa as Record<string, string>)[v] ?? v;
const rotuloResultado = (r: string) => rotulo(M.avaliacoes.resultados, r);
const rotuloNaData = (s: string, dias: number | null) =>
  fmt((M.autorizacoes.naData as Record<string, string>)[s] ?? s, { dias: dias ?? 0 });
const somenteLeitura = computed(() => !pode.value.editar);
</script>

<template>
  <section class="cadastro-fornecedor" aria-labelledby="cforn-titulo" data-testid="cforn-painel">
    <header class="cabecalho">
      <h2 id="cforn-titulo">
        {{ M.titulo }}<template v-if="ficha.data.value"> · {{ ficha.data.value.razaoSocial }}</template>
      </h2>
      <SanteBotao
        variante="secundario"
        :rotulo="M.fechar"
        data-testid="cforn-fechar"
        @acionar="emit('fechar')"
      />
    </header>
    <p>{{ M.explica }}</p>
    <p v-if="somenteLeitura" role="status" data-testid="cforn-so-leitura">{{ M.semPermissao }}</p>
    <p v-if="mensagem" role="status" data-testid="cforn-mensagem">{{ mensagem }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <ErroSuprimentos v-if="ficha.error.value" :erro="ficha.error.value" />
    <p v-else-if="id !== null && !ficha.data.value" role="status">{{ M.carregando }}</p>

    <template v-if="id === null || ficha.data.value">
      <div v-if="ficha.data.value?.avisos.length" class="avisos" data-testid="cforn-avisos">
        <h3>{{ M.avisos }}</h3>
        <ul>
          <li v-for="a in ficha.data.value.avisos" :key="a.codigo" :data-gravidade="a.gravidade">
            {{ a.mensagem }}
          </li>
        </ul>
      </div>
      <p v-if="ficha.data.value?.proximaAvaliacao" data-testid="cforn-proxima">
        {{ fmt(M.proximaAvaliacao, { data: ficha.data.value.proximaAvaliacao }) }}
      </p>

      <form class="grade" data-testid="cforn-form" @submit.prevent="gravarFornecedor">
        <fieldset :disabled="somenteLeitura">
          <legend>{{ M.abas.dados }}</legend>
          <SanteSelecao
            v-model="form.tipoPessoa"
            :rotulo="M.campos.tipoPessoa"
            :opcoes="opcoesPessoa"
            data-testid="cforn-tipo-pessoa"
          />
          <span class="campo">
            <label for="cforn-documento">{{ M.campos.documento }}</label>
            <input
              id="cforn-documento"
              v-model="form.documento"
              inputmode="numeric"
              data-testid="cforn-documento"
            />
          </span>
          <span class="campo">
            <label for="cforn-razao">{{ M.campos.razaoSocial }}</label>
            <input id="cforn-razao" v-model="form.razaoSocial" data-testid="cforn-razao" />
          </span>
          <span class="campo">
            <label for="cforn-fantasia">{{ M.campos.nomeFantasia }}</label>
            <input id="cforn-fantasia" v-model="form.nomeFantasia" data-testid="cforn-fantasia" />
          </span>
          <span class="campo">
            <label for="cforn-ie">{{ M.campos.inscricaoEstadual }}</label>
            <input id="cforn-ie" v-model="form.inscricaoEstadual" />
          </span>
          <span class="campo">
            <label for="cforn-im">{{ M.campos.inscricaoMunicipal }}</label>
            <input id="cforn-im" v-model="form.inscricaoMunicipal" />
          </span>
          <label class="marcar"
            ><input v-model="form.optanteSimples" type="checkbox" /> {{ M.campos.optanteSimples }}</label
          >
          <label class="marcar"
            ><input v-model="form.contribuinteIcms" type="checkbox" /> {{ M.campos.contribuinteIcms }}</label
          >
          <span class="campo">
            <label for="cforn-cep">{{ M.campos.cep }}</label>
            <input id="cforn-cep" v-model="form.cep" inputmode="numeric" />
          </span>
          <span class="campo">
            <label for="cforn-logradouro">{{ M.campos.logradouro }}</label>
            <input id="cforn-logradouro" v-model="form.logradouro" />
          </span>
          <span class="campo">
            <label for="cforn-numero">{{ M.campos.numeroEndereco }}</label>
            <input id="cforn-numero" v-model="form.numeroEndereco" />
          </span>
          <span class="campo">
            <label for="cforn-complemento">{{ M.campos.complemento }}</label>
            <input id="cforn-complemento" v-model="form.complemento" />
          </span>
          <span class="campo">
            <label for="cforn-bairro">{{ M.campos.bairro }}</label>
            <input id="cforn-bairro" v-model="form.bairro" />
          </span>
          <span class="campo">
            <label for="cforn-email">{{ M.campos.email }}</label>
            <input id="cforn-email" v-model="form.email" type="email" data-testid="cforn-email" />
          </span>
          <span class="campo">
            <label for="cforn-site">{{ M.campos.site }}</label>
            <input id="cforn-site" v-model="form.site" />
          </span>
          <span class="campo">
            <label for="cforn-cnes">{{ M.campos.numeroCnes }}</label>
            <input id="cforn-cnes" v-model="form.numeroCnes" inputmode="numeric" />
          </span>
          <span class="campo">
            <label for="cforn-prazo">{{ M.campos.prazoEntregaDias }}</label>
            <input id="cforn-prazo" v-model.number="form.prazoEntregaDias" type="number" min="0" />
          </span>
          <span class="campo">
            <label for="cforn-validade">{{ M.campos.diasValidadeAvaliacao }}</label>
            <input id="cforn-validade" v-model.number="form.diasValidadeAvaliacao" type="number" min="1" />
          </span>
          <label class="marcar"
            ><input v-model="form.forneceOpme" type="checkbox" /> {{ M.campos.forneceOpme }}</label
          >
          <label class="marcar"
            ><input v-model="form.transportadora" type="checkbox" /> {{ M.campos.transportadora }}</label
          >
          <label class="marcar"
            ><input v-model="form.prestadorServico" type="checkbox" /> {{ M.campos.prestadorServico }}</label
          >
          <SanteSelecao
            v-model="form.disponibilidade"
            :rotulo="M.campos.disponibilidade"
            :opcoes="opcoesDisponibilidade"
            data-testid="cforn-disponibilidade"
          />
          <SanteSelecao
            v-model="form.situacao"
            :rotulo="M.campos.situacao"
            :opcoes="opcoesSituacao"
            data-testid="cforn-situacao"
          />
          <span v-if="form.situacao !== 'ativo'" class="campo">
            <label for="cforn-motivo">{{ M.campos.motivoSituacao }}</label>
            <input id="cforn-motivo" v-model="form.motivoSituacao" data-testid="cforn-motivo" />
          </span>
          <span class="campo largo">
            <label for="cforn-obs">{{ M.campos.observacao }}</label>
            <textarea id="cforn-obs" v-model="form.observacao" rows="2" />
          </span>
        </fieldset>

        <fieldset :disabled="somenteLeitura" data-testid="cforn-categorias">
          <legend>{{ M.campos.categorias }}</legend>
          <label v-for="c in painel.categorias" :key="c.id" class="marcar">
            <input
              type="checkbox"
              :checked="form.categorias.includes(c.id)"
              :data-testid="`cforn-categoria-${c.id}`"
              @change="alternarCategoria(c.id, ($event.target as HTMLInputElement).checked)"
            />
            {{ c.descricao
            }}<span v-if="c.exigeAutorizacao" class="secundario"> · {{ M.campos.exigeAutorizacao }}</span>
          </label>
          <SanteSelecao
            v-model="form.categoriaPrincipal"
            :rotulo="M.campos.categoriaPrincipal"
            :opcoes="opcoesPrincipal"
            data-testid="cforn-categoria-principal"
          />
        </fieldset>

        <fieldset :disabled="somenteLeitura" data-testid="cforn-contatos">
          <legend>{{ M.contatos.titulo }}</legend>
          <div v-for="(c, i) in form.contatos" :key="`c-${c.id ?? 'novo'}-${i}`" class="linha">
            <SanteSelecao
              v-model="c.finalidade"
              :rotulo="M.contatos.finalidade"
              :opcoes="opcoesFinalidade"
              :data-testid="`cforn-contato-finalidade-${i}`"
            />
            <span class="campo">
              <label :for="`cforn-contato-nome-${i}`">{{ M.contatos.nome }}</label>
              <input
                :id="`cforn-contato-nome-${i}`"
                v-model="c.nome"
                :data-testid="`cforn-contato-nome-${i}`"
              />
            </span>
            <span class="campo">
              <label :for="`cforn-contato-cargo-${i}`">{{ M.contatos.cargo }}</label>
              <input :id="`cforn-contato-cargo-${i}`" v-model="c.cargo" />
            </span>
            <span class="campo">
              <label :for="`cforn-contato-tel-${i}`">{{ M.contatos.telefone }}</label>
              <input
                :id="`cforn-contato-tel-${i}`"
                v-model="c.telefone"
                inputmode="tel"
                :data-testid="`cforn-contato-tel-${i}`"
              />
            </span>
            <span class="campo">
              <label :for="`cforn-contato-ramal-${i}`">{{ M.contatos.ramal }}</label>
              <input :id="`cforn-contato-ramal-${i}`" v-model="c.ramal" />
            </span>
            <span class="campo">
              <label :for="`cforn-contato-email-${i}`">{{ M.contatos.email }}</label>
              <input
                :id="`cforn-contato-email-${i}`"
                v-model="c.email"
                type="email"
                :data-testid="`cforn-contato-email-${i}`"
              />
            </span>
            <label class="marcar"
              ><input v-model="c.principal" type="checkbox" /> {{ M.contatos.principal }}</label
            >
            <SanteBotao
              variante="secundario"
              :rotulo="M.contatos.remover"
              :data-testid="`cforn-contato-tirar-${i}`"
              @acionar="form.contatos.splice(i, 1)"
            />
          </div>
          <SanteBotao
            variante="secundario"
            :rotulo="M.contatos.incluir"
            data-testid="cforn-contato-incluir"
            @acionar="incluirContato"
          />
        </fieldset>

        <fieldset :disabled="somenteLeitura" data-testid="cforn-autorizacoes">
          <legend>{{ M.autorizacoes.titulo }}</legend>
          <div v-for="(a, i) in form.autorizacoes" :key="`a-${a.id ?? 'nova'}-${i}`" class="linha">
            <SanteSelecao
              v-model="a.tipo"
              :rotulo="M.autorizacoes.tipo"
              :opcoes="opcoesTipoAutorizacao"
              :data-testid="`cforn-aut-tipo-${i}`"
            />
            <span class="campo">
              <label :for="`cforn-aut-numero-${i}`">{{ M.autorizacoes.numero }}</label>
              <input
                :id="`cforn-aut-numero-${i}`"
                v-model="a.numero"
                :data-testid="`cforn-aut-numero-${i}`"
              />
            </span>
            <span class="campo">
              <label :for="`cforn-aut-orgao-${i}`">{{ M.autorizacoes.orgaoEmissor }}</label>
              <input :id="`cforn-aut-orgao-${i}`" v-model="a.orgaoEmissor" />
            </span>
            <span class="campo">
              <label :for="`cforn-aut-emissao-${i}`">{{ M.autorizacoes.emitidoEm }}</label>
              <input :id="`cforn-aut-emissao-${i}`" v-model="a.emitidoEm" type="date" />
            </span>
            <span class="campo">
              <label :for="`cforn-aut-validade-${i}`">{{ M.autorizacoes.validoAte }}</label>
              <input
                :id="`cforn-aut-validade-${i}`"
                v-model="a.validoAte"
                type="date"
                :data-testid="`cforn-aut-validade-${i}`"
              />
            </span>
            <span class="campo">
              <label :for="`cforn-aut-aviso-${i}`">{{ M.autorizacoes.diasAviso }}</label>
              <input
                :id="`cforn-aut-aviso-${i}`"
                v-model.number="a.diasAviso"
                type="number"
                min="0"
                max="365"
              />
            </span>
            <label class="marcar"
              ><input v-model="a.bloqueiaCompraVencido" type="checkbox" />
              {{ M.autorizacoes.bloqueiaCompraVencido }}</label
            >
            <SanteSelecao
              v-model="a.situacao"
              :rotulo="M.autorizacoes.situacao"
              :opcoes="opcoesSituacaoAutorizacao"
              :data-testid="`cforn-aut-situacao-${i}`"
            />
            <span v-if="a.id && ficha.data.value" class="secundario" :data-testid="`cforn-aut-nadata-${i}`">
              <template v-for="x in ficha.data.value.autorizacoes.filter((y) => y.id === a.id)" :key="x.id">
                {{ rotuloNaData(x.situacaoNaData, x.dias) }}
              </template>
            </span>
            <SanteBotao
              variante="secundario"
              :rotulo="M.autorizacoes.remover"
              :data-testid="`cforn-aut-tirar-${i}`"
              @acionar="form.autorizacoes.splice(i, 1)"
            />
          </div>
          <SanteBotao
            variante="secundario"
            :rotulo="M.autorizacoes.incluir"
            data-testid="cforn-aut-incluir"
            @acionar="incluirAutorizacao"
          />
        </fieldset>

        <div v-if="recusasFornecedor.length" role="alert" data-testid="cforn-recusas">
          <strong>{{ M.recusas }}</strong>
          <ul>
            <li v-for="r in recusasFornecedor" :key="r.codigo + r.mensagem">{{ r.mensagem }}</li>
          </ul>
        </div>
        <SanteBotao
          v-if="pode.editar"
          tipo="submit"
          :rotulo="M.gravar"
          :desabilitado="enviando || recusasFornecedor.length > 0"
          data-testid="cforn-gravar"
        />
      </form>

      <template v-if="ficha.data.value">
        <section aria-labelledby="cforn-contas-titulo" data-testid="cforn-contas">
          <h3 id="cforn-contas-titulo">{{ M.contas.titulo }}</h3>
          <p>{{ M.contas.explica }}</p>
          <p v-if="ficha.data.value.contas.length === 0">{{ M.contas.nenhuma }}</p>
          <table v-else class="tabela">
            <caption class="oculto">
              {{
                M.contas.titulo
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ M.contas.banco }}</th>
                <th scope="col">{{ M.contas.tipoConta }}</th>
                <th scope="col">{{ M.contas.agencia }}</th>
                <th scope="col">{{ M.contas.conta }}</th>
                <th scope="col">{{ M.contas.titularNome }}</th>
                <th scope="col">{{ M.campos.situacao }}</th>
                <th scope="col">
                  <span class="oculto">{{ M.contas.inativar }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in ficha.data.value.contas" :key="c.id" :data-testid="`cforn-conta-${c.id}`">
                <td>{{ c.banco ?? '—' }}</td>
                <td>
                  {{ rotulo(M.contas.tipos, c.tipoConta)
                  }}<template v-if="c.preferencial"> · {{ M.contas.preferencial }}</template>
                </td>
                <td>{{ c.agencia ?? '—' }}</td>
                <td>{{ c.contaMascarada }}</td>
                <td>{{ c.titularNome }}</td>
                <td>{{ c.ativo ? M.contas.ativa : M.contas.inativa }}</td>
                <td>
                  <SanteBotao
                    v-if="c.ativo && pode.editar"
                    variante="secundario"
                    :rotulo="M.contas.inativar"
                    :desabilitado="enviando"
                    :data-testid="`cforn-conta-inativar-${c.id}`"
                    @acionar="inativarConta(c)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <form v-if="pode.editar" class="grade" data-testid="cforn-conta-form" @submit.prevent="gravarConta">
            <SanteSelecao
              v-model="conta.banco"
              :rotulo="M.contas.banco"
              :opcoes="opcoesBanco"
              data-testid="cforn-conta-banco"
            />
            <SanteSelecao
              v-model="conta.tipoConta"
              :rotulo="M.contas.tipoConta"
              :opcoes="opcoesTipoConta"
              data-testid="cforn-conta-tipo"
            />
            <span class="campo">
              <label for="cforn-conta-agencia">{{ M.contas.agencia }}</label>
              <input id="cforn-conta-agencia" v-model="conta.agencia" data-testid="cforn-conta-agencia" />
            </span>
            <span class="campo">
              <label for="cforn-conta-dag">{{ M.contas.digitoAgencia }}</label>
              <input id="cforn-conta-dag" v-model="conta.digitoAgencia" />
            </span>
            <span class="campo">
              <label for="cforn-conta-numero">{{ M.contas.conta }}</label>
              <input id="cforn-conta-numero" v-model="conta.conta" data-testid="cforn-conta-numero" />
            </span>
            <span class="campo">
              <label for="cforn-conta-dc">{{ M.contas.digitoConta }}</label>
              <input id="cforn-conta-dc" v-model="conta.digitoConta" />
            </span>
            <SanteSelecao
              v-model="conta.tipoChavePix"
              :rotulo="M.contas.tipoChavePix"
              :opcoes="opcoesPix"
              data-testid="cforn-conta-pix-tipo"
            />
            <span class="campo">
              <label for="cforn-conta-pix">{{ M.contas.chavePix }}</label>
              <input id="cforn-conta-pix" v-model="conta.chavePix" data-testid="cforn-conta-pix" />
            </span>
            <span class="campo">
              <label for="cforn-conta-titular">{{ M.contas.titularNome }}</label>
              <input id="cforn-conta-titular" v-model="conta.titularNome" data-testid="cforn-conta-titular" />
            </span>
            <span class="campo">
              <label for="cforn-conta-titular-doc">{{ M.contas.titularDocumento }}</label>
              <input
                id="cforn-conta-titular-doc"
                v-model="conta.titularDocumento"
                inputmode="numeric"
                data-testid="cforn-conta-titular-doc"
              />
            </span>
            <label class="marcar"
              ><input v-model="conta.preferencial" type="checkbox" /> {{ M.contas.preferencial }}</label
            >
            <ul v-if="recusasConta.length" role="alert" data-testid="cforn-conta-recusas">
              <li v-for="r in recusasConta" :key="r.codigo">{{ r.mensagem }}</li>
            </ul>
            <SanteBotao
              tipo="submit"
              :rotulo="M.contas.incluir"
              :desabilitado="enviando || recusasConta.length > 0"
              data-testid="cforn-conta-incluir"
            />
          </form>
        </section>

        <section aria-labelledby="cforn-aval-titulo" data-testid="cforn-avaliacoes">
          <h3 id="cforn-aval-titulo">{{ M.avaliacoes.titulo }}</h3>
          <p v-if="ficha.data.value.avaliacoes.length === 0">{{ M.avaliacoes.nenhuma }}</p>
          <ul v-else>
            <li v-for="a in ficha.data.value.avaliacoes" :key="a.id" :data-testid="`cforn-avaliacao-${a.id}`">
              {{ a.avaliadoEm }} · {{ a.conta }} · {{ rotuloResultado(a.resultado) }}
              <template v-if="a.mediaPeriodo !== null">
                · {{ fmt(M.avaliacoes.mediaPeriodo, { media: a.mediaPeriodo.toFixed(2) }) }}</template
              >
              <template v-if="a.parecer"> · {{ a.parecer }}</template>
            </li>
          </ul>
          <form
            v-if="pode.avaliar"
            class="grade"
            data-testid="cforn-avaliacao-form"
            @submit.prevent="gravarAvaliacao"
          >
            <span class="campo">
              <label for="cforn-aval-data">{{ M.avaliacoes.avaliadoEm }}</label>
              <input id="cforn-aval-data" v-model="avaliacao.avaliadoEm" type="date" :max="hoje" />
            </span>
            <span class="campo">
              <label for="cforn-aval-ini">{{ M.avaliacoes.periodoInicio }}</label>
              <input id="cforn-aval-ini" v-model="avaliacao.periodoInicio" type="date" />
            </span>
            <span class="campo">
              <label for="cforn-aval-fim">{{ M.avaliacoes.periodoFim }}</label>
              <input id="cforn-aval-fim" v-model="avaliacao.periodoFim" type="date" />
            </span>
            <SanteSelecao
              v-for="cr in CRITERIOS_AVALIACAO_FORNECEDOR"
              :key="cr.codigo"
              v-model="avaliacao.notas[cr.codigo]"
              :rotulo="cr.rotulo"
              :opcoes="opcoesNota"
              :data-testid="`cforn-nota-${cr.codigo}`"
            />
            <span class="campo largo">
              <label for="cforn-aval-parecer">{{ M.avaliacoes.parecer }}</label>
              <textarea
                id="cforn-aval-parecer"
                v-model="avaliacao.parecer"
                rows="2"
                data-testid="cforn-aval-parecer"
              />
            </span>
            <p role="status" data-testid="cforn-aval-previa">
              {{
                fmt(M.avaliacoes.previa, {
                  conta: previaAvaliacao.conta,
                  resultado: rotuloResultado(previaAvaliacao.resultado),
                })
              }}
            </p>
            <ul v-if="recusasAvaliacao.length" role="alert" data-testid="cforn-aval-recusas">
              <li v-for="r in recusasAvaliacao" :key="r.codigo + r.mensagem">{{ r.mensagem }}</li>
            </ul>
            <SanteBotao
              tipo="submit"
              :rotulo="M.avaliacoes.registrar"
              :desabilitado="enviando || recusasAvaliacao.length > 0"
              data-testid="cforn-aval-registrar"
            />
          </form>
        </section>

        <section aria-labelledby="cforn-oc-titulo" data-testid="cforn-ocorrencias">
          <h3 id="cforn-oc-titulo">{{ M.ocorrencias.titulo }}</h3>
          <p v-if="ficha.data.value.ocorrencias.length === 0">{{ M.ocorrencias.nenhuma }}</p>
          <div
            v-for="o in ficha.data.value.ocorrencias"
            :key="o.id"
            class="ocorrencia"
            :data-testid="`cforn-ocorrencia-${o.numero}`"
          >
            <p>
              <strong>{{ fmt(M.ocorrencias.numero, { numero: o.numero }) }}</strong>
              · {{ rotulo(M.ocorrencias.tipos, o.tipo) }} ·
              {{ rotulo(M.ocorrencias.gravidades, o.gravidade) }} ·
              {{ o.ocorridoEm.replace('T', ' ').slice(0, 16) }} ·
              <span :data-testid="`cforn-ocorrencia-situacao-${o.numero}`">{{
                M.ocorrencias.situacoes[o.situacao]
              }}</span>
            </p>
            <p>{{ o.descricao }}</p>
            <p v-if="o.tratativa" class="secundario">{{ o.tratativa }}</p>
            <form
              v-if="pode.editar && ocorrenciaEmAberto(o.situacao)"
              class="grade"
              :data-testid="`cforn-andamento-${o.numero}`"
              @submit.prevent="gravarAndamento(o)"
            >
              <SanteSelecao
                v-model="andamentoDe(o).situacao"
                :rotulo="M.ocorrencias.passarPara"
                :opcoes="opcoesAndamento(o)"
                :data-testid="`cforn-andamento-situacao-${o.numero}`"
              />
              <span v-if="andamentoDe(o).situacao === 'notificada'" class="campo">
                <label :for="`cforn-andamento-email-${o.id}`">{{ M.ocorrencias.email }}</label>
                <input
                  :id="`cforn-andamento-email-${o.id}`"
                  v-model="andamentoDe(o).email"
                  type="email"
                  :data-testid="`cforn-andamento-email-${o.numero}`"
                />
              </span>
              <span class="campo largo">
                <label :for="`cforn-andamento-tratativa-${o.id}`">{{ M.ocorrencias.tratativa }}</label>
                <textarea
                  :id="`cforn-andamento-tratativa-${o.id}`"
                  v-model="andamentoDe(o).tratativa"
                  rows="2"
                  :data-testid="`cforn-andamento-tratativa-${o.numero}`"
                />
              </span>
              <ul v-if="recusasAndamento(o).length" role="alert">
                <li v-for="r in recusasAndamento(o)" :key="r.codigo">{{ r.mensagem }}</li>
              </ul>
              <SanteBotao
                tipo="submit"
                :rotulo="M.ocorrencias.gravarAndamento"
                :desabilitado="enviando || !andamentoDe(o).situacao || recusasAndamento(o).length > 0"
                :data-testid="`cforn-andamento-gravar-${o.numero}`"
              />
            </form>
          </div>
          <form
            v-if="pode.editar"
            class="grade"
            data-testid="cforn-ocorrencia-form"
            @submit.prevent="gravarOcorrencia"
          >
            <SanteSelecao
              v-model="ocorrencia.tipo"
              :rotulo="M.ocorrencias.tipo"
              :opcoes="opcoesTipoOcorrencia"
              data-testid="cforn-oc-tipo"
            />
            <SanteSelecao
              v-model="ocorrencia.gravidade"
              :rotulo="M.ocorrencias.gravidade"
              :opcoes="opcoesGravidade"
              data-testid="cforn-oc-gravidade"
            />
            <span class="campo">
              <label for="cforn-oc-quando">{{ M.ocorrencias.ocorridoEm }}</label>
              <input
                id="cforn-oc-quando"
                v-model="ocorrencia.ocorridoEm"
                type="datetime-local"
                data-testid="cforn-oc-quando"
              />
            </span>
            <span class="campo">
              <label for="cforn-oc-qtd">{{ M.ocorrencias.quantidadeAfetada }}</label>
              <input
                id="cforn-oc-qtd"
                v-model.number="ocorrencia.quantidadeAfetada"
                type="number"
                min="0"
                step="any"
                data-testid="cforn-oc-qtd"
              />
            </span>
            <span class="campo">
              <label for="cforn-oc-valor">{{ M.ocorrencias.valorAfetado }}</label>
              <input
                id="cforn-oc-valor"
                v-model.number="ocorrencia.valorAfetado"
                type="number"
                min="0"
                step="0.01"
              />
            </span>
            <span class="campo largo">
              <label for="cforn-oc-descricao">{{ M.ocorrencias.descricao }}</label>
              <textarea
                id="cforn-oc-descricao"
                v-model="ocorrencia.descricao"
                rows="2"
                data-testid="cforn-oc-descricao"
              />
            </span>
            <ul v-if="recusasOcorrencia.length" role="alert" data-testid="cforn-oc-recusas">
              <li v-for="r in recusasOcorrencia" :key="r.codigo">{{ r.mensagem }}</li>
            </ul>
            <SanteBotao
              tipo="submit"
              :rotulo="M.ocorrencias.registrar"
              :desabilitado="enviando || recusasOcorrencia.length > 0"
              data-testid="cforn-oc-registrar"
            />
          </form>
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped>
.cadastro-fornecedor {
  display: grid;
  gap: var(--sgh-espaco-3, 0.75rem);
}
.cabecalho {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.grade fieldset,
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2, 0.5rem);
  align-items: end;
}
.largo {
  flex-basis: 100%;
}
.marcar {
  display: inline-flex;
  gap: 0.25rem;
  align-items: center;
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
