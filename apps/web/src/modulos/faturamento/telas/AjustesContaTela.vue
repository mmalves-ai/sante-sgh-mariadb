<script setup lang="ts">
// Ajustes de valor da conta (F3.7, 06-FAT linhas 17, 18 e 20): `/faturamento/contas/:id/ajustes`. Tudo do valor da
// conta do paciente numa tela só:
// - Horário especial: cada item com a hora no relógio do hospital, a faixa que vale (noturno, fim de semana, feriado)
//   e o acréscimo calculado; um clique aplica tudo e refaz o total.
// - Acréscimo e desconto: motivo, valor ou percentual e justificativa, conferidos enquanto se digita (mesma regra do
//   servidor). O pedido fica pendente até outro usuário com a alçada aprovar ou recusar; o recusado fica no histórico.
// - Pacote: aplicar um pacote aceito pela fonte da conta, ver inclusos, itens à parte e alertas de teto; descaracterizar
//   pede motivo e justificativa e devolve a conta à cobrança aberta.
import { validarAjusteConta } from '@sgh/dominio-faturamento';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  aplicarHorario,
  aplicarPacote,
  cancelarAjuste,
  decidirAjuste,
  descaracterizarPacote,
  lerAjustes,
  lerPacotes,
  pedirAjuste,
} from '../api-ajustes.js';
import { novaChave } from '../api-faturamento.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';
import { quando } from '../usar-faturamento.js';

const props = defineProps<{ id: string }>();
const conta = computed(() => Number(props.id));
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Ajustes de valor da conta',
      voltar: 'Voltar à conta',
      fechada: 'A conta não está aberta: reabra-a para mudar os valores.',
      valores: 'Itens {itens} · acréscimos {acrescimo} · descontos {desconto} · total {total}',
      horario: 'Horário especial',
      semHorario: 'Nenhum item cobrado na conta.',
      item: 'Item',
      hora: 'Feito em',
      faixa: 'Faixa',
      acrescimo: 'Acréscimo',
      feriado: 'feriado',
      normal: 'horário normal',
      aplicar: 'Aplicar o horário especial ({n} item(ns) mudam)',
      emDia: 'Os acréscimos de horário estão em dia.',
      ajustes: 'Acréscimos e descontos',
      tipo: 'Tipo',
      desconto: 'Desconto',
      motivo: 'Motivo',
      forma: 'Forma',
      valor: 'Valor',
      percentual: 'Percentual',
      justificativa: 'Justificativa',
      pedir: 'Pedir ajuste',
      calculado: 'Valor do ajuste: {v}',
      situacao: 'Situação',
      pedidoPor: 'Pedido por',
      decididoPor: 'Decidido por',
      aprovar: 'Aprovar',
      recusar: 'Recusar',
      cancelar: 'Cancelar pedido',
      observacao: 'Por que recusa',
      semAjustes: 'Nenhum ajuste pedido.',
      pacotes: 'Pacote',
      semPacote: 'Nenhum pacote aplicado.',
      aplicarPacote: 'Aplicar pacote',
      reclassificar: 'Reclassificar itens',
      inclusos: '{i} incluso(s) · {p} à parte · versão {v} · valor {valor}',
      descaracterizado: 'Descaracterizado: {m}',
      descaracterizar: 'Descaracterizar',
      confirmar: 'Confirmar',
      gravado: 'Gravado.',
      sit_pendente_aprovacao: 'Aguardando alçada',
      sit_aprovado: 'Aprovado',
      sit_recusado: 'Recusado',
      sit_cancelado: 'Cancelado',
    },
  },
});
const qc = useQueryClient();
const aj = useQuery({ queryKey: ['faturamento', 'ajustes', conta], queryFn: () => lerAjustes(conta.value) });
const pac = useQuery({ queryKey: ['faturamento', 'pacotes', conta], queryFn: () => lerPacotes(conta.value) });
const dados = computed(() => aj.data.value);
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('ajustes');
async function acao(f: () => Promise<unknown>) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = (await f()) as { avisos?: string };
    mensagem.value = r.avisos ? r.avisos : t('gravado');
    chave = novaChave('ajustes');
    await qc.invalidateQueries({ queryKey: ['faturamento'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    gravando.value = false;
  }
}

// Horário especial
const mudam = computed(() => dados.value?.horario.filter((i) => i.mudou).length ?? 0);

// Acréscimo e desconto
const form = reactive({
  tipo: 'desconto' as 'acrescimo' | 'desconto',
  motivoId: 0,
  forma: 'valor' as 'valor' | 'percentual',
  valor: null as number | null,
  percentual: null as number | null,
  justificativa: '',
});
const motivos = computed(() => dados.value?.motivos.filter((m) => m.tipoAjuste === form.tipo) ?? []);
const motivoEscolhido = computed(() => dados.value?.motivos.find((m) => m.id === form.motivoId) ?? null);
function escolherMotivo() {
  const m = motivoEscolhido.value;
  if (!m) return;
  if (m.forma === 'percentual' || m.forma === 'valor') form.forma = m.forma;
  if (m.valorPadrao !== null) {
    if (form.forma === 'percentual') form.percentual = m.valorPadrao;
    else form.valor = m.valorPadrao;
  }
  if (m.textoPadrao && !form.justificativa) form.justificativa = m.textoPadrao;
}
const conferencia = computed(() =>
  dados.value
    ? validarAjusteConta(
        form,
        motivoEscolhido.value ? { tipoAjuste: motivoEscolhido.value.tipoAjuste, ativo: true } : null,
        {
          valorItens: dados.value.valores.itens,
          descontosEmVigor: dados.value.reservado.desconto,
          acrescimosEmVigor: dados.value.reservado.acrescimo,
        },
      )
    : null,
);
const erros = computed(() => Object.values(conferencia.value?.erros ?? {}));
async function pedir() {
  const ok = await acao(() =>
    pedirAjuste(
      conta.value,
      {
        ...form,
        valor: form.forma === 'valor' ? form.valor : null,
        percentual: form.forma === 'percentual' ? form.percentual : null,
      },
      chave,
    ),
  );
  if (ok) Object.assign(form, { valor: null, percentual: null, justificativa: '', motivoId: 0 });
}
const recusando = ref<number | null>(null);
const observacao = ref('');

// Pacote
const pacoteId = ref(0);
const descaracterizando = ref<number | null>(null);
const motivoDesc = ref(0);
const justDesc = ref('');
</script>

<template>
  <section class="tela-agenda" aria-labelledby="aj-titulo" data-testid="tela-ajustes-conta">
    <h1 id="aj-titulo">{{ t('titulo') }}</h1>
    <RouterLink :to="{ name: 'faturamento.conta', params: { id: props.id } }">{{ t('voltar') }}</RouterLink>
    <MensagemFaturamento :texto="mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <ErroFaturamento v-if="aj.error.value" :erro="aj.error.value" />
    <template v-if="dados">
      <p data-testid="aj-valores">
        {{
          t('valores', {
            itens: reais(dados.valores.itens),
            acrescimo: reais(dados.valores.acrescimo),
            desconto: reais(dados.valores.desconto),
            total: reais(dados.valores.total),
          })
        }}
      </p>
      <p v-if="!dados.editavel" role="status">{{ t('fechada') }}</p>

      <h2>{{ t('horario') }}</h2>
      <table v-if="dados.horario.length" class="tabela" data-testid="aj-horario">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">{{ t('item') }}</th>
            <th scope="col">{{ t('hora') }}</th>
            <th scope="col">{{ t('faixa') }}</th>
            <th scope="col">{{ t('acrescimo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in dados.horario" :key="i.id" :class="{ destaque: i.mudou }">
            <td>{{ i.sequencia }}</td>
            <td>{{ i.codigo }} - {{ i.descricao }}</td>
            <td>
              {{ quando(i.realizadoEm) }}<span v-if="i.feriado"> ({{ t('feriado') }})</span>
            </td>
            <td>{{ i.faixa ?? t('normal') }}</td>
            <td>
              {{ reais(i.acrescimo) }}
              <s v-if="i.mudou && i.acrescimoAtual !== i.acrescimo">{{ reais(i.acrescimoAtual) }}</s>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('semHorario') }}</p>
      <button
        v-if="dados.editavel && mudam > 0"
        type="button"
        :disabled="gravando"
        data-testid="aj-aplicar-horario"
        @click="acao(() => aplicarHorario(conta, chave))"
      >
        {{ t('aplicar', { n: mudam }) }}
      </button>
      <p v-else-if="dados.horario.length">{{ t('emDia') }}</p>

      <h2>{{ t('ajustes') }}</h2>
      <form v-if="dados.editavel" class="formulario" data-testid="aj-form" @submit.prevent="pedir">
        <label>
          {{ t('tipo') }}
          <select v-model="form.tipo" data-testid="aj-tipo" @change="form.motivoId = 0">
            <option value="desconto">{{ t('desconto') }}</option>
            <option value="acrescimo">{{ t('acrescimo') }}</option>
          </select>
        </label>
        <label>
          {{ t('motivo') }}
          <select v-model.number="form.motivoId" data-testid="aj-motivo" @change="escolherMotivo">
            <option :value="0"></option>
            <option v-for="m in motivos" :key="m.id" :value="m.id">{{ m.descricao }}</option>
          </select>
        </label>
        <label>
          {{ t('forma') }}
          <select v-model="form.forma" data-testid="aj-forma">
            <option value="valor">{{ t('valor') }}</option>
            <option value="percentual">{{ t('percentual') }}</option>
          </select>
        </label>
        <label v-if="form.forma === 'valor'">
          {{ t('valor') }}
          <input v-model.number="form.valor" type="number" min="0" step="0.01" data-testid="aj-valor" />
        </label>
        <label v-else>
          {{ t('percentual') }}
          <input
            v-model.number="form.percentual"
            type="number"
            min="0"
            max="100"
            step="0.01"
            data-testid="aj-percentual"
          />
        </label>
        <label>
          {{ t('justificativa') }}
          <textarea v-model="form.justificativa" maxlength="1000" data-testid="aj-justificativa"></textarea>
        </label>
        <p v-if="conferencia && conferencia.valor > 0" data-testid="aj-calculado">
          {{ t('calculado', { v: reais(conferencia.valor) }) }}
        </p>
        <ul v-if="erros.length" class="erros" data-testid="aj-erros">
          <li v-for="e in erros" :key="e">{{ e }}</li>
        </ul>
        <button type="submit" :disabled="gravando || erros.length > 0" data-testid="aj-pedir">
          {{ t('pedir') }}
        </button>
      </form>
      <table v-if="dados.ajustes.length" class="tabela" data-testid="aj-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('tipo') }}</th>
            <th scope="col">{{ t('motivo') }}</th>
            <th scope="col">{{ t('valor') }}</th>
            <th scope="col">{{ t('justificativa') }}</th>
            <th scope="col">{{ t('situacao') }}</th>
            <th scope="col">{{ t('pedidoPor') }}</th>
            <th scope="col">{{ t('decididoPor') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in dados.ajustes" :key="a.id">
            <td>{{ a.tipo === 'desconto' ? t('desconto') : t('acrescimo') }}</td>
            <td>{{ a.motivo }}</td>
            <td>
              {{ reais(a.valor) }}<span v-if="a.percentual !== null"> ({{ a.percentual }}%)</span>
            </td>
            <td>{{ a.justificativa }}</td>
            <td>{{ t(`sit_${a.situacao}`) }}</td>
            <td>{{ a.solicitante ?? '' }} · {{ quando(a.solicitadoEm) }}</td>
            <td>{{ a.decisor ?? '' }}</td>
            <td>
              <template v-if="a.situacao === 'pendente_aprovacao' && dados.editavel">
                <button
                  type="button"
                  :disabled="gravando"
                  data-testid="aj-aprovar"
                  @click="acao(() => decidirAjuste(a.id, a.versao, 'aprovar', null, chave))"
                >
                  {{ t('aprovar') }}
                </button>
                <button
                  v-if="recusando !== a.id"
                  type="button"
                  data-testid="aj-abrir-recusa"
                  @click="recusando = a.id"
                >
                  {{ t('recusar') }}
                </button>
                <span v-else>
                  <label>
                    {{ t('observacao') }}
                    <input v-model="observacao" maxlength="500" data-testid="aj-observacao" />
                  </label>
                  <button
                    type="button"
                    :disabled="gravando || observacao.trim().length < 3"
                    data-testid="aj-recusar"
                    @click="acao(() => decidirAjuste(a.id, a.versao, 'recusar', observacao.trim(), chave))"
                  >
                    {{ t('confirmar') }}
                  </button>
                </span>
                <button
                  type="button"
                  :disabled="gravando"
                  @click="acao(() => cancelarAjuste(a.id, a.versao, chave))"
                >
                  {{ t('cancelar') }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('semAjustes') }}</p>
    </template>

    <h2>{{ t('pacotes') }}</h2>
    <ErroFaturamento v-if="pac.error.value" :erro="pac.error.value" />
    <template v-if="pac.data.value">
      <ul v-if="pac.data.value.aplicados.length" data-testid="aj-pacotes">
        <li v-for="p in pac.data.value.aplicados" :key="p.id">
          <strong>{{ p.pacote }}</strong>
          <span v-if="p.ativo">
            {{
              t('inclusos', {
                i: p.inclusos,
                p: p.aParte,
                v: p.numeroVersao ?? '-',
                valor: reais(p.valorCobrado),
              })
            }}
          </span>
          <span v-else>{{ t('descaracterizado', { m: p.descaracterizacao?.motivo ?? '' }) }}</span>
          <ul v-if="p.alertas.length" class="erros" data-testid="aj-alertas">
            <li v-for="a in p.alertas" :key="a.mensagem">{{ a.mensagem }}</li>
          </ul>
          <template v-if="p.ativo && pac.data.value.editavel">
            <button
              type="button"
              :disabled="gravando"
              @click="acao(() => aplicarPacote(conta, p.pacoteId, chave))"
            >
              {{ t('reclassificar') }}
            </button>
            <button
              v-if="descaracterizando !== p.id"
              type="button"
              data-testid="aj-abrir-desc"
              @click="descaracterizando = p.id"
            >
              {{ t('descaracterizar') }}
            </button>
            <span v-else>
              <select v-model.number="motivoDesc" data-testid="aj-motivo-desc">
                <option :value="0"></option>
                <option v-for="m in pac.data.value.motivos" :key="m.id" :value="m.id">
                  {{ m.descricao }}
                </option>
              </select>
              <input
                v-model="justDesc"
                maxlength="1000"
                :placeholder="t('justificativa')"
                data-testid="aj-just-desc"
              />
              <button
                type="button"
                :disabled="gravando || !motivoDesc || justDesc.trim().length < 10"
                data-testid="aj-descaracterizar"
                @click="acao(() => descaracterizarPacote(p.id, p.versao, motivoDesc, justDesc.trim(), chave))"
              >
                {{ t('confirmar') }}
              </button>
            </span>
          </template>
        </li>
      </ul>
      <p v-else>{{ t('semPacote') }}</p>
      <form
        v-if="pac.data.value.editavel && pac.data.value.candidatos.length"
        class="formulario"
        @submit.prevent="acao(() => aplicarPacote(conta, pacoteId, chave))"
      >
        <select v-model.number="pacoteId" data-testid="aj-pacote">
          <option :value="0"></option>
          <option v-for="c in pac.data.value.candidatos" :key="c.id" :value="c.id">
            {{ c.codigo }} - {{ c.descricao }}
          </option>
        </select>
        <button type="submit" :disabled="gravando || !pacoteId" data-testid="aj-aplicar-pacote">
          {{ t('aplicarPacote') }}
        </button>
      </form>
    </template>
  </section>
</template>
