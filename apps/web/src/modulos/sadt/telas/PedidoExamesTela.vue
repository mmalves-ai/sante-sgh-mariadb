<script setup lang="ts">
// Pedido de exames (F3.5, 05-SADT linhas 4 e 5): o atendimento, o setor, os exames e os kits numa tela só; a cada
// mudança a API avalia as restrições (nada gravado) e os avisos aparecem na hora. O bloqueio que aceita exceção pede a
// justificativa, que fica registrada no item. Depois de gravar, cada exame pode ser cancelado com o motivo do cadastro.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type AvaliacaoPedido,
  avaliarPedido,
  cancelarItem,
  type CorpoPedido,
  gravarPedido,
  lerMotivosPedido,
  listarKits,
} from '../api-pedido.js';
import { novaChave } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';
import { usarSadt } from '../usar-sadt.js';

const { t } = useI18n();
const { apoio } = usarSadt();
const motivos = useQuery({ queryKey: ['sadt', 'pedido', 'motivos'], queryFn: lerMotivosPedido });
const kits = useQuery({ queryKey: ['sadt', 'kits'], queryFn: listarKits });

const atendimento = ref('');
const setor = ref('');
const prioridade = ref<CorpoPedido['prioridade']>('rotina');
const exames = ref<number[]>([]);
const kitsEscolhidos = ref<number[]>([]);
const indicacao = ref('');
const confirmado = ref(false);
const justificativa = ref('');
const avaliacao = ref<AvaliacaoPedido | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravados = ref<{ id: number; exame: number; cancelado: boolean }[]>([]);

const nomeExame = (id: number) => apoio.data.value?.exames.find((e) => e.id === id)?.nome ?? String(id);
const setores = computed(() => [
  { valor: '', rotulo: t('sadt.pedido.escolha') },
  ...(motivos.data.value?.setores ?? []).map((s) => ({ valor: String(s.id), rotulo: s.nome })),
]);
const prioridades = computed(() =>
  (['rotina', 'urgente', 'emergencia'] as const).map((p) => ({
    valor: p,
    rotulo: t(`sadt.pedido.prioridades.${p}`),
  })),
);
const corpo = (): CorpoPedido | null => {
  const at = Number(atendimento.value);
  const se = Number(setor.value);
  if (!at || !se || exames.value.length + kitsEscolhidos.value.length === 0) return null;
  return {
    atendimento: at,
    setor: se,
    prioridade: prioridade.value,
    exames: exames.value.map((exame) => ({ exame })),
    kits: kitsEscolhidos.value,
    indicacaoClinica: indicacao.value.trim() || null,
    confirmado: confirmado.value,
    justificativa: justificativa.value.trim() || null,
  };
};
// Validação na hora: cada mudança do pedido reavalia as restrições.
watch(
  [atendimento, setor, exames, kitsEscolhidos],
  async () => {
    const c = corpo();
    avaliacao.value = null;
    if (!c) return;
    try {
      avaliacao.value = await avaliarPedido(c, novaChave('pedido.avaliar'));
      erro.value = null;
    } catch (x) {
      erro.value = x;
    }
  },
  { deep: true },
);
const pedeJustificativa = computed(() =>
  (avaliacao.value?.restricoes ?? []).some(
    (r) => r.tipo === 'bloqueio' && r.excecao === null && r.permiteExcecao,
  ),
);
const ocupado = ref(false);
async function gravar(): Promise<void> {
  const c = corpo();
  if (!c) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await gravarPedido(c, novaChave('pedido.gravar'));
    mensagem.value = t('sadt.pedido.gravado', { numero: r.numero, n: r.itens.length });
    gravados.value = r.itens.map((i) => ({ id: i.id, exame: i.exame, cancelado: false }));
    exames.value = [];
    kitsEscolhidos.value = [];
    justificativa.value = '';
    confirmado.value = false;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const motivoCancelar = ref<Record<number, string>>({});
const complemento = ref<Record<number, string>>({});
const opcoesCancelar = computed(() => [
  { valor: '', rotulo: t('sadt.pedido.escolha') },
  ...(motivos.data.value?.cancelamento ?? []).map((m) => ({ valor: String(m.id), rotulo: m.descricao })),
]);
const exigeComplemento = (id: number) =>
  motivos.data.value?.cancelamento.find((m) => String(m.id) === motivoCancelar.value[id])?.exigeComplemento ??
  false;
async function cancelar(i: { id: number; cancelado: boolean }): Promise<void> {
  erro.value = null;
  try {
    await cancelarItem(
      i.id,
      Number(motivoCancelar.value[i.id]),
      complemento.value[i.id]?.trim() || null,
      novaChave('pedido.cancelar'),
    );
    i.cancelado = true;
    mensagem.value = t('sadt.pedido.cancelado');
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="pedido" data-testid="pedido-exames">
    <h1>{{ t('sadt.pedido.titulo') }}</h1>
    <div class="linha">
      <label for="pedido-atendimento">{{ t('sadt.pedido.atendimento') }}</label>
      <input
        id="pedido-atendimento"
        v-model="atendimento"
        inputmode="numeric"
        data-testid="pedido-atendimento"
      />
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
      <label v-for="e in apoio.data.value?.exames ?? []" :key="e.id">
        <input v-model="exames" type="checkbox" :value="e.id" :data-testid="`pedido-exame-${e.id}`" />
        {{ e.nome }}
      </label>
    </fieldset>
    <label for="pedido-indicacao">{{ t('sadt.pedido.indicacao') }}</label>
    <textarea id="pedido-indicacao" v-model="indicacao" maxlength="2000" />

    <div v-if="avaliacao" class="avisos" data-testid="pedido-avisos" aria-live="polite">
      <h2>{{ t('sadt.pedido.avisos') }}</h2>
      <p v-if="avaliacao.restricoes.length === 0">{{ t('sadt.pedido.semAvisos') }}</p>
      <ul>
        <li v-for="r in avaliacao.restricoes" :key="`${r.regra}-${r.exame}`" :class="r.tipo">
          {{ nomeExame(r.exame) }}: {{ r.mensagem }}
        </li>
      </ul>
      <label v-if="avaliacao.restricoes.some((r) => r.tipo === 'alerta')">
        <input v-model="confirmado" type="checkbox" data-testid="pedido-confirmar" />
        {{ t('sadt.pedido.confirmar') }}
      </label>
      <template v-if="pedeJustificativa">
        <label for="pedido-justificativa">{{ t('sadt.pedido.justificativa') }}</label>
        <input
          id="pedido-justificativa"
          v-model="justificativa"
          maxlength="500"
          data-testid="pedido-justificativa"
        />
      </template>
    </div>
    <SanteBotao :disabled="ocupado || !corpo()" data-testid="pedido-gravar" @click="gravar">
      {{ t('sadt.pedido.gravar') }}
    </SanteBotao>
    <p v-if="mensagem" role="status" data-testid="pedido-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />

    <section v-if="gravados.length" data-testid="pedido-itens">
      <h2>{{ t('sadt.pedido.itens') }}</h2>
      <article v-for="i in gravados" :key="i.id">
        <p>{{ nomeExame(i.exame) }}</p>
        <template v-if="!i.cancelado">
          <SanteSelecao
            :model-value="motivoCancelar[i.id] ?? ''"
            :rotulo="t('sadt.pedido.motivo')"
            :opcoes="opcoesCancelar"
            @update:model-value="(v: string) => (motivoCancelar[i.id] = v)"
          />
          <input
            v-if="exigeComplemento(i.id)"
            v-model="complemento[i.id]"
            :aria-label="t('sadt.pedido.complemento')"
            maxlength="500"
          />
          <SanteBotao :disabled="!motivoCancelar[i.id]" @click="cancelar(i)">{{
            t('sadt.pedido.cancelar')
          }}</SanteBotao>
        </template>
        <p v-else>{{ t('sadt.pedido.cancelado') }}</p>
      </article>
    </section>
  </section>
</template>

<style scoped>
.pedido {
  display: grid;
  gap: 0.75rem;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
fieldset {
  display: grid;
  gap: 0.25rem;
}
.avisos .bloqueio {
  color: var(--sante-erro, #b00020);
}
</style>
