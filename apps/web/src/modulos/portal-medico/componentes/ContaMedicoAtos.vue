<script setup lang="ts">
// Atos do hospital sobre a conta do médico externo (W0-10; linha 'Profissional / usuário do sistema' da matriz,
// NGS1.03.08/09 d): a conta que operou não se exclui; bloqueia-se (reversível), desbloqueia-se ou encerra-se
// (definitivo), sempre com motivo, painel de confirmação e a senha de novo (operação crítica). O encerramento com
// pedidos de cirurgia aguardando o bloco mostra a contagem e exige a decisão: retirar ou manter para a secretaria.
// O histórico mostra cada ato (fato novo), com a situação anterior e quem fez.
import type { AtoContaMedicoExternoItem, ContaMedicoExterno } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { atoContaMedicoExterno, atosContaMedicoExterno } from '../api-portal-medico.js';
import ErroPortalMedico from './ErroPortalMedico.vue';

type Ato = 'bloqueio' | 'desbloqueio' | 'encerramento';
const props = defineProps<{ conta: ContaMedicoExterno; podeGerir: boolean }>();
const emit = defineEmits<{ feito: [mensagem: string] }>();
const { t } = useI18n();

const ato = ref<Ato | null>(null);
const motivo = ref('');
const senha = ref('');
const decisao = ref<'retirar' | 'manter' | ''>('');
const confirmando = ref(false);
const ocupado = ref(false);
const erro = ref<unknown>(null);
/** A contagem e a amostra que o servidor devolveu (a lista pode ter mudado desde a leitura). */
const pendentesServidor = ref<{ quantidade: number; amostra: string[] } | null>(null);
const historico = ref<AtoContaMedicoExternoItem[] | null>(null);

const id = (x: string) => `pmc-${x}-${props.conta.acesso}`;
const pendentes = computed(() =>
  ato.value === 'encerramento' ? (pendentesServidor.value?.quantidade ?? props.conta.pedidosAbertos) : 0,
);
const amostra = computed(
  () =>
    pendentesServidor.value?.amostra ??
    props.conta.pedidos.map(
      (p) => `${p.data.split('-').reverse().join('/')} ${p.hora} · ${p.sala} · ${p.procedimento}`,
    ),
);
const pronto = computed(
  () =>
    motivo.value.trim().length >= 5 &&
    senha.value.length > 0 &&
    (pendentes.value === 0 || decisao.value !== ''),
);
const quando = (v: string) => `${v.slice(0, 10).split('-').reverse().join('/')} ${v.slice(11, 16)}`;

function iniciar(a: Ato): void {
  ato.value = a;
  motivo.value = '';
  senha.value = '';
  decisao.value = '';
  confirmando.value = false;
  erro.value = null;
  pendentesServidor.value = null;
}
function cancelar(): void {
  ato.value = null;
  senha.value = '';
  confirmando.value = false;
}
async function confirmar(): Promise<void> {
  if (!ato.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await atoContaMedicoExterno(props.conta.acesso, {
      ato: ato.value,
      motivo: motivo.value,
      pedidos: pendentes.value > 0 && decisao.value ? decisao.value : null,
      senha: senha.value,
    });
    ato.value = null;
    historico.value = null;
    emit('feito', r.mensagem);
  } catch (x) {
    const p =
      x instanceof ErroApi
        ? (x.problema as { codigo?: string; dependentes?: { quantidade: number; amostra: string[] }[] })
        : null;
    if (p?.codigo === 'pedidos-pendentes' && p.dependentes?.[0]) {
      pendentesServidor.value = p.dependentes[0];
      decisao.value = '';
    } else erro.value = x;
    confirmando.value = false;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}
async function alternarHistorico(): Promise<void> {
  if (historico.value) {
    historico.value = null;
    return;
  }
  try {
    historico.value = await atosContaMedicoExterno(props.conta.acesso);
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <div class="conta-atos" :data-testid="`pmc-${conta.numero}`">
    <p>
      {{ t('portalMedico.interno.gestaoConta.situacao') }}:
      <strong :data-testid="`pmc-situacao-${conta.numero}`">{{
        t(`portalMedico.interno.gestaoConta.situacoes.${conta.situacao}`)
      }}</strong>
    </p>
    <p v-if="podeGerir && conta.situacao !== 'encerrado' && !ato" class="acoes">
      <SanteBotao
        v-if="conta.situacao === 'ativo'"
        variante="secundario"
        :rotulo="t('portalMedico.interno.gestaoConta.bloquear')"
        :data-testid="`pmc-bloquear-${conta.numero}`"
        @acionar="iniciar('bloqueio')"
      />
      <SanteBotao
        v-if="conta.situacao === 'bloqueado'"
        variante="secundario"
        :rotulo="t('portalMedico.interno.gestaoConta.desbloquear')"
        :data-testid="`pmc-desbloquear-${conta.numero}`"
        @acionar="iniciar('desbloqueio')"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="t('portalMedico.interno.gestaoConta.encerrar')"
        :data-testid="`pmc-encerrar-${conta.numero}`"
        @acionar="iniciar('encerramento')"
      />
    </p>
    <form v-if="ato" class="painel" :data-testid="`pmc-painel-${conta.numero}`" @submit.prevent>
      <span class="campo">
        <label :for="id('motivo')">{{ t('portalMedico.interno.gestaoConta.motivo') }}</label>
        <textarea
          :id="id('motivo')"
          v-model="motivo"
          maxlength="250"
          rows="2"
          :data-testid="`pmc-motivo-${conta.numero}`"
        />
      </span>
      <fieldset v-if="pendentes > 0" :data-testid="`pmc-pendentes-${conta.numero}`">
        <legend>{{ t('portalMedico.interno.gestaoConta.pendentes', { n: pendentes }) }}</legend>
        <ul>
          <li v-for="(x, k) in amostra" :key="k">{{ x }}</li>
        </ul>
        <label v-for="d in ['retirar', 'manter'] as const" :key="d">
          <input
            v-model="decisao"
            type="radio"
            :value="d"
            :name="id('decisao')"
            :data-testid="`pmc-decisao-${d}-${conta.numero}`"
          />
          {{ t(`portalMedico.interno.gestaoConta.decisoes.${d}`) }}
        </label>
      </fieldset>
      <span class="campo">
        <label :for="id('senha')">{{ t('portalMedico.interno.gestaoConta.senha') }}</label>
        <input
          :id="id('senha')"
          v-model="senha"
          type="password"
          autocomplete="current-password"
          :data-testid="`pmc-senha-${conta.numero}`"
        />
      </span>
      <SanteAlerta
        v-if="confirmando"
        variante="aviso"
        :texto="t(`portalMedico.interno.gestaoConta.perguntas.${ato}`, { nome: conta.nome })"
        :data-testid="`pmc-pergunta-${conta.numero}`"
      />
      <p class="acoes">
        <SanteBotao
          :rotulo="
            confirmando
              ? t('portalMedico.interno.gestaoConta.confirmar')
              : t('portalMedico.interno.gestaoConta.seguir')
          "
          :desabilitado="!pronto || ocupado"
          :data-testid="confirmando ? `pmc-confirmar-${conta.numero}` : `pmc-seguir-${conta.numero}`"
          @acionar="confirmando ? confirmar() : (confirmando = true)"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('portalMedico.interno.gestaoConta.cancelar')"
          @acionar="cancelar()"
        />
      </p>
    </form>
    <p>
      <SanteBotao
        variante="secundario"
        :rotulo="
          historico
            ? t('portalMedico.interno.gestaoConta.ocultarHistorico')
            : t('portalMedico.interno.gestaoConta.historico')
        "
        :data-testid="`pmc-historico-${conta.numero}`"
        @acionar="alternarHistorico()"
      />
    </p>
    <template v-if="historico">
      <p v-if="historico.length === 0" class="secundario">
        {{ t('portalMedico.interno.gestaoConta.semHistorico') }}
      </p>
      <ul v-else :data-testid="`pmc-atos-${conta.numero}`">
        <li v-for="a in historico" :key="a.id">
          {{
            t('portalMedico.interno.gestaoConta.itemHistorico', {
              quando: quando(a.em),
              ato: t(`portalMedico.interno.gestaoConta.atos.${a.ato}`),
              quem: a.usuario,
              anterior: a.situacaoAnterior,
            })
          }}
          <template v-if="a.motivo">: {{ a.motivo }}</template>
          <template v-if="a.decisaoPedidos">
            ({{
              t('portalMedico.interno.gestaoConta.decisaoHistorico', {
                n: a.pedidosPendentes,
                decisao: t(`portalMedico.interno.gestaoConta.decisoes.${a.decisaoPedidos}`),
              })
            }})
          </template>
        </li>
      </ul>
    </template>
    <ErroPortalMedico v-if="erro" :erro="erro" />
  </div>
</template>
