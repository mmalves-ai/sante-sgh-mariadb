<script setup lang="ts">
// Ficha do equipamento (M55, etapa 1; regras 1 e 2): os dados, a etiqueta com o QR (a câmera do celular abre a OS deste
// equipamento, D-QR-55) para imprimir, a alteração (`manutencao.equipamento.editar`), o plano de manutenção com a
// última e a próxima execução, as execuções registradas, o registro da execução com o laudo (obrigatório na calibração
// e na segurança elétrica; a reprovada para o equipamento e abre a corretiva), o planejamento de nova atividade e a
// desativação (`manutencao.preventiva.planejar`), os contratos de manutenção que o cobrem e (W0-08, M3) os operadores
// aptos, o índice de obsolescência, os eventos do ciclo de vida e o PGTS; (W0-08, M4) a instalação de um modelo pronto
// de plano da infraestrutura (PMOC, reservatório, gerador, gases) e o selo do modelo em cada plano que veio dele.
import {
  ATIVIDADES_COM_LAUDO,
  esquemaPlanejarManutencao,
  esquemaRegistrarExecucao,
  type ApoioManutencao,
  type ItemPlanoPainel,
  type ResultadoManutencao,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { desenharQr } from '../../suporte/qr.js';
import {
  ativarPlano,
  lerEquipamento,
  lerExecucoes,
  planejar,
  registrarExecucao,
  urlLaudoExecucao,
} from '../api-manutencao.js';
import {
  comTodos,
  corpoDaExecucao,
  corpoDoPlano,
  dataBr,
  OPCOES,
  problemasDe,
  rascunhoExecucaoVazio,
  rascunhoPlanoVazio,
  ROTULOS,
  urlDoQr,
} from '../comum-manutencao.js';
import CicloVidaEquipamento from './CicloVidaEquipamento.vue';
import ErroManutencao from './ErroManutencao.vue';
import FormAlterarPlano from './FormAlterarPlano.vue';
import FormEquipamento from './FormEquipamento.vue';
import FormModeloPlano from './FormModeloPlano.vue';

const props = defineProps<{ id: number; apoio: ApoioManutencao }>();
const emit = defineEmits<{ fechar: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();

const consulta = useQuery({
  queryKey: computed(() => ['manutencao', 'equipamento', props.id]),
  queryFn: () => lerEquipamento(props.id),
});
const e = computed(() => consulta.data.value ?? null);
const origem = typeof window === 'undefined' ? '' : window.location.origin;
const qr = computed(() => (e.value ? desenharQr(urlDoQr(origem, e.value.codigo), 3, 4) : null));
const imprimir = () => window.print();

const editando = ref(false);
const mensagem = ref<string | null>(null);
async function depoisDeGravar(r: ResultadoManutencao) {
  mensagem.value = r.numero ? t('manutencao.plano.osCorretiva', { numero: r.numero }) : r.mensagem;
  editando.value = false;
  planejando.value = false;
  executando.value = null;
  alterando.value = null;
  instalandoModelo.value = false;
  await cliente.invalidateQueries({ queryKey: ['manutencao'] });
}

// ── Plano: execuções, registrar, planejar, desativar ────────────────────────────────────────────────────────────────
const vendoExecucoes = ref<number | null>(null);
const execucoes = useQuery({
  queryKey: computed(() => ['manutencao', 'execucoes', vendoExecucoes.value]),
  queryFn: () => lerExecucoes(vendoExecucoes.value!),
  enabled: computed(() => vendoExecucoes.value !== null),
});
const executando = ref<ItemPlanoPainel | null>(null);
/** W0-08: o plano em alteração (pela versão lida, com motivo). */
const alterando = ref<number | null>(null);
async function alterado(m: string) {
  mensagem.value = m;
  alterando.value = null;
  await cliente.invalidateQueries({ queryKey: ['manutencao'] });
}
const execucao = ref(rascunhoExecucaoVazio(props.apoio.hoje));
const planejando = ref(false);
/** W0-08 (M4): instalando um modelo pronto de plano. */
const instalandoModelo = ref(false);
const plano = ref(rascunhoPlanoVazio(props.apoio.hoje));
const opcoesCobertura = computed(() =>
  comTodos(
    t('manutencao.nenhumSelecionado'),
    (e.value?.coberturas ?? [])
      .filter((c) => c.vigente)
      .map((c) => ({ valor: c.id, rotulo: `${c.numero} - ${c.fornecedor.nome}` })),
  ),
);
const problemas = ref<Record<string, string>>({});
const listaProblemas = computed(() => Object.values(problemas.value));
const erro = ref<unknown>(null);
const gravando = ref(false);

async function tentar(f: () => Promise<ResultadoManutencao>) {
  erro.value = null;
  gravando.value = true;
  try {
    await depoisDeGravar(await f());
  } catch (x) {
    erro.value = x;
  } finally {
    gravando.value = false;
  }
}
function abrirExecucao(p: ItemPlanoPainel) {
  executando.value = executando.value?.plano === p.plano ? null : p;
  execucao.value = rascunhoExecucaoVazio(props.apoio.hoje);
  problemas.value = {};
}
async function gravarExecucao() {
  const p = executando.value;
  if (!p) return;
  const corpo = corpoDaExecucao(execucao.value, p.versao);
  problemas.value = problemasDe(esquemaRegistrarExecucao, { ...corpo, plano: p.plano });
  if (Object.keys(problemas.value).length > 0) return;
  await tentar(() => registrarExecucao(p.plano, corpo));
}
async function gravarPlano() {
  if (!e.value) return;
  const corpo = corpoDoPlano(plano.value, e.value.id);
  problemas.value = problemasDe(esquemaPlanejarManutencao, corpo);
  if (Object.keys(problemas.value).length > 0) return;
  await tentar(() => planejar(corpo));
}
const desativar = (p: ItemPlanoPainel) => tentar(() => ativarPlano(p.plano, p.versao, false));
const pedeLaudo = computed(
  () => !!executando.value && ATIVIDADES_COM_LAUDO.includes(executando.value.atividade),
);
</script>

<template>
  <section class="bloco" aria-labelledby="equipamento-ficha-titulo" data-testid="equipamento-ficha">
    <ErroManutencao v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!e" role="status">{{ t('manutencao.carregando') }}</p>
    <template v-else>
      <div class="acoes">
        <h2 id="equipamento-ficha-titulo">{{ e.codigo }} - {{ e.nome }}</h2>
        <SanteBotao
          variante="texto"
          :rotulo="t('manutencao.fechar')"
          data-testid="equipamento-fechar"
          @acionar="emit('fechar')"
        />
      </div>
      <p v-if="mensagem" role="status" data-testid="equipamento-mensagem">{{ mensagem }}</p>
      <SanteAlerta
        v-if="e.parado"
        variante="alerta"
        :texto="`${t('manutencao.equipamentos.campos.parado')}: ${t('manutencao.equipamentos.campos.osAbertas')} ${e.osAbertas}`"
        data-testid="equipamento-parado"
      />

      <FormEquipamento
        v-if="editando"
        :apoio="apoio"
        :equipamento="e"
        @gravado="depoisDeGravar"
        @cancelar="editando = false"
      />
      <template v-else>
        <dl class="ficha">
          <dt>{{ t('manutencao.equipamentos.campos.tipo') }}</dt>
          <dd>{{ ROTULOS.tipo[e.tipo] }}</dd>
          <dt>{{ t('manutencao.equipamentos.campos.criticidade') }}</dt>
          <dd>{{ ROTULOS.criticidade[e.criticidade] }}</dd>
          <template v-if="e.classeRisco">
            <dt>{{ t('manutencao.equipamentos.campos.classeRisco') }}</dt>
            <dd>{{ ROTULOS.classeRisco[e.classeRisco] }}</dd>
          </template>
          <dt>{{ t('manutencao.equipamentos.campos.situacao') }}</dt>
          <dd>{{ ROTULOS.situacaoEquipamento[e.situacao] }}</dd>
          <dt>{{ t('manutencao.equipamentos.campos.setor') }}</dt>
          <dd>
            {{ e.setor?.nome ?? '' }}<template v-if="e.localizacao"> - {{ e.localizacao }}</template>
          </dd>
          <template v-if="e.unidade">
            <dt>{{ t('manutencao.equipamentos.campos.unidade') }}</dt>
            <dd>{{ e.unidade.nome }}</dd>
          </template>
          <dt>{{ t('manutencao.equipamentos.campos.fabricante') }}</dt>
          <dd>{{ [e.fabricante, e.modelo].filter(Boolean).join(' / ') }}</dd>
          <template v-if="e.numeroSerie">
            <dt>{{ t('manutencao.equipamentos.campos.numeroSerie') }}</dt>
            <dd>{{ e.numeroSerie }}</dd>
          </template>
          <template v-if="e.registroAnvisa">
            <dt>{{ t('manutencao.equipamentos.campos.registroAnvisa') }}</dt>
            <dd>{{ e.registroAnvisa }}</dd>
          </template>
          <dt>{{ t('manutencao.equipamentos.campos.recurso') }}</dt>
          <dd data-testid="equipamento-recurso-lido">
            {{
              e.recurso
                ? `${ROTULOS.recursoTipo[e.recurso.tipo]}: ${e.recurso.nome}`
                : t('manutencao.equipamentos.semRecurso')
            }}
          </dd>
          <template v-if="e.bemPatrimonial">
            <dt>{{ t('manutencao.equipamentos.campos.bemPatrimonial') }}</dt>
            <dd data-testid="equipamento-bem-lido">
              {{ e.bem ? `${e.bem.plaqueta} ${e.bem.descricao}` : e.bemPatrimonial }}
            </dd>
          </template>
          <dt>{{ t('manutencao.equipamentos.campos.instalacao') }}</dt>
          <dd>{{ dataBr(e.instalacao) }}</dd>
          <dt>{{ t('manutencao.equipamentos.campos.garantiaAte') }}</dt>
          <dd>{{ dataBr(e.garantiaAte) }}</dd>
        </dl>
        <div class="acoes">
          <SanteBotao
            v-if="apoio.pode.editar"
            variante="secundario"
            :rotulo="t('manutencao.editar')"
            :desabilitado="!apoio.gravacao.ligada"
            data-testid="equipamento-editar"
            @acionar="editando = true"
          />
          <RouterLink
            :to="`/manutencao/os?abrir=${encodeURIComponent(e.codigo)}`"
            data-testid="equipamento-abrir-os"
          >
            {{ t('manutencao.equipamentos.abrirOs') }}
          </RouterLink>
        </div>
      </template>

      <section aria-labelledby="equipamento-etiqueta-titulo">
        <h3 id="equipamento-etiqueta-titulo">{{ t('manutencao.equipamentos.etiqueta') }}</h3>
        <p class="secundario">{{ t('manutencao.equipamentos.etiquetaAjuda') }}</p>
        <div class="etiqueta" data-testid="equipamento-etiqueta">
          <svg
            v-if="qr"
            :width="qr.lado"
            :height="qr.lado"
            :viewBox="`0 0 ${qr.lado} ${qr.lado}`"
            role="img"
            :aria-label="e.codigo"
          >
            <rect class="qr__fundo" :width="qr.lado" :height="qr.lado" />
            <path class="qr__modulos" :d="qr.caminho" />
          </svg>
          <strong>{{ e.codigo }}</strong>
          <span>{{ e.nome }}</span>
        </div>
        <SanteBotao
          variante="secundario"
          :rotulo="t('manutencao.equipamentos.etiqueta')"
          data-testid="equipamento-imprimir"
          @acionar="imprimir"
        />
      </section>

      <section aria-labelledby="equipamento-plano-titulo">
        <h3 id="equipamento-plano-titulo">{{ t('manutencao.plano.titulo') }}</h3>
        <p v-if="e.planos.length === 0" data-testid="equipamento-sem-plano">
          {{ t('manutencao.equipamentos.nenhumPlano') }}
        </p>
        <div v-else class="rolagem">
          <table class="tabela" data-testid="equipamento-planos">
            <thead>
              <tr>
                <th scope="col">{{ t('manutencao.plano.campos.atividade') }}</th>
                <th scope="col">{{ t('manutencao.plano.campos.periodicidade') }}</th>
                <th scope="col">{{ t('manutencao.plano.campos.ultima') }}</th>
                <th scope="col">{{ t('manutencao.plano.campos.proxima') }}</th>
                <th scope="col">{{ t('manutencao.equipamentos.campos.situacao') }}</th>
                <th scope="col">{{ t('manutencao.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in e.planos" :key="p.plano" :data-testid="`plano-${p.plano}`">
                <td>
                  {{ ROTULOS.atividade[p.atividade] }}
                  <span v-if="p.modelo" class="selo" :data-testid="`plano-modelo-${p.plano}`">{{
                    t('manutencao.plano.modelo.seloCurto', {
                      nome: t(`manutencao.plano.modelo.nomes.${p.modelo}`),
                    })
                  }}</span>
                </td>
                <td>{{ p.periodicidade.quantidade }} {{ p.periodicidade.unidade }}</td>
                <td>
                  {{ dataBr(p.ultimaExecucao)
                  }}<template v-if="p.ultimoResultado">
                    ({{ ROTULOS.resultado[p.ultimoResultado] }})</template
                  >
                </td>
                <td>{{ dataBr(p.proxima) }}</td>
                <td :class="{ vencido: p.situacao === 'vencida' }">
                  {{ ROTULOS.situacaoPlano[p.situacao] }}
                </td>
                <td class="acoes">
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('manutencao.plano.execucoes')"
                    :data-testid="`plano-execucoes-${p.plano}`"
                    @acionar="vendoExecucoes = vendoExecucoes === p.plano ? null : p.plano"
                  />
                  <template v-if="apoio.pode.planejar">
                    <SanteBotao
                      variante="secundario"
                      :rotulo="t('manutencao.plano.registrar')"
                      :desabilitado="!apoio.gravacao.ligada"
                      :data-testid="`plano-registrar-${p.plano}`"
                      @acionar="abrirExecucao(p)"
                    />
                    <SanteBotao
                      variante="secundario"
                      :rotulo="t('manutencao.plano.alterar')"
                      :desabilitado="!apoio.gravacao.ligada"
                      :data-testid="`plano-alterar-${p.plano}`"
                      @acionar="alterando = alterando === p.plano ? null : p.plano"
                    />
                    <SanteBotao
                      variante="destrutivo"
                      :confirmacao="t('manutencao.plano.desativarConfirma')"
                      :rotulo="t('manutencao.plano.desativar')"
                      :desabilitado="!apoio.gravacao.ligada || gravando"
                      :data-testid="`plano-desativar-${p.plano}`"
                      @acionar="desativar(p)"
                    />
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="vendoExecucoes !== null" class="bloco" data-testid="plano-execucoes">
          <h4>{{ t('manutencao.plano.execucoes') }}</h4>
          <p v-if="!execucoes.data.value" role="status">{{ t('manutencao.carregando') }}</p>
          <p v-else-if="execucoes.data.value.length === 0">{{ t('manutencao.plano.nenhumaExecucao') }}</p>
          <ul v-else class="historico">
            <li v-for="x in execucoes.data.value" :key="x.id">
              {{ dataBr(x.data) }}: {{ ROTULOS.resultado[x.resultado] }} - {{ t('manutencao.plano.por') }}
              {{ x.por }}
              <template v-if="x.laudo"> - {{ t('manutencao.plano.campos.laudo') }} {{ x.laudo }}</template>
              <template v-if="x.observacao"> ({{ x.observacao }})</template>
              -
              <a
                :href="urlLaudoExecucao(props.id, x.id)"
                :data-testid="`execucao-laudo-pdf-${x.id}`"
                download
                >{{ t('manutencao.plano.baixarLaudo') }}</a
              >
            </li>
          </ul>
        </div>

        <FormAlterarPlano
          v-if="alterando !== null"
          :key="alterando"
          :plano="alterando"
          :apoio="apoio"
          :opcoes-cobertura="opcoesCobertura"
          @alterado="alterado"
          @cancelar="alterando = null"
        />

        <form
          v-if="executando"
          class="bloco"
          data-testid="plano-form-execucao"
          @submit.prevent="gravarExecucao"
        >
          <h4>{{ t('manutencao.plano.registrar') }}: {{ ROTULOS.atividade[executando.atividade] }}</h4>
          <SanteAlerta v-if="pedeLaudo" variante="info" :texto="t('manutencao.plano.laudoObrigatorio')" />
          <div class="campos">
            <SanteData
              v-model="execucao.data"
              editavel
              :rotulo="t('manutencao.data')"
              :maximo="apoio.hoje"
              data-testid="execucao-data"
            />
            <SanteSelecao
              v-model="execucao.resultado"
              :rotulo="t('manutencao.plano.campos.resultado')"
              :opcoes="OPCOES.resultado"
              data-testid="execucao-resultado"
            />
            <SanteCampoTexto
              v-model="execucao.laudo"
              :obrigatorio="pedeLaudo"
              :rotulo="t('manutencao.plano.campos.laudo')"
              :max-bytes="10"
              data-testid="execucao-laudo"
            />
            <SanteCampoTexto
              v-model="execucao.certificadoPadrao"
              :rotulo="t('manutencao.plano.campos.certificadoPadrao')"
              :max-bytes="60"
              data-testid="execucao-certificado"
            />
          </div>
          <p class="secundario">{{ t('manutencao.laudoAjuda') }}</p>
          <SanteAlerta
            v-if="execucao.resultado === 'reprovado'"
            variante="aviso"
            :texto="t('manutencao.plano.reprovadoAviso')"
          />
          <SanteCampoTexto
            v-model="execucao.observacao"
            multilinha
            :obrigatorio="execucao.resultado !== 'aprovado'"
            :rotulo="t('manutencao.plano.campos.observacao')"
            :max-bytes="2000"
            data-testid="execucao-observacao"
          />
          <ul v-if="listaProblemas.length > 0" class="vencido" role="alert" data-testid="execucao-problemas">
            <li v-for="x in listaProblemas" :key="x">{{ x }}</li>
          </ul>
          <ErroManutencao v-if="erro" :erro="erro" />
          <div class="acoes">
            <SanteBotao
              tipo="submit"
              :rotulo="t('manutencao.gravar')"
              :desabilitado="gravando"
              data-testid="execucao-gravar"
            />
            <SanteBotao variante="texto" :rotulo="t('manutencao.cancelar')" @acionar="executando = null" />
          </div>
        </form>

        <SanteBotao
          v-if="apoio.pode.planejar && !planejando"
          variante="secundario"
          :rotulo="t('manutencao.plano.novo')"
          :desabilitado="!apoio.gravacao.ligada || e.situacao === 'desativado'"
          data-testid="plano-novo"
          @acionar="
            planejando = true;
            instalandoModelo = false;
            problemas = {};
          "
        />
        <SanteBotao
          v-if="apoio.pode.planejar && !instalandoModelo"
          variante="secundario"
          :rotulo="t('manutencao.plano.modelo.titulo')"
          :desabilitado="!apoio.gravacao.ligada || e.situacao === 'desativado'"
          data-testid="plano-modelo"
          @acionar="
            instalandoModelo = true;
            planejando = false;
          "
        />
        <FormModeloPlano
          v-if="instalandoModelo"
          :equipamento="e.id"
          :apoio="apoio"
          :opcoes-cobertura="opcoesCobertura"
          @instalado="depoisDeGravar"
          @cancelar="instalandoModelo = false"
        />
        <form v-if="planejando" class="bloco" data-testid="plano-form" @submit.prevent="gravarPlano">
          <h4>{{ t('manutencao.plano.novo') }}</h4>
          <div class="campos">
            <SanteSelecao
              v-model="plano.atividade"
              :rotulo="t('manutencao.plano.campos.atividade')"
              :opcoes="OPCOES.atividade"
              data-testid="plano-atividade"
            />
            <SanteCampoTexto
              v-model="plano.quantidade"
              :rotulo="t('manutencao.plano.campos.periodicidade')"
              :max-bytes="3"
              data-testid="plano-quantidade"
            />
            <SanteSelecao
              v-model="plano.unidade"
              :rotulo="t('manutencao.plano.campos.unidade')"
              :opcoes="OPCOES.unidadePeriodo"
              data-testid="plano-unidade"
            />
            <SanteData
              v-model="plano.dataBase"
              editavel
              :rotulo="t('manutencao.plano.campos.dataBase')"
              data-testid="plano-data-base"
            />
            <SanteCampoTexto
              v-model="plano.antecedencia"
              :rotulo="t('manutencao.plano.campos.antecedencia')"
              :max-bytes="3"
              data-testid="plano-antecedencia"
            />
            <SanteSelecao
              v-model="plano.executor"
              :rotulo="t('manutencao.plano.campos.executor')"
              :opcoes="OPCOES.executor"
              data-testid="plano-executor"
            />
            <SanteSelecao
              v-if="plano.executor === 'contrato'"
              v-model="plano.cobertura"
              :rotulo="t('manutencao.plano.campos.cobertura')"
              :opcoes="opcoesCobertura"
              busca
              data-testid="plano-cobertura"
            />
          </div>
          <SanteCampoTexto
            v-model="plano.procedimento"
            multilinha
            :rotulo="t('manutencao.plano.campos.procedimento')"
            :max-bytes="2000"
            data-testid="plano-procedimento"
          />
          <ul v-if="listaProblemas.length > 0" class="vencido" role="alert" data-testid="plano-problemas">
            <li v-for="x in listaProblemas" :key="x">{{ x }}</li>
          </ul>
          <ErroManutencao v-if="erro" :erro="erro" />
          <div class="acoes">
            <SanteBotao
              tipo="submit"
              :rotulo="t('manutencao.gravar')"
              :desabilitado="gravando"
              data-testid="plano-gravar"
            />
            <SanteBotao variante="texto" :rotulo="t('manutencao.cancelar')" @acionar="planejando = false" />
          </div>
        </form>
      </section>

      <section aria-labelledby="equipamento-coberturas-titulo">
        <h3 id="equipamento-coberturas-titulo">{{ t('manutencao.equipamentos.coberturas') }}</h3>
        <p v-if="e.coberturas.length === 0">{{ t('manutencao.contratos.nenhum') }}</p>
        <ul v-else class="historico" data-testid="equipamento-coberturas">
          <li v-for="c in e.coberturas" :key="c.id">
            {{ c.numero }} - {{ c.fornecedor.nome }} - {{ ROTULOS.cobertura[c.cobertura] }} -
            {{ t('manutencao.contratos.vigencia', { inicio: dataBr(c.inicio), fim: dataBr(c.fim) }) }}
            <span :class="{ vencido: !c.vigente }"
              >({{ c.vigente ? t('manutencao.contratos.vigente') : t('manutencao.contratos.vencido') }})</span
            >
          </li>
        </ul>
      </section>

      <CicloVidaEquipamento :equipamento="e" :apoio="apoio" />
    </template>
  </section>
</template>

<style scoped src="./estilo-manutencao.css"></style>
