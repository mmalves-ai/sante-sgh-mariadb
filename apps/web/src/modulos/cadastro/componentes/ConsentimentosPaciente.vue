<script setup lang="ts">
// Consentimentos do paciente (M11; cap-08 §8.13): por finalidade, versão do termo, situação e signatário, com
// os domínios do sistema atual (situação do termo, tipo de representante, motivo de revogação). Registrar e
// revogar só com cadastro.consentimento.registrar; gravação só na tabela SGH_ (auditada na mesma transação).
import { FINALIDADES_CONSENTIMENTO } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { gravarConsentimento, lerConsentimentos } from '../api-cadastro.js';
import { carimboBr } from '../formato.js';

const props = defineProps<{ idPaciente: number; podeRegistrar: boolean }>();
const { t } = useI18n();

const consulta = useQuery({
  queryKey: computed(() => ['cadastro', 'consentimentos', props.idPaciente]),
  queryFn: () => lerConsentimentos(props.idPaciente),
});
const c = computed(() => consulta.data.value);

type Finalidade = (typeof FINALIDADES_CONSENTIMENTO)[number];
const finalidade = ref<Finalidade>('atendimento');
const versao = ref('1');
const situacao = ref('');
const signatario = ref('');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);

watch(c, (x) => {
  if (!x) return;
  if (!situacao.value && x.opcoes.situacoes[0]) situacao.value = String(x.opcoes.situacoes[0].codigo);
  if (!signatario.value && x.opcoes.signatarios[0]) signatario.value = String(x.opcoes.signatarios[0].codigo);
});

const opcoesFinalidade = computed(() =>
  FINALIDADES_CONSENTIMENTO.map((v) => ({ valor: v, rotulo: t(`cadastro.consentimento.finalidades.${v}`) })),
);
const opcoes = (l: readonly { codigo: number; rotulo: string }[]) =>
  l.map((o) => ({ valor: String(o.codigo), rotulo: o.rotulo }));
const rotuloFinalidade = (f: string) =>
  (FINALIDADES_CONSENTIMENTO as readonly string[]).includes(f)
    ? t(`cadastro.consentimento.finalidades.${f}`)
    : f;

async function registrar(): Promise<void> {
  mensagem.value = null;
  erro.value = null;
  try {
    await gravarConsentimento(props.idPaciente, {
      acao: 'registrar',
      finalidade: finalidade.value,
      versao: versao.value.trim(),
      situacao: Number(situacao.value),
      signatario: Number(signatario.value),
    });
    mensagem.value = t('cadastro.consentimento.gravado');
    await consulta.refetch();
  } catch (e) {
    erro.value = e;
  }
}

async function revogar(id: number): Promise<void> {
  mensagem.value = null;
  erro.value = null;
  const motivo = c.value?.opcoes.revogacoes[0]?.codigo;
  if (motivo === undefined) return;
  try {
    await gravarConsentimento(props.idPaciente, { acao: 'revogar', id, motivo });
    mensagem.value = t('cadastro.consentimento.gravado');
    await consulta.refetch();
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section aria-labelledby="sec-consentimentos" data-testid="consentimentos">
    <h2 id="sec-consentimentos">{{ t('cadastro.ficha.consentimentos') }}</h2>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-else-if="c">
      <p v-if="mensagem" role="status">{{ mensagem }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
      <p v-if="c.itens.length === 0">{{ t('cadastro.consentimento.nenhum') }}</p>
      <table v-else>
        <caption>
          {{
            t('cadastro.consentimento.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('cadastro.consentimento.finalidade') }}</th>
            <th scope="col">{{ t('cadastro.consentimento.versao') }}</th>
            <th scope="col">{{ t('cadastro.consentimento.situacao') }}</th>
            <th scope="col">{{ t('cadastro.consentimento.signatario') }}</th>
            <th scope="col">{{ t('cadastro.consentimento.registrado') }}</th>
            <th scope="col">{{ t('cadastro.consentimento.por') }}</th>
            <th scope="col">{{ t('cadastro.consentimento.revogado') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in c.itens" :key="i.id">
            <td>{{ rotuloFinalidade(i.finalidade) }}</td>
            <td>{{ i.versao }}</td>
            <td>{{ i.situacao.rotulo }}</td>
            <td>{{ i.signatario.rotulo }}</td>
            <td>{{ carimboBr(i.registradoEm) }}</td>
            <td>{{ i.registradoPor }}</td>
            <td>
              <template v-if="i.revogadoEm"
                >{{ carimboBr(i.revogadoEm) }} {{ i.motivoRevogacao?.rotulo ?? '' }}</template
              >
              <SanteBotao
                v-else-if="podeRegistrar && c.opcoes.revogacoes.length > 0"
                :rotulo="t('cadastro.consentimento.revogar')"
                variante="destrutivo"
                :confirmacao="t('cadastro.consentimento.confirmarRevogar')"
                @acionar="revogar(i.id)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <form v-if="podeRegistrar" class="form" data-testid="form-consentimento" @submit.prevent="registrar">
        <SanteSelecao
          v-model="finalidade"
          :rotulo="t('cadastro.consentimento.finalidade')"
          :opcoes="opcoesFinalidade"
        />
        <div class="campo">
          <label for="consent-versao">{{ t('cadastro.consentimento.versao') }}</label>
          <input id="consent-versao" v-model="versao" maxlength="20" required />
        </div>
        <SanteSelecao
          v-model="situacao"
          :rotulo="t('cadastro.consentimento.situacao')"
          :opcoes="opcoes(c.opcoes.situacoes)"
        />
        <SanteSelecao
          v-model="signatario"
          :rotulo="t('cadastro.consentimento.signatario')"
          :opcoes="opcoes(c.opcoes.signatarios)"
        />
        <SanteAlerta
          v-if="c.opcoes.situacoes.length === 0 || c.opcoes.signatarios.length === 0"
          :texto="t('cadastro.nenhum')"
          variante="info"
        />
        <SanteBotao
          :rotulo="t('cadastro.consentimento.registrar')"
          variante="secundario"
          tipo="submit"
          :desabilitado="!situacao || !signatario"
          data-testid="botao-registrar-consentimento"
        />
      </form>
    </template>
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.form {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin-top: var(--sgh-espaco-2);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
