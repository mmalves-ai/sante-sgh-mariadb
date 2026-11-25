<script setup lang="ts">
// Reuso de dialisadores na hemodiálise (03-PEP linha 146): a sala de reprocessamento (os dialisadores em uso, pela
// etiqueta), a visão por paciente com o histórico (nada apagado), a abertura do dialisador e o reprocessamento com a
// conferência na hora pelas mesmas regras do servidor (@sgh/dominio-pep): o percentual do volume, o resultado (liberado,
// não liberado ou descarte) e o aviso do último reuso antes de gravar. Descarte, desativação do aberto por engano e
// cancelamento do último reprocessamento, sempre com motivo.
import {
  avaliarReprocessamento,
  conferirAberturaDialisador,
  METODOS_LIMPEZA_DIALISADOR,
  METODOS_REPROCESSAMENTO,
  type MetodoLimpezaDialisador,
  type MetodoReprocessamento,
  type ResultadoTesteDesinfetante,
  TETO_REUSOS_DIALISADOR,
} from '@sgh/dominio-pep';
import { type ResultadoBuscaPaciente } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteChave, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarPacientes } from '../../cadastro/api-cadastro.js';
import {
  abrirDialisador,
  cancelarReprocessamento,
  desativarDialisador,
  descartarDialisador,
  type DialisadorLido,
  lerDialisadoresDoPaciente,
  lerDialisadoresEmUso,
  novaChaveDialisador,
  type ReprocessamentoLido,
  reprocessarDialisador,
} from '../api-dialisador.js';

const { t } = useI18n();
const rota = useRoute();
const router = useRouter();
const podeRegistrar = computed(() => pode('enfermagem.cuidado.checar'));
const P = 'sessoes.dialisador';

// ── Sala de reprocessamento e paciente escolhido ──
const emUso = useQuery({ queryKey: ['sessoes', 'dialisadores', 'em-uso'], queryFn: lerDialisadoresEmUso });
const paciente = ref<{ id: number; nome: string } | null>(null);
const doPaciente = useQuery({
  queryKey: computed(() => ['sessoes', 'dialisadores', 'paciente', paciente.value?.id ?? 0]),
  queryFn: () => lerDialisadoresDoPaciente(paciente.value!.id),
  enabled: computed(() => paciente.value !== null),
});
function escolherPaciente(id: number, nome: string): void {
  paciente.value = { id, nome };
  void router.replace({ query: { ...rota.query, paciente: String(id) } });
}
watch(
  () => [rota.query['paciente'], emUso.data.value] as const,
  ([q]) => {
    const id = Number(q);
    if (!Number.isInteger(id) || id <= 0 || paciente.value?.id === id) return;
    const d = emUso.data.value?.itens.find((x) => x.paciente === id);
    paciente.value = { id, nome: d?.pacienteNome ?? `#${id}` };
  },
  { immediate: true },
);

const termo = ref('');
const pedido = ref('');
const busca = useQuery({
  queryKey: computed(() => ['sessoes', 'dialisadores', 'busca', pedido.value]),
  queryFn: (): Promise<ResultadoBuscaPaciente> => buscarPacientes(pedido.value),
  enabled: computed(() => pedido.value.length >= 3),
});
const atualizar = async () => {
  await Promise.all([emUso.refetch(), paciente.value ? doPaciente.refetch() : Promise.resolve()]);
};

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function gravar(fn: () => Promise<string>): Promise<boolean> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    mensagem.value = await fn();
    await atualizar();
    return true;
  } catch (x) {
    erro.value = x;
    return false;
  } finally {
    ocupado.value = false;
  }
}

// ── Abertura ──
const metodosLimpeza = computed(() =>
  METODOS_LIMPEZA_DIALISADOR.map((x) => ({ valor: x, rotulo: t(`${P}.metodos.${x}`) })),
);
const abertura = reactive({
  identificacao: '',
  metodo: 'automatizado' as MetodoLimpezaDialisador,
  limite: '',
  volume: '',
});
const tocadoAbertura = ref(false);
const num = (s: string): number | null => (s.trim() === '' ? null : Number(s.trim().replace(',', '.')));
const emUsoDoPaciente = computed(
  () => doPaciente.data.value?.itens.filter((x) => x.situacao === 'em_uso').length ?? 0,
);
const entradaAbertura = computed(() => ({
  identificacao: abertura.identificacao,
  metodo: abertura.metodo,
  limiteReusos: num(abertura.limite),
  volumeInicialMl: num(abertura.volume),
}));
const errosAbertura = computed(() =>
  conferirAberturaDialisador(entradaAbertura.value, emUsoDoPaciente.value),
);
const erroAbertura = (campo: string) =>
  tocadoAbertura.value ? (errosAbertura.value.find((e) => e.campo === campo)?.mensagem ?? null) : null;
async function abrir(): Promise<void> {
  tocadoAbertura.value = true;
  if (!paciente.value || errosAbertura.value.length) return;
  const ok = await gravar(async () => {
    const r = await abrirDialisador(
      {
        paciente: paciente.value!.id,
        ...entradaAbertura.value,
        identificacao: abertura.identificacao.trim(),
      },
      novaChaveDialisador('abrir'),
    );
    return t(`${P}.mensagens.aberto`, { limite: r.limiteReusos });
  });
  if (ok) {
    Object.assign(abertura, { identificacao: '', limite: '', volume: '' });
    tocadoAbertura.value = false;
  }
}

// ── Reprocessamento ──
const metodosReprocessamento = computed(() =>
  METODOS_REPROCESSAMENTO.map((x) => ({ valor: x, rotulo: t(`${P}.metodos.${x}`) })),
);
const testes = computed(() => [
  { valor: null, rotulo: t(`${P}.semTeste`) },
  { valor: 'positivo' as const, rotulo: t(`${P}.testes.positivo`) },
  { valor: 'negativo' as const, rotulo: t(`${P}.testes.negativo`) },
]);
const alvo = ref<DialisadorLido | null>(null);
const reproc = reactive({
  metodo: 'automatizado' as MetodoReprocessamento,
  volume: '',
  pre: null as ResultadoTesteDesinfetante | null,
  pos: null as ResultadoTesteDesinfetante | null,
  agente: '',
  linhas: true,
  observacao: '',
});
const tocadoReproc = ref(false);
function iniciarReprocessamento(d: DialisadorLido): void {
  alvo.value = d;
  tocadoReproc.value = false;
  Object.assign(reproc, {
    metodo: d.metodo === 'manual' ? 'manual' : 'automatizado',
    volume: '',
    pre: null,
    pos: null,
    observacao: '',
    linhas: true,
  });
}
const avaliacao = computed(() =>
  alvo.value
    ? avaliarReprocessamento(
        {
          situacao: alvo.value.situacao,
          metodo: alvo.value.metodo,
          limiteReusos: alvo.value.limiteReusos,
          reusosRealizados: alvo.value.reusosRealizados,
          volumeInicialMl: alvo.value.volumeInicialMl,
        },
        {
          metodo: reproc.metodo,
          volumeAtualMl: num(reproc.volume),
          testePreEnxague: reproc.pre,
          testePosEnxague: reproc.pos,
        },
      )
    : null,
);
const erroReproc = (campo: string) =>
  tocadoReproc.value ? (avaliacao.value?.erros.find((e) => e.campo === campo)?.mensagem ?? null) : null;
const errosGeraisReproc = computed(() =>
  tocadoReproc.value ? (avaliacao.value?.erros.filter((e) => e.campo === 'dialisador') ?? []) : [],
);
async function reprocessar(): Promise<void> {
  tocadoReproc.value = true;
  const d = alvo.value;
  if (!d || !avaliacao.value || avaliacao.value.erros.length) return;
  const ok = await gravar(async () => {
    const r = await reprocessarDialisador(
      d.id,
      {
        metodo: reproc.metodo,
        volumeAtualMl: num(reproc.volume),
        testePreEnxague: reproc.pre,
        testePosEnxague: reproc.pos,
        agente: reproc.agente.trim() || null,
        linhasDescartadas: reproc.linhas,
        observacao: reproc.observacao.trim() || null,
        versao: d.versao,
      },
      novaChaveDialisador('reprocessar'),
    );
    const v = { seq: r.sequencia, reusos: r.reusosRealizados, motivos: r.reprovacoes.join(' ') };
    if (r.descartado) return t(`${P}.mensagens.descartadoVolume`, v);
    if (!r.aprovado) return t(`${P}.mensagens.reprovado`, v);
    return t(r.ultimoReuso ? `${P}.mensagens.ultimo` : `${P}.mensagens.aprovado`, v);
  });
  if (ok) alvo.value = null;
}

// ── Saídas de uso e cancelamento (sempre com motivo) ──
type Acao = 'descartar' | 'desativar' | 'cancelar';
const pedindo = ref<{ acao: Acao; id: number; versao: number } | null>(null);
const motivo = ref('');
function pedir(acao: Acao, id: number, versao: number): void {
  pedindo.value = { acao, id, versao };
  motivo.value = '';
}
async function confirmar(): Promise<void> {
  const p = pedindo.value;
  if (!p || motivo.value.trim().length < 5) return;
  const corpo = { motivo: motivo.value.trim(), versao: p.versao };
  const ok = await gravar(async () => {
    if (p.acao === 'descartar') {
      await descartarDialisador(p.id, corpo, novaChaveDialisador('descartar'));
      return t(`${P}.mensagens.descartado`);
    }
    if (p.acao === 'desativar') {
      await desativarDialisador(p.id, corpo, novaChaveDialisador('desativar'));
      return t(`${P}.mensagens.desativado`);
    }
    await cancelarReprocessamento(p.id, corpo, novaChaveDialisador('cancelar'));
    return t(`${P}.mensagens.cancelado`);
  });
  if (ok) pedindo.value = null;
}
const ultimoValido = (d: DialisadorLido): ReprocessamentoLido | null =>
  d.reprocessamentos.find((r) => r.situacao === 'valido') ?? null;

const quando = (s: string | null) =>
  s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}` : '-';
const resultadoDe = (r: ReprocessamentoLido) =>
  r.situacao === 'cancelado' ? t(`${P}.cancelado`) : r.aprovado ? t(`${P}.aprovado`) : t(`${P}.reprovado`);
const ml = (v: number | null) => (v === null ? '-' : t(`${P}.ml`, { v }));
const teste = (v: string | null) => (v ? t(`${P}.testes.${v}`) : '-');
</script>

<template>
  <main class="tela" data-testid="tela-dialisadores">
    <h1>{{ t(`${P}.titulo`) }}</h1>
    <p>{{ t(`${P}.texto`) }}</p>
    <SanteAlerta
      v-if="mensagem"
      variante="info"
      :texto="mensagem"
      anunciar
      data-testid="dialisador-mensagem"
    />
    <MensagemErro v-if="erro" :erro="erro" />

    <section aria-labelledby="dial-em-uso" class="painel">
      <h2 id="dial-em-uso">{{ t(`${P}.emUso`) }}</h2>
      <MensagemErro v-if="emUso.isError.value" :erro="emUso.error.value" />
      <p v-else-if="!emUso.data.value" role="status">{{ t(`${P}.carregando`) }}</p>
      <p v-else-if="emUso.data.value.itens.length === 0">{{ t(`${P}.nenhumEmUso`) }}</p>
      <table v-else class="tabela" data-testid="dialisadores-em-uso">
        <thead>
          <tr>
            <th v-for="c in ['etiqueta', 'paciente', 'metodo', 'reusos', 'acoes']" :key="c" scope="col">
              {{ t(`${P}.colunas.${c}`) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in emUso.data.value.itens" :key="d.id" :data-testid="`em-uso-${d.id}`">
            <td>{{ d.identificacao }}</td>
            <td>{{ d.pacienteNome }} ({{ d.prontuario ?? '-' }})</td>
            <td>{{ t(`${P}.metodos.${d.metodo}`) }}</td>
            <td>{{ d.reusosRealizados }} / {{ d.limiteReusos }}</td>
            <td>
              <SanteBotao
                v-if="podeRegistrar && d.metodo !== 'uso_unico'"
                variante="texto"
                :rotulo="t(`${P}.reprocessar`)"
                :data-testid="`reprocessar-${d.id}`"
                @click="iniciarReprocessamento(d)"
              />
              <SanteBotao
                variante="texto"
                :rotulo="t(`${P}.verPaciente`)"
                :data-testid="`ver-paciente-${d.id}`"
                @click="escolherPaciente(d.paciente, d.pacienteNome)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <form
      v-if="alvo"
      class="painel"
      data-testid="form-reprocessamento"
      novalidate
      @submit.prevent="reprocessar"
    >
      <h2>{{ t(`${P}.reprocessamento`, { etiqueta: alvo.identificacao }) }}</h2>
      <ul v-if="errosGeraisReproc.length" role="alert" data-testid="reprocessamento-erros">
        <li v-for="e in errosGeraisReproc" :key="e.mensagem">{{ e.mensagem }}</li>
      </ul>
      <div class="grade">
        <SanteSelecao v-model="reproc.metodo" :rotulo="t(`${P}.metodo`)" :opcoes="metodosReprocessamento" />
        <div class="campo">
          <label for="dial-volume-atual">{{ t(`${P}.volumeAtual`) }}</label>
          <input
            id="dial-volume-atual"
            v-model="reproc.volume"
            inputmode="numeric"
            :aria-invalid="erroReproc('volumeAtualMl') ? 'true' : 'false'"
            aria-describedby="dial-volume-atual-erro"
          />
          <small id="dial-volume-atual-erro" role="status">{{ erroReproc('volumeAtualMl') }}</small>
        </div>
        <div>
          <SanteSelecao v-model="reproc.pre" :rotulo="t(`${P}.testePre`)" :opcoes="testes" obrigatorio />
          <small role="status">{{ erroReproc('testePreEnxague') }}</small>
        </div>
        <div>
          <SanteSelecao v-model="reproc.pos" :rotulo="t(`${P}.testePos`)" :opcoes="testes" obrigatorio />
          <small role="status">{{ erroReproc('testePosEnxague') }}</small>
        </div>
        <SanteCampoTexto v-model="reproc.agente" :rotulo="t(`${P}.agente`)" :max-bytes="60" />
        <SanteChave :ligada="reproc.linhas" :rotulo="t(`${P}.linhas`)" @alternar="reproc.linhas = $event" />
      </div>
      <SanteCampoTexto
        v-model="reproc.observacao"
        :rotulo="t(`${P}.observacao`)"
        :max-bytes="2000"
        multilinha
      />
      <div
        v-if="avaliacao && avaliacao.fracaoVolume !== null"
        role="status"
        data-testid="reprocessamento-previa"
      >
        <p>{{ t(`${P}.previa`, { pct: Math.round(avaliacao.fracaoVolume * 100) }) }}</p>
        <SanteAlerta
          v-if="avaliacao.descartar"
          variante="alerta"
          :texto="t(`${P}.previaDescarte`, { motivo: avaliacao.motivoDescarte })"
        />
        <SanteAlerta
          v-for="m in avaliacao.reprovacoes.filter((x) => x !== avaliacao?.motivoDescarte)"
          v-else
          :key="m"
          variante="alerta"
          :texto="m"
        />
        <p v-if="avaliacao.aprovado">
          {{ avaliacao.ultimoReuso ? t(`${P}.previaUltimo`) : t(`${P}.previaAprovado`) }}
        </p>
      </div>
      <SanteBotao
        tipo="submit"
        :rotulo="t(`${P}.registrar`)"
        :desabilitado="ocupado"
        data-testid="reprocessamento-gravar"
      />
      <SanteBotao variante="texto" :rotulo="t(`${P}.desistir`)" @click="alvo = null" />
    </form>

    <section aria-labelledby="dial-busca" class="painel">
      <h2 id="dial-busca">{{ t(`${P}.buscarPaciente`) }}</h2>
      <form class="grade" data-testid="dialisador-busca" @submit.prevent="pedido = termo.trim()">
        <SanteCampoTexto v-model="termo" :rotulo="t(`${P}.termo`)" :max-bytes="100" />
        <SanteBotao tipo="submit" variante="secundario" :rotulo="t(`${P}.buscarPaciente`)" />
      </form>
      <MensagemErro v-if="busca.isError.value" :erro="busca.error.value" />
      <ul v-else-if="busca.data.value" class="lista-simples" data-testid="dialisador-pacientes">
        <li v-for="p in busca.data.value.itens" :key="p.id">
          <SanteBotao
            variante="texto"
            :rotulo="`${p.nomeSocial ?? p.nome} (${p.prontuario})`"
            :data-testid="`escolher-paciente-${p.id}`"
            @click="escolherPaciente(p.id, p.nomeSocial ?? p.nome)"
          />
        </li>
      </ul>
    </section>

    <section
      v-if="paciente"
      aria-labelledby="dial-paciente"
      class="painel"
      data-testid="dialisadores-do-paciente"
    >
      <h2 id="dial-paciente">{{ t(`${P}.doPaciente`, { nome: paciente.nome }) }}</h2>
      <MensagemErro v-if="doPaciente.isError.value" :erro="doPaciente.error.value" />
      <p v-else-if="!doPaciente.data.value" role="status">{{ t(`${P}.carregando`) }}</p>
      <p v-else-if="doPaciente.data.value.itens.length === 0">{{ t(`${P}.nenhumDoPaciente`) }}</p>
      <article
        v-for="d in doPaciente.data.value?.itens ?? []"
        :key="d.id"
        class="cartao"
        :data-testid="`dialisador-${d.id}`"
      >
        <h3>
          {{ d.identificacao }} · {{ t(`${P}.situacoes.${d.situacao}`) }} ·
          {{ t(`${P}.metodos.${d.metodo}`) }} · {{ d.reusosRealizados }} / {{ d.limiteReusos }}
        </h3>
        <p>
          {{ t(`${P}.colunas.volume`) }}: {{ ml(d.volumeInicialMl) }} · {{ t(`${P}.colunas.aberto`) }}:
          {{ quando(d.abertoEm) }}
          <template v-if="d.motivo"> · {{ d.motivo }}</template>
        </p>
        <div v-if="podeRegistrar && d.situacao === 'em_uso'" class="acoes">
          <SanteBotao
            v-if="d.metodo !== 'uso_unico'"
            variante="secundario"
            :rotulo="t(`${P}.reprocessar`)"
            :data-testid="`reprocessar-pac-${d.id}`"
            @click="iniciarReprocessamento(d)"
          />
          <SanteBotao
            variante="texto"
            :rotulo="t(`${P}.descartar`)"
            :data-testid="`descartar-${d.id}`"
            @click="pedir('descartar', d.id, d.versao)"
          />
          <SanteBotao
            v-if="!d.reprocessamentos.some((r) => r.situacao === 'valido')"
            variante="texto"
            :rotulo="t(`${P}.desativar`)"
            :data-testid="`desativar-${d.id}`"
            @click="pedir('desativar', d.id, d.versao)"
          />
        </div>
        <table v-if="d.reprocessamentos.length" class="tabela" :data-testid="`reprocessamentos-${d.id}`">
          <thead>
            <tr>
              <th
                v-for="c in ['sequencia', 'em', 'volumeAtual', 'testes', 'resultado', 'responsavel', 'acoes']"
                :key="c"
                scope="col"
              >
                {{ t(`${P}.colunas.${c}`) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in d.reprocessamentos" :key="r.id" :data-testid="`reprocessamento-${r.id}`">
              <td>{{ r.sequencia }}</td>
              <td>{{ quando(r.reprocessadoEm) }}</td>
              <td>{{ r.volumeAtualMl ?? '-' }} / {{ ml(r.volumeInicialMl) }}</td>
              <td>{{ teste(r.testePreEnxague) }} / {{ teste(r.testePosEnxague) }}</td>
              <td>
                {{ resultadoDe(r)
                }}<template v-if="r.motivoCancelamento"> · {{ r.motivoCancelamento }}</template>
              </td>
              <td>{{ r.responsavel }}</td>
              <td>
                <SanteBotao
                  v-if="podeRegistrar && d.situacao === 'em_uso' && ultimoValido(d)?.id === r.id"
                  variante="texto"
                  :rotulo="t(`${P}.cancelar`)"
                  :data-testid="`cancelar-reprocessamento-${r.id}`"
                  @click="pedir('cancelar', r.id, r.versao)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </article>

      <form
        v-if="podeRegistrar && doPaciente.data.value && emUsoDoPaciente === 0"
        class="painel"
        data-testid="form-abertura"
        novalidate
        @submit.prevent="abrir"
      >
        <h3>{{ t(`${P}.novo`) }}</h3>
        <div class="grade">
          <div>
            <SanteCampoTexto
              v-model="abertura.identificacao"
              :rotulo="t(`${P}.etiqueta`)"
              :max-bytes="30"
              obrigatorio
            />
            <small role="status">{{ erroAbertura('identificacao') }}</small>
          </div>
          <SanteSelecao v-model="abertura.metodo" :rotulo="t(`${P}.metodo`)" :opcoes="metodosLimpeza" />
          <div v-if="abertura.metodo !== 'uso_unico'">
            <SanteCampoTexto v-model="abertura.limite" :rotulo="t(`${P}.limite`)" :max-bytes="3" />
            <small role="status">
              {{
                erroAbertura('limiteReusos') ??
                t(`${P}.limiteDica`, { teto: TETO_REUSOS_DIALISADOR[abertura.metodo] })
              }}
            </small>
          </div>
          <div v-if="abertura.metodo !== 'uso_unico'">
            <SanteCampoTexto v-model="abertura.volume" :rotulo="t(`${P}.volumeInicial`)" :max-bytes="4" />
            <small role="status">{{ erroAbertura('volumeInicialMl') }}</small>
          </div>
        </div>
        <SanteBotao
          tipo="submit"
          :rotulo="t(`${P}.abrir`)"
          :desabilitado="ocupado"
          data-testid="abertura-gravar"
        />
      </form>
    </section>

    <form v-if="pedindo" class="painel" data-testid="form-motivo" @submit.prevent="confirmar">
      <SanteCampoTexto v-model="motivo" :rotulo="t(`${P}.motivo`)" :max-bytes="500" />
      <SanteBotao
        tipo="submit"
        :rotulo="t(`${P}.confirmar`)"
        :desabilitado="ocupado || motivo.trim().length < 5"
        data-testid="motivo-confirmar"
      />
      <SanteBotao variante="texto" :rotulo="t(`${P}.desistir`)" @click="pedindo = null" />
    </form>
  </main>
</template>

<style scoped>
.grade {
  display: grid;
  gap: var(--sgh-espaco-3);
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
}
.campo {
  display: flex;
  flex-direction: column;
}
.cartao {
  border-top: 1px solid var(--sgh-borda);
  padding-block: var(--sgh-espaco-2);
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
}
</style>
