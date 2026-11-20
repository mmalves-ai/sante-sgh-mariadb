<script setup lang="ts">
// A manifestação aberta: o relato, quem se manifestou (o paciente só para a ouvidoria; nada na anônima), o prazo de
// 10 dias úteis, o encaminhamento à área e a resposta ao manifestante (reclamação e denúncia dizem se procede), com a
// versão lida. A não conformidade abre a partir dela na matriz de riscos.
import { rotuloCanalManifestacao, rotuloSituacaoManifestacao, rotuloTipoManifestacao } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import {
  encaminharManifestacao,
  type ManifestacaoTela,
  novaChaveGestao,
  responderManifestacao,
} from '../api-gestao.js';
import {
  acoesDaManifestacao,
  classeDoPrazoManifestacao,
  dataBr,
  montarEncaminhamento,
  montarResposta,
  TIPOS_COM_PROCEDENCIA,
} from '../regras-gestao.js';
import HistoricoVersoes from '../../componentes/HistoricoVersoes.vue';
import CorrecoesGestao from './CorrecoesGestao.vue';
import ErroGestao from './ErroGestao.vue';
import ErrosFormulario from './ErrosFormulario.vue';

const props = defineProps<{
  manifestacao: ManifestacaoTela;
  podeResponder: boolean;
  podeRegistrarNc: boolean;
}>();
const emit = defineEmits<{ aviso: [texto: string]; fechar: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();
const m = computed(() => props.manifestacao);
const acoes = computed(() => acoesDaManifestacao(m.value.situacao, props.podeResponder));
const exigeProcedencia = computed(() => (TIPOS_COM_PROCEDENCIA as readonly string[]).includes(m.value.tipo));
const opProcede = [
  { valor: '', rotulo: '' },
  { valor: 'sim', rotulo: t('gestaoQualidade.sim') },
  { valor: 'nao', rotulo: t('gestaoQualidade.nao') },
];

// W0-04: corrigir tipo, área e relato antes do encaminhamento; cancelar com motivo (a protocolada não se apaga).
const correcoes = ref<InstanceType<typeof CorrecoesGestao> | null>(null);
const cancelada = computed(() => !!m.value.canceladaEm);
const podeCorrigir = computed(() => props.podeResponder && !cancelada.value && m.value.situacao === 'aberta');
// Revisão do W0-04: o cancelamento (protocolada em duplicidade, por exemplo) vale também depois do encaminhamento e da
// resposta, como a API aceita; só a correção de tipo, área e relato fica restrita à manifestação ainda aberta.
const podeCancelar = computed(() => props.podeResponder && !cancelada.value);

const parte = ref<'encaminhar' | 'responder' | null>(null);
const encaminhadaA = ref('');
const observacao = ref('');
const resposta = ref('');
const procedente = ref('');
const erros = ref<Record<string, string>>({});
const erro = ref<unknown>(null);
const gravando = ref(false);
let chave = novaChaveGestao('ouvidoria');

async function gravar(): Promise<void> {
  erro.value = null;
  const r =
    parte.value === 'encaminhar'
      ? montarEncaminhamento(m.value, encaminhadaA.value, observacao.value)
      : montarResposta(m.value, resposta.value, procedente.value);
  if (!r.ok) {
    erros.value = { ...r.erros };
    return;
  }
  erros.value = {};
  gravando.value = true;
  try {
    if (parte.value === 'encaminhar') {
      await encaminharManifestacao(
        m.value.id,
        r.entrada as Parameters<typeof encaminharManifestacao>[1],
        chave,
      );
      emit('aviso', t('gestaoQualidade.ouvidoria.detalhe.encaminhada'));
    } else {
      await responderManifestacao(
        m.value.id,
        r.entrada as Parameters<typeof responderManifestacao>[1],
        chave,
      );
      emit('aviso', t('gestaoQualidade.ouvidoria.detalhe.respondidaOk'));
    }
    chave = novaChaveGestao('ouvidoria');
    parte.value = null;
    await cliente.invalidateQueries({ queryKey: ['gestaoQualidade'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="painel-ccih" aria-labelledby="manifestacao-titulo" data-testid="manifestacao-detalhe">
    <h2 id="manifestacao-titulo">
      {{ t('gestaoQualidade.ouvidoria.detalhe.titulo', { protocolo: m.protocolo }) }}
    </h2>
    <div class="linha-ccih">
      <span class="selo">{{ rotuloTipoManifestacao(m.tipo) }}</span>
      <span class="selo selo--neutro">{{ rotuloCanalManifestacao(m.canal) }}</span>
      <span class="selo" data-testid="man-situacao">{{ rotuloSituacaoManifestacao(m.situacao) }}</span>
      <span v-if="cancelada" class="selo selo--grave" data-testid="man-inativa">{{
        t('qualidade.correcao.inativo')
      }}</span>
      <span :class="classeDoPrazoManifestacao(m.estadoPrazo)" data-testid="man-prazo">{{
        t(`gestaoQualidade.ouvidoria.prazoEstado.${m.estadoPrazo}`, { data: dataBr(m.prazoEm) })
      }}</span>
    </div>
    <p v-if="cancelada" class="secundario" data-testid="man-cancelada">
      {{
        t('qualidade.correcao.cancelada', { em: dataHora(m.canceladaEm), motivo: m.motivoCancelamento ?? '' })
      }}
    </p>
    <p v-if="m.pesquisa !== null" class="secundario">
      {{ t('gestaoQualidade.ouvidoria.detalhe.daPesquisa') }}
    </p>
    <dl class="ficha-gestao">
      <dt>{{ t('gestaoQualidade.area') }}</dt>
      <dd>{{ m.area }}</dd>
      <dt>{{ t('gestaoQualidade.ouvidoria.colRecebida') }}</dt>
      <dd>{{ dataHora(m.recebidaEm) }}</dd>
      <template v-if="!m.identificada">
        <dt>{{ t('gestaoQualidade.ouvidoria.detalhe.manifestante') }}</dt>
        <dd>{{ t('gestaoQualidade.ouvidoria.anonima') }}</dd>
      </template>
      <template v-if="m.paciente">
        <dt>{{ t('gestaoQualidade.ouvidoria.detalhe.paciente') }}</dt>
        <dd>{{ m.paciente.nome }}</dd>
      </template>
      <template v-if="m.manifestante">
        <dt>{{ t('gestaoQualidade.ouvidoria.detalhe.manifestante') }}</dt>
        <dd>{{ m.manifestante }}</dd>
      </template>
      <template v-if="m.contato">
        <dt>{{ t('gestaoQualidade.ouvidoria.detalhe.contato') }}</dt>
        <dd>{{ m.contato }}</dd>
      </template>
      <dt>{{ t('gestaoQualidade.ouvidoria.detalhe.relato') }}</dt>
      <dd class="conteudo-documento">{{ m.relato }}</dd>
      <template v-if="m.encaminhadaA">
        <dt>{{ t('gestaoQualidade.ouvidoria.detalhe.encaminhadaA') }}</dt>
        <dd>{{ m.encaminhadaA }}</dd>
      </template>
      <template v-if="m.observacao">
        <dt>{{ t('gestaoQualidade.ouvidoria.detalhe.observacao') }}</dt>
        <dd>{{ m.observacao }}</dd>
      </template>
      <template v-if="m.resposta">
        <dt>{{ t('gestaoQualidade.ouvidoria.detalhe.resposta') }}</dt>
        <dd>
          {{ m.resposta }}
          <div class="secundario">
            {{
              t('gestaoQualidade.ouvidoria.detalhe.respondida', {
                usuario: m.respondidaPor ?? '',
                data: dataHora(m.respondidaEm),
              })
            }}
          </div>
        </dd>
      </template>
      <template v-if="m.procedente !== null">
        <dt>{{ t('gestaoQualidade.ouvidoria.detalhe.procedente') }}</dt>
        <dd>{{ m.procedente ? t('gestaoQualidade.sim') : t('gestaoQualidade.nao') }}</dd>
      </template>
    </dl>

    <div class="linha-ccih">
      <SanteBotao
        v-if="podeCorrigir && parte === null"
        variante="secundario"
        :rotulo="t('qualidade.correcao.corrigir')"
        data-testid="man-corrigir"
        @acionar="correcoes?.corrigirManifestacao(m)"
      />
      <SanteBotao
        v-if="podeCancelar && parte === null"
        variante="texto"
        :rotulo="t('qualidade.correcao.cancelarRegistro')"
        data-testid="man-cancelar"
        @acionar="correcoes?.cancelarManifestacao(m)"
      />
      <HistoricoVersoes registro="manifestacao" :id="m.id" />
      <SanteBotao
        v-if="acoes.encaminhar && parte === null && !cancelada"
        variante="secundario"
        :rotulo="t('gestaoQualidade.ouvidoria.detalhe.encaminhar')"
        data-testid="man-encaminhar"
        @acionar="parte = 'encaminhar'"
      />
      <SanteBotao
        v-if="acoes.responder && parte === null && !cancelada"
        :rotulo="t('gestaoQualidade.ouvidoria.detalhe.responder')"
        data-testid="man-responder"
        @acionar="parte = 'responder'"
      />
      <RouterLink
        v-if="podeRegistrarNc"
        :to="`/qualidade/gestao/riscos?aba=naoConformidades&origem=ouvidoria&id=${m.id}`"
        data-testid="man-abrir-nc"
        >{{ t('gestaoQualidade.ouvidoria.detalhe.abrirNc') }}</RouterLink
      >
      <SanteBotao :rotulo="t('gestaoQualidade.fechar')" variante="texto" @acionar="emit('fechar')" />
    </div>

    <form v-if="parte" class="painel-ccih" :data-testid="`form-${parte}`" @submit.prevent="gravar">
      <template v-if="parte === 'encaminhar'">
        <SanteCampoTexto
          v-model="encaminhadaA"
          :rotulo="t('gestaoQualidade.ouvidoria.form.encaminharA')"
          :max-bytes="80"
          obrigatorio
          data-testid="man-encaminhada-a"
        />
        <SanteCampoTexto
          v-model="observacao"
          :rotulo="t('gestaoQualidade.ouvidoria.form.observacao')"
          :max-bytes="1000"
          multilinha
          data-testid="man-observacao"
        />
      </template>
      <template v-else>
        <SanteCampoTexto
          v-model="resposta"
          :rotulo="t('gestaoQualidade.ouvidoria.form.resposta')"
          :max-bytes="4000"
          multilinha
          obrigatorio
          data-testid="man-resposta"
        />
        <SanteSelecao
          v-if="exigeProcedencia"
          v-model="procedente"
          :rotulo="t('gestaoQualidade.ouvidoria.form.procedente')"
          :opcoes="opProcede"
          obrigatorio
          data-testid="man-procedente"
        />
      </template>
      <ErrosFormulario :erros="erros" />
      <ErroGestao v-if="erro" :erro="erro" />
      <div class="linha-ccih">
        <SanteBotao
          tipo="submit"
          :rotulo="t('gestaoQualidade.gravar')"
          :desabilitado="gravando"
          data-testid="man-gravar-andamento"
        />
        <SanteBotao :rotulo="t('gestaoQualidade.cancelar')" variante="texto" @acionar="parte = null" />
      </div>
    </form>
    <CorrecoesGestao ref="correcoes" @alterado="(x) => emit('aviso', x)" />
  </section>
</template>
