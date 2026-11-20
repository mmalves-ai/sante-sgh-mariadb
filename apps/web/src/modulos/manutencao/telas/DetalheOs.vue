<script setup lang="ts">
// Detalhe da ordem de serviço (M55, etapa 1; regra 1): os dois prazos (atendimento e solução, pelo SLA da prioridade),
// a parada do equipamento, o contrato acionado, a conclusão com os custos e a conta impressa, o histórico e as ações
// que o servidor diz que a pessoa pode fazer agora (`acoes`): assumir (prioridade final, quem atende e o contrato),
// andamento (as esperas), concluir (causa, solução, tempos do reparo, volta ao uso, custos, laudo), o aceite ou a recusa
// de quem abriu (ou o encerramento sem aceite depois do prazo) e o cancelamento com motivo. Com o equipamento crítico
// parado, o alerta do setor e, na agenda de consultas, o caminho para bloquear os horários (a operação já existente; a
// OS nunca bloqueia sozinha, D-BLOQ-55).
import {
  esquemaAndamentoOs,
  esquemaAssumirOs,
  esquemaCancelarOs,
  esquemaConcluirOs,
  esquemaEncerrarOs,
  type ApoioManutencao,
  type OsDetalhe,
  type OsNoLeito,
  type PrioridadeOs,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { agirNaOs, lerCoberturas, lerOs, urlDocumentoOs, type AcaoDaOs } from '../api-manutencao.js';
import {
  corpoDaConclusao,
  instanteBr,
  OPCOES,
  problemasDe,
  rascunhoConclusaoVazio,
  reais,
  ROTULOS,
  textoDoPrazo,
} from '../comum-manutencao.js';
import OsNoLeitoAviso from '../../adt/componentes/OsNoLeitoAviso.vue';
import CampoInstante from './CampoInstante.vue';
import ErroManutencao from './ErroManutencao.vue';
import FormCorrigirOs from './FormCorrigirOs.vue';
import FormQueixaOs from './FormQueixaOs.vue';

const props = defineProps<{ id: number; apoio: ApoioManutencao }>();
const emit = defineEmits<{ fechar: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();

const consulta = useQuery({
  queryKey: computed(() => ['manutencao', 'os', 'detalhe', props.id]),
  queryFn: () => lerOs(props.id),
});
const o = computed<OsDetalhe | null>(() => consulta.data.value ?? null);
const prazo = (p: OsDetalhe['atendimento']) => {
  const x = textoDoPrazo(p);
  return t(x.chave, { tempo: x.tempo });
};

// ── Formulário da ação escolhida ────────────────────────────────────────────────────────────────────────────────────
type Acao = 'assumir' | 'andamento' | 'concluir' | 'aceitar' | 'recusar' | 'encerrarManutencao' | 'cancelar';
const acao = ref<Acao | null>(null);
const botoes = computed<Acao[]>(() => {
  const x = o.value;
  if (!x) return [];
  const r: Acao[] = [];
  for (const a of x.acoes) {
    if (a === 'encerrar') {
      if (x.souSolicitante) r.push('aceitar', 'recusar');
      else r.push('encerrarManutencao');
    } else r.push(a);
  }
  return r;
});
const ROTULO_ACAO: Record<Acao, string> = {
  assumir: 'manutencao.os.acoes.assumir',
  andamento: 'manutencao.os.acoes.andamento',
  concluir: 'manutencao.os.acoes.concluir',
  aceitar: 'manutencao.os.acoes.encerrar',
  recusar: 'manutencao.os.acoes.reabrir',
  encerrarManutencao: 'manutencao.os.acoes.encerrarManutencao',
  cancelar: 'manutencao.os.acoes.cancelar',
};

const prioridade = ref<PrioridadeOs>('media');
const executor = ref<'interno' | 'contrato'>('interno');
const cobertura = ref<number | null>(null);
const situacao = ref<'emAtendimento' | 'aguardandoPeca' | 'aguardandoTerceiro'>('emAtendimento');
const nota = ref('');
const conclusao = ref(rascunhoConclusaoVazio(props.apoio.hoje));
watch(o, (x) => {
  if (x) prioridade.value = x.prioridade;
});
const comParada = computed(() => !!o.value && o.value.paradaInicio !== null && o.value.paradaFim === null);

const coberturas = useQuery({
  queryKey: computed(() => ['manutencao', 'coberturas', o.value?.equipamento?.id ?? 0]),
  queryFn: () => lerCoberturas(o.value!.equipamento!.id),
  enabled: computed(() => acao.value === 'assumir' && !!o.value?.equipamento && props.apoio.pode.ler),
});
const opcoesCobertura = computed(() => [
  { valor: null as number | null, rotulo: t('manutencao.nenhumSelecionado') },
  ...(coberturas.data.value ?? [])
    .filter((c) => c.vigente)
    .map((c) => ({ valor: c.id as number | null, rotulo: `${c.numero} - ${c.fornecedor.nome}` })),
]);

const problemas = ref<Record<string, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
/** W0-07 (M4): o bloqueio do leito encerrado com a OS e a higienização solicitada. */
const leitoDaOs = ref<OsNoLeito | null>(null);
const gravando = ref(false);
// W0-08: a correção da abertura (antes de assumida) em formulário próprio.
const corrigindo = ref(false);
function alternarCorrecao() {
  corrigindo.value = !corrigindo.value;
  queixando.value = false;
  acao.value = null;
}
// W0-08 (M2): a queixa técnica do equipamento, aberta daqui na vigilância de produto da qualidade.
const queixando = ref(false);
function alternarQueixa() {
  queixando.value = !queixando.value;
  corrigindo.value = false;
  acao.value = null;
}
async function queixaAberta(m: string) {
  mensagem.value = m;
  queixando.value = false;
  await cliente.invalidateQueries({ queryKey: ['manutencao', 'os'] });
  await cliente.invalidateQueries({ queryKey: ['manutencao', 'alertas'] });
}
async function corrigida(m: string) {
  mensagem.value = m;
  corrigindo.value = false;
  await cliente.invalidateQueries({ queryKey: ['manutencao', 'os'] });
}
function escolher(a: Acao) {
  corrigindo.value = false;
  queixando.value = false;
  acao.value = acao.value === a ? null : a;
  problemas.value = {};
  erro.value = null;
  nota.value = '';
}

function pedido(
  a: Acao,
  x: OsDetalhe,
): {
  rota: AcaoDaOs;
  corpo: Record<string, unknown>;
  esquema:
    | typeof esquemaAssumirOs
    | typeof esquemaAndamentoOs
    | typeof esquemaConcluirOs
    | typeof esquemaEncerrarOs
    | typeof esquemaCancelarOs;
} {
  const notaOuNulo = nota.value.trim() === '' ? null : nota.value.trim();
  switch (a) {
    case 'assumir':
      return {
        rota: 'assumir',
        esquema: esquemaAssumirOs,
        corpo: {
          versao: x.versao,
          prioridade: prioridade.value,
          executor: executor.value,
          cobertura: executor.value === 'contrato' ? cobertura.value : null,
          nota: notaOuNulo,
        },
      };
    case 'andamento':
      return {
        rota: 'andamento',
        esquema: esquemaAndamentoOs,
        corpo: { versao: x.versao, situacao: situacao.value, nota: nota.value.trim() },
      };
    case 'concluir':
      return {
        rota: 'concluir',
        esquema: esquemaConcluirOs,
        corpo: corpoDaConclusao(conclusao.value, x.versao, comParada.value),
      };
    case 'aceitar':
    case 'encerrarManutencao':
      return {
        rota: 'encerrar',
        esquema: esquemaEncerrarOs,
        corpo: { versao: x.versao, aceite: true, nota: notaOuNulo },
      };
    case 'recusar':
      return {
        rota: 'encerrar',
        esquema: esquemaEncerrarOs,
        corpo: { versao: x.versao, aceite: false, nota: notaOuNulo },
      };
    case 'cancelar':
      return {
        rota: 'cancelamento',
        esquema: esquemaCancelarOs,
        corpo: { versao: x.versao, motivo: nota.value.trim() },
      };
  }
}

async function gravar() {
  const x = o.value;
  const a = acao.value;
  if (!x || !a) return;
  erro.value = null;
  mensagem.value = null;
  const p = pedido(a, x);
  problemas.value = problemasDe(p.esquema, { ...p.corpo, os: x.id });
  if (Object.keys(problemas.value).length > 0) return;
  gravando.value = true;
  try {
    const r = await agirNaOs(x.id, p.rota, p.corpo);
    mensagem.value = r.mensagem;
    leitoDaOs.value = r.leito ?? null;
    acao.value = null;
    conclusao.value = rascunhoConclusaoVazio(props.apoio.hoje);
    await cliente.invalidateQueries({ queryKey: ['manutencao', 'os'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
const listaProblemas = computed(() => Object.values(problemas.value));
</script>

<template>
  <section class="bloco" aria-labelledby="os-detalhe-titulo" data-testid="os-detalhe">
    <ErroManutencao v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!o" role="status">{{ t('manutencao.carregando') }}</p>
    <template v-else>
      <div class="acoes">
        <h2 id="os-detalhe-titulo">{{ t('manutencao.os.detalhe', { numero: o.numero }) }}</h2>
        <SanteBotao
          variante="texto"
          :rotulo="t('manutencao.fechar')"
          data-testid="os-detalhe-fechar"
          @acionar="emit('fechar')"
        />
      </div>
      <p v-if="mensagem" role="status" data-testid="os-mensagem">{{ mensagem }}</p>
      <OsNoLeitoAviso :leito="leitoDaOs" />
      <template v-if="o.alerta">
        <SanteAlerta
          variante="alerta"
          anunciar
          :texto="t('manutencao.os.avisos.criticoParado')"
          data-testid="os-alerta-parado"
        />
        <p v-if="o.alerta.operacaoBloqueio === 'agenda.bloquearHorarios'" data-testid="os-alerta-bloqueio">
          {{ t('manutencao.os.avisos.bloqueioProposto') }}
          <RouterLink to="/agenda/consultas/bloqueios">{{ t('manutencao.os.irBloqueio') }}</RouterLink>
        </p>
        <p v-else-if="o.alerta.recurso" class="secundario">{{ t('manutencao.os.avisos.soAlerta') }}</p>
      </template>
      <p v-if="o.tecnovigilancia?.alerta" data-testid="os-do-alerta">
        {{ t('manutencao.os.queixa.doAlerta', { numero: o.tecnovigilancia.alerta.numero }) }}
      </p>
      <p v-if="o.tecnovigilancia?.queixa" data-testid="os-queixa">
        {{ t('manutencao.os.queixa.aberta', { n: o.tecnovigilancia.queixa }) }}
        <RouterLink :to="`/qualidade/nsp/tecnovigilancia/${o.tecnovigilancia.queixa}`">{{
          t('manutencao.os.queixa.verNaQualidade')
        }}</RouterLink>
      </p>
      <dl class="ficha">
        <dt>{{ t('manutencao.os.campos.natureza') }}</dt>
        <dd>{{ ROTULOS.natureza[o.natureza] }}</dd>
        <dt>{{ t('manutencao.os.colunas.situacao') }}</dt>
        <dd data-testid="os-situacao">{{ ROTULOS.situacaoOs[o.situacao] }}</dd>
        <dt>{{ t('manutencao.os.colunas.prioridade') }}</dt>
        <dd>{{ ROTULOS.prioridade[o.prioridade] }}</dd>
        <dt>{{ t('manutencao.os.colunas.equipamento') }}</dt>
        <dd>{{ o.equipamento ? `${o.equipamento.codigo} - ${o.equipamento.nome}` : o.local }}</dd>
        <dt>{{ t('manutencao.os.colunas.setor') }}</dt>
        <dd>{{ o.setor.nome }}</dd>
        <dt>{{ t('manutencao.os.abertaPor') }}</dt>
        <dd>{{ o.solicitante }} ({{ instanteBr(o.abertaEm) }})</dd>
        <template v-if="o.contato">
          <dt>{{ t('manutencao.os.campos.contato') }}</dt>
          <dd>{{ o.contato }}</dd>
        </template>
        <dt>{{ t('manutencao.os.colunas.atendimento') }}</dt>
        <dd :class="{ vencido: o.atendimento.situacao === 'vencido' }" data-testid="os-prazo-atendimento">
          {{ instanteBr(o.atendimento.limite) }}: {{ prazo(o.atendimento) }}
        </dd>
        <dt>{{ t('manutencao.os.colunas.solucao') }}</dt>
        <dd :class="{ vencido: o.solucao.situacao === 'vencido' }" data-testid="os-prazo-solucao">
          {{ instanteBr(o.solucao.limite) }}: {{ prazo(o.solucao) }}
        </dd>
        <template v-if="o.paradaInicio">
          <dt>{{ t('manutencao.equipamentos.campos.parado') }}</dt>
          <dd data-testid="os-parada">
            {{
              o.paradaFim
                ? t('manutencao.os.paradaAte', {
                    de: instanteBr(o.paradaInicio),
                    ate: instanteBr(o.paradaFim),
                  })
                : t('manutencao.os.paradaDesde', { quando: instanteBr(o.paradaInicio) })
            }}
          </dd>
        </template>
        <template v-if="o.tecnico">
          <dt>{{ t('manutencao.os.colunas.tecnico') }}</dt>
          <dd>{{ o.tecnico }} ({{ ROTULOS.executor[o.executor] }})</dd>
        </template>
        <template v-if="o.cobertura">
          <dt>{{ t('manutencao.os.campos.cobertura') }}</dt>
          <dd>{{ o.cobertura.numero }} - {{ o.cobertura.fornecedor.nome }}</dd>
        </template>
        <dt>{{ t('manutencao.os.campos.descricao') }}</dt>
        <dd>{{ o.descricao }}</dd>
        <template v-if="o.causa">
          <dt>{{ t('manutencao.os.campos.causa') }}</dt>
          <dd>{{ ROTULOS.causa[o.causa] }}</dd>
          <dt>{{ t('manutencao.os.campos.solucao') }}</dt>
          <dd>{{ o.solucaoTexto }}</dd>
          <dt>{{ t('manutencao.os.campos.inicioReparo') }}</dt>
          <dd>{{ instanteBr(o.inicioReparo) }} - {{ instanteBr(o.fimReparo) }}</dd>
          <dt>{{ t('manutencao.os.campos.custoTotal') }}</dt>
          <dd data-testid="os-custos">
            {{
              t('manutencao.os.custosConta', {
                total: reais(o.custos.total),
                pecas: reais(o.custos.pecas),
                maoDeObra: reais(o.custos.maoDeObra),
                terceiros: reais(o.custos.terceiros),
              })
            }}
          </dd>
        </template>
        <template v-if="o.laudo">
          <dt>{{ t('manutencao.os.campos.laudo') }}</dt>
          <dd>{{ o.laudo }}</dd>
        </template>
      </dl>
      <p>
        <a :href="urlDocumentoOs(o.id)" data-testid="os-documento" download>{{
          t('manutencao.os.documento')
        }}</a>
      </p>

      <SanteAlerta
        v-if="o.situacao === 'concluida' && o.souSolicitante"
        variante="info"
        :texto="t('manutencao.os.avisos.aceite')"
      />
      <SanteAlerta
        v-else-if="o.situacao === 'concluida' && botoes.includes('encerrarManutencao')"
        variante="info"
        :texto="t('manutencao.os.avisos.aceiteVencido')"
      />

      <div class="acoes" data-testid="os-acoes">
        <SanteBotao
          v-for="a in botoes"
          :key="a"
          :variante="acao === a ? 'primario' : 'secundario'"
          :rotulo="t(ROTULO_ACAO[a])"
          :desabilitado="!apoio.gravacao.ligada"
          :data-testid="`os-acao-${a}`"
          @acionar="escolher(a)"
        />
        <SanteBotao
          v-if="o.podeCorrigir"
          :variante="corrigindo ? 'primario' : 'secundario'"
          :rotulo="t('manutencao.os.acoes.corrigir')"
          :desabilitado="!apoio.gravacao.ligada"
          data-testid="os-acao-corrigir"
          @acionar="alternarCorrecao"
        />
        <SanteBotao
          v-if="o.tecnovigilancia?.podeAbrirQueixa"
          :variante="queixando ? 'primario' : 'secundario'"
          :rotulo="t('manutencao.os.queixa.abrir')"
          :desabilitado="!apoio.gravacao.ligada"
          data-testid="os-acao-queixa"
          @acionar="alternarQueixa"
        />
        <span
          v-if="botoes.length === 0 && !o.podeCorrigir && !o.tecnovigilancia?.podeAbrirQueixa"
          class="secundario"
          >{{ t('manutencao.os.semAcoes') }}</span
        >
      </div>
      <FormCorrigirOs
        v-if="corrigindo"
        :key="o.versao"
        :os="o"
        :apoio="apoio"
        @corrigida="corrigida"
        @cancelar="corrigindo = false"
      />
      <FormQueixaOs
        v-if="queixando"
        :os="o.id"
        :ligada="apoio.gravacao.ligada"
        @aberta="queixaAberta"
        @cancelar="queixando = false"
      />

      <form v-if="acao" class="bloco" :data-testid="`os-form-${acao}`" @submit.prevent="gravar">
        <div v-if="acao === 'assumir'" class="campos">
          <SanteSelecao
            v-model="prioridade"
            :rotulo="t('manutencao.os.campos.prioridade')"
            :opcoes="OPCOES.prioridade"
            data-testid="os-assumir-prioridade"
          />
          <SanteSelecao
            v-model="executor"
            :rotulo="t('manutencao.os.campos.executor')"
            :opcoes="OPCOES.executor"
            data-testid="os-assumir-executor"
          />
          <SanteSelecao
            v-if="executor === 'contrato'"
            v-model="cobertura"
            :rotulo="t('manutencao.os.campos.cobertura')"
            :opcoes="opcoesCobertura"
            busca
            data-testid="os-assumir-cobertura"
          />
        </div>
        <SanteSelecao
          v-if="acao === 'andamento'"
          v-model="situacao"
          :rotulo="t('manutencao.os.colunas.situacao')"
          :opcoes="OPCOES.andamento"
          data-testid="os-andamento-situacao"
        />
        <template v-if="acao === 'concluir'">
          <div class="campos">
            <SanteSelecao
              v-model="conclusao.causa"
              :rotulo="t('manutencao.os.campos.causa')"
              :opcoes="[{ valor: null, rotulo: t('manutencao.nenhumSelecionado') }, ...OPCOES.causa]"
              data-testid="os-concluir-causa"
            />
            <CampoInstante
              v-model:data="conclusao.inicioData"
              v-model:hora="conclusao.inicioHora"
              :rotulo="t('manutencao.os.campos.inicioReparo')"
              :maximo="apoio.hoje"
              data-testid="os-concluir-inicio"
            />
            <CampoInstante
              v-model:data="conclusao.fimData"
              v-model:hora="conclusao.fimHora"
              :rotulo="t('manutencao.os.campos.fimReparo')"
              :maximo="apoio.hoje"
              data-testid="os-concluir-fim"
            />
            <CampoInstante
              v-if="comParada"
              v-model:data="conclusao.voltaData"
              v-model:hora="conclusao.voltaHora"
              :rotulo="t('manutencao.os.campos.voltaAoUso')"
              :maximo="apoio.hoje"
              data-testid="os-concluir-volta"
            />
            <SanteCampoTexto
              v-model="conclusao.custoPecas"
              :rotulo="t('manutencao.os.campos.custoPecas')"
              :max-bytes="16"
              data-testid="os-concluir-pecas"
            />
            <SanteCampoTexto
              v-model="conclusao.custoMaoDeObra"
              :rotulo="t('manutencao.os.campos.custoMaoDeObra')"
              :max-bytes="16"
              data-testid="os-concluir-mao"
            />
            <SanteCampoTexto
              v-model="conclusao.custoTerceiros"
              :rotulo="t('manutencao.os.campos.custoTerceiros')"
              :max-bytes="16"
              data-testid="os-concluir-terceiros"
            />
            <SanteCampoTexto
              v-model="conclusao.laudo"
              :rotulo="t('manutencao.os.campos.laudo')"
              :max-bytes="10"
              data-testid="os-concluir-laudo"
            />
          </div>
          <SanteCampoTexto
            v-model="conclusao.solucao"
            multilinha
            obrigatorio
            :rotulo="t('manutencao.os.campos.solucao')"
            :max-bytes="2000"
            data-testid="os-concluir-solucao"
          />
        </template>
        <SanteCampoTexto
          v-if="acao !== 'concluir'"
          v-model="nota"
          multilinha
          :obrigatorio="acao === 'andamento' || acao === 'recusar' || acao === 'cancelar'"
          :rotulo="acao === 'cancelar' ? t('manutencao.motivo') : t('manutencao.os.campos.nota')"
          :max-bytes="acao === 'cancelar' ? 400 : 2000"
          data-testid="os-acao-nota"
        />
        <p v-if="acao === 'cancelar' || acao === 'recusar'" class="secundario">
          {{ t('manutencao.motivoAjuda') }}
        </p>
        <ul v-if="listaProblemas.length > 0" class="vencido" role="alert" data-testid="os-problemas">
          <li v-for="p in listaProblemas" :key="p">{{ p }}</li>
        </ul>
        <ErroManutencao v-if="erro" :erro="erro" />
        <div class="acoes">
          <SanteBotao
            :variante="acao === 'cancelar' ? 'destrutivo' : 'primario'"
            :confirmacao="acao === 'cancelar' ? t('manutencao.os.acoes.cancelar') + '?' : ''"
            :rotulo="t('manutencao.confirmar')"
            :desabilitado="gravando"
            data-testid="os-acao-gravar"
            @acionar="gravar"
          />
          <SanteBotao variante="texto" :rotulo="t('manutencao.cancelar')" @acionar="acao = null" />
        </div>
      </form>

      <section aria-labelledby="os-historico-titulo">
        <h3 id="os-historico-titulo">{{ t('manutencao.os.historico') }}</h3>
        <ol class="historico" data-testid="os-historico">
          <li v-for="(e, i) in o.eventos" :key="i">
            {{ instanteBr(e.em) }} - {{ e.ator }}: {{ ROTULOS.situacaoOs[e.para]
            }}<template v-if="e.nota"> ({{ e.nota }})</template>
          </li>
        </ol>
      </section>
    </template>
  </section>
</template>

<style scoped src="./estilo-manutencao.css"></style>
