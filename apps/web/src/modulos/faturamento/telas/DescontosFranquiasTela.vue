<script setup lang="ts">
// Desconto comercial por volume e franquia do contrato (F8, 06-FAT linha 19): `/faturamento/descontos-franquias`
// (`?conta=` abre o painel da conta). Três abas:
//   - desconto por volume: faixas por convênio, base (valor da fatura, da competência ou quantidade de contas) e alvo
//     (grupo), conferidas enquanto se digita pelas mesmas regras do domínio (faixa sobreposta trava o salvar);
//   - franquia do contrato: valor, pontos ou percentual, vínculos do beneficiário, idade e exceções por grupo;
//   - na conta: valores da conta (total cobrado do convênio e parte do paciente), a prévia de cada franquia com o motivo
//     de não valer, o desconto pelo volume medido, a simulação de outro vínculo (só leitura) e a aplicação num clique.
// A aplicação usa o vínculo da carteira do cadastro; a franquia vai ao paciente e sai do total do convênio, e o desconto
// sai do total (e da guia TISS pelo fator de redução). Nada se apaga: a faixa retirada e o abatimento substituído
// ficam no histórico.
import {
  BASES_VOLUME,
  validarFaixasDesconto,
  validarFranquia,
  VINCULOS_BENEFICIARIO,
} from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { novaChave } from '../api-faturamento.js';
import {
  aplicarFranquiaDesconto,
  type ComercialConta,
  lerComercialConta,
  lerRegrasComerciais,
  type RegrasComerciais,
  salvarDescontoVolume,
  salvarFranquia,
} from '../api-regras-comerciais.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Descontos por volume e franquias',
      explica:
        'O desconto por volume reduz o total cobrado do convênio (e a guia TISS); a franquia é a parte do paciente e sai do total do convênio.',
      abaDesconto: 'Desconto por volume',
      abaFranquia: 'Franquia do contrato',
      abaConta: 'Na conta',
      convenio: 'Convênio',
      contrato: 'Contrato',
      descricao: 'Descrição',
      base: 'Medir o volume por',
      base_valor_fatura: 'Valor da fatura da conta',
      base_valor_competencia: 'Valor da competência do convênio',
      base_quantidade_contas: 'Quantidade de contas na competência',
      inicio: 'Vale a partir de',
      fim: 'Vale até (opcional)',
      ativa: 'Ativa',
      sim: 'Sim',
      nao: 'Não',
      faixas: 'Faixas (o fim da faixa não entra nela; vazio = sem limite)',
      de: 'De',
      ate: 'Até',
      tipoDesconto: 'Desconto em',
      tipo_percentual: 'Percentual',
      tipo_valor: 'Valor fixo',
      percentual: 'Percentual (%)',
      valor: 'Valor (R$)',
      grupo: 'Grupo de faturamento',
      qualquer: 'Qualquer',
      novaFaixa: 'Acrescentar faixa',
      retirar: 'Retirar',
      salvar: 'Salvar',
      nova: 'Novo cadastro',
      editar: 'Editar',
      semDescontos: 'Nenhum desconto por volume cadastrado.',
      semFranquias: 'Nenhuma franquia cadastrada nos contratos.',
      faltaConvenio: 'Escolha o convênio.',
      faltaDescricao: 'Informe a descrição.',
      faltaContrato: 'Escolha o contrato.',
      tipoFranquia: 'Franquia por',
      franquia_valor: 'Valor fixo por conta',
      franquia_quantidade: 'Pontos (quantidade × valor do ponto)',
      franquia_percentual: 'Percentual de participação',
      valorFranquia: 'Valor da franquia (R$)',
      quantidadePontos: 'Quantidade de pontos',
      valorPonto: 'Valor do ponto (R$)',
      percentualParticipacao: 'Participação (%)',
      valorParticipacao: 'Teto da participação (R$, opcional)',
      vinculos: 'Vale para',
      titular: 'Titular',
      dependente: 'Dependente',
      pensionista: 'Pensionista',
      idadeMinima: 'Idade mínima',
      idadeMaxima: 'Idade máxima',
      excecoes: 'Exceções (a franquia não incide sobre o grupo)',
      novaExcecao: 'Acrescentar exceção',
      excecoesQtd: '{n} exceção(ões)',
      gravado: 'Cadastro gravado.',
      conta: 'Número interno da conta',
      abrir: 'Abrir a conta',
      simular: 'Simular o vínculo (só a prévia)',
      doCadastro: 'O da carteira do cadastro',
      vinculoAtual: 'Vínculo: {v} ({o})',
      origem_cadastro: 'carteira do cadastro',
      origem_simulacao: 'simulação, não grava',
      semVinculo:
        'A carteira do paciente neste convênio não tem a titularidade: informe-a na cobertura do paciente.',
      itens: 'Itens',
      descontoConta: 'Desconto na conta',
      parteDoPaciente: 'Parte do paciente (franquia)',
      totalFonte: 'Total cobrado do convênio',
      previa: 'Prévia',
      valeValor: 'vale {v} sobre {b}',
      descontoVolume: 'Desconto por volume "{d}": volume {vol}, desconto {v}',
      semDesconto: 'Nenhum desconto por volume vale para esta conta.',
      aplicar: 'Aplicar franquia e desconto',
      aplicado: 'Aplicado: franquia {f}, desconto {d}. Total do convênio {t}.',
      historico: 'Aplicados nesta conta',
      vigente: 'vigente',
      substituido: 'substituído',
      tipoAplicado_franquia: 'Franquia',
      tipoAplicado_desconto_volume: 'Desconto por volume',
      tipoAplicado_desconto_geral: 'Desconto geral',
      motivo_sem_vinculo_no_cadastro: 'sem titularidade na carteira',
      motivo_vinculo_nao_coberto: 'vínculo não coberto',
      motivo_fora_da_idade: 'fora da faixa de idade',
      motivo_fora_da_vigencia: 'fora da vigência',
      motivo_inativa: 'inativa',
      motivo_regime_diferente: 'regime diferente',
      motivo_excecao: 'afastada por exceção',
    },
  },
});

const rota = useRoute();
const qc = useQueryClient();
const regras = useQuery({ queryKey: ['faturamento', 'regras-comerciais'], queryFn: lerRegrasComerciais });
const op = computed(() => regras.data.value?.opcoes);
type Opcao = { id: number; descricao: string };
const nomeDe = (lista: readonly Opcao[] | undefined, id: number | null | undefined) =>
  id === null || id === undefined ? '' : (lista?.find((o) => o.id === id)?.descricao ?? `#${id}`);
const opcoesDe = (lista: readonly Opcao[] | undefined, vazio: string) => [
  { valor: 0, rotulo: vazio },
  ...(lista ?? []).map((o) => ({ valor: o.id, rotulo: o.descricao })),
];
const reais = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const numN = (v: unknown) => (typeof v === 'number' ? v : null);
const ouNulo = (v: number) => (v > 0 ? v : null);
const textoNum = (v: string | number | null) =>
  v === null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;

const contaDoEndereco = Number(rota.query['conta']);
type Aba = 'desconto' | 'franquia' | 'conta';
const ABAS: Aba[] = ['desconto', 'franquia', 'conta'];
const aba = ref<Aba>(Number.isInteger(contaDoEndereco) && contaDoEndereco > 0 ? 'conta' : 'desconto');
const rotuloAba = (a: Aba) => t({ desconto: 'abaDesconto', franquia: 'abaFranquia', conta: 'abaConta' }[a]);

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('descontos-franquias');
async function gravar(fn: (k: string) => Promise<unknown>, depois: () => void) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    await fn(chave);
    mensagem.value = t('gravado');
    chave = novaChave('descontos-franquias');
    depois();
    await qc.invalidateQueries({ queryKey: ['faturamento', 'regras-comerciais'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

// ── Desconto por volume ────────────────────────────────────────────────────────────────────────────────
interface FaixaTela {
  sequencia: number;
  volumeInicial: number;
  volumeFinal: string | number | null;
  tipo: 'percentual' | 'valor';
  percentual: number | null;
  valor: number | null;
  grupoId: number;
}
const novaFaixa = (sequencia: number, inicio = 0): FaixaTela => ({
  sequencia,
  volumeInicial: inicio,
  volumeFinal: null,
  tipo: 'percentual',
  percentual: 0,
  valor: null,
  grupoId: 0,
});
const hoje = () => new Date().toISOString().slice(0, 10);
const descontoVazio = () => ({
  id: undefined as number | undefined,
  versao: undefined as number | undefined,
  fontePagadoraId: 0,
  descricao: '',
  baseVolume: 'valor_fatura' as (typeof BASES_VOLUME)[number],
  vigenciaInicio: hoje(),
  vigenciaFim: '',
  ativo: true,
  faixas: [novaFaixa(1)] as FaixaTela[],
});
const d = reactive(descontoVazio());
const novoDesconto = () => Object.assign(d, descontoVazio());
const faixasDominio = computed(() =>
  d.faixas.map((x) => ({
    sequencia: x.sequencia,
    volumeInicial: Number(x.volumeInicial) || 0,
    volumeFinal: textoNum(x.volumeFinal),
    tipo: x.tipo,
    percentual: x.tipo === 'percentual' ? x.percentual : null,
    valor: x.tipo === 'valor' ? x.valor : null,
    grupo: ouNulo(x.grupoId),
  })),
);
const errosDesconto = computed(() => {
  const e = { ...validarFaixasDesconto(faixasDominio.value) };
  if (!d.fontePagadoraId) e['fontePagadoraId'] = t('faltaConvenio');
  if (!d.descricao.trim()) e['descricao'] = t('faltaDescricao');
  if (d.vigenciaFim && d.vigenciaFim < d.vigenciaInicio)
    e['vigenciaFim'] = 'O fim da vigência é anterior ao início.';
  return Object.values(e);
});
function acrescentarFaixa() {
  const ultima = d.faixas[d.faixas.length - 1];
  const seq = Math.max(0, ...d.faixas.map((x) => x.sequencia)) + 1;
  d.faixas.push(novaFaixa(seq, textoNum(ultima?.volumeFinal ?? null) ?? 0));
}
type DescontoLido = RegrasComerciais['descontos'][number];
function editarDesconto(r: DescontoLido) {
  const x = r as DescontoLido & Record<string, unknown>;
  Object.assign(d, {
    id: r.id,
    versao: r.versao,
    fontePagadoraId: r.fontePagadoraId,
    descricao: r.descricao,
    baseVolume: r.baseVolume as (typeof BASES_VOLUME)[number],
    vigenciaInicio: typeof x['vigenciaInicio'] === 'string' ? x['vigenciaInicio'] : hoje(),
    vigenciaFim: typeof x['vigenciaFim'] === 'string' ? x['vigenciaFim'] : '',
    ativo: r.ativo,
    faixas: r.faixas.map((f) => ({
      sequencia: num(f['sequencia']),
      volumeInicial: num(f['volumeInicial']),
      volumeFinal: numN(f['volumeFinal']),
      tipo: f['tipo'] === 'valor' ? 'valor' : 'percentual',
      percentual: numN(f['percentual']),
      valor: numN(f['valor']),
      grupoId: num(f['grupoId']),
    })),
  });
}
function salvarDesconto() {
  if (errosDesconto.value.length) return;
  void gravar(
    (k) =>
      salvarDescontoVolume(
        {
          ...(d.id ? { id: d.id, versao: d.versao } : {}),
          fontePagadoraId: d.fontePagadoraId,
          descricao: d.descricao.trim(),
          baseVolume: d.baseVolume,
          vigenciaInicio: d.vigenciaInicio,
          vigenciaFim: d.vigenciaFim || null,
          ativo: d.ativo,
          faixas: faixasDominio.value.map((f) => ({
            sequencia: f.sequencia,
            volumeInicial: f.volumeInicial,
            volumeFinal: f.volumeFinal,
            tipo: f.tipo,
            percentual: f.percentual,
            valor: f.valor,
            grupoId: f.grupo,
          })),
        },
        k,
      ),
    () => Object.assign(d, descontoVazio()),
  );
}

// ── Franquia do contrato ───────────────────────────────────────────────────────────────────────────────
interface ExcecaoTela {
  grupoId: number;
  itemId: number | null;
  especialidadeId: number | null;
  regimeId: number | null;
  aplicaTitular: boolean;
  aplicaDependente: boolean;
  aplicaPensionista: boolean;
}
const franquiaVazia = () => ({
  id: undefined as number | undefined,
  versao: undefined as number | undefined,
  contratoId: 0,
  planoId: null as number | null,
  descricao: '',
  tipo: 'valor' as 'valor' | 'quantidade' | 'percentual',
  valorFranquia: null as number | null,
  quantidadePontos: null as number | null,
  valorPonto: null as number | null,
  percentualParticipacao: null as number | null,
  valorParticipacao: null as number | null,
  regimeId: null as number | null,
  itemId: null as number | null,
  grupoId: 0,
  aplicaTitular: true,
  aplicaDependente: true,
  aplicaPensionista: true,
  idadeMinima: null as number | string | null,
  idadeMaxima: null as number | string | null,
  vigenciaInicio: hoje(),
  vigenciaFim: '',
  ativo: true,
  excecoes: [] as ExcecaoTela[],
});
const f = reactive(franquiaVazia());
const novaFranquia = () => Object.assign(f, franquiaVazia());
const errosFranquia = computed(() => {
  const e = {
    ...validarFranquia({
      tipo: f.tipo,
      valorFranquia: f.valorFranquia,
      quantidadePontos: f.quantidadePontos,
      valorPonto: f.valorPonto,
      percentualParticipacao: f.percentualParticipacao,
      aplicaTitular: f.aplicaTitular,
      aplicaDependente: f.aplicaDependente,
      aplicaPensionista: f.aplicaPensionista,
      idadeMinima: textoNum(f.idadeMinima),
      idadeMaxima: textoNum(f.idadeMaxima),
      vigenciaInicio: f.vigenciaInicio,
      vigenciaFim: f.vigenciaFim || null,
      excecoes: f.excecoes.map((x) => ({
        grupo: ouNulo(x.grupoId),
        item: x.itemId,
        especialidade: x.especialidadeId,
        regime: x.regimeId,
        aplicaTitular: x.aplicaTitular,
        aplicaDependente: x.aplicaDependente,
        aplicaPensionista: x.aplicaPensionista,
        ativo: true,
      })),
    }),
  };
  if (!f.contratoId) e['contratoId'] = t('faltaContrato');
  if (!f.descricao.trim()) e['descricao'] = t('faltaDescricao');
  return Object.values(e);
});
type FranquiaLida = RegrasComerciais['franquias'][number];
function editarFranquia(r: FranquiaLida) {
  const x = r as FranquiaLida & Record<string, unknown>;
  const exc = Array.isArray(x['excecoes']) ? (x['excecoes'] as Record<string, unknown>[]) : [];
  Object.assign(f, {
    id: r.id,
    versao: numN(x['versao']) ?? undefined,
    contratoId: r.contratoId,
    planoId: numN(x['plano']),
    descricao: r.descricao,
    tipo: r.tipo as 'valor' | 'quantidade' | 'percentual',
    valorFranquia: numN(x['valorFranquia']),
    quantidadePontos: numN(x['quantidadePontos']),
    valorPonto: numN(x['valorPonto']),
    percentualParticipacao: numN(x['percentualParticipacao']),
    valorParticipacao: numN(x['valorParticipacao']),
    regimeId: numN(x['regime']),
    itemId: numN(x['item']),
    grupoId: num(x['grupo']),
    aplicaTitular: x['aplicaTitular'] !== false,
    aplicaDependente: x['aplicaDependente'] !== false,
    aplicaPensionista: x['aplicaPensionista'] !== false,
    idadeMinima: numN(x['idadeMinima']),
    idadeMaxima: numN(x['idadeMaxima']),
    vigenciaInicio: typeof x['vigenciaInicio'] === 'string' ? x['vigenciaInicio'] : hoje(),
    vigenciaFim: typeof x['vigenciaFim'] === 'string' ? x['vigenciaFim'] : '',
    ativo: r.ativo,
    // As exceções ativas voltam ao formulário: a gravação sem elas as inativaria.
    excecoes: exc
      .filter((e) => e['ativo'] !== false)
      .map((e) => ({
        grupoId: num(e['grupo']),
        itemId: numN(e['item']),
        especialidadeId: numN(e['especialidade']),
        regimeId: numN(e['regime']),
        aplicaTitular: e['aplicaTitular'] !== false,
        aplicaDependente: e['aplicaDependente'] !== false,
        aplicaPensionista: e['aplicaPensionista'] !== false,
      })),
  });
}
function salvarFranquiaTela() {
  if (errosFranquia.value.length) return;
  void gravar(
    (k) =>
      salvarFranquia(
        {
          ...(f.id ? { id: f.id, versao: f.versao } : {}),
          contratoId: f.contratoId,
          planoId: f.planoId,
          descricao: f.descricao.trim(),
          tipo: f.tipo,
          valorFranquia: f.tipo === 'valor' ? f.valorFranquia : null,
          quantidadePontos: f.tipo === 'quantidade' ? f.quantidadePontos : null,
          valorPonto: f.tipo === 'quantidade' ? f.valorPonto : null,
          percentualParticipacao: f.tipo === 'percentual' ? f.percentualParticipacao : null,
          valorParticipacao: f.tipo === 'percentual' ? f.valorParticipacao : null,
          regimeId: f.regimeId,
          itemId: f.itemId,
          grupoId: ouNulo(f.grupoId),
          aplicaTitular: f.aplicaTitular,
          aplicaDependente: f.aplicaDependente,
          aplicaPensionista: f.aplicaPensionista,
          idadeMinima: textoNum(f.idadeMinima),
          idadeMaxima: textoNum(f.idadeMaxima),
          vigenciaInicio: f.vigenciaInicio,
          vigenciaFim: f.vigenciaFim || null,
          ativo: f.ativo,
          excecoes: f.excecoes.map((x) => ({
            grupoId: ouNulo(x.grupoId),
            itemId: x.itemId,
            especialidadeId: x.especialidadeId,
            regimeId: x.regimeId,
            aplicaTitular: x.aplicaTitular,
            aplicaDependente: x.aplicaDependente,
            aplicaPensionista: x.aplicaPensionista,
          })),
        },
        k,
      ),
    () => Object.assign(f, franquiaVazia()),
  );
}
const valorDaFranquia = (r: FranquiaLida) => {
  const x = r as FranquiaLida & Record<string, unknown>;
  if (r.tipo === 'valor') return reais(numN(x['valorFranquia']));
  if (r.tipo === 'quantidade') return `${num(x['quantidadePontos'])} × ${reais(numN(x['valorPonto']))}`;
  return `${num(x['percentualParticipacao'])}%`;
};
const excecoesDe = (r: FranquiaLida) => {
  const x = (r as FranquiaLida & Record<string, unknown>)['excecoes'];
  return Array.isArray(x) ? x.filter((e) => (e as Record<string, unknown>)['ativo'] !== false).length : 0;
};

// ── Na conta ──────────────────────────────────────────────────────────────────────────────────────────
const contaTela = reactive({
  numero: Number.isInteger(contaDoEndereco) && contaDoEndereco > 0 ? String(contaDoEndereco) : '',
  simulacao: '' as '' | (typeof VINCULOS_BENEFICIARIO)[number],
});
const contaAberta = ref<number | null>(
  Number.isInteger(contaDoEndereco) && contaDoEndereco > 0 ? contaDoEndereco : null,
);
const comercial = useQuery({
  queryKey: computed(() => ['faturamento', 'comercial-conta', contaAberta.value, contaTela.simulacao]),
  queryFn: () => lerComercialConta(contaAberta.value as number, contaTela.simulacao || null),
  enabled: computed(() => contaAberta.value !== null),
});
function abrirConta() {
  const n = Number(contaTela.numero);
  if (Number.isInteger(n) && n > 0) contaAberta.value = n;
}
const c = computed<ComercialConta | undefined>(() => comercial.data.value);
const aplicando = ref(false);
async function aplicar() {
  if (!contaAberta.value) return;
  erro.value = null;
  mensagem.value = null;
  aplicando.value = true;
  try {
    const r = (await aplicarFranquiaDesconto(contaAberta.value, chave)) as Record<string, unknown>;
    chave = novaChave('descontos-franquias');
    mensagem.value = t('aplicado', {
      f: reais(numN(r['franquia'])),
      d: reais(numN(r['desconto'])),
      t: reais(numN(r['valorTotal'])),
    });
    await qc.invalidateQueries({ queryKey: ['faturamento', 'comercial-conta'] });
  } catch (e) {
    erro.value = e;
  } finally {
    aplicando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="df-titulo" data-testid="tela-descontos-franquias">
    <h1 id="df-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('explica') }}</p>
    <div role="tablist" class="abas">
      <button
        v-for="a in ABAS"
        :key="a"
        type="button"
        role="tab"
        :aria-selected="aba === a"
        :data-testid="`df-aba-${a}`"
        @click="aba = a"
      >
        {{ rotuloAba(a) }}
      </button>
    </div>
    <MensagemFaturamento :texto="mensagem" testid="df-mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <ErroFaturamento v-if="regras.error.value" :erro="regras.error.value" />

    <!-- Desconto por volume -->
    <div v-if="aba === 'desconto' && regras.data.value" role="tabpanel" data-testid="df-desconto">
      <table v-if="regras.data.value.descontos.length" class="tabela" data-testid="df-descontos">
        <thead>
          <tr>
            <th scope="col">{{ t('convenio') }}</th>
            <th scope="col">{{ t('descricao') }}</th>
            <th scope="col">{{ t('base') }}</th>
            <th scope="col">{{ t('faixas') }}</th>
            <th scope="col">{{ t('ativa') }}</th>
            <th scope="col">
              <span class="sr-only">{{ t('editar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in regras.data.value.descontos" :key="r.id" :data-testid="`df-desconto-${r.id}`">
            <td>{{ nomeDe(op?.fontes, r.fontePagadoraId) }}</td>
            <td>{{ r.descricao }}</td>
            <td>{{ t(`base_${r.baseVolume}`) }}</td>
            <td>{{ r.faixas.length }}</td>
            <td>{{ r.ativo ? t('sim') : t('nao') }}</td>
            <td>
              <button type="button" :data-testid="`df-editar-desconto-${r.id}`" @click="editarDesconto(r)">
                {{ t('editar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else data-testid="df-sem-descontos">{{ t('semDescontos') }}</p>

      <form class="formulario" data-testid="df-form-desconto" @submit.prevent="salvarDesconto">
        <SanteSelecao
          v-model="d.fontePagadoraId"
          :rotulo="t('convenio')"
          :opcoes="opcoesDe(op?.fontes, '')"
          data-testid="df-desconto-convenio"
        />
        <label>
          {{ t('descricao') }}
          <input v-model="d.descricao" maxlength="150" data-testid="df-desconto-descricao" />
        </label>
        <SanteSelecao
          v-model="d.baseVolume"
          :rotulo="t('base')"
          :opcoes="BASES_VOLUME.map((b) => ({ valor: b, rotulo: t(`base_${b}`) }))"
          data-testid="df-desconto-base"
        />
        <label>
          {{ t('inicio') }}
          <input v-model="d.vigenciaInicio" type="date" data-testid="df-desconto-inicio" />
        </label>
        <label>
          {{ t('fim') }}
          <input v-model="d.vigenciaFim" type="date" data-testid="df-desconto-fim" />
        </label>
        <label
          ><input v-model="d.ativo" type="checkbox" data-testid="df-desconto-ativa" /> {{ t('ativa') }}</label
        >

        <fieldset data-testid="df-faixas">
          <legend>{{ t('faixas') }}</legend>
          <div v-for="(x, i) in d.faixas" :key="x.sequencia" :data-testid="`df-faixa-${i}`">
            <label>
              {{ t('de') }}
              <input
                v-model.number="x.volumeInicial"
                type="number"
                min="0"
                step="0.01"
                :data-testid="`df-faixa-${i}-de`"
              />
            </label>
            <label>
              {{ t('ate') }}
              <input
                v-model="x.volumeFinal"
                type="number"
                min="0"
                step="0.01"
                :data-testid="`df-faixa-${i}-ate`"
              />
            </label>
            <SanteSelecao
              v-model="x.tipo"
              :rotulo="t('tipoDesconto')"
              :opcoes="[
                { valor: 'percentual' as const, rotulo: t('tipo_percentual') },
                { valor: 'valor' as const, rotulo: t('tipo_valor') },
              ]"
              :data-testid="`df-faixa-${i}-tipo`"
            />
            <label v-if="x.tipo === 'percentual'">
              {{ t('percentual') }}
              <input
                v-model.number="x.percentual"
                type="number"
                min="0"
                max="100"
                step="0.01"
                :data-testid="`df-faixa-${i}-percentual`"
              />
            </label>
            <label v-else>
              {{ t('valor') }}
              <input
                v-model.number="x.valor"
                type="number"
                min="0"
                step="0.01"
                :data-testid="`df-faixa-${i}-valor`"
              />
            </label>
            <SanteSelecao
              v-model="x.grupoId"
              :rotulo="t('grupo')"
              :opcoes="opcoesDe(op?.grupos, t('qualquer'))"
              :data-testid="`df-faixa-${i}-grupo`"
            />
            <button v-if="d.faixas.length > 1" type="button" @click="d.faixas.splice(i, 1)">
              {{ t('retirar') }}
            </button>
          </div>
          <button type="button" data-testid="df-nova-faixa" @click="acrescentarFaixa">
            {{ t('novaFaixa') }}
          </button>
        </fieldset>

        <p v-if="errosDesconto.length" role="status" data-testid="df-desconto-erros">
          {{ errosDesconto.join(' · ') }}
        </p>
        <button
          type="submit"
          :disabled="gravando || errosDesconto.length > 0"
          data-testid="df-desconto-salvar"
        >
          {{ t('salvar') }}
        </button>
        <button v-if="d.id" type="button" data-testid="df-desconto-nova" @click="novoDesconto">
          {{ t('nova') }}
        </button>
      </form>
    </div>

    <!-- Franquia do contrato -->
    <div v-if="aba === 'franquia' && regras.data.value" role="tabpanel" data-testid="df-franquia">
      <table v-if="regras.data.value.franquias.length" class="tabela" data-testid="df-franquias">
        <thead>
          <tr>
            <th scope="col">{{ t('contrato') }}</th>
            <th scope="col">{{ t('descricao') }}</th>
            <th scope="col">{{ t('tipoFranquia') }}</th>
            <th scope="col">{{ t('excecoes') }}</th>
            <th scope="col">{{ t('ativa') }}</th>
            <th scope="col">
              <span class="sr-only">{{ t('editar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in regras.data.value.franquias" :key="r.id" :data-testid="`df-franquia-${r.id}`">
            <td>{{ nomeDe(op?.contratos, r.contratoId) }}</td>
            <td>{{ r.descricao }}</td>
            <td>{{ valorDaFranquia(r) }}</td>
            <td>{{ t('excecoesQtd', { n: excecoesDe(r) }) }}</td>
            <td>{{ r.ativo ? t('sim') : t('nao') }}</td>
            <td>
              <button type="button" :data-testid="`df-editar-franquia-${r.id}`" @click="editarFranquia(r)">
                {{ t('editar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else data-testid="df-sem-franquias">{{ t('semFranquias') }}</p>

      <form class="formulario" data-testid="df-form-franquia" @submit.prevent="salvarFranquiaTela">
        <SanteSelecao
          v-model="f.contratoId"
          :rotulo="t('contrato')"
          :opcoes="opcoesDe(op?.contratos, '')"
          data-testid="df-franquia-contrato"
        />
        <label>
          {{ t('descricao') }}
          <input v-model="f.descricao" maxlength="150" data-testid="df-franquia-descricao" />
        </label>
        <SanteSelecao
          v-model="f.tipo"
          :rotulo="t('tipoFranquia')"
          :opcoes="[
            { valor: 'valor' as const, rotulo: t('franquia_valor') },
            { valor: 'quantidade' as const, rotulo: t('franquia_quantidade') },
            { valor: 'percentual' as const, rotulo: t('franquia_percentual') },
          ]"
          data-testid="df-franquia-tipo"
        />
        <label v-if="f.tipo === 'valor'">
          {{ t('valorFranquia') }}
          <input
            v-model.number="f.valorFranquia"
            type="number"
            min="0"
            step="0.01"
            data-testid="df-franquia-valor"
          />
        </label>
        <template v-if="f.tipo === 'quantidade'">
          <label>
            {{ t('quantidadePontos') }}
            <input
              v-model.number="f.quantidadePontos"
              type="number"
              min="0"
              data-testid="df-franquia-pontos"
            />
          </label>
          <label>
            {{ t('valorPonto') }}
            <input
              v-model.number="f.valorPonto"
              type="number"
              min="0"
              step="0.01"
              data-testid="df-franquia-valor-ponto"
            />
          </label>
        </template>
        <template v-if="f.tipo === 'percentual'">
          <label>
            {{ t('percentualParticipacao') }}
            <input
              v-model.number="f.percentualParticipacao"
              type="number"
              min="0"
              max="100"
              step="0.01"
              data-testid="df-franquia-percentual"
            />
          </label>
          <label>
            {{ t('valorParticipacao') }}
            <input
              v-model.number="f.valorParticipacao"
              type="number"
              min="0"
              step="0.01"
              data-testid="df-franquia-teto"
            />
          </label>
        </template>
        <SanteSelecao
          v-model="f.grupoId"
          :rotulo="t('grupo')"
          :opcoes="opcoesDe(op?.grupos, t('qualquer'))"
          data-testid="df-franquia-grupo"
        />
        <fieldset data-testid="df-franquia-vinculos">
          <legend>{{ t('vinculos') }}</legend>
          <label
            ><input v-model="f.aplicaTitular" type="checkbox" data-testid="df-franquia-titular" />
            {{ t('titular') }}</label
          >
          <label
            ><input v-model="f.aplicaDependente" type="checkbox" data-testid="df-franquia-dependente" />
            {{ t('dependente') }}</label
          >
          <label
            ><input v-model="f.aplicaPensionista" type="checkbox" data-testid="df-franquia-pensionista" />
            {{ t('pensionista') }}</label
          >
        </fieldset>
        <label>
          {{ t('idadeMinima') }}
          <input
            v-model="f.idadeMinima"
            type="number"
            min="0"
            max="150"
            data-testid="df-franquia-idade-min"
          />
        </label>
        <label>
          {{ t('idadeMaxima') }}
          <input
            v-model="f.idadeMaxima"
            type="number"
            min="0"
            max="150"
            data-testid="df-franquia-idade-max"
          />
        </label>
        <label>
          {{ t('inicio') }}
          <input v-model="f.vigenciaInicio" type="date" data-testid="df-franquia-inicio" />
        </label>
        <label>
          {{ t('fim') }}
          <input v-model="f.vigenciaFim" type="date" data-testid="df-franquia-fim" />
        </label>
        <label
          ><input v-model="f.ativo" type="checkbox" data-testid="df-franquia-ativa" /> {{ t('ativa') }}</label
        >

        <fieldset data-testid="df-franquia-excecoes">
          <legend>{{ t('excecoes') }}</legend>
          <div v-for="(x, i) in f.excecoes" :key="i" :data-testid="`df-excecao-${i}`">
            <SanteSelecao
              v-model="x.grupoId"
              :rotulo="t('grupo')"
              :opcoes="opcoesDe(op?.grupos, '')"
              :data-testid="`df-excecao-${i}-grupo`"
            />
            <button type="button" @click="f.excecoes.splice(i, 1)">{{ t('retirar') }}</button>
          </div>
          <button
            type="button"
            data-testid="df-nova-excecao"
            @click="
              f.excecoes.push({
                grupoId: 0,
                itemId: null,
                especialidadeId: null,
                regimeId: null,
                aplicaTitular: true,
                aplicaDependente: true,
                aplicaPensionista: true,
              })
            "
          >
            {{ t('novaExcecao') }}
          </button>
        </fieldset>

        <p v-if="errosFranquia.length" role="status" data-testid="df-franquia-erros">
          {{ errosFranquia.join(' · ') }}
        </p>
        <button
          type="submit"
          :disabled="gravando || errosFranquia.length > 0"
          data-testid="df-franquia-salvar"
        >
          {{ t('salvar') }}
        </button>
        <button v-if="f.id" type="button" data-testid="df-franquia-nova" @click="novaFranquia">
          {{ t('nova') }}
        </button>
      </form>
    </div>

    <!-- Na conta -->
    <div v-if="aba === 'conta'" role="tabpanel" data-testid="df-conta">
      <form class="formulario" @submit.prevent="abrirConta">
        <label>
          {{ t('conta') }}
          <input v-model="contaTela.numero" inputmode="numeric" data-testid="df-conta-numero" />
        </label>
        <button type="submit" :disabled="!Number(contaTela.numero)" data-testid="df-conta-abrir">
          {{ t('abrir') }}
        </button>
      </form>
      <ErroFaturamento v-if="comercial.error.value" :erro="comercial.error.value" />
      <template v-if="c">
        <h2 data-testid="df-conta-cabecalho">{{ c.conta.numero }} · {{ c.conta.situacao }}</h2>
        <dl class="formulario" data-testid="df-conta-valores">
          <dt>{{ t('itens') }}</dt>
          <dd>{{ reais(c.conta.valorItens) }}</dd>
          <dt>{{ t('descontoConta') }}</dt>
          <dd>{{ reais(c.conta.valorDesconto) }}</dd>
          <dt>{{ t('parteDoPaciente') }}</dt>
          <dd data-testid="df-conta-paciente">{{ reais(c.conta.valorPaciente) }}</dd>
          <dt>{{ t('totalFonte') }}</dt>
          <dd data-testid="df-conta-total">{{ reais(c.conta.valorTotal) }}</dd>
        </dl>

        <h3>{{ t('previa') }}</h3>
        <SanteSelecao
          v-model="contaTela.simulacao"
          :rotulo="t('simular')"
          :opcoes="[
            { valor: '' as const, rotulo: t('doCadastro') },
            ...VINCULOS_BENEFICIARIO.map((v) => ({ valor: v, rotulo: t(v) })),
          ]"
          data-testid="df-conta-simulacao"
        />
        <p v-if="c.previa.situacao.vinculo" data-testid="df-conta-vinculo">
          {{
            t('vinculoAtual', {
              v: t(c.previa.situacao.vinculo),
              o: t(`origem_${c.previa.situacao.origemVinculo}`),
            })
          }}
        </p>
        <p v-else role="status" data-testid="df-conta-sem-vinculo">{{ t('semVinculo') }}</p>
        <ul data-testid="df-conta-franquias">
          <li v-for="x in c.previa.franquia" :key="x.id" :data-testid="`df-conta-franquia-${x.id}`">
            {{ x.descricao }}:
            {{ x.motivo ? t(`motivo_${x.motivo}`) : t('valeValor', { v: reais(x.valor), b: reais(x.base) }) }}
          </li>
        </ul>
        <p data-testid="df-conta-desconto">
          {{
            c.previa.desconto
              ? t('descontoVolume', {
                  d: c.previa.desconto.descricao,
                  vol: c.previa.desconto.volume.toLocaleString('pt-BR'),
                  v: reais(c.previa.desconto.valor),
                })
              : t('semDesconto')
          }}
        </p>
        <button type="button" :disabled="aplicando" data-testid="df-conta-aplicar" @click="aplicar">
          {{ t('aplicar') }}
        </button>

        <template v-if="c.aplicados.length">
          <h3>{{ t('historico') }}</h3>
          <table class="tabela" data-testid="df-conta-aplicados">
            <tbody>
              <tr v-for="x in c.aplicados" :key="x.id">
                <td>{{ x.sequencia }}</td>
                <td>{{ t(`tipoAplicado_${x.tipo}`) }}</td>
                <td>{{ reais(x.valor) }}</td>
                <td>{{ x.vigente ? t('vigente') : t('substituido') }}</td>
                <td>{{ x.observacao }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </template>
    </div>
  </section>
</template>
