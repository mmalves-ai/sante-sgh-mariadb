<script setup lang="ts">
// Exportação dos profissionais ao cadastro nacional (C3-011, 02-CAD linha 29, item 3), na aba de conferência do
// cadastro SUS do estabelecimento: escolhe a competência, gera o arquivo XML das lotações vigentes (quem tem pendência
// fica fora e é listado), e baixa o arquivo guardado de cada exportação. O leiaute segue com o aviso para confirmar o
// esquema oficial com o gestor (central de integrações, integração 'cnes').
import { SanteBotao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  exportarProfissionaisCnes,
  lerArquivoExportacaoCnes,
  lerExportacoesCnes,
  type ExportadoCnes,
} from '../api-exportacao-cnes.js';

const props = defineProps<{ podeEditar: boolean }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Exportação dos profissionais ao cadastro nacional',
      explicacao:
        'Gera o arquivo XML das lotações vigentes na competência (CPF, cartão de saúde, ocupação, vínculo e carga ' +
        'horária) para importar no sistema do cadastro nacional. Quem tem pendência fica fora do arquivo e aparece abaixo.',
      competencia: 'Competência',
      exportar: 'Gerar arquivo',
      gerado: 'Arquivo {nome} gerado com {n} lotação(ões); {p} com pendência.',
      pendencias: 'Pendências (fora do arquivo)',
      leiaute: 'Leiaute {versao}',
      vazio: 'Nenhuma exportação ainda.',
      baixar: 'Baixar arquivo',
      remessa: 'Competência {c}, remessa {n}',
      exportadaEm: 'exportada em {d}',
    },
  },
});

const cliente = useQueryClient();
const lista = useQuery({
  queryKey: ['sus', 'estabelecimento', 'cnes', 'exportacoes'],
  queryFn: lerExportacoesCnes,
});
const f = reactive({ competencia: new Date().toISOString().slice(0, 7) });
const resultado = ref<ExportadoCnes | null>(null);
const exportar = useMutation({
  mutationFn: () => exportarProfissionaisCnes(f.competencia.replace('-', '')),
  onSuccess: (r) => {
    resultado.value = r;
    void cliente.invalidateQueries({ queryKey: ['sus', 'estabelecimento', 'cnes', 'exportacoes'] });
  },
});
const baixar = useMutation({
  mutationFn: (id: number) => lerArquivoExportacaoCnes(id),
  onSuccess: (a) => {
    const url = URL.createObjectURL(new Blob([a.conteudo], { type: 'application/xml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = a.nomeArquivo;
    link.click();
    URL.revokeObjectURL(url);
  },
});
const competenciaTela = (c: string) => `${c.slice(4, 6)}/${c.slice(0, 4)}`;
const dataTela = (d: string | null) => (d ? new Date(d).toLocaleString('pt-BR') : '');
</script>

<template>
  <section
    class="exportacao-cnes"
    aria-labelledby="estab-sus-cnes-exp-titulo"
    data-testid="estab-sus-cnes-exportacao"
  >
    <h2 id="estab-sus-cnes-exp-titulo">{{ t('titulo') }}</h2>
    <p>{{ t('explicacao') }}</p>
    <form
      v-if="props.podeEditar"
      class="formulario"
      data-testid="estab-sus-cnes-exp-form"
      @submit.prevent="exportar.mutate()"
    >
      <label
        >{{ t('competencia') }}
        <input v-model="f.competencia" type="month" required data-testid="estab-sus-cnes-exp-competencia"
      /></label>
      <SanteBotao
        :rotulo="t('exportar')"
        tipo="submit"
        :desabilitado="!f.competencia || exportar.isPending.value"
        data-testid="estab-sus-cnes-exportar"
      />
    </form>
    <MensagemErro v-if="exportar.isError.value" :erro="exportar.error.value" />
    <div v-if="resultado" role="status" data-testid="estab-sus-cnes-exp-resultado">
      <p>
        {{
          t('gerado', {
            nome: resultado.nomeArquivo,
            n: resultado.exportados,
            p: resultado.pendencias.length,
          })
        }}
      </p>
      <p class="aviso" data-testid="estab-sus-cnes-exp-aviso">
        {{ t('leiaute', { versao: resultado.leiaute.versao }) }}: {{ resultado.leiaute.aviso }}
      </p>
      <template v-if="resultado.pendencias.length">
        <h3>{{ t('pendencias') }}</h3>
        <ul data-testid="estab-sus-cnes-exp-pendencias">
          <li v-for="p in resultado.pendencias" :key="p.sequencia">
            {{ p.nome }}: {{ p.motivos.join(' ') }}
          </li>
        </ul>
      </template>
    </div>
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-if="lista.data.value?.length === 0" data-testid="estab-sus-cnes-exp-vazio">{{ t('vazio') }}</p>
    <ul v-else class="exportacoes">
      <li v-for="x in lista.data.value ?? []" :key="x.id" :data-testid="`estab-sus-cnes-exp-${x.id}`">
        {{ t('remessa', { c: competenciaTela(x.competencia), n: x.numeroRemessa }) }} —
        {{ t('exportadaEm', { d: dataTela(x.exportadaEm) }) }} — {{ x.observacao }}
        <SanteBotao
          v-if="x.arquivoId !== null"
          :rotulo="t('baixar')"
          variante="secundario"
          :desabilitado="baixar.isPending.value"
          :data-testid="`estab-sus-cnes-exp-baixar-${x.id}`"
          @acionar="baixar.mutate(x.id)"
        />
      </li>
    </ul>
    <MensagemErro v-if="baixar.isError.value" :erro="baixar.error.value" />
  </section>
</template>

<style scoped>
.exportacao-cnes {
  margin-top: var(--espaco-6, 1.5rem);
}
.aviso {
  font-style: italic;
}
</style>
