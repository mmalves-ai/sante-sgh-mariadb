<script setup lang="ts">
// Aba Regras de contabilização (M54.1; regra 2 da ficha): a origem e o fato com busca (ADR 0027), as versões publicadas
// (a versão não muda: a correção é uma versão nova com vigência), o editor da nova versão (condições e partidas, com a
// conta do plano ou a da tabela de integração, a mesma do arquivo do escritório contábil, regra 6), a simulação com os
// fatos de uma competência (não grava: contagens por situação, lançamentos, recusas e os totais com as parcelas) e a
// publicação com a justificativa e a senha (`contabil.regra.publicar`, crítica). O servidor confere de novo.
import {
  type ApoioContabil,
  type OrigemLancamento,
  type PlanoContabil,
  type SimulacaoRegra,
  type TipoFato,
  type VersaoRegra,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import SenhaConfirmacao from '../administracao/componentes/SenhaConfirmacao.vue';
import { lerRegras, publicarRegra, simularRegra } from './api-contabil.js';
import {
  CAMPOS_FATO,
  competenciasAte,
  dataBr,
  instante,
  novaPartida,
  novoRascunho,
  opcoesContasAnaliticas,
  problemasDoRascunho,
  reais,
  type RascunhoRegra,
  rotuloCompetencia,
  somaSituacoes,
  ultimaVersao,
} from './comum-contabil.js';

const props = defineProps<{ apoio: ApoioContabil; plano: PlanoContabil; hoje: string }>();
const { t } = useI18n();
const cliente = useQueryClient();

const origem = ref<OrigemLancamento>((props.apoio.origens[0]?.id ?? 3) as OrigemLancamento);
const opcoesOrigem = computed(() =>
  props.apoio.origens.map((o) => ({ valor: o.id as OrigemLancamento, rotulo: o.rotulo })),
);
const tiposDaOrigem = computed(() => props.apoio.tiposFato.filter((x) => x.origem === origem.value));
const tipoFato = ref<TipoFato | null>(null);
watch(
  tiposDaOrigem,
  (l) => {
    if (!l.some((x) => x.codigo === tipoFato.value)) tipoFato.value = l[0]?.codigo ?? null;
  },
  { immediate: true },
);
const opcoesTipo = computed(() => tiposDaOrigem.value.map((x) => ({ valor: x.codigo, rotulo: x.rotulo })));

const regras = useQuery({
  queryKey: computed(() => ['contabil', 'regras', props.plano.empresa, origem.value, tipoFato.value]),
  queryFn: () => lerRegras({ empresa: props.plano.empresa, origem: origem.value, tipoFato: tipoFato.value }),
  enabled: computed(() => tipoFato.value !== null),
});
const versoes = computed<VersaoRegra[]>(() =>
  [...(regras.data.value?.itens ?? [])].sort(
    (a, b) => a.regra.nome.localeCompare(b.regra.nome) || b.regra.versao - a.regra.versao,
  ),
);
const vigencia = (v: VersaoRegra) =>
  v.regra.vigenciaFim
    ? t('contabil.regras.vigenciaEntre', {
        inicio: dataBr(v.regra.vigenciaInicio),
        fim: dataBr(v.regra.vigenciaFim),
      })
    : t('contabil.regras.vigenciaDesde', { inicio: dataBr(v.regra.vigenciaInicio) });

// ── Editor ────────────────────────────────────────────────────────────────────────────────────────
const rascunho = ref<RascunhoRegra | null>(null);
const prioridadeTexto = ref('100');
const simulacao = ref<SimulacaoRegra | null>(null);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const ocupado = ref(false);
const justificativa = ref('');
const senha = ref('');

function abrirEditor(base: VersaoRegra | null) {
  if (!tipoFato.value) return;
  const ultima = base
    ? ultimaVersao(versoes.value, {
        empresa: base.regra.empresa,
        origem: base.regra.origem,
        tipoFato: base.regra.tipoFato,
        nome: base.regra.nome,
      })
    : null;
  rascunho.value = novoRascunho(ultima, {
    empresa: props.plano.empresa,
    origem: origem.value,
    tipoFato: tipoFato.value,
    hoje: props.hoje,
  });
  prioridadeTexto.value = String(rascunho.value.prioridade);
  simulacao.value = null;
  erro.value = null;
  aviso.value = null;
  justificativa.value = '';
  senha.value = '';
}
// Trocou a origem ou o fato: o rascunho de outro fato não vale mais.
watch([origem, tipoFato], () => {
  rascunho.value = null;
  simulacao.value = null;
});

const opcoesContas = computed(() => opcoesContasAnaliticas(props.plano.contas));
const opcoesContaPadrao = computed(() => [
  { valor: null as string | null, rotulo: t('contabil.regras.semContaPadrao') },
  ...opcoesContas.value,
]);
const opcoesCampos = Object.entries(CAMPOS_FATO).map(([valor, rotulo]) => ({ valor, rotulo }));
const opcoesLado = (['D', 'C'] as const).map((v) => ({ valor: v, rotulo: t(`contabil.lados.${v}`) }));
const opcoesModo = computed(() => [
  { valor: 'fixa' as const, rotulo: t('contabil.regras.contaFixa') },
  { valor: 'dePara' as const, rotulo: t('contabil.regras.contaDePara') },
]);
const opcoesBase = computed(() =>
  (['valorFato', 'campo', 'percentual'] as const).map((v) => ({
    valor: v,
    rotulo: t(`contabil.regras.bases.${v}`),
  })),
);
const opcoesCentro = computed(() =>
  (['doFato', 'nenhum'] as const).map((v) => ({ valor: v, rotulo: t(`contabil.regras.centrosCusto.${v}`) })),
);
const opcoesOperador = computed(() =>
  (['igual', 'diferente', 'em', 'maiorQue', 'menorQue'] as const).map((v) => ({
    valor: v,
    rotulo: t(`contabil.regras.operadores.${v}`),
  })),
);
const competencias = competenciasAte(props.hoje, 24);
const competencia = ref(competencias[0]!);
const opcoesCompetencia = competencias.map((c) => ({ valor: c, rotulo: rotuloCompetencia(c) }));

// Troca do modo da conta e da base do valor: a partida muda de forma (união discriminada do contrato).
type Partida = RascunhoRegra['partidas'][number];
function trocarModo(p: Partida, modo: 'fixa' | 'dePara') {
  p.conta = modo === 'fixa' ? { modo, conta: '' } : { modo, campoChave: 'tipoLancamento', contaPadrao: null };
}
function trocarBase(p: Partida, base: 'valorFato' | 'campo' | 'percentual') {
  p.valor =
    base === 'valorFato'
      ? { base }
      : base === 'campo'
        ? { base, campo: 'tipoLancamento' }
        : { base, percentual: 100 };
}
const percentualTexto = (p: Partida) => (p.valor.base === 'percentual' ? String(p.valor.percentual) : '');
function trocarPercentual(p: Partida, s: string) {
  const n = Number(s.replace(',', '.'));
  if (p.valor.base === 'percentual') p.valor = { base: 'percentual', percentual: Number.isFinite(n) ? n : 0 };
}
// Condições: o valor digitado vira número quando é inteiro, e lista quando o operador é "um destes".
const valoresCondicao = ref<string[]>([]);
watch(
  () => rascunho.value?.condicoes.length,
  () => {
    valoresCondicao.value = (rascunho.value?.condicoes ?? []).map((c) =>
      Array.isArray(c.valor) ? c.valor.join(', ') : String(c.valor),
    );
  },
  { immediate: true },
);
const valorDaCondicao = (s: string, operador: string) => {
  const um = (x: string) => (/^-?\d+$/.test(x.trim()) ? Number(x.trim()) : x.trim());
  return operador === 'em'
    ? s
        .split(',')
        .filter((x) => x.trim())
        .map(um)
    : um(s);
};

const problemas = computed(() => {
  const r = rascunho.value;
  if (!r) return [];
  const l = problemasDoRascunho(r);
  if (!/^\d{1,3}$/.test(prioridadeTexto.value)) l.push('prioridade');
  return l;
});
/** A regra que vai ao servidor (prioridade numérica e o valor das condições convertido). */
const regraParaEnviar = () => {
  const r = rascunho.value!;
  return {
    ...r,
    prioridade: Number(prioridadeTexto.value),
    condicoes: r.condicoes.map((c, i) => ({
      ...c,
      valor: valorDaCondicao(valoresCondicao.value[i] ?? '', c.operador),
    })),
  };
};

async function simular() {
  if (!rascunho.value || problemas.value.length) return;
  ocupado.value = true;
  erro.value = null;
  try {
    simulacao.value = await simularRegra(regraParaEnviar(), competencia.value);
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const podePublicar = computed(
  () =>
    props.apoio.podePublicar &&
    !!rascunho.value &&
    problemas.value.length === 0 &&
    justificativa.value.trim().length >= 10 &&
    senha.value.length > 0 &&
    !ocupado.value,
);
async function publicar() {
  if (!podePublicar.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await publicarRegra(regraParaEnviar(), justificativa.value.trim(), senha.value);
    aviso.value = r.mensagem;
    rascunho.value = null;
    simulacao.value = null;
    await cliente.invalidateQueries({ queryKey: ['contabil', 'regras'] });
  } catch (e) {
    erro.value = e;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}
const nomeConta = (codigo: string) => props.plano.contas.find((c) => c.codigo === codigo)?.nome ?? '';
</script>

<template>
  <section class="bloco" aria-labelledby="aba-regras-titulo" data-testid="aba-regras">
    <h2 id="aba-regras-titulo">{{ t('contabil.regras.titulo') }}</h2>
    <p class="secundario">{{ t('contabil.regras.descricao') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" data-testid="regras-aviso" />
    <div class="campos">
      <SanteSelecao
        v-model="origem"
        :rotulo="t('contabil.regras.origem')"
        :opcoes="opcoesOrigem"
        busca
        data-testid="regras-origem"
      />
      <SanteSelecao
        v-model="tipoFato"
        :rotulo="t('contabil.regras.tipoFato')"
        :opcoes="opcoesTipo"
        busca
        data-testid="regras-tipo-fato"
      />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('contabil.regras.novaRegra')"
          :desabilitado="!tipoFato"
          data-testid="regras-nova"
          @acionar="abrirEditor(null)"
        />
      </div>
    </div>
    <p v-if="tiposDaOrigem.length === 0" data-testid="regras-sem-fato">{{ t('contabil.regras.semFato') }}</p>
    <MensagemErro v-else-if="regras.isError.value" :erro="regras.error.value" />
    <p v-else-if="regras.isPending.value" role="status">{{ t('contabil.carregando') }}</p>
    <p v-else-if="versoes.length === 0" data-testid="regras-nenhuma">{{ t('contabil.regras.nenhuma') }}</p>
    <div v-else class="rolagem">
      <table class="tabela" data-testid="tabela-regras">
        <thead>
          <tr>
            <th scope="col">{{ t('contabil.regras.nome') }}</th>
            <th scope="col">{{ t('contabil.regras.versao') }}</th>
            <th scope="col">{{ t('contabil.regras.vigencia') }}</th>
            <th scope="col">{{ t('contabil.regras.prioridade') }}</th>
            <th scope="col">{{ t('contabil.regras.situacao') }}</th>
            <th scope="col">{{ t('contabil.regras.publicadaPor') }}</th>
            <th scope="col">{{ t('contabil.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in versoes" :key="v.id" :data-testid="`regra-${v.id}`">
            <td>{{ v.regra.nome }}</td>
            <td>{{ v.regra.versao }}</td>
            <td>{{ vigencia(v) }}</td>
            <td>{{ v.regra.prioridade }}</td>
            <td>{{ t(`contabil.situacoesRegra.${v.situacao}`) }}</td>
            <td>{{ v.publicadaPor }} · {{ instante(v.publicadaEm) }}</td>
            <td>
              <SanteBotao
                v-if="v.situacao === 'publicada'"
                variante="secundario"
                :rotulo="t('contabil.regras.novaVersao')"
                :data-testid="`regra-nova-versao-${v.id}`"
                @acionar="abrirEditor(v)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <section v-if="rascunho" class="bloco" aria-labelledby="editor-titulo" data-testid="regra-editor">
      <h3 id="editor-titulo">{{ t('contabil.regras.editor', { versao: rascunho.versao }) }}</h3>
      <div class="campos">
        <SanteCampoTexto
          v-model="rascunho.nome"
          :rotulo="t('contabil.regras.nome')"
          :max-bytes="60"
          obrigatorio
          data-testid="regra-nome"
        />
        <SanteData
          v-model="rascunho.vigenciaInicio"
          :rotulo="t('contabil.regras.vigenciaInicio')"
          editavel
          data-testid="regra-inicio"
        />
        <SanteData
          v-model="rascunho.vigenciaFim"
          :rotulo="t('contabil.regras.vigenciaFim')"
          editavel
          data-testid="regra-fim"
        />
        <SanteCampoTexto
          v-model="prioridadeTexto"
          :rotulo="t('contabil.regras.prioridade')"
          :max-bytes="3"
          data-testid="regra-prioridade"
        />
      </div>

      <h4>{{ t('contabil.regras.condicoes') }}</h4>
      <p v-if="rascunho.condicoes.length === 0" class="secundario">{{ t('contabil.regras.semCondicao') }}</p>
      <div
        v-for="(c, i) in rascunho.condicoes"
        :key="`cond-${i}`"
        class="campos"
        :data-testid="`regra-condicao-${i}`"
      >
        <SanteSelecao v-model="c.campo" :rotulo="t('contabil.regras.campo')" :opcoes="opcoesCampos" busca />
        <SanteSelecao
          v-model="c.operador"
          :rotulo="t('contabil.regras.operador')"
          :opcoes="opcoesOperador"
          busca
        />
        <SanteCampoTexto
          v-model="valoresCondicao[i]!"
          :rotulo="t('contabil.regras.valorCondicao')"
          :max-bytes="120"
        />
        <div class="acoes">
          <SanteBotao
            variante="secundario"
            :rotulo="t('contabil.regras.remover')"
            @acionar="rascunho.condicoes.splice(i, 1)"
          />
        </div>
      </div>
      <div class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('contabil.regras.incluirCondicao')"
          :desabilitado="rascunho.condicoes.length >= 10"
          data-testid="regra-incluir-condicao"
          @acionar="rascunho.condicoes.push({ campo: 'tipoLancamento', operador: 'igual', valor: '' })"
        />
      </div>

      <h4>{{ t('contabil.regras.partidas') }}</h4>
      <div
        v-for="(p, i) in rascunho.partidas"
        :key="`partida-${i}`"
        class="bloco"
        :data-testid="`regra-partida-${i}`"
      >
        <div class="campos">
          <SanteSelecao v-model="p.lado" :rotulo="t('contabil.regras.lado')" :opcoes="opcoesLado" busca />
          <SanteSelecao
            :model-value="p.conta.modo"
            :rotulo="t('contabil.regras.modoConta')"
            :opcoes="opcoesModo"
            busca
            @update:model-value="(m: 'fixa' | 'dePara') => trocarModo(p, m)"
          />
          <SanteSelecao
            v-if="p.conta.modo === 'fixa'"
            v-model="p.conta.conta"
            :rotulo="t('contabil.regras.contaFixa')"
            :opcoes="opcoesContas"
            busca
            :data-testid="`regra-partida-conta-${i}`"
          />
          <template v-else>
            <SanteSelecao
              v-model="p.conta.campoChave"
              :rotulo="t('contabil.regras.campoChave')"
              :opcoes="opcoesCampos"
              busca
            />
            <SanteSelecao
              :model-value="p.conta.contaPadrao ?? null"
              :rotulo="t('contabil.regras.contaPadrao')"
              :opcoes="opcoesContaPadrao"
              busca
              @update:model-value="
                (v: string | null) => p.conta.modo === 'dePara' && (p.conta.contaPadrao = v)
              "
            />
          </template>
          <SanteSelecao
            :model-value="p.valor.base"
            :rotulo="t('contabil.regras.base')"
            :opcoes="opcoesBase"
            busca
            @update:model-value="(b: 'valorFato' | 'campo' | 'percentual') => trocarBase(p, b)"
          />
          <SanteSelecao
            v-if="p.valor.base === 'campo'"
            v-model="p.valor.campo"
            :rotulo="t('contabil.regras.campo')"
            :opcoes="opcoesCampos"
            busca
          />
          <SanteCampoTexto
            v-if="p.valor.base === 'percentual'"
            :model-value="percentualTexto(p)"
            :rotulo="t('contabil.regras.percentual')"
            :max-bytes="6"
            @update:model-value="(s: string) => trocarPercentual(p, s)"
          />
          <SanteCampoTexto v-model="p.historico" :rotulo="t('contabil.regras.historico')" :max-bytes="120" />
          <SanteSelecao
            :model-value="p.centroCusto ?? 'nenhum'"
            @update:model-value="(v: 'doFato' | 'nenhum') => (p.centroCusto = v)"
            :rotulo="t('contabil.regras.centroCusto')"
            :opcoes="opcoesCentro"
            busca
          />
        </div>
        <div class="acoes">
          <SanteBotao
            variante="secundario"
            :rotulo="t('contabil.regras.remover')"
            :desabilitado="rascunho.partidas.length <= 2"
            :data-testid="`regra-partida-remover-${i}`"
            @acionar="rascunho.partidas.splice(i, 1)"
          />
        </div>
      </div>
      <div class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('contabil.regras.incluirPartida')"
          :desabilitado="rascunho.partidas.length >= 20"
          data-testid="regra-incluir-partida"
          @acionar="rascunho.partidas.push(novaPartida('C'))"
        />
      </div>

      <ul v-if="problemas.length" class="erro" data-testid="regra-problemas">
        <li v-for="x in problemas" :key="x">{{ t(`contabil.regras.rascunho.${x}`) }}</li>
      </ul>

      <!-- A simulação mostra os fatos um a um: só para quem acompanha os fatos (contabil.fato.ler). -->
      <h4 v-if="apoio.podeVerFatos">{{ t('contabil.regras.simular') }}</h4>
      <div v-if="apoio.podeVerFatos" class="campos">
        <SanteSelecao
          v-model="competencia"
          :rotulo="t('contabil.competencia')"
          :opcoes="opcoesCompetencia"
          busca
          data-testid="regra-competencia"
        />
        <div class="acoes">
          <SanteBotao
            variante="secundario"
            :rotulo="t('contabil.regras.simular')"
            :desabilitado="problemas.length > 0 || ocupado"
            data-testid="regra-simular"
            @acionar="simular"
          />
        </div>
      </div>
      <section
        v-if="simulacao"
        class="bloco"
        aria-labelledby="simulacao-titulo"
        data-testid="regra-simulacao"
      >
        <h4 id="simulacao-titulo">
          {{
            t('contabil.regras.simulacao', {
              contabilizados: simulacao.porSituacao.contabilizado,
              semRegra: simulacao.porSituacao.semRegra,
              semConta: simulacao.porSituacao.semConta,
            })
          }}
        </h4>
        <SanteAlerta
          v-if="simulacao.parcial"
          :texto="t('contabil.regras.simulacaoParcial')"
          variante="aviso"
          data-testid="simulacao-parcial"
        />
        <p data-testid="simulacao-fatos">
          {{
            t('contabil.regras.fatosDaCompetencia', {
              n: simulacao.fatos,
              soma: somaSituacoes(simulacao.porSituacao),
            })
          }}
        </p>
        <ul data-testid="simulacao-situacoes">
          <li v-for="(n, s) in simulacao.porSituacao" :key="s">
            {{ t(`contabil.situacoesFato.${s}`) }}: {{ n }}
          </li>
        </ul>
        <p data-testid="simulacao-totais">
          {{
            t('contabil.regras.totais', {
              debitos: reais(simulacao.totais.debitos),
              creditos: reais(simulacao.totais.creditos),
            })
          }}
          —
          {{
            simulacao.totais.equilibrado
              ? t('contabil.regras.equilibrado')
              : t('contabil.regras.desequilibrado')
          }}
        </p>
        <table v-if="simulacao.totais.parcelas.length" class="tabela" data-testid="simulacao-parcelas">
          <caption>
            {{
              t('contabil.regras.parcelas')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('contabil.regras.lado') }}</th>
              <th scope="col">{{ t('contabil.regras.conta') }}</th>
              <th scope="col">{{ t('contabil.valor') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(x, i) in simulacao.totais.parcelas" :key="`${x.lado}-${x.conta}-${i}`">
              <td>{{ t(`contabil.lados.${x.lado}`) }}</td>
              <td>{{ x.conta }} {{ nomeConta(x.conta) }}</td>
              <td>{{ reais(x.valorCentavos) }}</td>
            </tr>
          </tbody>
        </table>
        <template v-if="simulacao.recusas.length">
          <h4>{{ t('contabil.regras.recusasTitulo', { n: simulacao.recusas.length }) }}</h4>
          <ul data-testid="simulacao-recusas">
            <li v-for="(r, i) in simulacao.recusas.slice(0, 20)" :key="`${r.fato}-${i}`">
              {{ t(`contabil.situacoesFato.${r.situacao}`) }}: {{ r.motivo }}
            </li>
          </ul>
        </template>
        <p v-if="simulacao.problemasDaPublicacao.length === 0" data-testid="simulacao-pode-publicar">
          {{ t('contabil.regras.podePublicar') }}
        </p>
        <template v-else>
          <h4>{{ t('contabil.regras.problemasPublicacao') }}</h4>
          <ul class="erro" data-testid="simulacao-problemas">
            <li v-for="(x, i) in simulacao.problemasDaPublicacao" :key="i">{{ x }}</li>
          </ul>
        </template>
      </section>

      <h4>{{ t('contabil.regras.publicar') }}</h4>
      <p v-if="!apoio.podePublicar" class="secundario" data-testid="regra-sem-publicar">
        {{ t('contabil.regras.semPermissaoPublicar') }}
      </p>
      <template v-else>
        <p class="secundario">{{ t('contabil.regras.publicarAviso') }}</p>
        <SanteCampoTexto
          v-model="justificativa"
          :rotulo="t('contabil.justificativa')"
          :max-bytes="500"
          multilinha
          obrigatorio
          data-testid="regra-justificativa"
        />
        <p class="secundario">{{ t('contabil.justificativaAjuda') }}</p>
        <SenhaConfirmacao v-model="senha" testid="regra-senha" />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('contabil.regras.publicar')"
            :desabilitado="!podePublicar"
            data-testid="regra-publicar"
            @acionar="publicar"
          />
        </div>
      </template>
      <MensagemErro v-if="erro" :erro="erro" />
      <div class="acoes">
        <SanteBotao variante="secundario" :rotulo="t('contabil.cancelar')" @acionar="rascunho = null" />
      </div>
    </section>
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
