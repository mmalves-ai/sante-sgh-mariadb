<script setup lang="ts">
// A conta do portal do paciente na ficha do paciente (M50, etapa 1; ficha, seção 7; tela interna): a situação (sem o
// e-mail completo nem segredo), o convite impresso para o paciente (o código aparece uma vez), o bloqueio e o
// desbloqueio (com o acesso refeito quando o paciente perdeu o celular: sai um convite novo), o encerramento e o
// responsável que não é paciente (D-RESP-50), conferido no balcão pelo documento original. As ações críticas pedem a
// senha de novo. Nenhuma mensagem é enviada ao paciente. Com a conferência dos responsáveis, a ficha lista os
// responsáveis vigentes do paciente (pendentes e ativos) e encerra o acesso de um deles (perda da guarda, por exemplo).
// W0-10: a troca do e-mail no balcão (o link vai ao e-mail novo; a troca pendente aparece e pode ser cancelada) e a
// redefinição do segundo fator (convite novo impresso), com motivo, justificativa e a senha de novo.
import {
  type ConviteEmitido,
  ESCOPOS_VINCULO,
  type EscopoVinculo,
  MOTIVOS_BLOQUEIO_CONTA,
  MOTIVOS_ENCERRAMENTO_CONTA,
  MOTIVOS_REDEFINIR_SEGUNDO_FATOR,
  MOTIVOS_TROCA_EMAIL_BALCAO,
  PROVAS_ACEITAS,
  type ProvaVinculo,
  TIPOS_VINCULO_RESPONSAVEL,
  type TipoVinculoResponsavel,
  type VinculoParaConferir,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPortal from './ErroPortal.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  bloquearConta,
  cancelarTrocaEmailConta,
  contaDoPaciente,
  convidarPaciente,
  convidarResponsavel,
  desbloquearConta,
  encerrarConta,
  encerrarVinculo,
  redefinirSegundoFator,
  responsaveisDoPaciente,
  trocaEmailDaConta,
  trocarEmailConta,
} from '../api-portal-interno.js';

const props = defineProps<{ idPaciente: number }>();
const { t } = useI18n();
const consulta = useQuery({
  queryKey: computed(() => ['portal-paciente', 'conta', props.idPaciente]),
  queryFn: () => contaDoPaciente(props.idPaciente),
});
const c = computed(() => consulta.data.value);
const podeConferir = computed(() => pode('portal.vinculo.conferir'));
const responsaveis = useQuery({
  queryKey: computed(() => ['portal-paciente', 'responsaveis', props.idPaciente]),
  queryFn: () => responsaveisDoPaciente(props.idPaciente),
  enabled: podeConferir,
});
const contaId = computed(() => c.value?.conta?.conta ?? null);
const troca = useQuery({
  queryKey: computed(() => ['portal-paciente', 'troca-email', contaId.value]),
  queryFn: () => trocaEmailDaConta(contaId.value ?? ''),
  enabled: computed(() => contaId.value !== null),
});
const emailNovo = ref('');
const motivoTroca = ref<(typeof MOTIVOS_TROCA_EMAIL_BALCAO)[number]>('email-perdido');
const motivoRedefinir = ref<(typeof MOTIVOS_REDEFINIR_SEGUNDO_FATOR)[number]>('aparelho-perdido');
const enviada = ref<string | null>(null);
const vinculoEncerrar = ref<VinculoParaConferir | null>(null);
const convite = ref<ConviteEmitido | null>(null);
const erro = ref<unknown>(null);
const acao = ref<
  | ''
  | 'bloquear'
  | 'desbloquear'
  | 'encerrar'
  | 'responsavel'
  | 'encerrarVinculo'
  | 'trocarEmail'
  | 'cancelarTroca'
  | 'redefinir'
>('');
const motivoBloqueio = ref<(typeof MOTIVOS_BLOQUEIO_CONTA)[number]>('decisao-do-hospital');
const motivoEncerramento = ref<(typeof MOTIVOS_ENCERRAMENTO_CONTA)[number]>('pedido-do-titular');
const justificativa = ref('');
const refazer = ref(false);
const senha = ref('');
// Responsável no balcão
const nome = ref('');
const nascimento = ref('');
const tipo = ref<TipoVinculoResponsavel>('tutor');
const prova = ref<ProvaVinculo>('termo-tutela');
const validade = ref('');
const escopos = ref<EscopoVinculo[]>(['documentos', 'consentimentos', 'pedidos']);
watch(tipo, (x) => (prova.value = PROVAS_ACEITAS[x][0] as ProvaVinculo));

const opcoes = (lista: readonly string[], base: string) =>
  lista.map((v) => ({ valor: v, rotulo: t(`${base}.${v}`) }));
const quando = (s: string | null) =>
  s ? `${s.slice(0, 10).split('-').reverse().join('/')} ${s.slice(11, 16)}` : '—';

async function tentar(fn: () => Promise<void>): Promise<void> {
  erro.value = null;
  try {
    await fn();
    await consulta.refetch();
    if (podeConferir.value) await responsaveis.refetch();
    if (contaId.value) await troca.refetch();
  } catch (x) {
    erro.value = x;
  }
}
const convidar = () =>
  tentar(async () => {
    convite.value = await convidarPaciente(props.idPaciente, 'recepcao');
  });
const confirmar = () =>
  tentar(async () => {
    const conta = c.value?.conta?.conta ?? '';
    if (acao.value === 'bloquear')
      await bloquearConta(conta, {
        motivo: motivoBloqueio.value,
        justificativa: justificativa.value,
        senha: senha.value,
      });
    else if (acao.value === 'desbloquear') {
      const r = await desbloquearConta(conta, {
        justificativa: justificativa.value,
        refazerSegundoFator: refazer.value,
        senha: senha.value,
      });
      convite.value = r.convite;
    } else if (acao.value === 'encerrar')
      await encerrarConta(conta, {
        motivo: motivoEncerramento.value,
        justificativa: justificativa.value,
        senha: senha.value,
      });
    else if (acao.value === 'trocarEmail') {
      const r = await trocarEmailConta(conta, {
        email: emailNovo.value.trim(),
        motivo: motivoTroca.value,
        justificativa: justificativa.value,
        senha: senha.value,
      });
      enviada.value = r.emailMascarado;
      emailNovo.value = '';
    } else if (acao.value === 'cancelarTroca') await cancelarTrocaEmailConta(conta, { senha: senha.value });
    else if (acao.value === 'redefinir')
      convite.value = (
        await redefinirSegundoFator(conta, {
          motivo: motivoRedefinir.value,
          justificativa: justificativa.value,
          senha: senha.value,
        })
      ).convite;
    else if (acao.value === 'encerrarVinculo' && vinculoEncerrar.value) {
      await encerrarVinculo(vinculoEncerrar.value.vinculo, {
        motivo: 'revogado-pelo-hospital',
        justificativa: justificativa.value,
        senha: senha.value,
      });
      vinculoEncerrar.value = null;
    } else if (acao.value === 'responsavel')
      convite.value = await convidarResponsavel(props.idPaciente, {
        nome: nome.value,
        nascimento: nascimento.value,
        tipo: tipo.value,
        prova: prova.value,
        validade: validade.value || null,
        escopos: escopos.value,
        senha: senha.value,
      });
    acao.value = '';
    justificativa.value = '';
    senha.value = '';
  });
function pedirEncerramento(v: VinculoParaConferir): void {
  vinculoEncerrar.value = v;
  acao.value = 'encerrarVinculo';
}
function imprimir(): void {
  window.print();
}
</script>

<template>
  <section aria-labelledby="sec-portal-paciente" data-testid="conta-portal">
    <h2 id="sec-portal-paciente">{{ t('portal.interno.conta.titulo') }}</h2>
    <ErroPortal v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-else-if="c">
      <SanteAlerta v-if="!c.ligado" :texto="t('portal.interno.conta.desligado')" variante="info" />
      <p v-if="!c.conta" data-testid="conta-portal-sem">{{ t('portal.interno.conta.semConta') }}</p>
      <dl v-else class="conta-portal-dados" data-testid="conta-portal-dados">
        <dt>{{ t('portal.interno.conta.situacao') }}</dt>
        <dd data-testid="conta-portal-situacao">
          {{ t(`portal.interno.conta.situacoes.${c.conta.situacao}`) }}
        </dd>
        <dt>{{ t('portal.interno.conta.email') }}</dt>
        <dd>{{ c.conta.emailMascarado ?? '—' }}</dd>
        <dt>{{ t('portal.interno.conta.segundoFator') }}</dt>
        <dd>
          {{
            c.conta.segundoFator
              ? t('portal.interno.conta.comSegundoFator')
              : t('portal.interno.conta.semSegundoFator')
          }}
        </dd>
        <dt>{{ t('portal.interno.conta.ultimoAcesso') }}</dt>
        <dd>{{ quando(c.conta.ultimoAcessoEm) }}</dd>
        <dt v-if="c.conta.motivo">{{ t('portal.interno.conta.motivo') }}</dt>
        <dd v-if="c.conta.motivo">{{ c.conta.motivo }}</dd>
        <dt>{{ t('portal.interno.conta.responsaveis') }}</dt>
        <dd>{{ c.conta.responsaveis }}</dd>
      </dl>
      <div v-if="troca.data.value" class="conta-portal-troca" data-testid="conta-portal-troca">
        <SanteAlerta
          :texto="
            t('portal.interno.conta.trocaPendente', {
              email: troca.data.value.emailMascarado ?? '—',
              origem: t(`portal.interno.conta.origensTroca.${troca.data.value.origem}`),
              quando: quando(troca.data.value.validoAte),
            })
          "
          variante="info"
        />
        <SanteBotao
          v-if="pode('portal.conta.trocarEmail')"
          variante="texto"
          :rotulo="t('portal.interno.conta.cancelarTroca')"
          data-testid="conta-portal-cancelar-troca"
          @acionar="acao = 'cancelarTroca'"
        />
      </div>
      <SanteAlerta
        v-if="enviada"
        :texto="t('portal.interno.conta.trocaEnviada', { email: enviada })"
        variante="info"
        anunciar
      />
      <div v-if="c.ligado" class="conta-portal-acoes">
        <SanteBotao
          v-if="
            pode('portal.conta.convidar') &&
            (!c.conta || c.conta.situacao === 'convidada' || c.conta.situacao === 'encerrada')
          "
          :rotulo="t('portal.interno.conta.convidar')"
          variante="secundario"
          data-testid="conta-portal-convidar"
          @acionar="convidar"
        />
        <SanteBotao
          v-if="pode('portal.conta.bloquear') && c.conta?.situacao === 'ativa'"
          :rotulo="t('portal.interno.conta.bloquear')"
          variante="secundario"
          data-testid="conta-portal-bloquear"
          @acionar="acao = 'bloquear'"
        />
        <SanteBotao
          v-if="
            pode('portal.conta.bloquear') &&
            (c.conta?.situacao === 'bloqueada' || c.conta?.situacao === 'ativa')
          "
          :rotulo="t('portal.interno.conta.desbloquear')"
          variante="secundario"
          data-testid="conta-portal-desbloquear"
          @acionar="acao = 'desbloquear'"
        />
        <SanteBotao
          v-if="
            pode('portal.conta.trocarEmail') &&
            (c.conta?.situacao === 'ativa' || c.conta?.situacao === 'bloqueada')
          "
          :rotulo="t('portal.interno.conta.trocarEmail')"
          variante="secundario"
          data-testid="conta-portal-trocar-email"
          @acionar="acao = 'trocarEmail'"
        />
        <SanteBotao
          v-if="
            pode('portal.conta.bloquear') &&
            (c.conta?.situacao === 'ativa' || c.conta?.situacao === 'bloqueada')
          "
          :rotulo="t('portal.interno.conta.redefinirSegundoFator')"
          variante="secundario"
          data-testid="conta-portal-redefinir"
          @acionar="acao = 'redefinir'"
        />
        <SanteBotao
          v-if="pode('portal.conta.encerrar') && c.conta && c.conta.situacao !== 'encerrada'"
          :rotulo="t('portal.interno.conta.encerrar')"
          variante="secundario"
          data-testid="conta-portal-encerrar"
          @acionar="acao = 'encerrar'"
        />
        <SanteBotao
          v-if="pode('portal.conta.convidar') && pode('portal.vinculo.conferir')"
          :rotulo="t('portal.interno.conta.responsavelBalcao')"
          variante="secundario"
          data-testid="conta-portal-responsavel"
          @acionar="acao = 'responsavel'"
        />
      </div>
      <section
        v-if="podeConferir"
        aria-labelledby="sec-portal-responsaveis"
        data-testid="conta-portal-responsaveis"
      >
        <h3 id="sec-portal-responsaveis">{{ t('portal.interno.conta.vigentes') }}</h3>
        <ErroPortal v-if="responsaveis.isError.value" :erro="responsaveis.error.value" />
        <p v-else-if="responsaveis.data.value?.length === 0">{{ t('portal.interno.conta.semVigentes') }}</p>
        <ul v-else-if="responsaveis.data.value">
          <li
            v-for="v in responsaveis.data.value"
            :key="v.vinculo"
            :data-testid="`conta-portal-responsavel-${v.vinculo}`"
          >
            {{ v.primeiroNomeResponsavel }} · {{ t(`portal.responsaveis.tipos.${v.tipo}`) }} ·
            {{ t(`portal.responsaveis.situacoes.${v.situacao}`) }}
            <SanteBotao
              variante="texto"
              :rotulo="t('portal.interno.conta.encerrarVinculo')"
              :data-testid="`conta-portal-encerrar-vinculo-${v.vinculo}`"
              @acionar="pedirEncerramento(v)"
            />
          </li>
        </ul>
      </section>
      <form v-if="acao" class="form" data-testid="conta-portal-form" @submit.prevent="confirmar">
        <p v-if="acao === 'encerrarVinculo' && vinculoEncerrar">
          {{ t('portal.interno.vinculos.encerrarConfirma') }}
        </p>
        <SanteSelecao
          v-if="acao === 'bloquear'"
          v-model="motivoBloqueio"
          :rotulo="t('portal.interno.conta.motivo')"
          :opcoes="opcoes(MOTIVOS_BLOQUEIO_CONTA, 'portal.interno.conta.motivosBloqueio')"
          :busca="true"
        />
        <label v-if="acao === 'desbloquear'"
          ><input v-model="refazer" type="checkbox" data-testid="conta-portal-refazer" />
          {{ t('portal.interno.conta.refazerSegundoFator') }}</label
        >
        <SanteSelecao
          v-if="acao === 'encerrar'"
          v-model="motivoEncerramento"
          :rotulo="t('portal.interno.conta.motivo')"
          :opcoes="opcoes(MOTIVOS_ENCERRAMENTO_CONTA, 'portal.interno.conta.motivosEncerramento')"
          :busca="true"
        />
        <template v-if="acao === 'trocarEmail'">
          <p>{{ t('portal.interno.conta.trocaEmailAjuda') }}</p>
          <span class="campo">
            <label for="conta-portal-email-novo">{{ t('portal.interno.conta.emailNovo') }}</label>
            <input
              id="conta-portal-email-novo"
              v-model="emailNovo"
              type="email"
              autocomplete="off"
              data-testid="conta-portal-email-novo"
            />
          </span>
          <SanteSelecao
            v-model="motivoTroca"
            :rotulo="t('portal.interno.conta.motivo')"
            :opcoes="opcoes(MOTIVOS_TROCA_EMAIL_BALCAO, 'portal.interno.conta.motivosTrocaEmail')"
            :busca="true"
          />
        </template>
        <template v-if="acao === 'redefinir'">
          <p>{{ t('portal.interno.conta.redefinirAjuda') }}</p>
          <SanteSelecao
            v-model="motivoRedefinir"
            :rotulo="t('portal.interno.conta.motivo')"
            :opcoes="opcoes(MOTIVOS_REDEFINIR_SEGUNDO_FATOR, 'portal.interno.conta.motivosRedefinir')"
            :busca="true"
          />
        </template>
        <template v-if="acao === 'responsavel'">
          <p>{{ t('portal.interno.conta.responsavelAjuda') }}</p>
          <SanteCampoTexto
            v-model="nome"
            :rotulo="t('portal.interno.conta.nomeResponsavel')"
            :max-bytes="70"
            obrigatorio
          />
          <span class="campo">
            <label for="resp-nasc">{{ t('portal.interno.conta.nascimentoResponsavel') }}</label>
            <input id="resp-nasc" v-model="nascimento" type="date" data-testid="resp-nascimento" />
          </span>
          <SanteSelecao
            v-model="tipo"
            :rotulo="t('portal.responsaveis.tipo')"
            :opcoes="opcoes(TIPOS_VINCULO_RESPONSAVEL, 'portal.responsaveis.tipos')"
            :busca="true"
          />
          <SanteSelecao
            v-model="prova"
            :rotulo="t('portal.responsaveis.prova')"
            :opcoes="opcoes(PROVAS_ACEITAS[tipo], 'portal.responsaveis.provas')"
            :busca="true"
          />
          <span v-if="tipo === 'procurador'" class="campo">
            <label for="resp-validade">{{ t('portal.responsaveis.validade') }}</label>
            <input id="resp-validade" v-model="validade" type="date" />
          </span>
          <fieldset>
            <legend>{{ t('portal.interno.vinculos.escopo') }}</legend>
            <label v-for="e in ESCOPOS_VINCULO" :key="e"
              ><input v-model="escopos" type="checkbox" :value="e" />
              {{ t(`portal.responsaveis.escopos.${e}`) }}</label
            >
          </fieldset>
        </template>
        <SanteCampoTexto
          v-if="acao !== 'responsavel' && acao !== 'cancelarTroca'"
          v-model="justificativa"
          :rotulo="t('portal.interno.conta.justificativa')"
          :max-bytes="400"
          multilinha
          obrigatorio
        />
        <span class="campo">
          <label for="conta-portal-senha">{{ t('portal.interno.senha') }}</label>
          <input
            id="conta-portal-senha"
            v-model="senha"
            type="password"
            autocomplete="current-password"
            data-testid="conta-portal-senha"
          />
        </span>
        <SanteBotao
          tipo="submit"
          :rotulo="t('portal.gravar')"
          data-testid="conta-portal-confirmar"
          @acionar="confirmar"
        />
        <SanteBotao variante="texto" :rotulo="t('portal.cancelar')" @acionar="acao = ''" />
      </form>
      <section
        v-if="convite"
        class="conta-portal-convite"
        aria-labelledby="conta-portal-comprovante"
        data-testid="conta-portal-convite"
      >
        <h3 id="conta-portal-comprovante">{{ t('portal.interno.conta.comprovante') }}</h3>
        <p class="conta-portal-codigo" data-testid="conta-portal-codigo">{{ convite.codigo }}</p>
        <p>{{ t('portal.interno.conta.conviteAjuda', { quando: quando(convite.validoAte) }) }}</p>
        <SanteBotao variante="secundario" :rotulo="t('portal.interno.conta.imprimir')" @acionar="imprimir" />
      </section>
      <ErroPortal v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style scoped>
.conta-portal-dados {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.conta-portal-acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.conta-portal-codigo {
  font-family: monospace;
  font-size: 1.5rem;
  letter-spacing: 0.1em;
}
</style>
