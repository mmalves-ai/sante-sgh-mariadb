<script setup lang="ts">
// F3.8, 07-FIN linha 113: o ciclo da nota de serviço numa tela só. Emissão por seleção de faturas (uma ou muitas no
// mesmo envio, com a dedução da base e o comprovante na própria linha), a lista das notas com cancelar e substituir na
// linha e o histórico de cada nota. A conferência é a do domínio, feita enquanto se preenche: o botão só libera com o
// lote válido, e o cancelamento e a substituição mostram na hora o motivo que falta, a justificativa curta ou o prazo
// do município vencido. Os motivos vêm do catálogo do cliente; os prazos, da regra do município do estabelecimento.
import {
  conferirCancelamentoNfse,
  conferirLoteNfse,
  conferirSubstituicaoNfse,
  LIMITE_LOTE_NFSE,
  type PedidoNfseCompleto,
  TIPOS_DEDUCAO_NFSE,
  type TipoDeducaoNfse,
} from '@sgh/dominio-financeiro';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import {
  cancelarNotaServico,
  definirPrazoNotaServico,
  emitirLoteNotasServico,
  type HistoricoNotaServico,
  lerApoioNotaServico,
  lerHistoricoNotaServico,
  listarNotasServico,
  type NotaServico,
  substituirNotaServico,
} from '../api-nota-servico.js';

defineProps<{ pode: boolean }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Notas de serviço por fatura',
      simulador: 'Fora de produção: a prefeitura é o simulador e as notas saem com número de teste.',
      prefeitura: 'As notas ficam com o RPS gerado até a resposta da prefeitura.',
      semMunicipio:
        'O estabelecimento está sem município no cadastro: informe-o antes de emitir a nota de serviço.',
      emitirTitulo: 'Emitir por faturas',
      semFaturas: 'Nenhuma fatura à espera de nota.',
      escolher: 'Escolher',
      escolherFatura: 'Escolher a fatura {numero}',
      fatura: 'Fatura',
      devedor: 'Tomador',
      emissao: 'Emissão',
      valor: 'Valor',
      deducao: 'Dedução da base',
      comDeducao: 'Deduzir da base',
      tipoDeducao: 'Tipo da dedução da fatura {numero}',
      descricaoDeducao: 'Descrição da dedução da fatura {numero}',
      documentoDeducao: 'Comprovante da dedução da fatura {numero}',
      valorDeducao: 'Valor da dedução da fatura {numero}',
      descricao: 'Descrição',
      comprovante: 'Comprovante',
      tipos: {
        material: 'Material',
        subempreitada: 'Subempreitada',
        filme: 'Filme',
        honorario: 'Honorário',
        operacional: 'Operacional',
        outra: 'Outra',
      },
      itemServico: 'Item da lista de serviços',
      classificacao: 'Classificação tributária',
      aliquota: 'Alíquota do ISS (%)',
      issRetido: 'ISS retido pelo tomador',
      resumo: '{quantidade} fatura(s) escolhida(s), {valor} em serviços (até {limite} por envio)',
      emitir: 'Emitir {quantidade} nota(s)',
      notas: 'Notas emitidas',
      semNotas: 'Nenhuma nota emitida.',
      numero: 'Número',
      rps: 'RPS',
      servicos: 'Serviços',
      deducoes: 'Deduções',
      iss: 'ISS',
      liquido: 'Líquido',
      situacao: 'Situação',
      emitidaEm: 'Emitida em',
      acoes: 'Ações',
      situacoes: {
        rascunho: 'Rascunho',
        rps_gerado: 'RPS gerado',
        enviada: 'Enviada',
        autorizada: 'Autorizada',
        rejeitada: 'Rejeitada',
        cancelada: 'Cancelada',
        substituida: 'Substituída',
      },
      substituiu: 'substitui a nota {nota}',
      substituidaPor: 'substituída pela nota {nota}',
      historico: 'Histórico',
      cancelar: 'Cancelar',
      substituir: 'Substituir',
      cancelarNota: 'Cancelar a nota {nota}',
      substituirNota: 'Substituir a nota {nota}',
      motivo: 'Motivo',
      escolhaMotivo: 'Escolha o motivo',
      justificativa: 'Justificativa',
      letras: '{n} de 15 letras no mínimo',
      prazo: 'Emitida há {dias} dia(s); o prazo do município é de {prazo} dia(s).',
      novoValor: 'Valor dos serviços da nota substituta',
      confirmarCancelar: 'Confirmar o cancelamento',
      confirmarSubstituir: 'Emitir a substituta',
      desistir: 'Desistir',
      historicoDa: 'Histórico da nota {nota}',
      eventos: {
        emissao: 'Emissão',
        envio: 'Envio',
        autorizacao: 'Autorização',
        rejeicao: 'Rejeição',
        cancelamento: 'Cancelamento',
        substituicao: 'Substituição',
        erro: 'Erro',
      },
      evento: 'Evento',
      quando: 'Quando',
      quem: 'Quem',
      detalhe: 'Detalhe',
      pelaNota: 'substituta: nota {nota}',
      fechar: 'Fechar',
      prazosTitulo: 'Prazos do município',
      prazosTexto: '{municipio}: cancelar em até {c} dia(s) e substituir em até {s} dia(s) da emissão.',
      prazosPadrao: 'O município ainda não tem prazo próprio: vale o padrão.',
      prazoCancelamento: 'Dias para cancelar',
      prazoSubstituicao: 'Dias para substituir',
      aliquotaGeral: 'Alíquota geral do ISS do município (%)',
      gravarPrazos: 'Gravar os prazos',
    },
  },
});
const qc = useQueryClient();
const apoio = useQuery({ queryKey: ['financeiro', 'nota-servico', 'apoio'], queryFn: lerApoioNotaServico });
const notas = useQuery({
  queryKey: ['financeiro', 'nota-servico', 'notas'],
  queryFn: () => listarNotasServico(),
});
const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: unknown) => Number(String(v ?? '').replace(',', '.'));
const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');
const hoje = () => new Date().toISOString().slice(0, 10);

/** Sem o banco do cliente (fonte sintética) o ciclo não existe: o painel some em vez de mostrar erro. */
const indisponivel = computed(() => (apoio.error.value as { status?: number } | null)?.status === 503);
const erro = ref<unknown>(null);
const ok = ref('');
const gravando = ref(false);
async function gravar(fn: () => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  ok.value = '';
  gravando.value = true;
  try {
    ok.value = (await fn()).mensagem;
    await qc.invalidateQueries({ queryKey: ['financeiro', 'nota-servico'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    gravando.value = false;
  }
}

// ── Emissão por seleção de faturas ─────────────────────────────────────────────────────────────────────────────
interface DeducaoForm {
  ligada: boolean;
  tipo: TipoDeducaoNfse;
  descricao: string;
  documento: string;
  valor: string;
}
const comum = reactive({ itemServico: '', classificacao: '', aliquotaIss: '', issRetido: false });
const marcadas = ref<number[]>([]);
const deducoes = reactive<Record<number, DeducaoForm>>({});
// A linha da dedução nasce quando a fatura é escolhida (fora da renderização) e fica guardada se ela for desmarcada.
watch(
  marcadas,
  (lista) => {
    for (const titulo of lista)
      deducoes[titulo] ??= { ligada: false, tipo: 'material', descricao: '', documento: '', valor: '' };
  },
  { deep: true },
);
const tipos = computed(() => TIPOS_DEDUCAO_NFSE.map((v) => ({ valor: v, rotulo: t(`tipos.${v}`) })));
watch(
  () => apoio.data.value?.parametros,
  (p) => {
    if (!p) return;
    if (comum.aliquotaIss === '' && p.aliquota !== null)
      comum.aliquotaIss = String(p.aliquota).replace('.', ',');
    if (p.issRetido) comum.issRetido = true;
  },
  { immediate: true },
);
const faturas = computed(() => apoio.data.value?.faturas ?? []);
const pedidoDe = (titulo: number, valor: number, com: typeof comum): PedidoNfseCompleto => {
  const d = deducoes[titulo];
  return {
    tituloReceber: titulo,
    conta: null,
    momento: 'apresentacao',
    classificacao: com.classificacao.trim(),
    itemServico: com.itemServico.trim(),
    valorServicos: valor,
    aliquotaIss: num(com.aliquotaIss),
    issRetido: com.issRetido,
    retencoes: { ir: 0, pis: 0, cofins: 0, csll: 0, inss: 0 },
    deducoes: d?.ligada
      ? [
          {
            tipo: d.tipo,
            descricao: d.descricao.trim(),
            documento: d.documento.trim() || null,
            valor: num(d.valor),
          },
        ]
      : [],
  };
};
const lote = computed(() =>
  faturas.value
    .filter((f) => marcadas.value.includes(f.titulo))
    .map((f) => pedidoDe(f.titulo, f.valor, comum)),
);
const totalLote = computed(() => lote.value.reduce((s, n) => s + n.valorServicos, 0));
/** A mesma conferência do servidor, a cada tecla (as faturas da lista já são as sem nota ativa). */
const recusaLote = computed(() => (lote.value.length ? conferirLoteNfse(lote.value, []) : null));
async function emitir() {
  const enviado = await gravar(() => emitirLoteNotasServico(lote.value, novaChave('ns-lote')));
  if (enviado) marcadas.value = [];
}

// ── Cancelar e substituir, na linha da nota ────────────────────────────────────────────────────────────────────
const acao = ref<{ tipo: 'cancelar' | 'substituir'; nota: NotaServico } | null>(null);
const formAcao = reactive({ motivo: '', justificativa: '', valor: '', ...comum });
const motivos = computed(() => [
  { valor: '', rotulo: t('escolhaMotivo') },
  ...(apoio.data.value?.motivos ?? []).map((m) => ({ valor: String(m.id), rotulo: m.descricao })),
]);
function abrir(tipo: 'cancelar' | 'substituir', nota: NotaServico) {
  Object.assign(formAcao, {
    motivo: '',
    justificativa: '',
    valor: String(nota.valorServicos).replace('.', ','),
    itemServico: comum.itemServico,
    classificacao: comum.classificacao,
    aliquotaIss: String(nota.aliquotaIss).replace('.', ','),
    issRetido: nota.issRetido,
  });
  erro.value = null;
  ok.value = '';
  acao.value = { tipo, nota };
}
watch(
  () => formAcao.motivo,
  (m) => {
    // O texto padrão do motivo poupa a digitação; quem já escreveu não perde o que escreveu.
    const padrao = apoio.data.value?.motivos.find((x) => String(x.id) === m)?.justificativaPadrao;
    if (padrao && !formAcao.justificativa.trim()) formAcao.justificativa = padrao;
  },
);
const prazoDaAcao = computed(() => {
  const p = apoio.data.value?.parametros;
  return acao.value?.tipo === 'substituir'
    ? (p?.prazoSubstituicaoDias ?? 30)
    : (p?.prazoCancelamentoDias ?? 30);
});
const diasDaNota = computed(() => {
  const em = acao.value?.nota.emitidaEm?.slice(0, 10);
  return em
    ? Math.round((Date.parse(`${hoje()}T00:00:00Z`) - Date.parse(`${em}T00:00:00Z`)) / 86_400_000)
    : 0;
});
const substituta = computed(() =>
  acao.value
    ? {
        ...pedidoDe(acao.value.nota.tituloReceber ?? 0, num(formAcao.valor), formAcao),
        tituloReceber: acao.value.nota.tituloReceber,
        conta: acao.value.nota.tituloReceber === null ? acao.value.nota.conta : null,
        deducoes: [],
      }
    : null,
);
const recusaAcao = computed(() => {
  const a = acao.value;
  if (!a) return null;
  const m = apoio.data.value?.motivos.find((x) => String(x.id) === formAcao.motivo);
  const motivo = m ? { id: m.id, codigo: m.codigo, ativo: true, aplicaNotaServico: true } : null;
  const emitida = {
    situacao: a.nota.situacao,
    emitidaEm: a.nota.emitidaEm?.slice(0, 10) ?? hoje(),
    tituloReceber: a.nota.tituloReceber,
    conta: a.nota.tituloReceber === null ? a.nota.conta : null,
  };
  return a.tipo === 'cancelar'
    ? conferirCancelamentoNfse(emitida, motivo, formAcao.justificativa, hoje(), prazoDaAcao.value)
    : conferirSubstituicaoNfse(
        emitida,
        motivo,
        formAcao.justificativa,
        hoje(),
        prazoDaAcao.value,
        substituta.value as PedidoNfseCompleto,
      );
});
async function confirmar() {
  const a = acao.value;
  if (!a) return;
  const base = { motivo: Number(formAcao.motivo), justificativa: formAcao.justificativa.trim() };
  const enviado = await gravar(() =>
    a.tipo === 'cancelar'
      ? cancelarNotaServico(a.nota.id, base, novaChave('ns-cancelar'))
      : substituirNotaServico(a.nota.id, { ...base, nova: substituta.value }, novaChave('ns-substituir')),
  );
  if (enviado) acao.value = null;
}

// ── Histórico ──────────────────────────────────────────────────────────────────────────────────────────────────
const historico = ref<HistoricoNotaServico | null>(null);
async function verHistorico(nota: NotaServico) {
  erro.value = null;
  try {
    historico.value = await lerHistoricoNotaServico(nota.id);
  } catch (e) {
    erro.value = e;
  }
}

// ── Prazos do município ────────────────────────────────────────────────────────────────────────────────────────
const prazos = reactive({ cancelamento: '', substituicao: '', aliquota: '' });
watch(
  () => apoio.data.value?.parametros,
  (p) => {
    if (!p) return;
    prazos.cancelamento = String(p.prazoCancelamentoDias);
    prazos.substituicao = String(p.prazoSubstituicaoDias);
  },
  { immediate: true },
);
const prazosValidos = computed(() =>
  [prazos.cancelamento, prazos.substituicao].every((v) => /^\d{1,4}$/.test(v.trim()) && Number(v) <= 3650),
);
const gravarPrazos = () =>
  gravar(() =>
    definirPrazoNotaServico(
      {
        prazoCancelamentoDias: Number(prazos.cancelamento),
        prazoSubstituicaoDias: Number(prazos.substituicao),
        aliquota:
          apoio.data.value?.parametros.temRegra || prazos.aliquota === '' ? null : num(prazos.aliquota),
      },
      novaChave('ns-prazo'),
    ),
  );
</script>

<template>
  <section v-if="!indisponivel" aria-labelledby="ns-titulo" data-testid="ns-ciclo">
    <h2 id="ns-titulo">{{ t('titulo') }}</h2>
    <ErroFaturamento
      v-if="erro || apoio.error.value || notas.error.value"
      :erro="erro ?? apoio.error.value ?? notas.error.value"
    />
    <p v-if="ok" role="status" class="secundario" data-testid="ns-ok">{{ ok }}</p>
    <template v-if="apoio.data.value">
      <p class="secundario" data-testid="ns-destino">
        {{ t(apoio.data.value.destino === 'simulador' ? 'simulador' : 'prefeitura') }}
      </p>
      <p v-if="!apoio.data.value.parametros.municipio" role="alert" data-testid="ns-sem-municipio">
        {{ t('semMunicipio') }}
      </p>

      <h3>{{ t('emitirTitulo') }}</h3>
      <p v-if="!faturas.length" data-testid="ns-sem-faturas">{{ t('semFaturas') }}</p>
      <form v-else class="formulario" data-testid="ns-lote" @submit.prevent="emitir">
        <table class="tabela" data-testid="ns-faturas">
          <thead>
            <tr>
              <th scope="col">{{ t('escolher') }}</th>
              <th scope="col">{{ t('fatura') }}</th>
              <th scope="col">{{ t('devedor') }}</th>
              <th scope="col">{{ t('emissao') }}</th>
              <th scope="col">{{ t('valor') }}</th>
              <th scope="col">{{ t('deducao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in faturas" :key="f.titulo" :data-testid="`ns-fatura-${f.titulo}`">
              <td>
                <input
                  v-model="marcadas"
                  type="checkbox"
                  :value="f.titulo"
                  :aria-label="t('escolherFatura', { numero: f.numero })"
                  :data-testid="`ns-marcar-${f.titulo}`"
                />
              </td>
              <th scope="row">{{ f.numero }}</th>
              <td>{{ f.devedor }}</td>
              <td>{{ dia(f.emissao) }}</td>
              <td>{{ brl(f.valor) }}</td>
              <td>
                <template v-if="marcadas.includes(f.titulo) && deducoes[f.titulo]">
                  <label>
                    <input
                      v-model="deducoes[f.titulo]!.ligada"
                      type="checkbox"
                      :data-testid="`ns-deduzir-${f.titulo}`"
                    />
                    {{ t('comDeducao') }}
                  </label>
                  <span v-if="deducoes[f.titulo]!.ligada" class="acoes">
                    <SanteSelecao
                      v-model="deducoes[f.titulo]!.tipo"
                      :rotulo="t('tipoDeducao', { numero: f.numero })"
                      :opcoes="tipos"
                      :data-testid="`ns-ded-tipo-${f.titulo}`"
                    />
                    <input
                      v-model="deducoes[f.titulo]!.descricao"
                      maxlength="150"
                      :placeholder="t('descricao')"
                      :aria-label="t('descricaoDeducao', { numero: f.numero })"
                      :data-testid="`ns-ded-descricao-${f.titulo}`"
                    />
                    <input
                      v-model="deducoes[f.titulo]!.documento"
                      maxlength="60"
                      :placeholder="t('comprovante')"
                      :aria-label="t('documentoDeducao', { numero: f.numero })"
                      :data-testid="`ns-ded-documento-${f.titulo}`"
                    />
                    <input
                      v-model="deducoes[f.titulo]!.valor"
                      inputmode="decimal"
                      :placeholder="t('valor')"
                      :aria-label="t('valorDeducao', { numero: f.numero })"
                      :data-testid="`ns-ded-valor-${f.titulo}`"
                    />
                  </span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <span class="campo">
          <label for="ns-item">{{ t('itemServico') }}</label>
          <input id="ns-item" v-model="comum.itemServico" maxlength="20" data-testid="ns-item" />
        </span>
        <span class="campo">
          <label for="ns-classificacao">{{ t('classificacao') }}</label>
          <input
            id="ns-classificacao"
            v-model="comum.classificacao"
            maxlength="10"
            data-testid="ns-classificacao"
          />
        </span>
        <span class="campo">
          <label for="ns-aliquota">{{ t('aliquota') }}</label>
          <input id="ns-aliquota" v-model="comum.aliquotaIss" inputmode="decimal" data-testid="ns-aliquota" />
        </span>
        <span class="campo">
          <label for="ns-retido">
            <input id="ns-retido" v-model="comum.issRetido" type="checkbox" data-testid="ns-retido" />
            {{ t('issRetido') }}
          </label>
        </span>
        <p class="secundario" data-testid="ns-resumo">
          {{ t('resumo', { quantidade: lote.length, valor: brl(totalLote), limite: LIMITE_LOTE_NFSE }) }}
        </p>
        <p v-if="recusaLote" role="status" data-testid="ns-recusa-lote">{{ recusaLote.mensagem }}</p>
        <button
          type="submit"
          :disabled="
            gravando || !pode || !lote.length || !!recusaLote || !apoio.data.value.parametros.municipio
          "
          data-testid="ns-emitir"
        >
          {{ t('emitir', { quantidade: lote.length }) }}
        </button>
      </form>

      <h3>{{ t('notas') }}</h3>
      <p v-if="notas.data.value && !notas.data.value.length" data-testid="ns-sem-notas">
        {{ t('semNotas') }}
      </p>
      <table v-else-if="notas.data.value" class="tabela" data-testid="ns-notas">
        <thead>
          <tr>
            <th scope="col">{{ t('numero') }}</th>
            <th scope="col">{{ t('fatura') }}</th>
            <th scope="col">{{ t('devedor') }}</th>
            <th scope="col">{{ t('servicos') }}</th>
            <th scope="col">{{ t('deducoes') }}</th>
            <th scope="col">{{ t('iss') }}</th>
            <th scope="col">{{ t('liquido') }}</th>
            <th scope="col">{{ t('situacao') }}</th>
            <th scope="col">{{ t('emitidaEm') }}</th>
            <th scope="col">{{ t('acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="n in notas.data.value" :key="n.id" :data-testid="`ns-nota-${n.id}`">
            <th scope="row">{{ n.numero ?? `${t('rps')} ${n.rps}` }}</th>
            <td>{{ n.tituloNumero ?? '' }}</td>
            <td>{{ n.tomador }}</td>
            <td>{{ brl(n.valorServicos) }}</td>
            <td>{{ brl(n.valorDeducoes) }}</td>
            <td>{{ brl(n.valorIss) }}</td>
            <td>{{ brl(n.valorLiquido) }}</td>
            <td :data-testid="`ns-situacao-${n.id}`">
              {{ t(`situacoes.${n.situacao}`) }}
              <small v-if="n.substitui" class="secundario">{{
                t('substituiu', { nota: n.substitui })
              }}</small>
              <small v-if="n.substituta" class="secundario">
                {{ t('substituidaPor', { nota: n.substituta }) }}
              </small>
            </td>
            <td>{{ dia(n.emitidaEm) }}</td>
            <td class="acoes">
              <button type="button" :data-testid="`ns-historico-${n.id}`" @click="verHistorico(n)">
                {{ t('historico') }}
              </button>
              <template v-if="n.situacao === 'autorizada'">
                <button
                  type="button"
                  :disabled="!pode"
                  :data-testid="`ns-cancelar-${n.id}`"
                  @click="abrir('cancelar', n)"
                >
                  {{ t('cancelar') }}
                </button>
                <button
                  type="button"
                  :disabled="!pode"
                  :data-testid="`ns-substituir-${n.id}`"
                  @click="abrir('substituir', n)"
                >
                  {{ t('substituir') }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>

      <form v-if="acao" class="formulario painel" data-testid="ns-acao" @submit.prevent="confirmar">
        <h3>
          {{
            t(acao.tipo === 'cancelar' ? 'cancelarNota' : 'substituirNota', {
              nota: acao.nota.numero ?? acao.nota.rps,
            })
          }}
        </h3>
        <p class="secundario" data-testid="ns-prazo">
          {{ t('prazo', { dias: diasDaNota, prazo: prazoDaAcao }) }}
        </p>
        <span class="campo">
          <SanteSelecao
            v-model="formAcao.motivo"
            :rotulo="t('motivo')"
            :opcoes="motivos"
            data-testid="ns-motivo"
          />
        </span>
        <span class="campo">
          <label for="ns-justificativa">{{ t('justificativa') }}</label>
          <textarea
            id="ns-justificativa"
            v-model="formAcao.justificativa"
            rows="2"
            maxlength="500"
            aria-describedby="ns-letras"
            data-testid="ns-justificativa"
          ></textarea>
          <small id="ns-letras" class="secundario">
            {{ t('letras', { n: formAcao.justificativa.trim().length }) }}
          </small>
        </span>
        <template v-if="acao.tipo === 'substituir'">
          <span class="campo">
            <label for="ns-novo-valor">{{ t('novoValor') }}</label>
            <input
              id="ns-novo-valor"
              v-model="formAcao.valor"
              inputmode="decimal"
              data-testid="ns-novo-valor"
            />
          </span>
          <span class="campo">
            <label for="ns-novo-item">{{ t('itemServico') }}</label>
            <input
              id="ns-novo-item"
              v-model="formAcao.itemServico"
              maxlength="20"
              data-testid="ns-novo-item"
            />
          </span>
          <span class="campo">
            <label for="ns-nova-classificacao">{{ t('classificacao') }}</label>
            <input
              id="ns-nova-classificacao"
              v-model="formAcao.classificacao"
              maxlength="10"
              data-testid="ns-nova-classificacao"
            />
          </span>
          <span class="campo">
            <label for="ns-nova-aliquota">{{ t('aliquota') }}</label>
            <input
              id="ns-nova-aliquota"
              v-model="formAcao.aliquotaIss"
              inputmode="decimal"
              data-testid="ns-nova-aliquota"
            />
          </span>
        </template>
        <p v-if="recusaAcao" role="status" data-testid="ns-recusa-acao">{{ recusaAcao.mensagem }}</p>
        <span class="acoes">
          <button type="submit" :disabled="gravando || !pode || !!recusaAcao" data-testid="ns-confirmar">
            {{ t(acao.tipo === 'cancelar' ? 'confirmarCancelar' : 'confirmarSubstituir') }}
          </button>
          <button type="button" data-testid="ns-desistir" @click="acao = null">{{ t('desistir') }}</button>
        </span>
      </form>

      <section v-if="historico" class="painel" aria-labelledby="ns-hist-titulo" data-testid="ns-historico">
        <h3 id="ns-hist-titulo">{{ t('historicoDa', { nota: historico.numero ?? historico.nota }) }}</h3>
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('evento') }}</th>
              <th scope="col">{{ t('quando') }}</th>
              <th scope="col">{{ t('quem') }}</th>
              <th scope="col">{{ t('detalhe') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in historico.eventos" :key="e.id" :data-testid="`ns-evento-${e.tipo}`">
              <th scope="row">{{ t(`eventos.${e.tipo}`) }}</th>
              <td>{{ e.em ? new Date(e.em).toLocaleString('pt-BR') : '' }}</td>
              <td>{{ e.usuario ?? '' }}</td>
              <td>
                {{
                  [
                    e.motivo,
                    e.justificativa,
                    e.protocolo,
                    e.substituta ? t('pelaNota', { nota: e.substituta }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                }}
              </td>
            </tr>
          </tbody>
        </table>
        <ul v-if="historico.deducoes.length" data-testid="ns-hist-deducoes">
          <li v-for="d in historico.deducoes" :key="d.sequencia">
            {{ t(`tipos.${d.tipo}`) }}: {{ d.descricao }} ({{ d.documento ?? '' }}) {{ brl(d.valor) }}
          </li>
        </ul>
        <button type="button" data-testid="ns-hist-fechar" @click="historico = null">
          {{ t('fechar') }}
        </button>
      </section>

      <details data-testid="ns-prazos">
        <summary>{{ t('prazosTitulo') }}</summary>
        <p v-if="apoio.data.value.parametros.municipio" class="secundario" data-testid="ns-prazos-texto">
          {{
            t('prazosTexto', {
              municipio: apoio.data.value.parametros.municipio.nome,
              c: apoio.data.value.parametros.prazoCancelamentoDias,
              s: apoio.data.value.parametros.prazoSubstituicaoDias,
            })
          }}
          <template v-if="apoio.data.value.parametros.prazoPadrao">{{ t('prazosPadrao') }}</template>
        </p>
        <form class="formulario" @submit.prevent="gravarPrazos">
          <span class="campo">
            <label for="ns-prazo-cancelamento">{{ t('prazoCancelamento') }}</label>
            <input
              id="ns-prazo-cancelamento"
              v-model="prazos.cancelamento"
              inputmode="numeric"
              data-testid="ns-prazo-cancelamento"
            />
          </span>
          <span class="campo">
            <label for="ns-prazo-substituicao">{{ t('prazoSubstituicao') }}</label>
            <input
              id="ns-prazo-substituicao"
              v-model="prazos.substituicao"
              inputmode="numeric"
              data-testid="ns-prazo-substituicao"
            />
          </span>
          <span v-if="!apoio.data.value.parametros.temRegra" class="campo">
            <label for="ns-prazo-aliquota">{{ t('aliquotaGeral') }}</label>
            <input
              id="ns-prazo-aliquota"
              v-model="prazos.aliquota"
              inputmode="decimal"
              data-testid="ns-prazo-aliquota"
            />
          </span>
          <button
            type="submit"
            :disabled="
              gravando ||
              !pode ||
              !prazosValidos ||
              !apoio.data.value.parametros.municipio ||
              (!apoio.data.value.parametros.temRegra && prazos.aliquota === '')
            "
            data-testid="ns-gravar-prazos"
          >
            {{ t('gravarPrazos') }}
          </button>
        </form>
      </details>
    </template>
  </section>
</template>
