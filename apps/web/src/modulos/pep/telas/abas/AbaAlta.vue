<script setup lang="ts">
// Sumário de alta, relatório de transferência e óbito (regra 13): o sumário montado do episódio, editável, salvo
// em versões e finalizado pelo médico; a transferência e a declaração de óbito (crítica, pede a senha).
import type { SumarioAltaEstruturado } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import {
  finalizarSumario,
  lerAlta,
  cancelarObito,
  registrarObito,
  registrarTransferencia,
  salvarSumario,
} from '../../api-documentos.js';
import AvisoConsulta from '../../componentes/documentos/AvisoConsulta.vue';
import SecoesSumarioAlta from '../../componentes/documentos/SecoesSumarioAlta.vue';
import type { TextoSecao } from '../../api-sumario-secoes.js';
import { dataHoraBr } from '../../formato.js';

const props = defineProps<{ paciente: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const dados = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'alta', props.paciente]),
  queryFn: () => lerAlta(props.paciente, null),
});
const linhas = (x: readonly string[]) => x.join('\n');
const deLinhas = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
const f = ref({
  motivo: '',
  diagnosticos: '',
  procedimentos: '',
  evolucao: '',
  medicamentos: '',
  alergias: '',
  plano: '',
  encaminhamentos: '',
  condicao: '',
});
// F3.3 (L124): texto das seções configuradas pelo estabelecimento (pelo código da seção).
const secoes = ref<TextoSecao[]>([]);
watch(
  () => dados.data.value?.sumario,
  (s) => {
    if (!s) return;
    f.value = {
      motivo: s.motivoInternacao ?? '',
      diagnosticos: linhas(s.diagnosticos.map((d) => (d.cid ? `${d.cid} - ${d.descricao}` : d.descricao))),
      procedimentos: linhas(s.procedimentos),
      evolucao: s.evolucao ?? '',
      medicamentos: linhas(s.medicamentosAlta),
      alergias: linhas(s.alergias),
      plano: s.plano ?? '',
      encaminhamentos: linhas(s.encaminhamentos),
      condicao: s.condicaoAlta ?? '',
    };
    secoes.value = (s.secoes ?? []).map((x) => ({ ...x }));
  },
  { immediate: true },
);
function sumario(): SumarioAltaEstruturado {
  const v = f.value;
  return {
    ...(v.motivo.trim() ? { motivoInternacao: v.motivo.trim() } : {}),
    diagnosticos: deLinhas(v.diagnosticos).map((l) => {
      const m = /^([A-Z]\d{2}(?:\.?\d{1,2})?)\s*-\s*(.+)$/.exec(l);
      return m ? { cid: m[1]!, descricao: m[2]! } : { descricao: l };
    }),
    procedimentos: deLinhas(v.procedimentos),
    ...(v.evolucao.trim() ? { evolucao: v.evolucao.trim() } : {}),
    medicamentosAlta: deLinhas(v.medicamentos),
    alergias: deLinhas(v.alergias),
    ...(v.plano.trim() ? { plano: v.plano.trim() } : {}),
    encaminhamentos: deLinhas(v.encaminhamentos),
    ...(v.condicao.trim() ? { condicaoAlta: v.condicao.trim() } : {}),
    ...(secoes.value.length ? { secoes: secoes.value.map((x) => ({ ...x, texto: x.texto.trim() })) } : {}),
  };
}
const versaoAtual = computed(() => {
  const vs = dados.data.value?.versoes ?? [];
  return vs.length ? vs[vs.length - 1]!.versao : 0;
});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function atualizar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['pep', 'doc'] });
}
async function salvar(finalizar: boolean): Promise<void> {
  erro.value = null;
  const at = dados.data.value?.atendimento?.id;
  if (!at) return;
  try {
    const e = { atendimento: at, sumario: sumario(), versao: versaoAtual.value };
    if (finalizar) await finalizarSumario(props.paciente, e);
    else await salvarSumario(props.paciente, e);
    mensagem.value = finalizar ? t('pep.doc.alta.finalizado') : t('pep.doc.gravado');
    await atualizar();
  } catch (x) {
    erro.value = x;
  }
}
const destino = ref('');
const motivoT = ref('');
const resumo = ref('');
async function transferir(): Promise<void> {
  erro.value = null;
  const at = dados.data.value?.atendimento?.id;
  if (!at) return;
  try {
    await registrarTransferencia(props.paciente, {
      atendimento: at,
      destino: destino.value.trim(),
      motivo: motivoT.value.trim(),
      resumo: resumo.value.trim(),
    });
    mensagem.value = t('pep.doc.gravado');
    destino.value = '';
    await atualizar();
  } catch (x) {
    erro.value = x;
  }
}
const o = ref({ dataHora: '', numero: '', a: '', b: '', c: '', d: '', parteII: '', senha: '' });
async function obito(): Promise<void> {
  erro.value = null;
  const at = dados.data.value?.atendimento?.id;
  if (!at) return;
  const v = o.value;
  try {
    await registrarObito(props.paciente, {
      atendimento: at,
      dataHora: v.dataHora.slice(0, 16),
      ...(v.numero.trim() ? { numero: v.numero.trim() } : {}),
      causas: {
        a: v.a.trim(),
        ...(v.b.trim() ? { b: v.b.trim() } : {}),
        ...(v.c.trim() ? { c: v.c.trim() } : {}),
        ...(v.d.trim() ? { d: v.d.trim() } : {}),
        ...(v.parteII.trim() ? { parteII: v.parteII.trim() } : {}),
      },
      ...(v.senha ? { senha: v.senha } : {}),
    });
    mensagem.value = t('pep.doc.gravado');
    await atualizar();
  } catch (x) {
    erro.value = x;
  }
}
const cancelamento = ref({ motivo: '', senha: '' });
async function cancelar(): Promise<void> {
  erro.value = null;
  const v = cancelamento.value;
  try {
    await cancelarObito(props.paciente, { motivo: v.motivo.trim(), ...(v.senha ? { senha: v.senha } : {}) });
    cancelamento.value = { motivo: '', senha: '' };
    mensagem.value = t('pep.doc.alta.obitoCancelado');
    await atualizar();
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="aba" aria-labelledby="alta-titulo" data-testid="aba-alta-conteudo">
    <h2 id="alta-titulo">{{ t('pep.doc.alta.titulo') }}</h2>
    <MensagemErro v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="dados.data.value.obito"
        variante="info"
        :texto="t('pep.doc.alta.obitoRegistrado', { data: dataHoraBr(dados.data.value.obito.em) })"
      />
      <form
        v-if="dados.data.value.cancelarObitoAcao?.pode"
        class="form"
        data-testid="form-cancelar-obito"
        @submit.prevent="cancelar"
      >
        <h3>{{ t('pep.doc.alta.cancelarObito') }}</h3>
        <label
          ><span>{{ t('pep.doc.alta.motivoCancelamento') }}</span
          ><textarea
            v-model="cancelamento.motivo"
            rows="2"
            minlength="10"
            maxlength="2000"
            required
            data-testid="cancelar-obito-motivo"
          />
        </label>
        <label
          ><span>{{ t('pep.doc.senha') }}</span
          ><input v-model="cancelamento.senha" type="password" autocomplete="current-password"
        /></label>
        <SanteBotao
          variante="destrutivo"
          :confirmacao="t('pep.doc.alta.confirmarCancelamento')"
          :rotulo="t('pep.doc.alta.cancelarObito')"
          :desabilitado="cancelamento.motivo.trim().length < 10"
          data-testid="cancelar-obito"
          @acionar="cancelar"
        />
      </form>
      <form class="form" data-testid="form-sumario" @submit.prevent="salvar(true)">
        <h3>{{ t('pep.doc.alta.sumario') }}</h3>
        <label
          ><span>{{ t('pep.doc.alta.motivo') }}</span
          ><textarea v-model="f.motivo" rows="2" maxlength="1000" />
        </label>
        <label
          ><span>{{ t('pep.doc.alta.diagnosticos') }}</span
          ><textarea v-model="f.diagnosticos" rows="3" data-testid="sumario-diagnosticos" />
        </label>
        <label
          ><span>{{ t('pep.doc.alta.procedimentos') }}</span
          ><textarea v-model="f.procedimentos" rows="2" />
        </label>
        <label
          ><span>{{ t('pep.doc.alta.evolucao') }}</span
          ><textarea v-model="f.evolucao" rows="3" maxlength="4000" />
        </label>
        <label
          ><span>{{ t('pep.doc.alta.medicamentos') }}</span
          ><textarea v-model="f.medicamentos" rows="2" />
        </label>
        <label
          ><span>{{ t('pep.doc.alta.alergias') }}</span
          ><textarea v-model="f.alergias" rows="2" />
        </label>
        <label
          ><span>{{ t('pep.doc.alta.plano') }}</span
          ><textarea v-model="f.plano" rows="2" maxlength="2000" data-testid="sumario-plano" />
        </label>
        <label
          ><span>{{ t('pep.doc.alta.encaminhamentos') }}</span
          ><textarea v-model="f.encaminhamentos" rows="2" />
        </label>
        <label
          ><span>{{ t('pep.doc.alta.condicao') }}</span
          ><input v-model="f.condicao" maxlength="200" data-testid="sumario-condicao"
        /></label>
        <SecoesSumarioAlta
          v-if="dados.data.value.atendimento"
          v-model="secoes"
          :atendimento="dados.data.value.atendimento.id"
          :desabilitado="dados.data.value.finalizado"
        />
        <AvisoConsulta :acao="dados.data.value.finalizar" />
        <div v-if="!dados.data.value.finalizado" class="acoes">
          <SanteBotao
            variante="secundario"
            :rotulo="t('pep.doc.alta.salvarRascunho')"
            data-testid="sumario-rascunho"
            @acionar="salvar(false)"
          />
          <SanteBotao
            v-if="dados.data.value.finalizar.pode"
            tipo="submit"
            :rotulo="t('pep.doc.alta.finalizar')"
            data-testid="sumario-finalizar"
          />
        </div>
      </form>
      <section v-if="dados.data.value.versoes.length">
        <h3>{{ t('pep.doc.alta.versoes') }}</h3>
        <ul>
          <li v-for="v in dados.data.value.versoes" :key="v.versao">
            {{
              t('pep.doc.alta.versao', {
                n: v.versao,
                situacao: v.situacao,
                data: dataHoraBr(v.em),
                usuario: v.usuario,
              })
            }}
          </li>
        </ul>
      </section>
      <form
        v-if="dados.data.value.finalizar.pode || dados.data.value.finalizado"
        class="form"
        @submit.prevent="transferir"
      >
        <h3>{{ t('pep.doc.alta.transferencia') }}</h3>
        <ul v-if="dados.data.value.transferencias.length">
          <li v-for="x in dados.data.value.transferencias" :key="x.id">
            {{ x.destino }} · {{ dataHoraBr(x.em) }}
          </li>
        </ul>
        <label
          ><span>{{ t('pep.doc.alta.destino') }}</span
          ><input v-model="destino" maxlength="200" required
        /></label>
        <label
          ><span>{{ t('pep.doc.alta.motivoTransferencia') }}</span
          ><input v-model="motivoT" maxlength="500" required
        /></label>
        <label
          ><span>{{ t('pep.doc.alta.resumo') }}</span
          ><textarea v-model="resumo" rows="3" maxlength="4000" required />
        </label>
        <SanteBotao tipo="submit" :rotulo="t('pep.doc.alta.registrar')" />
      </form>
      <AvisoConsulta :acao="dados.data.value.obitoAcao" />
      <form
        v-if="dados.data.value.obitoAcao.pode && !dados.data.value.obito"
        class="form"
        data-testid="form-obito"
        @submit.prevent="obito"
      >
        <h3>{{ t('pep.doc.alta.obito') }}</h3>
        <div class="linha">
          <label
            ><span>{{ t('pep.doc.alta.dataHora') }}</span
            ><input v-model="o.dataHora" type="datetime-local" required
          /></label>
          <label
            ><span>{{ t('pep.doc.alta.numero') }}</span
            ><input v-model="o.numero" inputmode="numeric" maxlength="20"
          /></label>
        </div>
        <label
          ><span>{{ t('pep.doc.alta.causaA') }}</span
          ><input v-model="o.a" maxlength="200" required
        /></label>
        <label
          ><span>{{ t('pep.doc.alta.causaB') }}</span
          ><input v-model="o.b" maxlength="200"
        /></label>
        <label
          ><span>{{ t('pep.doc.alta.causaC') }}</span
          ><input v-model="o.c" maxlength="200"
        /></label>
        <label
          ><span>{{ t('pep.doc.alta.causaD') }}</span
          ><input v-model="o.d" maxlength="200"
        /></label>
        <label
          ><span>{{ t('pep.doc.alta.parteII') }}</span
          ><input v-model="o.parteII" maxlength="400"
        /></label>
        <label
          ><span>{{ t('pep.doc.senha') }}</span
          ><input v-model="o.senha" type="password" autocomplete="current-password"
        /></label>
        <SanteBotao tipo="submit" :rotulo="t('pep.doc.alta.registrar')" />
      </form>
      <p v-if="mensagem" role="status">{{ mensagem }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style scoped src="./abas.css"></style>
