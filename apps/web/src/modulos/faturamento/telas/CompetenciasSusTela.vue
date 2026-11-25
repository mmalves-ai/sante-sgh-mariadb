<script setup lang="ts">
// Competência SUS e críticas (M51, etapa 1; ficha, seção 7) — `Faturamento > Faturamento SUS > CIHA`: as competências
// por instrumento (filtro de instrumento e de situação com SanteSelecao, ADR 0027), abrir a competência, rodar a
// crítica prévia, fechar (supervisor) e reabrir com justificativa; no detalhe, as críticas paginadas no servidor, com
// os filtros de regra, gravidade e situação, a justificativa do aviso, o registro do equivalente SIGTAP e o atalho para
// a conta do paciente. BPA, APAC e AIH aparecem desligados por estabelecimento (DP-35). Sem dado pessoal na tela.
import {
  type CompetenciaSusResumo,
  type CriticaSusLida,
  GRAVIDADES_CRITICA_SUS,
  type GravidadeCriticaSus,
  INSTRUMENTOS_SUS,
  type InstrumentoSus,
  REGRAS_CRITICA_SUS,
  type RegraCriticaSus,
  SITUACOES_COMPETENCIA_SUS,
  SITUACOES_CRITICA_SUS,
  type SituacaoCriticaSus,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { carimboBr } from '../../cadastro/formato.js';
import PaginacaoCadastro from '../../cadastro/componentes/PaginacaoCadastro.vue';
import {
  abrirCompetenciaSus,
  criticarSus,
  fecharCompetenciaSus,
  justificarCriticaSus,
  lerCompetenciasSus,
  lerCriticasSus,
  reabrirCompetenciaSus,
} from '../api-sus.js';
import EquivalenciaSusDialogo from '../componentes/EquivalenciaSusDialogo.vue';
import JustificativaSusDialogo from '../componentes/JustificativaSusDialogo.vue';
import MinhaCompetenciaTrabalho from '../../tiss/componentes/MinhaCompetenciaTrabalho.vue';
import { lerCompetenciaTrabalho } from '../../tiss/api-competencia-trabalho.js';

const POR_PAGINA = 25;
const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const instrumentoInicial = String(rota.query['instrumento'] ?? 'ciha');
const instrumento = ref<InstrumentoSus>(
  (INSTRUMENTOS_SUS as readonly string[]).includes(instrumentoInicial)
    ? (instrumentoInicial as InstrumentoSus)
    : 'ciha',
);
const situacao = ref<'' | 'aberta' | 'fechada'>('');
const selecionada = ref<string | null>(rota.query['competencia'] ? String(rota.query['competencia']) : null);
const novaCompetencia = ref('');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

// A competência de trabalho do faturista: BPA e APAC são do SUS ambulatorial; AIH e CIHA, da internação. A escolhida
// (AAAA-MM, convertida para a AAAAMM do SUS) abre selecionada; a que o usuário selecionou à mão não é trocada. A
// leitura usa a mesma chave do painel (uma consulta só).
const moduloTrabalho = computed(() =>
  instrumento.value === 'bpa' || instrumento.value === 'apac' ? 'sus_ambulatorial' : 'sus_internacao',
);
const trabalho = useQuery({
  queryKey: computed(() => ['tiss', 'competencia-trabalho', moduloTrabalho.value]),
  queryFn: () => lerCompetenciaTrabalho(moduloTrabalho.value),
});
const competenciaTrabalho = computed(() => trabalho.data.value?.competencia?.replace('-', '') ?? null);
watch(
  competenciaTrabalho,
  (nova, velha) => {
    if (selecionada.value === null || selecionada.value === velha) selecionada.value = nova;
  },
  { immediate: true },
);
const lista = useQuery({
  queryKey: computed(() => ['sus', 'competencias', instrumento.value]),
  queryFn: () => lerCompetenciasSus(instrumento.value),
});
const dados = computed(() => lista.data.value);
const liberado = computed(
  () => dados.value?.instrumentos.find((x) => x.instrumento === instrumento.value)?.liberado ?? false,
);
const competencias = computed(() =>
  (dados.value?.competencias ?? []).filter((c) => !situacao.value || c.situacao === situacao.value),
);
const atual = computed<CompetenciaSusResumo | null>(
  () => dados.value?.competencias.find((c) => c.competencia === selecionada.value) ?? null,
);
const escopoParcial = computed(() => dados.value?.escopoParcial ?? false);

const opcoesInstrumento = computed(() =>
  INSTRUMENTOS_SUS.map((i) => ({ valor: i, rotulo: t(`faturamentoSus.instrumentos.${i}`) })),
);
const opcoesSituacao = computed(() => [
  { valor: '' as const, rotulo: t('faturamentoSus.competencias.todas') },
  ...SITUACOES_COMPETENCIA_SUS.map((s) => ({
    valor: s,
    rotulo: t(`faturamentoSus.situacoesCompetencia.${s}`),
  })),
]);

// ── Críticas da competência selecionada ───────────────────────────────────────────────────────────────
const regra = ref<RegraCriticaSus | ''>('');
const gravidade = ref<GravidadeCriticaSus | ''>('');
const situacaoCritica = ref<SituacaoCriticaSus>('aberta');
const pagina = ref(1);
watch([regra, gravidade, situacaoCritica, selecionada, instrumento], () => (pagina.value = 1));
watch(instrumento, () => (selecionada.value = competenciaTrabalho.value));
const criticas = useQuery({
  queryKey: computed(() => [
    'sus',
    'criticas',
    instrumento.value,
    selecionada.value,
    regra.value,
    gravidade.value,
    situacaoCritica.value,
    pagina.value,
  ]),
  queryFn: () =>
    lerCriticasSus({
      instrumento: instrumento.value,
      competencia: selecionada.value as string,
      ...(regra.value ? { regra: regra.value } : {}),
      ...(gravidade.value ? { gravidade: gravidade.value } : {}),
      situacao: situacaoCritica.value,
      pagina: pagina.value - 1,
      porPagina: POR_PAGINA,
    }),
  enabled: computed(() => selecionada.value !== null && atual.value !== null),
});
const pagCriticas = computed(() => criticas.data.value);
const opcoesRegra = computed(() => [
  { valor: '' as const, rotulo: t('faturamentoSus.competencias.todas') },
  ...REGRAS_CRITICA_SUS.map((r) => ({ valor: r, rotulo: t(`faturamentoSus.criticas.regras.${r}`) })),
]);
const opcoesGravidade = computed(() => [
  { valor: '' as const, rotulo: t('faturamentoSus.competencias.todas') },
  ...GRAVIDADES_CRITICA_SUS.map((g) => ({ valor: g, rotulo: t(`faturamentoSus.gravidades.${g}`) })),
]);
const opcoesSituacaoCritica = computed(() =>
  SITUACOES_CRITICA_SUS.map((s) => ({ valor: s, rotulo: t(`faturamentoSus.situacoesCritica.${s}`) })),
);

const podeAbrir = computed(() => pode('faturamento.sus.abrirCompetencia') && liberado.value);
const podeFechar = computed(
  () => pode('faturamento.sus.fecharCompetencia') && liberado.value && !escopoParcial.value,
);
const podeReabrir = computed(
  () => pode('faturamento.sus.reabrirCompetencia') && liberado.value && !escopoParcial.value,
);
const podeJustificar = computed(() => pode('faturamento.sus.justificarCritica'));
// A equivalência vale para todos os convênios do estabelecimento: com escopo parcial, o botão não aparece.
const podeEquivalencia = computed(() => pode('faturamento.susEquivalencia.editar') && !escopoParcial.value);

async function reler(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['sus'] });
}

async function agir(fn: () => Promise<string>): Promise<void> {
  mensagem.value = null;
  erro.value = null;
  ocupado.value = true;
  try {
    mensagem.value = await fn();
    await reler();
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

function abrir(): Promise<void> {
  return agir(async () => {
    const c = await abrirCompetenciaSus({
      instrumento: instrumento.value,
      competencia: novaCompetencia.value.trim(),
    });
    selecionada.value = c.competencia;
    novaCompetencia.value = '';
    return t('faturamentoSus.competencias.aberta', { competencia: c.competencia });
  });
}

function criticar(c: CompetenciaSusResumo): Promise<void> {
  return agir(async () => {
    selecionada.value = c.competencia;
    const r = await criticarSus({ instrumento: c.instrumento, competencia: c.competencia });
    return t('faturamentoSus.competencias.criticada', {
      tempo: (r.tempoMs / 1000).toFixed(1),
      registros: r.registros,
      bloqueantes: r.bloqueantes,
      avisos: r.avisos,
      corrigidas: r.corrigidas,
    });
  });
}

function fechar(c: CompetenciaSusResumo): Promise<void> {
  return agir(async () => {
    await fecharCompetenciaSus({ instrumento: c.instrumento, competencia: c.competencia, versao: c.versao });
    return t('faturamentoSus.competencias.fechada', { competencia: c.competencia });
  });
}

const reabrindo = ref<CompetenciaSusResumo | null>(null);
const dialogoReabrir = ref(false);
function pedirReabertura(c: CompetenciaSusResumo): void {
  reabrindo.value = c;
  dialogoReabrir.value = true;
}
async function reabrir(justificativa: string): Promise<void> {
  const c = reabrindo.value;
  if (!c) return;
  await reabrirCompetenciaSus({
    instrumento: c.instrumento,
    competencia: c.competencia,
    versao: c.versao,
    justificativa,
  });
  mensagem.value = t('faturamentoSus.competencias.reaberta', { competencia: c.competencia });
  await reler();
}

const justificando = ref<CriticaSusLida | null>(null);
const dialogoJustificar = ref(false);
function pedirJustificativa(c: CriticaSusLida): void {
  justificando.value = c;
  dialogoJustificar.value = true;
}
async function justificar(texto: string): Promise<void> {
  const c = justificando.value;
  if (!c) return;
  await justificarCriticaSus({ critica: c.id, versao: c.versao, justificativa: texto });
  mensagem.value = t('faturamentoSus.criticas.justificada');
  await reler();
}

const dialogoEquivalencia = ref(false);
const procedimentoEquivalencia = ref<number | null>(null);
function pedirEquivalencia(c: CriticaSusLida): void {
  const d = c.detalhe;
  const lista = typeof d['procedimentos'] === 'string' ? d['procedimentos'].split(',') : [];
  const p = typeof d['procedimento'] === 'number' ? d['procedimento'] : Number(lista[0] ?? 0);
  procedimentoEquivalencia.value = p > 0 ? p : null;
  dialogoEquivalencia.value = true;
}
function equivalenciaRegistrada(mudou: boolean): void {
  mensagem.value = mudou
    ? t('faturamentoSus.equivalencias.registrada')
    : t('faturamentoSus.equivalencias.semMudanca');
  void reler();
}

const REGRAS_DE_EQUIVALENCIA: ReadonlySet<string> = new Set([
  'sem-sigtap',
  'item-sem-sigtap',
  'sigtap-fora-da-competencia',
]);
const REGRAS_DO_PACIENTE: ReadonlySet<string> = new Set([
  'sem-identificacao',
  'cns-invalido',
  'cpf-invalido',
  'dado-minimo-ausente',
  'sem-cid-principal',
  'cid-invalido',
  'sexo-incompativel',
  'idade-incompativel',
  // Etapa 2 (BPA): o CNS do paciente, o CID e o executante do item corrigem-se na conta (ou no cadastro do paciente).
  'sem-cns-paciente',
  'cid-incompativel',
  'sem-cbo',
  'cbo-incompativel',
  'profissional-sem-identificacao',
]);

/** O detalhe técnico da crítica em texto (campo, código SIGTAP, CID, procedimentos do hospital). */
function detalheTexto(c: CriticaSusLida): string {
  const d = c.detalhe;
  const partes: string[] = [];
  if (typeof d['campo'] === 'string')
    partes.push(
      t('faturamentoSus.criticas.campoAusente', { campo: t(`faturamentoSus.criticas.campos.${d['campo']}`) }),
    );
  if (d['sigtap'] !== undefined && d['sigtap'] !== null)
    partes.push(t('faturamentoSus.criticas.sigtap', { codigo: String(d['sigtap']) }));
  if (typeof d['cid'] === 'string') partes.push(t('faturamentoSus.criticas.cid', { cid: d['cid'] }));
  if (typeof d['procedimentosNomes'] === 'string')
    partes.push(t('faturamentoSus.criticas.procedimentos', { lista: d['procedimentosNomes'] }));
  return partes.join(' · ');
}

function origemTexto(c: CriticaSusLida): string {
  if (c.origem.conta === null) return t('faturamentoSus.criticas.estabelecimento');
  const partes = [t('faturamentoSus.criticas.conta', { conta: c.origem.conta })];
  if (c.origem.atendimento !== null)
    partes.push(t('faturamentoSus.criticas.atendimento', { atendimento: c.origem.atendimento }));
  if (c.origem.item !== null) partes.push(t('faturamentoSus.criticas.item', { item: c.origem.item }));
  return partes.join(', ');
}
</script>

<template>
  <section class="tela" aria-labelledby="sus-competencias-titulo" data-testid="tela-competencias-sus">
    <h1 id="sus-competencias-titulo">{{ t('faturamentoSus.competencias.titulo') }}</h1>
    <p>
      <RouterLink to="/faturamento/sus/ciha">{{ t('faturamentoSus.competencias.irCiha') }}</RouterLink>
      ·
      <RouterLink to="/faturamento/sus/bpa">{{ t('faturamentoSus.competencias.irBpa') }}</RouterLink>
      ·
      <RouterLink to="/faturamento/sus/apac">{{ t('faturamentoSus.competencias.irApac') }}</RouterLink>
      <RouterLink to="/faturamento/sus/aih">{{ t('faturamentoSus.competencias.irAih') }}</RouterLink>
    </p>
    <SanteAlerta
      v-if="escopoParcial"
      :texto="t('faturamentoSus.competencias.escopoParcial')"
      variante="info"
    />
    <MinhaCompetenciaTrabalho :modulo="moduloTrabalho" />
    <div class="barra">
      <SanteSelecao
        v-model="instrumento"
        :rotulo="t('faturamentoSus.competencias.filtroInstrumento')"
        :opcoes="opcoesInstrumento"
        data-testid="filtro-instrumento-sus"
      />
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('faturamentoSus.competencias.filtroSituacao')"
        :opcoes="opcoesSituacao"
      />
      <form v-if="podeAbrir" class="linha" data-testid="form-abrir-competencia-sus" @submit.prevent="abrir">
        <SanteCampoTexto
          v-model="novaCompetencia"
          :rotulo="t('faturamentoSus.competencias.nova')"
          :max-bytes="6"
          data-testid="nova-competencia-sus"
        />
        <SanteBotao
          :rotulo="t('faturamentoSus.competencias.abrir')"
          tipo="submit"
          :desabilitado="ocupado || !/^\d{6}$/.test(novaCompetencia.trim())"
          data-testid="botao-abrir-competencia-sus"
        />
      </form>
    </div>
    <p v-if="podeAbrir" class="pequeno">{{ t('faturamentoSus.competencias.abrirAjuda') }}</p>
    <SanteAlerta
      v-if="dados && !liberado"
      :texto="t('faturamentoSus.competencias.desligado')"
      variante="aviso"
      data-testid="instrumento-sus-desligado"
    />
    <p v-if="mensagem" role="status" data-testid="mensagem-sus">{{ mensagem }}</p>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!dados">{{ t('faturamentoSus.carregando') }}</p>
    <template v-else>
      <p v-if="competencias.length === 0" data-testid="competencias-sus-vazio">
        {{ t('faturamentoSus.competencias.nenhuma') }}
      </p>
      <table v-else data-testid="tabela-competencias-sus">
        <caption>
          {{
            t('faturamentoSus.competencias.lista')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('faturamentoSus.competencias.competencia') }}</th>
            <th scope="col">{{ t('faturamentoSus.competencias.situacao') }}</th>
            <th scope="col">{{ t('faturamentoSus.competencias.registros') }}</th>
            <th scope="col">{{ t('faturamentoSus.competencias.bloqueantes') }}</th>
            <th scope="col">{{ t('faturamentoSus.competencias.avisos') }}</th>
            <th scope="col">{{ t('faturamentoSus.competencias.criticadaEm') }}</th>
            <th scope="col">{{ t('faturamentoSus.competencias.abertaPor') }}</th>
            <th scope="col">{{ t('faturamentoSus.competencias.fechadaPor') }}</th>
            <th scope="col">{{ t('faturamentoSus.criticas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in competencias"
            :key="c.competencia"
            :class="{ selecionada: c.competencia === selecionada }"
            :data-testid="`competencia-sus-${c.competencia}`"
          >
            <td>{{ c.competencia }}</td>
            <td>{{ t(`faturamentoSus.situacoesCompetencia.${c.situacao}`) }}</td>
            <td>{{ c.registros }}</td>
            <td>{{ c.criticasBloqueantes }}</td>
            <td>{{ c.avisos }}</td>
            <td>
              {{ c.criticadaEm ? carimboBr(c.criticadaEm) : t('faturamentoSus.competencias.nuncaCriticada') }}
            </td>
            <td class="pequeno">{{ c.abertaPor }} {{ carimboBr(c.abertaEm) }}</td>
            <td class="pequeno">{{ c.fechadaPor ? `${c.fechadaPor} ${carimboBr(c.fechadaEm)}` : '' }}</td>
            <td>
              <div class="linha">
                <SanteBotao
                  :rotulo="t('faturamentoSus.competencias.selecionar')"
                  variante="texto"
                  :data-testid="`ver-criticas-${c.competencia}`"
                  @acionar="selecionada = c.competencia"
                />
                <SanteBotao
                  v-if="podeAbrir && c.situacao === 'aberta'"
                  :rotulo="t('faturamentoSus.competencias.criticar')"
                  variante="secundario"
                  :desabilitado="ocupado"
                  :data-testid="`criticar-${c.competencia}`"
                  @acionar="criticar(c)"
                />
                <SanteBotao
                  v-if="podeFechar && c.situacao === 'aberta'"
                  :rotulo="t('faturamentoSus.competencias.fechar')"
                  variante="secundario"
                  :desabilitado="
                    ocupado || c.criticadaEm === null || c.criticasBloqueantes > 0 || c.avisos > 0
                  "
                  :data-testid="`fechar-${c.competencia}`"
                  @acionar="fechar(c)"
                />
                <SanteBotao
                  v-if="podeReabrir && c.situacao === 'fechada'"
                  :rotulo="t('faturamentoSus.competencias.reabrir')"
                  variante="secundario"
                  :desabilitado="ocupado"
                  :data-testid="`reabrir-${c.competencia}`"
                  @acionar="pedirReabertura(c)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <section v-if="atual" class="criticas" aria-labelledby="sus-criticas-titulo" data-testid="criticas-sus">
        <h2 id="sus-criticas-titulo">
          {{ t('faturamentoSus.criticas.titulo') }} —
          {{ t('faturamentoSus.competencias.selecionada', { competencia: atual.competencia }) }}
        </h2>
        <p v-if="atual.criticadaEm === null">{{ t('faturamentoSus.competencias.nuncaCriticada') }}</p>
        <dl v-if="pagCriticas && Object.keys(pagCriticas.porRegra).length > 0" class="porRegra">
          <dt>{{ t('faturamentoSus.criticas.porRegra') }}</dt>
          <dd v-for="(n, r) in pagCriticas.porRegra" :key="r">
            {{ t(`faturamentoSus.criticas.regras.${r}`) }}: {{ n }}
          </dd>
        </dl>
        <div class="barra">
          <SanteSelecao
            v-model="regra"
            :rotulo="t('faturamentoSus.criticas.filtroRegra')"
            :opcoes="opcoesRegra"
            busca
            data-testid="filtro-regra-sus"
          />
          <SanteSelecao
            v-model="gravidade"
            :rotulo="t('faturamentoSus.criticas.filtroGravidade')"
            :opcoes="opcoesGravidade"
          />
          <SanteSelecao
            v-model="situacaoCritica"
            :rotulo="t('faturamentoSus.criticas.filtroSituacao')"
            :opcoes="opcoesSituacaoCritica"
            data-testid="filtro-situacao-critica-sus"
          />
        </div>
        <MensagemErro v-if="criticas.isError.value" :erro="criticas.error.value" />
        <template v-else-if="pagCriticas">
          <p v-if="pagCriticas.itens.length === 0" data-testid="criticas-sus-vazio">
            {{ t('faturamentoSus.criticas.nenhuma') }}
          </p>
          <table v-else data-testid="tabela-criticas-sus">
            <caption>
              {{
                t('faturamentoSus.criticas.legenda', { total: pagCriticas.total })
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('faturamentoSus.criticas.regra') }}</th>
                <th scope="col">{{ t('faturamentoSus.criticas.gravidade') }}</th>
                <th scope="col">{{ t('faturamentoSus.criticas.origem') }}</th>
                <th scope="col">{{ t('faturamentoSus.criticas.detalhe') }}</th>
                <th scope="col">{{ t('faturamentoSus.criticas.situacao') }}</th>
                <th scope="col">{{ t('faturamentoSus.criticas.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in pagCriticas.itens" :key="c.id" :data-testid="`critica-sus-${c.regra}`">
                <td>{{ t(`faturamentoSus.criticas.regras.${c.regra}`) }}</td>
                <td>{{ t(`faturamentoSus.gravidades.${c.gravidade}`) }}</td>
                <td>{{ origemTexto(c) }}</td>
                <td>
                  {{ detalheTexto(c) }}
                  <span v-if="c.justificativa" class="pequeno">
                    {{ t('faturamentoSus.criticas.justificativaAtual', { texto: c.justificativa }) }}
                  </span>
                </td>
                <td>{{ t(`faturamentoSus.situacoesCritica.${c.situacao}`) }}</td>
                <td>
                  <div class="linha">
                    <SanteBotao
                      v-if="
                        podeEquivalencia && c.situacao === 'aberta' && REGRAS_DE_EQUIVALENCIA.has(c.regra)
                      "
                      :rotulo="t('faturamentoSus.criticas.corrigirDePara')"
                      variante="texto"
                      :data-testid="`equivalencia-${c.id}`"
                      @acionar="pedirEquivalencia(c)"
                    />
                    <RouterLink
                      v-if="c.origem.conta !== null && REGRAS_DO_PACIENTE.has(c.regra)"
                      :to="`/faturamento/contas/${c.origem.conta}`"
                    >
                      {{ t('faturamentoSus.criticas.corrigirCadastro') }}
                    </RouterLink>
                    <SanteBotao
                      v-if="
                        podeJustificar &&
                        c.situacao === 'aberta' &&
                        c.gravidade === 'aviso' &&
                        atual.situacao === 'aberta'
                      "
                      :rotulo="t('faturamentoSus.criticas.justificar')"
                      variante="texto"
                      :data-testid="`justificar-${c.id}`"
                      @acionar="pedirJustificativa(c)"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <PaginacaoCadastro
            v-model="pagina"
            :total="pagCriticas.total"
            :por-pagina="POR_PAGINA"
            :rotulo="t('faturamentoSus.criticas.titulo')"
          />
        </template>
      </section>
    </template>
    <JustificativaSusDialogo
      v-model:visivel="dialogoReabrir"
      :titulo="t('faturamentoSus.competencias.reabrir')"
      :ajuda="t('faturamentoSus.competencias.justificativaAjuda')"
      :rotulo-acao="t('faturamentoSus.competencias.reabrir')"
      :gravar="reabrir"
    />
    <JustificativaSusDialogo
      v-model:visivel="dialogoJustificar"
      :titulo="t('faturamentoSus.criticas.justificarTitulo')"
      :ajuda="t('faturamentoSus.criticas.justificativaAjuda')"
      :rotulo-acao="t('faturamentoSus.criticas.salvarJustificativa')"
      :gravar="justificar"
    />
    <EquivalenciaSusDialogo
      v-model:visivel="dialogoEquivalencia"
      :procedimento="procedimentoEquivalencia"
      :competencia="selecionada"
      @registrada="equivalenciaRegistrada"
    />
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
caption {
  text-align: left;
  font-weight: 600;
}
tr.selecionada {
  outline: 2px solid var(--sgh-foco, currentColor);
}
.barra,
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.pequeno {
  display: block;
  font-size: var(--sgh-fonte-pequena);
}
.porRegra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.porRegra dd {
  margin: 0;
}
.criticas {
  margin-top: var(--sgh-espaco-3);
}
</style>
