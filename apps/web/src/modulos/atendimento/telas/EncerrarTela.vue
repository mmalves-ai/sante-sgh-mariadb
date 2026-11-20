<script setup lang="ts">
// Encerrar e cancelar (ficha do M20, seção 7): `/recepcao/atendimento/:reg/encerrar`. O desfecho codificado (alta,
// encaminhamento, internação, transferência, evasão, óbito, encerramento administrativo): o ato médico só para quem
// tem o desfecho clínico e o conselho ativo (Lei 12.842/2013), a recepção registra a evasão e o encerramento
// administrativo. A exclusão do atendimento aberto por engano é do supervisor: a tela mostra antes o que será
// desfeito (conta, procedimentos, senha) e pede o motivo, a justificativa e a senha de novo. W1-05: com ato clínico ou
// de faturamento ligado, a prévia lista quantos e quais e oferece a anulação (o encerramento administrativo, que mantém
// os registros visíveis); a ficha de um agendamento mostra que a marcação volta a ficar sem atendimento.
import { DESFECHOS } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { pode as podeNaSessao } from '../../../casca/sessao/pode.js';
import {
  cancelarAtendimento,
  encerrarAtendimento,
  lerAtendimento,
  lerPreviaCancelamento,
  novaChave,
} from '../api-atendimento.js';
import AvisoAtendimento from '../componentes/AvisoAtendimento.vue';
import ErroAtendimento from '../componentes/ErroAtendimento.vue';
import ResumoAtendimento from '../componentes/ResumoAtendimento.vue';
import { usarAtendimento } from '../usar-atendimento.js';

const props = defineProps<{ reg: string }>();
const { t } = useI18n();
const roteador = useRouter();
const cliente = useQueryClient();
const { apoio, gravacao, pode, motivoAmbulatorio } = usarAtendimento();
const reg = computed(() => Number(props.reg));
const ficha = useQuery({
  queryKey: computed(() => ['atendimento', 'ficha', reg.value]),
  queryFn: () => lerAtendimento(reg.value),
});
// O ato médico pelo servidor (a permissão e o vínculo do próprio médico com conselho ativo).
const medico = computed(() => gravacao.data.value?.atoMedico.pode ?? false);
const desfechos = computed(() =>
  DESFECHOS.filter((d) => medico.value || !d.atoMedico).map((d) => ({
    valor: d.codigo as string,
    rotulo: d.rotulo,
  })),
);
const desfecho = ref('');
const destino = ref('');
const exigeDestino = computed(
  () => desfecho.value === 'transferencia' || desfecho.value === 'encaminhamento',
);
const podeEncerrar = computed(
  () => pode('atendimento.encerrarAtendimento').value && !ficha.data.value?.desfecho,
);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
// A anulação lógica (W1-05): o encerramento administrativo do atendimento que não pode ser excluído.
async function anular(): Promise<void> {
  desfecho.value = 'administrativo';
  destino.value = '';
  await encerrar();
}
async function encerrar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await encerrarAtendimento(
      reg.value,
      { desfecho: desfecho.value, ...(destino.value.trim() ? { destino: destino.value } : {}) },
      novaChave('encerrar'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['atendimento'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Exclusão (supervisor) ──
const supervisor = podeNaSessao('atendimento.atendimento.cancelar');
const previa = useQuery({
  queryKey: computed(() => ['atendimento', 'previa', reg.value]),
  queryFn: () => lerPreviaCancelamento(reg.value),
  enabled: supervisor,
});
const motivos = computed(() => [
  { valor: '', rotulo: t('atendimento.escolha') },
  ...(apoio.data.value?.motivosExclusao ?? []).map((m) => ({ valor: String(m.codigo), rotulo: m.nome })),
]);
const motivo = ref('');
const justificativa = ref('');
const senha = ref('');
const confirmar = ref(false);
const erroExclusao = ref<unknown>(null);
async function excluir(): Promise<void> {
  erroExclusao.value = null;
  ocupado.value = true;
  try {
    await cancelarAtendimento(
      reg.value,
      { motivo: Number(motivo.value), justificativa: justificativa.value, senha: senha.value },
      novaChave('cancelar'),
    );
    confirmar.value = false;
    await cliente.invalidateQueries({ queryKey: ['atendimento'] });
    await roteador.push('/recepcao/atendimento?excluido=sim');
  } catch (x) {
    erroExclusao.value = x;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="encerrar-titulo" data-testid="tela-encerrar">
    <h1 id="encerrar-titulo">{{ t('atendimento.encerrar.titulo') }}</h1>
    <p>{{ t('atendimento.encerrar.texto') }}</p>
    <AvisoAtendimento :motivo="motivoAmbulatorio" />
    <ErroAtendimento v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!ficha.data.value" role="status">{{ t('atendimento.carregando') }}</p>
    <template v-else>
      <ResumoAtendimento :atendimento="ficha.data.value" atalhos />
      <section v-if="podeEncerrar" class="painel" aria-labelledby="encerrar-desfecho">
        <h2 id="encerrar-desfecho">{{ t('atendimento.encerrar.desfecho') }}</h2>
        <SanteAlerta v-if="!medico" variante="info" :texto="t('atendimento.encerrar.atoMedico')" />
        <SanteOpcoes v-model="desfecho" :legenda="t('atendimento.encerrar.desfecho')" :opcoes="desfechos" />
        <SanteCampoTexto
          v-if="exigeDestino"
          v-model="destino"
          :rotulo="t('atendimento.encerrar.destino')"
          :max-bytes="60"
          obrigatorio
        />
        <SanteBotao
          :rotulo="t('atendimento.encerrar.gravar')"
          :desabilitado="!desfecho || (exigeDestino && !destino.trim()) || ocupado"
          data-testid="botao-encerrar"
          @acionar="encerrar"
        />
      </section>
      <p v-else-if="ficha.data.value.desfecho" data-testid="ja-encerrado">
        {{ t('atendimento.encerrar.jaEncerrado', { desfecho: ficha.data.value.desfecho.rotulo }) }}
      </p>
      <p v-if="mensagem" role="status" data-testid="encerrado">{{ mensagem }}</p>
      <ErroAtendimento v-if="erro" :erro="erro" />

      <section v-if="supervisor" class="painel" aria-labelledby="encerrar-exclusao">
        <h2 id="encerrar-exclusao">{{ t('atendimento.cancelar.titulo') }}</h2>
        <ErroAtendimento v-if="previa.isError.value" :erro="previa.error.value" />
        <template v-else-if="previa.data.value">
          <ul data-testid="previa-exclusao">
            <li>
              {{ previa.data.value.conta.rotulo }} ·
              {{ t('atendimento.procedimentos.itens', { n: previa.data.value.conta.itens }) }}
            </li>
            <li>{{ t('atendimento.cancelar.extras', { n: previa.data.value.procedimentosExtras }) }}</li>
            <li v-if="previa.data.value.senhaVolta">{{ previa.data.value.senhaVolta }}</li>
            <li v-if="previa.data.value.marcacaoVolta" data-testid="previa-marcacao-volta">
              {{ t('atendimento.cancelar.marcacaoVolta', { texto: previa.data.value.marcacaoVolta }) }}
            </li>
          </ul>
          <div v-if="previa.data.value.dependentes?.length" role="alert" data-testid="previa-dependentes">
            <p>
              <strong>{{ t('atendimento.cancelar.dependentesTitulo') }}</strong>
            </p>
            <ul>
              <li v-for="d in previa.data.value.dependentes" :key="d.rotulo">
                {{ t('atendimento.cancelar.dependente', { rotulo: d.rotulo, n: d.quantidade }) }}
                <span v-if="d.amostra.length" class="secundario">
                  ({{ t('atendimento.cancelar.exemplos', { lista: d.amostra.join(', ') }) }})</span
                >
              </li>
            </ul>
            <template v-if="previa.data.value.saida === 'anular' && podeEncerrar">
              <p>{{ t('atendimento.cancelar.anularTexto') }}</p>
              <SanteBotao
                variante="destrutivo"
                :rotulo="t('atendimento.cancelar.anular')"
                :confirmacao="t('atendimento.cancelar.anularTexto')"
                :desabilitado="ocupado"
                data-testid="botao-anular"
                @acionar="anular"
              />
            </template>
          </div>
          <SanteAlerta
            v-if="!previa.data.value.liberada"
            variante="aviso"
            :texto="previa.data.value.motivoLiberacao ?? t('atendimento.emConsulta')"
          />
          <SanteAlerta
            v-else-if="!previa.data.value.pode && !previa.data.value.dependentes?.length"
            variante="alerta"
            :texto="previa.data.value.motivo ?? ''"
          />
          <template v-else-if="!previa.data.value.pode" />
          <template v-else>
            <div class="filtros">
              <SanteSelecao v-model="motivo" :rotulo="t('atendimento.cancelar.motivo')" :opcoes="motivos" />
            </div>
            <SanteCampoTexto
              v-model="justificativa"
              :rotulo="t('atendimento.cancelar.justificativa')"
              :max-bytes="80"
              obrigatorio
            />
            <SanteBotao
              variante="destrutivo"
              :rotulo="t('atendimento.cancelar.excluir')"
              :confirmacao="t('atendimento.cancelar.confirmarTexto')"
              :desabilitado="!motivo || justificativa.trim().length < 10"
              data-testid="botao-excluir"
              @acionar="confirmar = true"
            />
          </template>
        </template>
      </section>
      <SanteDialogo v-model:visivel="confirmar" :titulo="t('atendimento.cancelar.confirmar')">
        <form class="filtros" @submit.prevent="excluir">
          <p>{{ t('atendimento.cancelar.confirmarTexto') }}</p>
          <div class="campo">
            <label for="excluir-senha">{{ t('atendimento.cancelar.senha') }}</label>
            <input
              id="excluir-senha"
              v-model="senha"
              type="password"
              autocomplete="current-password"
              data-testid="excluir-senha"
            />
          </div>
          <SanteBotao
            tipo="submit"
            :rotulo="t('atendimento.cancelar.excluir')"
            :desabilitado="!senha || ocupado"
            data-testid="botao-confirmar-exclusao"
          />
          <ErroAtendimento v-if="erroExclusao" :erro="erroExclusao" />
        </form>
      </SanteDialogo>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
