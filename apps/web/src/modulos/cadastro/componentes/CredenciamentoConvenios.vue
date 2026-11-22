<script setup lang="ts">
// ADR 0009 (decisões 25 e 26): credenciamento profissional × convênio, com plano, estabelecimento e vigência. Usado na
// ficha do profissional (fixa o profissional) e no cadastro do convênio (fixa o convênio). Atender sem credenciamento
// gera alerta, ou bloqueio quando o convênio liga a opção. Incluir um credenciamento grava uma linha nova; descredenciar
// é gravar a linha com "credenciado" desligado (a trilha guarda o anterior).
import type { Credenciamento } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { novaChave } from '../../agenda/api-agenda.js';
import { incluirCredenciamento, listarCredenciamentos } from '../../agenda/api-estruturada.js';
import { dataTela } from '../../agenda/estruturada-tela.js';

const props = withDefaults(
  defineProps<{
    profissionalId?: number | null;
    fontePagadoraId?: number | null;
    nomesConvenio?: Record<number, string>;
    podeEditar?: boolean;
  }>(),
  { profissionalId: null, fontePagadoraId: null, nomesConvenio: () => ({}), podeEditar: false },
);
const { t } = useI18n();
const cliente = useQueryClient();
const porProfissional = computed(() => props.profissionalId !== null);
const filtro = computed((): { profissionalId?: number; fontePagadoraId?: number } =>
  props.profissionalId !== null
    ? { profissionalId: props.profissionalId }
    : props.fontePagadoraId !== null
      ? { fontePagadoraId: props.fontePagadoraId }
      : {},
);
const consulta = useQuery({
  queryKey: computed(() => ['credenciamentos', filtro.value]),
  queryFn: () => listarCredenciamentos(filtro.value),
  enabled: computed(() => props.profissionalId !== null || props.fontePagadoraId !== null),
});
const d = new Date();
const hoje = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const outroId = ref<number | null>(null);
const planoId = ref<number | null>(null);
const inicio = ref(hoje);
const fim = ref('');
const credenciado = ref(true);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
const chave = ref(novaChave('credenciamento'));
const podeGravar = computed(
  () => !ocupado.value && !!outroId.value && !!inicio.value && (!fim.value || fim.value >= inicio.value),
);
const convenio = (id: number) => props.nomesConvenio[id] ?? `#${id}`;
const vigencia = (c: Credenciamento) =>
  c.vigenciaFim
    ? t('estruturada.vigenciaEntre', { inicio: dataTela(c.vigenciaInicio), fim: dataTela(c.vigenciaFim) })
    : t('estruturada.vigenciaDesde', { inicio: dataTela(c.vigenciaInicio) });

async function gravar(): Promise<void> {
  if (!podeGravar.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const outro = Number(outroId.value);
    const r = await incluirCredenciamento(
      {
        profissionalId: porProfissional.value ? Number(props.profissionalId) : outro,
        fontePagadoraId: porProfissional.value ? outro : Number(props.fontePagadoraId),
        estabelecimentoId: null,
        planoId: planoId.value || null,
        credenciado: credenciado.value,
        vigenciaInicio: inicio.value,
        vigenciaFim: fim.value || null,
      },
      chave.value,
    );
    mensagem.value = r.mensagem;
    outroId.value = null;
    planoId.value = null;
    await cliente.invalidateQueries({ queryKey: ['credenciamentos'] });
  } catch (e) {
    erro.value = e;
  } finally {
    chave.value = novaChave('credenciamento');
    ocupado.value = false;
  }
}
</script>

<template>
  <section
    class="credenciamento"
    aria-labelledby="credenciamento-titulo"
    data-testid="credenciamento-convenios"
  >
    <h3 id="credenciamento-titulo">
      {{
        porProfissional
          ? t('estruturada.credenciamento.titulo')
          : t('estruturada.credenciamento.tituloConvenio')
      }}
    </h3>
    <p class="nota">{{ t('estruturada.credenciamento.texto') }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value && consulta.isFetching.value" role="status">
      {{ t('estruturada.carregando') }}
    </p>
    <p v-else-if="(consulta.data.value ?? []).length === 0">{{ t('estruturada.nenhuma') }}</p>
    <table v-else data-testid="tabela-credenciamentos">
      <thead>
        <tr>
          <th scope="col">
            {{
              porProfissional
                ? t('estruturada.credenciamento.convenio')
                : t('estruturada.credenciamento.profissional')
            }}
          </th>
          <th scope="col">{{ t('estruturada.credenciamento.plano') }}</th>
          <th scope="col">{{ t('estruturada.credenciamento.estabelecimento') }}</th>
          <th scope="col">{{ t('estruturada.vigencia') }}</th>
          <th scope="col">{{ t('estruturada.preco.situacao') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in consulta.data.value" :key="c.id" :data-testid="`credenciamento-${c.id}`">
          <th scope="row">{{ porProfissional ? convenio(c.fontePagadoraId) : `#${c.profissionalId}` }}</th>
          <td>{{ c.planoId === null ? t('estruturada.credenciamento.todosPlanos') : `#${c.planoId}` }}</td>
          <td>
            {{
              c.estabelecimentoId === null ? t('estruturada.credenciamento.rede') : `#${c.estabelecimentoId}`
            }}
          </td>
          <td>{{ vigencia(c) }}</td>
          <td :class="{ descredenciado: !c.credenciado }">
            {{
              c.credenciado
                ? t('estruturada.credenciamento.credenciado')
                : t('estruturada.credenciamento.descredenciado')
            }}
          </td>
        </tr>
      </tbody>
    </table>
    <form v-if="podeEditar" class="form" data-testid="form-credenciamento" @submit.prevent="gravar">
      <div class="campo">
        <label for="cred-outro">
          {{
            porProfissional
              ? t('estruturada.credenciamento.convenioId')
              : t('estruturada.credenciamento.profissionalId')
          }}
        </label>
        <input id="cred-outro" v-model.number="outroId" type="number" min="1" data-testid="cred-outro" />
      </div>
      <div class="campo">
        <label for="cred-plano">{{ t('estruturada.credenciamento.planoId') }}</label>
        <input id="cred-plano" v-model.number="planoId" type="number" min="1" data-testid="cred-plano" />
      </div>
      <div class="campo">
        <label for="cred-inicio">{{ t('estruturada.credenciamento.inicio') }}</label>
        <input id="cred-inicio" v-model="inicio" type="date" data-testid="cred-inicio" />
      </div>
      <div class="campo">
        <label for="cred-fim">{{ t('estruturada.credenciamento.fim') }}</label>
        <input id="cred-fim" v-model="fim" type="date" data-testid="cred-fim" />
      </div>
      <label class="marca">
        <input v-model="credenciado" type="checkbox" data-testid="cred-credenciado" />
        {{ t('estruturada.credenciamento.credenciado') }}
      </label>
      <SanteBotao
        tipo="submit"
        :rotulo="
          credenciado ? t('estruturada.credenciamento.gravar') : t('estruturada.credenciamento.descredenciar')
        "
        :desabilitado="!podeGravar"
        data-testid="cred-gravar"
      />
    </form>
    <p v-if="mensagem" role="status" data-testid="cred-mensagem">{{ mensagem }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
  </section>
</template>

<style scoped>
.credenciamento {
  margin-top: var(--sgh-espaco-2);
}
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
.descredenciado {
  font-weight: 600;
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
.marca {
  display: flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
