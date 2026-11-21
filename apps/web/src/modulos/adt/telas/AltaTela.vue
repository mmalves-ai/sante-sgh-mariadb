<script setup lang="ts">
// Alta hospitalar em dois tempos (ficha do M21, seção 7): `/internacao/:reg/alta`. A alta médica (motivo, destino,
// previsão da saída) é ato médico: só o médico com o conselho ativo registra (o servidor confere). A saída (alta
// administrativa) vem depois, pela recepção: o motivo vem da alta médica, a hora é a da saída, o leito vai à
// higienização. O supervisor cancela a alta dada por engano e exclui a internação aberta por engano, com a senha de novo.
import { DESTINOS_ALTA } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { pode as podeNaSessao } from '../../../casca/sessao/pode.js';
import { dataBr } from '../../agenda/formato.js';
import {
  cancelarAlta,
  cancelarAltaMedica,
  darAlta,
  excluirInternacao,
  novaChave,
  registrarAltaMedica,
} from '../api-adt.js';
import AvisoAdt from '../componentes/AvisoAdt.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import ResumoInternacao from '../componentes/ResumoInternacao.vue';
import { usarAdt } from '../usar-adt.js';
import { usarInternacao } from '../usar-internacao.js';

const props = defineProps<{ reg: string }>();
const { t, te } = useI18n();
const roteador = useRouter();
const { apoio, gravacao, pode, motivoDe } = usarAdt();
const reg = computed(() => Number(props.reg));
const { ficha, recarregar } = usarInternacao(reg);
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function executar(fn: () => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    mensagem.value = (await fn()).mensagem;
    await recarregar();
    return true;
  } catch (x) {
    erro.value = x;
    await recarregar();
    return false;
  } finally {
    ocupado.value = false;
  }
}
const grupo = (g: string) => (te(`adt.alta.grupos.${g}`) ? t(`adt.alta.grupos.${g}`) : g);
const motivos = computed(() => [
  { valor: '', rotulo: t('adt.escolha') },
  ...(apoio.data.value?.motivosAlta ?? []).map((m) => ({
    valor: String(m.codigo),
    rotulo: `${m.nome} (${grupo(m.grupo)})`,
  })),
]);
const destinos = computed(() => [
  { valor: '', rotulo: t('adt.escolha') },
  ...DESTINOS_ALTA.map((d) => ({ valor: d.codigo as string, rotulo: d.rotulo })),
]);
const nomeMotivo = (c: number) =>
  apoio.data.value?.motivosAlta.find((m) => m.codigo === c)?.nome ?? String(c);
const nomeDestino = (c: string) => DESTINOS_ALTA.find((d) => d.codigo === c)?.rotulo ?? c;

// ── Alta médica ──
const altaMedica = computed(() => gravacao.data.value?.altaMedica ?? { pode: false, motivo: null });
const motivoMedica = ref('');
const destino = ref('');
const previsao = ref('');
const observacao = ref('');
const registrar = () =>
  executar(() =>
    registrarAltaMedica(
      reg.value,
      {
        motivo: Number(motivoMedica.value),
        destino: destino.value,
        ...(previsao.value ? { previsaoSaida: previsao.value } : {}),
        ...(observacao.value.trim() ? { observacao: observacao.value.trim() } : {}),
      },
      novaChave('alta-medica'),
    ),
  );
const motivoCancelaMedica = ref('');
const cancelarMedica = () =>
  executar(() =>
    cancelarAltaMedica(reg.value, { motivo: motivoCancelaMedica.value.trim() }, novaChave('cancelar-medica')),
  );

// ── Saída ──
const podeSaida = pode('internacao.darAlta');
const avisoSaida = motivoDe('internacao.darAlta');
const horaSaida = ref('');
const motivoSaida = ref('');
const saida = () => {
  const f = ficha.data.value;
  if (!f) return Promise.resolve(false);
  return executar(() =>
    darAlta(
      reg.value,
      {
        versao: f.versao,
        ...(horaSaida.value ? { horaSaida: horaSaida.value } : {}),
        ...(motivoSaida.value ? { motivo: Number(motivoSaida.value) } : {}),
      },
      novaChave('saida'),
    ),
  );
};

// ── Supervisor ──
const supervisorAlta = podeNaSessao('internacao.alta.cancelar');
const supervisorExclui = podeNaSessao('internacao.internacao.excluir');
const avisoSupervisor = motivoDe('internacao.cancelarAlta', 'internacao.excluirInternacao');
const justificativa = ref('');
const confirmaConta = ref(false);
const confirmaPeriodos = ref(false);
const motivoExclusao = ref('');
const dialogo = ref<'cancelar' | 'excluir' | null>(null);
const visivel = computed({
  get: () => dialogo.value !== null,
  set: (v: boolean) => {
    if (!v) dialogo.value = null;
  },
});
const senha = ref('');
const motivosExclusao = computed(() => [
  { valor: '', rotulo: t('adt.escolha') },
  ...(apoio.data.value?.motivosExclusao ?? []).map((m) => ({ valor: String(m.codigo), rotulo: m.nome })),
]);
async function confirmar(): Promise<void> {
  const qual = dialogo.value;
  const s = senha.value;
  senha.value = '';
  if (qual === 'cancelar') {
    if (
      await executar(() =>
        cancelarAlta(
          reg.value,
          { justificativa: justificativa.value.trim(), senha: s },
          novaChave('cancelar-alta'),
        ),
      )
    )
      dialogo.value = null;
  } else if (qual === 'excluir') {
    const ok = await executar(() =>
      excluirInternacao(
        reg.value,
        {
          justificativa: justificativa.value.trim(),
          confirmaApagarConta: confirmaConta.value,
          confirmaApagarPeriodos: confirmaPeriodos.value,
          ...(motivoExclusao.value ? { motivo: Number(motivoExclusao.value) } : {}),
          senha: s,
        },
        novaChave('excluir-internacao'),
      ),
    );
    if (ok) {
      dialogo.value = null;
      await roteador.push('/internacao');
    }
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="alta-titulo" data-testid="tela-alta">
    <h1 id="alta-titulo">{{ t('adt.alta.titulo') }}</h1>
    <p>{{ t('adt.alta.texto') }}</p>
    <ErroAdt v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!ficha.data.value" role="status">{{ t('adt.carregando') }}</p>
    <template v-else>
      <ResumoInternacao :internacao="ficha.data.value" atalhos />
      <SanteAlerta
        v-if="ficha.data.value.reinternacao30"
        variante="info"
        :texto="t('adt.alta.reinternacao')"
      />
      <p v-if="mensagem" role="status" data-testid="alta-mensagem">{{ mensagem }}</p>
      <ErroAdt v-if="erro" :erro="erro" />

      <section v-if="ficha.data.value.saida" class="painel" data-testid="alta-saida-feita">
        <p>
          {{
            t('adt.alta.saidaFeita', {
              data: dataBr(ficha.data.value.alta),
              motivo: ficha.data.value.saida.motivo.nome,
              grupo: grupo(ficha.data.value.saida.grupo),
              diarias: ficha.data.value.saida.diariasFaturaveis,
              perm: ficha.data.value.saida.permanencia312,
            })
          }}
        </p>
      </section>

      <template v-else>
        <section class="painel" aria-labelledby="alta-medica">
          <h2 id="alta-medica">{{ t('adt.alta.medica') }}</h2>
          <p v-if="ficha.data.value.altaMedica" data-testid="alta-medica-decidida">
            {{
              t('adt.alta.decidida', {
                em: ficha.data.value.altaMedica.decididaEm.replace('T', ' ').slice(0, 16),
                motivo: nomeMotivo(ficha.data.value.altaMedica.motivo),
                destino: nomeDestino(ficha.data.value.altaMedica.destino),
              })
            }}
          </p>
          <SanteAlerta
            v-if="!altaMedica.pode"
            variante="info"
            :texto="altaMedica.motivo ?? t('adt.alta.atoMedico')"
          />
          <template v-else-if="!ficha.data.value.altaMedica">
            <div class="filtros">
              <SanteSelecao
                v-model="motivoMedica"
                :rotulo="t('adt.motivo')"
                :opcoes="motivos"
                data-testid="alta-medica-motivo"
              />
              <SanteSelecao
                v-model="destino"
                :rotulo="t('adt.alta.destino')"
                :opcoes="destinos"
                data-testid="alta-medica-destino"
              />
              <div class="campo">
                <label for="alta-previsao">{{ t('adt.alta.previsao') }}</label>
                <input id="alta-previsao" v-model="previsao" type="time" />
              </div>
            </div>
            <SanteCampoTexto v-model="observacao" :rotulo="t('adt.observacao')" :max-bytes="200" multilinha />
            <SanteBotao
              :rotulo="t('adt.alta.registrarMedica')"
              :desabilitado="!motivoMedica || !destino || ocupado"
              data-testid="alta-medica-gravar"
              @acionar="registrar"
            />
          </template>
          <template v-else>
            <SanteCampoTexto
              v-model="motivoCancelaMedica"
              :rotulo="t('adt.alta.motivoCancelamento')"
              :max-bytes="200"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('adt.alta.cancelarMedica')"
              :desabilitado="motivoCancelaMedica.trim().length < 5 || ocupado"
              @acionar="cancelarMedica"
            />
          </template>
        </section>

        <section class="painel" aria-labelledby="alta-saida">
          <h2 id="alta-saida">{{ t('adt.alta.administrativa') }}</h2>
          <AvisoAdt :motivo="avisoSaida" />
          <p v-if="!ficha.data.value.altaMedica" class="secundario" data-testid="alta-sem-medica">
            {{ t('adt.alta.semMedica') }}
          </p>
          <template v-else-if="podeSaida">
            <div class="filtros">
              <SanteSelecao v-model="motivoSaida" :rotulo="t('adt.motivo')" :opcoes="motivos" />
              <div class="campo">
                <label for="alta-hora">{{ t('adt.alta.horaSaida') }}</label>
                <input id="alta-hora" v-model="horaSaida" type="time" data-testid="alta-hora" />
              </div>
            </div>
            <SanteBotao
              :rotulo="t('adt.alta.registrarSaida')"
              :desabilitado="ocupado"
              data-testid="alta-saida-gravar"
              @acionar="saida"
            />
          </template>
        </section>
      </template>

      <section v-if="supervisorAlta || supervisorExclui" class="painel" aria-labelledby="alta-supervisor">
        <h2 id="alta-supervisor">{{ t('adt.alta.supervisor') }}</h2>
        <AvisoAdt :motivo="avisoSupervisor" />
        <SanteCampoTexto
          v-model="justificativa"
          :rotulo="t('adt.justificativa')"
          :max-bytes="80"
          data-testid="supervisor-justificativa"
        />
        <template v-if="supervisorAlta && ficha.data.value.alta">
          <p class="secundario">{{ t('adt.alta.cancelarAltaTexto') }}</p>
          <SanteBotao
            variante="secundario"
            :rotulo="t('adt.alta.cancelarAlta')"
            :desabilitado="justificativa.trim().length < 10"
            data-testid="botao-cancelar-alta"
            @acionar="dialogo = 'cancelar'"
          />
        </template>
        <template v-if="supervisorExclui && !ficha.data.value.alta">
          <p class="secundario">{{ t('adt.alta.excluirTexto') }}</p>
          <div class="filtros">
            <SanteSelecao
              v-if="motivosExclusao.length > 1"
              v-model="motivoExclusao"
              :rotulo="t('adt.motivo')"
              :opcoes="motivosExclusao"
            />
            <label
              ><input v-model="confirmaConta" type="checkbox" data-testid="confirma-conta" />
              {{ t('adt.alta.confirmaConta') }}</label
            >
            <label
              ><input v-model="confirmaPeriodos" type="checkbox" data-testid="confirma-periodos" />
              {{ t('adt.alta.confirmaPeriodos') }}</label
            >
          </div>
          <SanteBotao
            variante="secundario"
            :rotulo="t('adt.alta.excluir')"
            :desabilitado="justificativa.trim().length < 10 || !confirmaConta || !confirmaPeriodos"
            data-testid="botao-excluir-internacao"
            @acionar="dialogo = 'excluir'"
          />
        </template>
      </section>
      <SanteDialogo v-model:visivel="visivel" :titulo="t('adt.alta.confirmar')">
        <form class="filtros" @submit.prevent="confirmar">
          <div class="campo">
            <label for="alta-senha">{{ t('adt.senhaConfirma') }}</label>
            <input
              id="alta-senha"
              v-model="senha"
              type="password"
              autocomplete="current-password"
              data-testid="supervisor-senha"
            />
          </div>
          <SanteBotao
            tipo="submit"
            variante="destrutivo"
            :confirmacao="
              dialogo === 'excluir' ? t('adt.alta.excluirTexto') : t('adt.alta.cancelarAltaTexto')
            "
            :rotulo="dialogo === 'excluir' ? t('adt.alta.excluir') : t('adt.alta.cancelarAlta')"
            :desabilitado="!senha || ocupado"
            data-testid="supervisor-confirmar"
          />
          <ErroAdt v-if="erro" :erro="erro" />
        </form>
      </SanteDialogo>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
