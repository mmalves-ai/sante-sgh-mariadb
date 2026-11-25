<script setup lang="ts">
// 03-PEP linha 115 (C2-003): aferição detalhada dos sinais vitais do paciente. Por parâmetro do cadastro: valor,
// instrumento, local e posição; o que não foi aferido leva o motivo (e o complemento, quando o motivo pede). A
// conferência do domínio roda na hora, campo a campo; fora da faixa normal, pede a confirmação; o servidor escolhe o
// limite que vale (setor, instrumento, sexo, idade) e grava o nível do alerta. A lista das recentes mostra o nível em
// texto, nunca só pela cor.
import { conferirDetalheAfericao, type ErroAfericao } from '@sgh/dominio-enfermagem';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { codigoDaRecusa } from '../api-enfermagem.js';
import {
  type CatalogosAfericao,
  lerAfericoes,
  lerCatalogosAfericao,
  registrarAfericao,
  type ValorAfericaoEntrada,
} from '../api-sinais-detalhe.js';
import ErroEnfermagem from './ErroEnfermagem.vue';

const props = defineProps<{ paciente: number; atendimento: number | null; podeCriar: boolean }>();
const { t } = useI18n();
const cliente = useQueryClient();

const catalogos = useQuery({
  queryKey: ['enfermagem', 'afericao', 'catalogos'],
  queryFn: () => lerCatalogosAfericao(),
});
const recentes = useQuery({
  queryKey: computed(() => ['enfermagem', 'afericoes', props.paciente]),
  queryFn: () => lerAfericoes(props.paciente),
});

type Parametro = CatalogosAfericao['parametros'][number];
interface Linha {
  valor: string;
  instrumento: string;
  local: string;
  posicao: string;
  naoAferido: boolean;
  motivo: string;
  complemento: string;
}
const linhas = ref<Record<string, Linha>>({});
const vazia = (): Linha => ({
  valor: '',
  instrumento: '',
  local: '',
  posicao: '',
  naoAferido: false,
  motivo: '',
  complemento: '',
});
const linha = (codigo: string): Linha => linhas.value[codigo] ?? vazia();
function limpar() {
  linhas.value = Object.fromEntries(parametros.value.map((p) => [p.codigo, vazia()]));
}

const parametros = computed(() => catalogos.data.value?.parametros ?? []);
watch(parametros, limpar, { immediate: true });
const nenhum = computed(() => ({ valor: '', rotulo: t('enfermagem.sinaisDetalhe.nenhum') }));
function opcoesInstrumento(p: Parametro) {
  return [
    nenhum.value,
    ...(catalogos.data.value?.instrumentos ?? [])
      .filter((i) => i.parametro === null || i.parametro === p.codigo)
      .map((i) => ({ valor: String(i.id), rotulo: i.descricao })),
  ];
}
const opcoesLocal = computed(() => [
  nenhum.value,
  ...(catalogos.data.value?.locais ?? []).map((l) => ({ valor: String(l.id), rotulo: l.descricao })),
]);
const opcoesPosicao = computed(() => [
  nenhum.value,
  ...(catalogos.data.value?.posicoes ?? []).map((l) => ({ valor: String(l.id), rotulo: l.descricao })),
]);
const opcoesMotivo = computed(() => [
  nenhum.value,
  ...(catalogos.data.value?.motivos ?? []).map((m) => ({ valor: String(m.id), rotulo: m.descricao })),
]);

const num = (s: string): number | null => {
  const v = Number(s.replace(',', '.'));
  return s.trim() !== '' && Number.isFinite(v) ? v : null;
};
const id = (s: string): number | null => (s ? Number(s) : null);
const motivoDe = (l: Linha) => catalogos.data.value?.motivos.find((m) => String(m.id) === l.motivo) ?? null;
const preenchida = (l: Linha) => l.naoAferido || l.valor.trim() !== '';

/** Conferência do domínio na hora, por parâmetro preenchido. */
const erros = computed<Record<string, ErroAfericao[]>>(() => {
  const r: Record<string, ErroAfericao[]> = {};
  for (const p of parametros.value) {
    const l = linhas.value[p.codigo];
    if (!l || !preenchida(l)) continue;
    const m = motivoDe(l);
    const lista = conferirDetalheAfericao(
      {
        valor: l.naoAferido ? null : num(l.valor),
        local: id(l.local),
        posicao: id(l.posicao),
        naoAferido: l.naoAferido,
        motivoNaoAfericao: l.naoAferido && m ? { id: m.id, exigeComplemento: m.exigeComplemento } : null,
        justificativa: l.complemento.trim() || null,
      },
      { exigeLocal: p.exigeLocal, exigePosicao: p.exigePosicao },
    );
    if (lista.length) r[p.codigo] = lista;
  }
  return r;
});
const digitadas = computed(() => parametros.value.filter((p) => preenchida(linha(p.codigo))));
/** Fora da faixa de alerta do cadastro: a tela já pede a confirmação; o limite fino quem decide é o servidor. */
const algumFora = computed(() =>
  digitadas.value.some((p) => {
    const v = num(linha(p.codigo).valor);
    if (v === null || linha(p.codigo).naoAferido) return false;
    return (p.alertaMinimo !== null && v < p.alertaMinimo) || (p.alertaMaximo !== null && v > p.alertaMaximo);
  }),
);
const confirmar = ref(false);
const pediuConfirmacao = ref(false);
const ocupado = ref(false);
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);
const podeGravar = computed(
  () =>
    props.podeCriar && !ocupado.value && digitadas.value.length > 0 && Object.keys(erros.value).length === 0,
);

async function gravar() {
  if (!podeGravar.value) return;
  ocupado.value = true;
  erro.value = null;
  feito.value = null;
  try {
    const valores: ValorAfericaoEntrada[] = digitadas.value.map((p) => {
      const l = linha(p.codigo);
      return {
        tipo: p.codigo,
        valor: l.naoAferido ? null : num(l.valor),
        instrumento: l.naoAferido ? null : id(l.instrumento),
        local: l.naoAferido ? null : id(l.local),
        posicao: l.naoAferido ? null : id(l.posicao),
        naoAferido: l.naoAferido,
        motivo: l.naoAferido ? id(l.motivo) : null,
        justificativa: l.complemento.trim() || null,
        confirmadoForaDaFaixa: confirmar.value,
      };
    });
    const r = await registrarAfericao(props.paciente, {
      atendimento: props.atendimento,
      horaReal: null,
      observacao: null,
      valores,
    });
    feito.value = r.mensagem;
    limpar();
    confirmar.value = false;
    pediuConfirmacao.value = false;
    await cliente.invalidateQueries({ queryKey: ['enfermagem', 'afericoes', props.paciente] });
  } catch (e) {
    if (codigoDaRecusa(e) === 'sinal-confirmar') pediuConfirmacao.value = true;
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

function detalhe(v: { instrumento: string | null; local: string | null; posicao: string | null }) {
  return (
    [v.instrumento, v.local, v.posicao].filter(Boolean).join(' · ') || t('enfermagem.sinaisDetalhe.nenhum')
  );
}
</script>

<template>
  <section class="painel" aria-labelledby="sd-titulo" data-testid="sd-painel">
    <h2 id="sd-titulo">{{ t('enfermagem.sinaisDetalhe.titulo') }}</h2>
    <p class="ajuda">{{ t('enfermagem.sinaisDetalhe.texto') }}</p>
    <ErroEnfermagem v-if="catalogos.isError.value" :erro="catalogos.error.value" />
    <p v-else-if="!catalogos.data.value" role="status">{{ t('enfermagem.comum.carregando') }}</p>
    <p v-else-if="parametros.length === 0" role="status">{{ t('enfermagem.sinaisDetalhe.semCatalogo') }}</p>
    <form v-else @submit.prevent="gravar">
      <fieldset
        v-for="p in parametros"
        :key="p.codigo"
        class="parametro"
        :data-testid="`sd-param-${p.codigo}`"
      >
        <legend>
          {{ p.descricao }}<span v-if="p.unidade"> ({{ p.unidade }})</span>
        </legend>
        <div class="linha">
          <label v-if="!linha(p.codigo).naoAferido">
            {{ t('enfermagem.sinaisDetalhe.valor') }}
            <input
              v-model="linha(p.codigo).valor"
              inputmode="decimal"
              :aria-invalid="!!erros[p.codigo]?.some((e) => e.campo === 'valor')"
              :data-testid="`sd-valor-${p.codigo}`"
            />
          </label>
          <SanteSelecao
            v-if="!linha(p.codigo).naoAferido"
            v-model="linha(p.codigo).instrumento"
            :rotulo="t('enfermagem.sinaisDetalhe.instrumento')"
            :opcoes="opcoesInstrumento(p)"
            :data-testid="`sd-instrumento-${p.codigo}`"
          />
          <SanteSelecao
            v-if="!linha(p.codigo).naoAferido && (p.exibeLocal || p.exigeLocal)"
            v-model="linha(p.codigo).local"
            :rotulo="t('enfermagem.sinaisDetalhe.local')"
            :opcoes="opcoesLocal"
            :obrigatorio="p.exigeLocal"
            :data-testid="`sd-local-${p.codigo}`"
          />
          <SanteSelecao
            v-if="!linha(p.codigo).naoAferido && (p.exibePosicao || p.exigePosicao)"
            v-model="linha(p.codigo).posicao"
            :rotulo="t('enfermagem.sinaisDetalhe.posicao')"
            :opcoes="opcoesPosicao"
            :obrigatorio="p.exigePosicao"
            :data-testid="`sd-posicao-${p.codigo}`"
          />
          <label class="marcador">
            <input
              v-model="linha(p.codigo).naoAferido"
              type="checkbox"
              :data-testid="`sd-nao-${p.codigo}`"
              @change="linha(p.codigo).valor = ''"
            />
            {{ t('enfermagem.sinaisDetalhe.naoAferido') }}
          </label>
          <SanteSelecao
            v-if="linha(p.codigo).naoAferido"
            v-model="linha(p.codigo).motivo"
            :rotulo="t('enfermagem.sinaisDetalhe.motivo')"
            :opcoes="opcoesMotivo"
            obrigatorio
            :data-testid="`sd-motivo-${p.codigo}`"
          />
          <label v-if="linha(p.codigo).naoAferido && motivoDe(linha(p.codigo))?.exigeComplemento">
            {{ t('enfermagem.sinaisDetalhe.complemento') }}
            <input
              v-model="linha(p.codigo).complemento"
              maxlength="500"
              :data-testid="`sd-complemento-${p.codigo}`"
            />
          </label>
        </div>
        <ul v-if="erros[p.codigo]" class="alerta" :data-testid="`sd-erros-${p.codigo}`">
          <li v-for="e in erros[p.codigo]" :key="e.codigo">{{ e.mensagem }}</li>
        </ul>
      </fieldset>
      <label v-if="algumFora || pediuConfirmacao" class="linha alerta">
        <input v-model="confirmar" type="checkbox" data-testid="sd-confirmar" />
        {{ t('enfermagem.sinaisDetalhe.confirmar') }}
      </label>
      <ErroEnfermagem v-if="erro" :erro="erro" />
      <p v-if="feito" role="status" data-testid="sd-feito">{{ feito }}</p>
      <SanteBotao
        tipo="submit"
        :rotulo="t('enfermagem.sinaisDetalhe.registrar')"
        :desabilitado="!podeGravar"
        data-testid="sd-registrar"
      />
    </form>

    <h3>{{ t('enfermagem.sinaisDetalhe.recentes') }}</h3>
    <ErroEnfermagem v-if="recentes.isError.value" :erro="recentes.error.value" />
    <p v-else-if="!recentes.data.value" role="status">{{ t('enfermagem.comum.carregando') }}</p>
    <p v-else-if="recentes.data.value.itens.length === 0">{{ t('enfermagem.sinaisDetalhe.vazio') }}</p>
    <div v-else class="rolagem">
      <table class="grade" data-testid="sd-recentes">
        <thead>
          <tr>
            <th scope="col">{{ t('enfermagem.sinaisDetalhe.quando') }}</th>
            <th scope="col">{{ t('enfermagem.sinaisDetalhe.parametro') }}</th>
            <th scope="col">{{ t('enfermagem.sinaisDetalhe.valor') }}</th>
            <th scope="col">{{ t('enfermagem.sinaisDetalhe.nivel') }}</th>
            <th scope="col">{{ t('enfermagem.sinaisDetalhe.detalhe') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="v in recentes.data.value.itens"
            :key="v.id"
            :class="{ fora: v.nivel && v.nivel !== 'normal' }"
          >
            <td>{{ v.aferidoEm?.slice(0, 16).replace('T', ' ') ?? '' }}</td>
            <td>{{ v.descricao }}</td>
            <td v-if="v.naoAferido">
              {{ t('enfermagem.sinaisDetalhe.naoAferido') }}: {{ v.motivo ?? '' }}
              <span v-if="v.justificativa">({{ v.justificativa }})</span>
            </td>
            <td v-else>{{ v.valor ?? '' }} {{ v.unidade ?? '' }}</td>
            <td :class="{ alerta: v.nivel && v.nivel !== 'normal' }" :data-testid="`sd-nivel-${v.id}`">
              {{ v.nivel ? t(`enfermagem.sinaisDetalhe.niveis.${v.nivel}`) : '' }}
            </td>
            <td>{{ detalhe(v) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.painel {
  display: grid;
  gap: var(--sgh-espaco-2);
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  background: var(--sgh-fundo-elevado);
}
.parametro {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
}
.marcador {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-height: var(--sgh-alvo-minimo);
}
</style>
