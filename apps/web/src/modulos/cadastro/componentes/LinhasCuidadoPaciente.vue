<script setup lang="ts">
// Programas de saúde e linhas de cuidado do paciente (F8, 02-CAD linha 11), na ficha: as inscrições (a viva em destaque,
// as encerradas no histórico, nunca apagadas), a linha do tempo de cada uma, a inscrição num clique (programa pela
// SanteSelecao, profissional de referência pela busca, data de hoje já preenchida) e a mudança de estado só para os
// próximos estados que o servidor calculou, com o motivo pedido na hora ao suspender ou encerrar. A inscrição revela
// condição de saúde (LGPD art. 11): a seção só aparece com cadastro.linhaCuidado.ler, e gravar pede
// cadastro.linhaCuidado.inscrever (perfis assistenciais; a recepção não tem). O servidor confere tudo de novo.
import { SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  buscarReferencias,
  type Inscricao,
  inscrever,
  lerInscricoes,
  lerProgramas,
  mudarEstado,
  type OpcoesProgramas,
  trocarReferencia,
} from '../api-linhas-cuidado.js';
import { carimboBr, dataBr } from '../formato.js';
import { faltasInscricao, faltasMudanca, hojeIso, pedeMotivo } from '../linhas-cuidado-tela.js';

const props = defineProps<{ idPaciente: number }>();
const { t } = useI18n();
const podeInscrever = computed(() => pode('cadastro.linhaCuidado.inscrever'));
const hoje = hojeIso();

const opcoes = ref<OpcoesProgramas | null>(null);
const itens = ref<Inscricao[]>([]);
const erro = ref<unknown>(null);
const mensagem = ref('');

async function carregar(): Promise<void> {
  try {
    itens.value = (await lerInscricoes(props.idPaciente)).itens;
  } catch (e) {
    erro.value = e;
  }
}
void carregar();
void lerProgramas()
  .then((o) => {
    opcoes.value = o;
  })
  .catch((e: unknown) => {
    erro.value = e;
  });

const vivas = computed(() => itens.value.filter((i) => !i.encerrada));
const encerradas = computed(() => itens.value.filter((i) => i.encerrada));
const tipo = (x: string) => t(`linhasCuidado.tipos.${x}`);
const falta = (x: string) => t(`linhasCuidado.falta.${x}`);
const operacao = (x: string) => {
  const k = `linhasCuidado.operacoes.${x}`;
  const r = t(k);
  return r === k ? x : r;
};

// ── busca do profissional de referência (compartilhada pela inscrição e pela troca) ──
interface Achado {
  id: number;
  nome: string;
}
function usarBusca() {
  const termo = ref('');
  const achados = ref<Achado[]>([]);
  // A falha da busca aparece (sem permissão, fora do ar); nunca vira lista vazia calada.
  const falhou = ref('');
  const buscou = ref(false);
  watch(termo, async (x) => {
    const q = x.trim();
    falhou.value = '';
    buscou.value = false;
    if (q.length < 3) {
      achados.value = [];
      return;
    }
    try {
      achados.value = (await buscarReferencias(q)).itens;
      buscou.value = true;
    } catch (e) {
      achados.value = [];
      falhou.value = e instanceof Error ? e.message : String(e);
    }
  });
  return { termo, achados, falhou, buscou };
}

// ── inscrição ──
const nova = reactive({ linha: 0, referencia: 0, vigenciaInicio: hoje });
const buscaNova = usarBusca();
const programasAtivos = computed(() => (opcoes.value?.linhas ?? []).filter((p) => p.ativo));
const programaNovo = computed(() => programasAtivos.value.find((p) => p.id === nova.linha) ?? null);
const faltasNova = computed(() =>
  faltasInscricao(
    { linha: nova.linha, referencia: nova.referencia || null, vigenciaInicio: nova.vigenciaInicio },
    programasAtivos.value,
    itens.value,
    hoje,
  ),
);
async function gravarInscricao(): Promise<void> {
  erro.value = null;
  mensagem.value = '';
  try {
    await inscrever(props.idPaciente, {
      linha: nova.linha,
      referencia: nova.referencia || null,
      vigenciaInicio: nova.vigenciaInicio,
    });
    mensagem.value = t('linhasCuidado.inscrito');
    Object.assign(nova, { linha: 0, referencia: 0, vigenciaInicio: hoje });
    buscaNova.termo.value = '';
    await carregar();
  } catch (e) {
    erro.value = e;
  }
}

// ── mudança de estado (uma inscrição por vez) ──
const mudando = ref<number | null>(null);
const mud = reactive({ estado: 0, data: hoje, motivo: '' });
const inscricaoMudando = computed(() => itens.value.find((i) => i.id === mudando.value) ?? null);
const estadoEscolhido = computed(() => opcoes.value?.estados.find((e) => e.id === mud.estado) ?? null);
const proximos = (i: Inscricao) => (opcoes.value?.estados ?? []).filter((e) => i.proximos.includes(e.id));
const faltasMud = computed(() =>
  inscricaoMudando.value ? faltasMudanca(mud, inscricaoMudando.value, opcoes.value?.estados ?? [], hoje) : [],
);
function abrirMudanca(i: Inscricao): void {
  mudando.value = mudando.value === i.id ? null : i.id;
  Object.assign(mud, { estado: 0, data: hoje, motivo: '' });
}
async function gravarMudanca(i: Inscricao): Promise<void> {
  erro.value = null;
  mensagem.value = '';
  try {
    const r = await mudarEstado(props.idPaciente, i.id, {
      versao: i.versao,
      estado: mud.estado,
      data: mud.data,
      motivo: pedeMotivo(estadoEscolhido.value) ? mud.motivo.trim() : null,
    });
    mensagem.value = t(r.encerrada ? 'linhasCuidado.mudadoEncerrada' : 'linhasCuidado.mudado');
    mudando.value = null;
    await carregar();
  } catch (e) {
    erro.value = e;
  }
}

// ── troca do profissional de referência ──
const trocando = ref<number | null>(null);
const novaRef = ref(0);
const buscaTroca = usarBusca();
function abrirTroca(i: Inscricao): void {
  trocando.value = trocando.value === i.id ? null : i.id;
  novaRef.value = 0;
  buscaTroca.termo.value = '';
}
async function gravarTroca(i: Inscricao, referencia: number | null): Promise<void> {
  erro.value = null;
  mensagem.value = '';
  try {
    await trocarReferencia(props.idPaciente, i.id, { versao: i.versao, referencia });
    mensagem.value = t('linhasCuidado.referenciaTrocada');
    trocando.value = null;
    await carregar();
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section aria-labelledby="sec-linhas-cuidado" data-testid="linhas-cuidado-paciente">
    <h2 id="sec-linhas-cuidado">{{ t('linhasCuidado.tituloPaciente') }}</h2>
    <p class="sigilo">{{ t('linhasCuidado.sigilo') }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status">{{ mensagem }}</p>
    <p v-if="itens.length === 0">{{ t('linhasCuidado.nenhuma') }}</p>

    <article
      v-for="i in [...vivas, ...encerradas]"
      :key="i.id"
      class="inscricao"
      :data-inscricao="i.linha.codigo"
      :data-encerrada="i.encerrada ? 'sim' : 'nao'"
    >
      <h3>
        {{ i.linha.descricao }}
        <span class="estado" :data-tipo="i.estado.tipo">{{ i.estado.descricao }}</span>
      </h3>
      <dl>
        <dt>{{ t('linhasCuidado.desde') }}</dt>
        <dd>{{ dataBr(i.estadoDesde) }}</dd>
        <dt>{{ t('linhasCuidado.inicio') }}</dt>
        <dd>{{ dataBr(i.vigenciaInicio) }}</dd>
        <template v-if="i.vigenciaFim">
          <dt>{{ t('linhasCuidado.fim') }}</dt>
          <dd>{{ dataBr(i.vigenciaFim) }}</dd>
        </template>
        <dt>{{ t('linhasCuidado.referencia') }}</dt>
        <dd>{{ i.referencia?.nome ?? t('linhasCuidado.semReferencia') }}</dd>
        <template v-if="i.motivoSaida">
          <dt>{{ t('linhasCuidado.motivoSaida') }}</dt>
          <dd>{{ i.motivoSaida }}</dd>
        </template>
      </dl>

      <div v-if="podeInscrever && !i.encerrada && opcoes" class="acoes">
        <button type="button" :aria-expanded="mudando === i.id" @click="abrirMudanca(i)">
          {{ t('linhasCuidado.mudar') }}
        </button>
        <button type="button" :aria-expanded="trocando === i.id" @click="abrirTroca(i)">
          {{ t('linhasCuidado.trocarReferencia') }}
        </button>
      </div>

      <form
        v-if="mudando === i.id && opcoes"
        class="form"
        data-testid="mudar-estado"
        @submit.prevent="gravarMudanca(i)"
      >
        <SanteSelecao
          v-model="mud.estado"
          :rotulo="t('linhasCuidado.novoEstado')"
          obrigatorio
          :opcoes="[
            { valor: 0, rotulo: t('linhasCuidado.escolha'), desabilitada: true },
            ...proximos(i).map((e) => ({ valor: e.id, rotulo: `${e.descricao} (${tipo(e.tipo)})` })),
          ]"
        />
        <label
          >{{ t('linhasCuidado.dataMudanca') }}
          <input v-model="mud.data" type="date" :max="hoje" :min="i.estadoDesde.slice(0, 10)" required
        /></label>
        <label v-if="pedeMotivo(estadoEscolhido)"
          >{{ t('linhasCuidado.motivo') }}
          <textarea v-model="mud.motivo" maxlength="500" rows="2" :aria-describedby="`motivo-dica-${i.id}`" />
          <small :id="`motivo-dica-${i.id}`">{{ t('linhasCuidado.motivoDica') }}</small>
        </label>
        <ul v-if="mud.estado && faltasMud.length" class="pendencias">
          <li v-for="x in faltasMud" :key="x">{{ falta(x) }}</li>
        </ul>
        <button type="submit" :disabled="faltasMud.length > 0">{{ t('linhasCuidado.gravarMudanca') }}</button>
      </form>

      <form
        v-if="trocando === i.id"
        class="form"
        data-testid="trocar-referencia"
        @submit.prevent="gravarTroca(i, novaRef || null)"
      >
        <label
          >{{ t('linhasCuidado.buscarProfissional') }} <input v-model="buscaTroca.termo.value" type="search"
        /></label>
        <p v-if="buscaTroca.falhou.value" class="pendencias" role="alert">
          {{ t('linhasCuidado.buscaFalhou', { erro: buscaTroca.falhou.value }) }}
        </p>
        <p v-else-if="buscaTroca.buscou.value && !buscaTroca.achados.value.length" class="dica">
          {{ t('linhasCuidado.buscaVazia') }}
        </p>
        <SanteSelecao
          v-if="buscaTroca.achados.value.length"
          v-model="novaRef"
          :rotulo="t('linhasCuidado.referencia')"
          :opcoes="[
            { valor: 0, rotulo: t('linhasCuidado.escolha'), desabilitada: true },
            ...buscaTroca.achados.value.map((p) => ({ valor: p.id, rotulo: p.nome })),
          ]"
        />
        <button type="submit" :disabled="!novaRef">{{ t('linhasCuidado.trocarReferencia') }}</button>
        <button v-if="i.referencia" type="button" @click="gravarTroca(i, null)">
          {{ t('linhasCuidado.limparReferencia') }}
        </button>
      </form>

      <details>
        <summary>{{ t('linhasCuidado.historico') }}</summary>
        <table>
          <caption>
            {{
              t('linhasCuidado.historicoLegenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('linhasCuidado.quando') }}</th>
              <th scope="col">{{ t('linhasCuidado.operacao') }}</th>
              <th scope="col">{{ t('linhasCuidado.estado') }}</th>
              <th scope="col">{{ t('linhasCuidado.usuario') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(h, k) in i.historico" :key="k" :data-evento="h.evento">
              <td>{{ carimboBr(h.ocorridoEm) }}</td>
              <td>
                {{ operacao(h.evento || h.operacao) }}
                <template v-if="h.evento === 'referencia'">
                  {{
                    t('linhasCuidado.trocaDePara', {
                      de: h.referenciaDe ?? t('linhasCuidado.semReferencia'),
                      para: h.referenciaPara ?? t('linhasCuidado.semReferencia'),
                    })
                  }}
                </template>
              </td>
              <td>{{ h.estado }}</td>
              <td>{{ h.usuario ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </article>

    <form
      v-if="podeInscrever && opcoes"
      class="form nova"
      data-testid="nova-inscricao"
      @submit.prevent="gravarInscricao"
    >
      <h3>{{ t('linhasCuidado.inscrever') }}</h3>
      <SanteSelecao
        v-model="nova.linha"
        :rotulo="t('linhasCuidado.programa')"
        obrigatorio
        :opcoes="[
          { valor: 0, rotulo: t('linhasCuidado.escolha'), desabilitada: true },
          ...programasAtivos.map((p) => ({ valor: p.id, rotulo: p.descricao })),
        ]"
      />
      <p v-if="programaNovo?.criterioEntrada" class="dica">
        {{ t('linhasCuidado.criterioEntrada') }}: {{ programaNovo.criterioEntrada }}
      </p>
      <label
        >{{ t('linhasCuidado.inscricaoData') }}
        <input v-model="nova.vigenciaInicio" type="date" :max="hoje" required
      /></label>
      <label
        >{{ t('linhasCuidado.buscarProfissional') }} <input v-model="buscaNova.termo.value" type="search"
      /></label>
      <p v-if="buscaNova.falhou.value" class="pendencias" role="alert">
        {{ t('linhasCuidado.buscaFalhou', { erro: buscaNova.falhou.value }) }}
      </p>
      <p v-else-if="buscaNova.buscou.value && !buscaNova.achados.value.length" class="dica">
        {{ t('linhasCuidado.buscaVazia') }}
      </p>
      <SanteSelecao
        v-if="buscaNova.achados.value.length"
        v-model="nova.referencia"
        :rotulo="t('linhasCuidado.referencia')"
        :obrigatorio="programaNovo?.exigeReferencia ?? false"
        :opcoes="[
          { valor: 0, rotulo: t('linhasCuidado.semReferencia') },
          ...buscaNova.achados.value.map((p) => ({ valor: p.id, rotulo: p.nome })),
        ]"
      />
      <ul v-if="nova.linha && faltasNova.length" class="pendencias">
        <li v-for="x in faltasNova" :key="x">{{ falta(x) }}</li>
      </ul>
      <button type="submit" :disabled="faltasNova.length > 0">{{ t('linhasCuidado.inscrever') }}</button>
    </form>
  </section>
</template>

<style scoped>
.sigilo,
.dica {
  font-size: 0.9em;
}
.inscricao {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
  margin-bottom: var(--sgh-espaco-2);
}
.inscricao[data-encerrada='sim'] h3 {
  text-decoration: line-through;
}
.estado {
  font-size: 0.85em;
  margin-left: var(--sgh-espaco-2);
}
dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-2);
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
}
.form label {
  display: block;
  margin-bottom: var(--sgh-espaco-1);
}
.pendencias {
  color: var(--sgh-alerta);
}
</style>
