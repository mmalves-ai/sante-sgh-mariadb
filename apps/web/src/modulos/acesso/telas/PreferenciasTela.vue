<script setup lang="ts">
// Preferências: tema, densidade, tamanho do texto, tela inicial e atalhos; o segundo fator abre a segurança da
// conta (M59-F2). 01-ADM L84: cada escolha é gravada na conta na hora (sem botão salvar) e segue a pessoa em qualquer
// computador; as visões salvas das telas (colunas e ordenação) aparecem aqui, com a que cada tela abre.
import { PERMISSOES_ACESSO } from '@sgh/contratos';
import { SanteOpcoes } from '@sgh/ui';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { ATALHOS } from '../../../casca/atalhos/atalhos.js';
import {
  usarPreferencias,
  type DensidadeEscolhida,
  type Tema,
} from '../../../casca/preferencias/preferencias.js';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  daConta,
  gravarPreferenciasDaConta,
  lerPreferenciasDaConta,
  type PreferenciasDaConta,
} from '../../../casca/preferencias/preferencias-servidor.js';

const { t } = useI18n();
const p = usarPreferencias();
const { permissoes } = usarSessao();
const podeEditar = computed(() => permissoes.value.has('acesso.preferencia.editar'));
const podeSeguranca = computed(() => permissoes.value.has(PERMISSOES_ACESSO.segundoFatorGerir));
const temas = computed<{ valor: Tema; rotulo: string }[]>(() => [
  { valor: 'claro', rotulo: t('preferencias.temaClaro') },
  { valor: 'escuro', rotulo: t('preferencias.temaEscuro') },
  { valor: 'sistema', rotulo: t('preferencias.temaSistema') },
]);
const densidades = computed<{ valor: DensidadeEscolhida; rotulo: string }[]>(() => [
  { valor: 'compacta', rotulo: t('preferencias.densidadeCompacta') },
  { valor: 'confortavel', rotulo: t('preferencias.densidadeConfortavel') },
]);
const fontes = computed(() => [
  { valor: 'normal' as const, rotulo: t('preferencias.fonteNormal') },
  { valor: 'ampliada' as const, rotulo: t('preferencias.fonteAmpliada') },
]);
const fonte = computed({
  get: () => (p.fonteAmpliada ? 'ampliada' : 'normal'),
  set: (v: 'normal' | 'ampliada') => (p.fonteAmpliada = v === 'ampliada'),
});
const tema = computed({ get: () => p.tema, set: (v: Tema) => (p.tema = v) });
const densidade = computed({ get: () => p.densidade, set: (v: DensidadeEscolhida) => (p.densidade = v) });

const conta = ref<PreferenciasDaConta | null>(null);
const telaInicial = ref('');
const situacaoConta = ref<'carregando' | 'guardada' | 'gravando' | 'erro' | 'local'>('carregando');
let carregada = false;
onMounted(async () => {
  try {
    conta.value = await lerPreferenciasDaConta();
    if (conta.value.guardadas) p.substituir(daConta(conta.value.geral));
    telaInicial.value = conta.value.telaInicial?.codigo ?? '';
    situacaoConta.value = 'guardada';
  } catch {
    situacaoConta.value = 'local';
  }
  carregada = true;
});
async function gravarNaConta(corpo: Parameters<typeof gravarPreferenciasDaConta>[0]): Promise<void> {
  if (!carregada || !podeEditar.value || situacaoConta.value === 'local') return;
  situacaoConta.value = 'gravando';
  try {
    await gravarPreferenciasDaConta(corpo);
    situacaoConta.value = 'guardada';
  } catch {
    situacaoConta.value = 'erro';
  }
}
watch(
  () => [p.tema, p.densidade, p.fonteAmpliada] as const,
  ([tema, densidade, textoAmpliado]) => void gravarNaConta({ tema, densidade, textoAmpliado }),
);
watch(telaInicial, (v) => void gravarNaConta({ telaInicial: v || null }));
const visoesPorTela = computed(() => {
  const titulos = new Map((conta.value?.telasDoMenu ?? []).map((x) => [x.codigo, x.titulo]));
  return (conta.value?.visoes ?? []).map((v) => ({
    ...v,
    titulo: titulos.get(v.tela) ?? v.tela,
    abre: conta.value?.visaoInicialPorTela[v.tela] === v.nome,
  }));
});
</script>

<template>
  <section class="tela" aria-labelledby="pref-titulo">
    <h1 id="pref-titulo">{{ t('preferencias.titulo') }}</h1>
    <p v-if="!podeEditar">{{ t('preferencias.semEdicao') }}</p>
    <form class="pref" @submit.prevent>
      <fieldset class="pref__grupo" :disabled="!podeEditar">
        <SanteOpcoes v-model="tema" :legenda="t('preferencias.tema')" :opcoes="temas" nome="tema" />
        <SanteOpcoes
          v-model="densidade"
          :legenda="t('preferencias.densidade')"
          :opcoes="densidades"
          nome="densidade"
        />
        <SanteOpcoes v-model="fonte" :legenda="t('preferencias.fonte')" :opcoes="fontes" nome="fonte" />
        <label v-if="conta" class="pref__campo">
          {{ t('preferencias.telaInicial') }}
          <select v-model="telaInicial" data-testid="pref-tela-inicial">
            <option value="">{{ t('preferencias.telaInicialPerfil') }}</option>
            <option v-for="x in conta.telasDoMenu" :key="x.codigo" :value="x.codigo">{{ x.titulo }}</option>
          </select>
        </label>
      </fieldset>
    </form>
    <p class="pref__nota" data-testid="pref-situacao" role="status">
      {{ t(`preferencias.conta.${situacaoConta}`) }}
    </p>
    <template v-if="visoesPorTela.length">
      <h2>{{ t('preferencias.visoes') }}</h2>
      <table class="pref__atalhos" data-testid="pref-visoes">
        <tbody>
          <tr v-for="v in visoesPorTela" :key="`${v.tela}|${v.nome}`">
            <td>{{ v.titulo }}</td>
            <td>{{ v.nome === 'padrao' ? t('preferencias.visaoPadrao') : v.nome }}</td>
            <td>{{ v.colunas.length }} {{ t('preferencias.colunas') }}</td>
            <td>{{ v.abre ? t('preferencias.abreNela') : '' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
    <h2>{{ t('preferencias.atalhos') }}</h2>
    <table class="pref__atalhos">
      <tbody>
        <tr v-for="a in ATALHOS" :key="a.id">
          <td>
            <kbd>{{ a.teclas }}</kbd>
          </td>
          <td>{{ t(`atalhos.${a.id}`) }}</td>
        </tr>
      </tbody>
    </table>
    <!-- W1-01 (parte 10c): os próprios pedidos de acesso. -->
    <h2>{{ t('acesso.pedidos.meusTitulo') }}</h2>
    <p>
      <RouterLink to="/preferencias/pedidos-acesso" data-testid="ir-meus-pedidos">{{
        t('acesso.pedidos.abrirMeus')
      }}</RouterLink>
    </p>
    <h2>{{ t('preferencias.segundoFator') }}</h2>
    <p>{{ t('preferencias.segundoFatorTexto') }}</p>
    <p v-if="podeSeguranca">
      <RouterLink to="/preferencias/seguranca" data-testid="ir-seguranca">{{
        t('preferencias.segundoFatorAbrir')
      }}</RouterLink>
    </p>
  </section>
</template>

<style scoped>
.pref__grupo {
  border: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
}
.pref__campo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
  max-width: 28rem;
}
.pref__nota {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.pref__atalhos td {
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
kbd {
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 4px;
  padding: 0 var(--sgh-espaco-1);
}
</style>
