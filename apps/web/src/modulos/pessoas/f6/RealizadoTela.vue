<script setup lang="ts">
// Plantão realizado e o relatório ao repasse (M52.6; item `Gestão de pessoas > Escala de plantão (médica e de
// enfermagem)`; `pessoas.realizado.ler` / `.registrar` / `.aprovar` / `.lancar`; ficha, seção 5; DP-33): os plantões
// da escala publicada da competência com o horário real (sugerido pelas marcações do ponto), aprovado por OUTRA pessoa
// da coordenação (nunca o próprio plantão); o relatório dos realizados aprovados do prestador com as contas, em PDF e
// CSV, e o lançamento no repasse (desligado até a DP-33, com o motivo); e as tarifas por hora.
import {
  type LinhaRealizado,
  ORIGENS_REALIZADO,
  SITUACOES_REALIZADO,
  TIPOS_PLANTAO,
  TIPOS_VINCULO,
} from '@sgh/contratos';
import {
  SanteAlerta,
  SanteBotao,
  SanteCampoTexto,
  SanteData,
  SanteHora,
  SanteOpcoes,
  SanteSelecao,
} from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { dataBr } from '../comum.js';
import {
  decidirRealizado,
  encerrarTarifa,
  estornarRealizado,
  incluirTarifa,
  lancarNoRepasse,
  lerApoioRealizado,
  lerRealizado,
  lerRelatorio,
  lerSugestao,
  lerTarifas,
  registrarRealizado,
  urlRelatorioCsv,
  urlRelatorioPdf,
} from './api-f6.js';

const { t } = useI18n();

/** Data e hora do instante (dd/mm/aaaa hh:mm). */
function dh(iso: string): string {
  return `${dataBr(iso)} ${iso.slice(11, 16)}`;
}
const cliente = useQueryClient();
const apoio = useQuery({ queryKey: ['f6', 'realizado', 'apoio'], queryFn: lerApoioRealizado });
const a = computed(() => apoio.data.value ?? null);
type Aba = 'plantoes' | 'repasse' | 'tarifas';
const aba = ref<Aba>('plantoes');
const abas: Aba[] = ['plantoes', 'repasse', 'tarifas'];
const hoje = new Date();
const competencia = ref(`${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`);
const competenciaAplicada = ref(competencia.value);
const unidade = ref<number | null>(null);
const situacao = ref<string>('todos');
const valida = computed(() => /^\d{4}-(0[1-9]|1[0-2])$/.test(competenciaAplicada.value));
const opcoesUnidade = computed(() => [
  { valor: null, rotulo: t('f6.realizado.todas') },
  ...(a.value?.unidades ?? []).map((u) => ({ valor: u.codigo as number | null, rotulo: u.rotulo })),
]);
const opcoesSituacao = computed(() => [
  { valor: 'todos', rotulo: t('f6.realizado.todos') },
  { valor: 'semRealizado', rotulo: t('f6.realizado.semRealizado') },
  ...(['informado', 'aprovado', 'recusado'] as const).map((s) => ({
    valor: s as string,
    rotulo: SITUACOES_REALIZADO[s],
  })),
]);
const lista = useQuery({
  queryKey: computed(() => ['f6', 'realizado', competenciaAplicada.value, unidade.value, situacao.value]),
  queryFn: () =>
    lerRealizado({
      competencia: competenciaAplicada.value,
      ...(unidade.value !== null ? { unidade: unidade.value } : {}),
      situacao: situacao.value,
    }),
  enabled: computed(() => valida.value && aba.value === 'plantoes'),
});
const l = computed(() => lista.data.value ?? null);
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);
const atualizar = () => cliente.invalidateQueries({ queryKey: ['f6', 'realizado'] });

// ── Registrar ─────────────────────────────────────────────────────────────────────────────────────────────────
const linha = ref<LinhaRealizado | null>(null);
const iniDia = ref<string | null>(null);
const iniHora = ref<string | null>(null);
const fimDia = ref<string | null>(null);
const fimHora = ref<string | null>(null);
const origem = ref<'informado' | 'ponto'>('informado');
const obs = ref('');
const sugestaoTexto = ref<string | null>(null);
function abrirRegistro(x: LinhaRealizado): void {
  linha.value = x;
  decidindo.value = null;
  const base = x.realizado ?? { inicio: x.previstoInicio, fim: x.previstoFim };
  iniDia.value = base.inicio.slice(0, 10);
  iniHora.value = base.inicio.slice(11, 16);
  fimDia.value = base.fim.slice(0, 10);
  fimHora.value = base.fim.slice(11, 16);
  origem.value = 'informado';
  obs.value = '';
  sugestaoTexto.value = null;
  erro.value = null;
}
async function sugerir(): Promise<void> {
  if (!linha.value) return;
  erro.value = null;
  try {
    const s = await lerSugestao(linha.value.plantao);
    if (!s.sugestao) {
      sugestaoTexto.value = t('f6.realizado.semSugestao');
      return;
    }
    iniDia.value = s.sugestao.inicio.slice(0, 10);
    iniHora.value = s.sugestao.inicio.slice(11, 16);
    fimDia.value = s.sugestao.fim.slice(0, 10);
    fimHora.value = s.sugestao.fim.slice(11, 16);
    origem.value = 'ponto';
    sugestaoTexto.value = t('f6.realizado.sugestao', {
      i: `${dataBr(s.sugestao.inicio)} ${s.sugestao.inicio.slice(11, 16)}`,
      f: `${dataBr(s.sugestao.fim)} ${s.sugestao.fim.slice(11, 16)}`,
    });
  } catch (x) {
    erro.value = x;
  }
}
// O SanteHora guarda "HH:MM"; o instante da API é AAAA-MM-DDTHH:MM.
const instante = (d: string | null, h: string | null) => (d && h ? `${d}T${h}` : '');
const podeRegistrar = computed(() => !!(iniDia.value && iniHora.value && fimDia.value && fimHora.value));
async function gravarRegistro(): Promise<void> {
  if (!linha.value || !podeRegistrar.value) return;
  erro.value = null;
  try {
    const r = await registrarRealizado({
      plantao: linha.value.plantao,
      inicio: instante(iniDia.value, iniHora.value),
      fim: instante(fimDia.value, fimHora.value),
      origem: origem.value,
      observacao: obs.value.trim() || null,
    });
    aviso.value = r.mensagem;
    linha.value = null;
    await atualizar();
  } catch (x) {
    erro.value = x;
  }
}

// ── Decidir ───────────────────────────────────────────────────────────────────────────────────────────────────
const decidindo = ref<LinhaRealizado | null>(null);
const decisao = ref<'aprovar' | 'recusar'>('aprovar');
const motivo = ref('');
const opcoesDecisao = computed(() => [
  { valor: 'aprovar' as const, rotulo: t('f6.realizado.aprovar') },
  { valor: 'recusar' as const, rotulo: t('f6.realizado.recusar') },
]);
function abrirDecisao(x: LinhaRealizado): void {
  decidindo.value = x;
  linha.value = null;
  decisao.value = 'aprovar';
  motivo.value = '';
  erro.value = null;
}
async function gravarDecisao(): Promise<void> {
  const r0 = decidindo.value?.realizado;
  if (!r0) return;
  if (decisao.value === 'recusar' && motivo.value.trim().length < 10) return;
  erro.value = null;
  try {
    const r = await decidirRealizado(
      r0.id,
      decisao.value,
      r0.versao,
      decisao.value === 'recusar' ? motivo.value.trim() : null,
    );
    aviso.value = r.mensagem;
    decidindo.value = null;
    await atualizar();
  } catch (x) {
    erro.value = x;
  }
}

// W0-06: estorno do realizado aprovado, com o motivo (o 409 da competência apurada aparece no diálogo, com o caminho
// da devolução da apuração).
const estornando = ref<LinhaRealizado | null>(null);
const dialogoEstorno = computed({
  get: () => estornando.value !== null,
  set: (v: boolean) => {
    if (!v) estornando.value = null;
  },
});
async function estornar(motivoEstorno: string): Promise<unknown> {
  const r0 = estornando.value?.realizado;
  if (!r0) return null;
  const r = await estornarRealizado(r0.id, r0.versao, motivoEstorno);
  aviso.value = r.mensagem;
  await atualizar();
  return r;
}

// ── Relatório ao repasse ──────────────────────────────────────────────────────────────────────────────────────
const relatorio = useQuery({
  queryKey: computed(() => ['f6', 'realizado', 'repasse', competenciaAplicada.value]),
  queryFn: () => lerRelatorio(competenciaAplicada.value),
  enabled: computed(() => valida.value && aba.value === 'repasse'),
});
const rel = computed(() => relatorio.data.value ?? null);
async function lancar(prestador: number, registro: number, realizados: readonly number[]): Promise<void> {
  erro.value = null;
  try {
    aviso.value = (
      await lancarNoRepasse(competenciaAplicada.value, prestador, registro, realizados)
    ).mensagem;
    await atualizar();
  } catch (x) {
    erro.value = x;
  }
}
const horas = (m: number) => `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
const reais = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Tarifas ───────────────────────────────────────────────────────────────────────────────────────────────────
const tarifas = useQuery({
  queryKey: ['f6', 'realizado', 'tarifas'],
  queryFn: lerTarifas,
  enabled: computed(() => aba.value === 'tarifas'),
});
const tipoTarifa = ref<'presencial' | 'sobreaviso' | 'diarista'>('presencial');
const unidadeTarifa = ref<number | null>(null);
const inicioTarifa = ref<string | null>(null);
const fimTarifa = ref<string | null>(null);
const valorTarifa = ref('');
const opcoesTipo = (['presencial', 'sobreaviso', 'diarista'] as const).map((x) => ({
  valor: x,
  rotulo: TIPOS_PLANTAO[x],
}));
const valorNumero = computed(() => Number(valorTarifa.value.replace('.', '').replace(',', '.')));
async function gravarTarifa(): Promise<void> {
  if (!inicioTarifa.value || !(valorNumero.value > 0)) return;
  erro.value = null;
  try {
    aviso.value = (
      await incluirTarifa({
        tipo: tipoTarifa.value,
        unidade: unidadeTarifa.value,
        inicio: inicioTarifa.value,
        fim: fimTarifa.value,
        valorHora: valorNumero.value,
      })
    ).mensagem;
    valorTarifa.value = '';
    await atualizar();
  } catch (x) {
    erro.value = x;
  }
}
const encerrando = ref<number | null>(null);
const fimEncerrar = ref<string | null>(null);
async function gravarEncerramento(): Promise<void> {
  if (encerrando.value === null || !fimEncerrar.value) return;
  erro.value = null;
  try {
    aviso.value = (await encerrarTarifa(encerrando.value, fimEncerrar.value)).mensagem;
    encerrando.value = null;
    await atualizar();
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="real-titulo" data-testid="tela-realizado">
    <h1 id="real-titulo">{{ t('f6.realizado.titulo') }}</h1>
    <p>{{ t('f6.realizado.subtitulo') }}</p>
    <ErroPessoas v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('f6.carregando') }}</p>
    <template v-else>
      <SanteAlerta v-if="!a.gravacao.ligada" :texto="a.gravacao.motivo ?? ''" variante="info" />
      <SanteAlerta v-else-if="a.acoes.motivo" :texto="a.acoes.motivo" variante="info" />
      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="realizado-aviso" />
      <ErroPessoas v-if="erro" :erro="erro" />
      <form class="campos" @submit.prevent="competenciaAplicada = competencia.trim()">
        <SanteCampoTexto
          v-model="competencia"
          :rotulo="t('f6.realizado.competencia')"
          :max-bytes="7"
          data-testid="realizado-competencia"
        />
        <SanteSelecao
          v-model="unidade"
          :rotulo="t('f6.realizado.unidade')"
          :opcoes="opcoesUnidade"
          data-testid="realizado-unidade"
        />
        <SanteBotao
          :rotulo="t('f6.buscar')"
          tipo="submit"
          variante="secundario"
          data-testid="realizado-buscar"
        />
      </form>
      <div class="acoes" role="tablist">
        <SanteBotao
          v-for="x in abas"
          :key="x"
          role="tab"
          :aria-selected="aba === x"
          :variante="aba === x ? 'primario' : 'secundario'"
          :rotulo="t(`f6.realizado.abas.${x}`)"
          :data-testid="`realizado-aba-${x}`"
          @acionar="aba = x"
        />
      </div>

      <section
        v-if="aba === 'plantoes'"
        class="bloco"
        aria-labelledby="real-plantoes"
        data-testid="realizado-plantoes"
      >
        <h2 id="real-plantoes">{{ t('f6.realizado.abas.plantoes') }}</h2>
        <SanteSelecao
          v-model="situacao"
          :rotulo="t('f6.realizado.situacao')"
          :opcoes="opcoesSituacao"
          data-testid="realizado-situacao"
        />
        <ErroPessoas v-if="lista.isError.value" :erro="lista.error.value" />
        <p v-else-if="!l" role="status">{{ t('f6.carregando') }}</p>
        <template v-else>
          <p data-testid="realizado-contagem">
            {{
              t('f6.realizado.contagem', {
                p: l.contagem.plantoes,
                s: l.contagem.semRealizado,
                a: l.contagem.aguardando,
                ap: l.contagem.aprovados,
                r: l.contagem.recusados,
              })
            }}
          </p>
          <p v-if="l.limitado" class="secundario">{{ t('f6.limitado') }}</p>
          <p v-if="l.itens.length === 0">{{ t('f6.nenhum') }}</p>
          <table v-else class="tabela">
            <thead>
              <tr>
                <th scope="col">{{ t('f6.realizado.colaborador') }}</th>
                <th scope="col">{{ t('f6.realizado.previsto') }}</th>
                <th scope="col">{{ t('f6.realizado.real') }}</th>
                <th scope="col">{{ t('f6.realizado.valor') }}</th>
                <th scope="col"><span class="secundario">—</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in l.itens" :key="x.plantao" :data-testid="`realizado-${x.plantao}`">
                <th scope="row">
                  {{ x.nome }}
                  <div class="secundario">
                    {{ TIPOS_VINCULO[x.tipoVinculo as keyof typeof TIPOS_VINCULO] ?? x.tipoVinculo }} ·
                    {{ TIPOS_PLANTAO[x.tipoPlantao as keyof typeof TIPOS_PLANTAO] ?? x.tipoPlantao }} ·
                    {{ x.unidadeNome ?? '' }}
                  </div>
                </th>
                <td>
                  {{ t('f6.faixa', { inicio: dh(x.previstoInicio), fim: dh(x.previstoFim) }) }}
                </td>
                <td>
                  <template v-if="x.realizado">
                    {{ t('f6.faixa', { inicio: dh(x.realizado.inicio), fim: dh(x.realizado.fim) }) }} ({{
                      horas(x.realizado.minutos)
                    }})
                    <div class="secundario">
                      {{ SITUACOES_REALIZADO[x.realizado.situacao] }} ·
                      {{ ORIGENS_REALIZADO[x.realizado.origem] }} ·
                      {{ t('f6.realizado.informado', { por: x.realizado.informadoPor }) }}
                      <template v-if="x.realizado.decididoPor">
                        · {{ t('f6.realizado.decidido', { por: x.realizado.decididoPor }) }}</template
                      >
                      <template v-if="x.realizado.motivo && !x.realizado.estorno">
                        · {{ x.realizado.motivo }}</template
                      >
                    </div>
                    <div
                      v-if="x.realizado.estorno"
                      class="secundario"
                      :data-testid="`estorno-realizado-${x.plantao}`"
                    >
                      {{
                        t('f6.realizado.estornado', {
                          em: dh(x.realizado.estorno.em),
                          por: x.realizado.estorno.por,
                          motivo: x.realizado.estorno.motivo,
                        })
                      }}
                      <template v-if="x.realizado.estorno.lancamento">
                        ·
                        {{
                          t('f6.realizado.estornoLancado', { id: x.realizado.estorno.lancamento })
                        }}</template
                      >
                    </div>
                    <div
                      v-if="x.realizado.estornoPendente"
                      class="marca"
                      :data-testid="`estorno-pendente-${x.plantao}`"
                    >
                      {{ t('f6.realizado.estornoPendente') }}
                    </div>
                  </template>
                  <span v-else class="secundario">{{ t('f6.realizado.semRealizado') }}</span>
                </td>
                <td>
                  <template v-if="x.realizado?.parcelas">{{ x.realizado.parcelas }}</template>
                  <div v-if="x.realizado?.lancamento" class="secundario">
                    {{ t('f6.realizado.lancado', { id: x.realizado.lancamento }) }}
                  </div>
                </td>
                <td>
                  <SanteBotao
                    v-if="x.acoes.registrar"
                    :rotulo="t('f6.realizado.registrar')"
                    variante="texto"
                    :data-testid="`registrar-realizado-${x.plantao}`"
                    @acionar="abrirRegistro(x)"
                  />
                  <SanteBotao
                    v-if="x.acoes.decidir"
                    :rotulo="t('f6.realizado.aprovar')"
                    variante="texto"
                    :data-testid="`decidir-realizado-${x.plantao}`"
                    @acionar="abrirDecisao(x)"
                  />
                  <SanteBotao
                    v-if="x.acoes.estornar"
                    :rotulo="
                      x.realizado?.estornoPendente
                        ? t('f6.realizado.concluirEstorno')
                        : t('f6.realizado.estornar')
                    "
                    variante="texto"
                    :data-testid="`estornar-realizado-${x.plantao}`"
                    @acionar="estornando = x"
                  />
                  <span v-if="x.acoes.motivo && !x.acoes.decidir" class="secundario">{{
                    x.acoes.motivo
                  }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </template>
        <form
          v-if="linha"
          class="bloco"
          :aria-label="t('f6.realizado.registrarDe', { nome: linha.nome })"
          data-testid="form-realizado"
          @submit.prevent="gravarRegistro"
        >
          <h3>{{ t('f6.realizado.registrarDe', { nome: linha.nome }) }}</h3>
          <div class="campos">
            <SanteData
              v-model="iniDia"
              :rotulo="t('f6.realizado.inicioDia')"
              editavel
              data-testid="real-ini-dia"
            />
            <SanteHora
              v-model="iniHora"
              :rotulo="t('f6.realizado.inicioHora')"
              editavel
              data-testid="real-ini-hora"
            />
            <SanteData
              v-model="fimDia"
              :rotulo="t('f6.realizado.fimDia')"
              editavel
              data-testid="real-fim-dia"
            />
            <SanteHora
              v-model="fimHora"
              :rotulo="t('f6.realizado.fimHora')"
              editavel
              data-testid="real-fim-hora"
            />
          </div>
          <div class="acoes">
            <SanteBotao
              :rotulo="t('f6.realizado.sugerir')"
              variante="secundario"
              data-testid="real-sugerir"
              @acionar="sugerir"
            />
            <span v-if="sugestaoTexto" class="secundario" data-testid="real-sugestao">{{
              sugestaoTexto
            }}</span>
          </div>
          <SanteCampoTexto v-model="obs" :rotulo="t('f6.observacao')" :max-bytes="400" />
          <div class="acoes">
            <SanteBotao :rotulo="t('f6.cancelar')" variante="texto" @acionar="linha = null" />
            <SanteBotao
              :rotulo="t('f6.gravar')"
              tipo="submit"
              :desabilitado="!podeRegistrar"
              data-testid="real-gravar"
            />
          </div>
        </form>
        <form
          v-if="decidindo?.realizado"
          class="bloco"
          :aria-label="t('f6.realizado.decidir', { nome: decidindo.nome })"
          data-testid="form-decisao"
          @submit.prevent="gravarDecisao"
        >
          <h3>{{ t('f6.realizado.decidir', { nome: decidindo.nome }) }}</h3>
          <p>
            {{ t('f6.faixa', { inicio: dh(decidindo.realizado.inicio), fim: dh(decidindo.realizado.fim) }) }}
            ({{ horas(decidindo.realizado.minutos) }})
          </p>
          <SanteOpcoes
            v-model="decisao"
            :legenda="t('f6.realizado.decidir', { nome: decidindo.nome })"
            :opcoes="opcoesDecisao"
            data-testid="real-decisao"
          />
          <template v-if="decisao === 'recusar'">
            <SanteCampoTexto
              v-model="motivo"
              :rotulo="t('f6.motivo')"
              :max-bytes="400"
              data-testid="real-motivo"
            />
            <p class="secundario">{{ t('f6.motivoAjuda') }}</p>
          </template>
          <div class="acoes">
            <SanteBotao :rotulo="t('f6.cancelar')" variante="texto" @acionar="decidindo = null" />
            <SanteBotao
              :rotulo="t('f6.gravar')"
              tipo="submit"
              :desabilitado="decisao === 'recusar' && motivo.trim().length < 10"
              data-testid="real-decidir"
            />
          </div>
        </form>
      </section>

      <section
        v-else-if="aba === 'repasse'"
        class="bloco"
        aria-labelledby="real-repasse"
        data-testid="realizado-repasse"
      >
        <h2 id="real-repasse">{{ t('f6.realizado.abas.repasse') }}</h2>
        <ErroPessoas v-if="relatorio.isError.value" :erro="relatorio.error.value" />
        <p v-else-if="!rel" role="status">{{ t('f6.carregando') }}</p>
        <template v-else>
          <SanteAlerta
            v-if="!rel.repasse.ligado"
            :texto="t('f6.realizado.repasseDesligado', { motivo: rel.repasse.motivo ?? '' })"
            variante="info"
            data-testid="repasse-desligado"
          />
          <div class="acoes">
            <a
              :href="urlRelatorioPdf(rel.competencia)"
              target="_blank"
              rel="noopener"
              data-testid="repasse-pdf"
              >{{ t('f6.realizado.pdf') }}</a
            >
            <a :href="urlRelatorioCsv(rel.competencia)" data-testid="repasse-csv">{{
              t('f6.realizado.csv')
            }}</a>
          </div>
          <h3>{{ t('f6.realizado.aLancar') }}</h3>
          <p v-if="rel.grupos.length === 0">{{ t('f6.nenhum') }}</p>
          <table v-else class="tabela">
            <thead>
              <tr>
                <th scope="col">{{ t('f6.realizado.prestador') }}</th>
                <th scope="col">{{ t('f6.realizado.plantoesCol') }}</th>
                <th scope="col">{{ t('f6.realizado.horas') }}</th>
                <th scope="col">{{ t('f6.realizado.conta') }}</th>
                <th scope="col"><span class="secundario">—</span></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="g in rel.grupos"
                :key="`${g.prestador}-${g.competencia}`"
                :data-testid="`grupo-${g.prestador}`"
              >
                <th scope="row">
                  {{ g.nome }} <span class="secundario">{{ g.prestador }}</span>
                </th>
                <td>{{ g.plantoes }}</td>
                <td>{{ horas(g.minutos) }}</td>
                <td>{{ g.parcelas }}</td>
                <td>
                  <SanteBotao
                    v-if="rel.repasse.ligado && a.acoes.lancar"
                    :rotulo="t('f6.realizado.lancar')"
                    variante="secundario"
                    :data-testid="`lancar-${g.prestador}`"
                    @acionar="lancar(g.prestador, g.registro, g.realizados)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <p data-testid="repasse-total">{{ t('f6.realizado.total', { t: rel.total.parcelas }) }}</p>
          <h3>{{ t('f6.realizado.jaLancados') }}</h3>
          <p v-if="rel.lancados.length === 0">{{ t('f6.nenhum') }}</p>
          <ul v-else>
            <li v-for="x in rel.lancados" :key="x.realizado">
              {{ x.nome }} · {{ t('f6.realizado.lancado', { id: x.lancamento })
              }}<template v-if="x.valor !== null"> · {{ reais(x.valor) }}</template>
            </li>
          </ul>
          <h3>{{ t('f6.realizado.fora') }}</h3>
          <p v-if="rel.foraDoRepasse.length === 0">{{ t('f6.nenhum') }}</p>
          <ul v-else data-testid="repasse-fora">
            <li v-for="x in rel.foraDoRepasse" :key="x.realizado">{{ x.nome }}: {{ x.motivo }}</li>
          </ul>
          <p v-if="rel.limitado" class="secundario">{{ t('f6.limitado') }}</p>
        </template>
      </section>

      <section v-else class="bloco" aria-labelledby="real-tarifas" data-testid="realizado-tarifas">
        <h2 id="real-tarifas">{{ t('f6.realizado.abas.tarifas') }}</h2>
        <ErroPessoas v-if="tarifas.isError.value" :erro="tarifas.error.value" />
        <p v-else-if="!tarifas.data.value" role="status">{{ t('f6.carregando') }}</p>
        <template v-else>
          <p v-if="tarifas.data.value.itens.length === 0">{{ t('f6.realizado.tarifa.semTarifas') }}</p>
          <table v-else class="tabela">
            <thead>
              <tr>
                <th scope="col">{{ t('f6.realizado.tarifa.tipo') }}</th>
                <th scope="col">{{ t('f6.realizado.unidade') }}</th>
                <th scope="col">{{ t('f6.realizado.tarifa.vigencia') }}</th>
                <th scope="col">{{ t('f6.realizado.tarifa.valorHora') }}</th>
                <th scope="col"><span class="secundario">—</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in tarifas.data.value.itens" :key="x.id" :data-testid="`tarifa-${x.id}`">
                <th scope="row">{{ TIPOS_PLANTAO[x.tipo as keyof typeof TIPOS_PLANTAO] ?? x.tipo }}</th>
                <td>{{ x.unidadeNome ?? t('f6.realizado.todas') }}</td>
                <td>
                  {{ dataBr(x.inicio) }} ·
                  {{
                    x.fim
                      ? t('f6.realizado.tarifa.ate', { d: dataBr(x.fim) })
                      : t('f6.realizado.tarifa.semFim')
                  }}
                </td>
                <td>{{ reais(x.valorHora) }}</td>
                <td>
                  <SanteBotao
                    v-if="a.acoes.tarifa"
                    :rotulo="t('f6.realizado.tarifa.encerrar')"
                    variante="texto"
                    :data-testid="`encerrar-tarifa-${x.id}`"
                    @acionar="encerrando = x.id"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <form v-if="encerrando !== null" class="campos" @submit.prevent="gravarEncerramento">
            <SanteData
              v-model="fimEncerrar"
              :rotulo="t('f6.realizado.tarifa.fimEncerrar')"
              editavel
              data-testid="tarifa-fim-encerrar"
            />
            <SanteBotao
              :rotulo="t('f6.realizado.tarifa.encerrar')"
              tipo="submit"
              :desabilitado="!fimEncerrar"
            />
            <SanteBotao :rotulo="t('f6.cancelar')" variante="texto" @acionar="encerrando = null" />
          </form>
          <form
            v-if="a.acoes.tarifa"
            class="bloco"
            :aria-label="t('f6.realizado.tarifa.nova')"
            data-testid="form-tarifa"
            @submit.prevent="gravarTarifa"
          >
            <h3>{{ t('f6.realizado.tarifa.nova') }}</h3>
            <div class="campos">
              <SanteSelecao
                v-model="tipoTarifa"
                :rotulo="t('f6.realizado.tarifa.tipo')"
                :opcoes="opcoesTipo"
                data-testid="tarifa-tipo"
              />
              <SanteSelecao
                v-model="unidadeTarifa"
                :rotulo="t('f6.realizado.tarifa.unidade')"
                :opcoes="opcoesUnidade"
                data-testid="tarifa-unidade"
              />
              <SanteData
                v-model="inicioTarifa"
                :rotulo="t('f6.realizado.tarifa.inicio')"
                editavel
                data-testid="tarifa-inicio"
              />
              <SanteData
                v-model="fimTarifa"
                :rotulo="t('f6.realizado.tarifa.fim')"
                editavel
                data-testid="tarifa-fim"
              />
              <SanteCampoTexto
                v-model="valorTarifa"
                :rotulo="t('f6.realizado.tarifa.valorHora')"
                :max-bytes="12"
                data-testid="tarifa-valor"
              />
            </div>
            <div class="acoes">
              <SanteBotao
                :rotulo="t('f6.gravar')"
                tipo="submit"
                :desabilitado="!inicioTarifa || !(valorNumero > 0)"
                data-testid="tarifa-gravar"
              />
            </div>
          </form>
        </template>
      </section>
    </template>
    <DialogoMotivo
      v-model:visivel="dialogoEstorno"
      :titulo="t('f6.realizado.estornarTitulo', { nome: estornando?.nome ?? '' })"
      :texto="t('f6.realizado.estornarTexto')"
      :confirmar="t('f6.realizado.estornar')"
      :acao="estornar"
      testid="dialogo-estorno"
    />
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
