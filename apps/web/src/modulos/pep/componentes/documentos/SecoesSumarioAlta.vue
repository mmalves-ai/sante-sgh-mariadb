<script setup lang="ts">
// Seções configuradas do sumário de alta no atendimento (F3.3, linha 03-PEP L124): mostra ao médico a lista do que o
// estabelecimento pede (obrigatórias marcadas) e abre um texto para cada seção sem campo próprio no sumário
// (texto livre, orientações, exames, dispositivos). O texto vai em `secoes` do sumário, pelo código da seção; a
// finalização recusa a obrigatória vazia (regra do domínio na API).
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { secoesDoAtendimento, type TextoSecao, TIPOS_DE_TEXTO } from '../../api-sumario-secoes.js';

const props = defineProps<{ atendimento: number; desabilitado?: boolean }>();
const modelo = defineModel<TextoSecao[]>({ required: true });
const { t } = useI18n();
const q = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'alta-secoes', props.atendimento]),
  queryFn: () => secoesDoAtendimento(props.atendimento),
  retry: false,
});
const secoes = computed(() => q.data.value?.itens ?? []);
const deTexto = computed(() =>
  secoes.value.filter(
    (s) => TIPOS_DE_TEXTO.has(s.tipoConteudo) && !(s.origem === 'padrao' && s.codigo === 'motivo'),
  ),
);
function texto(codigo: string): string {
  return modelo.value.find((x) => x.codigo === codigo)?.texto ?? '';
}
function escrever(codigo: string, titulo: string, v: string): void {
  const resto = modelo.value.filter((x) => x.codigo !== codigo);
  modelo.value = v.trim() ? [...resto, { codigo, titulo, texto: v }] : resto;
}
</script>

<template>
  <fieldset
    v-if="secoes.length && secoes[0]!.origem !== 'padrao'"
    class="secoes"
    data-testid="sumario-secoes-config"
  >
    <legend>{{ t('pep.sumarioSecoes.naAlta.configuradas') }}</legend>
    <ul class="lista">
      <li v-for="s in secoes" :key="s.codigo" :data-testid="`sumario-secao-${s.codigo}`">
        {{ s.descricao }}
        <strong v-if="s.obrigatorio">({{ t('pep.sumarioSecoes.naAlta.obrigatoria') }})</strong>
      </li>
    </ul>
    <label v-for="s in deTexto" :key="s.codigo" class="campo"
      ><span>{{ s.descricao }}<template v-if="s.obrigatorio"> *</template></span
      ><textarea
        :value="texto(s.codigo)"
        rows="2"
        maxlength="4000"
        :required="s.obrigatorio"
        :disabled="desabilitado"
        :data-testid="`sumario-secao-texto-${s.codigo}`"
        @input="escrever(s.codigo, s.descricao, ($event.target as HTMLTextAreaElement).value)"
      />
    </label>
  </fieldset>
</template>

<style scoped>
.secoes {
  border: 1px solid var(--sante-borda, #ccc);
  padding: 0.5rem;
}
.lista {
  margin: 0 0 0.5rem;
}
.campo {
  display: flex;
  flex-direction: column;
}
</style>
