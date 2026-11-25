<script setup lang="ts">
// Pedidos de vaga do paciente (02-AGE linha 53): o médico pede, no prontuário, a consulta, o exame ou o procedimento
// que ainda não tem vaga; o pedido entra na lista de espera da agenda com os procedimentos pedidos. Um formulário só
// (especialidade, procedimentos, prioridade, prazo), conferido na hora pela regra do domínio (validarPedidoVaga);
// a lista mostra os pedidos do médico e os que vieram da regulação, com a situação na fila. Nada se apaga.
import { validarPedidoVaga } from '@sgh/dominio-agenda';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { lerPedidosVaga, pedirVaga } from '../../api-pedido-vaga.js';
import { dataHoraBr } from '../../formato.js';

const props = defineProps<{ paciente: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const chave = computed(() => ['agenda', 'pedidos-vaga', props.paciente]);
const dados = useQuery({ queryKey: chave, queryFn: () => lerPedidosVaga(props.paciente) });

const especialidade = ref<number | null>(null);
const prioridade = ref<'normal' | 'urgente'>('normal');
const prazo = ref('');
const observacao = ref('');
const itens = ref<{ item: number | null; quantidade: number }[]>([{ item: null, quantidade: 1 }]);
const erro = ref<unknown>(null);
const gravado = ref(false);

const opcoesEspecialidade = computed(() => [
  { valor: null, rotulo: t('pep.pedidoVaga.semEspecialidade') },
  ...(dados.data.value?.especialidades ?? []).map((x) => ({ valor: x.id, rotulo: x.nome })),
]);
const opcoesItem = computed(() => [
  { valor: null, rotulo: t('pep.pedidoVaga.escolher') },
  ...(dados.data.value?.itens ?? []).map((x) => ({ valor: x.id, rotulo: x.nome })),
]);
const opcoesPrioridade = computed(() =>
  (['normal', 'urgente'] as const).map((p) => ({ valor: p, rotulo: t(`pep.pedidoVaga.prioridades.${p}`) })),
);

const hoje = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const escolhidos = computed(() =>
  itens.value
    .filter((x) => x.item !== null)
    .map((x) => ({ itemAgendavel: x.item as number, itemFaturavel: null, quantidade: Number(x.quantidade) })),
);
/** Validação na hora pela mesma regra do servidor; o primeiro problema de cada campo vira a mensagem. */
const problemas = computed(() => {
  const r = validarPedidoVaga({
    solicitante: dados.data.value?.solicitante?.id ?? null,
    regulacao: null,
    especialidade: especialidade.value,
    agenda: null,
    itens: escolhidos.value,
    prazoLimite: prazo.value || null,
    hoje: hoje(),
  });
  if (r.ok) return [];
  return r.problemas
    .filter((p) => p.campo !== 'solicitante')
    .map((p) =>
      p.campo === 'especialidade'
        ? t('pep.pedidoVaga.erros.alvo')
        : p.campo === 'prazoLimite'
          ? t('pep.pedidoVaga.erros.prazo')
          : p.campo.endsWith('quantidade')
            ? t('pep.pedidoVaga.erros.quantidade')
            : t('pep.pedidoVaga.erros.repetido'),
    )
    .filter((m, i, a) => a.indexOf(m) === i);
});

function incluirItem(): void {
  itens.value.push({ item: null, quantidade: 1 });
}
function retirarItem(i: number): void {
  itens.value.splice(i, 1);
  if (itens.value.length === 0) incluirItem();
}

async function pedir(): Promise<void> {
  erro.value = null;
  gravado.value = false;
  if (problemas.value.length > 0) return;
  try {
    await pedirVaga({
      paciente: props.paciente,
      especialidade: especialidade.value,
      prioridade: prioridade.value,
      prazoLimite: prazo.value || null,
      observacao: observacao.value.trim() || null,
      itens: escolhidos.value.map((x) => ({ itemAgendavel: x.itemAgendavel, quantidade: x.quantidade })),
    });
    especialidade.value = null;
    prioridade.value = 'normal';
    prazo.value = '';
    observacao.value = '';
    itens.value = [{ item: null, quantidade: 1 }];
    gravado.value = true;
    await cliente.invalidateQueries({ queryKey: ['agenda', 'pedidos-vaga'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="aba" aria-labelledby="pedido-vaga-titulo" data-testid="aba-pedidos-vaga-conteudo">
    <h2 id="pedido-vaga-titulo">{{ t('pep.pedidoVaga.titulo') }}</h2>
    <p>{{ t('pep.pedidoVaga.explicacao') }}</p>
    <MensagemErro v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('pep.pedidoVaga.carregando') }}</p>
    <template v-else>
      <p v-if="dados.data.value.pedidos.length === 0">{{ t('pep.pedidoVaga.nenhum') }}</p>
      <ul class="lista">
        <li
          v-for="x in dados.data.value.pedidos"
          :key="x.id"
          class="cartao"
          :data-testid="`pedido-vaga-${x.id}`"
        >
          <p>
            <strong>{{ x.especialidade ?? x.agenda ?? x.itens[0]?.descricao ?? '-' }}</strong> ·
            <span class="marcador">{{ t(`pep.pedidoVaga.situacoes.${x.situacao}`) }}</span> ·
            {{ t(`pep.pedidoVaga.prioridades.${x.prioridade}`) }}
            <span v-if="x.prazoLimite"> · {{ t('pep.pedidoVaga.ate', { data: x.prazoLimite }) }}</span>
          </p>
          <p>
            {{ x.entradaEm ? dataHoraBr(x.entradaEm) : '' }}
            <span v-if="x.solicitante">
              · {{ t('pep.pedidoVaga.solicitante', { nome: x.solicitante }) }}</span
            >
            <span v-if="x.regulacao"> · {{ t('pep.pedidoVaga.regulacao', { numero: x.regulacao }) }}</span>
          </p>
          <ul v-if="x.itens.length > 0">
            <li v-for="i in x.itens" :key="i.sequencia">
              {{ t('pep.pedidoVaga.itemQuantidade', { descricao: i.descricao, quantidade: i.quantidade }) }} ·
              {{ t(`pep.pedidoVaga.situacoes.${i.situacao}`) }}
            </li>
          </ul>
          <p v-if="x.observacao">{{ x.observacao }}</p>
        </li>
      </ul>

      <SanteAlerta
        v-if="!dados.data.value.solicitante"
        variante="info"
        :texto="t('pep.pedidoVaga.semProfissional')"
      />
      <form v-else class="form" data-testid="pedido-vaga-form" @submit.prevent="pedir">
        <h3>{{ t('pep.pedidoVaga.novo') }}</h3>
        <SanteSelecao
          v-model="especialidade"
          class="campo"
          :rotulo="t('pep.pedidoVaga.especialidade')"
          :opcoes="opcoesEspecialidade"
        />
        <div v-for="(x, i) in itens" :key="i" class="linha" :data-testid="`pedido-vaga-item-${i}`">
          <SanteSelecao
            v-model="x.item"
            class="campo"
            :rotulo="t('pep.pedidoVaga.procedimento')"
            :opcoes="opcoesItem"
          />
          <label class="campo"
            ><span>{{ t('pep.pedidoVaga.quantidade') }}</span
            ><input v-model.number="x.quantidade" type="number" min="1" max="99" step="1"
          /></label>
          <SanteBotao
            variante="secundario"
            :rotulo="t('pep.pedidoVaga.retirarItem')"
            @acionar="retirarItem(i)"
          />
        </div>
        <SanteBotao variante="secundario" :rotulo="t('pep.pedidoVaga.incluirItem')" @acionar="incluirItem" />
        <SanteSelecao
          v-model="prioridade"
          class="campo"
          :rotulo="t('pep.pedidoVaga.prioridade')"
          :opcoes="opcoesPrioridade"
        />
        <label class="campo"
          ><span>{{ t('pep.pedidoVaga.prazo') }}</span
          ><input v-model="prazo" type="date" :min="hoje()"
        /></label>
        <label class="campo"
          ><span>{{ t('pep.pedidoVaga.observacao') }}</span
          ><textarea v-model="observacao" rows="3" maxlength="600" />
        </label>
        <ul v-if="problemas.length > 0" role="alert" data-testid="pedido-vaga-problemas">
          <li v-for="p in problemas" :key="p">{{ p }}</li>
        </ul>
        <SanteBotao tipo="submit" :rotulo="t('pep.pedidoVaga.pedir')" :desabilitado="problemas.length > 0" />
        <SanteAlerta v-if="gravado" variante="info" :texto="t('pep.pedidoVaga.pedido')" />
      </form>
      <MensagemErro v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style scoped src="./abas.css"></style>
