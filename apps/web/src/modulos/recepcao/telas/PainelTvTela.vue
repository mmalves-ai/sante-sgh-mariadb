<script setup lang="ts">
// Painel de TV de setor (M19; ficha, seção 7): tela cheia pelo token do aparelho, com o conteúdo do módulo dono
// (leitos ao vivo do M16; o pronto atendimento por cor de risco do M44, com a senha ou as iniciais, a cor com o nome
// escrito e a espera; higienização e bloco cirúrgico quando os marcos deles chegarem). Nenhum nome de paciente. Relê a
// cada 30 s.
import '../componentes/estilo-classificacao.css';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { lerPainelTv, tokenDoAparelho } from '../api-recepcao.js';
import { horaDe } from '../formato.js';

const props = defineProps<{ dispositivo: string }>();
const { t } = useI18n();
const token = tokenDoAparelho(props.dispositivo);
const tela = useQuery({
  queryKey: ['paineltv', props.dispositivo],
  queryFn: () => lerPainelTv(token as string),
  enabled: token !== null,
  refetchInterval: 30_000,
  retry: false,
});
const recusado = computed(() => {
  const e = tela.error.value;
  return e instanceof ErroApi && (e.status === 401 || e.status === 403);
});
</script>

<template>
  <main class="painel-setor" data-testid="painel-tv-setor">
    <p v-if="!token" class="mensagem-grande" role="alert">{{ t('recepcao.painel.naoConfigurado') }}</p>
    <p v-else-if="recusado" class="mensagem-grande" role="alert">{{ t('recepcao.painel.foraDeServico') }}</p>
    <p v-else-if="tela.isError.value" class="mensagem-grande" role="alert">
      {{
        t('recepcao.painel.semConexao', {
          hora: tela.dataUpdatedAt.value ? horaDe(new Date(tela.dataUpdatedAt.value).toISOString()) : '—',
        })
      }}
    </p>
    <p v-else-if="!tela.data.value" role="status">{{ t('recepcao.carregando') }}</p>
    <template v-else>
      <h1>{{ tela.data.value.nome }}</h1>
      <p v-if="tela.data.value.colunas.length === 0" class="mensagem-grande">
        {{ t('recepcao.painelTv.semConteudo') }}
      </p>
      <template v-else>
        <ul class="resumo">
          <li v-for="r in tela.data.value.resumo" :key="r.rotulo">
            <strong>{{ r.valor }}</strong> {{ r.rotulo }}
          </li>
        </ul>
        <table>
          <caption class="visualmente-oculto">
            {{
              tela.data.value.nome
            }}
          </caption>
          <thead>
            <tr>
              <th v-for="c in tela.data.value.colunas" :key="c.campo" scope="col">{{ c.rotulo }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(l, i) in tela.data.value.linhas"
              :key="i"
              :class="l['cor'] ? `risco-faixa-${l['cor']}` : ''"
              :data-cor="l['cor'] ?? undefined"
            >
              <td v-for="c in tela.data.value.colunas" :key="c.campo">{{ l[c.campo] ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </template>
      <p class="rodape">
        {{ t('recepcao.painelTv.atualizado', { hora: horaDe(tela.data.value.atualizadoEm) }) }}
      </p>
    </template>
  </main>
</template>

<style scoped>
.painel-setor {
  min-height: 100vh;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  padding: var(--sgh-espaco-3);
  font-size: 1.5rem;
}
.resumo {
  list-style: none;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-4);
  font-size: 2rem;
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
