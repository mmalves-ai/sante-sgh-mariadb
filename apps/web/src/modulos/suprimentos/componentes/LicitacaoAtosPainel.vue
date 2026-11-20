<script setup lang="ts">
// As etapas e os atos de quem conduz (M55, etapa 4): a mudança de etapa disponível agora (as ações do processo com o
// motivo do bloqueio): para a pesquisa, o edital ou a sessão (com a justificativa da pesquisa abaixo do mínimo), a
// publicação do aviso (veículo e número de controle; a abertura mínima pelo art. 55 em dias úteis, sem sábado,
// domingo e feriado do calendário; nada é enviado ao portal: regra 12), fracassado e deserto com a justificativa; e os atos que cabem na etapa
// (parecer jurídico, esclarecimento ou impugnação, recurso de um licitante, documento, ata e o pedido de compra do
// vencedor ligado pelo número). O julgamento fica na aba da sessão; homologar, decidir o recurso, revogar e anular, na
// da autoridade. O servidor confere tudo de novo.
import {
  esquemaAvancarLicitacao,
  esquemaRegistrarEventoLicitacao,
  PARAMETROS_LICITACAO_PADRAO,
  type TipoEventoLicitacao,
  VEICULOS_PUBLICACAO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  avancarLicitacaoTela,
  type DetalheLicitacaoTela,
  novaChaveLicitacao,
  registrarEventoLicitacaoTela,
} from '../api-licitacao.js';
import { data } from '../usar-suprimentos.js';
import ErroSuprimentos from './ErroSuprimentos.vue';
import {
  aberturaMinima,
  eventosNaEtapa,
  lerNumero,
  nomeFornecedor,
  opcoesDe,
  rotuloEtapa,
  rotuloEventoLicitacao,
} from './licitacao-tela.js';
import { usarEnvioLicitacao } from './usar-envio-licitacao.js';

const props = defineProps<{ d: DetalheLicitacaoTela; pode: boolean }>();
const emit = defineEmits<{ gravado: [mensagem: string] }>();
const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`licitacao.atos.${s}`, p ?? {});
const { erro, enviando, executar } = usarEnvioLicitacao((m) => emit('gravado', m));
const problemasDe = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? [] : [...new Set((r.error?.issues ?? []).map((x) => x.message))];

// ── Mudança de etapa ────────────────────────────────────────────────────────────────────────────────────────

const ETAPAS_AQUI = ['pesquisa', 'edital', 'publicado', 'sessao', 'fracassado', 'deserto'] as const;
type EtapaAqui = (typeof ETAPAS_AQUI)[number];
const acoesEtapa = computed(() =>
  props.d.acoes.filter((a) => (ETAPAS_AQUI as readonly string[]).includes(a.acao)),
);
const para = ref<EtapaAqui | null>(null);
watch(
  acoesEtapa,
  (xs) => {
    if (!para.value || !xs.some((a) => a.acao === para.value))
      para.value = (xs.find((a) => a.pode)?.acao ?? xs[0]?.acao ?? null) as EtapaAqui | null;
  },
  { immediate: true },
);
const opcoesPara = computed(() =>
  acoesEtapa.value.map((a) => ({ valor: a.acao as EtapaAqui | null, rotulo: rotuloEtapa(a.acao) })),
);
const acao = computed(() => acoesEtapa.value.find((a) => a.acao === para.value) ?? null);
const veiculos = opcoesDe(VEICULOS_PUBLICACAO);
const e = reactive({
  justificativaPesquisa: '',
  dataPublicacao: props.d.hoje,
  dataAbertura: '',
  veiculo: 'pncp' as string,
  referencia: '',
  justificativa: '',
});
const minimo = computed(() =>
  aberturaMinima(props.d.processo, e.dataPublicacao, PARAMETROS_LICITACAO_PADRAO, props.d.feriados ?? []),
);
watch(
  minimo,
  (m) => {
    if (m && (!e.dataAbertura || e.dataAbertura < m.data)) e.dataAbertura = m.data;
  },
  { immediate: true },
);
const corpoEtapa = computed(() => {
  const base = { versao: props.d.versao, para: para.value };
  switch (para.value) {
    case 'edital':
    case 'sessao':
      return { ...base, justificativaPesquisa: e.justificativaPesquisa.trim() || null };
    case 'publicado':
      return {
        ...base,
        dataPublicacao: e.dataPublicacao,
        dataAbertura: e.dataAbertura,
        veiculo: e.veiculo,
        referencia: e.referencia,
      };
    case 'fracassado':
    case 'deserto':
      return { ...base, justificativa: e.justificativa };
    default:
      return base;
  }
});
const problemasEtapa = computed(() =>
  problemasDe(esquemaAvancarLicitacao.safeParse({ chave: 'previa.da.tela', ...corpoEtapa.value })),
);
const tentouEtapa = ref(false);
let chaveEtapa = novaChaveLicitacao('etapa');
async function avancar(): Promise<void> {
  tentouEtapa.value = true;
  if (!props.pode || !para.value || !acao.value?.pode || problemasEtapa.value.length) return;
  const corpo = corpoEtapa.value as Record<string, unknown> & { para: string };
  const ok = await executar(() => avancarLicitacaoTela(props.d.id, corpo, chaveEtapa));
  if (ok) {
    chaveEtapa = novaChaveLicitacao('etapa');
    tentouEtapa.value = false;
    Object.assign(e, { justificativaPesquisa: '', referencia: '', justificativa: '' });
  }
}

// ── Atos ────────────────────────────────────────────────────────────────────────────────────────────────────

const tiposAto = computed(() => eventosNaEtapa(props.d.etapa, props.d.modalidade));
const tipo = ref<TipoEventoLicitacao | null>(null);
watch(
  tiposAto,
  (xs) => {
    if (!tipo.value || !xs.includes(tipo.value)) tipo.value = xs[0] ?? null;
  },
  { immediate: true },
);
const opcoesTipo = computed(() =>
  tiposAto.value.map((x) => ({ valor: x as TipoEventoLicitacao | null, rotulo: rotuloEventoLicitacao(x) })),
);
const a = reactive({
  data: props.d.hoje,
  resultado: 'favoravel' as string,
  descricao: '',
  fornecedor: null as number | null,
  documento: '',
  referencia: '',
  validade: '',
  pedido: '',
});
const resultadosParecer = [
  { valor: 'favoravel', rotulo: k('favoravel') },
  { valor: 'ressalvas', rotulo: k('ressalvas') },
  { valor: 'desfavoravel', rotulo: k('desfavoravel') },
];
const licitantes = computed(() => {
  const xs = [...new Set(props.d.propostas.map((p) => p.fornecedor))];
  return [
    { valor: null as number | null, rotulo: '—' },
    ...xs.map((x) => ({ valor: x as number | null, rotulo: nomeFornecedor(props.d.propostas, x) })),
  ];
});
const corpoAto = computed(() => {
  const base = { versao: props.d.versao, tipo: tipo.value };
  const doc = lerNumero(a.documento);
  switch (tipo.value) {
    case 'parecer':
      return { ...base, data: a.data, resultado: a.resultado, descricao: a.descricao, documento: doc };
    case 'esclarecimento':
      return { ...base, data: a.data, descricao: a.descricao, documento: doc };
    case 'recurso':
      return { ...base, data: a.data, fornecedor: a.fornecedor, descricao: a.descricao, documento: doc };
    case 'documento':
      return { ...base, data: a.data, descricao: a.descricao, documento: doc };
    case 'ata':
      return {
        ...base,
        data: a.data,
        referencia: a.referencia,
        validade: a.validade || null,
        descricao: a.descricao,
        documento: doc,
      };
    case 'pedido':
      return { ...base, pedido: lerNumero(a.pedido), descricao: a.descricao };
    default:
      return base;
  }
});
const problemasAto = computed(() =>
  problemasDe(esquemaRegistrarEventoLicitacao.safeParse({ chave: 'previa.da.tela', ...corpoAto.value })),
);
const tentouAto = ref(false);
let chaveAto = novaChaveLicitacao('ato');
async function registrarAto(): Promise<void> {
  tentouAto.value = true;
  if (!props.pode || !tipo.value || problemasAto.value.length) return;
  const corpo = corpoAto.value as Record<string, unknown> & { tipo: string };
  const ok = await executar(() => registrarEventoLicitacaoTela(props.d.id, corpo, chaveAto));
  if (ok) {
    chaveAto = novaChaveLicitacao('ato');
    tentouAto.value = false;
    Object.assign(a, {
      descricao: '',
      fornecedor: null,
      documento: '',
      referencia: '',
      validade: '',
      pedido: '',
    });
  }
}
</script>

<template>
  <section class="atos-licitacao" data-testid="lic-atos">
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <form class="formulario-licitacao" data-testid="lic-etapa-form" @submit.prevent="avancar">
      <h3>{{ k('etapa') }}</h3>
      <p v-if="acoesEtapa.length === 0" class="secundario" data-testid="lic-etapa-nenhuma">
        {{ k('nenhumaEtapa') }}
        <template v-if="d.etapa === 'sessao'"> {{ k('julgarNaSessao') }}</template>
      </p>
      <template v-else>
        <SanteSelecao v-model="para" :rotulo="k('para')" :opcoes="opcoesPara" data-testid="lic-etapa-para" />
        <SanteAlerta
          v-if="acao?.motivo"
          :variante="acao.pode ? 'info' : 'aviso'"
          :texto="acao.motivo"
          data-testid="lic-etapa-motivo"
        />
        <span v-if="(para === 'edital' || para === 'sessao') && acao?.motivo" class="campo campo-largo">
          <label for="lic-just-pesquisa">{{ k('justificativaPesquisa') }}</label>
          <textarea
            id="lic-just-pesquisa"
            v-model="e.justificativaPesquisa"
            maxlength="1000"
            rows="2"
            data-testid="lic-just-pesquisa"
          />
        </span>
        <template v-if="para === 'publicado'">
          <div class="barra">
            <span class="campo">
              <label for="lic-data-pub">{{ k('dataPublicacao') }}</label>
              <input
                id="lic-data-pub"
                v-model="e.dataPublicacao"
                type="date"
                :max="d.hoje"
                data-testid="lic-data-pub"
              />
            </span>
            <span class="campo">
              <label for="lic-data-abertura">{{ k('dataAbertura') }}</label>
              <input
                id="lic-data-abertura"
                v-model="e.dataAbertura"
                type="date"
                :min="minimo?.data"
                data-testid="lic-data-abertura"
              />
            </span>
            <SanteSelecao
              v-model="e.veiculo"
              :rotulo="k('veiculo')"
              :opcoes="veiculos"
              data-testid="lic-veiculo"
            />
            <span class="campo">
              <label for="lic-ref-pub">{{ k('referenciaPublicacao') }}</label>
              <input id="lic-ref-pub" v-model="e.referencia" maxlength="100" data-testid="lic-ref-pub" />
            </span>
          </div>
          <p v-if="minimo" data-testid="lic-prazo-minimo">
            {{ k('prazoMinimo', { dias: minimo.dias, data: data(minimo.data) }) }}
          </p>
          <p class="secundario">{{ k('feriados') }}</p>
          <p class="secundario">{{ k('semPublicacaoExterna') }}</p>
        </template>
        <span v-if="para === 'fracassado' || para === 'deserto'" class="campo campo-largo">
          <label for="lic-just-final">{{ k('justificativa') }}</label>
          <textarea
            id="lic-just-final"
            v-model="e.justificativa"
            maxlength="1000"
            rows="2"
            data-testid="lic-just-final"
          />
        </span>
        <SanteAlerta
          v-if="tentouEtapa && problemasEtapa.length"
          variante="aviso"
          :texto="problemasEtapa.join('; ')"
          data-testid="lic-etapa-faltam"
        />
        <SanteBotao
          tipo="submit"
          :rotulo="k('avancar')"
          :desabilitado="!pode || enviando || !acao?.pode"
          data-testid="lic-etapa-avancar"
        />
      </template>
    </form>

    <form class="formulario-licitacao" data-testid="lic-ato-form" @submit.prevent="registrarAto">
      <h3>{{ k('atos') }}</h3>
      <p v-if="tiposAto.length === 0" class="secundario">{{ k('nenhumAto') }}</p>
      <template v-else>
        <div class="barra">
          <SanteSelecao v-model="tipo" :rotulo="k('tipo')" :opcoes="opcoesTipo" data-testid="lic-ato-tipo" />
          <span v-if="tipo !== 'pedido'" class="campo">
            <label for="lic-ato-data">{{ k('data') }}</label>
            <input id="lic-ato-data" v-model="a.data" type="date" :max="d.hoje" data-testid="lic-ato-data" />
          </span>
          <SanteSelecao
            v-if="tipo === 'parecer'"
            v-model="a.resultado"
            :rotulo="k('resultadoParecer')"
            :opcoes="resultadosParecer"
            data-testid="lic-ato-parecer"
          />
          <SanteSelecao
            v-if="tipo === 'recurso'"
            v-model="a.fornecedor"
            :rotulo="k('recorrente')"
            :opcoes="licitantes"
            :busca="true"
            data-testid="lic-ato-recorrente"
          />
          <template v-if="tipo === 'ata'">
            <span class="campo">
              <label for="lic-ato-ref">{{ k('referenciaAta') }}</label>
              <input id="lic-ato-ref" v-model="a.referencia" maxlength="100" data-testid="lic-ato-ref" />
            </span>
            <span class="campo">
              <label for="lic-ato-validade">{{ k('validade') }}</label>
              <input id="lic-ato-validade" v-model="a.validade" type="date" data-testid="lic-ato-validade" />
            </span>
          </template>
          <span v-if="tipo === 'pedido'" class="campo">
            <label for="lic-ato-pedido">{{ k('pedido') }}</label>
            <input
              id="lic-ato-pedido"
              v-model="a.pedido"
              inputmode="numeric"
              size="10"
              aria-describedby="lic-ato-pedido-ajuda"
              data-testid="lic-ato-pedido"
            />
          </span>
          <span v-if="tipo !== 'pedido'" class="campo">
            <label for="lic-ato-doc">{{
              tipo === 'documento' ? k('documento') : k('documentoOpcional')
            }}</label>
            <input
              id="lic-ato-doc"
              v-model="a.documento"
              inputmode="numeric"
              size="10"
              data-testid="lic-ato-doc"
            />
          </span>
        </div>
        <p v-if="tipo === 'pedido'" id="lic-ato-pedido-ajuda" class="secundario">
          {{ k('pedidoAjuda') }}
          <RouterLink to="/suprimentos/pedidos" data-testid="lic-ir-pedidos">{{ k('irPedidos') }}</RouterLink>
        </p>
        <span class="campo campo-largo">
          <label for="lic-ato-desc">{{ k('descricao') }}</label>
          <textarea
            id="lic-ato-desc"
            v-model="a.descricao"
            maxlength="1000"
            rows="2"
            data-testid="lic-ato-desc"
          />
        </span>
        <SanteAlerta
          v-if="tentouAto && problemasAto.length"
          variante="aviso"
          :texto="problemasAto.join('; ')"
          data-testid="lic-ato-faltam"
        />
        <SanteBotao
          tipo="submit"
          :rotulo="k('registrar')"
          :desabilitado="!pode || enviando"
          data-testid="lic-ato-registrar"
        />
      </template>
    </form>
  </section>
</template>
