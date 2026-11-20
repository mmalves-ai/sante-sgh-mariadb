<script setup lang="ts">
// Acidentes e CAT (M52.5; item `Gestão de pessoas > SESMT > CAT (acidente de trabalho)`; `pessoas.acidente.ler` /
// `.registrar`; regra 18, NR-32): a lista dos acidentes com as pendências (CAT a emitir ou atrasada, profilaxia a
// iniciar, sorologia atrasada), o registro do acidente (material biológico com a exposição, o material e a fonte nunca
// identificada; os códigos da CAT do eSocial), e o acompanhamento: profilaxia, sorologia por marco, emissão da CAT com o
// PDF e o encerramento com motivo.
import {
  type AcidenteResposta,
  type ColaboradorSesmt,
  type EfeitoEsocialSesmt,
  type ResultadoSesmt,
  esquemaEmitirCat,
  esquemaEncerrarAcidente,
  esquemaRegistrarAcidente,
  EXPOSICOES_BIOLOGICAS,
  type ExposicaoBiologica,
  FONTES_EXPOSICAO,
  type FonteExposicao,
  MATERIAIS_BIOLOGICOS,
  type MaterialBiologico,
  RESULTADOS_SOROLOGIA,
  type ResultadoSorologia,
  SITUACOES_PROFILAXIA,
  type SituacaoProfilaxia,
  type TesteFonte,
  TESTES_FONTE,
  TIPOS_ACIDENTE,
  type TipoAcidente,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteHora, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { dataBr, opcoesDe } from '../comum.js';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import {
  anularAcidente,
  emitirCat,
  encerrarAcidente,
  gerarCatEsocial,
  lerAcidente,
  lerAcidentes,
  lerApoioSesmt,
  registrarAcidente,
  registrarProfilaxia,
  registrarSorologia,
  urlCatPdf,
} from './api-sesmt.js';
import HistoricoSesmt from './HistoricoSesmt.vue';
import PendenciasSesmt from './PendenciasSesmt.vue';
import RetificarAcidente from './RetificarAcidente.vue';
import SeletorColaborador from './SeletorColaborador.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const apoio = useQuery({ queryKey: ['sesmt', 'apoio', 'cat'], queryFn: () => lerApoioSesmt('cat') });
const a = computed(() => apoio.data.value ?? null);
const estado = ref<'aberto' | 'encerrado' | 'todos'>('aberto');
const lista = useQuery({
  queryKey: computed(() => ['sesmt', 'acidentes', estado.value]),
  queryFn: () => lerAcidentes(estado.value),
});
const opcoesEstado = computed(() =>
  (['aberto', 'encerrado', 'todos'] as const).map((e) => ({ valor: e, rotulo: t(`sesmt.cat.estados.${e}`) })),
);
const instanteBr = (x: string) => `${dataBr(x.slice(0, 10))} ${x.slice(11, 16)}`;
const aviso = ref<string | null>(null);
async function recarregar(msg: string): Promise<void> {
  aviso.value = msg;
  await cliente.invalidateQueries({ queryKey: ['sesmt'] });
}

// ── Detalhe ─────────────────────────────────────────────────────────────────────────────────────────────────
const aberto = ref<number | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['sesmt', 'acidente', aberto.value]),
  queryFn: () => lerAcidente(aberto.value!),
  enabled: computed(() => aberto.value !== null),
});
const d = computed<AcidenteResposta | null>(() => detalhe.data.value ?? null);
const rotuloDe = (xs: readonly { codigo: number; rotulo: string }[] | undefined, c: number | null) =>
  c === null ? '—' : (xs?.find((x) => x.codigo === c)?.rotulo ?? String(c));

// ── Registro ────────────────────────────────────────────────────────────────────────────────────────────────
const registrando = ref(false);
const colaborador = ref<ColaboradorSesmt | null>(null);
const dataAcidente = ref<string | null>(null);
const horaAcidente = ref<string | null>(null);
const tipo = ref<TipoAcidente | null>('tipico');
const unidade = ref<number | null>(null);
const local = ref('');
const descricao = ref('');
const biologico = ref(false);
const perfurocortante = ref(false);
const exposicao = ref<ExposicaoBiologica | null>(null);
const material = ref<MaterialBiologico | null>(null);
const fonte = ref<FonteExposicao | null>(null);
const fonteTeste = ref<TesteFonte | null>(null);
const parteCorpo = ref<number | null>(null);
const natureza = ref<number | null>(null);
const agente = ref<number | null>(null);
const situacao = ref<number | null>(null);
const afastamento = ref(false);
const obito = ref(false);
const erroNovo = ref<unknown>(null);
const opcoesTipo = opcoesDe(TIPOS_ACIDENTE);
const opcoesExposicao = opcoesDe(EXPOSICOES_BIOLOGICAS);
const opcoesMaterial = opcoesDe(MATERIAIS_BIOLOGICOS);
const opcoesFonte = opcoesDe(FONTES_EXPOSICAO);
const opcoesTeste = opcoesDe(TESTES_FONTE);
const opcoesProfilaxia = opcoesDe(SITUACOES_PROFILAXIA);
const opcoesResultado = opcoesDe(RESULTADOS_SOROLOGIA);
const opcoesDominio = (xs: readonly { codigo: number; rotulo: string }[] | undefined) => [
  { valor: null, rotulo: '—' },
  ...(xs ?? []).map((x) => ({ valor: x.codigo, rotulo: x.rotulo })),
];
const hhmm = (h: string | null) => (h && /^\d{4}$/.test(h) ? `${h.slice(0, 2)}:${h.slice(2)}` : '');
const instante = (dia: string | null, hora: string | null) =>
  dia && hhmm(hora) ? `${dia}T${hhmm(hora)}` : '';
const entradaNova = computed(() =>
  esquemaRegistrarAcidente.safeParse({
    vinculo: colaborador.value?.vinculo ?? 0,
    ocorridoEm: instante(dataAcidente.value, horaAcidente.value),
    tipo: tipo.value ?? '',
    unidade: unidade.value,
    local: local.value.trim(),
    descricao: descricao.value.trim(),
    biologico: biologico.value,
    perfurocortante: perfurocortante.value,
    exposicao: biologico.value ? exposicao.value : null,
    material: biologico.value ? material.value : null,
    fonte: biologico.value ? fonte.value : null,
    fonteTeste: biologico.value ? fonteTeste.value : null,
    parteCorpo: parteCorpo.value,
    natureza: natureza.value,
    agente: agente.value,
    situacao: situacao.value,
    afastamento: afastamento.value,
    obito: obito.value,
  }),
);
async function gravarNovo(): Promise<void> {
  if (!entradaNova.value.success) return;
  erroNovo.value = null;
  try {
    const r = await registrarAcidente(entradaNova.value.data);
    registrando.value = false;
    aberto.value = r.id;
    await recarregar(r.mensagem);
  } catch (x) {
    erroNovo.value = x;
  }
}

// ── Acompanhamento ──────────────────────────────────────────────────────────────────────────────────────────
const erroAcao = ref<unknown>(null);
const profilaxia = ref<SituacaoProfilaxia | null>(null);
const profData = ref<string | null>(null);
const profHora = ref<string | null>(null);
async function gravarProfilaxia(): Promise<void> {
  if (!d.value || !profilaxia.value) return;
  erroAcao.value = null;
  try {
    const r = await registrarProfilaxia(d.value.id, {
      versao: d.value.versao,
      profilaxia: profilaxia.value,
      profilaxiaEm: instante(profData.value, profHora.value) || null,
      observacao: null,
    });
    await recarregar(r.mensagem);
  } catch (x) {
    erroAcao.value = x;
  }
}
const soroMarco = ref<string | null>(null);
const soroData = ref<string | null>(null);
const soroResultado = ref<ResultadoSorologia | null>(null);
async function gravarSorologia(): Promise<void> {
  if (!d.value || !soroMarco.value || !soroResultado.value) return;
  erroAcao.value = null;
  try {
    const r = await registrarSorologia(d.value.id, {
      marco: soroMarco.value as never,
      realizada: soroResultado.value === 'nao-realizada' ? null : soroData.value,
      resultado: soroResultado.value,
      observacao: null,
    });
    soroMarco.value = null;
    soroResultado.value = null;
    soroData.value = null;
    await recarregar(r.mensagem);
  } catch (x) {
    erroAcao.value = x;
  }
}
const tipoCat = ref<number | null>(null);
const iniciativa = ref<number | null>(null);
const numeroCat = ref('');
const emitidaEm = ref<string | null>(null);
const entradaCat = computed(() =>
  esquemaEmitirCat.safeParse({
    acidente: d.value?.id ?? 0,
    versao: d.value?.versao ?? 0,
    tipoCat: tipoCat.value ?? -1,
    iniciativa: iniciativa.value,
    numero: numeroCat.value.trim(),
    emitidaEm: emitidaEm.value ?? '',
  }),
);
async function gravarCat(): Promise<void> {
  if (!d.value || !entradaCat.value.success) return;
  erroAcao.value = null;
  try {
    const c = entradaCat.value.data;
    const r = await emitirCat(d.value.id, {
      versao: c.versao,
      tipoCat: c.tipoCat,
      iniciativa: c.iniciativa,
      numero: c.numero,
      emitidaEm: c.emitidaEm,
      cat: c.cat,
    });
    numeroCat.value = '';
    await recarregar(r.mensagem);
  } catch (x) {
    erroAcao.value = x;
  }
}
const motivoFim = ref('');
const entradaFim = computed(() =>
  esquemaEncerrarAcidente.safeParse({
    acidente: d.value?.id ?? 0,
    versao: d.value?.versao ?? 0,
    motivo: motivoFim.value.trim(),
  }),
);
async function gravarFim(): Promise<void> {
  if (!d.value || !entradaFim.value.success) return;
  erroAcao.value = null;
  try {
    const r = await encerrarAcidente(d.value.id, {
      versao: d.value.versao,
      motivo: entradaFim.value.data.motivo,
    });
    motivoFim.value = '';
    await recarregar(r.mensagem);
  } catch (x) {
    erroAcao.value = x;
  }
}
// ── W0-06: retificar e anular o acidente e a CAT, e o S-2210 na fila do eSocial (nada sai do dev) ──────────
const dlgRetificar = ref(false);
const dlgAnular = ref(false);
const efeitoEsocial = ref<string | null>(null);
watch(aberto, () => (efeitoEsocial.value = null));
function textoEfeito(e: EfeitoEsocialSesmt | undefined): string | null {
  if (!e || e.operacao === 'nenhuma') return null;
  const base = t(`sesmt.cat.efeito.${e.operacao}`, { e: e.evento ?? '', a: e.anterior ?? '' });
  const pend = e.pendencias.map((p) => p.mensagem).join('; ');
  return pend ? `${base} ${t('sesmt.cat.efeito.pendencias', { p: pend })}` : base;
}
async function aposCorrecao(r: ResultadoSesmt): Promise<void> {
  efeitoEsocial.value = textoEfeito(r.esocial);
  await recarregar(r.mensagem);
}
const anular = (motivo: string) => anularAcidente(d.value!.id, { versao: d.value!.versao, motivo });
const empresaCat = ref<number | null>(null);
const opcoesEmpresa = computed(() =>
  (d.value?.esocial?.empresas ?? []).map((e) => ({ valor: e.codigo, rotulo: e.rotulo })),
);
/** Gera o S-2210 original quando não há nenhum vivo na fila (o descartado e o substituído ficam só no histórico). */
const podeGerarCat = computed(
  () =>
    !!d.value?.esocial &&
    d.value.anuladoEm === null &&
    d.value.esocial.eventos.every((e) => e.situacao === 'descartado' || e.situacao === 'substituido'),
);
async function gerarCat(): Promise<void> {
  const empresa = empresaCat.value ?? d.value?.esocial?.empresas[0]?.codigo ?? null;
  if (!d.value || empresa === null) return;
  erroAcao.value = null;
  try {
    const r = await gerarCatEsocial(d.value.id, empresa);
    const ev = r.eventos[0];
    efeitoEsocial.value =
      r.gravado && ev?.id
        ? t('sesmt.cat.efeito.original', { e: ev.id })
        : t('sesmt.cat.efeito.pendencias', { p: (ev?.pendencias ?? []).map((p) => p.mensagem).join('; ') });
    await recarregar(t('sesmt.cat.filaAtualizada'));
  } catch (x) {
    erroAcao.value = x;
  }
}

const marcosAbertos = computed(() =>
  (d.value?.sorologias ?? [])
    .filter((s) => s.resultado === null)
    .map((s) => ({ valor: s.marco, rotulo: s.marcoRotulo })),
);
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="sesmt-cat-titulo" data-testid="tela-sesmt-cat">
    <h1 id="sesmt-cat-titulo">{{ t('sesmt.cat.titulo') }}</h1>
    <p>{{ t('sesmt.cat.subtitulo') }}</p>
    <ErroPessoas v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('sesmt.carregando') }}</p>
    <template v-else>
      <SanteAlerta v-if="!a.gravacao.ligada" :texto="a.gravacao.motivo ?? ''" variante="info" />
      <SanteAlerta v-else-if="!a.acoes.acidente" :texto="t('sesmt.soConsulta')" variante="info" />
      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="sesmt-aviso" />

      <section class="bloco" aria-labelledby="sesmt-acidentes" data-testid="lista-acidentes">
        <h2 id="sesmt-acidentes">{{ t('sesmt.cat.lista') }}</h2>
        <div class="campos">
          <SanteSelecao
            v-model="estado"
            :rotulo="t('sesmt.cat.estado')"
            :opcoes="opcoesEstado"
            data-testid="acidentes-estado"
          />
          <SanteBotao
            v-if="a.acoes.acidente && !registrando"
            :rotulo="t('sesmt.cat.novo')"
            data-testid="novo-acidente"
            @acionar="registrando = true"
          />
        </div>
        <ErroPessoas v-if="lista.isError.value" :erro="lista.error.value" />
        <p v-else-if="!lista.data.value" role="status">{{ t('sesmt.carregando') }}</p>
        <p v-else-if="lista.data.value.itens.length === 0">{{ t('sesmt.nenhum') }}</p>
        <table v-else class="tabela" data-testid="tabela-acidentes">
          <thead>
            <tr>
              <th scope="col">{{ t('sesmt.cat.colunas.quando') }}</th>
              <th scope="col">{{ t('sesmt.cat.colunas.colaborador') }}</th>
              <th scope="col">{{ t('sesmt.cat.colunas.tipo') }}</th>
              <th scope="col">{{ t('sesmt.cat.colunas.cat') }}</th>
              <th scope="col">{{ t('sesmt.pendencias') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in lista.data.value.itens" :key="x.id" :data-testid="`acidente-${x.id}`">
              <th scope="row">
                <SanteBotao
                  :rotulo="instanteBr(x.ocorridoEm)"
                  variante="texto"
                  :data-testid="`abrir-acidente-${x.id}`"
                  @acionar="aberto = x.id"
                />
              </th>
              <td>{{ x.nome }}</td>
              <td>
                {{ TIPOS_ACIDENTE[x.tipo] }}<span v-if="x.biologico"> · {{ t('sesmt.cat.biologico') }}</span>
              </td>
              <td>
                {{ x.catNumero ? x.catNumero : t('sesmt.cat.catPendente', { d: dataBr(x.catPrazo) }) }}
              </td>
              <td><PendenciasSesmt :pendencias="x.pendencias" /></td>
            </tr>
          </tbody>
        </table>
      </section>

      <form
        v-if="registrando"
        class="bloco"
        :aria-label="t('sesmt.cat.novo')"
        data-testid="form-acidente"
        @submit.prevent="gravarNovo"
      >
        <h2>{{ t('sesmt.cat.novo') }}</h2>
        <SeletorColaborador v-model="colaborador" tela="cat" />
        <div class="campos">
          <SanteData v-model="dataAcidente" :rotulo="t('sesmt.data')" editavel data-testid="acidente-data" />
          <SanteHora v-model="horaAcidente" :rotulo="t('sesmt.hora')" editavel data-testid="acidente-hora" />
          <SanteSelecao
            v-model="tipo"
            :rotulo="t('sesmt.cat.tipo')"
            :opcoes="opcoesTipo"
            data-testid="acidente-tipo"
          />
          <SanteSelecao
            v-model="unidade"
            :rotulo="t('sesmt.cat.unidade')"
            :opcoes="opcoesDominio(a.dominios.unidades)"
            busca
            data-testid="acidente-unidade"
          />
          <SanteCampoTexto
            v-model="local"
            :rotulo="t('sesmt.cat.local')"
            :max-bytes="80"
            data-testid="acidente-local"
          />
        </div>
        <SanteCampoTexto
          v-model="descricao"
          :rotulo="t('sesmt.cat.descricao')"
          :max-bytes="1000"
          multilinha
          data-testid="acidente-descricao"
        />
        <div class="acoes">
          <label class="marca"
            ><input v-model="biologico" type="checkbox" data-testid="acidente-biologico" />{{
              t('sesmt.cat.biologico')
            }}</label
          >
          <label class="marca"
            ><input v-model="perfurocortante" type="checkbox" data-testid="acidente-perfuro" />{{
              t('sesmt.cat.perfurocortante')
            }}</label
          >
          <label class="marca"
            ><input v-model="afastamento" type="checkbox" data-testid="acidente-afastamento" />{{
              t('sesmt.cat.afastamento')
            }}</label
          >
          <label class="marca"
            ><input v-model="obito" type="checkbox" data-testid="acidente-obito" />{{
              t('sesmt.cat.obito')
            }}</label
          >
        </div>
        <fieldset v-if="biologico" class="bloco">
          <legend>{{ t('sesmt.cat.biologico') }}</legend>
          <p class="secundario">{{ t('sesmt.cat.fonteAviso') }}</p>
          <div class="campos">
            <SanteSelecao
              v-model="exposicao"
              :rotulo="t('sesmt.cat.exposicao')"
              :opcoes="opcoesExposicao"
              data-testid="acidente-exposicao"
            />
            <SanteSelecao
              v-model="material"
              :rotulo="t('sesmt.cat.material')"
              :opcoes="opcoesMaterial"
              data-testid="acidente-material"
            />
            <SanteSelecao
              v-model="fonte"
              :rotulo="t('sesmt.cat.fonte')"
              :opcoes="opcoesFonte"
              data-testid="acidente-fonte"
            />
            <SanteSelecao
              v-model="fonteTeste"
              :rotulo="t('sesmt.cat.fonteTeste')"
              :opcoes="opcoesTeste"
              data-testid="acidente-fonte-teste"
            />
          </div>
        </fieldset>
        <div class="campos">
          <SanteSelecao
            v-model="parteCorpo"
            :rotulo="t('sesmt.cat.parteCorpo')"
            :opcoes="opcoesDominio(a.dominios.partesCorpo)"
            busca
            data-testid="acidente-parte-corpo"
          />
          <SanteSelecao
            v-model="natureza"
            :rotulo="t('sesmt.cat.natureza')"
            :opcoes="opcoesDominio(a.dominios.naturezas)"
            busca
            data-testid="acidente-natureza"
          />
          <SanteSelecao
            v-model="agente"
            :rotulo="t('sesmt.cat.agente')"
            :opcoes="opcoesDominio(a.dominios.agentes)"
            busca
            data-testid="acidente-agente"
          />
          <SanteSelecao
            v-model="situacao"
            :rotulo="t('sesmt.cat.situacaoGeradora')"
            :opcoes="opcoesDominio(a.dominios.situacoes)"
            busca
            data-testid="acidente-situacao"
          />
        </div>
        <ErroPessoas v-if="erroNovo" :erro="erroNovo" />
        <div class="acoes">
          <SanteBotao :rotulo="t('sesmt.cancelar')" variante="texto" @acionar="registrando = false" />
          <SanteBotao
            :rotulo="t('sesmt.gravar')"
            tipo="submit"
            :desabilitado="!entradaNova.success"
            data-testid="acidente-gravar"
          />
        </div>
      </form>

      <section
        v-if="aberto !== null"
        class="bloco"
        aria-labelledby="sesmt-acidente-detalhe"
        data-testid="detalhe-acidente"
      >
        <SanteAlerta :texto="t('sesmt.leituraAuditada')" variante="info" />
        <ErroPessoas v-if="detalhe.isError.value" :erro="detalhe.error.value" />
        <p v-else-if="!d" role="status">{{ t('sesmt.carregando') }}</p>
        <template v-else>
          <h2 id="sesmt-acidente-detalhe">
            {{ t('sesmt.cat.detalhe', { id: d.id }) }} · {{ d.colaborador.nome }}
          </h2>
          <PendenciasSesmt :pendencias="d.pendencias" />
          <dl class="dados">
            <dt>{{ t('sesmt.cat.ocorridoEm') }}</dt>
            <dd>{{ instanteBr(d.ocorridoEm) }} · {{ TIPOS_ACIDENTE[d.tipo] }}</dd>
            <dt>{{ t('sesmt.cat.local') }}</dt>
            <dd>{{ d.local }}</dd>
            <dt>{{ t('sesmt.cat.descricao') }}</dt>
            <dd>{{ d.descricao }}</dd>
            <template v-if="d.biologico">
              <dt>{{ t('sesmt.cat.exposicao') }}</dt>
              <dd>
                {{ d.exposicao ? EXPOSICOES_BIOLOGICAS[d.exposicao] : '—' }} ·
                {{ d.material ? MATERIAIS_BIOLOGICOS[d.material] : '—' }} ·
                {{ d.fonte ? FONTES_EXPOSICAO[d.fonte] : '—' }}
              </dd>
            </template>
            <dt>{{ t('sesmt.cat.parteCorpo') }}</dt>
            <dd>{{ rotuloDe(a.dominios.partesCorpo, d.parteCorpo) }}</dd>
            <dt>{{ t('sesmt.cat.natureza') }}</dt>
            <dd>{{ rotuloDe(a.dominios.naturezas, d.natureza) }}</dd>
            <dt>{{ t('sesmt.cat.profilaxia') }}</dt>
            <dd data-testid="acidente-profilaxia">
              {{ SITUACOES_PROFILAXIA[d.profilaxia] }}
              <span v-if="d.profilaxiaEm" class="secundario">{{ instanteBr(d.profilaxiaEm) }}</span>
            </dd>
            <dt>{{ t('sesmt.cat.colunas.cat') }}</dt>
            <dd data-testid="acidente-cat">
              {{
                d.catNumero
                  ? t('sesmt.cat.catEmitida', { n: d.catNumero, d: dataBr(d.catEmitidaEm) })
                  : t('sesmt.cat.catPendente', { d: dataBr(d.catPrazo) })
              }}
              <a
                v-if="d.catNumero"
                :href="urlCatPdf(d.id)"
                target="_blank"
                rel="noopener"
                data-testid="cat-pdf"
                >{{ t('sesmt.cat.pdf') }}</a
              >
            </dd>
            <template v-if="d.anuladoEm">
              <dt>{{ t('sesmt.cat.estado') }}</dt>
              <dd data-testid="acidente-anulado">
                {{
                  t('sesmt.cat.anuladoEm', {
                    d: instanteBr(d.anuladoEm),
                    p: d.anuladoPor ?? '',
                    m: d.motivoEncerramento ?? '',
                  })
                }}
              </dd>
            </template>
            <template v-else-if="d.estado === 'encerrado'">
              <dt>{{ t('sesmt.cat.estado') }}</dt>
              <dd>
                {{
                  t('sesmt.cat.encerrado', { d: instanteBr(d.encerradoEm ?? ''), m: d.motivoEncerramento })
                }}
              </dd>
            </template>
          </dl>
          <section v-if="d.sorologias.length" aria-labelledby="sesmt-soro" data-testid="sorologias">
            <h2 id="sesmt-soro">{{ t('sesmt.cat.sorologia') }}</h2>
            <table class="tabela">
              <thead>
                <tr>
                  <th scope="col">{{ t('sesmt.cat.marco') }}</th>
                  <th scope="col">{{ t('sesmt.cat.prevista') }}</th>
                  <th scope="col">{{ t('sesmt.cat.realizada') }}</th>
                  <th scope="col">{{ t('sesmt.cat.resultadoSorologia') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in d.sorologias" :key="s.id" :data-testid="`sorologia-${s.marco}`">
                  <th scope="row">{{ s.marcoRotulo }}</th>
                  <td>
                    {{ dataBr(s.prevista) }}
                    <span v-if="s.atrasada" class="secundario">{{ t('sesmt.cat.atrasada') }}</span>
                  </td>
                  <td>{{ dataBr(s.realizada) }}</td>
                  <td>{{ s.resultado ? RESULTADOS_SOROLOGIA[s.resultado] : '' }}</td>
                </tr>
              </tbody>
            </table>
          </section>
          <template v-if="a.acoes.acidente && d.estado === 'aberto'">
            <p class="secundario">
              {{ t('sesmt.cat.profilaxiaSugerida', { s: SITUACOES_PROFILAXIA[d.profilaxiaSugerida] }) }}
            </p>
            <form
              v-if="d.biologico"
              class="campos"
              :aria-label="t('sesmt.cat.profilaxia')"
              @submit.prevent="gravarProfilaxia"
            >
              <SanteSelecao
                v-model="profilaxia"
                :rotulo="t('sesmt.cat.profilaxia')"
                :opcoes="opcoesProfilaxia"
                data-testid="profilaxia-situacao"
              />
              <SanteData
                v-model="profData"
                :rotulo="t('sesmt.cat.profilaxiaEm')"
                editavel
                data-testid="profilaxia-data"
              />
              <SanteHora
                v-model="profHora"
                :rotulo="t('sesmt.hora')"
                editavel
                data-testid="profilaxia-hora"
              />
              <SanteBotao
                :rotulo="t('sesmt.gravar')"
                tipo="submit"
                variante="secundario"
                :desabilitado="!profilaxia"
                data-testid="profilaxia-gravar"
              />
            </form>
            <form
              v-if="marcosAbertos.length"
              class="campos"
              :aria-label="t('sesmt.cat.sorologia')"
              @submit.prevent="gravarSorologia"
            >
              <SanteSelecao
                v-model="soroMarco"
                :rotulo="t('sesmt.cat.marco')"
                :opcoes="marcosAbertos"
                data-testid="sorologia-marco"
              />
              <SanteData
                v-model="soroData"
                :rotulo="t('sesmt.cat.realizada')"
                editavel
                data-testid="sorologia-data"
              />
              <SanteSelecao
                v-model="soroResultado"
                :rotulo="t('sesmt.cat.resultadoSorologia')"
                :opcoes="opcoesResultado"
                data-testid="sorologia-resultado"
              />
              <SanteBotao
                :rotulo="t('sesmt.cat.registrarSorologia')"
                tipo="submit"
                variante="secundario"
                :desabilitado="!soroMarco || !soroResultado"
                data-testid="sorologia-gravar"
              />
            </form>
            <form
              class="bloco"
              :aria-label="t('sesmt.cat.emitirCat')"
              data-testid="form-cat"
              @submit.prevent="gravarCat"
            >
              <h2>{{ t('sesmt.cat.emitirCat') }}</h2>
              <div class="campos">
                <SanteSelecao
                  v-model="tipoCat"
                  :rotulo="t('sesmt.cat.tipoCat')"
                  :opcoes="opcoesDominio(a.dominios.tiposCat)"
                  data-testid="cat-tipo"
                />
                <SanteSelecao
                  v-model="iniciativa"
                  :rotulo="t('sesmt.cat.iniciativa')"
                  :opcoes="opcoesDominio(a.dominios.iniciativasCat)"
                  data-testid="cat-iniciativa"
                />
                <SanteCampoTexto
                  v-model="numeroCat"
                  :rotulo="t('sesmt.cat.numero')"
                  :max-bytes="30"
                  data-testid="cat-numero"
                />
                <SanteData
                  v-model="emitidaEm"
                  :rotulo="t('sesmt.cat.emitidaEm')"
                  editavel
                  data-testid="cat-emitida-em"
                />
                <SanteBotao
                  :rotulo="t('sesmt.gravar')"
                  tipo="submit"
                  :desabilitado="!entradaCat.success"
                  data-testid="cat-gravar"
                />
              </div>
            </form>
            <form class="campos" :aria-label="t('sesmt.cat.encerrar')" @submit.prevent="gravarFim">
              <SanteCampoTexto
                v-model="motivoFim"
                :rotulo="t('sesmt.motivo')"
                :max-bytes="400"
                data-testid="acidente-motivo-fim"
              />
              <SanteBotao
                :rotulo="t('sesmt.cat.encerrar')"
                tipo="submit"
                variante="secundario"
                :desabilitado="!entradaFim.success"
                data-testid="acidente-encerrar"
              />
            </form>
          </template>
          <SanteAlerta
            v-if="efeitoEsocial"
            :texto="efeitoEsocial"
            variante="info"
            anunciar
            data-testid="acidente-efeito-esocial"
          />
          <section
            v-if="d.esocial"
            class="bloco"
            aria-labelledby="sesmt-fila-cat"
            data-testid="acidente-fila"
          >
            <h3 id="sesmt-fila-cat">{{ t('sesmt.cat.fila') }}</h3>
            <p class="secundario">{{ t('sesmt.cat.filaAjuda') }}</p>
            <p v-if="d.esocial.eventos.length === 0" class="secundario">{{ t('sesmt.cat.semFila') }}</p>
            <ul v-else>
              <li v-for="e in d.esocial.eventos" :key="e.id" :data-testid="`fila-evento-${e.id}`">
                {{
                  t('sesmt.cat.filaLinha', {
                    evento: e.evento,
                    id: e.id,
                    situacao: e.situacao,
                    em: instanteBr(e.em),
                  })
                }}
                <span v-if="e.anterior" class="secundario">
                  · {{ t('sesmt.cat.filaRetifica', { id: e.anterior }) }}</span
                >
                <span v-if="e.recibo" class="secundario">
                  · {{ t('sesmt.cat.filaRecibo', { r: e.recibo }) }}</span
                >
              </li>
            </ul>
            <div v-if="a.acoes.acidente && podeGerarCat" class="campos">
              <SanteSelecao
                v-if="opcoesEmpresa.length > 1"
                v-model="empresaCat"
                :rotulo="t('sesmt.cat.empresa')"
                :opcoes="opcoesEmpresa"
                data-testid="cat-empresa"
              />
              <SanteBotao
                :rotulo="t('sesmt.cat.gerarS2210')"
                variante="secundario"
                :desabilitado="opcoesEmpresa.length === 0"
                data-testid="acidente-gerar-s2210"
                @acionar="gerarCat"
              />
            </div>
          </section>
          <HistoricoSesmt :correcoes="d.correcoes ?? []" testid="acidente-historico" />
          <ErroPessoas v-if="erroAcao" :erro="erroAcao" />
          <div class="acoes">
            <template v-if="a.acoes.acidente && !d.anuladoEm">
              <SanteBotao
                :rotulo="t('sesmt.cat.retificar')"
                variante="secundario"
                data-testid="acidente-retificar"
                @acionar="dlgRetificar = true"
              />
              <SanteBotao
                :rotulo="t('sesmt.cat.anular')"
                variante="secundario"
                data-testid="acidente-anular"
                @acionar="dlgAnular = true"
              />
            </template>
            <SanteBotao :rotulo="t('sesmt.fechar')" variante="texto" @acionar="aberto = null" />
          </div>
        </template>
        <RetificarAcidente
          v-if="d"
          v-model:visivel="dlgRetificar"
          :acidente="d"
          :apoio="a"
          @feito="aposCorrecao"
        />
        <DialogoMotivo
          v-if="d"
          v-model:visivel="dlgAnular"
          :titulo="t('sesmt.cat.anularTitulo', { id: d.id })"
          :texto="t('sesmt.cat.anularTexto')"
          :confirmar="t('sesmt.cat.anular')"
          :acao="anular"
          testid="dlg-anular-acidente"
          @feito="(r) => aposCorrecao(r as ResultadoSesmt)"
        />
      </section>
    </template>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
