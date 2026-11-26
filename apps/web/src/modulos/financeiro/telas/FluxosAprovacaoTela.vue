<script setup lang="ts">
// Fluxos de aprovação (F8, 07-FIN linha 65): `/financeiro/aprovacao/fluxos`. Desenho próprio: o fluxo é montado
// inteiro numa tela só (documento, faixa de valor, vigência, etapas em ordem e os aprovadores de cada etapa), e a MESMA
// regra do domínio que o servidor aplica (`conferirFluxo`) confere enquanto se monta: a recusa aparece na hora e
// desliga o botão. Um fluxo gravado não se reescreve (a trilha fica íntegra): para mudar, encerra-se e cria-se outro.
// Na mesma tela, os agrupadores (valores de um critério que restringem o aprovador) e as respostas padrão (o que o
// aprovador escolhe, com o efeito e se exige justificativa). Combos com SanteSelecao.
import {
  conferirFluxo,
  CRITERIOS_AGRUPADOR,
  type CriterioAgrupador,
  DOCUMENTOS_APROVAVEIS,
  type DocumentoAprovavel,
  type EfeitoResposta,
  type RegraQuorum,
} from '@sgh/dominio-financeiro';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  type AprovadorTela,
  criarFluxoAprovacao,
  encerrarFluxoAprovacao,
  type EtapaTela,
  lerConfiguracaoAprovacao,
  type NovoFluxoTela,
  salvarAgrupadorAprovacao,
  salvarRespostaAprovacao,
} from '../api-fluxo-aprovacao.js';
import { novaChave } from '../api-financeiro.js';
import { data, reais } from '../usar-financeiro.js';

const PREFIXO_I18N = 'financeiro.fluxoAprovacao';
const { t } = useI18n();
const tx = (k: string, p?: Record<string, unknown>) =>
  p ? t(`${PREFIXO_I18N}.${k}`, p) : t(`${PREFIXO_I18N}.${k}`);
const qc = useQueryClient();
const config = useQuery({
  queryKey: ['financeiro', 'fluxo-aprovacao', 'configuracao'],
  queryFn: lerConfiguracaoAprovacao,
});
const HOJE = new Date().toISOString().slice(0, 10);

// ── Opções dos combos ─────────────────────────────────────────────────────────────────────────────────────────
const opcoesTipo = computed(() => DOCUMENTOS_APROVAVEIS.map((d) => ({ valor: d, rotulo: tx(`tipos.${d}`) })));
const opcoesQuorum = computed(() =>
  (['qualquer', 'todos', 'minimo'] as const).map((q) => ({ valor: q, rotulo: tx(`quoruns.${q}`) })),
);
const opcoesCriterio = computed(() =>
  CRITERIOS_AGRUPADOR.map((c) => ({ valor: c, rotulo: tx(`criterios.${c}`) })),
);
const opcoesEfeito = computed(() =>
  (['aprova', 'reprova', 'devolve'] as const).map((e) => ({ valor: e, rotulo: tx(`efeitos.${e}`) })),
);
const comVazio = (vazio: string, lista: readonly { id: number; rotulo: string }[]) => [
  { valor: '', rotulo: vazio },
  ...lista.map((o) => ({ valor: String(o.id), rotulo: o.rotulo })),
];
const opcoesUsuario = computed(() => comVazio(tx('nenhum'), config.data.value?.apoios.usuarios ?? []));
const opcoesPapel = computed(() => comVazio(tx('nenhum'), config.data.value?.apoios.papeis ?? []));
const opcoesCentro = computed(() =>
  comVazio(tx('qualquerCentro'), config.data.value?.apoios.centrosCusto ?? []),
);
const opcoesAgrupador = computed(() =>
  comVazio(
    tx('semAgrupador'),
    (config.data.value?.agrupadores ?? [])
      .filter((a) => a.ativo)
      .map((a) => ({ id: a.id, rotulo: `${a.codigo} · ${a.descricao}` })),
  ),
);

// ── Fluxo novo (estado do formulário em texto; os combos trabalham com string) ─────────────────────────────────
interface AprovadorForm {
  usuario: string;
  papel: string;
  substituto: string;
  agrupador: string;
  valorLimite: string;
  aprovaPeloCelular: boolean;
}
interface EtapaForm {
  nome: string;
  valorMinimo: string;
  valorMaximo: string;
  regraQuorum: RegraQuorum;
  minimo: string;
  obrigatoria: boolean;
  aprovadores: AprovadorForm[];
}
const novoAprovador = (): AprovadorForm => ({
  usuario: '',
  papel: '',
  substituto: '',
  agrupador: '',
  valorLimite: '',
  aprovaPeloCelular: false,
});
const novaEtapa = (): EtapaForm => ({
  nome: '',
  valorMinimo: '',
  valorMaximo: '',
  regraQuorum: 'qualquer',
  minimo: '',
  obrigatoria: true,
  aprovadores: [novoAprovador()],
});
const vazioFluxo = () => ({
  codigo: '',
  descricao: '',
  tipo: 'titulo_pagar' as DocumentoAprovavel,
  todosEstabelecimentos: false,
  centroCusto: '',
  valorMinimo: '0',
  valorMaximo: '',
  prioridade: '1',
  vigenciaInicio: HOJE,
  vigenciaFim: '',
  etapas: [novaEtapa()] as EtapaForm[],
});
const fluxo = reactive(vazioFluxo());

const idOuNulo = (v: string) => (v === '' ? null : Number(v));
const numOuNulo = (v: string | number) => (String(v).trim() === '' ? null : Number(v));
const entrada = computed<NovoFluxoTela>(() => ({
  codigo: fluxo.codigo.trim().toUpperCase(),
  descricao: fluxo.descricao.trim(),
  tipo: fluxo.tipo,
  todosEstabelecimentos: fluxo.todosEstabelecimentos,
  centroCusto: idOuNulo(fluxo.centroCusto),
  valorMinimo: numOuNulo(fluxo.valorMinimo) ?? 0,
  valorMaximo: numOuNulo(fluxo.valorMaximo),
  prioridade: Number(fluxo.prioridade) || 1,
  vigenciaInicio: fluxo.vigenciaInicio,
  vigenciaFim: fluxo.vigenciaFim || null,
  etapas: fluxo.etapas.map((e, i): EtapaTela => ({
    sequencia: i + 1,
    nome: e.nome.trim(),
    valorMinimo: numOuNulo(e.valorMinimo),
    valorMaximo: numOuNulo(e.valorMaximo),
    regraQuorum: e.regraQuorum,
    minimo: e.regraQuorum === 'minimo' ? numOuNulo(e.minimo) : null,
    obrigatoria: e.obrigatoria,
    // A linha em branco (sem pessoa e sem papel) ainda não é aprovador: a etapa só com ela não tem aprovador.
    aprovadores: e.aprovadores
      .filter((a) => a.usuario || a.papel)
      .map((a): AprovadorTela => ({
        usuario: idOuNulo(a.usuario),
        papel: idOuNulo(a.papel),
        substituto: idOuNulo(a.substituto),
        agrupador: idOuNulo(a.agrupador),
        valorLimite: numOuNulo(a.valorLimite),
        aprovaPeloCelular: a.aprovaPeloCelular,
        vigenciaInicio: fluxo.vigenciaInicio,
        vigenciaFim: null,
      })),
  })),
}));
/** A regra do domínio, na hora (a mesma que o servidor aplica ao gravar). */
const recusa = computed(() => {
  const f = entrada.value;
  if (f.codigo.length < 2) return { mensagem: tx('codigo') + ' ?' };
  if (f.descricao.length < 3) return { mensagem: tx('descricao') + ' ?' };
  return conferirFluxo(f);
});

// ── Agrupador e resposta ──────────────────────────────────────────────────────────────────────────────────────
const agrupador = reactive({
  codigo: '',
  descricao: '',
  criterio: 'centro_custo' as CriterioAgrupador,
  membros: '',
  aceitaVazio: false,
});
const membrosAgrupador = computed(() =>
  agrupador.membros
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number),
);
const agrupadorOk = computed(
  () =>
    agrupador.codigo.trim().length >= 2 &&
    agrupador.descricao.trim().length >= 3 &&
    membrosAgrupador.value.every((n) => Number.isInteger(n) && n > 0) &&
    (membrosAgrupador.value.length > 0 || agrupador.aceitaVazio),
);
const resposta = reactive({
  codigo: '',
  descricao: '',
  efeito: 'aprova' as EfeitoResposta,
  exigeJustificativa: false,
  ordem: '0',
});
const respostaOk = computed(
  () => resposta.codigo.trim().length >= 2 && resposta.descricao.trim().length >= 2,
);

// ── Gravações ─────────────────────────────────────────────────────────────────────────────────────────────────
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('fluxo-aprov-cfg');
async function acao(f: (c: string) => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    mensagem.value = (await f(chave)).mensagem;
    chave = novaChave('fluxo-aprov-cfg');
    await qc.invalidateQueries({ queryKey: ['financeiro', 'fluxo-aprovacao'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    gravando.value = false;
  }
}
async function gravarFluxo() {
  if (recusa.value || gravando.value) return;
  if (await acao((c) => criarFluxoAprovacao(entrada.value, c))) Object.assign(fluxo, vazioFluxo());
}
async function encerrar(id: number, codigo: string) {
  if (!window.confirm(tx('confirmarEncerrar', { codigo }))) return;
  await acao((c) => encerrarFluxoAprovacao(id, c));
}
async function gravarAgrupador() {
  if (!agrupadorOk.value || gravando.value) return;
  const ok = await acao((c) =>
    salvarAgrupadorAprovacao(
      {
        id: null,
        codigo: agrupador.codigo.trim().toUpperCase(),
        descricao: agrupador.descricao.trim(),
        criterio: agrupador.criterio,
        fluxo: null,
        aceitaVazio: agrupador.aceitaVazio,
        ativo: true,
        membros: membrosAgrupador.value,
      },
      c,
    ),
  );
  if (ok) Object.assign(agrupador, { codigo: '', descricao: '', membros: '', aceitaVazio: false });
}
async function gravarResposta() {
  if (!respostaOk.value || gravando.value) return;
  const ok = await acao((c) =>
    salvarRespostaAprovacao(
      {
        id: null,
        codigo: resposta.codigo.trim().toUpperCase(),
        descricao: resposta.descricao.trim(),
        efeito: resposta.efeito,
        exigeJustificativa: resposta.exigeJustificativa,
        fluxo: null,
        ordem: Number(resposta.ordem) || 0,
        ativo: true,
      },
      c,
    ),
  );
  if (ok) Object.assign(resposta, { codigo: '', descricao: '', exigeJustificativa: false, ordem: '0' });
}
const faixa = (min: number, max: number | null) =>
  tx('faixa', { de: reais(min), ate: max === null ? tx('semTeto') : reais(max) });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="fla-titulo" data-testid="tela-fin-fluxos-aprovacao">
    <h1 id="fla-titulo">{{ tx('titulo') }}</h1>
    <p>{{ tx('texto') }}</p>
    <MensagemFaturamento :texto="mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <ErroFaturamento v-if="config.error.value" :erro="config.error.value" />

    <h2>{{ tx('vigentes') }}</h2>
    <p v-if="config.data.value && !config.data.value.fluxos.length" data-testid="fla-sem-fluxo">
      {{ tx('semFluxo') }}
    </p>
    <table v-else-if="config.data.value" class="tabela" data-testid="fla-fluxos">
      <thead>
        <tr>
          <th scope="col">{{ tx('codigo') }}</th>
          <th scope="col">{{ tx('tipo') }}</th>
          <th scope="col">{{ tx('valorMinimo') }}</th>
          <th scope="col">{{ tx('vigenciaInicio') }}</th>
          <th scope="col">{{ tx('etapas') }}</th>
          <th scope="col">
            <span class="visualmente-oculto">{{ tx('encerrar') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="f in config.data.value.fluxos" :key="f.id" :data-testid="`fla-fluxo-${f.codigo}`">
          <td>{{ f.codigo }} · {{ f.descricao }}</td>
          <td>{{ tx(`tipos.${f.tipo}`) }}</td>
          <td>{{ faixa(f.valorMinimo, f.valorMaximo) }}</td>
          <td>
            {{ data(f.vigenciaInicio) }}<template v-if="f.vigenciaFim"> — {{ data(f.vigenciaFim) }}</template>
          </td>
          <td>
            {{ tx('etapasResumo', { n: f.etapas.length }) }}:
            {{ f.etapas.map((e) => e.nome).join(' → ') }}
          </td>
          <td>
            <button
              v-if="f.ativo"
              type="button"
              class="secundario"
              :disabled="gravando"
              :data-testid="`fla-encerrar-${f.codigo}`"
              @click="encerrar(f.id, f.codigo)"
            >
              {{ tx('encerrar') }}
            </button>
            <span v-else>{{ tx('encerrado') }}</span>
          </td>
        </tr>
      </tbody>
    </table>

    <form class="formulario" :aria-label="tx('novo')" data-testid="fla-novo" @submit.prevent="gravarFluxo">
      <h2>{{ tx('novo') }}</h2>
      <span class="campo">
        <label for="fla-codigo">{{ tx('codigo') }}</label>
        <input id="fla-codigo" v-model="fluxo.codigo" maxlength="30" data-testid="fla-codigo" />
      </span>
      <span class="campo">
        <label for="fla-descricao">{{ tx('descricao') }}</label>
        <input id="fla-descricao" v-model="fluxo.descricao" maxlength="150" data-testid="fla-descricao" />
      </span>
      <span class="campo">
        <SanteSelecao v-model="fluxo.tipo" :rotulo="tx('tipo')" :opcoes="opcoesTipo" data-testid="fla-tipo" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="fluxo.centroCusto"
          :rotulo="tx('centroCusto')"
          :opcoes="opcoesCentro"
          data-testid="fla-centro"
        />
      </span>
      <label class="campo-marcacao">
        <input v-model="fluxo.todosEstabelecimentos" type="checkbox" data-testid="fla-todos-est" />
        {{ tx('todosEstabelecimentos') }}
      </label>
      <span class="campo">
        <label for="fla-vmin">{{ tx('valorMinimo') }}</label>
        <input
          id="fla-vmin"
          v-model="fluxo.valorMinimo"
          type="number"
          min="0"
          step="0.01"
          data-testid="fla-vmin"
        />
      </span>
      <span class="campo">
        <label for="fla-vmax">{{ tx('valorMaximo') }}</label>
        <input
          id="fla-vmax"
          v-model="fluxo.valorMaximo"
          type="number"
          min="0"
          step="0.01"
          data-testid="fla-vmax"
        />
      </span>
      <span class="campo">
        <label for="fla-prioridade">{{ tx('prioridade') }}</label>
        <input
          id="fla-prioridade"
          v-model="fluxo.prioridade"
          type="number"
          min="1"
          max="999"
          data-testid="fla-prioridade"
        />
      </span>
      <span class="campo">
        <label for="fla-vini">{{ tx('vigenciaInicio') }}</label>
        <input id="fla-vini" v-model="fluxo.vigenciaInicio" type="date" data-testid="fla-vini" />
      </span>
      <span class="campo">
        <label for="fla-vfim">{{ tx('vigenciaFim') }}</label>
        <input id="fla-vfim" v-model="fluxo.vigenciaFim" type="date" data-testid="fla-vfim" />
      </span>

      <fieldset v-for="(e, i) in fluxo.etapas" :key="i" class="etapa" :data-testid="`fla-etapa-${i + 1}`">
        <legend>{{ tx('etapa', { n: i + 1 }) }}</legend>
        <span class="campo">
          <label :for="`fla-etapa-nome-${i}`">{{ tx('nomeEtapa') }}</label>
          <input
            :id="`fla-etapa-nome-${i}`"
            v-model="e.nome"
            maxlength="100"
            :data-testid="`fla-etapa-nome-${i + 1}`"
          />
        </span>
        <span class="campo">
          <label :for="`fla-etapa-vmin-${i}`">{{ tx('valorMinimo') }}</label>
          <input :id="`fla-etapa-vmin-${i}`" v-model="e.valorMinimo" type="number" min="0" step="0.01" />
        </span>
        <span class="campo">
          <label :for="`fla-etapa-vmax-${i}`">{{ tx('valorMaximo') }}</label>
          <input :id="`fla-etapa-vmax-${i}`" v-model="e.valorMaximo" type="number" min="0" step="0.01" />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="e.regraQuorum"
            :rotulo="tx('quorum')"
            :opcoes="opcoesQuorum"
            :data-testid="`fla-etapa-quorum-${i + 1}`"
          />
        </span>
        <span v-if="e.regraQuorum === 'minimo'" class="campo">
          <label :for="`fla-etapa-min-${i}`">{{ tx('minimo') }}</label>
          <input :id="`fla-etapa-min-${i}`" v-model="e.minimo" type="number" min="1" max="50" />
        </span>
        <label class="campo-marcacao">
          <input v-model="e.obrigatoria" type="checkbox" />
          {{ tx('obrigatoria') }}
        </label>

        <h3>{{ tx('aprovadores') }}</h3>
        <div
          v-for="(a, j) in e.aprovadores"
          :key="j"
          class="aprovador"
          :data-testid="`fla-aprovador-${i + 1}-${j + 1}`"
        >
          <span class="campo">
            <SanteSelecao
              v-model="a.usuario"
              :rotulo="tx('pessoa')"
              :opcoes="opcoesUsuario"
              :data-testid="`fla-aprov-usuario-${i + 1}-${j + 1}`"
            />
          </span>
          <span class="campo">
            <SanteSelecao
              v-model="a.papel"
              :rotulo="tx('papel')"
              :opcoes="opcoesPapel"
              :data-testid="`fla-aprov-papel-${i + 1}-${j + 1}`"
            />
          </span>
          <span class="campo">
            <SanteSelecao v-model="a.substituto" :rotulo="tx('substituto')" :opcoes="opcoesUsuario" />
          </span>
          <span class="campo">
            <SanteSelecao v-model="a.agrupador" :rotulo="tx('agrupador')" :opcoes="opcoesAgrupador" />
          </span>
          <span class="campo">
            <label :for="`fla-aprov-limite-${i}-${j}`">{{ tx('valorLimite') }}</label>
            <input
              :id="`fla-aprov-limite-${i}-${j}`"
              v-model="a.valorLimite"
              type="number"
              min="0"
              step="0.01"
            />
          </span>
          <label class="campo-marcacao">
            <input
              v-model="a.aprovaPeloCelular"
              type="checkbox"
              :data-testid="`fla-aprov-celular-${i + 1}-${j + 1}`"
            />
            {{ tx('celular') }}
          </label>
          <button
            v-if="e.aprovadores.length > 1"
            type="button"
            class="secundario"
            @click="e.aprovadores.splice(j, 1)"
          >
            {{ tx('removerAprovador') }}
          </button>
        </div>
        <button
          type="button"
          class="secundario"
          :data-testid="`fla-novo-aprovador-${i + 1}`"
          @click="e.aprovadores.push(novoAprovador())"
        >
          {{ tx('novoAprovador') }}
        </button>
        <button
          v-if="fluxo.etapas.length > 1"
          type="button"
          class="secundario"
          @click="fluxo.etapas.splice(i, 1)"
        >
          {{ tx('removerEtapa') }}
        </button>
      </fieldset>
      <button
        type="button"
        class="secundario"
        data-testid="fla-nova-etapa"
        @click="fluxo.etapas.push(novaEtapa())"
      >
        {{ tx('novaEtapa') }}
      </button>

      <p v-if="recusa" role="alert" class="recusa" data-testid="fla-recusa">{{ recusa.mensagem }}</p>
      <p v-else role="status" data-testid="fla-conferido">{{ tx('conferido') }}</p>
      <button type="submit" class="primario" :disabled="!!recusa || gravando" data-testid="fla-gravar">
        {{ tx('gravar') }}
      </button>
    </form>

    <form
      class="formulario"
      :aria-label="tx('agrupadores')"
      data-testid="fla-agrupador"
      @submit.prevent="gravarAgrupador"
    >
      <h2>{{ tx('agrupadores') }}</h2>
      <p>{{ tx('agrupadoresTexto') }}</p>
      <ul v-if="config.data.value?.agrupadores.length" data-testid="fla-agrupadores">
        <li v-for="a in config.data.value.agrupadores" :key="a.id">
          {{ a.codigo }} · {{ a.descricao }} ({{ tx(`criterios.${a.criterio}`) }}: {{ a.membros.length }})
        </li>
      </ul>
      <span class="campo">
        <label for="fla-ag-codigo">{{ tx('codigo') }}</label>
        <input id="fla-ag-codigo" v-model="agrupador.codigo" maxlength="30" data-testid="fla-ag-codigo" />
      </span>
      <span class="campo">
        <label for="fla-ag-descricao">{{ tx('descricao') }}</label>
        <input
          id="fla-ag-descricao"
          v-model="agrupador.descricao"
          maxlength="150"
          data-testid="fla-ag-descricao"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="agrupador.criterio"
          :rotulo="tx('criterio')"
          :opcoes="opcoesCriterio"
          data-testid="fla-ag-criterio"
        />
      </span>
      <span class="campo">
        <label for="fla-ag-membros">{{ tx('membros') }}</label>
        <input
          id="fla-ag-membros"
          v-model="agrupador.membros"
          inputmode="numeric"
          data-testid="fla-ag-membros"
        />
      </span>
      <label class="campo-marcacao">
        <input v-model="agrupador.aceitaVazio" type="checkbox" />
        {{ tx('aceitaVazio') }}
      </label>
      <button type="submit" class="primario" :disabled="!agrupadorOk || gravando" data-testid="fla-ag-gravar">
        {{ tx('gravarAgrupador') }}
      </button>
    </form>

    <form
      class="formulario"
      :aria-label="tx('respostas')"
      data-testid="fla-resposta"
      @submit.prevent="gravarResposta"
    >
      <h2>{{ tx('respostas') }}</h2>
      <p>{{ tx('respostasTexto') }}</p>
      <ul v-if="config.data.value?.respostas.length" data-testid="fla-respostas">
        <li v-for="r in config.data.value.respostas" :key="r.id">
          {{ r.codigo }} · {{ r.descricao }} ({{ tx(`efeitos.${r.efeito}`)
          }}<template v-if="r.exigeJustificativa">, {{ tx('exigeJustificativa') }}</template
          >)
        </li>
      </ul>
      <span class="campo">
        <label for="fla-rp-codigo">{{ tx('codigo') }}</label>
        <input id="fla-rp-codigo" v-model="resposta.codigo" maxlength="30" data-testid="fla-rp-codigo" />
      </span>
      <span class="campo">
        <label for="fla-rp-descricao">{{ tx('descricao') }}</label>
        <input
          id="fla-rp-descricao"
          v-model="resposta.descricao"
          maxlength="150"
          data-testid="fla-rp-descricao"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="resposta.efeito"
          :rotulo="tx('efeito')"
          :opcoes="opcoesEfeito"
          data-testid="fla-rp-efeito"
        />
      </span>
      <span class="campo">
        <label for="fla-rp-ordem">{{ tx('ordem') }}</label>
        <input id="fla-rp-ordem" v-model="resposta.ordem" type="number" min="0" max="999" />
      </span>
      <label class="campo-marcacao">
        <input v-model="resposta.exigeJustificativa" type="checkbox" />
        {{ tx('exigeJustificativa') }}
      </label>
      <button type="submit" class="primario" :disabled="!respostaOk || gravando" data-testid="fla-rp-gravar">
        {{ tx('gravarResposta') }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.etapa {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
  margin-block: var(--sgh-espaco-2);
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.aprovador {
  border-top: 1px dashed var(--sgh-borda);
  padding-top: var(--sgh-espaco-2);
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  width: 100%;
}
.recusa {
  color: var(--sgh-alerta);
}
</style>
