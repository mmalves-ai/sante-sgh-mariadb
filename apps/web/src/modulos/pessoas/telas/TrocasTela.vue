<script setup lang="ts">
// Trocas de plantão (M52.3; item `Gestão de pessoas > Escala de plantão (médica e de enfermagem)`; rota
// `/pessoas/escala/trocas`; `pessoas.troca.pedir` / `pessoas.troca.aprovar`): o pedido do próprio plantão a um colega
// da mesma escala publicada (troca por outro plantão ou cessão), a resposta do colega (ou o registro da coordenação em
// nome do colega sem acesso), a decisão da coordenação e o cancelamento por quem pediu (regra 8). O servidor confere
// tudo de novo; as ações de cada troca vêm do servidor.
import {
  CODIGOS_ESTADO_TROCA,
  CODIGOS_TIPO_TROCA,
  ESTADOS_TROCA,
  type EstadoTroca,
  type LadoTroca,
  type ResultadoEscala,
  TIPOS_TROCA,
  type TipoTroca,
  type TrocaLida,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import {
  cancelarTroca,
  decidirTroca,
  lerApoioTrocas,
  lerPlantoesParaTroca,
  lerTrocas,
  pedirTroca,
  responderTroca,
} from '../api-plantao.js';
import { descricaoPlantao } from '../escala-comum.js';
import ErroPessoas from '../componentes/ErroPessoas.vue';

const { t } = useI18n();
const qc = useQueryClient();
const apoio = useQuery({ queryKey: ['pessoas', 'trocas', 'apoio'], queryFn: lerApoioTrocas });
const a = computed(() => apoio.data.value ?? null);

const estado = ref<EstadoTroca | null>(null);
const minhas = ref<'sim' | 'nao'>('nao');
const filtro = ref<{ estado: EstadoTroca | null; minhas: boolean }>({ estado: null, minhas: false });
const lista = useQuery({
  queryKey: computed(() => ['pessoas', 'trocas', filtro.value]),
  queryFn: () => lerTrocas(filtro.value),
});
const opcoesEstado = computed(() => [
  { valor: null, rotulo: t('pessoas.trocas.filtro.todas') },
  ...CODIGOS_ESTADO_TROCA.map((c) => ({ valor: c, rotulo: ESTADOS_TROCA[c] })),
]);
const opcoesMinhas = computed(() => [
  { valor: 'nao', rotulo: t('pessoas.trocas.filtro.todas') },
  { valor: 'sim', rotulo: t('pessoas.trocas.filtro.minhas') },
]);
function filtrar(): void {
  filtro.value = { estado: estado.value, minhas: minhas.value === 'sim' };
}
const lado = (l: LadoTroca | null) => (l ? `${l.nome}: ${descricaoPlantao(l)}` : t('pessoas.trocas.cessao'));
const quando = (i: string | null) => (i ? i.replace('T', ' ').slice(0, 16) : '');

const resultado = ref<ResultadoEscala | null>(null);
async function depois(r: ResultadoEscala): Promise<void> {
  resultado.value = r;
  await qc.invalidateQueries({ queryKey: ['pessoas', 'trocas'] });
}

// ── Novo pedido ──
const escala = ref<number | null>(null);
const tipo = ref<TipoTroca>('troca');
const plantao = ref<number | null>(null);
const colega = ref<number | null>(null);
const plantaoColega = ref<number | null>(null);
const motivo = ref('');
const aviso = ref<string | null>(null);
const daEscala = useQuery({
  queryKey: computed(() => ['pessoas', 'trocas', 'escala', escala.value]),
  queryFn: () => lerPlantoesParaTroca(escala.value!),
  enabled: computed(() => escala.value !== null),
});
watch(escala, () => {
  plantao.value = null;
  colega.value = null;
  plantaoColega.value = null;
});
const opcoesEscala = computed(() => (a.value?.escalas ?? []).map((x) => ({ valor: x.id, rotulo: x.rotulo })));
const opcoesTipo = CODIGOS_TIPO_TROCA.map((c) => ({ valor: c, rotulo: TIPOS_TROCA[c] }));
const plantoes = computed(() => daEscala.data.value?.plantoes ?? []);
const rotuloPlantao = (p: (typeof plantoes.value)[number]) =>
  `${p.nome}: ${descricaoPlantao(p)}${p.emTroca ? ` (${t('pessoas.trocas.nova.emTroca')})` : ''}`;
/** Quem pede escolhe o próprio plantão; a coordenação, o de qualquer colaborador da escala. */
const opcoesPlantao = computed(() =>
  plantoes.value
    .filter((p) => (p.meu || a.value?.acoes.emNomeDe) && !p.emTroca)
    .map((p) => ({ valor: p.plantao, rotulo: rotuloPlantao(p) })),
);
const escolhido = computed(() => plantoes.value.find((p) => p.plantao === plantao.value) ?? null);
const opcoesColega = computed(() =>
  (daEscala.data.value?.colegas ?? [])
    .filter((c) => c.vinculo !== escolhido.value?.vinculo)
    .map((c) => ({ valor: c.vinculo, rotulo: c.nome })),
);
const opcoesPlantaoColega = computed(() =>
  plantoes.value
    .filter((p) => p.vinculo === colega.value && !p.emTroca)
    .map((p) => ({ valor: p.plantao, rotulo: rotuloPlantao(p) })),
);
const pedido = useMutation({
  mutationFn: () => {
    const p = escolhido.value!;
    const b = plantoes.value.find((x) => x.plantao === plantaoColega.value) ?? null;
    return pedirTroca({
      tipo: tipo.value,
      plantao: p.plantao,
      versao: p.versao,
      colega: colega.value!,
      plantaoColega: tipo.value === 'troca' ? (b?.plantao ?? null) : null,
      versaoColega: tipo.value === 'troca' ? (b?.versao ?? null) : null,
      motivo: motivo.value.trim(),
    });
  },
  onSuccess: async (r) => {
    motivo.value = '';
    plantao.value = null;
    plantaoColega.value = null;
    await depois(r);
    await qc.invalidateQueries({ queryKey: ['pessoas', 'trocas', 'escala'] });
  },
});
function pedir(): void {
  aviso.value = null;
  resultado.value = null;
  if (!escolhido.value || colega.value === null || (tipo.value === 'troca' && plantaoColega.value === null)) {
    aviso.value = t('pessoas.trocas.nova.escolha');
    return;
  }
  pedido.mutate();
}

// ── Ações numa troca (diálogo) ──
type Acao = 'responder' | 'registrar' | 'decidir' | 'cancelar';
const dialogo = ref(false);
/** Cada abertura monta o diálogo de novo (reabrir logo depois de fechar não pode perder a abertura). */
const chaveDialogo = ref(0);
const alvo = ref<TrocaLida | null>(null);
const acao = ref<Acao>('responder');
const sim = ref<'sim' | 'nao'>('sim');
const texto = ref('');
const erroAcao = ref<unknown>(null);
const ocupado = ref(false);
function abrir(x: TrocaLida, qual: Acao): void {
  alvo.value = x;
  acao.value = qual;
  sim.value = 'sim';
  texto.value = '';
  erroAcao.value = null;
  chaveDialogo.value++;
  dialogo.value = true;
}
const opcoesResposta = computed(() => [
  { valor: 'sim', rotulo: t('pessoas.trocas.responder.aceite') },
  { valor: 'nao', rotulo: t('pessoas.trocas.responder.recusa') },
]);
async function confirmar(aceitar: boolean): Promise<void> {
  const x = alvo.value;
  if (!x) return;
  erroAcao.value = null;
  ocupado.value = true;
  try {
    const v = { versao: x.versao };
    const r =
      acao.value === 'responder'
        ? await responderTroca(x.id, { ...v, aceite: aceitar, confirmacao: null })
        : acao.value === 'registrar'
          ? await responderTroca(x.id, {
              ...v,
              aceite: sim.value === 'sim',
              confirmacao: texto.value.trim() || null,
            })
          : acao.value === 'decidir'
            ? await decidirTroca(x.id, { ...v, aprovar: aceitar, motivo: texto.value.trim() || null })
            : await cancelarTroca(x.id, { ...v, motivo: texto.value.trim() });
    dialogo.value = false;
    await depois(r);
  } catch (e) {
    erroAcao.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="pes-trocas-titulo" data-testid="tela-trocas">
    <h1 id="pes-trocas-titulo">{{ t('pessoas.trocas.titulo') }}</h1>
    <p>{{ t('pessoas.trocas.subtitulo') }}</p>
    <p class="acoes">
      <RouterLink to="/pessoas/escala">{{ t('pessoas.trocas.voltarEscala') }}</RouterLink>
      <RouterLink to="/pessoas/plantao-agora" data-testid="abrir-plantao-agora">{{
        t('pessoas.trocas.plantaoAgora')
      }}</RouterLink>
    </p>
    <ErroPessoas v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('pessoas.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!a.gravacao.ligada"
        :texto="a.gravacao.motivo ?? t('pessoas.escala.gravacaoDesligada')"
        variante="info"
        data-testid="trocas-gravacao-desligada"
      />
      <SanteAlerta
        v-else-if="!a.acoes.pedir && !a.acoes.aprovar"
        :texto="t('pessoas.trocas.soConsulta')"
        variante="info"
      />
      <SanteAlerta
        v-if="resultado"
        :texto="resultado.mensagem"
        variante="info"
        anunciar
        data-testid="trocas-resultado"
      />
      <SanteAlerta
        v-for="(al, i) in resultado?.alertas ?? []"
        :key="i"
        :texto="al"
        variante="aviso"
        data-testid="trocas-alerta"
      />

      <form
        v-if="a.acoes.pedir"
        class="bloco"
        aria-labelledby="pes-troca-nova"
        data-testid="form-pedir-troca"
        @submit.prevent="pedir"
      >
        <h2 id="pes-troca-nova">{{ t('pessoas.trocas.nova.titulo') }}</h2>
        <p class="secundario">{{ t('pessoas.trocas.nova.ajuda') }}</p>
        <div class="campos">
          <SanteSelecao
            v-model="escala"
            :rotulo="t('pessoas.trocas.nova.escala')"
            :opcoes="opcoesEscala"
            busca
            data-testid="troca-escala"
          />
          <SanteSelecao
            v-model="tipo"
            :rotulo="t('pessoas.trocas.nova.tipo')"
            :opcoes="opcoesTipo"
            data-testid="troca-tipo"
          />
          <SanteSelecao
            v-model="plantao"
            :rotulo="
              a.acoes.emNomeDe ? t('pessoas.trocas.nova.plantaoEmNome') : t('pessoas.trocas.nova.plantao')
            "
            :opcoes="opcoesPlantao"
            busca
            data-testid="troca-plantao"
          />
          <SanteSelecao
            v-model="colega"
            :rotulo="t('pessoas.trocas.nova.colega')"
            :opcoes="opcoesColega"
            busca
            data-testid="troca-colega"
          />
          <SanteSelecao
            v-if="tipo === 'troca'"
            v-model="plantaoColega"
            :rotulo="t('pessoas.trocas.nova.plantaoColega')"
            :opcoes="opcoesPlantaoColega"
            busca
            data-testid="troca-plantao-colega"
          />
        </div>
        <p v-if="escala !== null && daEscala.data.value && opcoesPlantao.length === 0" class="secundario">
          {{ t('pessoas.trocas.nova.semPlantao') }}
        </p>
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t('pessoas.trocas.nova.motivo')"
          :max-bytes="400"
          multilinha
          obrigatorio
          data-testid="troca-motivo"
        />
        <SanteAlerta v-if="aviso" :texto="aviso" variante="aviso" anunciar />
        <ErroPessoas v-if="pedido.isError.value" :erro="pedido.error.value" />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('pessoas.trocas.nova.pedir')"
            tipo="submit"
            :desabilitado="pedido.isPending.value"
            data-testid="pedir-troca"
          />
        </div>
      </form>

      <form class="campos" :aria-label="t('pessoas.buscar')" @submit.prevent="filtrar">
        <SanteSelecao
          v-model="estado"
          :rotulo="t('pessoas.trocas.filtro.estado')"
          :opcoes="opcoesEstado"
          data-testid="filtro-estado-troca"
        />
        <SanteSelecao
          v-model="minhas"
          :rotulo="t('pessoas.trocas.filtro.minhas')"
          :opcoes="opcoesMinhas"
          data-testid="filtro-minhas"
        />
        <SanteBotao
          :rotulo="t('pessoas.buscar')"
          tipo="submit"
          variante="secundario"
          data-testid="filtrar-trocas"
        />
      </form>
      <ErroPessoas v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="!lista.data.value" role="status">{{ t('pessoas.carregando') }}</p>
      <p v-else-if="lista.data.value.itens.length === 0" data-testid="trocas-vazio">
        {{ t('pessoas.trocas.vazio') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-trocas">
        <thead>
          <tr>
            <th scope="col">{{ t('pessoas.trocas.colunas.pedido') }}</th>
            <th scope="col">{{ t('pessoas.trocas.colunas.colega') }}</th>
            <th scope="col">{{ t('pessoas.trocas.colunas.plantaoColega') }}</th>
            <th scope="col">{{ t('pessoas.trocas.colunas.situacao') }}</th>
            <th scope="col">{{ t('pessoas.trocas.colunas.motivo') }}</th>
            <th scope="col">{{ t('pessoas.trocas.colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in lista.data.value.itens" :key="x.id" :data-testid="`troca-${x.id}`">
            <th scope="row">{{ lado(x.pedido) }}</th>
            <td>{{ x.colega.nome }}</td>
            <td>{{ x.tipo === 'troca' ? lado(x.plantaoColega) : t('pessoas.trocas.cessao') }}</td>
            <td :data-testid="`troca-estado-${x.id}`">
              {{ ESTADOS_TROCA[x.estado] }}
              <span class="secundario">
                <br />{{ t('pessoas.trocas.trilha', { por: x.pedidoPor, em: quando(x.pedidoEm) }) }}
                <template v-if="x.respostaPor">
                  <br />{{ t('pessoas.trocas.resposta', { por: x.respostaPor, em: quando(x.respostaEm) }) }}
                  <template v-if="x.confirmacao"> ({{ x.confirmacao }})</template>
                </template>
                <template v-if="x.decisaoPor">
                  <br />{{ t('pessoas.trocas.decisao', { por: x.decisaoPor, em: quando(x.decisaoEm) }) }}
                  <template v-if="x.motivoDecisao">: {{ x.motivoDecisao }}</template>
                </template>
              </span>
            </td>
            <td>{{ x.motivo }}</td>
            <td>
              <div class="acoes">
                <SanteBotao
                  v-if="x.acoes.responder"
                  :rotulo="t('pessoas.trocas.responder.aceitar')"
                  variante="secundario"
                  :data-testid="`responder-troca-${x.id}`"
                  @acionar="abrir(x, 'responder')"
                />
                <SanteBotao
                  v-if="x.acoes.registrarResposta"
                  :rotulo="t('pessoas.trocas.responder.registrar')"
                  variante="secundario"
                  :data-testid="`registrar-resposta-${x.id}`"
                  @acionar="abrir(x, 'registrar')"
                />
                <SanteBotao
                  v-if="x.acoes.decidir"
                  :rotulo="t('pessoas.trocas.decidir.aprovar')"
                  :data-testid="`decidir-troca-${x.id}`"
                  @acionar="abrir(x, 'decidir')"
                />
                <SanteBotao
                  v-if="x.acoes.cancelar"
                  :rotulo="t('pessoas.trocas.cancelar.botao')"
                  variante="texto"
                  :data-testid="`cancelar-troca-${x.id}`"
                  @acionar="abrir(x, 'cancelar')"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <SanteDialogo
      v-if="dialogo"
      :key="chaveDialogo"
      v-model:visivel="dialogo"
      :titulo="t('pessoas.trocas.dialogo')"
      largura="40rem"
    >
      <div v-if="alvo" class="bloco" data-testid="dialogo-troca">
        <p>
          <strong>{{ lado(alvo.pedido) }}</strong>
          <br />{{ t('pessoas.trocas.colunas.colega') }}: {{ alvo.colega.nome }}
          <template v-if="alvo.plantaoColega"><br />{{ lado(alvo.plantaoColega) }}</template>
        </p>
        <template v-if="acao === 'registrar'">
          <p class="secundario">{{ t('pessoas.trocas.responder.confirmacaoAjuda') }}</p>
          <SanteSelecao
            v-model="sim"
            :rotulo="t('pessoas.trocas.responder.registrar')"
            :opcoes="opcoesResposta"
            data-testid="resposta-colega"
          />
          <SanteCampoTexto
            v-model="texto"
            :rotulo="t('pessoas.trocas.responder.confirmacao')"
            :max-bytes="200"
            obrigatorio
            data-testid="resposta-confirmacao"
          />
        </template>
        <template v-else-if="acao === 'decidir'">
          <p class="secundario">{{ t('pessoas.trocas.decidir.ajuda') }}</p>
          <SanteCampoTexto
            v-model="texto"
            :rotulo="t('pessoas.trocas.decidir.motivo')"
            :max-bytes="400"
            multilinha
            data-testid="decisao-motivo"
          />
        </template>
        <SanteCampoTexto
          v-else-if="acao === 'cancelar'"
          v-model="texto"
          :rotulo="t('pessoas.trocas.cancelar.motivo')"
          :max-bytes="400"
          multilinha
          obrigatorio
          data-testid="cancelamento-motivo"
        />
        <ErroPessoas v-if="erroAcao" :erro="erroAcao" />
        <div class="acoes">
          <template v-if="acao === 'responder'">
            <SanteBotao
              :rotulo="t('pessoas.trocas.responder.aceitar')"
              :desabilitado="ocupado"
              data-testid="confirmar-aceite"
              @acionar="confirmar(true)"
            />
            <SanteBotao
              :rotulo="t('pessoas.trocas.responder.recusar')"
              variante="secundario"
              :desabilitado="ocupado"
              data-testid="confirmar-recusa"
              @acionar="confirmar(false)"
            />
          </template>
          <template v-else-if="acao === 'decidir'">
            <SanteBotao
              :rotulo="t('pessoas.trocas.decidir.aprovar')"
              :desabilitado="ocupado"
              data-testid="confirmar-aprovacao"
              @acionar="confirmar(true)"
            />
            <SanteBotao
              :rotulo="t('pessoas.trocas.decidir.reprovar')"
              variante="secundario"
              :desabilitado="ocupado"
              data-testid="confirmar-reprovacao"
              @acionar="confirmar(false)"
            />
          </template>
          <SanteBotao
            v-else
            :rotulo="t('pessoas.trocas.confirmar')"
            :desabilitado="ocupado"
            data-testid="confirmar-acao-troca"
            @acionar="confirmar(true)"
          />
          <SanteBotao :rotulo="t('pessoas.trocas.fechar')" variante="texto" @acionar="dialogo = false" />
        </div>
      </div>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
