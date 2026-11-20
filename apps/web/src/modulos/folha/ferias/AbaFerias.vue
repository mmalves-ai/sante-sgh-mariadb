<script setup lang="ts">
// Aba "Férias" (M53.4, etapa F3; `pessoas.ferias.ler`, gravações com `pessoas.ferias.programar` e
// `pessoas.ferias.calcular`; valores com `pessoas.salario.ler`): a escala de férias do intervalo (filtro por datas e
// situação, na empresa escolhida), o colaborador (pela busca da gestão de pessoas, para quem a tem, ou escolhido na
// escala) com os períodos aquisitivos, o direito pelas faltas, o saldo e os avisos; programar uma fração (início, dias,
// abono e o adiantamento do 13º, com a previsão do fim e do pagamento; as recusas da CLT vêm traduzidas, todas de uma
// vez); o recibo (prévia sem gravar, cálculo depois da confirmação, memória com a prova do líquido, avisos e o aviso e
// recibo em PDF) e o cancelamento com motivo. O servidor confere tudo de novo.
import {
  type ApoioFeriasDecimo,
  type AvisoProgramacaoFerias,
  type CabecalhoProcessoFolha,
  type ColaboradorResumo,
  esquemaCancelarFerias,
  esquemaProgramarFerias,
  type FeriasDoVinculo,
  type LinhaCalculoFolha,
  type PendenciaCalculo,
  type PeriodoAquisitivo,
  type RecusaProgramacaoFerias,
  type ResultadoCalculoFerias,
  SITUACOES_FERIAS,
} from '@sgh/contratos';
import {
  SanteAlerta,
  SanteBotao,
  SanteCampoTexto,
  SanteData,
  SanteDialogo,
  SanteOpcoes,
  SanteSelecao,
} from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { dataBr } from '../../pessoas/comum.js';
import { lerColaboradores } from '../../pessoas/api-pessoas.js';
import { instanteBr, rotuloCompetencia } from '../comum-folha.js';
import ErroFolha from '../telas/ErroFolha.vue';
import {
  calcularFerias,
  cancelarFerias,
  lerDetalheFerias,
  lerEscalaFerias,
  lerSaldoFerias,
  programarFerias,
  urlReciboFeriasPdf,
} from './api-ferias.js';
import {
  acoesDaFracao,
  escalaDaEmpresa,
  fimDoGozo,
  intervaloPadrao,
  opcoesAbono,
  opcoesDiasGozo,
  pagamentoPrevisto,
  periodoProgramavel,
  recusasDaProgramacao,
  faixa,
} from './comum-ferias.js';
import MemoriaLinhas from './MemoriaLinhas.vue';

const props = defineProps<{ apoio: ApoioFeriasDecimo; empresa: number | null }>();
const { t } = useI18n();
const cliente = useQueryClient();
const { permissoes } = usarSessao();
const podeBuscar = computed(() => permissoes.value.has('pessoas.colaborador.ler'));
const aviso = ref<string | null>(null);
const avisos = ref<readonly string[]>([]);
const erro = ref<unknown>(null);
const quem = (vinculo: number, matricula: string | null = null) =>
  matricula
    ? `${t('folha.matricula', { m: matricula })} · ${t('folha.vinculo', { v: vinculo })}`
    : t('folha.vinculo', { v: vinculo });
const simNao = (b: boolean) => (b ? t('folha.ferias.fracoes.sim') : t('folha.ferias.fracoes.nao'));

// ── Escala ──────────────────────────────────────────────────────────────────────────────────────────────────
const intervalo = intervaloPadrao(props.apoio.hoje);
const de = ref<string | null>(intervalo.de);
const ate = ref<string | null>(intervalo.ate);
type FiltroSituacao = 'todas' | FeriasDoVinculo['situacao'];
const situacao = ref<FiltroSituacao>('todas');
const opcoesSituacao = computed(() => [
  { valor: 'todas' as FiltroSituacao, rotulo: t('folha.ferias.escala.todas') },
  ...SITUACOES_FERIAS.map((s) => ({ valor: s as FiltroSituacao, rotulo: t(`folha.ferias.situacoes.${s}`) })),
]);
const intervaloOk = computed(() => !(de.value && ate.value && de.value > ate.value));
const escala = useQuery({
  queryKey: computed(() => ['folha', 'ferias', 'escala', props.empresa, de.value, ate.value, situacao.value]),
  queryFn: () =>
    lerEscalaFerias({
      empresa: props.empresa ?? undefined,
      de: de.value ?? undefined,
      ate: ate.value ?? undefined,
      situacao: situacao.value === 'todas' ? undefined : situacao.value,
    }),
  enabled: intervaloOk,
});
const itensEscala = computed(() =>
  escala.data.value ? escalaDaEmpresa(escala.data.value.itens, props.empresa) : null,
);

// ── Colaborador ─────────────────────────────────────────────────────────────────────────────────────────────
const termo = ref('');
const achados = ref<readonly ColaboradorResumo[] | null>(null);
const vinculo = ref<number | null>(null);
const nome = ref<string | null>(null);
async function buscar(): Promise<void> {
  erro.value = null;
  if (termo.value.trim().length < 2) return;
  try {
    achados.value = (
      await lerColaboradores({ termo: termo.value.trim(), estado: 'todos', limite: 30 })
    ).itens;
  } catch (x) {
    erro.value = x;
  }
}
function escolher(v: number, n: string | null = null): void {
  vinculo.value = v;
  nome.value = n;
  achados.value = null;
  aviso.value = null;
  avisos.value = [];
  erro.value = null;
}
function trocar(): void {
  vinculo.value = null;
  nome.value = null;
  termo.value = '';
}
const saldo = useQuery({
  queryKey: computed(() => ['folha', 'ferias', 'saldo', vinculo.value]),
  queryFn: () => lerSaldoFerias(vinculo.value!),
  enabled: computed(() => vinculo.value !== null),
});
const s = computed(() => saldo.data.value ?? null);
async function atualizar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['folha', 'ferias'] });
}

// ── Programar ───────────────────────────────────────────────────────────────────────────────────────────────
const programando = ref(false);
const periodo = ref<PeriodoAquisitivo | null>(null);
const inicio = ref<string | null>(null);
const dias = ref<number | null>(null);
const abono = ref<number | null>(0);
const adiantar = ref<'sim' | 'nao'>('nao');
const recusas = ref<readonly RecusaProgramacaoFerias[]>([]);
const ocupado = ref(false);
const podeProgramar = computed(() => props.apoio.gravacao.ligada && props.apoio.acoes.programar);
const opcoesDias = computed(() =>
  periodo.value ? opcoesDiasGozo(periodo.value.saldo).map((d) => ({ valor: d, rotulo: String(d) })) : [],
);
const opcoesAbonoP = computed(() =>
  periodo.value ? opcoesAbono(periodo.value).map((d) => ({ valor: d, rotulo: String(d) })) : [],
);
const opcoesAdiantar = computed(() => [
  { valor: 'nao' as const, rotulo: t('folha.ferias.fracoes.nao') },
  { valor: 'sim' as const, rotulo: t('folha.ferias.fracoes.sim') },
]);
function abrirProgramacao(p: PeriodoAquisitivo): void {
  periodo.value = p;
  inicio.value = null;
  dias.value = opcoesDiasGozo(p.saldo)[0] ?? null;
  abono.value = 0;
  adiantar.value = 'nao';
  recusas.value = [];
  erro.value = null;
  aviso.value = null;
  avisos.value = [];
  programando.value = true;
}
const programacao = computed(() =>
  esquemaProgramarFerias.safeParse({
    vinculo: vinculo.value ?? 0,
    empresa: props.empresa ?? -1,
    aquisitivoInicio: periodo.value?.inicio ?? '',
    inicio: inicio.value ?? '',
    dias: dias.value ?? 0,
    abono: abono.value ?? 0,
    adiantarDecimo: adiantar.value === 'sim',
  }),
);
const previsao = computed(() =>
  inicio.value && dias.value
    ? t('folha.ferias.programar.previsao', {
        inicio: dataBr(inicio.value),
        fim: dataBr(fimDoGozo(inicio.value, dias.value)),
        pagamento: dataBr(pagamentoPrevisto(inicio.value)),
      })
    : null,
);
async function programar(): Promise<void> {
  if (!programacao.value.success) return;
  erro.value = null;
  recusas.value = [];
  ocupado.value = true;
  try {
    const r = await programarFerias(programacao.value.data);
    programando.value = false;
    aviso.value = t('folha.ferias.programar.gravado');
    avisos.value = r.avisos.map((a: AvisoProgramacaoFerias) => t(`folha.ferias.avisoProgramacao.${a}`));
    await atualizar();
  } catch (x) {
    const rs = recusasDaProgramacao(x);
    if (rs.length) recusas.value = rs;
    else erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Recibo: prévia, cálculo e consulta ──────────────────────────────────────────────────────────────────────
const reciboVisivel = ref(false);
const fracao = ref<FeriasDoVinculo | null>(null);
interface Recibo {
  readonly origem: 'previa' | 'gravado';
  readonly processo: CabecalhoProcessoFolha | null;
  readonly linhas: readonly LinhaCalculoFolha[];
  readonly ocultas: boolean;
  readonly pendencias: readonly PendenciaCalculo[];
  readonly avisos: ResultadoCalculoFerias['avisos'];
}
const recibo = ref<Recibo | null>(null);
const erroRecibo = ref<unknown>(null);
const confirmando = ref(false);
function deResultado(r: ResultadoCalculoFerias): Recibo {
  return {
    origem: r.calculado ? 'gravado' : 'previa',
    processo: r.processo,
    linhas: r.linhas,
    ocultas: false,
    pendencias: r.pendencias,
    avisos: r.avisos,
  };
}
async function verPrevia(f: FeriasDoVinculo): Promise<void> {
  fracao.value = f;
  recibo.value = null;
  erroRecibo.value = null;
  reciboVisivel.value = true;
  try {
    recibo.value = deResultado(await calcularFerias(f.id, { versao: f.versao, simular: true }));
  } catch (x) {
    erroRecibo.value = x;
  }
}
async function verRecibo(f: FeriasDoVinculo): Promise<void> {
  fracao.value = f;
  recibo.value = null;
  erroRecibo.value = null;
  reciboVisivel.value = true;
  try {
    const d = await lerDetalheFerias(f.id);
    fracao.value = d.ferias;
    recibo.value = {
      origem: 'gravado',
      processo: d.processo,
      linhas: d.linhas,
      ocultas: d.linhasOcultas,
      pendencias: [],
      avisos: [],
    };
  } catch (x) {
    erroRecibo.value = x;
  }
}
async function calcular(): Promise<void> {
  const f = fracao.value;
  if (!f) return;
  erroRecibo.value = null;
  ocupado.value = true;
  try {
    const r = await calcularFerias(f.id, { versao: f.versao, simular: false });
    confirmando.value = false;
    recibo.value = deResultado(r);
    fracao.value = r.ferias;
    if (r.calculado && r.processo) {
      aviso.value = t('folha.ferias.recibo.calculado', { numero: r.processo.numero });
      await atualizar();
    }
  } catch (x) {
    erroRecibo.value = x;
  } finally {
    ocupado.value = false;
  }
}
const textoAvisoCalculo = (a: ResultadoCalculoFerias['avisos'][number]) =>
  t(`folha.ferias.avisoCalculo.${a.codigo}`, {
    competencias: a.competencias.map(rotuloCompetencia).join(', '),
  });
const podeCalcularRecibo = computed(
  () =>
    !!fracao.value &&
    recibo.value?.origem === 'previa' &&
    recibo.value.pendencias.length === 0 &&
    acoesDaFracao(fracao.value, props.apoio).calcular,
);

// ── Cancelar ────────────────────────────────────────────────────────────────────────────────────────────────
const cancelando = ref(false);
const motivo = ref('');
const alvoCancelamento = ref<FeriasDoVinculo | null>(null);
const cancelamento = computed(() =>
  esquemaCancelarFerias.safeParse({
    versao: alvoCancelamento.value?.versao ?? 0,
    motivo: motivo.value.trim(),
  }),
);
function abrirCancelamento(f: FeriasDoVinculo): void {
  alvoCancelamento.value = f;
  motivo.value = '';
  erro.value = null;
  aviso.value = null;
  avisos.value = [];
  cancelando.value = true;
}
async function cancelar(): Promise<void> {
  if (!alvoCancelamento.value || !cancelamento.value.success) return;
  erro.value = null;
  try {
    const r = await cancelarFerias(alvoCancelamento.value.id, cancelamento.value.data);
    cancelando.value = false;
    aviso.value = r.mensagem || t('folha.ferias.cancelar.cancelado');
    await atualizar();
  } catch (x) {
    erro.value = x;
  }
}
watch(
  () => props.empresa,
  () => {
    aviso.value = null;
    avisos.value = [];
  },
);
</script>

<template>
  <section class="bloco" :aria-label="t('folha.ferias.titulo')" data-testid="folha-ferias">
    <h2>{{ t('folha.ferias.titulo') }}</h2>
    <p class="secundario">{{ t('folha.ferias.descricao') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="folha-ferias-aviso" />
    <ul v-if="avisos.length" data-testid="folha-ferias-avisos-programacao">
      <li v-for="a in avisos" :key="a">{{ a }}</li>
    </ul>
    <ErroFolha v-if="erro && !programando && !cancelando" :erro="erro" />

    <!-- Colaborador e saldo -->
    <section
      class="bloco"
      :aria-label="t('folha.ferias.colaborador.titulo')"
      data-testid="folha-ferias-colaborador"
    >
      <h3>{{ t('folha.ferias.colaborador.titulo') }}</h3>
      <div v-if="vinculo !== null" class="campos">
        <p data-testid="folha-ferias-escolhido">
          <strong v-if="nome">{{ nome }} · </strong>{{ quem(vinculo, s?.matricula ?? null) }}
        </p>
        <SanteBotao :rotulo="t('folha.ferias.colaborador.trocar')" variante="texto" @acionar="trocar" />
      </div>
      <template v-else>
        <p>
          {{ podeBuscar ? t('folha.ferias.colaborador.escolha') : t('folha.ferias.colaborador.semBusca') }}
        </p>
        <div v-if="podeBuscar" class="campos">
          <SanteCampoTexto
            v-model="termo"
            :rotulo="t('folha.ferias.colaborador.buscar')"
            :max-bytes="70"
            data-testid="folha-ferias-termo"
          />
          <SanteBotao
            :rotulo="t('folha.ferias.colaborador.buscarBotao')"
            variante="secundario"
            data-testid="folha-ferias-buscar"
            @acionar="buscar"
          />
        </div>
        <ul v-if="achados" class="lista" data-testid="folha-ferias-achados">
          <li v-if="achados.length === 0">{{ t('folha.ferias.colaborador.nenhum') }}</li>
          <li v-for="c in achados" :key="c.vinculo">
            <SanteBotao
              :rotulo="`${c.nome} · ${quem(c.vinculo, c.matricula)}`"
              variante="texto"
              :data-testid="`folha-ferias-escolher-${c.vinculo}`"
              @acionar="escolher(c.vinculo, c.nome)"
            />
            <span class="secundario">{{ c.cargo }}</span>
          </li>
        </ul>
      </template>

      <template v-if="vinculo !== null">
        <ErroFolha v-if="saldo.isError.value" :erro="saldo.error.value" />
        <p v-else-if="!s" role="status">{{ t('folha.carregando') }}</p>
        <SanteAlerta
          v-else-if="!s.temDireito"
          :texto="t('folha.ferias.colaborador.semDireito')"
          variante="info"
          data-testid="folha-ferias-sem-direito"
        />
        <template v-else>
          <h4>{{ t('folha.ferias.periodos.titulo') }}</h4>
          <p v-if="s.periodos.length === 0">{{ t('folha.ferias.periodos.nenhum') }}</p>
          <table v-else class="tabela" data-testid="folha-ferias-periodos">
            <thead>
              <tr>
                <th scope="col">{{ t('folha.ferias.periodos.aquisitivo') }}</th>
                <th scope="col">{{ t('folha.ferias.periodos.concessivo') }}</th>
                <th scope="col">{{ t('folha.ferias.periodos.situacao') }}</th>
                <th scope="col">{{ t('folha.ferias.periodos.faltas') }}</th>
                <th scope="col">{{ t('folha.ferias.periodos.direito') }}</th>
                <th scope="col">{{ t('folha.ferias.periodos.gozados') }}</th>
                <th scope="col">{{ t('folha.ferias.periodos.abono') }}</th>
                <th scope="col">{{ t('folha.ferias.periodos.programados') }}</th>
                <th scope="col">{{ t('folha.ferias.periodos.saldo') }}</th>
                <th v-if="podeProgramar" scope="col">{{ t('folha.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in s.periodos" :key="p.inicio" :data-testid="`folha-ferias-periodo-${p.inicio}`">
                <th scope="row">
                  {{ faixa(p.inicio, p.fim) }}
                  <ul v-if="p.avisos.length" class="secundario">
                    <li v-for="a in p.avisos" :key="a" :data-testid="`folha-ferias-periodo-aviso-${a}`">
                      {{ t(`folha.ferias.aviso.${a}`) }}
                      <template v-if="a === 'competencias-sem-calculo' && p.competenciasSemCalculo.length">
                        ({{ p.competenciasSemCalculo.map(rotuloCompetencia).join(', ') }})
                      </template>
                    </li>
                  </ul>
                </th>
                <td>{{ dataBr(p.concessivoFim) }}</td>
                <td>{{ t(`folha.ferias.situacaoPeriodo.${p.situacao}`) }}</td>
                <td>{{ p.faltas }}</td>
                <td>{{ t('folha.ferias.periodos.dias', { n: p.direito }) }}</td>
                <td>{{ p.gozados }}</td>
                <td>{{ p.abono }}</td>
                <td>{{ p.programados }}</td>
                <td>
                  <strong>{{ t('folha.ferias.periodos.dias', { n: p.saldo }) }}</strong>
                </td>
                <td v-if="podeProgramar">
                  <SanteBotao
                    v-if="periodoProgramavel(p)"
                    :rotulo="t('folha.ferias.periodos.programar')"
                    variante="secundario"
                    :data-testid="`folha-ferias-programar-${p.inicio}`"
                    @acionar="abrirProgramacao(p)"
                  />
                </td>
              </tr>
            </tbody>
          </table>

          <h4>{{ t('folha.ferias.fracoes.titulo') }}</h4>
          <p v-if="s.ferias.length === 0">{{ t('folha.ferias.fracoes.nenhuma') }}</p>
          <table v-else class="tabela" data-testid="folha-ferias-fracoes">
            <thead>
              <tr>
                <th scope="col">{{ t('folha.ferias.fracoes.gozo') }}</th>
                <th scope="col">{{ t('folha.ferias.periodos.aquisitivo') }}</th>
                <th scope="col">{{ t('folha.ferias.fracoes.dias') }}</th>
                <th scope="col">{{ t('folha.ferias.fracoes.abono') }}</th>
                <th scope="col">{{ t('folha.ferias.fracoes.dobra') }}</th>
                <th scope="col">{{ t('folha.ferias.fracoes.adiantarDecimo') }}</th>
                <th scope="col">{{ t('folha.ferias.fracoes.pagamento') }}</th>
                <th scope="col">{{ t('folha.ferias.fracoes.situacao') }}</th>
                <th scope="col">{{ t('folha.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in s.ferias" :key="f.id" :data-testid="`folha-ferias-fracao-${f.id}`">
                <th scope="row">{{ faixa(f.inicio, f.fim) }}</th>
                <td>{{ faixa(f.aquisitivoInicio, f.aquisitivoFim) }}</td>
                <td>{{ f.dias }}</td>
                <td>{{ f.abono }}</td>
                <td>{{ f.dobra }}</td>
                <td>{{ simNao(f.adiantarDecimo) }}</td>
                <td>{{ dataBr(f.pagamento) }}</td>
                <td>
                  {{ t(`folha.ferias.situacoes.${f.situacao}`) }}
                  <span v-if="f.motivo" class="secundario">· {{ f.motivo }}</span>
                  <span class="secundario">
                    ·
                    {{
                      t('folha.ferias.fracoes.registrado', {
                        por: f.registradoPor,
                        em: instanteBr(f.registradoEm),
                      })
                    }}
                  </span>
                </td>
                <td class="acoes-linha">
                  <SanteBotao
                    v-if="f.situacao === 'programada' && apoio.acoes.calcularFerias"
                    :rotulo="t('folha.ferias.recibo.previa')"
                    variante="texto"
                    :data-testid="`folha-ferias-previa-${f.id}`"
                    @acionar="verPrevia(f)"
                  />
                  <SanteBotao
                    v-if="f.situacao === 'calculada'"
                    :rotulo="t('folha.ferias.recibo.ver')"
                    variante="texto"
                    :data-testid="`folha-ferias-recibo-${f.id}`"
                    @acionar="verRecibo(f)"
                  />
                  <a
                    v-if="acoesDaFracao(f, apoio).recibo"
                    :href="urlReciboFeriasPdf(f.id)"
                    target="_blank"
                    rel="noopener"
                    :data-testid="`folha-ferias-pdf-${f.id}`"
                    >{{ t('folha.ferias.recibo.pdf') }}</a
                  >
                  <SanteBotao
                    v-if="acoesDaFracao(f, apoio).cancelar"
                    :rotulo="t('folha.ferias.cancelar.botao')"
                    variante="texto"
                    :data-testid="`folha-ferias-cancelar-${f.id}`"
                    @acionar="abrirCancelamento(f)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </template>
    </section>

    <!-- Escala -->
    <section class="bloco" :aria-label="t('folha.ferias.escala.titulo')" data-testid="folha-ferias-escala">
      <h3>{{ t('folha.ferias.escala.titulo') }}</h3>
      <div class="campos">
        <SanteData
          v-model="de"
          :rotulo="t('folha.ferias.escala.de')"
          editavel
          data-testid="folha-ferias-de"
        />
        <SanteData
          v-model="ate"
          :rotulo="t('folha.ferias.escala.ate')"
          editavel
          data-testid="folha-ferias-ate"
        />
        <SanteSelecao
          v-model="situacao"
          :rotulo="t('folha.ferias.escala.situacao')"
          :opcoes="opcoesSituacao"
          data-testid="folha-ferias-situacao"
        />
      </div>
      <p v-if="!intervaloOk" role="alert">{{ t('folha.ferias.escala.intervaloInvalido') }}</p>
      <ErroFolha v-else-if="escala.isError.value" :erro="escala.error.value" />
      <p v-else-if="!itensEscala" role="status">{{ t('folha.carregando') }}</p>
      <p v-else-if="itensEscala.length === 0" data-testid="folha-ferias-escala-vazia">
        {{ t('folha.ferias.escala.nenhuma') }}
      </p>
      <table v-else class="tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('folha.ferias.fracoes.gozo') }}</th>
            <th scope="col">{{ t('folha.ferias.colaborador.titulo') }}</th>
            <th scope="col">{{ t('folha.ferias.fracoes.dias') }}</th>
            <th scope="col">{{ t('folha.ferias.fracoes.abono') }}</th>
            <th scope="col">{{ t('folha.ferias.fracoes.pagamento') }}</th>
            <th scope="col">{{ t('folha.ferias.fracoes.situacao') }}</th>
            <th scope="col">{{ t('folha.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in itensEscala" :key="f.id" :data-testid="`folha-ferias-escala-${f.id}`">
            <th scope="row">{{ faixa(f.inicio, f.fim) }}</th>
            <td>{{ quem(f.vinculo) }}</td>
            <td>{{ f.dias }}</td>
            <td>{{ f.abono }}</td>
            <td>{{ dataBr(f.pagamento) }}</td>
            <td>{{ t(`folha.ferias.situacoes.${f.situacao}`) }}</td>
            <td>
              <SanteBotao
                :rotulo="t('folha.ferias.escala.verColaborador')"
                variante="texto"
                :data-testid="`folha-ferias-ver-${f.id}`"
                @acionar="escolher(f.vinculo)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="escala.data.value?.limitado" class="secundario">{{ t('folha.ferias.escala.limitado') }}</p>
    </section>

    <!-- Programar -->
    <SanteDialogo v-model:visivel="programando" :titulo="t('folha.ferias.programar.titulo')">
      <form data-testid="folha-ferias-form" @submit.prevent="programar">
        <p v-if="periodo">
          {{
            t('folha.ferias.programar.periodo', {
              de: dataBr(periodo.inicio),
              ate: dataBr(periodo.fim),
              saldo: periodo.saldo,
            })
          }}
        </p>
        <div class="campos">
          <SanteData
            v-model="inicio"
            :rotulo="t('folha.ferias.programar.inicio')"
            editavel
            data-testid="folha-ferias-inicio"
          />
          <SanteSelecao
            v-model="dias"
            :rotulo="t('folha.ferias.programar.dias')"
            :opcoes="opcoesDias"
            data-testid="folha-ferias-dias"
          />
          <SanteSelecao
            v-model="abono"
            :rotulo="t('folha.ferias.programar.abono')"
            :opcoes="opcoesAbonoP"
            data-testid="folha-ferias-abono"
          />
        </div>
        <p v-if="periodo" class="secundario">
          {{ t('folha.ferias.programar.abonoAjuda', { max: Math.floor(periodo.direito / 3) }) }}
        </p>
        <SanteOpcoes
          v-model="adiantar"
          :legenda="t('folha.ferias.programar.adiantar')"
          :opcoes="opcoesAdiantar"
          data-testid="folha-ferias-adiantar"
        />
        <p v-if="empresa === null" role="alert">{{ t('folha.ferias.escolhaEmpresa') }}</p>
        <p v-if="previsao" data-testid="folha-ferias-previsao">{{ previsao }}</p>
        <p v-else class="secundario">{{ t('folha.ferias.programar.incompleto') }}</p>
        <section
          v-if="recusas.length"
          role="alert"
          :aria-label="t('folha.ferias.programar.recusasTitulo')"
          data-testid="folha-ferias-recusas"
        >
          <h4>{{ t('folha.ferias.programar.recusasTitulo') }}</h4>
          <ul>
            <li v-for="r in recusas" :key="r" :data-testid="`folha-ferias-recusa-${r}`">
              {{ t(`folha.ferias.recusa.${r}`) }}
            </li>
          </ul>
        </section>
        <ErroFolha v-if="erro && programando" :erro="erro" />
      </form>
      <template #rodape>
        <SanteBotao :rotulo="t('folha.fechar')" variante="texto" @acionar="programando = false" />
        <SanteBotao
          :rotulo="t('folha.gravar')"
          :desabilitado="!programacao.success || ocupado"
          data-testid="folha-ferias-gravar"
          @acionar="programar"
        />
      </template>
    </SanteDialogo>

    <!-- Recibo -->
    <SanteDialogo
      v-model:visivel="reciboVisivel"
      :titulo="
        recibo?.origem === 'previa' ? t('folha.ferias.recibo.previaTitulo') : t('folha.ferias.recibo.titulo')
      "
    >
      <div data-testid="folha-ferias-recibo">
        <p v-if="fracao">
          {{ quem(fracao.vinculo) }} · {{ faixa(fracao.inicio, fracao.fim) }} ·
          {{ t('folha.ferias.fracoes.pagamento') }} {{ dataBr(fracao.pagamento) }}
        </p>
        <ErroFolha v-if="erroRecibo && !confirmando" :erro="erroRecibo" />
        <p v-else-if="!recibo" role="status">{{ t('folha.carregando') }}</p>
        <template v-else>
          <p v-if="recibo.processo" class="secundario" data-testid="folha-ferias-recibo-numero">
            {{
              t('folha.ferias.recibo.numero', {
                numero: recibo.processo.numero,
                em: instanteBr(recibo.processo.calculadoEm),
                por: recibo.processo.calculadoPor,
              })
            }}
          </p>
          <section
            v-if="recibo.pendencias.length"
            role="alert"
            :aria-label="t('folha.ferias.recibo.pendenciasTitulo')"
            data-testid="folha-ferias-recibo-pendencias"
          >
            <h4>{{ t('folha.ferias.recibo.pendenciasTitulo') }}</h4>
            <ul>
              <li v-for="(p, i) in recibo.pendencias" :key="`${p.codigo}-${i}`">
                {{ t(`folha.calculo.pendencia.${p.codigo}`) }}
                <span v-if="p.papel" class="secundario">
                  · {{ t('folha.calculo.pendenciaPapel', { papel: t(`folha.calculo.papeis.${p.papel}`) }) }}
                </span>
              </li>
            </ul>
          </section>
          <ul v-if="recibo.avisos.length" data-testid="folha-ferias-recibo-avisos">
            <li v-for="a in recibo.avisos" :key="a.codigo">{{ textoAvisoCalculo(a) }}</li>
          </ul>
          <p v-if="recibo.ocultas" role="status" data-testid="folha-ferias-recibo-oculto">
            {{ t('folha.ferias.recibo.oculto') }}
          </p>
          <p v-else-if="recibo.linhas.length === 0 && recibo.pendencias.length === 0">
            {{ t('folha.ferias.recibo.semRecibo') }}
          </p>
          <MemoriaLinhas
            v-else-if="recibo.linhas.length"
            :linhas="recibo.linhas"
            prefixo="folha-ferias-recibo"
          />
          <p v-if="recibo.origem === 'gravado' && fracao && acoesDaFracao(fracao, apoio).recibo">
            <a
              :href="urlReciboFeriasPdf(fracao.id)"
              target="_blank"
              rel="noopener"
              data-testid="folha-ferias-recibo-pdf"
              >{{ t('folha.ferias.recibo.pdf') }}</a
            >
          </p>
        </template>
      </div>
      <template #rodape>
        <SanteBotao :rotulo="t('folha.fechar')" variante="texto" @acionar="reciboVisivel = false" />
        <SanteBotao
          v-if="podeCalcularRecibo"
          :rotulo="t('folha.ferias.recibo.calcular')"
          data-testid="folha-ferias-calcular"
          @acionar="confirmando = true"
        />
      </template>
    </SanteDialogo>

    <SanteDialogo v-model:visivel="confirmando" :titulo="t('folha.ferias.recibo.calcular')">
      <p data-testid="folha-ferias-confirmacao">{{ t('folha.ferias.recibo.confirmar') }}</p>
      <ErroFolha v-if="erroRecibo && confirmando" :erro="erroRecibo" />
      <template #rodape>
        <SanteBotao :rotulo="t('folha.fechar')" variante="texto" @acionar="confirmando = false" />
        <SanteBotao
          :rotulo="t('folha.confirmar')"
          :desabilitado="ocupado"
          data-testid="folha-ferias-confirmar"
          @acionar="calcular"
        />
      </template>
    </SanteDialogo>

    <!-- Cancelar -->
    <SanteDialogo v-model:visivel="cancelando" :titulo="t('folha.ferias.cancelar.titulo')">
      <p v-if="alvoCancelamento">
        {{ quem(alvoCancelamento.vinculo) }} · {{ faixa(alvoCancelamento.inicio, alvoCancelamento.fim) }} ·
        {{ t(`folha.ferias.situacoes.${alvoCancelamento.situacao}`) }}
      </p>
      <p class="secundario">{{ t('folha.ferias.cancelar.ajuda') }}</p>
      <SanteCampoTexto
        v-model="motivo"
        :rotulo="t('folha.ferias.cancelar.motivo')"
        :max-bytes="200"
        data-testid="folha-ferias-motivo"
      />
      <ErroFolha v-if="erro && cancelando" :erro="erro" />
      <template #rodape>
        <SanteBotao :rotulo="t('folha.fechar')" variante="texto" @acionar="cancelando = false" />
        <SanteBotao
          :rotulo="t('folha.confirmar')"
          :desabilitado="!cancelamento.success"
          data-testid="folha-ferias-confirmar-cancelamento"
          @acionar="cancelar"
        />
      </template>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
<style scoped>
.acoes-linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  align-items: center;
}
</style>
