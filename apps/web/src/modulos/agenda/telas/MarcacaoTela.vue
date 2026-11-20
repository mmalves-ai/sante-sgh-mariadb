<script setup lang="ts">
// Marcação (ficha do M17, seção 7): o detalhe com o contato (a leitura é registrada na trilha), as tentativas de
// confirmação e as ações que a situação permite: cancelar com motivo padronizado, remarcar (transferir ou
// liberar), confirmar ou registrar a tentativa, registrar a falta e desfazer o encaixe.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  cancelarMarcacao,
  confirmar,
  desfazerEncaixe,
  lerMarcacao,
  novaChave,
  registrarFalta,
  remarcar,
} from '../api-agenda.js';
import { pode as podePermissao } from '../../../casca/sessao/pode.js';
import { ofereceAbertura } from '../../atendimento/regras-tela.js';
import AvisoGravacao from '../componentes/AvisoGravacao.vue';
import ErroAgenda from '../componentes/ErroAgenda.vue';
import { dataBr, horaBr, horaDoContrato } from '../formato.js';
import { usarAgenda } from '../usar-agenda.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const roteador = useRouter();
const cliente = useQueryClient();
const { opcoes, opcoesAgenda, pode, motivoGravacao } = usarAgenda();
const marcacaoId = computed(() => Number(props.id));
const detalhe = useQuery({
  queryKey: computed(() => ['agenda', 'marcacao', marcacaoId.value]),
  queryFn: () => lerMarcacao(marcacaoId.value),
});
const m = computed(() => detalhe.data.value);
const podeAbrirAtendimento = podePermissao('atendimento.atendimento.abrir');
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const acao = ref<'' | 'cancelar' | 'remarcar' | 'confirmar'>('');

const motivos = computed(() =>
  (opcoes.data.value?.motivosCancelamento ?? []).map((x) => ({ valor: x.codigo, rotulo: x.texto })),
);
const canais = computed(() =>
  (opcoes.data.value?.canais ?? []).map((c) => ({ valor: c.codigo, rotulo: c.rotulo })),
);
const resultados = computed(() =>
  (opcoes.data.value?.resultadosConfirmacao ?? []).map((r) => ({ valor: r.codigo, rotulo: r.rotulo })),
);
const solicitantes = computed(() =>
  (['paciente', 'hospital', 'profissional'] as const).map((v) => ({
    valor: v,
    rotulo: t(`agenda.marcacao.solicitantes.${v}`),
  })),
);
const modos = computed(() =>
  (['transferir', 'liberar'] as const).map((v) => ({ valor: v, rotulo: t(`agenda.marcacao.modos.${v}`) })),
);

const motivo = ref('PAC-DESISTIU');
const solicitante = ref('paciente');
const complemento = ref('');
const modo = ref('transferir');
const destinoAgenda = ref('');
const destinoData = ref('');
const destinoHora = ref('');
const canal = ref('telefone');
const resultado = ref('confirmado');
const obsConfirmacao = ref('');

const podeCancelar = pode('agenda.cancelarConsulta');
const podeRemarcar = pode('agenda.remarcarConsulta');
const podeConfirmar = pode('agenda.confirmarConsulta');
const podeFalta = pode('agenda.registrarFalta');
const podeDesfazer = pode('agenda.desfazerEncaixe');

async function rodar(
  fn: () => Promise<{ mensagem: string; resultado: Record<string, unknown> }>,
  irPara?: (r: Record<string, unknown>) => number | null,
): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await fn();
    mensagem.value = r.mensagem;
    acao.value = '';
    await cliente.invalidateQueries({ queryKey: ['agenda'] });
    const destino = irPara?.(r.resultado) ?? null;
    if (destino && destino !== marcacaoId.value)
      await roteador.push(`/agenda/consultas/marcacoes/${destino}`);
  } catch (e) {
    erro.value = e;
  }
}
const cancelar = () =>
  rodar(() =>
    cancelarMarcacao(
      marcacaoId.value,
      {
        motivo: motivo.value,
        solicitante: solicitante.value,
        ...(complemento.value.trim() ? { complemento: complemento.value } : {}),
      },
      novaChave('cancelar'),
    ),
  );
const fazerRemarcacao = () =>
  rodar(
    () =>
      remarcar(
        marcacaoId.value,
        {
          destino: {
            agenda: Number(destinoAgenda.value || m.value?.agenda),
            data: destinoData.value,
            hora: horaDoContrato(destinoHora.value) ?? destinoHora.value,
          },
          modo: modo.value,
          canal: canal.value,
        },
        novaChave('remarcar'),
      ),
    (r) => Number(r['marcacao']) || null,
  );
const fazerConfirmacao = () =>
  rodar(() =>
    confirmar(
      marcacaoId.value,
      {
        resultado: resultado.value,
        canal: canal.value,
        ...(obsConfirmacao.value.trim() ? { observacao: obsConfirmacao.value } : {}),
      },
      novaChave('confirmar'),
    ),
  );
const falta = () => rodar(() => registrarFalta(marcacaoId.value, novaChave('falta')));
const desfazer = () => rodar(() => desfazerEncaixe(marcacaoId.value, {}, novaChave('desfazer')));
</script>

<template>
  <section class="tela-agenda" aria-labelledby="marcacao-titulo" data-testid="tela-marcacao">
    <RouterLink to="/agenda/consultas/dia">{{ t('agenda.dia.titulo') }}</RouterLink>
    <ErroAgenda v-if="detalhe.isError.value" :erro="detalhe.error.value" />
    <p v-else-if="!m" role="status">{{ t('agenda.carregando') }}</p>
    <template v-else>
      <h1 id="marcacao-titulo">{{ t('agenda.marcacao.titulo', { paciente: m.paciente }) }}</h1>
      <AvisoGravacao :motivo="motivoGravacao" />
      <dl class="dados" data-testid="marcacao-dados">
        <dt>{{ t('agenda.agenda') }}</dt>
        <dd>{{ m.nomeAgenda }}</dd>
        <dt>{{ t('agenda.data') }}</dt>
        <dd>
          {{ dataBr(m.data) }} {{ horaBr(m.hora)
          }}<template v-if="m.encaixe"> · {{ t('agenda.estados.encaixe') }}</template>
        </dd>
        <dt>{{ t('agenda.marcacao.situacao') }}</dt>
        <dd data-testid="marcacao-estado">{{ t(`agenda.estados.${m.estado}`) }}</dd>
        <dt>{{ t('agenda.convenio') }}</dt>
        <dd>
          {{ m.nomeConvenio ?? m.convenio
          }}<template v-if="m.retorno"> · {{ t('agenda.marcar.retorno') }}</template>
        </dd>
        <dt>{{ t('agenda.canal') }}</dt>
        <dd>{{ m.canal }}</dd>
        <dt>{{ t('agenda.marcacao.telefone') }}</dt>
        <dd>{{ m.telefone || '—' }}</dd>
        <dt>{{ t('agenda.marcacao.celular') }}</dt>
        <dd>{{ m.celular || '—' }}</dd>
        <dt>{{ t('agenda.observacao') }}</dt>
        <dd>{{ m.observacao ?? '—' }}</dd>
        <dt>{{ t('agenda.marcacao.marcadaPor') }}</dt>
        <dd>{{ m.marcadaPor ?? '—' }} · {{ dataBr(m.marcadaEm) }}</dd>
        <dt>{{ t('agenda.risco.titulo') }}</dt>
        <dd>
          {{ t(`agenda.risco.${m.risco.nivel}`) }}
          <template v-if="m.risco.percentual !== null">
            ({{ t('agenda.risco.percentual', { p: m.risco.percentual }) }})</template
          >
        </dd>
      </dl>
      <SanteAlerta v-if="m.temSenha" variante="info" :texto="t('agenda.marcacao.comSenha')" />

      <section class="painel" aria-labelledby="marcacao-confirmacoes">
        <h2 id="marcacao-confirmacoes">{{ t('agenda.marcacao.confirmacoes') }}</h2>
        <p v-if="m.confirmacoes.length === 0">{{ t('agenda.marcacao.semConfirmacao') }}</p>
        <ul v-else>
          <li v-for="(c, i) in m.confirmacoes" :key="i">{{ c.rotulo }} · {{ c.em }} · {{ c.por }}</li>
        </ul>
      </section>

      <div class="acoes" data-testid="marcacao-acoes">
        <RouterLink
          v-if="podeAbrirAtendimento && ofereceAbertura(m, hoje)"
          :to="`/recepcao/atendimento/novo?marcacao=${m.id}`"
          data-testid="marcacao-abrir-atendimento"
          >{{ t('agenda.dia.abrirAtendimento') }}</RouterLink
        >
        <SanteBotao
          v-if="m.acoes.confirmar && podeConfirmar"
          variante="secundario"
          :rotulo="t('agenda.marcacao.confirmar')"
          @acionar="acao = 'confirmar'"
        />
        <SanteBotao
          v-if="m.acoes.remarcar && podeRemarcar"
          variante="secundario"
          :rotulo="t('agenda.marcacao.remarcar')"
          @acionar="acao = 'remarcar'"
        />
        <SanteBotao
          v-if="m.acoes.cancelar && podeCancelar"
          variante="secundario"
          :rotulo="t('agenda.marcacao.cancelar')"
          @acionar="acao = 'cancelar'"
        />
        <SanteBotao
          v-if="m.acoes.registrarFalta && podeFalta"
          variante="destrutivo"
          :rotulo="t('agenda.marcacao.falta')"
          :confirmacao="t('agenda.marcacao.faltaPergunta', { paciente: m.paciente })"
          @acionar="falta"
        />
        <SanteBotao
          v-if="m.acoes.desfazerEncaixe && podeDesfazer"
          variante="destrutivo"
          :rotulo="t('agenda.marcacao.desfazer')"
          :confirmacao="t('agenda.marcacao.desfazerPergunta', { paciente: m.paciente })"
          @acionar="desfazer"
        />
      </div>

      <form v-if="acao === 'cancelar'" class="painel" data-testid="form-cancelar" @submit.prevent="cancelar">
        <h2>{{ t('agenda.marcacao.cancelar') }}</h2>
        <div class="filtros">
          <SanteSelecao v-model="motivo" :rotulo="t('agenda.motivo')" :opcoes="motivos" />
          <SanteSelecao
            v-model="solicitante"
            :rotulo="t('agenda.marcacao.solicitante')"
            :opcoes="solicitantes"
          />
        </div>
        <SanteCampoTexto v-model="complemento" :rotulo="t('agenda.complemento')" :max-bytes="200" />
        <div class="acoes">
          <SanteBotao
            variante="destrutivo"
            :rotulo="t('agenda.marcacao.cancelar')"
            :confirmacao="t('agenda.marcacao.cancelarPergunta', { paciente: m.paciente })"
            data-testid="confirmar-cancelamento"
            @acionar="cancelar"
          />
          <SanteBotao variante="texto" :rotulo="t('agenda.fechar')" @acionar="acao = ''" />
        </div>
      </form>

      <form
        v-if="acao === 'remarcar'"
        class="painel"
        data-testid="form-remarcar"
        @submit.prevent="fazerRemarcacao"
      >
        <h2>{{ t('agenda.marcacao.remarcar') }}</h2>
        <SanteSelecao v-model="modo" :rotulo="t('agenda.marcacao.modo')" :opcoes="modos" />
        <fieldset class="filtros">
          <legend>{{ t('agenda.marcacao.destino') }}</legend>
          <SanteSelecao
            v-model="destinoAgenda"
            :rotulo="t('agenda.agenda')"
            :opcoes="[{ valor: '', rotulo: m.nomeAgenda }, ...opcoesAgenda]"
          />
          <div class="campo">
            <label for="remarcar-data">{{ t('agenda.data') }}</label>
            <input
              id="remarcar-data"
              v-model="destinoData"
              type="date"
              required
              data-testid="remarcar-data"
            />
          </div>
          <div class="campo">
            <label for="remarcar-hora">{{ t('agenda.hora') }}</label>
            <input
              id="remarcar-hora"
              v-model="destinoHora"
              inputmode="numeric"
              :placeholder="t('agenda.horaExemplo')"
              required
              data-testid="remarcar-hora"
            />
          </div>
          <SanteSelecao v-model="canal" :rotulo="t('agenda.canal')" :opcoes="canais" />
        </fieldset>
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('agenda.marcacao.remarcar')"
            data-testid="confirmar-remarcacao"
          />
          <SanteBotao variante="texto" :rotulo="t('agenda.fechar')" @acionar="acao = ''" />
        </div>
      </form>

      <form
        v-if="acao === 'confirmar'"
        class="painel"
        data-testid="form-confirmar"
        @submit.prevent="fazerConfirmacao"
      >
        <h2>{{ t('agenda.marcacao.confirmar') }}</h2>
        <div class="filtros">
          <SanteSelecao v-model="resultado" :rotulo="t('agenda.marcacao.resultado')" :opcoes="resultados" />
          <SanteSelecao v-model="canal" :rotulo="t('agenda.canal')" :opcoes="canais" />
        </div>
        <SanteCampoTexto v-model="obsConfirmacao" :rotulo="t('agenda.observacao')" :max-bytes="200" />
        <div class="acoes">
          <SanteBotao tipo="submit" :rotulo="t('agenda.salvar')" data-testid="confirmar-confirmacao" />
          <SanteBotao variante="texto" :rotulo="t('agenda.fechar')" @acionar="acao = ''" />
        </div>
      </form>
    </template>
    <p v-if="mensagem" role="status" data-testid="marcacao-mensagem">{{ mensagem }}</p>
    <ErroAgenda v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
<style scoped>
.dados {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
  margin: 0;
}
.dados dt {
  font-weight: 600;
}
.dados dd {
  margin: 0;
}
</style>
