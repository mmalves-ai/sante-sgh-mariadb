<script setup lang="ts">
// Controle de entrega ao setor (ficha do M29, seção 7; regra 5): `/farmacia/entregas`. Os documentos dispensados
// aguardando o aceite da enfermagem (perfil tablet): a leitura da etiqueta da dose ou a confirmação no tablet; quem
// recebeu e quando. Filtro pelo setor (centro de custo) e uma leitura única no topo, que acha a dose pela etiqueta em
// qualquer documento da lista; o recorte da lista (desde quando ela olha) fica à vista. Tempo real pela mesma vigia.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { aceitar, lerEntregas, lerGravacaoEntrega, lerJanelaEntregas, novaChave } from '../api-farmacia.js';
import AvisoFarmacia from '../componentes/AvisoFarmacia.vue';
import ErroFarmacia from '../componentes/ErroFarmacia.vue';
import { horario, qtd, usarFarmacia } from '../usar-farmacia.js';

const { t } = useI18n();
const { pode, motivo } = usarFarmacia(lerGravacaoEntrega);
const situacao = ref('7');
const opcoes = computed(() =>
  (['7', '8', '9'] as const).map((v) => ({ valor: v, rotulo: t(`farmacia.entregas.situacoes.${v}`) })),
);
const TETO_LISTA = 500;
const janela = useQuery({ queryKey: ['farmacia', 'entregas', 'janela'], queryFn: () => lerJanelaEntregas() });
const setor = ref('');
const opcoesSetor = computed(() => [
  { valor: '', rotulo: t('farmacia.entregas.todosSetores') },
  ...(janela.data.value?.setores ?? []).map((c) => ({
    valor: String(c.codigo),
    rotulo: `${c.nome} (${c.codigo})`,
  })),
]);
const lista = useQuery({
  queryKey: computed(() => ['farmacia', 'entregas', situacao.value, setor.value]),
  queryFn: () => lerEntregas(Number(situacao.value), setor.value ? Number(setor.value) : null),
  refetchInterval: 30_000,
});
const cortada = computed(() => (lista.data.value ?? []).length >= TETO_LISTA);
const leituraGeral = ref('');
const naoAchou = ref(false);
async function aceitarLeituraGeral(): Promise<void> {
  const lido = leituraGeral.value.trim();
  naoAchou.value = false;
  if (!lido) return;
  const e = (lista.data.value ?? []).find(
    (x) => x.situacao === 7 && x.doses.some((d) => d.serie === lido || String(d.dose) === lido),
  );
  if (!e) {
    naoAchou.value = true;
    return;
  }
  leituras.value[e.controle] = lido;
  await aceitarEntrega(e.controle, 'leitura');
  if (!erro.value) leituraGeral.value = '';
}
const leituras = ref<Record<number, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function aceitarEntrega(controle: number, modo: 'leitura' | 'tablet'): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await aceitar(
      controle,
      modo === 'leitura'
        ? { modo, leitura: leituras.value[controle] ?? '' }
        : { modo, dispositivo: 'TABLET' },
      novaChave('aceite'),
    );
    mensagem.value = r.mensagem;
    await lista.refetch();
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ent-titulo" data-testid="tela-farmacia-entregas">
    <h1 id="ent-titulo">{{ t('farmacia.entregas.titulo') }}</h1>
    <p>{{ t('farmacia.entregas.texto') }}</p>
    <AvisoFarmacia
      :motivo="pode('suprimentos.confirmarEntrega') ? null : motivo('suprimentos.confirmarEntrega')"
    />
    <div class="filtros">
      <SanteSelecao v-model="situacao" :rotulo="t('farmacia.situacao')" :opcoes="opcoes" />
      <SanteSelecao
        v-model="setor"
        :rotulo="t('farmacia.entregas.setor')"
        :opcoes="opcoesSetor"
        data-testid="ent-setor"
      />
    </div>
    <div v-if="situacao === '7'" class="acoes">
      <span class="campo">
        <label for="ent-leitura-geral">{{ t('farmacia.entregas.leituraGeral') }}</label>
        <input
          id="ent-leitura-geral"
          v-model="leituraGeral"
          autocomplete="off"
          data-testid="ent-leitura-geral"
          @keydown.enter.prevent="aceitarLeituraGeral()"
        />
      </span>
      <SanteBotao
        :rotulo="t('farmacia.entregas.aceitarGeral')"
        :desabilitado="!pode('suprimentos.confirmarEntrega')"
        data-testid="ent-aceitar-geral"
        @acionar="aceitarLeituraGeral()"
      />
    </div>
    <p v-if="naoAchou" role="alert" data-testid="ent-leitura-nao-achou">
      {{ t('farmacia.entregas.leituraNaoAchou') }}
    </p>
    <p v-if="janela.data.value?.desde" class="secundario" data-testid="ent-janela">
      {{ t('farmacia.entregas.janela', { desde: horario(janela.data.value.desde) }) }}
    </p>
    <p v-if="cortada" data-testid="ent-cortada">{{ t('farmacia.entregas.cortada', { n: TETO_LISTA }) }}</p>
    <ErroFarmacia v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="ent-mensagem">{{ mensagem }}</p>
    <p v-if="lista.isLoading.value">{{ t('farmacia.carregando') }}</p>
    <p v-else-if="(lista.data.value ?? []).length === 0">{{ t('farmacia.nenhum') }}</p>
    <article
      v-for="e in lista.data.value ?? []"
      :key="e.controle"
      class="painel"
      :data-testid="`ent-controle-${e.controle}`"
    >
      <h2>
        {{ t('farmacia.leito') }} {{ e.leito || '—' }} · {{ t('farmacia.atendimento') }} {{ e.atendimento }} ·
        {{ e.situacaoNome }} {{ horario(e.desde) }}
      </h2>
      <p v-if="e.documento">
        {{ t('farmacia.entregas.documento') }} {{ e.documento.doc }}/{{ e.documento.mes }}/{{
          e.documento.ano
        }}
      </p>
      <ul>
        <li v-for="d in e.doses" :key="d.dose">
          {{ d.descricao }} · {{ qtd(d.quantidade) }} · {{ d.serie }}
        </li>
      </ul>
      <p v-if="e.aceite" data-testid="ent-aceite">
        {{
          t('farmacia.entregas.recebido', {
            autor: e.aceite.autor,
            em: horario(e.aceite.em),
            modo: e.aceite.modo,
          })
        }}
      </p>
      <div v-if="e.situacao === 7" class="acoes">
        <span class="campo">
          <label :for="`ent-leitura-${e.controle}`">{{ t('farmacia.entregas.lerEtiqueta') }}</label>
          <input
            :id="`ent-leitura-${e.controle}`"
            v-model="leituras[e.controle]"
            autocomplete="off"
            :data-testid="`ent-leitura-${e.controle}`"
          />
        </span>
        <SanteBotao
          :rotulo="t('farmacia.entregas.aceitarLeitura')"
          :desabilitado="!pode('suprimentos.confirmarEntrega')"
          :data-testid="`ent-aceitar-leitura-${e.controle}`"
          @acionar="aceitarEntrega(e.controle, 'leitura')"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('farmacia.entregas.aceitarTablet')"
          :desabilitado="!pode('suprimentos.confirmarEntrega')"
          :data-testid="`ent-aceitar-tablet-${e.controle}`"
          @acionar="aceitarEntrega(e.controle, 'tablet')"
        />
      </div>
    </article>
  </section>
</template>
