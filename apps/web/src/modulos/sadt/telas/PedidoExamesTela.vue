<script setup lang="ts">
// Pedido de exames (F3.5, 05-SADT linhas 4 e 5), com a visão por paciente: o paciente e o atendimento são escolhidos
// por busca (nome, prontuário ou número do atendimento), e o cabeçalho mostra quem é (nome, idade, sexo, prontuário,
// estabelecimento). Gravar só fica liberado depois da conferência do paciente. A cada mudança a API avalia as restrições
// (nada gravado) e os avisos aparecem na hora; o bloqueio que aceita exceção pede a justificativa, e só quem tem a
// permissão de autorizar a exceção grava. Os pedidos do paciente ficam listados com a situação de cada exame, o
// cancelamento com o motivo do cadastro e a linha do tempo do exame.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type AtendimentoPedido,
  type AvaliacaoPedido,
  avaliarPedido,
  buscarAtendimentos,
  cancelarItem,
  type CobrancaPedido,
  type CorpoPedido,
  gravarPedido,
  lerEventosDoItem,
  lerMotivosPedido,
  lancarPendentesNaConta,
  lerPedidosDoAtendimento,
  listarKits,
} from '../api-pedido.js';
import { novaChave } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';
import { quando, usarSadt } from '../usar-sadt.js';

const { t } = useI18n();
const { apoio } = usarSadt();
const cliente = useQueryClient();
const motivos = useQuery({ queryKey: ['sadt', 'pedido', 'motivos'], queryFn: lerMotivosPedido });
const kits = useQuery({ queryKey: ['sadt', 'kits'], queryFn: listarKits });

// ── Paciente e atendimento ──
const busca = ref('');
const encontrados = ref<AtendimentoPedido[] | null>(null);
const atendimento = ref<number | null>(null);
const pacienteConfirmado = ref(false);
const doAtendimento = useQuery({
  queryKey: computed(() => ['sadt', 'pedido', 'atendimento', atendimento.value]),
  queryFn: () => lerPedidosDoAtendimento(atendimento.value!),
  enabled: computed(() => atendimento.value !== null),
});
const cab = computed(() => doAtendimento.data.value?.atendimento ?? null);
async function buscar(): Promise<void> {
  erro.value = null;
  try {
    encontrados.value = (await buscarAtendimentos(busca.value.trim())).itens;
  } catch (x) {
    erro.value = x;
  }
}
function escolher(a: AtendimentoPedido): void {
  atendimento.value = a.id;
  pacienteConfirmado.value = false;
  encontrados.value = null;
}
function trocar(): void {
  atendimento.value = null;
  pacienteConfirmado.value = false;
  avaliacao.value = null;
  avisoCobranca.value = null;
}
const cabecalho = computed(() => {
  const a = cab.value;
  if (!a) return '';
  return t('sadt.pedido.cabecalho', {
    nome: a.nome,
    idade: a.idadeAnos === null ? t('sadt.pedido.semIdade') : t('sadt.pedido.idade', { n: a.idadeAnos }),
    sexo: t(`sadt.pedido.sexos.${a.sexo ?? 'nulo'}`),
    prontuario: a.prontuario,
    numero: a.numero,
    estabelecimento: a.estabelecimento,
  });
});

// ── O pedido ──
const setor = ref('');
const prioridade = ref<CorpoPedido['prioridade']>('rotina');
const exames = ref<number[]>([]);
const setorDoExame = ref<Record<number, string>>({});
const urgenteDoExame = ref<Record<number, boolean>>({});
// Material por exame: as opções vêm da avaliação (os materiais ativos do cadastro do exame); vazio = o padrão.
const materialDoExame = ref<Record<number, string>>({});
const materiaisDoExame = ref<Record<number, { valor: string; rotulo: string }[]>>({});
const kitsEscolhidos = ref<number[]>([]);
const indicacao = ref('');
const confirmado = ref(false);
const justificativa = ref('');
const avaliacao = ref<AvaliacaoPedido | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

const nomeExame = (id: number) => apoio.data.value?.exames.find((e) => e.id === id)?.nome ?? String(id);
const listaSetores = computed(() =>
  (motivos.data.value?.setores ?? []).map((s) => ({ valor: String(s.id), rotulo: s.nome })),
);
const setores = computed(() => [{ valor: '', rotulo: t('sadt.pedido.escolha') }, ...listaSetores.value]);
const setoresDoExame = computed(() => [
  { valor: '', rotulo: t('sadt.pedido.setorDoPedido') },
  ...listaSetores.value,
]);
const prioridades = computed(() =>
  (['rotina', 'urgente', 'emergencia'] as const).map((p) => ({
    valor: p,
    rotulo: t(`sadt.pedido.prioridades.${p}`),
  })),
);
const corpo = (): CorpoPedido | null => {
  const at = atendimento.value;
  const se = Number(setor.value);
  if (!at || !se || exames.value.length + kitsEscolhidos.value.length === 0) return null;
  return {
    atendimento: at,
    setor: se,
    prioridade: prioridade.value,
    exames: exames.value.map((exame) => ({
      exame,
      setor: Number(setorDoExame.value[exame] ?? '') || null,
      material: Number(materialDoExame.value[exame] ?? '') || null,
      urgente: urgenteDoExame.value[exame] ?? false,
    })),
    kits: kitsEscolhidos.value,
    indicacaoClinica: indicacao.value.trim() || null,
    confirmado: confirmado.value,
    justificativa: justificativa.value.trim() || null,
  };
};
// Validação na hora: cada mudança do pedido reavalia as restrições.
watch(
  [atendimento, setor, exames, kitsEscolhidos, setorDoExame, urgenteDoExame, materialDoExame],
  async () => {
    const c = corpo();
    avaliacao.value = null;
    if (!c) return;
    try {
      avaliacao.value = await avaliarPedido(c, novaChave('pedido.avaliar'));
      // As opções ficam guardadas entre uma avaliação e outra: o seletor não some enquanto a tela reavalia.
      materiaisDoExame.value = {
        ...materiaisDoExame.value,
        ...Object.fromEntries(
          avaliacao.value.materiais.map((m) => [
            m.exame,
            m.opcoes.map((o) => ({
              valor: o.padrao ? '' : String(o.id),
              rotulo: o.padrao ? t('sadt.pedido.materialPadraoOpcao', { nome: o.descricao }) : o.descricao,
            })),
          ]),
        ),
      };
      erro.value = null;
    } catch (x) {
      erro.value = x;
    }
  },
  { deep: true },
);
const pedeJustificativa = computed(
  () =>
    (avaliacao.value?.restricoes ?? []).some(
      (r) => r.tipo === 'bloqueio' && r.excecao === null && r.permiteExcecao,
    ) || (avaliacao.value?.limites ?? []).some((l) => l.acao !== 'alertar'),
);
const semPermissaoExcecao = computed(
  () => pedeJustificativa.value && doAtendimento.data.value?.podeAutorizarExcecao === false,
);
const ocupado = ref(false);
const podeGravar = computed(() => !ocupado.value && pacienteConfirmado.value && corpo() !== null);
// A cobrança não segura o pedido: o que não entrou na conta aparece na hora, com o motivo, e é lançado depois.
const avisoCobranca = ref<string | null>(null);
function resumoPendencias(c: CobrancaPedido | undefined): string | null {
  const pend = (c?.itens ?? []).filter((i) => i.contaItem === null && i.pendencia !== 'do-orcamento');
  if (!pend.length) return null;
  const motivos = [...new Set(pend.map((i) => i.mensagem ?? ''))].filter(Boolean).join(' ');
  return t('sadt.pedido.cobrancaPendente', { n: pend.length, motivos });
}
const temPendente = computed(
  () =>
    doAtendimento.data.value?.requisicoes.some((r) => r.itens.some((i) => i.cobranca === 'pendente')) ??
    false,
);
async function lancarPendentes(): Promise<void> {
  const at = atendimento.value;
  if (!at) return;
  erro.value = null;
  try {
    const r = await lancarPendentesNaConta(at, novaChave('pedido.conta'));
    const feitos = r.itens.filter((i) => i.contaItem !== null).length;
    mensagem.value = t('sadt.pedido.lancados', { n: feitos, p: r.itens.length - feitos });
    avisoCobranca.value = resumoPendencias(r);
    await cliente.invalidateQueries({ queryKey: ['sadt', 'pedido', 'atendimento'] });
  } catch (x) {
    erro.value = x;
  }
}
async function gravar(): Promise<void> {
  const c = corpo();
  if (!c || !pacienteConfirmado.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await gravarPedido(c, novaChave('pedido.gravar'));
    mensagem.value = t('sadt.pedido.gravado', { numero: r.numero, n: r.itens.length });
    avisoCobranca.value = resumoPendencias(r.cobranca);
    exames.value = [];
    materialDoExame.value = {};
    kitsEscolhidos.value = [];
    justificativa.value = '';
    confirmado.value = false;
    await cliente.invalidateQueries({ queryKey: ['sadt', 'pedido', 'atendimento'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Pedidos do paciente: cancelamento com motivo e linha do tempo do exame ──
const CANCELAVEIS = [
  'solicitado',
  'autorizado',
  'agendado',
  'coletado',
  'em_analise',
  'resultado_digitado',
  'revisado',
];
const motivoCancelar = ref<Record<number, string>>({});
const complemento = ref<Record<number, string>>({});
const linhaDoTempo = ref<Record<number, { evento: string; em: string; motivo: string | null }[]>>({});
const opcoesCancelar = computed(() => [
  { valor: '', rotulo: t('sadt.pedido.escolha') },
  ...(motivos.data.value?.cancelamento ?? []).map((m) => ({ valor: String(m.id), rotulo: m.descricao })),
]);
const exigeComplemento = (id: number) =>
  motivos.data.value?.cancelamento.find((m) => String(m.id) === motivoCancelar.value[id])?.exigeComplemento ??
  false;
async function cancelar(item: number): Promise<void> {
  erro.value = null;
  try {
    const r = await cancelarItem(
      item,
      Number(motivoCancelar.value[item]),
      complemento.value[item]?.trim() || null,
      novaChave('pedido.cancelar'),
    );
    mensagem.value = t(`sadt.pedido.canceladoConta.${r.conta}`);
    await cliente.invalidateQueries({ queryKey: ['sadt', 'pedido', 'atendimento'] });
    if (linhaDoTempo.value[item]) await verEventos(item);
  } catch (x) {
    erro.value = x;
  }
}
async function verEventos(item: number): Promise<void> {
  try {
    linhaDoTempo.value = { ...linhaDoTempo.value, [item]: (await lerEventosDoItem(item)).itens };
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="pedido" data-testid="pedido-exames">
    <h1>{{ t('sadt.pedido.titulo') }}</h1>

    <div v-if="atendimento === null" class="linha">
      <label for="pedido-busca">{{ t('sadt.pedido.buscarPaciente') }}</label>
      <input id="pedido-busca" v-model="busca" data-testid="pedido-busca" @keyup.enter="buscar" />
      <SanteBotao
        :rotulo="t('sadt.pedido.buscar')"
        :desabilitado="busca.trim().length < 2"
        data-testid="pedido-buscar"
        @acionar="buscar"
      />
    </div>
    <ul v-if="atendimento === null && encontrados" data-testid="pedido-encontrados">
      <li v-if="encontrados.length === 0">{{ t('sadt.pedido.nenhumAtendimento') }}</li>
      <li v-for="a in encontrados" :key="a.id">
        {{ a.nome }} ·
        {{ a.idadeAnos === null ? t('sadt.pedido.semIdade') : t('sadt.pedido.idade', { n: a.idadeAnos }) }} ·
        {{ t('sadt.pedido.atendimento') }} {{ a.numero }}
        <SanteBotao
          :rotulo="t('sadt.pedido.escolher')"
          :data-testid="`pedido-escolher-${a.id}`"
          @acionar="escolher(a)"
        />
      </li>
    </ul>

    <template v-if="atendimento !== null">
      <header class="cabecalho" data-testid="pedido-cabecalho">
        <strong>{{ cabecalho }}</strong>
        <label>
          <input v-model="pacienteConfirmado" type="checkbox" data-testid="pedido-paciente-confirmado" />
          {{ t('sadt.pedido.pacienteConfirmado') }}
        </label>
        <SanteBotao :rotulo="t('sadt.pedido.trocarPaciente')" data-testid="pedido-trocar" @acionar="trocar" />
      </header>

      <div class="linha">
        <SanteSelecao
          v-model="setor"
          :rotulo="t('sadt.pedido.setor')"
          :opcoes="setores"
          data-testid="pedido-setor"
        />
        <SanteSelecao v-model="prioridade" :rotulo="t('sadt.pedido.prioridade')" :opcoes="prioridades" />
      </div>
      <fieldset>
        <legend>{{ t('sadt.pedido.kits') }}</legend>
        <label v-for="k in kits.data.value?.itens ?? []" :key="k.id">
          <input v-model="kitsEscolhidos" type="checkbox" :value="k.id" />
          {{ k.nome }} ({{ t('sadt.pedido.versao', { n: k.numeroVersao }) }}:
          {{ k.itens.map((i) => i.nome).join(', ') }})
        </label>
      </fieldset>
      <fieldset>
        <legend>{{ t('sadt.pedido.exames') }}</legend>
        <p class="nota">{{ t('sadt.pedido.materialPadrao') }}</p>
        <div v-for="e in apoio.data.value?.exames ?? []" :key="e.id" class="exame">
          <label>
            <input v-model="exames" type="checkbox" :value="e.id" :data-testid="`pedido-exame-${e.id}`" />
            {{ e.nome }}
          </label>
          <template v-if="exames.includes(e.id)">
            <SanteSelecao
              :model-value="setorDoExame[e.id] ?? ''"
              :rotulo="t('sadt.pedido.setorDoExame')"
              :opcoes="setoresDoExame"
              @update:model-value="(v: string) => (setorDoExame = { ...setorDoExame, [e.id]: v })"
            />
            <SanteSelecao
              v-if="(materiaisDoExame[e.id] ?? []).length > 1"
              :model-value="materialDoExame[e.id] ?? ''"
              :rotulo="t('sadt.pedido.materialDoExame')"
              :opcoes="materiaisDoExame[e.id] ?? []"
              :data-testid="`pedido-material-${e.id}`"
              @update:model-value="(v: string) => (materialDoExame = { ...materialDoExame, [e.id]: v })"
            />
            <label>
              <input
                type="checkbox"
                :checked="urgenteDoExame[e.id] ?? false"
                @change="urgenteDoExame = { ...urgenteDoExame, [e.id]: !(urgenteDoExame[e.id] ?? false) }"
              />
              {{ t('sadt.pedido.urgenteExame') }}
            </label>
          </template>
        </div>
      </fieldset>
      <label for="pedido-indicacao">{{ t('sadt.pedido.indicacao') }}</label>
      <textarea id="pedido-indicacao" v-model="indicacao" maxlength="2000" />

      <div v-if="avaliacao" class="avisos" data-testid="pedido-avisos" aria-live="polite">
        <h2>{{ t('sadt.pedido.avisos') }}</h2>
        <p v-if="avaliacao.restricoes.length === 0 && avaliacao.limites.length === 0">
          {{ t('sadt.pedido.semAvisos') }}
        </p>
        <ul>
          <li v-for="r in avaliacao.restricoes" :key="`${r.regra}-${r.exame}`" :class="r.tipo">
            {{ nomeExame(r.exame) }}: {{ r.mensagem }}
          </li>
        </ul>
        <ul v-if="avaliacao.limites.length" data-testid="pedido-limites">
          <li
            v-for="l in avaliacao.limites"
            :key="`${l.tipo}-${l.regra}-${l.exame}`"
            :class="l.acao === 'alertar' ? 'alerta' : 'bloqueio'"
          >
            {{ nomeExame(l.exame) }}: {{ l.mensagem }}
          </li>
        </ul>
        <label
          v-if="
            avaliacao.restricoes.some((r) => r.tipo === 'alerta') ||
            avaliacao.limites.some((l) => l.acao === 'alertar')
          "
        >
          <input v-model="confirmado" type="checkbox" data-testid="pedido-confirmar" />
          {{ t('sadt.pedido.confirmar') }}
        </label>
        <template v-if="pedeJustificativa">
          <p v-if="semPermissaoExcecao" class="bloqueio" data-testid="pedido-sem-permissao-excecao">
            {{ t('sadt.pedido.semPermissaoExcecao') }}
          </p>
          <label for="pedido-justificativa">{{ t('sadt.pedido.justificativa') }}</label>
          <input
            id="pedido-justificativa"
            v-model="justificativa"
            maxlength="500"
            data-testid="pedido-justificativa"
          />
        </template>
      </div>
      <SanteBotao
        :rotulo="t('sadt.pedido.gravar')"
        :desabilitado="!podeGravar"
        data-testid="pedido-gravar"
        @acionar="gravar"
      />
    </template>
    <p v-if="mensagem" role="status" data-testid="pedido-mensagem">{{ mensagem }}</p>
    <p v-if="avisoCobranca" class="bloqueio" role="status" data-testid="pedido-cobranca-pendente">
      {{ avisoCobranca }}
    </p>
    <ErroSadt v-if="erro" :erro="erro" />
    <ErroSadt v-if="doAtendimento.isError.value" :erro="doAtendimento.error.value" />

    <section v-if="doAtendimento.data.value" data-testid="pedido-anteriores">
      <h2>{{ t('sadt.pedido.anteriores') }}</h2>
      <p v-if="doAtendimento.data.value.requisicoes.length === 0">{{ t('sadt.pedido.semAnteriores') }}</p>
      <SanteBotao
        v-if="temPendente"
        :rotulo="t('sadt.pedido.lancarPendentes')"
        data-testid="pedido-lancar-pendentes"
        @acionar="lancarPendentes"
      />
      <article
        v-for="r in doAtendimento.data.value.requisicoes"
        :key="r.id"
        :data-testid="`pedido-req-${r.id}`"
      >
        <h3>{{ r.numero }} · {{ r.situacao }} · {{ quando(r.solicitadaEm) }}</h3>
        <div v-for="i in r.itens" :key="i.id" class="item" :data-testid="`pedido-item-${i.id}`">
          <p>
            {{ i.sequencia }}. {{ i.exame }} · {{ i.situacao }}
            <span v-if="i.cobranca !== 'nao_se_aplica'" :data-testid="`pedido-cobranca-${i.id}`">
              · {{ t(`sadt.pedido.cobranca.${i.cobranca}`) }}
            </span>
          </p>
          <template v-if="CANCELAVEIS.includes(i.situacao)">
            <SanteSelecao
              :model-value="motivoCancelar[i.id] ?? ''"
              :rotulo="t('sadt.pedido.motivo')"
              :opcoes="opcoesCancelar"
              @update:model-value="(v: string) => (motivoCancelar = { ...motivoCancelar, [i.id]: v })"
            />
            <input
              v-if="exigeComplemento(i.id)"
              v-model="complemento[i.id]"
              :aria-label="t('sadt.pedido.complemento')"
              maxlength="500"
            />
            <SanteBotao
              :rotulo="t('sadt.pedido.cancelar')"
              :desabilitado="!motivoCancelar[i.id]"
              :data-testid="`pedido-cancelar-${i.id}`"
              @acionar="cancelar(i.id)"
            />
          </template>
          <SanteBotao
            :rotulo="t('sadt.pedido.linhaDoTempo')"
            :data-testid="`pedido-eventos-${i.id}`"
            @acionar="verEventos(i.id)"
          />
          <ol v-if="linhaDoTempo[i.id]" :data-testid="`pedido-linha-${i.id}`">
            <li v-for="(ev, k) in linhaDoTempo[i.id]" :key="k">
              {{ quando(ev.em) }} · {{ ev.evento }}<template v-if="ev.motivo"> · {{ ev.motivo }}</template>
            </li>
          </ol>
        </div>
      </article>
    </section>
  </section>
</template>

<style scoped>
.pedido {
  display: grid;
  gap: 0.75rem;
}
.linha,
.cabecalho,
.exame {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
.cabecalho {
  padding: 0.5rem;
  border: 1px solid var(--sgh-borda);
}
fieldset {
  display: grid;
  gap: 0.25rem;
}
.nota {
  font-size: 0.875rem;
}
.avisos .bloqueio,
.bloqueio {
  color: var(--sgh-alerta);
}
</style>
