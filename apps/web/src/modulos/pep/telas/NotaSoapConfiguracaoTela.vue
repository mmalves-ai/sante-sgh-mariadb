<script setup lang="ts">
// Configuração da nota clínica S.O.A.P. (03-PEP L98), na administração do PEP. Uma linha por estabelecimento e
// especialidade (sem um deles, vale para todos; a mais específica prevalece na nota): as partes obrigatórias para
// assinar, o CID-10 obrigatório na avaliação e a CIAP-2 (classificação da atenção primária), ligada só onde a unidade
// a usa. A mesma regra do domínio valida enquanto se marca, e a combinação repetida aparece antes de gravar.
// Ler: pep.admin.ler; gravar: pep.admin.editar. Nada é apagado: a configuração que deixa de valer fica inativa.
import { validarConfiguracaoNota } from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  type ConfiguracaoNotaTela,
  gravarConfiguracaoNota,
  lerConfiguracoesNota,
  lerOpcoesConfiguracaoNota,
} from '../api-nota-soap.js';

const { t } = useI18n();
const cliente = useQueryClient();
const CHAVE = ['pep', 'nota-soap', 'configuracoes'];
const lista = useQuery({ queryKey: CHAVE, queryFn: () => lerConfiguracoesNota(), staleTime: 0 });
const opcoes = useQuery({
  queryKey: ['pep', 'nota-soap', 'configuracoes', 'opcoes'],
  queryFn: () => lerOpcoesConfiguracaoNota(),
});
const podeEditar = computed(() => pode('pep.admin.editar'));
const erro = ref<unknown>(null);
const ok = ref('');
const gravando = ref(false);

const PARTES = ['Subjetivo', 'Objetivo', 'Avaliacao', 'Plano'] as const;
const ROTULO_PARTE = {
  Subjetivo: 'subjetivo',
  Objetivo: 'objetivo',
  Avaliacao: 'avaliacao',
  Plano: 'plano',
} as const;
const vazio = () => ({
  id: null as number | null,
  versao: null as number | null,
  estabelecimento: '',
  especialidade: '',
  descricao: '',
  exigeSubjetivo: false,
  exigeObjetivo: false,
  exigeAvaliacao: true,
  exigePlano: true,
  usaCiap: false,
  exigeCidAvaliacao: true,
  ativo: true,
});
const form = reactive(vazio());

const opcoesEstabelecimento = computed(() => [
  { valor: '', rotulo: t('pep.notaSoap.config.todos') },
  ...(opcoes.data.value?.estabelecimentos ?? []).map((e) => ({ valor: String(e.id), rotulo: e.nome })),
]);
const opcoesEspecialidade = computed(() => [
  { valor: '', rotulo: t('pep.notaSoap.config.todas') },
  ...(opcoes.data.value?.especialidades ?? []).map((e) => ({ valor: String(e.id), rotulo: e.nome })),
]);
const nomeDe = (tipo: 'estabelecimentos' | 'especialidades', id: number | null) =>
  id === null
    ? t(tipo === 'estabelecimentos' ? 'pep.notaSoap.config.todos' : 'pep.notaSoap.config.todas')
    : (opcoes.data.value?.[tipo].find((x) => x.id === id)?.nome ?? `#${id}`);

const idOuNull = (v: string) => (v ? Number(v) : null);
const corpo = computed(() => ({
  id: form.id,
  versao: form.versao,
  estabelecimento: idOuNull(form.estabelecimento),
  especialidade: idOuNull(form.especialidade),
  descricao: form.descricao.trim(),
  exigeSubjetivo: form.exigeSubjetivo,
  exigeObjetivo: form.exigeObjetivo,
  exigeAvaliacao: form.exigeAvaliacao,
  exigePlano: form.exigePlano,
  usaCiap: form.usaCiap,
  exigeCidAvaliacao: form.exigeCidAvaliacao,
  ativo: form.ativo,
}));
// Validação na hora: a mesma regra do servidor, mais a combinação repetida contra a lista já lida.
const falhas = computed(() => {
  const c = corpo.value;
  const f = validarConfiguracaoNota({
    ...c,
    estabelecimentoId: c.estabelecimento,
    especialidadeId: c.especialidade,
  }).map((x) => x.mensagem);
  const repetida = (lista.data.value ?? []).some(
    (x) =>
      x.id !== c.id && x.estabelecimentoId === c.estabelecimento && x.especialidadeId === c.especialidade,
  );
  if (repetida) f.push(t('pep.notaSoap.config.repetida'));
  return f;
});

function editar(c: ConfiguracaoNotaTela) {
  ok.value = '';
  Object.assign(form, {
    id: c.id,
    versao: c.versao,
    estabelecimento: c.estabelecimentoId === null ? '' : String(c.estabelecimentoId),
    especialidade: c.especialidadeId === null ? '' : String(c.especialidadeId),
    descricao: c.descricao,
    exigeSubjetivo: c.exigeSubjetivo,
    exigeObjetivo: c.exigeObjetivo,
    exigeAvaliacao: c.exigeAvaliacao,
    exigePlano: c.exigePlano,
    usaCiap: c.usaCiap,
    exigeCidAvaliacao: c.exigeCidAvaliacao,
    ativo: c.ativo,
  });
}
const limpar = () => Object.assign(form, vazio());

async function gravar() {
  erro.value = null;
  ok.value = '';
  gravando.value = true;
  try {
    await gravarConfiguracaoNota(corpo.value);
    ok.value = t('pep.notaSoap.config.gravada');
    limpar();
    await cliente.invalidateQueries({ queryKey: CHAVE });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="cfg" data-testid="nota-soap-config-tela">
    <h1>{{ t('pep.notaSoap.config.titulo') }}</h1>
    <p class="cfg__dica">{{ t('pep.notaSoap.config.intro') }}</p>
    <MensagemErro v-if="lista.error.value" :erro="lista.error.value" />
    <MensagemErro v-if="opcoes.error.value" :erro="opcoes.error.value" />
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta v-if="ok" variante="info" :texto="ok" anunciar data-testid="nota-soap-config-ok" />

    <template v-if="lista.data.value">
      <h2>{{ t('pep.notaSoap.config.lista') }}</h2>
      <p v-if="!lista.data.value.length" data-testid="nota-soap-config-vazia">
        {{ t('pep.notaSoap.config.nenhuma') }}
      </p>
      <ul v-else class="cfg__lista">
        <li
          v-for="c in lista.data.value"
          :key="c.id"
          :class="{ 'cfg__item--inativa': !c.ativo }"
          :data-testid="`nota-soap-config-${c.id}`"
        >
          <strong>{{ c.descricao }}</strong>
          · {{ nomeDe('estabelecimentos', c.estabelecimentoId) }} ·
          {{ nomeDe('especialidades', c.especialidadeId) }} · {{ t('pep.notaSoap.config.exige') }}:
          {{
            PARTES.filter((p) => c[`exige${p}`])
              .map((p) => t(`pep.notaSoap.partes.${ROTULO_PARTE[p]}`))
              .join(', ')
          }}
          · {{ t('pep.notaSoap.config.cid') }}:
          {{ t(c.exigeCidAvaliacao ? 'pep.notaSoap.config.sim' : 'pep.notaSoap.config.nao') }} ·
          {{ t('pep.notaSoap.config.ciap') }}:
          {{ t(c.usaCiap ? 'pep.notaSoap.config.sim' : 'pep.notaSoap.config.nao') }}
          <span v-if="!c.ativo"> · {{ t('pep.notaSoap.config.inativa') }}</span>
          <SanteBotao
            v-if="podeEditar"
            variante="secundario"
            :rotulo="t('pep.notaSoap.config.editar')"
            :data-testid="`nota-soap-config-editar-${c.id}`"
            @acionar="editar(c)"
          />
        </li>
      </ul>

      <p v-if="!podeEditar" data-testid="nota-soap-config-so-leitura">
        {{ t('pep.notaSoap.config.semPermissao') }}
      </p>
      <form v-else class="cfg__form" data-testid="nota-soap-config-form" @submit.prevent>
        <h2>{{ form.id ? t('pep.notaSoap.config.editar') : t('pep.notaSoap.config.nova') }}</h2>
        <div class="cfg__linha">
          <label>
            {{ t('pep.notaSoap.config.descricao') }}
            <input
              v-model="form.descricao"
              type="text"
              maxlength="150"
              data-testid="nota-soap-config-descricao"
            />
          </label>
          <SanteSelecao
            v-model="form.estabelecimento"
            :rotulo="t('pep.notaSoap.config.estabelecimento')"
            :opcoes="opcoesEstabelecimento"
            data-testid="nota-soap-config-estabelecimento"
          />
          <SanteSelecao
            v-model="form.especialidade"
            :rotulo="t('pep.notaSoap.config.especialidade')"
            :opcoes="opcoesEspecialidade"
            data-testid="nota-soap-config-especialidade"
          />
        </div>
        <fieldset class="cfg__marcas">
          <legend>{{ t('pep.notaSoap.config.partesObrigatorias') }}</legend>
          <label v-for="p in PARTES" :key="p">
            <input
              v-model="form[`exige${p}`]"
              type="checkbox"
              :data-testid="`nota-soap-config-exige-${ROTULO_PARTE[p]}`"
            />
            {{ t(`pep.notaSoap.partes.${ROTULO_PARTE[p]}`) }}
          </label>
        </fieldset>
        <div class="cfg__marcas">
          <label>
            <input
              v-model="form.exigeCidAvaliacao"
              type="checkbox"
              data-testid="nota-soap-config-exige-cid"
            />
            {{ t('pep.notaSoap.config.exigeCid') }}
          </label>
          <label>
            <input v-model="form.usaCiap" type="checkbox" data-testid="nota-soap-config-usa-ciap" />
            {{ t('pep.notaSoap.config.usaCiap') }}
          </label>
          <label>
            <input v-model="form.ativo" type="checkbox" data-testid="nota-soap-config-ativo" />
            {{ t('pep.notaSoap.config.ativo') }}
          </label>
        </div>
        <SanteAlerta
          v-if="falhas.length"
          variante="alerta"
          :texto="falhas.join(' ')"
          data-testid="nota-soap-config-falhas"
        />
        <div class="cfg__linha">
          <SanteBotao
            :rotulo="t('pep.notaSoap.config.gravar')"
            :desabilitado="gravando || falhas.length > 0"
            data-testid="nota-soap-config-gravar"
            @acionar="gravar()"
          />
          <SanteBotao
            v-if="form.id"
            variante="secundario"
            :rotulo="t('pep.notaSoap.config.cancelar')"
            data-testid="nota-soap-config-cancelar"
            @acionar="limpar()"
          />
        </div>
      </form>
    </template>
    <p v-else-if="!lista.error.value">{{ t('pep.carregando') }}</p>
  </section>
</template>

<style scoped>
.cfg__dica {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.cfg__form,
.cfg__lista {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.cfg__lista {
  list-style: none;
  padding: 0;
}
.cfg__lista li {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
}
.cfg__item--inativa {
  color: var(--sgh-texto-secundario);
}
.cfg__linha,
.cfg__marcas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.cfg__marcas {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
}
</style>
