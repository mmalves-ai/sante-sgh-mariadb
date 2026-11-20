<script setup lang="ts">
// O contrato SUS aberto: o resumo (esfera, gestor, vigência, CNES, habilitação, rede, orçamento e a divisão do
// pré-fixado), as pendências da regra 11 (contrato vigente, CNES e habilitação), os incentivos, as metas (nova e
// alteração pela versão), as apurações registradas e o painel produção × meta com o repasse. A alteração e o
// encerramento do contrato pela versão vista. As ações só com a funcionalidade ligada e a permissão de editar.
import type { MetaSus } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { encerrarContratoSus, type ItemDominioSusTela, lerContratoSus } from '../api-contratualizacao.js';
import { data, num, quando } from '../usar-faturamento.js';
import ContratoSusFormulario from './ContratoSusFormulario.vue';
import {
  competenciaAnterior,
  competenciaTexto,
  reaisDeCentavos,
  rotuloComplexidade,
  rotuloEscore,
  rotuloEsfera,
  rotuloFormato,
  rotuloIndicador,
  rotuloModalidade,
  rotuloNivel,
  rotuloOrigem,
  rotuloPeriodicidade,
  rotuloRede,
  rotuloSituacao,
  rotuloTipoMeta,
} from './contratualizacao-tela.js';
import ErroFaturamento from './ErroFaturamento.vue';
import MetaSusFormulario from './MetaSusFormulario.vue';
import PainelSusProducao from './PainelSusProducao.vue';

const props = defineProps<{
  id: number;
  pode: boolean;
  competencia: string;
  incentivosDominio: readonly ItemDominioSusTela[];
  cnesSugerido: string | null;
}>();
const emit = defineEmits<{ fechar: []; mudou: [] }>();
const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`contratualizacaoSus.contrato.${s}`, p ?? {});
const km = (s: string, p?: Record<string, unknown>) => t(`contratualizacaoSus.metas.${s}`, p ?? {});
const ka = (s: string, p?: Record<string, unknown>) => t(`contratualizacaoSus.apuracoes.${s}`, p ?? {});

const detalhe = useQuery({
  queryKey: computed(() => ['contratualizacao', 'contrato', props.id]),
  queryFn: () => lerContratoSus(props.id),
});
const d = computed(() => detalhe.data.value ?? null);
const ativo = computed(() => d.value?.contrato.situacao === 'ativo');
const podeAgir = computed(() => props.pode && ativo.value);
const mensagem = ref('');
const modo = ref<'ver' | 'alterar' | 'encerrar' | 'meta'>('ver');
const metaAberta = ref<MetaSus | null>(null);
const painelChave = ref(0);
const consultas = useQueryClient();

// Toda gravação (contrato, meta, apuração) muda o painel: o cache do painel deste contrato (todas as competências) sai
// antes de remontá-lo, senão a remontagem dentro do staleTime mostraria a conta antiga.
async function gravado(m: string): Promise<void> {
  mensagem.value = m;
  modo.value = 'ver';
  metaAberta.value = null;
  consultas.removeQueries({ queryKey: ['contratualizacao', 'painel', props.id] });
  await detalhe.refetch();
  painelChave.value++;
  emit('mudou');
}
function novaMeta(): void {
  metaAberta.value = null;
  modo.value = 'meta';
}
function alterarMeta(m: MetaSus): void {
  metaAberta.value = m;
  modo.value = 'meta';
}

const motivo = ref('');
const erroEncerrar = ref<unknown>(null);
const encerrando = ref(false);
async function encerrar(): Promise<void> {
  const c = d.value?.contrato;
  if (!c || motivo.value.trim().length < 10) return;
  erroEncerrar.value = null;
  encerrando.value = true;
  try {
    const r = await encerrarContratoSus(c.id, { versaoVista: c.versao, motivo: motivo.value.trim() });
    motivo.value = '';
    await gravado(r.mensagem);
  } catch (e) {
    erroEncerrar.value = e;
  } finally {
    encerrando.value = false;
  }
}

function alvo(m: MetaSus): string {
  return m.tipo === 'quantitativa'
    ? km('alvoQuanti', {
        nivel: rotuloNivel(m.nivelSigtap),
        codigo: m.codigoSigtap ?? '',
        modalidade: rotuloModalidade(m.modalidade),
      }) + (m.complexidade !== null ? ` · ${rotuloComplexidade(m.complexidade)}` : '')
    : km('alvoQuali', { indicador: rotuloIndicador(m.indicador), formato: rotuloFormato(m.formato) });
}
const vigenciaMeta = (m: MetaSus) =>
  m.fim
    ? km('vigencia', { inicio: competenciaTexto(m.inicio), fim: competenciaTexto(m.fim) })
    : km('vigenciaAberta', { inicio: competenciaTexto(m.inicio) });
const valorMeta = (m: MetaSus) =>
  m.tipo === 'quantitativa'
    ? km('porCompetencia', { valor: num(m.valorMeta) })
    : km('noPeriodo', { valor: num(m.valorMeta) });
const descricaoMeta = (id: number) => d.value?.metas.find((m) => m.id === id)?.descricao ?? String(id);
</script>

<template>
  <section class="contrato-sus" aria-labelledby="cd-titulo" data-testid="cd-contrato">
    <ErroFaturamento v-if="detalhe.isError.value" :erro="detalhe.error.value" />
    <p v-else-if="!d" role="status">{{ t('contratualizacaoSus.carregando') }}</p>
    <template v-else>
      <div class="barra">
        <h2 id="cd-titulo">{{ k('titulo', { numero: d.contrato.numero }) }}</h2>
        <SanteBotao
          variante="secundario"
          :rotulo="k('voltar')"
          data-testid="cd-voltar"
          @acionar="emit('fechar')"
        />
        <SanteBotao
          v-if="modo === 'ver'"
          :rotulo="k('alterar')"
          :desabilitado="!podeAgir"
          data-testid="cd-alterar"
          @acionar="modo = 'alterar'"
        />
        <SanteBotao
          v-if="modo === 'ver'"
          variante="secundario"
          :rotulo="k('encerrar')"
          :desabilitado="!podeAgir"
          data-testid="cd-encerrar"
          @acionar="modo = 'encerrar'"
        />
      </div>
      <p v-if="mensagem" role="status" data-testid="cd-mensagem">{{ mensagem }}</p>

      <ContratoSusFormulario
        v-if="modo === 'alterar'"
        :contrato="d.contrato"
        :pode="podeAgir"
        :incentivos-dominio="incentivosDominio"
        :cnes-sugerido="cnesSugerido"
        @gravado="(_id: number, m: string) => gravado(m)"
        @cancelar="modo = 'ver'"
      />

      <form
        v-else-if="modo === 'encerrar'"
        class="formulario-sus"
        data-testid="cd-encerramento"
        @submit.prevent="encerrar"
      >
        <span class="campo campo-largo">
          <label for="cd-motivo">{{ k('motivoEncerramento') }}</label>
          <textarea
            id="cd-motivo"
            v-model="motivo"
            maxlength="300"
            rows="3"
            required
            data-testid="cd-motivo"
          />
        </span>
        <p v-if="motivo.trim().length < 10" class="secundario">{{ k('motivoCurto') }}</p>
        <ErroFaturamento v-if="erroEncerrar" :erro="erroEncerrar" />
        <div class="barra">
          <SanteBotao
            tipo="submit"
            :rotulo="k('confirmarEncerramento')"
            :desabilitado="encerrando || motivo.trim().length < 10"
            data-testid="cd-confirmar-encerramento"
          />
          <SanteBotao variante="secundario" :rotulo="k('cancelar')" @acionar="modo = 'ver'" />
        </div>
      </form>

      <template v-else>
        <section aria-labelledby="cd-requisitos" data-testid="cd-requisitos">
          <h3 id="cd-requisitos">{{ k('requisitos') }}</h3>
          <template v-if="d.requisitos.length">
            <SanteAlerta v-for="r in d.requisitos" :key="r.codigo" variante="aviso" :texto="r.mensagem" />
          </template>
          <p v-else>{{ k('semPendencias') }}</p>
        </section>

        <dl class="resumo-sus" data-testid="cd-resumo">
          <dt>{{ k('situacao') }}</dt>
          <dd data-testid="cd-situacao">{{ rotuloSituacao(d.contrato.situacao) }}</dd>
          <dt>{{ k('esfera') }}</dt>
          <dd>{{ rotuloEsfera(d.contrato.esfera) }}</dd>
          <dt>{{ k('gestor') }}</dt>
          <dd>{{ d.contrato.gestor }}</dd>
          <dt>{{ k('objeto') }}</dt>
          <dd>{{ d.contrato.objeto }}</dd>
          <dt>{{ k('vigencia') }}</dt>
          <dd>{{ k('vigenciaTexto', { inicio: data(d.contrato.inicio), fim: data(d.contrato.fim) }) }}</dd>
          <dt>{{ k('cnes') }}</dt>
          <dd>{{ d.contrato.cnes ?? '—' }}</dd>
          <dt>{{ k('habilitacao') }}</dt>
          <dd>
            {{ d.contrato.habilitacao ?? '—' }}
            <span v-if="d.contrato.habilitacaoValidade" class="secundario">
              ({{ k('habilitacaoValidade', { data: data(d.contrato.habilitacaoValidade) }) }})
            </span>
          </dd>
          <dt>{{ k('rede') }}</dt>
          <dd>{{ rotuloRede(d.contrato.redeAssistencia) }}</dd>
          <dt>{{ k('pre') }}</dt>
          <dd>{{ reaisDeCentavos(d.contrato.valorPreMensalCentavos) }}</dd>
          <dt>{{ k('pos') }}</dt>
          <dd>{{ reaisDeCentavos(d.contrato.valorPosMensalCentavos) }}</dd>
          <dt>{{ k('parteQualitativa') }}</dt>
          <dd>
            {{
              k('parteQualitativaTexto', {
                pct: d.contrato.parteQualitativaPct,
                resto: 100 - d.contrato.parteQualitativaPct,
              })
            }}
          </dd>
          <template v-if="d.contrato.observacao">
            <dt>{{ k('observacao') }}</dt>
            <dd>{{ d.contrato.observacao }}</dd>
          </template>
        </dl>
        <p class="secundario">
          {{ k('registro', { por: d.contrato.criadoPor, em: quando(d.contrato.criadoEm) }) }}
          <template v-if="d.contrato.alteradoPor">
            · {{ k('alteracao', { por: d.contrato.alteradoPor, em: quando(d.contrato.alteradoEm) }) }}
          </template>
        </p>
        <p v-if="d.contrato.situacao === 'encerrado'" data-testid="cd-encerrado">
          {{
            k('encerradoTexto', {
              por: d.contrato.encerradoPor ?? '—',
              em: quando(d.contrato.encerradoEm),
              motivo: d.contrato.motivoEncerramento ?? '',
            })
          }}
        </p>

        <section aria-labelledby="cd-incentivos" data-testid="cd-incentivos">
          <h3 id="cd-incentivos">{{ k('incentivos') }}</h3>
          <p v-if="!d.contrato.incentivos.length">{{ k('semIncentivos') }}</p>
          <table v-else class="grade">
            <thead>
              <tr>
                <th scope="col">{{ k('colIncentivo') }}</th>
                <th scope="col">{{ k('colValorMensal') }}</th>
                <th scope="col">{{ k('colPeriodo') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(x, i) in d.contrato.incentivos" :key="i">
                <td>{{ x.nome }}</td>
                <td>{{ reaisDeCentavos(x.valorMensalCentavos) }}</td>
                <td>
                  {{ k('vigenciaTexto', { inicio: data(x.inicio), fim: x.fim ? data(x.fim) : k('semFim') }) }}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section aria-labelledby="cd-metas" data-testid="cd-metas">
          <div class="barra">
            <h3 id="cd-metas">{{ km('titulo') }}</h3>
            <SanteBotao
              v-if="modo !== 'meta'"
              :rotulo="km('nova')"
              :desabilitado="!podeAgir"
              data-testid="cd-nova-meta"
              @acionar="novaMeta"
            />
          </div>
          <MetaSusFormulario
            v-if="modo === 'meta'"
            :key="metaAberta?.id ?? 'nova'"
            :contrato="d.contrato.id"
            :meta="metaAberta"
            :pode="podeAgir"
            :competencia="competencia"
            @gravado="(_id: number, m: string) => gravado(m)"
            @cancelar="modo = 'ver'"
          />
          <p v-if="!d.metas.length" data-testid="cd-sem-metas">{{ km('nenhuma') }}</p>
          <div v-else class="rolagem">
            <table class="grade" data-testid="cd-lista-metas">
              <thead>
                <tr>
                  <th scope="col">{{ km('colDescricao') }}</th>
                  <th scope="col">{{ km('colTipo') }}</th>
                  <th scope="col">{{ km('colAlvo') }}</th>
                  <th scope="col">{{ km('colPeriodicidade') }}</th>
                  <th scope="col">{{ km('colVigencia') }}</th>
                  <th scope="col">{{ km('colMeta') }}</th>
                  <th scope="col">{{ km('colPontos') }}</th>
                  <th scope="col">{{ km('colSituacao') }}</th>
                  <th scope="col">{{ km('colAcoes') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in d.metas" :key="m.id" :data-testid="`cd-meta-${m.id}`">
                  <td>{{ m.descricao }}</td>
                  <td>{{ rotuloTipoMeta(m.tipo) }}</td>
                  <td>{{ alvo(m) }}</td>
                  <td>{{ rotuloPeriodicidade(m.periodicidade) }}</td>
                  <td>{{ vigenciaMeta(m) }}</td>
                  <td>{{ valorMeta(m) }}</td>
                  <td>{{ m.pontos }}</td>
                  <td>{{ m.ativa ? km('ativa') : km('inativa') }}</td>
                  <td>
                    <SanteBotao
                      variante="secundario"
                      :rotulo="km('alterar', { descricao: m.descricao })"
                      :desabilitado="!podeAgir"
                      :data-testid="`cd-alterar-meta-${m.id}`"
                      @acionar="alterarMeta(m)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <PainelSusProducao
          v-if="d.metas.length"
          :key="painelChave"
          :contrato="d.contrato.id"
          :competencia="competenciaAnterior(competencia)"
          :competencia-atual="competencia"
          :pode="podeAgir"
          @apurado="gravado"
        />

        <section aria-labelledby="cd-apuracoes" data-testid="cd-apuracoes">
          <h3 id="cd-apuracoes">{{ ka('titulo') }}</h3>
          <p v-if="!d.apuracoes.length">{{ ka('nenhuma') }}</p>
          <div v-else class="rolagem">
            <table class="grade">
              <thead>
                <tr>
                  <th scope="col">{{ ka('colMeta') }}</th>
                  <th scope="col">{{ ka('colPeriodo') }}</th>
                  <th scope="col">{{ ka('colMetaPeriodo') }}</th>
                  <th scope="col">{{ ka('colRealizado') }}</th>
                  <th scope="col">{{ ka('colCumprimento') }}</th>
                  <th scope="col">{{ ka('colEscore') }}</th>
                  <th scope="col">{{ ka('colOrigem') }}</th>
                  <th scope="col">{{ ka('colPor') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="a in d.apuracoes" :key="a.id" :data-testid="`cd-apuracao-${a.id}`">
                  <td>{{ descricaoMeta(a.meta) }}</td>
                  <td>
                    {{
                      ka('periodo', {
                        inicio: competenciaTexto(a.inicioPeriodo),
                        fim: competenciaTexto(a.competencia),
                      })
                    }}
                  </td>
                  <td>{{ num(a.metaPeriodo) }}</td>
                  <td>{{ num(a.realizado) }}</td>
                  <td>{{ num(a.cumprimentoPct) }}%</td>
                  <td>{{ rotuloEscore(a.escore) }}</td>
                  <td>{{ rotuloOrigem(a.origem) }}</td>
                  <td>{{ a.por }} · {{ quando(a.em) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </template>
  </section>
</template>
