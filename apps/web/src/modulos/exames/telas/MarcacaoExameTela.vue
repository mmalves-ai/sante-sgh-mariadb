<script setup lang="ts">
// Marcação de exame (ficha do M18, seção 7): o detalhe com o contato (a leitura é registrada na trilha), o exame
// escolhido, o solicitante e as ações que a situação permite: cancelar com motivo padronizado (o horário volta a
// ficar vago) e remarcar (transferir, como o balcão faz, ou liberar o horário antigo).
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { dataBr, horaDoContrato } from '../../agenda/formato.js';
import { cancelarExame, lerMarcacaoExame, novaChave, remarcarExame } from '../api-exames.js';
import AvisoExame from '../componentes/AvisoExame.vue';
import ErroExame from '../componentes/ErroExame.vue';
import { usarExames } from '../usar-exames.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const roteador = useRouter();
const cliente = useQueryClient();
const { opcoes, opcoesAgenda, pode, motivoGravacao } = usarExames();
const marcacaoId = computed(() => Number(props.id));
/** Cancelada (a marcação não existe mais): a tela fica com o que foi lido e a mensagem. */
const encerrada = ref(false);
const detalhe = useQuery({
  queryKey: computed(() => ['exames', 'marcacao', marcacaoId.value]),
  queryFn: () => lerMarcacaoExame(marcacaoId.value),
  enabled: computed(() => !encerrada.value),
});
const m = computed(() => detalhe.data.value);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const acao = ref<'' | 'cancelar' | 'remarcar'>('');
const motivos = computed(() =>
  (opcoes.data.value?.motivosCancelamento ?? []).map((x) => ({ valor: x.codigo, rotulo: x.texto })),
);
const canais = computed(() =>
  (opcoes.data.value?.canais ?? []).map((c) => ({ valor: c.codigo, rotulo: c.rotulo })),
);
const solicitantes = computed(() =>
  (['paciente', 'hospital', 'profissional'] as const).map((v) => ({
    valor: v,
    rotulo: t(`exames.solicitantes.${v}`),
  })),
);
const modos = computed(() =>
  (['transferir', 'liberar'] as const).map((v) => ({ valor: v, rotulo: t(`exames.marcacao.modos.${v}`) })),
);
const agendas = computed(() => [
  { valor: '', rotulo: t('exames.marcacao.mesmaAgenda') },
  ...opcoesAgenda.value,
]);
const motivo = ref('PAC-DESISTIU');
const solicitante = ref('paciente');
const complemento = ref('');
const modo = ref('transferir');
const destinoAgenda = ref('');
const destinoData = ref('');
const destinoHora = ref('');
const canal = ref('telefone');
const podeCancelar = pode('agenda.cancelarExame');
const podeRemarcar = pode('agenda.remarcarExame');
const ativa = computed(() => !!m.value && !m.value.atendido && !m.value.temSenha);

async function rodar(
  fn: () => Promise<{ mensagem: string; resultado: Record<string, unknown> }>,
  ir?: (r: Record<string, unknown>) => number | null,
  encerra = false,
): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await fn();
    mensagem.value = r.mensagem;
    acao.value = '';
    if (encerra) encerrada.value = true;
    await cliente.invalidateQueries({ queryKey: ['exames'] });
    const destino = ir?.(r.resultado) ?? null;
    if (destino && destino !== marcacaoId.value) await roteador.push(`/agenda/exames/marcacoes/${destino}`);
  } catch (e) {
    erro.value = e;
  }
}
const cancelar = () =>
  rodar(
    () =>
      cancelarExame(
        marcacaoId.value,
        {
          motivo: motivo.value,
          solicitante: solicitante.value,
          ...(complemento.value.trim() ? { complemento: complemento.value } : {}),
        },
        novaChave('cancelar-exame'),
      ),
    undefined,
    true,
  );
const remarcar = () =>
  rodar(
    () =>
      remarcarExame(
        marcacaoId.value,
        {
          destino: {
            agenda: Number(destinoAgenda.value || m.value?.agenda),
            data: destinoData.value,
            hora: horaDoContrato(destinoHora.value) ?? destinoHora.value,
          },
          modo: modo.value,
          canal: canal.value,
          ...(modo.value === 'liberar' ? { motivo: 'PAC-OUTRA-DATA' } : {}),
        },
        novaChave('remarcar-exame'),
      ),
    (r) => Number(r['marcacao']) || null,
  );
</script>

<template>
  <section class="tela-agenda" aria-labelledby="marcacao-exame-titulo" data-testid="tela-marcacao-exame">
    <h1 id="marcacao-exame-titulo">{{ t('exames.marcacao.titulo') }}</h1>
    <AvisoExame :motivo="motivoGravacao" />
    <p class="acoes">
      <RouterLink to="/agenda/exames/marcar">{{ t('exames.marcar.titulo') }}</RouterLink>
      <RouterLink to="/agenda/exames/dia">{{ t('exames.dia.titulo') }}</RouterLink>
    </p>
    <ErroExame v-if="detalhe.isError.value" :erro="detalhe.error.value" />
    <p v-else-if="!m" role="status">{{ t('exames.carregando') }}</p>
    <template v-else>
      <dl class="painel" data-testid="marcacao-exame-dados">
        <div>
          <dt>{{ t('exames.paciente') }}</dt>
          <dd>
            {{ m.pacienteNome
            }}<span v-if="m.prontuario > 0">
              · {{ t('exames.marcacao.prontuario', { n: m.prontuario }) }}</span
            >
          </dd>
        </div>
        <div>
          <dt>{{ t('exames.agenda') }}</dt>
          <dd>{{ m.agendaNome }} · {{ m.categoria }}</dd>
        </div>
        <div>
          <dt>{{ t('exames.marcacao.quando') }}</dt>
          <dd>{{ dataBr(m.data) }} {{ m.hora }}</dd>
        </div>
        <div>
          <dt>{{ t('exames.marcacao.situacao') }}</dt>
          <dd data-testid="marcacao-exame-estado">{{ m.estadoRotulo }}</dd>
        </div>
        <div>
          <dt>{{ t('exames.marcar.exameEscolhido') }}</dt>
          <dd>{{ m.exameEscolhido?.nome ?? t('exames.marcacao.exameNaChegada') }}</dd>
        </div>
        <div v-if="m.solicitante">
          <dt>{{ t('exames.marcar.solicitante') }}</dt>
          <dd>
            {{ m.solicitante.nome }} ·
            {{ t('exames.marcacao.crmUf', { crm: m.solicitante.crm, uf: m.solicitante.uf }) }}
          </dd>
        </div>
        <div>
          <dt>{{ t('exames.convenio') }}</dt>
          <dd>{{ m.convenio }}</dd>
        </div>
        <div>
          <dt>{{ t('exames.marcacao.contato') }}</dt>
          <dd>{{ [m.telefone, m.celular, m.email].filter((x) => x).join(' · ') || '—' }}</dd>
        </div>
        <div v-if="m.observacao">
          <dt>{{ t('exames.observacao') }}</dt>
          <dd>{{ m.observacao }}</dd>
        </div>
        <div>
          <dt>{{ t('exames.marcacao.marcadaPor') }}</dt>
          <dd>{{ m.marcadaPor || '—' }} · {{ dataBr(m.marcadaEm) }}</dd>
        </div>
      </dl>
      <SanteAlerta
        v-if="m.vinculo === 'sem-vinculo'"
        variante="aviso"
        :texto="t('exames.marcacao.semVinculo')"
      />
      <SanteAlerta v-if="m.temSenha" variante="info" :texto="t('exames.marcacao.comSenha')" />
      <SanteAlerta
        v-if="m.estado === 'marcacao-incompleta'"
        variante="aviso"
        :texto="t('exames.marcacao.incompleta')"
      />

      <div v-if="ativa && !encerrada" class="acoes">
        <SanteBotao
          v-if="podeCancelar"
          variante="secundario"
          :rotulo="t('exames.marcacao.cancelar')"
          @acionar="acao = 'cancelar'"
        />
        <SanteBotao
          v-if="podeRemarcar"
          variante="secundario"
          :rotulo="t('exames.marcacao.remarcar')"
          @acionar="acao = 'remarcar'"
        />
      </div>

      <section
        v-if="acao === 'cancelar'"
        class="painel"
        aria-labelledby="cancelar-exame"
        data-testid="form-cancelar-exame"
      >
        <h2 id="cancelar-exame">{{ t('exames.marcacao.cancelar') }}</h2>
        <div class="filtros">
          <SanteSelecao v-model="motivo" :rotulo="t('exames.motivo')" :opcoes="motivos" />
          <SanteSelecao
            v-model="solicitante"
            :rotulo="t('exames.marcacao.quemPediu')"
            :opcoes="solicitantes"
          />
        </div>
        <SanteCampoTexto v-model="complemento" :rotulo="t('exames.complemento')" :max-bytes="200" />
        <div class="acoes">
          <SanteBotao
            variante="destrutivo"
            :rotulo="t('exames.marcacao.confirmarCancelamento')"
            :confirmacao="t('exames.marcacao.cancelarPergunta', { paciente: m.paciente })"
            data-testid="confirmar-cancelamento-exame"
            @acionar="cancelar"
          />
          <SanteBotao variante="texto" :rotulo="t('exames.voltar')" @acionar="acao = ''" />
        </div>
      </section>

      <section
        v-if="acao === 'remarcar'"
        class="painel"
        aria-labelledby="remarcar-exame"
        data-testid="form-remarcar-exame"
      >
        <h2 id="remarcar-exame">{{ t('exames.marcacao.remarcar') }}</h2>
        <div class="filtros">
          <SanteSelecao v-model="destinoAgenda" :rotulo="t('exames.agenda')" :opcoes="agendas" />
          <div class="campo">
            <label for="remarcar-exame-data">{{ t('exames.data') }}</label>
            <input
              id="remarcar-exame-data"
              v-model="destinoData"
              type="date"
              data-testid="remarcar-exame-data"
            />
          </div>
          <div class="campo">
            <label for="remarcar-exame-hora">{{ t('exames.hora') }}</label>
            <input
              id="remarcar-exame-hora"
              v-model="destinoHora"
              inputmode="numeric"
              :placeholder="t('exames.horaExemplo')"
              data-testid="remarcar-exame-hora"
            />
          </div>
          <SanteSelecao v-model="modo" :rotulo="t('exames.marcacao.modo')" :opcoes="modos" />
          <SanteSelecao v-model="canal" :rotulo="t('exames.canal')" :opcoes="canais" />
        </div>
        <p class="secundario">{{ t(`exames.marcacao.modosTexto.${modo}`) }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('exames.marcacao.confirmarRemarcacao')"
            :desabilitado="!destinoData || !horaDoContrato(destinoHora)"
            data-testid="confirmar-remarcacao-exame"
            @acionar="remarcar"
          />
          <SanteBotao variante="texto" :rotulo="t('exames.voltar')" @acionar="acao = ''" />
        </div>
      </section>
    </template>
    <p v-if="mensagem" role="status" data-testid="marcacao-exame-mensagem">{{ mensagem }}</p>
    <ErroExame v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
