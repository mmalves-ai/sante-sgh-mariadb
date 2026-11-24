<script setup lang="ts">
// Histórico de alterações do cadastro do paciente (M11): a linha do tempo lida ao vivo das versões que o
// trigger do sistema atual grava a cada mudança, os telefones de cada versão e as unificações feitas no
// sistema atual. Sem paciente escolhido (aberta pelo menu), orienta a buscar primeiro. F3.1: quem tem a permissão de
// unificar desfaz uma unificação daqui mesmo, com motivo e senha (validação na hora; nada se apaga).
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { desfazerUnificacao, lerHistorico } from '../api-cadastro.js';
import EscolhaPorBusca from '../componentes/EscolhaPorBusca.vue';
import LinhaDoTempo from '../componentes/LinhaDoTempo.vue';
import PaginacaoCadastro from '../componentes/PaginacaoCadastro.vue';
import { carimboBr } from '../formato.js';

const props = defineProps<{ id?: string }>();
const { t } = useI18n();
const idNumero = computed(() => (props.id ? Number(props.id) : 0));
const pagina = ref(1);
watch(idNumero, () => (pagina.value = 1));

const consulta = useQuery({
  queryKey: computed(() => ['cadastro', 'historico', idNumero.value, pagina.value]),
  queryFn: () => lerHistorico(idNumero.value, pagina.value),
  enabled: computed(() => Number.isInteger(idNumero.value) && idNumero.value > 0),
});
const h = computed(() => consulta.data.value);

type Unificacao = NonNullable<typeof h.value>['unificacoes'][number];
const podeDesfazer = computed(() => pode('cadastro.paciente.unificar'));
const desfazendo = ref<Unificacao | null>(null);
const motivo = ref('');
const senha = ref('');
const enviando = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref('');
const motivoValido = computed(() => motivo.value.trim().length >= 5 && motivo.value.trim().length <= 400);

function abrirDesfazer(u: Unificacao): void {
  desfazendo.value = u;
  motivo.value = '';
  senha.value = '';
  erro.value = null;
  mensagem.value = '';
}

async function confirmarDesfazer(): Promise<void> {
  const u = desfazendo.value;
  if (!u?.id || !motivoValido.value) return;
  enviando.value = true;
  erro.value = null;
  try {
    await desfazerUnificacao(u.id, {
      motivo: motivo.value.trim(),
      ...(senha.value ? { senha: senha.value } : {}),
    });
    mensagem.value = t('cadastro.historico.desfeita', { absorvido: u.absorvido });
    desfazendo.value = null;
    await consulta.refetch();
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="historico-titulo" data-testid="tela-historico-paciente">
    <h1 id="historico-titulo">{{ t('cadastro.historico.titulo') }}</h1>
    <EscolhaPorBusca
      v-if="!idNumero"
      :texto="t('cadastro.historico.escolha')"
      destino="/cadastros/pacientes"
      :rotulo="t('cadastro.busca.titulo')"
    />
    <MensagemErro v-else-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!h">{{ t('cadastro.carregando') }}</p>
    <template v-else>
      <p>
        <RouterLink :to="`/cadastros/pacientes/${h.id}`">{{ t('cadastro.historico.abrirFicha') }}</RouterLink>
      </p>
      <LinhaDoTempo :legenda="t('cadastro.historico.legenda', { nome: h.nome })" :versoes="h.versoes" />
      <PaginacaoCadastro
        v-model="pagina"
        :total="h.total"
        :por-pagina="h.porPagina"
        :rotulo="t('cadastro.historico.titulo')"
      />
      <section v-if="h.unificacoes.length > 0" aria-labelledby="unificacoes-titulo">
        <h2 id="unificacoes-titulo">{{ t('cadastro.historico.unificacoes') }}</h2>
        <ul>
          <li
            v-for="u in h.unificacoes"
            :key="u.id ?? `${u.absorvido}-${u.sobrevivente}`"
            :data-testid="u.id ? `unificacao-${u.id}` : `unificacao-absorvido-${u.absorvido}`"
            :data-situacao="u.situacao ?? 'efetivada'"
          >
            {{
              t('cadastro.historico.unificacao', {
                absorvido: u.absorvido,
                sobrevivente: u.sobrevivente,
                em: carimboBr(u.em),
              })
            }}
            <span
              v-if="u.situacao === 'revertida'"
              class="unificacao-desfeita"
              :data-testid="`unificacao-desfeita-${u.id}`"
            >
              {{
                t('cadastro.historico.revertida', {
                  em: carimboBr(u.revertidaEm ?? null),
                  por: u.revertidaPor ?? '—',
                  motivo: u.motivoReversao ?? '—',
                })
              }}
            </span>
            <span v-else-if="u.reversivel === false" :data-testid="`unificacao-nao-reversivel-${u.id}`">
              {{ t('cadastro.historico.naoReversivel') }}
            </span>
            <SanteBotao
              v-else-if="podeDesfazer && u.id"
              variante="secundario"
              :rotulo="t('cadastro.historico.desfazer')"
              :data-testid="`desfazer-unificacao-${u.id}`"
              @click="abrirDesfazer(u)"
            />
          </li>
        </ul>
      </section>
      <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" data-testid="mensagem-desfazer" />
      <form
        v-if="desfazendo"
        class="form-desfazer"
        data-testid="form-desfazer-unificacao"
        aria-labelledby="desfazer-titulo"
        @submit.prevent="confirmarDesfazer"
      >
        <h2 id="desfazer-titulo">
          {{ t('cadastro.historico.desfazerTitulo', { absorvido: desfazendo.absorvido }) }}
        </h2>
        <p>
          {{
            t('cadastro.historico.desfazerAviso', {
              absorvido: desfazendo.absorvido,
              sobrevivente: desfazendo.sobrevivente,
            })
          }}
        </p>
        <label>
          {{ t('cadastro.historico.motivoDesfazer') }}
          <textarea v-model="motivo" maxlength="400" rows="3" required data-testid="motivo-desfazer" />
        </label>
        <label>
          {{ t('cadastro.historico.senhaDesfazer') }}
          <input
            v-model="senha"
            type="password"
            autocomplete="current-password"
            data-testid="senha-desfazer"
          />
        </label>
        <MensagemErro v-if="erro" :erro="erro" />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('cadastro.historico.confirmarDesfazer')"
            :desabilitado="!motivoValido || enviando"
            data-testid="botao-confirmar-desfazer"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('cadastro.historico.cancelar')"
            @click="desfazendo = null"
          />
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
.form-desfazer {
  display: grid;
  gap: var(--sgh-espaco-2, 0.5rem);
  max-width: 40rem;
}
.form-desfazer label {
  display: grid;
}
/* Alvo mínimo de toque (WCAG 2.5.8): links de ação e de lista. */
nav a,
.acoes a,
li a,
.link-acao {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
</style>
