<script setup lang="ts">
// Abas da "Migração gradual dos usuários" (M37): cada aba é uma rota com a sua permissão; a aba sem permissão não
// aparece (o servidor confere de novo).
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';

const props = defineProps<{ atual: string }>();
const { t } = useI18n();
const { permissoes } = usarSessao();
const ABAS = [
  { id: 'setores', rota: '/administracao/coexistencia/migracao', permissao: 'config.coexistencia.ler' },
  {
    id: 'pessoas',
    rota: '/administracao/coexistencia/migracao/pessoas',
    permissao: 'config.coexistenciaPessoas.ler',
  },
  {
    id: 'treinamento',
    rota: '/administracao/coexistencia/migracao/treinamento',
    permissao: 'config.coexistenciaTreino.ler',
  },
  {
    id: 'indicadores',
    rota: '/administracao/coexistencia/migracao/indicadores',
    permissao: 'config.coexistencia.ler',
  },
  { id: 'onda1', rota: '/administracao/coexistencia/migracao/onda1', permissao: 'config.coexistencia.ler' },
  { id: 'onda2', rota: '/administracao/coexistencia/migracao/onda2', permissao: 'config.coexistencia.ler' },
  { id: 'onda3', rota: '/administracao/coexistencia/migracao/onda3', permissao: 'config.coexistencia.ler' },
  { id: 'onda4', rota: '/administracao/coexistencia/migracao/onda4', permissao: 'config.coexistencia.ler' },
  { id: 'fim', rota: '/administracao/coexistencia/migracao/fim', permissao: 'config.coexistencia.ler' },
  // M58 (etapa 1): a prontidão do desligamento por hospital (cartão da migração gradual; ficha, seção 7).
  {
    id: 'desligamento',
    rota: '/administracao/coexistencia/desligamento',
    permissao: 'config.coexistencia.ler',
  },
  // M59 (etapa 5): o termo das concessões da coexistência (cartão; ficha do M59, seção 7).
  {
    id: 'concessoes',
    rota: '/administracao/coexistencia/concessoes',
    permissao: 'config.coexistencia.ler',
  },
  // M59 (etapa 6): a retrocompatibilidade do banco e o plano de evolução do modelo (ADR 0033; só leitura).
  {
    id: 'retrocompatibilidade',
    rota: '/administracao/coexistencia/retrocompatibilidade',
    permissao: 'config.coexistencia.ler',
  },
  // M58 (etapa 2): o ensaio da versão 5 do motor na cópia (o relatório lido pela verificação da estrutura do banco).
  {
    id: 'ensaioFirebird5',
    rota: '/administracao/coexistencia/desligamento/ensaio-firebird5',
    permissao: 'config.schema.ler',
  },
  // M58 (etapa 3): o ensaio da conversão do texto para UTF-8 na cópia em versão 5.
  {
    id: 'ensaioUtf8',
    rota: '/administracao/coexistencia/desligamento/ensaio-utf8',
    permissao: 'config.schema.ler',
  },
  // M58 (etapa 5): a janela em produção de cada passo, a verificação depois dela e a restrição de entrada.
  {
    id: 'janela',
    rota: '/administracao/coexistencia/desligamento/janela',
    permissao: 'config.coexistencia.ler',
  },
  {
    id: 'conducao',
    rota: '/administracao/coexistencia/migracao/conducao',
    permissao: 'acesso.opcao.revogar',
  },
  { id: 'chamados', rota: '/administracao/coexistencia/migracao/chamados', permissao: 'config.chamado.ler' },
] as const;
const visiveis = computed(() => ABAS.filter((a) => permissoes.value.has(a.permissao)));
</script>

<template>
  <nav class="abas-migracao" :aria-label="t('coexistencia.abas.rotulo')" data-testid="abas-migracao">
    <ul>
      <li v-for="a in visiveis" :key="a.id">
        <RouterLink
          :to="a.rota"
          :aria-current="a.id === props.atual ? 'page' : undefined"
          :data-testid="`aba-migracao-${a.id}`"
        >
          {{ t(`coexistencia.abas.${a.id}`) }}
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.abas-migracao ul {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  padding: 0;
  margin: 0 0 var(--sgh-espaco-3);
  list-style: none;
}
.abas-migracao a[aria-current='page'] {
  font-weight: 700;
  text-decoration: underline;
}
</style>
