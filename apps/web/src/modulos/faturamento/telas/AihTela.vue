<script setup lang="ts">
// AIH (M51, etapa 4; ficha, seções 5, 7, 8 e 12; regra 6) — `Faturamento > Faturamento SUS > AIH (internação, SIH)`:
// a faixa numérica liberada pelo gestor (supervisor), o laudo de solicitação pela internação (o laudo do médico
// transcrito), a autorização com o número da faixa, a negativa, o fechamento (o espelho com o procedimento principal, os
// secundários, os OPM com a nota e o lote e as diárias de UTI pela trajetória, com os valores da SIGTAP da competência),
// a reabertura e o cancelamento; o SISAIH01 da competência com o hash e o download; os atalhos para a crítica, os leitos
// de UTI habilitados, o retorno do gestor e os médicos solicitantes. Construída e DESLIGADA por estabelecimento (DP-35):
// sem a chave, a tela diz o pré-requisito. Nenhum documento do paciente na tela (o prontuário e a internação).
import {
  type AihLida,
  type ArquivoSusLido,
  type CaraterInternacaoSih,
  CARATERES_INTERNACAO_SIH,
  type CompetenciaSusResumo,
  type EspelhoAih,
  type InternacaoParaAih,
  SITUACOES_AIH,
  type SituacaoAih,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import PaginacaoCadastro from '../../cadastro/componentes/PaginacaoCadastro.vue';
import { carimboBr } from '../../cadastro/formato.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import LaudoInternacaoSusPainel from '../componentes/LaudoInternacaoSusPainel.vue';
import LotesLaudoSusPainel from '../componentes/LotesLaudoSusPainel.vue';
import {
  enderecoArquivoAih,
  gerarSisaih,
  lerAihs,
  lerEspelhoAih,
  lerInternacaoAih,
  lerPainelAih,
  registrarAih,
  registrarFaixaAih,
} from '../api-sus-aih.js';
import { lerArquivosSus, lerCompetenciasSus } from '../api-sus.js';

const { t } = useI18n();
const cliente = useQueryClient();
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

const podeRegistrar = computed(() => pode('faturamento.susAih.registrar'));
const podeFaixa = computed(() => pode('faturamento.susAih.registrarFaixa'));

const painel = useQuery({ queryKey: ['sus', 'aih', 'painel'], queryFn: () => lerPainelAih() });
const liberado = computed(() => painel.data.value?.liberado ?? false);

async function executar(fn: () => Promise<string>): Promise<boolean> {
  mensagem.value = null;
  erro.value = null;
  ocupado.value = true;
  try {
    mensagem.value = await fn();
    await cliente.invalidateQueries({ queryKey: ['sus'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    ocupado.value = false;
  }
}

// ── Faixa ──────────────────────────────────────────────────────────────────────────────────────────────
const faixa = reactive({ inicial: '', final: '', orgao: '', data: null as string | null });
const faixaValida = computed(
  () =>
    /^\d{13}$/.test(faixa.inicial.trim()) &&
    /^\d{13}$/.test(faixa.final.trim()) &&
    faixa.orgao.trim().length >= 3 &&
    faixa.data !== null,
);
async function registrarFaixa(): Promise<void> {
  const ok = await executar(async () => {
    const f = await registrarFaixaAih({
      acao: 'registrar',
      inicial: faixa.inicial.trim(),
      final: faixa.final.trim(),
      orgaoEmissor: faixa.orgao.trim(),
      dataLiberacao: faixa.data ?? '',
    });
    return t('faturamentoSus.aih.faixaRegistrada', { inicial: f.inicial, final: f.final, total: f.total });
  });
  if (ok) Object.assign(faixa, { inicial: '', final: '', orgao: '', data: null });
}
const cancelandoFaixa = ref<number | null>(null);
const justificativaFaixa = ref('');
async function cancelarFaixa(id: number, versao: string): Promise<void> {
  const ok = await executar(async () => {
    await registrarFaixaAih({
      acao: 'cancelar',
      faixa: id,
      versao,
      justificativa: justificativaFaixa.value.trim(),
    });
    return t('faturamentoSus.aih.faixaCancelada');
  });
  if (ok) {
    cancelandoFaixa.value = null;
    justificativaFaixa.value = '';
  }
}

// ── Laudo ──────────────────────────────────────────────────────────────────────────────────────────────
const registroBusca = ref('');
const internacao = ref<InternacaoParaAih | null>(null);
const erroInternacao = ref<unknown>(null);
const laudo = reactive({
  procedimento: '',
  cid: '',
  cidSecundario: '',
  carater: '01' as CaraterInternacaoSih,
  solicitante: '',
  data: null as string | null,
  justificativa: '',
});
const opcoesCarater = computed(() =>
  (Object.keys(CARATERES_INTERNACAO_SIH) as CaraterInternacaoSih[]).map((c) => ({
    valor: c,
    rotulo: `${c} — ${CARATERES_INTERNACAO_SIH[c]}`,
  })),
);
async function buscarInternacao(): Promise<void> {
  erroInternacao.value = null;
  internacao.value = null;
  const n = Number(registroBusca.value.trim());
  if (!Number.isInteger(n) || n <= 0) return;
  try {
    internacao.value = await lerInternacaoAih(n);
    laudo.cid = internacao.value.cidPrincipal ?? '';
    if (internacao.value.carater) laudo.carater = internacao.value.carater;
    laudo.data = internacao.value.entrada;
  } catch (e) {
    erroInternacao.value = e;
  }
}
const laudoValido = computed(
  () =>
    internacao.value !== null &&
    internacao.value.sus &&
    internacao.value.aih === null &&
    /^\d{10}$/.test(laudo.procedimento.trim()) &&
    laudo.cid.trim().length >= 3 &&
    /^\d{1,11}$/.test(laudo.solicitante.trim()) &&
    laudo.data !== null &&
    laudo.justificativa.trim().length >= 10,
);
async function registrarLaudo(): Promise<void> {
  const i = internacao.value;
  if (!i) return;
  const ok = await executar(async () => {
    const a = await registrarAih({
      acao: 'laudo',
      laudo: {
        registro: i.registro,
        procedimentoSolicitado: laudo.procedimento.trim(),
        cidPrincipal: laudo.cid.trim(),
        cidSecundario: laudo.cidSecundario.trim() || null,
        carater: laudo.carater,
        solicitante: laudo.solicitante.trim(),
        dataLaudo: laudo.data ?? '',
        justificativa: laudo.justificativa.trim(),
      },
    });
    selecionada.value = a.id;
    return t('faturamentoSus.aih.laudoRegistrado', { registro: a.registro });
  });
  if (ok) {
    internacao.value = null;
    registroBusca.value = '';
    Object.assign(laudo, {
      procedimento: '',
      cid: '',
      cidSecundario: '',
      solicitante: '',
      justificativa: '',
    });
  }
}

// ── Lista e AIH selecionada ────────────────────────────────────────────────────────────────────────────
const POR_PAGINA = 50;
const situacao = ref<'' | SituacaoAih>('');
const numeroFiltro = ref('');
const filtroNumero = ref('');
const pagina = ref(1);
watch([situacao, filtroNumero], () => (pagina.value = 1));
const opcoesSituacao = computed(() => [
  { valor: '' as const, rotulo: t('faturamentoSus.aih.todas') },
  ...SITUACOES_AIH.map((x) => ({ valor: x, rotulo: t(`faturamentoSus.aih.situacoes.${x}`) })),
]);
const lista = useQuery({
  queryKey: computed(() => ['sus', 'aih', 'lista', situacao.value, filtroNumero.value, pagina.value]),
  queryFn: () =>
    lerAihs({
      ...(situacao.value ? { situacao: situacao.value } : {}),
      ...(filtroNumero.value ? { numero: filtroNumero.value } : {}),
      pagina: pagina.value - 1,
      porPagina: POR_PAGINA,
    }),
});
const selecionada = ref<number | null>(null);
const espelho = useQuery({
  queryKey: computed(() => ['sus', 'aih', 'espelho', selecionada.value ?? 0]),
  queryFn: () => lerEspelhoAih(selecionada.value ?? 0),
  enabled: computed(() => selecionada.value !== null),
});
const aih = computed<AihLida | null>(() => espelho.data.value?.aih ?? null);
const esp = computed<EspelhoAih | null>(() => espelho.data.value ?? null);

// Autorizar
const opcoesFaixa = computed(() =>
  (painel.data.value?.faixas ?? [])
    .filter((f) => f.situacao === 'ativa')
    .map((f) => ({ valor: f.id, rotulo: `${f.inicial} a ${f.final} (${f.orgaoEmissor})` })),
);
const autorizacao = reactive({
  faixa: null as number | null,
  numero: '',
  autorizador: '',
  data: null as string | null,
});
watch(opcoesFaixa, (o) => {
  if (autorizacao.faixa === null && o[0]) autorizacao.faixa = o[0].valor;
});
const autorizacaoValida = computed(
  () =>
    autorizacao.faixa !== null &&
    (autorizacao.numero.trim() === '' || /^\d{13}$/.test(autorizacao.numero.trim())) &&
    /^\d{15}$/.test(autorizacao.autorizador.trim()) &&
    autorizacao.data !== null,
);
async function autorizar(a: AihLida): Promise<void> {
  await executar(async () => {
    const r = await registrarAih({
      acao: 'autorizar',
      aih: a.id,
      versao: a.versao,
      faixa: autorizacao.faixa ?? 0,
      numero: autorizacao.numero.trim() || null,
      autorizador: autorizacao.autorizador.trim(),
      dataAutorizacao: autorizacao.data ?? '',
    });
    return t('faturamentoSus.aih.autorizada', { numero: r.numero ?? '' });
  });
}

// Justificativa (negar, reabrir, cancelar)
const justificativa = ref('');
async function comJustificativa(a: AihLida, acao: 'negar' | 'reabrir' | 'cancelar'): Promise<void> {
  const ok = await executar(async () => {
    await registrarAih({ acao, aih: a.id, versao: a.versao, justificativa: justificativa.value.trim() });
    return t(`faturamentoSus.aih.feito.${acao}`);
  });
  if (ok) justificativa.value = '';
}

// Fechar: o procedimento realizado (vazio: o solicitado) e os dados de cada OPM da conta.
const realizado = ref('');
const opm = reactive<
  Record<number, { cnpj: string; nota: string; anvisa: string; serie: string; lote: string }>
>({});
const linhasOpm = computed(() =>
  (esp.value?.origem === 'montagem' ? esp.value.linhas : []).filter(
    (x) => x.tipo === 'opm' && x.item !== null,
  ),
);
watch(linhasOpm, (ls) => {
  for (const x of ls)
    if (x.item !== null && !opm[x.item])
      opm[x.item] = { cnpj: '', nota: '', anvisa: '', serie: '', lote: '' };
});
const fechamentoValido = computed(
  () =>
    (realizado.value.trim() === '' || /^\d{10}$/.test(realizado.value.trim())) &&
    linhasOpm.value.every((x) => {
      const o = x.item !== null ? opm[x.item] : undefined;
      return o !== undefined && /^\d{14}$/.test(o.cnpj.trim()) && o.nota.trim().length > 0;
    }),
);
async function fechar(a: AihLida): Promise<void> {
  await executar(async () => {
    await registrarAih({
      acao: 'fechar',
      aih: a.id,
      versao: a.versao,
      procedimentoRealizado: realizado.value.trim() || null,
      opm: linhasOpm.value.map((x) => {
        const o = opm[x.item ?? 0] ?? { cnpj: '', nota: '', anvisa: '', serie: '', lote: '' };
        return {
          item: x.item ?? 0,
          cnpjFornecedor: o.cnpj.trim(),
          notaFiscal: o.nota.trim(),
          registroAnvisa: o.anvisa.trim(),
          serie: o.serie.trim(),
          lote: o.lote.trim(),
        };
      }),
    });
    realizado.value = '';
    return t('faturamentoSus.aih.fechada');
  });
}
const bloqueantes = computed(() => (esp.value?.criticas ?? []).filter((c) => c.gravidade === 'bloqueante'));
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const textoCritica = (c: { regra: string; detalhe: Record<string, string | number | null> }) => {
  const extra = c.detalhe['campo']
    ? t('faturamentoSus.criticas.campoAusente', { campo: String(c.detalhe['campo']) })
    : c.detalhe['sigtap']
      ? t('faturamentoSus.criticas.sigtap', { codigo: String(c.detalhe['sigtap']) })
      : '';
  return `${t(`faturamentoSus.criticas.regras.${c.regra}`)}${extra ? ` — ${extra}` : ''}`;
};

// ── SISAIH01 ───────────────────────────────────────────────────────────────────────────────────────────
const competencias = useQuery({
  queryKey: ['sus', 'competencias', 'aih'],
  queryFn: () => lerCompetenciasSus('aih'),
});
const competencia = ref('');
watch(
  () => competencias.data.value?.competencias ?? [],
  (cs) => {
    if (!competencia.value && cs[0]) competencia.value = cs[0].competencia;
  },
);
const opcoesCompetencia = computed(() =>
  (competencias.data.value?.competencias ?? []).map((c) => ({
    valor: c.competencia,
    rotulo: `${c.competencia} — ${t(`faturamentoSus.situacoesCompetencia.${c.situacao}`)}`,
  })),
);
const atual = computed<CompetenciaSusResumo | null>(
  () =>
    (competencias.data.value?.competencias ?? []).find((c) => c.competencia === competencia.value) ?? null,
);
const arquivos = useQuery({
  queryKey: computed(() => ['sus', 'arquivos', 'aih', competencia.value]),
  queryFn: () => lerArquivosSus('aih', competencia.value),
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
async function gerar(): Promise<void> {
  const c = atual.value;
  if (!c) return;
  await executar(async () => {
    const r = await gerarSisaih({ competencia: c.competencia, versao: c.versao });
    return t('faturamentoSus.aih.sisaihGerado', {
      aihs: r.arquivo.registros,
      linhas: r.arquivo.linhas,
      tempo: (r.tempoMs / 1000).toFixed(1),
    });
  });
}
const situacaoArquivo = (a: ArquivoSusLido) => t(`faturamentoSus.ciha.situacoes.${a.situacao}`);
</script>

<template>
  <section class="tela" aria-labelledby="aih-titulo" data-testid="tela-aih">
    <h1 id="aih-titulo">{{ t('faturamentoSus.aih.titulo') }}</h1>
    <p>{{ t('faturamentoSus.aih.explicacao') }}</p>
    <p class="pequeno">{{ t('faturamentoSus.ciha.envio') }}</p>
    <nav class="linha" :aria-label="t('faturamentoSus.aih.atalhos')">
      <RouterLink to="/faturamento/sus/competencias?instrumento=aih">{{
        t('faturamentoSus.aih.irCriticas')
      }}</RouterLink>
      <RouterLink to="/faturamento/sus/cadastros/leitos-uti" data-testid="link-leitos-uti">
        {{ t('faturamentoSus.aih.leitosUti') }}
      </RouterLink>
      <RouterLink to="/faturamento/sus/retorno" data-testid="link-retorno">{{
        t('faturamentoSus.aih.retorno')
      }}</RouterLink>
      <RouterLink to="/faturamento/sus/solicitantes">{{ t('faturamentoSus.aih.solicitantes') }}</RouterLink>
      <RouterLink to="/faturamento/sus/cadastros/dominios" data-testid="link-dominios">
        {{ t('faturamentoSus.aih.dominios') }}
      </RouterLink>
    </nav>
    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!painel.data.value">{{ t('faturamentoSus.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!liberado"
        :texto="t('faturamentoSus.aih.desligado')"
        variante="aviso"
        data-testid="aih-desligado"
      />
      <SanteAlerta
        v-if="!painel.data.value.leiauteConferido"
        :texto="t('faturamentoSus.aih.leiauteNaoConferido')"
        variante="alerta"
      />
      <section aria-labelledby="aih-parametros-titulo" data-testid="aih-parametros">
        <h2 id="aih-parametros-titulo">{{ t('faturamentoSus.aih.parametros') }}</h2>
        <dl class="resumo">
          <dt>{{ t('faturamentoSus.aih.cnes') }}</dt>
          <dd>
            {{
              painel.data.value.parametros.cnes
                ? t('faturamentoSus.aih.informado')
                : t('faturamentoSus.aih.falta')
            }}
          </dd>
          <dt>{{ t('faturamentoSus.aih.diretor') }}</dt>
          <dd>
            {{
              painel.data.value.parametros.diretorClinico
                ? t('faturamentoSus.aih.informado')
                : t('faturamentoSus.aih.falta')
            }}
          </dd>
          <dt>{{ t('faturamentoSus.aih.diarias') }}</dt>
          <dd>{{ t('faturamentoSus.aih.acomodacoes', { n: painel.data.value.parametros.diariasUti }) }}</dd>
          <dt>{{ t('faturamentoSus.aih.leitosHabilitados') }}</dt>
          <dd data-testid="aih-leitos-resumo">
            {{
              painel.data.value.leitosUti
                .filter((x) => x.leitos > 0)
                .map((x) => `${x.nome}: ${x.leitos}`)
                .join('; ') || t('faturamentoSus.aih.nenhumLeito')
            }}
          </dd>
        </dl>
        <p class="pequeno">{{ t('faturamentoSus.aih.parametrosAjuda') }}</p>
      </section>

      <p v-if="mensagem" role="status" data-testid="mensagem-aih">{{ mensagem }}</p>
      <ErroFaturamento v-if="erro" :erro="erro" />

      <section aria-labelledby="aih-faixas-titulo" data-testid="aih-faixas">
        <h2 id="aih-faixas-titulo">{{ t('faturamentoSus.aih.faixas') }}</h2>
        <p v-if="painel.data.value.faixas.length === 0">{{ t('faturamentoSus.aih.nenhumaFaixa') }}</p>
        <table v-else data-testid="tabela-faixas">
          <thead>
            <tr>
              <th scope="col">{{ t('faturamentoSus.aih.inicial') }}</th>
              <th scope="col">{{ t('faturamentoSus.aih.final') }}</th>
              <th scope="col">{{ t('faturamentoSus.aih.orgao') }}</th>
              <th scope="col">{{ t('faturamentoSus.aih.usados') }}</th>
              <th scope="col">{{ t('faturamentoSus.aih.proximo') }}</th>
              <th scope="col">{{ t('faturamentoSus.aih.situacao') }}</th>
              <th scope="col">{{ t('faturamentoSus.aih.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in painel.data.value.faixas" :key="f.id" :data-testid="`faixa-${f.id}`">
              <td>{{ f.inicial }}</td>
              <td>{{ f.final }}</td>
              <td>
                {{ f.orgaoEmissor }} <span class="pequeno">{{ f.dataLiberacao }}</span>
              </td>
              <td>{{ f.usados }} / {{ f.total }}</td>
              <td>{{ f.proximo ?? '—' }}</td>
              <td>{{ t(`faturamentoSus.aih.situacoesFaixa.${f.situacao}`) }}</td>
              <td>
                <template v-if="podeFaixa && liberado && f.situacao === 'ativa'">
                  <SanteBotao
                    v-if="cancelandoFaixa !== f.id"
                    :rotulo="t('faturamentoSus.aih.cancelarFaixa')"
                    variante="secundario"
                    :data-testid="`botao-cancelar-faixa-${f.id}`"
                    @acionar="cancelandoFaixa = f.id"
                  />
                  <form v-else class="linha" @submit.prevent="cancelarFaixa(f.id, f.versao)">
                    <SanteCampoTexto
                      v-model="justificativaFaixa"
                      :rotulo="t('faturamentoSus.aih.justificativa')"
                      :max-bytes="500"
                    />
                    <SanteBotao
                      :rotulo="t('faturamentoSus.aih.confirmar')"
                      tipo="submit"
                      :desabilitado="ocupado || justificativaFaixa.trim().length < 10"
                    />
                  </form>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <form
          v-if="podeFaixa && liberado"
          class="linha"
          data-testid="form-faixa"
          @submit.prevent="registrarFaixa"
        >
          <SanteCampoTexto
            v-model="faixa.inicial"
            :rotulo="t('faturamentoSus.aih.inicial')"
            :max-bytes="13"
            data-testid="faixa-inicial"
          />
          <SanteCampoTexto
            v-model="faixa.final"
            :rotulo="t('faturamentoSus.aih.final')"
            :max-bytes="13"
            data-testid="faixa-final"
          />
          <SanteCampoTexto
            v-model="faixa.orgao"
            :rotulo="t('faturamentoSus.aih.orgao')"
            :max-bytes="60"
            data-testid="faixa-orgao"
          />
          <SanteData
            v-model="faixa.data"
            :rotulo="t('faturamentoSus.aih.dataLiberacao')"
            editavel
            data-testid="faixa-data"
          />
          <SanteBotao
            :rotulo="t('faturamentoSus.aih.registrarFaixa')"
            tipo="submit"
            :desabilitado="ocupado || !faixaValida"
            data-testid="botao-registrar-faixa"
          />
        </form>
        <p class="pequeno">{{ t('faturamentoSus.aih.faixaAjuda') }}</p>
      </section>

      <section v-if="podeRegistrar && liberado" aria-labelledby="aih-laudo-titulo" data-testid="aih-laudo">
        <h2 id="aih-laudo-titulo">{{ t('faturamentoSus.aih.novoLaudo') }}</h2>
        <form class="linha" data-testid="form-internacao" @submit.prevent="buscarInternacao">
          <SanteCampoTexto
            v-model="registroBusca"
            :rotulo="t('faturamentoSus.aih.registro')"
            :max-bytes="10"
            data-testid="laudo-registro"
          />
          <SanteBotao
            :rotulo="t('faturamentoSus.aih.buscarInternacao')"
            tipo="submit"
            variante="secundario"
            data-testid="botao-buscar-internacao"
          />
        </form>
        <ErroFaturamento v-if="erroInternacao" :erro="erroInternacao" />
        <template v-if="internacao">
          <dl class="resumo" data-testid="laudo-internacao">
            <dt>{{ t('faturamentoSus.aih.prontuario') }}</dt>
            <dd>{{ internacao.prontuario ?? '—' }}</dd>
            <dt>{{ t('faturamentoSus.aih.periodo') }}</dt>
            <dd>
              {{ internacao.entrada ?? '—' }} — {{ internacao.alta ?? t('faturamentoSus.aih.semAlta') }}
            </dd>
            <dt>{{ t('faturamentoSus.aih.financiador') }}</dt>
            <dd>{{ internacao.sus ? t('faturamentoSus.aih.sus') : t('faturamentoSus.aih.naoSus') }}</dd>
            <dt>{{ t('faturamentoSus.aih.cnsPaciente') }}</dt>
            <dd>
              {{ internacao.cnsValido ? t('faturamentoSus.aih.cnsOk') : t('faturamentoSus.aih.cnsFalta') }}
            </dd>
          </dl>
          <SanteAlerta v-if="!internacao.sus" :texto="t('faturamentoSus.aih.naoSusAviso')" variante="aviso" />
          <SanteAlerta
            v-else-if="internacao.aih !== null"
            :texto="t('faturamentoSus.aih.jaTemAih')"
            variante="aviso"
          />
          <form v-else class="grade" data-testid="form-laudo" @submit.prevent="registrarLaudo">
            <SanteCampoTexto
              v-model="laudo.procedimento"
              :rotulo="t('faturamentoSus.aih.procedimentoSolicitado')"
              :max-bytes="10"
              data-testid="laudo-procedimento"
            />
            <SanteCampoTexto
              v-model="laudo.cid"
              :rotulo="t('faturamentoSus.aih.cid')"
              :max-bytes="6"
              data-testid="laudo-cid"
            />
            <SanteCampoTexto
              v-model="laudo.cidSecundario"
              :rotulo="t('faturamentoSus.aih.cidSecundario')"
              :max-bytes="6"
            />
            <SanteSelecao
              v-model="laudo.carater"
              :rotulo="t('faturamentoSus.aih.carater')"
              :opcoes="opcoesCarater"
              data-testid="laudo-carater"
            />
            <SanteCampoTexto
              v-model="laudo.solicitante"
              :rotulo="t('faturamentoSus.aih.solicitante')"
              :max-bytes="11"
              data-testid="laudo-solicitante"
            />
            <SanteData
              v-model="laudo.data"
              :rotulo="t('faturamentoSus.aih.dataLaudo')"
              editavel
              data-testid="laudo-data"
            />
            <SanteCampoTexto
              v-model="laudo.justificativa"
              :rotulo="t('faturamentoSus.aih.justificativaLaudo')"
              :max-bytes="2000"
              multilinha
              data-testid="laudo-justificativa"
            />
            <SanteBotao
              :rotulo="t('faturamentoSus.aih.registrarLaudo')"
              tipo="submit"
              :desabilitado="ocupado || !laudoValido"
              data-testid="botao-registrar-laudo"
            />
          </form>
        </template>
        <p class="pequeno">{{ t('faturamentoSus.aih.laudoAjuda') }}</p>
      </section>

      <section aria-labelledby="aih-lista-titulo" data-testid="aih-lista">
        <h2 id="aih-lista-titulo">{{ t('faturamentoSus.aih.lista') }}</h2>
        <form class="linha" @submit.prevent="filtroNumero = numeroFiltro.trim()">
          <SanteSelecao
            v-model="situacao"
            :rotulo="t('faturamentoSus.aih.situacao')"
            :opcoes="opcoesSituacao"
            data-testid="aih-filtro-situacao"
          />
          <SanteCampoTexto v-model="numeroFiltro" :rotulo="t('faturamentoSus.aih.numero')" :max-bytes="13" />
          <SanteBotao :rotulo="t('faturamentoSus.aih.filtrar')" tipo="submit" variante="secundario" />
        </form>
        <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
        <p v-else-if="!lista.data.value">{{ t('faturamentoSus.carregando') }}</p>
        <p v-else-if="lista.data.value.itens.length === 0" data-testid="aih-nenhuma">
          {{ t('faturamentoSus.aih.nenhuma') }}
        </p>
        <template v-else>
          <table data-testid="tabela-aih">
            <thead>
              <tr>
                <th scope="col">{{ t('faturamentoSus.aih.numero') }}</th>
                <th scope="col">{{ t('faturamentoSus.aih.situacao') }}</th>
                <th scope="col">{{ t('faturamentoSus.aih.registro') }}</th>
                <th scope="col">{{ t('faturamentoSus.aih.prontuario') }}</th>
                <th scope="col">{{ t('faturamentoSus.aih.procedimento') }}</th>
                <th scope="col">{{ t('faturamentoSus.aih.periodo') }}</th>
                <th scope="col">{{ t('faturamentoSus.aih.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in lista.data.value.itens" :key="a.id" :data-testid="`aih-${a.id}`">
                <td>{{ a.numero ?? '—' }}</td>
                <td>{{ t(`faturamentoSus.aih.situacoes.${a.situacao}`) }}</td>
                <td>{{ a.registro }}</td>
                <td>{{ a.prontuario ?? '—' }}</td>
                <td>
                  {{ a.procedimentoRealizado ?? a.procedimentoSolicitado }}
                  <span class="pequeno">{{ a.procedimentoSolicitadoNome ?? '' }}</span>
                </td>
                <td>{{ a.entrada ?? '—' }} — {{ a.alta ?? '—' }}</td>
                <td>
                  <SanteBotao
                    :rotulo="t('faturamentoSus.aih.abrir')"
                    variante="secundario"
                    :data-testid="`botao-abrir-aih-${a.id}`"
                    @acionar="selecionada = a.id"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <PaginacaoCadastro
            v-model="pagina"
            :total="lista.data.value.total"
            :por-pagina="POR_PAGINA"
            :rotulo="t('faturamentoSus.aih.lista')"
          />
        </template>
      </section>

      <section v-if="selecionada !== null" aria-labelledby="aih-detalhe-titulo" data-testid="aih-detalhe">
        <h2 id="aih-detalhe-titulo">
          {{ t('faturamentoSus.aih.detalhe', { registro: aih?.registro ?? '' }) }}
        </h2>
        <MensagemErro v-if="espelho.isError.value" :erro="espelho.error.value" />
        <p v-else-if="!aih || !esp">{{ t('faturamentoSus.carregando') }}</p>
        <template v-else>
          <dl class="resumo">
            <dt>{{ t('faturamentoSus.aih.situacao') }}</dt>
            <dd data-testid="aih-situacao">{{ t(`faturamentoSus.aih.situacoes.${aih.situacao}`) }}</dd>
            <dt>{{ t('faturamentoSus.aih.numero') }}</dt>
            <dd data-testid="aih-numero">{{ aih.numero ?? '—' }}</dd>
            <dt>{{ t('faturamentoSus.aih.procedimentoSolicitado') }}</dt>
            <dd>{{ aih.procedimentoSolicitado }} {{ aih.procedimentoSolicitadoNome ?? '' }}</dd>
            <dt>{{ t('faturamentoSus.aih.cid') }}</dt>
            <dd>{{ aih.cidPrincipal }}{{ aih.cidSecundario ? ` / ${aih.cidSecundario}` : '' }}</dd>
            <dt>{{ t('faturamentoSus.aih.solicitante') }}</dt>
            <dd>{{ aih.solicitanteNome ?? aih.solicitante }}</dd>
            <dt>{{ t('faturamentoSus.aih.dataLaudo') }}</dt>
            <dd>{{ aih.dataLaudo }}</dd>
            <dt>{{ t('faturamentoSus.aih.permanencia') }}</dt>
            <dd data-testid="aih-permanencia">
              {{ esp.permanencia.dias ?? '—' }}
              <span class="pequeno">{{
                t('faturamentoSus.aih.media', { media: esp.permanencia.media ?? '—' })
              }}</span>
            </dd>
            <dt>{{ t('faturamentoSus.aih.diariasUti') }}</dt>
            <dd data-testid="aih-diarias-uti">{{ esp.diariasUti.total }}</dd>
            <dt>{{ t('faturamentoSus.aih.apresentacao') }}</dt>
            <dd>
              {{ aih.competenciaApresentacao ?? '—' }}
              <span v-if="aih.reapresentacoes > 0" class="pequeno">{{
                t('faturamentoSus.aih.reapresentacoes', { n: aih.reapresentacoes })
              }}</span>
            </dd>
            <dt v-if="aih.justificativaSituacao">{{ t('faturamentoSus.aih.justificativa') }}</dt>
            <dd v-if="aih.justificativaSituacao">{{ aih.justificativaSituacao }}</dd>
          </dl>
          <p class="pequeno">{{ aih.justificativa }}</p>

          <h3>
            {{ t('faturamentoSus.aih.espelho', { origem: t(`faturamentoSus.aih.origens.${esp.origem}`) }) }}
          </h3>
          <table data-testid="tabela-espelho">
            <thead>
              <tr>
                <th scope="col">{{ t('faturamentoSus.aih.tipo') }}</th>
                <th scope="col">{{ t('faturamentoSus.aih.procedimento') }}</th>
                <th scope="col">{{ t('faturamentoSus.aih.quantidade') }}</th>
                <th scope="col">{{ t('faturamentoSus.aih.cbo') }}</th>
                <th scope="col">{{ t('faturamentoSus.aih.valorSh') }}</th>
                <th scope="col">{{ t('faturamentoSus.aih.valorSp') }}</th>
                <th scope="col">{{ t('faturamentoSus.aih.valorTotal') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(x, k) in esp.linhas"
                :key="`${x.tipo}-${x.procedimento}-${k}`"
                :data-testid="`espelho-${x.tipo}-${x.procedimento}`"
              >
                <td>{{ t(`faturamentoSus.aih.tipos.${x.tipo}`) }}</td>
                <td>
                  {{ x.procedimento }} <span class="pequeno">{{ x.nome ?? '' }}</span>
                </td>
                <td>{{ x.quantidade }}</td>
                <td>{{ x.cbo ?? '—' }}</td>
                <td>{{ moeda(x.valorServicoHospitalar) }}</td>
                <td>{{ moeda(x.valorServicoProfissional) }}</td>
                <td>{{ moeda(x.valorTotal) }}</td>
              </tr>
            </tbody>
          </table>
          <p data-testid="espelho-total">
            {{
              t('faturamentoSus.aih.totalEspelho', {
                valor: moeda(esp.valorTotal),
                fora: esp.itensForaDaAih,
                sem: esp.itensSemSigtap,
              })
            }}
          </p>
          <section
            v-if="esp.criticas.length"
            :aria-label="t('faturamentoSus.aih.criticasDaAih')"
            data-testid="aih-criticas"
          >
            <h3>{{ t('faturamentoSus.aih.criticasDaAih') }}</h3>
            <ul>
              <li v-for="(c, k) in esp.criticas" :key="k" :data-testid="`aih-critica-${c.regra}`">
                <strong>{{ t(`faturamentoSus.gravidades.${c.gravidade}`) }}:</strong> {{ textoCritica(c) }}
              </li>
            </ul>
          </section>
          <SanteAlerta
            v-if="esp.retorno"
            :texto="
              t('faturamentoSus.aih.retornoDaAih', {
                situacao: t(`faturamentoSus.retorno.situacoes.${esp.retorno.situacao}`),
                motivo: esp.retorno.motivo ?? '—',
                tratamento: t(`faturamentoSus.retorno.tratamentos.${esp.retorno.tratamento}`),
              })
            "
            variante="info"
            data-testid="aih-retorno"
          />

          <template v-if="podeRegistrar && liberado">
            <form
              v-if="aih.situacao === 'solicitada'"
              class="grade"
              data-testid="form-autorizar"
              @submit.prevent="autorizar(aih)"
            >
              <h3>{{ t('faturamentoSus.aih.autorizacao') }}</h3>
              <SanteSelecao
                v-model="autorizacao.faixa"
                :rotulo="t('faturamentoSus.aih.faixa')"
                :opcoes="opcoesFaixa"
                data-testid="autorizar-faixa"
              />
              <SanteCampoTexto
                v-model="autorizacao.numero"
                :rotulo="t('faturamentoSus.aih.numeroOpcional')"
                :max-bytes="13"
                data-testid="autorizar-numero"
              />
              <SanteCampoTexto
                v-model="autorizacao.autorizador"
                :rotulo="t('faturamentoSus.aih.autorizador')"
                :max-bytes="15"
                data-testid="autorizar-autorizador"
              />
              <SanteData
                v-model="autorizacao.data"
                :rotulo="t('faturamentoSus.aih.dataAutorizacao')"
                editavel
                data-testid="autorizar-data"
              />
              <SanteBotao
                :rotulo="t('faturamentoSus.aih.autorizar')"
                tipo="submit"
                :desabilitado="ocupado || !autorizacaoValida"
                data-testid="botao-autorizar"
              />
            </form>
            <form
              v-if="aih.situacao === 'autorizada'"
              class="grade"
              data-testid="form-fechar"
              @submit.prevent="fechar(aih)"
            >
              <h3>{{ t('faturamentoSus.aih.fechamento') }}</h3>
              <SanteAlerta
                v-if="bloqueantes.length"
                :texto="t('faturamentoSus.aih.comBloqueante', { n: bloqueantes.length })"
                variante="alerta"
              />
              <SanteCampoTexto
                v-model="realizado"
                :rotulo="t('faturamentoSus.aih.procedimentoRealizado')"
                :max-bytes="10"
                data-testid="fechar-realizado"
              />
              <fieldset
                v-for="x in linhasOpm"
                :key="x.item ?? 0"
                class="grade"
                :data-testid="`fechar-opm-${x.item}`"
              >
                <legend>
                  {{ t('faturamentoSus.aih.opm', { procedimento: x.procedimento, nome: x.nome ?? '' }) }}
                </legend>
                <template v-if="x.item !== null && opm[x.item]">
                  <SanteCampoTexto
                    v-model="opm[x.item]!.cnpj"
                    :rotulo="t('faturamentoSus.aih.cnpjFornecedor')"
                    :max-bytes="14"
                    :data-testid="`opm-cnpj-${x.item}`"
                  />
                  <SanteCampoTexto
                    v-model="opm[x.item]!.nota"
                    :rotulo="t('faturamentoSus.aih.notaFiscal')"
                    :max-bytes="15"
                    :data-testid="`opm-nota-${x.item}`"
                  />
                  <SanteCampoTexto
                    v-model="opm[x.item]!.anvisa"
                    :rotulo="t('faturamentoSus.aih.registroAnvisa')"
                    :max-bytes="20"
                  />
                  <SanteCampoTexto
                    v-model="opm[x.item]!.serie"
                    :rotulo="t('faturamentoSus.aih.serie')"
                    :max-bytes="20"
                  />
                  <SanteCampoTexto
                    v-model="opm[x.item]!.lote"
                    :rotulo="t('faturamentoSus.aih.lote')"
                    :max-bytes="20"
                    :data-testid="`opm-lote-${x.item}`"
                  />
                </template>
              </fieldset>
              <p v-if="esp.lotesSaida.length" class="pequeno" data-testid="lotes-saida">
                {{ t('faturamentoSus.aih.lotesSaida') }}
                {{ esp.lotesSaida.map((l) => `${l.nome} (${l.lote})`).join('; ') }}
              </p>
              <SanteBotao
                :rotulo="t('faturamentoSus.aih.fechar')"
                tipo="submit"
                :desabilitado="ocupado || !fechamentoValido || bloqueantes.length > 0"
                data-testid="botao-fechar-aih"
              />
            </form>
            <form
              v-if="['solicitada', 'autorizada', 'fechada'].includes(aih.situacao)"
              class="linha"
              data-testid="form-justificativa"
              @submit.prevent
            >
              <SanteCampoTexto
                v-model="justificativa"
                :rotulo="t('faturamentoSus.aih.justificativa')"
                :max-bytes="500"
                data-testid="aih-justificativa"
              />
              <SanteBotao
                v-if="aih.situacao === 'solicitada'"
                :rotulo="t('faturamentoSus.aih.negar')"
                variante="secundario"
                :desabilitado="ocupado || justificativa.trim().length < 10"
                data-testid="botao-negar"
                @acionar="comJustificativa(aih, 'negar')"
              />
              <SanteBotao
                v-if="aih.situacao === 'fechada'"
                :rotulo="t('faturamentoSus.aih.reabrir')"
                variante="secundario"
                :desabilitado="ocupado || justificativa.trim().length < 10"
                data-testid="botao-reabrir"
                @acionar="comJustificativa(aih, 'reabrir')"
              />
              <SanteBotao
                :rotulo="t('faturamentoSus.aih.cancelar')"
                variante="secundario"
                :desabilitado="ocupado || justificativa.trim().length < 10"
                data-testid="botao-cancelar-aih"
                @acionar="comJustificativa(aih, 'cancelar')"
              />
            </form>
          </template>
          <LaudoInternacaoSusPainel :aih="aih" :pode-registrar="podeRegistrar && liberado" />
        </template>
      </section>

      <LotesLaudoSusPainel :pode-registrar="podeRegistrar && liberado" />

      <section aria-labelledby="aih-sisaih-titulo" data-testid="aih-sisaih">
        <h2 id="aih-sisaih-titulo">{{ t('faturamentoSus.aih.sisaih') }}</h2>
        <MensagemErro v-if="competencias.isError.value" :erro="competencias.error.value" />
        <p v-else-if="opcoesCompetencia.length === 0" data-testid="aih-sem-competencia">
          {{ t('faturamentoSus.aih.semCompetencia') }}
          <RouterLink to="/faturamento/sus/competencias?instrumento=aih">{{
            t('faturamentoSus.aih.irCriticas')
          }}</RouterLink>
        </p>
        <template v-else>
          <div class="linha">
            <SanteSelecao
              v-model="competencia"
              :rotulo="t('faturamentoSus.aih.competencia')"
              :opcoes="opcoesCompetencia"
              data-testid="aih-competencia"
            />
            <RouterLink :to="`/faturamento/sus/competencias?instrumento=aih&competencia=${competencia}`">
              {{ t('faturamentoSus.aih.irCriticas') }}
            </RouterLink>
          </div>
          <dl v-if="atual" class="resumo" data-testid="aih-resumo-competencia">
            <dt>{{ t('faturamentoSus.aih.registros') }}</dt>
            <dd>{{ atual.registros }}</dd>
            <dt>{{ t('faturamentoSus.competencias.bloqueantes') }}</dt>
            <dd>{{ atual.criticasBloqueantes }}</dd>
            <dt>{{ t('faturamentoSus.competencias.avisos') }}</dt>
            <dd>{{ atual.avisos }}</dd>
            <dt>{{ t('faturamentoSus.competencias.criticadaEm') }}</dt>
            <dd>{{ atual.criticadaEm ? carimboBr(atual.criticadaEm) : '—' }}</dd>
          </dl>
          <SanteBotao
            v-if="podeRegistrar"
            :rotulo="t('faturamentoSus.aih.gerarSisaih')"
            :desabilitado="ocupado || !pronta || (competencias.data.value?.escopoParcial ?? false)"
            data-testid="botao-gerar-sisaih"
            @acionar="gerar"
          />
          <p v-if="atual && atual.criticadaEm === null" class="pequeno">
            {{ t('faturamentoSus.aih.semCritica') }}
          </p>
          <table v-if="(arquivos.data.value ?? []).length" data-testid="tabela-arquivos-aih">
            <thead>
              <tr>
                <th scope="col">{{ t('faturamentoSus.ciha.nome') }}</th>
                <th scope="col">{{ t('faturamentoSus.ciha.geradoPor') }}</th>
                <th scope="col">{{ t('faturamentoSus.aih.aihs') }}</th>
                <th scope="col">{{ t('faturamentoSus.ciha.linhas') }}</th>
                <th scope="col">{{ t('faturamentoSus.ciha.hash') }}</th>
                <th scope="col">{{ t('faturamentoSus.ciha.situacao') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in arquivos.data.value" :key="a.id" :data-testid="`arquivo-aih-${a.id}`">
                <td>
                  <a
                    v-if="podeRegistrar && liberado && a.situacao !== 'substituido'"
                    :href="enderecoArquivoAih(a.id)"
                    download
                  >
                    {{ a.nomeArquivo }}
                  </a>
                  <span v-else>{{ a.nomeArquivo }}</span>
                  <span class="pequeno">{{
                    t('faturamentoSus.ciha.leiaute', { leiaute: a.leiaute, versao: a.versaoLeiaute })
                  }}</span>
                </td>
                <td class="pequeno">{{ a.geradoPor }} {{ carimboBr(a.geradoEm) }}</td>
                <td>{{ a.registros }}</td>
                <td>{{ a.linhas }}</td>
                <td>
                  <code class="hash" data-testid="hash-arquivo-aih">{{ a.hash }}</code>
                </td>
                <td>{{ situacaoArquivo(a) }}</td>
              </tr>
            </tbody>
          </table>
        </template>
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
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
  border: 0;
  padding: 0;
}
.grade h3,
.grade legend {
  grid-column: 1 / -1;
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
.hash {
  font-family: var(--sgh-fonte-mono, monospace);
  font-size: var(--sgh-fonte-pequena);
  word-break: break-all;
}
</style>
