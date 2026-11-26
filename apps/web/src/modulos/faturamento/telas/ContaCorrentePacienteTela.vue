<script setup lang="ts">
import { SanteSelecao } from '@sgh/ui';
// Conta corrente do paciente particular (F3.7, 06-FAT linha 39): `/faturamento/pacientes/:id/conta-corrente`.
// Tudo do paciente numa tela: o saldo, o recebimento de adiantamento ou caução no caixa aberto (com a vedação da caução
// exigida na urgência avisada enquanto se marca), o uso do saldo em cada conta em aberto com um clique (o devido já
// calculado), o estorno da aplicação com motivo, a devolução do saldo e o extrato corrido. A validação do domínio roda
// enquanto se digita; o servidor confere de novo e as recusas aparecem com o texto dele. Sem paciente na rota, a tela
// abre pela busca do paciente (entrada pelo menu). O atendimento é escolhido da lista do paciente e a urgência vem do
// caráter dele (nunca de uma marca solta). Devolver com conta aberta devendo pede a confirmação explícita.
// F7 (07-FIN linha 92): a devolução é um pedido que reserva o saldo; outra pessoa
// (faturamento.devolucaoAdiantamento.aprovar) aprova e o valor sai; quem pediu não vê o botão de aprovar e o servidor
// recusa se tentar. Fora do dinheiro, a aprovação pede o identificador da transação (validação na hora).
import { FORMAS_ADIANTAMENTO, validarAdiantamento, validarDevolucao } from '@sgh/dominio-faturamento';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { buscarPacientes } from '../../cadastro/api-cadastro.js';
import {
  aplicarAdiantamento,
  aprovarDevolucao,
  cancelarDevolucao,
  devolverAdiantamento,
  estornarAplicacao,
  lerContaCorrente,
  receberAdiantamento,
} from '../api-particular.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';

const props = defineProps<{ id?: string }>();
const { t } = useI18n();
const router = useRouter();
const paciente = computed(() => Number(props.id ?? 0));
const qc = useQueryClient();
const q = useQuery({
  queryKey: ['faturamento', 'conta-corrente', paciente],
  queryFn: () => lerContaCorrente(paciente.value),
  enabled: computed(() => paciente.value > 0),
});
// ── Busca do paciente (entrada pelo menu) ──
const termo = ref('');
const achados = ref<{ id: number; nome: string; prontuario: number }[]>([]);
const buscou = ref(false);
async function procurar() {
  erro.value = null;
  try {
    const r = await buscarPacientes(termo.value.trim());
    achados.value = r.itens.map((p) => ({
      id: p.id,
      nome: p.nomeSocial || p.nome,
      prontuario: p.prontuario,
    }));
    buscou.value = true;
  } catch (e) {
    erro.value = e;
  }
}
const abrir = (id: number) => router.push(`/faturamento/pacientes/${id}/conta-corrente`);
const erro = ref<unknown>(null);
const aviso = ref('');
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const data = (v: string) => new Date(v).toLocaleString('pt-BR');
const chave = () => crypto.randomUUID();
const rotulo = (k: string) => t(`particular.rotulos.${k}`);
async function rodar(fn: () => Promise<unknown>, feito: string) {
  erro.value = null;
  aviso.value = '';
  try {
    await fn();
    aviso.value = feito;
    await qc.invalidateQueries({ queryKey: ['faturamento', 'conta-corrente'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}

// ── Recebimento ──
const rec = reactive({
  tipo: 'adiantamento' as 'adiantamento' | 'caucao',
  valor: 0,
  forma: 'dinheiro' as (typeof FORMAS_ADIANTAMENTO)[number],
  parcelas: 1,
  comprovante: '',
  atendimentoId: 0,
  declaracaoVoluntaria: false,
  pagadorNome: '',
});
const atendimento = computed(
  () => q.data.value?.atendimentos.find((a) => a.id === rec.atendimentoId) ?? null,
);
const urgencia = computed(() => atendimento.value?.urgencia ?? false);
const errosRec = computed(() =>
  validarAdiantamento({
    ...rec,
    atendimentoUrgencia: urgencia.value,
    comprovante: rec.comprovante || null,
    pagadorNome: rec.pagadorNome || null,
    pagadorCpf: null,
    pacienteEhPagador: !rec.pagadorNome,
    // Fora de produção o conector é o simulado; em produção o servidor pede o comprovante se faltar.
    conectorEletronico: true,
  }),
);
const receber = () =>
  rodar(
    () =>
      receberAdiantamento(
        {
          tipo: rec.tipo,
          valor: rec.valor,
          forma: rec.forma,
          parcelas: rec.parcelas,
          declaracaoVoluntaria: rec.declaracaoVoluntaria,
          atendimentoId: rec.atendimentoId || null,
          pacienteId: paciente.value,
          comprovante: rec.comprovante || null,
          pagadorNome: rec.pagadorNome || null,
        },
        chave(),
      ),
    t('particular.cc.recebido'),
  ).then((ok) => ok && Object.assign(rec, { valor: 0, comprovante: '', pagadorNome: '' }));

// ── Uso do saldo na conta ──
const valorUso = reactive<Record<number, number | null>>({});
const usar = (conta: number) =>
  rodar(() => aplicarAdiantamento(conta, valorUso[conta] || null, chave()), t('particular.cc.usado'));
const estornar = (aplicacao: number) => {
  const motivo = window.prompt(t('particular.cc.motivoEstorno'));
  if (motivo?.trim())
    void rodar(() => estornarAplicacao(aplicacao, motivo, chave()), t('particular.cc.estornoFeito'));
};

// ── Devolução ──
const dev = reactive({
  adiantamento: 0,
  valor: 0,
  forma: 'pix' as (typeof FORMAS_ADIANTAMENTO)[number],
  favorecidoNome: '',
  chavePix: '',
  motivo: '',
  confirmarContaAberta: false,
});
/** O que o paciente ainda deve nas contas abertas: o saldo deveria abater ali antes de sair do hospital. */
const devidoAberto = computed(() =>
  (q.data.value?.contasAbertas ?? []).reduce((s, c) => s + Math.max(0, c.devido), 0),
);
const escolhido = computed(() => q.data.value?.adiantamentos.find((a) => a.id === dev.adiantamento) ?? null);
const errosDev = computed(() =>
  escolhido.value
    ? validarDevolucao({
        ...dev,
        saldo: escolhido.value.disponivel,
        situacao: escolhido.value.situacao as 'ativo',
        favorecidoCpf: null,
        chavePix: dev.chavePix || null,
      })
    : { adiantamento: t('particular.cc.escolhaAdiantamento') },
);
const podeDevolver = computed(
  () => !Object.keys(errosDev.value).length && (devidoAberto.value <= 0 || dev.confirmarContaAberta),
);
function prepararDevolucao(id: number, saldo: number) {
  // O valor sugerido é o disponível (o saldo menos os pedidos ainda em aprovação).
  Object.assign(dev, { adiantamento: id, valor: saldo, favorecidoNome: q.data.value?.paciente.nome ?? '' });
}
const devolver = () =>
  rodar(
    () =>
      devolverAdiantamento(
        dev.adiantamento,
        {
          valor: dev.valor,
          forma: dev.forma,
          favorecidoNome: dev.favorecidoNome,
          chavePix: dev.chavePix || null,
          motivo: dev.motivo,
          confirmarContaAberta: dev.confirmarContaAberta,
        },
        chave(),
      ),
    t('particular.cc.devolvido'),
  ).then((ok) => ok && Object.assign(dev, { adiantamento: 0, motivo: '', confirmarContaAberta: false }));

// ── Aprovação da devolução por outra pessoa ──
const { sessao, permissoes } = usarSessao();
const podeAprovar = computed(() => permissoes.value.has('faturamento.devolucaoAdiantamento.aprovar'));
// O cancelamento do pedido é do caixa (a mesma permissão de pedir), com motivo.
const podeCancelar = computed(() => permissoes.value.has('faturamento.recibo.emitir'));
const meuPedido = (solicitante: number | null) =>
  solicitante !== null && String(solicitante) === String(sessao.value?.usuario.id ?? '');
// Fora do dinheiro, o identificador da transação (do pedido ou digitado aqui) prova que o valor saiu.
const comprovanteAprovacao = reactive<Record<number, string>>({});
const pedeComprovante = (p: { forma: string; comprovante: string | null }) =>
  p.forma !== 'dinheiro' && !p.comprovante;
const faltaComprovante = (p: { id: number; forma: string; comprovante: string | null }) =>
  pedeComprovante(p) && !comprovanteAprovacao[p.id]?.trim();
const aprovar = (devolucao: number) =>
  rodar(
    () => aprovarDevolucao(devolucao, comprovanteAprovacao[devolucao]?.trim() || null, chave()),
    t('particular.cc.aprovada'),
  ).then((ok) => {
    if (ok) comprovanteAprovacao[devolucao] = '';
  });
const cancelarPedido = (devolucao: number) => {
  const motivo = window.prompt(t('particular.cc.motivoCancelamento'));
  if (motivo?.trim())
    void rodar(() => cancelarDevolucao(devolucao, motivo, chave()), t('particular.cc.pedidoCancelado'));
};
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cc-titulo" data-testid="tela-conta-corrente">
    <h1 id="cc-titulo">{{ t('particular.cc.titulo') }}</h1>
    <ErroFaturamento v-if="q.error.value || erro" :erro="q.error.value ?? erro" />
    <p v-if="aviso" role="status" data-testid="cc-aviso">{{ aviso }}</p>
    <form v-if="!paciente" class="filtros" data-testid="cc-busca" @submit.prevent="procurar">
      <label>
        {{ t('particular.cc.buscarPaciente') }}
        <input v-model="termo" minlength="2" data-testid="cc-termo" />
      </label>
      <button type="submit" :disabled="termo.trim().length < 2">{{ t('particular.cc.buscar') }}</button>
      <p v-if="buscou && !achados.length" class="secundario">{{ t('particular.cc.nenhumPaciente') }}</p>
      <ul>
        <li v-for="p in achados" :key="p.id">
          {{ p.nome }} <span class="secundario">{{ p.prontuario }}</span>
          <button type="button" @click="abrir(p.id)">{{ t('particular.cc.abrir') }}</button>
        </li>
      </ul>
    </form>
    <template v-if="q.data.value">
      <p>
        <strong>{{ q.data.value.paciente.nome }}</strong>
        {{ t('particular.cc.saldo') }}
        <strong data-testid="cc-saldo">{{ moeda(q.data.value.saldo) }}</strong>
      </p>

      <h2>{{ t('particular.cc.receber') }}</h2>
      <form class="filtros" data-testid="cc-form-receber" @submit.prevent="receber">
        <SanteSelecao
          v-model="rec.tipo"
          :rotulo="t('particular.cc.tipo')"
          :opcoes="[
            { valor: 'adiantamento' as const, rotulo: rotulo('adiantamento') },
            { valor: 'caucao' as const, rotulo: rotulo('caucao') },
          ]"
          data-testid="cc-tipo"
        />
        <label>
          {{ t('particular.cc.valor') }}
          <input v-model.number="rec.valor" type="number" min="0" step="0.01" data-testid="cc-valor" />
        </label>
        <SanteSelecao
          v-model="rec.forma"
          :rotulo="t('particular.cc.forma')"
          :opcoes="[...FORMAS_ADIANTAMENTO.map((x) => ({ valor: x, rotulo: rotulo(x) }))]"
          data-testid="cc-forma"
        />
        <label v-if="rec.forma === 'cartao_credito'">
          {{ t('particular.cc.parcelas') }}
          <input v-model.number="rec.parcelas" type="number" min="1" max="99" />
        </label>
        <label v-if="rec.forma !== 'dinheiro'">
          {{ t('particular.cc.comprovante') }}
          <input v-model="rec.comprovante" maxlength="60" />
        </label>
        <label>
          {{ t('particular.cc.pagador') }}
          <input v-model="rec.pagadorNome" maxlength="150" />
        </label>
        <SanteSelecao
          v-model="rec.atendimentoId"
          :rotulo="t('particular.cc.atendimento')"
          :opcoes="[
            { valor: 0, rotulo: t('particular.cc.semAtendimento') },
            ...q.data.value.atendimentos.map((a) => ({
              valor: a.id,
              rotulo: t('particular.cc.atendimentoOpcao', {
                numero: a.numero,
                data: a.entradaEm ? data(a.entradaEm) : '',
              }),
            })),
          ]"
          data-testid="cc-atendimento"
        />
        <p v-if="urgencia" class="secundario" data-testid="cc-urgencia">{{ t('particular.cc.urgencia') }}</p>
        <label v-if="rec.tipo === 'caucao' && urgencia">
          <input v-model="rec.declaracaoVoluntaria" type="checkbox" /> {{ t('particular.cc.voluntaria') }}
        </label>
        <ul v-if="Object.keys(errosRec).length" class="secundario" data-testid="cc-erros-receber">
          <li v-for="(m, c) in errosRec" :key="c">{{ m }}</li>
        </ul>
        <button type="submit" :disabled="Object.keys(errosRec).length > 0" data-testid="cc-receber">
          {{ t('particular.cc.receberBotao') }}
        </button>
      </form>

      <h2>{{ t('particular.cc.usarTitulo') }}</h2>
      <p v-if="!q.data.value.contasAbertas.length" class="secundario">
        {{ t('particular.cc.nenhumaConta') }}
      </p>
      <table v-else class="tabela" data-testid="cc-contas">
        <thead>
          <tr>
            <th>{{ t('particular.cc.conta') }}</th>
            <th>{{ t('particular.cc.total') }}</th>
            <th>{{ t('particular.cc.devido') }}</th>
            <th>{{ t('particular.cc.valorUsar') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in q.data.value.contasAbertas" :key="c.id">
            <td>{{ c.numero }}</td>
            <td>{{ moeda(c.total) }}</td>
            <td>{{ moeda(c.devido) }}</td>
            <td>
              <input
                v-model.number="valorUso[c.id]"
                type="number"
                min="0"
                step="0.01"
                :placeholder="moeda(Math.min(c.devido, q.data.value.saldo))"
                :aria-label="t('particular.cc.valorUsarDe', { numero: c.numero })"
              />
            </td>
            <td>
              <button
                type="button"
                :disabled="c.devido <= 0 || q.data.value.saldo <= 0"
                :data-testid="`cc-usar-${c.id}`"
                @click="usar(c.id)"
              >
                {{ t('particular.cc.usar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>{{ t('particular.cc.adiantamentos') }}</h2>
      <table class="tabela" data-testid="cc-adiantamentos">
        <thead>
          <tr>
            <th>{{ t('particular.cc.numero') }}</th>
            <th>{{ t('particular.cc.tipo') }}</th>
            <th>{{ t('particular.cc.recebidoEm') }}</th>
            <th>{{ t('particular.cc.forma') }}</th>
            <th>{{ t('particular.cc.valor') }}</th>
            <th>{{ t('particular.cc.saldoCol') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in q.data.value.adiantamentos" :key="a.id">
            <td>{{ a.numero }}</td>
            <td>
              {{ rotulo(a.tipo) }}
              <span v-if="a.voluntaria" class="secundario">{{ t('particular.cc.voluntario') }}</span>
            </td>
            <td>{{ data(a.recebidoEm) }}</td>
            <td>{{ rotulo(a.forma) }}</td>
            <td>{{ moeda(a.valor) }}</td>
            <td>{{ moeda(a.saldo) }}</td>
            <td>
              <button
                v-if="a.disponivel > 0"
                type="button"
                :data-testid="`cc-devolver-${a.id}`"
                @click="prepararDevolucao(a.id, a.disponivel)"
              >
                {{ t('particular.cc.devolver') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <h3>{{ t('particular.cc.aplicacoes') }}</h3>
      <ul class="secundario" data-testid="cc-aplicacoes">
        <li v-for="x in q.data.value.aplicacoes" :key="x.id">
          {{
            t('particular.cc.naConta', { valor: moeda(x.valor), conta: x.conta, data: data(x.aplicadoEm) })
          }}
          <span v-if="x.estornado">{{
            t('particular.cc.estornado', { motivo: x.motivoEstorno ?? '' })
          }}</span>
          <button v-else type="button" :data-testid="`cc-estornar-${x.id}`" @click="estornar(x.id)">
            {{ t('particular.cc.estornar') }}
          </button>
        </li>
      </ul>

      <template v-if="q.data.value.devolucoesPendentes.length">
        <h3>{{ t('particular.cc.pendentesTitulo') }}</h3>
        <ul data-testid="cc-pendentes">
          <li v-for="p in q.data.value.devolucoesPendentes" :key="p.id" :data-testid="`cc-pendente-${p.id}`">
            {{
              t('particular.cc.pedidoDe', {
                valor: moeda(p.valor),
                favorecido: p.favorecido,
                forma: rotulo(p.forma),
                solicitante: p.solicitante,
                data: data(p.solicitadoEm),
                motivo: p.motivo,
              })
            }}
            <span
              v-if="meuPedido(p.solicitanteId)"
              class="secundario"
              :data-testid="`cc-seu-pedido-${p.id}`"
              >{{ t('particular.cc.seuPedido') }}</span
            >
            <template v-else-if="podeAprovar">
              <label v-if="pedeComprovante(p)">
                {{ t('particular.cc.comprovanteDevolucao') }}
                <input
                  v-model="comprovanteAprovacao[p.id]"
                  maxlength="60"
                  :aria-invalid="faltaComprovante(p)"
                  :aria-describedby="`cc-comprovante-aviso-${p.id}`"
                  :data-testid="`cc-comprovante-${p.id}`"
                />
              </label>
              <small
                v-if="faltaComprovante(p)"
                :id="`cc-comprovante-aviso-${p.id}`"
                class="secundario"
                :data-testid="`cc-comprovante-aviso-${p.id}`"
                >{{ t('particular.cc.comprovanteObrigatorio') }}</small
              >
              <button
                type="button"
                :disabled="faltaComprovante(p)"
                :data-testid="`cc-aprovar-${p.id}`"
                @click="aprovar(p.id)"
              >
                {{ t('particular.cc.aprovar') }}
              </button>
            </template>
            <button
              v-if="podeCancelar"
              type="button"
              :data-testid="`cc-cancelar-pedido-${p.id}`"
              @click="cancelarPedido(p.id)"
            >
              {{ t('particular.cc.cancelarPedido') }}
            </button>
          </li>
        </ul>
      </template>

      <form v-if="dev.adiantamento" class="filtros" data-testid="cc-form-devolver" @submit.prevent="devolver">
        <h3>{{ t('particular.cc.devolucaoTitulo') }}</h3>
        <p v-if="escolhido" class="secundario" data-testid="cc-dev-disponivel">
          {{ t('particular.cc.disponivel', { valor: moeda(escolhido.disponivel) }) }}
        </p>
        <label>
          {{ t('particular.cc.valor') }}
          <input v-model.number="dev.valor" type="number" min="0" step="0.01" data-testid="cc-dev-valor" />
        </label>
        <SanteSelecao
          v-model="dev.forma"
          :rotulo="t('particular.cc.forma')"
          :opcoes="[
            { valor: 'pix' as const, rotulo: rotulo('pix') },
            { valor: 'dinheiro' as const, rotulo: t('particular.cc.dinheiroCaixa') },
            { valor: 'transferencia' as const, rotulo: rotulo('transferencia') },
            { valor: 'cheque' as const, rotulo: rotulo('cheque') },
          ]"
          data-testid="cc-dev-forma"
        />
        <label>
          {{ t('particular.cc.favorecido') }}
          <input v-model="dev.favorecidoNome" maxlength="150" />
        </label>
        <label v-if="dev.forma === 'pix'">
          {{ t('particular.cc.chavePix') }}
          <input v-model="dev.chavePix" maxlength="77" data-testid="cc-dev-chave" />
        </label>
        <label>
          {{ t('particular.cc.motivo') }}
          <input v-model="dev.motivo" maxlength="500" data-testid="cc-dev-motivo" />
        </label>
        <template v-if="devidoAberto > 0">
          <p class="secundario" data-testid="cc-dev-conta-aberta">
            {{ t('particular.cc.contaAberta', { valor: moeda(devidoAberto) }) }}
          </p>
          <label>
            <input v-model="dev.confirmarContaAberta" type="checkbox" data-testid="cc-dev-confirmar" />
            {{ t('particular.cc.confirmarContaAberta') }}
          </label>
        </template>
        <ul v-if="Object.keys(errosDev).length" class="secundario">
          <li v-for="(m, c) in errosDev" :key="c">{{ m }}</li>
        </ul>
        <button type="submit" :disabled="!podeDevolver" data-testid="cc-dev-registrar">
          {{ t('particular.cc.registrarDevolucao') }}
        </button>
        <button type="button" @click="dev.adiantamento = 0">{{ t('particular.cc.cancelar') }}</button>
      </form>

      <h2>{{ t('particular.cc.extrato') }}</h2>
      <table class="tabela" data-testid="cc-extrato">
        <thead>
          <tr>
            <th>{{ t('particular.cc.data') }}</th>
            <th>{{ t('particular.cc.lancamento') }}</th>
            <th>{{ t('particular.cc.referencia') }}</th>
            <th>{{ t('particular.cc.credito') }}</th>
            <th>{{ t('particular.cc.debito') }}</th>
            <th>{{ t('particular.cc.saldoCol') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(l, k) in q.data.value.extrato.linhas" :key="k">
            <td>{{ data(l.data) }}</td>
            <td>{{ rotulo(l.tipo) }}</td>
            <td>{{ l.referencia }}</td>
            <td>{{ l.credito ? moeda(l.credito) : '' }}</td>
            <td>{{ l.debito ? moeda(l.debito) : '' }}</td>
            <td>{{ moeda(l.saldo) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
