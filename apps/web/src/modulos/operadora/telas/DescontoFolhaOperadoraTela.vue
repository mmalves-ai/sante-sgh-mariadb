<script setup lang="ts">
// Desconto em folha da mensalidade (F7, 08-SGO linha 97, C3-028) — `Faturamento > Operadora própria > Desconto em
// folha`. A operadora e a contratante (órgão ou empresa que desconta do salário do titular, por busca remota) com a
// competência dão a prévia com as críticas (o que fica fora da remessa e por quê) e a geração da remessa; a lista das
// remessas abre a ficha com os itens, o arquivo para a contratante, a marcação de enviada, a leitura do retorno
// (matrícula;valor descontado, colado ou de arquivo, e a data do crédito do repasse), a conferência e o cancelamento.
// A baixa da cobrança pelo descontado é do domínio e da gravação (a mais antiga primeiro; o saldo vai para a seguinte).
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { lerTelaCobranca } from '../api-cobranca.js';
import {
  arquivoRemessaFolha,
  buscarContratantesFolha,
  cancelarRemessaFolha,
  conferirRemessaFolha,
  type ContratanteFolha,
  enviarRemessaFolha,
  gerarRemessaFolha,
  lerRemessaFolha,
  listarRemessasFolha,
  type PreviaFolha,
  previaRemessaFolha,
  retornoRemessaFolha,
} from '../api-desconto-folha.js';
import { mensagensDescontoFolhaOperadora } from '../i18n-desconto-folha.js';

const { t } = useI18n({ useScope: 'local', messages: { 'pt-BR': mensagensDescontoFolhaOperadora } });
const cliente = useQueryClient();
const podeGerar = computed(() => pode('operadora.cobranca.gerar'));
const TIPOS = ['mensal', 'decimo_terceiro', 'complementar'] as const;
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const reais = (v: number | null) => (v === null ? '—' : moeda.format(v));

const tela = useQuery({ queryKey: ['operadora', 'cobranca', 'tela'], queryFn: () => lerTelaCobranca() });
const operadora = ref<number | null>(null);
watch(
  () => tela.data.value,
  (v) => {
    if (v && (operadora.value === null || !v.operadoras.some((o) => o.id === operadora.value)))
      operadora.value = v.operadoras[0]?.id ?? null;
  },
  { immediate: true },
);
const opOperadoras = computed(() =>
  (tela.data.value?.operadoras ?? []).map((o) => ({ valor: o.id, rotulo: `${o.razaoSocial} (${o.registroAns})` })),
);

// Contratante por busca remota: as opções são as da última busca, mais a escolhida.
const contratantes = ref<ContratanteFolha[]>([]);
const contratante = ref<number | null>(null);
async function buscarContratantes(termo: string) {
  if (operadora.value === null) return;
  const achados = await buscarContratantesFolha(operadora.value, termo);
  const atual = contratantes.value.find((c) => c.id === contratante.value);
  contratantes.value = atual && !achados.some((c) => c.id === atual.id) ? [atual, ...achados] : achados;
}
const opContratantes = computed(() =>
  contratantes.value.map((c) => ({ valor: c.id, rotulo: `${c.codigo} — ${c.nome}` })),
);
const opTipos = computed(() => TIPOS.map((v) => ({ valor: v, rotulo: t(`tipos.${v}`) })));

const f = reactive({ competencia: new Date().toISOString().slice(0, 7), tipo: 'mensal', observacao: '' });
const entrada = computed(() =>
  operadora.value !== null && contratante.value !== null && /^\d{4}-\d{2}$/.test(f.competencia)
    ? { operadora: operadora.value, contratante: contratante.value, competencia: f.competencia }
    : null,
);
const previa = ref<PreviaFolha | null>(null);
watch(entrada, () => (previa.value = null));

const remessas = useQuery({
  queryKey: computed(() => ['operadora', 'desconto-folha', 'remessas', operadora.value]),
  queryFn: () => listarRemessasFolha(operadora.value),
  enabled: computed(() => operadora.value !== null),
});
const aberta = ref<number | null>(null);
const ficha = useQuery({
  queryKey: computed(() => ['operadora', 'desconto-folha', 'remessa', aberta.value]),
  queryFn: () => lerRemessaFolha(aberta.value as number),
  enabled: computed(() => aberta.value !== null),
});
const r = reactive({ texto: '', creditoEm: new Date().toISOString().slice(0, 10), motivo: '' });
watch(aberta, () => Object.assign(r, { texto: '', motivo: '' }));

const erro = ref<unknown>(null);
const aviso = ref('');
const acao = useMutation({
  mutationFn: (fn: () => Promise<string>) => fn(),
  onSuccess: (msg) => {
    erro.value = null;
    aviso.value = msg;
    void cliente.invalidateQueries({ queryKey: ['operadora', 'desconto-folha'] });
  },
  onError: (e) => {
    erro.value = e;
    aviso.value = '';
  },
});
const ocupado = computed(() => acao.isPending.value);

function verPrevia() {
  const e = entrada.value;
  if (e)
    acao.mutate(async () => {
      previa.value = await previaRemessaFolha(e);
      return t('previaResumo', {
        itens: previa.value.itens.length,
        total: reais(previa.value.valorTotal),
        atrasado: reais(previa.value.valorAtrasado),
      });
    });
}
function gerar() {
  const e = entrada.value;
  if (e)
    acao.mutate(async () => {
      const g = await gerarRemessaFolha({ ...e, tipo: f.tipo, observacao: f.observacao.trim() || null });
      previa.value = null;
      aberta.value = g.id;
      return t('gerada', { numero: String((g as { numero?: string }).numero ?? g.id) });
    });
}
function emFicha(fn: (id: number, versao: number) => Promise<unknown>) {
  const d = ficha.data.value;
  if (d)
    acao.mutate(async () => {
      await fn(d.id, d.versao);
      return t('feito');
    });
}
async function baixarArquivo() {
  const d = ficha.data.value;
  if (!d) return;
  try {
    const a = await arquivoRemessaFolha(d.id);
    const url = URL.createObjectURL(new Blob([a.conteudo], { type: a.tipoMime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = a.nome;
    link.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    erro.value = e;
  }
}
async function lerArquivoRetorno(ev: Event) {
  const arq = (ev.target as HTMLInputElement).files?.[0];
  if (arq) r.texto = await arq.text();
}
</script>

<template>
  <section class="tela-operadora" aria-labelledby="ope-desconto-folha-titulo" data-testid="tela-desconto-folha">
    <h1 id="ope-desconto-folha-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('texto') }}</p>
    <MensagemErro v-if="tela.isError.value" :erro="tela.error.value" />
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="desconto-folha-aviso">{{ aviso }}</p>

    <div class="campos">
      <SanteSelecao
        v-model="operadora"
        :rotulo="t('operadora')"
        :opcoes="opOperadoras"
        data-testid="desconto-folha-operadora"
      />
      <SanteSelecao
        v-model="contratante"
        :rotulo="t('contratante')"
        :opcoes="opContratantes"
        :buscar="(termo: string) => void buscarContratantes(termo)"
        data-testid="desconto-folha-contratante"
      />
      <label
        >{{ t('competencia') }}
        <input v-model="f.competencia" type="month" required data-testid="desconto-folha-competencia"
      /></label>
      <SanteSelecao v-model="f.tipo" :rotulo="t('tipo')" :opcoes="opTipos" data-testid="desconto-folha-tipo" />
      <label
        >{{ t('observacao') }}
        <input v-model="f.observacao" maxlength="1000" data-testid="desconto-folha-observacao"
      /></label>
    </div>
    <div class="acoes">
      <button type="button" :disabled="!entrada || ocupado" data-testid="desconto-folha-previa" @click="verPrevia">
        {{ t('previa') }}
      </button>
      <button
        v-if="podeGerar"
        type="button"
        :disabled="!entrada || ocupado"
        data-testid="desconto-folha-gerar"
        @click="gerar"
      >
        {{ t('gerar') }}
      </button>
    </div>

    <template v-if="previa">
      <table data-testid="desconto-folha-previa-itens">
        <thead>
          <tr>
            <th scope="col">{{ t('colunas.cobranca') }}</th>
            <th scope="col">{{ t('colunas.matricula') }}</th>
            <th scope="col">{{ t('colunas.competencia') }}</th>
            <th scope="col">{{ t('colunas.enviado') }}</th>
            <th scope="col">{{ t('colunas.atrasado') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in previa.itens" :key="i.sequencia">
            <td>{{ i.numero }}</td>
            <td>{{ i.matriculaFuncional }}</td>
            <td>{{ i.competencia }}</td>
            <td>{{ reais(i.valorEnviado) }}</td>
            <td>{{ reais(i.valorAtrasado) }}</td>
          </tr>
        </tbody>
      </table>
      <template v-if="previa.criticas.length">
        <h2>{{ t('criticas') }}</h2>
        <ul data-testid="desconto-folha-criticas">
          <li v-for="c in previa.criticas" :key="`${c.fatura}-${c.codigo}`">{{ c.numero }}: {{ c.mensagem }}</li>
        </ul>
      </template>
    </template>

    <h2>{{ t('remessas') }}</h2>
    <MensagemErro v-if="remessas.isError.value" :erro="remessas.error.value" />
    <p v-else-if="remessas.data.value && !remessas.data.value.length">{{ t('nenhuma') }}</p>
    <table v-else-if="remessas.data.value" data-testid="desconto-folha-remessas">
      <thead>
        <tr>
          <th scope="col">{{ t('colunas.numero') }}</th>
          <th scope="col">{{ t('colunas.contratante') }}</th>
          <th scope="col">{{ t('colunas.competencia') }}</th>
          <th scope="col">{{ t('colunas.situacao') }}</th>
          <th scope="col">{{ t('colunas.enviado') }}</th>
          <th scope="col">{{ t('colunas.descontado') }}</th>
          <th scope="col">{{ t('colunas.itens') }}</th>
          <th scope="col"><span class="sr-only">{{ t('abrir') }}</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in remessas.data.value" :key="m.id">
          <td>{{ m.numero }}</td>
          <td>{{ m.contratanteNome }}</td>
          <td>{{ m.competencia }}</td>
          <td>{{ t(`situacoes.${m.situacao}`) }}</td>
          <td>{{ reais(m.valorEnviado) }}</td>
          <td>{{ reais(m.valorDescontado) }}</td>
          <td>{{ m.itens }}</td>
          <td>
            <button type="button" :data-testid="`desconto-folha-abrir-${m.id}`" @click="aberta = m.id">
              {{ t('abrir') }} {{ m.numero }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <section v-if="ficha.data.value" :aria-label="ficha.data.value.numero" data-testid="desconto-folha-ficha">
      <h2>{{ ficha.data.value.numero }} · {{ t(`situacoes.${ficha.data.value.situacao}`) }}</h2>
      <table data-testid="desconto-folha-itens">
        <thead>
          <tr>
            <th scope="col">{{ t('colunas.cobranca') }}</th>
            <th scope="col">{{ t('colunas.matricula') }}</th>
            <th scope="col">{{ t('colunas.competencia') }}</th>
            <th scope="col">{{ t('colunas.enviado') }}</th>
            <th scope="col">{{ t('colunas.atrasado') }}</th>
            <th scope="col">{{ t('colunas.descontado') }}</th>
            <th scope="col">{{ t('colunas.situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in ficha.data.value.detalhe" :key="i.sequencia">
            <td>{{ i.cobranca }}</td>
            <td>{{ i.matriculaFuncional }}</td>
            <td>{{ i.competencia }}</td>
            <td>{{ reais(i.valorEnviado) }}</td>
            <td>{{ reais(i.valorAtrasado) }}</td>
            <td>{{ reais(i.valorDescontado) }}</td>
            <td>{{ t(`situacoes.${i.situacao}`) }}</td>
          </tr>
        </tbody>
      </table>
      <div class="acoes">
        <button type="button" data-testid="desconto-folha-arquivo" @click="baixarArquivo">
          {{ t('baixarArquivo') }}
        </button>
        <template v-if="podeGerar">
          <button
            v-if="ficha.data.value.situacao === 'gerada'"
            type="button"
            :disabled="ocupado"
            data-testid="desconto-folha-enviar"
            @click="emFicha(enviarRemessaFolha)"
          >
            {{ t('enviar') }}
          </button>
          <button
            v-if="ficha.data.value.situacao === 'retorno_recebido'"
            type="button"
            :disabled="ocupado"
            data-testid="desconto-folha-conferir"
            @click="emFicha(conferirRemessaFolha)"
          >
            {{ t('conferir') }}
          </button>
        </template>
      </div>
      <div v-if="podeGerar && ficha.data.value.situacao === 'enviada'" class="campos">
        <label
          >{{ t('retorno') }}
          <textarea v-model="r.texto" rows="5" data-testid="desconto-folha-retorno-texto"></textarea
        ></label>
        <label
          >{{ t('arquivoRetorno') }}
          <input type="file" accept=".csv,.txt,text/plain" data-testid="desconto-folha-retorno-arquivo" @change="lerArquivoRetorno"
        /></label>
        <label
          >{{ t('creditoEm') }}
          <input v-model="r.creditoEm" type="date" required data-testid="desconto-folha-credito"
        /></label>
        <button
          type="button"
          :disabled="!r.texto.trim() || !r.creditoEm || ocupado"
          data-testid="desconto-folha-ler-retorno"
          @click="emFicha((id, v) => retornoRemessaFolha(id, v, r.texto, r.creditoEm))"
        >
          {{ t('lerRetorno') }}
        </button>
      </div>
      <div
        v-if="podeGerar && ['gerada', 'enviada'].includes(ficha.data.value.situacao)"
        class="campos"
      >
        <label
          >{{ t('motivo') }} <input v-model="r.motivo" maxlength="500" data-testid="desconto-folha-motivo"
        /></label>
        <button
          type="button"
          :disabled="!r.motivo.trim() || ocupado"
          data-testid="desconto-folha-cancelar"
          @click="emFicha((id, v) => cancelarRemessaFolha(id, v, r.motivo.trim()))"
        >
          {{ t('cancelar') }}
        </button>
      </div>
    </section>
  </section>
</template>

<style scoped src="../estilo-operadora.css"></style>
<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
