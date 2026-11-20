<script setup lang="ts">
// CIHA (M51, etapa 1; ficha, seções 7, 8 e 12) — `Faturamento > Faturamento SUS > CIHA`: a competência da CIHA
// (SanteSelecao), o resumo da crítica, "Gerar arquivo CIHA" (desabilitado com crítica bloqueante, sem crítica, com a
// competência fechada ou sem acesso a todos os convênios), os arquivos gerados com o hash, as linhas, a situação e o
// leiaute, o download (auditado) e as equivalências SIGTAP registradas (com os nomes dos dois procedimentos, busca e
// paginação no servidor, "Alterar" e "Desativar" por linha; só com acesso a todos os convênios, porque a equivalência
// vale para o estabelecimento inteiro). Enquanto a CIHA não for a fonte do envio
// (Funcionalidades), o arquivo é para conferência contra o envio atual (regra 8). Exportação só em arquivo (regra 9).
import { type ArquivoSusLido, type CompetenciaSusResumo, type EquivalenciaSusLida } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { carimboBr } from '../../cadastro/formato.js';
import PaginacaoCadastro from '../../cadastro/componentes/PaginacaoCadastro.vue';
import {
  desativarEquivalenciaSus,
  enderecoArquivoSus,
  gerarCiha,
  lerArquivosSus,
  lerCompetenciasSus,
  lerEquivalenciasSus,
} from '../api-sus.js';
import EquivalenciaSusDialogo from '../componentes/EquivalenciaSusDialogo.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const competencia = ref<string>('');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const gerando = ref(false);

const lista = useQuery({
  queryKey: ['sus', 'competencias', 'ciha'],
  queryFn: () => lerCompetenciasSus('ciha'),
});
const dados = computed(() => lista.data.value);
const competencias = computed(() => dados.value?.competencias ?? []);
watch(competencias, (cs) => {
  if (!competencia.value && cs[0]) competencia.value = cs[0].competencia;
});
const atual = computed<CompetenciaSusResumo | null>(
  () => competencias.value.find((c) => c.competencia === competencia.value) ?? null,
);
const opcoes = computed(() =>
  competencias.value.map((c) => ({
    valor: c.competencia,
    rotulo: `${c.competencia} — ${t(`faturamentoSus.situacoesCompetencia.${c.situacao}`)}`,
  })),
);
const arquivos = useQuery({
  queryKey: computed(() => ['sus', 'arquivos', 'ciha', competencia.value]),
  queryFn: () => lerArquivosSus('ciha', competencia.value),
  enabled: computed(() => competencia.value !== ''),
});
const POR_PAGINA_EQ = 50;
const termoEq = ref('');
const filtroEq = ref('');
const inativasEq = ref<'nao' | 'sim'>('nao');
const paginaEq = ref(1);
watch([filtroEq, inativasEq], () => (paginaEq.value = 1));
const equivalencias = useQuery({
  queryKey: computed(() => ['sus', 'equivalencias', filtroEq.value, inativasEq.value, paginaEq.value]),
  queryFn: () =>
    lerEquivalenciasSus({
      ...(filtroEq.value ? { termo: filtroEq.value } : {}),
      inativas: inativasEq.value,
      pagina: paginaEq.value - 1,
      porPagina: POR_PAGINA_EQ,
    }),
});
const opcoesInativas = computed(() => [
  { valor: 'nao' as const, rotulo: t('faturamentoSus.equivalencias.ativa') },
  { valor: 'sim' as const, rotulo: t('faturamentoSus.equivalencias.mostrarInativas') },
]);
function filtrarEquivalencias(): void {
  filtroEq.value = termoEq.value.trim();
}

const podeGerar = computed(() => pode('faturamento.susCiha.gerar'));
const podeEquivalencia = computed(
  () => pode('faturamento.susEquivalencia.editar') && !(dados.value?.escopoParcial ?? true),
);
const pronta = computed(
  () =>
    atual.value !== null &&
    atual.value.situacao === 'aberta' &&
    atual.value.criticadaEm !== null &&
    atual.value.criticasBloqueantes === 0,
);
const fonteDoEnvio = computed(() => dados.value?.cihaFonteDoEnvio ?? false);

async function gerar(): Promise<void> {
  const c = atual.value;
  if (!c) return;
  mensagem.value = null;
  erro.value = null;
  gerando.value = true;
  try {
    const r = await gerarCiha({ competencia: c.competencia, versao: c.versao });
    mensagem.value = t('faturamentoSus.ciha.gerado', {
      tempo: (r.tempoMs / 1000).toFixed(1),
      registros: r.arquivo.registros,
      linhas: r.arquivo.linhas,
    });
    await cliente.invalidateQueries({ queryKey: ['sus'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gerando.value = false;
  }
}

const dialogoEquivalencia = ref(false);
const procedimentoEquivalencia = ref<number | null>(null);
function novaEquivalencia(): void {
  procedimentoEquivalencia.value = null;
  dialogoEquivalencia.value = true;
}
function alterarEquivalencia(x: EquivalenciaSusLida): void {
  procedimentoEquivalencia.value = x.procedimento;
  dialogoEquivalencia.value = true;
}
const paraDesativar = ref<EquivalenciaSusLida | null>(null);
const dialogoDesativar = computed({
  get: () => paraDesativar.value !== null,
  set: (v: boolean) => {
    if (!v) paraDesativar.value = null;
  },
});
async function desativar(): Promise<void> {
  const x = paraDesativar.value;
  if (!x) return;
  mensagem.value = null;
  erro.value = null;
  try {
    await desativarEquivalenciaSus({ procedimento: x.procedimento, versao: x.versao });
    mensagem.value = t('faturamentoSus.equivalencias.desativadaOk');
    await cliente.invalidateQueries({ queryKey: ['sus'] });
  } catch (e) {
    erro.value = e;
  } finally {
    paraDesativar.value = null;
  }
}
const nomeProcedimento = (x: EquivalenciaSusLida) =>
  `${x.procedimentoCodigo ?? x.procedimento} ${x.procedimentoNome ?? ''}`.trim();
function equivalenciaRegistrada(mudou: boolean): void {
  mensagem.value = mudou
    ? t('faturamentoSus.equivalencias.registrada')
    : t('faturamentoSus.equivalencias.semMudanca');
  void cliente.invalidateQueries({ queryKey: ['sus'] });
}

const situacaoArquivo = (a: ArquivoSusLido) => t(`faturamentoSus.ciha.situacoes.${a.situacao}`);
</script>

<template>
  <section class="tela" aria-labelledby="ciha-titulo" data-testid="tela-ciha">
    <h1 id="ciha-titulo">{{ t('faturamentoSus.ciha.titulo') }}</h1>
    <p>{{ t('faturamentoSus.ciha.explicacao') }}</p>
    <p class="pequeno">{{ t('faturamentoSus.ciha.envio') }}</p>
    <SanteAlerta
      v-if="dados"
      :texto="fonteDoEnvio ? t('faturamentoSus.ciha.fonteDoEnvio') : t('faturamentoSus.ciha.paraConferencia')"
      :variante="fonteDoEnvio ? 'info' : 'aviso'"
      data-testid="ciha-fonte-do-envio"
    />
    <SanteAlerta
      v-if="dados?.escopoParcial"
      :texto="t('faturamentoSus.competencias.escopoParcial')"
      variante="info"
    />
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!dados">{{ t('faturamentoSus.carregando') }}</p>
    <template v-else>
      <p v-if="competencias.length === 0" data-testid="ciha-sem-competencia">
        {{ t('faturamentoSus.ciha.semCompetencia') }}
        <RouterLink to="/faturamento/sus/competencias?instrumento=ciha">
          {{ t('faturamentoSus.ciha.irCriticas') }}
        </RouterLink>
      </p>
      <template v-else>
        <div class="barra">
          <SanteSelecao
            v-model="competencia"
            :rotulo="t('faturamentoSus.ciha.escolha')"
            :opcoes="opcoes"
            data-testid="ciha-competencia"
          />
          <RouterLink :to="`/faturamento/sus/competencias?instrumento=ciha&competencia=${competencia}`">
            {{ t('faturamentoSus.ciha.irCriticas') }}
          </RouterLink>
        </div>
        <section v-if="atual" aria-labelledby="ciha-resumo-titulo" data-testid="ciha-resumo">
          <h2 id="ciha-resumo-titulo">{{ t('faturamentoSus.ciha.resumo') }}</h2>
          <dl class="resumo">
            <dt>{{ t('faturamentoSus.ciha.registros') }}</dt>
            <dd>{{ atual.registros }}</dd>
            <dt>{{ t('faturamentoSus.competencias.bloqueantes') }}</dt>
            <dd>{{ atual.criticasBloqueantes }}</dd>
            <dt>{{ t('faturamentoSus.competencias.avisos') }}</dt>
            <dd>{{ atual.avisos }}</dd>
            <dt>{{ t('faturamentoSus.competencias.criticadaEm') }}</dt>
            <dd>{{ atual.criticadaEm ? carimboBr(atual.criticadaEm) : '—' }}</dd>
          </dl>
          <p v-if="atual.criticadaEm === null">{{ t('faturamentoSus.ciha.semCritica') }}</p>
          <p v-else-if="atual.criticasBloqueantes > 0">
            {{ t('faturamentoSus.ciha.bloqueada', { n: atual.criticasBloqueantes }) }}
          </p>
          <p v-else-if="atual.situacao === 'aberta'">{{ t('faturamentoSus.ciha.pronta') }}</p>
          <div class="linha">
            <SanteBotao
              v-if="podeGerar"
              :rotulo="t('faturamentoSus.ciha.gerar')"
              :desabilitado="gerando || !pronta || dados.escopoParcial"
              data-testid="botao-gerar-ciha"
              @acionar="gerar"
            />
            <SanteBotao
              v-if="podeEquivalencia"
              :rotulo="t('faturamentoSus.equivalencias.registrar')"
              variante="secundario"
              data-testid="botao-nova-equivalencia"
              @acionar="novaEquivalencia"
            />
          </div>
        </section>
        <p v-if="mensagem" role="status" data-testid="mensagem-ciha">{{ mensagem }}</p>
        <ErroFaturamento v-if="erro" :erro="erro" />

        <section aria-labelledby="ciha-arquivos-titulo">
          <h2 id="ciha-arquivos-titulo">{{ t('faturamentoSus.ciha.arquivos') }}</h2>
          <MensagemErro v-if="arquivos.isError.value" :erro="arquivos.error.value" />
          <p v-else-if="(arquivos.data.value ?? []).length === 0" data-testid="ciha-sem-arquivo">
            {{ t('faturamentoSus.ciha.nenhumArquivo') }}
          </p>
          <table v-else data-testid="tabela-arquivos-ciha">
            <thead>
              <tr>
                <th scope="col">{{ t('faturamentoSus.ciha.nome') }}</th>
                <th scope="col">{{ t('faturamentoSus.ciha.geradoPor') }}</th>
                <th scope="col">{{ t('faturamentoSus.ciha.registros') }}</th>
                <th scope="col">{{ t('faturamentoSus.ciha.linhas') }}</th>
                <th scope="col">{{ t('faturamentoSus.ciha.hash') }}</th>
                <th scope="col">{{ t('faturamentoSus.ciha.situacao') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in arquivos.data.value" :key="a.id" :data-testid="`arquivo-ciha-${a.id}`">
                <td>
                  <a
                    v-if="podeGerar && a.situacao !== 'substituido'"
                    :href="enderecoArquivoSus(a.id)"
                    download
                  >
                    {{ a.nomeArquivo }}
                  </a>
                  <span v-else>{{ a.nomeArquivo }}</span>
                  <span class="pequeno">
                    {{ t('faturamentoSus.ciha.leiaute', { leiaute: a.leiaute, versao: a.versaoLeiaute }) }}
                    <template v-if="a.conferidoContraOficial">
                      · {{ t('faturamentoSus.ciha.conferido') }}</template
                    >
                    · {{ t('faturamentoSus.ciha.tamanho', { bytes: a.bytes }) }}
                  </span>
                  <span v-if="a.semMovimento" class="pequeno">{{
                    t('faturamentoSus.ciha.semMovimento')
                  }}</span>
                </td>
                <td class="pequeno">{{ a.geradoPor }} {{ carimboBr(a.geradoEm) }}</td>
                <td>{{ a.registros }}</td>
                <td>{{ a.linhas }}</td>
                <td>
                  <code class="hash" data-testid="hash-arquivo-ciha">{{ a.hash }}</code>
                </td>
                <td>{{ situacaoArquivo(a) }}</td>
              </tr>
            </tbody>
          </table>
          <SanteAlerta
            v-if="(arquivos.data.value ?? []).some((a) => !a.conferidoContraOficial)"
            :texto="t('faturamentoSus.ciha.leiauteNaoConferido')"
            variante="alerta"
          />
        </section>

        <section aria-labelledby="ciha-equivalencias-titulo">
          <h2 id="ciha-equivalencias-titulo">{{ t('faturamentoSus.equivalencias.lista') }}</h2>
          <p class="pequeno">{{ t('faturamentoSus.equivalencias.explicacao') }}</p>
          <p v-if="pode('faturamento.susEquivalencia.editar') && dados.escopoParcial" class="pequeno">
            {{ t('faturamentoSus.equivalencias.escopoParcial') }}
          </p>
          <form class="linha" data-testid="filtro-equivalencias-sus" @submit.prevent="filtrarEquivalencias">
            <SanteCampoTexto
              v-model="termoEq"
              :rotulo="t('faturamentoSus.equivalencias.filtrar')"
              :max-bytes="60"
              data-testid="equivalencias-termo"
            />
            <SanteSelecao
              v-model="inativasEq"
              :rotulo="t('faturamentoSus.equivalencias.colunaSituacao')"
              :opcoes="opcoesInativas"
            />
            <SanteBotao
              :rotulo="t('faturamentoSus.equivalencias.buscar')"
              tipo="submit"
              variante="secundario"
              data-testid="botao-filtrar-equivalencias"
            />
          </form>
          <MensagemErro v-if="equivalencias.isError.value" :erro="equivalencias.error.value" />
          <p v-else-if="(equivalencias.data.value?.itens ?? []).length === 0">
            {{ t('faturamentoSus.equivalencias.nenhuma') }}
          </p>
          <template v-else>
            <p class="pequeno">
              {{ t('faturamentoSus.equivalencias.total', { n: equivalencias.data.value?.total ?? 0 }) }}
            </p>
            <table data-testid="tabela-equivalencias-sus">
              <thead>
                <tr>
                  <th scope="col">{{ t('faturamentoSus.equivalencias.colunaProcedimento') }}</th>
                  <th scope="col">{{ t('faturamentoSus.equivalencias.colunaTabela') }}</th>
                  <th scope="col">{{ t('faturamentoSus.equivalencias.colunaSigtap') }}</th>
                  <th scope="col">{{ t('faturamentoSus.equivalencias.colunaSituacao') }}</th>
                  <th scope="col">{{ t('faturamentoSus.equivalencias.colunaRegistro') }}</th>
                  <th v-if="podeEquivalencia" scope="col">
                    {{ t('faturamentoSus.equivalencias.colunaAcoes') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="x in equivalencias.data.value?.itens ?? []"
                  :key="x.id"
                  :data-testid="`equivalencia-sus-${x.procedimento}`"
                >
                  <td>{{ nomeProcedimento(x) }}</td>
                  <td class="pequeno">{{ x.tabela ?? '' }}</td>
                  <td>{{ x.sigtap }} {{ x.sigtapNome ?? '' }}</td>
                  <td>
                    {{
                      x.ativa
                        ? t('faturamentoSus.equivalencias.ativa')
                        : t('faturamentoSus.equivalencias.desativada')
                    }}
                  </td>
                  <td class="pequeno">
                    {{
                      t('faturamentoSus.equivalencias.registradaPor', {
                        quem: x.registradaPor,
                        quando: carimboBr(x.registradaEm),
                      })
                    }}
                  </td>
                  <td v-if="podeEquivalencia">
                    <div class="linha">
                      <SanteBotao
                        :rotulo="t('faturamentoSus.equivalencias.alterar')"
                        variante="secundario"
                        :data-testid="`alterar-equivalencia-${x.procedimento}`"
                        @acionar="alterarEquivalencia(x)"
                      />
                      <SanteBotao
                        v-if="x.ativa"
                        :rotulo="t('faturamentoSus.equivalencias.desativar')"
                        variante="texto"
                        :data-testid="`desativar-equivalencia-${x.procedimento}`"
                        @acionar="paraDesativar = x"
                      />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <PaginacaoCadastro
              v-model="paginaEq"
              :total="equivalencias.data.value?.total ?? 0"
              :por-pagina="POR_PAGINA_EQ"
              :rotulo="t('faturamentoSus.equivalencias.lista')"
            />
          </template>
        </section>
      </template>
    </template>
    <EquivalenciaSusDialogo
      v-model:visivel="dialogoEquivalencia"
      :procedimento="procedimentoEquivalencia"
      :competencia="competencia || null"
      @registrada="equivalenciaRegistrada"
    />
    <SanteDialogo v-model:visivel="dialogoDesativar" :titulo="t('faturamentoSus.equivalencias.desativar')">
      <p v-if="paraDesativar">
        {{
          t('faturamentoSus.equivalencias.confirmarDesativar', {
            procedimento: nomeProcedimento(paraDesativar),
          })
        }}
      </p>
      <div class="linha">
        <SanteBotao
          :rotulo="t('faturamentoSus.equivalencias.desativar')"
          data-testid="confirmar-desativar-equivalencia"
          @acionar="desativar"
        />
        <SanteBotao
          :rotulo="t('faturamentoSus.criticas.cancelar')"
          variante="texto"
          @acionar="dialogoDesativar = false"
        />
      </div>
    </SanteDialogo>
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
.resumo {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.resumo dd {
  margin: 0;
}
.hash {
  font-family: var(--sgh-fonte-mono, monospace);
  font-size: var(--sgh-fonte-pequena);
  word-break: break-all;
}
</style>
