<script setup lang="ts">
// Transferência de leito (ficha do M21, seção 7): `/leitos/transferencias` (`?destino=` do mapa). O paciente internado,
// o leito de destino livre (o bloqueado, o em higienização e o que não aceita o paciente pelo sexo ou pela faixa de
// idade não aparecem; os incompatíveis ficam listados com o motivo) e a justificativa; a gravação confere o
// carimbo da internação e trava origem e destino em ordem fixa: quem chega depois ao mesmo leito recebe "leito ocupado".
import { leitoDaChaveTexto } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { lerMapa, listarInternacoes, novaChave, transferir } from '../api-adt.js';
import AvisoAdt from '../componentes/AvisoAdt.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import { leitoTexto } from '../regras-tela.js';
import { usarAdt } from '../usar-adt.js';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const { pode, motivoDe } = usarAdt('leitos');
const podeTransferir = pode('internacao.transferirLeito');
const aviso = motivoDe('internacao.transferirLeito');
const internados = useQuery({ queryKey: ['adt', 'internados', ''], queryFn: () => listarInternacoes() });
// `?internacao=` vem do arrastar no mapa (o paciente solto no leito livre): a tela abre com os dois para confirmar.
const reg = ref(typeof rota.query['internacao'] === 'string' ? (rota.query['internacao'] as string) : '');
// M44 (etapa 2): a transferência vinda do NIR (`?solicitacao=`): o leito reservado para ela é admissível só para ela.
const solicitacaoNir =
  typeof rota.query['solicitacao'] === 'string' && /^\d+$/.test(rota.query['solicitacao'])
    ? Number(rota.query['solicitacao'])
    : null;
// O mapa para a internação escolhida: o servidor diz quais leitos não aceitam o paciente (sexo e faixa de idade).
const mapa = useQuery({
  queryKey: computed(() => ['adt', 'mapa', 'internacao', reg.value, solicitacaoNir ?? 0]),
  queryFn: () =>
    lerMapa(false, {
      ...(reg.value ? { internacao: Number(reg.value) } : {}),
      ...(solicitacaoNir ? { solicitacao: solicitacaoNir } : {}),
    }),
});
const incompativeis = computed(() =>
  (mapa.data.value?.leitos ?? []).filter((l) => l.admissivel && l.incompatibilidade),
);
const destino = ref(typeof rota.query['destino'] === 'string' ? (rota.query['destino'] as string) : '');
const justificativa = ref('');
const escolhida = computed(
  () => internados.data.value?.itens.find((i) => String(i.reg) === reg.value) ?? null,
);
const opcoes = computed(() => ({
  internados: [
    { valor: '', rotulo: t('adt.escolha') },
    ...(internados.data.value?.itens ?? []).map((i) => ({
      valor: String(i.reg),
      rotulo: `${i.nome} · ${leitoTexto(i.leito)}`,
    })),
  ],
  destinos: [
    { valor: '', rotulo: t('adt.escolha') },
    ...(mapa.data.value?.leitos ?? [])
      .filter((l) => l.admissivel && !l.incompatibilidade)
      .map((l) => ({ valor: l.chave, rotulo: leitoTexto(l.leito) })),
  ],
}));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function gravar(): Promise<void> {
  const i = escolhida.value;
  const d = leitoDaChaveTexto(destino.value);
  if (!i || !d) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    await transferir(
      {
        internacao: i.reg,
        destino: d,
        versao: i.versao,
        ...(justificativa.value.trim() ? { justificativa: justificativa.value.trim() } : {}),
        ...(solicitacaoNir ? { solicitacaoNir } : {}),
      },
      novaChave('transferir'),
    );
    mensagem.value = t('adt.transferencia.feita', { leito: leitoTexto(d) });
    reg.value = '';
    destino.value = '';
    justificativa.value = '';
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
    await cliente.invalidateQueries({ queryKey: ['adt'] });
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="transf-titulo" data-testid="tela-transferencia">
    <h1 id="transf-titulo">{{ t('adt.transferencia.titulo') }}</h1>
    <p>{{ t('adt.transferencia.texto') }}</p>
    <AvisoAdt :motivo="aviso" />
    <ErroAdt v-if="internados.isError.value" :erro="internados.error.value" />
    <div class="filtros">
      <SanteSelecao
        v-model="reg"
        :rotulo="t('adt.paciente')"
        :opcoes="opcoes.internados"
        data-testid="transf-internacao"
      />
      <p v-if="escolhida" class="secundario">
        {{ t('adt.transferencia.origem') }}: {{ leitoTexto(escolhida.leito) }}
      </p>
      <SanteSelecao
        v-model="destino"
        :rotulo="t('adt.transferencia.destino')"
        :opcoes="opcoes.destinos"
        data-testid="transf-destino"
      />
    </div>
    <details
      v-if="escolhida && incompativeis.length > 0"
      class="secundario"
      data-testid="transf-incompativeis"
    >
      <summary>{{ t('adt.admissao.incompativeis', { n: incompativeis.length }) }}</summary>
      <ul class="lista-simples">
        <li v-for="l in incompativeis" :key="l.chave">
          {{ leitoTexto(l.leito) }}: {{ l.incompatibilidade }}
        </li>
      </ul>
    </details>
    <SanteCampoTexto v-model="justificativa" :rotulo="t('adt.transferencia.justificativa')" :max-bytes="80" />
    <SanteBotao
      :rotulo="t('adt.transferencia.gravar')"
      :desabilitado="!podeTransferir || !escolhida || !destino || ocupado"
      data-testid="transf-gravar"
      @acionar="gravar"
    />
    <p v-if="mensagem" role="status" data-testid="transf-feita">{{ mensagem }}</p>
    <ErroAdt v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
