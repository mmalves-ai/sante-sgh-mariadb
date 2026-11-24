<script setup lang="ts">
// Herança do atendimento anterior: `/recepcao/atendimento/heranca`. O que a ficha nova traz preenchido do último
// atendimento do paciente (convênio, profissional, carteirinha, plano…). Duas colunas, cada uma com o seu botão: a do
// estabelecimento (vale para todos) e a pessoal (só para mim: segue o estabelecimento, herda ou não herda). "Seguir o
// estabelecimento" encerra a regra pessoal sem apagá-la. A gravação confere a configuração lida (outra estação mudou:
// o aviso e a releitura).
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { alterarHeranca, lerConfiguracaoHeranca, novaChave } from '../api-atendimento.js';
import ErroAtendimento from '../componentes/ErroAtendimento.vue';
import { usarAtendimento } from '../usar-atendimento.js';

type Pessoal = 'segue' | 'sim' | 'nao';
const { t } = useI18n();
const cliente = useQueryClient();
const { pode } = usarAtendimento();
const cfg = useQuery({ queryKey: ['atendimento', 'heranca'], queryFn: () => lerConfiguracaoHeranca() });
const doEstabelecimento = ref<Record<string, boolean>>({});
const pessoal = ref<Record<string, Pessoal>>({});
const opcoesPessoal = computed(() => [
  { valor: 'segue' as Pessoal, rotulo: t('atendimento.heranca.segue') },
  { valor: 'sim' as Pessoal, rotulo: t('atendimento.heranca.herda') },
  { valor: 'nao' as Pessoal, rotulo: t('atendimento.heranca.naoHerda') },
]);
const comoPessoal = (v: boolean | null): Pessoal => (v === null ? 'segue' : v ? 'sim' : 'nao');
watch(
  () => cfg.data.value,
  (c) => {
    if (!c) return;
    doEstabelecimento.value = Object.fromEntries(c.campos.map((x) => [x.campo, x.estabelecimento]));
    pessoal.value = Object.fromEntries(c.campos.map((x) => [x.campo, comoPessoal(x.pessoal)]));
  },
  { immediate: true },
);
const podeGravar = pode('atendimento.alterarHeranca');
const mudouEstabelecimento = computed(() =>
  (cfg.data.value?.campos ?? []).filter((c) => doEstabelecimento.value[c.campo] !== c.estabelecimento),
);
const mudouPessoal = computed(() =>
  (cfg.data.value?.campos ?? []).filter((c) => pessoal.value[c.campo] !== comoPessoal(c.pessoal)),
);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function gravar(paraMim: boolean): Promise<void> {
  const c = cfg.data.value;
  if (!c) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const marcas = paraMim
      ? Object.fromEntries(
          mudouPessoal.value.map((x) => {
            const v = pessoal.value[x.campo];
            return [x.campo, v === 'segue' ? null : v === 'sim'];
          }),
        )
      : Object.fromEntries(
          mudouEstabelecimento.value.map((x) => [x.campo, doEstabelecimento.value[x.campo]]),
        );
    const r = await alterarHeranca(
      { versao: c.versao, ...(paraMim ? { paraMim: true } : {}), marcas },
      novaChave('heranca'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['atendimento'] });
  } catch (x) {
    erro.value = x;
    await cfg.refetch();
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="heranca-titulo" data-testid="tela-heranca">
    <h1 id="heranca-titulo">{{ t('atendimento.heranca.titulo') }}</h1>
    <p>{{ t('atendimento.heranca.texto') }}</p>
    <ErroAtendimento v-if="cfg.isError.value" :erro="cfg.error.value" />
    <p v-else-if="!cfg.data.value" role="status">{{ t('atendimento.carregando') }}</p>
    <form v-else class="painel" @submit.prevent>
      <table class="tabela" data-testid="tabela-heranca">
        <thead>
          <tr>
            <th scope="col">{{ t('atendimento.heranca.campos') }}</th>
            <th scope="col">{{ t('atendimento.heranca.estabelecimento') }}</th>
            <th scope="col">{{ t('atendimento.heranca.paraMim') }}</th>
            <th scope="col">{{ t('atendimento.heranca.emVigor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in cfg.data.value.campos" :key="c.campo">
            <th scope="row">{{ c.rotulo }}</th>
            <td>
              <input
                v-model="doEstabelecimento[c.campo]"
                type="checkbox"
                :disabled="!podeGravar"
                :aria-label="`${c.rotulo}: ${t('atendimento.heranca.estabelecimento')}`"
                :data-testid="`heranca-${c.campo}`"
              />
            </td>
            <td>
              <SanteSelecao
                v-model="pessoal[c.campo]"
                :desabilitado="!podeGravar"
                ocultar-rotulo
                :rotulo="`${c.rotulo}: ${t('atendimento.heranca.paraMim')}`"
                :opcoes="opcoesPessoal"
                :data-testid="`heranca-pessoal-${c.campo}`"
              />
            </td>
            <td :data-testid="`heranca-vigor-${c.campo}`">
              {{ c.herda ? t('atendimento.heranca.herda') : t('atendimento.heranca.naoHerda') }}
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="podeGravar" class="acoes">
        <SanteBotao
          :rotulo="t('atendimento.heranca.gravarEstabelecimento')"
          :desabilitado="!mudouEstabelecimento.length || ocupado"
          data-testid="botao-gravar-heranca"
          @acionar="gravar(false)"
        />
        <SanteBotao
          :rotulo="t('atendimento.heranca.gravarPessoal')"
          :desabilitado="!mudouPessoal.length || ocupado"
          data-testid="botao-gravar-heranca-pessoal"
          @acionar="gravar(true)"
        />
      </p>
      <p v-if="mensagem" role="status">{{ mensagem }}</p>
      <ErroAtendimento v-if="erro" :erro="erro" />
    </form>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
