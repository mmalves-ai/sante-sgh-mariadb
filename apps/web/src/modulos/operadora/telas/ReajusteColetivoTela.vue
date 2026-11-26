<script setup lang="ts">
// Reajuste da operadora além do anual digitado (08-SGO L96, C1-086), atalho da tela de cobrança: o índice com vigência
// (o teto da ANS com o protocolo, que o reajuste anual do individual passa a usar sem digitar), o agrupamento do coletivo
// pequeno (RN ANS 565/2022: os contratos coletivos com até o limite de vidas entram de uma vez; percentual único pela
// regra ou informado com a memória; aplicado no aniversário de cada contrato) e o reajuste do coletivo grande pela
// sinistralidade apurada, com a conta impressa antes de gravar. Gravar só com operadora.cobranca.gerar.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { lerTelaCobranca } from '../api-cobranca.js';
import {
  type Agrupamento,
  aplicarAgrupamento,
  calcularAgrupamento,
  cancelarAgrupamento,
  type ContratoColetivo,
  criarAgrupamento,
  gravarIndice,
  gravarRegra,
  type Indice,
  lerAgrupamentos,
  lerContratosColetivos,
  lerIndices,
  lerMembros,
  lerPrevia,
  lerRegras,
  type Membro,
  type Previa,
  reajustarPorSinistralidade,
  type Regra,
} from '../api-reajuste-coletivo.js';

type Aba = 'indices' | 'agrupamento' | 'sinistralidade';
const { t } = useI18n();
const aba = ref<Aba>('indices');
const podeGravar = computed(() => pode('operadora.cobranca.gerar'));
const operadoras = ref<{ valor: number | null; rotulo: string }[]>([]);
const operadora = ref<number | null>(null);
const erro = ref<string | null>(null);
const aviso = ref<string | null>(null);
const pct = (v: number | null) =>
  v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: string | null) => (v ? v.split('-').reverse().join('/') : '—');
const numeroBr = (v: string): number | null => {
  const t = v.trim().replace(/\./g, '').replace(',', '.');
  return t === '' || Number.isNaN(Number(t)) ? null : Number(t);
};

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

// ---------------------------------------------------------------- índices ----------------------------------------
const TIPO_INDICE: Record<Indice['tipo'], string> = {
  teto_individual_ans: 'Teto da ANS (individual ou familiar)',
  economico: 'Índice econômico',
  proprio: 'Índice próprio',
};
const tiposIndice = Object.entries(TIPO_INDICE).map(([valor, rotulo]) => ({ valor, rotulo }));
const indices = ref<Indice[]>([]);
const ind = ref({
  codigo: '',
  descricao: '',
  tipo: 'teto_individual_ans' as string | null,
  inicio: '',
  fim: '',
});
const indPercentual = ref('');
const indProtocolo = ref('');
const faltaIndice = computed(() => {
  const f: string[] = [];
  if (!/^[A-Za-z0-9_.-]{2,30}$/.test(ind.value.codigo.trim())) f.push('código');
  if (ind.value.descricao.trim().length < 3) f.push('descrição');
  if (!/^\d{4}-\d{2}-01$/.test(ind.value.inicio)) f.push('início no dia 1');
  if (ind.value.fim && ind.value.fim < ind.value.inicio) f.push('fim depois do início');
  const p = numeroBr(indPercentual.value);
  if (p === null || p < -100 || p > 100) f.push('percentual');
  if (ind.value.tipo === 'teto_individual_ans' && !indProtocolo.value.trim()) f.push('protocolo do ofício');
  return f;
});
async function carregarIndices() {
  indices.value = (await tentar(() => lerIndices())) ?? [];
}
async function salvarIndice() {
  const r = await tentar(
    () =>
      gravarIndice({
        codigo: ind.value.codigo.trim(),
        descricao: ind.value.descricao.trim(),
        tipo: ind.value.tipo as Indice['tipo'],
        vigenciaInicio: ind.value.inicio,
        vigenciaFim: ind.value.fim || null,
        percentual: numeroBr(indPercentual.value) ?? 0,
        protocolo: indProtocolo.value.trim() || null,
      }),
    'Índice cadastrado.',
  );
  if (r) {
    ind.value = { codigo: '', descricao: '', tipo: 'teto_individual_ans', inicio: '', fim: '' };
    indPercentual.value = '';
    indProtocolo.value = '';
    await carregarIndices();
    aviso.value = 'Índice cadastrado.';
  }
}
void carregarIndices();

// ---------------------------------------------------------------- regras -----------------------------------------
const regras = ref<Regra[]>([]);
const opcoesRegra = computed(() =>
  regras.value.map((r) => ({ valor: r.id, rotulo: `${r.codigo} — ${r.descricao}` })),
);
const novaRegra = ref({ codigo: '', descricao: '', base: 'sinistralidade' as string | null, inicio: '' });
const regraMeses = ref('12');
const regraMeta = ref('');
const faixas = ref<{ ate: string; percentual: string }[]>([{ ate: '', percentual: '' }]);
const bases = [
  { valor: 'sinistralidade', rotulo: 'Sinistralidade (%)' },
  { valor: 'mensalidade', rotulo: 'Mensalidade média (R$)' },
];
/** As faixas na tela: cada uma começa onde a anterior termina (sem buraco nem sobreposição). */
const faixasMontadas = computed(() =>
  faixas.value.map((f, i) => ({
    de: i === 0 ? 0 : (numeroBr(faixas.value[i - 1]!.ate) ?? Number.NaN),
    ate: i === faixas.value.length - 1 && !f.ate.trim() ? null : numeroBr(f.ate),
    percentual: numeroBr(f.percentual) ?? Number.NaN,
  })),
);
const faltaRegra = computed(() => {
  const f: string[] = [];
  if (!/^[A-Za-z0-9_.-]{2,30}$/.test(novaRegra.value.codigo.trim())) f.push('código');
  if (novaRegra.value.descricao.trim().length < 3) f.push('descrição');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(novaRegra.value.inicio)) f.push('início');
  const m = Number(regraMeses.value);
  if (!Number.isInteger(m) || m < 1 || m > 36) f.push('meses (1 a 36)');
  faixasMontadas.value.forEach((x, i) => {
    if (Number.isNaN(x.percentual)) f.push(`percentual da faixa ${i + 1}`);
    if (x.ate !== null && !(x.ate > x.de)) f.push(`valor final da faixa ${i + 1}`);
  });
  return f;
});
async function carregarRegras() {
  if (operadora.value === null) return;
  regras.value = (await tentar(() => lerRegras(operadora.value!))) ?? [];
}
async function salvarRegra() {
  const r = await tentar(() =>
    gravarRegra(operadora.value!, {
      codigo: novaRegra.value.codigo.trim(),
      descricao: novaRegra.value.descricao.trim(),
      base: novaRegra.value.base as Regra['base'],
      meses: Number(regraMeses.value),
      meta: numeroBr(regraMeta.value),
      vigenciaInicio: novaRegra.value.inicio,
      vigenciaFim: null,
      faixas: faixasMontadas.value,
    }),
  );
  if (r) {
    novaRegra.value = { codigo: '', descricao: '', base: 'sinistralidade', inicio: '' };
    faixas.value = [{ ate: '', percentual: '' }];
    await carregarRegras();
    aviso.value = 'Regra cadastrada.';
  }
}

// ---------------------------------------------------------------- agrupamento ------------------------------------
const SITUACAO: Record<Agrupamento['situacao'], string> = {
  aberto: 'Aberto',
  calculado: 'Calculado',
  aplicado: 'Aplicado',
  cancelado: 'Cancelado',
};
const agrupamentos = ref<Agrupamento[]>([]);
const novoAgr = ref({ descricao: '', vigencia: '' });
const limiteVidas = ref('29');
const aberto = ref<number | null>(null);
const membros = ref<Membro[]>([]);
const regraCalculo = ref<number | null>(null);
const percentualInformado = ref('');
const justificativa = ref('');
const competenciaAplicar = ref('');
const motivoCancelar = ref('');
const faltaAgrupamento = computed(() => {
  const f: string[] = [];
  if (novoAgr.value.descricao.trim().length < 3) f.push('descrição');
  if (!/^\d{4}-\d{2}-01$/.test(novoAgr.value.vigencia)) f.push('início do período no dia 1');
  const l = Number(limiteVidas.value);
  if (!Number.isInteger(l) || l < 29) f.push('limite de vidas (29 ou mais)');
  return f;
});
const podeCalcular = computed(
  () =>
    regraCalculo.value !== null ||
    (numeroBr(percentualInformado.value) !== null && justificativa.value.trim().length >= 10),
);
async function carregarAgrupamentos() {
  if (operadora.value === null) return;
  agrupamentos.value = (await tentar(() => lerAgrupamentos(operadora.value!))) ?? [];
}
async function abrir(a: Agrupamento) {
  aberto.value = aberto.value === a.id ? null : a.id;
  membros.value = aberto.value === null ? [] : ((await tentar(() => lerMembros(a.id))) ?? []);
}
async function criar() {
  const r = await tentar(() =>
    criarAgrupamento(operadora.value!, {
      descricao: novoAgr.value.descricao.trim(),
      vigencia: novoAgr.value.vigencia,
      limiteVidas: Number(limiteVidas.value),
    }),
  );
  if (r) {
    novoAgr.value = { descricao: '', vigencia: '' };
    await carregarAgrupamentos();
    aviso.value = `Agrupamento criado com ${String(r['contratos'])} contrato(s) e ${String(r['vidas'])} vida(s).`;
  }
}
async function calcular(a: Agrupamento) {
  const r = await tentar(() =>
    calcularAgrupamento(a.id, {
      versao: a.versao,
      regra: regraCalculo.value,
      percentual: regraCalculo.value === null ? numeroBr(percentualInformado.value) : null,
      justificativa: justificativa.value.trim() || null,
    }),
  );
  if (r) {
    await carregarAgrupamentos();
    aviso.value = `Percentual único calculado: ${pct(Number(r['percentual']))}.`;
  }
}
async function aplicar(a: Agrupamento) {
  const r = await tentar(() =>
    aplicarAgrupamento(a.id, { versao: a.versao, competencia: competenciaAplicar.value }),
  );
  if (r) {
    await carregarAgrupamentos();
    const ign = String(r['ignorados'] ?? '');
    aviso.value = `Reajuste aplicado a ${String(r['aplicados'])} contrato(s).${ign ? ` Fora: ${ign}.` : ''}`;
  }
}
async function cancelar(a: Agrupamento) {
  const r = await tentar(() => cancelarAgrupamento(a.id, { versao: a.versao, motivo: motivoCancelar.value }));
  if (r) {
    motivoCancelar.value = '';
    await carregarAgrupamentos();
    aviso.value = 'Agrupamento cancelado.';
  }
}

// ---------------------------------------------------------------- sinistralidade ---------------------------------
const contratos = ref<ContratoColetivo[]>([]);
const opcoesContrato = computed(() =>
  contratos.value.map((k) => ({
    valor: k.id,
    rotulo: `${k.numero} — ${k.vidas} vida(s)${k.vidas <= 29 ? ' (agrupamento)' : ''}`,
  })),
);
const contrato = ref<number | null>(null);
const regraSin = ref<number | null>(null);
const competenciaSin = ref('');
const previa = ref<Previa | null>(null);
const contratoEscolhido = computed(() => contratos.value.find((k) => k.id === contrato.value) ?? null);
const competenciaOk = computed(() => /^\d{4}-(0[1-9]|1[0-2])$/.test(competenciaSin.value));
const foraDoAniversario = computed(
  () =>
    contratoEscolhido.value !== null &&
    competenciaOk.value &&
    Number(competenciaSin.value.slice(5, 7)) !== contratoEscolhido.value.mesReajuste,
);
async function carregarContratos() {
  if (operadora.value === null) return;
  contratos.value = (await tentar(() => lerContratosColetivos(operadora.value!))) ?? [];
}
async function verPrevia() {
  previa.value = await tentar(() => lerPrevia(contrato.value!, competenciaSin.value, regraSin.value!));
}
async function reajustar() {
  const r = await tentar(() =>
    reajustarPorSinistralidade(contrato.value!, {
      competencia: competenciaSin.value,
      regra: regraSin.value!,
    }),
  );
  if (r) {
    previa.value = null;
    aviso.value = `Reajuste de ${pct(Number(r['percentual']))} registrado (sinistralidade ${pct(Number(r['sinistralidade']))}).`;
  }
}
watch([contrato, regraSin, competenciaSin], () => {
  previa.value = null;
});

watch(operadora, () => {
  aberto.value = null;
  void carregarRegras();
  void carregarAgrupamentos();
  void carregarContratos();
});
</script>

<template>
  <section class="reajuste" aria-labelledby="reajuste-titulo" data-testid="tela-reajuste-coletivo">
    <h1 id="reajuste-titulo">{{ t('operadoraReajuste.titulo') }}</h1>
    <p class="reajuste__ajuda">{{ t('operadoraReajuste.ajuda') }}</p>
    <RouterLink to="/operadora/cobranca" data-testid="link-cobranca">{{
      t('operadoraReajuste.voltar')
    }}</RouterLink>
    <SanteAlerta
      v-if="!podeGravar"
      :texto="t('operadoraReajuste.somenteLeitura')"
      variante="info"
      data-testid="reajuste-somente-leitura"
    />
    <SanteSelecao
      id="reajuste-operadora"
      v-model="operadora"
      :rotulo="t('operadoraReajuste.operadora')"
      :opcoes="operadoras"
      data-testid="reajuste-operadora"
    />
    <div class="reajuste__linha" role="tablist">
      <SanteBotao
        :rotulo="t('operadoraReajuste.abas.indices')"
        :variante="aba === 'indices' ? 'primario' : 'secundario'"
        data-testid="aba-indices"
        @click="aba = 'indices'"
      />
      <SanteBotao
        :rotulo="t('operadoraReajuste.abas.agrupamento')"
        :variante="aba === 'agrupamento' ? 'primario' : 'secundario'"
        data-testid="aba-agrupamento"
        @click="aba = 'agrupamento'"
      />
      <SanteBotao
        :rotulo="t('operadoraReajuste.abas.sinistralidade')"
        :variante="aba === 'sinistralidade' ? 'primario' : 'secundario'"
        data-testid="aba-sinistralidade"
        @click="aba = 'sinistralidade'"
      />
    </div>
    <SanteAlerta v-if="erro" :texto="erro" variante="alerta" anunciar data-testid="reajuste-erro" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="reajuste-aviso" />

    <!-- Índices -->
    <div v-if="aba === 'indices'" class="reajuste__painel" data-testid="painel-indices">
      <form
        v-if="podeGravar"
        class="reajuste__painel"
        data-testid="form-indice"
        @submit.prevent="salvarIndice"
      >
        <div class="reajuste__linha">
          <SanteCampoTexto
            :max-bytes="200"
            id="ind-codigo"
            v-model="ind.codigo"
            :rotulo="t('operadoraReajuste.indice.codigo')"
            data-testid="ind-codigo"
          />
          <SanteCampoTexto
            :max-bytes="200"
            id="ind-descricao"
            v-model="ind.descricao"
            :rotulo="t('operadoraReajuste.indice.descricao')"
            data-testid="ind-descricao"
          />
          <SanteSelecao
            id="ind-tipo"
            v-model="ind.tipo"
            :rotulo="t('operadoraReajuste.indice.tipo')"
            :opcoes="tiposIndice"
            data-testid="ind-tipo"
          />
        </div>
        <div class="reajuste__linha">
          <SanteCampoTexto
            :max-bytes="200"
            id="ind-inicio"
            v-model="ind.inicio"
            :rotulo="t('operadoraReajuste.indice.vigenciaDe')"
            data-testid="ind-inicio"
          />
          <SanteCampoTexto
            :max-bytes="200"
            id="ind-fim"
            v-model="ind.fim"
            :rotulo="t('operadoraReajuste.indice.vigenciaAte')"
            data-testid="ind-fim"
          />
          <SanteCampoTexto
            :max-bytes="200"
            id="ind-percentual"
            v-model="indPercentual"
            :rotulo="t('operadoraReajuste.indice.percentual')"
            data-testid="ind-percentual"
          />
          <SanteCampoTexto
            :max-bytes="200"
            id="ind-protocolo"
            v-model="indProtocolo"
            :rotulo="t('operadoraReajuste.indice.protocolo')"
            data-testid="ind-protocolo"
          />
        </div>
        <p v-if="faltaIndice.length" class="reajuste__erro" data-testid="ind-falta">
          {{ t('operadoraReajuste.falta', { lista: faltaIndice.join(', ') }) }}
        </p>
        <SanteBotao
          :rotulo="t('operadoraReajuste.indice.cadastrar')"
          tipo="submit"
          :desabilitado="faltaIndice.length > 0"
          data-testid="ind-salvar"
        />
      </form>
      <table class="reajuste__tabela" data-testid="tabela-indices">
        <thead>
          <tr>
            <th>{{ t('operadoraReajuste.indice.colunas.codigo') }}</th>
            <th>{{ t('operadoraReajuste.indice.colunas.tipo') }}</th>
            <th>{{ t('operadoraReajuste.indice.colunas.vigencia') }}</th>
            <th>{{ t('operadoraReajuste.indice.colunas.percentual') }}</th>
            <th>{{ t('operadoraReajuste.indice.colunas.protocolo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in indices" :key="i.id" :data-testid="`indice-${i.codigo}`">
            <td>{{ i.codigo }} — {{ i.descricao }}</td>
            <td>{{ TIPO_INDICE[i.tipo] }}</td>
            <td>
              {{
                t('operadoraReajuste.periodo', { de: dataBr(i.vigenciaInicio), ate: dataBr(i.vigenciaFim) })
              }}
            </td>
            <td>{{ pct(i.percentual) }}</td>
            <td>{{ i.protocolo ?? '—' }}</td>
          </tr>
          <tr v-if="!indices.length">
            <td colspan="5">{{ t('operadoraReajuste.indice.vazio') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Agrupamento -->
    <div v-else-if="aba === 'agrupamento'" class="reajuste__painel" data-testid="painel-agrupamento">
      <p class="reajuste__ajuda">{{ t('operadoraReajuste.agrupamento.ajuda') }}</p>
      <form
        v-if="podeGravar && operadora !== null"
        class="reajuste__linha"
        data-testid="form-agrupamento"
        @submit.prevent="criar"
      >
        <SanteCampoTexto
          :max-bytes="200"
          id="agr-descricao"
          v-model="novoAgr.descricao"
          :rotulo="t('operadoraReajuste.agrupamento.descricao')"
          data-testid="agr-descricao"
        />
        <SanteCampoTexto
          :max-bytes="200"
          id="agr-vigencia"
          v-model="novoAgr.vigencia"
          :rotulo="t('operadoraReajuste.agrupamento.inicio')"
          data-testid="agr-vigencia"
        />
        <SanteCampoTexto
          :max-bytes="200"
          id="agr-limite"
          v-model="limiteVidas"
          :rotulo="t('operadoraReajuste.agrupamento.limiteVidas')"
          data-testid="agr-limite"
        />
        <SanteBotao
          :rotulo="t('operadoraReajuste.agrupamento.criar')"
          tipo="submit"
          :desabilitado="faltaAgrupamento.length > 0"
          data-testid="agr-criar"
        />
        <p v-if="faltaAgrupamento.length" class="reajuste__erro" data-testid="agr-falta">
          {{ t('operadoraReajuste.falta', { lista: faltaAgrupamento.join(', ') }) }}
        </p>
      </form>
      <article
        v-for="a in agrupamentos"
        :key="a.id"
        class="reajuste__cartao"
        :data-testid="`agrupamento-${a.id}`"
      >
        <header class="reajuste__linha">
          <strong>{{ a.descricao }}</strong>
          <span>{{ t('operadoraReajuste.agrupamento.desde', { data: dataBr(a.vigencia) }) }}</span>
          <span>{{
            t('operadoraReajuste.agrupamento.contagem', { contratos: a.contratos, vidas: a.vidas })
          }}</span>
          <span>{{ t('operadoraReajuste.agrupamento.percentualUnico', { pct: pct(a.percentual) }) }}</span>
          <span :data-testid="`agrupamento-situacao-${a.id}`">{{ SITUACAO[a.situacao] }}</span>
          <SanteBotao
            :rotulo="aberto === a.id ? 'Fechar' : 'Contratos e ações'"
            variante="secundario"
            :data-testid="`agrupamento-abrir-${a.id}`"
            @click="abrir(a)"
          />
        </header>
        <div v-if="aberto === a.id" class="reajuste__painel">
          <p v-if="a.memoria" class="reajuste__ajuda" data-testid="agrupamento-memoria">{{ a.memoria }}</p>
          <table class="reajuste__tabela" data-testid="tabela-membros">
            <thead>
              <tr>
                <th>{{ t('operadoraReajuste.agrupamento.colunas.contrato') }}</th>
                <th>{{ t('operadoraReajuste.agrupamento.colunas.aniversario') }}</th>
                <th>{{ t('operadoraReajuste.agrupamento.colunas.vidas') }}</th>
                <th>{{ t('operadoraReajuste.agrupamento.colunas.reajustado') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in membros" :key="m.id">
                <td>{{ m.numero }}</td>
                <td>{{ t('operadoraReajuste.agrupamento.mes', { mes: m.mesReajuste }) }}</td>
                <td>{{ m.vidas }}</td>
                <td>{{ m.reajustado ? 'Sim' : 'Não' }}</td>
              </tr>
            </tbody>
          </table>
          <template v-if="podeGravar && a.situacao !== 'cancelado'">
            <div v-if="a.situacao !== 'aplicado'" class="reajuste__linha" data-testid="agr-calculo">
              <SanteSelecao
                id="agr-regra"
                v-model="regraCalculo"
                :rotulo="t('operadoraReajuste.agrupamento.regra')"
                :opcoes="[{ valor: null, rotulo: 'Percentual informado' }, ...opcoesRegra]"
                data-testid="agr-regra"
              />
              <SanteCampoTexto
                :max-bytes="200"
                v-if="regraCalculo === null"
                id="agr-percentual"
                v-model="percentualInformado"
                :rotulo="t('operadoraReajuste.agrupamento.percentual')"
                data-testid="agr-percentual"
              />
              <SanteCampoTexto
                :max-bytes="2000"
                id="agr-justificativa"
                v-model="justificativa"
                :rotulo="t('operadoraReajuste.agrupamento.memoria')"
                data-testid="agr-justificativa"
              />
              <SanteBotao
                :rotulo="t('operadoraReajuste.agrupamento.calcular')"
                :desabilitado="!podeCalcular"
                data-testid="agr-calcular"
                @click="calcular(a)"
              />
            </div>
            <div v-if="a.situacao !== 'aberto'" class="reajuste__linha" data-testid="agr-aplicacao">
              <SanteCampoTexto
                :max-bytes="200"
                id="agr-competencia"
                v-model="competenciaAplicar"
                :rotulo="t('operadoraReajuste.agrupamento.competencia')"
                data-testid="agr-competencia"
              />
              <SanteBotao
                :rotulo="t('operadoraReajuste.agrupamento.aplicar')"
                :desabilitado="!/^\d{4}-(0[1-9]|1[0-2])$/.test(competenciaAplicar)"
                data-testid="agr-aplicar"
                @click="aplicar(a)"
              />
            </div>
            <div v-if="a.situacao !== 'aplicado'" class="reajuste__linha">
              <SanteCampoTexto
                :max-bytes="500"
                id="agr-motivo"
                v-model="motivoCancelar"
                :rotulo="t('operadoraReajuste.agrupamento.motivo')"
                data-testid="agr-motivo"
              />
              <SanteBotao
                :rotulo="t('operadoraReajuste.agrupamento.cancelar')"
                variante="secundario"
                :desabilitado="motivoCancelar.trim().length < 5"
                data-testid="agr-cancelar"
                @click="cancelar(a)"
              />
            </div>
          </template>
        </div>
      </article>
      <p v-if="operadora !== null && !agrupamentos.length">{{ t('operadoraReajuste.agrupamento.vazio') }}</p>
    </div>

    <!-- Sinistralidade -->
    <div v-else class="reajuste__painel" data-testid="painel-sinistralidade">
      <h2>{{ t('operadoraReajuste.regra.titulo') }}</h2>
      <table class="reajuste__tabela" data-testid="tabela-regras">
        <thead>
          <tr>
            <th>{{ t('operadoraReajuste.regra.colunas.regra') }}</th>
            <th>{{ t('operadoraReajuste.regra.colunas.base') }}</th>
            <th>{{ t('operadoraReajuste.regra.colunas.meses') }}</th>
            <th>{{ t('operadoraReajuste.regra.colunas.faixas') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in regras" :key="r.id" :data-testid="`regra-${r.codigo}`">
            <td>{{ r.codigo }} — {{ r.descricao }}</td>
            <td>
              {{ r.base === 'sinistralidade' ? `Sinistralidade (meta ${pct(r.meta)})` : 'Mensalidade média' }}
            </td>
            <td>{{ r.meses }}</td>
            <td>
              <span v-for="(f, i) in r.faixas" :key="i">
                {{
                  t('operadoraReajuste.regra.faixaLista', {
                    de: f.de,
                    ate: f.ate ?? '…',
                    pct: pct(f.percentual),
                  })
                }}<span v-if="i < r.faixas.length - 1">{{ t('operadoraReajuste.regra.separador') }}</span>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <form
        v-if="podeGravar && operadora !== null"
        class="reajuste__painel"
        data-testid="form-regra"
        @submit.prevent="salvarRegra"
      >
        <div class="reajuste__linha">
          <SanteCampoTexto
            :max-bytes="200"
            id="regra-codigo"
            v-model="novaRegra.codigo"
            :rotulo="t('operadoraReajuste.regra.codigo')"
            data-testid="regra-codigo"
          />
          <SanteCampoTexto
            :max-bytes="200"
            id="regra-descricao"
            v-model="novaRegra.descricao"
            :rotulo="t('operadoraReajuste.regra.descricao')"
            data-testid="regra-descricao"
          />
          <SanteSelecao
            id="regra-base"
            v-model="novaRegra.base"
            :rotulo="t('operadoraReajuste.regra.base')"
            :opcoes="bases"
            data-testid="regra-base"
          />
          <SanteCampoTexto
            :max-bytes="200"
            id="regra-meses"
            v-model="regraMeses"
            :rotulo="t('operadoraReajuste.regra.meses')"
            data-testid="regra-meses"
          />
          <SanteCampoTexto
            :max-bytes="200"
            id="regra-meta"
            v-model="regraMeta"
            :rotulo="t('operadoraReajuste.regra.meta')"
            data-testid="regra-meta"
          />
          <SanteCampoTexto
            :max-bytes="200"
            id="regra-inicio"
            v-model="novaRegra.inicio"
            :rotulo="t('operadoraReajuste.regra.vigenciaDe')"
            data-testid="regra-inicio"
          />
        </div>
        <div v-for="(f, i) in faixas" :key="i" class="reajuste__linha" :data-testid="`faixa-${i}`">
          <span>{{ t('operadoraReajuste.regra.faixa', { n: i + 1, de: faixasMontadas[i]!.de }) }}</span>
          <SanteCampoTexto
            :max-bytes="200"
            :id="`faixa-ate-${i}`"
            v-model="f.ate"
            :rotulo="i === faixas.length - 1 ? 'até (vazio: sem limite)' : 'até'"
            :data-testid="`faixa-ate-${i}`"
          />
          <SanteCampoTexto
            :max-bytes="200"
            :id="`faixa-pct-${i}`"
            v-model="f.percentual"
            :rotulo="t('operadoraReajuste.regra.reajuste')"
            :data-testid="`faixa-pct-${i}`"
          />
        </div>
        <div class="reajuste__linha">
          <SanteBotao
            :rotulo="t('operadoraReajuste.regra.maisFaixa')"
            variante="secundario"
            data-testid="faixa-mais"
            @click="faixas.push({ ate: '', percentual: '' })"
          />
          <SanteBotao
            :rotulo="t('operadoraReajuste.regra.cadastrar')"
            tipo="submit"
            :desabilitado="faltaRegra.length > 0"
            data-testid="regra-salvar"
          />
        </div>
        <p v-if="faltaRegra.length" class="reajuste__erro" data-testid="regra-falta">
          {{ t('operadoraReajuste.falta', { lista: faltaRegra.join(', ') }) }}
        </p>
      </form>

      <h2>{{ t('operadoraReajuste.sinistralidade.titulo') }}</h2>
      <div class="reajuste__linha">
        <SanteSelecao
          id="sin-contrato"
          v-model="contrato"
          :rotulo="t('operadoraReajuste.sinistralidade.contrato')"
          :opcoes="opcoesContrato"
          data-testid="sin-contrato"
        />
        <SanteSelecao
          id="sin-regra"
          v-model="regraSin"
          :rotulo="t('operadoraReajuste.sinistralidade.regra')"
          :opcoes="opcoesRegra"
          data-testid="sin-regra"
        />
        <SanteCampoTexto
          :max-bytes="200"
          id="sin-competencia"
          v-model="competenciaSin"
          :rotulo="t('operadoraReajuste.sinistralidade.competencia')"
          data-testid="sin-competencia"
        />
        <SanteBotao
          :rotulo="t('operadoraReajuste.sinistralidade.apurar')"
          :desabilitado="contrato === null || regraSin === null || !competenciaOk"
          data-testid="sin-apurar"
          @click="verPrevia"
        />
      </div>
      <p v-if="foraDoAniversario" class="reajuste__erro" data-testid="sin-fora-aniversario">
        {{ t('operadoraReajuste.sinistralidade.foraAniversario', { mes: contratoEscolhido!.mesReajuste }) }}
      </p>
      <div v-if="previa" class="reajuste__cartao" data-testid="sin-previa">
        <p>
          {{
            t('operadoraReajuste.sinistralidade.periodo', {
              de: dataBr(previa.periodo.inicio),
              ate: dataBr(previa.periodo.fim),
            })
          }}
        </p>
        <p>
          {{
            t('operadoraReajuste.sinistralidade.valores', {
              receita: moeda(previa.receita),
              despesa: moeda(previa.despesa),
            })
          }}
        </p>
        <p data-testid="sin-memoria">{{ previa.memoria }}</p>
        <p>
          {{ t('operadoraReajuste.sinistralidade.pelaRegra') }}
          <strong data-testid="sin-percentual">{{ pct(previa.percentual) }}</strong>
        </p>
        <p
          v-for="p in [...previa.problemasContrato, ...previa.problemas]"
          :key="p.codigo"
          class="reajuste__erro"
          data-testid="sin-problema"
        >
          {{ p.detalhe }}
        </p>
        <SanteBotao
          v-if="podeGravar"
          :rotulo="t('operadoraReajuste.sinistralidade.registrar')"
          :desabilitado="previa.problemas.length + previa.problemasContrato.length > 0 || foraDoAniversario"
          data-testid="sin-registrar"
          @click="reajustar"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.reajuste,
.reajuste__painel {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.reajuste__linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.reajuste__ajuda {
  color: var(--sgh-texto-secundario);
}
.reajuste__erro {
  color: var(--sgh-alerta);
}
.reajuste__cartao {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
.reajuste__tabela {
  width: 100%;
  border-collapse: collapse;
}
.reajuste__tabela th,
.reajuste__tabela td {
  text-align: left;
  padding: var(--sgh-espaco-1);
}
</style>
