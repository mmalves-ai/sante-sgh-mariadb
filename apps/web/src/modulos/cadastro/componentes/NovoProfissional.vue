<script setup lang="ts">
// D-PROF-39: inclusão do profissional do corpo clínico com o primeiro registro no conselho e a ocupação (CBO), pelo
// servidor (o executor grava; a recusa do servidor aparece com o motivo). Combos com busca (ADR 0027). Dados bancários
// e de repasse não existem aqui (regra 11). Por padrão, o registro é credenciado em todos os convênios ativos.
import { tipoDoProblema } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { incluirProfissional, lerOpcoesProfissional } from '../api-cadastro.js';

const emit = defineEmits<{ incluido: [id: number]; cancelar: [] }>();
const { t } = useI18n();
const opcoes = useQuery({
  queryKey: ['cadastro', 'profissionais', 'opcoes'],
  queryFn: () => lerOpcoesProfissional(),
});
const o = computed(() => opcoes.data.value);

const f = ref({
  nome: '',
  nomeSocial: '',
  cpf: '',
  sexo: '' as '' | 'F' | 'M',
  nascimento: '',
  nomeMae: '',
  cns: '',
  email: '',
  celular: '',
  conselho: 'CRM',
  numero: '',
  uf: '',
  cbo: null as number | null,
  sigla: null as number | null,
  credenciarTodos: true,
});
const gravando = ref(false);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);

const vazio = (rotulo: string) => ({ valor: null, rotulo });
const sexos = computed(() => [
  { valor: '' as const, rotulo: t('cadastro.profissionais.edicao.sexos.vazio') },
  { valor: 'F' as const, rotulo: t('cadastro.profissionais.edicao.sexos.F') },
  { valor: 'M' as const, rotulo: t('cadastro.profissionais.edicao.sexos.M') },
]);
const conselhos = computed(() =>
  (o.value?.conselhos ?? []).map((c) => ({ valor: String(c.valor), rotulo: c.rotulo })),
);
const ufs = computed(() => [
  { valor: '', rotulo: t('cadastro.profissionais.edicao.escolha') },
  ...(o.value?.ufs ?? []).map((u) => ({ valor: u, rotulo: u })),
]);
const cbos = computed(() => [
  vazio(t('cadastro.profissionais.edicao.escolha')),
  ...(o.value?.cbos ?? []).map((c) => ({ valor: Number(c.valor), rotulo: c.rotulo })),
]);
const siglas = computed(() => [
  vazio(t('cadastro.profissionais.edicao.semSigla')),
  ...(o.value?.siglas ?? [])
    .filter((s) => s.conselho === null || s.conselho === f.value.conselho)
    .map((s) => ({ valor: s.valor, rotulo: s.rotulo })),
]);

async function gravar(): Promise<void> {
  if (gravando.value) return;
  recusa.value = null;
  erro.value = null;
  const x = f.value;
  const numero = Number(x.numero.replace(/\D+/g, ''));
  if (!x.nome.trim() || !x.cpf.trim() || !numero || !x.uf || x.cbo === null) {
    recusa.value = t('cadastro.profissionais.edicao.obrigatorios');
    return;
  }
  gravando.value = true;
  try {
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    const r = await incluirProfissional({
      nome: x.nome,
      cpf: x.cpf,
      ...(opt(x.nomeSocial) ? { nomeSocial: x.nomeSocial } : {}),
      ...(x.sexo ? { sexo: x.sexo } : {}),
      ...(opt(x.nascimento) ? { nascimento: x.nascimento } : {}),
      ...(opt(x.nomeMae) ? { nomeMae: x.nomeMae } : {}),
      ...(opt(x.cns) ? { cns: x.cns } : {}),
      ...(opt(x.email) ? { email: x.email } : {}),
      ...(opt(x.celular) ? { celular: x.celular } : {}),
      registro: {
        conselho: x.conselho,
        numero,
        uf: x.uf,
        cbo: x.cbo,
        ...(x.sigla !== null ? { sigla: x.sigla } : {}),
        convenios: x.credenciarTodos ? (o.value?.convenios ?? []).map((c) => Number(c.valor)) : [],
      },
    });
    emit('incluido', r.profissional);
  } catch (e) {
    const tipo = e instanceof ErroApi && e.problema ? tipoDoProblema(e.problema) : null;
    if ((tipo === 'recusa-de-negocio' || tipo === 'entrada-invalida') && e instanceof ErroApi && e.problema)
      recusa.value = e.problema.detail ?? e.problema.title ?? '';
    else erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="novo" aria-labelledby="novo-profissional-titulo" data-testid="novo-profissional">
    <h2 id="novo-profissional-titulo">{{ t('cadastro.profissionais.edicao.novoTitulo') }}</h2>
    <p>{{ t('cadastro.profissionais.edicao.novoTexto') }}</p>
    <MensagemErro v-if="opcoes.isError.value" :erro="opcoes.error.value" />
    <form class="grade" @submit.prevent="gravar">
      <div class="campo">
        <label for="np-nome">{{ t('cadastro.profissionais.edicao.nome') }}</label>
        <input id="np-nome" v-model="f.nome" maxlength="70" required data-testid="np-nome" />
      </div>
      <div class="campo">
        <label for="np-social">{{ t('cadastro.profissionais.edicao.nomeSocial') }}</label>
        <input id="np-social" v-model="f.nomeSocial" maxlength="70" />
      </div>
      <div class="campo">
        <label for="np-cpf">{{ t('cadastro.profissionais.edicao.cpf') }}</label>
        <input id="np-cpf" v-model="f.cpf" inputmode="numeric" maxlength="14" required data-testid="np-cpf" />
      </div>
      <SanteSelecao v-model="f.sexo" :rotulo="t('cadastro.profissionais.edicao.sexo')" :opcoes="sexos" />
      <div class="campo">
        <label for="np-nasc">{{ t('cadastro.profissionais.edicao.nascimento') }}</label>
        <input id="np-nasc" v-model="f.nascimento" type="date" />
      </div>
      <div class="campo">
        <label for="np-mae">{{ t('cadastro.profissionais.edicao.nomeMae') }}</label>
        <input id="np-mae" v-model="f.nomeMae" maxlength="70" />
      </div>
      <div class="campo">
        <label for="np-cns">{{ t('cadastro.profissionais.edicao.cns') }}</label>
        <input id="np-cns" v-model="f.cns" inputmode="numeric" maxlength="18" />
      </div>
      <div class="campo">
        <label for="np-email">{{ t('cadastro.profissionais.edicao.email') }}</label>
        <input id="np-email" v-model="f.email" type="email" maxlength="50" />
      </div>
      <div class="campo">
        <label for="np-cel">{{ t('cadastro.profissionais.edicao.celular') }}</label>
        <input id="np-cel" v-model="f.celular" inputmode="tel" maxlength="15" />
      </div>
      <SanteSelecao
        v-model="f.conselho"
        :rotulo="t('cadastro.profissionais.edicao.conselho')"
        :opcoes="conselhos"
        busca
        obrigatorio
        data-testid="np-conselho"
      />
      <div class="campo">
        <label for="np-numero">{{ t('cadastro.profissionais.edicao.numero') }}</label>
        <input
          id="np-numero"
          v-model="f.numero"
          inputmode="numeric"
          maxlength="9"
          required
          data-testid="np-numero"
        />
      </div>
      <SanteSelecao
        v-model="f.uf"
        :rotulo="t('cadastro.profissionais.edicao.uf')"
        :opcoes="ufs"
        busca
        obrigatorio
        data-testid="np-uf"
      />
      <SanteSelecao
        v-model="f.cbo"
        :rotulo="t('cadastro.profissionais.edicao.cbo')"
        :opcoes="cbos"
        busca
        obrigatorio
        data-testid="np-cbo"
      />
      <SanteSelecao
        v-model="f.sigla"
        :rotulo="t('cadastro.profissionais.edicao.sigla')"
        :opcoes="siglas"
        busca
      />
      <label class="marcar">
        <input v-model="f.credenciarTodos" type="checkbox" data-testid="np-credenciar" />
        {{ t('cadastro.profissionais.edicao.credenciarTodos') }}
      </label>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('cadastro.profissionais.edicao.gravar')"
          variante="primario"
          tipo="submit"
          :desabilitado="gravando"
          data-testid="np-gravar"
        />
        <SanteBotao
          :rotulo="t('cadastro.profissionais.edicao.cancelar')"
          variante="secundario"
          @acionar="emit('cancelar')"
        />
      </div>
    </form>
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="np-recusa" />
    <MensagemErro v-if="erro" :erro="erro" />
  </section>
</template>

<style scoped>
.novo {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.campo {
  display: flex;
  flex-direction: column;
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
}
.marcar {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-height: var(--sgh-alvo-minimo);
}
</style>
