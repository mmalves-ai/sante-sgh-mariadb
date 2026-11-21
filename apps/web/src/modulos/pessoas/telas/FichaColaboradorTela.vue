<script setup lang="ts">
// Ficha do colaborador (M52.1; regras 1 a 4; leitura auditada de dado pessoal, CPF mascarado): os dados do vínculo,
// os outros vínculos da mesma pessoa, a atuação assistencial (a situação do cadastro de profissionais com a legenda
// "a confirmar", que não define o vínculo; os registros no conselho com a validade conferida pelo RH), o acesso ao
// sistema, os dependentes e o histórico funcional. Ações por permissão e liberação: registrar mudança, incluir e
// encerrar dependente (com confirmação; nunca apagado), registrar a validade e desligar. Cada registro mostra as
// unidades onde o profissional atende.
import {
  esquemaAlterarDependente,
  esquemaAlterarVinculo,
  esquemaCorrigirColaborador,
  esquemaDependente,
  esquemaEncerrarDependente,
  esquemaLigarCargoColaborador,
  esquemaRegistrarHabilitacao,
  PARENTESCOS_DEPENDENTE,
  type ParentescoDependente,
  SITUACOES_HABILITACAO,
  TIPOS_EVENTO_HISTORICO,
  TIPOS_VINCULO,
  type CorrecaoColaboradorLida,
  type TipoVinculo,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  alterarDependente,
  corrigirColaborador,
  encerrarDependente,
  incluirDependente,
  lerApoioPessoas,
  lerFicha,
  ligarCargoColaborador,
  registrarMudanca,
  registrarValidade,
} from '../api-pessoas.js';
import { lerCargos } from '../cargos/api-cargos.js';
import { dataBr, opcoesDe, semVinculo } from '../comum.js';
import DialogoDesligamento from '../componentes/DialogoDesligamento.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import DesempenhoColaborador from '../avaliacao/DesempenhoColaborador.vue';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const vinculo = computed(() => Number(rota.params['vinculo']));
const apoio = useQuery({ queryKey: ['pessoas', 'apoio'], queryFn: lerApoioPessoas });
const ficha = useQuery({
  queryKey: computed(() => ['pessoas', 'ficha', vinculo.value]),
  queryFn: () => lerFicha(vinculo.value),
});
const f = computed(() => ficha.data.value ?? null);
const a = computed(() => apoio.data.value ?? null);
const ativo = computed(() => f.value?.estado === 'ativo');
const podeAgir = computed(() => !!a.value?.acoes.admitir && ativo.value);
// W0-06: a correção cadastral vale também para o desligado (o erro de registro se corrige sempre, com motivo).
const podeCorrigir = computed(() => !!a.value?.acoes.admitir && !!f.value);
const podeDesligar = computed(() => !!a.value?.acoes.desligar && ativo.value);
const aviso = ref<string | null>(null);
async function recarregar(msg: string): Promise<void> {
  aviso.value = msg;
  await cliente.invalidateQueries({ queryKey: ['pessoas'] });
}
const varianteConselho = (s: string) => (s === 'vencida' ? 'alerta' : s === 'aVencer' ? 'aviso' : 'info');
function prazo(dias: number | null): string {
  if (dias === null) return '';
  return dias < 0
    ? t('pessoas.conselho.vencidoHa', { dias: -dias })
    : t('pessoas.conselho.diasParaVencer', { dias });
}

// ── Mudança funcional ──
const mudando = ref(false);
const mVigencia = ref<string | null>(null);
const mCargo = ref('');
const mFuncao = ref('');
const mCarga = ref('');
const mCentro = ref<number | null>(null);
const mMotivo = ref('');
const mErro = ref<unknown>(null);
function abrirMudanca(): void {
  const x = f.value!;
  mVigencia.value = a.value?.hoje ?? null;
  mCargo.value = x.cargo;
  mFuncao.value = x.funcao ?? '';
  mCarga.value = String(x.cargaSemanalHoras);
  mCentro.value = x.lotacao.centroCusto;
  mMotivo.value = '';
  mErro.value = null;
  mudando.value = true;
}
const mEntrada = computed(() => {
  const x = f.value;
  if (!x) return null;
  const lotacaoMudou = mCentro.value !== null && mCentro.value !== x.lotacao.centroCusto;
  return esquemaAlterarVinculo.safeParse({
    vinculo: x.vinculo,
    versao: x.versao,
    vigencia: mVigencia.value ?? '',
    ...(mCargo.value.trim() !== x.cargo ? { cargo: mCargo.value.trim() } : {}),
    ...((mFuncao.value.trim() || null) !== x.funcao ? { funcao: mFuncao.value.trim() || null } : {}),
    ...(Number(mCarga.value) !== x.cargaSemanalHoras ? { cargaSemanalHoras: Number(mCarga.value) } : {}),
    ...(lotacaoMudou
      ? { lotacao: { centroCusto: mCentro.value, unidade: x.lotacao.unidade, setor: x.lotacao.setor } }
      : {}),
    motivo: mMotivo.value.trim(),
  });
});
async function gravarMudanca(): Promise<void> {
  const e = mEntrada.value;
  if (!e?.success) return;
  mErro.value = null;
  try {
    const resto = semVinculo(e.data);
    await registrarMudanca(vinculo.value, resto);
    mudando.value = false;
    await recarregar(t('pessoas.ficha.mudanca.sucesso'));
  } catch (x) {
    mErro.value = x;
  }
}

// ── Dependente ──
const incluindo = ref(false);
const dNome = ref('');
const dNascimento = ref<string | null>(null);
const dParentesco = ref<ParentescoDependente | null>(null);
const dCpf = ref('');
const dIr = ref(false);
const dSf = ref(false);
const dErro = ref<unknown>(null);
const opcoesParentesco = opcoesDe(PARENTESCOS_DEPENDENTE);
const dEntrada = computed(() =>
  esquemaDependente.safeParse({
    vinculo: vinculo.value,
    nome: dNome.value.trim(),
    nascimento: dNascimento.value ?? '',
    parentesco: dParentesco.value ?? '',
    cpf: dCpf.value.trim() || null,
    dependenteIr: dIr.value,
    dependenteSalarioFamilia: dSf.value,
  }),
);
async function gravarDependente(): Promise<void> {
  if (!dEntrada.value.success) return;
  dErro.value = null;
  try {
    const resto = semVinculo(dEntrada.value.data);
    await incluirDependente(vinculo.value, resto);
    incluindo.value = false;
    dNome.value = '';
    dNascimento.value = null;
    dParentesco.value = null;
    dCpf.value = '';
    await recarregar(t('pessoas.dependentes.sucesso'));
  } catch (x) {
    dErro.value = x;
  }
}

// ── Fim do dependente ──
const encerrandoId = ref<number | null>(null);
const eAte = ref<string | null>(null);
const eMotivo = ref('');
const eErro = ref<unknown>(null);
const encerrando = computed({
  get: () => encerrandoId.value !== null,
  set: (v: boolean) => {
    if (!v) encerrandoId.value = null;
  },
});
const encerrandoNome = computed(
  () => f.value?.dependentes.find((d) => d.id === encerrandoId.value)?.nome ?? '',
);
function abrirEncerrar(id: number): void {
  encerrandoId.value = id;
  eAte.value = a.value?.hoje ?? null;
  eMotivo.value = '';
  eErro.value = null;
}
const eEntrada = computed(() =>
  esquemaEncerrarDependente.safeParse({
    vinculo: vinculo.value,
    dependente: encerrandoId.value ?? 0,
    ate: eAte.value ?? '',
    motivo: eMotivo.value.trim(),
  }),
);
async function gravarEncerramento(): Promise<void> {
  if (!eEntrada.value.success || encerrandoId.value === null) return;
  eErro.value = null;
  try {
    const { ate, motivo } = eEntrada.value.data;
    await encerrarDependente(vinculo.value, encerrandoId.value, { ate, motivo });
    encerrandoId.value = null;
    await recarregar(t('pessoas.dependentes.encerrado'));
  } catch (x) {
    eErro.value = x;
  }
}

// ── W0-06: correção cadastral (nome, matrícula, tipo, admissão), com motivo; o valor anterior fica no histórico ──
const corrigindo = ref(false);
const cNome = ref('');
const cMatricula = ref('');
const cTipo = ref<TipoVinculo | null>(null);
const cAdmissao = ref<string | null>(null);
const cMotivo = ref('');
const cErro = ref<unknown>(null);
const opcoesTipo = opcoesDe(TIPOS_VINCULO);
function abrirCorrecao(): void {
  const x = f.value!;
  cNome.value = x.nome;
  cMatricula.value = x.matricula ?? '';
  cTipo.value = x.tipo;
  cAdmissao.value = x.admissao;
  cMotivo.value = '';
  cErro.value = null;
  corrigindo.value = true;
}
const cEntrada = computed(() => {
  const x = f.value;
  if (!x) return null;
  const matricula = cMatricula.value.trim() || null;
  return esquemaCorrigirColaborador.safeParse({
    vinculo: x.vinculo,
    versao: x.versao,
    ...(cNome.value.trim() !== x.nome ? { nome: cNome.value.trim() } : {}),
    ...(matricula !== x.matricula ? { matricula } : {}),
    ...(cTipo.value && cTipo.value !== x.tipo ? { tipo: cTipo.value } : {}),
    ...(cAdmissao.value && cAdmissao.value !== x.admissao ? { admissao: cAdmissao.value } : {}),
    motivo: cMotivo.value.trim(),
  });
});
async function gravarCorrecao(): Promise<void> {
  const e = cEntrada.value;
  if (!e?.success) return;
  cErro.value = null;
  try {
    await corrigirColaborador(vinculo.value, semVinculo(e.data));
    corrigindo.value = false;
    await recarregar(t('pessoas.correcao.sucesso'));
  } catch (x) {
    cErro.value = x;
  }
}

// ── W0-06 (5d-3a): cargo do quadro de cargos e salários (só os ativos; null retira), com motivo ──
const ligandoCargo = ref(false);
const qCargo = ref<number | null>(null);
const qRetirar = ref(false);
const qMotivo = ref('');
const qErro = ref<unknown>(null);
const quadro = useQuery({
  queryKey: ['pessoas', 'cargos', 'lista'],
  queryFn: lerCargos,
  enabled: ligandoCargo,
});
const opcoesQuadro = computed(() =>
  (quadro.data.value?.cargos ?? [])
    .filter((c) => c.ativo)
    .map((c) => ({ valor: c.id, rotulo: t('pessoas.cargoQuadro.valor', { nome: c.nome, cbo: c.cbo }) })),
);
function abrirCargoQuadro(): void {
  qCargo.value = f.value?.cargoQuadro?.id ?? null;
  qRetirar.value = false;
  qMotivo.value = '';
  qErro.value = null;
  ligandoCargo.value = true;
}
const qEntrada = computed(() => {
  const x = f.value;
  if (!x) return null;
  const cargo = qRetirar.value ? null : qCargo.value;
  if (cargo === (x.cargoQuadro?.id ?? null)) return null;
  return esquemaLigarCargoColaborador.safeParse({
    vinculo: x.vinculo,
    versao: x.versao,
    cargo,
    motivo: qMotivo.value.trim(),
  });
});
async function gravarCargoQuadro(): Promise<void> {
  const e = qEntrada.value;
  if (!e?.success) return;
  qErro.value = null;
  try {
    await ligarCargoColaborador(vinculo.value, semVinculo(e.data));
    ligandoCargo.value = false;
    await recarregar(t('pessoas.cargoQuadro.sucesso'));
  } catch (x) {
    qErro.value = x;
  }
}

// ── W0-06: alteração do dependente com versão (a anterior acaba na véspera de "a partir de") ──
const alterandoId = ref<number | null>(null);
const aDesde = ref<string | null>(null);
const aNome = ref('');
const aNascimento = ref<string | null>(null);
const aParentesco = ref<ParentescoDependente | null>(null);
const aCpf = ref('');
const aRetirarCpf = ref(false);
const aIr = ref(false);
const aSf = ref(false);
const aMotivo = ref('');
const aErro = ref<unknown>(null);
const alterando = computed({
  get: () => alterandoId.value !== null,
  set: (v: boolean) => {
    if (!v) alterandoId.value = null;
  },
});
const depAlterado = computed(() => f.value?.dependentes.find((d) => d.id === alterandoId.value) ?? null);
function abrirAlteracao(id: number): void {
  const d = f.value?.dependentes.find((x) => x.id === id);
  if (!d) return;
  alterandoId.value = id;
  aDesde.value = a.value?.hoje ?? null;
  aNome.value = d.nome;
  aNascimento.value = d.nascimento;
  aParentesco.value = d.parentesco;
  aCpf.value = '';
  aRetirarCpf.value = false;
  aIr.value = d.dependenteIr;
  aSf.value = d.dependenteSalarioFamilia;
  aMotivo.value = '';
  aErro.value = null;
}
const aEntrada = computed(() => {
  const d = depAlterado.value;
  if (!d) return null;
  const cpf = aCpf.value.replace(/\D/g, '');
  return esquemaAlterarDependente.safeParse({
    vinculo: vinculo.value,
    dependente: d.id,
    desde: aDesde.value ?? '',
    ...(aNome.value.trim() !== d.nome ? { nome: aNome.value.trim() } : {}),
    ...(aNascimento.value && aNascimento.value !== d.nascimento ? { nascimento: aNascimento.value } : {}),
    ...(aParentesco.value && aParentesco.value !== d.parentesco ? { parentesco: aParentesco.value } : {}),
    ...(aRetirarCpf.value ? { cpf: null } : cpf ? { cpf } : {}),
    ...(aIr.value !== d.dependenteIr ? { dependenteIr: aIr.value } : {}),
    ...(aSf.value !== d.dependenteSalarioFamilia ? { dependenteSalarioFamilia: aSf.value } : {}),
    motivo: aMotivo.value.trim(),
  });
});
async function gravarAlteracao(): Promise<void> {
  const e = aEntrada.value;
  if (!e?.success || alterandoId.value === null) return;
  aErro.value = null;
  try {
    const resto: Partial<typeof e.data> = { ...e.data };
    delete resto.vinculo;
    delete resto.dependente;
    await alterarDependente(
      vinculo.value,
      alterandoId.value,
      resto as Omit<typeof e.data, 'vinculo' | 'dependente'>,
    );
    alterandoId.value = null;
    await recarregar(t('pessoas.dependentes.alterado'));
  } catch (x) {
    aErro.value = x;
  }
}

// ── W0-06: histórico das correções e alterações (valor anterior e novo, motivo, quem e quando) ──
function rotuloOu(chave: string, padrao: string): string {
  const v = t(chave);
  return v === chave ? padrao : v;
}
const nomeOperacaoCorrecao = (op: string) =>
  rotuloOu(`pessoas.correcao.operacoes.${op.replaceAll('.', '_')}`, op);
function mudancasCorrecao(
  c: CorrecaoColaboradorLida,
): Array<{ campo: string; antes: string; depois: string }> {
  const chaves = [...new Set([...Object.keys(c.antes), ...Object.keys(c.depois)])].filter(
    (k) => k !== 'dependente' && !(k === 'cargo' && 'cargoQuadro' in c.depois),
  );
  const txt = (k: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? t('pessoas.correcao.sim') : t('pessoas.correcao.nao');
    const x = String(v);
    if (k === 'tipo' && x in TIPOS_VINCULO) return TIPOS_VINCULO[x as TipoVinculo];
    if (k === 'parentesco' && x in PARENTESCOS_DEPENDENTE)
      return PARENTESCOS_DEPENDENTE[x as ParentescoDependente];
    return /^\d{4}-\d{2}-\d{2}$/.test(x) ? dataBr(x) : x;
  };
  return chaves.map((k) => ({
    campo: rotuloOu(`pessoas.correcao.campos.${k}`, k),
    antes: txt(k, c.antes[k]),
    depois: txt(k, c.depois[k]),
  }));
}

// ── Validade do conselho ──
const registroAberto = ref<number | null>(null);
const hValidade = ref<string | null>(null);
const hConferido = ref<string | null>(null);
const hObs = ref('');
const hErro = ref<unknown>(null);
const validando = computed({
  get: () => registroAberto.value !== null,
  set: (v: boolean) => {
    if (!v) registroAberto.value = null;
  },
});
function abrirValidade(registro: number, validade: string | null): void {
  registroAberto.value = registro;
  hValidade.value = validade;
  hConferido.value = a.value?.hoje ?? null;
  hObs.value = '';
  hErro.value = null;
}
const hEntrada = computed(() =>
  esquemaRegistrarHabilitacao.safeParse({
    registro: registroAberto.value ?? 0,
    validade: hValidade.value,
    conferidoEm: hConferido.value ?? '',
    observacao: hObs.value.trim() || null,
  }),
);
async function gravarValidade(): Promise<void> {
  if (!hEntrada.value.success) return;
  hErro.value = null;
  try {
    await registrarValidade(hEntrada.value.data);
    registroAberto.value = null;
    await recarregar(t('pessoas.conselho.sucesso'));
  } catch (x) {
    hErro.value = x;
  }
}

// ── Desligamento ──
const desligando = ref(false);
const opcoesCentro = computed(() =>
  (a.value?.centrosCusto ?? []).map((c) => ({ valor: c.codigo, rotulo: c.rotulo })),
);
const { permissoes: permissoesSessao } = usarSessao();
const veFichaEsocial = computed(() => permissoesSessao.value.has('pessoas.esocial.gerar'));
const veDesempenho = computed(() => permissoesSessao.value.has('pessoas.avaliacao.ler'));
const tipoRescisao = (c: number) => a.value?.tiposRescisao.find((x) => x.codigo === c)?.rotulo ?? String(c);
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="pes-ficha-titulo" data-testid="tela-ficha-colaborador">
    <p>
      <RouterLink to="/pessoas/colaboradores">{{ t('pessoas.ficha.voltarLista') }}</RouterLink>
      <!-- M53.6 (D-FICHA-TELA-536): a ficha do eSocial do colaborador, para quem gera os eventos do eSocial. -->
      <template v-if="veFichaEsocial">
        ·
        <RouterLink
          :to="`/pessoas/esocial?aba=fichas&vinculo=${vinculo}`"
          data-testid="ficha-abrir-esocial"
          >{{ t('pessoas.ficha.fichaEsocial') }}</RouterLink
        >
      </template>
    </p>
    <h1 id="pes-ficha-titulo">{{ f ? f.nome : t('pessoas.ficha.titulo') }}</h1>
    <ErroPessoas v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!f" role="status">{{ t('pessoas.carregando') }}</p>
    <template v-else>
      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="aviso-ficha" />
      <SanteAlerta
        v-if="a && !a.gravacao.ligada"
        :texto="a.gravacao.motivo ?? t('pessoas.gravacaoDesligada')"
        variante="info"
      />
      <div class="acoes">
        <SanteBotao
          v-if="podeAgir"
          :rotulo="t('pessoas.ficha.alterar')"
          variante="secundario"
          data-testid="abrir-mudanca"
          @acionar="abrirMudanca"
        />
        <SanteBotao
          v-if="podeCorrigir"
          :rotulo="t('pessoas.correcao.abrir')"
          variante="secundario"
          data-testid="abrir-correcao"
          @acionar="abrirCorrecao"
        />
        <SanteBotao
          v-if="podeCorrigir"
          :rotulo="t('pessoas.cargoQuadro.abrir')"
          variante="secundario"
          data-testid="abrir-cargo-quadro"
          @acionar="abrirCargoQuadro"
        />
        <SanteBotao
          v-if="podeAgir"
          :rotulo="t('pessoas.dependentes.incluir')"
          variante="secundario"
          data-testid="abrir-dependente"
          @acionar="incluindo = true"
        />
        <SanteBotao
          v-if="podeDesligar"
          :rotulo="t('pessoas.ficha.desligar')"
          variante="secundario"
          data-testid="abrir-desligamento"
          @acionar="desligando = true"
        />
      </div>

      <section class="bloco" aria-labelledby="pes-ficha-dados">
        <h2 id="pes-ficha-dados">{{ t('pessoas.ficha.dados') }}</h2>
        <dl class="dados" data-testid="ficha-dados">
          <dt>{{ t('pessoas.ficha.cpf') }}</dt>
          <dd data-testid="ficha-cpf">{{ f.cpfMascarado ?? '' }}</dd>
          <dt>{{ t('pessoas.admissao.matricula') }}</dt>
          <dd>{{ f.matricula ?? '' }}</dd>
          <dt>{{ t('pessoas.ficha.vinculo') }}</dt>
          <dd>
            {{ TIPOS_VINCULO[f.tipo] }} ·
            <span data-testid="ficha-estado">{{
              ativo ? t('pessoas.ficha.ativo') : t('pessoas.ficha.desligado')
            }}</span>
          </dd>
          <dt>{{ t('pessoas.ficha.cargo') }}</dt>
          <dd data-testid="ficha-cargo">{{ f.cargo }}</dd>
          <dt>{{ t('pessoas.cargoQuadro.rotulo') }}</dt>
          <dd data-testid="ficha-cargo-quadro">
            <template v-if="f.cargoQuadro">
              {{ t('pessoas.cargoQuadro.valor', { nome: f.cargoQuadro.nome, cbo: f.cargoQuadro.cbo }) }}
              <span v-if="!f.cargoQuadro.ativo" class="secundario"
                >· {{ t('pessoas.cargoQuadro.inativo') }}</span
              >
            </template>
            <span v-else class="secundario">{{ t('pessoas.cargoQuadro.nenhum') }}</span>
          </dd>
          <dt>{{ t('pessoas.ficha.funcao') }}</dt>
          <dd>{{ f.funcao ?? '' }}</dd>
          <dt>{{ t('pessoas.ficha.carga') }}</dt>
          <dd>{{ t('pessoas.ficha.cargaHoras', { horas: f.cargaSemanalHoras }) }}</dd>
          <dt>{{ t('pessoas.ficha.lotacao') }}</dt>
          <dd>
            {{
              [f.lotacao.centroCustoNome ?? f.lotacao.centroCusto, f.lotacao.unidadeNome, f.lotacao.setor]
                .filter(Boolean)
                .join(' · ')
            }}
          </dd>
          <dt>{{ t('pessoas.ficha.admissao') }}</dt>
          <dd>{{ dataBr(f.admissao) }}</dd>
          <template v-if="f.desligamento">
            <dt>{{ t('pessoas.ficha.desligamento') }}</dt>
            <dd data-testid="ficha-desligamento">
              {{ dataBr(f.desligamento.data) }} · {{ tipoRescisao(f.desligamento.tipoRescisao) }}
            </dd>
            <dt>{{ t('pessoas.ficha.motivoDesligamento') }}</dt>
            <dd>{{ f.desligamento.motivo }}</dd>
          </template>
        </dl>
      </section>

      <section v-if="f.outrosVinculos.length" class="bloco" aria-labelledby="pes-ficha-outros">
        <h2 id="pes-ficha-outros">{{ t('pessoas.ficha.outrosVinculos') }}</h2>
        <ul>
          <li v-for="o in f.outrosVinculos" :key="o.vinculo">
            <RouterLink :to="`/pessoas/colaboradores/${o.vinculo}`"
              >{{ TIPOS_VINCULO[o.tipo] }} · {{ o.cargo }}</RouterLink
            >
            ({{ o.estado === 'ativo' ? t('pessoas.ficha.ativo') : t('pessoas.ficha.desligado') }})
          </li>
        </ul>
      </section>

      <section class="bloco" aria-labelledby="pes-ficha-assist" data-testid="ficha-assistencial">
        <h2 id="pes-ficha-assist">{{ t('pessoas.ficha.assistencial') }}</h2>
        <p v-if="!f.profissional">{{ t('pessoas.ficha.semProfissional') }}</p>
        <template v-else>
          <p v-if="f.profissional.situacao" data-testid="ficha-situacao-cadastro">
            {{ t('pessoas.ficha.situacaoCadastro') }}: {{ f.profissional.situacao }}
          </p>
          <p v-if="f.profissional.registros.length === 0">{{ t('pessoas.conselho.semRegistros') }}</p>
          <table v-else class="tabela" data-testid="tabela-registros">
            <caption class="secundario">
              {{
                t('pessoas.ficha.registros')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('pessoas.conselho.registro') }}</th>
                <th scope="col">{{ t('pessoas.conselho.cbo') }}</th>
                <th scope="col">{{ t('pessoas.ficha.unidadesAtende') }}</th>
                <th scope="col">{{ t('pessoas.conselho.validade') }}</th>
                <th scope="col">{{ t('pessoas.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in f.profissional.registros"
                :key="r.registro"
                :data-testid="`registro-${r.registro}`"
              >
                <th scope="row">
                  {{ [r.conselho, r.numero, r.uf].filter(Boolean).join(' ') }}
                  <span v-if="r.ativo === false" class="secundario"
                    >({{ t('pessoas.conselho.inativo') }})</span
                  >
                </th>
                <td>{{ r.cboDescricao ?? r.cbo ?? '' }}</td>
                <td :data-testid="`registro-unidades-${r.registro}`">
                  <template v-if="r.unidades.length">{{
                    r.unidades
                      .map((u) =>
                        u.ativo
                          ? (u.nome ?? u.codigo)
                          : `${u.nome ?? u.codigo} (${t('pessoas.conselho.inativo')})`,
                      )
                      .join(', ')
                  }}</template>
                  <span v-else class="secundario">{{ t('pessoas.ficha.semUnidade') }}</span>
                </td>
                <td>
                  {{ dataBr(r.validade) }}
                  <SanteAlerta
                    v-if="r.ativo !== false && r.situacao !== 'valida'"
                    :texto="`${SITUACOES_HABILITACAO[r.situacao]} ${prazo(r.diasParaVencer)}`.trim()"
                    :variante="varianteConselho(r.situacao)"
                  />
                </td>
                <td>
                  <SanteBotao
                    v-if="podeAgir"
                    :rotulo="t('pessoas.conselho.registrar')"
                    variante="texto"
                    :data-testid="`registrar-validade-${r.registro}`"
                    @acionar="abrirValidade(r.registro, r.validade)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </section>

      <section class="bloco" aria-labelledby="pes-ficha-acesso" data-testid="ficha-acesso">
        <h2 id="pes-ficha-acesso">{{ t('pessoas.ficha.acesso') }}</h2>
        <p v-if="f.usuarios.length === 0">{{ t('pessoas.ficha.semUsuario') }}</p>
        <ul v-else>
          <li v-for="u in f.usuarios" :key="`${u.hospital}-${u.login}`" :data-bloqueado="u.bloqueado">
            {{ u.login }}:
            {{ u.bloqueado ? t('pessoas.ficha.acessoBloqueado') : t('pessoas.ficha.acessoLivre') }}
          </li>
        </ul>
      </section>

      <section class="bloco" aria-labelledby="pes-ficha-dep" data-testid="ficha-dependentes">
        <h2 id="pes-ficha-dep">{{ t('pessoas.dependentes.titulo') }}</h2>
        <p v-if="f.dependentes.length === 0">{{ t('pessoas.dependentes.vazio') }}</p>
        <table v-else class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('pessoas.dependentes.nome') }}</th>
              <th scope="col">{{ t('pessoas.dependentes.nascimento') }}</th>
              <th scope="col">{{ t('pessoas.dependentes.parentesco') }}</th>
              <th scope="col">{{ t('pessoas.ficha.cpf') }}</th>
              <th scope="col">{{ t('pessoas.dependentes.desde') }}</th>
              <th scope="col">{{ t('pessoas.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in f.dependentes" :key="d.id" :data-testid="`dependente-${d.id}`">
              <th scope="row">{{ d.nome }}</th>
              <td>{{ dataBr(d.nascimento) }}</td>
              <td>{{ PARENTESCOS_DEPENDENTE[d.parentesco] }}</td>
              <td>{{ d.cpfMascarado ?? '' }}</td>
              <td>{{ d.desde ? dataBr(d.desde) : '' }}</td>
              <td>
                <SanteBotao
                  v-if="podeAgir"
                  :rotulo="t('pessoas.dependentes.alterar')"
                  variante="texto"
                  :data-testid="`alterar-dependente-${d.id}`"
                  @acionar="abrirAlteracao(d.id)"
                />
                <SanteBotao
                  v-if="podeAgir"
                  :rotulo="t('pessoas.dependentes.encerrar')"
                  variante="texto"
                  :data-testid="`encerrar-dependente-${d.id}`"
                  @acionar="abrirEncerrar(d.id)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <DesempenhoColaborador v-if="veDesempenho" :vinculo="vinculo" :ativo="ativo" />

      <section class="bloco" aria-labelledby="pes-ficha-hist" data-testid="ficha-historico">
        <h2 id="pes-ficha-hist">{{ t('pessoas.historico.titulo') }}</h2>
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('pessoas.historico.vigencia') }}</th>
              <th scope="col">{{ t('pessoas.historico.evento') }}</th>
              <th scope="col">{{ t('pessoas.historico.antes') }}</th>
              <th scope="col">{{ t('pessoas.historico.depois') }}</th>
              <th scope="col">{{ t('pessoas.motivo') }}</th>
              <th scope="col">{{ t('pessoas.historico.quem') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in f.historico" :key="h.id" :data-tipo="h.tipo">
              <th scope="row">{{ dataBr(h.vigencia) }}</th>
              <td>{{ TIPOS_EVENTO_HISTORICO[h.tipo] }}</td>
              <td>{{ h.antes ?? '' }}</td>
              <td>{{ h.depois ?? '' }}</td>
              <td>{{ h.motivo ?? '' }}</td>
              <td>{{ h.registradoPor }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="bloco" aria-labelledby="pes-ficha-correcoes" data-testid="ficha-correcoes">
        <h2 id="pes-ficha-correcoes">{{ t('pessoas.correcao.historico') }}</h2>
        <p v-if="(f.correcoes ?? []).length === 0" class="secundario">
          {{ t('pessoas.correcao.semHistorico') }}
        </p>
        <ul v-else>
          <li v-for="c in f.correcoes" :key="c.id" :data-testid="`correcao-${c.id}`">
            {{
              t('pessoas.correcao.linha', {
                em: `${dataBr(c.em)} ${c.em.slice(11, 16)}`,
                por: c.por,
                operacao: nomeOperacaoCorrecao(c.operacao),
              })
            }}
            <div class="secundario">{{ c.motivo }}</div>
            <ul class="secundario">
              <li v-for="m in mudancasCorrecao(c)" :key="m.campo">
                {{ t('pessoas.correcao.mudanca', m) }}
              </li>
            </ul>
          </li>
        </ul>
      </section>

      <SanteDialogo v-model:visivel="ligandoCargo" :titulo="t('pessoas.cargoQuadro.titulo')">
        <form class="bloco" data-testid="form-cargo-quadro" @submit.prevent="gravarCargoQuadro">
          <p class="secundario">{{ t('pessoas.cargoQuadro.ajuda') }}</p>
          <SanteSelecao
            v-if="!qRetirar"
            v-model="qCargo"
            :rotulo="t('pessoas.cargoQuadro.campo')"
            :opcoes="opcoesQuadro"
            busca
            obrigatorio
            data-testid="cargo-quadro-cargo"
          />
          <p
            v-if="quadro.isSuccess.value && opcoesQuadro.length === 0"
            class="secundario"
            data-testid="cargo-quadro-vazio"
          >
            {{ t('pessoas.cargoQuadro.semCargos') }}
          </p>
          <ErroPessoas v-if="quadro.error.value" :erro="quadro.error.value" />
          <label v-if="f.cargoQuadro" class="marca">
            <input v-model="qRetirar" type="checkbox" data-testid="cargo-quadro-retirar" />
            {{ t('pessoas.cargoQuadro.retirar') }}
          </label>
          <SanteCampoTexto
            v-model="qMotivo"
            :rotulo="t('pessoas.motivo')"
            :max-bytes="400"
            multilinha
            obrigatorio
            data-testid="cargo-quadro-motivo"
          />
          <p class="secundario">{{ t('pessoas.motivoAjuda') }}</p>
          <ErroPessoas v-if="qErro" :erro="qErro" />
          <div class="acoes">
            <SanteBotao :rotulo="t('pessoas.cancelar')" variante="texto" @acionar="ligandoCargo = false" />
            <SanteBotao
              :rotulo="t('pessoas.gravar')"
              tipo="submit"
              :desabilitado="!qEntrada?.success"
              data-testid="cargo-quadro-gravar"
            />
          </div>
        </form>
      </SanteDialogo>

      <SanteDialogo v-model:visivel="corrigindo" :titulo="t('pessoas.correcao.titulo')">
        <form class="bloco" data-testid="form-correcao" @submit.prevent="gravarCorrecao">
          <p class="secundario">{{ t('pessoas.correcao.ajuda') }}</p>
          <SanteCampoTexto
            v-model="cNome"
            :rotulo="t('pessoas.dependentes.nome')"
            :max-bytes="70"
            obrigatorio
            data-testid="correcao-nome"
          />
          <SanteCampoTexto
            v-model="cMatricula"
            :rotulo="t('pessoas.admissao.matricula')"
            :max-bytes="20"
            data-testid="correcao-matricula"
          />
          <SanteSelecao
            v-model="cTipo"
            :rotulo="t('pessoas.ficha.vinculo')"
            :opcoes="opcoesTipo"
            obrigatorio
            data-testid="correcao-tipo"
          />
          <SanteData
            v-model="cAdmissao"
            :rotulo="t('pessoas.ficha.admissao')"
            editavel
            data-testid="correcao-admissao"
          />
          <SanteCampoTexto
            v-model="cMotivo"
            :rotulo="t('pessoas.motivo')"
            :max-bytes="400"
            multilinha
            obrigatorio
            data-testid="correcao-motivo"
          />
          <p class="secundario">{{ t('pessoas.motivoAjuda') }}</p>
          <ErroPessoas v-if="cErro" :erro="cErro" />
          <div class="acoes">
            <SanteBotao :rotulo="t('pessoas.cancelar')" variante="texto" @acionar="corrigindo = false" />
            <SanteBotao
              :rotulo="t('pessoas.gravar')"
              tipo="submit"
              :desabilitado="!cEntrada?.success"
              data-testid="correcao-gravar"
            />
          </div>
        </form>
      </SanteDialogo>

      <SanteDialogo v-model:visivel="alterando" :titulo="t('pessoas.dependentes.alterarTitulo')">
        <form class="bloco" data-testid="form-alterar-dependente" @submit.prevent="gravarAlteracao">
          <p class="secundario">{{ t('pessoas.dependentes.alterarAjuda') }}</p>
          <SanteData
            v-model="aDesde"
            :rotulo="t('pessoas.dependentes.aPartirDe')"
            editavel
            data-testid="alterar-dependente-desde"
          />
          <SanteCampoTexto
            v-model="aNome"
            :rotulo="t('pessoas.dependentes.nome')"
            :max-bytes="70"
            obrigatorio
            data-testid="alterar-dependente-nome"
          />
          <SanteData
            v-model="aNascimento"
            :rotulo="t('pessoas.dependentes.nascimento')"
            editavel
            data-testid="alterar-dependente-nascimento"
          />
          <SanteSelecao
            v-model="aParentesco"
            :rotulo="t('pessoas.dependentes.parentesco')"
            :opcoes="opcoesParentesco"
            obrigatorio
            data-testid="alterar-dependente-parentesco"
          />
          <SanteCampoTexto
            v-if="!aRetirarCpf"
            v-model="aCpf"
            :rotulo="t('pessoas.dependentes.novoCpf')"
            :max-bytes="14"
            data-testid="alterar-dependente-cpf"
          />
          <label v-if="depAlterado?.cpfMascarado" class="marca"
            ><input v-model="aRetirarCpf" type="checkbox" data-testid="alterar-dependente-retirar-cpf" />
            {{ t('pessoas.dependentes.retirarCpf') }}</label
          >
          <label class="marca"
            ><input v-model="aIr" type="checkbox" data-testid="alterar-dependente-ir" />
            {{ t('pessoas.dependentes.ir') }}</label
          >
          <label class="marca"
            ><input v-model="aSf" type="checkbox" data-testid="alterar-dependente-sf" />
            {{ t('pessoas.dependentes.salarioFamilia') }}</label
          >
          <SanteCampoTexto
            v-model="aMotivo"
            :rotulo="t('pessoas.motivo')"
            :max-bytes="180"
            multilinha
            obrigatorio
            data-testid="alterar-dependente-motivo"
          />
          <p class="secundario">{{ t('pessoas.motivoAjuda') }}</p>
          <ErroPessoas v-if="aErro" :erro="aErro" />
          <div class="acoes">
            <SanteBotao :rotulo="t('pessoas.cancelar')" variante="texto" @acionar="alterandoId = null" />
            <SanteBotao
              :rotulo="t('pessoas.gravar')"
              tipo="submit"
              :desabilitado="!aEntrada?.success"
              data-testid="alterar-dependente-gravar"
            />
          </div>
        </form>
      </SanteDialogo>

      <SanteDialogo v-model:visivel="mudando" :titulo="t('pessoas.ficha.mudanca.titulo')">
        <form class="bloco" data-testid="form-mudanca" @submit.prevent="gravarMudanca">
          <p class="secundario">{{ t('pessoas.ficha.mudanca.ajuda') }}</p>
          <SanteData
            v-model="mVigencia"
            :rotulo="t('pessoas.ficha.mudanca.vigencia')"
            editavel
            data-testid="mudanca-vigencia"
          />
          <SanteCampoTexto
            v-model="mCargo"
            :rotulo="t('pessoas.ficha.cargo')"
            :max-bytes="60"
            data-testid="mudanca-cargo"
          />
          <SanteCampoTexto v-model="mFuncao" :rotulo="t('pessoas.ficha.funcao')" :max-bytes="60" />
          <SanteCampoTexto v-model="mCarga" :rotulo="t('pessoas.admissao.carga')" :max-bytes="2" />
          <SanteSelecao
            v-model="mCentro"
            :rotulo="t('pessoas.admissao.centroCusto')"
            :opcoes="opcoesCentro"
            busca
          />
          <SanteCampoTexto
            v-model="mMotivo"
            :rotulo="t('pessoas.motivo')"
            :max-bytes="400"
            multilinha
            obrigatorio
            data-testid="mudanca-motivo"
          />
          <p class="secundario">{{ t('pessoas.motivoAjuda') }}</p>
          <ErroPessoas v-if="mErro" :erro="mErro" />
          <div class="acoes">
            <SanteBotao :rotulo="t('pessoas.cancelar')" variante="texto" @acionar="mudando = false" />
            <SanteBotao
              :rotulo="t('pessoas.gravar')"
              tipo="submit"
              :desabilitado="!mEntrada?.success"
              data-testid="mudanca-gravar"
            />
          </div>
        </form>
      </SanteDialogo>

      <SanteDialogo v-model:visivel="incluindo" :titulo="t('pessoas.dependentes.incluir')">
        <form class="bloco" data-testid="form-dependente" @submit.prevent="gravarDependente">
          <SanteCampoTexto
            v-model="dNome"
            :rotulo="t('pessoas.dependentes.nome')"
            :max-bytes="70"
            obrigatorio
            data-testid="dependente-nome"
          />
          <SanteData
            v-model="dNascimento"
            :rotulo="t('pessoas.dependentes.nascimento')"
            editavel
            data-testid="dependente-nascimento"
          />
          <SanteSelecao
            v-model="dParentesco"
            :rotulo="t('pessoas.dependentes.parentesco')"
            :opcoes="opcoesParentesco"
            obrigatorio
            data-testid="dependente-parentesco"
          />
          <SanteCampoTexto
            v-model="dCpf"
            :rotulo="t('pessoas.dependentes.cpf')"
            :max-bytes="14"
            data-testid="dependente-cpf"
          />
          <label class="marca"
            ><input v-model="dIr" type="checkbox" data-testid="dependente-ir" />
            {{ t('pessoas.dependentes.ir') }}</label
          >
          <label class="marca"
            ><input v-model="dSf" type="checkbox" /> {{ t('pessoas.dependentes.salarioFamilia') }}</label
          >
          <ErroPessoas v-if="dErro" :erro="dErro" />
          <div class="acoes">
            <SanteBotao :rotulo="t('pessoas.cancelar')" variante="texto" @acionar="incluindo = false" />
            <SanteBotao
              :rotulo="t('pessoas.gravar')"
              tipo="submit"
              :desabilitado="!dEntrada.success"
              data-testid="dependente-gravar"
            />
          </div>
        </form>
      </SanteDialogo>

      <SanteDialogo v-model:visivel="encerrando" :titulo="t('pessoas.dependentes.encerrarTitulo')">
        <form class="bloco" data-testid="form-encerrar-dependente" @submit.prevent="gravarEncerramento">
          <p>
            <strong>{{ encerrandoNome }}</strong>
          </p>
          <p class="secundario">{{ t('pessoas.dependentes.encerrarAjuda') }}</p>
          <SanteData
            v-model="eAte"
            :rotulo="t('pessoas.dependentes.ate')"
            editavel
            data-testid="encerrar-dependente-ate"
          />
          <SanteCampoTexto
            v-model="eMotivo"
            :rotulo="t('pessoas.motivo')"
            :max-bytes="200"
            data-testid="encerrar-dependente-motivo"
          />
          <p class="secundario">{{ t('pessoas.motivoAjuda') }}</p>
          <ErroPessoas v-if="eErro" :erro="eErro" />
          <div class="acoes">
            <SanteBotao :rotulo="t('pessoas.cancelar')" variante="texto" @acionar="encerrandoId = null" />
            <SanteBotao
              :rotulo="t('pessoas.dependentes.encerrar')"
              tipo="submit"
              :desabilitado="!eEntrada.success"
              data-testid="encerrar-dependente-gravar"
            />
          </div>
        </form>
      </SanteDialogo>

      <SanteDialogo v-model:visivel="validando" :titulo="t('pessoas.conselho.registrar')">
        <form class="bloco" data-testid="form-validade" @submit.prevent="gravarValidade">
          <SanteData
            v-model="hValidade"
            :rotulo="t('pessoas.conselho.validade')"
            editavel
            data-testid="validade-data"
          />
          <SanteData
            v-model="hConferido"
            :rotulo="t('pessoas.conselho.conferidoEm')"
            editavel
            data-testid="validade-conferido"
          />
          <SanteCampoTexto v-model="hObs" :rotulo="t('pessoas.conselho.observacao')" :max-bytes="200" />
          <ErroPessoas v-if="hErro" :erro="hErro" />
          <div class="acoes">
            <SanteBotao :rotulo="t('pessoas.cancelar')" variante="texto" @acionar="registroAberto = null" />
            <SanteBotao
              :rotulo="t('pessoas.gravar')"
              tipo="submit"
              :desabilitado="!hEntrada.success"
              data-testid="validade-gravar"
            />
          </div>
        </form>
      </SanteDialogo>

      <DialogoDesligamento
        v-if="a && desligando"
        v-model:visivel="desligando"
        :vinculo="f.vinculo"
        :hoje="a.hoje"
        :tipos-rescisao="a.tiposRescisao"
        @desligado="cliente.invalidateQueries({ queryKey: ['pessoas'] })"
      />
    </template>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
