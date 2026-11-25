<script setup lang="ts">
// Controle orçamentário na compra e no pagamento (C2-112, 07-FIN linha 130), em `/financeiro/orcamento/controle`, aberta
// pelo orçamento empresarial. Numa tela só, em quatro abas: reservar o pedido de compra ou o título a pagar na linha do
// orçamento com o saldo e a regra que vale à vista antes de gravar (o alerta pede ciência; o bloqueio abre o pedido de
// exceção ali mesmo); as reservas com a nota (parcial ou final) e a liberação com o motivo; as exceções, decididas por
// outra pessoa; e as regras (comece em alerta: o bloqueio é decisão do hospital). Mesmas regras do domínio que a API
// aplica; nada se apaga.
import {
  ACOES_CONTROLE,
  conferirSaldo,
  DOCUMENTOS_CONTROLE,
  DOCUMENTOS_RESERVA,
  PERIODOS_APURACAO,
  validarExcecaoOrcamentaria,
  validarRegraControle,
  type AcaoControle,
  type DocumentoControle,
  type PeriodoApuracao,
} from '@sgh/dominio-financeiro';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../casca/sessao/pode.js';
import {
  controlarDocumento,
  decidirExcecao,
  lerPainelControle,
  lerSaldoControle,
  liberarReserva,
  pedirExcecao,
  type RegraLida,
  registrarNotaReserva,
  reservarOrcamento,
  salvarRegraControle,
} from './api-controle-orcamentario.js';
import ErroOrcamento from './ErroOrcamento.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const D = 'orcamentoEmpresarial.controle';
const podeGravar = computed(() => pode('financeiro.orcamento.editar'));
const podeAprovar = computed(() => pode('financeiro.orcamento.aprovar'));
type Id = number | '';
const nulo = (v: Id) => (v === '' ? null : v);
const hoje = () => new Date().toISOString().slice(0, 10);
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numero = (v: string) => {
  const x = Number(String(v).replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(x) ? null : x;
};

const ABAS = ['reservar', 'reservas', 'excecoes', 'regras'] as const;
const aba = ref<(typeof ABAS)[number]>('reservar');
const painel = useQuery({ queryKey: ['orcamento', 'controle'], queryFn: lerPainelControle });
const p = computed(() => painel.data.value);
const recarregar = () => cliente.invalidateQueries({ queryKey: ['orcamento', 'controle'] });
const comVazio = (vazio: string, itens: readonly { id: number; nome: string }[]) => [
  { valor: '' as Id, rotulo: vazio },
  ...itens.map((x) => ({ valor: x.id as Id, rotulo: x.nome })),
];

const erro = ref<unknown>(null);
const aviso = ref('');
const acao = useMutation({
  mutationFn: (fn: () => Promise<unknown>) => fn(),
  onSuccess: () => {
    erro.value = null;
    aviso.value = t(`${D}.feito`);
    void recarregar();
  },
  onError: (e) => {
    aviso.value = '';
    erro.value = e;
  },
});

// ------------------------------------------------------------ reservar
const r = ref({
  tipoDocumento: 'pedido_compra' as string,
  documento: '' as Id,
  linha: '' as Id,
  mes: hoje().slice(0, 7),
  conta: '' as Id,
  valor: '',
  ciente: false,
  justificativa: '',
});
const competencia = computed(() => (/^\d{4}-\d{2}$/.test(r.value.mes) ? `${r.value.mes}-01` : ''));
const opDocumentos = computed(() =>
  DOCUMENTOS_RESERVA.map((x) => ({ valor: x as string, rotulo: t(`${D}.documentos.${x}`) })),
);
// O documento é escolhido pelo número de negócio, com o fornecedor, o valor e o já reservado à vista.
const docsDoTipo = computed(() =>
  (p.value?.documentos ?? []).filter((d) => d.tipoDocumento === r.value.tipoDocumento),
);
const opDocumentosLista = computed(() =>
  comVazio(
    t(`${D}.escolha`),
    docsDoTipo.value.map((d) => ({
      id: d.id,
      nome: [d.numero, d.fornecedor, moeda(d.valor), t(`${D}.jaReservado`, { valor: moeda(d.reservado) })]
        .filter(Boolean)
        .join(' · '),
    })),
  ),
);
const opLinhas = computed(() => comVazio(t(`${D}.escolha`), p.value?.linhas ?? []));
const opContas = computed(() => comVazio(t(`${D}.escolha`), p.value?.contas ?? []));
const saldo = useQuery({
  queryKey: computed(() => [
    'orcamento',
    'controle',
    'saldo',
    r.value.linha,
    competencia.value,
    r.value.tipoDocumento,
    r.value.conta,
  ]),
  queryFn: () =>
    lerSaldoControle({
      linha: r.value.linha as number,
      competencia: competencia.value,
      tipoDocumento: r.value.tipoDocumento,
      conta: nulo(r.value.conta),
    }),
  enabled: computed(() => r.value.linha !== '' && competencia.value !== ''),
});
const valorReserva = computed(() => numero(r.value.valor));
const conferencia = computed(() => {
  const s = saldo.data.value;
  if (!s || valorReserva.value === null) return null;
  return conferirSaldo({
    acao: s.acao,
    tolerancia: s.regra?.tolerancia ?? 0,
    saldo: s,
    valor: valorReserva.value,
    ciente: r.value.ciente,
    excecaoAprovada: null,
  });
});
const bloqueado = computed(() => conferencia.value?.decisao === 'bloqueio');
const documentoId = computed(() =>
  docsDoTipo.value.some((d) => d.id === r.value.documento) ? (r.value.documento as number) : null,
);
function reservarPeloDocumento() {
  acao.mutate(() =>
    controlarDocumento({
      tipoDocumento: r.value.tipoDocumento,
      documento: documentoId.value!,
      ciente: r.value.ciente,
    }),
  );
}
const podeReservar = computed(
  () =>
    podeGravar.value &&
    documentoId.value !== null &&
    r.value.linha !== '' &&
    competencia.value !== '' &&
    (conferencia.value === null || conferencia.value.decisao !== 'bloqueio') &&
    !(conferencia.value?.decisao === 'alerta' && !r.value.ciente),
);
function reservar() {
  acao.mutate(() =>
    reservarOrcamento({
      tipoDocumento: r.value.tipoDocumento,
      documento: documentoId.value!,
      linha: r.value.linha as number,
      competencia: competencia.value,
      contaOrcamentaria: nulo(r.value.conta),
      valor: valorReserva.value,
      ciente: r.value.ciente,
    }),
  );
}
const problemasExcecao = computed(() => {
  const ps = validarExcecaoOrcamentaria({
    valor: conferencia.value?.excesso ?? 0,
    justificativa: r.value.justificativa,
  });
  if (r.value.conta === '') ps.push({ campo: 'conta', mensagem: t(`${D}.contaObrigatoria`) });
  return ps;
});
function enviarExcecao() {
  acao.mutate(() =>
    pedirExcecao({
      tipoDocumento: r.value.tipoDocumento,
      documento: documentoId.value!,
      linha: r.value.linha as number,
      competencia: competencia.value,
      contaOrcamentaria: r.value.conta as number,
      valor: conferencia.value!.excesso,
      justificativa: r.value.justificativa.trim(),
    }),
  );
}

// ------------------------------------------------------------ reservas: nota e liberação
const notaAberta = ref<number | null>(null);
const nota = ref({ valor: '', final: false, numero: '', ciente: false });
const liberarAberta = ref<number | null>(null);
const motivoLiberar = ref('');
function abrirNota(id: number) {
  notaAberta.value = id;
  liberarAberta.value = null;
  nota.value = { valor: '', final: false, numero: '', ciente: false };
}
function gravarNota(id: number, versao: number) {
  acao.mutate(async () => {
    await registrarNotaReserva(id, {
      versao,
      valorRealizado: numero(nota.value.valor) ?? 0,
      final: nota.value.final,
      numeroDocumento: nota.value.numero.trim() || null,
      ciente: nota.value.ciente,
    });
    notaAberta.value = null;
  });
}
function confirmarLiberar(id: number, versao: number) {
  acao.mutate(async () => {
    await liberarReserva(id, { versao, motivo: motivoLiberar.value.trim() });
    liberarAberta.value = null;
    motivoLiberar.value = '';
  });
}

// ------------------------------------------------------------ exceções
const parecer = ref<Record<number, string>>({});
function decidir(id: number, versao: number, aprovar: boolean) {
  acao.mutate(() => decidirExcecao(id, { versao, aprovar, parecer: parecer.value[id]?.trim() || null }));
}

// ------------------------------------------------------------ regras
const regraEditando = ref<number | null | 'nova'>(null);
const regraVersao = ref<number | undefined>(undefined);
const g = ref({
  acao: 'alertar' as string,
  tipoDocumento: 'todos' as string,
  planoOrcamentario: '' as Id,
  centroCusto: '' as Id,
  contaOrcamentaria: '' as Id,
  naturezaFinanceira: '' as Id,
  tolerancia: '0',
  periodo: 'mensal' as string,
  prioridade: '100',
  vigenciaInicio: hoje(),
  vigenciaFim: '',
  ativo: true,
});
const opAcoes = computed(() =>
  ACOES_CONTROLE.map((x) => ({ valor: x as string, rotulo: t(`${D}.acoes.${x}`) })),
);
const opDocControle = computed(() =>
  DOCUMENTOS_CONTROLE.map((x) => ({ valor: x as string, rotulo: t(`${D}.documentos.${x}`) })),
);
const opPeriodos = computed(() =>
  PERIODOS_APURACAO.map((x) => ({ valor: x as string, rotulo: t(`${D}.periodos.${x}`) })),
);
const opPlanos = computed(() => comVazio(t(`${D}.todos`), p.value?.planos ?? []));
const opCentros = computed(() => comVazio(t(`${D}.todos`), p.value?.centros ?? []));
const opContasRegra = computed(() => comVazio(t(`${D}.todos`), p.value?.contas ?? []));
const opNaturezas = computed(() => comVazio(t(`${D}.todos`), p.value?.naturezas ?? []));
const nomeDe = (lista: readonly { id: number; nome: string }[] | undefined, id: number | null) =>
  id === null ? t(`${D}.todos`) : (lista?.find((x) => x.id === id)?.nome ?? String(id));
function novaRegra() {
  regraEditando.value = 'nova';
  regraVersao.value = undefined;
  g.value = {
    acao: 'alertar',
    tipoDocumento: 'todos',
    planoOrcamentario: '',
    centroCusto: '',
    contaOrcamentaria: '',
    naturezaFinanceira: '',
    tolerancia: '0',
    periodo: 'mensal',
    prioridade: '100',
    vigenciaInicio: hoje(),
    vigenciaFim: '',
    ativo: true,
  };
}
function editarRegra(x: RegraLida) {
  regraEditando.value = x.id;
  regraVersao.value = x.versao;
  g.value = {
    acao: x.acao,
    tipoDocumento: x.tipoDocumento,
    planoOrcamentario: x.planoOrcamentario ?? '',
    centroCusto: x.centroCusto ?? '',
    contaOrcamentaria: x.contaOrcamentaria ?? '',
    naturezaFinanceira: x.naturezaFinanceira ?? '',
    tolerancia: String(x.tolerancia),
    periodo: x.periodo,
    prioridade: String(x.prioridade),
    vigenciaInicio: x.vigenciaInicio,
    vigenciaFim: x.vigenciaFim ?? '',
    ativo: x.ativo,
  };
}
const regraProposta = computed(() => ({
  acao: g.value.acao as AcaoControle,
  tipoDocumento: g.value.tipoDocumento as DocumentoControle,
  planoOrcamentario: nulo(g.value.planoOrcamentario),
  versaoOrcamento: null,
  centroCusto: nulo(g.value.centroCusto),
  contaOrcamentaria: nulo(g.value.contaOrcamentaria),
  naturezaFinanceira: nulo(g.value.naturezaFinanceira),
  tolerancia: numero(g.value.tolerancia) ?? NaN,
  periodo: g.value.periodo as PeriodoApuracao,
  prioridade: Number(g.value.prioridade),
  vigenciaInicio: g.value.vigenciaInicio,
  vigenciaFim: g.value.vigenciaFim || null,
}));
const problemasRegra = computed(() => validarRegraControle(regraProposta.value));
function gravarRegra(ativo = g.value.ativo) {
  const alvo = regraEditando.value === 'nova' ? null : regraEditando.value;
  acao.mutate(async () => {
    await salvarRegraControle(alvo, {
      ...regraProposta.value,
      ativo,
      ...(regraVersao.value !== undefined ? { versao: regraVersao.value } : {}),
    });
    regraEditando.value = null;
  });
}
function alternarRegra(x: RegraLida) {
  editarRegra(x);
  gravarRegra(!x.ativo);
}
</script>

<template>
  <section class="tela-controle" aria-labelledby="ctl-titulo" data-testid="tela-controle-orcamentario">
    <h1 id="ctl-titulo">{{ t(`${D}.titulo`) }}</h1>
    <p>{{ t(`${D}.texto`) }}</p>
    <p>
      <RouterLink :to="{ name: 'financeiro.orcamento' }" data-testid="ctl-ir-orcamento">{{
        t(`${D}.irOrcamento`)
      }}</RouterLink>
    </p>
    <SanteAlerta v-if="!podeGravar" :texto="t(`${D}.somenteLeitura`)" variante="info" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="ctl-aviso" />
    <ErroOrcamento v-if="erro" :erro="erro" />
    <ErroOrcamento v-if="painel.isError.value" :erro="painel.error.value" />

    <div class="acoes" role="tablist">
      <SanteBotao
        v-for="x in ABAS"
        :key="x"
        role="tab"
        :aria-selected="aba === x"
        :variante="aba === x ? 'primario' : 'secundario'"
        :rotulo="t(`${D}.abas.${x}`)"
        :data-testid="`ctl-aba-${x}`"
        @acionar="aba = x"
      />
    </div>

    <!-- Reservar -->
    <form v-if="aba === 'reservar'" aria-labelledby="ctl-reservar" data-testid="ctl-reservar" @submit.prevent>
      <h2 id="ctl-reservar">{{ t(`${D}.abas.reservar`) }}</h2>
      <div class="grade">
        <SanteSelecao
          v-model="r.tipoDocumento"
          :rotulo="t(`${D}.documento`)"
          :opcoes="opDocumentos"
          data-testid="ctl-tipo-documento"
        />
        <SanteSelecao
          v-model="r.documento"
          :rotulo="t(`${D}.numeroDocumento`)"
          :opcoes="opDocumentosLista"
          data-testid="ctl-documento"
        />
        <SanteSelecao
          v-model="r.linha"
          :rotulo="t(`${D}.linha`)"
          :opcoes="opLinhas"
          data-testid="ctl-linha"
        />
        <label
          >{{ t(`${D}.competencia`) }}
          <input v-model="r.mes" type="month" data-testid="ctl-competencia" />
        </label>
        <SanteSelecao
          v-model="r.conta"
          :rotulo="t(`${D}.conta`)"
          :opcoes="opContas"
          data-testid="ctl-conta"
        />
        <label
          >{{ t(`${D}.valor`) }}
          <input
            v-model="r.valor"
            inputmode="decimal"
            :placeholder="t(`${D}.valorVazio`)"
            data-testid="ctl-valor"
          />
        </label>
      </div>
      <dl v-if="saldo.data.value" class="resumo" data-testid="ctl-saldo">
        <div>
          <dt>{{ t(`${D}.orcado`) }}</dt>
          <dd>{{ moeda(saldo.data.value.orcado) }}</dd>
        </div>
        <div>
          <dt>{{ t(`${D}.comprometido`) }}</dt>
          <dd>{{ moeda(saldo.data.value.comprometido) }}</dd>
        </div>
        <div>
          <dt>{{ t(`${D}.realizado`) }}</dt>
          <dd>{{ moeda(saldo.data.value.realizado) }}</dd>
        </div>
        <div>
          <dt>{{ t(`${D}.disponivel`) }}</dt>
          <dd data-testid="ctl-disponivel">{{ moeda(saldo.data.value.disponivel) }}</dd>
        </div>
        <div>
          <dt>{{ t(`${D}.regraQueVale`) }}</dt>
          <dd data-testid="ctl-regra-que-vale">
            {{ saldo.data.value.regra ? t(`${D}.acoes.${saldo.data.value.acao}`) : t(`${D}.semRegra`) }}
            ({{ t(`${D}.periodos.${saldo.data.value.periodo}`) }})
          </dd>
        </div>
      </dl>
      <template v-if="conferencia && conferencia.excesso > 0 && conferencia.decisao !== 'livre'">
        <SanteAlerta
          :texto="t(`${D}.passaDoSaldo`, { valor: moeda(conferencia.excesso) })"
          variante="aviso"
          data-testid="ctl-excesso"
        />
        <label v-if="conferencia.decisao === 'alerta'" class="marca">
          <input v-model="r.ciente" type="checkbox" data-testid="ctl-ciente" />
          {{ t(`${D}.ciente`) }}
        </label>
      </template>
      <SanteBotao
        :rotulo="t(`${D}.reservar`)"
        :desabilitado="!podeReservar || acao.isPending.value"
        data-testid="ctl-reservar-gravar"
        @acionar="reservar"
      />
      <SanteBotao
        v-if="podeGravar && documentoId !== null"
        :rotulo="t(`${D}.reservarPeloDocumento`)"
        variante="secundario"
        :desabilitado="acao.isPending.value"
        data-testid="ctl-reservar-documento"
        @acionar="reservarPeloDocumento"
      />
      <fieldset v-if="bloqueado && podeGravar" data-testid="ctl-excecao">
        <legend>{{ t(`${D}.pedirExcecao`) }}</legend>
        <p>{{ t(`${D}.bloqueia`) }}</p>
        <label class="largo"
          >{{ t(`${D}.justificativa`) }}
          <textarea v-model="r.justificativa" maxlength="1000" rows="3" data-testid="ctl-justificativa" />
        </label>
        <ul v-if="problemasExcecao.length" data-testid="ctl-excecao-problemas">
          <li v-for="x in problemasExcecao" :key="x.campo">{{ x.mensagem }}</li>
        </ul>
        <SanteBotao
          :rotulo="t(`${D}.enviarExcecao`)"
          :desabilitado="problemasExcecao.length > 0 || documentoId === null || acao.isPending.value"
          data-testid="ctl-excecao-enviar"
          @acionar="enviarExcecao"
        />
      </fieldset>
    </form>

    <!-- Reservas -->
    <section v-if="aba === 'reservas' && p" aria-labelledby="ctl-reservas">
      <h2 id="ctl-reservas">{{ t(`${D}.abas.reservas`) }}</h2>
      <p v-if="!p.reservas.length" role="status">{{ t(`${D}.vazioReservas`) }}</p>
      <table v-else data-testid="ctl-lista-reservas">
        <thead>
          <tr>
            <th scope="col">{{ t(`${D}.documento`) }}</th>
            <th scope="col">{{ t(`${D}.competencia`) }}</th>
            <th scope="col">{{ t(`${D}.reservado`) }}</th>
            <th scope="col">{{ t(`${D}.consumido`) }}</th>
            <th scope="col">{{ t(`${D}.aberto`) }}</th>
            <th scope="col">{{ t(`${D}.situacao`) }}</th>
            <th scope="col">
              <span class="sgh-visualmente-oculto">{{ t(`${D}.nota`) }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="x in p.reservas" :key="x.id">
            <tr :data-testid="`ctl-reserva-${x.id}`">
              <td>
                {{ t(`${D}.documentos.${x.tipoDocumento}`) }} {{ x.documentoNumero ?? '' }} ·
                {{ x.numero }}
                <strong v-if="x.excedeuSaldo">{{ t(`${D}.excedeu`) }}</strong>
              </td>
              <td>{{ x.competencia.slice(0, 7) }}</td>
              <td>{{ moeda(x.reservado) }}</td>
              <td>{{ moeda(x.consumido) }}</td>
              <td>{{ moeda(x.aberto) }}</td>
              <td>
                {{ t(`${D}.situacoesReserva.${x.situacao}`) }}
                <span v-if="x.motivoLiberacao"> · {{ x.motivoLiberacao }}</span>
              </td>
              <td>
                <div v-if="podeGravar && x.aberto > 0" class="acoes">
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t(`${D}.nota`)"
                    :data-testid="`ctl-nota-${x.id}`"
                    @acionar="abrirNota(x.id)"
                  />
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t(`${D}.liberar`)"
                    :data-testid="`ctl-liberar-${x.id}`"
                    @acionar="
                      liberarAberta = x.id;
                      notaAberta = null;
                    "
                  />
                </div>
              </td>
            </tr>
            <tr v-if="notaAberta === x.id">
              <td colspan="7">
                <div class="grade">
                  <label
                    >{{ t(`${D}.valorNota`) }}
                    <input v-model="nota.valor" inputmode="decimal" data-testid="ctl-nota-valor" />
                  </label>
                  <label
                    >{{ t(`${D}.numeroDocumento`) }}
                    <input v-model="nota.numero" maxlength="30" data-testid="ctl-nota-numero" />
                  </label>
                  <label class="marca">
                    <input v-model="nota.final" type="checkbox" data-testid="ctl-nota-final" />
                    {{ t(`${D}.notaFinal`) }}
                  </label>
                  <label v-if="nota.final" class="marca">
                    <input v-model="nota.ciente" type="checkbox" data-testid="ctl-nota-ciente" />
                    {{ t(`${D}.notaCiente`) }}
                  </label>
                  <SanteBotao
                    :rotulo="t(`${D}.gravarNota`)"
                    :desabilitado="numero(nota.valor) === null || acao.isPending.value"
                    data-testid="ctl-nota-gravar"
                    @acionar="gravarNota(x.id, x.versao)"
                  />
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t(`${D}.cancelar`)"
                    @acionar="notaAberta = null"
                  />
                </div>
              </td>
            </tr>
            <tr v-if="liberarAberta === x.id">
              <td colspan="7">
                <div class="grade">
                  <label
                    >{{ t(`${D}.motivo`) }}
                    <input v-model="motivoLiberar" maxlength="400" data-testid="ctl-liberar-motivo" />
                  </label>
                  <SanteBotao
                    :rotulo="t(`${D}.confirmarLiberar`)"
                    :desabilitado="motivoLiberar.trim().length < 5 || acao.isPending.value"
                    data-testid="ctl-liberar-confirmar"
                    @acionar="confirmarLiberar(x.id, x.versao)"
                  />
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t(`${D}.cancelar`)"
                    @acionar="liberarAberta = null"
                  />
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </section>

    <!-- Exceções -->
    <section v-if="aba === 'excecoes' && p" aria-labelledby="ctl-excecoes">
      <h2 id="ctl-excecoes">{{ t(`${D}.abas.excecoes`) }}</h2>
      <p v-if="!p.excecoes.length" role="status">{{ t(`${D}.vazioExcecoes`) }}</p>
      <table v-else data-testid="ctl-lista-excecoes">
        <thead>
          <tr>
            <th scope="col">{{ t(`${D}.documento`) }}</th>
            <th scope="col">{{ t(`${D}.valor`) }}</th>
            <th scope="col">{{ t(`${D}.saldoNoPedido`) }}</th>
            <th scope="col">{{ t(`${D}.justificativa`) }}</th>
            <th scope="col">{{ t(`${D}.solicitante`) }}</th>
            <th scope="col">{{ t(`${D}.situacao`) }}</th>
            <th scope="col">{{ t(`${D}.parecer`) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in p.excecoes" :key="x.id" :data-testid="`ctl-excecao-${x.id}`">
            <td>
              {{ t(`${D}.documentos.${x.tipoDocumento}`) }} {{ x.documentoNumero ?? '' }} · {{ x.numero }}
            </td>
            <td>{{ moeda(x.valor) }}</td>
            <td>{{ x.saldoDisponivel === null ? '' : moeda(x.saldoDisponivel) }}</td>
            <td>{{ x.justificativa }}</td>
            <td>{{ x.solicitanteNome }}</td>
            <td>{{ t(`${D}.situacoesExcecao.${x.situacao}`) }}</td>
            <td>
              <template v-if="x.situacao === 'pendente' && podeAprovar">
                <span v-if="x.solicitante === p.usuario">{{ t(`${D}.suaExcecao`) }}</span>
                <div v-else class="grade">
                  <label
                    >{{ t(`${D}.parecer`) }}
                    <input v-model="parecer[x.id]" maxlength="1000" :data-testid="`ctl-parecer-${x.id}`" />
                  </label>
                  <SanteBotao
                    :rotulo="t(`${D}.aprovar`)"
                    :data-testid="`ctl-aprovar-${x.id}`"
                    @acionar="decidir(x.id, x.versao, true)"
                  />
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t(`${D}.reprovar`)"
                    :desabilitado="(parecer[x.id] ?? '').trim().length < 5"
                    :data-testid="`ctl-reprovar-${x.id}`"
                    @acionar="decidir(x.id, x.versao, false)"
                  />
                </div>
              </template>
              <span v-else>{{ x.parecer }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Regras -->
    <section v-if="aba === 'regras' && p" aria-labelledby="ctl-regras">
      <h2 id="ctl-regras">{{ t(`${D}.abas.regras`) }}</h2>
      <p>{{ t(`${D}.recomendacao`) }}</p>
      <SanteBotao
        v-if="podeGravar && regraEditando === null"
        :rotulo="t(`${D}.novaRegra`)"
        data-testid="ctl-regra-nova"
        @acionar="novaRegra"
      />
      <form v-if="regraEditando !== null" data-testid="ctl-regra-form" @submit.prevent>
        <div class="grade">
          <SanteSelecao
            v-model="g.acao"
            :rotulo="t(`${D}.acao`)"
            :opcoes="opAcoes"
            data-testid="ctl-regra-acao"
          />
          <SanteSelecao
            v-model="g.tipoDocumento"
            :rotulo="t(`${D}.tipoDocumento`)"
            :opcoes="opDocControle"
            data-testid="ctl-regra-documento"
          />
          <SanteSelecao
            v-model="g.planoOrcamentario"
            :rotulo="t(`${D}.plano`)"
            :opcoes="opPlanos"
            data-testid="ctl-regra-plano"
          />
          <SanteSelecao
            v-model="g.centroCusto"
            :rotulo="t(`${D}.centro`)"
            :opcoes="opCentros"
            data-testid="ctl-regra-centro"
          />
          <SanteSelecao
            v-model="g.contaOrcamentaria"
            :rotulo="t(`${D}.conta`)"
            :opcoes="opContasRegra"
            data-testid="ctl-regra-conta"
          />
          <SanteSelecao
            v-model="g.naturezaFinanceira"
            :rotulo="t(`${D}.natureza`)"
            :opcoes="opNaturezas"
            data-testid="ctl-regra-natureza"
          />
          <label
            >{{ t(`${D}.tolerancia`) }}
            <input v-model="g.tolerancia" inputmode="decimal" data-testid="ctl-regra-tolerancia" />
          </label>
          <SanteSelecao
            v-model="g.periodo"
            :rotulo="t(`${D}.periodo`)"
            :opcoes="opPeriodos"
            data-testid="ctl-regra-periodo"
          />
          <label
            >{{ t(`${D}.prioridade`) }}
            <input v-model="g.prioridade" inputmode="numeric" data-testid="ctl-regra-prioridade" />
          </label>
          <label
            >{{ t(`${D}.vigenciaInicio`) }}
            <input v-model="g.vigenciaInicio" type="date" data-testid="ctl-regra-inicio" />
          </label>
          <label
            >{{ t(`${D}.vigenciaFim`) }}
            <input v-model="g.vigenciaFim" type="date" data-testid="ctl-regra-fim" />
          </label>
        </div>
        <ul v-if="problemasRegra.length" data-testid="ctl-regra-problemas">
          <li v-for="x in problemasRegra" :key="x.campo">{{ x.mensagem }}</li>
        </ul>
        <div class="acoes">
          <SanteBotao
            :rotulo="t(`${D}.gravarRegra`)"
            :desabilitado="problemasRegra.length > 0 || acao.isPending.value"
            data-testid="ctl-regra-gravar"
            @acionar="gravarRegra()"
          />
          <SanteBotao variante="secundario" :rotulo="t(`${D}.cancelar`)" @acionar="regraEditando = null" />
        </div>
      </form>
      <p v-if="!p.regras.length" role="status">{{ t(`${D}.vazioRegras`) }}</p>
      <table v-else data-testid="ctl-lista-regras">
        <thead>
          <tr>
            <th scope="col">{{ t(`${D}.prioridade`) }}</th>
            <th scope="col">{{ t(`${D}.acao`) }}</th>
            <th scope="col">{{ t(`${D}.tipoDocumento`) }}</th>
            <th scope="col">{{ t(`${D}.centro`) }}</th>
            <th scope="col">{{ t(`${D}.conta`) }}</th>
            <th scope="col">{{ t(`${D}.tolerancia`) }}</th>
            <th scope="col">{{ t(`${D}.periodo`) }}</th>
            <th scope="col">{{ t(`${D}.situacao`) }}</th>
            <th scope="col">
              <span class="sgh-visualmente-oculto">{{ t(`${D}.editarRegra`) }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in p.regras" :key="x.id" :data-testid="`ctl-regra-${x.id}`">
            <td>{{ x.prioridade }}</td>
            <td>{{ t(`${D}.acoes.${x.acao}`) }}</td>
            <td>{{ t(`${D}.documentos.${x.tipoDocumento}`) }}</td>
            <td>{{ nomeDe(p.centros, x.centroCusto) }}</td>
            <td>{{ nomeDe(p.contas, x.contaOrcamentaria) }}</td>
            <td>{{ x.tolerancia }}%</td>
            <td>{{ t(`${D}.periodos.${x.periodo}`) }}</td>
            <td>{{ x.ativo ? t(`${D}.ativa`) : t(`${D}.inativa`) }}</td>
            <td>
              <div v-if="podeGravar" class="acoes">
                <SanteBotao
                  variante="secundario"
                  :rotulo="t(`${D}.editarRegra`)"
                  :data-testid="`ctl-regra-editar-${x.id}`"
                  @acionar="editarRegra(x)"
                />
                <SanteBotao
                  variante="secundario"
                  :rotulo="x.ativo ? t(`${D}.desativar`) : t(`${D}.reativar`)"
                  :data-testid="`ctl-regra-alternar-${x.id}`"
                  @acionar="alternarRegra(x)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<style scoped>
.grade {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
.acoes {
  display: flex;
  gap: 0.5rem;
  margin: 0.5rem 0;
}
.resumo {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
}
.resumo dd {
  margin: 0;
  font-weight: 600;
}
.marca {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.largo {
  display: flex;
  flex-direction: column;
  max-width: 40rem;
}
table {
  border-collapse: collapse;
  margin: 0.75rem 0;
}
th,
td {
  padding: 0.25rem 0.5rem;
  text-align: left;
  vertical-align: top;
}
</style>
