<script setup lang="ts">
// Tesouraria das cobranças do portal do paciente (W0-10; linha 'Financeiro' da matriz: depois da baixa, só estorno;
// quem concilia não é quem cobra). A fila do período (os pagamentos confirmados pelo gateway e os pagos em dobro), com
// a situação na tesouraria e o histórico de cada um. "Conciliar" registra a baixa (o valor do extrato confere) ou a
// divergência com motivo; "Estornar" devolve pelo gateway com motivo e a senha de novo (operação crítica). Cada ação
// passa por um painel de confirmação. Os atos são fatos novos: nada se altera nem se apaga. O item do menu fica com o
// W4-01; a tela é /tesouraria/portal.
import type { AcaoTesourariaPortal, PagamentoTesourariaPortal } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import ErroPortal from '../componentes/ErroPortal.vue';
import { conciliarPagamentoPortal, estornarPagamentoPortal, tesourariaPortal } from '../api-portal-agenda.js';

const { t } = useI18n();
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hoje = new Date();
const de = ref(iso(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 7)));
const ate = ref(iso(hoje));
const filtro = ref('todas');
const consulta = useQuery({
  queryKey: computed(() => ['tesouraria-portal', de.value, ate.value]),
  queryFn: () => tesourariaPortal(de.value, ate.value),
});
const itens = computed(() =>
  (consulta.data.value?.itens ?? []).filter((i) => filtro.value === 'todas' || i.situacao === filtro.value),
);
const opcoesFiltro = computed(() =>
  (['todas', 'a-conciliar', 'divergente', 'conciliado', 'estornado'] as const).map((v) => ({
    valor: v,
    rotulo: t(`portal.interno.tesouraria.situacoes.${v}`),
  })),
);
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const quando = (d: string | null) =>
  d ? `${d.slice(0, 10).split('-').reverse().join('/')} ${d.slice(11, 16)}` : '—';
const total = computed(() => itens.value.reduce((s, i) => s + i.valor, 0));
const podeEstornar = computed(() => pode('portal.pagamento.estornar'));
/** A recusa da tesouraria (situação, valor ou segregação de funções) com o texto da tela; o resto vai ao ErroPortal. */
const recusa = computed(() => {
  const x = erro.value;
  if (!(x instanceof ErroApi)) return null;
  const c = (x.problema as { codigo?: unknown } | null)?.codigo;
  return c === 'situacao' || c === 'valor' || c === 'segregacao' ? c : null;
});

const aberto = ref<PagamentoTesourariaPortal | null>(null);
const acao = ref<AcaoTesourariaPortal | null>(null);
const valor = ref('');
const referencia = ref('');
const motivo = ref('');
const senha = ref('');
const confirmando = ref(false);
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);

function iniciar(p: PagamentoTesourariaPortal, a: AcaoTesourariaPortal): void {
  aberto.value = p;
  acao.value = a;
  valor.value = p.valor.toFixed(2).replace('.', ',');
  referencia.value = '';
  motivo.value = '';
  senha.value = '';
  confirmando.value = false;
  erro.value = null;
  feito.value = null;
}
function fechar(): void {
  aberto.value = null;
  acao.value = null;
  confirmando.value = false;
}
const valorNumero = computed(() => Number(valor.value.replace(/\./g, '').replace(',', '.')));
const pergunta = computed(() => {
  const p = aberto.value;
  if (!p || !acao.value) return '';
  const chave =
    acao.value === 'conciliado'
      ? 'confirmarConciliar'
      : acao.value === 'divergente'
        ? 'confirmarDivergencia'
        : 'confirmarEstorno';
  return t(`portal.interno.tesouraria.${chave}`, {
    valor: moeda(acao.value === 'estorno' ? p.valor : valorNumero.value),
    transacao: p.transacao,
  });
});
const rotuloAcao = computed(() =>
  t(
    `portal.interno.tesouraria.${acao.value === 'conciliado' ? 'conciliar' : acao.value === 'divergente' ? 'divergencia' : 'estornar'}`,
  ),
);
async function confirmar(): Promise<void> {
  const p = aberto.value;
  if (!p || !acao.value) return;
  erro.value = null;
  try {
    const r =
      acao.value === 'estorno'
        ? await estornarPagamentoPortal(p.id, { motivo: motivo.value, senha: senha.value })
        : await conciliarPagamentoPortal(p.id, {
            acao: acao.value,
            valor: valorNumero.value,
            referencia: referencia.value.trim() || null,
            ...(acao.value === 'divergente' ? { motivo: motivo.value } : {}),
          });
    feito.value = t(`portal.interno.tesouraria.feito.${acao.value}`, {
      ref: r.atos[r.atos.length - 1]?.referencia ?? '',
    });
    fechar();
    await consulta.refetch();
  } catch (x) {
    erro.value = x;
    confirmando.value = false;
  } finally {
    senha.value = '';
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="tes-titulo" data-testid="tela-tesouraria-portal">
    <h1 id="tes-titulo">{{ t('portal.interno.tesouraria.titulo') }}</h1>
    <p>{{ t('portal.interno.tesouraria.ajuda') }}</p>
    <form class="tes-busca" @submit.prevent>
      <span class="campo">
        <label for="tes-de">{{ t('portal.interno.tesouraria.de') }}</label>
        <input id="tes-de" v-model="de" type="date" data-testid="tes-de" />
      </span>
      <span class="campo">
        <label for="tes-ate">{{ t('portal.interno.tesouraria.ate') }}</label>
        <input id="tes-ate" v-model="ate" type="date" data-testid="tes-ate" />
      </span>
      <SanteSelecao
        v-model="filtro"
        :rotulo="t('portal.interno.tesouraria.situacao')"
        :opcoes="opcoesFiltro"
        data-testid="tes-filtro"
      />
      <SanteBotao
        tipo="submit"
        variante="secundario"
        :rotulo="t('portal.interno.tesouraria.atualizar')"
        data-testid="tes-atualizar"
        @acionar="consulta.refetch()"
      />
    </form>
    <SanteAlerta v-if="feito" :texto="feito" variante="info" data-testid="tes-feito" />
    <SanteAlerta
      v-if="recusa"
      :texto="t(`portal.interno.tesouraria.recusas.${recusa}`)"
      variante="alerta"
      anunciar
      data-testid="tes-recusa"
    />
    <ErroPortal v-else-if="erro" :erro="erro" />
    <ErroPortal v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-else-if="consulta.data.value">
      <SanteAlerta
        v-if="!consulta.data.value.estornoDisponivel"
        :texto="t('portal.interno.tesouraria.semEstorno')"
        variante="aviso"
      />
      <p v-if="itens.length === 0">{{ t('portal.nenhum') }}</p>
      <template v-else>
        <p data-testid="tes-total">
          {{ t('portal.interno.tesouraria.total', { n: itens.length, valor: moeda(total) }) }}
        </p>
        <table class="tes-tabela" data-testid="tes-fila">
          <caption>
            {{
              t('portal.interno.tesouraria.titulo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('portal.interno.tesouraria.quando') }}</th>
              <th scope="col">{{ t('portal.interno.tesouraria.cobranca') }}</th>
              <th scope="col">{{ t('portal.interno.tesouraria.valor') }}</th>
              <th scope="col">{{ t('portal.interno.tesouraria.situacao') }}</th>
              <th scope="col">{{ t('portal.interno.tesouraria.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in itens" :key="i.id" :data-testid="`tes-linha-${i.id}`">
              <td>{{ quando(i.confirmadoEm) }}</td>
              <td>
                {{ i.transacao }} · {{ i.forma }}
                <strong v-if="i.situacaoCobranca === 'duplicado'">
                  · {{ t('portal.interno.tesouraria.duplicado') }}</strong
                >
              </td>
              <td>{{ moeda(i.valor) }}</td>
              <td>
                <span :data-testid="`tes-situacao-${i.id}`">{{
                  t(`portal.interno.tesouraria.situacoes.${i.situacao}`)
                }}</span>
                <ul
                  v-if="i.atos.length"
                  class="tes-atos"
                  :aria-label="t('portal.interno.tesouraria.historico')"
                >
                  <li v-for="a in i.atos" :key="a.id">
                    {{
                      t('portal.interno.tesouraria.ato', {
                        acao: t(`portal.interno.tesouraria.atos.${a.acao}`),
                        quem: a.usuario,
                        quando: quando(a.em),
                      })
                    }}
                    <template v-if="a.motivo"> · {{ a.motivo }}</template>
                    <template v-if="a.referencia"> · {{ a.referencia }}</template>
                  </li>
                </ul>
              </td>
              <td class="tes-acoes">
                <template v-if="i.situacao === 'a-conciliar' || i.situacao === 'divergente'">
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('portal.interno.tesouraria.conciliar')"
                    :data-testid="`tes-conciliar-${i.id}`"
                    @acionar="iniciar(i, 'conciliado')"
                  />
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('portal.interno.tesouraria.divergencia')"
                    :data-testid="`tes-divergencia-${i.id}`"
                    @acionar="iniciar(i, 'divergente')"
                  />
                </template>
                <SanteBotao
                  v-if="i.situacao !== 'estornado' && podeEstornar && consulta.data.value.estornoDisponivel"
                  variante="texto"
                  :rotulo="t('portal.interno.tesouraria.estornar')"
                  :data-testid="`tes-estornar-${i.id}`"
                  @acionar="iniciar(i, 'estorno')"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>

    <form v-if="aberto && acao" class="form" data-testid="tes-form" @submit.prevent>
      <h2>{{ t(`portal.interno.tesouraria.atos.${acao}`) }} · {{ aberto.transacao }}</h2>
      <template v-if="acao !== 'estorno'">
        <SanteCampoTexto
          v-model="valor"
          :rotulo="t('portal.interno.tesouraria.valorExtrato')"
          :max-bytes="14"
          data-testid="tes-valor"
        />
        <SanteCampoTexto
          v-model="referencia"
          :rotulo="t('portal.interno.tesouraria.referencia')"
          :max-bytes="80"
          data-testid="tes-referencia"
        />
      </template>
      <SanteCampoTexto
        v-if="acao !== 'conciliado'"
        v-model="motivo"
        :rotulo="t('portal.interno.tesouraria.motivo')"
        :max-bytes="250"
        data-testid="tes-motivo"
      />
      <span v-if="acao === 'estorno'" class="campo">
        <label for="tes-senha">{{ t('portal.interno.senha') }}</label>
        <input
          id="tes-senha"
          v-model="senha"
          type="password"
          autocomplete="current-password"
          data-testid="tes-senha"
        />
      </span>
      <SanteAlerta v-if="confirmando" :texto="pergunta" variante="aviso" data-testid="tes-pergunta" />
      <div class="tes-botoes">
        <SanteBotao
          tipo="submit"
          :rotulo="confirmando ? t('portal.interno.tesouraria.confirmar') : rotuloAcao"
          :data-testid="confirmando ? 'tes-confirmar' : 'tes-seguir'"
          @acionar="confirmando ? confirmar() : (confirmando = true)"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('portal.interno.tesouraria.cancelar')"
          data-testid="tes-voltar"
          @acionar="fechar"
        />
      </div>
    </form>
  </section>
</template>

<style scoped>
.tes-tabela {
  border-collapse: collapse;
  width: 100%;
}
.tes-tabela th,
.tes-tabela td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
.tes-busca,
.tes-botoes,
.tes-acoes {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--sgh-espaco-2);
}
.tes-atos {
  margin: var(--sgh-espaco-1) 0 0;
  padding-left: var(--sgh-espaco-3);
  font-size: 0.9em;
}
.form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
  margin-top: var(--sgh-espaco-3);
}
.campo {
  display: flex;
  flex-direction: column;
}
</style>
