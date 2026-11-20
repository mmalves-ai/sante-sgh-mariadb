<script setup lang="ts">
// Aplicativo do profissional da higienização (ficha do M21, seção 7): `/m/higienizacao`, no celular (sem modo offline:
// a beira-leito é o único offline). A fila por prazo (as atrasadas primeiro): assumir, iniciar, pausar e concluir com
// o checklist e a foto (vai ao armazenamento de objetos local; o banco guarda só a chave). Cada etapa registra quem,
// quando e de qual aparelho. Também é a "Minha fila de trabalho" da higienização.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SolicitacaoLimpeza } from '@sgh/contratos';
import { pode as podeNaSessao } from '../../../casca/sessao/pode.js';
import { base64DoArquivo, enviarFoto, novaChave, registrarEtapa } from '../api-adt.js';
import AvisoAdt from '../componentes/AvisoAdt.vue';
import CartaoLimpeza from '../componentes/CartaoLimpeza.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import { proximasEtapas } from '../regras-tela.js';
import { usarAdt } from '../usar-adt.js';
import { usarFilaHigienizacao } from '../usar-fila.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { apoio, pode, motivoDe } = usarAdt('higienizacao');
const podeEtapa = pode('etapa');
const aviso = motivoDe('etapa');
const LEMBRAR = 'sgh.higienizacao.profissional';
const lido = (() => {
  try {
    return globalThis.localStorage?.getItem(LEMBRAR) ?? '';
  } catch {
    return '';
  }
})();
// Quem só executa vê e registra só em seu nome (o servidor resolve o profissional ligado ao login); o supervisor
// escolhe o profissional.
const supervisor = podeNaSessao('hotelaria.limpeza.liberar');
const profissional = ref(supervisor ? lido : '');
const numero = computed(() => (supervisor && profissional.value ? Number(profissional.value) : null));
const { fila, agoraEstabelecimento } = usarFilaHigienizacao(numero);
watch(
  () => fila.data.value?.profissionalDaSessao,
  (p) => {
    if (!supervisor && p) profissional.value = String(p);
  },
  { immediate: true },
);
const opcoesProf = computed(() => [
  { valor: '', rotulo: t('adt.escolha') },
  ...(apoio.data.value?.profissionaisLimpeza ?? []).map((p) => ({ valor: String(p.codigo), rotulo: p.nome })),
]);
function escolher(v: string): void {
  profissional.value = v;
  try {
    globalThis.localStorage?.setItem(LEMBRAR, v);
  } catch {
    // Sem o armazenamento do navegador, a escolha vale só nesta tela.
  }
}
const itens = computed(() =>
  (fila.data.value?.itens ?? []).filter((i) => proximasEtapas(i.etapa).length > 0),
);
const CHECKLIST = ['superficies', 'piso', 'banheiro', 'enxoval', 'residuos'];
const marcados = ref<Record<number, string[]>>({});
const fotos = ref<Record<number, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
function alternar(sol: number, c: string): void {
  const atual = marcados.value[sol] ?? [];
  marcados.value[sol] = atual.includes(c) ? atual.filter((x) => x !== c) : [...atual, c];
}
const itensChecklist = (i: SolicitacaoLimpeza) => (i.precaucao ? [...CHECKLIST, 'protocoloCcih'] : CHECKLIST);
async function foto(i: SolicitacaoLimpeza, ev: Event): Promise<void> {
  const arq = (ev.target as HTMLInputElement).files?.[0];
  if (!arq) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const tipo = ['image/jpeg', 'image/png', 'image/webp'].includes(arq.type) ? arq.type : 'image/jpeg';
    const r = await enviarFoto(
      { solicitacao: i.solicitacao, tipo, conteudo: await base64DoArquivo(arq) },
      novaChave('foto'),
    );
    fotos.value[i.solicitacao] = r.chave;
    mensagem.value = t('adt.hig.fotoEnviada');
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
async function etapa(i: SolicitacaoLimpeza, proxima: string): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await registrarEtapa(
      i.solicitacao,
      {
        etapa: proxima,
        ...(supervisor && numero.value ? { profissional: numero.value } : {}),
        ...(proxima === 'concluido' ? { checklist: marcados.value[i.solicitacao] ?? [] } : {}),
        ...(proxima === 'concluido' && fotos.value[i.solicitacao]
          ? { foto: fotos.value[i.solicitacao] }
          : {}),
      },
      novaChave(`etapa-${proxima}`),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['adt', 'hig'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda app-hig" aria-labelledby="app-hig-titulo" data-testid="tela-app-higienizacao">
    <h1 id="app-hig-titulo">{{ t('adt.hig.app') }}</h1>
    <p>{{ t('adt.hig.appTexto') }}</p>
    <AvisoAdt :motivo="aviso" />
    <SanteSelecao
      v-if="supervisor"
      :model-value="profissional"
      :rotulo="t('adt.hig.souProfissional')"
      :opcoes="opcoesProf"
      data-testid="app-profissional"
      @update:model-value="escolher(String($event))"
    />
    <p v-else-if="profissional" class="secundario" data-testid="app-profissional-sessao">
      {{
        t('adt.hig.emSeuNome', {
          nome: opcoesProf.find((o) => o.valor === profissional)?.rotulo ?? profissional,
        })
      }}
    </p>
    <p v-if="supervisor && !profissional" class="secundario">{{ t('adt.hig.escolhaProfissional') }}</p>
    <p v-if="mensagem" role="status" data-testid="app-mensagem">{{ mensagem }}</p>
    <ErroAdt v-if="erro" :erro="erro" />
    <ErroAdt v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('adt.carregando') }}</p>
    <template v-else-if="profissional">
      <p v-if="itens.length === 0">{{ t('adt.nenhum') }}</p>
      <CartaoLimpeza v-for="i in itens" :key="i.solicitacao" :item="i" :agora="agoraEstabelecimento">
        <fieldset v-if="i.etapa === 'emExecucao'" class="checklist">
          <legend>{{ t('adt.hig.checklist') }}</legend>
          <label v-for="c in itensChecklist(i)" :key="c">
            <input
              type="checkbox"
              :value="c"
              :checked="(marcados[i.solicitacao] ?? []).includes(c)"
              :data-testid="`check-${i.solicitacao}-${c}`"
              @change="alternar(i.solicitacao, c)"
            />
            {{ t(`adt.hig.itens.${c}`) }}
          </label>
          <label :for="`foto-${i.solicitacao}`">{{ t('adt.hig.foto') }}</label>
          <input
            :id="`foto-${i.solicitacao}`"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            :data-testid="`foto-${i.solicitacao}`"
            @change="foto(i, $event)"
          />
        </fieldset>
        <p class="acoes">
          <SanteBotao
            v-for="p in proximasEtapas(i.etapa)"
            :key="p"
            :variante="p === 'pausado' ? 'secundario' : 'primario'"
            :rotulo="t(`adt.hig.acoesEtapa.${p}`)"
            :desabilitado="!podeEtapa || ocupado"
            :data-testid="`etapa-${p}-${i.solicitacao}`"
            @acionar="etapa(i, p)"
          />
        </p>
      </CartaoLimpeza>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.app-hig {
  max-width: 40rem;
}
.checklist {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.checklist label {
  min-height: var(--sgh-alvo-minimo);
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
}
</style>
