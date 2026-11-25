<script setup lang="ts">
// Saídas de estoque (ficha do M28, seção 7; regras 3, 4, 6, 7, 8 e 10): `/suprimentos/saidas`. A saída a setor
// (centro de custo), paciente internado (conta de convênio do período), paciente externo (o médico que pede) ou
// terceiro; o lote sugerido é o que vence primeiro; o valor e o número são do banco (gatilhos). A tela confere antes e
// mostra a recusa em português; o centro de custo técnico (9901 a 9999) não gera consumo (aviso).
import { CENTRO_TECNICO, DESTINOS_SAIDA, ORIGENS_SAIDA } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { baixarEtiquetas } from '../api-etiqueta.js';
import { novaChave, registrarSaida } from '../api-suprimentos.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import FiltroDocumentos from '../componentes/FiltroDocumentos.vue';
import { usarListaDocumentos } from '../componentes/usar-lista-documentos.js';
import LinhasItens from '../componentes/LinhasItens.vue';
import { mensagensEtiqueta as M } from '../i18n-etiqueta.js';
import { itensDaEntrada, type LinhaItem } from '../componentes/linhas.js';
import { chaveDoc, data, numero, reais, usarSuprimentos } from '../usar-suprimentos.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { apoio, pode, motivo, locaisDoTipo, centros, nomeLocal } = usarSuprimentos();
const destino = ref('2');
const origem = ref('E');
const local = ref('');
const centroCusto = ref('');
const atendimento = ref('');
const medico = ref('');
const terceiro = ref('');
const observacao = ref('');
const linhas = ref<LinhaItem[]>([]);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const avisos = ref<string[]>([]);
const ocupado = ref(false);

const locais = computed(() => [
  { valor: '', rotulo: t('suprimentos.escolha') },
  ...locaisDoTipo(destino.value === '5' ? 'V' : 'S').map((l) => ({
    valor: String(l.codigo),
    rotulo: l.nome,
  })),
]);
const opcoesCentros = computed(() => [
  { valor: '', rotulo: t('suprimentos.escolha') },
  ...centros.value.map((c) => ({ valor: String(c.codigo), rotulo: `${c.codigo} · ${c.nome}` })),
]);
const destinos = DESTINOS_SAIDA.map((d) => ({ valor: String(d.codigo), rotulo: d.rotulo }));
const origens = ORIGENS_SAIDA.map((o) => ({ valor: o.codigo, rotulo: o.rotulo }));
const tecnico = computed(() => {
  const c = Number(centroCusto.value);
  return c >= CENTRO_TECNICO.de && c <= CENTRO_TECNICO.ate;
});
watch(local, () => (linhas.value = []));

async function gravar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const cc = centros.value.find((c) => c.codigo === Number(centroCusto.value));
    const d = Number(destino.value);
    const r = await registrarSaida(
      {
        destino: d,
        origem: origem.value,
        local: Number(local.value),
        centroCusto: Number(centroCusto.value),
        localConsumo: cc?.localConsumo ?? 1,
        ...(d === 1 || d === 3 ? { atendimento: numero(atendimento.value) } : {}),
        ...(d === 3 && numero(medico.value) > 0 ? { medico: numero(medico.value) } : {}),
        ...(d === 5 ? { terceiro: numero(terceiro.value) } : {}),
        ...(observacao.value.trim() ? { observacao: observacao.value.trim() } : {}),
        itens: itensDaEntrada(linhas.value),
      },
      novaChave('saida'),
    );
    mensagem.value = r.mensagem;
    avisos.value = r.avisos;
    // As etiquetas lidas saem como consumidas (a leitura seguinte da mesma etiqueta é recusada).
    const lidas = linhas.value.flatMap((l) => l.etiquetas ?? []);
    if (lidas.length) {
      const b = await baixarEtiquetas({ identificadores: lidas, situacao: 'consumida' });
      avisos.value = [...avisos.value, `${M.baixadas} ${b.baixadas}`];
    }
    linhas.value = [];
    await cliente.invalidateQueries({ queryKey: ['suprimentos'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

const { filtro, pagina, lista, haSeguinte } = usarListaDocumentos('saida');
const podeGravar = computed(() => pode('suprimentos.registrarSaida'));
</script>

<template>
  <section class="tela-agenda" aria-labelledby="saidas-titulo" data-testid="tela-suprimentos-saidas">
    <h1 id="saidas-titulo">{{ t('suprimentos.saidas.titulo') }}</h1>
    <p>{{ t('suprimentos.saidas.texto') }}</p>
    <AvisoSuprimentos :motivo="podeGravar ? null : motivo('suprimentos.registrarSaida')" />
    <p v-if="apoio.data.value?.mesFechado" role="alert">{{ t('suprimentos.mesFechado') }}</p>
    <form v-if="podeGravar" class="painel" @submit.prevent="gravar">
      <h2>{{ t('suprimentos.saidas.nova') }}</h2>
      <div class="filtros">
        <SanteSelecao
          v-model="destino"
          :rotulo="t('suprimentos.destino')"
          :opcoes="destinos"
          data-testid="saida-destino"
        />
        <SanteSelecao v-model="origem" :rotulo="t('suprimentos.origem')" :opcoes="origens" />
        <SanteSelecao
          v-model="local"
          :rotulo="t('suprimentos.local')"
          :opcoes="locais"
          data-testid="saida-local"
        />
        <SanteSelecao
          v-model="centroCusto"
          :rotulo="t('suprimentos.centroCusto')"
          :opcoes="opcoesCentros"
          data-testid="saida-cc"
        />
        <span v-if="destino === '1' || destino === '3'" class="campo">
          <label for="saida-atendimento">{{ t('suprimentos.atendimento') }}</label>
          <input
            id="saida-atendimento"
            v-model="atendimento"
            inputmode="numeric"
            data-testid="saida-atendimento"
          />
        </span>
        <span v-if="destino === '3'" class="campo">
          <label for="saida-medico">{{ t('suprimentos.medico') }}</label>
          <input id="saida-medico" v-model="medico" inputmode="numeric" />
        </span>
        <span v-if="destino === '5'" class="campo">
          <label for="saida-terceiro">{{ t('suprimentos.terceiro') }}</label>
          <input id="saida-terceiro" v-model="terceiro" inputmode="numeric" data-testid="saida-terceiro" />
        </span>
        <span class="campo">
          <label for="saida-obs">{{ t('suprimentos.observacao') }}</label>
          <input id="saida-obs" v-model="observacao" maxlength="60" />
        </span>
      </div>
      <p v-if="tecnico" role="status">{{ t('suprimentos.saidas.tecnico') }}</p>
      <p v-if="destino === '3'" class="secundario">{{ t('suprimentos.saidas.tceAConfirmar') }}</p>
      <LinhasItens v-model="linhas" :local="local ? Number(local) : null" testid="saida-itens" />
      <div class="acoes">
        <SanteBotao
          tipo="submit"
          :rotulo="t('suprimentos.saidas.gravar')"
          :desabilitado="ocupado || !local || !centroCusto || linhas.length === 0"
          data-testid="saida-gravar"
        />
      </div>
    </form>
    <p v-if="mensagem" role="status" data-testid="saida-mensagem">{{ mensagem }}</p>
    <p v-for="a in avisos" :key="a" role="status">{{ a }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <h2>{{ t('suprimentos.saidas.lista') }}</h2>
    <FiltroDocumentos
      v-model:filtro="filtro"
      v-model:pagina="pagina"
      prefixo="saidas"
      :ha-seguinte="haSeguinte"
    />
    <ErroSuprimentos v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0">{{ t('suprimentos.nenhum') }}</p>
    <table v-else class="tabela" data-testid="tabela-saidas">
      <caption>
        {{
          t('suprimentos.saidas.lista')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('suprimentos.documento') }}</th>
          <th scope="col">{{ t('suprimentos.data') }}</th>
          <th scope="col">{{ t('suprimentos.local') }}</th>
          <th scope="col">{{ t('suprimentos.destino') }}</th>
          <th scope="col">{{ t('suprimentos.valor') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in lista.data.value.itens" :key="d.id">
          <td>
            <RouterLink
              :to="`/suprimentos/documentos/saida/${d.chave.ano}/${d.chave.mes}/${d.chave.doc}`"
              :data-testid="`saida-doc-${d.chave.doc}`"
            >
              {{ chaveDoc(d.chave) }}
            </RouterLink>
          </td>
          <td>{{ data(d.data) }} {{ d.hora }}</td>
          <td>{{ nomeLocal(d.local) }}</td>
          <td>
            {{ destinos.find((x) => x.valor === String(d.destino))?.rotulo ?? '—'
            }}<template v-if="d.paciente"> · {{ d.paciente.nome }}</template>
          </td>
          <td>{{ reais(d.valor) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
