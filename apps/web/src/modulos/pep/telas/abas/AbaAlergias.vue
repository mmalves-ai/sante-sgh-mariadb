<script setup lang="ts">
// Alergias e reações adversas (regra 4): ativas e histórico; informar alergia (agente, princípio, reação,
// gravidade e origem) ou "nega alergias", ligada a um registro clínico do atendimento; retirar da lista ativa com
// motivo (fica no histórico), reativar a retirada por engano (motivo) e alterar a ativa (03-PEP L100).
// Dentro do formulário clínico (componente de alergia, D-ALE-2) recebe o `atendimento` do registro: a alergia é
// gravada na hora, ligada ao atendimento, sem escolher registro.
import {
  GRAVIDADES_ALERGIA,
  ORIGENS_ALERGIA,
  type GravidadeAlergia,
  type OrigemAlergia,
} from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { inativarAlergia, lerAlergias, reativarAlergia, registrarAlergia } from '../../api-documentos.js';
import AlterarAlergia from './AlterarAlergia.vue';
import AvisoConsulta from '../../componentes/documentos/AvisoConsulta.vue';
import HistoricoDaAlergia from './HistoricoDaAlergia.vue';
import { dataHoraBr } from '../../formato.js';

const props = defineProps<{ paciente: number; atendimento?: number | null }>();
const { t } = useI18n();
const cliente = useQueryClient();
const dados = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'alergias', props.paciente]),
  queryFn: () => lerAlergias(props.paciente),
});
const versao = computed(() =>
  (dados.data.value?.ativas.map((a) => a.id) ?? []).sort((a, b) => a - b).join(','),
);
const registro = ref<number | null>(null);
const nega = ref(false);
const agente = ref<number | null>(null);
const principio = ref<number | null>(null);
const reacao = ref('');
const gravidade = ref<GravidadeAlergia | ''>('');
const origem = ref<OrigemAlergia | ''>('');
const observacao = ref('');
const manifestacoes = ref<number[]>([]);
const motivo = ref('');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const opcoesRegistro = computed(() =>
  (dados.data.value?.registros ?? []).map((r) => ({
    valor: r.registro,
    rotulo: `${r.modelo} · ${dataHoraBr(r.dataHora)}`,
  })),
);
const opcoesAgente = computed(() =>
  (dados.data.value?.agentes ?? []).map((a) => ({ valor: a.id, rotulo: a.nome })),
);
const opcoesPrincipio = computed<{ valor: number | null; rotulo: string }[]>(() => [
  { valor: null, rotulo: '-' },
  ...(dados.data.value?.principios ?? []).map((p) => ({ valor: p.id, rotulo: p.nome })),
]);
const opcoesGravidade = computed<{ valor: GravidadeAlergia | ''; rotulo: string }[]>(() => [
  { valor: '', rotulo: '-' },
  ...GRAVIDADES_ALERGIA.map((g) => ({ valor: g, rotulo: t(`pep.doc.alergias.gravidades.${g}`) })),
]);
const opcoesOrigem = computed<{ valor: OrigemAlergia | ''; rotulo: string }[]>(() => [
  { valor: '', rotulo: '-' },
  ...ORIGENS_ALERGIA.map((o) => ({ valor: o, rotulo: t(`pep.doc.alergias.origens.${o}`) })),
]);

async function atualizar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['pep', 'doc'] });
}
async function registrar(): Promise<void> {
  erro.value = null;
  const noFormulario = props.atendimento ?? null;
  const reg =
    noFormulario !== null ? null : (registro.value ?? dados.data.value?.registros[0]?.registro ?? null);
  if (reg === null && noFormulario === null) return;
  // O agente é obrigatório quando não é "nega alergias" (o antigo required do campo).
  if (!nega.value && agente.value === null) return;
  try {
    await registrarAlergia(props.paciente, {
      ...(reg !== null ? { registro: reg } : { atendimento: noFormulario ?? undefined }),
      nega: nega.value,
      ...(nega.value || agente.value === null ? {} : { agente: agente.value }),
      principios: !nega.value && principio.value !== null ? [principio.value] : [],
      ...(reacao.value.trim() ? { reacao: reacao.value.trim() } : {}),
      ...(gravidade.value ? { gravidade: gravidade.value } : {}),
      ...(origem.value ? { origem: origem.value } : {}),
      ...(observacao.value.trim() ? { observacao: observacao.value.trim() } : {}),
      manifestacoes: nega.value ? [] : manifestacoes.value,
      versao: versao.value,
    });
    mensagem.value = t('pep.doc.gravado');
    agente.value = null;
    reacao.value = '';
    manifestacoes.value = [];
    await atualizar();
  } catch (e) {
    erro.value = e;
  }
}
const motivoReativar = ref('');
async function reativar(id: number): Promise<void> {
  erro.value = null;
  try {
    await reativarAlergia(props.paciente, id, motivoReativar.value, versao.value);
    mensagem.value = t('pep.doc.gravado');
    motivoReativar.value = '';
    await atualizar();
  } catch (e) {
    erro.value = e;
  }
}
async function inativar(id: number): Promise<void> {
  erro.value = null;
  try {
    await inativarAlergia(props.paciente, id, motivo.value, versao.value);
    mensagem.value = t('pep.doc.gravado');
    motivo.value = '';
    await atualizar();
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="aba" aria-labelledby="alergias-titulo" data-testid="aba-alergias-conteudo">
    <h2 id="alergias-titulo">{{ t('pep.doc.alergias.titulo') }}</h2>
    <MensagemErro v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <template v-else>
      <p class="marcador" data-testid="situacao-alergias">
        {{ t(`pep.doc.alergias.situacao.${dados.data.value.situacao}`) }}
      </p>
      <h3>{{ t('pep.doc.alergias.ativas') }}</h3>
      <p v-if="dados.data.value.ativas.length === 0">{{ t('pep.doc.nenhum') }}</p>
      <ul v-else class="lista">
        <li v-for="a in dados.data.value.ativas" :key="a.id" class="cartao" :data-testid="`alergia-${a.id}`">
          <p>
            <strong>{{ a.agente }}</strong
            ><span v-if="a.tipo"> · {{ a.tipo }}</span>
          </p>
          <p v-if="a.principios.length">{{ a.principios.join(', ') }}</p>
          <p v-if="a.observacao">{{ a.observacao }}</p>
          <p>
            {{ dataHoraBr(a.registradaEm) }}<span v-if="a.profissional"> · {{ a.profissional }}</span>
          </p>
          <HistoricoDaAlergia :paciente="paciente" :alergia="a.id" />
          <AlterarAlergia
            v-if="dados.data.value.criar.pode"
            :paciente="paciente"
            :alergia="a"
            :versao="versao"
            :catalogo="dados.data.value.manifestacoes"
          />
          <div v-if="dados.data.value.inativar.pode" class="linha">
            <label class="campo">
              <span>{{ t('pep.doc.motivo') }}</span>
              <input v-model="motivo" maxlength="500" :data-testid="`motivo-inativar-${a.id}`" />
            </label>
            <SanteBotao
              variante="destrutivo"
              :rotulo="t('pep.doc.alergias.inativar')"
              :confirmacao="t('pep.doc.alergias.inativarPergunta', { agente: a.agente })"
              @acionar="inativar(a.id)"
            />
          </div>
        </li>
      </ul>
      <details v-if="dados.data.value.historico.length">
        <summary>{{ t('pep.doc.alergias.historico') }} ({{ dados.data.value.historico.length }})</summary>
        <ul class="lista">
          <li v-for="a in dados.data.value.historico" :key="a.id" class="cartao">
            {{ a.agente }} · {{ dataHoraBr(a.registradaEm) }}
            <HistoricoDaAlergia :paciente="paciente" :alergia="a.id" />
            <div v-if="dados.data.value.inativar.pode" class="linha">
              <label class="campo">
                <span>{{ t('pep.doc.alergias.motivoReativar') }}</span>
                <input v-model="motivoReativar" maxlength="500" :data-testid="`motivo-reativar-${a.id}`" />
              </label>
              <SanteBotao
                :rotulo="t('pep.doc.alergias.reativar')"
                :desabilitado="motivoReativar.trim().length < 10"
                :data-testid="`reativar-${a.id}`"
                @acionar="reativar(a.id)"
              />
            </div>
          </li>
        </ul>
      </details>

      <AvisoConsulta :acao="dados.data.value.criar" />
      <form
        v-if="dados.data.value.criar.pode"
        class="form"
        data-testid="form-alergia"
        @submit.prevent="registrar"
      >
        <h3>{{ t('pep.doc.alergias.nova') }}</h3>
        <p v-if="atendimento" class="nota" data-testid="alergia-no-formulario">
          {{ t('pep.doc.alergias.noFormulario') }}
        </p>
        <SanteSelecao
          v-else
          v-model="registro"
          class="campo"
          :rotulo="t('pep.doc.alergias.registro')"
          :opcoes="opcoesRegistro"
        />
        <label class="marca"
          ><input v-model="nega" type="checkbox" data-testid="alergia-nega" />{{
            t('pep.doc.alergias.nega')
          }}</label
        >
        <template v-if="!nega">
          <SanteSelecao
            v-model="agente"
            obrigatorio
            class="campo"
            data-testid="alergia-agente"
            :rotulo="t('pep.doc.alergias.agente')"
            :opcoes="opcoesAgente"
          />
          <SanteSelecao
            v-model="principio"
            class="campo"
            :rotulo="t('pep.doc.alergias.principios')"
            :opcoes="opcoesPrincipio"
          />
          <fieldset v-if="dados.data.value.manifestacoes.length" data-testid="alergia-manifestacoes">
            <legend>{{ t('pep.doc.alergias.manifestacoes') }}</legend>
            <label v-for="m in dados.data.value.manifestacoes" :key="m.id" class="marca"
              ><input
                v-model="manifestacoes"
                type="checkbox"
                :value="m.id"
                :disabled="manifestacoes.length >= 10 && !manifestacoes.includes(m.id)"
                :data-testid="`alergia-manifestacao-${m.id}`"
              />{{ m.nome }}</label
            >
          </fieldset>
          <label
            ><span>{{ t('pep.doc.alergias.reacao') }}</span
            ><input v-model="reacao" maxlength="200" data-testid="alergia-reacao"
          /></label>
          <SanteSelecao
            v-model="gravidade"
            class="campo"
            :rotulo="t('pep.doc.alergias.gravidade')"
            :opcoes="opcoesGravidade"
          />
          <SanteSelecao
            v-model="origem"
            class="campo"
            :rotulo="t('pep.doc.alergias.origem')"
            :opcoes="opcoesOrigem"
          />
          <label
            ><span>{{ t('pep.doc.alergias.observacao') }}</span
            ><input v-model="observacao" maxlength="255"
          /></label>
        </template>
        <SanteBotao tipo="submit" :rotulo="t('pep.doc.alergias.registrar')" data-testid="alergia-registrar" />
      </form>
      <p v-if="mensagem" role="status">{{ mensagem }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style scoped src="./abas.css"></style>
