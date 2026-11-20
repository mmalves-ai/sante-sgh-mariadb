<script setup lang="ts">
// Cobranças da operadora (M56, etapa 3, F2): a lista da mais nova para a mais antiga com os filtros (competência,
// situação, tipo, número do contrato, só as vencidas), as contagens, e a ficha com os itens (o preço da faixa e o valor
// reajustado; o evento da coparticipação), o pagamento, o acordo e a notificação. Na ficha, registrar o pagamento (o
// devido na data com a multa e os juros, ou a dispensa com o motivo), cancelar e estornar. O documento do pagador sai
// mascarado; a lista e a ficha são leituras auditadas.
import type { CobrancaDetalhe, CobrancaResumo, TelaCobranca } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  baixarCobranca,
  cancelarCobranca,
  estornarCobranca,
  lerCobranca,
  lerCobrancas,
} from '../../api-cobranca.js';
import ErroOperadora from '../f1/ErroOperadora.vue';
import { brl, competenciaBr, dataBr, devidoDaBaixa, numeroDe, reais, valorDoCampo } from './comum.js';

const props = defineProps<{ tela: TelaCobranca; operadora: number }>();
const emit = defineEmits<{ mudou: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();

const competencia = ref('');
const situacao = ref<string | null>(null);
const tipo = ref<number | null>(null);
const busca = ref('');
const vencidas = ref(false);
const filtro = ref<{
  competencia: string | null;
  situacao: string | null;
  tipo: number | null;
  busca: string | null;
  vencidas: boolean;
}>({
  competencia: null,
  situacao: null,
  tipo: null,
  busca: null,
  vencidas: false,
});
const pagina = ref<number[]>([]);
const apos = computed(() => pagina.value.at(-1) ?? null);
const q = useQuery({
  queryKey: computed(() => ['operadora', 'cobrancas', props.operadora, filtro.value, apos.value]),
  queryFn: () => lerCobrancas({ operadora: props.operadora, ...filtro.value, apos: apos.value }),
});

const opcoesSituacao = computed(() => [
  { valor: null, rotulo: t('operadoraCobranca.filtro.todas') },
  ...(['aberta', 'paga', 'cancelada', 'renegociada'] as const).map((s) => ({
    valor: s,
    rotulo: t(`operadoraCobranca.situacoes.${s}`),
  })),
]);
const opcoesTipo = computed(() => [
  { valor: null, rotulo: t('operadoraCobranca.filtro.todos') },
  ...[1, 2, 3, 4].map((n) => ({ valor: n, rotulo: t(`operadoraCobranca.tipos.${n}`) })),
]);

function filtrar(): void {
  filtro.value = {
    competencia: competencia.value.trim() || null,
    situacao: situacao.value,
    tipo: tipo.value,
    busca: busca.value.trim() || null,
    vencidas: vencidas.value,
  };
  pagina.value = [];
}

// ── Ficha ────────────────────────────────────────────────────────────────────────────────────────────────────
const ficha = ref<CobrancaDetalhe | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
const acao = ref<'baixa' | 'cancelar' | 'estornar' | null>(null);
const pagoEm = ref<string | null>(null);
const valorPago = ref('');
const dispensar = ref(false);
const motivoDispensa = ref('');
const motivo = ref('');

async function abrir(c: CobrancaResumo | number): Promise<void> {
  erro.value = null;
  acao.value = null;
  try {
    ficha.value = await lerCobranca(typeof c === 'number' ? c : c.id);
  } catch (e) {
    erro.value = e;
  }
}

/** O devido na data escolhida (a multa e os juros daquela data, ou só o valor com a dispensa; a regra do servidor). */
const baixa = computed(() => {
  const f = ficha.value;
  if (!f) return null;
  return devidoDaBaixa(f.valor, f.vencimento, pagoEm.value, dispensar.value);
});

function iniciar(a: 'baixa' | 'cancelar' | 'estornar'): void {
  acao.value = a;
  erro.value = null;
  mensagem.value = null;
  pagoEm.value = props.tela.hoje || null;
  dispensar.value = false;
  valorPago.value = baixa.value ? valorDoCampo(baixa.value.devido) : '';
  motivoDispensa.value = '';
  motivo.value = '';
}

// Mudou a data do pagamento ou a dispensa: o campo do valor pago volta ao devido daquela data.
watch([pagoEm, dispensar], () => {
  if (acao.value === 'baixa' && baixa.value) valorPago.value = valorDoCampo(baixa.value.devido);
});

async function executar(): Promise<void> {
  const f = ficha.value;
  if (!f || !acao.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const r =
      acao.value === 'baixa'
        ? await baixarCobranca(f.id, {
            versao: f.versao,
            pagoEm: pagoEm.value,
            valorPago: numeroDe(valorPago.value),
            dispensarEncargos: dispensar.value,
            motivoDispensa: dispensar.value ? motivoDispensa.value || null : null,
          })
        : acao.value === 'cancelar'
          ? await cancelarCobranca(f.id, { versao: f.versao, motivo: motivo.value })
          : await estornarCobranca(f.id, { versao: f.versao, motivo: motivo.value });
    mensagem.value = [r.mensagem, ...r.avisos].join(' ');
    acao.value = null;
    await cliente.invalidateQueries({ queryKey: ['operadora', 'cobrancas'] });
    await abrir(f.id);
    emit('mudou');
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="ope-cobrancas-titulo" data-testid="operadora-cobrancas">
    <h2 id="ope-cobrancas-titulo">{{ t('operadoraCobranca.abas.cobrancas') }}</h2>
    <dl v-if="q.data.value" class="campos" data-testid="cobranca-totais">
      <div>
        <dt>{{ t('operadoraCobranca.totais.abertas') }}</dt>
        <dd>{{ q.data.value.totais.abertas }} · {{ brl(q.data.value.totais.valorAberto) }}</dd>
      </div>
      <div>
        <dt>{{ t('operadoraCobranca.totais.vencidas') }}</dt>
        <dd data-testid="total-vencidas">
          {{ q.data.value.totais.vencidas }} · {{ brl(q.data.value.totais.valorVencido) }}
        </dd>
      </div>
      <div>
        <dt>{{ t('operadoraCobranca.totais.pagasNoMes') }}</dt>
        <dd>{{ q.data.value.totais.pagasNoMes }} · {{ brl(q.data.value.totais.valorPagoNoMes) }}</dd>
      </div>
    </dl>
    <form class="campos" role="search" @submit.prevent="filtrar">
      <SanteCampoTexto
        v-model="competencia"
        :rotulo="t('operadoraCobranca.filtro.competencia')"
        :max-bytes="7"
      />
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('operadoraCobranca.filtro.situacao')"
        :opcoes="opcoesSituacao"
        data-testid="filtro-situacao"
      />
      <SanteSelecao
        v-model="tipo"
        :rotulo="t('operadoraCobranca.filtro.tipo')"
        :opcoes="opcoesTipo"
        data-testid="filtro-tipo"
      />
      <SanteCampoTexto v-model="busca" :rotulo="t('operadoraCobranca.filtro.contrato')" :max-bytes="20" />
      <label class="acoes">
        <input v-model="vencidas" type="checkbox" data-testid="filtro-vencidas" />
        <span>{{ t('operadoraCobranca.filtro.vencidas') }}</span>
      </label>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('operadoraCobranca.filtro.buscar')"
          variante="secundario"
          tipo="submit"
          data-testid="cobranca-buscar"
        />
      </div>
    </form>
    <ErroOperadora v-if="q.isError.value" :erro="q.error.value" />
    <table v-else-if="q.data.value?.itens.length" class="tabela" data-testid="tabela-cobrancas">
      <thead>
        <tr>
          <th scope="col">{{ t('operadoraCobranca.colunas.contrato') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.pagador') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.tipo') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.competencia') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.vencimento') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.valor') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.situacao') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.encargos') }}</th>
          <th scope="col">{{ t('operadoraCobranca.colunas.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="c in q.data.value.itens"
          :key="c.id"
          :data-testid="`cobranca-${c.id}`"
          :data-situacao="c.situacao"
        >
          <th scope="row">{{ c.contratoNumero }}</th>
          <td>
            {{ c.pagadorNome }}<br /><span class="secundario">{{ c.pagadorDocumento }}</span>
          </td>
          <td>{{ t(`operadoraCobranca.tipos.${c.tipo}`) }}</td>
          <td>{{ competenciaBr(c.competencia) }}</td>
          <td>
            {{ dataBr(c.vencimento) }}
            <span v-if="c.vencida" class="secundario"
              >· {{ t('operadoraCobranca.dias', { n: c.diasAtraso }) }}</span
            >
          </td>
          <td>{{ brl(c.valor) }}</td>
          <td>{{ t(`operadoraCobranca.situacoes.${c.situacao}`) }}</td>
          <td>{{ c.encargosHoje.total > 0 ? `${brl(c.encargosHoje.total)}` : '—' }}</td>
          <td>
            <SanteBotao :rotulo="t('operadoraCobranca.acoes.abrir')" variante="texto" @acionar="abrir(c)" />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="q.data.value">{{ t('operadoraCobranca.nenhum') }}</p>
    <div class="acoes">
      <SanteBotao
        v-if="pagina.length"
        :rotulo="t('operadoraCobranca.paginas.primeira')"
        variante="texto"
        @acionar="pagina = []"
      />
      <SanteBotao
        v-if="q.data.value?.proxima"
        :rotulo="t('operadoraCobranca.paginas.proxima')"
        variante="texto"
        @acionar="pagina = [...pagina, q.data.value!.proxima!]"
      />
    </div>
    <p v-if="mensagem" role="status" data-testid="mensagem-cobranca">{{ mensagem }}</p>
    <ErroOperadora v-if="erro" :erro="erro" />

    <section
      v-if="ficha"
      class="bloco"
      aria-labelledby="ope-cobranca-ficha"
      data-testid="ficha-cobranca"
      :data-situacao="ficha.situacao"
    >
      <h2 id="ope-cobranca-ficha">
        {{ t('operadoraCobranca.ficha.titulo') }} {{ ficha.contratoNumero }} ·
        {{ t(`operadoraCobranca.tipos.${ficha.tipo}`) }}
        {{ competenciaBr(ficha.competencia) }}
      </h2>
      <p>
        {{ ficha.descricao }} · {{ ficha.pagadorNome }} ({{ ficha.pagadorDocumento }}) ·
        {{ brl(ficha.valor) }} · {{ dataBr(ficha.vencimento) }} ·
        <strong data-testid="ficha-cobranca-situacao">{{
          t(`operadoraCobranca.situacoes.${ficha.situacao}`)
        }}</strong>
      </p>
      <p class="secundario">
        {{ t('operadoraCobranca.ficha.emitida', { por: ficha.criadoPor, em: dataBr(ficha.criadoEm) }) }}
      </p>
      <p v-if="ficha.pagoEm" data-testid="ficha-pagamento">
        {{
          t('operadoraCobranca.ficha.pagamento', {
            data: dataBr(ficha.pagoEm),
            valor: reais(ficha.valorPago),
            multa: reais(ficha.multa),
            juros: reais(ficha.juros),
          })
        }}
      </p>
      <p v-if="ficha.dispensaMotivo">
        {{ t('operadoraCobranca.ficha.dispensa', { motivo: ficha.dispensaMotivo }) }}
      </p>
      <p v-if="ficha.motivo">{{ t('operadoraCobranca.ficha.motivo', { motivo: ficha.motivo }) }}</p>
      <p v-if="ficha.acordoDestino">
        {{ t('operadoraCobranca.ficha.acordoDestino', { acordo: ficha.acordoDestino }) }}
      </p>
      <p v-if="ficha.acordoOrigem">
        {{
          t('operadoraCobranca.ficha.parcela', {
            parcela: ficha.parcela,
            parcelas: ficha.parcelas,
            acordo: ficha.acordoOrigem,
          })
        }}
      </p>
      <p v-if="ficha.notificadoEm && ficha.notificacaoMeio">
        {{
          t('operadoraCobranca.ficha.notificacao', {
            data: dataBr(ficha.notificadoEm),
            meio: t(`operadoraCobranca.inadimplencia.meios.${ficha.notificacaoMeio}`),
            referencia: ficha.notificacaoReferencia ?? '',
          })
        }}
      </p>
      <table class="tabela" data-testid="tabela-itens-cobranca">
        <caption>
          {{
            t('operadoraCobranca.ficha.itens')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('operadoraCobranca.colunas.beneficiario') }}</th>
            <th scope="col">{{ t('operadoraCobranca.colunas.descricao') }}</th>
            <th scope="col">{{ t('operadoraCobranca.colunas.idade') }}</th>
            <th scope="col">{{ t('operadoraCobranca.colunas.valorBase') }}</th>
            <th scope="col">{{ t('operadoraCobranca.colunas.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(i, n) in ficha.itens" :key="n">
            <th scope="row">{{ i.beneficiarioNome ?? '—' }}</th>
            <td>{{ i.descricao }}</td>
            <td>{{ i.idade ?? '—' }}</td>
            <td>{{ i.valorBase !== null ? `${brl(i.valorBase)}` : '—' }}</td>
            <td>{{ brl(i.valor) }}</td>
          </tr>
        </tbody>
      </table>
      <table v-if="ficha.renegociadas.length" class="tabela" data-testid="tabela-renegociadas">
        <caption>
          {{
            t('operadoraCobranca.ficha.renegociadas')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('operadoraCobranca.colunas.tipo') }}</th>
            <th scope="col">{{ t('operadoraCobranca.colunas.competencia') }}</th>
            <th scope="col">{{ t('operadoraCobranca.colunas.vencimento') }}</th>
            <th scope="col">{{ t('operadoraCobranca.colunas.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in ficha.renegociadas" :key="r.id">
            <th scope="row">{{ t(`operadoraCobranca.tipos.${r.tipo}`) }}</th>
            <td>{{ competenciaBr(r.competencia) }}</td>
            <td>{{ dataBr(r.vencimento) }}</td>
            <td>{{ brl(r.valor) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="tela.acoes.gerar && !acao" class="acoes">
        <SanteBotao
          v-if="ficha.situacao === 'aberta'"
          :rotulo="t('operadoraCobranca.acoes.baixar')"
          variante="primario"
          data-testid="cobranca-baixar"
          @acionar="iniciar('baixa')"
        />
        <SanteBotao
          v-if="ficha.situacao === 'aberta'"
          :rotulo="t('operadoraCobranca.acoes.cancelar')"
          variante="secundario"
          data-testid="cobranca-cancelar"
          @acionar="iniciar('cancelar')"
        />
        <SanteBotao
          v-if="ficha.situacao === 'paga'"
          :rotulo="t('operadoraCobranca.acoes.estornar')"
          variante="secundario"
          data-testid="cobranca-estornar"
          @acionar="iniciar('estornar')"
        />
        <SanteBotao :rotulo="t('operadoraCobranca.acoes.fechar')" variante="texto" @acionar="ficha = null" />
      </div>
      <form v-if="acao === 'baixa'" class="campos" data-testid="form-baixa" @submit.prevent="executar">
        <SanteData v-model="pagoEm" :rotulo="t('operadoraCobranca.baixa.pagoEm')" editavel />
        <SanteCampoTexto
          v-model="valorPago"
          :rotulo="t('operadoraCobranca.baixa.valorPago')"
          :max-bytes="15"
          obrigatorio
        />
        <p v-if="baixa && baixa.calculados.total > 0" data-testid="baixa-devido">
          {{
            dispensar
              ? t('operadoraCobranca.baixa.devidoDispensado', { valor: reais(baixa.devido) })
              : t('operadoraCobranca.baixa.devido', {
                  valor: reais(baixa.devido),
                  multa: reais(baixa.multa),
                  juros: reais(baixa.juros),
                })
          }}
        </p>
        <label class="acoes">
          <input v-model="dispensar" type="checkbox" data-testid="baixa-dispensar" />
          <span>{{ t('operadoraCobranca.baixa.dispensar') }}</span>
        </label>
        <SanteCampoTexto
          v-if="dispensar"
          v-model="motivoDispensa"
          :rotulo="t('operadoraCobranca.baixa.motivoDispensa')"
          :max-bytes="200"
        />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('operadoraCobranca.acoes.gravar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="baixa-gravar"
          />
          <SanteBotao :rotulo="t('operadoraCobranca.acoes.voltar')" variante="texto" @acionar="acao = null" />
        </div>
      </form>
      <form
        v-if="acao === 'cancelar' || acao === 'estornar'"
        class="campos"
        data-testid="form-motivo-cobranca"
        @submit.prevent
      >
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t('operadoraCobranca.motivo')"
          :max-bytes="200"
          obrigatorio
        />
        <div class="acoes">
          <SanteBotao
            :rotulo="
              acao === 'cancelar'
                ? t('operadoraCobranca.acoes.cancelar')
                : t('operadoraCobranca.acoes.estornar')
            "
            variante="destrutivo"
            :confirmacao="
              acao === 'cancelar'
                ? t('operadoraCobranca.acoes.confirmarCancelar')
                : t('operadoraCobranca.acoes.confirmarEstornar')
            "
            :desabilitado="ocupado"
            data-testid="motivo-confirmar"
            @acionar="executar"
          />
          <SanteBotao :rotulo="t('operadoraCobranca.acoes.voltar')" variante="texto" @acionar="acao = null" />
        </div>
      </form>
      <SanteAlerta v-if="!tela.acoes.gerar" :texto="t('operadoraCobranca.soConsulta')" variante="info" />
    </section>
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
