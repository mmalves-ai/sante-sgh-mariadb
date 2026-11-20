<script setup lang="ts">
// Visualização e impressão do registro gravado (ficha do M22, seção 7): `/pep/:paciente/registro/:id`. O mesmo
// FormRenderer em visualização (e em impressão: só o que foi respondido, sem as ações), com a prova (o conteúdo
// confere com o hash guardado, ou foi alterado no outro sistema depois) e a suspensão com justificativa e senha
// (o original continua visível, marcado suspenso). Toda abertura vai à trilha; a primeira do paciente na sessão
// pede o motivo do acesso. Corretor: o registro suspenso oferece "Registrar correção" (o mesmo modelo, ligado ao
// original, como o legado); a correção mostra o registro que corrige; o feito numa sessão "como" leva a marca do
// suporte técnico na tela e na impressão (ADR 0021, R1).
import {
  MOTIVOS_ACESSO_PRONTUARIO,
  type MotivoAcessoProntuario,
  ROTULOS_MOTIVO_ACESSO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  codigoDoErro,
  informarMotivoRegistro,
  novaChave,
  suspenderRegistro,
  visualizarRegistro,
} from '../api-registro.js';
import FormRenderer from '../componentes/formulario/FormRenderer.vue';
import { dataHoraBr } from '../formato.js';

const props = defineProps<{ paciente: string; id: string }>();
const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const idPaciente = computed(() => Number(props.paciente));
const idRegistro = computed(() => Number(props.id));
const finalizado = computed(() => rota.query['finalizado'] === '1');

const reg = useQuery({
  queryKey: computed(() => ['pep', 'reg', 'ver', idPaciente.value, idRegistro.value]),
  queryFn: () => visualizarRegistro(idPaciente.value, idRegistro.value),
  retry: false,
  staleTime: 0,
});
const r = computed(() => reg.data.value);
const pedeMotivo = computed(() => codigoDoErro(reg.error.value) === 'motivo-necessario');
const motivo = ref<MotivoAcessoProntuario | ''>('');
const opcoesMotivo = computed(() => [
  { valor: '' as const, rotulo: '' },
  ...MOTIVOS_ACESSO_PRONTUARIO.map((m) => ({ valor: m, rotulo: ROTULOS_MOTIVO_ACESSO[m] })),
]);
async function informar(): Promise<void> {
  if (!motivo.value) return;
  await informarMotivoRegistro(idPaciente.value, motivo.value);
  await reg.refetch();
}

const respostas = computed(() => Object.fromEntries((r.value?.respostas ?? []).map((x) => [x.vinculo, x])));
const modo = ref<'visualizacao' | 'impressao'>('visualizacao');
async function imprimir(): Promise<void> {
  modo.value = 'impressao';
  await nextTick();
  window.print();
  modo.value = 'visualizacao';
}

// ── Suspensão ───────────────────────────────────────────────────────────────────────────────────
const suspender = ref(false);
const justificativa = ref('');
const senha = ref('');
const erro = ref<unknown>(null);
const ok = ref(false);
const textoErro = computed(() => {
  const c = codigoDoErro(erro.value);
  const k = c ? `pep.reg.erros.${c}` : null;
  return k && t(k) !== k ? t(k) : null;
});
async function confirmarSuspensao(): Promise<void> {
  erro.value = null;
  try {
    await suspenderRegistro(
      idPaciente.value,
      idRegistro.value,
      justificativa.value.trim(),
      senha.value,
      novaChave('suspensao'),
    );
    suspender.value = false;
    senha.value = '';
    ok.value = true;
    await cliente.invalidateQueries({ queryKey: ['pep', 'reg', 'ver', idPaciente.value, idRegistro.value] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="ver-titulo" data-testid="tela-registro-visualizacao">
    <h1 id="ver-titulo">
      {{ t('pep.reg.ver.titulo') }}<template v-if="r">: {{ r.modelo.nome }}</template>
    </h1>
    <p class="nao-imprimir">
      <RouterLink :to="`/pep/${idPaciente}/registro`">{{ t('pep.reg.ver.novo') }}</RouterLink>
    </p>
    <p v-if="finalizado" role="status" data-testid="registro-finalizado">
      {{ t('pep.reg.registro.finalizado') }}
    </p>
    <p v-if="ok" role="status" data-testid="registro-suspenso-ok">{{ t('pep.reg.ver.suspensoOk') }}</p>

    <form v-if="pedeMotivo" class="motivo" data-testid="motivo-registro" @submit.prevent="informar">
      <h2>{{ t('pep.reg.ver.motivoTitulo') }}</h2>
      <p>{{ t('pep.reg.ver.motivoTexto') }}</p>
      <SanteSelecao v-model="motivo" :rotulo="t('pep.reg.ver.motivoCampo')" :opcoes="opcoesMotivo" />
      <SanteBotao tipo="submit" :rotulo="t('pep.reg.ver.motivoConfirmar')" :desabilitado="!motivo" />
    </form>
    <MensagemErro v-else-if="reg.isError.value" :erro="reg.error.value" />
    <p v-else-if="!r" role="status">{{ t('pep.reg.carregando') }}</p>
    <template v-else>
      <dl class="resumo" data-testid="resumo-registro-clinico">
        <div>
          <dt>{{ t('pep.reg.registro.modelo') }}</dt>
          <dd>{{ r.modelo.codigo }} · {{ r.modelo.nome }}</dd>
        </div>
        <div>
          <dt>{{ t('pep.reg.registro.horario') }}</dt>
          <dd>{{ dataHoraBr(r.dataHoraClinica) }}</dd>
        </div>
        <div>
          <dt>{{ t('pep.reg.ver.gravadoEm') }}</dt>
          <dd>{{ dataHoraBr(r.lancadoEm) }} · {{ r.profissional ?? '' }}</dd>
        </div>
      </dl>
      <p v-for="(m, i) in r.marcas" :key="i" class="marca-suporte" data-testid="marca-suporte">
        <strong>{{ m }}</strong>
      </p>
      <p v-if="r.corrige" data-testid="registro-corrige">
        <RouterLink :to="`/pep/${idPaciente}/registro/${r.corrige}`">
          {{ t('pep.reg.ver.corrige', { n: r.corrige }) }}
        </RouterLink>
      </p>
      <SanteAlerta
        v-if="r.suspenso"
        variante="alerta"
        :texto="t('pep.reg.ver.suspenso')"
        data-testid="marca-suspenso"
      />
      <p v-if="r.suspenso && r.justificativaSuspensao">
        {{ t('pep.reg.ver.justificativa', { texto: r.justificativaSuspensao }) }}
      </p>
      <SanteAlerta
        class="nao-imprimir"
        :variante="r.prova.situacao === 'alterado' ? 'aviso' : 'info'"
        :texto="t(`pep.reg.ver.prova.${r.prova.situacao}`)"
        data-testid="prova-registro"
      />
      <FormRenderer :campos="r.campos" :respostas="respostas" :titulo="r.modelo.nome ?? ''" :modo="modo" />
      <div class="acoes nao-imprimir">
        <SanteBotao
          variante="secundario"
          :rotulo="t('pep.reg.ver.imprimir')"
          data-testid="imprimir-registro"
          @acionar="imprimir"
        />
        <SanteBotao
          v-if="r.podeSuspender"
          variante="secundario"
          :rotulo="t('pep.reg.ver.suspender')"
          data-testid="suspender-registro"
          @acionar="suspender = true"
        />
        <RouterLink
          v-if="r.podeCorrigir && r.modelo.codigo"
          class="link-acao"
          :to="{
            path: `/pep/${idPaciente}/registro/${r.modelo.codigo}`,
            query: { corrige: String(idRegistro) },
          }"
          data-testid="corrigir-registro"
        >
          {{ t('pep.reg.ver.corrigir') }}
        </RouterLink>
      </div>
      <SanteDialogo v-model:visivel="suspender" :titulo="t('pep.reg.ver.suspenderTitulo')">
        <p>{{ t('pep.reg.ver.suspenderTexto') }}</p>
        <label for="ver-justificativa" class="rotulo">{{ t('pep.reg.ver.justificativaCampo') }}</label>
        <textarea id="ver-justificativa" v-model="justificativa" maxlength="200" rows="3" class="entrada" />
        <label for="ver-senha" class="rotulo">{{ t('pep.reg.ver.senha') }}</label>
        <input
          id="ver-senha"
          v-model="senha"
          type="password"
          autocomplete="current-password"
          class="entrada"
        />
        <SanteAlerta v-if="textoErro" variante="alerta" :texto="textoErro" />
        <MensagemErro v-else-if="erro" :erro="erro" />
        <template #rodape>
          <SanteBotao
            variante="secundario"
            :rotulo="t('pep.reg.registro.fechar')"
            @acionar="suspender = false"
          />
          <SanteBotao
            variante="primario"
            :rotulo="t('pep.reg.ver.confirmarSuspensao')"
            :desabilitado="justificativa.trim().length < 10 || !senha"
            @acionar="confirmarSuspensao"
          />
        </template>
      </SanteDialogo>
    </template>
  </section>
</template>

<style scoped>
.tela {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
  max-width: 72rem;
}
.resumo {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2) var(--sgh-espaco-5);
  margin: 0;
}
.resumo dt {
  font-weight: 600;
}
.resumo dd {
  margin: 0;
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
}
.link-acao {
  font-weight: 600;
}
.marca-suporte {
  margin: 0;
}
.motivo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
  max-width: 32rem;
}
.rotulo {
  font-weight: 600;
  display: block;
  margin-top: var(--sgh-espaco-2);
}
.entrada {
  font: inherit;
  width: 100%;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
@media print {
  .nao-imprimir {
    display: none !important;
  }
}
</style>
