<script setup lang="ts">
// ADR 0009: as regras estruturadas da agenda do profissional (preço particular, convênios e planos atendidos,
// restrições e preparo), com o TEXTO ORIGINAL inteiro ao lado e o trecho não interpretado destacado (decisão 27: a
// regra estimada já vale; o trecho não interpretado continua valendo pelo texto). "Ver o texto de origem" destaca o
// texto de onde a regra saiu. A edição da regra de preço só aparece com a permissão de alterar a agenda; a inclusão de
// cobertura, restrição e preparo, com a permissão agenda.estruturada.editar. Os nomes (convênio, plano, subplano,
// profissional, estabelecimento) vêm do contrato; os mapas das props só completam o que faltar.
import type {
  CoberturaAgenda,
  PreparoAgenda,
  RegraPrecoParticular,
  RestricaoAgenda,
  TextoOrigemAgenda,
} from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { listarConvenios } from '../../precos/api-precos.js';
import { lerAgendaEstruturada } from '../api-estruturada.js';
import { nomesDaAgenda } from '../estruturada-edicao.js';
import { agruparCobertura, dataTela, reais, regrasVigentes } from '../estruturada-tela.js';
import ErroAgenda from './ErroAgenda.vue';
import RegraEstruturadaForm, { type TipoRegraEstruturada } from './RegraEstruturadaForm.vue';
import RegraPrecoForm from './RegraPrecoForm.vue';
import TextoOriginalAgenda from './TextoOriginalAgenda.vue';

const props = withDefaults(
  defineProps<{
    agendaId: number;
    /** Nome do convênio pelo id (as opções da agenda); sem nome, mostra o código. */
    nomesConvenio?: Record<number, string>;
    /** Nome do plano pelo id, quando a tela tiver; sem nome, mostra o código. */
    nomesPlano?: Record<number, string>;
    particularId?: number | null;
    podeEditar?: boolean;
  }>(),
  { nomesConvenio: () => ({}), nomesPlano: () => ({}), particularId: null, podeEditar: false },
);
const { t } = useI18n();
const cliente = useQueryClient();
const consulta = useQuery({
  queryKey: computed(() => ['agenda', 'estruturada', props.agendaId]),
  queryFn: () => lerAgendaEstruturada(props.agendaId),
});
const a = computed(() => consulta.data.value ?? null);
const recusadas = computed(() =>
  (a.value?.precosParticulares ?? []).filter((r) => r.situacaoRevisao === 'recusada'),
);
const grupos = computed(() => (a.value ? agruparCobertura(a.value.coberturas) : []));
const textoAtivo = ref<number | null>(null);
const editando = ref<RegraPrecoParticular | 'nova' | null>(null);
const mensagem = ref<string | null>(null);
const d = new Date();
const hoje = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// As regras que valem hoje, na ordem de especificidade do cálculo (a primeira vence para o alvo dela).
const precos = computed(() => (a.value ? regrasVigentes(a.value.precosParticulares, hoje) : []));

const nomes = computed(() =>
  a.value
    ? nomesDaAgenda(a.value)
    : { convenios: {} as Record<number, string>, planos: {} as Record<number, string> },
);
const convenio = (id: number | null) =>
  id === null ? '' : (nomes.value.convenios[id] ?? props.nomesConvenio[id] ?? `#${id}`);
const plano = (id: number | null) =>
  id === null ? '' : (nomes.value.planos[id] ?? props.nomesPlano[id] ?? `#${id}`);
// Convênios para a edição: os aceitos pela agenda, com o nome do contrato.
const conveniosDaAgenda = computed(() =>
  (a.value?.conveniosAceitos ?? []).map((c) => ({
    fontePagadoraId: c.fontePagadoraId,
    nome: convenio(c.fontePagadoraId),
  })),
);
const incluindo = ref<TipoRegraEstruturada | null>(null);
/** Regra em revisão (PUT com a versão lida); nula: inclusão. */
const emRevisao = ref<CoberturaAgenda | RestricaoAgenda | PreparoAgenda | null>(null);
function revisar(tipo: TipoRegraEstruturada, regra: CoberturaAgenda | RestricaoAgenda | PreparoAgenda): void {
  emRevisao.value = regra;
  incluindo.value = tipo;
}
function fecharForm(): void {
  incluindo.value = null;
  emRevisao.value = null;
}
// Cobertura: a coluna própria que substitui o texto pode incluir um convênio que a agenda ainda não aceita, então a
// escolha vem do cadastro de convênios ativos do hospital (o mesmo da tela de preços), somado aos aceitos.
const cadastroConvenios = useQuery({
  queryKey: ['convenios', '', 'ativos'],
  queryFn: () => listarConvenios('', 'ativos'),
  enabled: computed(() => incluindo.value === 'cobertura'),
});
const conveniosCobertura = computed(() => {
  const lista = [...conveniosDaAgenda.value];
  const vistos = new Set(lista.map((c) => c.fontePagadoraId));
  for (const c of cadastroConvenios.data.value?.itens ?? []) {
    if (vistos.has(c.codigo)) continue;
    vistos.add(c.codigo);
    lista.push({ fontePagadoraId: c.codigo, nome: c.nome });
  }
  return lista;
});
const rotuloTexto = (x: TextoOrigemAgenda) =>
  t(`estruturada.textoOriginal.campos.${x.campo}`, { convenio: convenio(x.fontePagadoraId) });
const podeEditarRegras = computed(() => pode('agenda.estruturada.editar'));
const vigencia = (x: { vigenciaInicio: string | null; vigenciaFim: string | null }) =>
  x.vigenciaInicio === null
    ? t('estruturada.semVigencia')
    : x.vigenciaFim === null
      ? t('estruturada.vigenciaDesde', { inicio: dataTela(x.vigenciaInicio) })
      : t('estruturada.vigenciaEntre', { inicio: dataTela(x.vigenciaInicio), fim: dataTela(x.vigenciaFim) });
const situacao = (s: RegraPrecoParticular['situacaoRevisao']) => t(`estruturada.${s}`);
const donoRegra = (r: RegraPrecoParticular) =>
  r.dono.tipo === 'agenda' ? t('estruturada.preco.donoAgenda') : t('estruturada.preco.donoProfissional');
const alvoRegra = (r: RegraPrecoParticular) =>
  r.alvo.tipo === 'consulta'
    ? t('estruturada.preco.alvoConsulta')
    : r.alvo.tipo === 'exame'
      ? t('estruturada.preco.alvoExame')
      : r.alvo.tipo === 'item'
        ? t('estruturada.preco.alvoItem', { id: r.alvo.itemFaturavelId })
        : t('estruturada.preco.alvoGrupo', { id: r.alvo.grupoFaturamentoId });

function idade(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return t('estruturada.restricao.idadeEntre', { min, max });
  if (min !== null) return t('estruturada.restricao.idadeMin', { min });
  if (max !== null) return t('estruturada.restricao.idadeMax', { max });
  return t('estruturada.restricao.idadeLivre');
}
function retorno(aceita: boolean | null, dias: number | null): string {
  if (aceita === null) return t('estruturada.restricao.herda');
  if (!aceita) return t('estruturada.restricao.retornoNao');
  return dias === null
    ? t('estruturada.restricao.retornoSim')
    : t('estruturada.restricao.retornoDias', { dias });
}
const encaixe = (p: boolean | null) =>
  p === null
    ? t('estruturada.restricao.herda')
    : p
      ? t('estruturada.restricao.encaixeSim')
      : t('estruturada.restricao.encaixeNao');
function escopo(r: RestricaoAgenda): string {
  const partes: string[] = [];
  if (r.fontePagadoraId !== null)
    partes.push(t('estruturada.restricao.escopoConvenio', { convenio: convenio(r.fontePagadoraId) }));
  if (r.planoId !== null) partes.push(t('estruturada.restricao.escopoPlano', { plano: plano(r.planoId) }));
  if (r.itemAgendavelId !== null)
    partes.push(t('estruturada.restricao.escopoItem', { item: r.itemAgendavelId }));
  return partes.length ? partes.join(' · ') : t('estruturada.restricao.escopoTodos');
}
const tipoPreparo = (p: PreparoAgenda) => t(`estruturada.preparo.tipos.${p.tipo}`);
const rotuloCobertura = (c: CoberturaAgenda) =>
  c.aceita ? t('estruturada.cobertura.aceita') : t('estruturada.cobertura.exclui');

function verTexto(id: number | null): void {
  if (id === null) return;
  textoAtivo.value = id;
  document.getElementById(`texto-origem-${id}`)?.scrollIntoView?.({ block: 'nearest' });
}
async function gravado(m: string): Promise<void> {
  mensagem.value = m;
  editando.value = null;
  incluindo.value = null;
  emRevisao.value = null;
  await cliente.invalidateQueries({ queryKey: ['agenda', 'estruturada'] });
}
</script>

<template>
  <section class="painel estruturada" aria-labelledby="estruturada-titulo" data-testid="agenda-estruturada">
    <h2 id="estruturada-titulo">{{ t('estruturada.titulo') }}</h2>
    <p class="secundario">{{ t('estruturada.texto') }}</p>
    <ErroAgenda v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!a" role="status">{{ t('estruturada.carregando') }}</p>
    <div v-else class="lado-a-lado">
      <div class="regras">
        <p class="secundario" data-testid="estruturada-cabecalho">
          <strong data-testid="estruturada-agenda">{{ a.nome }}</strong> ·
          {{ t('estruturada.profissional') }}: {{ a.profissionalNome ?? '–' }} ·
          {{ t('estruturada.estabelecimento') }}: {{ a.estabelecimentoNome }} ·
          {{ t('estruturada.codigoOrigem') }}: {{ a.codigoOrigem ?? '–' }} ·
          {{ t('estruturada.vigenciaAgenda') }}:
          {{ vigencia(a) }}
        </p>

        <!-- Preço particular -->
        <section aria-labelledby="estruturada-preco" data-testid="estruturada-preco">
          <h3 id="estruturada-preco">{{ t('estruturada.preco.titulo') }}</h3>
          <p class="secundario">{{ t('estruturada.preco.texto') }}</p>
          <p v-if="precos.length === 0">{{ t('estruturada.nenhuma') }}</p>
          <table v-else class="tabela">
            <caption class="sr-only">
              {{
                t('estruturada.preco.titulo')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('estruturada.preco.valor') }}</th>
                <th scope="col">{{ t('estruturada.preco.alvo') }}</th>
                <th scope="col">{{ t('estruturada.preco.dono') }}</th>
                <th scope="col">{{ t('estruturada.preco.prioridade') }}</th>
                <th scope="col">{{ t('estruturada.vigencia') }}</th>
                <th scope="col">{{ t('estruturada.preco.situacao') }}</th>
                <th scope="col">{{ t('agenda.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in precos" :key="r.id" :data-testid="`regra-preco-${r.id}`">
                <th scope="row">{{ reais(r.valor) }}</th>
                <td>{{ alvoRegra(r) }}</td>
                <td>{{ donoRegra(r) }}</td>
                <td>{{ r.prioridade }}</td>
                <td>{{ vigencia(r) }}</td>
                <td :class="{ estimada: r.situacaoRevisao === 'estimada' }">
                  {{ situacao(r.situacaoRevisao) }}
                </td>
                <td>
                  <SanteBotao
                    v-if="r.textoOrigemId !== null"
                    variante="texto"
                    :rotulo="t('estruturada.verTexto')"
                    :data-testid="`ver-texto-preco-${r.id}`"
                    @acionar="verTexto(r.textoOrigemId)"
                  />
                  <SanteBotao
                    v-if="podeEditar"
                    variante="texto"
                    :rotulo="t('estruturada.preco.editar')"
                    :aria-label="t('estruturada.preco.editarDe', { valor: reais(r.valor) })"
                    :data-testid="`editar-preco-${r.id}`"
                    @acionar="editando = r"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="recusadas.length" class="secundario" data-testid="precos-recusados">
            {{ t('estruturada.recusada') }}: {{ recusadas.map((r) => reais(r.valor)).join(', ') }}
          </p>
          <SanteBotao
            v-if="podeEditar && editando === null"
            variante="secundario"
            :rotulo="t('estruturada.preco.nova')"
            data-testid="nova-regra-preco"
            @acionar="editando = 'nova'"
          />
          <RegraPrecoForm
            v-if="podeEditar && editando !== null"
            :key="editando === 'nova' ? 'nova' : editando.id"
            :agenda-id="agendaId"
            :profissional-id="a.profissionalId"
            :particular-id="particularId"
            :regra="editando === 'nova' ? null : editando"
            :hoje="hoje"
            @gravado="gravado"
            @cancelar="editando = null"
          />
          <p v-if="mensagem" role="status" data-testid="estruturada-mensagem">{{ mensagem }}</p>
        </section>

        <!-- Convênios e planos -->
        <section aria-labelledby="estruturada-cobertura" data-testid="estruturada-cobertura">
          <h3 id="estruturada-cobertura">{{ t('estruturada.cobertura.titulo') }}</h3>
          <p class="secundario">{{ t('estruturada.cobertura.texto') }}</p>
          <p data-testid="convenios-da-agenda">
            {{
              t('estruturada.cobertura.aceitosPelaAgenda', {
                lista: conveniosDaAgenda.map((c) => c.nome).join(', ') || '–',
              })
            }}
          </p>
          <ul v-if="grupos.length" class="lista">
            <li
              v-for="g in grupos"
              :key="g.fontePagadoraId"
              :data-testid="`cobertura-convenio-${g.fontePagadoraId}`"
            >
              <strong>{{ convenio(g.fontePagadoraId) }}</strong>
              <span v-if="g.convenio">
                · {{ t('estruturada.cobertura.convenioInteiro') }}: {{ rotuloCobertura(g.convenio) }}
                <em v-if="g.convenio.situacaoRevisao === 'estimada'">({{ t('estruturada.estimada') }})</em>
              </span>
              <ul>
                <li v-for="p in g.planos" :key="p.superiorId ?? 0">
                  <span v-if="p.superiorId !== null">
                    {{
                      t('estruturada.cobertura.subplanosDe', {
                        plano: p.itens[0]?.planoSuperiorNome ?? plano(p.superiorId),
                      })
                    }}:
                  </span>
                  <span
                    v-for="c in p.itens"
                    :key="c.id"
                    class="cobertura"
                    :class="{ exclui: !c.aceita }"
                    :data-testid="`cobertura-${c.id}`"
                  >
                    {{ c.planoNome ?? plano(c.planoId) }} — {{ rotuloCobertura(c) }}
                    <em v-if="c.situacaoRevisao === 'estimada'">({{ t('estruturada.estimada') }})</em>
                    <SanteBotao
                      v-if="c.textoOrigemId !== null"
                      variante="texto"
                      :rotulo="t('estruturada.verTexto')"
                      @acionar="verTexto(c.textoOrigemId)"
                    />
                    <SanteBotao
                      v-if="podeEditarRegras && incluindo === null"
                      variante="texto"
                      :rotulo="t('estruturada.edicao.revisar')"
                      :data-testid="`revisar-cobertura-${c.id}`"
                      @acionar="revisar('cobertura', c)"
                    />
                  </span>
                </li>
              </ul>
            </li>
          </ul>
          <SanteBotao
            v-if="podeEditarRegras && incluindo === null"
            variante="secundario"
            :rotulo="t('estruturada.edicao.novas.cobertura')"
            data-testid="nova-cobertura"
            @acionar="incluindo = 'cobertura'"
          />
          <RegraEstruturadaForm
            v-if="podeEditarRegras && incluindo === 'cobertura'"
            :agenda-id="agendaId"
            tipo="cobertura"
            :regra="emRevisao"
            :convenios="conveniosCobertura"
            :textos="a.textos"
            :rotulo-texto="rotuloTexto"
            :hoje="hoje"
            @gravado="gravado"
            @cancelar="fecharForm"
            @ver-texto="verTexto"
          />
        </section>

        <!-- Restrições -->
        <section aria-labelledby="estruturada-restricao" data-testid="estruturada-restricao">
          <h3 id="estruturada-restricao">{{ t('estruturada.restricao.titulo') }}</h3>
          <dl class="padrao" data-testid="restricao-padrao">
            <dt>{{ t('estruturada.restricao.padrao') }}</dt>
            <dd>
              {{ t('estruturada.restricao.sexo') }}:
              {{ t(`estruturada.restricao.sexos.${a.padrao.sexoAtendido}`) }} ·
              {{ t('estruturada.restricao.idade') }}:
              {{ idade(a.padrao.idadeMinimaAnos, a.padrao.idadeMaximaAnos) }} ·
              {{ t('estruturada.restricao.retorno') }}:
              {{ retorno(a.padrao.aceitaRetorno, a.padrao.diasRetorno) }} ·
              {{ t('estruturada.restricao.encaixe') }}: {{ encaixe(a.padrao.permiteEncaixe) }}
            </dd>
          </dl>
          <ul v-if="a.restricoes.length" class="lista" data-testid="restricoes">
            <li v-for="r in a.restricoes" :key="r.id" :data-testid="`restricao-${r.id}`">
              <strong>{{ escopo(r) }}</strong
              >:
              <template v-if="r.sexoAtendido">
                {{ t('estruturada.restricao.sexo') }}:
                {{ t(`estruturada.restricao.sexos.${r.sexoAtendido}`) }} ·
              </template>
              {{ t('estruturada.restricao.idade') }}: {{ idade(r.idadeMinimaAnos, r.idadeMaximaAnos) }} ·
              {{ t('estruturada.restricao.retorno') }}: {{ retorno(r.aceitaRetorno, r.diasRetorno) }} ·
              {{ t('estruturada.restricao.encaixe') }}: {{ encaixe(r.permiteEncaixe) }} · {{ vigencia(r) }}
              <em v-if="r.situacaoRevisao === 'estimada'">({{ t('estruturada.estimada') }})</em>
              <SanteBotao
                v-if="r.textoOrigemId !== null"
                variante="texto"
                :rotulo="t('estruturada.verTexto')"
                @acionar="verTexto(r.textoOrigemId)"
              />
              <SanteBotao
                v-if="podeEditarRegras && incluindo === null"
                variante="texto"
                :rotulo="t('estruturada.edicao.revisar')"
                :data-testid="`revisar-restricao-${r.id}`"
                @acionar="revisar('restricao', r)"
              />
            </li>
          </ul>
          <SanteBotao
            v-if="podeEditarRegras && incluindo === null"
            variante="secundario"
            :rotulo="t('estruturada.edicao.novas.restricao')"
            data-testid="nova-restricao"
            @acionar="incluindo = 'restricao'"
          />
          <RegraEstruturadaForm
            v-if="podeEditarRegras && incluindo === 'restricao'"
            :agenda-id="agendaId"
            tipo="restricao"
            :regra="emRevisao"
            :convenios="conveniosDaAgenda"
            :textos="a.textos"
            :rotulo-texto="rotuloTexto"
            :hoje="hoje"
            @gravado="gravado"
            @cancelar="fecharForm"
            @ver-texto="verTexto"
          />
        </section>

        <!-- Preparo -->
        <section aria-labelledby="estruturada-preparo" data-testid="estruturada-preparo">
          <h3 id="estruturada-preparo">{{ t('estruturada.preparo.titulo') }}</h3>
          <p v-if="a.padrao.preparo" data-testid="preparo-padrao">
            <strong>{{ t('estruturada.preparo.padraoAgenda') }}:</strong> {{ a.padrao.preparo }}
          </p>
          <p v-if="!a.padrao.preparo && a.preparos.length === 0">{{ t('estruturada.nenhuma') }}</p>
          <ul v-if="a.preparos.length" class="lista">
            <li v-for="p in a.preparos" :key="p.id" :data-testid="`preparo-${p.id}`">
              <strong>{{ tipoPreparo(p) }}</strong
              >: {{ p.descricao }}
              <template v-if="p.jejumHoras"
                >· {{ t('estruturada.preparo.jejum', { horas: p.jejumHoras }) }}</template
              >
              <em v-if="p.situacaoRevisao === 'estimada'">({{ t('estruturada.estimada') }})</em>
              <SanteBotao
                v-if="p.textoOrigemId !== null"
                variante="texto"
                :rotulo="t('estruturada.verTexto')"
                @acionar="verTexto(p.textoOrigemId)"
              />
              <SanteBotao
                v-if="podeEditarRegras && incluindo === null"
                variante="texto"
                :rotulo="t('estruturada.edicao.revisar')"
                :data-testid="`revisar-preparo-${p.id}`"
                @acionar="revisar('preparo', p)"
              />
            </li>
          </ul>
          <SanteBotao
            v-if="podeEditarRegras && incluindo === null"
            variante="secundario"
            :rotulo="t('estruturada.edicao.novas.preparo')"
            data-testid="nova-preparo"
            @acionar="incluindo = 'preparo'"
          />
          <RegraEstruturadaForm
            v-if="podeEditarRegras && incluindo === 'preparo'"
            :agenda-id="agendaId"
            tipo="preparo"
            :regra="emRevisao"
            :convenios="conveniosDaAgenda"
            :textos="a.textos"
            :rotulo-texto="rotuloTexto"
            :hoje="hoje"
            @gravado="gravado"
            @cancelar="fecharForm"
            @ver-texto="verTexto"
          />
        </section>
      </div>

      <aside
        class="textos"
        :aria-label="t('estruturada.textoOriginal.titulo')"
        data-testid="estruturada-textos"
      >
        <h3>{{ t('estruturada.textoOriginal.titulo') }}</h3>
        <p class="secundario">{{ t('estruturada.textoOriginal.legenda') }}</p>
        <p v-if="a.textos.length === 0">{{ t('estruturada.nenhumTexto') }}</p>
        <TextoOriginalAgenda
          v-for="x in a.textos"
          :key="x.id"
          :texto="x"
          :nome-convenio="convenio(x.fontePagadoraId)"
          :destacado="textoAtivo === x.id"
        />
      </aside>
    </div>
  </section>
</template>

<style scoped>
.lado-a-lado {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: var(--sgh-espaco-3, 1.5rem);
  align-items: start;
}
@media (max-width: 960px) {
  .lado-a-lado {
    grid-template-columns: minmax(0, 1fr);
  }
}
.textos {
  position: sticky;
  top: 0;
}
.estimada {
  font-style: italic;
}
.cobertura {
  display: inline-block;
  margin-right: var(--sgh-espaco-2);
}
.exclui {
  font-weight: 600;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.lista {
  padding-left: var(--sgh-espaco-3, 1.5rem);
}
</style>
