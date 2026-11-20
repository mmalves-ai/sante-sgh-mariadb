<script setup lang="ts">
// Aba "Rescisão" (M53.5, etapa F4; `pessoas.rescisao.ler`, gravações com `pessoas.rescisao.calcular`; verbas, termo e
// multa com `pessoas.salario.ler`): a fila dos colaboradores desligados do intervalo (o desligamento é o do cadastro do
// colaborador), com a modalidade sugerida pelo motivo do desligamento; o formulário (modalidade → os avisos que ela aceita,
// o término do contrato a prazo só na antecipação, o saldo do FGTS do extrato opcional e o pagamento padrão em 10 dias);
// a prévia com a apuração (aviso, projeção, avos, multa com as parcelas impressas), a memória das verbas, as pendências e
// os avisos traduzidos; a gravação depois da confirmação; as rescisões do intervalo com o termo em PDF e o cancelamento
// com motivo. O servidor confere tudo de novo.
import {
  type ApoioRescisao,
  type ApuracaoRescisao,
  type AvisoPrevio,
  type CalcularRescisaoEntrada,
  type DesligadoParaRescisao,
  esquemaCalcularRescisao,
  esquemaCancelarRescisao,
  parcelasMultaFgts,
  type LinhaCalculoFolha,
  type ModalidadeRescisao,
  type PendenciaCalculo,
  type RecusaRescisao,
  type RescisaoDoVinculo,
  type ResultadoCalculoRescisao,
  SITUACOES_RESCISAO,
  type SituacaoRescisao,
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
import { dataBr } from '../../pessoas/comum.js';
import { lerCentavos } from '../calculo/comum-calculo.js';
import { instanteBr, reais, rotuloCompetencia } from '../comum-folha.js';
import MemoriaLinhas from '../ferias/MemoriaLinhas.vue';
import ErroFolha from '../telas/ErroFolha.vue';
import {
  calcularRescisao,
  cancelarRescisao,
  lerDesligados,
  lerDetalheRescisao,
  lerRescisoes,
  urlTermoRescisaoPdf,
} from './api-rescisao.js';
import {
  acoesDaRescisao,
  avisosDa,
  casaColaborador,
  contaMulta,
  filtrarDesligados,
  intervaloDesligados,
  pagamentoPadrao,
  pedeTermo,
  recusasDaRescisao,
  termoObrigatorio,
  vinculoDaBusca,
} from './comum-rescisao.js';

const props = defineProps<{ apoio: ApoioRescisao; empresa: number | null }>();
const { t, te } = useI18n();
const cliente = useQueryClient();
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const grava = computed(() => props.apoio.gravacao.ligada && props.apoio.acoes.calcular);
const quem = (vinculo: number, matricula: string | null = null) =>
  matricula
    ? `${t('folha.matricula', { m: matricula })} · ${t('folha.vinculo', { v: vinculo })}`
    : t('folha.vinculo', { v: vinculo });
const rotuloTipo = (tipo: string) =>
  te(`folha.rescisao.tipos.${tipo}`) ? t(`folha.rescisao.tipos.${tipo}`) : tipo;
const rotuloModalidade = (m: ModalidadeRescisao) => t(`folha.rescisao.modalidades.${m}`);
const rotuloAviso = (a: AvisoPrevio) => t(`folha.rescisao.avisos.${a}`);

// ── Fila dos desligados e rescisões do intervalo ──────────────────────────────────────────────────────────────
const intervalo = intervaloDesligados(props.apoio.hoje);
const de = ref<string | null>(intervalo.de);
const ate = ref<string | null>(intervalo.ate);
const intervaloOk = computed(() => !!de.value && !!ate.value && de.value <= ate.value);
const fila = useQuery({
  queryKey: computed(() => ['folha', 'rescisao', 'desligados', de.value, ate.value]),
  queryFn: () => lerDesligados({ de: de.value!, ate: ate.value! }),
  enabled: intervaloOk,
});
// A busca do colaborador (matrícula ou vínculo) filtra a fila na tela e o histórico no servidor quando aponta um
// vínculo só; a situação vai ao servidor (o filtro `vinculo` e `situacao` da rota do histórico).
const busca = ref('');
const situacao = ref<SituacaoRescisao | null>(null);
const opcoesSituacao = computed(() => [
  { valor: null, rotulo: t('folha.rescisao.historico.todasSituacoes') },
  ...SITUACOES_RESCISAO.map((x) => ({ valor: x, rotulo: t(`folha.rescisao.situacoes.${x}`) })),
]);
const filaVisivel = computed(() => filtrarDesligados(fila.data.value?.itens ?? [], busca.value));
const vinculoBuscado = computed(() => vinculoDaBusca(fila.data.value?.itens ?? [], busca.value));
const historico = useQuery({
  queryKey: computed(() => [
    'folha',
    'rescisao',
    'lista',
    props.empresa,
    de.value,
    ate.value,
    vinculoBuscado.value ?? null,
    situacao.value,
  ]),
  queryFn: () =>
    lerRescisoes({
      empresa: props.empresa ?? undefined,
      de: de.value!,
      ate: ate.value!,
      vinculo: vinculoBuscado.value,
      situacao: situacao.value ?? undefined,
    }),
  enabled: intervaloOk,
});
const matriculas = computed(
  () => new Map((fila.data.value?.itens ?? []).map((x) => [x.vinculo, x.matricula] as const)),
);
const historicoVisivel = computed(() =>
  (historico.data.value?.itens ?? []).filter((r) =>
    casaColaborador(busca.value, r.vinculo, matriculas.value.get(r.vinculo) ?? null),
  ),
);
async function atualizar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['folha', 'rescisao'] });
}

// ── Formulário ────────────────────────────────────────────────────────────────────────────────────────────────
const formVisivel = ref(false);
const alvo = ref<DesligadoParaRescisao | null>(null);
const modalidade = ref<ModalidadeRescisao | null>(null);
const avisoPrevio = ref<AvisoPrevio>('nenhum');
const termo = ref<string | null>(null);
const saldoTexto = ref('');
const pagamento = ref<string | null>(null);
const recusas = ref<readonly RecusaRescisao[]>([]);
const opcoesModalidade = computed(() =>
  props.apoio.modalidades.map((m) => ({ valor: m.modalidade, rotulo: rotuloModalidade(m.modalidade) })),
);
const opcoesAviso = computed(() =>
  avisosDa(modalidade.value, props.apoio).map((a) => ({ valor: a, rotulo: rotuloAviso(a) })),
);
watch(modalidade, (m) => {
  const xs = avisosDa(m, props.apoio);
  if (!xs.includes(avisoPrevio.value)) avisoPrevio.value = xs[0] ?? 'nenhum';
  if (!pedeTermo(m)) termo.value = null;
});
function abrirFormulario(d: DesligadoParaRescisao): void {
  alvo.value = d;
  modalidade.value = d.modalidadeSugerida;
  avisoPrevio.value = avisosDa(d.modalidadeSugerida, props.apoio)[0] ?? 'nenhum';
  termo.value = null;
  saldoTexto.value = '';
  pagamento.value = pagamentoPadrao(d.desligamento);
  recusas.value = [];
  erro.value = null;
  aviso.value = null;
  formVisivel.value = true;
}
const saldoFgts = computed(() => (saldoTexto.value.trim() ? lerCentavos(saldoTexto.value) : null));
const saldoInvalido = computed(() => saldoTexto.value.trim() !== '' && saldoFgts.value === null);
const entrada = computed(() =>
  esquemaCalcularRescisao.safeParse({
    vinculo: alvo.value?.vinculo ?? 0,
    empresa: props.empresa ?? -1,
    modalidade: modalidade.value ?? '',
    aviso: avisoPrevio.value,
    termo: termo.value,
    saldoFgts: saldoFgts.value,
    pagamento: pagamento.value,
    simular: true,
  }),
);
const formOk = computed(
  () =>
    entrada.value.success && !saldoInvalido.value && !(termoObrigatorio(modalidade.value) && !termo.value),
);

// ── Prévia, gravação e consulta ───────────────────────────────────────────────────────────────────────────────
interface Termo {
  readonly origem: 'previa' | 'gravada';
  readonly rescisao: RescisaoDoVinculo | null;
  readonly processo: { numero: number; calculadoPor: string; calculadoEm: string } | null;
  readonly apuracao: ApuracaoRescisao | null;
  readonly linhas: readonly LinhaCalculoFolha[];
  readonly ocultas: boolean;
  readonly pendencias: readonly PendenciaCalculo[];
  readonly avisos: ResultadoCalculoRescisao['avisos'];
}
const termoVisivel = ref(false);
const resultado = ref<Termo | null>(null);
const erroTermo = ref<unknown>(null);
const confirmando = ref(false);
const enviado = ref<CalcularRescisaoEntrada | null>(null);
function deResultado(r: ResultadoCalculoRescisao): Termo {
  return {
    origem: r.calculado ? 'gravada' : 'previa',
    rescisao: r.rescisao,
    processo: r.processo,
    apuracao: r.apuracao,
    linhas: r.linhas,
    ocultas: false,
    pendencias: r.pendencias,
    avisos: r.avisos,
  };
}
async function verPrevia(): Promise<void> {
  if (!formOk.value || !entrada.value.success) return;
  recusas.value = [];
  erro.value = null;
  ocupado.value = true;
  try {
    const e = entrada.value.data;
    const r = await calcularRescisao(e);
    enviado.value = e;
    resultado.value = deResultado(r);
    erroTermo.value = null;
    formVisivel.value = false;
    termoVisivel.value = true;
  } catch (x) {
    const rs = recusasDaRescisao(x);
    if (rs.length) recusas.value = rs;
    else erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
async function gravar(): Promise<void> {
  if (!enviado.value) return;
  erroTermo.value = null;
  ocupado.value = true;
  try {
    const r = await calcularRescisao({ ...enviado.value, simular: false });
    confirmando.value = false;
    resultado.value = deResultado(r);
    if (r.calculado && r.processo) {
      aviso.value = [
        t('folha.rescisao.previa.gravada', { numero: r.processo.numero }),
        ...(r.substituida ? [t('folha.rescisao.previa.substituida')] : []),
      ].join(' ');
      await atualizar();
    }
  } catch (x) {
    erroTermo.value = x;
  } finally {
    ocupado.value = false;
  }
}
async function verRescisao(id: number): Promise<void> {
  resultado.value = null;
  erroTermo.value = null;
  enviado.value = null;
  termoVisivel.value = true;
  try {
    const d = await lerDetalheRescisao(id);
    resultado.value = {
      origem: 'gravada',
      rescisao: d.rescisao,
      processo: d.processo,
      apuracao: null,
      linhas: d.linhas,
      ocultas: d.linhasOcultas,
      pendencias: [],
      avisos: [],
    };
  } catch (x) {
    erroTermo.value = x;
  }
}
const podeGravar = computed(
  () =>
    grava.value &&
    resultado.value?.origem === 'previa' &&
    resultado.value.pendencias.length === 0 &&
    resultado.value.linhas.length > 0,
);
const textoAviso = (a: ResultadoCalculoRescisao['avisos'][number]) =>
  t(`folha.rescisao.avisoCalculo.${a.codigo}`, {
    competencias: a.competencias.map(rotuloCompetencia).join(', '),
  });
/** A apuração da prévia; na rescisão gravada (consulta), o que a rescisão guarda. */
const linhasApuracao = computed<string[]>(() => {
  const r = resultado.value;
  if (!r) return [];
  const a = r.apuracao;
  const x = r.rescisao;
  const desligamento = a?.desligamento ?? x?.desligamento;
  if (!desligamento) return [];
  const diasAviso = a?.diasAviso ?? x?.diasAviso ?? 0;
  const indenizados = a?.diasIndenizados ?? x?.diasIndenizados ?? 0;
  const projecao = a?.projecao ?? x?.projecao ?? desligamento;
  const saldo = a?.saldoFgts ?? x?.saldoFgts ?? 0;
  const multa = a?.multaFgts ?? x?.multaFgts ?? 0;
  const informado = a?.saldoFgtsInformado ?? x?.saldoFgtsInformado ?? false;
  // Na gravada, o percentual e o FGTS desta rescisão vêm das linhas do termo (a linha da multa e a do FGTS).
  const gravada = parcelasMultaFgts(r.linhas);
  const pct = a ? a.percentualMulta : gravada.percentual;
  const conta = contaMulta(saldo, a ? a.fgtsRescisao : gravada.fgtsRescisao, pct, multa);
  const ls: string[] = [];
  ls.push(
    a
      ? t('folha.rescisao.apuracao.aviso', {
          dias: diasAviso,
          anos: a.anosCompletos,
          indenizados,
        })
      : t('folha.rescisao.apuracao.avisoGravado', { dias: diasAviso, indenizados }),
  );
  ls.push(
    t('folha.rescisao.apuracao.projecao', {
      desligamento: dataBr(desligamento),
      dias: indenizados,
      projecao: dataBr(projecao),
    }),
  );
  if (a) {
    ls.push(
      t('folha.rescisao.apuracao.saldo', {
        dias: a.diasSaldo,
        competencia: rotuloCompetencia(a.competencia),
      }),
    );
    ls.push(t('folha.rescisao.apuracao.avos', { avos: a.avosDecimo, aviso: a.avosDecimoAviso }));
  }
  if (!r.ocultas)
    ls.push(
      conta
        ? `${t('folha.rescisao.apuracao.multa', { conta })} (${t(
            informado ? 'folha.rescisao.apuracao.saldoInformado' : 'folha.rescisao.apuracao.saldoEstimado',
          )})`
        : t('folha.rescisao.apuracao.semMulta'),
    );
  const pg = a?.pagamento ?? x?.pagamento;
  if (pg) ls.push(t('folha.rescisao.apuracao.pagamento', { data: dataBr(pg) }));
  return ls;
});

// ── Cancelar ──────────────────────────────────────────────────────────────────────────────────────────────────
const cancelando = ref(false);
const motivo = ref('');
const alvoCancelamento = ref<RescisaoDoVinculo | null>(null);
const cancelamento = computed(() =>
  esquemaCancelarRescisao.safeParse({
    versao: alvoCancelamento.value?.versao ?? 0,
    motivo: motivo.value.trim(),
  }),
);
function abrirCancelamento(r: RescisaoDoVinculo): void {
  alvoCancelamento.value = r;
  motivo.value = '';
  erro.value = null;
  aviso.value = null;
  termoVisivel.value = false;
  cancelando.value = true;
}
async function cancelar(): Promise<void> {
  if (!alvoCancelamento.value || !cancelamento.value.success) return;
  erro.value = null;
  try {
    const r = await cancelarRescisao(alvoCancelamento.value.id, cancelamento.value.data);
    cancelando.value = false;
    aviso.value = r.mensagem || t('folha.rescisao.cancelar.cancelada');
    await atualizar();
  } catch (x) {
    erro.value = x;
  }
}
watch(
  () => props.empresa,
  () => {
    aviso.value = null;
  },
);
</script>

<template>
  <section class="bloco" :aria-label="t('folha.rescisao.titulo')" data-testid="folha-rescisao">
    <h2>{{ t('folha.rescisao.titulo') }}</h2>
    <p class="secundario">{{ t('folha.rescisao.descricao') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="folha-rescisao-aviso" />
    <ErroFolha v-if="erro && !formVisivel && !cancelando" :erro="erro" />

    <div class="campos" data-testid="folha-rescisao-intervalo">
      <SanteData
        v-model="de"
        :rotulo="t('folha.rescisao.fila.de')"
        editavel
        data-testid="folha-rescisao-de"
      />
      <SanteData
        v-model="ate"
        :rotulo="t('folha.rescisao.fila.ate')"
        editavel
        data-testid="folha-rescisao-ate"
      />
      <SanteCampoTexto
        v-model="busca"
        :rotulo="t('folha.rescisao.fila.busca')"
        :max-bytes="40"
        data-testid="folha-rescisao-busca"
      />
    </div>
    <p class="secundario">{{ t('folha.rescisao.fila.buscaAjuda') }}</p>
    <p v-if="!intervaloOk" role="alert">{{ t('folha.rescisao.fila.intervaloInvalido') }}</p>

    <!-- Fila dos desligados -->
    <section class="bloco" :aria-label="t('folha.rescisao.fila.titulo')" data-testid="folha-rescisao-fila">
      <h3>{{ t('folha.rescisao.fila.titulo') }}</h3>
      <ErroFolha v-if="fila.isError.value" :erro="fila.error.value" />
      <p v-else-if="intervaloOk && !fila.data.value" role="status">{{ t('folha.carregando') }}</p>
      <p v-else-if="fila.data.value?.itens.length === 0" data-testid="folha-rescisao-fila-vazia">
        {{ t('folha.rescisao.fila.nenhum') }}
      </p>
      <p
        v-else-if="fila.data.value && filaVisivel.length === 0"
        data-testid="folha-rescisao-fila-nenhum-busca"
      >
        {{ t('folha.rescisao.fila.nenhumNaBusca') }}
      </p>
      <div
        v-else-if="fila.data.value"
        class="rolagem"
        tabindex="0"
        role="region"
        :aria-label="t('folha.rescisao.fila.titulo')"
      >
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('folha.rescisao.fila.colaborador') }}</th>
              <th scope="col">{{ t('folha.rescisao.fila.tipo') }}</th>
              <th scope="col">{{ t('folha.rescisao.fila.admissao') }}</th>
              <th scope="col">{{ t('folha.rescisao.fila.desligamento') }}</th>
              <th scope="col">{{ t('folha.rescisao.fila.sugerida') }}</th>
              <th scope="col">{{ t('folha.rescisao.fila.situacao') }}</th>
              <th scope="col">{{ t('folha.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="d in filaVisivel"
              :key="d.vinculo"
              :data-testid="`folha-rescisao-desligado-${d.vinculo}`"
            >
              <th scope="row">{{ quem(d.vinculo, d.matricula) }}</th>
              <td>{{ rotuloTipo(d.tipo) }}</td>
              <td>{{ dataBr(d.admissao) }}</td>
              <td>{{ dataBr(d.desligamento) }}</td>
              <td>
                {{
                  d.modalidadeSugerida
                    ? rotuloModalidade(d.modalidadeSugerida)
                    : t('folha.rescisao.fila.semSugestao')
                }}
              </td>
              <td>
                {{ d.rescisao ? t('folha.rescisao.fila.calculada') : t('folha.rescisao.fila.pendente') }}
              </td>
              <td class="acoes-linha">
                <SanteBotao
                  v-if="grava && d.tipo === 'clt'"
                  :rotulo="
                    d.rescisao ? t('folha.rescisao.fila.recalcular') : t('folha.rescisao.fila.calcular')
                  "
                  variante="texto"
                  :data-testid="`folha-rescisao-calcular-${d.vinculo}`"
                  @acionar="abrirFormulario(d)"
                />
                <SanteBotao
                  v-if="d.rescisao"
                  :rotulo="t('folha.rescisao.fila.ver')"
                  variante="texto"
                  :data-testid="`folha-rescisao-ver-${d.vinculo}`"
                  @acionar="verRescisao(d.rescisao)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="fila.data.value?.limitado" class="secundario">{{ t('folha.rescisao.fila.limitado') }}</p>
    </section>

    <!-- Rescisões do intervalo -->
    <section
      class="bloco"
      :aria-label="t('folha.rescisao.historico.titulo')"
      data-testid="folha-rescisao-historico"
    >
      <h3>{{ t('folha.rescisao.historico.titulo') }}</h3>
      <div class="campos">
        <SanteSelecao
          v-model="situacao"
          :rotulo="t('folha.rescisao.historico.situacao')"
          :opcoes="opcoesSituacao"
          data-testid="folha-rescisao-filtro-situacao"
        />
      </div>
      <ErroFolha v-if="historico.isError.value" :erro="historico.error.value" />
      <p v-else-if="intervaloOk && !historico.data.value" role="status">{{ t('folha.carregando') }}</p>
      <p
        v-else-if="historico.data.value && historicoVisivel.length === 0"
        data-testid="folha-rescisao-historico-vazio"
      >
        {{ t('folha.rescisao.historico.nenhuma') }}
      </p>
      <div
        v-else-if="historico.data.value"
        class="rolagem"
        tabindex="0"
        role="region"
        :aria-label="t('folha.rescisao.historico.titulo')"
      >
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('folha.rescisao.fila.desligamento') }}</th>
              <th scope="col">{{ t('folha.rescisao.fila.colaborador') }}</th>
              <th scope="col">{{ t('folha.rescisao.historico.modalidade') }}</th>
              <th scope="col">{{ t('folha.rescisao.historico.aviso') }}</th>
              <th scope="col">{{ t('folha.rescisao.historico.pagamento') }}</th>
              <th v-if="apoio.acoes.verSalario" scope="col">{{ t('folha.rescisao.historico.multa') }}</th>
              <th scope="col">{{ t('folha.situacao') }}</th>
              <th scope="col">{{ t('folha.rescisao.historico.registro') }}</th>
              <th scope="col">{{ t('folha.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in historicoVisivel" :key="r.id" :data-testid="`folha-rescisao-item-${r.id}`">
              <th scope="row">{{ dataBr(r.desligamento) }}</th>
              <td>{{ quem(r.vinculo, matriculas.get(r.vinculo) ?? null) }}</td>
              <td>{{ rotuloModalidade(r.modalidade) }}</td>
              <td>{{ rotuloAviso(r.aviso) }} · {{ r.diasAviso }}</td>
              <td>{{ dataBr(r.pagamento) }}</td>
              <td v-if="apoio.acoes.verSalario">{{ r.multaFgts === null ? '—' : reais(r.multaFgts) }}</td>
              <td>
                {{ t(`folha.rescisao.situacoes.${r.situacao}`) }}
                <span v-if="r.motivo" class="secundario"> · {{ r.motivo }}</span>
              </td>
              <td class="secundario">{{ r.registradoPor }} · {{ instanteBr(r.registradoEm) }}</td>
              <td class="acoes-linha">
                <SanteBotao
                  :rotulo="t('folha.rescisao.fila.ver')"
                  variante="texto"
                  :data-testid="`folha-rescisao-ver-item-${r.id}`"
                  @acionar="verRescisao(r.id)"
                />
                <a
                  v-if="acoesDaRescisao(r, apoio).termo"
                  :href="urlTermoRescisaoPdf(r.id)"
                  target="_blank"
                  rel="noopener"
                  :data-testid="`folha-rescisao-pdf-${r.id}`"
                  >{{ t('folha.rescisao.previa.pdf') }}</a
                >
                <SanteBotao
                  v-if="acoesDaRescisao(r, apoio).cancelar"
                  :rotulo="t('folha.rescisao.historico.cancelar')"
                  variante="texto"
                  :data-testid="`folha-rescisao-cancelar-${r.id}`"
                  @acionar="abrirCancelamento(r)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="historico.data.value?.limitado" class="secundario">{{ t('folha.rescisao.fila.limitado') }}</p>
    </section>

    <!-- Formulário -->
    <SanteDialogo v-model:visivel="formVisivel" :titulo="t('folha.rescisao.form.titulo')">
      <form data-testid="folha-rescisao-form" @submit.prevent="verPrevia">
        <p v-if="alvo">
          <strong>{{ quem(alvo.vinculo, alvo.matricula) }}</strong> ·
          {{
            t('folha.rescisao.form.desligado', {
              data: dataBr(alvo.desligamento),
              admissao: dataBr(alvo.admissao),
            })
          }}
        </p>
        <p v-if="alvo?.modalidadeSugerida" class="secundario" data-testid="folha-rescisao-sugerida">
          {{ t('folha.rescisao.form.sugerida', { modalidade: rotuloModalidade(alvo.modalidadeSugerida) }) }}
        </p>
        <SanteSelecao
          v-model="modalidade"
          :rotulo="t('folha.rescisao.form.modalidade')"
          :opcoes="opcoesModalidade"
          data-testid="folha-rescisao-modalidade"
        />
        <SanteOpcoes
          v-if="opcoesAviso.length"
          v-model="avisoPrevio"
          :legenda="t('folha.rescisao.form.aviso')"
          :opcoes="opcoesAviso"
          data-testid="folha-rescisao-aviso-previo"
        />
        <template v-if="pedeTermo(modalidade)">
          <SanteData
            v-model="termo"
            :rotulo="t('folha.rescisao.form.termo')"
            editavel
            data-testid="folha-rescisao-termo"
          />
          <p class="secundario">{{ t('folha.rescisao.form.termoAjuda') }}</p>
        </template>
        <div class="campos">
          <SanteCampoTexto
            v-model="saldoTexto"
            :rotulo="t('folha.rescisao.form.saldoFgts')"
            :max-bytes="20"
            data-testid="folha-rescisao-saldo"
          />
          <SanteData
            v-model="pagamento"
            :rotulo="t('folha.rescisao.form.pagamento')"
            editavel
            data-testid="folha-rescisao-pagamento"
          />
        </div>
        <p v-if="saldoInvalido" role="alert" data-testid="folha-rescisao-saldo-invalido">
          {{ t('folha.rescisao.form.saldoFgtsInvalido') }}
        </p>
        <p v-else class="secundario">{{ t('folha.rescisao.form.saldoFgtsAjuda') }}</p>
        <p v-if="alvo" class="secundario">
          {{ t('folha.rescisao.form.pagamentoAjuda', { data: dataBr(pagamentoPadrao(alvo.desligamento)) }) }}
        </p>
        <p v-if="empresa === null" role="alert">{{ t('folha.rescisao.escolhaEmpresa') }}</p>
        <p v-else-if="!formOk" class="secundario">{{ t('folha.rescisao.form.incompleto') }}</p>
        <section
          v-if="recusas.length"
          role="alert"
          :aria-label="t('folha.rescisao.form.recusasTitulo')"
          data-testid="folha-rescisao-recusas"
        >
          <h4>{{ t('folha.rescisao.form.recusasTitulo') }}</h4>
          <ul>
            <li v-for="r in recusas" :key="r" :data-testid="`folha-rescisao-recusa-${r}`">
              {{ t(`folha.rescisao.recusa.${r}`) }}
            </li>
          </ul>
        </section>
        <ErroFolha v-if="erro && formVisivel" :erro="erro" />
      </form>
      <template #rodape>
        <SanteBotao :rotulo="t('folha.fechar')" variante="texto" @acionar="formVisivel = false" />
        <SanteBotao
          :rotulo="t('folha.rescisao.form.previa')"
          :desabilitado="!formOk || ocupado"
          data-testid="folha-rescisao-previa"
          @acionar="verPrevia"
        />
      </template>
    </SanteDialogo>

    <!-- Prévia ou rescisão gravada -->
    <SanteDialogo
      v-model:visivel="termoVisivel"
      :titulo="
        resultado?.origem === 'previa'
          ? t('folha.rescisao.previa.titulo')
          : t('folha.rescisao.previa.gravadaTitulo')
      "
    >
      <div data-testid="folha-rescisao-termo-calculado">
        <ErroFolha v-if="erroTermo && !confirmando" :erro="erroTermo" />
        <p v-else-if="!resultado" role="status">{{ t('folha.carregando') }}</p>
        <template v-else>
          <p v-if="resultado.rescisao" data-testid="folha-rescisao-cabecalho">
            {{ quem(resultado.rescisao.vinculo, matriculas.get(resultado.rescisao.vinculo) ?? null) }} ·
            {{ rotuloModalidade(resultado.rescisao.modalidade) }} ·
            {{ rotuloAviso(resultado.rescisao.aviso) }} ·
            {{ t(`folha.rescisao.situacoes.${resultado.rescisao.situacao}`) }}
          </p>
          <p v-else-if="enviado" data-testid="folha-rescisao-cabecalho">
            {{ quem(enviado.vinculo, matriculas.get(enviado.vinculo) ?? null) }} ·
            {{ rotuloModalidade(enviado.modalidade) }} · {{ rotuloAviso(enviado.aviso) }}
          </p>
          <p v-if="resultado.processo" class="secundario" data-testid="folha-rescisao-numero">
            {{
              t('folha.rescisao.previa.numero', {
                numero: resultado.processo.numero,
                em: instanteBr(resultado.processo.calculadoEm),
                por: resultado.processo.calculadoPor,
              })
            }}
          </p>
          <section :aria-label="t('folha.rescisao.apuracao.titulo')" data-testid="folha-rescisao-apuracao">
            <h4>{{ t('folha.rescisao.apuracao.titulo') }}</h4>
            <ul>
              <li v-for="(l, i) in linhasApuracao" :key="i">{{ l }}</li>
            </ul>
          </section>
          <section
            v-if="resultado.pendencias.length"
            role="alert"
            :aria-label="t('folha.rescisao.previa.pendenciasTitulo')"
            data-testid="folha-rescisao-pendencias"
          >
            <h4>{{ t('folha.rescisao.previa.pendenciasTitulo') }}</h4>
            <ul>
              <li v-for="(p, i) in resultado.pendencias" :key="`${p.codigo}-${i}`">
                {{ t(`folha.calculo.pendencia.${p.codigo}`) }}
                <span v-if="p.papel" class="secundario">
                  · {{ t('folha.calculo.pendenciaPapel', { papel: t(`folha.calculo.papeis.${p.papel}`) }) }}
                </span>
              </li>
            </ul>
          </section>
          <ul v-if="resultado.avisos.length" data-testid="folha-rescisao-avisos">
            <li v-for="a in resultado.avisos" :key="a.codigo">{{ textoAviso(a) }}</li>
          </ul>
          <p v-if="resultado.ocultas" role="status" data-testid="folha-rescisao-oculto">
            {{ t('folha.rescisao.previa.oculto') }}
          </p>
          <p v-else-if="resultado.linhas.length === 0 && resultado.pendencias.length === 0">
            {{ t('folha.rescisao.previa.semLinhas') }}
          </p>
          <MemoriaLinhas
            v-else-if="resultado.linhas.length"
            :linhas="resultado.linhas"
            prefixo="folha-rescisao"
          />
          <p
            v-if="
              resultado.origem === 'gravada' &&
              resultado.rescisao &&
              acoesDaRescisao(resultado.rescisao, apoio).termo
            "
          >
            <a
              :href="urlTermoRescisaoPdf(resultado.rescisao.id)"
              target="_blank"
              rel="noopener"
              data-testid="folha-rescisao-pdf"
              >{{ t('folha.rescisao.previa.pdf') }}</a
            >
          </p>
        </template>
      </div>
      <template #rodape>
        <SanteBotao :rotulo="t('folha.fechar')" variante="texto" @acionar="termoVisivel = false" />
        <SanteBotao
          v-if="
            resultado?.origem === 'gravada' &&
            resultado.rescisao &&
            acoesDaRescisao(resultado.rescisao, apoio).cancelar
          "
          :rotulo="t('folha.rescisao.historico.cancelar')"
          variante="secundario"
          data-testid="folha-rescisao-cancelar"
          @acionar="abrirCancelamento(resultado.rescisao)"
        />
        <SanteBotao
          v-if="podeGravar"
          :rotulo="t('folha.rescisao.previa.gravar')"
          data-testid="folha-rescisao-gravar"
          @acionar="confirmando = true"
        />
      </template>
    </SanteDialogo>

    <SanteDialogo v-model:visivel="confirmando" :titulo="t('folha.rescisao.previa.gravar')">
      <p data-testid="folha-rescisao-confirmacao">{{ t('folha.rescisao.previa.confirmar') }}</p>
      <ErroFolha v-if="erroTermo && confirmando" :erro="erroTermo" />
      <template #rodape>
        <SanteBotao :rotulo="t('folha.fechar')" variante="texto" @acionar="confirmando = false" />
        <SanteBotao
          :rotulo="t('folha.confirmar')"
          :desabilitado="ocupado"
          data-testid="folha-rescisao-confirmar"
          @acionar="gravar"
        />
      </template>
    </SanteDialogo>

    <!-- Cancelar -->
    <SanteDialogo v-model:visivel="cancelando" :titulo="t('folha.rescisao.cancelar.titulo')">
      <p v-if="alvoCancelamento">
        {{ quem(alvoCancelamento.vinculo, matriculas.get(alvoCancelamento.vinculo) ?? null) }} ·
        {{ dataBr(alvoCancelamento.desligamento) }} · {{ rotuloModalidade(alvoCancelamento.modalidade) }}
      </p>
      <p class="secundario">{{ t('folha.rescisao.cancelar.ajuda') }}</p>
      <SanteCampoTexto
        v-model="motivo"
        :rotulo="t('folha.rescisao.cancelar.motivo')"
        :max-bytes="200"
        data-testid="folha-rescisao-motivo"
      />
      <ErroFolha v-if="erro && cancelando" :erro="erro" />
      <template #rodape>
        <SanteBotao :rotulo="t('folha.fechar')" variante="texto" @acionar="cancelando = false" />
        <SanteBotao
          :rotulo="t('folha.confirmar')"
          :desabilitado="!cancelamento.success"
          data-testid="folha-rescisao-confirmar-cancelamento"
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
