<script setup lang="ts">
// Parecer e interconsulta (ficha do M23, regra 10): `/pep/interconsultas`. A fila por especialidade ou categoria,
// com prioridade, prazo e situação; aceitar (o vínculo assistencial vem do aceite), responder (o registro clínico
// de resposta, no formulário) e cancelar (só quem pediu, com motivo).
import { CATEGORIAS_ASSISTENCIAIS, SITUACOES_PARECER } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { aceitarParecer, cancelarParecer, lerFila } from '../api-documentos.js';
import AvisoConsulta from '../componentes/documentos/AvisoConsulta.vue';
import { dataHoraBr } from '../formato.js';
// M52.3: o atalho para quem está de plantão agora (o especialista do parecer pode estar de plantão ou de sobreaviso).
import LinkPlantaoAgora from '../../pessoas/componentes/LinkPlantaoAgora.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const especialidade = ref<number | null>(null);
const categoria = ref('');
const situacao = ref('');
const fila = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'fila', especialidade.value, categoria.value, situacao.value]),
  queryFn: () =>
    lerFila({
      ...(especialidade.value !== null ? { especialidade: especialidade.value } : {}),
      ...(categoria.value ? { categoria: categoria.value } : {}),
      ...(situacao.value ? { situacao: situacao.value } : {}),
    }),
});
const opcoesEspecialidade = computed(() => [
  { valor: null, rotulo: t('pep.doc.pareceres.todas') },
  ...(fila.data.value?.especialidades ?? []).map((e) => ({ valor: e.id, rotulo: e.nome })),
]);
const opcoesCategoria = computed(() => [
  { valor: '', rotulo: t('pep.doc.pareceres.todas') },
  ...CATEGORIAS_ASSISTENCIAIS.map((c) => ({ valor: c as string, rotulo: t(`pep.doc.categorias.${c}`) })),
]);
const opcoesSituacao = computed(() => [
  { valor: '', rotulo: t('pep.doc.pareceres.todas') },
  ...SITUACOES_PARECER.map((s) => ({ valor: s as string, rotulo: t(`pep.doc.pareceres.situacoes.${s}`) })),
]);
const motivo = ref('');
const erro = ref<unknown>(null);
async function aceitar(id: number): Promise<void> {
  erro.value = null;
  try {
    await aceitarParecer(id);
    await cliente.invalidateQueries({ queryKey: ['pep', 'doc', 'fila'] });
  } catch (e) {
    erro.value = e;
  }
}
async function cancelar(id: number): Promise<void> {
  erro.value = null;
  try {
    await cancelarParecer(id, motivo.value.trim());
    motivo.value = '';
    await cliente.invalidateQueries({ queryKey: ['pep', 'doc', 'fila'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="aba" aria-labelledby="pareceres-titulo" data-testid="tela-interconsultas">
    <h1 id="pareceres-titulo">{{ t('pep.doc.pareceres.titulo') }}</h1>
    <LinkPlantaoAgora />
    <p>{{ t('pep.doc.pareceres.texto') }}</p>
    <form class="linha" @submit.prevent>
      <SanteSelecao
        v-model="especialidade"
        class="campo"
        :rotulo="t('pep.doc.pareceres.especialidade')"
        :opcoes="opcoesEspecialidade"
      />
      <SanteSelecao
        v-model="categoria"
        class="campo"
        :rotulo="t('pep.doc.pareceres.categoria')"
        :opcoes="opcoesCategoria"
      />
      <SanteSelecao
        v-model="situacao"
        class="campo"
        :rotulo="t('pep.doc.pareceres.situacao')"
        :opcoes="opcoesSituacao"
      />
    </form>
    <MensagemErro v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <template v-else>
      <p>{{ t('pep.doc.pareceres.historico', fila.data.value.historico) }}</p>
      <AvisoConsulta :acao="fila.data.value.responder" />
      <p v-if="fila.data.value.itens.length === 0">{{ t('pep.doc.nenhum') }}</p>
      <table v-else class="tabela" data-testid="tabela-fila">
        <thead>
          <tr>
            <th scope="col">{{ t('pep.doc.pareceres.col.paciente') }}</th>
            <th scope="col">{{ t('pep.doc.pareceres.col.especialidade') }}</th>
            <th scope="col">{{ t('pep.doc.pareceres.col.prioridade') }}</th>
            <th scope="col">{{ t('pep.doc.pareceres.col.prazo') }}</th>
            <th scope="col">{{ t('pep.doc.pareceres.col.situacao') }}</th>
            <th scope="col">{{ t('pep.doc.pareceres.col.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in fila.data.value.itens" :key="p.id" :data-testid="`parecer-${p.id}`">
            <td>
              <RouterLink :to="`/pep/paciente/${p.paciente}/linha-do-tempo`">{{ p.nome }}</RouterLink>
            </td>
            <td>{{ p.especialidade ?? (p.categoria ? t(`pep.doc.categorias.${p.categoria}`) : '-') }}</td>
            <td>{{ t(`pep.doc.pareceres.prioridades.${p.prioridade}`) }}</td>
            <td>
              {{ dataHoraBr(p.prazo) }}
              <span v-if="p.atrasado" class="marcador">{{ t('pep.doc.pareceres.atrasado') }}</span>
            </td>
            <td>{{ t(`pep.doc.pareceres.situacoes.${p.situacao}`) }}</td>
            <td class="acoes">
              <template
                v-if="
                  fila.data.value.responder.pode && (p.situacao === 'solicitado' || p.situacao === 'aceito')
                "
              >
                <SanteBotao
                  v-if="p.situacao === 'solicitado'"
                  variante="secundario"
                  :rotulo="t('pep.doc.pareceres.aceitar')"
                  :data-testid="`aceitar-${p.id}`"
                  @acionar="aceitar(p.id)"
                />
                <RouterLink
                  :to="{ path: `/pep/${p.paciente}/registro/MED10`, query: { parecer: p.id } }"
                  :data-testid="`responder-${p.id}`"
                  >{{ t('pep.doc.pareceres.responder') }}</RouterLink
                >
              </template>
              <template
                v-if="fila.data.value.criar.pode && (p.situacao === 'solicitado' || p.situacao === 'aceito')"
              >
                <label class="campo"
                  ><span>{{ t('pep.doc.pareceres.motivoCancelamento') }}</span
                  ><input v-model="motivo" maxlength="500"
                /></label>
                <SanteBotao
                  variante="destrutivo"
                  :rotulo="t('pep.doc.pareceres.cancelar')"
                  :confirmacao="t('pep.doc.pareceres.cancelar')"
                  @acionar="cancelar(p.id)"
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <MensagemErro v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style scoped src="./abas/abas.css"></style>
