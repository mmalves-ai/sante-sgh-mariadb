<script setup lang="ts">
// Portal do paciente: pagamento e pesquisa de satisfação (M50, etapa 2; ficha, seção 7). As consultas e os exames
// particulares com valor no portal: a cobrança Pix (o copia e cola do gateway) ou cartão (a página segura do gateway; o
// número do cartão nunca passa pelo portal), a conferência "já paguei" e o histórico. Fora de produção, o gateway é o
// simulado (o aviso e "Simular o pagamento"). E a pesquisa de satisfação dos atendimentos dos últimos 30 dias.
import type { AgendamentoPortal, CobrancaPortal, SessaoContaPortal } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPortal from '../componentes/ErroPortal.vue';
import PortalCasca from '../componentes/PortalCasca.vue';
import {
  conferirPagamentoPortal,
  iniciarPagamentoPortal,
  meusAgendamentos,
  pagamentosPortal,
  responderPesquisaPortal,
  simularPagamentoPortal,
} from '../api-portal-agenda.js';

const { t } = useI18n();
const sessao = ref<SessaoContaPortal | null>(null);
const versao = ref(0);
const pode = computed(() => sessao.value?.ativo.escopos.includes('agendamentos') ?? false);
const chave = computed(() => [versao.value, sessao.value?.ativo.vinculo ?? '']);
const agendamentos = useQuery({
  queryKey: computed(() => ['portal-paciente', 'agendamentos', ...chave.value]),
  queryFn: () => meusAgendamentos(),
  // O que muda em outra tela (o pagamento, a chegada, a conferência) aparece ao voltar: relê sempre ao montar.
  refetchOnMount: 'always',
  staleTime: 0,
  enabled: pode,
});
const pagamentos = useQuery({
  queryKey: computed(() => ['portal-paciente', 'pagamentos', ...chave.value]),
  queryFn: () => pagamentosPortal(),
  // O que muda em outra tela (o pagamento, a chegada, a conferência) aparece ao voltar: relê sempre ao montar.
  refetchOnMount: 'always',
  staleTime: 0,
  enabled: pode,
});
const aPagar = computed(() =>
  (agendamentos.data.value?.itens ?? []).filter(
    (a) => a.pagamento.valor !== null && a.pagamento.situacao !== 'confirmado' && a.situacao === 'marcado',
  ),
);
const pesquisas = computed(() =>
  (agendamentos.data.value?.itens ?? []).filter((a) => a.pesquisa === 'pendente'),
);
const cobranca = ref<CobrancaPortal | null>(null);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const dinheiro = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (d: string) => d.slice(0, 10).split('-').reverse().join('/');
const hora = (h: string) => h.slice(0, 5);
const horaDe = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

async function pagar(a: AgendamentoPortal, forma: 'pix' | 'cartao-credito'): Promise<void> {
  erro.value = null;
  aviso.value = null;
  try {
    cobranca.value = await iniciarPagamentoPortal(a.tipo, a.id, forma);
    versao.value++;
  } catch (x) {
    erro.value = x;
  }
}
async function conferir(): Promise<void> {
  if (!cobranca.value) return;
  erro.value = null;
  try {
    cobranca.value = await conferirPagamentoPortal(cobranca.value.id);
    if (cobranca.value.situacao !== 'pendente') versao.value++;
  } catch (x) {
    erro.value = x;
  }
}
async function simular(): Promise<void> {
  if (!cobranca.value) return;
  erro.value = null;
  try {
    cobranca.value = await simularPagamentoPortal(cobranca.value.id, true);
    versao.value++;
  } catch (x) {
    erro.value = x;
  }
}
async function copiar(): Promise<void> {
  try {
    await navigator.clipboard.writeText(cobranca.value?.pixCopiaECola ?? '');
    aviso.value = t('portal.pagamentos.copiado');
  } catch {
    /* sem área de transferência: o código continua na tela */
  }
}

// Pesquisa
const notas = Array.from({ length: 11 }, (_, i) => ({ valor: String(i), rotulo: String(i) }));
const nota = ref<Record<string, string>>({});
const comentario = ref<Record<string, string>>({});
async function responder(a: AgendamentoPortal): Promise<void> {
  erro.value = null;
  try {
    await responderPesquisaPortal(
      a.tipo,
      a.id,
      Number(nota.value[`${a.tipo}-${a.id}`] ?? '10'),
      (comentario.value[`${a.tipo}-${a.id}`] ?? '').trim() || null,
    );
    aviso.value = t('portal.pesquisa.obrigado');
    versao.value++;
  } catch (x) {
    erro.value = x;
  }
}
function trocou(s: SessaoContaPortal): void {
  sessao.value = s;
  cobranca.value = null;
  versao.value++;
}
</script>

<template>
  <PortalCasca :titulo="t('portal.pagamentos.titulo')" @sessao="(s) => (sessao = s)" @trocou="trocou">
    <p v-if="!pode">{{ t('portal.recusas.sem-escopo') }}</p>
    <template v-else>
      <ErroPortal v-if="erro" :erro="erro" />
      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="pac-pag-aviso" />
      <section class="portal-painel" aria-labelledby="pac-apagar" data-testid="pac-a-pagar">
        <h2 id="pac-apagar">{{ t('portal.pagamentos.aPagar') }}</h2>
        <SanteAlerta
          v-if="pagamentos.data.value && !pagamentos.data.value.ligado"
          :texto="t('portal.pagamentos.desligado')"
          variante="info"
        />
        <p v-if="aPagar.length === 0">{{ t('portal.pagamentos.nadaAPagar') }}</p>
        <ul v-else class="pac-lista">
          <li v-for="a in aPagar" :key="`${a.tipo}-${a.id}`" :data-testid="`pac-apagar-${a.id}`">
            <span
              >{{ dia(a.data) }} {{ hora(a.hora) }} · {{ a.procedimento }} ·
              <strong>{{ dinheiro(a.pagamento.valor ?? 0) }}</strong></span
            >
            <template v-if="pagamentos.data.value?.ligado">
              <SanteBotao
                :rotulo="t('portal.pagamentos.pix')"
                :data-testid="`pac-pix-${a.id}`"
                @acionar="pagar(a, 'pix')"
              />
              <SanteBotao
                variante="secundario"
                :rotulo="t('portal.pagamentos.cartao')"
                :data-testid="`pac-cartao-${a.id}`"
                @acionar="pagar(a, 'cartao-credito')"
              />
            </template>
          </li>
        </ul>
        <div v-if="cobranca" class="portal-painel" data-testid="pac-cobranca">
          <p>{{ dinheiro(cobranca.valor) }} · {{ t(`portal.pagamentos.situacoes.${cobranca.situacao}`) }}</p>
          <SanteAlerta v-if="cobranca.simulado" :texto="t('portal.pagamentos.simulado')" variante="info" />
          <template v-if="cobranca.situacao === 'pendente'">
            <template v-if="cobranca.pixCopiaECola">
              <span class="portal-campo">
                <label for="pac-pix">{{ t('portal.pagamentos.copiaECola') }}</label>
                <textarea
                  id="pac-pix"
                  :value="cobranca.pixCopiaECola"
                  readonly
                  rows="3"
                  data-testid="pac-pix-codigo"
                ></textarea>
              </span>
              <SanteBotao variante="texto" :rotulo="t('portal.pagamentos.copiar')" @acionar="copiar" />
            </template>
            <a v-if="cobranca.enderecoCartao" :href="cobranca.enderecoCartao" rel="noopener">{{
              t('portal.pagamentos.cartaoPagina')
            }}</a>
            <p>{{ t('portal.pagamentos.vence', { hora: horaDe(cobranca.expiraEm) }) }}</p>
            <SanteBotao
              variante="secundario"
              :rotulo="t('portal.pagamentos.conferir')"
              data-testid="pac-conferir-pagamento"
              @acionar="conferir"
            />
            <SanteBotao
              v-if="cobranca.simulado"
              variante="texto"
              :rotulo="t('portal.pagamentos.simular')"
              data-testid="pac-simular"
              @acionar="simular"
            />
          </template>
        </div>
      </section>

      <section class="portal-painel" aria-labelledby="pac-pesquisa" data-testid="pac-pesquisas">
        <h2 id="pac-pesquisa">{{ t('portal.pesquisa.titulo') }}</h2>
        <p v-if="pesquisas.length === 0">{{ t('portal.pesquisa.nenhuma') }}</p>
        <form
          v-for="a in pesquisas"
          :key="`${a.tipo}-${a.id}`"
          class="portal-painel"
          :data-testid="`pac-pesquisa-form-${a.id}`"
          @submit.prevent="responder(a)"
        >
          <h3>{{ dia(a.data) }} · {{ a.procedimento }}</h3>
          <p>{{ t('portal.pesquisa.pergunta') }}</p>
          <SanteSelecao
            :model-value="nota[`${a.tipo}-${a.id}`] ?? '10'"
            :rotulo="t('portal.pesquisa.nota')"
            :opcoes="notas"
            :data-testid="`pac-nota-${a.id}`"
            @update:model-value="(v: string) => (nota[`${a.tipo}-${a.id}`] = v)"
          />
          <SanteCampoTexto
            :model-value="comentario[`${a.tipo}-${a.id}`] ?? ''"
            :rotulo="t('portal.pesquisa.comentario')"
            :max-bytes="500"
            multilinha
            @update:model-value="(v: string) => (comentario[`${a.tipo}-${a.id}`] = v)"
          />
          <SanteBotao
            tipo="submit"
            :rotulo="t('portal.pesquisa.enviar')"
            :data-testid="`pac-pesquisa-enviar-${a.id}`"
            @acionar="responder(a)"
          />
        </form>
      </section>

      <section class="portal-painel" aria-labelledby="pac-hist" data-testid="pac-historico-pagamentos">
        <h2 id="pac-hist">{{ t('portal.pagamentos.historico') }}</h2>
        <p v-if="!pagamentos.data.value?.itens.length">{{ t('portal.nenhum') }}</p>
        <table v-else class="portal-tabela">
          <caption>
            {{
              t('portal.pagamentos.historico')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('portal.pagamentos.colunas.quando') }}</th>
              <th scope="col">{{ t('portal.pagamentos.colunas.valor') }}</th>
              <th scope="col">{{ t('portal.pagamentos.colunas.forma') }}</th>
              <th scope="col">{{ t('portal.pagamentos.colunas.situacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in pagamentos.data.value.itens" :key="p.id">
              <td>{{ p.confirmadoEm ? dia(p.confirmadoEm) : dia(p.expiraEm) }}</td>
              <td>{{ dinheiro(p.valor) }}</td>
              <td>{{ t(`portal.pagamentos.formas.${p.forma}`) }}</td>
              <td>{{ t(`portal.pagamentos.situacoes.${p.situacao}`) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </PortalCasca>
</template>

<style scoped>
.pac-lista {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.pac-lista li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
</style>
