<script setup lang="ts">
// Escala semanal do profissional (ficha do M17, seção 7): `/agenda/consultas/escalas`. A escala em uso (a da última
// geração), as escalas planejadas com a data em que passam a valer (só do novo; a geração da grade usa a vigente)
// e as gerações da agenda, com a reversão das feitas por estas telas.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import {
  cancelarEscalaPlanejada,
  lerEscala,
  novaChave,
  planejarEscala,
  reverterGeracao,
} from '../api-agenda.js';
import AvisoGravacao from '../componentes/AvisoGravacao.vue';
import ErroAgenda from '../componentes/ErroAgenda.vue';
import { dataBr, horaBr, horaDoContrato } from '../formato.js';
import { usarAgenda } from '../usar-agenda.js';
import { usarSessao } from '../../../casca/sessao/sessao.js';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const { opcoesAgenda, pode, motivoGravacao, gravacao } = usarAgenda();
const agenda = ref(String(rota.query['agenda'] ?? ''));
const escala = useQuery({
  queryKey: computed(() => ['agenda', 'escala', agenda.value]),
  queryFn: () => lerEscala(Number(agenda.value)),
  enabled: computed(() => agenda.value !== ''),
});
const escolhas = computed(() => [{ valor: '', rotulo: t('agenda.escolha') }, ...opcoesAgenda.value]);
const DIAS = computed(() =>
  ['2', '3', '4', '5', '6', '7', '1'].map((v) => ({ valor: v, rotulo: t(`agenda.dias.${v}`) })),
);
const { permissoes } = usarSessao();
const podeEditar = computed(
  () => (gravacao.data.value?.ligada ?? false) && permissoes.value.has('agenda.escala.editar'),
);
const podeReverter = pode('agenda.reverterGrade');

interface Faixa {
  semana: string;
  inicio: string;
  fim: string;
  intervaloInicio: string;
  intervaloFim: string;
}
const vigenteDesde = ref('');
const duracao = ref('15');
const faixas = ref<Faixa[]>([
  { semana: '2', inicio: '08:00', fim: '12:00', intervaloInicio: '', intervaloFim: '' },
]);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
function acrescentar(): void {
  faixas.value.push({ semana: '3', inicio: '08:00', fim: '12:00', intervaloInicio: '', intervaloFim: '' });
}
async function rodar(fn: () => Promise<{ mensagem: string }>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = (await fn()).mensagem;
    await cliente.invalidateQueries({ queryKey: ['agenda'] });
  } catch (e) {
    erro.value = e;
  }
}
function planejar(): Promise<void> {
  const corpo = {
    vigenteDesde: vigenteDesde.value,
    duracaoMinutos: Number(duracao.value),
    faixas: faixas.value.map((f) => ({
      semana: Number(f.semana),
      inicio: horaDoContrato(f.inicio) ?? f.inicio,
      fim: horaDoContrato(f.fim) ?? f.fim,
      intervaloInicio: horaDoContrato(f.intervaloInicio),
      intervaloFim: horaDoContrato(f.intervaloFim),
    })),
  };
  return rodar(() => planejarEscala(Number(agenda.value), corpo, novaChave('escala')));
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="escalas-titulo" data-testid="tela-escalas">
    <h1 id="escalas-titulo">{{ t('agenda.escalas.titulo') }}</h1>
    <p>{{ t('agenda.escalas.texto') }}</p>
    <AvisoGravacao :motivo="motivoGravacao" />
    <SanteSelecao v-model="agenda" :rotulo="t('agenda.agenda')" :opcoes="escolhas" />

    <ErroAgenda v-if="escala.isError.value" :erro="escala.error.value" />
    <p v-else-if="agenda && !escala.data.value" role="status">{{ t('agenda.carregando') }}</p>
    <template v-else-if="escala.data.value">
      <section class="painel" aria-labelledby="escalas-atual">
        <h2 id="escalas-atual">{{ t('agenda.escalas.atual') }}</h2>
        <p v-if="escala.data.value.escala.length === 0">{{ t('agenda.escalas.semEscala') }}</p>
        <table v-else class="tabela" data-testid="escala-atual">
          <caption class="sgh-visualmente-oculto">
            {{
              t('agenda.escalas.atual')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('agenda.escalas.dia') }}</th>
              <th scope="col">{{ t('agenda.escalas.inicio') }}</th>
              <th scope="col">{{ t('agenda.escalas.fim') }}</th>
              <th scope="col">{{ t('agenda.escalas.intervalo') }}</th>
              <th scope="col">{{ t('agenda.escalas.duracao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in escala.data.value.escala" :key="`${l.semana}-${l.inicio}`">
              <td>{{ l.dia }}</td>
              <td>{{ horaBr(l.inicio) }}</td>
              <td>{{ horaBr(l.fim) }}</td>
              <td>
                {{ l.intervaloInicio ? `${horaBr(l.intervaloInicio)}–${horaBr(l.intervaloFim)}` : '—' }}
              </td>
              <td>{{ horaBr(l.duracao) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="painel" aria-labelledby="escalas-planejadas">
        <h2 id="escalas-planejadas">{{ t('agenda.escalas.planejadas') }}</h2>
        <ul v-if="escala.data.value.planejadas.length">
          <li
            v-for="p in escala.data.value.planejadas"
            :key="p.id"
            class="acoes"
            :data-testid="`planejada-${p.id}`"
          >
            {{ t('agenda.escalas.vigenteDesde') }} {{ dataBr(p.vigenteDesde) }} ·
            {{ p.linhas.map((l) => `${l.dia} ${horaBr(l.inicio)}–${horaBr(l.fim)}`).join('; ') }}
            <SanteBotao
              v-if="podeEditar"
              variante="texto"
              :rotulo="t('agenda.escalas.cancelarPlanejada')"
              @acionar="
                rodar(() => cancelarEscalaPlanejada(Number(agenda), p.id, novaChave('cancelar-escala')))
              "
            />
          </li>
        </ul>
        <form v-if="podeEditar" class="painel" @submit.prevent="planejar">
          <h3>{{ t('agenda.escalas.planejar') }}</h3>
          <div class="filtros">
            <div class="campo">
              <label for="escala-desde">{{ t('agenda.escalas.vigenteDesde') }}</label>
              <input id="escala-desde" v-model="vigenteDesde" type="date" required />
            </div>
            <div class="campo">
              <label for="escala-duracao">{{ t('agenda.agendas.duracao') }}</label>
              <input
                id="escala-duracao"
                v-model="duracao"
                type="number"
                min="5"
                max="240"
                step="5"
                required
              />
            </div>
          </div>
          <fieldset v-for="(f, i) in faixas" :key="i" class="filtros">
            <legend>{{ t('agenda.escalas.dia') }} {{ i + 1 }}</legend>
            <SanteSelecao v-model="f.semana" :rotulo="t('agenda.escalas.dia')" :opcoes="DIAS" />
            <div class="campo">
              <label :for="`faixa-ini-${i}`">{{ t('agenda.escalas.inicio') }}</label>
              <input
                :id="`faixa-ini-${i}`"
                v-model="f.inicio"
                inputmode="numeric"
                :placeholder="t('agenda.horaExemplo')"
                required
              />
            </div>
            <div class="campo">
              <label :for="`faixa-fim-${i}`">{{ t('agenda.escalas.fim') }}</label>
              <input
                :id="`faixa-fim-${i}`"
                v-model="f.fim"
                inputmode="numeric"
                :placeholder="t('agenda.horaExemplo')"
                required
              />
            </div>
            <div class="campo">
              <label :for="`faixa-ii-${i}`"
                >{{ t('agenda.escalas.intervalo') }} ({{ t('agenda.escalas.inicio') }})</label
              >
              <input :id="`faixa-ii-${i}`" v-model="f.intervaloInicio" inputmode="numeric" />
            </div>
            <div class="campo">
              <label :for="`faixa-if-${i}`"
                >{{ t('agenda.escalas.intervalo') }} ({{ t('agenda.escalas.fim') }})</label
              >
              <input :id="`faixa-if-${i}`" v-model="f.intervaloFim" inputmode="numeric" />
            </div>
            <SanteBotao
              v-if="faixas.length > 1"
              variante="texto"
              :rotulo="t('agenda.escalas.tirar', { n: i + 1 })"
              @acionar="faixas.splice(i, 1)"
            />
          </fieldset>
          <div class="acoes">
            <SanteBotao
              variante="secundario"
              :rotulo="t('agenda.escalas.acrescentar')"
              @acionar="acrescentar"
            />
            <SanteBotao tipo="submit" :rotulo="t('agenda.salvar')" />
          </div>
        </form>
      </section>

      <section class="painel" aria-labelledby="escalas-geracoes">
        <h2 id="escalas-geracoes">{{ t('agenda.escalas.geracoes') }}</h2>
        <table class="tabela" data-testid="geracoes">
          <caption class="sgh-visualmente-oculto">
            {{
              t('agenda.escalas.geracoes')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('agenda.de') }}</th>
              <th scope="col">{{ t('agenda.ate') }}</th>
              <th scope="col">{{ t('agenda.bloqueios.autor') }}</th>
              <th scope="col">{{ t('agenda.bloqueios.horarios') }}</th>
              <th scope="col">{{ t('agenda.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(g, i) in escala.data.value.geracoes" :key="g.id ?? `ant-${i}`">
              <td>{{ dataBr(g.inicio) }}</td>
              <td>{{ dataBr(g.fim) }}</td>
              <td>{{ g.autor }}</td>
              <td>{{ g.horarios ?? '—' }}</td>
              <td>
                <span v-if="g.id === null" class="secundario" :title="t('agenda.escalas.anteriorTexto')">{{
                  t('agenda.escalas.anterior')
                }}</span>
                <span v-else-if="g.revertida">{{ t('agenda.escalas.revertida') }}</span>
                <SanteBotao
                  v-else-if="g.reversivel && podeReverter"
                  variante="destrutivo"
                  :rotulo="t('agenda.escalas.reverter')"
                  :confirmacao="
                    t('agenda.escalas.reverterPergunta', { inicio: dataBr(g.inicio), fim: dataBr(g.fim) })
                  "
                  @acionar="rodar(() => reverterGeracao(g.id as number, novaChave('reverter')))"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="escala.data.value.geracoes.some((g) => g.id === null)" class="secundario">
          {{ t('agenda.escalas.anteriorTexto') }}
        </p>
      </section>
    </template>
    <p v-if="mensagem" role="status">{{ mensagem }}</p>
    <ErroAgenda v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
