<script setup lang="ts">
// Consolidação dos avisos, histórico de envio e de resposta, e "meus avisos" (01-ADM L76), dentro de "Alertas e
// gatilhos do sistema", abaixo das regras de alerta.
// Desenho: lista e formulário na mesma tela, a regra de consolidação conferida ENQUANTO se digita pela mesma regra do
// domínio que o servidor usa (o botão só libera sem pendência); o histórico abre com a medição por canal (taxa de
// leitura e tempo até a leitura) e filtra por canal num clique; "meus avisos" põe primeiro o que espera resposta, com
// "Ciente" e "Resolver" na própria linha. A consolidação roda sozinha pelo despachante do worker; "Consolidar agora"
// só adianta. Sem o banco do cliente a API responde 503 e o painel some.
import { PERMISSOES_M10_CODIGOS as C } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import {
  consolidarCanal,
  gravarConsolidacao,
  lerHistoricoNotificacao,
  lerMeusEnvios,
  lerPainelNotificacao,
  responderEnvio,
} from '../api-notificacao-regras.js';
import {
  alternarCampo,
  CAMPOS_AGRUPAMENTO,
  type ConsolidacaoLida,
  conferirConsolidacao,
  corpoDaConsolidacao,
  FORMATOS_CONSOLIDACAO,
  type FormConsolidacao,
  formConsolidacaoNova,
  formDaConsolidacao,
  percentual,
  quando,
  separarMeusEnvios,
} from '../notificacao-consolidacao-tela.js';

const { t } = useI18n();
const qc = useQueryClient();
const podeLer = computed(() => pode(C.alertaLer));
const podeEditar = computed(() => pode(C.alertaEditar));
const podeResponder = computed(() => pode(C.notificacaoResponder));

const painel = useQuery({
  queryKey: ['adm', 'regras-alerta'],
  queryFn: () => lerPainelNotificacao(),
  enabled: podeLer,
  retry: false,
});
const filtroCanal = ref('');
const historico = useQuery({
  queryKey: computed(() => ['adm', 'notificacao-historico', filtroCanal.value]),
  queryFn: () => lerHistoricoNotificacao(filtroCanal.value || undefined),
  enabled: podeLer,
  retry: false,
});
const meus = useQuery({
  queryKey: ['acesso', 'meus-envios'],
  queryFn: () => lerMeusEnvios(),
  enabled: podeResponder,
  retry: false,
});
const indisponivel = (e: unknown) => e instanceof ErroApi && e.status === 503;

const canais = computed(() => painel.data.value?.canais ?? []);
const nomeCanal = (codigo: string) => canais.value.find((c) => c.codigo === codigo)?.descricao ?? codigo;
const opcoesFiltro = computed(() => [
  { valor: '', rotulo: t('regrasAlerta.notificacao.todosCanais') },
  ...canais.value.map((c) => ({ valor: c.codigo, rotulo: c.descricao })),
]);
const canalConsolidar = ref('');
const opcoesConsolidar = computed(() => canais.value.map((c) => ({ valor: c.codigo, rotulo: c.descricao })));
const opcoesFormato = computed(() =>
  FORMATOS_CONSOLIDACAO.map((f) => ({ valor: f, rotulo: t(`regrasAlerta.notificacao.formatos.${f}`) })),
);

const form = ref<FormConsolidacao | null>(null);
const emEdicao = ref<ConsolidacaoLida | null>(null);
const titulo = ref<HTMLElement | null>(null);
const aviso = ref('');
const erro = ref<unknown>(null);
const ocupado = ref(false);
const pendencia = computed(() => (form.value ? conferirConsolidacao(form.value) : null));

async function abrir(c: ConsolidacaoLida | null): Promise<void> {
  emEdicao.value = c;
  form.value = c ? formDaConsolidacao(c) : formConsolidacaoNova();
  aviso.value = '';
  erro.value = null;
  await nextTick();
  titulo.value?.focus();
}
function fechar(): void {
  form.value = null;
  emEdicao.value = null;
}

async function agir(acao: () => Promise<string>, invalidar: readonly (readonly unknown[])[]): Promise<void> {
  if (ocupado.value) return;
  aviso.value = '';
  erro.value = null;
  ocupado.value = true;
  try {
    aviso.value = await acao();
    await Promise.all(invalidar.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

function gravar(): Promise<void> {
  const f = form.value;
  if (!f || pendencia.value) return Promise.resolve();
  return agir(async () => {
    await gravarConsolidacao(corpoDaConsolidacao(f), crypto.randomUUID());
    fechar();
    return t('regrasAlerta.notificacao.gravada', { nome: f.nome.trim() });
  }, [['adm', 'regras-alerta']]);
}

function consolidar(): Promise<void> {
  if (!canalConsolidar.value) return Promise.resolve();
  return agir(async () => {
    const r = (await consolidarCanal(canalConsolidar.value, crypto.randomUUID())).resultado;
    return t('regrasAlerta.notificacao.consolidado', {
      envios: Number(r['envios'] ?? 0),
      avisos: Number(r['avisos'] ?? 0),
      aguardando: Number(r['aguardando'] ?? 0),
      retidos: Number(r['retidos'] ?? 0),
    });
  }, [
    ['adm', 'notificacao-historico'],
    ['acesso', 'meus-envios'],
  ]);
}

function responder(id: number, versao: number, resolver: boolean): Promise<void> {
  return agir(async () => {
    const r = (await responderEnvio(id, versao, resolver, crypto.randomUUID())).resultado;
    return t('regrasAlerta.notificacao.respondido', {
      avisos: Number(r['avisos'] ?? 0),
      resolvidos: Number(r['resolvidos'] ?? 0),
    });
  }, [
    ['acesso', 'meus-envios'],
    ['adm', 'notificacao-historico'],
  ]);
}

const meusSeparados = computed(() => separarMeusEnvios(meus.data.value?.envios ?? []));
const nomesCampos = (cs: readonly string[]) =>
  cs.map((c) => t(`regrasAlerta.notificacao.camposNomes.${c}`)).join(', ');
</script>

<template>
  <div class="notificacao">
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="notificacao-aviso" />
    <MensagemErro v-if="erro" :erro="erro" />

    <section
      v-if="podeLer && !indisponivel(painel.error.value)"
      aria-labelledby="consolidacoes-titulo"
      data-testid="consolidacoes"
    >
      <h2 id="consolidacoes-titulo">{{ t('regrasAlerta.notificacao.consolidacoes') }}</h2>
      <p>{{ t('regrasAlerta.notificacao.consolidacoesTexto') }}</p>
      <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
      <p v-else-if="painel.isPending.value">{{ t('regrasAlerta.carregando') }}</p>
      <template v-else-if="painel.data.value">
        <p v-if="painel.data.value.consolidacoes.length === 0">
          {{ t('regrasAlerta.notificacao.nenhumaConsolidacao') }}
        </p>
        <div v-else class="rolagem">
          <table>
            <caption>
              {{
                t('regrasAlerta.notificacao.legendaConsolidacoes')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('regrasAlerta.notificacao.col.nome') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.col.janela') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.col.agrupa') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.col.limite') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.col.resumo') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.col.situacao') }}</th>
                <th v-if="podeEditar" scope="col">{{ t('regrasAlerta.notificacao.col.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in painel.data.value.consolidacoes" :key="c.id" data-testid="consolidacao-linha">
                <th scope="row">
                  {{ c.nome }} <small>{{ c.codigo }}</small>
                </th>
                <td>{{ t('regrasAlerta.notificacao.minutos', { n: c.janelaMinutos }) }}</td>
                <td>{{ nomesCampos(c.campos) }}</td>
                <td>
                  {{
                    c.limitePorUsuario === null
                      ? t('regrasAlerta.notificacao.semLimite')
                      : t('regrasAlerta.notificacao.limiteDe', {
                          n: c.limitePorUsuario,
                          m: c.periodoLimiteMinutos ?? 0,
                        })
                  }}
                </td>
                <td>{{ c.horarioResumo ?? '—' }}</td>
                <td>{{ c.ativo ? t('regrasAlerta.ativa') : t('regrasAlerta.inativa') }}</td>
                <td v-if="podeEditar" class="acoes">
                  <SanteBotao
                    :rotulo="t('regrasAlerta.notificacao.alterar')"
                    :aria-label="t('regrasAlerta.notificacao.alterarDe', { nome: c.nome })"
                    variante="secundario"
                    :desabilitado="ocupado"
                    data-testid="consolidacao-alterar"
                    @acionar="abrir(c)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <SanteBotao
          v-if="podeEditar && !form"
          :rotulo="t('regrasAlerta.notificacao.nova')"
          data-testid="consolidacao-nova"
          @acionar="abrir(null)"
        />

        <form v-if="form" class="formulario" data-testid="consolidacao-form" @submit.prevent="gravar">
          <h3 ref="titulo" tabindex="-1">
            {{
              emEdicao
                ? t('regrasAlerta.notificacao.tituloAlterar', { nome: emEdicao.nome })
                : t('regrasAlerta.notificacao.tituloNova')
            }}
          </h3>
          <div class="linha">
            <div class="campo">
              <label for="consolidacao-codigo">{{ t('regrasAlerta.notificacao.codigo') }}</label>
              <input
                id="consolidacao-codigo"
                v-model="form.codigo"
                maxlength="30"
                :disabled="emEdicao !== null"
                data-testid="consolidacao-codigo"
              />
            </div>
            <div class="campo">
              <label for="consolidacao-nome">{{ t('regrasAlerta.notificacao.nome') }}</label>
              <input
                id="consolidacao-nome"
                v-model="form.nome"
                maxlength="150"
                data-testid="consolidacao-nome"
              />
            </div>
          </div>
          <div class="linha">
            <div class="campo">
              <label for="consolidacao-janela">{{ t('regrasAlerta.notificacao.janela') }}</label>
              <input
                id="consolidacao-janela"
                v-model="form.janelaMinutos"
                inputmode="numeric"
                maxlength="5"
                aria-describedby="consolidacao-janela-ajuda"
                data-testid="consolidacao-janela"
              />
              <small id="consolidacao-janela-ajuda">{{ t('regrasAlerta.notificacao.janelaAjuda') }}</small>
            </div>
            <div class="campo">
              <label for="consolidacao-horario">{{ t('regrasAlerta.notificacao.horario') }}</label>
              <input
                id="consolidacao-horario"
                v-model="form.horarioResumo"
                maxlength="5"
                data-testid="consolidacao-horario"
              />
            </div>
            <SanteSelecao
              v-model="form.formato"
              :rotulo="t('regrasAlerta.notificacao.formato')"
              :opcoes="opcoesFormato"
              data-testid="consolidacao-formato"
            />
          </div>
          <fieldset class="grupo">
            <legend>{{ t('regrasAlerta.notificacao.campos') }}</legend>
            <div class="linha">
              <label v-for="c in CAMPOS_AGRUPAMENTO" :key="c">
                <input
                  type="checkbox"
                  :checked="form.campos.includes(c)"
                  :data-testid="`consolidacao-campo-${c}`"
                  @change="form.campos = alternarCampo(form.campos, c)"
                />
                {{ t(`regrasAlerta.notificacao.camposNomes.${c}`) }}
              </label>
            </div>
          </fieldset>
          <label>
            <input v-model="form.comLimite" type="checkbox" data-testid="consolidacao-com-limite" />
            {{ t('regrasAlerta.notificacao.comLimite') }}
          </label>
          <div v-if="form.comLimite" class="linha">
            <div class="campo">
              <label for="consolidacao-limite">{{ t('regrasAlerta.notificacao.limite') }}</label>
              <input
                id="consolidacao-limite"
                v-model="form.limitePorUsuario"
                inputmode="numeric"
                maxlength="4"
                data-testid="consolidacao-limite"
              />
            </div>
            <div class="campo">
              <label for="consolidacao-periodo">{{ t('regrasAlerta.notificacao.periodo') }}</label>
              <input
                id="consolidacao-periodo"
                v-model="form.periodoLimiteMinutos"
                inputmode="numeric"
                maxlength="5"
                data-testid="consolidacao-periodo"
              />
            </div>
          </div>
          <label>
            <input v-model="form.ativo" type="checkbox" data-testid="consolidacao-ativa" />
            {{ t('regrasAlerta.notificacao.ativa') }}
          </label>
          <p v-if="pendencia" class="pendencia" role="status" data-testid="consolidacao-pendencia">
            {{ t('regrasAlerta.notificacao.pendencia', { texto: pendencia }) }}
          </p>
          <div class="linha">
            <SanteBotao
              tipo="submit"
              :rotulo="t('regrasAlerta.notificacao.gravar')"
              :desabilitado="ocupado || pendencia !== null"
              data-testid="consolidacao-gravar"
            />
            <SanteBotao
              :rotulo="t('regrasAlerta.notificacao.cancelar')"
              variante="secundario"
              data-testid="consolidacao-cancelar"
              @acionar="fechar"
            />
          </div>
        </form>

        <div v-if="podeEditar && canais.length" class="consolidar" data-testid="consolidar">
          <h3>{{ t('regrasAlerta.notificacao.consolidarTitulo') }}</h3>
          <p>{{ t('regrasAlerta.notificacao.consolidarTexto') }}</p>
          <div class="linha">
            <SanteSelecao
              v-model="canalConsolidar"
              :rotulo="t('regrasAlerta.notificacao.canal')"
              :opcoes="opcoesConsolidar"
              data-testid="consolidar-canal"
            />
            <SanteBotao
              :rotulo="t('regrasAlerta.notificacao.consolidar')"
              :desabilitado="ocupado || !canalConsolidar"
              data-testid="consolidar-agora"
              @acionar="consolidar"
            />
          </div>
        </div>
      </template>
    </section>

    <section
      v-if="podeLer && !indisponivel(historico.error.value)"
      aria-labelledby="historico-titulo"
      data-testid="historico-envios"
    >
      <h2 id="historico-titulo">{{ t('regrasAlerta.notificacao.historico') }}</h2>
      <p>{{ t('regrasAlerta.notificacao.historicoTexto') }}</p>
      <SanteSelecao
        v-model="filtroCanal"
        :rotulo="t('regrasAlerta.notificacao.canal')"
        :opcoes="opcoesFiltro"
        data-testid="historico-canal"
      />
      <MensagemErro v-if="historico.isError.value" :erro="historico.error.value" />
      <p v-else-if="historico.isPending.value">{{ t('regrasAlerta.carregando') }}</p>
      <template v-else-if="historico.data.value">
        <div v-if="historico.data.value.medicao.length" class="rolagem">
          <table data-testid="historico-medicao">
            <caption>
              {{
                t('regrasAlerta.notificacao.legendaMedicao')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('regrasAlerta.notificacao.med.canal') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.med.envios') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.med.avisos') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.med.lidos') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.med.falhas') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.med.aguardando') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.med.taxa') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.med.mediana') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in historico.data.value.medicao" :key="m.canal">
                <th scope="row">{{ nomeCanal(m.canal) }}</th>
                <td>{{ m.envios }}</td>
                <td>{{ m.avisos }}</td>
                <td>{{ m.lidos }}</td>
                <td>{{ m.falhas }}</td>
                <td>{{ m.aguardando }}</td>
                <td>{{ percentual(m.taxaLeituraPercentual) }}</td>
                <td>
                  {{
                    m.medianaMinutosAteLeitura === null
                      ? '—'
                      : t('regrasAlerta.notificacao.minutos', { n: m.medianaMinutosAteLeitura })
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="historico.data.value.envios.length === 0">{{ t('regrasAlerta.notificacao.nenhumEnvio') }}</p>
        <div v-else class="rolagem">
          <table>
            <caption>
              {{
                t('regrasAlerta.notificacao.legendaEnvios')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('regrasAlerta.notificacao.env.quem') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.env.canal') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.env.avisos') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.env.situacao') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.env.tentativas') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.env.ocorrido') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.env.lido') }}</th>
                <th scope="col">{{ t('regrasAlerta.notificacao.env.erro') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in historico.data.value.envios" :key="e.id" data-testid="historico-envio">
                <th scope="row">{{ e.usuario }}</th>
                <td>{{ nomeCanal(e.canal) }}</td>
                <td>{{ e.quantidadeAvisos }}</td>
                <td>{{ t(`regrasAlerta.notificacao.situacoes.${e.situacao}`) }}</td>
                <td>{{ e.tentativas }}</td>
                <td>{{ quando(e.ocorridoEm) }}</td>
                <td>{{ quando(e.lidoEm) }}</td>
                <td>{{ e.erro ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>

    <section
      v-if="podeResponder && !indisponivel(meus.error.value)"
      aria-labelledby="meus-avisos-titulo"
      data-testid="meus-avisos"
    >
      <h2 id="meus-avisos-titulo">{{ t('regrasAlerta.notificacao.meus') }}</h2>
      <p>{{ t('regrasAlerta.notificacao.meusTexto') }}</p>
      <MensagemErro v-if="meus.isError.value" :erro="meus.error.value" />
      <p v-else-if="meus.isPending.value">{{ t('regrasAlerta.carregando') }}</p>
      <template v-else>
        <h3>{{ t('regrasAlerta.notificacao.aResponder') }}</h3>
        <p v-if="meusSeparados.aResponder.length === 0">{{ t('regrasAlerta.notificacao.nenhumMeu') }}</p>
        <ul v-else class="lista">
          <li v-for="e in meusSeparados.aResponder" :key="e.id" data-testid="meu-envio">
            <span>{{
              t('regrasAlerta.notificacao.avisosN', {
                n: e.quantidadeAvisos,
                canal: nomeCanal(e.canal),
                quando: quando(e.ocorridoEm),
              })
            }}</span>
            <SanteBotao
              :rotulo="t('regrasAlerta.notificacao.ciente')"
              :aria-label="t('regrasAlerta.notificacao.cienteDe', { id: e.id })"
              variante="secundario"
              :desabilitado="ocupado"
              data-testid="meu-envio-ciente"
              @acionar="responder(e.id, e.versao, false)"
            />
            <SanteBotao
              :rotulo="t('regrasAlerta.notificacao.resolver')"
              :aria-label="t('regrasAlerta.notificacao.resolverDe', { id: e.id })"
              :desabilitado="ocupado"
              data-testid="meu-envio-resolver"
              @acionar="responder(e.id, e.versao, true)"
            />
          </li>
        </ul>
        <template v-if="meusSeparados.respondidos.length">
          <h3>{{ t('regrasAlerta.notificacao.respondidos') }}</h3>
          <ul class="lista">
            <li v-for="e in meusSeparados.respondidos" :key="e.id" data-testid="meu-envio-respondido">
              {{
                t('regrasAlerta.notificacao.avisosN', {
                  n: e.quantidadeAvisos,
                  canal: nomeCanal(e.canal),
                  quando: quando(e.lidoEm ?? e.ocorridoEm),
                })
              }}
              · {{ t(`regrasAlerta.notificacao.situacoes.${e.situacao}`) }}
            </li>
          </ul>
        </template>
      </template>
    </section>
  </div>
</template>

<style scoped>
.notificacao section {
  margin-bottom: var(--sgh-espaco-3);
}
.rolagem {
  overflow-x: auto;
  margin: var(--sgh-espaco-2) 0;
}
th small {
  display: block;
  font-weight: normal;
}
.acoes {
  white-space: nowrap;
}
.formulario {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 48rem;
  margin: var(--sgh-espaco-3) 0;
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-3);
}
.grupo {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.lista li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
  margin-bottom: var(--sgh-espaco-1);
}
.consolidar {
  margin-top: var(--sgh-espaco-3);
}
</style>
