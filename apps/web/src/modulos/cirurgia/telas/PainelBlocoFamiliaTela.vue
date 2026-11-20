<script setup lang="ts">
// Painel para familiares do centro cirúrgico (M46, etapa 2; ficha, seção 7 e regra 5): a TV da sala de espera em tela
// cheia pelo token do aparelho (perfil Painel/Totem, conteúdo "bloco"), sem sessão de pessoa. Mostra só o código
// anônimo que a família recebeu, a etapa (em preparo, aguardando, em cirurgia, em recuperação, saiu) e o horário;
// nunca o nome, o procedimento, a sala nem o cirurgião. Relê a cada 1 s (a propagação pedida é abaixo de 2 s; o servidor guarda 0,5 s).
import { PAINEL_FAMILIA_RELEITURA_MS } from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { tokenDoAparelho } from '../../recepcao/api-recepcao.js';
import { lerPainelFamilia } from '../api-bloco-seguro.js';

const props = defineProps<{ dispositivo: string }>();
const { t } = useI18n();
const token = tokenDoAparelho(props.dispositivo);
const painel = useQuery({
  queryKey: ['bloco', 'painel-familia', props.dispositivo],
  queryFn: () => lerPainelFamilia(token as string),
  enabled: token !== null,
  refetchInterval: PAINEL_FAMILIA_RELEITURA_MS,
  retry: false,
});
const recusado = computed(() => {
  const e = painel.error.value;
  return e instanceof ErroApi && (e.status === 401 || e.status === 403);
});
const hora = (x: string | null | undefined) => (x ? x.replace('T', ' ').slice(11, 16) : '—');
</script>

<template>
  <main class="painel-familia" data-testid="painel-bloco-familia">
    <p v-if="!token" class="mensagem-grande" role="alert">{{ t('blocoSeguro.painel.naoConfigurado') }}</p>
    <p v-else-if="recusado" class="mensagem-grande" role="alert">
      {{ t('blocoSeguro.painel.foraDeServico') }}
    </p>
    <p v-else-if="painel.isError.value && !painel.data.value" class="mensagem-grande" role="alert">
      {{
        t('blocoSeguro.painel.semConexao', {
          hora: painel.dataUpdatedAt.value ? hora(new Date(painel.dataUpdatedAt.value).toISOString()) : '—',
        })
      }}
    </p>
    <p v-else-if="!painel.data.value" role="status">{{ t('blocoSeguro.carregando') }}</p>
    <template v-else>
      <h1>{{ painel.data.value.nome || t('blocoSeguro.painel.titulo') }}</h1>
      <p class="orientacao">{{ t('blocoSeguro.painel.orientacao') }}</p>
      <p
        v-if="painel.data.value.linhas.length === 0"
        class="mensagem-grande"
        data-testid="painel-familia-vazio"
      >
        {{ t('blocoSeguro.painel.vazio') }}
      </p>
      <table v-else data-testid="painel-familia-tabela">
        <caption class="visualmente-oculto">
          {{
            t('blocoSeguro.painel.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('blocoSeguro.painel.codigo') }}</th>
            <th scope="col">{{ t('blocoSeguro.painel.etapa') }}</th>
            <th scope="col">{{ t('blocoSeguro.painel.desde') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="l in painel.data.value.linhas"
            :key="l.codigo"
            :data-etapa="l.etapa"
            :data-testid="`painel-familia-${l.codigo}`"
          >
            <td class="codigo">{{ l.codigo }}</td>
            <td>{{ l.rotuloEtapa }}</td>
            <td>{{ l.desde }}</td>
          </tr>
        </tbody>
      </table>
      <p class="rodape" aria-live="polite">
        {{ t('blocoSeguro.painel.atualizado', { hora: hora(painel.data.value.atualizadoEm) }) }}
        <template v-if="painel.isError.value">
          · {{ t('blocoSeguro.painel.semConexao', { hora: hora(painel.data.value.atualizadoEm) }) }}</template
        >
      </p>
    </template>
  </main>
</template>

<style scoped>
.painel-familia {
  min-height: 100vh;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  padding: var(--sgh-espaco-3);
  font-size: 1.75rem;
}
.orientacao {
  color: var(--sgh-texto-secundario);
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.codigo {
  font-weight: 700;
  letter-spacing: 0.12em;
  font-size: 2.25rem;
}
.mensagem-grande {
  font-size: 2rem;
  font-weight: 700;
  text-align: center;
}
.rodape {
  color: var(--sgh-texto-secundario);
}
.visualmente-oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
