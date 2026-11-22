<script setup lang="ts">
// ADR 0009, decisão 26: criar convênio no cadastro, com as opções de credenciamento já na criação. Com "credenciar
// todos os profissionais ativos" ligado, a API credencia os ativos ao criar (credenciarTodosAtivos); desligado, o
// credenciamento é feito no cadastro do profissional ou do convênio. "Bloquear sem credenciamento" (decisão 25) nasce
// desligado: o padrão é o alerta.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { novaChave } from '../../agenda/api-agenda.js';
import {
  criarConvenio,
  esquemaEntradaNovoConvenio,
  TIPOS_FONTE_PAGADORA,
  type EntradaNovoConvenio,
} from '../../agenda/api-estruturada.js';

const emit = defineEmits<{ criado: [mensagem: string]; cancelar: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();
const codigo = ref('');
const nome = ref('');
const registroAns = ref('');
const d = new Date();
const inicio = ref(
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
);
const tipo = ref<EntradaNovoConvenio['tipo']>('operadora');
const credenciaTodos = ref(false);
const bloqueia = ref(false);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const chave = ref(novaChave('criar-convenio'));
const opcoesTipo = computed(() =>
  TIPOS_FONTE_PAGADORA.map((v) => ({ valor: v, rotulo: t(`estruturada.novoConvenio.tipos.${v}`) })),
);
const entrada = computed(() =>
  esquemaEntradaNovoConvenio.safeParse({
    codigo: codigo.value,
    nome: nome.value,
    tipo: tipo.value,
    registroAns: registroAns.value.trim() || null,
    dataInicioRelacao: inicio.value,
    bloqueiaSemCredenciamento: bloqueia.value,
    credenciaTodosAoCriar: credenciaTodos.value,
  }),
);

async function gravar(): Promise<void> {
  if (!entrada.value.success) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await criarConvenio(entrada.value.data, chave.value);
    await cliente.invalidateQueries({ queryKey: ['convenios'] });
    nome.value = '';
    codigo.value = '';
    registroAns.value = '';
    const devolvido = (r.resultado ?? {}) as Record<string, unknown>;
    emit('criado', t('estruturada.novoConvenio.criado', { n: Number(devolvido['credenciados'] ?? 0) }));
  } catch (e) {
    erro.value = e;
  } finally {
    chave.value = novaChave('criar-convenio');
    ocupado.value = false;
  }
}
</script>

<template>
  <form class="form" data-testid="form-novo-convenio" @submit.prevent="gravar">
    <h2>{{ t('estruturada.novoConvenio.titulo') }}</h2>
    <div class="linha">
      <div class="campo">
        <label for="novo-convenio-codigo">{{ t('estruturada.novoConvenio.codigo') }}</label>
        <input id="novo-convenio-codigo" v-model="codigo" maxlength="30" data-testid="novo-convenio-codigo" />
      </div>
      <div class="campo">
        <label for="novo-convenio-nome">{{ t('estruturada.novoConvenio.nome') }}</label>
        <input id="novo-convenio-nome" v-model="nome" maxlength="150" data-testid="novo-convenio-nome" />
      </div>
      <div class="campo">
        <label for="novo-convenio-ans">{{ t('estruturada.novoConvenio.registroAns') }}</label>
        <input id="novo-convenio-ans" v-model="registroAns" maxlength="10" data-testid="novo-convenio-ans" />
      </div>
      <SanteSelecao
        id="novo-convenio-tipo"
        v-model="tipo"
        :rotulo="t('estruturada.novoConvenio.tipo')"
        :opcoes="opcoesTipo"
        data-testid="novo-convenio-tipo"
      />
    </div>
    <label class="marca">
      <input v-model="credenciaTodos" type="checkbox" data-testid="novo-convenio-credencia-todos" />
      {{ t('estruturada.opcoesConvenio.credenciaTodos') }}
    </label>
    <p class="nota">{{ t('estruturada.novoConvenio.credenciaTodosAjuda') }}</p>
    <div v-if="credenciaTodos" class="campo">
      <label for="novo-convenio-inicio">{{ t('estruturada.novoConvenio.inicio') }}</label>
      <input id="novo-convenio-inicio" v-model="inicio" type="date" data-testid="novo-convenio-inicio" />
    </div>
    <label class="marca">
      <input v-model="bloqueia" type="checkbox" data-testid="novo-convenio-bloqueia" />
      {{ t('estruturada.opcoesConvenio.bloqueia') }}
    </label>
    <p class="nota">{{ t('estruturada.opcoesConvenio.bloqueiaAjuda') }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <div class="linha">
      <SanteBotao
        tipo="submit"
        :rotulo="t('estruturada.novoConvenio.criar')"
        :desabilitado="ocupado || !entrada.success"
        data-testid="novo-convenio-criar"
      />
      <SanteBotao variante="texto" :rotulo="t('estruturada.edicao.cancelar')" @acionar="emit('cancelar')" />
    </div>
  </form>
</template>

<style scoped>
.form {
  display: grid;
  gap: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
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
