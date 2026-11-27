<script setup lang="ts">
// Apresentação TISS por fonte pagadora (06-FAT linha 30): `/faturamento/apresentacao-tiss`.
// Uma tela por fonte pagadora, em três blocos na mesma página: a regra (geral ou por tipo de conta), o que vai em cada
// guia (itens da regra escolhida) e os valores padrão de campo. Validação na hora, pelas mesmas regras do servidor (o
// valor padrão é conferido no domínio TISS antes de enviar); nada se apaga: o item é desativado e o valor padrão
// encerrado, e os dois continuam visíveis no histórico. Formulários só com convenio.contrato.editar.
import { CAMPOS_PADRAO_TISS, validarValorPadraoCampo } from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { listarConvenios } from '../../precos/api-precos.js';
import {
  type ItemApresentacaoTela,
  type NovaRegraApresentacao,
  type PadraoApresentacaoTela,
  type RegraApresentacaoTela,
  desativarItemApresentacao,
  encerrarPadraoCampo,
  gravarRegraApresentacao,
  incluirItemApresentacao,
  incluirPadraoCampo,
  lerApresentacaoTiss,
  lerOpcoesApresentacaoTiss,
} from '../api-apresentacao-tiss.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';

const { t } = useI18n();
const qc = useQueryClient();
const hoje = new Date().toISOString().slice(0, 10);
const podeEditar = computed(() => pode('convenio.contrato.editar'));
const num = (s: string): number | null => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
const chave = (r: string) => `apresentacao-tiss.${r}.${crypto.randomUUID()}`;

const convenios = useQuery({
  queryKey: ['convenios', '', 'todos'],
  queryFn: () => listarConvenios('', 'todos'),
});
const opcoesConvenio = computed(() =>
  (convenios.data.value?.itens ?? []).map((c) => ({
    valor: String(c.codigo),
    rotulo: `${c.codigo} — ${c.nome}`,
  })),
);
const convenio = ref('');
const fonte = computed(() => num(convenio.value));

const opcoes = useQuery({
  queryKey: ['faturamento', 'apresentacao-tiss', 'opcoes'],
  queryFn: lerOpcoesApresentacaoTiss,
});
const combo = (lista: readonly { id: number; rotulo: string }[] | undefined, vazio?: string) => [
  ...(vazio !== undefined ? [{ valor: '', rotulo: vazio }] : []),
  ...(lista ?? []).map((o) => ({ valor: String(o.id), rotulo: o.rotulo })),
];
const rotuloDe = (lista: readonly { id: number; rotulo: string }[] | undefined, id: number | null) =>
  id === null ? null : ((lista ?? []).find((o) => o.id === id)?.rotulo ?? String(id));

const chaveDados = computed(() => ['faturamento', 'apresentacao-tiss', fonte.value]);
const dados = useQuery({
  queryKey: chaveDados,
  queryFn: () => lerApresentacaoTiss(fonte.value as number),
  enabled: computed(() => fonte.value !== null),
});
const regras = computed(() => dados.data.value?.regras ?? []);
const regraEscolhida = ref<number | null>(null);
const itensDaRegra = computed(() =>
  (dados.data.value?.itens ?? []).filter((i) => i.regraId === regraEscolhida.value),
);
const padroes = computed(() => dados.data.value?.padroes ?? []);

const erro = ref<unknown>(null);
const aviso = ref('');
async function rodar(fn: () => Promise<unknown>, ok: string) {
  erro.value = null;
  aviso.value = '';
  try {
    await fn();
    aviso.value = ok;
    await qc.invalidateQueries({ queryKey: chaveDados.value });
  } catch (e) {
    erro.value = e;
  }
}

// ── Regra ──────────────────────────────────────────────────────────────────────────────────────────
const regraVazia = () => ({
  id: null as number | null,
  versao: null as number | null,
  tipoConta: '',
  versaoTiss: '',
  registroAns: '',
  codigoContratado: '',
  limiteGuias: '',
  ordenacao: 'numero_guia' as NovaRegraApresentacao['ordenacaoGuias'],
  usaGuiaConsulta: true,
  agrupaItens: false,
  omiteGuiaSemValor: false,
  eletronico: true,
  identificacao: 'codigo' as NovaRegraApresentacao['identificacaoContratado'],
  documento: '',
  numeracao: 'hospital' as NovaRegraApresentacao['numeracaoGuia'],
  prefixo: '',
  largura: '8',
  proximo: '',
  quebra: 'nao_quebra' as NovaRegraApresentacao['quebraResumoInternacao'],
  diasCorte: '',
  spSadt: 'por_atendimento' as NovaRegraApresentacao['geracaoSpSadt'],
  ativa: true,
});
// Regras do montador conferidas na hora (o dígito do CNPJ e do CPF é conferido de novo no servidor).
const errosMontador = computed(() => {
  const e: Record<string, string> = {};
  const doc = fr.documento.replace(/\D/g, '');
  if (fr.identificacao === 'cnpj' && doc.length !== 14) e['documento'] = t('apresentacaoTiss.regra.erroCnpj');
  if (fr.identificacao === 'cpf' && doc.length !== 11) e['documento'] = t('apresentacaoTiss.regra.erroCpf');
  if (fr.quebra === 'por_periodo' && !/^\d{1,3}$/.test(fr.diasCorte))
    e['diasCorte'] = t('apresentacaoTiss.regra.erroDiasCorte');
  if (fr.proximo && fr.prefixo.trim().length + (Number(fr.largura) || 0) > 20)
    e['prefixo'] = t('apresentacaoTiss.regra.erroSerie');
  return e;
});
const fr = reactive(regraVazia());
const editandoRegra = ref(false);
watch(fonte, () => {
  Object.assign(fr, regraVazia());
  editandoRegra.value = false;
  regraEscolhida.value = null;
});
watch(regras, (rs) => {
  if (regraEscolhida.value === null || !rs.some((r) => r.id === regraEscolhida.value))
    regraEscolhida.value = rs[0]?.id ?? null;
});

function novaRegra() {
  Object.assign(fr, regraVazia());
  fr.versaoTiss = String(opcoes.data.value?.versoesTiss[0]?.id ?? '');
  editandoRegra.value = true;
}
function editarRegra(r: RegraApresentacaoTela) {
  Object.assign(fr, {
    id: r.id,
    versao: r.versao,
    tipoConta: r.tipoContaId === null ? '' : String(r.tipoContaId),
    versaoTiss: String(r.versaoPadraoTissId),
    registroAns: r.registroAns ?? '',
    codigoContratado: r.codigoContratadoOperadora ?? '',
    limiteGuias: r.limiteGuiasLote === null ? '' : String(r.limiteGuiasLote),
    ordenacao: r.ordenacaoGuias,
    usaGuiaConsulta: r.usaGuiaConsulta,
    agrupaItens: r.agrupaItens,
    omiteGuiaSemValor: r.omiteGuiaSemValor,
    eletronico: r.usaFaturamentoEletronico,
    identificacao: r.identificacaoContratado,
    documento: (r.identificacaoContratado === 'cpf' ? r.cpfContratado : r.cnpjContratado) ?? '',
    numeracao: r.numeracaoGuia,
    prefixo: r.prefixoNumeroGuia ?? '',
    largura: String(r.larguraNumeroGuia),
    proximo: r.proximoNumeroGuia === null ? '' : String(r.proximoNumeroGuia),
    quebra: r.quebraResumoInternacao,
    diasCorte: r.diasCorteResumo === null ? '' : String(r.diasCorteResumo),
    spSadt: r.geracaoSpSadt,
    ativa: r.ativo,
  });
  regraEscolhida.value = r.id;
  editandoRegra.value = true;
}

const errosRegra = computed(() => {
  const e: Record<string, string> = {};
  if (num(fr.versaoTiss) === null) e['versao'] = t('apresentacaoTiss.regra.erroVersao');
  if (fr.registroAns.trim() && !/^\d{6}$/.test(fr.registroAns.trim()))
    e['ans'] = t('apresentacaoTiss.regra.erroAns');
  const lim = num(fr.limiteGuias);
  if (fr.limiteGuias.trim() && (lim === null || !Number.isInteger(lim) || lim < 1 || lim > 9999))
    e['limite'] = t('apresentacaoTiss.regra.erroLimite');
  const tipo = num(fr.tipoConta);
  if (fr.id === null && regras.value.some((r) => r.tipoContaId === tipo))
    e['tipo'] = t('apresentacaoTiss.regra.repetida');
  return e;
});

function gravarRegra() {
  if (fonte.value === null || Object.keys(errosRegra.value).length || Object.keys(errosMontador.value).length)
    return;
  const corpo: NovaRegraApresentacao = {
    ...(fr.id !== null && fr.versao !== null ? { id: fr.id, versao: fr.versao } : {}),
    fontePagadoraId: fonte.value,
    tipoContaId: num(fr.tipoConta),
    versaoPadraoTissId: num(fr.versaoTiss) as number,
    registroAns: fr.registroAns.trim() || null,
    codigoContratadoOperadora: fr.codigoContratado.trim() || null,
    limiteGuiasLote: num(fr.limiteGuias),
    ordenacaoGuias: fr.ordenacao,
    usaGuiaConsulta: fr.usaGuiaConsulta,
    agrupaItens: fr.agrupaItens,
    omiteGuiaSemValor: fr.omiteGuiaSemValor,
    usaFaturamentoEletronico: fr.eletronico,
    identificacaoContratado: fr.identificacao,
    documentoContratado: fr.identificacao === 'codigo' ? null : fr.documento.trim() || null,
    numeracaoGuia: fr.numeracao,
    prefixoNumeroGuia: fr.prefixo.trim() || null,
    larguraNumeroGuia: Number(fr.largura) || 8,
    proximoNumeroGuia: num(fr.proximo),
    quebraResumoInternacao: fr.quebra,
    diasCorteResumo: fr.quebra === 'por_periodo' ? num(fr.diasCorte) : null,
    geracaoSpSadt: fr.spSadt,
    ativo: fr.ativa,
  };
  void rodar(async () => {
    const r = await gravarRegraApresentacao(corpo, chave('regra'));
    regraEscolhida.value = r.id;
    editandoRegra.value = false;
  }, t('apresentacaoTiss.regra.gravada'));
}

// ── Itens da regra ─────────────────────────────────────────────────────────────────────────────────
const itemVazio = () => ({
  grupo: '',
  item: '',
  funcao: '',
  tipoGuia: '',
  codigo: '',
  descricao: '',
  agrupa: false,
  agrupamentoData: '',
  naoExporta: false,
});
const fi = reactive(itemVazio());
const GUIAS = ['consulta', 'sp_sadt', 'resumo_internacao', 'honorario', 'outras_despesas'] as const;
const opcoesGuia = computed(() => [
  { valor: '', rotulo: t('apresentacaoTiss.item.qualquerGuia') },
  ...GUIAS.map((g) => ({ valor: g, rotulo: t(`apresentacaoTiss.item.guias.${g}`) })),
]);
const opcoesData = computed(() => [
  { valor: '', rotulo: t('apresentacaoTiss.item.semData') },
  ...(['por_dia', 'primeira_data', 'ultima_data'] as const).map((d) => ({
    valor: d,
    rotulo: t(`apresentacaoTiss.item.datas.${d}`),
  })),
]);
/** As mesmas três regras do servidor, na hora. */
const errosItem = computed(() => {
  const e: string[] = [];
  if (num(fi.grupo) === null && num(fi.item) === null && num(fi.funcao) === null)
    e.push(t('apresentacaoTiss.item.erroAlvo'));
  if (fi.naoExporta && (fi.codigo.trim() || fi.agrupa)) e.push(t('apresentacaoTiss.item.erroForaArquivo'));
  if (fi.agrupamentoData && !fi.agrupa) e.push(t('apresentacaoTiss.item.erroData'));
  return e;
});
function incluirItem() {
  if (regraEscolhida.value === null || errosItem.value.length) return;
  const corpo = {
    regraId: regraEscolhida.value,
    grupoFaturamentoId: num(fi.grupo),
    itemFaturavelId: num(fi.item),
    funcaoEquipeCobrancaId: num(fi.funcao),
    setorFuncionalId: null,
    profissionalId: null,
    tipoGuia: fi.tipoGuia || null,
    codigoApresentacao: fi.codigo.trim() || null,
    descricaoApresentacao: fi.descricao.trim() || null,
    agrupa: fi.agrupa,
    agrupamentoData: fi.agrupamentoData || null,
    naoExporta: fi.naoExporta,
  };
  void rodar(async () => {
    await incluirItemApresentacao(corpo, chave('item'));
    Object.assign(fi, itemVazio());
  }, t('apresentacaoTiss.item.incluido'));
}
function desativarItem(i: ItemApresentacaoTela) {
  void rodar(
    () => desativarItemApresentacao(i.id, i.versao, chave('item-desativar')),
    t('apresentacaoTiss.item.desativado'),
  );
}
function alvoDoItem(i: ItemApresentacaoTela): string {
  const o = opcoes.data.value;
  return [
    rotuloDe(o?.grupos, i.grupoId),
    i.itemId !== null ? `${t('apresentacaoTiss.item.itemId')} ${i.itemId}` : null,
    rotuloDe(o?.funcoes, i.funcaoId),
  ]
    .filter((x) => x !== null)
    .join(' · ');
}

// ── Valores padrão ─────────────────────────────────────────────────────────────────────────────────
const padraoVazio = () => ({
  campo: '',
  valor: '',
  regime: '',
  origem: '',
  daRegra: false,
  sobrepoe: false,
  todosEstabelecimentos: false,
  inicio: hoje,
  fim: '',
});
const fp = reactive(padraoVazio());
const opcoesCampo = computed(() =>
  Object.entries(CAMPOS_PADRAO_TISS).map(([c, d]) => ({ valor: c, rotulo: d.nome })),
);
const nomeCampo = (c: string) => (CAMPOS_PADRAO_TISS as Record<string, { nome: string }>)[c]?.nome ?? c;
/** Conferido no domínio TISS (o mesmo validador do servidor), campo a campo. */
const errosPadrao = computed(() =>
  fp.campo || fp.valor
    ? validarValorPadraoCampo({
        campo: fp.campo,
        valor: fp.valor,
        vigenciaInicio: fp.inicio,
        vigenciaFim: fp.fim || null,
      })
    : { campo: '' },
);
function incluirPadrao() {
  if (fonte.value === null || Object.keys(errosPadrao.value).length) return;
  const corpo = {
    fontePagadoraId: fonte.value,
    estabelecimentoProprio: !fp.todosEstabelecimentos,
    regraId: fp.daRegra ? regraEscolhida.value : null,
    campo: fp.campo,
    valor: fp.valor.trim(),
    regimeAtendimentoId: num(fp.regime),
    origemEntradaAtendimentoId: num(fp.origem),
    itemFaturavelId: null,
    sobrepoe: fp.sobrepoe,
    vigenciaInicio: fp.inicio,
    vigenciaFim: fp.fim || null,
  };
  void rodar(async () => {
    await incluirPadraoCampo(corpo, chave('padrao'));
    Object.assign(fp, padraoVazio());
  }, t('apresentacaoTiss.padrao.incluido'));
}
const vigente = (p: PadraoApresentacaoTela) => p.ativo && (p.vigenciaFim === null || p.vigenciaFim >= hoje);
function encerrarPadrao(p: PadraoApresentacaoTela) {
  const fim = hoje < p.vigenciaInicio ? p.vigenciaInicio : hoje;
  void rodar(
    () => encerrarPadraoCampo(p.id, p.versao, fim, chave('padrao-encerrar')),
    t('apresentacaoTiss.padrao.encerrado'),
  );
}
</script>

<template>
  <section class="tela" aria-labelledby="apt-titulo" data-testid="apresentacao-tiss">
    <h1 id="apt-titulo">{{ t('apresentacaoTiss.titulo') }}</h1>
    <p class="secundario">{{ t('apresentacaoTiss.explicacao') }}</p>
    <div class="campo largo">
      <SanteSelecao
        id="apt-convenio"
        v-model="convenio"
        :rotulo="t('apresentacaoTiss.convenio')"
        :opcoes="opcoesConvenio"
        data-testid="apt-convenio"
      />
    </div>
    <ErroFaturamento v-if="dados.error.value" :erro="dados.error.value" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="apt-aviso">{{ aviso }}</p>
    <p v-if="fonte === null" class="secundario" data-testid="apt-escolha">
      {{ t('apresentacaoTiss.escolhaConvenio') }}
    </p>

    <template v-if="fonte !== null && dados.data.value">
      <!-- Regras -->
      <h2>{{ t('apresentacaoTiss.regras', { n: regras.length }) }}</h2>
      <p v-if="!regras.length" class="secundario" data-testid="apt-sem-regra">
        {{ t('apresentacaoTiss.semRegra') }}
      </p>
      <ul class="lista-regras">
        <li v-for="r in regras" :key="r.id" :data-testid="`apt-regra-${r.id}`">
          <label>
            <input v-model="regraEscolhida" type="radio" name="apt-regra" :value="r.id" />
            {{
              r.tipoContaId === null
                ? t('apresentacaoTiss.geral')
                : rotuloDe(opcoes.data.value?.tiposConta, r.tipoContaId)
            }}
          </label>
          · {{ t(`apresentacaoTiss.regra.ordens.${r.ordenacaoGuias}`) }}
          <span v-if="r.limiteGuiasLote !== null"
            >· {{ t('apresentacaoTiss.regra.limiteGuias') }}: {{ r.limiteGuiasLote }}</span
          >
          <span v-if="r.codigoContratadoOperadora">· {{ r.codigoContratadoOperadora }}</span>
          <span v-if="!r.ativo">· {{ t('apresentacaoTiss.inativa') }}</span>
          <button v-if="podeEditar" type="button" :data-testid="`apt-editar-${r.id}`" @click="editarRegra(r)">
            {{ t('apresentacaoTiss.editar') }}
          </button>
        </li>
      </ul>
      <button
        v-if="podeEditar && !editandoRegra"
        type="button"
        data-testid="apt-nova-regra"
        @click="novaRegra"
      >
        {{ t('apresentacaoTiss.novaRegra') }}
      </button>
      <form
        v-if="podeEditar && editandoRegra"
        class="filtros"
        data-testid="apt-form-regra"
        @submit.prevent="gravarRegra"
      >
        <SanteSelecao
          id="apt-tipo-conta"
          v-model="fr.tipoConta"
          :rotulo="t('apresentacaoTiss.regra.tipoConta')"
          :opcoes="combo(opcoes.data.value?.tiposConta, t('apresentacaoTiss.regra.todosTipos'))"
          :desabilitado="fr.id !== null"
          data-testid="apt-tipo-conta"
        />
        <SanteSelecao
          id="apt-versao-tiss"
          v-model="fr.versaoTiss"
          :rotulo="t('apresentacaoTiss.regra.versaoTiss')"
          :opcoes="combo(opcoes.data.value?.versoesTiss)"
          obrigatorio
          data-testid="apt-versao-tiss"
        />
        <label>
          {{ t('apresentacaoTiss.regra.registroAns') }}
          <input v-model="fr.registroAns" inputmode="numeric" maxlength="6" data-testid="apt-ans" />
        </label>
        <label>
          {{ t('apresentacaoTiss.regra.codigoContratado') }}
          <input v-model="fr.codigoContratado" maxlength="20" data-testid="apt-contratado" />
        </label>
        <label>
          {{ t('apresentacaoTiss.regra.limiteGuias') }}
          <input v-model="fr.limiteGuias" inputmode="numeric" maxlength="4" data-testid="apt-limite" />
        </label>
        <SanteSelecao
          id="apt-ordenacao"
          v-model="fr.ordenacao"
          :rotulo="t('apresentacaoTiss.regra.ordenacao')"
          :opcoes="
            (['numero_guia', 'paciente', 'data_atendimento'] as const).map((o) => ({
              valor: o,
              rotulo: t(`apresentacaoTiss.regra.ordens.${o}`),
            }))
          "
          data-testid="apt-ordenacao"
        />
        <label
          ><input v-model="fr.usaGuiaConsulta" type="checkbox" />
          {{ t('apresentacaoTiss.regra.usaGuiaConsulta') }}</label
        >
        <label
          ><input v-model="fr.agrupaItens" type="checkbox" />
          {{ t('apresentacaoTiss.regra.agrupaItens') }}</label
        >
        <label>
          <input v-model="fr.omiteGuiaSemValor" type="checkbox" data-testid="apt-omite" />
          {{ t('apresentacaoTiss.regra.omiteGuiaSemValor') }}
        </label>
        <label
          ><input v-model="fr.eletronico" type="checkbox" />
          {{ t('apresentacaoTiss.regra.eletronico') }}</label
        >
        <SanteSelecao
          id="apt-identificacao"
          v-model="fr.identificacao"
          :rotulo="t('apresentacaoTiss.regra.identificacao')"
          :opcoes="
            (['codigo', 'cnpj', 'cpf'] as const).map((o) => ({
              valor: o,
              rotulo: t(`apresentacaoTiss.regra.identificacoes.${o}`),
            }))
          "
          data-testid="apt-identificacao"
        />
        <label v-if="fr.identificacao !== 'codigo'"
          >{{ t('apresentacaoTiss.regra.documento') }}
          <input v-model="fr.documento" inputmode="numeric" maxlength="18" data-testid="apt-documento" />
          <small v-if="errosMontador['documento']" role="alert" data-testid="apt-erro-documento">{{
            errosMontador['documento']
          }}</small>
        </label>
        <SanteSelecao
          id="apt-numeracao"
          v-model="fr.numeracao"
          :rotulo="t('apresentacaoTiss.regra.numeracao')"
          :opcoes="
            (['hospital', 'operadora', 'sequencial_lote'] as const).map((o) => ({
              valor: o,
              rotulo: t(`apresentacaoTiss.regra.numeracoes.${o}`),
            }))
          "
          data-testid="apt-numeracao"
        />
        <template v-if="fr.numeracao === 'hospital'">
          <label
            >{{ t('apresentacaoTiss.regra.prefixo') }}
            <input v-model="fr.prefixo" maxlength="10" data-testid="apt-prefixo" />
            <small v-if="errosMontador['prefixo']" role="alert">{{ errosMontador['prefixo'] }}</small>
          </label>
          <label
            >{{ t('apresentacaoTiss.regra.largura') }}
            <input v-model="fr.largura" inputmode="numeric" maxlength="2" data-testid="apt-largura" />
          </label>
          <label
            >{{ t('apresentacaoTiss.regra.proximo') }}
            <input v-model="fr.proximo" inputmode="numeric" maxlength="12" data-testid="apt-proximo" />
          </label>
        </template>
        <SanteSelecao
          id="apt-quebra"
          v-model="fr.quebra"
          :rotulo="t('apresentacaoTiss.regra.quebra')"
          :opcoes="
            (['nao_quebra', 'por_periodo', 'por_prestador', 'por_limite_itens'] as const).map((o) => ({
              valor: o,
              rotulo: t(`apresentacaoTiss.regra.quebras.${o}`),
            }))
          "
          data-testid="apt-quebra"
        />
        <label v-if="fr.quebra === 'por_periodo'"
          >{{ t('apresentacaoTiss.regra.diasCorte') }}
          <input v-model="fr.diasCorte" inputmode="numeric" maxlength="3" data-testid="apt-dias-corte" />
          <small v-if="errosMontador['diasCorte']" role="alert">{{ errosMontador['diasCorte'] }}</small>
        </label>
        <SanteSelecao
          id="apt-sp-sadt"
          v-model="fr.spSadt"
          :rotulo="t('apresentacaoTiss.regra.spSadt')"
          :opcoes="
            (['por_atendimento', 'por_prestador', 'por_procedimento', 'por_data'] as const).map((o) => ({
              valor: o,
              rotulo: t(`apresentacaoTiss.regra.spSadts.${o}`),
            }))
          "
          data-testid="apt-sp-sadt"
        />
        <label><input v-model="fr.ativa" type="checkbox" /> {{ t('apresentacaoTiss.regra.ativa') }}</label>
        <div v-if="Object.keys(errosRegra).length" role="alert" data-testid="apt-erros-regra">
          <ul>
            <li v-for="(m, k) in errosRegra" :key="k">{{ m }}</li>
          </ul>
        </div>
        <button
          type="submit"
          :disabled="Object.keys(errosRegra).length + Object.keys(errosMontador).length > 0"
          data-testid="apt-gravar-regra"
        >
          {{ t('apresentacaoTiss.regra.gravar') }}
        </button>
      </form>

      <!-- Itens -->
      <h2>{{ t('apresentacaoTiss.itens', { n: itensDaRegra.length }) }}</h2>
      <p v-if="regraEscolhida === null" class="secundario">{{ t('apresentacaoTiss.item.escolhaRegra') }}</p>
      <template v-else>
        <p v-if="!itensDaRegra.length" class="secundario" data-testid="apt-sem-itens">
          {{ t('apresentacaoTiss.semItens') }}
        </p>
        <table v-else data-testid="apt-itens">
          <thead>
            <tr>
              <th scope="col">{{ t('apresentacaoTiss.item.alvo') }}</th>
              <th scope="col">{{ t('apresentacaoTiss.item.tipoGuia') }}</th>
              <th scope="col">{{ t('apresentacaoTiss.item.codigo') }}</th>
              <th scope="col">{{ t('apresentacaoTiss.item.agrupa') }}</th>
              <th scope="col">
                <span class="sr-only">{{ t('apresentacaoTiss.item.desativar') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in itensDaRegra" :key="i.id" :data-testid="`apt-item-${i.id}`">
              <td>{{ alvoDoItem(i) }}</td>
              <td>
                {{
                  i.tipoGuia
                    ? t(`apresentacaoTiss.item.guias.${i.tipoGuia}`)
                    : t('apresentacaoTiss.item.qualquerGuia')
                }}
              </td>
              <td>
                <template v-if="i.naoExporta">{{ t('apresentacaoTiss.item.naoExporta') }}</template>
                <template v-else
                  >{{ i.codigoApresentacao ?? '—' }} {{ i.descricaoApresentacao ?? '' }}</template
                >
              </td>
              <td>
                {{ i.agrupa ? t(`apresentacaoTiss.item.datas.${i.agrupamentoData ?? 'por_dia'}`) : '—' }}
              </td>
              <td>
                <span v-if="!i.ativo">{{ t('apresentacaoTiss.item.inativo') }}</span>
                <button
                  v-else-if="podeEditar"
                  type="button"
                  :data-testid="`apt-desativar-${i.id}`"
                  @click="desativarItem(i)"
                >
                  {{ t('apresentacaoTiss.item.desativar') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <form v-if="podeEditar" class="filtros" data-testid="apt-form-item" @submit.prevent="incluirItem">
          <SanteSelecao
            id="apt-item-grupo"
            v-model="fi.grupo"
            :rotulo="t('apresentacaoTiss.item.grupo')"
            :opcoes="combo(opcoes.data.value?.grupos, '—')"
            data-testid="apt-item-grupo"
          />
          <label>
            {{ t('apresentacaoTiss.item.itemId') }}
            <input v-model="fi.item" inputmode="numeric" data-testid="apt-item-id" />
          </label>
          <SanteSelecao
            id="apt-item-funcao"
            v-model="fi.funcao"
            :rotulo="t('apresentacaoTiss.item.funcao')"
            :opcoes="combo(opcoes.data.value?.funcoes, '—')"
            data-testid="apt-item-funcao"
          />
          <SanteSelecao
            id="apt-item-guia"
            v-model="fi.tipoGuia"
            :rotulo="t('apresentacaoTiss.item.tipoGuia')"
            :opcoes="opcoesGuia"
            data-testid="apt-item-guia"
          />
          <label>
            {{ t('apresentacaoTiss.item.codigo') }}
            <input v-model="fi.codigo" maxlength="20" data-testid="apt-item-codigo" />
          </label>
          <label>
            {{ t('apresentacaoTiss.item.descricao') }}
            <input v-model="fi.descricao" maxlength="150" data-testid="apt-item-descricao" />
          </label>
          <label
            ><input v-model="fi.agrupa" type="checkbox" data-testid="apt-item-agrupa" />
            {{ t('apresentacaoTiss.item.agrupa') }}</label
          >
          <SanteSelecao
            id="apt-item-data"
            v-model="fi.agrupamentoData"
            :rotulo="t('apresentacaoTiss.item.agrupamentoData')"
            :opcoes="opcoesData"
            data-testid="apt-item-data"
          />
          <label>
            <input v-model="fi.naoExporta" type="checkbox" data-testid="apt-item-fora" />
            {{ t('apresentacaoTiss.item.naoExporta') }}
          </label>
          <div v-if="errosItem.length" role="alert" data-testid="apt-erros-item">
            <ul>
              <li v-for="m in errosItem" :key="m">{{ m }}</li>
            </ul>
          </div>
          <button type="submit" :disabled="errosItem.length > 0" data-testid="apt-incluir-item">
            {{ t('apresentacaoTiss.item.incluir') }}
          </button>
        </form>
      </template>

      <!-- Valores padrão -->
      <h2>{{ t('apresentacaoTiss.padroes', { n: padroes.length }) }}</h2>
      <p v-if="!padroes.length" class="secundario" data-testid="apt-sem-padroes">
        {{ t('apresentacaoTiss.semPadroes') }}
      </p>
      <ul v-else data-testid="apt-padroes">
        <li v-for="p in padroes" :key="p.id" :data-testid="`apt-padrao-${p.id}`">
          {{ nomeCampo(p.campo) }} = {{ p.valor }}
          <span v-if="p.sobrepoe">· {{ t('apresentacaoTiss.padrao.sobrepoe') }}</span>
          <span v-if="p.estabelecimentoId === null"
            >· {{ t('apresentacaoTiss.padrao.todosEstabelecimentos') }}</span
          >
          <span v-if="p.regraId !== null">· {{ t('apresentacaoTiss.padrao.daRegra') }}</span>
          · {{ p.vigenciaInicio }}
          <span v-if="p.vigenciaFim">{{ t('apresentacaoTiss.padrao.ate', { data: p.vigenciaFim }) }}</span>
          <template v-if="vigente(p)">
            · {{ t('apresentacaoTiss.padrao.vigente') }}
            <button
              v-if="podeEditar"
              type="button"
              :data-testid="`apt-encerrar-${p.id}`"
              @click="encerrarPadrao(p)"
            >
              {{ t('apresentacaoTiss.padrao.encerrar') }}
            </button>
          </template>
        </li>
      </ul>
      <form v-if="podeEditar" class="filtros" data-testid="apt-form-padrao" @submit.prevent="incluirPadrao">
        <SanteSelecao
          id="apt-padrao-campo"
          v-model="fp.campo"
          :rotulo="t('apresentacaoTiss.padrao.campo')"
          :opcoes="opcoesCampo"
          obrigatorio
          data-testid="apt-padrao-campo"
        />
        <label>
          {{ t('apresentacaoTiss.padrao.valor') }}
          <input v-model="fp.valor" maxlength="200" data-testid="apt-padrao-valor" />
        </label>
        <SanteSelecao
          id="apt-padrao-regime"
          v-model="fp.regime"
          :rotulo="t('apresentacaoTiss.padrao.regime')"
          :opcoes="combo(opcoes.data.value?.regimes, t('apresentacaoTiss.padrao.todos'))"
          data-testid="apt-padrao-regime"
        />
        <SanteSelecao
          id="apt-padrao-origem"
          v-model="fp.origem"
          :rotulo="t('apresentacaoTiss.padrao.origem')"
          :opcoes="combo(opcoes.data.value?.origens, t('apresentacaoTiss.padrao.todos'))"
          data-testid="apt-padrao-origem"
        />
        <label>
          {{ t('apresentacaoTiss.padrao.inicio') }}
          <input v-model="fp.inicio" type="date" data-testid="apt-padrao-inicio" />
        </label>
        <label>
          {{ t('apresentacaoTiss.padrao.fim') }}
          <input v-model="fp.fim" type="date" data-testid="apt-padrao-fim" />
        </label>
        <label
          ><input v-model="fp.sobrepoe" type="checkbox" /> {{ t('apresentacaoTiss.padrao.sobrepoe') }}</label
        >
        <label v-if="regraEscolhida !== null">
          <input v-model="fp.daRegra" type="checkbox" /> {{ t('apresentacaoTiss.padrao.daRegra') }}
        </label>
        <label>
          <input v-model="fp.todosEstabelecimentos" type="checkbox" />
          {{ t('apresentacaoTiss.padrao.todosEstabelecimentos') }}
        </label>
        <div v-if="Object.values(errosPadrao).some((m) => m)" role="alert" data-testid="apt-erros-padrao">
          <ul>
            <li v-for="(m, k) in errosPadrao" :key="k">{{ m }}</li>
          </ul>
        </div>
        <button
          type="submit"
          :disabled="Object.keys(errosPadrao).length > 0"
          data-testid="apt-incluir-padrao"
        >
          {{ t('apresentacaoTiss.padrao.incluir') }}
        </button>
      </form>
    </template>
  </section>
</template>
