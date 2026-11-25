<script setup lang="ts">
// O complemento da conta da AIH (F7, 06-SUS linha 58): a equipe de cada procedimento, os vários diagnósticos
// secundários e os incrementos da habilitação do hospital, em três abas sobre a última conta. A conferência roda a cada
// mudança com a mesma regra do domínio que a gravação usa (conferirComplementoAih): o botão só grava sem problema.
// Sem permissão, ou com a conta fora da situação fechada, o painel só mostra.
import {
  CLASSIFICACOES_DIAGNOSTICO_AIH,
  conferirComplementoAih,
  TIPOS_DIAGNOSTICO_AIH,
  type ClassificacaoDiagnosticoAih,
  type TipoDiagnosticoAih,
} from '@sgh/dominio-faturamento';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  gravarComplementoAih,
  lerComplementoAih,
  type ComplementoAihTela,
} from '../api-conta-aih-complemento.js';
import { mensagensContaAihComplemento } from '../i18n-conta-aih-complemento.js';

const props = defineProps<{ aih: number; cidPrincipal: string; podeRegistrar: boolean }>();
const { t } = useI18n({ useScope: 'local', messages: { 'pt-BR': mensagensContaAihComplemento } });
const cliente = useQueryClient();

type Aba = 'equipe' | 'diagnosticos' | 'incrementos';
const ABAS: readonly Aba[] = ['equipe', 'diagnosticos', 'incrementos'];
const aba = ref<Aba>('equipe');

interface LinhaEquipe {
  procedimento: number | '';
  cns: string;
  cbo: string;
  atividade: string;
  credor: string;
  documentoCredor: string;
}
interface LinhaDiagnostico {
  cid: string;
  tipo: TipoDiagnosticoAih;
  classificacao: ClassificacaoDiagnosticoAih | '';
}
interface LinhaIncremento {
  habilitacao: string;
  procedimento: number | '';
  percentual: string;
}

const consulta = useQuery({
  queryKey: computed(() => ['sus', 'aih', 'complemento', props.aih]),
  queryFn: () => lerComplementoAih(props.aih),
});
const dados = computed<ComplementoAihTela | null>(() => consulta.data.value ?? null);
const editavel = computed(() => props.podeRegistrar && (dados.value?.editavel ?? false));

const equipe = ref<LinhaEquipe[]>([]);
const diagnosticos = ref<LinhaDiagnostico[]>([]);
const incrementos = ref<LinhaIncremento[]>([]);
function carregar(d: ComplementoAihTela | null): void {
  equipe.value = (d?.equipe ?? []).map((x) => ({
    procedimento: x.procedimento,
    cns: x.cns,
    cbo: x.cbo,
    atividade: x.atividade,
    credor: x.credor ?? '',
    documentoCredor: x.documentoCredor ?? '',
  }));
  diagnosticos.value = (d?.diagnosticos ?? []).map((x) => ({
    cid: x.cid,
    tipo: x.tipo,
    classificacao: x.classificacao ?? '',
  }));
  incrementos.value = (d?.incrementos ?? []).map((x) => ({
    habilitacao: x.habilitacao,
    procedimento: x.procedimento ?? '',
    percentual: String(x.percentual).replace('.', ','),
  }));
}
watch(dados, carregar, { immediate: true });

// Opções dos combos: OPM não recebe equipe nem incremento.
const procedimentosComAto = computed(() =>
  (dados.value?.opcoes.procedimentos ?? []).filter((p) => p.tipo !== 'opm'),
);
const opcoesProcedimento = computed(() =>
  procedimentosComAto.value.map((p) => ({
    valor: p.sequencia,
    rotulo: `${p.sequencia}. ${p.codigo} ${p.nome}`,
  })),
);
const opcoesProcedimentoIncremento = computed(() => [
  { valor: '' as const, rotulo: t('aihToda') },
  ...opcoesProcedimento.value,
]);
const codigoDescricao = (xs: readonly { codigo: string; descricao: string }[]) =>
  xs.map((x) => ({ valor: x.codigo, rotulo: `${x.codigo} ${x.descricao}` }));
const opcoesAtividade = computed(() => codigoDescricao(dados.value?.opcoes.atividades ?? []));
const opcoesCredor = computed(() => [
  { valor: '', rotulo: t('hospital') },
  ...codigoDescricao(dados.value?.opcoes.credores ?? []),
]);
const opcoesHabilitacao = computed(() => codigoDescricao(dados.value?.opcoes.habilitacoes ?? []));
const opcoesTipo = TIPOS_DIAGNOSTICO_AIH.map((x) => ({ valor: x, rotulo: t(`tipos.${x}`) }));
const opcoesClassificacao = [
  { valor: '' as const, rotulo: t('semClassificacao') },
  ...CLASSIFICACOES_DIAGNOSTICO_AIH.map((x) => ({ valor: x, rotulo: t(`classificacoes.${x}`) })),
];

const percentualNumero = (v: string) => {
  const n = Number(v.trim().replace(',', '.'));
  return v.trim() === '' || Number.isNaN(n) ? 0 : n;
};
const vazioParaNulo = (v: string) => (v.trim() === '' ? null : v.trim());

// O corpo do PUT, que também é a entrada da conferência na hora.
const corpo = computed(() => ({
  versao: dados.value?.versao ?? 0,
  diagnosticos: diagnosticos.value.map((d) => ({
    cid: d.cid.trim().replace('.', '').toUpperCase(),
    tipo: d.tipo,
    classificacao: d.classificacao === '' ? null : d.classificacao,
  })),
  equipe: equipe.value.map((x) => ({
    procedimento: x.procedimento === '' ? 0 : x.procedimento,
    cns: x.cns.replace(/\D/g, ''),
    cbo: x.cbo.trim().toUpperCase(),
    atividade: x.atividade,
    credor: vazioParaNulo(x.credor),
    documentoCredor: vazioParaNulo(x.documentoCredor.replace(/\D/g, '')),
  })),
  incrementos: incrementos.value.map((x) => ({
    habilitacao: x.habilitacao,
    procedimento: x.procedimento === '' ? null : x.procedimento,
    percentual: percentualNumero(x.percentual),
  })),
}));
const problemas = computed(() =>
  dados.value && editavel.value
    ? conferirComplementoAih(corpo.value, {
        situacaoConta: dados.value.situacaoConta,
        cidPrincipal: props.cidPrincipal,
        procedimentos: dados.value.opcoes.procedimentos.map((p) => ({
          sequencia: p.sequencia,
          tipo: p.tipo,
        })),
        habilitacoes: new Set(dados.value.opcoes.habilitacoes.map((h) => h.codigo)),
      })
    : [],
);
const problemasDe = (prefixo: string) =>
  problemas.value.filter((p) => p.campo === prefixo || p.campo.startsWith(`${prefixo}.`));
const linhaComProblema = (lista: Aba, i: number) => problemas.value.some((p) => p.campo === `${lista}.${i}`);
const quantidade = (a: Aba) =>
  a === 'equipe'
    ? equipe.value.length
    : a === 'diagnosticos'
      ? diagnosticos.value.length
      : incrementos.value.length;

const valorGravado = (x: LinhaIncremento) => {
  const g = dados.value?.incrementos.find(
    (i) => i.habilitacao === x.habilitacao && (i.procedimento ?? '') === x.procedimento,
  );
  return g ? g.valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
};

function incluirProfissional(): void {
  equipe.value.push({
    procedimento: procedimentosComAto.value[0]?.sequencia ?? '',
    cns: '',
    cbo: '',
    atividade: '',
    credor: '',
    documentoCredor: '',
  });
}
function incluirDiagnostico(): void {
  diagnosticos.value.push({ cid: '', tipo: 'secundario', classificacao: '' });
}
function incluirIncremento(): void {
  incrementos.value.push({
    habilitacao: dados.value?.opcoes.habilitacoes[0]?.codigo ?? '',
    procedimento: '',
    percentual: '',
  });
}

const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function gravar(): Promise<void> {
  if (problemas.value.length || !dados.value) return;
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await gravarComplementoAih(props.aih, corpo.value);
    mensagem.value = t('gravado', { conta: r.conta });
    await cliente.invalidateQueries({ queryKey: ['sus', 'aih'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section aria-labelledby="aih-complemento-titulo" data-testid="aih-complemento">
    <h3 id="aih-complemento-titulo">{{ t('titulo') }}</h3>
    <p class="pequeno">{{ t('resumo') }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!dados" aria-live="polite">{{ t('carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!dados.editavel"
        :texto="t('somenteLeitura', { situacao: dados.situacaoConta })"
        variante="info"
        data-testid="aih-complemento-somente-leitura"
      />
      <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" data-testid="aih-complemento-mensagem" />
      <MensagemErro v-if="erro" :erro="erro" />

      <div class="abas" role="tablist" :aria-label="t('titulo')">
        <button
          v-for="a in ABAS"
          :id="`aih-complemento-aba-${a}`"
          :key="a"
          type="button"
          role="tab"
          class="aba"
          :class="{ 'aba--ativa': aba === a, 'aba--problema': problemasDe(a).length > 0 }"
          :aria-selected="aba === a"
          :aria-controls="`aih-complemento-painel-${a}`"
          :data-testid="`aih-complemento-aba-${a}`"
          @click="aba = a"
        >
          {{ t(`abas.${a}`, { n: quantidade(a) }) }}
        </button>
      </div>

      <!-- Equipe -->
      <div
        v-show="aba === 'equipe'"
        id="aih-complemento-painel-equipe"
        role="tabpanel"
        aria-labelledby="aih-complemento-aba-equipe"
        data-testid="aih-complemento-equipe"
      >
        <p v-if="!equipe.length">{{ t('semEquipe') }}</p>
        <template v-if="editavel">
          <fieldset
            v-for="(x, i) in equipe"
            :key="i"
            class="linha"
            :class="{ 'linha--problema': linhaComProblema('equipe', i) }"
            :data-testid="`aih-equipe-${i}`"
          >
            <SanteSelecao
              v-model="x.procedimento"
              :rotulo="t('procedimento')"
              :opcoes="opcoesProcedimento"
              :data-testid="`aih-equipe-procedimento-${i}`"
            />
            <SanteCampoTexto
              v-model="x.cns"
              :rotulo="t('cns')"
              :max-bytes="15"
              :data-testid="`aih-equipe-cns-${i}`"
            />
            <SanteCampoTexto
              v-model="x.cbo"
              :rotulo="t('cbo')"
              :max-bytes="6"
              :data-testid="`aih-equipe-cbo-${i}`"
            />
            <SanteSelecao
              v-model="x.atividade"
              :rotulo="t('atividade')"
              :opcoes="opcoesAtividade"
              :data-testid="`aih-equipe-atividade-${i}`"
            />
            <SanteSelecao
              v-model="x.credor"
              :rotulo="t('credor')"
              :opcoes="opcoesCredor"
              :data-testid="`aih-equipe-credor-${i}`"
            />
            <SanteCampoTexto
              v-if="x.credor !== ''"
              v-model="x.documentoCredor"
              :rotulo="t('documentoCredor')"
              :max-bytes="18"
              :data-testid="`aih-equipe-documento-${i}`"
            />
            <SanteBotao
              :rotulo="t('retirarLinha', { n: i + 1 })"
              variante="texto"
              :data-testid="`aih-equipe-retirar-${i}`"
              @acionar="equipe.splice(i, 1)"
            />
          </fieldset>
          <SanteBotao
            :rotulo="t('incluirProfissional')"
            variante="secundario"
            :desabilitado="!procedimentosComAto.length"
            data-testid="aih-equipe-incluir"
            @acionar="incluirProfissional"
          />
        </template>
        <table v-else-if="dados.equipe.length" data-testid="aih-equipe-tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('procedimento') }}</th>
              <th scope="col">{{ t('cns') }}</th>
              <th scope="col">{{ t('cbo') }}</th>
              <th scope="col">{{ t('atividade') }}</th>
              <th scope="col">{{ t('credor') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(x, i) in dados.equipe" :key="i">
              <td>{{ x.procedimento }}. {{ x.codigoProcedimento }}</td>
              <td>
                {{ x.cns }} <span class="pequeno">{{ x.nome ?? '' }}</span>
              </td>
              <td>{{ x.cbo }}</td>
              <td>{{ x.atividade }}</td>
              <td>{{ x.credor ?? t('hospital') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Diagnósticos secundários -->
      <div
        v-show="aba === 'diagnosticos'"
        id="aih-complemento-painel-diagnosticos"
        role="tabpanel"
        aria-labelledby="aih-complemento-aba-diagnosticos"
        data-testid="aih-complemento-diagnosticos"
      >
        <p v-if="!diagnosticos.length">{{ t('semDiagnosticos') }}</p>
        <template v-if="editavel">
          <fieldset
            v-for="(d, i) in diagnosticos"
            :key="i"
            class="linha"
            :class="{ 'linha--problema': linhaComProblema('diagnosticos', i) }"
            :data-testid="`aih-diagnostico-${i}`"
          >
            <SanteCampoTexto
              v-model="d.cid"
              :rotulo="t('cid')"
              :max-bytes="6"
              :data-testid="`aih-diagnostico-cid-${i}`"
            />
            <SanteSelecao
              v-model="d.tipo"
              :rotulo="t('tipo')"
              :opcoes="opcoesTipo"
              :data-testid="`aih-diagnostico-tipo-${i}`"
            />
            <SanteSelecao
              v-model="d.classificacao"
              :rotulo="t('classificacao')"
              :opcoes="opcoesClassificacao"
              :data-testid="`aih-diagnostico-classificacao-${i}`"
            />
            <SanteBotao
              :rotulo="t('retirarLinha', { n: i + 1 })"
              variante="texto"
              :data-testid="`aih-diagnostico-retirar-${i}`"
              @acionar="diagnosticos.splice(i, 1)"
            />
          </fieldset>
          <SanteBotao
            :rotulo="t('incluirDiagnostico')"
            variante="secundario"
            data-testid="aih-diagnostico-incluir"
            @acionar="incluirDiagnostico"
          />
        </template>
        <ul v-else-if="dados.diagnosticos.length" data-testid="aih-diagnosticos-lista">
          <li v-for="(d, i) in dados.diagnosticos" :key="i">
            {{ d.cid }} · {{ t(`tipos.${d.tipo}`) }}
            <span v-if="d.classificacao" class="pequeno">({{ t(`classificacoes.${d.classificacao}`) }})</span>
          </li>
        </ul>
      </div>

      <!-- Incrementos -->
      <div
        v-show="aba === 'incrementos'"
        id="aih-complemento-painel-incrementos"
        role="tabpanel"
        aria-labelledby="aih-complemento-aba-incrementos"
        data-testid="aih-complemento-incrementos"
      >
        <p v-if="!incrementos.length">{{ t('semIncrementos') }}</p>
        <template v-if="editavel">
          <p
            v-if="!dados.opcoes.habilitacoes.length"
            class="pequeno"
            data-testid="aih-incremento-sem-habilitacao"
          >
            {{ t('semHabilitacao') }}
          </p>
          <fieldset
            v-for="(x, i) in incrementos"
            :key="i"
            class="linha"
            :class="{ 'linha--problema': linhaComProblema('incrementos', i) }"
            :data-testid="`aih-incremento-${i}`"
          >
            <SanteSelecao
              v-model="x.habilitacao"
              :rotulo="t('habilitacao')"
              :opcoes="opcoesHabilitacao"
              :data-testid="`aih-incremento-habilitacao-${i}`"
            />
            <SanteSelecao
              v-model="x.procedimento"
              :rotulo="t('procedimento')"
              :opcoes="opcoesProcedimentoIncremento"
              :data-testid="`aih-incremento-procedimento-${i}`"
            />
            <SanteCampoTexto
              v-model="x.percentual"
              :rotulo="t('percentual')"
              :max-bytes="8"
              :data-testid="`aih-incremento-percentual-${i}`"
            />
            <span class="pequeno">{{ t('valor') }}: {{ valorGravado(x) }}</span>
            <SanteBotao
              :rotulo="t('retirarLinha', { n: i + 1 })"
              variante="texto"
              :data-testid="`aih-incremento-retirar-${i}`"
              @acionar="incrementos.splice(i, 1)"
            />
          </fieldset>
          <SanteBotao
            :rotulo="t('incluirIncremento')"
            variante="secundario"
            :desabilitado="!dados.opcoes.habilitacoes.length"
            data-testid="aih-incremento-incluir"
            @acionar="incluirIncremento"
          />
        </template>
        <table v-else-if="dados.incrementos.length" data-testid="aih-incrementos-tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('habilitacao') }}</th>
              <th scope="col">{{ t('procedimento') }}</th>
              <th scope="col">{{ t('percentual') }}</th>
              <th scope="col">{{ t('valor') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(x, i) in dados.incrementos" :key="i">
              <td>
                {{ x.habilitacao }} <span class="pequeno">{{ x.descricao ?? '' }}</span>
              </td>
              <td>{{ x.procedimento ?? t('aihToda') }}</td>
              <td>{{ x.percentual.toLocaleString('pt-BR') }}</td>
              <td>{{ x.valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <template v-if="editavel">
        <section v-if="problemas.length" aria-live="polite" data-testid="aih-complemento-problemas">
          <p>{{ t('problemas', { n: problemas.length }) }}</p>
          <ul>
            <li v-for="(p, k) in problemas" :key="k">{{ p.mensagem }}</li>
          </ul>
        </section>
        <SanteBotao
          :rotulo="t('gravar')"
          :desabilitado="ocupado || problemas.length > 0"
          data-testid="aih-complemento-gravar"
          @acionar="gravar"
        />
      </template>
    </template>
  </section>
</template>

<style scoped>
.abas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  margin-block: var(--sgh-espaco-2);
}
.aba {
  padding: var(--sgh-espaco-1) var(--sgh-espaco-3);
  border: 1px solid var(--sgh-borda);
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
  cursor: pointer;
}
.aba--ativa {
  border-color: var(--sgh-primaria);
  font-weight: 600;
}
.aba--problema {
  border-color: var(--sgh-alerta);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--sgh-espaco-2);
  margin-block: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
}
.linha--problema {
  border-color: var(--sgh-alerta);
}
</style>
