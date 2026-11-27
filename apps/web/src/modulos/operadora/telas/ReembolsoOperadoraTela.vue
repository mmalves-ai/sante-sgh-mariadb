<script setup lang="ts">
// Reembolso ao beneficiário (08-SGO L106, C2-047; RN ANS 566/2022: pago em até 30 dias, no limite da tabela do plano).
// Uma tela só, por atalho da cobrança: a fila com o prazo legal e o atraso em destaque; a visão por beneficiário (os
// pedidos e o total reembolsado no ano); o pedido novo com os comprovantes, CPF/CNPJ e datas conferidos na hora; a análise
// com glosa por item (motivo padronizado) e a prévia do que será pago; o pagamento (crédito na conta do beneficiário) e o
// cancelamento com motivo; a tabela de referência por município e a regra do plano. O servidor confere tudo de novo.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import {
  type Anexo,
  type Apoio,
  analisar,
  anexar,
  buscar,
  cancelar,
  type Detalhe,
  documentoValido,
  incluirPedido,
  incluirRegra,
  incluirTabela,
  lerAnexo,
  lerApoio,
  lerDoBeneficiario,
  lerFila,
  lerPedido,
  lerRegras,
  lerTabelas,
  type Opcao,
  pagar,
  type Regra,
  type Resumo,
  SITUACOES,
  type Situacao,
  type Tabela,
} from '../api-reembolso.js';

const { t } = useI18n();
type Aba = 'fila' | 'novo' | 'tabelas';
const aba = ref<Aba>('fila');
const podeRegistrar = computed(() => pode('operadora.reembolso.registrar'));
const podeAnalisar = computed(() => pode('operadora.reembolso.analisar'));
const podePagar = computed(() => pode('operadora.reembolso.pagar'));
const erro = ref<string | null>(null);
const aviso = ref<string | null>(null);
const hoje = new Date().toISOString().slice(0, 10);
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '—');
const numeroBr = (v: string): number | null => {
  const t = v.trim().replace(/\./g, '').replace(',', '.');
  return t === '' || Number.isNaN(Number(t)) ? null : Number(t);
};
const ROTULO_SITUACAO = Object.fromEntries(
  SITUACOES.map((s) => [s, t(`operadoraReembolso.situacoes.${s}`)]),
) as Record<Situacao, string>;

async function tentar<T>(fn: () => Promise<T>, ok?: string): Promise<T | null> {
  // Só a gravação troca o aviso; a leitura que vem logo depois não o apaga (o erro apaga).
  erro.value = null;
  if (ok) aviso.value = null;
  try {
    const r = await fn();
    if (ok) aviso.value = ok;
    return r;
  } catch (e) {
    aviso.value = null;
    erro.value = e instanceof Error ? e.message : String(e);
    return null;
  }
}

// ── apoio ──
const apoio = ref<Apoio>({ operadoras: [], modalidades: [], motivos: [] });
const operadora = ref<number | null>(null);
const opcoesOperadora = computed(() => apoio.value.operadoras.map((o) => ({ valor: o.id, rotulo: o.nome })));
const opcoesModalidade = computed(() => [
  { valor: null, rotulo: t('operadoraReembolso.opcoes.qualquerModalidade') },
  ...apoio.value.modalidades.map((m) => ({ valor: m.id, rotulo: m.descricao })),
]);
const opcoesMotivo = computed(() => [
  { valor: null, rotulo: t('operadoraReembolso.opcoes.escolhaMotivo') },
  ...apoio.value.motivos.map((m) => ({ valor: m.id, rotulo: `${m.codigo} · ${m.descricao}` })),
]);
void tentar(async () => {
  apoio.value = await lerApoio();
  operadora.value = apoio.value.operadoras[0]?.id ?? null;
});

// ── busca com combo ──
function busca(alvo: 'beneficiarios' | 'procedimentos' | 'municipios') {
  const termo = ref('');
  const opcoes = ref<Opcao[]>([]);
  let vez = 0;
  watch(termo, async (t) => {
    const minha = ++vez;
    if (t.trim().length < 2) return void (opcoes.value = []);
    const r = await buscar(alvo, t).catch(() => []);
    if (minha === vez) opcoes.value = r;
  });
  return {
    termo,
    opcoes: computed(() => [
      { valor: null, rotulo: t('operadoraReembolso.opcoes.escolha') },
      ...opcoes.value.map((o) => ({ valor: o.id, rotulo: o.rotulo })),
    ]),
  };
}

// ── fila e visão por beneficiário ──
const filtro = ref<Situacao | null>(null);
const opcoesFiltro = [
  { valor: null, rotulo: t('operadoraReembolso.opcoes.todas') },
  ...SITUACOES.map((s) => ({ valor: s, rotulo: ROTULO_SITUACAO[s] })),
];
const fila = ref<Resumo[]>([]);
const atrasados = computed(() => fila.value.filter((p) => p.atrasado).length);
async function carregarFila() {
  const r = await tentar(() => lerFila(filtro.value));
  if (r) fila.value = r;
}
watch(filtro, carregarFila, { immediate: true });
const visao = ref<{ nome: string; pedidos: Resumo[]; reembolsadoNoAno: number } | null>(null);
async function abrirBeneficiario(p: Resumo) {
  const r = await tentar(() => lerDoBeneficiario(p.beneficiario.id));
  if (r) visao.value = { nome: `${p.beneficiario.matricula} · ${p.beneficiario.nome}`, ...r };
}

// ── pedido aberto: análise, pagamento, cancelamento, comprovante ──
const aberto = ref<Detalhe | null>(null);
const glosas = ref<Record<number, { motivo: number | null; valor: string; justificativa: string }>>({});
const copart = ref<Record<number, string>>({});
const pendencia = ref('');
const pagoEm = ref(hoje);
const motivoCancelamento = ref('');
async function abrir(id: number) {
  const r = await tentar(() => lerPedido(id));
  if (!r) return;
  aberto.value = r;
  glosas.value = Object.fromEntries(
    r.itens.map((i) => [i.id, { motivo: null, valor: '', justificativa: '' }]),
  );
  copart.value = Object.fromEntries(r.itens.map((i) => [i.id, '']));
}
const emAnalise = computed(() =>
  aberto.value ? ['solicitado', 'em_analise', 'pendente_documento'].includes(aberto.value.situacao) : false,
);
/** Prévia na hora do que cada item paga (limite − glosa − coparticipação), sem os tetos do plano (o servidor aplica). */
const previa = computed(() =>
  (aberto.value?.itens ?? []).map((i) => {
    const g = glosas.value[i.id];
    const glosa = numeroBr(g?.valor ?? '') ?? 0;
    const c = numeroBr(copart.value[i.id] ?? '') ?? 0;
    const limite = i.valorLimite ?? i.valorApresentado;
    const problema =
      glosa > 0 && !g?.motivo
        ? t('operadoraReembolso.falta.motivoGlosa')
        : glosa + c > limite
          ? t('operadoraReembolso.falta.glosaPassa')
          : null;
    return { id: i.id, limite, paga: Math.max(0, limite - glosa - c), problema };
  }),
);
const previaOk = computed(() => previa.value.every((p) => p.problema === null));
async function concluir() {
  const a = aberto.value;
  if (!a) return;
  const r = await tentar(
    () =>
      analisar(a.id, {
        versao: a.versao,
        decisao: 'concluir',
        observacao: null,
        itens: a.itens.map((i) => {
          const g = glosas.value[i.id]!;
          const v = numeroBr(g.valor) ?? 0;
          return {
            item: i.id,
            coparticipacao: numeroBr(copart.value[i.id] ?? '') ?? 0,
            glosas:
              v > 0 ? [{ motivo: g.motivo, valor: v, justificativa: g.justificativa.trim() || null }] : [],
          };
        }),
      }),
    t('operadoraReembolso.ok.analise'),
  );
  if (r) await Promise.all([abrir(a.id), carregarFila()]);
}
async function pedirDocumento() {
  const a = aberto.value;
  if (!a || !pendencia.value.trim()) return;
  const r = await tentar(
    () =>
      analisar(a.id, {
        versao: a.versao,
        decisao: 'pendente_documento',
        observacao: pendencia.value,
        itens: [],
      }),
    t('operadoraReembolso.ok.pendente'),
  );
  if (r) await Promise.all([abrir(a.id), carregarFila()]);
}
async function anexarNoAberto(ev: Event) {
  const a = aberto.value;
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!a || !f) return;
  const r = await tentar(
    async () => anexar(a.id, a.versao, await lerAnexo(f)),
    t('operadoraReembolso.ok.anexo'),
  );
  if (r) await Promise.all([abrir(a.id), carregarFila()]);
}
async function pagarAberto() {
  const a = aberto.value;
  if (!a || !DATA.test(pagoEm.value) || pagoEm.value > hoje) return;
  const r = await tentar(() => pagar(a.id, a.versao, pagoEm.value), t('operadoraReembolso.ok.pago'));
  if (r) await Promise.all([abrir(a.id), carregarFila()]);
}
async function cancelarAberto() {
  const a = aberto.value;
  if (!a || motivoCancelamento.value.trim().length < 5) return;
  const r = await tentar(
    () => cancelar(a.id, a.versao, motivoCancelamento.value),
    t('operadoraReembolso.ok.cancelado'),
  );
  if (r) await Promise.all([abrir(a.id), carregarFila()]);
}

// ── pedido novo ──
const bBenef = busca('beneficiarios');
const bProc = busca('procedimentos');
const bMun = busca('municipios');
const novo = ref({
  beneficiario: null as number | null,
  canal: 'presencial' as 'portal' | 'presencial' | 'central' | 'correspondencia',
  modalidade: null as number | null,
  municipio: null as number | null,
  prestadorNome: '',
  prestadorDocumento: '',
  dataAtendimento: hoje,
  dataAlta: '',
  numeroDocumentoFiscal: '',
});
const opcoesCanal = [
  { valor: 'presencial', rotulo: t('operadoraReembolso.canais.presencial') },
  { valor: 'central', rotulo: t('operadoraReembolso.canais.central') },
  { valor: 'portal', rotulo: t('operadoraReembolso.canais.portal') },
  { valor: 'correspondencia', rotulo: t('operadoraReembolso.canais.correspondencia') },
];
const itensNovos = ref<{ procedimento: number; rotulo: string; quantidade: string; valor: string }[]>([]);
const itemNovo = ref({ procedimento: null as number | null, quantidade: '1', valor: '' });
const anexosNovos = ref<Anexo[]>([]);
function incluirItem() {
  const p = itemNovo.value.procedimento;
  if (!p || !(numeroBr(itemNovo.value.valor) ?? 0)) return;
  const rotulo = bProc.opcoes.value.find((o) => o.valor === p)?.rotulo ?? String(p);
  itensNovos.value.push({
    procedimento: p,
    rotulo,
    quantidade: itemNovo.value.quantidade,
    valor: itemNovo.value.valor,
  });
  itemNovo.value = { procedimento: null, quantidade: '1', valor: '' };
}
async function escolherAnexos(ev: Event) {
  const fs = [...((ev.target as HTMLInputElement).files ?? [])];
  anexosNovos.value = await Promise.all(fs.map(lerAnexo));
}
/** Validação na hora, a mesma do domínio. */
const faltasNovo = computed(() => {
  const n = novo.value;
  const f: string[] = [];
  if (!n.beneficiario) f.push(t('operadoraReembolso.falta.beneficiario'));
  if (!n.prestadorNome.trim()) f.push(t('operadoraReembolso.falta.prestador'));
  if (!documentoValido(n.prestadorDocumento)) f.push(t('operadoraReembolso.falta.documento'));
  if (!DATA.test(n.dataAtendimento) || n.dataAtendimento > hoje)
    f.push(t('operadoraReembolso.falta.dataFutura'));
  if (n.dataAlta && n.dataAlta < n.dataAtendimento) f.push(t('operadoraReembolso.falta.alta'));
  if (itensNovos.value.length === 0) f.push(t('operadoraReembolso.falta.item'));
  if (anexosNovos.value.length === 0) f.push(t('operadoraReembolso.falta.anexo'));
  if (anexosNovos.value.some((a) => !['application/pdf', 'image/png', 'image/jpeg'].includes(a.tipoMime)))
    f.push(t('operadoraReembolso.falta.tipoAnexo'));
  return f;
});
const totalNovo = computed(() => itensNovos.value.reduce((a, i) => a + (numeroBr(i.valor) ?? 0), 0));
async function registrar() {
  if (faltasNovo.value.length) return;
  const n = novo.value;
  const r = await tentar(
    () =>
      incluirPedido({
        ...n,
        dataAlta: n.dataAlta || null,
        numeroDocumentoFiscal: n.numeroDocumentoFiscal.trim() || null,
        observacao: null,
        itens: itensNovos.value.map((i) => ({
          procedimento: i.procedimento,
          quantidade: numeroBr(i.quantidade) ?? 1,
          valorApresentado: numeroBr(i.valor) ?? 0,
          dataRealizacao: null,
        })),
        anexos: anexosNovos.value,
      }),
    t('operadoraReembolso.ok.registrado'),
  );
  if (!r) return;
  const p = r as { id: number; numero?: string; prazoPagamento?: string };
  aviso.value = t('operadoraReembolso.ok.registradoPrazo', {
    numero: p.numero ?? p.id,
    prazo: dataBr(p.prazoPagamento ?? null),
  });
  itensNovos.value = [];
  anexosNovos.value = [];
  aba.value = 'fila';
  await carregarFila();
  await abrir(p.id);
}

// ── tabelas e regras ──
const tabelas = ref<Tabela[]>([]);
const regras = ref<Regra[]>([]);
async function carregarTabelas() {
  const op = operadora.value;
  if (!op) return;
  const r = await tentar(async () => [await lerTabelas(op), await lerRegras(op)] as const);
  if (r) [tabelas.value, regras.value] = [r[0], r[1]];
}
watch([aba, operadora], () => {
  if (aba.value === 'tabelas') void carregarTabelas();
});
const tab = ref({
  codigo: '',
  nome: '',
  municipio: null as number | null,
  padrao: false,
  inicio: hoje,
  procedimento: null as number | null,
  valor: '',
  qtdMax: '',
});
const itensTab = ref<
  { procedimento: number; rotulo: string; valor: number; quantidadeMaxima: number | null }[]
>([]);
function incluirItemTab() {
  const p = tab.value.procedimento;
  const v = numeroBr(tab.value.valor);
  if (!p || v === null || itensTab.value.some((i) => i.procedimento === p)) return;
  itensTab.value.push({
    procedimento: p,
    rotulo: bProc.opcoes.value.find((o) => o.valor === p)?.rotulo ?? String(p),
    valor: v,
    quantidadeMaxima: numeroBr(tab.value.qtdMax),
  });
  tab.value = { ...tab.value, procedimento: null, valor: '', qtdMax: '' };
}
async function gravarTabela() {
  const op = operadora.value;
  if (!op || !tab.value.codigo.trim() || !tab.value.nome.trim() || itensTab.value.length === 0) return;
  const r = await tentar(
    () =>
      incluirTabela(op, {
        codigo: tab.value.codigo,
        nome: tab.value.nome,
        produto: null,
        municipio: tab.value.municipio,
        modalidade: null,
        fator: null,
        padrao: tab.value.padrao,
        vigenciaInicio: tab.value.inicio,
        vigenciaFim: null,
        itens: itensTab.value.map(({ procedimento, valor, quantidadeMaxima }) => ({
          procedimento,
          valor,
          quantidadeMaxima,
        })),
      }),
    t('operadoraReembolso.ok.tabela'),
  );
  if (r) {
    itensTab.value = [];
    await carregarTabelas();
  }
}
const reg = ref({
  plano: '',
  tabela: null as number | null,
  multiplicador: '1',
  percentual: '',
  limiteEvento: '',
  limiteAnual: '',
  prazo: '30',
  inicio: hoje,
});
const opcoesTabela = computed(() => [
  { valor: null, rotulo: t('operadoraReembolso.opcoes.pelaCidade') },
  ...tabelas.value.map((t) => ({ valor: t.id, rotulo: `${t.codigo} · ${t.nome}` })),
]);
const faltaRegra = computed(() => {
  const p = numeroBr(reg.value.prazo) ?? 0;
  if (!(numeroBr(reg.value.multiplicador) ?? 0)) return t('operadoraReembolso.falta.multiplicador');
  if (p < 1 || p > 30) return t('operadoraReembolso.falta.prazo');
  if (!/^\d+$/.test(reg.value.plano.trim())) return t('operadoraReembolso.falta.plano');
  return null;
});
async function gravarRegra() {
  const op = operadora.value;
  if (!op || faltaRegra.value) return;
  const r = await tentar(
    () =>
      incluirRegra(op, {
        plano: Number(reg.value.plano),
        modalidade: null,
        tabela: reg.value.tabela,
        multiplicador: numeroBr(reg.value.multiplicador),
        percentual: numeroBr(reg.value.percentual),
        livreEscolha: true,
        limitePorEvento: numeroBr(reg.value.limiteEvento),
        limiteAnual: numeroBr(reg.value.limiteAnual),
        prazoPagamentoDias: numeroBr(reg.value.prazo),
        vigenciaInicio: reg.value.inicio,
        vigenciaFim: null,
      }),
    t('operadoraReembolso.ok.regra'),
  );
  if (r) await carregarTabelas();
}
</script>

<template>
  <section class="tela-operadora" aria-labelledby="reembolso-titulo" data-testid="tela-reembolso">
    <h1 id="reembolso-titulo">{{ t('operadoraReembolso.titulo') }}</h1>
    <p>{{ t('operadoraReembolso.ajuda') }}</p>
    <SanteAlerta v-if="erro" :texto="erro" variante="alerta" data-testid="reembolso-erro" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" data-testid="reembolso-aviso" />
    <div class="abas" role="group" :aria-label="t('operadoraReembolso.secoes')">
      <SanteBotao
        :rotulo="t('operadoraReembolso.abas.fila')"
        :variante="aba === 'fila' ? 'primario' : 'secundario'"
        data-testid="aba-fila"
        @click="aba = 'fila'"
      />
      <SanteBotao
        v-if="podeRegistrar"
        :rotulo="t('operadoraReembolso.abas.novo')"
        :variante="aba === 'novo' ? 'primario' : 'secundario'"
        data-testid="aba-novo"
        @click="aba = 'novo'"
      />
      <SanteBotao
        :rotulo="t('operadoraReembolso.abas.tabelas')"
        :variante="aba === 'tabelas' ? 'primario' : 'secundario'"
        data-testid="aba-tabelas"
        @click="aba = 'tabelas'"
      />
    </div>

    <template v-if="aba === 'fila'">
      <SanteSelecao
        id="reembolso-filtro"
        v-model="filtro"
        :rotulo="t('operadoraReembolso.fila.situacao')"
        :opcoes="opcoesFiltro"
        data-testid="reembolso-filtro"
      />
      <p role="status" data-testid="reembolso-atrasados">
        {{ t('operadoraReembolso.fila.contagem', { total: fila.length, atrasados }) }}
      </p>
      <table class="tabela-operadora" data-testid="reembolso-fila">
        <thead>
          <tr>
            <th>{{ t('operadoraReembolso.fila.numero') }}</th>
            <th>{{ t('operadoraReembolso.fila.beneficiario') }}</th>
            <th>{{ t('operadoraReembolso.fila.prestador') }}</th>
            <th>{{ t('operadoraReembolso.fila.apresentado') }}</th>
            <th>{{ t('operadoraReembolso.fila.reembolsado') }}</th>
            <th>{{ t('operadoraReembolso.fila.prazo') }}</th>
            <th>{{ t('operadoraReembolso.fila.situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in fila" :key="p.id" :data-testid="`reembolso-linha-${p.id}`">
            <td>
              <button
                type="button"
                class="link"
                :data-testid="`reembolso-abrir-${p.id}`"
                @click="abrir(p.id)"
              >
                {{ p.numero }}
              </button>
            </td>
            <td>
              <button
                type="button"
                class="link"
                :data-testid="`reembolso-benef-${p.id}`"
                @click="abrirBeneficiario(p)"
              >
                {{ p.beneficiario.nome }}
              </button>
            </td>
            <td>{{ p.prestadorNome }}</td>
            <td>{{ moeda(p.valorApresentado) }}</td>
            <td>{{ moeda(p.valorReembolsado) }}</td>
            <td>
              {{ dataBr(p.prazoPagamento) }}
              <strong v-if="p.atrasado" :data-testid="`reembolso-atraso-${p.id}`">
                {{ t('operadoraReembolso.fila.atrasado', { dias: -(p.diasParaOPrazo ?? 0) }) }}</strong
              >
              <span v-else-if="p.diasParaOPrazo !== null">
                {{ t('operadoraReembolso.fila.faltam', { dias: p.diasParaOPrazo }) }}</span
              >
            </td>
            <td>{{ ROTULO_SITUACAO[p.situacao] }}</td>
          </tr>
        </tbody>
      </table>

      <section v-if="visao" :aria-label="t('operadoraReembolso.visao.rotulo')" data-testid="reembolso-visao">
        <h2>{{ visao.nome }}</h2>
        <p data-testid="reembolso-total-ano">
          {{
            t('operadoraReembolso.visao.totalAno', {
              valor: moeda(visao.reembolsadoNoAno),
              pedidos: visao.pedidos.length,
            })
          }}
        </p>
        <ul>
          <li v-for="p in visao.pedidos" :key="p.id">
            {{ p.numero }} · {{ dataBr(p.dataAtendimento) }} · {{ moeda(p.valorReembolsado) }} ·
            {{ ROTULO_SITUACAO[p.situacao] }}
          </li>
        </ul>
      </section>

      <section
        v-if="aberto"
        :aria-label="t('operadoraReembolso.pedido.rotulo')"
        data-testid="reembolso-pedido"
      >
        <h2>
          {{
            t('operadoraReembolso.pedido.titulo', {
              numero: aberto.numero,
              situacao: ROTULO_SITUACAO[aberto.situacao],
            })
          }}
        </h2>
        <p>
          {{
            t('operadoraReembolso.pedido.resumo', {
              matricula: aberto.beneficiario.matricula,
              nome: aberto.beneficiario.nome,
              prestador: aberto.prestadorNome,
              documento: aberto.prestadorDocumento,
              data: dataBr(aberto.dataAtendimento),
              tabela: aberto.tabelaReferencia?.nome ?? t('operadoraReembolso.pedido.percentualPlano'),
            })
          }}
        </p>
        <p v-if="aberto.observacao" data-testid="reembolso-observacao">
          {{ t('operadoraReembolso.pedido.observacao', { texto: aberto.observacao }) }}
        </p>
        <p>
          {{ t('operadoraReembolso.pedido.comprovantes') }}
          <span v-for="a in aberto.anexos" :key="a.id" data-testid="reembolso-anexo">{{ a.nome }} · </span>
          <label v-if="emAnalise && podeRegistrar">
            {{ t('operadoraReembolso.pedido.anexarOutro') }}
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              data-testid="reembolso-anexar"
              @change="anexarNoAberto"
            />
          </label>
        </p>
        <table class="tabela-operadora" data-testid="reembolso-itens">
          <thead>
            <tr>
              <th>{{ t('operadoraReembolso.pedido.procedimento') }}</th>
              <th>{{ t('operadoraReembolso.pedido.quantidade') }}</th>
              <th>{{ t('operadoraReembolso.fila.apresentado') }}</th>
              <th>{{ t('operadoraReembolso.pedido.reembolsavel') }}</th>
              <th>{{ t('operadoraReembolso.pedido.glosa') }}</th>
              <th>{{ t('operadoraReembolso.pedido.pago') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(i, k) in aberto.itens" :key="i.id">
              <td>{{ i.procedimento.codigo }} · {{ i.procedimento.descricao }}</td>
              <td>{{ i.quantidade }}</td>
              <td>{{ moeda(i.valorApresentado) }}</td>
              <td>{{ moeda(i.valorLimite ?? i.valorApresentado) }}</td>
              <td v-if="emAnalise && podeAnalisar">
                <SanteSelecao
                  :id="`glosa-motivo-${i.id}`"
                  v-model="glosas[i.id]!.motivo"
                  :rotulo="t('operadoraReembolso.pedido.motivo')"
                  :opcoes="opcoesMotivo"
                  :data-testid="`glosa-motivo-${k}`"
                />
                <SanteCampoTexto
                  :id="`glosa-valor-${i.id}`"
                  v-model="glosas[i.id]!.valor"
                  :max-bytes="20"
                  :rotulo="t('operadoraReembolso.pedido.valorGlosado')"
                  :data-testid="`glosa-valor-${k}`"
                />
                <SanteCampoTexto
                  :id="`glosa-just-${i.id}`"
                  v-model="glosas[i.id]!.justificativa"
                  :max-bytes="1000"
                  :rotulo="t('operadoraReembolso.pedido.justificativa')"
                />
                <SanteCampoTexto
                  :id="`copart-${i.id}`"
                  v-model="copart[i.id]!"
                  :max-bytes="20"
                  :rotulo="t('operadoraReembolso.pedido.coparticipacao')"
                />
                <small v-if="previa[k]?.problema" role="alert">{{ previa[k]?.problema }}</small>
              </td>
              <td v-else>
                {{ moeda(i.valorGlosado) }}
                <span v-for="(g, x) in i.glosas" :key="x"> · {{ g.motivo }}</span>
              </td>
              <td :data-testid="`reembolso-paga-${k}`">
                {{ moeda(emAnalise ? (previa[k]?.paga ?? 0) : i.valorReembolsado) }}
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="emAnalise && podeAnalisar" class="acoes">
          <SanteBotao
            :rotulo="t('operadoraReembolso.pedido.concluir')"
            :desabilitado="!previaOk"
            data-testid="reembolso-concluir"
            @click="concluir"
          />
          <SanteCampoTexto
            id="reembolso-pendencia"
            v-model="pendencia"
            :max-bytes="2000"
            :rotulo="t('operadoraReembolso.pedido.documentoFalta')"
            data-testid="reembolso-pendencia"
          />
          <SanteBotao
            :rotulo="t('operadoraReembolso.pedido.pedirDocumento')"
            variante="secundario"
            :desabilitado="!pendencia.trim()"
            data-testid="reembolso-pedir-documento"
            @click="pedirDocumento"
          />
        </div>
        <div v-if="podePagar && ['aprovado', 'aprovado_parcial'].includes(aberto.situacao)" class="acoes">
          <SanteCampoTexto
            id="reembolso-pago-em"
            v-model="pagoEm"
            :max-bytes="10"
            :rotulo="t('operadoraReembolso.pedido.pagoEmCampo')"
            data-testid="reembolso-pago-em"
          />
          <SanteBotao
            :rotulo="t('operadoraReembolso.pedido.pagar', { valor: moeda(aberto.valorReembolsado) })"
            data-testid="reembolso-pagar"
            @click="pagarAberto"
          />
        </div>
        <div v-if="podePagar && !['pago', 'negado', 'cancelado'].includes(aberto.situacao)" class="acoes">
          <SanteCampoTexto
            id="reembolso-motivo-canc"
            v-model="motivoCancelamento"
            :max-bytes="500"
            :rotulo="t('operadoraReembolso.pedido.motivoCancelamento')"
          />
          <SanteBotao
            :rotulo="t('operadoraReembolso.pedido.cancelar')"
            variante="secundario"
            :desabilitado="motivoCancelamento.trim().length < 5"
            data-testid="reembolso-cancelar"
            @click="cancelarAberto"
          />
        </div>
        <p v-if="aberto.pagoEm" data-testid="reembolso-pago">
          {{ t('operadoraReembolso.pedido.pagoEm', { data: dataBr(aberto.pagoEm) }) }}
        </p>
      </section>
    </template>

    <template v-else-if="aba === 'novo'">
      <form class="formulario" data-testid="reembolso-novo" @submit.prevent="registrar">
        <SanteCampoTexto
          id="novo-benef-busca"
          v-model="bBenef.termo.value"
          :max-bytes="60"
          :rotulo="t('operadoraReembolso.novo.buscaBenef')"
          data-testid="novo-benef-busca"
        />
        <SanteSelecao
          id="novo-benef"
          v-model="novo.beneficiario"
          :rotulo="t('operadoraReembolso.novo.beneficiario')"
          :opcoes="bBenef.opcoes.value"
          data-testid="novo-benef"
        />
        <SanteSelecao
          id="novo-canal"
          v-model="novo.canal"
          :rotulo="t('operadoraReembolso.novo.canal')"
          :opcoes="opcoesCanal"
          data-testid="novo-canal"
        />
        <SanteSelecao
          id="novo-modalidade"
          v-model="novo.modalidade"
          :rotulo="t('operadoraReembolso.novo.modalidade')"
          :opcoes="opcoesModalidade"
        />
        <SanteCampoTexto
          id="novo-mun-busca"
          v-model="bMun.termo.value"
          :max-bytes="60"
          :rotulo="t('operadoraReembolso.novo.buscaMun')"
          data-testid="novo-mun-busca"
        />
        <SanteSelecao
          id="novo-mun"
          v-model="novo.municipio"
          :rotulo="t('operadoraReembolso.novo.municipio')"
          :opcoes="bMun.opcoes.value"
          data-testid="novo-mun"
        />
        <SanteCampoTexto
          id="novo-prestador"
          v-model="novo.prestadorNome"
          :max-bytes="150"
          :rotulo="t('operadoraReembolso.novo.prestador')"
          data-testid="novo-prestador"
        />
        <SanteCampoTexto
          id="novo-doc"
          v-model="novo.prestadorDocumento"
          :max-bytes="18"
          :rotulo="t('operadoraReembolso.novo.documento')"
          data-testid="novo-doc"
        />
        <SanteCampoTexto
          id="novo-data"
          v-model="novo.dataAtendimento"
          :max-bytes="10"
          :rotulo="t('operadoraReembolso.novo.data')"
          data-testid="novo-data"
        />
        <SanteCampoTexto
          id="novo-alta"
          v-model="novo.dataAlta"
          :max-bytes="10"
          :rotulo="t('operadoraReembolso.novo.alta')"
        />
        <SanteCampoTexto
          id="novo-nf"
          v-model="novo.numeroDocumentoFiscal"
          :max-bytes="100"
          :rotulo="t('operadoraReembolso.novo.nota')"
          data-testid="novo-nf"
        />
        <fieldset>
          <legend>{{ t('operadoraReembolso.novo.procedimentos') }}</legend>
          <SanteCampoTexto
            id="novo-proc-busca"
            v-model="bProc.termo.value"
            :max-bytes="60"
            :rotulo="t('operadoraReembolso.novo.buscaProc')"
            data-testid="novo-proc-busca"
          />
          <SanteSelecao
            id="novo-proc"
            v-model="itemNovo.procedimento"
            :rotulo="t('operadoraReembolso.novo.procedimento')"
            :opcoes="bProc.opcoes.value"
            data-testid="novo-proc"
          />
          <SanteCampoTexto
            id="novo-qtd"
            v-model="itemNovo.quantidade"
            :max-bytes="6"
            :rotulo="t('operadoraReembolso.novo.quantidade')"
            data-testid="novo-qtd"
          />
          <SanteCampoTexto
            id="novo-valor"
            v-model="itemNovo.valor"
            :max-bytes="20"
            :rotulo="t('operadoraReembolso.novo.valor')"
            data-testid="novo-valor"
          />
          <SanteBotao
            :rotulo="t('operadoraReembolso.novo.incluir')"
            variante="secundario"
            data-testid="novo-incluir-item"
            @click="incluirItem"
          />
          <ul data-testid="novo-itens">
            <li v-for="(i, k) in itensNovos" :key="k">
              {{
                t('operadoraReembolso.novo.item', {
                  rotulo: i.rotulo,
                  quantidade: i.quantidade,
                  valor: moeda(numeroBr(i.valor) ?? 0),
                })
              }}
            </li>
          </ul>
          <p>{{ t('operadoraReembolso.novo.total', { valor: moeda(totalNovo) }) }}</p>
        </fieldset>
        <label>
          {{ t('operadoraReembolso.novo.comprovantes') }}
          <input
            type="file"
            multiple
            accept="application/pdf,image/png,image/jpeg"
            data-testid="novo-anexos"
            @change="escolherAnexos"
          />
        </label>
        <ul v-if="faltasNovo.length" role="alert" data-testid="novo-faltas">
          <li v-for="f in faltasNovo" :key="f">{{ f }}</li>
        </ul>
        <SanteBotao
          :rotulo="t('operadoraReembolso.novo.registrar')"
          tipo="submit"
          :desabilitado="faltasNovo.length > 0"
          data-testid="novo-registrar"
        />
      </form>
    </template>

    <template v-else>
      <SanteSelecao
        id="reembolso-operadora"
        v-model="operadora"
        :rotulo="t('operadoraReembolso.tabelas.operadora')"
        :opcoes="opcoesOperadora"
        data-testid="reembolso-operadora"
      />
      <h2>{{ t('operadoraReembolso.tabelas.titulo') }}</h2>
      <ul data-testid="reembolso-tabelas">
        <li v-for="tb in tabelas" :key="tb.id">
          {{
            t('operadoraReembolso.tabelas.linha', {
              codigo: tb.codigo,
              nome: tb.nome,
              municipio:
                tb.municipio?.nome ??
                (tb.padrao
                  ? t('operadoraReembolso.tabelas.padrao')
                  : t('operadoraReembolso.tabelas.todosMunicipios')),
              inicio: dataBr(tb.vigenciaInicio),
              itens: tb.itens,
            })
          }}
        </li>
      </ul>
      <form
        v-if="podeAnalisar"
        class="formulario"
        data-testid="reembolso-nova-tabela"
        @submit.prevent="gravarTabela"
      >
        <SanteCampoTexto
          id="tab-codigo"
          v-model="tab.codigo"
          :max-bytes="30"
          :rotulo="t('operadoraReembolso.tabelas.codigo')"
          data-testid="tab-codigo"
        />
        <SanteCampoTexto
          id="tab-nome"
          v-model="tab.nome"
          :max-bytes="150"
          :rotulo="t('operadoraReembolso.tabelas.nome')"
          data-testid="tab-nome"
        />
        <SanteCampoTexto
          id="tab-mun-busca"
          v-model="bMun.termo.value"
          :max-bytes="60"
          :rotulo="t('operadoraReembolso.tabelas.buscaMun')"
        />
        <SanteSelecao
          id="tab-mun"
          v-model="tab.municipio"
          :rotulo="t('operadoraReembolso.tabelas.municipio')"
          :opcoes="bMun.opcoes.value"
          data-testid="tab-mun"
        />
        <SanteCampoTexto
          id="tab-inicio"
          v-model="tab.inicio"
          :max-bytes="10"
          :rotulo="t('operadoraReembolso.tabelas.inicio')"
        />
        <SanteCampoTexto
          id="tab-proc-busca"
          v-model="bProc.termo.value"
          :max-bytes="60"
          :rotulo="t('operadoraReembolso.novo.buscaProc')"
          data-testid="tab-proc-busca"
        />
        <SanteSelecao
          id="tab-proc"
          v-model="tab.procedimento"
          :rotulo="t('operadoraReembolso.novo.procedimento')"
          :opcoes="bProc.opcoes.value"
          data-testid="tab-proc"
        />
        <SanteCampoTexto
          id="tab-valor"
          v-model="tab.valor"
          :max-bytes="20"
          :rotulo="t('operadoraReembolso.tabelas.valor')"
          data-testid="tab-valor"
        />
        <SanteCampoTexto
          id="tab-qtd"
          v-model="tab.qtdMax"
          :max-bytes="6"
          :rotulo="t('operadoraReembolso.tabelas.qtdMax')"
        />
        <SanteBotao
          :rotulo="t('operadoraReembolso.tabelas.incluir')"
          variante="secundario"
          data-testid="tab-incluir-item"
          @click="incluirItemTab"
        />
        <ul>
          <li v-for="i in itensTab" :key="i.procedimento">{{ i.rotulo }} · {{ moeda(i.valor) }}</li>
        </ul>
        <SanteBotao
          :rotulo="t('operadoraReembolso.tabelas.gravar')"
          tipo="submit"
          :desabilitado="itensTab.length === 0"
          data-testid="tab-gravar"
        />
      </form>
      <h2>{{ t('operadoraReembolso.regras.titulo') }}</h2>
      <ul data-testid="reembolso-regras">
        <li v-for="r in regras" :key="r.id">
          {{
            t('operadoraReembolso.regras.linha', {
              plano: r.plano.nome,
              mult: r.multiplicador,
              percentual:
                r.percentual !== null
                  ? t('operadoraReembolso.regras.ouPercentual', { pct: r.percentual })
                  : '',
              teto:
                r.limitePorEvento !== null ? moeda(r.limitePorEvento) : t('operadoraReembolso.regras.sem'),
              prazo: r.prazoPagamentoDias,
            })
          }}
        </li>
      </ul>
      <form
        v-if="podeAnalisar"
        class="formulario"
        data-testid="reembolso-nova-regra"
        @submit.prevent="gravarRegra"
      >
        <SanteCampoTexto
          id="reg-plano"
          v-model="reg.plano"
          :max-bytes="12"
          :rotulo="t('operadoraReembolso.regras.plano')"
          data-testid="reg-plano"
        />
        <SanteSelecao
          id="reg-tabela"
          v-model="reg.tabela"
          :rotulo="t('operadoraReembolso.regras.tabela')"
          :opcoes="opcoesTabela"
        />
        <SanteCampoTexto
          id="reg-mult"
          v-model="reg.multiplicador"
          :max-bytes="10"
          :rotulo="t('operadoraReembolso.regras.multiplicador')"
          data-testid="reg-mult"
        />
        <SanteCampoTexto
          id="reg-pct"
          v-model="reg.percentual"
          :max-bytes="10"
          :rotulo="t('operadoraReembolso.regras.percentual')"
        />
        <SanteCampoTexto
          id="reg-evento"
          v-model="reg.limiteEvento"
          :max-bytes="20"
          :rotulo="t('operadoraReembolso.regras.tetoEvento')"
          data-testid="reg-evento"
        />
        <SanteCampoTexto
          id="reg-anual"
          v-model="reg.limiteAnual"
          :max-bytes="20"
          :rotulo="t('operadoraReembolso.regras.tetoAnual')"
        />
        <SanteCampoTexto
          id="reg-prazo"
          v-model="reg.prazo"
          :max-bytes="3"
          :rotulo="t('operadoraReembolso.regras.prazo')"
          data-testid="reg-prazo"
        />
        <p v-if="faltaRegra" role="alert" data-testid="reg-falta">{{ faltaRegra }}</p>
        <SanteBotao
          :rotulo="t('operadoraReembolso.regras.gravar')"
          tipo="submit"
          :desabilitado="!!faltaRegra"
          data-testid="reg-gravar"
        />
      </form>
    </template>
  </section>
</template>
