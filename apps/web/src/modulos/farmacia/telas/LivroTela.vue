<script setup lang="ts">
// Livro de controlados (ficha do M29, seção 7; regra 9; DP-47.14): `/farmacia/livro`. Os 4 livros, uma página por
// substância, os termos; modo conferência até a aprovação prévia da Vigilância Sanitária (a chave do livro oficial
// tem esse pré-requisito); fechado pelo farmacêutico responsável; PDF/A pelo conversor do servidor.
// F3.6 (05-SUP linha 10): o período fechado mostra os termos como ficaram GRAVADOS (emitente, páginas, responsável e
// emissão da época), o período é conferido na hora (até 7 dias) e o fechamento oficial pede confirmação, porque guarda
// o conteúdo e não se refaz.
import { conferirFechamentoLivro, LIVROS_CONTROLADOS } from '@sgh/contratos/regras-suprimentos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { fecharLivro, lerLivro, novaChave, urlPdfLivro } from '../api-farmacia.js';
import AvisoFarmacia from '../componentes/AvisoFarmacia.vue';
import ErroFarmacia from '../componentes/ErroFarmacia.vue';
import { data, horario, qtd, usarFarmacia } from '../usar-farmacia.js';

const { t } = useI18n();
const { pode, motivoFuncionalidade } = usarFarmacia();
const livro = ref('1');
const inicio = ref('');
const fim = ref('');
const opcoes = LIVROS_CONTROLADOS.map((l) => ({ valor: String(l.id), rotulo: l.titulo }));
const consulta = computed(() => ({
  livro: Number(livro.value),
  inicio: inicio.value || undefined,
  fim: fim.value || undefined,
}));
const l = useQuery({
  queryKey: computed(() => ['farmacia', 'livro', consulta.value]),
  queryFn: () => lerLivro(consulta.value),
});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const confirmando = ref(false);
const fechado = computed(() => l.data.value?.fechado ?? null);
const oficial = computed(() =>
  fechado.value ? fechado.value.modo === 'oficial' : l.data.value?.modo === 'oficial',
);
const termo = (tipo: 'abertura' | 'encerramento') =>
  fechado.value?.termos.find((x) => x.tipo === tipo) ?? null;
/** O período do livro conferido na hora pela mesma regra do servidor (só o que não depende do banco). */
const recusaPeriodo = computed(() => {
  const x = l.data.value;
  if (!x) return null;
  const r = conferirFechamentoLivro({
    responsavelTecnico: true,
    inicio: x.inicio,
    fim: x.fim,
    oficial: false,
    chaveOficialLigada: true,
    jaFechado: false,
  });
  return r ? r.mensagem : null;
});
const podeFechar = computed(() => pode('fecharLivro') && !recusaPeriodo.value && !fechado.value);
const podeFecharOficial = computed(
  () => pode('fecharLivroOficial') && !recusaPeriodo.value && fechado.value?.modo !== 'oficial',
);
async function fechar(comoOficial: boolean): Promise<void> {
  const x = l.data.value;
  if (!x) return;
  erro.value = null;
  mensagem.value = null;
  confirmando.value = false;
  try {
    mensagem.value = (
      await fecharLivro(
        { livro: x.livro, inicio: x.inicio, fim: x.fim, oficial: comoOficial },
        novaChave('livro'),
      )
    ).mensagem;
    await l.refetch();
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="livro-titulo" data-testid="tela-farmacia-livro">
    <h1 id="livro-titulo">{{ t('farmacia.livro.titulo') }}</h1>
    <p>{{ t('farmacia.livro.texto') }}</p>
    <AvisoFarmacia :motivo="motivoFuncionalidade('livroOficial')" />
    <div class="filtros">
      <SanteSelecao v-model="livro" :rotulo="t('farmacia.livro.escolhaLivro')" :opcoes="opcoes" />
      <span class="campo"
        ><label for="lv-ini">{{ t('farmacia.inicio') }}</label
        ><input id="lv-ini" v-model="inicio" type="date"
      /></span>
      <span class="campo"
        ><label for="lv-fim">{{ t('farmacia.fim') }}</label
        ><input id="lv-fim" v-model="fim" type="date"
      /></span>
    </div>
    <ErroFarmacia v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="livro-mensagem">{{ mensagem }}</p>
    <template v-if="l.data.value">
      <p data-testid="livro-modo">
        {{ oficial ? t('farmacia.livro.oficial') : t('farmacia.livro.conferencia') }}
      </p>
      <p v-if="recusaPeriodo" role="alert" data-testid="livro-periodo">{{ recusaPeriodo }}</p>
      <p data-testid="livro-termo-abertura" :data-gravado="termo('abertura') ? 'sim' : 'nao'">
        {{ termo('abertura')?.texto ?? l.data.value.termoAbertura }}
      </p>
      <section
        v-for="p in l.data.value.paginas"
        :key="p.pagina"
        class="painel"
        :aria-labelledby="`lv-p-${p.pagina}`"
      >
        <h2 :id="`lv-p-${p.pagina}`">
          {{ t('farmacia.livro.pagina', { n: p.pagina, nome: p.nome, lista: p.lista }) }}
        </h2>
        <p>
          {{ t('farmacia.controlados.anterior') }} {{ qtd(p.anterior) }} ·
          {{ t('farmacia.controlados.entradas') }} {{ qtd(p.entradas) }} ·
          {{ t('farmacia.controlados.saidas') }} {{ qtd(p.saidas) }} · {{ t('farmacia.controlados.final') }}
          {{ qtd(p.final) }}
        </p>
        <ul>
          <li v-for="m in p.movimentos" :key="`${m.documento}-${m.tipo}`">
            {{ data(m.data) }} · {{ t(`farmacia.controlados.tipos.${m.tipo}`) }} · {{ qtd(m.quantidade) }} ·
            {{ m.documento }}
          </li>
        </ul>
      </section>
      <p data-testid="livro-termo-encerramento" :data-gravado="termo('encerramento') ? 'sim' : 'nao'">
        {{ termo('encerramento')?.texto ?? l.data.value.termoEncerramento }}
      </p>
      <p v-if="fechado" data-testid="livro-termos-situacao">
        {{
          fechado.termos.length ? t('farmacia.livro.termosGravados') : t('farmacia.livro.termosNaoGravados')
        }}
      </p>
      <p v-if="l.data.value.fechado" data-testid="livro-fechado">
        {{
          t('farmacia.livro.fechado', {
            por: l.data.value.fechado.por,
            em: horario(l.data.value.fechado.em),
            guarda: data(l.data.value.fechado.guardaAte),
          })
        }}
      </p>
      <div class="acoes">
        <a :href="urlPdfLivro(consulta)" data-testid="livro-pdf">{{ t('farmacia.livro.pdf') }}</a>
        <SanteBotao
          :rotulo="t('farmacia.livro.fechar')"
          :desabilitado="!podeFechar"
          data-testid="livro-fechar"
          @acionar="fechar(false)"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('farmacia.livro.fecharOficial')"
          :desabilitado="!podeFecharOficial || confirmando"
          data-testid="livro-fechar-oficial"
          @acionar="confirmando = true"
        />
      </div>
      <section
        v-if="confirmando"
        class="painel"
        aria-labelledby="lv-confirma"
        data-testid="livro-confirmar-oficial"
      >
        <h2 id="lv-confirma">{{ t('farmacia.livro.confirmarTitulo') }}</h2>
        <p>
          {{
            t('farmacia.livro.confirmarTexto', {
              titulo: l.data.value.titulo,
              inicio: data(l.data.value.inicio),
              fim: data(l.data.value.fim),
              paginas: l.data.value.paginas.length,
            })
          }}
        </p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('farmacia.livro.confirmar')"
            data-testid="livro-confirmar"
            @acionar="fechar(true)"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('farmacia.livro.desistir')"
            data-testid="livro-desistir"
            @acionar="confirmando = false"
          />
        </div>
      </section>
    </template>
  </section>
</template>
