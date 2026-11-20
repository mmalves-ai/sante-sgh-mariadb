<script setup lang="ts">
// Lista de problemas e diagnósticos (só do novo): incluir, resolver, descartar e reativar geram versão nova;
// nada se apaga.
import type { ProblemaPep } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { incluirProblema, lerProblemas, mudarProblema } from '../../api-documentos.js';
import AvisoConsulta from '../../componentes/documentos/AvisoConsulta.vue';
import { dataHoraBr } from '../../formato.js';

const props = defineProps<{ paciente: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const dados = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'problemas', props.paciente]),
  queryFn: () => lerProblemas(props.paciente),
});
const descricao = ref('');
const cid = ref('');
const tipo = ref<'problema' | 'diagnostico'>('diagnostico');
const inicio = ref('');
const opcoesTipo = computed<{ valor: 'problema' | 'diagnostico'; rotulo: string }[]>(() => [
  { valor: 'diagnostico', rotulo: t('pep.doc.problemas.tipos.diagnostico') },
  { valor: 'problema', rotulo: t('pep.doc.problemas.tipos.problema') },
]);
const erro = ref<unknown>(null);
async function incluir(): Promise<void> {
  erro.value = null;
  try {
    await incluirProblema(props.paciente, {
      descricao: descricao.value.trim(),
      tipo: tipo.value,
      ...(cid.value.trim() ? { cid: cid.value.trim().toUpperCase() } : {}),
      ...(inicio.value ? { inicio: inicio.value } : {}),
    });
    descricao.value = '';
    cid.value = '';
    await cliente.invalidateQueries({ queryKey: ['pep', 'doc'] });
  } catch (e) {
    erro.value = e;
  }
}
async function mudar(p: ProblemaPep, situacao: 'ativo' | 'resolvido' | 'descartado'): Promise<void> {
  erro.value = null;
  try {
    await mudarProblema(props.paciente, p.id, {
      situacao,
      versao: p.id,
      ...(situacao !== 'ativo' ? { fim: new Date().toISOString().slice(0, 10) } : {}),
    });
    await cliente.invalidateQueries({ queryKey: ['pep', 'doc'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="aba" aria-labelledby="problemas-titulo" data-testid="aba-problemas-conteudo">
    <h2 id="problemas-titulo">{{ t('pep.doc.problemas.titulo') }}</h2>
    <MensagemErro v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <template v-else>
      <p v-if="dados.data.value.problemas.length === 0">{{ t('pep.doc.nenhum') }}</p>
      <table v-else class="tabela" data-testid="tabela-problemas">
        <thead>
          <tr>
            <th scope="col">{{ t('pep.doc.problemas.descricao') }}</th>
            <th scope="col">{{ t('pep.doc.problemas.cid') }}</th>
            <th scope="col">{{ t('pep.doc.problemas.tipo') }}</th>
            <th scope="col">{{ t('pep.doc.problemas.situacao') }}</th>
            <th scope="col">{{ t('pep.doc.problemas.inicio') }}</th>
            <th scope="col">
              <span class="sr">{{ t('pep.doc.confirmar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in dados.data.value.problemas" :key="p.id">
            <td>{{ p.descricao }}</td>
            <td>{{ p.cid ?? '-' }}</td>
            <td>{{ t(`pep.doc.problemas.tipos.${p.tipo}`) }}</td>
            <td>
              {{ t(`pep.doc.problemas.situacoes.${p.situacao}`) }} ·
              {{ t('pep.doc.problemas.versoes', { n: p.versoes }) }}
            </td>
            <td>{{ dataHoraBr(p.inicio) || dataHoraBr(p.em) }}</td>
            <td class="acoes">
              <template v-if="dados.data.value.criar.pode">
                <SanteBotao
                  v-if="p.situacao === 'ativo'"
                  variante="secundario"
                  :rotulo="t('pep.doc.problemas.resolver')"
                  @acionar="mudar(p, 'resolvido')"
                />
                <SanteBotao
                  v-if="p.situacao === 'ativo'"
                  variante="destrutivo"
                  :rotulo="t('pep.doc.problemas.descartar')"
                  :confirmacao="t('pep.doc.problemas.descartarPergunta', { descricao: p.descricao })"
                  @acionar="mudar(p, 'descartado')"
                />
                <SanteBotao
                  v-if="p.situacao === 'resolvido'"
                  variante="texto"
                  :rotulo="t('pep.doc.problemas.reativar')"
                  @acionar="mudar(p, 'ativo')"
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <AvisoConsulta :acao="dados.data.value.criar" />
      <form
        v-if="dados.data.value.criar.pode"
        class="form"
        data-testid="form-problema"
        @submit.prevent="incluir"
      >
        <h3>{{ t('pep.doc.problemas.novo') }}</h3>
        <div class="linha">
          <label
            ><span>{{ t('pep.doc.problemas.descricao') }}</span
            ><input v-model="descricao" maxlength="200" required data-testid="problema-descricao"
          /></label>
          <label
            ><span>{{ t('pep.doc.problemas.cid') }}</span
            ><input v-model="cid" maxlength="6"
          /></label>
          <SanteSelecao
            v-model="tipo"
            class="campo"
            :rotulo="t('pep.doc.problemas.tipo')"
            :opcoes="opcoesTipo"
          />
          <label
            ><span>{{ t('pep.doc.problemas.inicio') }}</span
            ><input v-model="inicio" type="date"
          /></label>
          <SanteBotao tipo="submit" :rotulo="t('pep.doc.problemas.novo')" />
        </div>
      </form>
      <MensagemErro v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style scoped src="./abas.css"></style>
