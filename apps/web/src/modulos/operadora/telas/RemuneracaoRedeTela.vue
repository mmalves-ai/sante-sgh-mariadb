<script setup lang="ts">
// Remuneração e pagamento do prestador da rede (08-SGO L102, C2-120). Quatro abas numa tela só:
// - Tabelas: tabela negociada (reais ou CH/UCO/filme) e itens, com o valor calculado na hora;
// - Regras: regra de valoração (fator, acréscimo de urgência ou horário) e a simulação do valor de um evento;
// - Pagamento: visão pelo prestador (contas analisadas sem lote, adiantamentos, lotes), lote com tributos e fechamento
//   que gera o título no contas a pagar, adiantamento com título; reajuste do contrato;
// - Calendário: competências do ano com entrega, corte e pagamento, e o fechamento.
// - Pacotes: pacote negociado (principal, itens dentro e fora, diárias, valor global), validado na hora.
// Os tributos do lote vêm do cadastro tributário (alíquota, mínimo, enquadramento); a alíquota digitada é exceção.
// A validação é do servidor (domínio); a tela confere o óbvio antes de enviar.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { mensagensRemuneracaoRede } from '../i18n-remuneracao.js';
import { pode } from '../../../casca/sessao/pode.js';
import { lerTelaCobranca } from '../api-cobranca.js';
import {
  buscarItensFaturaveis,
  buscarProcedimentos,
  type CalendarioPagamento,
  cancelarLote,
  criarLote,
  fecharCalendario,
  fecharLote,
  incluirAdiantamento,
  incluirCalendario,
  incluirItem,
  incluirPacote,
  incluirRegra,
  incluirTabela,
  type ItemTabela,
  lerCalendario,
  lerItens,
  lerPacotes,
  lerOpcoes,
  lerPrestador,
  lerRegras,
  lerTabelas,
  type Opcao,
  type OpcoesRemuneracao,
  type PacoteRemuneracao,
  reajustarContrato,
  type RegraValoracao,
  type ResultadoValoracao,
  type TabelaRemuneracao,
  valorarEvento,
  type VisaoPrestador,
} from '../api-remuneracao-rede.js';

const { t } = useI18n({ useScope: 'local', messages: { 'pt-BR': mensagensRemuneracaoRede } });
const podeEditar = computed(() => pode('operadora.prestador.editar'));
const podePagar = computed(() => pode('operadora.conta.pagar'));
const erro = ref<string | null>(null);
const aviso = ref<string | null>(null);
const aba = ref<'tabelas' | 'regras' | 'pacotes' | 'pagamento' | 'calendario'>('tabelas');
const operadoras = ref<{ valor: number | null; rotulo: string }[]>([]);
const operadora = ref<number | null>(null);
const vazio: OpcoesRemuneracao = {
  prestadores: [],
  tabelas: [],
  grupos: [],
  indices: [],
  tributos: [],
  naturezas: [],
  documentos: [],
  contratos: [],
  tiposPrestador: [],
};
const opcoes = ref<OpcoesRemuneracao>(vazio);
const moeda = (v: number | null) =>
  v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: string | null) => (v ? v.split('-').reverse().join('/') : '—');
const numeroBr = (v: string): number | null => {
  const t = v.trim().replace(/\./g, '').replace(',', '.');
  return t === '' || Number.isNaN(Number(t)) ? null : Number(t);
};
const lista = (xs: Opcao[], nada: string) => [
  { valor: null as number | null, rotulo: nada },
  ...xs.map((o) => ({ valor: o.id as number | null, rotulo: o.rotulo })),
];
const nulo = (s: string) => (s.trim() ? s.trim() : null);

async function tentar<T>(fn: () => Promise<T>, ok?: string): Promise<T | null> {
  erro.value = null;
  aviso.value = null;
  try {
    const r = await fn();
    if (ok) aviso.value = ok;
    return r;
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
    return null;
  }
}

void tentar(async () => {
  const t = await lerTelaCobranca();
  operadoras.value = t.operadoras.map((o) => ({
    valor: o.id,
    rotulo: `${o.razaoSocial} (${o.registroAns})`,
  }));
  if (t.operadoras.length === 1) operadora.value = t.operadoras[0]!.id;
});
watch(operadora, async (op) => {
  tabelas.value = [];
  regras.value = [];
  pacotes.value = [];
  if (!op) return;
  opcoes.value = (await tentar(() => lerOpcoes(op))) ?? vazio;
  await recarregarCadastro();
});
async function recarregarCadastro() {
  const op = operadora.value;
  if (!op) return;
  tabelas.value = (await tentar(() => lerTabelas(op))) ?? [];
  regras.value = (await tentar(() => lerRegras(op))) ?? [];
  pacotes.value = (await tentar(() => lerPacotes(op))) ?? [];
  opcoes.value = (await tentar(() => lerOpcoes(op))) ?? opcoes.value;
}

// ------------------------------------------------------------------ tabelas e itens
const tabelas = ref<TabelaRemuneracao[]>([]);
const tabelaSel = ref<number | null>(null);
const itens = ref<ItemTabela[]>([]);
const nt = ref({
  codigo: '',
  nome: '',
  finalidade: 'pagamento_rede',
  tipoValor: 'valor_fixo',
  valorCh: '',
  valorUco: '',
  valorFilme: '',
  inicio: '',
  fim: '',
});
const tabelaAtual = computed(() => tabelas.value.find((t) => t.id === tabelaSel.value) ?? null);
watch(tabelaSel, async (t) => {
  itens.value = t ? ((await tentar(() => lerItens(t))) ?? []) : [];
});
const problemaTabela = computed(() => {
  if (!nt.value.codigo.trim() || !nt.value.nome.trim()) return t('faltaCodigoNome');
  if (nt.value.tipoValor === 'indice' && !(numeroBr(nt.value.valorCh) ?? 0)) return t('faltaCh');
  if (!nt.value.inicio) return t('faltaInicio');
  if (nt.value.fim && nt.value.fim < nt.value.inicio) return t('fimAntes');
  return null;
});
async function salvarTabela() {
  const op = operadora.value;
  if (!op || problemaTabela.value) return;
  const r = await tentar(
    () =>
      incluirTabela(op, {
        codigo: nt.value.codigo.trim(),
        nome: nt.value.nome.trim(),
        finalidade: nt.value.finalidade,
        tipoValor: nt.value.tipoValor,
        valorCh: numeroBr(nt.value.valorCh),
        valorUco: numeroBr(nt.value.valorUco),
        valorFilme: numeroBr(nt.value.valorFilme),
        prestador: null,
        inicio: nt.value.inicio,
        fim: nulo(nt.value.fim),
      }),
    t('tabelaIncluida'),
  );
  if (r) {
    await recarregarCadastro();
    tabelaSel.value = r.id;
  }
}
const busca = ref('');
const achados = ref<Opcao[]>([]);
watch(busca, async (b) => {
  achados.value = b.trim().length >= 2 ? ((await tentar(() => buscarProcedimentos(b))) ?? []) : [];
});
const ni = ref({
  procedimento: null as number | null,
  grupo: null as number | null,
  valor: '',
  ch: '',
  uco: '',
  filme: '',
  inicio: '',
});
const previa = computed(() => {
  const t = tabelaAtual.value;
  if (!t) return null;
  if (t.tipoValor === 'valor_fixo') return numeroBr(ni.value.valor);
  return (
    Math.round(
      ((numeroBr(ni.value.ch) ?? 0) * (t.valorCh ?? 0) +
        (numeroBr(ni.value.uco) ?? 0) * (t.valorUco ?? 0) +
        (numeroBr(ni.value.filme) ?? 0) * (t.valorFilme ?? 0)) *
        100,
    ) / 100
  );
});
async function salvarItem() {
  const tab = tabelaSel.value;
  if (!tab) return;
  const r = await tentar(
    () =>
      incluirItem(tab, {
        procedimento: ni.value.procedimento,
        grupo: ni.value.grupo,
        prestador: null,
        valor: numeroBr(ni.value.valor),
        quantidadeCh: numeroBr(ni.value.ch),
        quantidadeUco: numeroBr(ni.value.uco),
        quantidadeFilme: numeroBr(ni.value.filme),
        inicio: ni.value.inicio || tabelaAtual.value?.inicio || '',
        fim: null,
      }),
    t('itemIncluido'),
  );
  if (r) itens.value = (await tentar(() => lerItens(tab))) ?? [];
}

// ------------------------------------------------------------------ regras e simulação
const regras = ref<RegraValoracao[]>([]);
const nr = ref({
  codigo: '',
  descricao: '',
  prioridade: '100',
  prestador: null as number | null,
  tabela: null as number | null,
  fator: '1',
  acrescimo: '',
  horaInicio: '',
  horaFim: '',
  inicio: '',
});
async function salvarRegra() {
  const op = operadora.value;
  if (!op || nr.value.tabela === null) return;
  const r = await tentar(
    () =>
      incluirRegra(op, {
        codigo: nr.value.codigo.trim(),
        descricao: nr.value.descricao.trim(),
        prioridade: Number(nr.value.prioridade) || 100,
        prestador: nr.value.prestador,
        tipoPrestador: null,
        grupo: null,
        item: null,
        tabela: nr.value.tabela,
        fator: numeroBr(nr.value.fator) ?? 1,
        acrescimo: numeroBr(nr.value.acrescimo),
        diaSemana: null,
        horaInicio: nulo(nr.value.horaInicio),
        horaFim: nulo(nr.value.horaFim),
        inicio: nr.value.inicio,
        fim: null,
      }),
    t('regraIncluida'),
  );
  if (r) await recarregarCadastro();
}
const sim = ref({
  prestador: null as number | null,
  procedimento: null as number | null,
  data: '',
  hora: '',
  urgencia: false,
  quantidade: '1',
});
const resultado = ref<ResultadoValoracao | null>(null);
async function simular() {
  const op = operadora.value;
  if (!op || sim.value.prestador === null || sim.value.procedimento === null || !sim.value.data) return;
  resultado.value = await tentar(() =>
    valorarEvento(op, {
      prestador: sim.value.prestador!,
      procedimento: sim.value.procedimento!,
      data: sim.value.data,
      hora: nulo(sim.value.hora),
      urgencia: sim.value.urgencia,
      quantidade: numeroBr(sim.value.quantidade) ?? 1,
    }),
  );
}

// ------------------------------------------------------------------ pagamento pelo prestador
const prestador = ref<number | null>(null);
const visao = ref<VisaoPrestador | null>(null);
const marcadas = ref<number[]>([]);
const tributosLote = ref<{ tributo: number | null; aliquota: string; motivo: string }[]>([]);
// Validação na hora: tributo sem repetição; a alíquota digitada é exceção ao cadastro e precisa do motivo.
const problemaLote = computed(() => {
  const ts = tributosLote.value.filter((x) => x.tributo !== null);
  if (new Set(ts.map((x) => x.tributo)).size !== ts.length) return t('tributoRepetido');
  for (const x of ts) {
    if (!x.aliquota.trim()) continue;
    const a = numeroBr(x.aliquota);
    if (a === null || a < 0 || a > 100) return t('aliquotaInvalida');
    if (x.motivo.trim().length < 5) return t('faltaMotivoExcecao');
  }
  return null;
});
const nl = ref({ competencia: '', vencimento: '' });
const fech = ref({ natureza: null as number | null, documento: null as number | null });
const brutoMarcado = computed(
  () =>
    Math.round(
      (visao.value?.contas.filter((c) => marcadas.value.includes(c.id)).reduce((s, c) => s + c.liberado, 0) ??
        0) * 100,
    ) / 100,
);
watch(prestador, () => void abrirPrestador());
async function abrirPrestador() {
  const op = operadora.value;
  marcadas.value = [];
  visao.value = op && prestador.value ? await tentar(() => lerPrestador(op, prestador.value!)) : null;
}
async function gerarLote() {
  const op = operadora.value;
  if (!op || !prestador.value || !marcadas.value.length || problemaLote.value) return;
  const r = await tentar(
    () =>
      criarLote(op, {
        prestador: prestador.value,
        competencia: nl.value.competencia ? `${nl.value.competencia.slice(0, 7)}-01` : '',
        vencimento: nl.value.vencimento,
        contas: marcadas.value,
        tributos: tributosLote.value
          .filter((t) => t.tributo !== null)
          .map((t) => ({
            tributo: t.tributo,
            aliquota: numeroBr(t.aliquota),
            deducao: 0,
            motivo: nulo(t.motivo),
          })),
        mensagemPrestador: null,
      }),
    t('loteCalculado'),
  );
  if (r) await abrirPrestador();
}
async function fechar(id: number, versao: number) {
  if (fech.value.natureza === null || fech.value.documento === null) {
    erro.value = t('faltaNaturezaDoc');
    return;
  }
  const r = await tentar(
    () => fecharLote(id, { versao, natureza: fech.value.natureza!, documento: fech.value.documento! }),
    t('loteFechado'),
  );
  if (r) await abrirPrestador();
}
async function cancelar(id: number, versao: number) {
  if (await tentar(() => cancelarLote(id, versao), t('loteCancelado'))) await abrirPrestador();
}
const na = ref({ descricao: '', data: '', valor: '', parcelas: '1', inicio: '', vencimento: '' });
async function salvarAdiantamento() {
  if (!prestador.value || fech.value.natureza === null || fech.value.documento === null) {
    erro.value = t('faltaPrestadorNaturezaDoc');
    return;
  }
  const r = await tentar(
    () =>
      incluirAdiantamento(prestador.value!, {
        descricao: na.value.descricao.trim(),
        data: na.value.data,
        valor: numeroBr(na.value.valor) ?? 0,
        parcelas: Number(na.value.parcelas) || 1,
        inicioCompensacao: na.value.inicio ? `${na.value.inicio.slice(0, 7)}-01` : null,
        natureza: fech.value.natureza,
        documento: fech.value.documento,
        vencimento: na.value.vencimento || na.value.data,
      }),
    t('adiantamentoIncluido'),
  );
  if (r) await abrirPrestador();
}
const nrj = ref({
  contrato: null as number | null,
  tabela: null as number | null,
  forma: 'acordo',
  indice: null as number | null,
  percentual: '',
  dataBase: '',
  inicio: '',
  descricao: '',
});
async function salvarReajuste() {
  if (nrj.value.contrato === null) return;
  await tentar(
    () =>
      reajustarContrato(nrj.value.contrato!, {
        forma: nrj.value.forma,
        indice: nrj.value.indice,
        percentual: numeroBr(nrj.value.percentual) ?? 0,
        dataBase: nrj.value.dataBase,
        inicio: nrj.value.inicio || nrj.value.dataBase,
        descricao: nulo(nrj.value.descricao),
        tabela: nrj.value.tabela,
        grupo: null,
      }),
    t('reajusteAplicado'),
  );
}

// ------------------------------------------------------------------ calendário
// ------------------------------------------------------------------ pacotes
const TIPOS_PACOTE = ['clinico', 'cirurgico', 'obstetrico', 'diagnostico', 'terapeutico', 'outro'] as const;
const pacotes = ref<PacoteRemuneracao[]>([]);
const np = ref({
  codigo: '',
  descricao: '',
  prestador: null as number | null,
  tipo: 'cirurgico' as string,
  regime: null as string | null,
  diarias: '',
  valor: '',
  inicio: '',
  fim: '',
});
const buscaItem = ref('');
const achadosItem = ref<Opcao[]>([]);
watch(buscaItem, async (b) => {
  achadosItem.value = b.trim().length >= 2 ? ((await tentar(() => buscarItensFaturaveis(b))) ?? []) : [];
});
const itemEscolhido = ref<number | null>(null);
const principal = ref<{ id: number; rotulo: string } | null>(null);
const itensPacote = ref<
  { item: number; rotulo: string; inclusao: 'incluido' | 'excluido'; quantidade: string }[]
>([]);
const rotuloAchado = (id: number) => achadosItem.value.find((o) => o.id === id)?.rotulo ?? String(id);
function definirPrincipal() {
  if (itemEscolhido.value === null) return;
  principal.value = { id: itemEscolhido.value, rotulo: rotuloAchado(itemEscolhido.value) };
}
function adicionarAoPacote(inclusao: 'incluido' | 'excluido') {
  const id = itemEscolhido.value;
  if (id === null) return;
  itensPacote.value.push({ item: id, rotulo: rotuloAchado(id), inclusao, quantidade: '' });
}
const problemaPacote = computed(() => {
  const x = np.value;
  if (!x.codigo.trim() || !x.descricao.trim()) return t('faltaCodigoNome');
  if (!principal.value) return t('faltaPrincipal');
  if (!((numeroBr(x.valor) ?? 0) > 0)) return t('faltaValorGlobal');
  if (x.regime === 'ambulatorial' && (numeroBr(x.diarias) ?? 0) > 0) return t('diariasAmbulatorial');
  if (!x.inicio) return t('faltaInicio');
  if (x.fim && x.fim < x.inicio) return t('fimAntes');
  const ids = itensPacote.value.map((i) => i.item);
  if (new Set(ids).size !== ids.length) return t('itemRepetido');
  if (itensPacote.value.some((i) => i.item === principal.value!.id && i.inclusao === 'excluido'))
    return t('principalExcluido');
  if (itensPacote.value.some((i) => i.quantidade.trim() && !((numeroBr(i.quantidade) ?? 0) > 0)))
    return t('quantidadeInvalida');
  return null;
});
async function salvarPacote() {
  const op = operadora.value;
  if (!op || problemaPacote.value || !principal.value) return;
  const x = np.value;
  const r = await tentar(
    () =>
      incluirPacote(op, {
        codigo: x.codigo.trim(),
        descricao: x.descricao.trim(),
        prestador: x.prestador,
        principal: principal.value!.id,
        tipo: x.tipo,
        regime: x.regime,
        diarias: x.diarias.trim() ? Number(x.diarias) : null,
        valorGlobal: numeroBr(x.valor),
        inicio: x.inicio,
        fim: nulo(x.fim),
        inclusoes: null,
        itens: itensPacote.value.map((i) => ({
          item: i.item,
          inclusao: i.inclusao,
          quantidade: numeroBr(i.quantidade),
        })),
      }),
    t('pacoteIncluido'),
  );
  if (r) {
    principal.value = null;
    itensPacote.value = [];
    await recarregarCadastro();
  }
}

const ano = ref(String(new Date().getFullYear()));
const calendario = ref<CalendarioPagamento[]>([]);
const nc = ref({
  competencia: '',
  atendimentoInicio: '',
  atendimentoFim: '',
  entregaInicio: '',
  entregaFim: '',
  corte: '',
  pagamento: '',
});
async function abrirCalendario() {
  const op = operadora.value;
  if (op) calendario.value = (await tentar(() => lerCalendario(op, Number(ano.value)))) ?? [];
}
watch([aba, ano, operadora], () => {
  if (aba.value === 'calendario') void abrirCalendario();
});
async function salvarCalendario() {
  const op = operadora.value;
  if (!op) return;
  const r = await tentar(
    () =>
      incluirCalendario(op, {
        competencia: nc.value.competencia ? `${nc.value.competencia.slice(0, 7)}-01` : '',
        prestador: null,
        atendimentoInicio: nc.value.atendimentoInicio,
        atendimentoFim: nc.value.atendimentoFim,
        entregaInicio: nulo(nc.value.entregaInicio),
        entregaFim: nulo(nc.value.entregaFim),
        corte: nulo(nc.value.corte),
        pagamento: nc.value.pagamento,
      }),
    t('competenciaIncluida'),
  );
  if (r) await abrirCalendario();
}
async function fecharCompetencia(c: CalendarioPagamento) {
  if (await tentar(() => fecharCalendario(c.id, c.versao), t('competenciaFechada'))) await abrirCalendario();
}
</script>

<template>
  <section class="remun" data-testid="remuneracao-rede">
    <h1>{{ t('titulo') }}</h1>
    <SanteAlerta v-if="erro" variante="alerta" :texto="erro" data-testid="remun-erro" />
    <SanteAlerta v-if="aviso" variante="info" :texto="aviso" data-testid="remun-aviso" />
    <div class="remun__linha">
      <SanteSelecao
        id="remun-operadora"
        v-model="operadora"
        :rotulo="t('operadora')"
        :opcoes="operadoras"
        data-testid="remun-operadora"
      />
      <SanteSelecao
        id="remun-aba"
        v-model="aba"
        :rotulo="t('assunto')"
        :opcoes="[
          { valor: 'tabelas', rotulo: t('abaTabelas') },
          { valor: 'regras', rotulo: t('abaRegras') },
          { valor: 'pacotes', rotulo: t('abaPacotes') },
          { valor: 'pagamento', rotulo: t('abaPagamento') },
          { valor: 'calendario', rotulo: t('abaCalendario') },
        ]"
        data-testid="remun-aba"
      />
    </div>

    <template v-if="operadora && aba === 'tabelas'">
      <table class="remun__tabela" data-testid="remun-tabelas">
        <thead>
          <tr>
            <th>{{ t('codigo') }}</th>
            <th>{{ t('nome') }}</th>
            <th>{{ t('valor') }}</th>
            <th>{{ t('vigencia') }}</th>
            <th>{{ t('itens') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="tb in tabelas"
            :key="tb.id"
            :data-testid="`remun-tabela-${tb.codigo}`"
            @click="tabelaSel = tb.id"
          >
            <td>{{ tb.codigo }}</td>
            <td>{{ tb.nome }}</td>
            <td>
              {{
                tb.tipoValor === 'indice'
                  ? t('unidadesTabela', { ch: tb.valorCh ?? '—', uco: tb.valorUco ?? '—' })
                  : t('reais')
              }}
            </td>
            <td>{{ t('periodo', { de: dataBr(tb.inicio), ate: dataBr(tb.fim) }) }}</td>
            <td>{{ tb.itens }}</td>
          </tr>
        </tbody>
      </table>
      <fieldset v-if="podeEditar" class="remun__form" data-testid="remun-nova-tabela">
        <legend>{{ t('novaTabela') }}</legend>
        <SanteCampoTexto :max-bytes="150" id="remun-t-codigo" v-model="nt.codigo" :rotulo="t('codigo')" />
        <SanteCampoTexto :max-bytes="150" id="remun-t-nome" v-model="nt.nome" :rotulo="t('nome')" />
        <SanteSelecao
          id="remun-t-tipo"
          v-model="nt.tipoValor"
          :rotulo="t('valorItens')"
          :opcoes="[
            { valor: 'valor_fixo', rotulo: t('emReais') },
            { valor: 'indice', rotulo: t('emUnidades') },
          ]"
        />
        <template v-if="nt.tipoValor === 'indice'">
          <SanteCampoTexto :max-bytes="150" id="remun-t-ch" v-model="nt.valorCh" :rotulo="t('valorCh')" />
          <SanteCampoTexto :max-bytes="150" id="remun-t-uco" v-model="nt.valorUco" :rotulo="t('valorUco')" />
          <SanteCampoTexto
            :max-bytes="150"
            id="remun-t-filme"
            v-model="nt.valorFilme"
            :rotulo="t('valorFilme')"
          />
        </template>
        <SanteCampoTexto
          :max-bytes="10"
          id="remun-t-inicio"
          v-model="nt.inicio"
          :rotulo="t('inicioVigencia')"
        />
        <SanteCampoTexto :max-bytes="10" id="remun-t-fim" v-model="nt.fim" :rotulo="t('fimOpcional')" />
        <p v-if="problemaTabela" class="remun__dica" data-testid="remun-t-problema">{{ problemaTabela }}</p>
        <SanteBotao
          :desabilitado="!!problemaTabela"
          data-testid="remun-t-salvar"
          @click="salvarTabela"
          :rotulo="t('incluirTabela')"
        />
      </fieldset>
      <template v-if="tabelaAtual">
        <h2>{{ t('itensDe', { codigo: tabelaAtual.codigo }) }}</h2>
        <table class="remun__tabela" data-testid="remun-itens">
          <thead>
            <tr>
              <th>{{ t('procedimento') }}</th>
              <th>{{ t('unidades') }}</th>
              <th>{{ t('valor') }}</th>
              <th>{{ t('vigencia') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in itens" :key="i.id">
              <td>{{ i.procedimentoRotulo ?? i.grupoRotulo }}</td>
              <td>{{ i.quantidadeCh ?? '' }} {{ i.quantidadeUco ?? '' }}</td>
              <td>{{ moeda(i.valorCalculado) }}</td>
              <td>{{ t('periodo', { de: dataBr(i.inicio), ate: dataBr(i.fim) }) }}</td>
            </tr>
          </tbody>
        </table>
        <fieldset v-if="podeEditar" class="remun__form" data-testid="remun-novo-item">
          <legend>{{ t('novoItem') }}</legend>
          <SanteCampoTexto
            :max-bytes="150"
            id="remun-i-busca"
            v-model="busca"
            :rotulo="t('procurarCodigoNome')"
          />
          <SanteSelecao
            id="remun-i-proc"
            v-model="ni.procedimento"
            :rotulo="t('procedimento')"
            :opcoes="lista(achados, t('escolha'))"
          />
          <SanteSelecao
            id="remun-i-grupo"
            v-model="ni.grupo"
            :rotulo="t('ouGrupo')"
            :opcoes="lista(opcoes.grupos, t('nenhum'))"
          />
          <SanteCampoTexto
            :max-bytes="150"
            v-if="tabelaAtual.tipoValor === 'valor_fixo'"
            id="remun-i-valor"
            v-model="ni.valor"
            :rotulo="t('valorReais')"
          />
          <template v-else>
            <SanteCampoTexto :max-bytes="150" id="remun-i-ch" v-model="ni.ch" :rotulo="t('qtdCh')" />
            <SanteCampoTexto :max-bytes="150" id="remun-i-uco" v-model="ni.uco" :rotulo="t('qtdUco')" />
            <SanteCampoTexto :max-bytes="150" id="remun-i-filme" v-model="ni.filme" :rotulo="t('filmeM2')" />
          </template>
          <SanteCampoTexto
            :max-bytes="10"
            id="remun-i-inicio"
            v-model="ni.inicio"
            :rotulo="t('inicioItem')"
          />
          <p class="remun__dica" data-testid="remun-i-previa">
            {{ t('valorCalculado', { valor: moeda(previa) }) }}
          </p>
          <SanteBotao data-testid="remun-i-salvar" @click="salvarItem" :rotulo="t('incluirItem')" />
        </fieldset>
      </template>
    </template>

    <template v-if="operadora && aba === 'regras'">
      <table class="remun__tabela" data-testid="remun-regras">
        <thead>
          <tr>
            <th>{{ t('prioridade') }}</th>
            <th>{{ t('codigo') }}</th>
            <th>{{ t('descricao') }}</th>
            <th>{{ t('tabela') }}</th>
            <th>{{ t('fator') }}</th>
            <th>{{ t('acrescimo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in regras" :key="r.id">
            <td>{{ r.prioridade }}</td>
            <td>{{ r.codigo }}</td>
            <td>{{ r.descricao }}</td>
            <td>{{ r.tabelaCodigo }}</td>
            <td>{{ r.fator }}</td>
            <td>{{ r.acrescimo === null ? '—' : `${r.acrescimo}%` }}</td>
          </tr>
        </tbody>
      </table>
      <fieldset v-if="podeEditar" class="remun__form" data-testid="remun-nova-regra">
        <legend>{{ t('novaRegra') }}</legend>
        <SanteCampoTexto :max-bytes="150" id="remun-r-codigo" v-model="nr.codigo" :rotulo="t('codigo')" />
        <SanteCampoTexto
          :max-bytes="150"
          id="remun-r-descricao"
          v-model="nr.descricao"
          :rotulo="t('descricao')"
        />
        <SanteCampoTexto
          :max-bytes="150"
          id="remun-r-prioridade"
          v-model="nr.prioridade"
          :rotulo="t('prioridadeAjuda')"
        />
        <SanteSelecao
          id="remun-r-prestador"
          v-model="nr.prestador"
          :rotulo="t('prestador')"
          :opcoes="lista(opcoes.prestadores, t('todos'))"
        />
        <SanteSelecao
          id="remun-r-tabela"
          v-model="nr.tabela"
          :rotulo="t('tabela')"
          :opcoes="lista(opcoes.tabelas, t('escolha'))"
        />
        <SanteCampoTexto :max-bytes="150" id="remun-r-fator" v-model="nr.fator" :rotulo="t('fator')" />
        <SanteCampoTexto
          :max-bytes="150"
          id="remun-r-acrescimo"
          v-model="nr.acrescimo"
          :rotulo="t('acrescimoUrgencia')"
        />
        <SanteCampoTexto
          :max-bytes="10"
          id="remun-r-hi"
          v-model="nr.horaInicio"
          :rotulo="t('horaEspecialInicio')"
        />
        <SanteCampoTexto
          :max-bytes="10"
          id="remun-r-hf"
          v-model="nr.horaFim"
          :rotulo="t('horaEspecialFim')"
        />
        <SanteCampoTexto
          :max-bytes="10"
          id="remun-r-inicio"
          v-model="nr.inicio"
          :rotulo="t('inicioVigencia')"
        />
        <SanteBotao data-testid="remun-r-salvar" @click="salvarRegra" :rotulo="t('incluirRegra')" />
      </fieldset>
      <fieldset class="remun__form" data-testid="remun-simular">
        <legend>{{ t('simular') }}</legend>
        <SanteSelecao
          id="remun-s-prestador"
          v-model="sim.prestador"
          :rotulo="t('prestador')"
          :opcoes="lista(opcoes.prestadores, t('escolha'))"
        />
        <SanteCampoTexto :max-bytes="150" id="remun-s-busca" v-model="busca" :rotulo="t('procurar')" />
        <SanteSelecao
          id="remun-s-proc"
          v-model="sim.procedimento"
          :rotulo="t('procedimento')"
          :opcoes="lista(achados, t('escolha'))"
        />
        <SanteCampoTexto :max-bytes="10" id="remun-s-data" v-model="sim.data" :rotulo="t('data')" />
        <SanteCampoTexto :max-bytes="10" id="remun-s-hora" v-model="sim.hora" :rotulo="t('hora')" />
        <label
          ><input v-model="sim.urgencia" type="checkbox" data-testid="remun-s-urgencia" />
          {{ t('urgencia') }}</label
        >
        <SanteBotao data-testid="remun-s-calcular" @click="simular" :rotulo="t('calcular')" />
        <p v-if="resultado" data-testid="remun-s-resultado">
          {{
            t('formula', {
              tabela: resultado.tabelaCodigo,
              unitario: moeda(resultado.valorUnitarioTabela),
              fator: resultado.fator,
              acrescimo: resultado.acrescimoPercentual,
              quantidade: resultado.quantidade,
            })
          }}
          <strong>{{ moeda(resultado.valor) }}</strong>
        </p>
      </fieldset>
    </template>

    <template v-if="operadora && aba === 'pacotes'">
      <table class="remun__tabela" data-testid="remun-pacotes">
        <thead>
          <tr>
            <th>{{ t('codigo') }}</th>
            <th>{{ t('descricao') }}</th>
            <th>{{ t('principal') }}</th>
            <th>{{ t('tipoPacote') }}</th>
            <th>{{ t('prestador') }}</th>
            <th>{{ t('itens') }}</th>
            <th>{{ t('valorGlobal') }}</th>
            <th>{{ t('vigencia') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="k in pacotes" :key="k.id" :data-testid="`remun-pacote-${k.codigo}`">
            <td>{{ k.codigo }}</td>
            <td>{{ k.descricao }}</td>
            <td>{{ k.principal }}</td>
            <td>{{ t(`tipo_${k.tipo}`) }}</td>
            <td>{{ k.prestadorNome ?? t('todos') }}</td>
            <td>{{ k.itens }}</td>
            <td>{{ moeda(k.valorGlobal) }}</td>
            <td>{{ t('periodo', { de: dataBr(k.inicio), ate: dataBr(k.fim) }) }}</td>
          </tr>
        </tbody>
      </table>
      <fieldset v-if="podeEditar" class="remun__form" data-testid="remun-novo-pacote">
        <legend>{{ t('novoPacote') }}</legend>
        <SanteCampoTexto :max-bytes="30" id="remun-k-codigo" v-model="np.codigo" :rotulo="t('codigo')" />
        <SanteCampoTexto
          :max-bytes="150"
          id="remun-k-descricao"
          v-model="np.descricao"
          :rotulo="t('descricao')"
        />
        <SanteSelecao
          id="remun-k-prestador"
          v-model="np.prestador"
          :rotulo="t('prestador')"
          :opcoes="lista(opcoes.prestadores, t('todos'))"
        />
        <SanteSelecao
          id="remun-k-tipo"
          v-model="np.tipo"
          :rotulo="t('tipoPacote')"
          :opcoes="TIPOS_PACOTE.map((x) => ({ valor: x, rotulo: t(`tipo_${x}`) }))"
        />
        <SanteSelecao
          id="remun-k-regime"
          v-model="np.regime"
          :rotulo="t('regime')"
          :opcoes="[
            { valor: null, rotulo: t('nenhum') },
            ...['ambulatorial', 'internacao', 'hospital_dia'].map((x) => ({
              valor: x,
              rotulo: t(`regime_${x}`),
            })),
          ]"
        />
        <SanteCampoTexto :max-bytes="3" id="remun-k-diarias" v-model="np.diarias" :rotulo="t('diarias')" />
        <SanteCampoTexto :max-bytes="20" id="remun-k-valor" v-model="np.valor" :rotulo="t('valorGlobal')" />
        <SanteCampoTexto
          :max-bytes="10"
          id="remun-k-inicio"
          v-model="np.inicio"
          :rotulo="t('inicioVigencia')"
        />
        <SanteCampoTexto :max-bytes="10" id="remun-k-fim" v-model="np.fim" :rotulo="t('fimVigencia')" />
        <SanteCampoTexto :max-bytes="60" id="remun-k-busca" v-model="buscaItem" :rotulo="t('procurarItem')" />
        <SanteSelecao
          id="remun-k-item"
          v-model="itemEscolhido"
          :rotulo="t('itemFaturavel')"
          :opcoes="lista(achadosItem, t('escolha'))"
        />
        <div class="remun__linha">
          <SanteBotao
            :desabilitado="itemEscolhido === null"
            data-testid="remun-k-principal"
            @click="definirPrincipal"
            :rotulo="t('definirPrincipal')"
          />
          <SanteBotao
            :desabilitado="itemEscolhido === null"
            data-testid="remun-k-incluido"
            @click="adicionarAoPacote('incluido')"
            :rotulo="t('adicionarIncluido')"
          />
          <SanteBotao
            :desabilitado="itemEscolhido === null"
            data-testid="remun-k-excluido"
            @click="adicionarAoPacote('excluido')"
            :rotulo="t('adicionarExcluido')"
          />
        </div>
        <p class="remun__dica" data-testid="remun-k-principal-escolhido">
          {{ t('principal') }}: {{ principal?.rotulo ?? '—' }}
        </p>
        <div
          v-for="(i, k) in itensPacote"
          :key="k"
          class="remun__linha remun__dica"
          :data-testid="`remun-k-linha-${k}`"
        >
          <span>{{ i.rotulo }} ({{ t(i.inclusao) }})</span>
          <SanteCampoTexto
            :max-bytes="10"
            :id="`remun-k-qtd-${k}`"
            v-model="i.quantidade"
            :rotulo="t('quantidadePadrao')"
          />
          <SanteBotao @click="itensPacote.splice(k, 1)" :rotulo="t('remover')" />
        </div>
        <p v-if="problemaPacote" class="remun__dica" data-testid="remun-k-problema">{{ problemaPacote }}</p>
        <SanteBotao
          :desabilitado="!!problemaPacote"
          data-testid="remun-k-salvar"
          @click="salvarPacote"
          :rotulo="t('incluirPacote')"
        />
      </fieldset>
    </template>

    <template v-if="operadora && aba === 'pagamento'">
      <div class="remun__linha">
        <SanteSelecao
          id="remun-p-prestador"
          v-model="prestador"
          :rotulo="t('prestador')"
          :opcoes="lista(opcoes.prestadores, t('escolha'))"
          data-testid="remun-p-prestador"
        />
        <SanteSelecao
          id="remun-p-natureza"
          v-model="fech.natureza"
          :rotulo="t('natureza')"
          :opcoes="lista(opcoes.naturezas, t('escolha'))"
        />
        <SanteSelecao
          id="remun-p-documento"
          v-model="fech.documento"
          :rotulo="t('documento')"
          :opcoes="lista(opcoes.documentos, t('escolha'))"
        />
      </div>
      <template v-if="visao">
        <h2>{{ t('contasSemLote') }}</h2>
        <table class="remun__tabela" data-testid="remun-contas">
          <thead>
            <tr>
              <th></th>
              <th>{{ t('protocolo') }}</th>
              <th>{{ t('competencia') }}</th>
              <th>{{ t('apresentado') }}</th>
              <th>{{ t('glosado') }}</th>
              <th>{{ t('liberado') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in visao.contas" :key="c.id">
              <td>
                <input
                  v-model="marcadas"
                  type="checkbox"
                  :value="c.id"
                  :data-testid="`remun-conta-${c.protocolo}`"
                />
              </td>
              <td>{{ c.protocolo }}</td>
              <td>{{ dataBr(c.competencia) }}</td>
              <td>{{ moeda(c.apresentado) }}</td>
              <td>{{ moeda(c.glosado) }}</td>
              <td>{{ moeda(c.liberado) }}</td>
            </tr>
          </tbody>
        </table>
        <fieldset v-if="podePagar" class="remun__form" data-testid="remun-novo-lote">
          <legend>{{ t('loteBruto', { valor: moeda(brutoMarcado) }) }}</legend>
          <SanteCampoTexto
            :max-bytes="10"
            id="remun-l-comp"
            v-model="nl.competencia"
            :rotulo="t('competenciaMes')"
          />
          <SanteCampoTexto
            :max-bytes="10"
            id="remun-l-venc"
            v-model="nl.vencimento"
            :rotulo="t('vencimento')"
          />
          <div v-for="(tr, k) in tributosLote" :key="k" class="remun__linha">
            <SanteSelecao
              :id="`remun-l-trib-${k}`"
              v-model="tr.tributo"
              :rotulo="t('tributoRetido')"
              :opcoes="lista(opcoes.tributos, t('escolha'))"
            />
            <SanteCampoTexto
              :max-bytes="150"
              :id="`remun-l-aliq-${k}`"
              v-model="tr.aliquota"
              :rotulo="t('aliquotaExcecao')"
            />
            <SanteCampoTexto
              v-if="tr.aliquota.trim()"
              :max-bytes="300"
              :id="`remun-l-motivo-${k}`"
              v-model="tr.motivo"
              :rotulo="t('motivoExcecao')"
            />
          </div>
          <p class="remun__dica">{{ t('dicaTributoCadastro') }}</p>
          <p v-if="problemaLote" class="remun__dica" data-testid="remun-l-problema">{{ problemaLote }}</p>
          <SanteBotao
            data-testid="remun-l-tributo"
            @click="tributosLote.push({ tributo: null, aliquota: '', motivo: '' })"
            :rotulo="t('adicionarTributo')"
          />
          <SanteBotao
            :desabilitado="!marcadas.length || !!problemaLote"
            data-testid="remun-l-calcular"
            @click="gerarLote"
            :rotulo="t('calcularLote')"
          />
        </fieldset>
        <h2>{{ t('lotes') }}</h2>
        <table class="remun__tabela" data-testid="remun-lotes">
          <thead>
            <tr>
              <th>{{ t('numero') }}</th>
              <th>{{ t('competencia') }}</th>
              <th>{{ t('bruto') }}</th>
              <th>{{ t('tributos') }}</th>
              <th>{{ t('liquido') }}</th>
              <th>{{ t('situacao') }}</th>
              <th>{{ t('tituloPagar') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in visao.lotes" :key="l.id" :data-testid="`remun-lote-${l.numero}`">
              <td>{{ l.numero }}</td>
              <td>{{ dataBr(l.competencia) }}</td>
              <td>{{ moeda(l.bruto) }}</td>
              <td>{{ moeda(l.tributos) }}</td>
              <td>{{ moeda(l.liquido) }}</td>
              <td>{{ l.situacao }}</td>
              <td>{{ l.tituloNumero ?? '—' }}</td>
              <td>
                <template v-if="podePagar && l.situacao === 'calculado'">
                  <SanteBotao
                    data-testid="remun-lote-fechar"
                    @click="fechar(l.id, l.versao)"
                    :rotulo="t('fecharGerar')"
                  />
                  <SanteBotao
                    variante="secundario"
                    @click="cancelar(l.id, l.versao)"
                    :rotulo="t('cancelar')"
                  />
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <h2>{{ t('adiantamentos') }}</h2>
        <table class="remun__tabela" data-testid="remun-adiantamentos">
          <thead>
            <tr>
              <th>{{ t('numero') }}</th>
              <th>{{ t('dataCol') }}</th>
              <th>{{ t('valor') }}</th>
              <th>{{ t('compensado') }}</th>
              <th>{{ t('situacao') }}</th>
              <th>{{ t('tituloPagar') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in visao.adiantamentos" :key="a.id">
              <td>{{ a.numero }}</td>
              <td>{{ dataBr(a.data) }}</td>
              <td>{{ moeda(a.valor) }}</td>
              <td>{{ moeda(a.compensado) }}</td>
              <td>{{ a.situacao }}</td>
              <td>{{ a.titulo ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
        <fieldset v-if="podePagar" class="remun__form" data-testid="remun-novo-adiantamento">
          <legend>{{ t('novoAdiantamento') }}</legend>
          <SanteCampoTexto :max-bytes="150" id="remun-a-desc" v-model="na.descricao" :rotulo="t('motivo')" />
          <SanteCampoTexto :max-bytes="10" id="remun-a-data" v-model="na.data" :rotulo="t('data')" />
          <SanteCampoTexto :max-bytes="150" id="remun-a-valor" v-model="na.valor" :rotulo="t('valorReais')" />
          <SanteCampoTexto
            :max-bytes="150"
            id="remun-a-parcelas"
            v-model="na.parcelas"
            :rotulo="t('parcelas')"
          />
          <SanteCampoTexto
            :max-bytes="10"
            id="remun-a-inicio"
            v-model="na.inicio"
            :rotulo="t('compensarDesde')"
          />
          <SanteBotao
            data-testid="remun-a-salvar"
            @click="salvarAdiantamento"
            :rotulo="t('incluirAdiantamento')"
          />
        </fieldset>
      </template>
      <fieldset v-if="podeEditar" class="remun__form" data-testid="remun-reajuste">
        <legend>{{ t('reajuste') }}</legend>
        <SanteSelecao
          id="remun-rj-contrato"
          v-model="nrj.contrato"
          :rotulo="t('contrato')"
          :opcoes="lista(opcoes.contratos, t('escolha'))"
        />
        <SanteSelecao
          id="remun-rj-tabela"
          v-model="nrj.tabela"
          :rotulo="t('tabelaReajustada')"
          :opcoes="lista(opcoes.tabelas, t('nenhuma'))"
        />
        <SanteSelecao
          id="remun-rj-forma"
          v-model="nrj.forma"
          :rotulo="t('forma')"
          :opcoes="[
            { valor: 'acordo', rotulo: t('formaAcordo') },
            { valor: 'indice_contratual', rotulo: t('formaContratual') },
            { valor: 'indice_legal', rotulo: t('formaLegal') },
          ]"
        />
        <SanteSelecao
          v-if="nrj.forma !== 'acordo'"
          id="remun-rj-indice"
          v-model="nrj.indice"
          :rotulo="t('indice')"
          :opcoes="lista(opcoes.indices, t('escolha'))"
        />
        <SanteCampoTexto
          :max-bytes="150"
          id="remun-rj-perc"
          v-model="nrj.percentual"
          :rotulo="t('percentual')"
        />
        <SanteCampoTexto :max-bytes="10" id="remun-rj-base" v-model="nrj.dataBase" :rotulo="t('dataBase')" />
        <SanteCampoTexto :max-bytes="150" id="remun-rj-desc" v-model="nrj.descricao" :rotulo="t('termo')" />
        <SanteBotao data-testid="remun-rj-salvar" @click="salvarReajuste" :rotulo="t('aplicarReajuste')" />
      </fieldset>
    </template>

    <template v-if="operadora && aba === 'calendario'">
      <SanteCampoTexto :max-bytes="150" id="remun-c-ano" v-model="ano" :rotulo="t('ano')" />
      <table class="remun__tabela" data-testid="remun-calendario">
        <thead>
          <tr>
            <th>{{ t('competencia') }}</th>
            <th>{{ t('atendimento') }}</th>
            <th>{{ t('entrega') }}</th>
            <th>{{ t('corte') }}</th>
            <th>{{ t('pagamento') }}</th>
            <th>{{ t('dias') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in calendario" :key="c.id">
            <td>{{ dataBr(c.competencia).slice(3) }}</td>
            <td>{{ t('periodo', { de: dataBr(c.atendimentoInicio), ate: dataBr(c.atendimentoFim) }) }}</td>
            <td>{{ t('periodo', { de: dataBr(c.entregaInicio), ate: dataBr(c.entregaFim) }) }}</td>
            <td>{{ dataBr(c.corte) }}</td>
            <td>{{ dataBr(c.pagamento) }}</td>
            <td>{{ c.dias ?? '—' }}</td>
            <td>
              <span v-if="c.fechado">{{ t('fechada') }}</span>
              <SanteBotao
                v-else-if="podePagar"
                variante="secundario"
                @click="fecharCompetencia(c)"
                :rotulo="t('fechar')"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <fieldset v-if="podePagar" class="remun__form" data-testid="remun-nova-competencia">
        <legend>{{ t('novaCompetencia') }}</legend>
        <SanteCampoTexto
          :max-bytes="10"
          id="remun-c-comp"
          v-model="nc.competencia"
          :rotulo="t('competenciaMes')"
        />
        <SanteCampoTexto
          :max-bytes="10"
          id="remun-c-ai"
          v-model="nc.atendimentoInicio"
          :rotulo="t('atendimentoDe')"
        />
        <SanteCampoTexto
          :max-bytes="10"
          id="remun-c-af"
          v-model="nc.atendimentoFim"
          :rotulo="t('atendimentoAte')"
        />
        <SanteCampoTexto
          :max-bytes="10"
          id="remun-c-ei"
          v-model="nc.entregaInicio"
          :rotulo="t('entregaDe')"
        />
        <SanteCampoTexto :max-bytes="10" id="remun-c-ef" v-model="nc.entregaFim" :rotulo="t('entregaAte')" />
        <SanteCampoTexto :max-bytes="10" id="remun-c-corte" v-model="nc.corte" :rotulo="t('corteData')" />
        <SanteCampoTexto
          :max-bytes="10"
          id="remun-c-pag"
          v-model="nc.pagamento"
          :rotulo="t('pagamentoData')"
        />
        <SanteBotao
          data-testid="remun-c-salvar"
          @click="salvarCalendario"
          :rotulo="t('incluirCompetencia')"
        />
      </fieldset>
    </template>
  </section>
</template>

<style scoped>
.remun {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.remun__linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.remun__form {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.remun__tabela {
  width: 100%;
  border-collapse: collapse;
}
.remun__dica {
  grid-column: 1 / -1;
}
</style>
