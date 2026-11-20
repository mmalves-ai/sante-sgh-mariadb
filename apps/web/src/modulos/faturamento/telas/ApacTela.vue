<script setup lang="ts">
// APAC (M51, etapa 3; ficha, seções 5, 7, 8 e 12) — `Faturamento > Faturamento SUS > APAC (laudos e autorizações)`:
//   - as APACs do estabelecimento (filtro por situação, número e prontuário; paginação no servidor; o paciente pelo
//     prontuário, nunca pelo documento) com as ações do ciclo: autorizar (número de 13 dígitos e validade de até três
//     competências), negar, continuar na competência seguinte, encerrar (motivo de saída) e cancelar;
//   - o novo laudo (o atendimento ambulatorial do SUS conferido no servidor, o procedimento principal, os CID, o médico
//     solicitante do cadastro SUS, a justificativa e o laudo de nefrologia com os domínios do faturamento SUS);
//   - por competência: o resumo da crítica (que roda na tela de críticas), "Gerar arquivo APAC" com o hash, os arquivos,
//     o download (auditado) e os procedimentos de cada arquivo, sem dado pessoal;
//   - os domínios do laudo de nefrologia em consulta.
// Construída e DESLIGADA por estabelecimento (DP-35): sem a chave, a tela diz o pré-requisito. Exportação só em arquivo.
import {
  type ApacLida,
  type ArquivoSusLido,
  type AtendimentoLaudoApac,
  type CompetenciaSusResumo,
  esquemaCompetenciaSus,
  type LaudoEspecificoApac,
  MOTIVOS_ENCERRAMENTO_APAC,
  MOTIVOS_SAIDA_APAC,
  type MotivoSaidaApac,
  type RegistrarApacEntrada,
  type SituacaoApac,
  SITUACOES_APAC,
  type SolicitanteApac,
  type TipoApac,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import PaginacaoCadastro from '../../cadastro/componentes/PaginacaoCadastro.vue';
import { carimboBr } from '../../cadastro/formato.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import {
  buscarSolicitantesApac,
  enderecoArquivoApac,
  gerarApac,
  lerApacs,
  lerArquivosSus,
  lerAtendimentoLaudoApac,
  lerCompetenciasSus,
  lerDominiosApac,
  lerLinhasApac,
  registrarApac,
} from '../api-sus.js';

const { t } = useI18n();
const cliente = useQueryClient();
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

const lista = useQuery({
  queryKey: ['sus', 'competencias', 'apac'],
  queryFn: () => lerCompetenciasSus('apac'),
});
const dados = computed(() => lista.data.value);
const liberado = computed(
  () => dados.value?.instrumentos.find((x) => x.instrumento === 'apac')?.liberado ?? false,
);
const podeRegistrar = computed(() => pode('faturamento.susApac.registrar'));

// ── A lista das APACs ──────────────────────────────────────────────────────────────────────────────
const POR_PAGINA = 50;
const situacao = ref<'' | SituacaoApac>('');
const termoNumero = ref('');
const termoProntuario = ref('');
const filtro = ref<{ numero: string; prontuario: string }>({ numero: '', prontuario: '' });
const pagina = ref(1);
watch([situacao, filtro], () => (pagina.value = 1));
const opcoesSituacao = computed(() => [
  { valor: '' as const, rotulo: t('faturamentoSus.apac.todas') },
  ...SITUACOES_APAC.map((x) => ({ valor: x, rotulo: t(`faturamentoSus.apac.situacoes.${x}`) })),
]);
const apacs = useQuery({
  queryKey: computed(() => ['sus', 'apac', situacao.value, filtro.value, pagina.value]),
  queryFn: () =>
    lerApacs({
      ...(situacao.value ? { situacao: situacao.value } : {}),
      ...(filtro.value.numero ? { numero: filtro.value.numero } : {}),
      ...(filtro.value.prontuario ? { prontuario: Number(filtro.value.prontuario) } : {}),
      pagina: pagina.value - 1,
      porPagina: POR_PAGINA,
    }),
  enabled: liberado,
});
const filtroValido = computed(
  () =>
    (termoNumero.value.trim() === '' || /^\d{1,13}$/.test(termoNumero.value.trim())) &&
    (termoProntuario.value.trim() === '' || /^\d{1,9}$/.test(termoProntuario.value.trim())),
);
function filtrar(): void {
  if (filtroValido.value)
    filtro.value = { numero: termoNumero.value.trim(), prontuario: termoProntuario.value.trim() };
}
const validade = (a: ApacLida) =>
  a.competenciaInicial
    ? t('faturamentoSus.apac.validade', {
        inicio: a.competenciaInicial,
        fim: a.competenciaFinal,
        ultima: a.ultimaCompetencia,
      })
    : t('faturamentoSus.apac.semValidade');

async function executar(e: RegistrarApacEntrada, ok: string): Promise<ApacLida | null> {
  mensagem.value = null;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await registrarApac(e);
    mensagem.value = ok;
    await cliente.invalidateQueries({ queryKey: ['sus'] });
    return r;
  } catch (x) {
    erro.value = x;
    return null;
  } finally {
    ocupado.value = false;
  }
}

// ── O detalhe de uma APAC ─────────────────────────────────────────────────────────────────────────
const aberta = ref<ApacLida | null>(null);
watch(
  () => apacs.data.value,
  (p) => {
    // Depois de uma ação, o detalhe mostra a versão relida da mesma APAC.
    const a = aberta.value;
    if (a && p) aberta.value = p.itens.find((x) => x.id === a.id) ?? a;
  },
);
function abrirDetalhe(a: ApacLida): void {
  aberta.value = a;
}
const nomeDominio = (
  k: 'caracteristicaTratamento' | 'contraindicacaoTransplante' | 'situacaoTransplante' | 'acessoVascular',
  id: number,
) => {
  const nome = dominios.data.value?.[k].find((x) => x.id === id)?.nome;
  return nome ? `${id} — ${nome}` : String(id);
};
const motivoSaida = (m: string) =>
  m in MOTIVOS_SAIDA_APAC ? `${m} — ${MOTIVOS_SAIDA_APAC[m as MotivoSaidaApac]}` : m;
const cidsDe = (a: ApacLida) => [a.cidPrincipal, a.cidSecundario ?? '—', a.cidAssociado ?? '—'].join(' · ');

// ── A ação sobre uma APAC ─────────────────────────────────────────────────────────────────────────
type Acao = 'autorizar' | 'negar' | 'continuar' | 'encerrar' | 'cancelar';
const escolhida = ref<{ apac: ApacLida; acao: Acao } | null>(null);
const numero = ref('');
const tipo = ref<TipoApac>('inicial');
const autorizador = ref('');
const dataAutorizacao = ref<string | null>(null);
const competenciaInicial = ref('');
const competenciaFinal = ref('');
const motivo = ref<MotivoSaidaApac>('12');
const dataEncerramento = ref<string | null>(null);
const justificativaSituacao = ref('');
const opcoesTipo = computed(() => [
  { valor: 'inicial' as const, rotulo: t('faturamentoSus.apac.tipos.inicial') },
  { valor: 'unica' as const, rotulo: t('faturamentoSus.apac.tipos.unica') },
]);
const opcoesMotivo = computed(() =>
  MOTIVOS_ENCERRAMENTO_APAC.map((m) => ({ valor: m, rotulo: `${m} — ${MOTIVOS_SAIDA_APAC[m]}` })),
);
function abrirAcao(apac: ApacLida, acao: Acao): void {
  escolhida.value = { apac, acao };
  mensagem.value = null;
  erro.value = null;
  numero.value = '';
  autorizador.value = '';
  dataAutorizacao.value = null;
  competenciaInicial.value = apac.dataSolicitacao.slice(0, 7).replace('-', '');
  competenciaFinal.value = competenciaInicial.value;
  dataEncerramento.value = null;
  justificativaSituacao.value = '';
}
const competenciaValida = (c: string) => esquemaCompetenciaSus.safeParse(c.trim()).success;
const acaoValida = computed(() => {
  const e = escolhida.value;
  if (!e) return false;
  if (e.acao === 'autorizar')
    return (
      /^\d{13}$/.test(numero.value.trim()) &&
      /^\d{15}$/.test(autorizador.value.trim()) &&
      dataAutorizacao.value !== null &&
      competenciaValida(competenciaInicial.value) &&
      competenciaValida(competenciaFinal.value)
    );
  if (e.acao === 'encerrar') return dataEncerramento.value !== null;
  if (e.acao === 'negar' || e.acao === 'cancelar') return justificativaSituacao.value.trim().length >= 10;
  return true;
});
async function confirmarAcao(): Promise<void> {
  const e = escolhida.value;
  if (!e || !acaoValida.value) return;
  const base = { apac: e.apac.id, versao: e.apac.versao };
  let entrada: RegistrarApacEntrada;
  switch (e.acao) {
    case 'autorizar':
      entrada = {
        acao: 'autorizar',
        ...base,
        numero: numero.value.trim(),
        tipo: tipo.value,
        autorizador: autorizador.value.trim(),
        dataAutorizacao: dataAutorizacao.value as string,
        competenciaInicial: competenciaInicial.value.trim(),
        competenciaFinal: competenciaFinal.value.trim(),
      };
      break;
    case 'encerrar':
      entrada = {
        acao: 'encerrar',
        ...base,
        motivo: motivo.value,
        dataEncerramento: dataEncerramento.value as string,
      };
      break;
    case 'negar':
    case 'cancelar':
      entrada = { acao: e.acao, ...base, justificativa: justificativaSituacao.value.trim() };
      break;
    case 'continuar':
      entrada = { acao: 'continuar', ...base };
      break;
  }
  if (await executar(entrada, t('faturamentoSus.apac.registrada'))) escolhida.value = null;
}

// ── O novo laudo ───────────────────────────────────────────────────────────────────────────────────
const laudoAberto = ref(false);
/** A APAC solicitada cujo laudo está sendo corrigido (null: novo laudo). */
const corrigindo = ref<ApacLida | null>(null);
const registro = ref('');
const atendimento = ref<AtendimentoLaudoApac | null>(null);
const procedimento = ref('');
const cidPrincipal = ref('');
const cidSecundario = ref('');
const cidAssociado = ref('');
const termoSolicitante = ref('');
const solicitantes = ref<SolicitanteApac[] | null>(null);
const solicitante = ref('');
const dataSolicitacao = ref<string | null>(null);
const justificativa = ref('');
const laudoEspecifico = ref<LaudoEspecificoApac>('nenhum');
const caracteristicaTratamento = ref<number | null>(null);
const contraindicacaoTransplante = ref<number | null>(null);
const situacaoTransplante = ref<number | null>(null);
const acessoVascular = ref<number | null>(null);
const inicioTratamento = ref<string | null>(null);
const dominios = useQuery({
  queryKey: ['sus', 'apac-dominios'],
  queryFn: () => lerDominiosApac(),
  enabled: liberado,
});
const opcoesDominio = (
  k: 'caracteristicaTratamento' | 'contraindicacaoTransplante' | 'situacaoTransplante' | 'acessoVascular',
) =>
  computed(() => [
    { valor: null, rotulo: t('faturamentoSus.apac.escolha') },
    ...(dominios.data.value?.[k] ?? []).map((x) => ({
      valor: x.id as number | null,
      rotulo: `${x.id} — ${x.nome}`,
    })),
  ]);
const opcoesCaracteristica = opcoesDominio('caracteristicaTratamento');
const opcoesContraindicacao = opcoesDominio('contraindicacaoTransplante');
const opcoesSituacaoTransplante = opcoesDominio('situacaoTransplante');
const opcoesAcesso = opcoesDominio('acessoVascular');
const opcoesLaudo = computed(() => [
  { valor: 'nenhum' as const, rotulo: t('faturamentoSus.apac.laudos.nenhum') },
  { valor: 'nefrologia' as const, rotulo: t('faturamentoSus.apac.laudos.nefrologia') },
]);
const opcoesSolicitante = computed(() => [
  { valor: '', rotulo: t('faturamentoSus.apac.escolha') },
  ...(solicitantes.value ?? []).map((x) => ({
    valor: x.chave,
    rotulo: `${x.nome}${x.crm ? ` · ${t('faturamentoSus.apac.crm', { crm: x.crm })}` : ''}${x.cnsValido ? '' : ` ${t('faturamentoSus.apac.solicitanteSemCns')}`}`,
  })),
]);
const FORMA_CID = /^[A-Za-z]\d{2}\.?[0-9Xx]?$/;
const cidOk = (c: string, obrigatorio: boolean) =>
  c.trim() === '' ? !obrigatorio : FORMA_CID.test(c.trim());
const exigeNefrologia = computed(() => procedimento.value.trim().startsWith('0305'));
const laudoValido = computed(
  () =>
    (corrigindo.value !== null ||
      (atendimento.value !== null &&
        atendimento.value.contaSus &&
        /^\d{10}$/.test(procedimento.value.trim()))) &&
    cidOk(cidPrincipal.value, true) &&
    cidOk(cidSecundario.value, false) &&
    cidOk(cidAssociado.value, false) &&
    solicitante.value !== '' &&
    dataSolicitacao.value !== null &&
    justificativa.value.trim().length >= 10 &&
    (!exigeNefrologia.value || laudoEspecifico.value === 'nefrologia') &&
    (laudoEspecifico.value === 'nenhum' ||
      (caracteristicaTratamento.value !== null &&
        contraindicacaoTransplante.value !== null &&
        situacaoTransplante.value !== null &&
        acessoVascular.value !== null &&
        inicioTratamento.value !== null)),
);
async function conferirAtendimento(): Promise<void> {
  atendimento.value = null;
  erro.value = null;
  if (!/^\d{1,9}$/.test(registro.value.trim())) return;
  try {
    atendimento.value = await lerAtendimentoLaudoApac(Number(registro.value.trim()));
    if (atendimento.value.cidPrincipal && !cidPrincipal.value)
      cidPrincipal.value = atendimento.value.cidPrincipal;
  } catch (x) {
    erro.value = x;
  }
}
async function buscarSolicitante(): Promise<void> {
  if (termoSolicitante.value.trim().length < 2) return;
  try {
    solicitantes.value = await buscarSolicitantesApac(termoSolicitante.value.trim());
    if (solicitantes.value.length === 1) solicitante.value = solicitantes.value[0]?.chave ?? '';
  } catch (x) {
    erro.value = x;
  }
}
function limparLaudo(): void {
  registro.value = '';
  atendimento.value = null;
  procedimento.value = '';
  cidPrincipal.value = '';
  cidSecundario.value = '';
  cidAssociado.value = '';
  termoSolicitante.value = '';
  solicitantes.value = null;
  solicitante.value = '';
  dataSolicitacao.value = null;
  justificativa.value = '';
  laudoEspecifico.value = 'nenhum';
  caracteristicaTratamento.value = null;
  contraindicacaoTransplante.value = null;
  situacaoTransplante.value = null;
  acessoVascular.value = null;
  inicioTratamento.value = null;
}
function novoLaudo(): void {
  if (corrigindo.value) limparLaudo();
  corrigindo.value = null;
  laudoAberto.value = true;
}
/** A correção do laudo da solicitada: o formulário do laudo com o que foi transcrito (D-CORRIGIR-513). */
function abrirCorrecao(a: ApacLida): void {
  limparLaudo();
  escolhida.value = null;
  corrigindo.value = a;
  mensagem.value = null;
  erro.value = null;
  registro.value = String(a.registro);
  procedimento.value = a.procedimento;
  cidPrincipal.value = a.cidPrincipal;
  cidSecundario.value = a.cidSecundario ?? '';
  cidAssociado.value = a.cidAssociado ?? '';
  solicitantes.value = [
    { chave: a.solicitante, nome: a.solicitanteNome ?? '—', crm: a.solicitanteCrm, cnsValido: true },
  ];
  solicitante.value = a.solicitante;
  dataSolicitacao.value = a.dataSolicitacao;
  justificativa.value = a.justificativa;
  laudoEspecifico.value = a.laudoEspecifico;
  caracteristicaTratamento.value = a.nefrologia?.caracteristicaTratamento ?? null;
  contraindicacaoTransplante.value = a.nefrologia?.contraindicacaoTransplante ?? null;
  situacaoTransplante.value = a.nefrologia?.situacaoTransplante ?? null;
  acessoVascular.value = a.nefrologia?.acessoVascular ?? null;
  inicioTratamento.value = a.nefrologia?.inicioTratamento ?? null;
  laudoAberto.value = true;
}
function fecharLaudo(): void {
  laudoAberto.value = false;
  if (corrigindo.value) limparLaudo();
  corrigindo.value = null;
}
async function registrarLaudo(): Promise<void> {
  if (!laudoValido.value) return;
  const nefro =
    laudoEspecifico.value === 'nefrologia'
      ? {
          caracteristicaTratamento: caracteristicaTratamento.value as number,
          contraindicacaoTransplante: contraindicacaoTransplante.value as number,
          situacaoTransplante: situacaoTransplante.value as number,
          acessoVascular: acessoVascular.value as number,
          inicioTratamento: inicioTratamento.value as string,
        }
      : null;
  const transcrito = {
    cidPrincipal: cidPrincipal.value.trim(),
    cidSecundario: cidSecundario.value.trim() || null,
    cidAssociado: cidAssociado.value.trim() || null,
    solicitante: solicitante.value,
    dataSolicitacao: dataSolicitacao.value as string,
    justificativa: justificativa.value.trim(),
    laudoEspecifico: laudoEspecifico.value,
    nefrologia: nefro,
  };
  const c = corrigindo.value;
  if (c) {
    const r = await executar(
      { acao: 'corrigir', apac: c.id, versao: c.versao, laudo: transcrito },
      t('faturamentoSus.apac.laudoCorrigido'),
    );
    if (r) {
      aberta.value = r;
      fecharLaudo();
    }
    return;
  }
  if (!atendimento.value) return;
  const r = await executar(
    {
      acao: 'laudo',
      laudo: {
        registro: atendimento.value.registro,
        procedimento: procedimento.value.trim(),
        cidPrincipal: cidPrincipal.value.trim(),
        cidSecundario: cidSecundario.value.trim() || null,
        cidAssociado: cidAssociado.value.trim() || null,
        solicitante: solicitante.value,
        dataSolicitacao: dataSolicitacao.value as string,
        justificativa: justificativa.value.trim(),
        laudoEspecifico: laudoEspecifico.value,
        nefrologia: nefro,
      },
    },
    t('faturamentoSus.apac.laudoRegistrado'),
  );
  if (r) {
    laudoAberto.value = false;
    aberta.value = r;
  }
}

// ── A competência e o arquivo APAC-Mag ─────────────────────────────────────────────────────────────
const competencia = ref('');
const competencias = computed(() => dados.value?.competencias ?? []);
watch(competencias, (cs) => {
  if (!competencia.value && cs[0]) competencia.value = cs[0].competencia;
});
const atual = computed<CompetenciaSusResumo | null>(
  () => competencias.value.find((c) => c.competencia === competencia.value) ?? null,
);
const opcoesCompetencia = computed(() =>
  competencias.value.map((c) => ({
    valor: c.competencia,
    rotulo: `${c.competencia} — ${t(`faturamentoSus.situacoesCompetencia.${c.situacao}`)}`,
  })),
);
const arquivos = useQuery({
  queryKey: computed(() => ['sus', 'arquivos', 'apac', competencia.value]),
  queryFn: () => lerArquivosSus('apac', competencia.value),
  enabled: computed(() => competencia.value !== ''),
});
const pronta = computed(
  () =>
    liberado.value &&
    atual.value !== null &&
    atual.value.situacao === 'aberta' &&
    atual.value.criticadaEm !== null &&
    atual.value.criticasBloqueantes === 0,
);
const arquivoAberto = ref<ArquivoSusLido | null>(null);
async function gerar(): Promise<void> {
  const c = atual.value;
  if (!c) return;
  mensagem.value = null;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await gerarApac({ competencia: c.competencia, versao: c.versao });
    mensagem.value = t('faturamentoSus.apac.gerado', {
      tempo: (r.tempoMs / 1000).toFixed(1),
      registros: r.arquivo.registros,
      linhas: r.arquivo.linhas,
    });
    arquivoAberto.value = r.arquivo;
    await cliente.invalidateQueries({ queryKey: ['sus'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const paginaLinhas = ref(1);
watch(arquivoAberto, () => (paginaLinhas.value = 1));
const linhas = useQuery({
  queryKey: computed(() => ['sus', 'apac-linhas', arquivoAberto.value?.id ?? 0, paginaLinhas.value]),
  queryFn: () =>
    lerLinhasApac({
      arquivo: arquivoAberto.value?.id ?? 0,
      pagina: paginaLinhas.value - 1,
      porPagina: POR_PAGINA,
    }),
  enabled: computed(() => arquivoAberto.value !== null && liberado.value),
});
const situacaoArquivo = (a: ArquivoSusLido) => t(`faturamentoSus.ciha.situacoes.${a.situacao}`);
</script>

<template>
  <section class="tela" aria-labelledby="apac-titulo" data-testid="tela-apac">
    <h1 id="apac-titulo">{{ t('faturamentoSus.apac.titulo') }}</h1>
    <p>{{ t('faturamentoSus.apac.explicacao') }}</p>
    <p class="pequeno">{{ t('faturamentoSus.apac.envio') }}</p>
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!dados">{{ t('faturamentoSus.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!liberado"
        :texto="t('faturamentoSus.apac.desligado')"
        variante="aviso"
        data-testid="apac-desligada"
      />
      <SanteAlerta
        v-if="dados.escopoParcial"
        :texto="t('faturamentoSus.competencias.escopoParcial')"
        variante="info"
      />
      <p v-if="mensagem" role="status" data-testid="mensagem-apac">{{ mensagem }}</p>
      <ErroFaturamento v-if="erro" :erro="erro" />

      <template v-if="liberado">
        <!-- As APACs -->
        <section aria-labelledby="apac-lista-titulo" data-testid="apac-lista">
          <h2 id="apac-lista-titulo">{{ t('faturamentoSus.apac.lista') }}</h2>
          <form class="linha" data-testid="filtro-apac" @submit.prevent="filtrar">
            <SanteSelecao
              v-model="situacao"
              :rotulo="t('faturamentoSus.apac.filtroSituacao')"
              :opcoes="opcoesSituacao"
              data-testid="apac-situacao"
            />
            <SanteCampoTexto
              v-model="termoNumero"
              :rotulo="t('faturamentoSus.apac.filtroNumero')"
              :max-bytes="13"
            />
            <SanteCampoTexto
              v-model="termoProntuario"
              :rotulo="t('faturamentoSus.apac.filtroProntuario')"
              :max-bytes="9"
            />
            <SanteBotao
              :rotulo="t('faturamentoSus.apac.filtrar')"
              tipo="submit"
              variante="secundario"
              :desabilitado="!filtroValido"
              data-testid="botao-filtrar-apac"
            />
            <SanteBotao
              v-if="podeRegistrar"
              :rotulo="t('faturamentoSus.apac.novoLaudo')"
              data-testid="botao-novo-laudo"
              @acionar="novoLaudo"
            />
          </form>
          <p class="pequeno">{{ t('faturamentoSus.apac.laudoPeloMedico') }}</p>
          <MensagemErro v-if="apacs.isError.value" :erro="apacs.error.value" />
          <p v-else-if="!apacs.data.value">{{ t('faturamentoSus.carregando') }}</p>
          <p v-else-if="apacs.data.value.itens.length === 0" data-testid="apac-nenhuma">
            {{ t('faturamentoSus.apac.nenhuma') }}
          </p>
          <template v-else>
            <p class="pequeno">{{ t('faturamentoSus.apac.total', { n: apacs.data.value.total }) }}</p>
            <table data-testid="tabela-apac">
              <thead>
                <tr>
                  <th scope="col">{{ t('faturamentoSus.apac.colunaNumero') }}</th>
                  <th scope="col">{{ t('faturamentoSus.apac.colunaProntuario') }}</th>
                  <th scope="col">{{ t('faturamentoSus.apac.colunaProcedimento') }}</th>
                  <th scope="col">{{ t('faturamentoSus.apac.colunaCid') }}</th>
                  <th scope="col">{{ t('faturamentoSus.apac.colunaValidade') }}</th>
                  <th scope="col">{{ t('faturamentoSus.apac.colunaSituacao') }}</th>
                  <th scope="col">{{ t('faturamentoSus.apac.colunaAcoes') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="a in apacs.data.value.itens" :key="a.id" :data-testid="`apac-${a.id}`">
                  <td>{{ a.numero ?? t('faturamentoSus.apac.semNumero') }}</td>
                  <td>{{ a.prontuario ?? '—' }}</td>
                  <td>
                    {{ a.procedimento }}
                    <span class="pequeno">{{ a.procedimentoNome ?? '' }}</span>
                    <span class="pequeno">{{
                      t('faturamentoSus.apac.laudoDe', {
                        data: a.dataSolicitacao,
                        solicitante: a.solicitanteNome ?? '—',
                      })
                    }}</span>
                  </td>
                  <td>{{ a.cidPrincipal }}</td>
                  <td class="pequeno">{{ validade(a) }}</td>
                  <td>
                    {{ t(`faturamentoSus.apac.situacoes.${a.situacao}`) }}
                    <span v-if="a.tipo" class="pequeno">{{ t(`faturamentoSus.apac.tipos.${a.tipo}`) }}</span>
                  </td>
                  <td>
                    <div class="acoes">
                      <SanteBotao
                        :rotulo="t('faturamentoSus.apac.ver')"
                        variante="secundario"
                        :data-testid="`botao-ver-${a.id}`"
                        @acionar="abrirDetalhe(a)"
                      />
                    </div>
                    <div v-if="podeRegistrar" class="acoes">
                      <SanteBotao
                        v-if="a.situacao === 'solicitada'"
                        :rotulo="t('faturamentoSus.apac.corrigirLaudo')"
                        variante="secundario"
                        :data-testid="`botao-corrigir-${a.id}`"
                        @acionar="abrirCorrecao(a)"
                      />
                      <SanteBotao
                        v-if="a.situacao === 'solicitada'"
                        :rotulo="t('faturamentoSus.apac.autorizar')"
                        variante="secundario"
                        :data-testid="`botao-autorizar-${a.id}`"
                        @acionar="abrirAcao(a, 'autorizar')"
                      />
                      <SanteBotao
                        v-if="a.situacao === 'solicitada'"
                        :rotulo="t('faturamentoSus.apac.negar')"
                        variante="secundario"
                        :data-testid="`botao-negar-${a.id}`"
                        @acionar="abrirAcao(a, 'negar')"
                      />
                      <SanteBotao
                        v-if="
                          a.situacao === 'autorizada' &&
                          a.tipo === 'inicial' &&
                          a.ultimaCompetencia !== a.competenciaFinal
                        "
                        :rotulo="t('faturamentoSus.apac.continuar')"
                        variante="secundario"
                        :data-testid="`botao-continuar-${a.id}`"
                        @acionar="abrirAcao(a, 'continuar')"
                      />
                      <SanteBotao
                        v-if="a.situacao === 'autorizada'"
                        :rotulo="t('faturamentoSus.apac.encerrar')"
                        variante="secundario"
                        :data-testid="`botao-encerrar-${a.id}`"
                        @acionar="abrirAcao(a, 'encerrar')"
                      />
                      <SanteBotao
                        v-if="a.situacao === 'solicitada' || a.situacao === 'autorizada'"
                        :rotulo="t('faturamentoSus.apac.cancelarApac')"
                        variante="secundario"
                        :data-testid="`botao-cancelar-${a.id}`"
                        @acionar="abrirAcao(a, 'cancelar')"
                      />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <PaginacaoCadastro
              v-model="pagina"
              :total="apacs.data.value.total"
              :por-pagina="POR_PAGINA"
              :rotulo="t('faturamentoSus.apac.lista')"
            />
          </template>
        </section>

        <!-- O detalhe da APAC -->
        <section v-if="aberta" aria-labelledby="apac-detalhe-titulo" data-testid="apac-detalhe">
          <h2 id="apac-detalhe-titulo">
            {{
              t('faturamentoSus.apac.detalheTitulo', {
                numero: aberta.numero ?? t('faturamentoSus.apac.semNumero'),
              })
            }}
          </h2>
          <dl class="resumo">
            <dt>{{ t('faturamentoSus.apac.detalheSituacao') }}</dt>
            <dd data-testid="apac-detalhe-situacao">
              {{ t(`faturamentoSus.apac.situacoes.${aberta.situacao}`) }}
            </dd>
            <dt>{{ t('faturamentoSus.apac.detalheAtendimento') }}</dt>
            <dd>{{ aberta.registro }}</dd>
            <dt>{{ t('faturamentoSus.apac.detalheProntuario') }}</dt>
            <dd>{{ aberta.prontuario ?? '—' }}</dd>
            <dt>{{ t('faturamentoSus.apac.detalheProcedimento') }}</dt>
            <dd>{{ aberta.procedimento }} {{ aberta.procedimentoNome ?? '' }}</dd>
            <dt>{{ t('faturamentoSus.apac.detalheCids') }}</dt>
            <dd data-testid="apac-detalhe-cids">{{ cidsDe(aberta) }}</dd>
            <dt>{{ t('faturamentoSus.apac.detalheSolicitante') }}</dt>
            <dd>
              {{ aberta.solicitanteNome ?? '—' }}
              <template v-if="aberta.solicitanteCrm">
                · {{ t('faturamentoSus.apac.crm', { crm: aberta.solicitanteCrm }) }}
              </template>
            </dd>
            <dt>{{ t('faturamentoSus.apac.detalheDataLaudo') }}</dt>
            <dd>{{ aberta.dataSolicitacao }}</dd>
            <dt>{{ t('faturamentoSus.apac.detalheJustificativa') }}</dt>
            <dd class="texto" data-testid="apac-detalhe-justificativa">{{ aberta.justificativa }}</dd>
            <dt>{{ t('faturamentoSus.apac.detalheLaudoEspecifico') }}</dt>
            <dd>{{ t(`faturamentoSus.apac.laudos.${aberta.laudoEspecifico}`) }}</dd>
            <template v-if="aberta.nefrologia">
              <dt>{{ t('faturamentoSus.apac.caracteristicaTratamento') }}</dt>
              <dd data-testid="apac-detalhe-nefrologia">
                {{ nomeDominio('caracteristicaTratamento', aberta.nefrologia.caracteristicaTratamento) }}
              </dd>
              <dt>{{ t('faturamentoSus.apac.contraindicacaoTransplante') }}</dt>
              <dd>
                {{ nomeDominio('contraindicacaoTransplante', aberta.nefrologia.contraindicacaoTransplante) }}
              </dd>
              <dt>{{ t('faturamentoSus.apac.situacaoTransplante') }}</dt>
              <dd>{{ nomeDominio('situacaoTransplante', aberta.nefrologia.situacaoTransplante) }}</dd>
              <dt>{{ t('faturamentoSus.apac.acessoVascular') }}</dt>
              <dd>{{ nomeDominio('acessoVascular', aberta.nefrologia.acessoVascular) }}</dd>
              <dt>{{ t('faturamentoSus.apac.inicioTratamento') }}</dt>
              <dd>{{ aberta.nefrologia.inicioTratamento }}</dd>
            </template>
            <template v-if="aberta.tipo">
              <dt>{{ t('faturamentoSus.apac.detalheAutorizacao') }}</dt>
              <dd>
                {{
                  t('faturamentoSus.apac.detalheAutorizacaoTexto', {
                    tipo: t(`faturamentoSus.apac.tipos.${aberta.tipo}`),
                    data: aberta.dataAutorizacao ?? '—',
                  })
                }}
              </dd>
            </template>
            <dt>{{ t('faturamentoSus.apac.detalheValidade') }}</dt>
            <dd>{{ validade(aberta) }}</dd>
            <template v-if="aberta.justificativaSituacao">
              <dt>{{ t('faturamentoSus.apac.detalheJustificativaSituacao') }}</dt>
              <dd class="texto" data-testid="apac-detalhe-justificativa-situacao">
                {{ aberta.justificativaSituacao }}
              </dd>
            </template>
            <template v-if="aberta.motivoSaida">
              <dt>{{ t('faturamentoSus.apac.detalheSaida') }}</dt>
              <dd data-testid="apac-detalhe-saida">
                {{
                  t('faturamentoSus.apac.detalheSaidaTexto', {
                    motivo: motivoSaida(aberta.motivoSaida),
                    data: aberta.dataEncerramento ?? '—',
                  })
                }}
              </dd>
            </template>
            <dt>{{ t('faturamentoSus.apac.detalheRegistrada') }}</dt>
            <dd>
              {{
                t('faturamentoSus.apac.carimbo', {
                  por: aberta.registradaPor,
                  em: carimboBr(aberta.registradaEm),
                })
              }}
            </dd>
            <template v-if="aberta.alteradaPor && aberta.alteradaEm">
              <dt>{{ t('faturamentoSus.apac.detalheAlterada') }}</dt>
              <dd data-testid="apac-detalhe-alterada">
                {{
                  t('faturamentoSus.apac.carimbo', {
                    por: aberta.alteradaPor,
                    em: carimboBr(aberta.alteradaEm),
                  })
                }}
              </dd>
            </template>
          </dl>
          <div class="linha">
            <SanteBotao
              v-if="podeRegistrar && aberta.situacao === 'solicitada'"
              :rotulo="t('faturamentoSus.apac.corrigirLaudo')"
              data-testid="botao-corrigir-detalhe"
              @acionar="abrirCorrecao(aberta)"
            />
            <SanteBotao
              :rotulo="t('faturamentoSus.apac.fecharDetalhe')"
              variante="secundario"
              data-testid="botao-fechar-detalhe"
              @acionar="aberta = null"
            />
          </div>
        </section>

        <!-- A ação escolhida -->
        <section v-if="escolhida" aria-labelledby="apac-acao-titulo" data-testid="apac-acao">
          <h2 id="apac-acao-titulo">
            {{ t(`faturamentoSus.apac.${escolhida.acao === 'cancelar' ? 'cancelarApac' : escolhida.acao}`) }}
            —
            {{
              t('faturamentoSus.apac.detalhe', {
                numero: escolhida.apac.numero ?? t('faturamentoSus.apac.semNumero'),
              })
            }}
          </h2>
          <form class="grade" data-testid="form-acao-apac" @submit.prevent="confirmarAcao">
            <template v-if="escolhida.acao === 'autorizar'">
              <SanteCampoTexto v-model="numero" :rotulo="t('faturamentoSus.apac.numero')" :max-bytes="13" />
              <SanteSelecao v-model="tipo" :rotulo="t('faturamentoSus.apac.tipo')" :opcoes="opcoesTipo" />
              <SanteCampoTexto
                v-model="autorizador"
                :rotulo="t('faturamentoSus.apac.autorizador')"
                :max-bytes="15"
              />
              <SanteData
                v-model="dataAutorizacao"
                :rotulo="t('faturamentoSus.apac.dataAutorizacao')"
                editavel
              />
              <SanteCampoTexto
                v-model="competenciaInicial"
                :rotulo="t('faturamentoSus.apac.competenciaInicial')"
                :max-bytes="6"
              />
              <SanteCampoTexto
                v-model="competenciaFinal"
                :rotulo="t('faturamentoSus.apac.competenciaFinal')"
                :max-bytes="6"
              />
            </template>
            <template v-else-if="escolhida.acao === 'encerrar'">
              <SanteSelecao
                v-model="motivo"
                :rotulo="t('faturamentoSus.apac.motivo')"
                :opcoes="opcoesMotivo"
              />
              <SanteData
                v-model="dataEncerramento"
                :rotulo="t('faturamentoSus.apac.dataEncerramento')"
                editavel
              />
            </template>
            <template v-else-if="escolhida.acao === 'negar' || escolhida.acao === 'cancelar'">
              <SanteCampoTexto
                v-model="justificativaSituacao"
                :rotulo="t('faturamentoSus.apac.justificativaSituacao')"
                :max-bytes="500"
                multilinha
              />
            </template>
            <div class="linha">
              <SanteBotao
                :rotulo="
                  t(
                    escolhida.acao === 'autorizar'
                      ? 'faturamentoSus.apac.confirmarAutorizacao'
                      : escolhida.acao === 'encerrar'
                        ? 'faturamentoSus.apac.confirmarEncerramento'
                        : escolhida.acao === 'negar'
                          ? 'faturamentoSus.apac.confirmarNegativa'
                          : escolhida.acao === 'cancelar'
                            ? 'faturamentoSus.apac.confirmarCancelamento'
                            : 'faturamentoSus.apac.continuar',
                  )
                "
                tipo="submit"
                :desabilitado="ocupado || !acaoValida"
                data-testid="botao-confirmar-acao-apac"
              />
              <SanteBotao
                :rotulo="t('faturamentoSus.apac.cancelar')"
                variante="secundario"
                @acionar="escolhida = null"
              />
            </div>
          </form>
        </section>

        <!-- O novo laudo -->
        <section v-if="laudoAberto" aria-labelledby="apac-laudo-titulo" data-testid="apac-laudo">
          <h2 id="apac-laudo-titulo">
            {{
              corrigindo
                ? t('faturamentoSus.apac.corrigirTitulo', {
                    numero: corrigindo.numero ?? t('faturamentoSus.apac.semNumero'),
                  })
                : t('faturamentoSus.apac.novoLaudo')
            }}
          </h2>
          <form class="grade" data-testid="form-laudo-apac" @submit.prevent="registrarLaudo">
            <template v-if="corrigindo">
              <p class="pequeno">{{ t('faturamentoSus.apac.corrigirExplicacao') }}</p>
              <p data-testid="apac-correcao-fixos">
                {{
                  t('faturamentoSus.apac.corrigirFixos', {
                    registro: corrigindo.registro,
                    procedimento: corrigindo.procedimento,
                  })
                }}
              </p>
            </template>
            <div v-if="!corrigindo" class="linha">
              <SanteCampoTexto
                v-model="registro"
                :rotulo="t('faturamentoSus.apac.atendimento')"
                :max-bytes="9"
              />
              <SanteBotao
                :rotulo="t('faturamentoSus.apac.conferirAtendimento')"
                variante="secundario"
                data-testid="botao-conferir-atendimento"
                @acionar="conferirAtendimento"
              />
            </div>
            <p v-if="!corrigindo" class="pequeno">{{ t('faturamentoSus.apac.atendimentoAjuda') }}</p>
            <template v-if="atendimento && !corrigindo">
              <p data-testid="apac-atendimento">
                {{
                  t('faturamentoSus.apac.atendimentoConferido', {
                    registro: atendimento.registro,
                    data: atendimento.data ?? '—',
                    prontuario: atendimento.prontuario ?? '—',
                  })
                }}
              </p>
              <SanteAlerta
                v-if="!atendimento.contaSus"
                :texto="t('faturamentoSus.apac.atendimentoNaoSus')"
                variante="alerta"
              />
              <SanteAlerta
                v-if="!atendimento.cnsValido"
                :texto="t('faturamentoSus.apac.pacienteSemCns')"
                variante="aviso"
              />
            </template>
            <SanteCampoTexto
              v-if="!corrigindo"
              v-model="procedimento"
              :rotulo="t('faturamentoSus.apac.procedimento')"
              :max-bytes="10"
            />
            <SanteCampoTexto
              v-model="cidPrincipal"
              :rotulo="t('faturamentoSus.apac.cidPrincipal')"
              :max-bytes="5"
            />
            <SanteCampoTexto
              v-model="cidSecundario"
              :rotulo="t('faturamentoSus.apac.cidSecundario')"
              :max-bytes="5"
            />
            <SanteCampoTexto
              v-model="cidAssociado"
              :rotulo="t('faturamentoSus.apac.cidAssociado')"
              :max-bytes="5"
            />
            <div class="linha">
              <SanteCampoTexto
                v-model="termoSolicitante"
                :rotulo="t('faturamentoSus.apac.buscarSolicitante')"
                :max-bytes="60"
              />
              <SanteBotao
                :rotulo="t('faturamentoSus.apac.buscar')"
                variante="secundario"
                data-testid="botao-buscar-solicitante"
                @acionar="buscarSolicitante"
              />
            </div>
            <p v-if="solicitantes && solicitantes.length === 0">
              {{ t('faturamentoSus.apac.nenhumSolicitante') }}
            </p>
            <SanteSelecao
              v-model="solicitante"
              :rotulo="t('faturamentoSus.apac.solicitante')"
              :opcoes="opcoesSolicitante"
              :busca="true"
              data-testid="apac-solicitante"
            />
            <SanteData
              v-model="dataSolicitacao"
              :rotulo="t('faturamentoSus.apac.dataSolicitacao')"
              editavel
            />
            <SanteCampoTexto
              v-model="justificativa"
              :rotulo="t('faturamentoSus.apac.justificativa')"
              :max-bytes="2000"
              multilinha
            />
            <SanteSelecao
              v-model="laudoEspecifico"
              :rotulo="t('faturamentoSus.apac.laudoEspecifico')"
              :opcoes="opcoesLaudo"
              data-testid="apac-laudo-especifico"
            />
            <p v-if="exigeNefrologia" class="pequeno">{{ t('faturamentoSus.apac.nefrologiaExigida') }}</p>
            <template v-if="laudoEspecifico === 'nefrologia'">
              <SanteSelecao
                v-model="caracteristicaTratamento"
                :rotulo="t('faturamentoSus.apac.caracteristicaTratamento')"
                :opcoes="opcoesCaracteristica"
              />
              <SanteSelecao
                v-model="contraindicacaoTransplante"
                :rotulo="t('faturamentoSus.apac.contraindicacaoTransplante')"
                :opcoes="opcoesContraindicacao"
              />
              <SanteSelecao
                v-model="situacaoTransplante"
                :rotulo="t('faturamentoSus.apac.situacaoTransplante')"
                :opcoes="opcoesSituacaoTransplante"
              />
              <SanteSelecao
                v-model="acessoVascular"
                :rotulo="t('faturamentoSus.apac.acessoVascular')"
                :opcoes="opcoesAcesso"
              />
              <SanteData
                v-model="inicioTratamento"
                :rotulo="t('faturamentoSus.apac.inicioTratamento')"
                editavel
              />
            </template>
            <div class="linha">
              <SanteBotao
                :rotulo="
                  corrigindo
                    ? t('faturamentoSus.apac.confirmarCorrecao')
                    : t('faturamentoSus.apac.registrarLaudo')
                "
                tipo="submit"
                :desabilitado="ocupado || !laudoValido"
                data-testid="botao-registrar-laudo"
              />
              <SanteBotao
                :rotulo="t('faturamentoSus.apac.cancelar')"
                variante="secundario"
                @acionar="fecharLaudo"
              />
            </div>
          </form>
        </section>
      </template>

      <!-- A competência e o arquivo -->
      <section aria-labelledby="apac-arquivo-titulo" data-testid="apac-competencia">
        <h2 id="apac-arquivo-titulo">{{ t('faturamentoSus.apac.competencia') }}</h2>
        <p v-if="competencias.length === 0" data-testid="apac-sem-competencia">
          {{ t('faturamentoSus.apac.semCompetencia') }}
          <RouterLink to="/faturamento/sus/competencias?instrumento=apac">
            {{ t('faturamentoSus.apac.irCriticas') }}
          </RouterLink>
        </p>
        <template v-else>
          <div class="barra">
            <SanteSelecao
              v-model="competencia"
              :rotulo="t('faturamentoSus.apac.escolhaCompetencia')"
              :opcoes="opcoesCompetencia"
              data-testid="apac-competencia-escolha"
            />
            <RouterLink :to="`/faturamento/sus/competencias?instrumento=apac&competencia=${competencia}`">
              {{ t('faturamentoSus.apac.irCriticas') }}
            </RouterLink>
          </div>
          <div v-if="atual" data-testid="apac-resumo">
            <h3>{{ t('faturamentoSus.apac.resumo') }}</h3>
            <dl class="resumo">
              <dt>{{ t('faturamentoSus.apac.apresentadas') }}</dt>
              <dd>{{ atual.registros }}</dd>
              <dt>{{ t('faturamentoSus.competencias.bloqueantes') }}</dt>
              <dd>{{ atual.criticasBloqueantes }}</dd>
              <dt>{{ t('faturamentoSus.competencias.avisos') }}</dt>
              <dd>{{ atual.avisos }}</dd>
              <dt>{{ t('faturamentoSus.competencias.criticadaEm') }}</dt>
              <dd>{{ atual.criticadaEm ? carimboBr(atual.criticadaEm) : '—' }}</dd>
            </dl>
            <p v-if="atual.criticadaEm === null">{{ t('faturamentoSus.apac.semCritica') }}</p>
            <p v-else-if="atual.criticasBloqueantes > 0">
              {{ t('faturamentoSus.apac.bloqueada', { n: atual.criticasBloqueantes }) }}
            </p>
            <p v-else-if="atual.situacao === 'aberta' && liberado">{{ t('faturamentoSus.apac.pronta') }}</p>
            <SanteBotao
              v-if="podeRegistrar"
              :rotulo="t('faturamentoSus.apac.gerar')"
              :desabilitado="ocupado || !pronta || dados.escopoParcial"
              data-testid="botao-gerar-apac"
              @acionar="gerar"
            />
          </div>
          <h3>{{ t('faturamentoSus.apac.arquivos') }}</h3>
          <MensagemErro v-if="arquivos.isError.value" :erro="arquivos.error.value" />
          <p v-else-if="(arquivos.data.value ?? []).length === 0" data-testid="apac-sem-arquivo">
            {{ t('faturamentoSus.apac.nenhumArquivo') }}
          </p>
          <table v-else data-testid="tabela-arquivos-apac">
            <thead>
              <tr>
                <th scope="col">{{ t('faturamentoSus.ciha.nome') }}</th>
                <th scope="col">{{ t('faturamentoSus.ciha.geradoPor') }}</th>
                <th scope="col">{{ t('faturamentoSus.apac.apresentadas') }}</th>
                <th scope="col">{{ t('faturamentoSus.ciha.linhas') }}</th>
                <th scope="col">{{ t('faturamentoSus.ciha.hash') }}</th>
                <th scope="col">{{ t('faturamentoSus.ciha.situacao') }}</th>
                <th scope="col">{{ t('faturamentoSus.apac.verLinhas') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in arquivos.data.value" :key="a.id" :data-testid="`arquivo-apac-${a.id}`">
                <td>
                  <a
                    v-if="podeRegistrar && liberado && a.situacao !== 'substituido'"
                    :href="enderecoArquivoApac(a.id)"
                    download
                  >
                    {{ a.nomeArquivo }}
                  </a>
                  <span v-else>{{ a.nomeArquivo }}</span>
                  <span class="pequeno">
                    {{ t('faturamentoSus.ciha.leiaute', { leiaute: a.leiaute, versao: a.versaoLeiaute }) }}
                    · {{ t('faturamentoSus.ciha.tamanho', { bytes: a.bytes }) }}
                  </span>
                </td>
                <td class="pequeno">{{ a.geradoPor }} {{ carimboBr(a.geradoEm) }}</td>
                <td>{{ a.registros }}</td>
                <td>{{ a.linhas }}</td>
                <td>
                  <code class="hash" data-testid="hash-arquivo-apac">{{ a.hash }}</code>
                </td>
                <td>{{ situacaoArquivo(a) }}</td>
                <td>
                  <SanteBotao
                    :rotulo="t('faturamentoSus.apac.verLinhas')"
                    variante="secundario"
                    :desabilitado="!liberado"
                    :data-testid="`botao-linhas-apac-${a.id}`"
                    @acionar="arquivoAberto = a"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <SanteAlerta
            v-if="(arquivos.data.value ?? []).some((a) => !a.conferidoContraOficial)"
            :texto="t('faturamentoSus.apac.leiauteNaoConferido')"
            variante="alerta"
          />
        </template>
      </section>

      <section v-if="arquivoAberto" aria-labelledby="apac-linhas-titulo" data-testid="apac-linhas">
        <h2 id="apac-linhas-titulo">
          {{ t('faturamentoSus.apac.linhasDoArquivo', { nome: arquivoAberto.nomeArquivo }) }}
        </h2>
        <MensagemErro v-if="linhas.isError.value" :erro="linhas.error.value" />
        <p v-else-if="!linhas.data.value">{{ t('faturamentoSus.carregando') }}</p>
        <template v-else>
          <p class="pequeno" data-testid="apac-resumo-linhas">
            {{
              t('faturamentoSus.apac.resumoLinhas', {
                apacs: linhas.data.value.apacs,
                total: linhas.data.value.total,
                quantidade: linhas.data.value.quantidade,
              })
            }}
          </p>
          <table data-testid="tabela-linhas-apac">
            <thead>
              <tr>
                <th scope="col">{{ t('faturamentoSus.apac.colunaNumero') }}</th>
                <th scope="col">{{ t('faturamentoSus.apac.colunaTipoNoArquivo') }}</th>
                <th scope="col">{{ t('faturamentoSus.bpa.procedimento') }}</th>
                <th scope="col">{{ t('faturamentoSus.apac.colunaPrincipal') }}</th>
                <th scope="col">{{ t('faturamentoSus.apac.colunaCbo') }}</th>
                <th scope="col">{{ t('faturamentoSus.apac.colunaQuantidade') }}</th>
                <th scope="col">{{ t('faturamentoSus.apac.colunaConta') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in linhas.data.value.itens" :key="x.id" :data-testid="`linha-apac-${x.id}`">
                <td>{{ x.numero }}</td>
                <td>{{ t(`faturamentoSus.apac.tiposNoArquivo.${x.tipoNoArquivo}`) }}</td>
                <td>{{ x.procedimento }}</td>
                <td>{{ x.principal ? t('faturamentoSus.apac.sim') : t('faturamentoSus.apac.nao') }}</td>
                <td>{{ x.cbo }}</td>
                <td>{{ x.quantidade }}</td>
                <td>
                  <RouterLink
                    v-if="x.conta !== null"
                    :to="`/faturamento/contas/${x.conta}`"
                    :aria-label="t('faturamentoSus.apac.contaAbrir', { conta: x.conta })"
                  >
                    {{ x.conta }}
                  </RouterLink>
                  <span v-else>—</span>
                </td>
              </tr>
            </tbody>
          </table>
          <PaginacaoCadastro
            v-model="paginaLinhas"
            :total="linhas.data.value.total"
            :por-pagina="POR_PAGINA"
            :rotulo="t('faturamentoSus.apac.linhasDoArquivo', { nome: arquivoAberto.nomeArquivo })"
          />
        </template>
      </section>

      <section v-if="liberado" aria-labelledby="apac-dominios-titulo" data-testid="apac-dominios">
        <h2 id="apac-dominios-titulo">{{ t('faturamentoSus.apac.dominios') }}</h2>
        <p class="pequeno">{{ t('faturamentoSus.apac.dominiosExplicacao') }}</p>
        <MensagemErro v-if="dominios.isError.value" :erro="dominios.error.value" />
        <dl v-else-if="dominios.data.value" class="resumo">
          <dt>{{ t('faturamentoSus.apac.caracteristicaTratamento') }}</dt>
          <dd>
            {{ dominios.data.value.caracteristicaTratamento.map((x) => `${x.id} ${x.nome}`).join('; ') }}
          </dd>
          <dt>{{ t('faturamentoSus.apac.contraindicacaoTransplante') }}</dt>
          <dd>
            {{ dominios.data.value.contraindicacaoTransplante.map((x) => `${x.id} ${x.nome}`).join('; ') }}
          </dd>
          <dt>{{ t('faturamentoSus.apac.situacaoTransplante') }}</dt>
          <dd>{{ dominios.data.value.situacaoTransplante.map((x) => `${x.id} ${x.nome}`).join('; ') }}</dd>
          <dt>{{ t('faturamentoSus.apac.acessoVascular') }}</dt>
          <dd>{{ dominios.data.value.acessoVascular.map((x) => `${x.id} ${x.nome}`).join('; ') }}</dd>
        </dl>
      </section>
    </template>
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
.barra,
.linha,
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.grade {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 48rem;
}
.pequeno {
  display: block;
  font-size: var(--sgh-fonte-pequena);
}
.resumo {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.resumo dd {
  margin: 0;
}
.texto {
  white-space: pre-wrap;
}
.hash {
  font-family: var(--sgh-fonte-mono, monospace);
  font-size: var(--sgh-fonte-pequena);
  word-break: break-all;
}
</style>
