<script setup lang="ts">
// A operadora como empresa distinta (M56.2, regra 3): registro na ANS, CNPJ, razão social e modalidade. Só o gestor da
// operadora inclui e altera (`operadora.empresa.editar`); os demais perfis da operadora consultam.
import {
  MODALIDADES_OPERADORA,
  type ModalidadeOperadora,
  type OperadoraEmpresa,
  SITUACOES_OPERADORA,
  type SituacaoOperadoraEmpresa,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { gravarOperadoraEmpresa } from '../../api-operadora.js';
import { opcoesDe, type Tela } from './comum.js';
import ErroOperadora from './ErroOperadora.vue';

const props = defineProps<{ tela: Tela }>();
const emit = defineEmits<{ mudou: [] }>();
const { t } = useI18n();

const aberto = ref<OperadoraEmpresa | 'nova' | null>(null);
const registroAns = ref('');
const cnpj = ref('');
const razaoSocial = ref('');
const nomeFantasia = ref('');
const modalidade = ref<ModalidadeOperadora>('medicinaGrupo');
const situacao = ref<SituacaoOperadoraEmpresa>('ativa');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);

const opcoesModalidade = opcoesDe(MODALIDADES_OPERADORA, false);
const opcoesSituacao = opcoesDe(SITUACOES_OPERADORA, false);
const pode = computed(() => props.tela.acoes.editarEmpresa);

function abrir(o: OperadoraEmpresa | 'nova'): void {
  aberto.value = o;
  erro.value = null;
  mensagem.value = null;
  const x = o === 'nova' ? null : o;
  registroAns.value = x?.registroAns ?? '';
  cnpj.value = x?.cnpj ?? '';
  razaoSocial.value = x?.razaoSocial ?? '';
  nomeFantasia.value = x?.nomeFantasia ?? '';
  modalidade.value = x?.modalidade ?? 'medicinaGrupo';
  situacao.value = x?.situacao ?? 'ativa';
}

async function gravar(): Promise<void> {
  const o = aberto.value;
  if (!o) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await gravarOperadoraEmpresa(o === 'nova' ? null : o.id, {
      registroAns: registroAns.value,
      cnpj: cnpj.value,
      razaoSocial: razaoSocial.value,
      nomeFantasia: nomeFantasia.value || null,
      modalidade: modalidade.value,
      situacao: situacao.value,
      ...(o === 'nova' ? {} : { versao: o.versao }),
    });
    mensagem.value = r.mensagem;
    aberto.value = null;
    emit('mudou');
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="ope-empresa-titulo" data-testid="operadora-empresa">
    <h2 id="ope-empresa-titulo">{{ t('operadora.f1.empresa.titulo') }}</h2>
    <p class="secundario">{{ t('operadora.f1.empresa.texto') }}</p>
    <p v-if="mensagem" role="status" data-testid="mensagem-empresa">{{ mensagem }}</p>
    <table v-if="tela.operadoras.length" class="tabela" data-testid="tabela-empresas">
      <thead>
        <tr>
          <th scope="col">{{ t('operadora.f1.empresa.razaoSocial') }}</th>
          <th scope="col">{{ t('operadora.f1.empresa.registroAns') }}</th>
          <th scope="col">{{ t('operadora.f1.empresa.cnpj') }}</th>
          <th scope="col">{{ t('operadora.f1.empresa.modalidade') }}</th>
          <th scope="col">{{ t('operadora.f1.situacao') }}</th>
          <th v-if="pode" scope="col">{{ t('operadora.f1.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="o in tela.operadoras" :key="o.id">
          <th scope="row">{{ o.razaoSocial }}</th>
          <td>{{ o.registroAns }}</td>
          <td>{{ o.cnpj }}</td>
          <td>{{ MODALIDADES_OPERADORA[o.modalidade] }}</td>
          <td>{{ SITUACOES_OPERADORA[o.situacao] }}</td>
          <td v-if="pode">
            <SanteBotao :rotulo="t('operadora.f1.editar')" variante="texto" @acionar="abrir(o)" />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('operadora.f1.semOperadora') }}</p>
    <div v-if="pode && !aberto" class="acoes">
      <SanteBotao
        :rotulo="t('operadora.f1.novo')"
        variante="secundario"
        data-testid="empresa-incluir"
        @acionar="abrir('nova')"
      />
    </div>
    <form v-if="aberto" class="campos" data-testid="form-empresa" @submit.prevent="gravar">
      <SanteCampoTexto
        v-model="registroAns"
        :rotulo="t('operadora.f1.empresa.registroAns')"
        :max-bytes="8"
        obrigatorio
      />
      <SanteCampoTexto v-model="cnpj" :rotulo="t('operadora.f1.empresa.cnpj')" :max-bytes="18" obrigatorio />
      <SanteCampoTexto
        v-model="razaoSocial"
        :rotulo="t('operadora.f1.empresa.razaoSocial')"
        :max-bytes="120"
        obrigatorio
      />
      <SanteCampoTexto
        v-model="nomeFantasia"
        :rotulo="t('operadora.f1.empresa.nomeFantasia')"
        :max-bytes="60"
      />
      <SanteSelecao
        v-model="modalidade"
        :rotulo="t('operadora.f1.empresa.modalidade')"
        :opcoes="opcoesModalidade"
        data-testid="empresa-modalidade"
      />
      <SanteSelecao v-model="situacao" :rotulo="t('operadora.f1.situacao')" :opcoes="opcoesSituacao" />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('operadora.f1.gravar')"
          variante="primario"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="empresa-gravar"
        />
        <SanteBotao :rotulo="t('operadora.f1.cancelar')" variante="texto" @acionar="aberto = null" />
      </div>
    </form>
    <ErroOperadora v-if="erro" :erro="erro" />
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
