<script setup lang="ts">
// Portadores, desconto e cessão de recebíveis (F8, 07-FIN linha 79): `/financeiro/receber/cessao`. Desenho próprio, numa
// tela só: (1) os portadores com a condição vigente, o limite e o quanto já está tomado; o formulário confere na hora
// a conta do portador bancário e o cessionário da cessão; (2) a nova operação: o tipo filtra os portadores que a fazem,
// a taxa vem da condição do portador, as parcelas a receber em aberto se marcam numa lista com o devedor, o vencimento
// e o saldo (a que já está com portador vem travada), e a prévia pela MESMA regra do domínio que o servidor aplica
// (`planejarCessao`) mostra face, deságio, custos, líquido e o limite que sobra; a recusa (desconto sem coobrigação,
// parcela vencida, limite estourado, líquido zerado) aparece antes de gravar e desliga o botão; (3) as operações com
// as parcelas: o desfecho de cada uma (o devedor pagou ao portador, ou o hospital recompra quando há coobrigação) e o
// cancelamento com motivo, que devolve à carteira o que ainda estava com o portador. Nada se apaga.
import { planejarCessao } from '@sgh/dominio-financeiro';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  cancelarOperacao,
  contratarOperacao,
  desfechoItem,
  gravarPortador,
  lerApoiosCessao,
  lerOperacoesCessao,
  lerParcelasCessao,
  lerPortadores,
  type OperacaoCessao,
  type ParcelaReceberCessao,
  type Portador,
  PORTADOR_DA_OPERACAO,
  TIPOS_COM_CONTA,
  TIPOS_PORTADOR,
  type TipoOperacao,
  type TipoPortador,
} from '../api-cessao-recebivel.js';
import { novaChave } from '../api-financeiro.js';
import { data, reais, usarFinanceiro } from '../usar-financeiro.js';

const MOTIVO_MINIMO = 5;
const PERM = {
  portador: 'financeiro.parametro.editar',
  contratar: 'financeiro.cessaoRecebivel.contratar',
  desfecho: 'financeiro.cessaoRecebivel.desfecho',
} as const;
const { t } = useI18n();
const qc = useQueryClient();
const { apoio, tem } = usarFinanceiro();
const hoje = computed(() => apoio.data.value?.hoje ?? '');
const num = (v: number | '' | string) => (v === '' ? 0 : Number(v) || 0);

const apoios = useQuery({ queryKey: ['financeiro', 'cessao', 'apoios'], queryFn: lerApoiosCessao });
const portadores = useQuery({
  queryKey: computed(() => ['financeiro', 'cessao', 'portadores', hoje.value]),
  queryFn: () => lerPortadores(hoje.value || null),
});
const operacoes = useQuery({ queryKey: ['financeiro', 'cessao', 'operacoes'], queryFn: lerOperacoesCessao });

// ── Gravação comum: mensagem do servidor, nova chave e releitura ───────────────────────────────────────────
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('cessao');
async function acao(f: (c: string) => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    mensagem.value = (await f(chave)).mensagem;
    chave = novaChave('cessao');
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    gravando.value = false;
  }
}
const disponivel = (p: Portador) => (p.limiteCredito === null ? null : p.limiteCredito - p.utilizado);

// ── Portador ─────────────────────────────────────────────────────────────────────────────────────────────────
const vazio = () => ({
  id: null as number | null,
  codigo: '',
  descricao: '',
  tipo: 'cobranca_descontada' as TipoPortador,
  conta: '',
  pessoa: '',
  taxa: 0 as number | '',
  prazo: '' as number | '',
  limite: '' as number | '',
  tarifa: '' as number | '',
  vigencia: '',
  ativo: true,
});
const fp = reactive(vazio());
watch(
  hoje,
  (h) => {
    if (h && !fp.vigencia) fp.vigencia = h;
  },
  { immediate: true },
);
const opcoesTipoPortador = computed(() =>
  TIPOS_PORTADOR.map((x) => ({ valor: x, rotulo: t(`financeiro.cessao.tipos.${x}`) })),
);
const opcoesConta = computed(() => [
  { valor: '', rotulo: t('financeiro.cessao.escolhaConta') },
  ...(apoios.data.value?.contas ?? []).map((c) => ({ valor: String(c.id), rotulo: c.rotulo })),
]);
const opcoesPessoa = computed(() => [
  { valor: '', rotulo: t('financeiro.cessao.escolhaPessoa') },
  ...(apoios.data.value?.pessoas ?? []).map((c) => ({ valor: String(c.id), rotulo: c.rotulo })),
]);
// A mesma conferência do servidor, enquanto se preenche.
const faltaPortador = computed(() => {
  if (!fp.codigo.trim()) return t('financeiro.cessao.codigoObrigatorio');
  if (fp.descricao.trim().length < 3) return t('financeiro.cessao.descricaoCurta');
  if (TIPOS_COM_CONTA.includes(fp.tipo) && !fp.conta) return t('financeiro.cessao.contaObrigatoria');
  if (fp.tipo === 'cessao' && !fp.pessoa) return t('financeiro.cessao.pessoaObrigatoria');
  return null;
});
function editar(p: Portador) {
  Object.assign(fp, {
    id: p.portador,
    codigo: p.codigo,
    descricao: p.descricao,
    tipo: p.tipo,
    conta: p.contaBancaria === null ? '' : String(p.contaBancaria),
    pessoa: p.pessoaJuridica === null ? '' : String(p.pessoaJuridica),
    taxa: p.taxaDesconto ?? 0,
    prazo: p.prazoDias ?? '',
    limite: p.limiteCredito ?? '',
    tarifa: p.valorTarifa ?? '',
    vigencia: hoje.value || p.vigenciaInicio || '',
    ativo: p.ativo,
  });
}
function limparPortador() {
  Object.assign(fp, vazio(), { vigencia: hoje.value });
}
async function salvarPortador() {
  if (faltaPortador.value || !tem(PERM.portador)) return;
  const ok = await acao((c) =>
    gravarPortador(
      {
        id: fp.id,
        codigo: fp.codigo.trim(),
        descricao: fp.descricao.trim(),
        tipo: fp.tipo,
        contaBancaria: fp.conta ? Number(fp.conta) : null,
        pessoaJuridica: fp.pessoa ? Number(fp.pessoa) : null,
        taxaDesconto: num(fp.taxa),
        prazoDias: fp.prazo === '' ? null : num(fp.prazo),
        limiteCredito: fp.limite === '' ? null : num(fp.limite),
        valorTarifa: fp.tarifa === '' ? null : num(fp.tarifa),
        vigenciaInicio: fp.vigencia,
        ativo: fp.ativo,
      },
      c,
    ),
  );
  if (ok) limparPortador();
}

// ── Nova operação ────────────────────────────────────────────────────────────────────────────────────────────
const tipoOp = ref<TipoOperacao>('desconto_duplicata');
const opcoesTipoOp = computed(() =>
  (['desconto_duplicata', 'cessao', 'fomento'] as const).map((x) => ({
    valor: x,
    rotulo: t(`financeiro.cessao.tiposOperacao.${x}`),
  })),
);
const portadoresDoTipo = computed(() =>
  (portadores.data.value ?? []).filter((p) => p.ativo && PORTADOR_DA_OPERACAO[tipoOp.value].includes(p.tipo)),
);
const portadorId = ref('');
const opcoesPortador = computed(() => [
  { valor: '', rotulo: t('financeiro.cessao.escolhaPortador') },
  ...portadoresDoTipo.value.map((p) => {
    const d = disponivel(p);
    return {
      valor: String(p.portador),
      rotulo: t('financeiro.cessao.portadorRotulo', {
        codigo: p.codigo,
        descricao: p.descricao,
        taxa: p.taxaDesconto ?? 0,
        disponivel: d === null ? t('financeiro.cessao.semLimite') : reais(d),
      }),
    };
  }),
]);
const portador = computed(
  () => portadoresDoTipo.value.find((p) => String(p.portador) === portadorId.value) ?? null,
);
const comCoobrigacao = ref(true);
const taxaMensal = ref<number | ''>(0);
const valorTarifas = ref<number | ''>(0);
const valorIof = ref<number | ''>(0);
const dataOperacao = ref('');
const numeroContrato = ref('');
const observacaoOp = ref('');
watch(
  hoje,
  (h) => {
    if (h && !dataOperacao.value) dataOperacao.value = h;
  },
  { immediate: true },
);
// O desconto de duplicata é sempre com coobrigação; trocar o tipo limpa o portador que deixou de servir.
watch(tipoOp, (x) => {
  if (x === 'desconto_duplicata') comCoobrigacao.value = true;
  if (!portadoresDoTipo.value.some((p) => String(p.portador) === portadorId.value)) portadorId.value = '';
});
// A taxa vem da condição vigente do portador; o usuário muda se negociou outra.
watch(portador, (p) => {
  if (p) {
    taxaMensal.value = p.taxaDesconto ?? 0;
    valorTarifas.value = p.valorTarifa ?? 0;
  }
});

const busca = ref('');
const buscaAplicada = ref('');
let espera: ReturnType<typeof setTimeout> | undefined;
watch(busca, (b) => {
  clearTimeout(espera);
  espera = setTimeout(() => (buscaAplicada.value = b), 300);
});
const parcelas = useQuery({
  queryKey: computed(() => ['financeiro', 'cessao', 'parcelas', buscaAplicada.value]),
  queryFn: () => lerParcelasCessao(buscaAplicada.value),
});
// As parcelas marcadas sobrevivem à troca da busca: cada parcela vista fica guardada (a leitura mais recente vale),
// e a prévia, o contador e o corpo enviado saem todos da mesma lista `escolhidas`.
const marcadas = ref<number[]>([]);
const vistas = reactive(new Map<number, ParcelaReceberCessao>());
watch(
  () => parcelas.data.value,
  (lista) => {
    for (const p of lista ?? []) vistas.set(p.parcela, p);
  },
  { immediate: true },
);
const escolhidas = computed(() =>
  marcadas.value
    .map((id) => vistas.get(id))
    .filter((p): p is ParcelaReceberCessao => !!p && p.portador === null)
    .sort((a, b) => a.parcela - b.parcela),
);

// A prévia: a mesma regra do domínio que o servidor aplica na gravação.
const plano = computed(() => {
  const p = portador.value;
  if (!p || !escolhidas.value.length || !dataOperacao.value) return null;
  return planejarCessao({
    tipo: tipoOp.value,
    comCoobrigacao: comCoobrigacao.value,
    dataOperacao: dataOperacao.value,
    taxaMensal: num(taxaMensal.value),
    valorTarifas: num(valorTarifas.value),
    valorIof: num(valorIof.value),
    parcelas: escolhidas.value.map((x) => ({
      parcela: x.parcela,
      situacao: x.situacao,
      saldo: x.saldo,
      vencimento: x.vencimento,
      jaCedida: x.portador !== null,
    })),
    limitePortador: p.limiteCredito,
    utilizadoPortador: p.utilizado,
  });
});
const recusaPrevia = computed(() => (plano.value && 'codigo' in plano.value ? plano.value : null));
const previa = computed(() => (plano.value && 'valorLiquido' in plano.value ? plano.value : null));
const podeContratar = computed(() => !gravando.value && !!previa.value && tem(PERM.contratar));
async function contratar() {
  const p = portador.value;
  if (!podeContratar.value || !p) return;
  const nc = numeroContrato.value.trim();
  const obs = observacaoOp.value.trim();
  const ok = await acao((c) =>
    contratarOperacao(
      {
        portador: p.portador,
        tipo: tipoOp.value,
        comCoobrigacao: comCoobrigacao.value,
        dataOperacao: dataOperacao.value,
        taxaMensal: num(taxaMensal.value),
        valorTarifas: num(valorTarifas.value),
        valorIof: num(valorIof.value),
        ...(nc ? { numeroContrato: nc } : {}),
        parcelas: escolhidas.value.map((x) => x.parcela),
        ...(obs ? { observacao: obs } : {}),
      },
      c,
    ),
  );
  if (ok) {
    marcadas.value = [];
    numeroContrato.value = '';
    observacaoOp.value = '';
    valorIof.value = 0;
  }
}

// ── Desfecho e cancelamento ──────────────────────────────────────────────────────────────────────────────────
const dataDesfecho = ref('');
watch(
  hoje,
  (h) => {
    if (h && !dataDesfecho.value) dataDesfecho.value = h;
  },
  { immediate: true },
);
const recompra = reactive<Record<number, number | ''>>({});
const valorRecompra = (item: number, face: number) => (item in recompra ? num(recompra[item] ?? '') : face);
function liquidar(item: number) {
  void acao((c) => desfechoItem(item, 'liquidar', dataDesfecho.value, null, c));
}
function recomprar(item: number, face: number) {
  void acao((c) => desfechoItem(item, 'recomprar', dataDesfecho.value, valorRecompra(item, face), c));
}
const aberta = ref<OperacaoCessao | null>(null);
const motivo = ref('');
const faltamMotivo = computed(() => Math.max(0, MOTIVO_MINIMO - motivo.value.trim().length));
function abrir(o: OperacaoCessao) {
  aberta.value = o;
  motivo.value = '';
}
async function confirmarCancelamento() {
  const o = aberta.value;
  if (!o || faltamMotivo.value > 0) return;
  if (await acao((c) => cancelarOperacao(o.operacao, motivo.value.trim(), c))) aberta.value = null;
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ces-titulo" data-testid="tela-fin-cessao">
    <h1 id="ces-titulo">{{ t('financeiro.cessao.titulo') }}</h1>
    <p>{{ t('financeiro.cessao.texto') }}</p>
    <MensagemFaturamento :texto="mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <ErroFaturamento v-if="apoios.error.value" :erro="apoios.error.value" />

    <h2>{{ t('financeiro.cessao.portadores') }}</h2>
    <ErroFaturamento v-if="portadores.error.value" :erro="portadores.error.value" />
    <table v-else-if="portadores.data.value?.length" class="tabela" data-testid="ces-portadores">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.cessao.codigo') }}</th>
          <th scope="col">{{ t('financeiro.cessao.descricao') }}</th>
          <th scope="col">{{ t('financeiro.cessao.tipo') }}</th>
          <th scope="col">{{ t('financeiro.cessao.taxa') }}</th>
          <th scope="col">{{ t('financeiro.cessao.limite') }}</th>
          <th scope="col">{{ t('financeiro.cessao.utilizado') }}</th>
          <th scope="col">{{ t('financeiro.cessao.disponivel') }}</th>
          <th scope="col">{{ t('financeiro.cessao.ativo') }}</th>
          <th scope="col">{{ t('financeiro.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in portadores.data.value" :key="p.portador" :data-testid="`ces-portador-${p.codigo}`">
          <td>{{ p.codigo }}</td>
          <td>{{ p.descricao }}</td>
          <td>{{ t(`financeiro.cessao.tipos.${p.tipo}`) }}</td>
          <td>{{ p.taxaDesconto ?? '—' }}</td>
          <td>{{ p.limiteCredito === null ? t('financeiro.cessao.semLimite') : reais(p.limiteCredito) }}</td>
          <td>{{ reais(p.utilizado) }}</td>
          <td :data-testid="`ces-disponivel-${p.codigo}`">
            {{ disponivel(p) === null ? t('financeiro.cessao.semLimite') : reais(disponivel(p) ?? 0) }}
          </td>
          <td>{{ p.ativo ? t('financeiro.sim') : t('financeiro.nao') }}</td>
          <td>
            <button
              type="button"
              :disabled="!tem(PERM.portador)"
              :data-testid="`ces-editar-${p.codigo}`"
              @click="editar(p)"
            >
              {{ t('financeiro.cessao.editar') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="portadores.data.value">{{ t('financeiro.nenhum') }}</p>

    <form
      v-if="tem(PERM.portador)"
      class="formulario"
      data-testid="ces-form-portador"
      @submit.prevent="salvarPortador"
    >
      <h3>
        {{
          fp.id
            ? t('financeiro.cessao.editarPortador', { codigo: fp.codigo })
            : t('financeiro.cessao.novoPortador')
        }}
      </h3>
      <span class="campo">
        <label for="ces-codigo">{{ t('financeiro.cessao.codigo') }}</label>
        <input id="ces-codigo" v-model="fp.codigo" maxlength="20" data-testid="ces-codigo" />
      </span>
      <span class="campo">
        <label for="ces-descricao">{{ t('financeiro.cessao.descricao') }}</label>
        <input id="ces-descricao" v-model="fp.descricao" maxlength="100" data-testid="ces-descricao" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="fp.tipo"
          :rotulo="t('financeiro.cessao.tipo')"
          :opcoes="opcoesTipoPortador"
          data-testid="ces-tipo-portador"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="fp.conta"
          :rotulo="t('financeiro.cessao.conta')"
          :opcoes="opcoesConta"
          data-testid="ces-conta"
        />
      </span>
      <span v-if="fp.tipo === 'cessao'" class="campo">
        <SanteSelecao
          v-model="fp.pessoa"
          :rotulo="t('financeiro.cessao.pessoa')"
          :opcoes="opcoesPessoa"
          data-testid="ces-pessoa"
        />
      </span>
      <span class="campo">
        <label for="ces-taxa">{{ t('financeiro.cessao.taxa') }}</label>
        <input
          id="ces-taxa"
          v-model.number="fp.taxa"
          type="number"
          min="0"
          max="100"
          step="0.01"
          data-testid="ces-taxa"
        />
      </span>
      <span class="campo">
        <label for="ces-prazo">{{ t('financeiro.cessao.prazo') }}</label>
        <input id="ces-prazo" v-model.number="fp.prazo" type="number" min="0" data-testid="ces-prazo" />
      </span>
      <span class="campo">
        <label for="ces-limite">{{ t('financeiro.cessao.limite') }}</label>
        <input
          id="ces-limite"
          v-model.number="fp.limite"
          type="number"
          min="0"
          step="0.01"
          data-testid="ces-limite"
        />
      </span>
      <span class="campo">
        <label for="ces-tarifa">{{ t('financeiro.cessao.tarifa') }}</label>
        <input
          id="ces-tarifa"
          v-model.number="fp.tarifa"
          type="number"
          min="0"
          step="0.01"
          data-testid="ces-tarifa"
        />
      </span>
      <span class="campo">
        <label for="ces-vigencia">{{ t('financeiro.cessao.vigencia') }}</label>
        <input id="ces-vigencia" v-model="fp.vigencia" type="date" data-testid="ces-vigencia" />
      </span>
      <span class="campo">
        <label>
          <input v-model="fp.ativo" type="checkbox" data-testid="ces-ativo" />
          {{ t('financeiro.cessao.ativo') }}
        </label>
      </span>
      <p v-if="faltaPortador" role="alert" data-testid="ces-falta-portador">{{ faltaPortador }}</p>
      <button type="submit" :disabled="gravando || !!faltaPortador" data-testid="ces-gravar-portador">
        {{ t('financeiro.cessao.gravarPortador') }}
      </button>
      <button v-if="fp.id" type="button" data-testid="ces-limpar-portador" @click="limparPortador">
        {{ t('financeiro.cessao.limpar') }}
      </button>
    </form>

    <form
      v-if="tem(PERM.contratar)"
      class="formulario"
      :aria-label="t('financeiro.cessao.novaOperacao')"
      data-testid="ces-nova"
      @submit.prevent="contratar"
    >
      <h2>{{ t('financeiro.cessao.novaOperacao') }}</h2>
      <span class="campo">
        <SanteSelecao
          v-model="tipoOp"
          :rotulo="t('financeiro.cessao.tipoOperacao')"
          :opcoes="opcoesTipoOp"
          data-testid="ces-tipo-operacao"
        />
      </span>
      <p v-if="portadores.data.value && !portadoresDoTipo.length" data-testid="ces-sem-portador">
        {{ t('financeiro.cessao.semPortadorDoTipo') }}
      </p>
      <span v-else class="campo">
        <SanteSelecao
          v-model="portadorId"
          :rotulo="t('financeiro.cessao.portador')"
          :opcoes="opcoesPortador"
          data-testid="ces-portador"
        />
      </span>
      <span class="campo">
        <label>
          <input
            v-model="comCoobrigacao"
            type="checkbox"
            :disabled="tipoOp === 'desconto_duplicata'"
            data-testid="ces-coobrigacao"
          />
          {{ t('financeiro.cessao.coobrigacao') }}
        </label>
        <small v-if="tipoOp === 'desconto_duplicata'">{{ t('financeiro.cessao.coobrigacaoDesconto') }}</small>
      </span>
      <span class="campo">
        <label for="ces-data">{{ t('financeiro.cessao.dataOperacao') }}</label>
        <input id="ces-data" v-model="dataOperacao" type="date" data-testid="ces-data" />
      </span>
      <span class="campo">
        <label for="ces-taxa-op">{{ t('financeiro.cessao.taxaMensal') }}</label>
        <input
          id="ces-taxa-op"
          v-model.number="taxaMensal"
          type="number"
          min="0"
          max="100"
          step="0.01"
          data-testid="ces-taxa-op"
        />
      </span>
      <span class="campo">
        <label for="ces-tarifas">{{ t('financeiro.cessao.tarifas') }}</label>
        <input
          id="ces-tarifas"
          v-model.number="valorTarifas"
          type="number"
          min="0"
          step="0.01"
          data-testid="ces-tarifas"
        />
      </span>
      <span class="campo">
        <label for="ces-iof">{{ t('financeiro.cessao.iof') }}</label>
        <input
          id="ces-iof"
          v-model.number="valorIof"
          type="number"
          min="0"
          step="0.01"
          data-testid="ces-iof"
        />
      </span>
      <span class="campo">
        <label for="ces-contrato">{{ t('financeiro.cessao.numeroContrato') }}</label>
        <input id="ces-contrato" v-model="numeroContrato" maxlength="40" data-testid="ces-contrato" />
      </span>
      <span class="campo">
        <label for="ces-observacao">{{ t('financeiro.cessao.observacao') }}</label>
        <input id="ces-observacao" v-model="observacaoOp" maxlength="2000" data-testid="ces-observacao" />
      </span>

      <h3>{{ t('financeiro.cessao.parcelas') }}</h3>
      <span class="campo">
        <label for="ces-busca">{{ t('financeiro.cessao.busca') }}</label>
        <input id="ces-busca" v-model="busca" maxlength="60" data-testid="ces-busca" />
      </span>
      <ErroFaturamento v-if="parcelas.error.value" :erro="parcelas.error.value" />
      <p v-else-if="parcelas.data.value && !parcelas.data.value.length" data-testid="ces-sem-parcela">
        {{ t('financeiro.cessao.semParcela') }}
      </p>
      <table v-else-if="parcelas.data.value" class="tabela" data-testid="ces-parcelas">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.cessao.marcarColuna') }}</th>
            <th scope="col">{{ t('financeiro.cessao.devedor') }}</th>
            <th scope="col">{{ t('financeiro.cessao.documento') }}</th>
            <th scope="col">{{ t('financeiro.cessao.vencimento') }}</th>
            <th scope="col">{{ t('financeiro.cessao.saldo') }}</th>
            <th scope="col">{{ t('financeiro.cessao.portador') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in parcelas.data.value" :key="p.parcela" :data-testid="`ces-parcela-${p.parcela}`">
            <td>
              <input
                v-model="marcadas"
                type="checkbox"
                :value="p.parcela"
                :disabled="p.portador !== null"
                :aria-label="t('financeiro.cessao.marcar', { sequencia: p.sequencia, numero: p.numero })"
                :data-testid="`ces-marcar-${p.parcela}`"
              />
            </td>
            <td>{{ p.contraparte ?? '—' }}</td>
            <td>{{ p.numero }}{{ p.documento ? ` · ${p.documento}` : '' }} / {{ p.sequencia }}</td>
            <td>{{ data(p.vencimento) }}</td>
            <td>{{ reais(p.saldo) }}</td>
            <td>{{ p.portador ? t('financeiro.cessao.comPortador', { portador: p.portador }) : '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p data-testid="ces-marcadas">{{ t('financeiro.cessao.marcadas', { n: escolhidas.length }) }}</p>

      <p class="resumo" aria-live="polite" data-testid="ces-previa">
        <span v-if="recusaPrevia" role="alert" data-testid="ces-recusa-previa">{{
          recusaPrevia.mensagem
        }}</span>
        <span v-else-if="previa && portador" data-testid="ces-previa-texto">
          {{
            t('financeiro.cessao.previa', {
              face: reais(previa.valorFace),
              desagio: reais(previa.valorDesagio),
              custos: reais(num(valorTarifas) + num(valorIof)),
              liquido: reais(previa.valorLiquido),
              disponivelDepois:
                portador.limiteCredito === null
                  ? t('financeiro.cessao.semLimite')
                  : reais(portador.limiteCredito - portador.utilizado - previa.valorFace),
            })
          }}
        </span>
      </p>
      <button type="submit" :disabled="!podeContratar" data-testid="ces-contratar">
        {{ t('financeiro.cessao.contratar') }}
      </button>
    </form>

    <h2>{{ t('financeiro.cessao.operacoes') }}</h2>
    <span v-if="tem(PERM.desfecho)" class="campo">
      <label for="ces-data-desfecho">{{ t('financeiro.cessao.dataDesfecho') }}</label>
      <input id="ces-data-desfecho" v-model="dataDesfecho" type="date" data-testid="ces-data-desfecho" />
    </span>
    <ErroFaturamento v-if="operacoes.error.value" :erro="operacoes.error.value" />
    <template v-else-if="operacoes.data.value?.length">
      <article
        v-for="o in operacoes.data.value"
        :key="o.operacao"
        class="formulario"
        :data-testid="`ces-operacao-${o.numero}`"
      >
        <h3>
          {{ o.numero }} · {{ t(`financeiro.cessao.tiposOperacao.${o.tipo}`) }} · {{ o.portador ?? '—' }} ·
          {{ data(o.dataOperacao) }} ·
          {{
            o.comCoobrigacao ? t('financeiro.cessao.comCoobrigacao') : t('financeiro.cessao.semCoobrigacao')
          }}
        </h3>
        <p :data-testid="`ces-operacao-valores-${o.numero}`">
          {{ t('financeiro.cessao.face') }} {{ reais(o.valorFace) }} · {{ t('financeiro.cessao.desagio') }}
          {{ reais(o.valorDesagio) }} · {{ t('financeiro.cessao.liquido') }} {{ reais(o.valorLiquido) }} ·
          <strong :data-testid="`ces-operacao-situacao-${o.numero}`">{{
            t(`financeiro.cessao.situacoesOperacao.${o.situacao}`)
          }}</strong>
        </p>
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('financeiro.cessao.documento') }}</th>
              <th scope="col">{{ t('financeiro.cessao.vencimento') }}</th>
              <th scope="col">{{ t('financeiro.cessao.face') }}</th>
              <th scope="col">{{ t('financeiro.cessao.desagio') }}</th>
              <th scope="col">{{ t('financeiro.situacao') }}</th>
              <th scope="col">{{ t('financeiro.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in o.itens" :key="i.item" :data-testid="`ces-item-${i.item}`">
              <td>{{ i.documento }}</td>
              <td>{{ data(i.vencimento) }}</td>
              <td>{{ reais(i.valorFace) }}</td>
              <td>{{ reais(i.valorDesagio) }}</td>
              <td :data-testid="`ces-item-situacao-${i.item}`">
                {{ t(`financeiro.cessao.situacoesItem.${i.situacao}`) }}
              </td>
              <td>
                <template v-if="o.situacao === 'contratada' && i.situacao === 'cedida' && tem(PERM.desfecho)">
                  <button
                    type="button"
                    :disabled="gravando"
                    :data-testid="`ces-liquidar-${i.item}`"
                    @click="liquidar(i.item)"
                  >
                    {{ t('financeiro.cessao.liquidar') }}
                  </button>
                  <template v-if="o.comCoobrigacao">
                    <input
                      v-model.number="recompra[i.item]"
                      type="number"
                      min="0"
                      step="0.01"
                      :placeholder="String(i.valorFace)"
                      :aria-label="t('financeiro.cessao.valorRecompra', { documento: i.documento })"
                      :data-testid="`ces-valor-recompra-${i.item}`"
                    />
                    <button
                      type="button"
                      :disabled="gravando"
                      :data-testid="`ces-recomprar-${i.item}`"
                      @click="recomprar(i.item, i.valorFace)"
                    >
                      {{ t('financeiro.cessao.recomprar') }}
                    </button>
                  </template>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <button
          v-if="o.situacao === 'contratada' && tem(PERM.desfecho)"
          type="button"
          :disabled="gravando"
          :data-testid="`ces-cancelar-${o.numero}`"
          @click="abrir(o)"
        >
          {{ t('financeiro.cessao.cancelarOperacao') }}
        </button>
      </article>
    </template>
    <p v-else-if="operacoes.data.value">{{ t('financeiro.nenhum') }}</p>

    <form
      v-if="aberta"
      class="formulario"
      data-testid="ces-cancelamento"
      @submit.prevent="confirmarCancelamento"
    >
      <h2>
        {{ t('financeiro.cessao.cancelarCom', { numero: aberta.numero, portador: aberta.portador ?? '—' }) }}
      </h2>
      <p>{{ t('financeiro.cessao.devolve') }}</p>
      <span class="campo">
        <label for="ces-motivo">{{ t('financeiro.cessao.motivo') }}</label>
        <textarea
          id="ces-motivo"
          v-model="motivo"
          maxlength="500"
          :aria-invalid="faltamMotivo > 0"
          aria-describedby="ces-motivo-falta"
          data-testid="ces-motivo"
        ></textarea>
        <small v-if="faltamMotivo > 0" id="ces-motivo-falta">
          {{ t('financeiro.cessao.motivoFalta', { n: faltamMotivo }) }}
        </small>
      </span>
      <button type="submit" :disabled="gravando || faltamMotivo > 0" data-testid="ces-confirmar-cancelamento">
        {{ t('financeiro.cessao.confirmarCancelar') }}
      </button>
      <button type="button" @click="aberta = null">{{ t('financeiro.cancelar') }}</button>
    </form>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
