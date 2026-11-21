<script setup lang="ts">
// BPA (M51, etapa 2; ficha, seções 5, 7, 8 e 12) — `Faturamento > Faturamento SUS > BPA (produção ambulatorial)`: a
// competência do BPA (SanteSelecao), o resumo da crítica (o validador de compatibilidade roda na tela de críticas),
// "Gerar BPA" (desabilitado com crítica bloqueante, sem crítica, com a competência fechada, sem acesso a todos os
// convênios ou com o BPA desligado), os arquivos gerados com o hash, o download (auditado) e as linhas de cada arquivo
// (consolidado e individualizado, com folha, sequência, procedimento, ocupação, idade e quantidade; busca por tipo e
// procedimento, paginação no servidor; sem dado pessoal: a linha individualizada leva só o atalho para a conta).
// Construído e DESLIGADO por estabelecimento (DP-35): sem a chave, a tela diz o pré-requisito. Exportação só em arquivo
// (regra 9); os parâmetros do faturamento ambulatorial do banco do hospital ficam em consulta.
import { type ArquivoSusLido, type CompetenciaSusResumo, type TipoLinhaBpa } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import PaginacaoCadastro from '../../cadastro/componentes/PaginacaoCadastro.vue';
import { carimboBr } from '../../cadastro/formato.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import {
  enderecoArquivoBpa,
  gerarBpa,
  lerArquivosSus,
  lerCompetenciasSus,
  lerLinhasBpa,
  lerParametrosLegadoSus,
} from '../api-sus.js';

const { t } = useI18n();
const cliente = useQueryClient();
const competencia = ref<string>('');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const gerando = ref(false);

const lista = useQuery({
  queryKey: ['sus', 'competencias', 'bpa'],
  queryFn: () => lerCompetenciasSus('bpa'),
});
const dados = computed(() => lista.data.value);
const liberado = computed(
  () => dados.value?.instrumentos.find((x) => x.instrumento === 'bpa')?.liberado ?? false,
);
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
  queryKey: computed(() => ['sus', 'arquivos', 'bpa', competencia.value]),
  queryFn: () => lerArquivosSus('bpa', competencia.value),
  enabled: computed(() => competencia.value !== ''),
});
const parametros = useQuery({
  queryKey: ['sus', 'parametros-ambulatoriais'],
  queryFn: () => lerParametrosLegadoSus(),
});

const podeGerar = computed(() => pode('faturamento.susBpa.gerar'));
const pronta = computed(
  () =>
    liberado.value &&
    atual.value !== null &&
    atual.value.situacao === 'aberta' &&
    atual.value.criticadaEm !== null &&
    atual.value.criticasBloqueantes === 0,
);

async function gerar(): Promise<void> {
  const c = atual.value;
  if (!c) return;
  mensagem.value = null;
  erro.value = null;
  gerando.value = true;
  try {
    const r = await gerarBpa({ competencia: c.competencia, versao: c.versao });
    mensagem.value = t('faturamentoSus.bpa.gerado', {
      tempo: (r.tempoMs / 1000).toFixed(1),
      registros: r.arquivo.registros,
      linhas: r.arquivo.linhas,
    });
    arquivoAberto.value = r.arquivo;
    await cliente.invalidateQueries({ queryKey: ['sus'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gerando.value = false;
  }
}

// As linhas do arquivo escolhido (paginação e filtro no servidor).
const POR_PAGINA = 50;
const arquivoAberto = ref<ArquivoSusLido | null>(null);
const tipo = ref<'' | TipoLinhaBpa>('');
const termoProcedimento = ref('');
const filtroProcedimento = ref('');
const pagina = ref(1);
watch([arquivoAberto, tipo, filtroProcedimento], () => (pagina.value = 1));
const opcoesTipo = computed(() => [
  { valor: '' as const, rotulo: t('faturamentoSus.bpa.todos') },
  { valor: 'c' as const, rotulo: t('faturamentoSus.bpa.tipos.c') },
  { valor: 'i' as const, rotulo: t('faturamentoSus.bpa.tipos.i') },
]);
const linhas = useQuery({
  queryKey: computed(() => [
    'sus',
    'bpa-linhas',
    arquivoAberto.value?.id ?? 0,
    tipo.value,
    filtroProcedimento.value,
    pagina.value,
  ]),
  queryFn: () =>
    lerLinhasBpa({
      arquivo: arquivoAberto.value?.id ?? 0,
      ...(tipo.value ? { tipo: tipo.value } : {}),
      ...(filtroProcedimento.value ? { procedimento: filtroProcedimento.value } : {}),
      pagina: pagina.value - 1,
      porPagina: POR_PAGINA,
    }),
  enabled: computed(() => arquivoAberto.value !== null && liberado.value),
});
const procedimentoValido = computed(
  () => termoProcedimento.value.trim() === '' || /^\d{2,10}$/.test(termoProcedimento.value.trim()),
);
function filtrar(): void {
  if (procedimentoValido.value) filtroProcedimento.value = termoProcedimento.value.trim();
}
const resumoTipos = computed(() => {
  const p = linhas.data.value?.porTipo ?? {};
  return t('faturamentoSus.bpa.resumoTipos', {
    cl: p['c']?.linhas ?? 0,
    cq: p['c']?.quantidade ?? 0,
    il: p['i']?.linhas ?? 0,
    iq: p['i']?.quantidade ?? 0,
  });
});
const situacaoArquivo = (a: ArquivoSusLido) => t(`faturamentoSus.ciha.situacoes.${a.situacao}`);
</script>

<template>
  <section class="tela" aria-labelledby="bpa-titulo" data-testid="tela-bpa">
    <h1 id="bpa-titulo">{{ t('faturamentoSus.bpa.titulo') }}</h1>
    <p>{{ t('faturamentoSus.bpa.explicacao') }}</p>
    <p class="pequeno">{{ t('faturamentoSus.bpa.envio') }}</p>
    <nav class="linha" :aria-label="t('faturamentoSus.bpa.atalhos')">
      <RouterLink to="/faturamento/sus/retorno?instrumento=bpa" data-testid="bpa-link-retorno">{{
        t('faturamentoSus.bpa.retorno')
      }}</RouterLink>
    </nav>
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!dados">{{ t('faturamentoSus.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!liberado"
        :texto="t('faturamentoSus.bpa.desligado')"
        variante="aviso"
        data-testid="bpa-desligado"
      />
      <SanteAlerta
        v-if="dados.escopoParcial"
        :texto="t('faturamentoSus.competencias.escopoParcial')"
        variante="info"
      />
      <p v-if="competencias.length === 0" data-testid="bpa-sem-competencia">
        {{ t('faturamentoSus.bpa.semCompetencia') }}
        <RouterLink to="/faturamento/sus/competencias?instrumento=bpa">
          {{ t('faturamentoSus.bpa.irCriticas') }}
        </RouterLink>
      </p>
      <template v-else>
        <div class="barra">
          <SanteSelecao
            v-model="competencia"
            :rotulo="t('faturamentoSus.bpa.escolha')"
            :opcoes="opcoes"
            data-testid="bpa-competencia"
          />
          <RouterLink :to="`/faturamento/sus/competencias?instrumento=bpa&competencia=${competencia}`">
            {{ t('faturamentoSus.bpa.irCriticas') }}
          </RouterLink>
        </div>
        <section v-if="atual" aria-labelledby="bpa-resumo-titulo" data-testid="bpa-resumo">
          <h2 id="bpa-resumo-titulo">{{ t('faturamentoSus.bpa.resumo') }}</h2>
          <dl class="resumo">
            <dt>{{ t('faturamentoSus.bpa.atendimentos') }}</dt>
            <dd>{{ atual.registros }}</dd>
            <dt>{{ t('faturamentoSus.competencias.bloqueantes') }}</dt>
            <dd>{{ atual.criticasBloqueantes }}</dd>
            <dt>{{ t('faturamentoSus.competencias.avisos') }}</dt>
            <dd>{{ atual.avisos }}</dd>
            <dt>{{ t('faturamentoSus.competencias.criticadaEm') }}</dt>
            <dd>{{ atual.criticadaEm ? carimboBr(atual.criticadaEm) : '—' }}</dd>
          </dl>
          <p v-if="atual.criticadaEm === null">{{ t('faturamentoSus.bpa.semCritica') }}</p>
          <p v-else-if="atual.criticasBloqueantes > 0">
            {{ t('faturamentoSus.bpa.bloqueada', { n: atual.criticasBloqueantes }) }}
          </p>
          <p v-else-if="atual.situacao === 'aberta' && liberado">{{ t('faturamentoSus.bpa.pronta') }}</p>
          <div class="linha">
            <SanteBotao
              v-if="podeGerar"
              :rotulo="t('faturamentoSus.bpa.gerar')"
              :desabilitado="gerando || !pronta || dados.escopoParcial"
              data-testid="botao-gerar-bpa"
              @acionar="gerar"
            />
          </div>
        </section>
        <p v-if="mensagem" role="status" data-testid="mensagem-bpa">{{ mensagem }}</p>
        <ErroFaturamento v-if="erro" :erro="erro" />

        <section aria-labelledby="bpa-arquivos-titulo">
          <h2 id="bpa-arquivos-titulo">{{ t('faturamentoSus.bpa.arquivos') }}</h2>
          <MensagemErro v-if="arquivos.isError.value" :erro="arquivos.error.value" />
          <p v-else-if="(arquivos.data.value ?? []).length === 0" data-testid="bpa-sem-arquivo">
            {{ t('faturamentoSus.bpa.nenhumArquivo') }}
          </p>
          <table v-else data-testid="tabela-arquivos-bpa">
            <thead>
              <tr>
                <th scope="col">{{ t('faturamentoSus.ciha.nome') }}</th>
                <th scope="col">{{ t('faturamentoSus.ciha.geradoPor') }}</th>
                <th scope="col">{{ t('faturamentoSus.bpa.atendimentos') }}</th>
                <th scope="col">{{ t('faturamentoSus.ciha.linhas') }}</th>
                <th scope="col">{{ t('faturamentoSus.ciha.hash') }}</th>
                <th scope="col">{{ t('faturamentoSus.ciha.situacao') }}</th>
                <th scope="col">{{ t('faturamentoSus.bpa.verLinhas') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in arquivos.data.value" :key="a.id" :data-testid="`arquivo-bpa-${a.id}`">
                <td>
                  <a
                    v-if="podeGerar && liberado && a.situacao !== 'substituido'"
                    :href="enderecoArquivoBpa(a.id)"
                    download
                  >
                    {{ a.nomeArquivo }}
                  </a>
                  <span v-else>{{ a.nomeArquivo }}</span>
                  <span class="pequeno">
                    {{ t('faturamentoSus.ciha.leiaute', { leiaute: a.leiaute, versao: a.versaoLeiaute }) }}
                    · {{ t('faturamentoSus.ciha.tamanho', { bytes: a.bytes }) }}
                  </span>
                </td>
                <td class="pequeno">{{ a.geradoPor }} {{ carimboBr(a.geradoEm) }}</td>
                <td>{{ a.registros }}</td>
                <td>{{ a.linhas }}</td>
                <td>
                  <code class="hash" data-testid="hash-arquivo-bpa">{{ a.hash }}</code>
                </td>
                <td>{{ situacaoArquivo(a) }}</td>
                <td>
                  <SanteBotao
                    :rotulo="t('faturamentoSus.bpa.verLinhas')"
                    variante="secundario"
                    :desabilitado="!liberado"
                    :data-testid="`botao-linhas-bpa-${a.id}`"
                    @acionar="arquivoAberto = a"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <SanteAlerta
            v-if="(arquivos.data.value ?? []).some((a) => !a.conferidoContraOficial)"
            :texto="t('faturamentoSus.bpa.leiauteNaoConferido')"
            variante="alerta"
          />
        </section>

        <section v-if="arquivoAberto" aria-labelledby="bpa-linhas-titulo" data-testid="bpa-linhas">
          <h2 id="bpa-linhas-titulo">
            {{ t('faturamentoSus.bpa.linhasDoArquivo', { nome: arquivoAberto.nomeArquivo }) }}
          </h2>
          <form class="linha" data-testid="filtro-linhas-bpa" @submit.prevent="filtrar">
            <SanteSelecao
              v-model="tipo"
              :rotulo="t('faturamentoSus.bpa.tipo')"
              :opcoes="opcoesTipo"
              data-testid="bpa-tipo"
            />
            <SanteCampoTexto
              v-model="termoProcedimento"
              :rotulo="t('faturamentoSus.bpa.filtrarProcedimento')"
              :max-bytes="10"
              data-testid="bpa-procedimento"
            />
            <span v-if="!procedimentoValido" class="pequeno" role="alert">{{
              t('faturamentoSus.bpa.procedimentoInvalido')
            }}</span>
            <SanteBotao
              :rotulo="t('faturamentoSus.bpa.filtrar')"
              tipo="submit"
              variante="secundario"
              data-testid="botao-filtrar-bpa"
            />
          </form>
          <MensagemErro v-if="linhas.isError.value" :erro="linhas.error.value" />
          <p v-else-if="!linhas.data.value">{{ t('faturamentoSus.carregando') }}</p>
          <template v-else>
            <p class="pequeno" data-testid="bpa-resumo-tipos">{{ resumoTipos }}</p>
            <p v-if="linhas.data.value.itens.length === 0">{{ t('faturamentoSus.bpa.nenhumaLinha') }}</p>
            <template v-else>
              <p class="pequeno">{{ t('faturamentoSus.bpa.total', { n: linhas.data.value.total }) }}</p>
              <table data-testid="tabela-linhas-bpa">
                <thead>
                  <tr>
                    <th scope="col">{{ t('faturamentoSus.bpa.tipo') }}</th>
                    <th scope="col">{{ t('faturamentoSus.bpa.folha') }}</th>
                    <th scope="col">{{ t('faturamentoSus.bpa.sequencia') }}</th>
                    <th scope="col">{{ t('faturamentoSus.bpa.procedimento') }}</th>
                    <th scope="col">{{ t('faturamentoSus.bpa.cbo') }}</th>
                    <th scope="col">{{ t('faturamentoSus.bpa.idade') }}</th>
                    <th scope="col">{{ t('faturamentoSus.bpa.quantidade') }}</th>
                    <th scope="col">{{ t('faturamentoSus.bpa.data') }}</th>
                    <th scope="col">{{ t('faturamentoSus.bpa.conta') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="x in linhas.data.value.itens" :key="x.id" :data-testid="`linha-bpa-${x.id}`">
                    <td>{{ t(`faturamentoSus.bpa.tipos.${x.tipo}`) }}</td>
                    <td>{{ x.folha }}</td>
                    <td>{{ x.sequencia }}</td>
                    <td>{{ x.procedimento }}</td>
                    <td>{{ x.cbo }}</td>
                    <td>{{ x.idade ?? '—' }}</td>
                    <td>{{ x.quantidade }}</td>
                    <td>{{ x.data ?? '—' }}</td>
                    <td>
                      <RouterLink
                        v-if="x.conta !== null"
                        :to="`/faturamento/contas/${x.conta}`"
                        :aria-label="t('faturamentoSus.bpa.contaAbrir', { conta: x.conta })"
                      >
                        {{ x.conta }}
                      </RouterLink>
                      <span v-else>—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <PaginacaoCadastro
                v-model="pagina"
                :total="linhas.data.value.total"
                :por-pagina="POR_PAGINA"
                :rotulo="t('faturamentoSus.bpa.linhasDoArquivo', { nome: arquivoAberto.nomeArquivo })"
              />
            </template>
          </template>
        </section>
      </template>

      <section aria-labelledby="bpa-parametros-titulo" data-testid="bpa-parametros">
        <h2 id="bpa-parametros-titulo">{{ t('faturamentoSus.bpa.parametros') }}</h2>
        <p class="pequeno">{{ t('faturamentoSus.bpa.parametrosExplicacao') }}</p>
        <MensagemErro v-if="parametros.isError.value" :erro="parametros.error.value" />
        <dl v-else-if="parametros.data.value" class="resumo">
          <dt>{{ t('faturamentoSus.bpa.competenciaModulo') }}</dt>
          <dd>{{ parametros.data.value.competenciaAmbulatorio ?? '—' }}</dd>
          <dt>{{ t('faturamentoSus.bpa.versaoModulo') }}</dt>
          <dd>{{ parametros.data.value.versao ?? '—' }}</dd>
          <dt>{{ t('faturamentoSus.bpa.orgaoModulo') }}</dt>
          <dd>{{ parametros.data.value.orgao ?? '—' }}</dd>
        </dl>
      </section>
    </template>
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
